/**
 * Git 提交规范配置（Electron 主进程模块）
 * - 内置提交规范（完整版 / 精简版）与 AI 生成提交信息的提示词模板
 * - 配置以 JSON 文件持久化（路径由调用方传入，通常为 app.getPath('userData') 下）
 * - 文件缺失或损坏时自动回落内置默认值，保证功能始终可用
 */
const fs = require('fs')

/** 配置结构版本号（后续结构调整时用于兼容处理） */
const CONFIG_VERSION = 1

/** 内置提交规范：完整版（覆盖分支命名、提交格式、评审、Tag 与自动化要求） */
const DEFAULT_SPEC_FULL = [
  '# Git 提交规范',
  '',
  '## 一、分支命名规范',
  '',
  '分支名格式：`<类型>/<内容>`',
  '',
  '| 前缀 | 用途 | 示例 |',
  '| --- | --- | --- |',
  '| feature/ | 新功能开发 | feature/user-login |',
  '| bugfix/ | Bug 修复 | bugfix/login-timeout |',
  '| hotfix/ | 紧急线上修复 | hotfix/payment-crash |',
  '| release/ | 版本发布准备 | release/v2.1.0 |',
  '| chore/ | 构建 / 工具变动 | chore/update-dependencies |',
  '',
  '进阶要求：',
  '1. 尽量关联工单号，如 feature/PROJ-123-user-login；',
  '2. 描述必须语义化，禁止 feature/aaa、feature/test、feature/111 这类无意义名称；',
  '3. release 与 hotfix 分支必须带版本号，如 release/v2.1.0、hotfix/v2.0.1-payment-fix。',
  '',
  '## 二、Commit Message 规范',
  '',
  '必须使用 Conventional Commits（约定式提交）格式：`<type>(<scope>): <subject>`',
  '',
  'type（必填）：',
  '',
  '| type | 含义 | 示例 |',
  '| --- | --- | --- |',
  '| feat | 新增功能 | feat(user): 添加用户登录功能 |',
  '| fix | 修复 bug | fix(api): 修复接口超时问题 |',
  '| docs | 文档更新 | docs(readme): 更新部署说明 |',
  '| style | 代码格式（不影响功能） | style: 统一缩进为4空格 |',
  '| refactor | 代码重构 | refactor(order): 优化订单查询逻辑 |',
  '| perf | 性能优化 | perf(cache): 优化缓存命中率 |',
  '| test | 测试相关 | test(auth): 增加登录单元测试 |',
  '| chore | 构建 / 工具变动 | chore: 升级Spring Boot版本 |',
  '| revert | 回滚提交 | revert: 回滚 feat(user): 添加用户登录功能 |',
  '',
  'scope（可选）：描述改动影响范围，如 user、api、order、payment。',
  '',
  'subject（必填）：',
  '- 使用一般现在时，不用过去时（add 而非 added）；',
  '- 使用祈使句（add feature 而非 I added feature）；',
  '- 首字母不大写，句尾不加句号；',
  '- 不超过 50 个字符。',
  '',
  '长篇 Commit Message（改动较大时使用）：第一行标题后空一行写 body，',
  '按"问题原因 / 解决方案 / 影响范围 / 测试情况"组织，每行不超过 72 字符。',
  '',
  '## 三、提交核心原则',
  '',
  '1. 每个提交只解决一个或一类问题，不把多个不相关改动塞进一个 commit；',
  '2. 单次提交代码量不宜过大，建议不超过 300 行；',
  '3. 提交前确保已自测，不提交"应该能跑"的代码；',
  '4. 提交信息清晰可追溯，禁止只写 fix、update、修改这类无意义描述。',
  '',
  '## 四、Code Review 要求',
  '',
  '1. 禁止直接 push 到 main/master；',
  '2. 合并前必须通过 Code Review 与 CI 检查；',
  '3. 核心项目至少 2 名审批人同意；',
  '4. 审查清单：风格指南、测试覆盖率（≥80%）、是否引入多余依赖、文档是否更新、是否破坏现有功能、是否提交敏感信息。',
  '',
  '## 五、Tag 管理规范',
  '',
  '版本号遵循语义化版本：主版本号.次版本号.修订号（不兼容变更 / 向下兼容新增 / 向下兼容修复）。',
  '发布时创建带注释的 Tag 并推送：`git tag -a v2.1.0 -m "Release version 2.1.0"`、`git push origin v2.1.0`。',
  '',
  '## 六、一句话总结',
  '',
  '分支名要清晰，commit message 要规范，提交粒度要小，合并前要 review，发布要打 tag。',
].join('\n')

/** 内置提交规范：精简版（只保留生成提交信息必需的硬性约束，节省 token） */
const DEFAULT_SPEC_BRIEF = [
  '# Git 提交规范（精简版）',
  '',
  '## 提交格式',
  '`<type>(<scope>): <subject>`，type 必填、scope 可选、subject 必填。',
  '',
  '## type 取值',
  'feat 新增功能、fix 修复bug、docs 文档、style 格式、refactor 重构、perf 性能、test 测试、chore 构建工具、revert 回滚。',
  '',
  '## subject 要求',
  '- 一般现在时、祈使句（add 而非 added / I added）；',
  '- 首字母不大写，句尾无句号；',
  '- 不超过 50 个字符；',
  '- 禁止 fix、update、修改这类无意义描述。',
  '',
  '## scope 要求',
  '描述影响范围（user、api、order、payment 等模块名），推断不出则省略。',
  '',
  '## 长提交信息',
  '改动较大时，标题后空一行写 body：问题原因 / 解决方案 / 影响范围 / 测试情况，每行不超过 72 字符。',
  '',
  '## 提交粒度',
  '一个提交只解决一类问题，建议不超过 300 行；禁止直接提交到 main/master。',
].join('\n')

