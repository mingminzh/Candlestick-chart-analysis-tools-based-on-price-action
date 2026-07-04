const BUILTIN_RULE_CARDS = [
  {
    id: 'TR-CHASE-MIDDLE-001',
    name: 'TR-追单-区间中部禁止',
    category: '交易区间与追单',
    scenarios: ['Trading Range', '区间中部', '追单', '跟随不足'],
    appliesTo: ['long', 'short'],
    evidence: [
      '入场前多根K线重叠、影线增多或连续突破缺少跟随',
      '价格位于近期高低点中间区域，而不是区间边缘',
      '入场依据主要来自单根大阳/大阴，而不是二次信号或突破回测'
    ],
    commonMistakes: [
      '把区间中部的一根趋势棒当作趋势恢复',
      '忽略前面已经出现的 Climax 或双向交易',
      '没有等待突破后跟随，直接在中部追单'
    ],
    reviewQuestions: [
      '入场点是否在区间中部，而不是接近区间边缘？',
      '突破后是否有第二根以上同向跟随棒？',
      '如果下一根反向收回突破位，原交易假设是否立即失效？'
    ],
    mistakeTag: '区间中部追单'
  },
  {
    id: 'TR-FOLLOW-FAIL-001',
    name: 'TR-突破-缺少跟随',
    category: '交易区间与追单',
    scenarios: ['突破', '失败突破', '跟随不足', 'Trading Range'],
    appliesTo: ['long', 'short'],
    evidence: [
      '突破棒之后没有连续同向收盘',
      '突破很快被反向K线收回',
      '突破发生在此前重叠较多或双向交易之后'
    ],
    commonMistakes: [
      '看到突破就假设进入趋势',
      '忽略突破后没有跟随代表对手方仍然活跃',
      '把应当快速降级的 scalp 当成 swing 管理'
    ],
    reviewQuestions: [
      '突破后第一根和第二根是否给出有效跟随？',
      '突破失败时是否及时降低持仓预期？',
      '止损是否放在结构失效位，而不是随机金额位置？'
    ],
    mistakeTag: '突破缺少跟随'
  },
  {
    id: 'TR-RESULT-BIAS-001',
    name: '复盘-盈利单防结果论',
    category: '交易质量评估',
    scenarios: ['盈利单', '结果论', '过程质量'],
    appliesTo: ['long', 'short'],
    evidence: [
      '交易虽然盈利，但入场前背景证据不足',
      '盈利来自短期波动触及目标，而不是清晰setup后的跟随',
      '止损或目标设置没有对应价格行为结构'
    ],
    commonMistakes: [
      '因为盈利就把入场逻辑合理化',
      '忽略同样方式在更多样本里可能没有正期望',
      '把运气好的 scalp 复盘成高质量 swing'
    ],
    reviewQuestions: [
      '如果这笔单亏损，同样的入场理由是否仍成立？',
      '入场前是否有足够背景和信号证据？',
      '这笔盈利是否可以复制，还是只来自结果偏差？'
    ],
    mistakeTag: '盈利单结果论'
  }
]

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch (err) {
    return fallback
  }
}

function localRuleCards() {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem('pa-rule-cards')
  const parsed = raw ? safeJsonParse(raw, []) : []
  return Array.isArray(parsed) ? parsed : []
}

let privateRuleCardsCache = null

async function privateRuleCards() {
  if (privateRuleCardsCache) return privateRuleCardsCache
  if (typeof window === 'undefined' || !window.priceActionKnowledge?.readRuleCards) {
    privateRuleCardsCache = []
    return privateRuleCardsCache
  }
  try {
    const result = await window.priceActionKnowledge.readRuleCards()
    privateRuleCardsCache = Array.isArray(result?.cards) ? result.cards : []
    if (result?.errors?.length) {
      console.warn('私有规则卡读取存在错误:', result.errors)
    }
  } catch (err) {
    console.warn('读取私有规则卡失败:', err)
    privateRuleCardsCache = []
  }
  return privateRuleCardsCache
}

