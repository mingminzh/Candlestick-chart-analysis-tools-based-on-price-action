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
          <p>本机使用时，留空代理接口，只填写 OpenAI API Key 和模型名。代理接口只填你自己的后端服务地址。</p>
        </div>
        <button class="icon-btn" @click="emit('close')">×</button>
      </div>

      <label>
        <span>AI代理接口地址</span>
        <input v-model="endpoint" placeholder="https://your-domain/api/review" />
      </label>
      <div class="field-help">
        不要在这里填写 https://api.openai.com/v1/...；那会被当成代理接口，容易出现 401。
      </div>

      <div class="divider">或本机直接调用 OpenAI</div>

      <label>
        <span>OpenAI API Key</span>
        <input v-model="apiKey" type="password" placeholder="sk-..." autocomplete="off" />
      </label>

      <label>
        <span>模型名</span>
        <input v-model="model" placeholder="例如你账号可用的 gpt 系列模型名" />
      </label>

      <div class="note">
        出现 401 时，通常是 Key 不完整、Key 没有权限、填错位置，或代理接口没有正确转发 Authorization。API Key 会保存在本机 localStorage 中，不要把带 Key 的网页部署给别人使用。
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

.field-help {
  margin-top: -6px;
  color: #d29922;
  font-size: 11px;
  line-height: 1.45;
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
