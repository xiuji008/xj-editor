/* 端到端冒烟：在真实 Electron 渲染进程里跑一遍 Markdown → docx 导出 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')

const DEV_URL = pathToFileURL(path.resolve(__dirname, 'dist/index.html')).href

const MD = [
  '---',
  'title: 冒烟测试文档',
  'author: XJ',
  'tags: [测试, 导出]',
  '---',
  '',
  '# 一级标题',
  '',
  '这是**加粗**、*斜体*、`行内代码`与[链接](https://example.com)。',
  '',
  '## 二级标题',
  '',
  '- 无序项 1',
  '  - 嵌套项',
  '- [x] 已完成任务',
  '- [ ] 未完成任务',
  '',
  '1. 有序项 1',
  '2. 有序项 2',
  '',
  '> [!NOTE]',
  '> 这是一条提示。',
  '',
  '| 字段 | 值 |',
  '| --- | --- |',
  '| 标题 | 冒烟 |',
  '| 状态 | 通过 |',
  '',
  '```js',
  'const answer = 42',
  'function hello() { return "world" }',
  '```',
  '',
  '```mermaid',
  'graph LR',
  '  A[开始] --> B[结束]',
  '```',
  '',
  '```chart',
  '{"type":"bar","title":"示例","data":[{"name":"甲","value":8},{"name":"乙","value":5}]}',
  '```',
  '',
  '行内公式 $a^2+b^2=c^2$ 与块级公式：',
  '',
  '$$',
  '\\int_0^1 x^2 dx = \\frac{1}{3}',
  '$$',
  '',
  '![示例图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)',
  '',
  '![带图注的图](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)',
  '',
].join('\n')

async function main() {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer:error]', message)
  })
  await win.loadURL(DEV_URL)
  // 等待前端挂载并完成动态 import
  await new Promise((r) => setTimeout(r, 6000))

  const result = await win.webContents.executeJavaScript(
    `(async () => {
      const fn = window.__docxTest
      if (!fn) return { ok: false, error: '__docxTest 未挂载' }
      try {
        const res = await fn({ markdown: ${JSON.stringify(MD)}, baseName: 'smoke.md', baseDir: '' })
        const head = Array.from(res.data.slice(0, 4))
        return { ok: true, bytes: res.data.length, head, warnings: res.warnings }
      } catch (err) {
        return { ok: false, error: String(err && err.stack || err) }
      }
    })()`,
  )
  console.log('RESULT ' + JSON.stringify(result))
  app.quit()
}

app.whenReady().then(main).catch((err) => {
  console.log('FATAL ' + String(err && err.stack))
  app.quit()
})
