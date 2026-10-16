import fs from 'node:fs'
import { Document, Packer } from 'docx'
import { htmlToContent } from 'docx/html'
import katex from 'katex'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#ecf5ff"/><text x="10" y="45" font-family="sans-serif" font-size="20">mermaid</text></svg>',
  'utf-8',
)

const mathml = katex.renderToString('E = mc^2', { displayMode: true, output: 'mathml' })

const html = `
<h1>一级标题</h1>
<h2>二级标题</h2>
<p>这是<strong>加粗</strong>、<em>斜体</em>、<del>删除线</del>、<code>行内代码</code>与<a href="https://example.com">链接</a>。</p>
<ul><li>无序项 1</li><li>无序项 2<ul><li>嵌套项</li></ul></li></ul>
<ol><li>有序项 1</li><li>有序项 2</li></ol>
<ul><li><input type="checkbox" checked> 已完成任务</li><li><input type="checkbox"> 未完成任务</li></ul>
<blockquote style="border-left:4px solid #409eff;background:#ecf5ff;padding:8px 12px;margin:12px 0"><p style="color:#409eff;font-weight:bold;margin:0 0 4px 0">NOTE</p><p>提示块正文</p></blockquote>
<pre style="background:#0d1117;color:#c9d1d9;padding:10px 12px;font-family:Consolas,monospace"><code><span style="color:#ff7b72">const</span> <span style="color:#79c0ff">answer</span> = <span style="color:#79c0ff">42</span></code></pre>
<table><tr><th>字段</th><th>值</th></tr><tr><td>标题</td><td>测试文档</td></tr></table>
<p style="text-align:center"><img src="docx-asset://1" alt="位图"></p>
<p style="text-align:center;color:#909399;font-size:12px"><em>图 1 位图图注</em></p>
<p style="text-align:center"><img src="docx-asset://2" alt="矢量图"></p>
<p style="text-align:center">$$E=mc^2$$</p>
${mathml}
<hr>
<p>正文结尾。</p>
`

const assets = new Map([
  ['docx-asset://1', { data: new Uint8Array(PNG_1X1) }],
  ['docx-asset://2', { data: new Uint8Array(SVG), fallback: new Uint8Array(PNG_1X1) }],
])
const warnings = []

const content = htmlToContent(html, {
  stylesheet: '.markdown-body{font-family:"微软雅黑"} th,td{border:1px solid #d0d7de}',
  maxImageWidth: 601,
  images: (src) => assets.get(src),
  onWarning: (w) => warnings.push(`${w.code} | ${w.message}`),
})

const doc = new Document({
  styles: { default: { document: { run: { font: '微软雅黑', size: 21 } } } },
  sections: [{ children: [...content] }],
})
const buf = await Packer.toBuffer(doc)
fs.writeFileSync('tmp-smoke.docx', buf)

console.log('块数量:', content.length)
console.log('块类型:', content.map((c) => c.constructor.name).join(', '))
console.log('docx 字节:', buf.length)
console.log('warnings:', warnings.length ? warnings : '（无）')
