/**
 * PDF 阅读笔记的 AI 生成能力
 *
 * 复用应用已有的 AI 通道（请求在主进程发起，见 utils/ai.ts），
 * 针对「阅读批注」场景定制提示词：
 * - 输入为读者选中的原文（quote），可选已有笔记作为追加上下文；
 * - 输出为 Markdown 文本的短笔记，便于直接落到侧栏卡片并渲染；
 * - 采用流式返回，边生成边写入笔记，用户可随时中断。
 *
 * @module utils/pdfAi
 */
import { aiChatStream, getActiveProvider, stripCodeFence } from './ai'

/** PDF 笔记场景标识（用于 AI 调用日志归类） */
export const PDF_AI_SCENE = 'pdf' as const

/** AI 生成温度：偏确定性，避免解读发散 */
const NOTE_TEMPERATURE = 0.3

/** 单次 AI 生成笔记的长度上限（字符数，超出后提示词由模型自行压缩） */
const MAX_QUOTE_LENGTH = 2000

/**
 * 阅读笔记助手的系统提示词。
 * 约束输出为可直接使用的 Markdown 短笔记，而不是复述原文。
 */
const SYSTEM_PROMPT = `你是读者的文献阅读助手，负责把读者标记的原文片段转化为有用的阅读笔记。

要求：
1. 一律使用中文，输出 Markdown 格式；
2. 直接给出「要点 / 解释 / 启示」等有价值的内容，不要复述原文，不要出现"原文大意是""这段主要讲了"之类铺垫语；
3. 结构精简：优先用 1 个小标题 + 2~4 条要点（无序列表），必要时加一句行动建议，总长度控制在 200 字以内；
4. 术语较多时用行内代码标注关键术语（如 \`RPC\`），需要强调处用加粗；
5. 只输出笔记正文，不要包裹代码块围栏，也不要输出任何前后缀说明。`

/**
 * 构建用户侧提示词。
 * @param opts.quote 读者选中的原文
 * @param opts.existing 已存在的笔记正文（作为优化 / 补充的上下文）
 * @returns 用户提示词
 */
function buildUserPrompt(opts: { quote?: string; existing?: string }): string {
  const quote = (opts.quote || '').slice(0, MAX_QUOTE_LENGTH).trim()
  const existing = (opts.existing || '').trim()
  const parts: string[] = []
  if (quote) parts.push(`【标记的原文】\n${quote}`)
  if (existing) {
    parts.push(
      `【读者已写的笔记】\n${existing}\n\n请基于上述原文，对已有笔记进行补充、纠错与精炼，输出整合后的完整笔记（不要保留"已有笔记"这类小标题）。`,
    )
  } else {
    parts.push('请为上述原文生成一条阅读笔记。')
  }
  if (!quote && !existing) parts.push('原文为空时，请回复一句"暂无原文，无法生成笔记"。')
  return parts.join('\n\n')
}

/** AI 生成结果句柄 */
export interface AiNoteSession {
  /** 是否成功发起（未配置厂商时为 false） */
  ok: boolean
  /** 错误信息（未配置 / 发起失败时给出） */
  error?: string
  /** 中断生成（不触发后续写入） */
  stop?: () => void
}

/**
 * 流式生成 PDF 阅读笔记。
 *
 * @param opts.quote 选中的原文（可为空，为空时仅依据已有笔记优化）
 * @param opts.existing 已有笔记正文
 * @param opts.onDelta 增量文本回调（尚未去除代码块围栏）
 * @param opts.onDone 生成完成回调，返回清洗后的完整文本；stopped 表示用户中断
 * @param opts.onError 失败回调
 * @returns 会话句柄，失败时 ok 为 false 且给出可读错误
 */
export async function streamAiNote(opts: {
  quote?: string
  existing?: string
  onDelta?: (delta: string) => void
  onDone?: (content: string, stopped: boolean) => void
  onError?: (error: string) => void
}): Promise<AiNoteSession> {
  const provider = await getActiveProvider()
  if (!provider) {
    return { ok: false, error: '尚未配置 AI 厂商，请先到设置中配置模型后再使用' }
  }

  let full = ''
  let stopped = false
  const session = await aiChatStream(
    provider,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt({ quote: opts.quote, existing: opts.existing }) },
    ],
    {
      onDelta: (delta) => {
        full += delta
        opts.onDelta?.(delta)
      },
      onDone: (content, payload) => {
        if (payload?.stopped) stopped = true
        const base = content ?? full
        opts.onDone?.(stripCodeFence(base), stopped)
      },
      onError: (error) => {
        opts.onError?.(error || 'AI 生成失败')
      },
    },
    NOTE_TEMPERATURE,
    PDF_AI_SCENE,
  )

  if (!session.ok) return { ok: false, error: session.error || 'AI 调用失败' }
  return { ok: true, stop: session.stop }
}
