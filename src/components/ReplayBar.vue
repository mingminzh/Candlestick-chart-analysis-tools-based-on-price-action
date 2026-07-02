<script setup>
import { computed } from 'vue'

const props = defineProps({
  replayIndex: { type: Number, required: true },
  replayMax: { type: Number, required: true },
  canReplayNext: { type: Boolean, required: true },
  canReplayPrev: { type: Boolean, required: true },
  isAutoPlaying: { type: Boolean, required: true },
  currentBar: { type: Object, default: null },
  barCountSettings: { type: Object, default: () => ({ enabled: true, displayInterval: 2 }) }
})

const emit = defineEmits(['next', 'prev', 'reset', 'auto-toggle', 'update-count-settings'])

const progress = computed(() => {
  if (!props.replayMax) return 0
  return ((props.replayIndex + 1) / (props.replayMax + 1)) * 100
})

function fmtTime(time) {
  if (!time) return '-'
  const d = new Date(time * 1000)
  const yyyy = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mo}-${dd} ${hh}:${mm}`
}

function updateCountSetting(patch) {
  emit('update-count-settings', patch)
}
</script>

<template>
  <div class="replay-bar">
    <div class="left">
      <button
        class="big"
        :disabled="!canReplayPrev"
        @click="emit('prev')"
        :title="'回退一根K线 (←)'"
      >
        ◀ 上一根
      </button>

      <button
        class="primary big"
        :disabled="!canReplayNext"
        @click="emit('next')"
        :title="'前进一根K线 (空格)'"
      >
        ▶ 下一根
      </button>

      <button
        :class="['big', { active: isAutoPlaying }]"
        :disabled="!canReplayNext && !isAutoPlaying"
        @click="emit('auto-toggle')"
      >
        {{ isAutoPlaying ? '⏸ 暂停' : '⏩ 自动播放' }}
      </button>

      <button class="big" @click="emit('reset')">⟲ 重置</button>
    </div>

    <div class="middle">
      <div class="progress-info">
        <span class="lbl">已显示</span>
        <span class="val">{{ replayIndex + 1 }} / {{ replayMax + 1 }}</span>
        <span class="lbl">·</span>
        <span class="val">{{ progress.toFixed(1) }}%</span>
      </div>
      <div class="progress">
        <div class="bar" :style="{ width: progress + '%' }"></div>
      </div>
      <div class="count-settings">
        <label class="count-toggle">
          <input
            type="checkbox"
            :checked="barCountSettings.enabled"
            @change="(e) => updateCountSetting({ enabled: e.target.checked })"
          />
          <span>K线编号</span>
        </label>
        <label>
          <span>每隔</span>
          <input
            type="number"
            min="1"
            step="1"
            :value="barCountSettings.displayInterval"
            :disabled="!barCountSettings.enabled"
            @change="(e) => updateCountSetting({ displayInterval: e.target.value })"
          />
          <span>根显示</span>
        </label>
      </div>
    </div>

    <div class="right">
      <div v-if="currentBar" class="ohlc">
        <div class="time">{{ fmtTime(currentBar.time) }}</div>
        <div class="vals">
          <span>O <b>{{ currentBar.open.toFixed(2) }}</b></span>
          <span>H <b class="hi">{{ currentBar.high.toFixed(2) }}</b></span>
          <span>L <b class="lo">{{ currentBar.low.toFixed(2) }}</b></span>
          <span>C <b :class="currentBar.close >= currentBar.open ? 'hi' : 'lo'">{{ currentBar.close.toFixed(2) }}</b></span>
          <span>V <b>{{ currentBar.volume.toFixed(0) }}</b></span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.replay-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
}

.left {
  display: flex;
  gap: 8px;
}

button.big {
  padding: 8px 14px;
  font-weight: 500;
}

.middle {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
}

.progress-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.progress-info .lbl {
  color: #6e7681;
}

.progress-info .val {
  color: #c9d1d9;
  font-variant-numeric: tabular-nums;
}

.progress {
  height: 6px;
  background: #0d1117;
  border-radius: 3px;
  overflow: hidden;
}

.count-settings {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: #8b949e;
}

.count-settings label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.count-settings input[type='number'] {
  width: 48px;
}

.count-settings input[type='text'] {
  width: 96px;
}

.count-settings input {
  height: 22px;
  padding: 1px 5px;
  font-size: 11px;
}

.count-toggle input {
  width: auto;
  height: auto;
}

.bar {
  height: 100%;
  background: linear-gradient(90deg, #1f6feb, #58a6ff);
  transition: width 0.2s ease;
}

.right .ohlc {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.ohlc .time {
  font-size: 11px;
  color: #6e7681;
  font-variant-numeric: tabular-nums;
}

.ohlc .vals {
  display: flex;
  gap: 8px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.ohlc .vals span {
  color: #8b949e;
}

.ohlc .vals b {
  font-weight: 600;
  color: #e6edf3;
}

.ohlc .vals b.hi {
  color: #26a69a;
}

.ohlc .vals b.lo {
  color: #ef5350;
}
</style>