function tradeDirection(payload) {
  return payload?.selectedTrade?.side || ''
}

function textHaystack(payload) {
  const trade = payload?.selectedTrade || {}
  const review = payload?.review || {}
  const pnlText = Number(trade.pnl || 0) > 0 ? '盈利单' : Number(trade.pnl || 0) < 0 ? '亏损单' : '保本单'
  return [
    pnlText,
    trade.side,
    trade.exitReason,
    trade.entryType,
    trade.orderType,
    review.marketState,
    review.tradePlan,
    review.alwaysIn,
    review.signalQuality,
    review.invalidation,
    review.note,
    payload?.currentBar?.close
  ].filter(Boolean).join(' ').toLowerCase()
}

function cardSearchText(card) {
  return [
    card.id,
    card.name,
    card.category,
    card.summary,
    card.trigger,
    ...(card.scenarios || []),
    ...(card.evidence || []),
    ...(card.commonMistakes || []),
    ...(card.reviewQuestions || []),
    ...(card.mistakeTags || []),
    card.mistakeTag
  ].filter(Boolean).join(' ').toLowerCase()
}

const KEYWORD_GROUPS = [
  ['交易区间', 'trading range', 'tr', '区间', '震荡', '横盘'],
  ['突破', 'breakout', 'bo', '跟随', '假突破', '失败突破'],
  ['趋势', 'trend', 'always in', 'ai', '通道', 'channel'],
  ['反转', 'reversal', '大反转', '小反转', 'major reversal', 'minor reversal'],
  ['楔形', 'wedge', '三推', '三次推动'],
  ['双顶', 'double top', '双底', 'double bottom', '颈线'],
  ['末端旗形', 'final flag', '末端', '旗形'],
  ['高潮', 'climax', '抢购高潮', '抛售高潮', '衰竭'],
  ['止损', 'stop', '保护性止损', '失效'],
  ['止盈', 'target', '目标', 'measured move', 'mm', '测量'],
  ['剥头皮', 'scalp', '波段', 'swing', '管理'],
  ['第二入场', 'second entry', '二次信号', '高二', '低二'],
  ['追单', 'chase', '区间中部', 'middle'],
  ['概率', 'probability', '盈亏比', '风险', '仓位']
]

function cardScore(card, payload) {
  const direction = tradeDirection(payload)
  const haystack = textHaystack(payload)
  const cardText = cardSearchText(card)
  let score = 0
  if (!card.appliesTo?.length || card.appliesTo.includes(direction)) score += 1
  for (const word of card.scenarios || []) {
    if (haystack.includes(String(word).toLowerCase())) score += 2
  }
  for (const group of KEYWORD_GROUPS) {
    const hasPayloadKeyword = group.some(word => haystack.includes(word.toLowerCase()))
    const hasCardKeyword = group.some(word => cardText.includes(word.toLowerCase()))
    if (hasPayloadKeyword && hasCardKeyword) score += 3
  }
  for (const field of [card.name, card.category, card.mistakeTag]) {
    const value = String(field || '').toLowerCase()
    if (value && haystack.includes(value)) score += 3
  }
  if (Number(payload?.selectedTrade?.pnl || 0) > 0 && card.id === 'TR-RESULT-BIAS-001') score += 3
  if (Number(payload?.selectedTrade?.pnl || 0) < 0) {
    if (card.category === '交易区间与追单') score += 1
    if (cardText.includes('止损') || cardText.includes('管理') || cardText.includes('失败')) score += 1
  }
  return score
}

export async function selectRuleCardsForReview(payload, limit = 8) {
  const cards = [
    ...BUILTIN_RULE_CARDS,
    ...localRuleCards(),
    ...await privateRuleCards()
  ]
  return cards
    .map(card => ({ ...card, matchScore: cardScore(card, payload) }))
    .filter(card => card.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit)
}
