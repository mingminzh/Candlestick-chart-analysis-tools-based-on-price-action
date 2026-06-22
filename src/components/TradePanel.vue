<script setup>
import { ref, computed, defineProps, defineEmits } from 'vue'

const props = defineProps({
  account: { type: Object, required: true },
  orders: { type: Array, required: true },
  positions: { type: Array, required: true },
  trades: { type: Array, required: true },
  realized: { type: Number, required: true },
  unrealized: { type: Number, required: true },
  equity: { type: Number, required: true },
  currentBar: { type: Object, default: null }
})

const emit = defineEmits([
  'market-buy',
  'market-sell',
  'close-position',
  'close-all',
  'cancel-order',
  'cancel-all',
  'set-tp',
  'set-sl',
  'remove-tp',
  'remove-sl'
])

const currentPrice = computed(() => props.currentBar?.close?.toFixed(2) ?? '-')
const pnlClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '')

function fmt(v, dp = 2) {
  if (v === undefined || v === null || isNaN(v)) return '-'
  return Number(v).toFixed(dp)
}

function fmtTime(time) {
  if (!time) return '-'
  const d = new Date(time * 1000)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const day = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
  return `${day} ${hh}:${mm}`
}

function positionPnL(p) {
  if (!props.currentBar) return 0
  const dir = p.side === 'long' ? 1 : -1
  return (props.currentBar.close - p.entryPrice) * p.quantity * dir
}

// 给定当前价/方向，建议默认 TP / SL 价 (偏离 1%)
function suggestTPSL(p) {
  if (!props.currentBar) return { tp: '', sl: '' }
  const price = props.currentBar.close
  const offset = price * 0.01
  if (p.side === 'long') return { tp: fmt(price + offset), sl: fmt(price - offset) }
  return { tp: fmt(price - offset), sl: fmt(price + offset) }
}

// 每个持仓上的 TP/SL 临时输入值
const tpslInputs = ref({})
function getInput(posId, kind) {
  if (!tpslInputs.value[posId]) {
    const pos = props.positions.find(p => p.id === posId)
    tpslInputs.value[posId] = suggestTPSL(pos)
  }
  return tpslInputs.value[posId][kind]
}
function setInput(posId, kind, v) {
  if (!tpslInputs.value[posId]) tpslInputs.value[posId] = { tp: '', sl: '' }
  tpslInputs.value[posId][kind] = v
}
function applyTP(p) {
  const v = parseFloat(getInput(p.id, 'tp'))
  if (!isNaN(v) && v > 0) {
    emit('set-tp', p.id, v)
  }
}
function applySL(p) {
  const v = parseFloat(getInput(p.id, 'sl'))
  if (!isNaN(v) && v > 0) {
    emit('set-sl', p.id, v)
  }
}

// 委托行展示辅助
function orderKindClass(o) {
  if (o.type === 'tp') return 'long'
  if (o.type === 'sl') return 'short'
  return o.side === 'buy' ? 'long' : 'short'
}
function orderKindLabel(o) {
  if (o.type === 'tp') return '止盈'
  if (o.type === 'sl') return '止损'
  if (o.type === 'limit') return `限${o.side === 'buy' ? '买' : '卖'}`
  if (o.type === 'stop') return `止${o.side === 'buy' ? '买' : '卖'}`
  return '委托'
}
function orderKindHint(o) {
  if (o.type === 'tp' || o.type === 'sl') {
    return o.type === 'tp' ? 'TP · 达到自动平仓' : 'SL · 达到自动平仓'
  }
  return '挂单: ' + fmtTime(o.createdAt)
}
</script>

