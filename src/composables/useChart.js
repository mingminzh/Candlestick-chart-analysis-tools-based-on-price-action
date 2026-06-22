import { ref, reactive, computed } from 'vue'
import { Chart } from '@mg-exchange/charts'
import { generateMockBars } from '../data/mockData.js'

/**
 * 主 composable - 管理 Chart 实例和整个 demo 的状态
 *
 * 回放机制：
 *   - 一次性生成全部 bars
 *   - 初始用 chart.setData(allBars.slice(0, initialVisible)) 显示一部分
 *   - 提供一个空 datafeed (Chart 构造时必填，但我们不依赖它加载数据)
 *   - 点击"下一根" → chart.updateBar(allBars[replayIndex])
 */
export function useChart() {
  // ---------- 配置 ----------
  const totalBars = 600
  const initialVisible = 200
  const symbol = 'BTCUSDT'
  const timeframe = '1H'

  // ---------- 数据 ----------
  const allBars = generateMockBars({ timeframe, count: totalBars })

  // Datafeed —— 在 chart 构造时 loadInitialData() 会调一次 getBars，
  // 我们返回当前 replayIndex 范围内的 bars。
  // 注意：Chart 构造完成后我们不再依赖 datafeed，回放推进直接用 updateBar。
  const datafeed = {
    async getBars() {
      // 返回 [0..replayIndex] 范围内的初始可见数据
      return allBars.slice(0, initialVisible)
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
        exchange: 'Mock',
        type: 'perpetual',
        pricePrecision: 2,
        qtyPrecision: 4,
        minMove: 0.01
      }
    }
  }

  // ---------- Chart 实例 ----------
  let chart = null
  const chartReady = ref(false)

  // ---------- 回放状态 ----------
  const replayIndex = ref(initialVisible - 1)
  const replayMax = totalBars - 1
  const canReplayNext = computed(() => replayIndex.value < replayMax)
  const isAutoPlaying = ref(false)
  let autoPlayTimer = null

  const currentBar = computed(() => allBars[replayIndex.value] || null)

  // ---------- 画线状态 ----------
  const activeDrawingTool = ref(null)
  const drawingsCount = ref(0)

  // ---------- 交易状态 ----------
  const account = reactive({
    balance: 10000,
    initialBalance: 10000
  })

  const orders = reactive([])
  const positions = reactive([])
  const trades = reactive([])

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

  let orderIdSeq = 1
  let positionIdSeq = 1

  // ---------- Chart 初始化 ----------
  function initChart(container) {
    // 防御性：如果已经有 chart 实例（HMR 或重复挂载），先销毁
    if (chart) {
      try { chart.destroy() } catch (e) {}
      chart = null
    }
    // 防御性：清空容器内可能残留的 canvas（来自旧 Chart 实例）
    while (container.firstChild) container.removeChild(container.firstChild)

    chart = new Chart({
      container,
      symbol,
      timeframe,
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
        { label: `市价买入 @ ${price.toFixed(2)}`, action: 'market-buy' },
        { label: `市价卖出 @ ${price.toFixed(2)}`, action: 'market-sell' },
        { label: `限价买入 @ ${price.toFixed(2)}`, action: 'limit-buy', separator: true },
        { label: `限价卖出 @ ${price.toFixed(2)}`, action: 'limit-sell' },
        { label: `止损单 @ ${price.toFixed(2)}`, action: 'stop-order', separator: true },
        { label: '在此处设置警报', action: 'alert' }
      ]
    })

    chart.on('tradeRequested', ({ side, price, type, action }) => {
      onTradeRequested({ side, price, type, action })
    })

    chart.on('orderLineMoved', ({ id, price }) => {
      const order = orders.find(o => o.id === id)
      if (order && order.status === 'pending') {
        const newPrice = +price.toFixed(2)
        order.price = newPrice
        // 同步回持仓上的 tp / sl 字段
        if (order.type === 'tp' || order.type === 'sl') {
          const pos = positions.find(p => p.id === order.positionId)
          if (pos) {
            if (order.type === 'tp') pos.tp = newPrice
            else pos.sl = newPrice
            chart.updateOrderLine(id, { price: newPrice, label: `${order.type === 'tp' ? '止盈' : '止损'} ${order.quantity}` })
          }
        } else {
          chart.updateOrderLine(id, { price: newPrice, label: orderLabel(order) })
        }
      }
    })

    chart.on('drawingAdded', () => {
      drawingsCount.value = chart.getDrawings().length
      activeDrawingTool.value = null
    })
    chart.on('drawingRemoved', () => {
      drawingsCount.value = chart.getDrawings().length
    })

    chartReady.value = true
  }

  // ---------- 回放控制 ----------
  function replayNext() {
    if (!canReplayNext.value || !chart) return
    replayIndex.value += 1
    chart.updateBar(allBars[replayIndex.value])
    matchPendingOrders()
    refreshPositionOverlays()
  }

  function replayReset() {
    if (!chart) return
    stopAutoPlay()
    replayIndex.value = initialVisible - 1
    chart.setData(allBars.slice(0, initialVisible))
    refreshPositionOverlays()
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

  function clearDrawings() {
    if (!chart) return
    chart.clearDrawings()
    drawingsCount.value = 0
  }

  function setMagnetMode(enabled) {
    chart?.setMagnetMode(enabled)
  }

  // ---------- 交易：右键/+ 按钮触发 ----------
  function onTradeRequested({ side, price, type, action }) {
    const a = action || `${type}-${side}`
    switch (a) {
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
    return 0.05
  }

  function orderLabel(order) {
    const sideTxt = order.side === 'buy' ? '买' : '卖'
    const typeTxt = order.type === 'limit' ? '限价' : '止损'
    return `${typeTxt}${sideTxt} ${order.quantity}`
  }

  function openMarketPosition(side, qty = defaultQty()) {
    if (!currentBar.value) return
    const entryPrice = currentBar.value.close
    const id = `pos-${positionIdSeq++}`
    positions.push({
      id,
      side,
      entryPrice,
      quantity: qty,
      openTime: currentBar.value.time
    })
    refreshPositionOverlays()
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
    chart?.addOrderLine({
      id,
      price: order.price,
      type: 'limit',
      side,
      label: orderLabel(order),
      quantity: qty
    })
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
    chart?.addOrderLine({
      id,
      price: order.price,
      type: 'stop',
      side,
      label: orderLabel(order),
      quantity: qty
    })
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
    chart?.addOrderLine({
      id,
      price: order.price,
      type: 'tp',
      side: order.side,
      label: `止盈 ${pos.quantity}`,
      quantity: pos.quantity
    })
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
    chart?.addOrderLine({
      id,
      price: order.price,
      type: 'sl',
      side: order.side,
      label: `止损 ${pos.quantity}`,
      quantity: pos.quantity
    })
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
  }

  function cancelOrder(orderId) {
    const idx = orders.findIndex(o => o.id === orderId)
    if (idx === -1) return
    orders.splice(idx, 1)
    chart?.removeOrderLine(orderId)
  }

  function closePosition(positionId, closePriceOverride) {
    const idx = positions.findIndex(p => p.id === positionId)
    if (idx === -1) return
    const p = positions[idx]
    const closePrice = closePriceOverride ?? currentBar.value?.close ?? p.entryPrice
    const dir = p.side === 'long' ? 1 : -1
    const pnl = (closePrice - p.entryPrice) * p.quantity * dir
    account.balance += pnl
    trades.push({
      id: `trade-${trades.length + 1}`,
      side: p.side,
      entryPrice: p.entryPrice,
      closePrice,
      quantity: p.quantity,
      pnl,
      openTime: p.openTime,
      closeTime: currentBar.value?.time,
      exitReason: p.exitReason || 'manual'
    })
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
      } else if (order.type === 'stop') {
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
    positions.push({
      id,
      side,
      entryPrice: price,
      quantity: qty,
      openTime: currentBar.value?.time
    })
    refreshPositionOverlays()
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

  function destroy() {
    stopAutoPlay()
    if (chart) {
      chart.destroy()
      chart = null
    }
  }

  return {
    chartReady,
    symbol,
    timeframe,
    initChart,
    destroy,

    replayIndex,
    replayMax,
    canReplayNext,
    isAutoPlaying,
    currentBar,
    replayNext,
    replayReset,
    startAutoPlay,
    stopAutoPlay,

    activeDrawingTool,
    drawingsCount,
    setDrawingTool,
    clearDrawings,
    setMagnetMode,

    account,
    orders,
    positions,
    trades,
    realizedPnL,
    unrealizedPnL,
    equity,
    openMarketPosition,
    placeLimitOrder,
    placeStopOrder,
    setTakeProfit,
    setStopLoss,
    removeTPSL,
    cancelOrder,
    cancelAllOrders,
    closePosition,
    closeAllPositions
  }
}
