<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, ArrowRight, Download, MagicStick, MoreFilled, Refresh, Upload, VideoPause, View } from '@element-plus/icons-vue'
import GitIcon from './GitIcon.vue'
import GitBranchDialog from './GitBranchDialog.vue'
import GitStashDialog from './GitStashDialog.vue'
import GitIgnoreDialog from './GitIgnoreDialog.vue'
import GitCommitSpecDialog from './GitCommitSpecDialog.vue'
import AiConfigDialog from './AiConfigDialog.vue'
import { gitStatusMeta } from '../utils/git'
import { aiChatStream, getActiveProvider } from '../utils/ai'
import {
  buildCommitMessagePrompt,
  buildFileSummary,
  buildRecentCommitSummary,
  getCommitSpec,
  normalizeCommitMessage,
  truncateDiffForAi,
  validateCommitMessage,
} from '../utils/commitSpec'

/**
 * Git 面板（侧边栏内嵌）
 * 提供分支管理、远程同步、变更列表、暂存 / 取消暂存、提交、储藏与忽略规则的入口。
 */

/** 变更分组类型 */
type GroupKey = 'conflicted' | 'staged' | 'unstaged'

/** 变更分组展示模型 */
interface ChangeGroup {
  key: GroupKey
  title: string
  checked: boolean
  danger: boolean
  list: GitFileChange[]
}

const props = defineProps<{
  /** 仓库根目录，为空表示当前目录不是 Git 仓库 */
  repoRoot: string
  /** 当前编辑器是否存在未保存修改 */
  dirty: boolean
  /** 提交前保存当前文件（由宿主应用提供） */
  saveCurrent?: () => Promise<void>
}>()

const emit = defineEmits<{
  /** 打开文件（仓库内相对路径） */
  'open-file': [relPath: string]
  /** 查看差异 */
  'view-diff': [payload: { paths: string[]; staged?: boolean; title?: string }]
  /** 查看提交历史 */
  'view-history': [payload: { path?: string }]
  /** 仓库状态变化（供宿主更新目录树徽标） */
  'status-change': [status: GitStatus | null]
  /** Git 设置已变更，需重新检测仓库 */
  'config-changed': []
  /** 工作区文件被整体改变（切换分支 / 拉取 / 应用储藏等），宿主需刷新目录树 */
  'repo-changed': []
}>()

/** 每窗口隔离的存储：面板布局与输入历史按窗口独立，避免多窗口互相覆盖 */
const winStore: Storage = typeof sessionStorage === 'object' && sessionStorage ? sessionStorage : localStorage
/** 面板高度持久化键 */
const HEIGHT_KEY = 'md-git-panel-height'
/** 折叠状态持久化键 */
const COLLAPSED_KEY = 'md-git-collapsed'
/** 历史提交信息持久化键 */
const MESSAGES_KEY = 'md-git-messages'
/** 提交信息输入框高度持久化键 */
const COMMIT_INPUT_HEIGHT_KEY = 'md-git-commit-input-height'
/** 面板高度范围 */
const HEIGHT_MIN = 120
const HEIGHT_MAX = 600
/** 提交信息输入框高度范围（px） */
const COMMIT_INPUT_HEIGHT_MIN = 48
const COMMIT_INPUT_HEIGHT_MAX = 360
/** 历史提交信息最多保留条数 */
const MESSAGE_MAX = 10

