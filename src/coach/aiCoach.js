import { selectRuleCardsForReview } from './ruleCards.js'

export const REVIEW_SECTION_PROMPTS = [
  {
    title: '短背景判断',
    prompt: '用3-5句判断当前交易背景：趋势/Trading Range/反转尝试/Climax后、Always In倾向、多空力量是否清晰。必须引用Bar编号或价格行为证据。'
  },
  {
    title: '逐K或分段分析',
    prompt: '围绕入场前后关键Bar做逐K或分段分析，说明多空力量、突破/失败突破、跟随、重叠、信号棒和入场棒。不要泛泛描述。'
  },
  {
    title: 'Setup评价',
    prompt: '评价这笔交易的入场是否成立：位置、信号质量、是否追单、是否有二次信号或突破回测、失败条件是否清晰。'
  },
  {
    title: '交易管理评价',
    prompt: '评价止损、止盈、减仓、退出和持仓预期是否符合价格行为结构，区分Scalp和Swing，不要结果论。'
  },
  {
    title: '关键错误假设',
    prompt: '明确指出用户当时最可能错在哪里，并说明证据。若证据不足，必须写证据不足，不能强行判断。'
  },
  {
    title: '下次执行标准',
    prompt: '给出下次同类场景必须检查的具体条件，不超过5条。'
  },
  {
    title: '错误标签',
    prompt: '输出可统计的错误标签，例如区间中部追单、突破缺少跟随、逆Always In、盈利单结果论、证据不足。'
  }
]

