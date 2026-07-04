<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  report: { type: Object, required: true },
  trades: { type: Array, default: () => [] },
  tradeReviewStatus: { type: Object, default: () => ({}) },
  tradeFollowUps: { type: Object, default: () => ({}) },
  selectedTrade: { type: Object, default: null },
  selectedTradeId: { type: String, default: '' },
  feedback: { type: Object, default: null },
  reviewState: { type: Object, default: () => ({ loading: false, error: '' }) }
})

const emit = defineEmits(['export-reviews', 'select-trade', 'review-trade', 'regenerate-review', 'ask-follow-up', 'delete-trade'])
const tradeSearch = ref('')
const directionFilter = ref('all')
const resultFilter = ref('all')
const archiveFilter = ref('all')
const followUpText = ref('')
const isListening = ref(false)
let recognition = null

const speechSupported = computed(() => {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
})

const mainMetrics = computed(() => [
  { label: '完成交易', value: props.report.tradeStats.total },
  { label: '胜率', value: pct(props.report.tradeStats.winRate) },
  { label: '总盈亏', value: money(props.report.tradeStats.totalPnl), tone: pnlTone(props.report.tradeStats.totalPnl) },
  { label: '盈亏因子', value: props.report.tradeStats.profitFactor === Infinity ? '∞' : fmt(props.report.tradeStats.profitFactor) },
  { label: '平均盈亏', value: money(props.report.tradeStats.avgPnl), tone: pnlTone(props.report.tradeStats.avgPnl) },
  { label: '错误标签', value: sortedEntries(props.report.mistakeTagStats).length }
])

const sortedTrades = computed(() => props.trades.slice().reverse())
const filteredTrades = computed(() => {
  const keyword = tradeSearch.value.trim().toLowerCase()
  return sortedTrades.value.filter((trade) => {
    const status = reviewStatusFor(trade.id)
    if (directionFilter.value !== 'all' && trade.side !== directionFilter.value) return false
    if (resultFilter.value === 'win' && Number(trade.pnl || 0) <= 0) return false
    if (resultFilter.value === 'loss' && Number(trade.pnl || 0) >= 0) return false
    if (archiveFilter.value === 'questioned' && !status.questioned) return false
    if (archiveFilter.value === 'reviewed' && !status.reviewed) return false
    if (!keyword) return true
    return [
      trade.id,
      trade.side === 'long' ? '多 long 做多' : '空 short 做空',
      trade.exitReason,
      fmt(trade.entryPrice),
      fmt(trade.closePrice),
      fmt(trade.pnl),
      status.questioned ? '疑问' : '',
      status.reviewed ? '已点评 reviewed' : '',
      ...(status.mistakeTags || [])
    ].filter(Boolean).join(' ').toLowerCase().includes(keyword)
  })
})

const scoreEntries = computed(() => {
  const scores = props.feedback?.scores || {}
  return [
    ['背景', scores.context],
    ['Setup', scores.setup],
    ['管理', scores.management],
    ['纪律', scores.discipline],
    ['总分', scores.total ?? props.feedback?.score]
  ].filter(([, value]) => value !== undefined && value !== null && value !== '')
})
const topMistakeTags = computed(() => sortedEntries(props.report.mistakeTagStats).slice(0, 3))

function pct(value) {
  if (!Number.isFinite(value)) return '-'
  return `${(value * 100).toFixed(1)}%`
}

function money(value) {
  if (!Number.isFinite(Number(value))) return '-'
  return `$${Number(value).toFixed(2)}`
}

function pnlTone(value) {
  return Number(value) > 0 ? 'pos' : Number(value) < 0 ? 'neg' : ''
}

function fmt(value, dp = 2) {
  if (!Number.isFinite(Number(value))) return '-'
  return Number(value).toFixed(dp)
}

