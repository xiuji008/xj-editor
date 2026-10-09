<template>
  <el-dialog v-model="visible" title="文件关联设置" width="520px" @open="onOpen">
    <FileAssociationsPanel ref="panelRef" />

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import FileAssociationsPanel from './settings/FileAssociationsPanel.vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = ref(props.modelValue)
const panelRef = ref<InstanceType<typeof FileAssociationsPanel> | null>(null)

watch(() => props.modelValue, (val) => {
  visible.value = val
})

watch(visible, (val) => {
  emit('update:modelValue', val)
})

/** 重新打开时重新检测注册状态 */
function onOpen() {
  void panelRef.value?.load()
}
</script>
