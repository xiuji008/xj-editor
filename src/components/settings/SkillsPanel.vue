<template>
  <div class="skills-panel">
    <!-- 工作区信息与操作 -->
    <div class="panel-section">
      <div class="section-title">工作区</div>
      <div class="workspace-row">
        <span class="workspace-path" :title="workspaceRoot || ''">{{ workspaceRoot || '（未打开目录）' }}</span>
        <el-button size="small" :disabled="!workspaceRoot" @click="pickImport">
          <el-icon><FolderAdd /></el-icon>导入 skill
        </el-button>
        <el-button size="small" @click="rescan">
          <el-icon><Refresh /></el-icon>重新扫描
        </el-button>
      </div>
      <p class="section-hint">
        可写 skill 安装在当前打开目录的 <code>.xj/skills/</code> 下，随目录走；同名 skill 会覆盖内置版本。
      </p>
    </div>

    <!-- 工作区 skill -->
    <div class="panel-section">
      <div class="section-title">工作区 skill（{{ workspaceSkills.length }}）</div>
      <SkillRow
        v-for="s in workspaceSkills"
        :key="s.id"
        :meta="s"
        removable
        @toggle="onToggle"
        @remove="onRemove"
        @reveal="onReveal"
        @import-compat="onImportCompat"
      />
      <div v-if="!workspaceSkills.length" class="empty-row">当前工作区还没有安装 skill</div>
    </div>

    <!-- 内置 skill -->
    <div class="panel-section">
      <div class="section-title">内置 skill（{{ builtinSkills.length }}）</div>
      <SkillRow v-for="s in builtinSkills" :key="s.id" :meta="s" @toggle="onToggle" @reveal="onReveal" />
      <div v-if="!builtinSkills.length" class="empty-row">无内置 skill</div>
    </div>

    <!-- 兼容识别（只读） -->
    <div v-if="compatSkills.length" class="panel-section">
      <div class="section-title">发现 .claude/skills（只读，{{ compatSkills.length }}）</div>
      <SkillRow v-for="s in compatSkills" :key="s.id" :meta="s" compat @import-compat="onImportCompat" />
      <p class="section-hint">兼容识别自 <code>.claude/skills/</code>，不会被自动加载；点「导入」复制到 .xj/skills 后生效。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, defineComponent, h, type PropType } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderAdd, Refresh, Switch, Delete, FolderOpened, Download, Lock } from '@element-plus/icons-vue'

const props = defineProps<{
  /** 当前 workspace 根目录 */
  workspaceRoot: string
}>()

const workspaceSkills = ref<SkillMeta[]>([])
const builtinSkills = ref<SkillMeta[]>([])
const compatSkills = ref<SkillMeta[]>([])