function fmtTime(time) {
  if (!time) return '-'
  const d = new Date(time * 1000)
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${mo}-${dd} ${hh}:${mm}`
}

function sortedEntries(obj) {
  return Object.entries(obj || {})
    .filter(([, value]) => (typeof value === 'number' ? value : value?.count || 0) > 0)
    .sort((a, b) => {
      const av = typeof a[1] === 'number' ? a[1] : a[1]?.count || 0
      const bv = typeof b[1] === 'number' ? b[1] : b[1]?.count || 0
      return bv - av
    })
}

function reviewStatusFor(tradeId) {
  return props.tradeReviewStatus[tradeId] || { reviewed: false, questioned: false, score: null, mistakeTags: [] }
}

function submitFollowUp() {
  const text = followUpText.value.trim()
  if (!props.selectedTrade?.id || !text) return
  emit('ask-follow-up', props.selectedTrade.id, text)
  followUpText.value = ''
}

function startFollowUpVoice() {
  if (!props.selectedTrade?.id || !speechSupported.value) return
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  recognition?.stop?.()
  recognition = new SpeechRecognition()
  recognition.lang = 'zh-CN'
  recognition.interimResults = true
  recognition.continuous = false
  const baseText = followUpText.value
  recognition.onstart = () => {
    isListening.value = true
  }
  recognition.onresult = (event) => {
    let finalText = ''
    let interimText = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0]?.transcript || ''
      if (event.results[i].isFinal) finalText += text
      else interimText += text
    }
    const prefix = baseText ? `${baseText}\n` : ''
    followUpText.value = `${prefix}${finalText || interimText}`.trim()
  }
  recognition.onend = () => {
    isListening.value = false
  }
  recognition.onerror = () => {
    isListening.value = false
  }
  recognition.start()
}
</script>

<template>
  <div class="report-panel">
    <div class="section head">
      <div>
        <div class="title">会话报告</div>
        <div class="sub">{{ report.totalVisibleBars }} / {{ report.totalBars }} 根已显示</div>
      </div>
      <div class="head-actions">
        <button class="mini" @click="emit('export-reviews')">导出JSON</button>
        <div class="pill">{{ report.openPositions }} 持仓 · {{ report.pendingOrders }} 委托</div>
      </div>
    </div>

    <div class="metrics">
      <div v-for="item in mainMetrics" :key="item.label" class="metric">
        <span>{{ item.label }}</span>
        <b :class="item.tone">{{ item.value }}</b>
      </div>
    </div>

    <div class="compact-report">
      <div class="compact-block">
        <span>交易结果</span>
        <b class="pos">盈 {{ report.tradeStats.wins }}</b>
        <b class="neg">亏 {{ report.tradeStats.losses }}</b>
        <b>保 {{ report.tradeStats.breakeven }}</b>
      </div>
      <div class="compact-block wide">
        <span>AI错误标签</span>
        <template v-if="topMistakeTags.length">
          <b v-for="[name, stat] in topMistakeTags" :key="name" class="compact-tag">
            {{ name }} · {{ stat.count }}
          </b>
        </template>
        <b v-else>暂无</b>
      </div>
    </div>

    <div class="archive">
      <div class="archive-list">
        <div class="title">历史订单</div>
        <div class="history-tools">
          <input v-model="tradeSearch" type="search" placeholder="搜索方向、价格、盈亏、标签" />
          <span>{{ filteredTrades.length }} 笔</span>
        </div>
        <div class="history-filters">
          <select v-model="directionFilter">
            <option value="all">全部方向</option>
            <option value="long">只看多单</option>
            <option value="short">只看空单</option>
          </select>
          <select v-model="resultFilter">
            <option value="all">全部结果</option>
            <option value="win">只看盈利</option>
            <option value="loss">只看亏损</option>
          </select>
          <select v-model="archiveFilter">
            <option value="all">全部档案</option>
            <option value="questioned">疑问单</option>
            <option value="reviewed">已点评</option>
          </select>
        </div>
        <div v-if="!filteredTrades.length" class="empty">暂无匹配订单</div>
        <div v-else class="trade-list archive-trades">
          <button
            v-for="trade in filteredTrades"
            :key="trade.id"
            :class="['archive-trade', { selected: selectedTradeId === trade.id }]"
            @click="emit('select-trade', trade.id)"
          >
            <span :class="['side-chip', trade.side]">{{ trade.side === 'long' ? '多' : '空' }}</span>
            <span class="archive-price">{{ fmt(trade.entryPrice) }} → {{ fmt(trade.closePrice) }}</span>
            <b :class="pnlTone(trade.pnl)">{{ money(trade.pnl) }}</b>
            <em>{{ fmtTime(trade.closeTime) }}</em>
            <small>
              <span v-if="reviewStatusFor(trade.id).questioned">疑问</span>
              <span v-if="reviewStatusFor(trade.id).reviewed">已点评</span>
              <span v-if="reviewStatusFor(trade.id).score !== null">评分 {{ fmt(reviewStatusFor(trade.id).score, 0) }}</span>
            </small>
          </button>
        </div>
      </div>

      <div class="archive-detail">
        <div v-if="!selectedTrade" class="empty">选择一笔历史订单查看复盘档案</div>
        <template v-else>
          <div class="detail-head">
            <div>
              <div class="title">复盘档案</div>
              <div class="sub">
                {{ selectedTrade.side === 'long' ? '多单' : '空单' }}
                {{ fmt(selectedTrade.entryPrice) }} → {{ fmt(selectedTrade.closePrice) }}
                · {{ fmtTime(selectedTrade.closeTime) }}
              </div>
            </div>
            <div class="head-actions">
              <div class="pill" :class="pnlTone(selectedTrade.pnl)">{{ money(selectedTrade.pnl) }}</div>
              <div v-if="reviewStatusFor(selectedTrade.id).questioned" class="pill">疑问单</div>
            </div>
          </div>

          <div class="trade-summary">
            <div><span>数量</span><b>{{ fmt(selectedTrade.quantity, 4) }}</b></div>
            <div><span>入场金额</span><b>{{ money(selectedTrade.notional) }}</b></div>
            <div><span>出场原因</span><b>{{ selectedTrade.exitReason || 'manual' }}</b></div>
            <div><span>点评状态</span><b>{{ reviewStatusFor(selectedTrade.id).reviewed ? '已点评' : '未点评' }}</b></div>
          </div>

          <div class="detail-actions">
            <button class="mini primary" :disabled="reviewState.loading" @click="emit('review-trade', selectedTrade.id)">
              {{ reviewState.loading ? '点评中…' : reviewStatusFor(selectedTrade.id).reviewed ? '查看点评' : 'AI点评' }}
            </button>
            <button class="mini" :disabled="reviewState.loading" @click="emit('regenerate-review', selectedTrade.id)">重新点评</button>
            <button class="mini danger" @click="emit('delete-trade', selectedTrade.id)">删除订单</button>
          </div>

          <div v-if="reviewState.loading" class="review-progress">
            <div class="progress-head"><span>AI正在分析</span><span>请求中</span></div>
            <div class="progress-bar"><span></span></div>
          </div>
          <div v-else-if="reviewState.error" class="review-error">{{ reviewState.error }}</div>

          <div v-if="feedback && feedback.payloadPreview?.selectedTradeId === selectedTrade.id" class="review-content">
            <div class="review-summary"><span>结论</span>{{ feedback.summary }}</div>
            <div v-if="feedback.keyWrongAssumption" class="review-card warn-card">
              <div class="review-title">关键错误假设</div>
              <p><strong>{{ feedback.keyWrongAssumption.title }}</strong></p>
              <p>{{ feedback.keyWrongAssumption.detail }}</p>
            </div>
            <div v-if="scoreEntries.length" class="score-grid">
              <div v-for="[name, value] in scoreEntries" :key="name" class="score-box">
                <span>{{ name }}</span><b>{{ fmt(value, 0) }}</b>
              </div>
            </div>
            <div v-if="feedback.evidence?.length" class="review-card">
              <div class="review-title">证据链</div>
              <ul>
                <li v-for="item in feedback.evidence" :key="item.ref + item.point">
                  <strong>{{ item.ref }}</strong>: {{ item.point }}
                </li>
              </ul>
            </div>
            <div v-if="feedback.ruleRefs?.length || feedback.mistakeTags?.length" class="tag-panel">
              <div v-if="feedback.ruleRefs?.length" class="tag-row">
                <span>规则引用</span>
                <b v-for="item in feedback.ruleRefs" :key="item">{{ item }}</b>
              </div>
              <div v-if="feedback.mistakeTags?.length" class="tag-row danger-tags">
                <span>错误标签</span>
                <b v-for="item in feedback.mistakeTags" :key="item">{{ item }}</b>
              </div>
            </div>
            <div v-if="feedback.sections?.length" class="review-sections">
              <div v-for="section in feedback.sections" :key="section.title" class="review-card">
                <div class="review-title">{{ section.title }}</div>
                <p v-if="section.body">{{ section.body }}</p>
                <ul v-if="section.items?.length">
                  <li v-for="item in section.items" :key="item">{{ item }}</li>
                </ul>
              </div>
            </div>
          </div>
          <div v-else class="empty">这笔订单还没有AI点评</div>

          <div class="followup-box">
            <div class="review-title">追问</div>
            <div v-if="tradeFollowUps[selectedTrade.id]?.length" class="followup-list">
              <div v-for="item in tradeFollowUps[selectedTrade.id]" :key="item.id" class="followup-item">
                <p><strong>问：</strong>{{ item.question }}</p>
                <p><strong>答：</strong>{{ item.answer }}</p>
              </div>
            </div>
            <textarea v-model="followUpText" placeholder="继续追问这笔单，例如：这是不是区间中部追单？"></textarea>
            <div class="followup-actions">
              <button class="mini" :disabled="!speechSupported" @click="startFollowUpVoice">
                {{ isListening ? '听写中…' : '语音追问' }}
              </button>
              <button class="mini primary" @click="submitFollowUp">发送追问</button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.report-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  container-type: inline-size;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.head {
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-start;
}

.head-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
  flex-shrink: 0;
}

.title {
  font-size: 12px;
  font-weight: 600;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.sub {
  margin-top: 4px;
  font-size: 12px;
  color: #c9d1d9;
}

.pill {
  padding: 4px 8px;
  border-radius: 6px;
  background: #0d1117;
  border: 1px solid #30363d;
  color: #8b949e;
  font-size: 12px;
}

.mini {
  min-height: 24px;
  padding: 3px 8px;
  font-size: 11px;
}

.metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.metric,
.trade-summary div,
.row,
.trade-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.metric,
.trade-summary div {
  padding: 8px;
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 6px;
}

.metric span,
.trade-summary span,
.dist span {
  color: #8b949e;
  font-size: 12px;
}

.metric b,
.trade-summary b,
.row b,
.trade-row b {
  color: #e6edf3;
  font-variant-numeric: tabular-nums;
}

.pos {
  color: #26a69a !important;
}

.neg {
  color: #ef5350 !important;
}

.dist-group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.dist {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.row {
  gap: 8px;
  padding: 6px 8px;
  background: #0d1117;
  border-radius: 6px;
  font-size: 12px;
}

.row em,
.trade-row em {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #c9d1d9;
  font-style: normal;
}

.trade-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.compact-report {
  display: grid;
  grid-template-columns: minmax(180px, auto) minmax(0, 1fr);
  gap: 8px;
}

.compact-block {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 6px;
  background: #0d1117;
  border: 1px solid #21262d;
}

.compact-block span {
  flex-shrink: 0;
  color: #8b949e;
  font-size: 11px;
  font-weight: 700;
}

.compact-block b {
  min-width: 0;
  color: #c9d1d9;
  font-size: 11px;
  font-weight: 600;
}

.compact-tag {
  max-width: 180px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(88, 166, 255, 0.1);
  border: 1px solid rgba(88, 166, 255, 0.22);
  color: #79c0ff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  font-size: 12px;
  color: #6e7681;
  text-align: center;
  padding: 12px;
  font-style: italic;
}

.trade-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.archive {
  display: grid;
  grid-template-columns: minmax(220px, 0.9fr) minmax(360px, 1.6fr);
  gap: 12px;
  min-height: 520px;
}

.archive-list,
.archive-detail {
  min-width: 0;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #30363d;
  background: #0d1117;
  overflow: auto;
}

.archive-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-tools {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}

.history-tools input,
.history-filters select {
  min-width: 0;
  height: 30px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid #30363d;
  background: #161b22;
  color: #e6edf3;
  font-size: 12px;
}

.history-tools span {
  color: #8b949e;
  font-size: 11px;
}

.history-filters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.archive-trades {
  margin-top: 8px;
}

.archive-trade {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 5px 8px;
  width: 100%;
  padding: 8px;
  text-align: left;
  border-radius: 6px;
  border: 1px solid #21262d;
  background: #161b22;
  color: #c9d1d9;
}

.archive-trade.selected {
  border-color: #58a6ff;
  box-shadow: inset 3px 0 0 #1f6feb;
}

.archive-trade em,
.archive-trade small {
  grid-column: 2 / 4;
  color: #8b949e;
  font-size: 11px;
}

.archive-trade small {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.archive-trade small span,
.side-chip {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  background: rgba(88, 166, 255, 0.12);
  color: #79c0ff;
}

.side-chip.long {
  background: rgba(38, 166, 154, 0.16);
  color: #26a69a;
}

.side-chip.short {
  background: rgba(239, 83, 80, 0.16);
  color: #ef5350;
}

.archive-price {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.detail-head,
.detail-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.detail-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.review-content,
.review-sections,
.followup-box,
.followup-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.review-summary,
.review-card,
.tag-panel,
.followup-box {
  padding: 10px 12px;
  border-radius: 6px;
  background: #161b22;
  border-left: 3px solid #58a6ff;
  color: #c9d1d9;
  font-size: 13px;
  line-height: 1.7;
}

.review-summary span,
.review-title {
  display: block;
  margin-bottom: 4px;
  color: #58a6ff;
  font-size: 12px;
  font-weight: 700;
}

.warn-card {
  border-left-color: #d29922;
}

.score-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}

.score-box {
  padding: 7px 6px;
  border-radius: 5px;
  background: #161b22;
  border: 1px solid #30363d;
  text-align: center;
}

.score-box span {
  display: block;
  color: #8b949e;
  font-size: 10px;
}

.score-box b {
  display: block;
  margin-top: 3px;
  color: #e6edf3;
}

.tag-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}

.tag-row span {
  width: 52px;
  color: #8b949e;
  font-size: 11px;
}

.tag-row b {
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(88, 166, 255, 0.12);
  color: #79c0ff;
  border: 1px solid rgba(88, 166, 255, 0.25);
  font-size: 11px;
}

.danger-tags b {
  background: rgba(239, 83, 80, 0.1);
  color: #ffb4ad;
  border-color: rgba(239, 83, 80, 0.25);
}

.followup-box textarea {
  min-height: 70px;
  width: 100%;
  resize: vertical;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #30363d;
  background: #0d1117;
  color: #e6edf3;
  font-size: 12px;
  line-height: 1.5;
}

.followup-item {
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #30363d;
  background: #0d1117;
}

.followup-item p {
  margin: 0;
}

.followup-item p + p {
  margin-top: 5px;
}

.followup-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.review-progress,
.review-error {
  padding: 8px;
  border-radius: 6px;
  background: rgba(88, 166, 255, 0.08);
  border: 1px solid rgba(88, 166, 255, 0.24);
  color: #c9d1d9;
}

.review-error {
  background: rgba(239, 83, 80, 0.1);
  border-color: rgba(239, 83, 80, 0.28);
  color: #ffb4ad;
}

.progress-head {
  display: flex;
  justify-content: space-between;
  color: #58a6ff;
  font-size: 12px;
  font-weight: 700;
}

.progress-bar {
  position: relative;
  height: 4px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(88, 166, 255, 0.18);
}

.progress-bar span {
  position: absolute;
  inset: 0 auto 0 0;
  width: 38%;
  border-radius: inherit;
  background: #58a6ff;
  animation: review-progress 1.1s ease-in-out infinite;
}

@keyframes review-progress {
  0% {
    transform: translateX(-110%);
  }
  55% {
    transform: translateX(95%);
  }
  100% {
    transform: translateX(260%);
  }
}

.trade-row {
  padding: 8px;
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 6px;
  font-size: 12px;
}

.trade-row div {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.trade-row span {
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.trade-row span.long {
  color: #26a69a;
  background: rgba(38, 166, 154, 0.12);
}

.trade-row span.short {
  color: #ef5350;
  background: rgba(239, 83, 80, 0.12);
}

@container (min-width: 500px) {
  .report-panel {
    padding: 14px;
  }

  .metrics {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .trade-summary {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .tag-row,
  .trade-row,
  .row {
    padding: 9px 10px;
  }
}

@container (min-width: 680px) {
  .report-panel {
    gap: 14px;
  }

  .section {
    gap: 10px;
  }

  .metrics {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .title {
    font-size: 13px;
  }
}
</style>
