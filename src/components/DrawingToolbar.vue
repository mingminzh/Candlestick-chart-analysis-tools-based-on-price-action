<script setup>
import { defineProps, defineEmits } from 'vue'

const props = defineProps({
  activeTool: { type: String, default: null },
  drawingsCount: { type: Number, default: 0 }
})

const emit = defineEmits(['select', 'clear', 'toggle-magnet'])

// 这些 toolName 来自 @mg-exchange/charts 的 47 种画线工具
const tools = [
  { name: 'trend-line', label: '趋势线', icon: '╱' },
  { name: 'horizontal-line', label: '水平线', icon: '─' },
  { name: 'vertical-line', label: '垂直线', icon: '│' },
  { name: 'ray', label: '射线', icon: '↗' },
  { name: 'parallel-channel', label: '平行通道', icon: '⇗' },
  { name: 'fib-retracement', label: '斐波那契', icon: 'φ' },
  { name: 'rectangle', label: '矩形', icon: '▭' },
  { name: 'ellipse', label: '椭圆', icon: '○' },
  { name: 'arrow', label: '箭头', icon: '→' },
  { name: 'text', label: '文字', icon: 'T' },
  { name: 'long-position', label: '多头位置', icon: '🟢' },
  { name: 'short-position', label: '空头位置', icon: '🔴' }
]
</script>

<template>
  <div class="drawing-toolbar">
    <div class="title">画线工具</div>
    <div class="grid">
      <button
        v-for="t in tools"
        :key="t.name"
        :class="['tool-btn', { active: activeTool === t.name }]"
        :title="t.label"
        @click="emit('select', t.name)"
      >
        <span class="icon">{{ t.icon }}</span>
        <span class="lbl">{{ t.label }}</span>
      </button>
    </div>

    <div class="actions">
      <label class="magnet">
        <input type="checkbox" @change="(e) => emit('toggle-magnet', e.target.checked)" />
        <span>磁吸 OHLC</span>
      </label>
      <button class="danger" :disabled="!drawingsCount" @click="emit('clear')">
        清除全部 ({{ drawingsCount }})
      </button>
    </div>
  </div>
</template>

<style scoped>
.drawing-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
}

.title {
  font-size: 12px;
  font-weight: 600;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.tool-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  font-size: 12px;
  text-align: left;
}

.tool-btn .icon {
  width: 18px;
  text-align: center;
  font-weight: 700;
  color: #58a6ff;
}

.tool-btn .lbl {
  flex: 1;
}

.tool-btn.active {
  background: #1f6feb;
  border-color: #58a6ff;
}

.tool-btn.active .icon {
  color: #fff;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid #30363d;
}

.magnet {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #c9d1d9;
}
</style>
