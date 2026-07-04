<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { useChart } from './composables/useChart.js'
import ReplayBar from './components/ReplayBar.vue'
import DrawingToolbar from './components/DrawingToolbar.vue'
import TradePanel from './components/TradePanel.vue'
import ReportPanel from './components/ReportPanel.vue'
import TradeMarkersOverlay from './components/TradeMarkersOverlay.vue'
import AiSettingsModal from './components/AiSettingsModal.vue'

const chartContainer = ref(null)

const {
  // 基本
  symbol,
  timeframe,
  sessionInfo,
  timeframeOptions,
  isLoadingData,
  initChart,
  destroy,
  importCsvFile,
  importReviewJsonFile,
  loadLatestBtcData,
  setTimeframe,
  resetToMockData,
  // 回放
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
  // 画线
  activeDrawingTool,
  drawingsCount,
  setDrawingTool,
  setRiskRewardTool,
  clearDrawings,
  setMagnetMode,
  deleteSelectedDrawing,
  // 交易
  account,
  orders,
  positions,
  trades,
  tradeNotes,
  questionedTradeIds,
  tradeFollowUps,
  tradeMarkers,
  currentTrade,
  currentTradeFeedback,
  currentTradeReviewState,
  selectedTrade,
  selectedTradeId,
  tradeReviewStatus,
  currentReview,
  currentCoachFeedback,
  currentReviewRequestState,
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
  markTradeQuestioned,
  askTradeFollowUp,
  exportReviewData,
  runCoachForCurrentBar
} = useChart()

const fileInput = ref(null)
const reviewJsonInput = ref(null)
const importError = ref('')
const activeRightPanel = ref('trade')
const selectedTimeframe = ref(timeframe.value)
const aiSettingsOpen = ref(false)
const panelWidths = ref(readPanelWidths())
const isResizingPanel = ref(false)
const rightPanelWidth = computed(() => panelWidths.value[activeRightPanel.value] || 360)
const mainStyle = computed(() => ({ '--right-panel-width': `${rightPanelWidth.value}px` }))

watch(timeframe, (value) => {
  selectedTimeframe.value = value
})

watch(activeRightPanel, (value) => {
  if (value === 'report' && !selectedTrade.value && trades.length) {
    selectTradeForReview(trades[trades.length - 1].id)
  }
})

onMounted(async () => {
  // 等容器稳定（两次 rAF 确保布局已 commit）
  await nextTick()
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  initChart(chartContainer.value)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('mousemove', onPanelResizeMove)
  window.removeEventListener('mouseup', stopPanelResize)
  destroy()
})

function readPanelWidths() {
  if (typeof window === 'undefined') return { trade: 360, report: 640 }
  try {
    return {
      trade: 360,
      report: 640,
      ...(JSON.parse(window.localStorage.getItem('pa-panel-widths') || '{}') || {})
    }
  } catch (err) {
    return { trade: 360, report: 640 }
  }
}

function savePanelWidths() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem('pa-panel-widths', JSON.stringify(panelWidths.value))
}

function startPanelResize() {
  isResizingPanel.value = true
  window.addEventListener('mousemove', onPanelResizeMove)
  window.addEventListener('mouseup', stopPanelResize)
}

function onPanelResizeMove(event) {
  if (!isResizingPanel.value) return
  const viewportWidth = window.innerWidth || 1280
  const minWidth = activeRightPanel.value === 'report' ? 560 : 320
  const maxWidth = Math.max(minWidth, viewportWidth - 520)
  const nextWidth = Math.min(maxWidth, Math.max(minWidth, viewportWidth - event.clientX - 8))
  panelWidths.value = { ...panelWidths.value, [activeRightPanel.value]: nextWidth }
}

function stopPanelResize() {
  if (!isResizingPanel.value) return
  isResizingPanel.value = false
  savePanelWidths()
  window.removeEventListener('mousemove', onPanelResizeMove)
  window.removeEventListener('mouseup', stopPanelResize)
}

