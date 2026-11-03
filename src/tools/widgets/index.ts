import { Clock, Connection, Cpu, Document, Key } from '@element-plus/icons-vue'
import { registerTools } from '../registry'
import type { ToolDefinition } from '../types'

/**
 * 内置工具清单。
 * 新增一个工具只需两步：在 widgets 下创建 .vue 组件，然后在此数组追加一条定义。
 */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    id: 'json-formatter',
    name: 'JSON 格式化',
    description: '左右分栏工作台：源码编辑 + 虚拟滚动树视图，支持大 JSON 懒加载与搜索',
    category: 'text',
    icon: Document,
    keywords: ['json', '格式化', '压缩', '转义', '树视图', '大文件', 'format', 'minify', 'escape'],
    component: () => import('./JsonFormatter.vue'),
    order: 10,
  },
  {
    id: 'base64-codec',
    name: 'Base64 编解码',
    description: '文本与 Base64 互转，支持 URL 安全字符集',
    category: 'encode',
    icon: Connection,
    keywords: ['base64', '编码', '解码', 'encode', 'decode', 'urlsafe'],
    component: () => import('./Base64Codec.vue'),
    order: 20,
  },
  {
    id: 'hash-calculator',
    name: '哈希计算',
    description: 'MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512，支持 HMAC 密钥',
    category: 'crypto',
    icon: Key,
    keywords: ['md5', 'sha', 'hash', 'hmac', '摘要', '哈希', '签名'],
    component: () => import('./HashCalculator.vue'),
    order: 30,
  },
  {
    id: 'timestamp-converter',
    name: '时间戳转换',
    description: '时间戳与日期双向转换，自动识别秒 / 毫秒并输出 ISO、UTC',
    category: 'time',
    icon: Clock,
    keywords: ['timestamp', '时间戳', '日期', 'unix', 'iso', 'utc'],
    component: () => import('./TimestampConverter.vue'),
    order: 40,
  },
  {
    id: 'process-manager',
    name: '进程管理',
    description: '按端口号 / 服务名 / PID 查进程并一键结束，专治「端口被占用」',
    category: 'dev',
    icon: Cpu,
    keywords: ['进程', '端口', '占用', 'taskkill', 'netstat', 'pid', 'kill', 'process', 'port', 'java'],
    component: () => import('./ProcessManager.vue'),
    order: 50,
    badge: 'new',
  },
]

// 注册内置工具，导入本模块即生效
registerTools(BUILTIN_TOOLS)
