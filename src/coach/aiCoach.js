export const REVIEW_SECTION_PROMPTS = [
  {
    title: '开盘背景',
    prompt: '判断当前交易日或当前复盘窗口的开盘背景，包括 EMA20/EMA200 位置、开盘方向、是否有 Spike、Climax、缺口或早盘主导方向。'
  },
  {
    title: '市场周期转换识别',
    prompt: '按 Al Brooks 价格行为框架判断市场当前处于趋势、趋势后的 Trading Range、反转尝试、突破回测、通道、铁丝网或区间中部，并说明 Always In 多空状态。'
  },
  {
    title: '逐K分析',
    prompt: '从选中交易入场点前后开始逐段分析 K 线，使用 Bar 编号描述关键 Swing、信号棒、入场棒、跟随棒、失败突破、二次信号、Measured Move 和强弱转换。'
  },
  {
    title: '本次交易Setup',
    prompt: '围绕这笔交易说明入场类型、信号质量、入场价格是否合理、止损位置、第一目标、第二目标、盈亏比、管理方式和是否符合 Brooks 交易逻辑。'
  },
  {
    title: '操作建议',
    prompt: '给出具体可执行管理建议，包括是否应持有、减仓、移止损、等待跟随、快速退出或避免在区间中部追单。'
  },
  {
    title: '常见错误提醒',
    prompt: '指出这笔交易中可能存在的典型错误，例如追在 Climax 后、把区间当趋势、忽略二次入场、没有等待跟随、止损不在结构失效位。'
  },
  {
    title: '总结',
    prompt: '用简洁结论总结这笔交易的质量、主要优势、最大问题、下次同类场景的执行规则，并给出 0-100 分评分依据。'
  }
]

export function buildAiReviewRequest(payload) {
  return {
    systemPrompt: [
      '你是一名专注 Al Brooks 价格行为交易的复盘教练。',
      '你的任务是基于用户选中的单笔历史交易，从入场点开始分析当下市场周期、多空力量、价格行为和交易管理。',
      '请使用中文，保留必要英文术语，例如 Always In、Trading Range、Bull Signal Bar、Second Entry、Measured Move、Climax。',
      '不要泛泛而谈，要引用 Bar 编号、价格、方向、盈亏、入场和出场信息。',
      '输出必须是结构化 JSON，不要输出 Markdown。'
    ].join('\n'),
    sectionPrompts: REVIEW_SECTION_PROMPTS,
    outputSchema: {
      summary: '一句话核心结论',
      score: '0-100 的数字评分',
      sections: [
        {
          title: '章节标题',
          body: '可选，段落分析',
          items: ['可选，条目列表']
        }
      ],
      issues: [
        {
          severity: 'info | warn | danger',
          title: '问题标题',
          detail: '问题细节'
        }
      ],
      suggestions: ['具体操作建议']
    },
    payload
  }
}

function aiEndpoint() {
  if (typeof window === 'undefined') return ''
  return (window.localStorage.getItem('pa-ai-review-endpoint') || import.meta.env.VITE_AI_REVIEW_ENDPOINT || '').trim()
}

function aiProvider() {
  if (typeof window === 'undefined') return 'deepseek'
  return (window.localStorage.getItem('pa-ai-provider') || 'deepseek').trim()
}

function aiApiKey() {
  if (typeof window === 'undefined') return ''
  return (
    window.localStorage.getItem('pa-ai-api-key') ||
    window.localStorage.getItem('pa-openai-api-key') ||
    ''
  ).trim()
}

function aiModel(provider) {
  if (typeof window === 'undefined') return ''
  const saved = (
    window.localStorage.getItem('pa-ai-model') ||
    window.localStorage.getItem('pa-openai-model') ||
    ''
  ).trim()
  if (saved) return saved
  if (provider === 'deepseek') return 'deepseek-chat'
  return ''
}

function isOpenAiEndpoint(endpoint) {
  return /^https:\/\/api\.openai\.com\/v1\//i.test(endpoint)
}

function defaultChatEndpoint(provider) {
  if (provider === 'deepseek') return 'https://api.deepseek.com/chat/completions'
  return 'https://api.openai.com/v1/chat/completions'
}

async function readErrorMessage(res) {
  try {
    const data = await res.json()
    return data?.error?.message || data?.message || ''
  } catch (err) {
    return ''
  }
}

function authErrorMessage(prefix, message = '') {
  return `${prefix}: 401。请检查 AI设置 中的服务商、API Key、模型名是否对应。DeepSeek 请选“DeepSeek”，只填写 DeepSeek API Key，模型可用 deepseek-chat。${message ? ` 原始信息: ${message}` : ''}`
}

