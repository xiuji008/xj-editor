<template>
  <el-dialog v-model="visible" title="PlantUML 配置" width="540px" @open="onOpen">
    <PlantUmlPanel ref="panelRef" />

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import PlantUmlPanel from './settings/PlantUmlPanel.vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = ref(props.modelValue)
const panelRef = ref<InstanceType<typeof PlantUmlPanel> | null>(null)

watch(() => props.modelValue, (val) => {
  visible.value = val
})

watch(visible, (val) => {
  emit('update:modelValue', val)
})

/** 重新打开时载入最新配置 */
function onOpen() {
  panelRef.value?.load()
}

/** 保存配置，成功后关闭对话框 */
function handleSave() {
  if (panelRef.value?.save()) {
    ElMessage.success('PlantUML 配置已保存')
    visible.value = false
  }
}
</script>
