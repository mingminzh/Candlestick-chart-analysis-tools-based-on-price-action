const fs = require('fs')
const path = require('path')

const defaultDir = path.join(
  process.env.HOME || '',
  'Library/Application Support/kline-replay-demo/Local Storage/leveldb'
)
const leveldbDir = process.argv[2] || defaultDir
const outFile = process.argv[3] || path.join(process.cwd(), 'recovered-pa-session-candidates.json')
const key = 'pa-training-replay-session:v1'
const jsonStartPattern = Buffer.from('{"savedAt"', 'utf16le')

function balancedJsonEnd(text) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return -1
}

function findPattern(buffer, pattern, from = 0) {
  return buffer.indexOf(pattern, from)
}

function sessionScore(session) {
  return (
    (Array.isArray(session.trades) ? session.trades.length : 0) * 1000 +
    (session.coachFeedbacks ? Object.keys(session.coachFeedbacks).length : 0) * 100 +
    (session.tradeFollowUps ? Object.keys(session.tradeFollowUps).length : 0) * 10 +
    (session.tradeNotes ? Object.keys(session.tradeNotes).length : 0)
  )
}

function parseJsonValue(text) {
  const first = text.search(/\S/)
  if (first < 0) return null
  const startChar = text[first]
  if (startChar === '{' || startChar === '[') {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = first; i < text.length; i += 1) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === startChar) depth += 1
      else if ((startChar === '{' && ch === '}') || (startChar === '[' && ch === ']')) {
        depth -= 1
        if (depth === 0) return JSON.parse(text.slice(first, i + 1))
      }
    }
    return null
  }
  if (startChar === '"') {
    let escaped = false
    for (let i = first + 1; i < text.length; i += 1) {
      const ch = text[i]
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') return JSON.parse(text.slice(first, i + 1))
    }
  }
  const primitive = text.slice(first).match(/^-?\d+(?:\.\d+)?|^true|^false|^null/)
  return primitive ? JSON.parse(primitive[0]) : null
}

function extractField(buffer, fieldName) {
  const pattern = Buffer.from(`"${fieldName}":`, 'utf16le')
  const start = buffer.indexOf(pattern)
  if (start < 0) return undefined
  const valueStart = start + pattern.length
  try {
    return parseJsonValue(buffer.slice(valueStart).toString('utf16le'))
  } catch (err) {
    return undefined
  }
}

function recoverSessionByFields(file, buffer) {
  const trades = extractField(buffer, 'trades')
  const coachFeedbacks = extractField(buffer, 'coachFeedbacks')
  if (!Array.isArray(trades) && (!coachFeedbacks || typeof coachFeedbacks !== 'object')) return null
  return {
    savedAt: extractField(buffer, 'savedAt') || '',
    dataset: {
      symbol: extractField(buffer, 'symbol') || 'BTCUSDT',
      timeframe: extractField(buffer, 'timeframe') || '',
      source: extractField(buffer, 'source') || '',
      name: extractField(buffer, 'name') || '',
      bars: []
    },
    replayIndex: extractField(buffer, 'replayIndex') || 0,
    barCountSettings: extractField(buffer, 'barCountSettings') || { enabled: true, displayInterval: 2 },
    account: extractField(buffer, 'account') || {},
    orders: extractField(buffer, 'orders') || [],
    positions: extractField(buffer, 'positions') || [],
    trades: Array.isArray(trades) ? trades : [],
    tradeNotes: extractField(buffer, 'tradeNotes') || {},
    barReviews: extractField(buffer, 'barReviews') || {},
    coachFeedbacks: coachFeedbacks && typeof coachFeedbacks === 'object' ? coachFeedbacks : {},
    mistakes: extractField(buffer, 'mistakes') || {},
    questionedTradeIds: extractField(buffer, 'questionedTradeIds') || {},
    tradeFollowUps: extractField(buffer, 'tradeFollowUps') || {},
    selectedTradeId: extractField(buffer, 'selectedTradeId') || '',
    currentTradeId: extractField(buffer, 'currentTradeId') || '',
    recoveredFrom: file,
    recoveredPartial: true
  }
}

