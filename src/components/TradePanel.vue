<script setup>
import { ref, watch, computed } from 'vue'

const props = defineProps({
  account: { type: Object, required: true },
  orders: { type: Array, required: true },
  positions: { type: Array, required: true },
  trades: { type: Array, required: true },
  tradeNotes: { type: Object, default: () => ({}) },
  selectedTrade: { type: Object, default: null },
  selectedTradeId: { type: String, default: '' },
  feedback: { type: Object, default: null },
  reviewState: { type: Object, default: () => ({ loading: false, error: '' }) },
  realized: { type: Number, required: true },
  unrealized: { type: Number, required: true },
  equity: { type: Number, required: true },
  currentBar: { type: Object, default: null }
})

const emit = defineEmits([
  'market-buy',
  'market-sell',
  'update-account',
  'limit-order',
  'stop-order',
  'breakout-order',
  'update-order-price',
  'close-position',
  'close-all',
  'cancel-order',
  'cancel-all',
  'set-tp',
  'set-sl',
  'remove-tp',
  'remove-sl',
  'select-trade',
  'review-trade',
  'update-trade-note',
  'delete-trade',
  'reset-account'
])

const currentPrice = computed(() => props.currentBar?.close?.toFixed(2) ?? '-')
const pnlClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '')
const isReviewing = computed(() => Boolean(props.reviewState?.loading))
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
const pendingPrice = ref('')
const reviewCollapsed = ref(false)
const isListening = ref(false)
let recognition = null
const accountDraft = ref({
  initialBalance: props.account.initialBalance,
  orderMode: props.account.orderMode || 'qty',
  defaultQty: props.account.defaultQty || 0.05,
  defaultAmount: props.account.defaultAmount || 1000
})

watch(() => props.account, (account) => {
  accountDraft.value = {
    initialBalance: account.initialBalance,
    orderMode: account.orderMode || 'qty',
    defaultQty: account.defaultQty || 0.05,
    defaultAmount: account.defaultAmount || 1000
  }
}, { deep: true })

watch(() => props.selectedTradeId, () => {
  reviewCollapsed.value = false
})

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

function pendingOrderPrice() {
  const raw = pendingPrice.value || props.currentBar?.close
  const price = Number(raw)
  return Number.isFinite(price) && price > 0 ? price : null
}

function setPendingFromCurrent() {
  if (props.currentBar?.close) pendingPrice.value = fmt(props.currentBar.close)
}

function isTradeReviewing(tradeId) {
  return props.selectedTradeId === tradeId && isReviewing.value
}

function placePending(type, side) {
  const price = pendingOrderPrice()
  if (!price) return
  const eventName = type === 'limit' ? 'limit-order' : type === 'breakout' ? 'breakout-order' : 'stop-order'
  emit(eventName, side, price)
}

function updateOrderFromInput(orderId, value) {
  const price = Number(value)
  if (Number.isFinite(price) && price > 0) {
    emit('update-order-price', orderId, price)
  }
}

function applyAccountSettings() {
  emit('update-account', {
    initialBalance: Number(accountDraft.value.initialBalance),
    orderMode: accountDraft.value.orderMode,
    defaultQty: Number(accountDraft.value.defaultQty),
    defaultAmount: Number(accountDraft.value.defaultAmount)
  })
}

function resetAccount() {
  const initial = Number(accountDraft.value.initialBalance) || 1000
  emit('reset-account', initial)
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
  if (o.type === 'breakout') return `突破${o.side === 'buy' ? '买' : '卖'}`
  if (o.type === 'stop') return `止${o.side === 'buy' ? '买' : '卖'}`
  return '委托'
}
function orderKindHint(o) {
  if (o.type === 'tp' || o.type === 'sl') {
    return o.type === 'tp' ? 'TP · 达到自动平仓' : 'SL · 达到自动平仓'
  }
  return '挂单: ' + fmtTime(o.createdAt)
}

const speechSupported = computed(() => {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
})

const selectedTradeNote = computed(() => props.selectedTrade?.id ? props.tradeNotes[props.selectedTrade.id] || '' : '')

function updateSelectedTradeNote(value) {
  if (!props.selectedTrade?.id) return
  emit('update-trade-note', props.selectedTrade.id, value)
}

