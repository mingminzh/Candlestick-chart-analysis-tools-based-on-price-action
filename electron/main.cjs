const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

function projectRoot() {
  return path.join(__dirname, '..')
}

function ruleCardDirCandidates() {
  const candidates = [
    process.env.PA_RULE_CARDS_DIR,
    path.join(projectRoot(), 'knowledge_private', 'rule-cards'),
    path.join(process.cwd(), 'knowledge_private', 'rule-cards'),
    path.join(app.getPath('documents'), 'AI_Project', 'project_02', 'kline-replay', 'knowledge_private', 'rule-cards')
  ]

  if (app.isPackaged) {
    candidates.push(
      path.resolve(path.dirname(app.getPath('exe')), '..', '..', '..', '..', '..', 'knowledge_private', 'rule-cards')
    )
  }

  return [...new Set(candidates.filter(Boolean))]
}

function normalizeRuleCard(card, sourceFile) {
  if (!card || typeof card !== 'object') return null
  const name = String(card.name || card.id || '').trim()
  if (!name) return null
  return {
    id: String(card.id || name),
    name,
    category: String(card.category || '私有规则卡'),
    scenarios: Array.isArray(card.scenarios) ? card.scenarios.map(String) : [],
    appliesTo: Array.isArray(card.appliesTo) ? card.appliesTo.map(String) : [],
    evidence: Array.isArray(card.evidence) ? card.evidence.map(String) : [],
    commonMistakes: Array.isArray(card.commonMistakes) ? card.commonMistakes.map(String) : [],
    reviewQuestions: Array.isArray(card.reviewQuestions) ? card.reviewQuestions.map(String) : [],
    mistakeTag: String(card.mistakeTag || name),
    source: 'knowledge_private',
    sourceFile
  }
}

function readPrivateRuleCards() {
  const candidates = ruleCardDirCandidates()
  const dir = candidates.find(candidate => fs.existsSync(candidate)) || candidates[0]
  if (!dir || !fs.existsSync(dir)) return { dir, searched: candidates, cards: [], errors: [] }
  const cards = []
  const errors = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.toLowerCase().endsWith('.json')) continue
    const fullPath = path.join(dir, file)
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
      const records = Array.isArray(parsed) ? parsed : [parsed]
      for (const record of records) {
        const card = normalizeRuleCard(record, file)
        if (card) cards.push(card)
      }
    } catch (err) {
      errors.push(`${file}: ${err.message}`)
    }
  }
  return { dir, searched: candidates, cards, errors }
}

ipcMain.handle('knowledge:readRuleCards', () => readPrivateRuleCards())

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: '价格行为复盘训练',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