const files = fs.readdirSync(leveldbDir)
  .filter(name => /\.(log|ldb)$/.test(name))
  .map(name => path.join(leveldbDir, name))

const candidates = []
const seen = new Set()

for (const file of files) {
  const buffer = fs.readFileSync(file)
  if (
    !buffer.includes(Buffer.from(key, 'utf8')) &&
    !buffer.includes(Buffer.from(key, 'utf16le')) &&
    !buffer.includes(jsonStartPattern)
  ) {
    continue
  }

  const recoveredByFields = recoverSessionByFields(file, buffer)
  if (recoveredByFields) {
    const signature = JSON.stringify({
      savedAt: recoveredByFields.savedAt,
      trades: recoveredByFields.trades,
      feedbackKeys: Object.keys(recoveredByFields.coachFeedbacks || {}),
      partial: true
    })
    if (!seen.has(signature)) {
      seen.add(signature)
      candidates.push({
        file,
        savedAt: recoveredByFields.savedAt || '',
        symbol: recoveredByFields.dataset?.symbol || '',
        timeframe: recoveredByFields.dataset?.timeframe || '',
        barsCount: Array.isArray(recoveredByFields.dataset?.bars) ? recoveredByFields.dataset.bars.length : 0,
        replayIndex: recoveredByFields.replayIndex,
        tradesCount: Array.isArray(recoveredByFields.trades) ? recoveredByFields.trades.length : 0,
        feedbackCount: recoveredByFields.coachFeedbacks ? Object.keys(recoveredByFields.coachFeedbacks).length : 0,
        followUpCount: recoveredByFields.tradeFollowUps ? Object.keys(recoveredByFields.tradeFollowUps).length : 0,
        score: sessionScore(recoveredByFields),
        partial: true,
        session: recoveredByFields
      })
    }
  }

  let start = 0
  while ((start = findPattern(buffer, jsonStartPattern, start)) >= 0) {
    const decoded = buffer.slice(start).toString('utf16le')
    const end = balancedJsonEnd(decoded)
    if (end > 0) {
      const raw = decoded.slice(0, end)
      try {
        const session = JSON.parse(raw)
        const signature = JSON.stringify({
          savedAt: session.savedAt,
          trades: session.trades,
          feedbackKeys: Object.keys(session.coachFeedbacks || {})
        })
        if (!seen.has(signature)) {
          seen.add(signature)
          candidates.push({
            file,
            savedAt: session.savedAt || '',
            symbol: session.dataset?.symbol || '',
            timeframe: session.dataset?.timeframe || '',
            barsCount: Array.isArray(session.dataset?.bars) ? session.dataset.bars.length : 0,
            replayIndex: session.replayIndex,
            tradesCount: Array.isArray(session.trades) ? session.trades.length : 0,
            feedbackCount: session.coachFeedbacks ? Object.keys(session.coachFeedbacks).length : 0,
            followUpCount: session.tradeFollowUps ? Object.keys(session.tradeFollowUps).length : 0,
            score: sessionScore(session),
            session
          })
        }
      } catch (err) {
        // LevelDB files can contain partial historical records; skip fragments.
      }
    }
    start += jsonStartPattern.length
  }
}

candidates.sort((a, b) => {
  if (b.score !== a.score) return b.score - a.score
  return String(b.savedAt).localeCompare(String(a.savedAt))
})

fs.writeFileSync(outFile, JSON.stringify(candidates, null, 2))

console.log(`found ${candidates.length} candidate session(s)`)
for (const [index, item] of candidates.entries()) {
  console.log(
    `#${index + 1} savedAt=${item.savedAt || '-'} timeframe=${item.timeframe || '-'} bars=${item.barsCount} trades=${item.tradesCount} feedback=${item.feedbackCount} followUps=${item.followUpCount} score=${item.score}`
  )
}
console.log(`written: ${outFile}`)