/** 重新扫描 */
async function rescan() {
  if (!window.mdAPI) return
  try {
    const res = await window.mdAPI.skills.list(props.workspaceRoot)
    workspaceSkills.value = res.workspace
    builtinSkills.value = res.builtin
    compatSkills.value = res.claudeCompat
  } catch (err) {
    ElMessage.error(`扫描失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

onMounted(() => void rescan())

async function onToggle(meta: SkillMeta, enabled: boolean) {
  const res = await window.mdAPI?.skills.setEnabled({ rootPath: meta.rootPath, enabled })
  if (res?.ok) {
    meta.enabled = enabled
    ElMessage.success(enabled ? '已启用' : '已停用')
  }
}

async function onRemove(meta: SkillMeta) {
  try {
    await ElMessageBox.confirm(`确定删除 skill「${meta.name}」？该操作不可恢复。`, '删除 skill', { type: 'warning' })
  } catch {
    return
  }
  const res = await window.mdAPI?.skills.remove({ rootPath: meta.rootPath })
  if (res?.ok) {
    ElMessage.success('已删除')
    await rescan()
  } else if (res) {
    ElMessage.error(res.error || '删除失败')
  }
}

async function onReveal(meta: SkillMeta) {
  const res = await window.mdAPI?.skills.reveal({ rootPath: meta.rootPath })
  if (res && !res.ok) ElMessage.error(res.error || '打开失败')
}

/** 导入 skill（文件选择 → 复制到 .xj/skills） */
async function pickImport() {
  if (!window.mdAPI || !props.workspaceRoot) return
  const picked = await window.mdAPI.openDirectory({ title: '选择 skill 所在目录（包含 SKILL.md）' })
  if (picked?.canceled !== false || !picked?.path) return
  await doImport(picked.path)
}

async function onImportCompat(meta: SkillMeta) {
  if (!props.workspaceRoot) return
  await doImport(meta.rootPath)
}

async function doImport(fromPath: string) {
  let res = await window.mdAPI?.skills.import({ workspaceRoot: props.workspaceRoot, fromPath })
  if (res?.needConfirm) {
    try {
      await ElMessageBox.confirm(res.error || '同名 skill 已存在，覆盖？', '覆盖确认', { type: 'warning' })
    } catch {
      return
    }
    res = await window.mdAPI?.skills.import({ workspaceRoot: props.workspaceRoot, fromPath, overwrite: true })
  }
  if (res?.ok) {
    ElMessage.success(`已导入：${res.name}`)
    await rescan()
  } else if (res && !res.needConfirm) {
    ElMessage.error(res.error || '导入失败')
  }
}

/** 重新载入（SettingsDialog onOpen 调用） */
function load() {
  void rescan()
}
defineExpose({ load })

/** 单行 skill 条目（本地小组件） */
const SkillRow = defineComponent({
  name: 'SkillRow',
  props: {
    meta: { type: Object as PropType<SkillMeta>, required: true },
    removable: { type: Boolean, default: false },
    compat: { type: Boolean, default: false },
  },
  emits: ['toggle', 'remove', 'reveal', 'import-compat'],
  setup(rowProps, { emit }) {
    return () =>
      h('div', { class: 'skill-row' }, [
        h('div', { class: 'skill-row__main' }, [
          h('span', { class: 'skill-row__name' }, [
            rowProps.meta.name,
            rowProps.meta.version ? h('span', { class: 'skill-row__ver' }, ` v${rowProps.meta.version}`) : null,
            rowProps.compat
              ? h('span', { class: 'skill-row__badge skill-row__badge--compat' }, [
                  h('span', { class: 'badge-inner' }, [
                    h(Lock as never, { style: { width: '10px', height: '10px' } }),
                    '只读',
                  ]),
                ])
              : null,
            rowProps.meta.hasScripts
              ? h('span', { class: 'skill-row__badge' }, '脚本未启用')
              : null,
          ]),
          h('div', { class: 'skill-row__desc', title: rowProps.meta.description }, rowProps.meta.description),
        ]),
        h('div', { class: 'skill-row__actions' }, [
          h('button', {
            class: 'skill-icon-btn',
            title: rowProps.meta.enabled ? '停用' : '启用',
            onClick: () => emit('toggle', rowProps.meta, !rowProps.meta.enabled),
          }, [h(Switch as never, { style: { width: '14px', height: '14px' }, color: rowProps.meta.enabled ? 'var(--el-color-primary)' : 'var(--el-text-color-placeholder)' })]),
          h('button', {
            class: 'skill-icon-btn',
            title: '打开目录',
            onClick: () => emit('reveal', rowProps.meta),
          }, [h(FolderOpened as never, { style: { width: '14px', height: '14px' } })]),
          rowProps.compat
            ? h('button', {
                class: 'skill-icon-btn',
                title: '导入到 .xj/skills',
                onClick: () => emit('import-compat', rowProps.meta),
              }, [h(Download as never, { style: { width: '14px', height: '14px' } })])
            : null,
          rowProps.removable
            ? h('button', {
                class: 'skill-icon-btn skill-icon-btn--danger',
                title: '删除',
                onClick: () => emit('remove', rowProps.meta),
              }, [h(Delete as never, { style: { width: '14px', height: '14px' } })])
            : null,
        ]),
      ])
  },
})
</script>

<style scoped>
.skills-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.panel-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.section-hint {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.section-hint code {
  background: var(--el-fill-color-light);
  padding: 0 4px;
  border-radius: 3px;
}
.workspace-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.workspace-path {
  flex: 1;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty-row {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  padding: 8px 0;
}
</style>

<style>
/* SkillRow 用 h() 渲染，样式放非 scoped 便于命中 */
.skill-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}
.skill-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.skill-row__name {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.skill-row__ver {
  font-weight: 400;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.skill-row__badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  font-weight: 400;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}
.skill-row__badge--compat {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}
.skill-row__desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.skill-row__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.skill-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--el-text-color-secondary);
}
.skill-icon-btn:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.skill-icon-btn--danger:hover {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
</style>
