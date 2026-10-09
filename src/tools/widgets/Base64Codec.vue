<template>
  <div class="base64-codec">
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="codec-alert" />

    <div class="codec-toolbar">
      <el-radio-group v-model="mode" size="small">
        <el-radio-button value="encode">编码</el-radio-button>
        <el-radio-button value="decode">解码</el-radio-button>
      </el-radio-group>
      <el-checkbox v-model="urlSafe" size="small">URL 安全（-_ 替换 +/，去掉 =）</el-checkbox>
      <div class="toolbar-spacer" />
      <el-button size="small" @click="handleSample">填入示例</el-button>
      <el-button size="small" @click="handleClear">清空</el-button>
    </div>

    <div class="codec-panes">
      <ToolSection title="输入" :copyable="false">
        <el-input
          v-model="input"
          type="textarea"
          :rows="8"
          resize="none"
          spellcheck="false"
          placeholder="在此输入待处理的文本"
        />
      </ToolSection>

      <div class="pane-switch">
        <el-button text :icon="Bottom" @click="swapResult" />
      </div>

      <ToolSection title="输出" :copyable="true" :text="output">
        <el-input
          :model-value="output"
          type="textarea"
          :rows="8"
          resize="none"
          readonly
          spellcheck="false"
          placeholder="处理结果将显示在这里"
        />
      </ToolSection>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Bottom } from '@element-plus/icons-vue'
import { computed, ref } from 'vue'
import ToolSection from '../ToolSection.vue'

/** 处理模式：编码或解码 */
type CodecMode = 'encode' | 'decode'

/** 当前处理模式 */
const mode = ref<CodecMode>('encode')
/** 是否使用 URL 安全字符集（仅在编码时生效） */
const urlSafe = ref(false)
/** 输入文本 */
const input = ref('')


/**
 * 把二进制字符串转为标准 Base64。
 *
 * @param binary 每字符代表一个字节的字符串
 * @returns Base64 字符串
 */
function encodeBinary(binary: string): string {
  let result = btoa(binary)
  if (urlSafe.value) {
    result = result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  return result
}

/**
 * 标准 Base64 转字符串（按 UTF-8 解码）。
 *
 * @param base64 Base64 文本
 * @returns 解码后的字符串
 */
function decodeToString(base64: string): string {
  let normalized = base64.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4
  if (padding > 0) {
    normalized += '='.repeat(4 - padding)
  }
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

/** 计算结果：包含输出文本与可能的错误信息 */
const result = computed<{ text: string; message: string }>(() => {
  if (!input.value) {
    return { text: '', message: '' }
  }
  try {
    if (mode.value === 'encode') {
      const bytes = new TextEncoder().encode(input.value)
      let binary = ''
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte)
      })
      return { text: encodeBinary(binary), message: '' }
    }
    return { text: decodeToString(input.value.trim()), message: '' }
  } catch {
    const message = mode.value === 'encode' ? '编码失败：文本包含不支持的字符' : '解码失败：不是合法的 Base64 文本'
    return { text: '', message }
  }
})

/** 输出文本 */
const output = computed(() => result.value.text)

/** 错误信息，为空表示无错误 */
const error = computed(() => result.value.message)

/** 填入示例文本 */
function handleSample(): void {
  input.value = mode.value === 'encode' ? 'MyHub 工具集' : 'TXlIdWIg5bel5YW36ZuG'
}

/** 清空输入 */
function handleClear(): void {
  input.value = ''
}

/** 把输出结果回填到输入框，便于二次处理 */
function swapResult(): void {
  if (!output.value) {
    return
  }
  input.value = output.value
}
</script>

<style scoped>
.base64-codec {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.codec-alert {
  padding: 6px 8px;
}

.codec-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-spacer {
  flex: 1;
}

.codec-panes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pane-switch {
  display: flex;
  justify-content: center;
}
</style>
