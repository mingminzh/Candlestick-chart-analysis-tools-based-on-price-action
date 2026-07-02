<script setup>
import { computed } from 'vue'

const props = defineProps({
  report: { type: Object, required: true }
})

const emit = defineEmits(['export-reviews'])

const mainMetrics = computed(() => [
  { label: '已判读K线', value: props.report.reviewedBars },
  { label: '判读覆盖', value: pct(props.report.reviewRate) },
  { label: '错题数量', value: props.report.mistakeCount },
  { label: '完成交易', value: props.report.tradeStats.total },
  { label: '胜率', value: pct(props.report.tradeStats.winRate) },
  { label: '总盈亏', value: money(props.report.tradeStats.totalPnl), tone: pnlTone(props.report.tradeStats.totalPnl) },
  { label: '平均盈亏', value: money(props.report.tradeStats.avgPnl), tone: pnlTone(props.report.tradeStats.avgPnl) }
])

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

    <div class="section">
      <div class="title">判断分布</div>
      <div class="dist-group">
        <div class="dist">
          <span>交易计划</span>
          <div v-for="[name, count] in sortedEntries(report.reviewStats.tradePlans)" :key="name" class="row">
            <em>{{ name }}</em><b>{{ count }}</b>
          </div>
        </div>
        <div class="dist">
          <span>市场状态</span>
          <div v-for="[name, count] in sortedEntries(report.reviewStats.marketStates)" :key="name" class="row">
            <em>{{ name }}</em><b>{{ count }}</b>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="title">交易结果</div>
      <div class="trade-summary">
        <div><span>盈利</span><b class="pos">{{ report.tradeStats.wins }}</b></div>
        <div><span>亏损</span><b class="neg">{{ report.tradeStats.losses }}</b></div>
        <div><span>保本</span><b>{{ report.tradeStats.breakeven }}</b></div>
        <div>
          <span>盈亏因子</span>
          <b>{{ report.tradeStats.profitFactor === Infinity ? '∞' : fmt(report.tradeStats.profitFactor) }}</b>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="title">AI错误标签</div>
      <div v-if="!sortedEntries(report.mistakeTagStats).length" class="empty">暂无AI错误标签</div>
      <div v-else class="tag-stats">
        <div v-for="[name, stat] in sortedEntries(report.mistakeTagStats)" :key="name" class="tag-row">
          <div>
            <b>{{ name }}</b>
            <span>{{ stat.count }} 次 · 盈 {{ stat.wins }} / 亏 {{ stat.losses }}</span>
          </div>
          <em :class="pnlTone(stat.totalPnl)">{{ money(stat.totalPnl) }}</em>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="title">最近成交</div>
      <div v-if="!report.recentTrades.length" class="empty">暂无成交记录</div>
      <div v-else class="trade-list">
        <div v-for="trade in report.recentTrades" :key="trade.id" class="trade-row">
          <div>
            <span :class="trade.side">{{ trade.side === 'long' ? '多' : '空' }}</span>
            <em>{{ fmtTime(trade.closeTime) }}</em>
          </div>
          <b :class="pnlTone(trade.pnl)">{{ money(trade.pnl) }}</b>
        </div>
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

.tag-stats {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tag-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 6px;
}

.tag-row div {
  min-width: 0;
}

.tag-row b,
.tag-row span {
  display: block;
}

.tag-row b {
  color: #e6edf3;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-row span {
  margin-top: 3px;
  color: #8b949e;
  font-size: 11px;
}

.tag-row em {
  flex-shrink: 0;
  color: #c9d1d9;
  font-size: 12px;
  font-style: normal;
  font-variant-numeric: tabular-nums;
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
</style>
