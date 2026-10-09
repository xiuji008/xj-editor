/**
 * MD5 摘要算法的纯前端实现。
 * 浏览器内置的 Web Crypto API 不提供 MD5，而工具场景中 MD5 仍有兼容性需求，故自行实现。
 */

/** 每轮迭代使用的循环左移位数，共 64 轮 */
const SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

/** 常量表 T[i] = floor(abs(sin(i + 1)) * 2^32) */
const TABLE = (() => {
  const table = new Array<number>(64)
  for (let i = 0; i < 64; i++) {
    table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0
  }
  return table
})()

/**
 * 32 位无符号循环左移。
 *
 * @param value 待移位的值
 * @param bits 左移位数（0-31）
 * @returns 移位后的 32 位无符号整数
 */
function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

/**
 * 32 位无符号加法，溢出部分自动回绕。
 *
 * @param args 参与相加的数
 * @returns 相加结果的 32 位无符号表示
 */
function add32(...args: number[]): number {
  return args.reduce((acc, cur) => (acc + cur) >>> 0, 0)
}

/**
 * 计算字符串的 MD5 摘要（32 位小写十六进制）。
 *
 * @param input 待计算的文本，按 UTF-8 编码参与计算
 * @returns MD5 十六进制字符串
 */
export function md5(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLength = bytes.length * 8
  // 补位后总长度：原始数据 + 0x80 + 8 字节长度，向 64 字节对齐
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const buffer = new Uint8Array(paddedLength)
  buffer.set(bytes)
  buffer[bytes.length] = 0x80

  const view = new DataView(buffer.buffer)
  view.setUint32(paddedLength - 8, bitLength >>> 0, true)
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 4294967296), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Uint32Array(16)
    for (let i = 0; i < 16; i++) {
      words[i] = view.getUint32(offset + i * 4, true)
    }

    let [a, b, c, d] = [a0, b0, c0, d0]

    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const next = add32(a, f, TABLE[i], words[g])
      const rotated = rotateLeft(next, SHIFT[i])
      a = d
      d = c
      c = b
      b = add32(b, rotated)
    }

    a0 = add32(a0, a)
    b0 = add32(b0, b)
    c0 = add32(c0, c)
    d0 = add32(d0, d)
  }

  return [a0, b0, c0, d0]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('')
}
