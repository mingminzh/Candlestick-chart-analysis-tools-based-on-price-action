const TIME_COLUMNS = ['time', 'timestamp', 'date', 'datetime', 'open_time']
const REQUIRED_COLUMNS = ['open', 'high', 'low', 'close']
const VOLUME_COLUMNS = ['volume', 'vol', 'qty']

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_')
}

function splitCsvLine(line) {
  const cells = []
  let cur = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    const next = line[i + 1]
    if (ch === '"' && inQuotes && next === '"') {
      cur += '"'
      i += 1
    } else if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

function toNumber(value, field, rowNumber) {
  const cleaned = String(value ?? '').replace(/,/g, '').trim()
  const n = Number(cleaned)
  if (!Number.isFinite(n)) {
    throw new Error(`第 ${rowNumber} 行的 ${field} 不是有效数字`)
  }
  return n
}

function toUnixSeconds(value, rowNumber) {
  const raw = String(value ?? '').trim()
  if (!raw) throw new Error(`第 ${rowNumber} 行缺少时间`)

  const numeric = Number(raw)
  if (Number.isFinite(numeric)) {
    if (numeric > 1e12) return Math.floor(numeric / 1000)
    if (numeric > 1e10) return Math.floor(numeric / 1000)
    return Math.floor(numeric)
  }

  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) {
    throw new Error(`第 ${rowNumber} 行的时间无法解析: ${raw}`)
  }
  return Math.floor(parsed / 1000)
}

function findColumn(headers, candidates) {
  return headers.findIndex(h => candidates.includes(h))
}

export function parseCsvBars(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))

  if (lines.length < 2) {
    throw new Error('CSV 至少需要表头和一行K线数据')
  }

  const headers = splitCsvLine(lines[0]).map(normalizeHeader)
  const timeIndex = findColumn(headers, TIME_COLUMNS)
  if (timeIndex === -1) {
    throw new Error(`CSV 需要时间列，支持: ${TIME_COLUMNS.join(', ')}`)
  }

  const columnIndex = {}
  for (const field of REQUIRED_COLUMNS) {
    const idx = findColumn(headers, [field])
    if (idx === -1) throw new Error(`CSV 缺少 ${field} 列`)
    columnIndex[field] = idx
  }

  const volumeIndex = findColumn(headers, VOLUME_COLUMNS)
  const bars = []

  for (let i = 1; i < lines.length; i++) {
    const rowNumber = i + 1
    const cells = splitCsvLine(lines[i])
    const time = toUnixSeconds(cells[timeIndex], rowNumber)
    const open = toNumber(cells[columnIndex.open], 'open', rowNumber)
    const high = toNumber(cells[columnIndex.high], 'high', rowNumber)
    const low = toNumber(cells[columnIndex.low], 'low', rowNumber)
    const close = toNumber(cells[columnIndex.close], 'close', rowNumber)
    const volume = volumeIndex === -1 || cells[volumeIndex] === ''
      ? 0
      : toNumber(cells[volumeIndex], 'volume', rowNumber)

    if (high < Math.max(open, close) || low > Math.min(open, close)) {
      throw new Error(`第 ${rowNumber} 行 high/low 与 open/close 不一致`)
    }

    bars.push({ time, open, high, low, close, volume })
  }

  bars.sort((a, b) => a.time - b.time)

  const deduped = []
  for (const bar of bars) {
    if (deduped.length && deduped[deduped.length - 1].time === bar.time) {
      deduped[deduped.length - 1] = bar
    } else {
      deduped.push(bar)
    }
  }

  if (deduped.length < 20) {
    throw new Error('有效K线少于20根，无法形成可靠复盘上下文')
  }

  return deduped
}
