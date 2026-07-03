import { ref, reactive, computed } from 'vue'
import { Chart } from '@mg-exchange/charts'
import { generateMockBars } from '../data/mockData.js'
import { parseCsvBars } from '../data/csvBars.js'
import { BTC_TIMEFRAMES, fetchLatestBtcBars } from '../data/binanceData.js'
import { buildCoachPayload } from '../coach/localCoach.js'
import { requestAiCoachFeedback } from '../coach/aiCoach.js'

const STORAGE_KEY = 'pa-training-replay-session:v1'
const DEFAULT_CONTEXT_BARS = 200
const FUTURE_PADDING_BARS = 80
const DEFAULT_INITIAL_BALANCE = 1000

const replayEma20 = {
  name: 'Replay EMA20',
  shortName: 'EMA20',
  description: 'EMA20 calculated only from revealed replay bars',
  overlay: true,
  params: [
    { name: 'period', type: 'number', default: 20, min: 1, max: 500, step: 1 },
    { name: 'color', type: 'color', default: '#f0b429' }
  ],
  plots: [
    { key: 'ema', type: 'line', color: '#f0b429', lineWidth: 1.5 }
  ],
  calculate(bars, params) {
    const period = Number(params.period) || 20
    const k = 2 / (period + 1)
    let seedSum = 0
    let emaValue
    let realCount = 0

    return bars.map((bar) => {
      if (bar.futurePadding) {
        return { time: bar.time, values: { ema: undefined } }
      }
      realCount += 1
      if (realCount < period) {
        seedSum += bar.close
        return { time: bar.time, values: { ema: undefined } }
      }
      if (realCount === period) {
        seedSum += bar.close
        emaValue = seedSum / period
      } else {
        emaValue = bar.close * k + emaValue * (1 - k)
      }
      return { time: bar.time, values: { ema: emaValue } }
    })
  }
}

function makeDefaultDataset() {
  return {
    symbol: 'BTCUSDT',
    timeframe: '1H',
    source: 'mock',
    name: '模拟数据',
    bars: generateMockBars({ timeframe: '1H', count: 600 })
  }
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function safeReadSession() {
  if (!canUseStorage()) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (err) {
    console.warn('读取训练会话失败:', err)
    return null
  }
}

function safeWriteSession(payload) {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (err) {
    console.warn('保存训练会话失败:', err)
  }
}

function assignReactiveArray(target, items) {
  target.splice(0, target.length, ...(Array.isArray(items) ? items : []))
}

function assignReactiveObject(target, source) {
  for (const key of Object.keys(target)) delete target[key]
  if (!source || typeof source !== 'object') return
  for (const [key, value] of Object.entries(source)) target[key] = value
}

function nextNumericId(items, prefix) {
  let max = 0
  for (const item of items) {
    const raw = String(item?.id || '')
    if (raw.startsWith(prefix)) {
      const n = Number(raw.slice(prefix.length))
      if (Number.isFinite(n)) max = Math.max(max, n)
    }
  }
  return max + 1
}

function inferTimeframe(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return '1H'
  const seconds = Math.max(1, bars[1].time - bars[0].time)
  if (seconds <= 60) return '1m'
  if (seconds <= 300) return '5m'
  if (seconds <= 900) return '15m'
  if (seconds <= 1800) return '30m'
  if (seconds <= 3600) return '1H'
  if (seconds <= 14400) return '4H'
  return '1D'
}

function inferDatasetMeta(fileName, bars) {
  const clean = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-](\d{4}|\d{8}).*$/, '')
  const parts = clean.split(/[_\-\s]+/).filter(Boolean)
  return {
    symbol: (parts[0] || 'IMPORTED').toUpperCase(),
    timeframe: parts.find(p => /^\d+[mhd]$/i.test(p))?.toUpperCase().replace('M', 'm').replace('D', 'D').replace('H', 'H') || inferTimeframe(bars)
  }
}

function blankReview() {
  return {
    marketState: '',
    barType: '',
    alwaysIn: '',
    tradePlan: '',
    signalQuality: '',
    invalidation: '',
    note: ''
  }
}

