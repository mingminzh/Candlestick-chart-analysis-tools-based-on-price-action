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
  return window.localStorage.getItem('pa-ai-review-endpoint') || import.meta.env.VITE_AI_REVIEW_ENDPOINT || ''
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
  const endpoint = aiEndpoint()
  if (!endpoint) {
    return {
      createdAt: new Date().toISOString(),
      summary: 'AI 点评接口未配置。请设置 localStorage: pa-ai-review-endpoint，或配置 VITE_AI_REVIEW_ENDPOINT。',
      score: undefined,
      sections: [
        {
          title: 'AI 接入方式',
          items: [
            '前端会向配置的接口 POST 结构化复盘上下文和提示词。',
            '接口应返回 JSON: { summary, score, sections, issues, suggestions }。',
            '建议由后端代理调用 OpenAI，避免在浏览器暴露 API Key。'
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

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAiReviewRequest(payload))
  })
  if (!res.ok) {
    throw new Error(`AI 点评接口请求失败: ${res.status}`)
  }
  return normalizeFeedback(await res.json(), payload)
}
