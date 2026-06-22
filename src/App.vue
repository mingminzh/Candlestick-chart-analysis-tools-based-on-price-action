<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useChart } from './composables/useChart.js'
import ReplayBar from './components/ReplayBar.vue'
import DrawingToolbar from './components/DrawingToolbar.vue'
import TradePanel from './components/TradePanel.vue'

const chartContainer = ref(null)

const {
  // 基本
  symbol,
  timeframe,
  initChart,
  destroy,
  // 回放
  replayIndex,
  replayMax,
  canReplayNext,
  isAutoPlaying,
  currentBar,
  replayNext,
  replayReset,
  startAutoPlay,
  stopAutoPlay,
  // 画线
  activeDrawingTool,
  drawingsCount,
  setDrawingTool,
  clearDrawings,
  setMagnetMode,
  // 交易
  account,
  orders,
  positions,
  trades,
  realizedPnL,
  unrealizedPnL,
  equity,
  openMarketPosition,
  setTakeProfit,
  setStopLoss,
  removeTPSL,
  cancelOrder,
  cancelAllOrders,
  closePosition,
  closeAllPositions
} = useChart()

onMounted(async () => {
  // 等容器稳定（两次 rAF 确保布局已 commit）
  await nextTick()
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  initChart(chartContainer.value)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  destroy()
})

function onKey(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  if (e.code === 'Space') {
    e.preventDefault()
    if (canReplayNext.value) replayNext()
  } else if (e.code === 'KeyR') {
    replayReset()
  } else if (e.code === 'KeyP') {
    if (isAutoPlaying.value) stopAutoPlay()
    else startAutoPlay()
  }
}

function onAutoToggle() {
  if (isAutoPlaying.value) stopAutoPlay()
  else startAutoPlay()
}

function onMarketBuy() {
  openMarketPosition('long')
}
function onMarketSell() {
  openMarketPosition('short')
}
</script>

<template>
  <div class="app">
    <!-- 顶部标题栏 -->
    <header class="header">
      <div class="brand">
        <span class="logo">📈</span>
        <span class="name">K线回放交易 Demo</span>
        <span class="sym">{{ symbol }} · {{ timeframe }}</span>
      </div>
      <div class="shortcuts">
        <kbd>Space</kbd> 下一根 ·
        <kbd>P</kbd> 自动播放 ·
        <kbd>R</kbd> 重置 ·
        <kbd>右键</kbd> 画线下单
      </div>
    </header>

    <!-- 回放控制条 -->
    <div class="replay-wrap">
      <ReplayBar
        :replay-index="replayIndex"
        :replay-max="replayMax"
        :can-replay-next="canReplayNext"
        :is-auto-playing="isAutoPlaying"
        :current-bar="currentBar"
        @next="replayNext"
        @reset="replayReset"
        @auto-toggle="onAutoToggle"
      />
    </div>

    <!-- 主体布局 -->
    <div class="main">
      <!-- 左侧：画线工具 -->
      <aside class="sidebar left">
        <DrawingToolbar
          :active-tool="activeDrawingTool"
          :drawings-count="drawingsCount"
          @select="setDrawingTool"
          @clear="clearDrawings"
          @toggle-magnet="setMagnetMode"
        />
      </aside>

      <!-- 中间：图表 -->
      <main class="chart-area">
        <div ref="chartContainer" class="chart"></div>
      </main>

      <!-- 右侧：交易面板 -->
      <aside class="sidebar right">
        <TradePanel
          :account="account"
          :orders="orders"
          :positions="positions"
          :trades="trades"
          :realized="realizedPnL"
          :unrealized="unrealizedPnL"
          :equity="equity"
          :current-bar="currentBar"
          @market-buy="onMarketBuy"
          @market-sell="onMarketSell"
          @close-position="closePosition"
          @close-all="closeAllPositions"
          @cancel-order="cancelOrder"
          @cancel-all="cancelAllOrders"
          @set-tp="setTakeProfit"
          @set-sl="setStopLoss"
          @remove-tp="(id) => removeTPSL(id, 'tp')"
          @remove-sl="(id) => removeTPSL(id, 'sl')"
        />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  gap: 8px;
  padding: 8px;
}

.header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
}

.replay-wrap {
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo {
  font-size: 20px;
}

.name {
  font-weight: 600;
  font-size: 15px;
  color: #e6edf3;
}

.sym {
  margin-left: 10px;
  padding: 3px 10px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 12px;
  font-size: 12px;
  color: #58a6ff;
  font-variant-numeric: tabular-nums;
}

.shortcuts {
  font-size: 12px;
  color: #8b949e;
}

.shortcuts kbd {
  display: inline-block;
  padding: 1px 6px;
  margin: 0 2px;
  background: #21262d;
  border: 1px solid #30363d;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: #c9d1d9;
}

.main {
  display: grid;
  grid-template-columns: 200px 1fr 320px;
  gap: 8px;
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
}

.sidebar {
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.sidebar.left {
  display: flex;
}

.sidebar.left > * {
  flex: 1;
}

.chart-area {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
  display: flex;
}

.chart {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  position: relative;
}
</style>
