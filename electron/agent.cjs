/**
 * Agent 运行时（Electron 主进程模块，基于 Vercel AI SDK v5）
 * - 唯一 agent 链路：provider 工厂 + streamText 多步工具调用循环
 * - 工具在主进程注册（zod schema），execute 通过反向 IPC 调发起窗口的渲染进程执行
 * - 每步经 onStepFinish 写入 aiLogger（runId/step/skill/tools/thinking）
 * - 普通对话链路（ai.cjs）与本模块互不影响
 */
const { streamText, tool, stepCountIs } = require('ai')
const { z } = require('zod')
const aiLogger = require('./aiLogger.cjs')
const skills = require('./skills.cjs')

/** 渲染进程工具执行超时（毫秒） */
const TOOL_CALL_TIMEOUT = 30000

// ============================================================
// 工具 schema 与注册表
// ============================================================

const NodeInput = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  sub: z.string().optional(),
  shape: z.enum(['rect', 'rounded', 'diamond', 'ellipse']).optional(),
  tone: z.string().optional(),
})
const EdgeInput = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
  kind: z.enum(['solid', 'dashed', 'dotted']).optional(),
})
const GroupInput = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  children: z.array(z.string()).min(1),
})
/** CanvasSpec：严格定义结构，字段语义见 skills/excalidraw-diagram/references/canvas-spec.md */
const CanvasSpecInput = z.object({
  layout: z.enum(['flow-v', 'flow-h', 'mindmap', 'swimlane', 'sequence']).optional(),
  theme: z.enum(['professional', 'colorful', 'mono', 'hand-drawn']).optional(),
  title: z.string().optional(),
  groups: z.array(GroupInput).max(10).optional(),
  nodes: z.array(NodeInput).min(1).max(40),
  edges: z.array(EdgeInput).max(80).optional(),
})

/**
 * 构建本次运行的工具表（按 payload.toolNames 与 skill 声明过滤）
 * @param {object} payload agent:run 入参
 * @param {Electron.WebContents} sender 发起窗口
 */
function buildTools(payload, sender) {
  const runId = payload.runId
  const allowed = new Set(Array.isArray(payload.toolNames) ? payload.toolNames : [])
  const durations = new Map() // toolCallId -> 执行耗时（毫秒）

  const wrap = (definition, runner) =>
    tool({
      ...definition,
      execute: async (input, options) => {
        const started = Date.now()
        try {
          const result = await runner(input, options)
          if (options?.toolCallId) durations.set(options.toolCallId, Date.now() - started)
          return result
        } catch (err) {
          if (options?.toolCallId) durations.set(options.toolCallId, Date.now() - started)
          throw err
        }
      },
    })

  const defs = {}

  // 读取画布摘要（渲染进程执行）
  if (allowed.has('whiteboard_get_scene')) {
    defs.whiteboard_get_scene = wrap(
      {
        description:
          '获取当前白板摘要：元素数量、类型分布、当前选中元素（仅 id/type/text）、视口。用于判断是否已有内容和避让。',
        inputSchema: z.object({}),
      },
      async () => callRenderer(sender, runId, 'whiteboard_get_scene', {}),
    )
  }

  // 应用 CanvasSpec（渲染进程编译为 elements 后生成预览，不直接落画布，等待用户确认）
  if (allowed.has('whiteboard_apply_elements')) {
    defs.whiteboard_apply_elements = wrap(
      {
        description:
          '把 CanvasSpec（DSL）编译为 Excalidraw 元素并生成预览。不会直接写入画布，用户会在界面上确认插入或替换。同一次回答里只需要调用一次。',
        inputSchema: z.object({
          spec: CanvasSpecInput.describe('图的 DSL 描述（节点/边/分组/布局）'),
          mode: z.enum(['append', 'replace']).optional().describe('append 追加到现有内容之后；replace 覆盖整个画布'),
        }),
      },
      async (input) =>
        callRenderer(sender, runId, 'whiteboard_apply_elements', {
          spec: input.spec,
          mode: input.mode || 'append',
        }),
    )
  }

  // 读取 skill 参考文档（主进程直接执行，路径白名单）
  if (allowed.has('skill_read_reference')) {
    defs.skill_read_reference = wrap(
      {
        description: '读取当前 skill 的 references/ 参考文档（如 layout-recipes.md、style-tokens.md、canvas-spec.md）。',
        inputSchema: z.object({
          name: z.string().describe('文档名，如 layout-recipes.md'),
        }),
      },
      async (input) => {
        const rel = String(input?.name || '').replace(/\\/g, '/')
        const relPath = rel.startsWith('references/') ? rel : `references/${rel}`
        const res = skills.readSkillResource({ rootPath: payload.skillRoot, relPath })
        if (!res.ok) return { ok: false, error: res.error }
        return { ok: true, relPath: res.relPath, content: res.content }
      },
    )
  }

  return { defs, durations }
}

// ============================================================
// 反向 IPC：主进程 -> 渲染进程执行工具
// ============================================================