/** 仓库状态 */
const status = ref<GitStatus | null>(null)
/** 状态加载中 */
const loading = ref(false)
/** 提交中 */
const committing = ref(false)
/** AI 生成提交信息中 */
const generating = ref(false)
/** 当前流式会话的中断函数（生成中有效） */
let stopStream: (() => void) | null = null
/** 提交信息输入框实例（生成结束后聚焦、高度持久化） */
const commitInputRef = ref<{ focus: () => void; textarea?: unknown } | null>(null)
/** 提交规范设置弹窗 */
const specVisible = ref(false)
/** AI 配置弹窗（未配置 AI 时引导配置） */
const aiConfigVisible = ref(false)
/** 错误信息 */
const errorText = ref('')
/** 提交信息输入 */
const commitMessage = ref('')
/** 历史提交信息 */
const messageHistory = ref<string[]>([])
/** 是否折叠 */
const collapsed = ref(winStore.getItem(COLLAPSED_KEY) === '1')
/** 面板主体高度 */
const panelHeight = ref(Number(winStore.getItem(HEIGHT_KEY)) || 240)
/** 正在进行的远程操作：pull / push / fetch，空表示无 */
const syncAction = ref('')
/** 分支管理弹窗 */
const branchVisible = ref(false)
/** 储藏（stash）弹窗 */
const stashVisible = ref(false)
/** .gitignore 编辑弹窗 */
const ignoreVisible = ref(false)
/** 上次刷新时间，用于窗口聚焦时的节流 */
let lastRefreshAt = 0

/** 是否可与远程同步（游离 HEAD 时无法推送 / 拉取） */
const canSync = computed(() => !!props.repoRoot && !status.value?.detached)

/** 拉取按钮提示 */
const pullTip = computed(() =>
  status.value?.detached ? '游离 HEAD，无法同步' : `拉取（落后 ${status.value?.behind ?? 0} 个提交）`,
)

/** 推送按钮提示 */
const pushTip = computed(() =>
  status.value?.detached ? '游离 HEAD，无法同步' : `推送（领先 ${status.value?.ahead ?? 0} 个提交）`,
)

/** 变更总数 */
const totalChanges = computed(() => {
  const s = status.value
  if (!s) return 0
  return s.staged.length + s.unstaged.length + s.conflicted.length
})

/** 是否存在冲突 */
const hasConflicts = computed(() => !!status.value?.conflicted.length)

/** 是否可提交：有暂存文件、填写了提交信息且无冲突 */
const canCommit = computed(
  () => !!status.value?.staged.length && !!commitMessage.value.trim() && !hasConflicts.value,
)

/** 分支展示文本 */
const branchLabel = computed(() => {
  const s = status.value
  if (!s) return '-'
  return s.detached ? 'HEAD（游离）' : s.branch
})

/** 变更分组（空分组不展示） */
const groups = computed<ChangeGroup[]>(() => {
  const s = status.value
  if (!s) return []
  const all: ChangeGroup[] = [
    {
      key: 'conflicted',
      title: `冲突 (${s.conflicted.length})`,
      checked: false,
      danger: true,
      list: s.conflicted,
    },
    {
      key: 'staged',
      title: `已暂存的更改 (${s.staged.length})`,
      checked: true,
      danger: false,
      list: s.staged,
    },
    {
      key: 'unstaged',
      title: `未暂存的更改 (${s.unstaged.length})`,
      checked: false,
      danger: false,
      list: s.unstaged,
    },
  ]
  return all.filter((g) => g.list.length > 0)
})

/** 读取历史提交信息 */
function loadMessageHistory() {
  try {
    const list: unknown = JSON.parse(winStore.getItem(MESSAGES_KEY) || '[]')
    messageHistory.value = (Array.isArray(list) ? list : []).filter(
      (v): v is string => typeof v === 'string' && !!v.trim(),
    )
  } catch {
    messageHistory.value = []
  }
}

/** 记录一条提交信息（去重后置顶，超出上限丢弃最旧的） */
function pushMessageHistory(message: string) {
  const text = message.trim()
  if (!text) return
  messageHistory.value = [text, ...messageHistory.value.filter((m) => m !== text)].slice(0, MESSAGE_MAX)
  winStore.setItem(MESSAGES_KEY, JSON.stringify(messageHistory.value))
}