<template>
  <div class="trade-panel">
    <!-- 账户 -->
    <div class="section account">
      <div class="row">
        <span class="lbl">当前价</span>
        <span class="val">{{ currentPrice }}</span>
      </div>
      <div class="row">
        <span class="lbl">余额</span>
        <span class="val">${{ fmt(account.balance) }}</span>
      </div>
      <div class="row">
        <span class="lbl">浮动盈亏</span>
        <span class="val" :class="pnlClass(unrealized)">${{ fmt(unrealized) }}</span>
      </div>
      <div class="row">
        <span class="lbl">已实现</span>
        <span class="val" :class="pnlClass(realized)">${{ fmt(realized) }}</span>
      </div>
      <div class="row total">
        <span class="lbl">权益</span>
        <span class="val" :class="pnlClass(equity - account.initialBalance)">${{ fmt(equity) }}</span>
      </div>
    </div>

    <!-- 快速下单 -->
    <div class="section">
      <div class="title">快速下单</div>
      <div class="quick-trade">
        <button class="primary" @click="emit('market-buy')">市价做多</button>
        <button class="danger" @click="emit('market-sell')">市价做空</button>
      </div>
      <div class="hint">
        💡 右键图表 → 限价/止损下单<br />
        💡 拖动委托线可修改价格
      </div>
    </div>

    <!-- 持仓 -->
    <div class="section">
      <div class="title">
        持仓 ({{ positions.length }})
        <button v-if="positions.length" class="link-btn" @click="emit('close-all')">全部平仓</button>
      </div>
      <div v-if="!positions.length" class="empty">暂无持仓</div>
      <div v-else class="list">
        <div v-for="p in positions" :key="p.id" class="item position">
          <div class="line1">
            <span class="side" :class="p.side">{{ p.side === 'long' ? '多' : '空' }}</span>
            <span class="qty">{{ p.quantity }}</span>
            <span class="px">@ {{ fmt(p.entryPrice) }}</span>
            <span class="pnl" :class="pnlClass(positionPnL(p))">${{ fmt(positionPnL(p)) }}</span>
          </div>
          <div class="line2">
            <span class="meta">开仓: {{ fmtTime(p.openTime) }}</span>
            <button class="mini" @click="emit('close-position', p.id)">平仓</button>
          </div>

          <!-- 止盈止损编辑器 -->
          <div class="tpsl">
            <div class="tpsl-row">
              <span class="tpsl-label tp">止盈</span>
              <input
                v-if="!p.tp"
                type="number"
                step="0.01"
                placeholder="价格"
                :value="getInput(p.id, 'tp')"
                @input="(e) => setInput(p.id, 'tp', e.target.value)"
                @keyup.enter="applyTP(p)"
              />
              <span v-else class="tpsl-val">@ {{ fmt(p.tp) }}</span>
              <button v-if="!p.tp" class="mini primary" @click="applyTP(p)">+</button>
              <button v-else class="mini" @click="emit('remove-tp', p.id)">✕</button>
            </div>
            <div class="tpsl-row">
              <span class="tpsl-label sl">止损</span>
              <input
                v-if="!p.sl"
                type="number"
                step="0.01"
                placeholder="价格"
                :value="getInput(p.id, 'sl')"
                @input="(e) => setInput(p.id, 'sl', e.target.value)"
                @keyup.enter="applySL(p)"
              />
              <span v-else class="tpsl-val">@ {{ fmt(p.sl) }}</span>
              <button v-if="!p.sl" class="mini danger" @click="applySL(p)">+</button>
              <button v-else class="mini" @click="emit('remove-sl', p.id)">✕</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 委托 -->
    <div class="section">
      <div class="title">
        委托 ({{ orders.length }})
        <button v-if="orders.length" class="link-btn" @click="emit('cancel-all')">全部撤销</button>
      </div>
      <div v-if="!orders.length" class="empty">无委托单</div>
      <div v-else class="list">
        <div v-for="o in orders" :key="o.id" class="item">
          <div class="line1">
            <span class="side" :class="orderKindClass(o)">
              {{ orderKindLabel(o) }}
            </span>
            <span class="qty">{{ o.quantity }}</span>
            <span class="px">@ {{ fmt(o.price) }}</span>
            <span class="status">待成交</span>
          </div>
          <div class="line2">
            <span class="meta">{{ orderKindHint(o) }}</span>
            <button v-if="!o.positionId" class="mini" @click="emit('cancel-order', o.id)">撤单</button>
            <span v-else class="meta">关联持仓</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 成交历史 -->
    <div class="section">
      <div class="title">成交历史 ({{ trades.length }})</div>
      <div v-if="!trades.length" class="empty">无成交记录</div>
      <div v-else class="list">
        <div v-for="t in trades.slice().reverse().slice(0, 8)" :key="t.id" class="item">
          <div class="line1">
            <span class="side" :class="t.side">{{ t.side === 'long' ? '多' : '空' }}</span>
            <span class="qty">{{ t.quantity }}</span>
            <span class="px">{{ fmt(t.entryPrice) }} → {{ fmt(t.closePrice) }}</span>
            <span class="pnl" :class="pnlClass(t.pnl)">${{ fmt(t.pnl) }}</span>
          </div>
          <div v-if="t.exitReason" class="line2">
            <span class="meta" :class="t.exitReason === '止盈' ? 'pos' : t.exitReason === '止损' ? 'neg' : ''">
              {{ t.exitReason }} 平仓
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trade-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  gap: 6px;
}

