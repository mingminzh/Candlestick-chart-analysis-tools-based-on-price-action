<script setup>
const props = defineProps({
  markers: { type: Array, default: () => [] },
  selectedTradeId: { type: String, default: '' }
})

const emit = defineEmits(['select'])

function fmt(v, dp = 2) {
  if (v === undefined || v === null || isNaN(v)) return '-'
  return Number(v).toFixed(dp)
}

function fmtTime(time) {
  if (!time) return '-'
  const d = new Date(time * 1000)
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${mo}/${dd} ${hh}:${mm}`
}
</script>

<template>
  <div class="trade-markers-layer">
    <button
      v-for="marker in markers"
      :key="marker.id"
      :class="['trade-marker', marker.profitable ? 'win' : 'loss', { selected: selectedTradeId === marker.id }]"
      :style="{ left: `${marker.x}px`, top: `${marker.y}px` }"
      :aria-label="`${marker.profitable ? '盈利' : '亏损'}交易 ${marker.id}`"
      @click.stop="emit('select', marker.id)"
    >
      <span class="marker-icon">{{ marker.side === 'long' ? '▲' : '▼' }}</span>
      <span class="marker-tooltip">
        <strong>{{ marker.profitable ? '盈利订单' : '亏损订单' }}</strong>
        <span>方向: {{ marker.side === 'long' ? '多' : '空' }}</span>
        <span>入场: {{ fmt(marker.entryPrice) }}</span>
        <span>出场: {{ fmt(marker.closePrice) }}</span>
        <span>仓位: {{ fmt(marker.quantity, 4) }}</span>
        <span>入场金额: {{ fmt(marker.notional) }} U</span>
        <span :class="marker.profitable ? 'pos' : 'neg'">盈亏: {{ fmt(marker.pnl) }} U</span>
        <span>时间: {{ fmtTime(marker.openTime) }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.trade-markers-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 8;
}

.trade-marker {
  position: absolute;
  width: 22px;
  height: 22px;
  transform: translate(-50%, -50%);
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 999px;
  border: 2px solid currentColor;
  background: #0d1117;
  color: #26a69a;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
  cursor: pointer;
}

.trade-marker.loss {
  color: #ef5350;
}

.trade-marker.selected {
  animation: selected-marker-pulse 0.9s ease-in-out infinite;
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.4), 0 2px 8px rgba(0, 0, 0, 0.35);
}

.marker-icon {
  font-size: 12px;
  line-height: 1;
}

.marker-tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  width: max-content;
  min-width: 160px;
  display: none;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #30363d;
  background: rgba(13, 17, 23, 0.96);
  color: #c9d1d9;
  font-size: 11px;
  text-align: left;
  white-space: nowrap;
}

.trade-marker:hover .marker-tooltip {
  display: flex;
}

.marker-tooltip strong {
  color: #e6edf3;
  font-size: 12px;
}

.marker-tooltip .pos {
  color: #26a69a;
}

.marker-tooltip .neg {
  color: #ef5350;
}

@keyframes selected-marker-pulse {
  0% {
    transform: translate(-50%, -50%) scale(1);
    box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.32), 0 2px 8px rgba(0, 0, 0, 0.35);
  }
  50% {
    transform: translate(-50%, -50%) scale(1.22);
    box-shadow: 0 0 0 8px rgba(88, 166, 255, 0.08), 0 2px 12px rgba(0, 0, 0, 0.45);
  }
  100% {
    transform: translate(-50%, -50%) scale(1);
    box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.32), 0 2px 8px rgba(0, 0, 0, 0.35);
  }
}
</style>