/** 统一处理 Git 写操作结果，失败时提示 */
function handleResult(res: { ok: boolean; message?: string } | undefined, fallback: string): boolean {
  if (!res || !res.ok) {
    ElMessage.error(res?.message || fallback)
    return false
  }
  return true
}

/** 刷新仓库状态 */
async function refresh(force = false) {
  if (!props.repoRoot || !window.mdAPI) return
  loading.value = true
  try {
    const res = await window.mdAPI.git.status(props.repoRoot)
    if (res?.ok && res.status) {
      status.value = res.status
      errorText.value = ''
    } else {
      status.value = null
      errorText.value = res?.message || '读取仓库状态失败'
    }
    emit('status-change', status.value)
  } finally {
    loading.value = false
    lastRefreshAt = Date.now()
  }
  if (force) lastRefreshAt = Date.now()
}

/** 暂存 / 取消暂存单个文件 */
async function toggleFile(change: GitFileChange) {
  if (!props.repoRoot || !window.mdAPI || loading.value) return
  loading.value = true
  try {
    const args = { repoRoot: props.repoRoot, paths: [change.path] }
    const res = change.staged
      ? await window.mdAPI.git.unstage(args)
      : await window.mdAPI.git.add(args)
    if (handleResult(res, '操作失败')) await refresh()
  } finally {
    loading.value = false
  }
}

/** 整组暂存 / 取消暂存 */
async function toggleGroup(key: GroupKey) {
  if (!props.repoRoot || !window.mdAPI || loading.value || !status.value) return
  const group = groups.value.find((g) => g.key === key)
  if (!group || !group.list.length) return
  loading.value = true
  try {
    const args = { repoRoot: props.repoRoot, paths: group.list.map((c) => c.path) }
    const res =
      key === 'staged' ? await window.mdAPI.git.unstage(args) : await window.mdAPI.git.add(args)
    if (handleResult(res, '操作失败')) await refresh()
  } finally {
    loading.value = false
  }
}

/* ========== AI 生成提交信息（流式回显到提交信息框） ========== */

/** 中断正在进行的 AI 生成 */
function stopGenerate() {
  stopStream?.()
  stopStream = null
  generating.value = false
}

/** 生成结束后统一收尾：清理状态、规整文案并聚焦输入框 */
function finishGenerate() {
  stopStream = null
  generating.value = false
  nextTick(() => commitInputRef.value?.focus())
}

/**
 * 调用 AI 基于当前改动生成提交信息，增量实时写入提交信息输入框。
 * 已填写内容时会先确认覆盖；生成中再次点击可停止生成。
 */
