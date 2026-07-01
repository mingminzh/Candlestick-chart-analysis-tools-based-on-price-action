const BINANCE_ENDPOINTS = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api.binance.us'
]

export const BTC_TIMEFRAMES = [
  { label: '1分钟', value: '1m', interval: '1m' },
  { label: '5分钟', value: '5m', interval: '5m' },
  { label: '15分钟', value: '15m', interval: '15m' },
  { label: '30分钟', value: '30m', interval: '30m' },
  { label: '1小时', value: '1H', interval: '1h' },
  { label: '4小时', value: '4H', interval: '4h' },
  { label: '1天', value: '1D', interval: '1d' }
]

export function toBinanceInterval(timeframe) {
  return BTC_TIMEFRAMES.find(item => item.value === timeframe)?.interval || '5m'
}

function normalizeKline(row) {
  return {
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5])
  }
}

function uniqueSortedBars(rows) {
  const byTime = new Map()
  for (const row of rows) {
    const bar = normalizeKline(row)
    if (
      Number.isFinite(bar.time) &&
      Number.isFinite(bar.open) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close)
    ) {
      byTime.set(bar.time, bar)
    }
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time)
}

async function requestKlines(endpoint, { symbol, interval, limit, endTime }) {
  const url = new URL('/api/v3/klines', endpoint)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('interval', interval)
  url.searchParams.set('limit', String(limit))
  if (endTime) url.searchParams.set('endTime', String(endTime))

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${endpoint} 返回 ${res.status}: ${text.slice(0, 120)}`)
  }
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error(`${endpoint} 返回格式异常`)
  return data
}

export async function fetchLatestBtcBars({ timeframe = '5m', targetCount = 3000 } = {}) {
  const interval = toBinanceInterval(timeframe)
  const symbol = 'BTCUSDT'
  const pageSize = 1000
  let lastError = null

  for (const endpoint of BINANCE_ENDPOINTS) {
    try {
      const rows = []
      let endTime = undefined
      while (rows.length < targetCount) {
        const page = await requestKlines(endpoint, {
          symbol,
          interval,
          limit: Math.min(pageSize, targetCount - rows.length),
          endTime
        })
        if (!page.length) break
        rows.push(...page)
        const oldestOpenTime = Number(page[0][0])
        endTime = oldestOpenTime - 1
        if (page.length < pageSize) break
      }

      const bars = uniqueSortedBars(rows).slice(-targetCount)
      if (!bars.length) throw new Error(`${endpoint} 没有返回K线`)
      return {
        bars,
        symbol,
        timeframe,
        source: 'binance',
        name: `BTCUSDT 最新 ${timeframe} (${bars.length} bars)`
      }
    } catch (err) {
      lastError = err
    }
  }

  throw lastError || new Error('BTCUSDT 最新K线加载失败')
}
