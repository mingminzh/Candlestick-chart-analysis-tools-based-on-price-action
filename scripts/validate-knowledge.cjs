const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const ruleDir = path.join(root, 'knowledge_private', 'rule-cards')
const summaryDir = path.join(root, 'knowledge_private', 'summaries')
const requiredFields = ['id', 'name', 'category', 'reviewQuestions']

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function asArray(value) {
  return Array.isArray(value) ? value : [value]
}

function fail(message) {
  console.error(`知识库校验失败: ${message}`)
  process.exit(1)
}

function warn(message) {
  console.warn(`警告: ${message}`)
}

if (!fs.existsSync(ruleDir)) {
  fail(`找不到规则卡目录 ${path.relative(root, ruleDir)}`)
}

const files = fs.readdirSync(ruleDir).filter(file => file.endsWith('.json')).sort()
if (!files.length) {
  fail('规则卡目录为空')
}

const ids = new Set()
const categories = new Map()
let total = 0

for (const file of files) {
  const fullPath = path.join(ruleDir, file)
  let cards
  try {
    cards = asArray(readJson(fullPath))
  } catch (err) {
    fail(`${file} 不是合法 JSON: ${err.message}`)
  }

  if (!cards.length) fail(`${file} 没有规则卡内容`)

  for (const [index, card] of cards.entries()) {
    const label = `${file}[${index}]`
    for (const field of requiredFields) {
      if (!card[field]) fail(`${label} 缺少必填字段 ${field}`)
    }
    if (!Array.isArray(card.reviewQuestions) || !card.reviewQuestions.length) {
      fail(`${label} 的 reviewQuestions 必须是非空数组`)
    }
    if (ids.has(card.id)) fail(`规则 ID 重复: ${card.id}`)
    ids.add(card.id)
    categories.set(card.category, (categories.get(card.category) || 0) + 1)
  }

  total += cards.length
  console.log(`${file}: ${cards.length}`)
}

if (fs.existsSync(summaryDir)) {
  const summaries = fs.readdirSync(summaryDir).filter(file => file.endsWith('.md')).length
  if (!summaries) warn('summaries 目录存在但没有 Markdown 摘要')
  console.log(`summaries: ${summaries}`)
} else {
  warn('找不到 summaries 目录')
}

const ignoreTargets = [path.join('knowledge_private', 'rule-cards', files[0])]
if (fs.existsSync(summaryDir)) {
  const summaryFiles = fs.readdirSync(summaryDir).filter(file => file.endsWith('.md')).sort()
  if (summaryFiles[0]) ignoreTargets.push(path.join('knowledge_private', 'summaries', summaryFiles[0]))
}

for (const target of ignoreTargets) {
  const ignoreCheck = spawnSync('git', ['check-ignore', '--no-index', '-q', target], {
    cwd: root,
    stdio: 'ignore'
  })
  if (ignoreCheck.status !== 0) {
    fail(`私有知识文件没有被 gitignore 忽略: ${target}`)
  }
}

console.log(`total: ${total}`)
console.log('categories:')
for (const [category, count] of [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'))) {
  console.log(`- ${category}: ${count}`)
}
console.log('知识库校验通过')