async function generateCommitMessage() {
  if (generating.value) {
    stopGenerate()
    return
  }
  if (!props.repoRoot || !window.mdAPI) return
  if (!status.value) {
    ElMessage.warning('仓库状态尚未加载完成')
    return
  }
  const provider = await getActiveProvider()
  if (!provider) {
    try {
      await ElMessageBox.confirm(
        '尚未配置可用的 AI 服务（需要填写服务地址与模型），是否现在去配置？',
        'AI 生成提交信息',
        { type: 'warning', confirmButtonText: '去配置', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    aiConfigVisible.value = true
    return
  }

  // 优先基于已暂存的改动（与将要提交的内容一致），没有暂存时回落到工作区改动
  const useStaged = status.value.staged.length > 0
  const changes = useStaged ? status.value.staged : status.value.unstaged
  if (!changes.length) {
    ElMessage.warning('当前没有改动可供生成提交信息')
    return
  }
  if (commitMessage.value.trim()) {
    try {
      await ElMessageBox.confirm('将覆盖当前已填写的提交信息，是否继续？', 'AI 生成提交信息', {
        type: 'warning',
        confirmButtonText: '覆盖并生成',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }

  const cfg = await getCommitSpec()
  if (!cfg) {
    ElMessage.error('读取提交规范失败')
    return
  }

  const paths = changes.map((c) => c.path)
  const diffRes = await window.mdAPI.git.diff({ repoRoot: props.repoRoot, paths, staged: useStaged })
  const diff = truncateDiffForAi(diffRes?.ok ? diffRes.diff || '' : '')
  let recentCommits = '（无）'
  if (cfg.includeRecentCommits) {
    const logRes = await window.mdAPI.git.log({ repoRoot: props.repoRoot, limit: 5 })
    recentCommits = buildRecentCommitSummary(logRes?.ok ? logRes.commits || [] : [])
  }
  const prompt = buildCommitMessagePrompt(cfg.spec, cfg.promptTemplate, {
    branch: branchLabel.value,
    files: buildFileSummary(changes),
    diff,
    recentCommits,
  })
  if (!useStaged) ElMessage.info('没有已暂存的改动，已基于工作区改动生成')

  generating.value = true
  commitMessage.value = ''
  try {
    const session = await aiChatStream(
      provider,
      [{ role: 'user', content: prompt }],
      {
        onDelta: (delta) => {
          commitMessage.value += delta
        },
        onDone: (content, payload) => {
          commitMessage.value = normalizeCommitMessage(content || commitMessage.value)
          finishGenerate()
          if (payload?.fallback) ElMessage.info('该模型未返回流式结果，已一次性生成')
        },
        onError: (error, payload) => {
          const partial = normalizeCommitMessage(payload?.content || commitMessage.value)
          if (partial) commitMessage.value = partial
          finishGenerate()
          ElMessage.error(error)
        },
      },
      0.2,
      'commit',
    )
    if (!session.ok) {
      ElMessage.error(session.error || 'AI 生成失败')
      finishGenerate()
      return
    }
    stopStream = session.stop
  } catch (err) {
    ElMessage.error(String(err))
    finishGenerate()
  }
}

/** 提交已暂存的更改 */
async function doCommit() {
  const message = commitMessage.value.trim()
  if (!message || !props.repoRoot || !window.mdAPI) return
  if (hasConflicts.value) {
    ElMessage.warning('存在冲突文件，请先在外部工具中解决冲突后再提交')
    return
  }
  if (!status.value?.staged.length) {
    ElMessage.warning('请先勾选要提交的文件')
    return
  }
  // 当前编辑器有未保存内容时先让用户决定是否保存，避免把旧内容提交进去
  if (props.dirty && typeof props.saveCurrent === 'function') {
    try {
      await ElMessageBox.confirm('当前打开的文件有未保存的修改，是否保存后继续提交？', '提示', {
        type: 'warning',
        confirmButtonText: '保存并继续',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
    await props.saveCurrent()
  }
  // 开启规范校验时不合规先提示，确认后仍可提交（不强制阻断）
  const specConfig = await getCommitSpec()
  if (specConfig?.validateBeforeCommit) {
    const check = validateCommitMessage(message)
    if (!check.ok) {
      try {
        await ElMessageBox.confirm(`提交信息可能不符合规范：${check.message}。是否仍要提交？`, '提交规范校验', {
          type: 'warning',
          confirmButtonText: '仍要提交',
          cancelButtonText: '取消',
        })
      } catch {
        return
      }
    }
  }
  committing.value = true
  try {
    const res = await window.mdAPI.git.commit({ repoRoot: props.repoRoot, message })
    if (!handleResult(res, '提交失败')) return
    pushMessageHistory(message)
    commitMessage.value = ''
    ElMessage.success('已提交')
    await refresh()
  } finally {
    committing.value = false
  }
}

/** 在差异弹窗中查看单个文件的差异 */
function viewDiffOf(change: GitFileChange) {
  emit('view-diff', {
    paths: [change.path],
    staged: change.staged,
    title: change.path,
  })
}

/* ========== P1：远程同步 / 分支 / 储藏 / 忽略规则 ========== */

/** 拉取远程更新 */
async function doPull() {
  if (!props.repoRoot || syncAction.value || !window.mdAPI) return
  syncAction.value = 'pull'
  try {
    const res = await window.mdAPI.git.pull({ repoRoot: props.repoRoot })
    if (!handleResult(res, '拉取失败')) return
    ElMessage.success(/already up.to.date/i.test(res?.summary || '') ? '已是最新' : '已拉取')
    await refresh()
    emit('repo-changed')
  } finally {
    syncAction.value = ''
  }
}

/** 推送本地提交；无上游分支时先询问是否设置上游 */
async function doPush() {
  if (!props.repoRoot || syncAction.value || !window.mdAPI) return
  let setUpstream = false
  if (!status.value?.upstream) {
    try {
      await ElMessageBox.confirm('当前分支还没有上游分支，是否设置上游并推送？', '推送', {
        type: 'warning',
        confirmButtonText: '设置上游并推送',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
    setUpstream = true
  }
  syncAction.value = 'push'
  try {
    const res = await window.mdAPI.git.push({
      repoRoot: props.repoRoot,
      branch: status.value?.branch || '',
      setUpstream,
    })
    if (!handleResult(res, '推送失败')) return
    ElMessage.success(/everything up-to-date/i.test(res?.summary || '') ? '已是最新，无需推送' : '已推送')
    await refresh()
    emit('repo-changed')
  } finally {
    syncAction.value = ''
  }
}

/** 获取远程更新（仅刷新远程分支信息，不改动工作区） */
async function doFetch() {
  if (!props.repoRoot || syncAction.value || !window.mdAPI) return
  syncAction.value = 'fetch'
  try {
    const res = await window.mdAPI.git.fetch({ repoRoot: props.repoRoot, prune: true })
    if (!handleResult(res, '获取远程更新失败')) return
    ElMessage.success('已获取远程更新')
    await refresh()
  } finally {
    syncAction.value = ''
  }
}

/** 分支 / 储藏 / 忽略规则弹窗内发生变更后：刷新状态并通知宿主刷新目录树 */
async function onDialogChanged() {
  await refresh()
  emit('repo-changed')
}

/** 更多菜单命令 */
async function onCommand(command: string) {
  if (command === 'branch') {
    branchVisible.value = true
    return
  }
  if (command === 'stash') {
    stashVisible.value = true
    return
  }
  if (command === 'ignore') {
    ignoreVisible.value = true
    return
  }
  if (command === 'pull') {
    await doPull()
    return
  }
  if (command === 'push') {
    await doPush()
    return
  }
  if (command === 'fetch') {
    await doFetch()
    return
  }
  if (command === 'history') {
    emit('view-history', {})
    return
  }
  if (command === 'commitSpec') {
    specVisible.value = true
    return
  }
  if (command === 'refresh') {
    await refresh(true)
    return
  }
  if (command === 'settings') {
    const cfg = await window.mdAPI?.git.getConfig()
    const { value } = await ElMessageBox.prompt(
      '未检测到 Git 或需要使用指定版本时，可填写 git.exe 的完整路径（留空则自动探测）。',
      'Git 设置',
      {
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        inputValue: cfg?.gitPath || '',
        inputPlaceholder: '例如：C:\\Program Files\\Git\\cmd\\git.exe',
      },
    ).catch(() => ({ value: '' as string }))
    const gitPath = (value || '').trim()
    const res = await window.mdAPI?.git.setConfig({ gitPath })
    if (res?.ok) {
      ElMessage.success(gitPath ? '已保存 Git 路径' : '已恢复自动探测')
      emit('config-changed')
    } else {
      ElMessage.error(res?.message || '保存失败')
    }
  }
}

/** 切换折叠状态并持久化 */
function toggleCollapse() {
  collapsed.value = !collapsed.value
  winStore.setItem(COLLAPSED_KEY, collapsed.value ? '1' : '0')
}

/* ========== 面板高度拖动 ========== */
let resizing = false
let startY = 0
let startHeight = 0

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  resizing = true
  startY = e.clientY
  startHeight = panelHeight.value
  document.body.classList.add('git-panel-resizing')
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  if (!resizing) return
  const next = startHeight + (e.clientY - startY)
  panelHeight.value = Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, next))
}

function onResizeEnd() {
  if (!resizing) return
  resizing = false
  document.body.classList.remove('git-panel-resizing')
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  winStore.setItem(HEIGHT_KEY, String(panelHeight.value))
}

/* ========== 提交信息输入框高度 ========== */
/** 监听输入框高度变化的观察器（记住用户拖动后的高度） */
let commitResizeObserver: ResizeObserver | null = null

/**
 * 让提交信息输入框可以向下拉长：恢复上次拖动的高度，并把新的高度写入本地存储。
 * 输入框随仓库状态渲染，状态变化后需要重新绑定到新的 textarea 元素。
 */
function setupCommitInputResize() {
  commitResizeObserver?.disconnect()
  const el = commitInputRef.value?.textarea as HTMLTextAreaElement | undefined
  if (!el) return
  const saved = Number(winStore.getItem(COMMIT_INPUT_HEIGHT_KEY))
  if (saved >= COMMIT_INPUT_HEIGHT_MIN) {
    el.style.height = `${Math.min(COMMIT_INPUT_HEIGHT_MAX, saved)}px`
  }
  commitResizeObserver = new ResizeObserver(() => {
    const height = el.clientHeight
    if (height < COMMIT_INPUT_HEIGHT_MIN) return
    winStore.setItem(COMMIT_INPUT_HEIGHT_KEY, String(Math.min(COMMIT_INPUT_HEIGHT_MAX, height)))
  })
  commitResizeObserver.observe(el)
}

/** 窗口重新聚焦且距上次刷新超过 5s 时自动刷新 */
function onWindowFocus() {
  if (!props.repoRoot) return
  if (Date.now() - lastRefreshAt < 5000) return
  refresh()
}

watch(
  () => props.repoRoot,
  (root) => {
    status.value = null
    errorText.value = ''
    emit('status-change', null)
    if (root) refresh()
  },
  { immediate: true },
)

// 提交区随仓库状态渲染，状态就绪后再绑定输入框高度
watch(status, (value) => {
  if (value) nextTick(setupCommitInputResize)
})

onMounted(() => {
  loadMessageHistory()
  window.addEventListener('focus', onWindowFocus)
  nextTick(setupCommitInputResize)
})

onBeforeUnmount(() => {
  // 卸载时中断可能仍在进行中的 AI 生成，避免回调打到已销毁组件
  stopGenerate()
  commitResizeObserver?.disconnect()
  commitResizeObserver = null
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  document.body.classList.remove('git-panel-resizing')
})

defineExpose({ refresh })
</script>

<template>
  <div class="git-panel">
    <div class="git-resizer" title="拖动调整高度" @mousedown="onResizeStart" />

    <!-- 头部：分支 / 同步状态 / 操作 -->
    <div class="git-header">
      <span
        class="git-branch"
        :class="{ clickable: !!repoRoot }"
        :title="repoRoot ? `${status?.repoRoot || repoRoot}（点击管理分支）` : ''"
        @click="repoRoot && (branchVisible = true)"
      >
        <GitIcon class="branch-icon" />
        <span class="branch-name">{{ branchLabel }}</span>
        <span
          v-if="status?.upstream"
          class="sync-info"
          :title="`领先 ${status.ahead} 个提交 / 落后 ${status.behind} 个提交`"
        >
          ↑{{ status.ahead }} ↓{{ status.behind }}
        </span>
      </span>
      <div class="git-actions">
        <el-tooltip :content="pullTip" placement="top">
          <el-button
            text
            size="small"
            :icon="Download"
            :loading="syncAction === 'pull'"
            :disabled="!canSync || !!syncAction"
            @click="doPull"
          />
        </el-tooltip>
        <el-tooltip :content="pushTip" placement="top">
          <el-button
            text
            size="small"
            :icon="Upload"
            :loading="syncAction === 'push'"
            :disabled="!canSync || !!syncAction"
            @click="doPush"
          />
        </el-tooltip>
        <el-tooltip content="刷新" placement="top">
          <el-button text size="small" :icon="Refresh" :loading="loading" @click="refresh(true)" />
        </el-tooltip>
        <el-dropdown trigger="click" @command="onCommand">
          <el-button text size="small" :icon="MoreFilled" />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="branch">分支管理…</el-dropdown-item>
              <el-dropdown-item command="pull">拉取</el-dropdown-item>
              <el-dropdown-item command="push">推送</el-dropdown-item>
              <el-dropdown-item command="fetch">获取远程更新</el-dropdown-item>
              <el-dropdown-item command="stash" divided>储藏（stash）…</el-dropdown-item>
              <el-dropdown-item command="ignore">编辑 .gitignore…</el-dropdown-item>
              <el-dropdown-item command="history" divided>查看提交历史</el-dropdown-item>
              <el-dropdown-item command="refresh">刷新状态</el-dropdown-item>
              <el-dropdown-item command="commitSpec" divided>提交规范设置…</el-dropdown-item>
              <el-dropdown-item command="settings">Git 设置…</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-tooltip :content="collapsed ? '展开' : '收起'" placement="top">
          <el-button
            text
            size="small"
            :icon="collapsed ? ArrowRight : ArrowDown"
            @click="toggleCollapse"
          />
        </el-tooltip>
      </div>
    </div>

    <!-- 主体：变更列表 + 提交区 -->
    <div v-show="!collapsed" class="git-body" :style="{ height: panelHeight + 'px' }">
      <div v-if="!status" class="git-tip">
        {{ repoRoot ? errorText || '读取中…' : '未检测到 Git，可在 ⋯ 菜单中设置 git.exe 路径' }}
      </div>
      <template v-else>
        <div class="git-summary">
          <span>更改 ({{ totalChanges }})</span>
          <span v-if="status.truncated" class="truncated-tip" title="变更过多，仅显示部分">
            仅显示部分
          </span>
        </div>

        <div v-for="group in groups" :key="group.key" class="git-group">
          <div class="group-header">
            <el-checkbox :model-value="group.checked" @change="toggleGroup(group.key)" />
            <span class="group-title" :class="{ danger: group.danger }">{{ group.title }}</span>
          </div>
          <div
            v-for="change in group.list"
            :key="`${group.key}-${change.path}`"
            class="change-item"
            :title="change.path"
            @click="emit('open-file', change.path)"
          >
            <el-checkbox :model-value="change.staged" @click.stop @change="toggleFile(change)" />
            <span
              class="change-status"
              :style="{ color: gitStatusMeta(change.status).color }"
              :title="gitStatusMeta(change.status).label"
            >
              {{ gitStatusMeta(change.status).text }}
            </span>
            <span class="change-name">{{ change.name }}</span>
            <span v-if="change.dir" class="change-dir">{{ change.dir }}</span>
            <el-button
              text
              size="small"
              :icon="View"
              title="查看差异"
              @click.stop="viewDiffOf(change)"
            />
          </div>
        </div>

        <div v-if="totalChanges === 0" class="git-tip">当前没有更改</div>

        <!-- 提交区 -->
        <div class="git-commit">
          <el-input
            ref="commitInputRef"
            v-model="commitMessage"
            class="commit-input"
            type="textarea"
            :rows="2"
            resize="vertical"
            maxlength="500"
            title="拖动右下角可向下拉长"
            placeholder="输入提交信息（Ctrl+Enter 提交），或点击「AI 生成」自动撰写"
            @keydown.ctrl.enter.prevent="doCommit"
          />
          <div class="commit-actions">
            <el-tooltip
              :content="generating ? '停止生成' : '基于当前改动生成规范的提交信息'"
              placement="top"
            >
              <el-button
                v-if="!generating"
                size="small"
                type="primary"
                plain
                :icon="MagicStick"
                @click="generateCommitMessage"
              >
                AI 生成
              </el-button>
              <el-button v-else size="small" type="danger" plain :icon="VideoPause" @click="stopGenerate">
                停止
              </el-button>
            </el-tooltip>
            <div class="commit-actions-right">
              <el-dropdown
                v-if="messageHistory.length"
                trigger="click"
                @command="(v: string) => (commitMessage = v)"
              >
                <el-button text size="small">历史信息</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-for="m in messageHistory" :key="m" :command="m">
                      {{ m }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-button size="small" @click="emit('view-history', {})">历史</el-button>
              <el-button
                size="small"
                type="primary"
                :loading="committing"
                :disabled="!canCommit"
                @click="doCommit"
              >
                提交
              </el-button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 分支 / 储藏 / 忽略规则弹窗：append-to-body 避免被侧边栏裁剪 -->
    <GitBranchDialog
      v-model="branchVisible"
      :repo-root="repoRoot"
      append-to-body
      @changed="onDialogChanged"
    />
    <GitStashDialog
      v-model="stashVisible"
      :repo-root="repoRoot"
      append-to-body
      @changed="onDialogChanged"
    />
    <GitIgnoreDialog
      v-model="ignoreVisible"
      :repo-root="repoRoot"
      append-to-body
      @changed="onDialogChanged"
    />
    <!-- 提交规范与 AI 配置：append-to-body 避免被侧边栏裁剪 -->
    <GitCommitSpecDialog v-model="specVisible" />
    <AiConfigDialog v-model="aiConfigVisible" />
  </div>
</template>

<style scoped>
.git-panel {
  position: relative;
  border-top: 1px solid var(--border-color-lighter, #ebeef5);
  background: var(--fill-color-blank, #fff);
}

.git-resizer {
  height: 4px;
  cursor: ns-resize;
}

.git-resizer:hover {
  background: var(--color-primary-light-8, #d9ecff);
}

.git-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 4px 8px;
}

.git-branch {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 12px;
  color: var(--text-color-primary, #303133);
}

.branch-icon {
  color: var(--color-primary, #409eff);
}

.git-branch.clickable {
  cursor: pointer;
}

.git-branch.clickable:hover .branch-name {
  color: var(--color-primary, #409eff);
  text-decoration: underline;
}

.branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-info {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-color-secondary, #909399);
}

.git-actions {
  display: flex;
  align-items: center;
}

.git-body {
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding: 0 8px 8px;
}

.git-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 0;
  font-size: 12px;
  color: var(--text-color-primary, #303133);
}

.truncated-tip {
  font-size: 11px;
  color: var(--text-color-secondary, #909399);
}

.git-group {
  margin-top: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
}

.group-title {
  font-size: 12px;
  color: var(--text-color-regular, #606266);
}

.group-title.danger {
  color: #c74e39;
}

.change-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
}

.change-item:hover {
  background: var(--fill-color-light, #f5f7fa);
}

.change-status {
  flex: 0 0 auto;
  font-family: Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
}

.change-name {
  flex: 0 0 auto;
  max-width: 50%;
  font-size: 12px;
  color: var(--text-color-primary, #303133);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-dir {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-color-secondary, #a8abb2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-tip {
  padding: 8px 0;
  font-size: 12px;
  color: var(--text-color-secondary, #909399);
}

.git-commit {
  margin-top: 8px;
}

/* 提交信息输入框允许向下拉长，并限制拉伸范围 */
.commit-input :deep(.el-textarea__inner) {
  min-height: 48px;
  max-height: 360px;
}

.commit-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 6px;
}

.commit-actions-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
