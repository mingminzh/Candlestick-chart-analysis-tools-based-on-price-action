/**
 * Mock K-line data generator.
 * 一次性生成完整的K线数据，用于回放。
 */

const TIMEFRAME_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400
}

/**
 * 可重复的伪随机
 */
function seededRandom(seed) {
  let s = seed >>> 0
  return () => {
    // xorshift32
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0xffffffff
  }
}

/** 标准正态：Box–Muller */
function gaussian(rand) {
  let u = 0
  let v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

/**
 * 生成模拟K线数据
 *
 * 用几何布朗运动 (GBM) + 均值回归生成价格，限制单步波动 ≤ 5% 防止爆炸。
 */
export function generateMockBars({
  timeframe = '1H',
  count = 500,
  startPrice = 65000,
  endTime = Math.floor(Date.UTC(2026, 5, 20) / 1000),
  seed = 42,
  // 单步价格波动率 (标准差)，0.008 = 0.8%/bar
  sigma = 0.008
} = {}) {
  const tfSeconds = TIMEFRAME_SECONDS[timeframe] || 3600
  const rand = seededRandom(seed)
  const bars = []

  let price = startPrice
  const startTime = endTime - count * tfSeconds

  for (let i = 0; i < count; i++) {
    const time = startTime + i * tfSeconds

    // 几何布朗运动：dS/S = mu*dt + sigma*dW
    // 加微弱均值回归
    const meanReversion = (Math.log(startPrice / price)) * 0.005
    const z = gaussian(rand)
    let ret = meanReversion + sigma * z

    // 限制单步幅度，防止爆炸
    if (ret > 0.05) ret = 0.05
    if (ret < -0.05) ret = -0.05

    const open = +price.toFixed(2)
    const close = +(price * Math.exp(ret)).toFixed(2)

    // High/Low 围绕 open/close，加 intra-bar 抖动
    const bodyHi = Math.max(open, close)
    const bodyLo = Math.min(open, close)
    const wickRange = Math.max(Math.abs(close - open), open * sigma * 0.6)
    const high = +(bodyHi + wickRange * rand()).toFixed(2)
    const low = +Math.max(bodyLo - wickRange * rand(), 1).toFixed(2)

    // 成交量
    const baseVol = 80 + rand() * 120
    const volume = +(baseVol * (1 + Math.abs(ret) * 80)).toFixed(2)

    bars.push({ time, open, high, low, close, volume })
    price = close
  }

  return bars
}

export const TIMEFRAMES = Object.keys(TIMEFRAME_SECONDS)
