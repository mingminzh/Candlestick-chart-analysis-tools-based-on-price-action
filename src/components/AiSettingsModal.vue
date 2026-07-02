<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'saved'])

const endpoint = ref('')
const apiKey = ref('')
const model = ref('')
const provider = ref('deepseek')

watch(() => props.open, (value) => {
  if (!value || typeof window === 'undefined') return
  provider.value = window.localStorage.getItem('pa-ai-provider') || 'deepseek'
  endpoint.value = window.localStorage.getItem('pa-ai-review-endpoint') || ''
  apiKey.value = window.localStorage.getItem('pa-ai-api-key') || window.localStorage.getItem('pa-openai-api-key') || ''
  model.value = window.localStorage.getItem('pa-ai-model') || window.localStorage.getItem('pa-openai-model') || ''
})

function save() {
  window.localStorage.setItem('pa-ai-provider', provider.value)
  window.localStorage.setItem('pa-ai-review-endpoint', endpoint.value.trim())
  window.localStorage.setItem('pa-ai-api-key', apiKey.value.trim())
  window.localStorage.setItem('pa-ai-model', model.value.trim())
  emit('saved')
  emit('close')
}

function clearAll() {
  provider.value = 'deepseek'
  endpoint.value = ''
  apiKey.value = ''
  model.value = ''
  window.localStorage.removeItem('pa-ai-provider')
  window.localStorage.removeItem('pa-ai-review-endpoint')
  window.localStorage.removeItem('pa-ai-api-key')
  window.localStorage.removeItem('pa-ai-model')
  window.localStorage.removeItem('pa-openai-api-key')
  window.localStorage.removeItem('pa-openai-model')
  emit('saved')
}

function fillDeepSeekDefaults() {
  provider.value = 'deepseek'
  endpoint.value = ''
  if (!model.value || model.value.startsWith('gpt')) model.value = 'deepseek-chat'
}
</script>

<template>
  <div v-if="open" class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-head">
        <div>
          <h2>AI设置</h2>
          <p>你使用 DeepSeek 时，选择 DeepSeek，填写 DeepSeek API Key；代理接口留空。</p>
        </div>
        <button class="icon-btn" @click="emit('close')">×</button>
      </div>

      <label>
        <span>AI服务商</span>
        <select v-model="provider" @change="provider === 'deepseek' && fillDeepSeekDefaults()">
          <option value="deepseek">DeepSeek</option>
          <option value="openai">OpenAI</option>
          <option value="proxy">自定义代理</option>
        </select>
      </label>

      <label>
        <span>AI代理接口地址</span>
        <input
          v-model="endpoint"
          :disabled="provider !== 'proxy'"
          placeholder="仅自定义代理需要填写，例如 https://your-domain/api/review"
        />
      </label>
      <div class="field-help">
        DeepSeek 和 OpenAI 直连时，这里请留空；自定义代理才需要填写你自己的后端接口。
      </div>

      <div class="divider">{{ provider === 'deepseek' ? 'DeepSeek 直连' : provider === 'openai' ? 'OpenAI 直连' : '代理接口模式' }}</div>

      <label>
        <span>{{ provider === 'deepseek' ? 'DeepSeek API Key' : 'API Key' }}</span>
        <input
          v-model="apiKey"
          type="password"
          :disabled="provider === 'proxy'"
          placeholder="DeepSeek/OpenAI 的 API Key"
          autocomplete="off"
        />
      </label>

      <label>
        <span>模型名</span>
        <input
          v-model="model"
          :disabled="provider === 'proxy'"
          :placeholder="provider === 'deepseek' ? 'deepseek-chat' : '填写你账号可用的模型名'"
        />
      </label>

      <div class="note">
        DeepSeek 默认接口为 https://api.deepseek.com/chat/completions，默认模型为 deepseek-chat。出现 401 时，通常是服务商选错、Key 不完整或模型/权限不匹配。
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

input,
select {
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