function countBy(records, field, fallback = '未选择') {
  return records.reduce((acc, record) => {
    const key = record?.[field] || fallback
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

function summarizeTrades(trades) {
  const closed = trades.filter(t => Number.isFinite(Number(t.pnl)))
  const wins = closed.filter(t => Number(t.pnl) > 0)
  const losses = closed.filter(t => Number(t.pnl) < 0)
  const totalPnl = closed.reduce((sum, t) => sum + Number(t.pnl || 0), 0)
  const avgPnl = closed.length ? totalPnl / closed.length : 0
  const grossProfit = wins.reduce((sum, t) => sum + Number(t.pnl || 0), 0)
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + Number(t.pnl || 0), 0))

  return {
    total: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: closed.length - wins.length - losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    totalPnl,
    avgPnl,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
  }
}

function summarizeMistakeTags(feedbacks, trades) {
  const byId = new Map(trades.map(trade => [trade.id, trade]))
  const stats = {}
  for (const [key, feedback] of Object.entries(feedbacks || {})) {
    const tags = Array.isArray(feedback?.mistakeTags) ? feedback.mistakeTags : []
    if (!tags.length) continue
    const tradeId = key.startsWith('trade:') ? key.slice(6) : feedback?.payloadPreview?.selectedTradeId
    const pnl = Number(byId.get(tradeId)?.pnl || 0)
    for (const tag of tags) {
      const name = String(tag || '').trim()
      if (!name) continue
      if (!stats[name]) stats[name] = { count: 0, totalPnl: 0, wins: 0, losses: 0 }
      stats[name].count += 1
      stats[name].totalPnl += pnl
      if (pnl > 0) stats[name].wins += 1
      if (pnl < 0) stats[name].losses += 1
    }
  }
  return stats
}

function timeframeSeconds(tf) {
  const raw = String(tf || '1H')
  const n = Number.parseInt(raw, 10) || 1
  if (/m$/i.test(raw)) return n * 60
  if (/h$/i.test(raw)) return n * 3600
  if (/d$/i.test(raw)) return n * 86400
  return 3600
}

function nearestBarIndexByTime(bars, time) {
  if (!Array.isArray(bars) || !bars.length || !time) return -1
  let bestIndex = -1
  let bestDistance = Infinity
  bars.forEach((bar, index) => {
    const distance = Math.abs(Number(bar.time) - Number(time))
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  return bestIndex
}

function chinaEightSessionKey(time) {
  const d = new Date(time * 1000)
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
}

/**
 * 主 composable - 管理 Chart 实例和整个 demo 的状态
 *
 * 回放机制：
 *   - 一次性生成全部 bars
 *   - 初始用 chart.setData(allBars.slice(0, initialVisible)) 显示一部分
 *   - 提供一个空 datafeed (Chart 构造时必填，但我们不依赖它加载数据)
 *   - 点击"下一根/上一根" → 重新渲染 [0..replayIndex]，保持回放状态可逆
 */
export function useChart() {
  // ---------- 数据 ----------
  const savedSession = safeReadSession()
  const defaultDataset = makeDefaultDataset()
  const initialDataset = savedSession?.dataset?.bars?.length ? savedSession.dataset : defaultDataset
  const allBars = ref(initialDataset.bars)
  const symbol = ref(initialDataset.symbol || defaultDataset.symbol)
  const timeframe = ref(initialDataset.timeframe || defaultDataset.timeframe)
  const dataSource = ref(initialDataset.source || defaultDataset.source)
  const datasetName = ref(initialDataset.name || defaultDataset.name)
  const sessionMessage = ref(savedSession?.dataset?.bars?.length ? '已恢复上次训练会话' : '使用内置模拟数据')
  const isLoadingData = ref(false)
  const dataError = ref('')
  const selectedTradeId = ref(savedSession?.selectedTradeId || '')
  const markerRefreshTick = ref(0)
  const barCountSettings = reactive({
    enabled: savedSession?.barCountSettings?.enabled ?? true,
    displayInterval: savedSession?.barCountSettings?.displayInterval ?? savedSession?.barCountSettings?.reminderInterval ?? 2
  })

  const visibleStartIndex = computed(() => Math.min(DEFAULT_CONTEXT_BARS - 1, Math.max(allBars.value.length - 1, 0)))

  // Datafeed —— 在 chart 构造时 loadInitialData() 会调一次 getBars，
  // 我们返回当前 replayIndex 范围内的 bars。
  // 注意：Chart 构造完成后我们不再依赖 datafeed，回放推进直接用 updateBar。
  const datafeed = {
    async getBars() {
      // 返回 [0..replayIndex] 范围内的初始可见数据
      return replayDisplayBars()
    },
    subscribe() {
      // 不订阅实时流，回放手动驱动
      return () => {}
    },
    async searchSymbols() {
      return []
    },
    async resolveSymbol(sym) {
      return {
        symbol: sym,
        name: sym,
        exchange: dataSource.value === 'mock' ? 'Mock' : 'Imported',
        type: 'perpetual',
        pricePrecision: 2,
        qtyPrecision: 4,
        minMove: 0.01
      }
    }
  }

  // ---------- Chart 实例 ----------
  let chart = null
  let ema20IndicatorId = null
  const chartReady = ref(false)

  // ---------- 回放状态 ----------
  const replayIndex = ref(
    Number.isInteger(savedSession?.replayIndex)
      ? Math.min(savedSession.replayIndex, allBars.value.length - 1)
      : visibleStartIndex.value
  )
  const replayMax = computed(() => Math.max(allBars.value.length - 1, 0))
  const canReplayNext = computed(() => replayIndex.value < replayMax.value)
  const canReplayPrev = computed(() => replayIndex.value > 0)
  const isAutoPlaying = ref(false)
  let autoPlayTimer = null

  const currentBar = computed(() => allBars.value[replayIndex.value] || null)

  // ---------- 画线状态 ----------
  const activeDrawingTool = ref(null)
  const drawingsCount = ref(0)

  // ---------- 交易状态 ----------
  const account = reactive({
    balance: savedSession?.account?.balance ?? DEFAULT_INITIAL_BALANCE,
    initialBalance: savedSession?.account?.initialBalance ?? DEFAULT_INITIAL_BALANCE,
    orderMode: savedSession?.account?.orderMode || 'qty',
    defaultQty: savedSession?.account?.defaultQty ?? 0.05,
    defaultAmount: savedSession?.account?.defaultAmount ?? 1000
  })

  const orders = reactive([])
  const positions = reactive([])
  const trades = reactive([])
  const barReviews = reactive({})
  const coachFeedbacks = reactive({})
  const reviewRequestStates = reactive({})
  const mistakes = reactive({})
  const tradeNotes = reactive({})
  assignReactiveArray(orders, savedSession?.orders)
  assignReactiveArray(positions, savedSession?.positions)
  assignReactiveArray(trades, savedSession?.trades)
  assignReactiveObject(barReviews, savedSession?.barReviews)
  assignReactiveObject(coachFeedbacks, savedSession?.coachFeedbacks)
  assignReactiveObject(mistakes, savedSession?.mistakes)
  assignReactiveObject(tradeNotes, savedSession?.tradeNotes)

  const realizedPnL = computed(() => trades.reduce((s, t) => s + t.pnl, 0))

  const unrealizedPnL = computed(() => {
    if (!currentBar.value) return 0
    const price = currentBar.value.close
    return positions.reduce((sum, p) => {
      const dir = p.side === 'long' ? 1 : -1
      return sum + (price - p.entryPrice) * p.quantity * dir
    }, 0)
  })

  const equity = computed(() => account.balance + unrealizedPnL.value)
  const currentReviewKey = computed(() => currentBar.value ? String(currentBar.value.time) : '')
  const currentReview = computed(() => {
    const key = currentReviewKey.value
    return key && barReviews[key] ? { ...blankReview(), ...barReviews[key] } : blankReview()
  })
  const currentCoachFeedback = computed(() => {
    if (selectedTradeId.value && coachFeedbacks[`trade:${selectedTradeId.value}`]) {
      return coachFeedbacks[`trade:${selectedTradeId.value}`]
    }
    const key = currentReviewKey.value
    return key && coachFeedbacks[key] ? coachFeedbacks[key] : null
  })
  const currentReviewRequestState = computed(() => {
    const key = selectedTradeId.value ? `trade:${selectedTradeId.value}` : currentReviewKey.value
    return key && reviewRequestStates[key]
      ? reviewRequestStates[key]
      : { loading: false, error: '', startedAt: '', finishedAt: '' }
  })
  const currentMistake = computed(() => {
    const key = currentReviewKey.value
    return key && mistakes[key] ? mistakes[key] : null
  })
  const selectedTrade = computed(() => trades.find(t => t.id === selectedTradeId.value) || null)
  const reviewStats = computed(() => {
    const records = Object.values(barReviews)
    return {
      total: records.length,
      reviewedCurrent: Boolean(currentReviewKey.value && barReviews[currentReviewKey.value]),
      tradePlans: countBy(records, 'tradePlan'),
      marketStates: countBy(records, 'marketState'),
      barTypes: countBy(records, 'barType'),
      alwaysIn: countBy(records, 'alwaysIn'),
      signalQuality: countBy(records, 'signalQuality')
    }
  })
  const sessionReport = computed(() => {
    const reviewRecords = Object.values(barReviews)
    return {
      reviewedBars: reviewRecords.length,
      totalVisibleBars: replayIndex.value + 1,
      totalBars: allBars.value.length,
      reviewRate: replayIndex.value >= 0 ? reviewRecords.length / (replayIndex.value + 1) : 0,
      reviewStats: reviewStats.value,
      tradeStats: summarizeTrades(trades),
      mistakeTagStats: summarizeMistakeTags(coachFeedbacks, trades),
      recentTrades: trades.slice().reverse().slice(0, 12),
      openPositions: positions.length,
      pendingOrders: orders.length,
      mistakeCount: Object.keys(mistakes).length
    }
  })
  const tradeMarkers = computed(() => {
    markerRefreshTick.value
    if (!chart || !Array.isArray(trades) || !trades.length) return []
    const scale = chart.timeScale
    const priceScale = chart.priceScale
    const dataSource = chart.dataSource
    if (!scale || !priceScale || !dataSource) return []
    const chartWidth = chart.chartWidth || chartContainerWidth()
    const paneHeight = chart.paneManager?.getMain?.().height || chart.chartHeight || chartContainerHeight()
    const first = Math.floor(scale.firstIndex) - 2
    const last = Math.ceil(scale.firstIndex + scale.visibleCount) + 2
    return trades.map(trade => {
      const idx = dataSource.nearestIndex?.(trade.openTime)
      if (!Number.isFinite(idx) || idx < first || idx > last) return null
      const x = (idx - scale.firstIndex) * scale.barSpacing + scale.offsetX + scale.barSpacing / 2
      const y = priceToY(trade.entryPrice, priceScale, paneHeight)
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < -24 || x > chartWidth + 24 || y < -24 || y > paneHeight + 24) return null
      return {
        id: trade.id,
        x,
        y,
        side: trade.side,
        profitable: Number(trade.pnl || 0) >= 0,
        pnl: Number(trade.pnl || 0),
        quantity: trade.quantity,
        notional: trade.notional || trade.entryPrice * trade.quantity,
        entryPrice: trade.entryPrice,
        closePrice: trade.closePrice,
        openTime: trade.openTime,
        closeTime: trade.closeTime,
        exitReason: trade.exitReason || 'manual'
      }
    }).filter(Boolean)
  })

  let orderIdSeq = nextNumericId(orders, 'ord-')
  let positionIdSeq = nextNumericId(positions, 'pos-')
  let markerRefreshTimer = null

  function chartContainerWidth() {
    return chart?.container?.clientWidth || 0
  }

  function chartContainerHeight() {
    return chart?.container?.clientHeight || 0
  }

  function priceToY(price, scale, height) {
    if (!scale || !height) return 0
    if (scale.mode === 'logarithmic') {
      const min = Math.log(scale.min)
      const max = Math.log(scale.max)
      return max === min ? height / 2 : height * (1 - (Math.log(price) - min) / (max - min))
    }
    const range = scale.max - scale.min
    return range === 0 ? height / 2 : height * (1 - (price - scale.min) / range)
  }

  function refreshTradeMarkers() {
    markerRefreshTick.value += 1
  }

  // ---------- Chart 初始化 ----------
  function initChart(container) {
    // 防御性：如果已经有 chart 实例（HMR 或重复挂载），先销毁
    if (chart) {
      try { chart.destroy() } catch (e) {}
      chart = null
      ema20IndicatorId = null
    }
    if (markerRefreshTimer) {
      clearInterval(markerRefreshTimer)
      markerRefreshTimer = null
    }
    // 防御性：清空容器内可能残留的 canvas（来自旧 Chart 实例）
    while (container.firstChild) container.removeChild(container.firstChild)

    chart = new Chart({
      container,
      symbol: symbol.value,
      timeframe: timeframe.value,
      datafeed,
      theme: 'dark',
      chartType: 'candlestick',
      renderer: 'canvas2d',  // 'webgl' 会自动 fallback 到 canvas2d 如果不可用
      pricePrecision: 2,
      features: {
        crosshair: true,
        tooltip: true,
        drawings: true,
        indicators: true,
        volume: true,
        grid: true,
        priceLine: true,
        ohlcvLegend: true,
        watermark: true,
        barChange: true
      },
      trading: {
        showPlusButton: false,
        showContextMenu: true,
        draggableOrderLines: true
      }
    })

    // ---------- 残影修复 ----------
    // chart 内部 clearRect 受 setTransform(dpr,...) 缩放矩阵影响，
    // 在某些 DPR (尤其非整数) / 浏览器组合下会清不干净留下残影。
    // 这里 monkey-patch layers.clear，强制 reset transform 后再 clearRect。
    if (chart.layers && typeof chart.layers.clear === 'function') {
      const origClear = chart.layers.clear.bind(chart.layers)
      chart.layers.clear = function (name) {
        const layer = this.get(name)
        if (layer && layer.ctx && layer.ctx instanceof CanvasRenderingContext2D) {
          const ctx = layer.ctx
          ctx.save()
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
          ctx.restore()
        } else {
          origClear(name)
        }
      }
    }

    // 启用交易模式 + 自定义右键菜单
    chart.setTradeMode(true, {
      showPlusButton: false,  // 关闭 "+" 悬停标签，避免残影
      showContextMenu: true,
      draggableOrderLines: true,
      contextMenuItems: (price) => [
        { label: `复制价格 ${price.toFixed(2)}`, action: 'copy-price' },
        { label: `市价买入 @ ${price.toFixed(2)}`, action: 'market-buy' },
        { label: `市价卖出 @ ${price.toFixed(2)}`, action: 'market-sell' },
        { label: `限价买入 @ ${price.toFixed(2)}`, action: 'limit-buy', separator: true },
        { label: `限价卖出 @ ${price.toFixed(2)}`, action: 'limit-sell' },
        { label: `突破买入 @ ${price.toFixed(2)}`, action: 'breakout-buy', separator: true },
        { label: `突破卖出 @ ${price.toFixed(2)}`, action: 'breakout-sell' },
        { label: `止损单 @ ${price.toFixed(2)}`, action: 'stop-order', separator: true },
        { label: '在此处设置警报', action: 'alert' }
      ]
    })

    chart.on('tradeRequested', ({ side, price, type, action }) => {
      onTradeRequested({ side, price, type, action })
    })

    chart.on('orderLineMoved', ({ id, price }) => {
      updateOrderPrice(id, price)
    })

    chart.on('drawingAdded', () => {
      drawingsCount.value = chart.getDrawings().length
      activeDrawingTool.value = null
    })
    chart.on('drawingRemoved', () => {
      drawingsCount.value = chart.getDrawings().length
    })
    chart.on('drawingSelected', () => {
      activeDrawingTool.value = null
    })

    chartReady.value = true
    ensureCoreIndicators()
    restoreChartDecorations()
    markerRefreshTimer = window.setInterval(refreshTradeMarkers, 250)
  }

  function ensureCoreIndicators() {
    if (!chart || ema20IndicatorId) return
    ema20IndicatorId = chart.addIndicator(replayEma20, {
      period: 20,
      color: '#f0b429'
    })
  }

  // ---------- 回放控制 ----------
  function futurePaddingBars() {
    const last = allBars.value[replayIndex.value]
    if (!last) return []
    const step = timeframeSeconds(timeframe.value)
    return Array.from({ length: FUTURE_PADDING_BARS }, (_, i) => ({
      time: last.time + step * (i + 1),
      open: last.close,
      high: last.close,
      low: last.close,
      close: last.close,
      volume: 0,
      futurePadding: true
    }))
  }

  function replayDisplayBars() {
    return [
      ...allBars.value.slice(0, replayIndex.value + 1),
      ...futurePaddingBars()
    ]
  }

  function restoreTimeScaleSnapshot(snapshot) {
    if (!chart || !snapshot || !chart.timeScale) return
    const maxFirst = Math.max(0, (chart.dataSource?.length || 0) - snapshot.visibleCount)
    chart.timeScale.barSpacing = snapshot.barSpacing
    chart.timeScale.visibleCount = snapshot.visibleCount
    chart.timeScale.offsetX = snapshot.offsetX
    chart.timeScale.firstIndex = Math.min(Math.max(0, snapshot.firstIndex), maxFirst)
    chart.scrollZoom?.updateState?.({ timeScale: chart.timeScale, totalBars: chart.dataSource?.length || 0 })
    chart.recalcPriceRange?.()
    chart.layers?.markAllDirty?.()
    chart.scheduleRender?.()
  }

  function renderReplayWindow(options = {}) {
    if (!chart) return
    const preserveTimeScale = options.preserveTimeScale ?? true
    const timeScaleSnapshot = preserveTimeScale && chart.timeScale
      ? { ...chart.timeScale }
      : null
    const drawings = typeof chart.getDrawings === 'function' ? chart.getDrawings() : []
    chart.setData(replayDisplayBars())
    restoreTimeScaleSnapshot(timeScaleSnapshot)
    const afterDrawings = typeof chart.getDrawings === 'function' ? chart.getDrawings() : []
    if (drawings.length && !afterDrawings.length && typeof chart.loadDrawings === 'function') {
      chart.loadDrawings(drawings)
      drawingsCount.value = drawings.length
    }
    refreshBarCountMarkers()
    restoreOrderLines()
    refreshPositionOverlays()
    refreshTradeMarkers()
  }

  function replayNext() {
    if (!canReplayNext.value || !chart) return
    replayIndex.value += 1
    renderReplayWindow()
    matchPendingOrders()
    refreshPositionOverlays()
    saveSession()
  }

  function replayPrev() {
    if (!canReplayPrev.value || !chart) return
    stopAutoPlay()
    replayIndex.value -= 1
    renderReplayWindow()
    saveSession()
  }

  function replayReset() {
    if (!chart) return
    stopAutoPlay()
    replayIndex.value = visibleStartIndex.value
    renderReplayWindow({ preserveTimeScale: false })
    saveSession()
  }

  async function importCsvFile(file, options = {}) {
    const text = await file.text()
    const bars = parseCsvBars(text)
    const inferred = inferDatasetMeta(file.name, bars)
    applyDataset({
      bars,
      symbol: options.symbol || inferred.symbol,
      timeframe: options.timeframe || inferred.timeframe,
      source: 'csv',
      name: file.name || 'CSV导入'
    })
    sessionMessage.value = `已导入 ${bars.length} 根K线: ${file.name}`
  }

  function applyDataset(dataset) {
    stopAutoPlay()
    allBars.value = dataset.bars
    symbol.value = dataset.symbol || 'IMPORTED'
    timeframe.value = dataset.timeframe || inferTimeframe(dataset.bars)
    dataSource.value = dataset.source || 'custom'
    datasetName.value = dataset.name || '未命名数据'
    replayIndex.value = visibleStartIndex.value
    resetTradingState()
    if (chart) {
      renderReplayWindow({ preserveTimeScale: false })
    }
    saveSession()
  }

  async function loadLatestBtcData(nextTimeframe = timeframe.value || '5m') {
    stopAutoPlay()
    isLoadingData.value = true
    dataError.value = ''
    sessionMessage.value = `正在加载 BTCUSDT ${nextTimeframe} 最新K线...`
    try {
      const dataset = await fetchLatestBtcBars({ timeframe: nextTimeframe, targetCount: 3000 })
      applyDataset(dataset)
      sessionMessage.value = `已加载 BTCUSDT ${nextTimeframe} 最新K线: ${dataset.bars.length} 根`
    } catch (err) {
      dataError.value = err?.message || 'BTC最新K线加载失败'
      sessionMessage.value = dataError.value
      throw err
    } finally {
      isLoadingData.value = false
    }
  }

  async function setTimeframe(nextTimeframe) {
    if (!nextTimeframe || nextTimeframe === timeframe.value) return
    if (dataSource.value === 'binance' || symbol.value === 'BTCUSDT') {
      await loadLatestBtcData(nextTimeframe)
      return
    }
    applyDataset({
      ...makeDefaultDataset(),
      timeframe: nextTimeframe,
      name: `模拟数据 ${nextTimeframe}`,
      bars: generateMockBars({ timeframe: nextTimeframe, count: 600 })
    })
    sessionMessage.value = `已切换模拟数据周期: ${nextTimeframe}`
  }

  function resetToMockData() {
    applyDataset(makeDefaultDataset())
    sessionMessage.value = '已重置为内置模拟数据'
  }

  function updateCurrentReview(patch) {
    if (!currentBar.value || !patch || typeof patch !== 'object') return
    const key = currentReviewKey.value
    const existing = barReviews[key] || {}
    barReviews[key] = {
      ...blankReview(),
      ...existing,
      ...patch,
      barTime: currentBar.value.time,
      barIndex: replayIndex.value,
      close: currentBar.value.close,
      updatedAt: new Date().toISOString()
    }
    saveSession()
  }

  function clearCurrentReview() {
    const key = currentReviewKey.value
    if (!key || !barReviews[key]) return
    delete barReviews[key]
    saveSession()
  }

  async function runCoachForCurrentBar() {
    if (!currentBar.value) return
    const selected = selectedTrade.value
    const key = selected?.id ? `trade:${selected.id}` : currentReviewKey.value
    if (reviewRequestStates[key]?.loading) return
    reviewRequestStates[key] = {
      loading: true,
      error: '',
      startedAt: new Date().toISOString(),
      finishedAt: ''
    }
    const payload = buildCoachPayload({
      bars: allBars.value,
      replayIndex: replayIndex.value,
      review: selected?.id ? { ...currentReview.value, note: tradeNotes[selected.id] || '' } : currentReview.value,
      trades,
      positions,
      selectedTrade: selected ? { ...selected, note: tradeNotes[selected.id] || '' } : null
    })
    try {
      coachFeedbacks[key] = await requestAiCoachFeedback(payload)
      reviewRequestStates[key] = {
        ...reviewRequestStates[key],
        loading: false,
        error: '',
        finishedAt: new Date().toISOString()
      }
      saveSession()
    } catch (err) {
      reviewRequestStates[key] = {
        ...reviewRequestStates[key],
        loading: false,
        error: err?.message || 'AI点评失败',
        finishedAt: new Date().toISOString()
      }
      throw err
    }
  }

  function markCurrentMistake(reason = '') {
    if (!currentBar.value) return
    const key = currentReviewKey.value
    mistakes[key] = {
      barTime: currentBar.value.time,
      barIndex: replayIndex.value,
      close: currentBar.value.close,
      reason,
      review: { ...currentReview.value },
      coachFeedback: currentCoachFeedback.value ? { ...currentCoachFeedback.value } : null,
      createdAt: new Date().toISOString()
    }
    saveSession()
  }

  function unmarkCurrentMistake() {
    const key = currentReviewKey.value
    if (!key || !mistakes[key]) return
    delete mistakes[key]
    saveSession()
  }

  function startAutoPlay(intervalMs = 400) {
    if (isAutoPlaying.value) return
    isAutoPlaying.value = true
    autoPlayTimer = setInterval(() => {
      if (!canReplayNext.value) {
        stopAutoPlay()
        return
      }
      replayNext()
    }, intervalMs)
  }

  function stopAutoPlay() {
    isAutoPlaying.value = false
    if (autoPlayTimer) {
      clearInterval(autoPlayTimer)
      autoPlayTimer = null
    }
  }

  // ---------- 画线 ----------
  function setDrawingTool(toolName) {
    if (!chart) return
    if (activeDrawingTool.value === toolName) {
      activeDrawingTool.value = null
      chart.setDrawingTool(null)
    } else {
      activeDrawingTool.value = toolName
      chart.setDrawingTool(toolName)
    }
  }

  function setRiskRewardTool(side) {
    if (!chart) return
    const toolKey = side === 'short' ? 'short-position' : 'long-position'
    if (activeDrawingTool.value === toolKey) {
      activeDrawingTool.value = null
      chart.setDrawingTool(null)
      return
    }
    activeDrawingTool.value = toolKey
    chart.setDrawingTool('long-short')
    sessionMessage.value = side === 'short'
      ? '空头仓位工具: 依次点击入场、目标下方、止损上方'
      : '多头仓位工具: 依次点击入场、目标上方、止损下方'
  }

  function clearDrawings() {
    if (!chart) return
    chart.clearDrawings()
    drawingsCount.value = 0
  }

  function setMagnetMode(enabled) {
    chart?.setMagnetMode(enabled)
  }

  function deleteSelectedDrawing() {
    if (!chart || typeof chart.getSelectedDrawing !== 'function') return false
    const selected = chart.getSelectedDrawing()
    if (!selected?.id) return false
    chart.removeDrawing(selected.id)
    drawingsCount.value = chart.getDrawings?.().length || 0
    saveSession()
    return true
  }

  // ---------- 交易：右键/+ 按钮触发 ----------
  function onTradeRequested({ side, price, type, action }) {
    const a = action || `${type}-${side}`
    switch (a) {
      case 'copy-price':
        copyPrice(price)
        break
      case 'market-buy':
        openMarketPosition('long')
        break
      case 'market-sell':
        openMarketPosition('short')
        break
      case 'limit-buy':
        placeLimitOrder('buy', price)
        break
      case 'limit-sell':
        placeLimitOrder('sell', price)
        break
      case 'breakout-buy':
        placeBreakoutOrder('buy', price)
        break
      case 'breakout-sell':
        placeBreakoutOrder('sell', price)
        break
      case 'stop-order': {
        const cur = currentBar.value?.close ?? price
        const orderSide = price < cur ? 'sell' : 'buy'
        placeStopOrder(orderSide, price)
        break
      }
      case 'alert':
        if (chart) chart.addAlert(price, 'crossing', `警报 ${price.toFixed(2)}`)
        break
      default:
        if (type === 'market') {
          openMarketPosition(side === 'buy' ? 'long' : 'short')
        } else if (type === 'limit') {
          placeLimitOrder(side, price)
        }
    }
  }

  // ---------- 持仓/订单 helpers ----------
  function defaultQty() {
    if (!currentBar.value) return Number(account.defaultQty) || 0.05
    if (account.orderMode === 'amount') {
      const amount = Number(account.defaultAmount)
      return amount > 0 ? +(amount / currentBar.value.close).toFixed(6) : 0.05
    }
    const qty = Number(account.defaultQty)
    return qty > 0 ? qty : 0.05
  }

  function orderLabel(order) {
    const sideTxt = order.side === 'buy' ? '买' : '卖'
    const typeTxt = order.type === 'limit' ? '限价' : order.type === 'breakout' ? '突破' : '止损'
    return `${typeTxt}${sideTxt} ${order.quantity}`
  }

  function orderLinePayload(order) {
    return {
      id: order.id,
      price: order.price,
      type: order.type,
      side: order.side,
      label: order.type === 'tp' ? `止盈 ${order.quantity}` : order.type === 'sl' ? `止损 ${order.quantity}` : orderLabel(order),
      quantity: order.quantity
    }
  }

  function addOrReplaceOrderLine(order) {
    if (!chart || order.status !== 'pending') return
    chart.removeOrderLine?.(order.id)
    chart.addOrderLine(orderLinePayload(order))
  }

  async function copyPrice(price) {
    const text = Number(price).toFixed(2)
    try {
      await navigator.clipboard.writeText(text)
      sessionMessage.value = `已复制价格: ${text}`
    } catch (err) {
      sessionMessage.value = `复制失败，请手动复制: ${text}`
    }
  }

  function updateAccountSettings(patch) {
    if (!patch || typeof patch !== 'object') return
    const initialBalance = Number(patch.initialBalance)
    if (Number.isFinite(initialBalance) && initialBalance > 0) {
      const delta = initialBalance - account.initialBalance
      account.initialBalance = initialBalance
      account.balance += delta
    }
    if (patch.orderMode === 'qty' || patch.orderMode === 'amount') account.orderMode = patch.orderMode
    const defaultQtyValue = Number(patch.defaultQty)
    if (Number.isFinite(defaultQtyValue) && defaultQtyValue > 0) account.defaultQty = defaultQtyValue
    const defaultAmountValue = Number(patch.defaultAmount)
    if (Number.isFinite(defaultAmountValue) && defaultAmountValue > 0) account.defaultAmount = defaultAmountValue
    saveSession()
  }

  function openMarketPosition(side, qty = defaultQty()) {
    if (!currentBar.value) return
    const entryPrice = currentBar.value.close
    const id = `pos-${positionIdSeq++}`
    const pos = {
      id,
      side,
      entryPrice,
      quantity: qty,
      openTime: currentBar.value.time
    }
    positions.push(pos)
    refreshPositionOverlays()
    saveSession()
  }

  function placeLimitOrder(side, price, qty = defaultQty()) {
    const id = `ord-${orderIdSeq++}`
    const order = {
      id,
      side,
      type: 'limit',
      price: +price.toFixed(2),
      quantity: qty,
      status: 'pending',
      createdAt: currentBar.value?.time
    }
    orders.push(order)
    addOrReplaceOrderLine(order)
    saveSession()
  }

  function placeBreakoutOrder(side, price, qty = defaultQty()) {
    const id = `ord-${orderIdSeq++}`
    const order = {
      id,
      side,
      type: 'breakout',
      price: +price.toFixed(2),
      quantity: qty,
      status: 'pending',
      createdAt: currentBar.value?.time
    }
    orders.push(order)
    addOrReplaceOrderLine(order)
    saveSession()
  }

  function placeStopOrder(side, price, qty = defaultQty()) {
    const id = `ord-${orderIdSeq++}`
    const order = {
      id,
      side,
      type: 'stop',
      price: +price.toFixed(2),
      quantity: qty,
      status: 'pending',
      createdAt: currentBar.value?.time
    }
    orders.push(order)
    addOrReplaceOrderLine(order)
    saveSession()
  }

  function updateOrderPrice(orderId, price) {
    const order = orders.find(o => o.id === orderId)
    const newPrice = Number(price)
    if (!order || order.status !== 'pending' || !Number.isFinite(newPrice) || newPrice <= 0) return
    order.price = +newPrice.toFixed(2)

    if (order.type === 'tp' || order.type === 'sl') {
      const pos = positions.find(p => p.id === order.positionId)
      if (pos) {
        if (order.type === 'tp') pos.tp = order.price
        else pos.sl = order.price
      }
    }

    chart?.updateOrderLine?.(order.id, orderLinePayload(order))
    refreshPositionOverlays()
    saveSession()
  }

  /**
   * 给指定持仓设置止盈 (TP) 线
   * TP 价格是目标平仓价 - 多头: high >= tp 时平仓; 空头: low <= tp 时平仓
   */
  function setTakeProfit(positionId, price) {
    const pos = positions.find(p => p.id === positionId)
    if (!pos) return

    // 若已有 TP，先移除
    if (pos.tpOrderId) {
      const oldOrder = orders.find(o => o.id === pos.tpOrderId)
      if (oldOrder) {
        orders.splice(orders.indexOf(oldOrder), 1)
        chart?.removeOrderLine(pos.tpOrderId)
      }
    }

    const id = `ord-${orderIdSeq++}`
    const order = {
      id,
      side: pos.side === 'long' ? 'sell' : 'buy', // 平仓方向
      type: 'tp',
      price: +price.toFixed(2),
      quantity: pos.quantity,
      status: 'pending',
      positionId, // 关联到持仓
      createdAt: currentBar.value?.time
    }
    orders.push(order)
    pos.tpOrderId = id
    pos.tp = order.price
    addOrReplaceOrderLine(order)
    saveSession()
  }

  /**
   * 给指定持仓设置止损 (SL) 线
   * SL 价格是最大亏损平仓价 - 多头: low <= sl 时平仓; 空头: high >= sl 时平仓
   */
  function setStopLoss(positionId, price) {
    const pos = positions.find(p => p.id === positionId)
    if (!pos) return

    if (pos.slOrderId) {
      const oldOrder = orders.find(o => o.id === pos.slOrderId)
      if (oldOrder) {
        orders.splice(orders.indexOf(oldOrder), 1)
        chart?.removeOrderLine(pos.slOrderId)
      }
    }

    const id = `ord-${orderIdSeq++}`
    const order = {
      id,
      side: pos.side === 'long' ? 'sell' : 'buy', // 平仓方向
      type: 'sl',
      price: +price.toFixed(2),
      quantity: pos.quantity,
      status: 'pending',
      positionId,
      createdAt: currentBar.value?.time
    }
    orders.push(order)
    pos.slOrderId = id
    pos.sl = order.price
    addOrReplaceOrderLine(order)
    saveSession()
  }

  /**
   * 移除指定持仓的 TP 或 SL
   */
  function removeTPSL(positionId, kind /* 'tp' | 'sl' */) {
    const pos = positions.find(p => p.id === positionId)
    if (!pos) return
    const orderId = kind === 'tp' ? pos.tpOrderId : pos.slOrderId
    if (!orderId) return
    const idx = orders.findIndex(o => o.id === orderId)
    if (idx !== -1) orders.splice(idx, 1)
    chart?.removeOrderLine(orderId)
    if (kind === 'tp') {
      pos.tpOrderId = null
      pos.tp = null
    } else {
      pos.slOrderId = null
      pos.sl = null
    }
    saveSession()
  }

  function cancelOrder(orderId) {
    const idx = orders.findIndex(o => o.id === orderId)
    if (idx === -1) return
    const order = orders[idx]
    if (order.positionId && (order.type === 'tp' || order.type === 'sl')) {
      const pos = positions.find(p => p.id === order.positionId)
      if (pos) {
        if (order.type === 'tp') {
          pos.tpOrderId = null
          pos.tp = null
        } else {
          pos.slOrderId = null
          pos.sl = null
        }
      }
    }
    orders.splice(idx, 1)
    chart?.removeOrderLine(orderId)
    refreshPositionOverlays()
    saveSession()
  }

  function closePosition(positionId, closePriceOverride) {
    const idx = positions.findIndex(p => p.id === positionId)
    if (idx === -1) return
    const p = positions[idx]
    const closePrice = closePriceOverride ?? currentBar.value?.close ?? p.entryPrice
    const dir = p.side === 'long' ? 1 : -1
    const pnl = (closePrice - p.entryPrice) * p.quantity * dir
    account.balance += pnl
    const trade = {
      id: `trade-${trades.length + 1}`,
      side: p.side,
      entryPrice: p.entryPrice,
      closePrice,
      quantity: p.quantity,
      notional: p.entryPrice * p.quantity,
      pnl,
      openTime: p.openTime,
      closeTime: currentBar.value?.time,
      exitReason: p.exitReason || 'manual'
    }
    trades.push(trade)
    selectedTradeId.value = trade.id
    // 移除该持仓的 TP/SL 委托线
    if (p.tpOrderId) {
      const oi = orders.findIndex(o => o.id === p.tpOrderId)
      if (oi !== -1) orders.splice(oi, 1)
      chart?.removeOrderLine(p.tpOrderId)
    }
    if (p.slOrderId) {
      const oi = orders.findIndex(o => o.id === p.slOrderId)
      if (oi !== -1) orders.splice(oi, 1)
      chart?.removeOrderLine(p.slOrderId)
    }
    positions.splice(idx, 1)
    refreshPositionOverlays()
    refreshTradeMarkers()
    saveSession()
  }

  function closeAllPositions() {
    while (positions.length) {
      closePosition(positions[0].id)
    }
  }

  function cancelAllOrders() {
    while (orders.length) {
      cancelOrder(orders[0].id)
    }
  }

  function matchPendingOrders() {
    if (!currentBar.value) return
    const { high, low } = currentBar.value
    // 复制列表以避免边遍历边删
    const pending = orders.filter(o => o.status === 'pending').slice()
    for (const order of pending) {
      // TP / SL —— 平掉关联的持仓
      if (order.type === 'tp' || order.type === 'sl') {
        const pos = positions.find(p => p.id === order.positionId)
        if (!pos) {
          // 持仓已不在（可能用户手动平仓了） → 撤销委托
          const i = orders.findIndex(o => o.id === order.id)
          if (i !== -1) orders.splice(i, 1)
          chart?.removeOrderLine(order.id)
          continue
        }
        let triggered = false
        if (order.type === 'tp') {
          // TP: 多头 high>=tp, 空头 low<=tp
          triggered = pos.side === 'long' ? high >= order.price : low <= order.price
        } else {
          // SL: 多头 low<=sl, 空头 high>=sl
          triggered = pos.side === 'long' ? low <= order.price : high >= order.price
        }
        if (triggered) {
          pos.exitReason = order.type === 'tp' ? '止盈' : '止损'
          closePosition(pos.id, order.price)
        }
        continue
      }

      // 普通挂单 (limit / stop) —— 开仓
      let triggered = false
      if (order.type === 'limit') {
        triggered = order.side === 'buy' ? low <= order.price : high >= order.price
      } else if (order.type === 'stop' || order.type === 'breakout') {
        triggered = order.side === 'buy' ? high >= order.price : low <= order.price
      }
      if (triggered) {
        const positionSide = order.side === 'buy' ? 'long' : 'short'
        openMarketPositionAt(positionSide, order.quantity, order.price)
        cancelOrder(order.id)
      }
    }
  }

  function openMarketPositionAt(side, qty, price) {
    const id = `pos-${positionIdSeq++}`
    const pos = {
      id,
      side,
      entryPrice: price,
      quantity: qty,
      openTime: currentBar.value?.time
    }
    positions.push(pos)
    refreshPositionOverlays()
    saveSession()
  }

  function refreshPositionOverlays() {
    if (!chart) return
    const overlays = positions.map(p => {
      const cur = currentBar.value?.close ?? p.entryPrice
      const dir = p.side === 'long' ? 1 : -1
      const pnl = (cur - p.entryPrice) * p.quantity * dir
      return {
        side: p.side,
        entryPrice: p.entryPrice,
        quantity: p.quantity,
        currentPrice: cur,
        pnl,
        breakeven: p.entryPrice,
        tpLevels: p.tp != null ? [{ price: p.tp, quantity: p.quantity }] : [],
        slLevels: p.sl != null ? [{ price: p.sl, quantity: p.quantity }] : []
      }
    })
    chart.setPositionOverlays(overlays)
  }

  function resetTradingState() {
    if (chart) {
      for (const order of orders) {
        chart.removeOrderLine?.(order.id)
      }
    }
    account.balance = DEFAULT_INITIAL_BALANCE
    account.initialBalance = DEFAULT_INITIAL_BALANCE
    account.orderMode = 'qty'
    account.defaultQty = 0.05
    account.defaultAmount = 1000
    assignReactiveArray(orders, [])
    assignReactiveArray(positions, [])
    assignReactiveArray(trades, [])
    assignReactiveObject(barReviews, {})
    assignReactiveObject(coachFeedbacks, {})
    assignReactiveObject(mistakes, {})
    orderIdSeq = 1
    positionIdSeq = 1
    chart?.setPositionOverlays?.([])
    selectedTradeId.value = ''
  }

  function resetAccount(initialBalance = DEFAULT_INITIAL_BALANCE) {
    const nextInitial = Number(initialBalance) > 0 ? Number(initialBalance) : DEFAULT_INITIAL_BALANCE
    if (chart) {
      for (const order of orders) chart.removeOrderLine?.(order.id)
    }
    account.balance = nextInitial
    account.initialBalance = nextInitial
    assignReactiveArray(orders, [])
    assignReactiveArray(positions, [])
    assignReactiveArray(trades, [])
    orderIdSeq = 1
    positionIdSeq = 1
    selectedTradeId.value = ''
    chart?.setPositionOverlays?.([])
    saveSession()
  }

  function deleteTrade(tradeId) {
    const idx = trades.findIndex(t => t.id === tradeId)
    if (idx === -1) return
    const trade = trades[idx]
    account.balance -= Number(trade.pnl || 0)
    trades.splice(idx, 1)
    if (selectedTradeId.value === tradeId) selectedTradeId.value = ''
    delete tradeNotes[tradeId]
    refreshTradeMarkers()
    saveSession()
  }

  function restoreOrderLines() {
    if (!chart) return
    chart.clearOrderLines?.()
    for (const order of orders) {
      if (order.status !== 'pending') continue
      addOrReplaceOrderLine(order)
    }
  }

  function restoreChartDecorations() {
    if (!chart) return
    ensureCoreIndicators()
    chart.setData(replayDisplayBars())
    refreshBarCountMarkers()
    restoreOrderLines()
    refreshPositionOverlays()
  }

  function refreshBarCountMarkers() {
    if (!chart || typeof chart.setBarMarkers !== 'function') return
    if (!barCountSettings.enabled || timeframeSeconds(timeframe.value) >= 86400) {
      chart.setBarMarkers([])
      return
    }
    const interval = Math.max(1, Number(barCountSettings.displayInterval) || 1)
    let count = 0
    let previousDay = ''
    const markers = []
    for (const bar of allBars.value.slice(0, replayIndex.value + 1)) {
      const day = chinaEightSessionKey(bar.time)
      count = day !== previousDay ? 1 : count + 1
      previousDay = day
      if (count % interval === 0) {
        markers.push({
          time: bar.time,
          label: String(count),
          color: '#f0b429',
          position: 'below'
        })
      }
    }
    chart.setBarMarkers(markers)
  }

  function updateBarCountSettings(patch) {
    if (!patch || typeof patch !== 'object') return
    if (typeof patch.enabled === 'boolean') barCountSettings.enabled = patch.enabled
    if (Object.prototype.hasOwnProperty.call(patch, 'displayInterval')) {
      const interval = Number(patch.displayInterval)
      barCountSettings.displayInterval = Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 1
    }
    refreshBarCountMarkers()
    saveSession()
  }

  function selectTradeForReview(tradeId) {
    selectedTradeId.value = tradeId || ''
    const trade = trades.find(t => t.id === tradeId)
    if (trade) {
      const closeIndex = nearestBarIndexByTime(allBars.value, trade.closeTime || trade.openTime)
      const openIndex = nearestBarIndexByTime(allBars.value, trade.openTime)
      const targetIndex = Math.max(closeIndex, openIndex + 20)
      if (targetIndex >= 0) {
        replayIndex.value = Math.min(allBars.value.length - 1, Math.max(visibleStartIndex.value, targetIndex))
        renderReplayWindow()
      }
    }
    saveSession()
  }

  function updateTradeNote(tradeId, note) {
    if (!tradeId) return
    tradeNotes[tradeId] = String(note || '')
    saveSession()
  }

  function exportReviewData() {
    const data = {
      exportedAt: new Date().toISOString(),
      symbol: symbol.value,
      timeframe: timeframe.value,
      dataset: {
        source: dataSource.value,
        name: datasetName.value,
        barsCount: allBars.value.length
      },
      report: sessionReport.value,
      trades: trades.map(trade => ({ ...trade })),
      coachFeedbacks: Object.fromEntries(
        Object.entries(coachFeedbacks).map(([key, value]) => [key, { ...value }])
      )
    }
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    a.href = url
    a.download = `price-action-review-${symbol.value}-${timeframe.value}-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function saveSession() {
    safeWriteSession({
      savedAt: new Date().toISOString(),
      dataset: {
        symbol: symbol.value,
        timeframe: timeframe.value,
        source: dataSource.value,
        name: datasetName.value,
        bars: allBars.value
      },
      replayIndex: replayIndex.value,
      barCountSettings: { ...barCountSettings },
      account: { ...account },
      orders: orders.map(o => ({ ...o })),
      positions: positions.map(p => ({ ...p })),
      trades: trades.map(t => ({ ...t })),
      tradeNotes: { ...tradeNotes },
      barReviews: Object.fromEntries(
        Object.entries(barReviews).map(([key, value]) => [key, { ...value }])
      ),
      coachFeedbacks: Object.fromEntries(
        Object.entries(coachFeedbacks).map(([key, value]) => [key, { ...value }])
      ),
      mistakes: Object.fromEntries(
        Object.entries(mistakes).map(([key, value]) => [key, { ...value }])
      ),
      selectedTradeId: selectedTradeId.value
    })
  }

  const sessionInfo = computed(() => ({
    name: datasetName.value,
    source: dataSource.value,
    barsCount: allBars.value.length,
    symbol: symbol.value,
    timeframe: timeframe.value,
    message: sessionMessage.value
  }))

  function destroy() {
    stopAutoPlay()
    if (chart) {
      chart.destroy()
      chart = null
      ema20IndicatorId = null
    }
    if (markerRefreshTimer) {
      clearInterval(markerRefreshTimer)
      markerRefreshTimer = null
    }
  }

  return {
    chartReady,
    symbol,
    timeframe,
    sessionInfo,
    sessionMessage,
    dataError,
    isLoadingData,
    timeframeOptions: BTC_TIMEFRAMES,
    initChart,
    destroy,
    importCsvFile,
    loadLatestBtcData,
    setTimeframe,
    resetToMockData,
    saveSession,

    replayIndex,
    replayMax,
    canReplayNext,
    canReplayPrev,
    isAutoPlaying,
    currentBar,
    barCountSettings,
    replayNext,
    replayPrev,
    replayReset,
    startAutoPlay,
    stopAutoPlay,
    updateBarCountSettings,

    activeDrawingTool,
    drawingsCount,
    setDrawingTool,
    setRiskRewardTool,
    clearDrawings,
    setMagnetMode,
    deleteSelectedDrawing,

    account,
    orders,
    positions,
    trades,
    tradeNotes,
    tradeMarkers,
    selectedTrade,
    selectedTradeId,
    barReviews,
    currentReview,
    currentCoachFeedback,
    currentReviewRequestState,
    currentMistake,
    reviewStats,
    sessionReport,
    realizedPnL,
    unrealizedPnL,
    equity,
    openMarketPosition,
    placeLimitOrder,
    placeBreakoutOrder,
    placeStopOrder,
    updateOrderPrice,
    updateAccountSettings,
    resetAccount,
    setTakeProfit,
    setStopLoss,
    removeTPSL,
    cancelOrder,
    cancelAllOrders,
    closePosition,
    closeAllPositions,
    deleteTrade,
    selectTradeForReview,
    updateTradeNote,
    exportReviewData,
    updateCurrentReview,
    clearCurrentReview,
    runCoachForCurrentBar,
    markCurrentMistake,
    unmarkCurrentMistake
  }
}