function normalizeFeedback(data, payload) {
  const raw = data?.feedback || data
  return {
    createdAt: new Date().toISOString(),
    summary: raw?.summary || 'AI 已返回点评，但缺少 summary 字段。',
    score: Number.isFinite(Number(raw?.score)) ? Number(raw.score) : undefined,
    sections: Array.isArray(raw?.sections) ? raw.sections : [],
    issues: Array.isArray(raw?.issues) ? raw.issues : [],
    suggestions: Array.isArray(raw?.suggestions) ? raw.suggestions : [],
    source: 'ai',
    payloadPreview: {
      barsUsed: payload.contextBars?.length || 0,
      openPositions: payload.openPositions?.length || 0,
      selectedTradeId: payload.selectedTrade?.id,
      currentClose: payload.currentBar?.close
    }
  }
}

export async function requestAiCoachFeedback(payload) {
  const provider = aiProvider()
  const endpoint = aiEndpoint()
  const apiKey = aiApiKey()
  const model = aiModel(provider)

  if (provider === 'proxy') {
    if (!endpoint) {
      throw new Error('当前选择了“自定义代理”，但还没有填写 AI代理接口地址。')
    }
    return requestProxyEndpoint({ endpoint, payload })
  }

  if (endpoint && isOpenAiEndpoint(endpoint)) {
    if (!apiKey || !model) {
      throw new Error('检测到“AI代理接口地址”填写的是 OpenAI 官方地址。如果你用 DeepSeek，请清空代理接口并选择 DeepSeek；如果用 OpenAI，请选择 OpenAI 并填写 Key 与模型名。')
    }
    return requestOpenAiCompatible({ endpoint, apiKey, model, provider: 'openai', payload })
  }

  if (apiKey && model) {
    return requestOpenAiCompatible({
      endpoint: defaultChatEndpoint(provider),
      apiKey,
      model,
      provider,
      payload
    })
  }

  if (!endpoint) {
    return {
      createdAt: new Date().toISOString(),
      summary: 'AI 点评未配置。请在顶部“AI设置”里选择 DeepSeek，并填写 DeepSeek API Key。模型默认 deepseek-chat。',
      score: undefined,
      sections: [
        {
          title: 'AI 接入方式',
          items: [
            'DeepSeek: 选择 DeepSeek，填写 DeepSeek API Key，模型默认 deepseek-chat。',
            'OpenAI: 选择 OpenAI，填写 OpenAI API Key 和模型名。',
            '自定义代理: 选择自定义代理，填写你自己的后端接口地址。'
          ]
        },
        {
          title: '点评 Prompt 模块',
          items: REVIEW_SECTION_PROMPTS.map(section => `${section.title}: ${section.prompt}`)
        }
      ],
      issues: [{ severity: 'warn', title: 'AI未配置', detail: '当前没有可用 AI 点评接口，因此没有执行实时分析。' }],
      suggestions: ['配置 AI 点评接口后，再点击成交历史中的“点评”。'],
      source: 'ai-unconfigured',
      payloadPreview: {
        barsUsed: payload.contextBars?.length || 0,
        openPositions: payload.openPositions?.length || 0,
        selectedTradeId: payload.selectedTrade?.id,
        currentClose: payload.currentBar?.close
      }
    }
  }

  return requestProxyEndpoint({ endpoint, payload })
}

async function requestProxyEndpoint({ endpoint, payload }) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAiReviewRequest(payload))
  })
  if (!res.ok) {
    const message = await readErrorMessage(res)
    if (res.status === 401) throw new Error(authErrorMessage('AI 点评接口鉴权失败', message))
    throw new Error(`AI 点评接口请求失败: ${res.status}${message ? ` ${message}` : ''}`)
  }
  return normalizeFeedback(await res.json(), payload)
}

async function requestOpenAiCompatible({ endpoint, apiKey, model, provider, payload }) {
  const body = buildAiReviewRequest(payload)
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: body.systemPrompt },
        {
          role: 'user',
          content: JSON.stringify({
            sectionPrompts: body.sectionPrompts,
            outputSchema: body.outputSchema,
            payload: body.payload
          })
        }
      ]
    })
  })
  if (!res.ok) {
    const message = await readErrorMessage(res)
    if (res.status === 401) throw new Error(authErrorMessage(`${provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'} 鉴权失败`, message))
    throw new Error(`${provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'} 请求失败: ${res.status}${message ? ` ${message}` : ''}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content || '{}'
  return normalizeFeedback(JSON.parse(content), payload)
}