.section + .section {
  padding-top: 10px;
  border-top: 1px solid #21262d;
}

.title {
  font-size: 12px;
  font-weight: 600;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.account .row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  padding: 2px 0;
}

.account .row.total {
  padding-top: 6px;
  border-top: 1px solid #21262d;
  font-weight: 600;
}

.lbl {
  color: #8b949e;
}

.val {
  color: #e6edf3;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.val.pos {
  color: #26a69a;
}

.val.neg {
  color: #ef5350;
}

.quick-trade {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.hint {
  font-size: 11px;
  color: #6e7681;
  line-height: 1.6;
  padding: 6px;
  background: #0d1117;
  border-radius: 4px;
  border-left: 2px solid #1f6feb;
}

.empty {
  font-size: 12px;
  color: #6e7681;
  text-align: center;
  padding: 12px;
  font-style: italic;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item {
  padding: 8px;
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 6px;
  font-size: 12px;
}

.line1 {
  display: flex;
  align-items: center;
  gap: 8px;
}

.line2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  color: #6e7681;
  font-size: 11px;
}

.side {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
}

.side.long {
  background: rgba(38, 166, 154, 0.2);
  color: #26a69a;
}

.side.short {
  background: rgba(239, 83, 80, 0.2);
  color: #ef5350;
}

.qty {
  color: #c9d1d9;
  font-variant-numeric: tabular-nums;
}

.px {
  color: #8b949e;
  font-variant-numeric: tabular-nums;
}

.pnl {
  margin-left: auto;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.pnl.pos {
  color: #26a69a;
}

.pnl.neg {
  color: #ef5350;
}

.status {
  margin-left: auto;
  color: #d29922;
  font-size: 11px;
}

.mini {
  padding: 2px 8px;
  font-size: 11px;
}

.link-btn {
  background: transparent;
  border: none;
  color: #58a6ff;
  font-size: 11px;
  padding: 2px 6px;
}

.link-btn:hover {
  background: transparent;
  text-decoration: underline;
}

/* 持仓卡片扩展：TP/SL 编辑器 */
.item.position {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tpsl {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed #21262d;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tpsl-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.tpsl-label {
  width: 32px;
  text-align: center;
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 600;
}

.tpsl-label.tp {
  background: rgba(38, 166, 154, 0.2);
  color: #26a69a;
}

.tpsl-label.sl {
  background: rgba(239, 83, 80, 0.2);
  color: #ef5350;
}

.tpsl-row input {
  flex: 1;
  padding: 3px 6px;
  font-size: 11px;
  min-width: 0;
}

.tpsl-val {
  flex: 1;
  color: #c9d1d9;
  font-variant-numeric: tabular-nums;
}

.meta.pos {
  color: #26a69a;
}
.meta.neg {
  color: #ef5350;
}
</style>
