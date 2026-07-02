<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'saved'])

const endpoint = ref('')
const apiKey = ref('')
const model = ref('')

watch(() => props.open, (value) => {
  if (!value || typeof window === 'undefined') return
  endpoint.value = window.localStorage.getItem('pa-ai-review-endpoint') || ''
  apiKey.value = window.localStorage.getItem('pa-openai-api-key') || ''
  model.value = window.localStorage.getItem('pa-openai-model') || ''
})

function save() {
  window.localStorage.setItem('pa-ai-review-endpoint', endpoint.value.trim())
  window.localStorage.setItem('pa-openai-api-key', apiKey.value.trim())
  window.localStorage.setItem('pa-openai-model', model.value.trim())
  emit('saved')
  emit('close')
}

function clearAll() {
  endpoint.value = ''
  apiKey.value = ''
  model.value = ''
  window.localStorage.removeItem('pa-ai-review-endpoint')
  window.localStorage.removeItem('pa-openai-api-key')
  window.localStorage.removeItem('pa-openai-model')
  emit('saved')
}
</script>

<template>
  <div v-if="open" class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-head">
        <div>
          <h2>AI设置</h2>
          <p>优先推荐填写自己的后端代理接口；本机使用也可以直接填写 OpenAI API Key。</p>
        </div>
        <button class="icon-btn" @click="emit('close')">×</button>
      </div>

      <label>
        <span>AI代理接口地址</span>
        <input v-model="endpoint" placeholder="https://your-domain/api/review" />
      </label>

      <div class="divider">或本机直接调用 OpenAI</div>

      <label>
        <span>OpenAI API Key</span>
        <input v-model="apiKey" type="password" placeholder="sk-..." autocomplete="off" />
      </label>

      <label>
        <span>模型名</span>
        <input v-model="model" placeholder="填写你账号可用的模型名" />
      </label>

      <div class="note">
        API Key 会保存在本机浏览器/桌面应用的 localStorage 中。不要把带 Key 的网页部署给别人使用。
      </div>

      <div class="actions">
        <button @click="clearAll">清空</button>
        <button class="primary" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(1, 4, 9, 0.72);
}

.modal {
  width: min(520px, 100%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  border-radius: 8px;
  border: 1px solid #30363d;
  background: #161b22;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

h2 {
  margin: 0;
  color: #e6edf3;
  font-size: 16px;
}

p {
  margin: 5px 0 0;
  color: #8b949e;
  font-size: 12px;
  line-height: 1.5;
}

label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: #8b949e;
  font-size: 12px;
}

input {
  height: 34px;
  padding: 6px 9px;
  border-radius: 6px;
  border: 1px solid #30363d;
  background: #0d1117;
  color: #e6edf3;
}

.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #6e7681;
  font-size: 11px;
}

.divider::before,
.divider::after {
  content: '';
  height: 1px;
  flex: 1;
  background: #30363d;
}

.note {
  padding: 8px;
  border-left: 3px solid #d29922;
  border-radius: 5px;
  background: #0d1117;
  color: #c9d1d9;
  font-size: 12px;
  line-height: 1.55;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.icon-btn {
  min-width: 30px;
  height: 30px;
  padding: 0;
  font-size: 18px;
}
</style>
