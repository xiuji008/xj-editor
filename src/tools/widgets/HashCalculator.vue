<template>
  <div class="hash-calculator">
    <div class="hash-toolbar">
      <el-select v-model="algorithm" size="small" class="algo-select">
        <el-option v-for="item in ALGORITHMS" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-checkbox v-model="uppercase" size="small">大写输出</el-checkbox>
      <el-input v-model="hmacKey" size="small" placeholder="HMAC 密钥（可选）" clearable class="key-input" />
      <div class="toolbar-spacer" />
      <el-button size="small" @click="input = ''">清空</el-button>
    </div>

    <ToolSection title="输入" :copyable="false">
      <el-input
        v-model="input"
        type="textarea"
        :rows="5"
        resize="none"
        spellcheck="false"
        placeholder="在此输入待计算摘要的文本"
      />
    </ToolSection>

    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="hash-alert" />

    <ToolSection v-if="hashValue" title="摘要结果" :copyable="true" :text="hashValue">
      <el-input :model-value="hashValue" type="textarea" :rows="3" resize="none" readonly spellcheck="false" />
      <template #actions>
        <span class="hash-meta">{{ hmacKey ? 'HMAC-' : '' }}{{ algorithm }} · {{ displayLength }} 字符</span>
      </template>
    </ToolSection>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ToolSection from '../ToolSection.vue'
import { md5 } from './md5'

/** Web Crypto 摘要算法的枚举值 */
type WebAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'

/** 可选算法及其展示名 */
const ALGORITHMS: { label: string; value: string }[] = [
  { label: 'MD5', value: 'MD5' },
  { label: 'SHA-1', value: 'SHA-1' },
  { label: 'SHA-256', value: 'SHA-256' },
  { label: 'SHA-384', value: 'SHA-384' },
  { label: 'SHA-512', value: 'SHA-512' },
]

/** 当前算法 */
const algorithm = ref<string>('SHA-256')
/** 是否大写输出 */
const uppercase = ref(false)
/** HMAC 密钥，为空时计算普通摘要 */
const hmacKey = ref('')
/** 输入文本 */
const input = ref('')
/** 摘要结果 */
const hashValue = ref('')
/** 错误信息 */
const error = ref('')

/** 结果字符长度 */
const displayLength = computed(() => hashValue.value.length)

/**
 * 把字节数组适配为 Web Crypto 可接收的 BufferSource。
 * TS 内置 lib 中 Uint8Array 的 buffer 为 ArrayBufferLike（含 SharedArrayBuffer），
 * 与 BufferSource 类型不兼容，此处做一次安全转换。
 *
 * @param bytes 字节数组
 * @returns 可被 Web Crypto 消费的 BufferSource
 */
function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource
}

/**
 * 计算 Web Crypto 支持的摘要 / HMAC。
 *
 * @param algo 摘要算法
 * @param data 原始字节
 * @param key HMAC 密钥，为空时计算普通摘要
 * @returns 摘要字节数组
 */
async function digestWithWebCrypto(algo: WebAlgorithm, data: Uint8Array, key: string): Promise<Uint8Array> {
  if (!key) {
    const buffer = await crypto.subtle.digest(algo, toBufferSource(data))
    return new Uint8Array(buffer)
  }
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(new TextEncoder().encode(key)),
    { name: 'HMAC', hash: algo },
    false,
    ['sign'],
  )
  const buffer = await crypto.subtle.sign('HMAC', cryptoKey, toBufferSource(data))
  return new Uint8Array(buffer)
}

/**
 * 按当前配置计算摘要并写入结果状态。
 */
async function compute(): Promise<void> {
  const text = input.value
  if (!text) {
    hashValue.value = ''
    error.value = ''
    return
  }
  const data = new TextEncoder().encode(text)
  try {
    let bytes: Uint8Array
    if (algorithm.value === 'MD5') {
      if (hmacKey.value) {
        throw new Error('MD5 暂不支持 HMAC，请清空密钥或改用 SHA 系列算法')
      }
      bytes = new Uint8Array(16)
      const hex = md5(text)
      for (let i = 0; i < 16; i++) {
        bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
      }
    } else {
      bytes = await digestWithWebCrypto(algorithm.value as WebAlgorithm, data, hmacKey.value)
    }
    let hex = Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    if (uppercase.value) {
      hex = hex.toUpperCase()
    }
    hashValue.value = hex
    error.value = ''
  } catch (e) {
    hashValue.value = ''
    error.value = `计算失败：${(e as Error).message}`
  }
}

watch([input, algorithm, uppercase, hmacKey], () => {
  void compute()
})
</script>

<style scoped>
.hash-calculator {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hash-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.toolbar-spacer {
  flex: 1;
}

.algo-select {
  width: 130px;
}

.key-input {
  width: 200px;
}

.hash-alert {
  padding: 6px 8px;
}

.hash-meta {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
</style>