export async function buildAiReviewRequest(payload) {
  const matchedRuleCards = (await selectRuleCardsForReview(payload)).map(card => ({
    name: card.name,
    category: card.category,
    scenarios: card.scenarios,
    evidence: card.evidence,
    commonMistakes: card.commonMistakes,
    reviewQuestions: card.reviewQuestions,
    mistakeTag: card.mistakeTag
  }))
  return {
    systemPrompt: [
      '你是一名专注 Al Brooks 价格行为交易的复盘教练。',
      '你的任务不是夸奖用户，也不是生成好看的行情解读，而是帮助用户发现复盘中自洽但错误的交易逻辑。',
      '你必须基于用户选中的单笔历史交易，从入场点附近开始分析当下市场周期、多空力量、价格行为和交易管理。',
      '默认 contextBars 是以 selectedTrade.entryBarLabel 为中心的入场前后窗口，通常包含入场前最多80根与入场后最多80根K线。',
      '分析顺序应先看入场前背景，再看入场棒与入场后跟随，不要直接跳到盈亏结果。',
      '请使用中文，保留必要英文术语，例如 Always In、Trading Range、Bull Signal Bar、Second Entry、Measured Move、Climax。',
      '每个关键判断必须引用 Bar 编号、价格行为证据或 ruleCards 中的规则名。',
      '引用K线时只能使用 payload.contextBars[].displayLabel、selectedTrade.entryBarLabel 或 selectedTrade.exitBarLabel，例如 Bar37。',
      '禁止引用 payload.contextBars 中不存在的Bar编号；如果找不到对应证据，必须写“证据不足”。',
      'payload.contextBars[].time 是机器时间戳，禁止写成 Bar1773262800 这类时间戳编号。',
      '禁止泛泛而谈，禁止只因为盈利就认定交易正确，也禁止只因为亏损就认定交易错误。',
      '使用概率化表达，例如“更像60/40的交易区间环境”，不要把不确定判断说成绝对结论。',
      '如果证据不足，必须明确写“证据不足”，不能强行判断。',
      '输出必须是结构化 JSON，不要输出 Markdown，不要输出 JSON 以外的文字。'
    ].join('\n'),
    sectionPrompts: REVIEW_SECTION_PROMPTS,
    outputSchema: {
      summary: '一句话核心结论',
      verdictProbability: {
        label: '优质 | 可做但一般 | 不该做 | 证据不足',
        probabilityText: '例如 多头胜率约55%，但不适合Swing管理',
        confidence: '0-100 数字，表示本次判断置信度'
      },
      keyWrongAssumption: {
        title: '用户当时最可能错误假设',
        detail: '说明错误逻辑',
        evidence: ['必须引用Bar编号/价格行为/规则名']
      },
      scores: {
        context: '背景判断 0-100',
        setup: 'Setup质量 0-100',
        management: '交易管理 0-100',
        discipline: '执行纪律 0-100',
        total: '总分 0-100'
      },
      evidence: [
        {
          ref: 'Bar编号或规则名',
          point: '这条证据说明什么'
        }
      ],
      ruleRefs: ['引用的规则名'],
      mistakeTags: ['可统计的错误标签'],
      sections: [
        {
          title: '短背景判断 | 逐K或分段分析 | Setup评价 | 交易管理评价 | 下次执行标准',
          body: '段落分析',
          items: ['可选条目']
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
    ruleCards: matchedRuleCards,
    payload: {
      ...payload,
      ruleCards: matchedRuleCards,
      costMode: Number(payload?.selectedTrade?.pnl || 0) < 0 ? 'loss-medium' : 'win-compact'
    }
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
  const scores = raw?.scores && typeof raw.scores === 'object' ? raw.scores : {}
  const totalScore = scores.total ?? raw?.score
  return {
    createdAt: new Date().toISOString(),
    summary: raw?.summary || 'AI 已返回点评，但缺少 summary 字段。',
    score: Number.isFinite(Number(totalScore)) ? Number(totalScore) : undefined,
    verdictProbability: raw?.verdictProbability || null,
    keyWrongAssumption: raw?.keyWrongAssumption || null,
    scores,
    evidence: Array.isArray(raw?.evidence) ? raw.evidence : [],
    ruleRefs: Array.isArray(raw?.ruleRefs) ? raw.ruleRefs : [],
    mistakeTags: Array.isArray(raw?.mistakeTags) ? raw.mistakeTags : [],
    sections: Array.isArray(raw?.sections) ? raw.sections : [],
    issues: Array.isArray(raw?.issues) ? raw.issues : [],
    suggestions: Array.isArray(raw?.suggestions) ? raw.suggestions : [],
    source: 'ai',
    payloadPreview: {
      barsUsed: payload.contextBars?.length || 0,
      openPositions: payload.openPositions?.length || 0,
      selectedTradeId: payload.selectedTrade?.id,
      currentClose: payload.currentBar?.close,
      ruleCards: payload.ruleCards?.map(card => card.name) || [],
      costMode: payload.costMode || ''
    }
  }
}

export async function requestAiCoachFeedback(payload) {
  const provider = aiProvider()
  const endpoint = aiEndpoint()
  const apiKey = aiApiKey()
  const model = aiModel(provider)
  const requestBody = await buildAiReviewRequest(payload)
  const reviewPayload = requestBody.payload

  if (provider === 'proxy') {
    if (!endpoint) {
      throw new Error('当前选择了“自定义代理”，但还没有填写 AI代理接口地址。')
    }
    return requestProxyEndpoint({ endpoint, body: requestBody })
  }

  if (endpoint && isOpenAiEndpoint(endpoint)) {
    if (!apiKey || !model) {
      throw new Error('检测到“AI代理接口地址”填写的是 OpenAI 官方地址。如果你用 DeepSeek，请清空代理接口并选择 DeepSeek；如果用 OpenAI，请选择 OpenAI 并填写 Key 与模型名。')
    }
    return requestOpenAiCompatible({ endpoint, apiKey, model, provider: 'openai', body: requestBody })
  }

  if (apiKey && model) {
    return requestOpenAiCompatible({
      endpoint: defaultChatEndpoint(provider),
      apiKey,
      model,
      provider,
      body: requestBody
    })
  }

  if (!endpoint) {
    return {
      createdAt: new Date().toISOString(),
      summary: 'AI 点评未配置。请在顶部“AI设置”里选择 DeepSeek，并填写 DeepSeek API Key。模型默认 deepseek-chat。',
      score: undefined,
      verdictProbability: {
        label: '证据不足',
        probabilityText: '未调用AI模型，无法判断交易质量。',
        confidence: 0
      },
      keyWrongAssumption: {
        title: 'AI未配置',
        detail: '当前没有执行实时纠偏点评。',
        evidence: ['请先配置 DeepSeek API Key。']
      },
      scores: {},
      evidence: [],
      ruleRefs: reviewPayload.ruleCards?.map(card => card.name) || [],
      mistakeTags: ['AI未配置'],
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
        barsUsed: reviewPayload.contextBars?.length || 0,
        openPositions: reviewPayload.openPositions?.length || 0,
        selectedTradeId: reviewPayload.selectedTrade?.id,
        currentClose: reviewPayload.currentBar?.close,
        ruleCards: reviewPayload.ruleCards?.map(card => card.name) || [],
        costMode: reviewPayload.costMode || ''
      }
    }
  }

  return requestProxyEndpoint({ endpoint, body: requestBody })
}

async function requestProxyEndpoint({ endpoint, body }) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const message = await readErrorMessage(res)
    if (res.status === 401) throw new Error(authErrorMessage('AI 点评接口鉴权失败', message))
    throw new Error(`AI 点评接口请求失败: ${res.status}${message ? ` ${message}` : ''}`)
  }
  return normalizeFeedback(await res.json(), body.payload)
}

async function requestOpenAiCompatible({ endpoint, apiKey, model, provider, body }) {
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
  return normalizeFeedback(JSON.parse(content), body.payload)
}
