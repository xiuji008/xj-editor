<template>
  <el-dialog v-model="visible" title="快捷 AI 提示词" width="820px" top="6vh" @open="onOpen">
    <div class="dialog-body">
      <QuickAiPanel ref="panelRef" />
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import QuickAiPanel from './settings/QuickAiPanel.vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 保存成功后通知外部刷新快捷动作 */
  saved: []
}>()

const visible = ref(props.modelValue)
const panelRef = ref<InstanceType<typeof QuickAiPanel> | null>(null)

watch(() => props.modelValue, (val) => {
  visible.value = val
})

watch(visible, (val) => {
  emit('update:modelValue', val)
})

/** 打开时载入最新配置 */
function onOpen() {
  void panelRef.value?.load()
}

/** 保存并通知外部刷新 */
async function handleSave() {
  if (await panelRef.value?.save()) {
    ElMessage.success('快捷 AI 提示词已保存')
    visible.value = false
    emit('saved')
  }
}
</script>

<style scoped>
.dialog-body {
  height: 460px;
}
</style>