/** 内置 AI 生成提交信息的提示词模板（占位符在渲染时替换为真实上下文） */
const DEFAULT_PROMPT_TEMPLATE = [
  '# 角色',
  '你是严格遵守 Git 提交规范的资深工程师，负责把代码差异归纳为规范的提交说明。',
  '',
  '# 提交规范（必须遵守）',
  '${spec}',
  '',
  '# 上下文',
  '- 当前分支：${branch}',
  '- 变更文件：',
  '${files}',
  '- 最近提交（仅用于保持措辞风格，不要照抄）：',
  '${recentCommits}',
  '',
  '# 代码差异',
  '```diff',
  '${diff}',
  '```',
  '',
  '# 输出要求',
  '1. 第一行必须是 <type>(<scope>): <subject>，type 只能取规范中列出的值；scope 推断不出则省略括号；',
  '2. subject 使用一般现在时与祈使句，首字母不大写、结尾无句号，长度不超过 50 个字符，语言跟随差异中的注释语言；',
  '3. 多文件或核心逻辑改动时，标题后空一行补充多行 body（问题原因 / 解决方案 / 影响范围 / 测试情况），每行不超过 72 字符；',
  '4. 只输出提交信息本身，不要代码围栏、不要引号包裹、不要任何解释或前后缀；',
  '5. 差异被省略时只按已有信息归纳，禁止编造不存在的改动。',
].join('\n')

/** 规范预设：full 完整版 / brief 精简版 */
const SPEC_PRESETS = ['full', 'brief']

/**
 * 获取指定预设的内置规范文本
 * @param {string} preset 预设名：full / brief，未知值回落完整版
 * @returns {string} 规范文本
 */
function getDefaultSpec(preset) {
  return preset === 'brief' ? DEFAULT_SPEC_BRIEF : DEFAULT_SPEC_FULL
}

/**
 * 构造一份内置默认配置
 * @param {string} [preset] 规范预设：full / brief
 * @returns {{ version: number, preset: string, spec: string, promptTemplate: string, validateBeforeCommit: boolean, includeRecentCommits: boolean }} 默认配置
 */
function buildDefaultConfig(preset = 'full') {
  const key = SPEC_PRESETS.includes(preset) ? preset : 'full'
  return {
    version: CONFIG_VERSION,
    preset: key,
    spec: getDefaultSpec(key),
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    validateBeforeCommit: false,
    includeRecentCommits: true,
  }
}

/**
 * 读取提交规范配置：文件缺失、损坏或字段缺失时自动补齐为内置默认值
 * @param {string} configPath 配置文件路径
 * @returns {{ version: number, preset: string, spec: string, promptTemplate: string, validateBeforeCommit: boolean, includeRecentCommits: boolean }} 配置
 */
function getCommitSpec(configPath) {
  const defaults = buildDefaultConfig()
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(configPath, 'utf-8')) || {}
  } catch {
    /* 首次运行或文件损坏时使用内置默认配置 */
  }
  const pickText = (value, fallback) => (typeof value === 'string' && value.trim() ? value : fallback)
  return {
    version: CONFIG_VERSION,
    preset: SPEC_PRESETS.includes(stored.preset) ? stored.preset : defaults.preset,
    spec: pickText(stored.spec, defaults.spec),
    promptTemplate: pickText(stored.promptTemplate, defaults.promptTemplate),
    validateBeforeCommit: stored.validateBeforeCommit === true,
    includeRecentCommits: stored.includeRecentCommits !== false,
  }
}

/**
 * 保存提交规范配置
 * @param {string} configPath 配置文件路径
 * @param {object} config 待保存配置
 * @returns {Promise<void>}
 */
async function saveCommitSpec(configPath, config) {
  const current = getCommitSpec(configPath)
  const preset = SPEC_PRESETS.includes(config?.preset) ? config.preset : current.preset
  const payload = {
    version: CONFIG_VERSION,
    preset,
    spec: pickText(config?.spec, current.spec),
    promptTemplate: pickText(config?.promptTemplate, current.promptTemplate),
    validateBeforeCommit: config?.validateBeforeCommit === true,
    includeRecentCommits: config?.includeRecentCommits !== false,
  }
  await fs.promises.writeFile(configPath, JSON.stringify(payload, null, 2), 'utf-8')
  return payload
}

/**
 * 恢复内置默认配置（可指定规范预设）
 * @param {string} configPath 配置文件路径
 * @param {string} [preset] 规范预设：full / brief
 * @returns {object} 恢复后的配置
 */
function resetCommitSpec(configPath, preset = 'full') {
  return buildDefaultConfig(preset)
}

/**
 * 取非空文本，为空时回落默认值
 * @param {unknown} value 待校验值
 * @param {string} fallback 默认值
 * @returns {string} 文本
 */
function pickText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback
}

module.exports = {
  CONFIG_VERSION,
  SPEC_PRESETS,
  DEFAULT_SPEC_FULL,
  DEFAULT_SPEC_BRIEF,
  DEFAULT_PROMPT_TEMPLATE,
  getDefaultSpec,
  buildDefaultConfig,
  getCommitSpec,
  saveCommitSpec,
  resetCommitSpec,
}