function startVoiceInput() {
  if (!props.selectedTrade?.id || !speechSupported.value) return
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  recognition?.stop?.()
  recognition = new SpeechRecognition()
  recognition.lang = 'zh-CN'
  recognition.interimResults = true
  recognition.continuous = false
  const baseText = selectedTradeNote.value
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
    updateSelectedTradeNote(`${prefix}${finalText || interimText}`.trim())
  }
  recognition.onend = () => {
    isListening.value = false
  }
  recognition.onerror = () => {
    isListening.value = false
  }
  recognition.start()
}

function stopVoiceInput() {
  recognition?.stop?.()
  isListening.value = false
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
      <div class="account-editor">
        <label>
          <span>初始资金</span>
          <input v-model="accountDraft.initialBalance" type="number" step="100" @change="applyAccountSettings" />
        </label>
        <button class="reset-account" @click="resetAccount">重置账户</button>
        <label>
          <span>下单模式</span>
          <select v-model="accountDraft.orderMode" @change="applyAccountSettings">
            <option value="qty">手数</option>
            <option value="amount">金额</option>
          </select>
        </label>
        <label v-if="accountDraft.orderMode === 'qty'">
          <span>默认手数</span>
          <input v-model="accountDraft.defaultQty" type="number" step="0.001" @change="applyAccountSettings" />
        </label>
        <label v-else>
          <span>下单金额</span>
          <input v-model="accountDraft.defaultAmount" type="number" step="100" @change="applyAccountSettings" />
        </label>
      </div>
    </div>

    <!-- 快速下单 -->
    <div class="section">
      <div class="title">快速下单</div>
      <div class="quick-trade">
        <button class="primary" @click="emit('market-buy')">市价做多</button>
        <button class="danger" @click="emit('market-sell')">市价做空</button>
      </div>
      <div class="pending-trade">
        <div class="price-row">
          <input
            v-model="pendingPrice"
            type="number"
            step="0.01"
            placeholder="挂单价格"
            @focus="setPendingFromCurrent"
          />
          <button class="mini" @click="setPendingFromCurrent">当前价</button>
        </div>
        <div class="quick-trade">
          <button class="primary" @click="placePending('limit', 'buy')">限价买入</button>
          <button class="danger" @click="placePending('limit', 'sell')">限价卖出</button>
          <button class="primary ghost" @click="placePending('breakout', 'buy')">突破买入</button>
          <button class="danger ghost" @click="placePending('breakout', 'sell')">突破卖出</button>
          <button class="primary ghost" @click="placePending('stop', 'buy')">止损买入</button>
          <button class="danger ghost" @click="placePending('stop', 'sell')">止损卖出</button>
        </div>
      </div>
      <div class="hint">
        下单后不会自动生成止盈/止损；在持仓里设置 TP/SL 后，图表上会出现可拖动的对应线。
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
            <label class="order-price">
              @
              <input
                type="number"
                step="0.01"
                :value="fmt(o.price)"
                @change="(e) => updateOrderFromInput(o.id, e.target.value)"
              />
            </label>
            <span class="status">待成交</span>
          </div>
          <div class="line2">
            <span class="meta">{{ orderKindHint(o) }}</span>
            <button class="mini" @click="emit('cancel-order', o.id)">
              {{ o.positionId ? '取消' : '撤单' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 成交历史 -->
    <div class="section">
      <div class="title">成交历史 ({{ trades.length }})</div>
      <div v-if="!trades.length" class="empty">无成交记录</div>
      <div v-else class="list">
        <div
          v-for="t in trades.slice().reverse().slice(0, 12)"
          :key="t.id"
          :class="['item', 'trade-item', { selected: selectedTradeId === t.id }]"
          @click="emit('select-trade', t.id)"
        >
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
            <div class="trade-actions">
              <button
                class="mini primary"
                :disabled="isTradeReviewing(t.id)"
                @click.stop="emit('review-trade', t.id)"
              >
                {{ isTradeReviewing(t.id) ? '点评中…' : '点评' }}
              </button>
              <button class="mini danger" @click.stop="emit('delete-trade', t.id)">删除</button>
            </div>
          </div>
          <div v-else class="line2">
            <span class="meta">手动平仓</span>
            <div class="trade-actions">
              <button
                class="mini primary"
                :disabled="isTradeReviewing(t.id)"
                @click.stop="emit('review-trade', t.id)"
              >
                {{ isTradeReviewing(t.id) ? '点评中…' : '点评' }}
              </button>
              <button class="mini danger" @click.stop="emit('delete-trade', t.id)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="selectedTrade && feedback && feedback.payloadPreview?.selectedTradeId === selectedTrade.id"
        class="trade-review"
      >
        <div class="voice-note">
          <div class="voice-head">
            <span>交易备注</span>
            <button
              class="mini"
              :disabled="!speechSupported"
              @click="isListening ? stopVoiceInput() : startVoiceInput()"
            >
              {{ isListening ? '停止语音' : '语音输入' }}
            </button>
          </div>
          <textarea
            :value="selectedTradeNote"
            placeholder="可以说出你的入场理由、当时看到的形态、犹豫点或执行问题。"
            @input="(e) => updateSelectedTradeNote(e.target.value)"
          ></textarea>
        </div>
        <div v-if="isReviewing" class="review-progress">
          <div class="progress-head">
            <span>AI正在分析这笔交易</span>
            <span>请求中</span>
          </div>
          <div class="progress-bar"><span></span></div>
          <div class="progress-text">正在读取入场点之后的K线、成交结果、备注和价格行为结构。</div>
        </div>
        <div class="review-head">
          <div>
            <div class="title">交易点评</div>
            <div class="review-subtitle">基于该笔入场点之后的市场状态、力量变化和价格行为结构</div>
          </div>
          <div class="review-actions">
            <span v-if="feedback.score !== undefined" class="score-pill">评分 {{ feedback.score }}</span>
            <button class="mini" @click="reviewCollapsed = !reviewCollapsed">
              {{ reviewCollapsed ? '展开' : '收起' }}
            </button>
          </div>
        </div>
        <div class="review-summary">
          <span class="summary-label">结论</span>
          {{ feedback.summary }}
        </div>
        <template v-if="!reviewCollapsed">
          <div v-if="feedback.verdictProbability" class="review-card verdict-card">
            <div class="review-title">概率判断</div>
            <p>
              <strong>{{ feedback.verdictProbability.label || '未定' }}</strong>
              <span v-if="feedback.verdictProbability.probabilityText">
                · {{ feedback.verdictProbability.probabilityText }}
              </span>
              <span v-if="feedback.verdictProbability.confidence !== undefined">
                · 置信度 {{ feedback.verdictProbability.confidence }}
              </span>
            </p>
          </div>
          <div v-if="feedback.keyWrongAssumption" class="review-card warn-card">
            <div class="review-title">关键错误假设</div>
            <p><strong>{{ feedback.keyWrongAssumption.title }}</strong></p>
            <p>{{ feedback.keyWrongAssumption.detail }}</p>
            <ul v-if="feedback.keyWrongAssumption.evidence?.length">
              <li v-for="item in feedback.keyWrongAssumption.evidence" :key="item">{{ item }}</li>
            </ul>
          </div>
          <div v-if="scoreEntries.length" class="score-grid">
            <div v-for="[name, value] in scoreEntries" :key="name" class="score-box">
              <span>{{ name }}</span>
              <b>{{ fmt(value, 0) }}</b>
            </div>
          </div>
          <div v-if="feedback.evidence?.length" class="review-card evidence-card">
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
          <div v-if="feedback.issues?.length" class="review-card warn-card">
            <div class="review-title">需要修正</div>
            <ul>
              <li v-for="issue in feedback.issues" :key="issue.title + issue.detail">
                <strong>{{ issue.title }}</strong>: {{ issue.detail }}
              </li>
            </ul>
          </div>
          <div v-if="feedback.suggestions?.length" class="review-card action-card">
            <div class="review-title">操作建议</div>
            <ul>
              <li v-for="item in feedback.suggestions" :key="item">{{ item }}</li>
            </ul>
          </div>
        </template>
      </div>
      <div v-else-if="selectedTrade" class="review-empty">
        <div class="voice-note">
          <div class="voice-head">
            <span>交易备注</span>
            <button
              class="mini"
              :disabled="!speechSupported"
              @click="isListening ? stopVoiceInput() : startVoiceInput()"
            >
              {{ isListening ? '停止语音' : '语音输入' }}
            </button>
          </div>
          <textarea
            :value="selectedTradeNote"
            placeholder="可以先用语音记录这笔单的入场理由，再点击点评。"
            @input="(e) => updateSelectedTradeNote(e.target.value)"
          ></textarea>
        </div>
        <div v-if="isReviewing" class="review-progress">
          <div class="progress-head">
            <span>AI正在分析这笔交易</span>
            <span>请求中</span>
          </div>
          <div class="progress-bar"><span></span></div>
          <div class="progress-text">正在连接AI接口并生成点评，请稍等。</div>
        </div>
        <div v-else-if="reviewState?.error" class="review-error">
          <strong>AI点评失败</strong>
          <span>{{ reviewState.error }}</span>
        </div>
        <div v-else>已选中交易，点击该笔记录右侧“点评”生成分析。</div>
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

.account-editor {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px dashed #21262d;
}

.account-editor label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
  color: #8b949e;
}

.account-editor input,
.account-editor select {
  min-width: 0;
  height: 28px;
  padding: 3px 6px;
  font-size: 12px;
}

.reset-account {
  align-self: end;
  min-height: 28px;
  padding: 4px 8px;
}

.account-editor .checkbox-line {
  flex-direction: row;
  align-items: center;
  min-height: 28px;
}

.account-editor .checkbox-line input {
  width: auto;
  height: auto;
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

.pending-trade {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.price-row {
  display: flex;
  gap: 6px;
}

.price-row input {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  font-size: 12px;
}

button.ghost {
  background: #161b22;
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

.trade-item {
  cursor: pointer;
}

.trade-item.selected {
  border-color: #58a6ff;
  box-shadow: inset 3px 0 0 #1f6feb;
}

.trade-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.trade-review,
.review-empty {
  margin-top: 8px;
  padding: 10px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
}

.review-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.review-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.review-subtitle {
  margin-top: 3px;
  color: #6e7681;
  font-size: 11px;
  line-height: 1.4;
}

.score-pill {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(240, 180, 41, 0.12);
  color: #f0b429;
  border: 1px solid rgba(240, 180, 41, 0.35);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.review-empty {
  color: #8b949e;
  font-size: 12px;
  text-align: center;
}

.review-progress {
  margin: 8px 0;
  padding: 8px;
  border-radius: 6px;
  background: rgba(88, 166, 255, 0.08);
  border: 1px solid rgba(88, 166, 255, 0.24);
  color: #c9d1d9;
  text-align: left;
}

.progress-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
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

.progress-text {
  margin-top: 7px;
  color: #8b949e;
  font-size: 11px;
  line-height: 1.45;
}

.review-error {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(239, 83, 80, 0.1);
  border: 1px solid rgba(239, 83, 80, 0.28);
  color: #ffb4ad;
  text-align: left;
  line-height: 1.5;
}

.voice-note {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
  text-align: left;
}

.voice-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  color: #8b949e;
  font-size: 12px;
  font-weight: 700;
}

.voice-note textarea {
  min-height: 74px;
  width: 100%;
  resize: vertical;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #30363d;
  background: #161b22;
  color: #e6edf3;
  font-size: 12px;
  line-height: 1.55;
}

.review-summary {
  margin-top: 8px;
  color: #c9d1d9;
  font-size: 12px;
  line-height: 1.6;
  padding: 8px;
  background: #161b22;
  border-radius: 5px;
  border-left: 3px solid #f0b429;
}

.summary-label {
  display: inline-block;
  margin-right: 6px;
  color: #f0b429;
  font-weight: 700;
}

.review-sections {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.review-card {
  padding: 8px;
  background: #161b22;
  border-left: 3px solid #58a6ff;
  border-radius: 5px;
}

.review-card.warn-card {
  border-left-color: #d29922;
}

.review-card.action-card {
  border-left-color: #26a69a;
}

.review-card.verdict-card {
  border-left-color: #a371f7;
}

.review-card.evidence-card {
  border-left-color: #79c0ff;
}

.review-title {
  color: #58a6ff;
  font-size: 12px;
  font-weight: 700;
}

.score-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.score-box {
  min-width: 0;
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
  line-height: 1.2;
}

.score-box b {
  display: block;
  margin-top: 3px;
  color: #e6edf3;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.tag-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding: 8px;
  border-radius: 5px;
  background: #161b22;
  border: 1px solid #30363d;
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
  max-width: 100%;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(88, 166, 255, 0.12);
  color: #79c0ff;
  border: 1px solid rgba(88, 166, 255, 0.25);
  font-size: 11px;
  font-weight: 600;
}

.danger-tags b {
  background: rgba(239, 83, 80, 0.1);
  color: #ffb4ad;
  border-color: rgba(239, 83, 80, 0.25);
}

.review-card p,
.review-card li {
  color: #c9d1d9;
  font-size: 12px;
  line-height: 1.6;
}

.review-card ul {
  margin: 6px 0 0;
  padding-left: 16px;
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

.order-price {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #8b949e;
  font-variant-numeric: tabular-nums;
}

.order-price input {
  width: 90px;
  min-width: 0;
  padding: 2px 5px;
  font-size: 11px;
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

.mini:disabled {
  cursor: progress;
  opacity: 0.65;
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