/** 进行中的工具调用：callId -> { resolve, reject, timer, sender } */
const pendingCalls = new Map()
let callSeq = 0

/**
 * 调发起窗口的渲染进程执行工具
 * @param {Electron.WebContents} sender 发起运行的窗口
 * @param {string} runId 运行标识
 * @param {string} name 工具名
 * @param {object} args 工具入参
 */
function callRenderer(sender, runId, name, args) {
  if (!sender || sender.isDestroyed()) return Promise.reject(new Error('窗口已关闭'))
  const callId = `${runId}-${++callSeq}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(callId)
      reject(new Error(`工具 ${name} 执行超时（${TOOL_CALL_TIMEOUT / 1000}s）`))
    }, TOOL_CALL_TIMEOUT)
    pendingCalls.set(callId, { resolve, reject, timer, sender })
    sender.send('agent:tool-call', { runId, callId, name, args })
  })
}

/** 渲染进程回传工具结果（main.cjs 注册 agent:tool-result 后转发到这里） */
function handleToolResult(event, payload = {}) {
  const callId = String(payload.callId || '')
  const pending = pendingCalls.get(callId)
  if (!pending) return { ok: false, error: '调用不存在或已超时' }
  if (event.sender !== pending.sender) return { ok: false, error: '来源窗口不匹配' }
  clearTimeout(pending.timer)
  pendingCalls.delete(callId)
  if (payload.ok) pending.resolve(payload.data ?? { ok: true })
  else pending.reject(new Error(String(payload.error || '工具执行失败')))
  return { ok: true }
}

/** 清理某次运行遗留的待处理调用（窗口关闭 / 运行结束） */
function clearPendingCallsByRun(runId) {
  for (const [callId, pending] of pendingCalls) {
    if (callId.startsWith(`${runId}-`)) {
      clearTimeout(pending.timer)
      pendingCalls.delete(callId)
      pending.reject(new Error('运行已结束'))
    }
  }
}

// ============================================================
// 运行管理
// ============================================================

/** 进行中的 agent 运行：runId -> { controller, sender } */
const runs = new Map()

/**
 * 厂商配置 -> AI SDK model 实例
 * @param {object} provider { format, baseUrl, apiKey, model }
 */
function createModel(provider) {
  const format = provider.format || 'openai'
  const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '')
  const apiKey = String(provider.apiKey || '')
  const model = String(provider.model || '')
  if (!baseUrl || !model) throw new Error('请先在 AI 配置中填写服务地址与模型')
  if (format === 'anthropic') {
    return require('@ai-sdk/anthropic').createAnthropic({ apiKey, baseURL: baseUrl })(model)
  }
  if (format === 'gemini') {
    return require('@ai-sdk/google').createGoogleGenerativeAI({ apiKey, baseURL: baseUrl })(model)
  }
  // openai 兼容格式（默认；Ollama 等本地模型可不填 Key）
  return require('@ai-sdk/openai').createOpenAI({ apiKey, baseURL: baseUrl }).chat(model)
}

/** 提取 reasoning 字段文本（可能是字符串或分段数组） */
function extractText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((p) => (typeof p === 'string' ? p : String(p?.text || '')))
      .join('')
  }
  return ''
}

/** 消息 -> ModelMessage（过滤 system，system 走顶层参数） */
function toCoreMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.role !== 'system' && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
}

/** 组装单步的工具调用日志（toolCalls 与 toolResults 按 toolCallId 对齐） */
function buildToolsLog(step, durations) {
  const calls = Array.isArray(step?.toolCalls) ? step.toolCalls : []
  const results = new Map()
  for (const r of Array.isArray(step?.toolResults) ? step.toolResults : []) {
    results.set(String(r?.toolCallId || ''), r)
  }
  return calls.map((c) => {
    const result = results.get(String(c?.toolCallId || ''))
    const argsText = safeJsonText(c?.input, 2000)
    const resultText = result ? safeJsonText(result.output, 500) : ''
    const resultIsError = !!result && (result.isError === true || result?.result?.isError === true)
    return {
      name: String(c?.toolName || ''),
      ok: !!result && !resultIsError,
      elapsedMs: Number(durations.get(String(c?.toolCallId || ''))) || null,
      argsChars: argsText.length,
      argsSnippet: argsText,
      resultChars: resultText.length,
      resultSnippet: resultText,
      error: resultIsError ? '工具执行报错' : result ? '' : '无结果（可能被中断）',
    }
  })
}

/** JSON 安全序列化（截断） */
function safeJsonText(value, limit) {
  let text = ''
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  return (text || '').slice(0, limit)
}

/**
 * 运行一次 agent（立即返回；事件通过 agent:event 推送，工具调用通过 agent:tool-call 推送）
 * @param {object} payload { runId, provider, system, messages, toolNames, skill, skillRoot, maxSteps, temperature }
 * @param {Electron.WebContents} sender 发起窗口
 */
async function runAgent(payload = {}, sender) {
  const runId = String(payload.runId || '')
  const provider = payload.provider
  const messages = payload.messages
  const send = (channel, data) => {
    if (sender && !sender.isDestroyed()) sender.send(channel, data)
  }
  if (!runId) return { ok: false, error: '缺少运行标识' }
  if (!provider?.id) return { ok: false, error: '未选择 AI 厂商' }
  if (provider.toolSupport === false) {
    return { ok: false, error: '当前厂商/模型未启用工具调用（AI 配置中已关闭），无法执行 skill' }
  }
  const coreMessages = toCoreMessages(messages)
  if (!coreMessages.length) return { ok: false, error: '对话内容为空' }

  let model
  try {
    model = createModel(provider)
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }

  const { defs, durations } = buildTools(payload, sender)
  if (!Object.keys(defs).length) return { ok: false, error: '当前 skill 没有可用的工具' }

  const controller = new AbortController()
  runs.set(runId, { controller, sender })
  const maxSteps = Math.min(10, Math.max(1, Number(payload.maxSteps) || 5))
  const temperature = Number.isFinite(payload.temperature) ? payload.temperature : 0.4
  const started = Date.now()
  let stepIndex = 0
  let lastStepAt = started
  let produced = ''

  ;(async () => {
    try {
      const result = streamText({
        model,
        system: String(payload.system || ''),
        messages: coreMessages,
        tools: defs,
        temperature,
        stopWhen: stepCountIs(maxSteps),
        abortSignal: controller.signal,
        onStepFinish: (step) => {
          stepIndex++
          const now = Date.now()
          const elapsedMs = now - lastStepAt
          lastStepAt = now
          const usage = step?.usage || {}
          const input = Number(usage.inputTokens ?? usage.promptTokens)
          const output = Number(usage.outputTokens ?? usage.completionTokens)
          const hasUsage = Number.isFinite(input) && Number.isFinite(output)
          const stepText = extractText(step?.text)
          aiLogger
            .logAiCall({
              requestId: `${runId}-s${stepIndex}`,
              runId,
              step: stepIndex,
              skill: payload.skill || null,
              scene: 'skill',
              provider,
              messages,
              temperature,
              stream: true,
              ok: !String(step?.finishReason || '').includes('error'),
              content: stepText,
              thinking: extractText(step?.reasoning),
              usage: hasUsage ? { input, output, total: Number(usage.totalTokens) || input + output } : null,
              elapsedMs,
              finishReason: String(step?.finishReason || ''),
              tools: buildToolsLog(step, durations),
            })
            .catch(() => {})
        },
      })
      for await (const chunk of result.fullStream) {
        switch (chunk?.type) {
          case 'text-delta': {
            const delta = chunk.text ?? chunk.textDelta ?? ''
            if (delta) {
              produced += delta
              send('agent:event', { runId, type: 'text-delta', delta })
            }
            break
          }
          case 'reasoning-delta': {
            const delta = chunk.text ?? chunk.textDelta ?? ''
            if (delta) send('agent:event', { runId, type: 'reasoning-delta', delta })
            break
          }
          case 'tool-call':
            send('agent:event', { runId, type: 'tool-start', name: chunk.toolName })
            break
          case 'tool-result':
            send('agent:event', { runId, type: 'tool-result', name: chunk.toolName })
            break
          case 'error':
            throw chunk.error instanceof Error ? chunk.error : new Error(String(chunk?.error?.message || chunk?.error || '请求失败'))
          default:
            break
        }
      }
      send('agent:event', { runId, type: 'done', text: produced })
    } catch (err) {
      const stopped = controller.signal.aborted || err?.name === 'AbortError'
      if (stopped) {
        send('agent:event', { runId, type: 'done', text: produced, stopped: true })
      } else {
        const msg = err?.message || String(err)
        send('agent:event', { runId, type: 'error', error: msg })
      }
    } finally {
      runs.delete(runId)
      clearPendingCallsByRun(runId)
    }
  })()

  return { ok: true, runId, elapsed0: Date.now() - started }
}

/** 停止运行 */
function stopRun(runId) {
  const run = runs.get(String(runId || ''))
  if (!run) return { ok: false, error: '运行不存在或已结束' }
  run.controller.abort()
  return { ok: true }
}

/** 窗口关闭时清理其发起的运行（main.cjs 在窗口 closed 事件里调用） */
function disposeSender(sender) {
  for (const [runId, run] of runs) {
    if (run.sender === sender) {
      run.controller.abort()
      runs.delete(runId)
      clearPendingCallsByRun(runId)
    }
  }
}

/**
 * 注册 agent 相关 IPC（由 main.cjs 调用一次）
 * @param {Electron.IpcMain} ipcMain
 */
function registerAgentIpc(ipcMain) {
  ipcMain.handle('agent:run', (event, payload) => runAgent(payload, event.sender))
  ipcMain.handle('agent:stop', (_event, payload) => stopRun(payload?.runId))
  ipcMain.on('agent:tool-result', (event, payload) => handleToolResult(event, payload))
}

module.exports = {
  registerAgentIpc,
  runAgent,
  stopRun,
  disposeSender,
}