function onKey(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  if (e.code === 'Space') {
    e.preventDefault()
    if (canReplayNext.value) replayNext()
  } else if (e.code === 'ArrowRight') {
    e.preventDefault()
    if (canReplayNext.value) replayNext()
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault()
    if (canReplayPrev.value) replayPrev()
  } else if (e.code === 'KeyR') {
    replayReset()
  } else if (e.code === 'KeyP') {
    if (isAutoPlaying.value) stopAutoPlay()
    else startAutoPlay()
  } else if (e.code === 'Delete' || e.code === 'Backspace') {
    if (deleteSelectedDrawing()) e.preventDefault()
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

function onSelectTrade(tradeId) {
  selectTradeForReview(tradeId)
}

async function onReviewTrade(tradeId) {
  selectTradeForReview(tradeId)
  activeRightPanel.value = 'trade'
  try {
    await runCoachForCurrentBar()
  } catch (err) {
    importError.value = err?.message || 'AI点评失败'
  }
}

async function onReportReviewTrade(tradeId) {
  selectTradeForReview(tradeId)
  activeRightPanel.value = 'report'
  try {
    await runCoachForCurrentBar()
  } catch (err) {
    importError.value = err?.message || 'AI点评失败'
  }
}

async function onRegenerateReview(tradeId) {
  selectTradeForReview(tradeId)
  activeRightPanel.value = 'trade'
  try {
    await runCoachForCurrentBar({ force: true })
  } catch (err) {
    importError.value = err?.message || 'AI点评失败'
  }
}

async function onReportRegenerateReview(tradeId) {
  selectTradeForReview(tradeId)
  activeRightPanel.value = 'report'
  try {
    await runCoachForCurrentBar({ force: true })
  } catch (err) {
    importError.value = err?.message || 'AI点评失败'
  }
}

async function onAskFollowUp(tradeId, question) {
  try {
    await askTradeFollowUp(tradeId, question)
  } catch (err) {
    importError.value = err?.message || 'AI追问失败'
  }
}

function onTradeMarkerSelect(tradeId) {
  activeRightPanel.value = 'report'
  selectTradeForReview(tradeId)
}

async function onTimeframeChange() {
  importError.value = ''
  try {
    await setTimeframe(selectedTimeframe.value)
  } catch (err) {
    importError.value = err?.message || '周期切换失败'
    selectedTimeframe.value = timeframe.value
  }
}

async function onLoadLatestBtc() {
  importError.value = ''
  try {
    await loadLatestBtcData(selectedTimeframe.value, { resetTrading: false })
  } catch (err) {
    importError.value = err?.message || 'BTC最新K线加载失败'
  }
}

function openCsvPicker() {
  fileInput.value?.click()
}

function openReviewJsonPicker() {
  reviewJsonInput.value?.click()
}

async function onCsvSelected(e) {
  const file = e.target.files?.[0]
  if (!file) return
  importError.value = ''
  try {
    await importCsvFile(file)
  } catch (err) {
    importError.value = err?.message || 'CSV导入失败'
  } finally {
    e.target.value = ''
  }
}

async function onReviewJsonSelected(e) {
  const file = e.target.files?.[0]
  if (!file) return
  importError.value = ''
  try {
    await importReviewJsonFile(file)
    activeRightPanel.value = 'report'
  } catch (err) {
    importError.value = err?.message || '复盘JSON导入失败'
  } finally {
    e.target.value = ''
  }
}
</script>

<template>
  <div class="app">
    <!-- 顶部标题栏 -->
    <header class="header">
      <div class="brand">
        <span class="logo">PA</span>
        <span class="name">价格行为复盘训练</span>
        <span class="sym">{{ symbol }} · {{ timeframe }}</span>
        <span class="dataset">{{ sessionInfo.name }} · {{ sessionInfo.barsCount }} bars</span>
      </div>
      <div class="header-actions">
        <input ref="fileInput" class="file-input" type="file" accept=".csv,text/csv" @change="onCsvSelected" />
        <input ref="reviewJsonInput" class="file-input" type="file" accept=".json,application/json" @change="onReviewJsonSelected" />
        <span v-if="importError" class="import-error">{{ importError }}</span>
        <span v-else class="session-msg">{{ sessionInfo.message }}</span>
        <select v-model="selectedTimeframe" :disabled="isLoadingData" @change="onTimeframeChange">
          <option v-for="item in timeframeOptions" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </select>
        <button :disabled="isLoadingData" @click="onLoadLatestBtc">
          {{ isLoadingData ? '加载中...' : '加载BTC最新' }}
        </button>
        <button @click="openCsvPicker">导入CSV</button>
        <button @click="openReviewJsonPicker">导入复盘</button>
        <button @click="resetToMockData">模拟数据</button>
        <button @click="aiSettingsOpen = true">AI设置</button>
      </div>
    </header>

    <AiSettingsModal
      :open="aiSettingsOpen"
      @close="aiSettingsOpen = false"
      @saved="importError = ''"
    />

    <!-- 回放控制条 -->
    <div class="replay-wrap">
      <ReplayBar
        :replay-index="replayIndex"
        :replay-max="replayMax"
        :can-replay-next="canReplayNext"
        :can-replay-prev="canReplayPrev"
        :is-auto-playing="isAutoPlaying"
        :current-bar="currentBar"
        :bar-count-settings="barCountSettings"
        @next="replayNext"
        @prev="replayPrev"
        @reset="replayReset"
        @auto-toggle="onAutoToggle"
        @update-count-settings="updateBarCountSettings"
      />
    </div>

    <!-- 主体布局 -->
    <div
      class="main"
      :style="mainStyle"
      :class="{
        'report-open': activeRightPanel === 'report',
        'trade-review-open': activeRightPanel === 'trade' && currentTrade
      }"
    >
      <!-- 左侧：画线工具 -->
      <aside class="sidebar left">
        <DrawingToolbar
          :active-tool="activeDrawingTool"
          :drawings-count="drawingsCount"
          @select="setDrawingTool"
          @select-position="setRiskRewardTool"
          @clear="clearDrawings"
          @toggle-magnet="setMagnetMode"
        />
      </aside>

      <!-- 中间：图表 -->
      <main class="chart-area">
        <div ref="chartContainer" class="chart"></div>
        <TradeMarkersOverlay
          :markers="tradeMarkers"
          :selected-trade-id="selectedTradeId"
          @select="onTradeMarkerSelect"
        />
      </main>

      <button
        class="panel-resizer"
        aria-label="调整图表和右侧面板宽度"
        @mousedown.prevent="startPanelResize"
      ></button>

      <!-- 右侧：交易面板 -->
      <aside class="sidebar right">
        <div class="right-panel">
          <div class="panel-tabs">
            <button :class="{ active: activeRightPanel === 'trade' }" @click="activeRightPanel = 'trade'">
              交易
            </button>
            <button :class="{ active: activeRightPanel === 'report' }" @click="activeRightPanel = 'report'">
              报告
            </button>
          </div>

          <TradePanel
            v-if="activeRightPanel === 'trade'"
            :account="account"
            :orders="orders"
            :positions="positions"
            :trades="trades"
            :trade-notes="tradeNotes"
            :selected-trade="currentTrade"
            :selected-trade-id="currentTrade?.id || ''"
            :trade-review-status="tradeReviewStatus"
            :trade-follow-ups="tradeFollowUps"
            :feedback="currentTradeFeedback"
            :review-state="currentTradeReviewState"
            :realized="realizedPnL"
            :unrealized="unrealizedPnL"
            :equity="equity"
            :current-bar="currentBar"
            @update-account="updateAccountSettings"
            @reset-account="resetAccount"
            @market-buy="onMarketBuy"
            @market-sell="onMarketSell"
            @limit-order="placeLimitOrder"
            @breakout-order="placeBreakoutOrder"
            @stop-order="placeStopOrder"
            @update-order-price="updateOrderPrice"
            @close-position="closePosition"
            @select-trade="onSelectTrade"
            @review-trade="onReviewTrade"
            @regenerate-review="onRegenerateReview"
            @mark-questioned="markTradeQuestioned"
            @ask-follow-up="onAskFollowUp"
            @update-trade-note="updateTradeNote"
            @delete-trade="deleteTrade"
            @close-all="closeAllPositions"
            @cancel-order="cancelOrder"
            @cancel-all="cancelAllOrders"
            @set-tp="setTakeProfit"
            @set-sl="setStopLoss"
            @remove-tp="(id) => removeTPSL(id, 'tp')"
            @remove-sl="(id) => removeTPSL(id, 'sl')"
          />

          <ReportPanel
            v-else
            :report="sessionReport"
            :trades="trades"
            :trade-review-status="tradeReviewStatus"
            :trade-follow-ups="tradeFollowUps"
            :selected-trade="selectedTrade"
            :selected-trade-id="selectedTradeId"
            :feedback="currentCoachFeedback"
            :review-state="currentReviewRequestState"
            @select-trade="selectTradeForReview"
            @review-trade="onReportReviewTrade"
            @regenerate-review="onReportRegenerateReview"
            @ask-follow-up="onAskFollowUp"
            @delete-trade="deleteTrade"
            @export-reviews="exportReviewData"
          />
        </div>
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
  gap: 12px;
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
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #238636;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
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

.dataset {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #8b949e;
}

.header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.header-actions select {
  height: 32px;
  min-width: 92px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid #30363d;
  background: #0d1117;
  color: #e6edf3;
}

.file-input {
  display: none;
}

.session-msg,
.import-error {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.session-msg {
  color: #8b949e;
}

.import-error {
  color: #f85149;
}

.main {
  display: grid;
  grid-template-columns: 200px minmax(360px, 1fr) 6px minmax(320px, var(--right-panel-width));
  gap: 8px;
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
}

.main.trade-review-open {
  grid-template-columns: 200px minmax(360px, 1fr) 6px minmax(320px, var(--right-panel-width));
}

.main.report-open {
  grid-template-columns: 200px minmax(320px, 1fr) 6px minmax(560px, var(--right-panel-width));
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

.right-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}

.panel-resizer {
  width: 6px;
  min-width: 6px;
  height: 100%;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: #21262d;
  cursor: col-resize;
}

.panel-resizer:hover {
  background: #58a6ff;
}

.panel-tabs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  flex-shrink: 0;
}

.panel-tabs button {
  min-height: 34px;
}

.panel-tabs button.active {
  background: #1f6feb;
  border-color: #1f6feb;
}

.right-panel > :not(.panel-tabs) {
  flex: 1 1 0;
  min-height: 0;
}

.chart-area {
  position: relative;
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

@media (max-width: 1280px) {
  .main.trade-review-open {
    grid-template-columns: 170px minmax(320px, 1fr) 6px minmax(320px, var(--right-panel-width));
  }

  .main.report-open {
    grid-template-columns: 170px minmax(280px, 1fr) 6px minmax(560px, var(--right-panel-width));
  }
}

@media (max-width: 1040px) {
  .main,
  .main.report-open {
    grid-template-columns: 1fr;
  }

  .sidebar.left {
    display: none;
  }

  .sidebar.right {
    min-height: 360px;
  }
}
</style>
