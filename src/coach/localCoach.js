function directionFromPlan(plan) {
  if (plan === '做多') return 'long'
  if (plan === '做空') return 'short'
  return 'none'
}

function classifyCandle(bar) {
  if (!bar) return 'unknown'
  const range = Math.max(bar.high - bar.low, 0)
  if (!range) return 'flat'
  const body = Math.abs(bar.close - bar.open)
  const bodyRatio = body / range
  const closePos = (bar.close - bar.low) / range
  if (bodyRatio <= 0.25) return 'doji'
  if (bar.close > bar.open && closePos >= 0.65) return 'bull_trend'
  if (bar.close < bar.open && closePos <= 0.35) return 'bear_trend'
  return 'neutral'
}

function formatCandleLabel(kind) {
  return {
    doji: '十字星/小实体',
    bull_trend: '多头趋势棒',
    bear_trend: '空头趋势棒',
    neutral: '普通K线',
    flat: '平K线',
    unknown: '未知'
  }[kind] || kind
}

function pushIssue(issues, severity, title, detail) {
  issues.push({ severity, title, detail })
}

function ema(values, period) {
  if (!values.length) return []
  const k = 2 / (period + 1)
  const result = []
  let prev = values[0]
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[i] : values[i] * k + prev * (1 - k)
    result.push(prev)
  }
  return result
}

function barStrength(bar) {
  const range = Math.max(bar.high - bar.low, 0)
  if (!range) return 'Neutral'
  const body = Math.abs(bar.close - bar.open)
  const closePos = (bar.close - bar.low) / range
  if (bar.close > bar.open && body / range > 0.55 && closePos > 0.65) return 'Strong Bull'
  if (bar.close < bar.open && body / range > 0.55 && closePos < 0.35) return 'Strong Bear'
  if (body / range < 0.25) return 'Doji'
  return 'Medium'
}

function nearestIndexByTime(bars, time) {
  if (!time || !bars.length) return -1
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < bars.length; i++) {
    const dist = Math.abs(bars[i].time - time)
    if (dist < bestDist) {
      best = i
      bestDist = dist
    }
  }
  return best
}

function barSessionKey(time) {
  const d = new Date(time * 1000)
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
}

function buildBarNumberMap(bars) {
  const numbers = new Map()
  let count = 0
  let previousDay = ''
  bars.forEach((bar, index) => {
    const day = barSessionKey(bar.time)
    count = day !== previousDay ? 1 : count + 1
    previousDay = day
    numbers.set(index, count)
  })
  return numbers
}

function makeAiBar(bar, absoluteIndex, barNumbers) {
  const barNo = barNumbers.get(absoluteIndex) || absoluteIndex + 1
  return {
    barNo,
    displayLabel: `Bar${barNo}`,
    absoluteIndex,
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume
  }
}

function summarizeMarket(bars) {
  if (bars.length < 10) return '样本较少，优先观察最近K线的跟随和重叠。'
  const closes = bars.map(b => b.close)
  const ema20 = ema(closes, 20)
  const ema50 = ema(closes, 50)
  const last = bars[bars.length - 1]
  const e20 = ema20[ema20.length - 1]
  const e50 = ema50[ema50.length - 1]
  const recent = bars.slice(-20)
  const bull = recent.filter(b => b.close > b.open).length
  const bear = recent.length - bull
  const overlap = recent.filter((b, i) => i > 0 && b.high <= recent[i - 1].high && b.low >= recent[i - 1].low).length
  const emaText = last.close >= e20 && e20 >= e50
    ? '价格在EMA20上方且EMA20位于EMA50上方，多头仍有主动权。'
    : last.close <= e20 && e20 <= e50
      ? '价格在EMA20下方且EMA20位于EMA50下方，空头仍有主动权。'
      : '价格与均线纠缠，倾向Trading Range或趋势转换段。'
  return `${emaText} 最近20根多头棒${bull}根、空头棒${bear}根，重叠/内包约${overlap}处；若重叠继续增加，按Al Brooks思路应降低追单权重，优先等二次信号或突破后跟随。`
}

function makeSegments(bars) {
  const size = Math.max(5, Math.floor(bars.length / 4))
  const segments = []
  for (let start = 0; start < bars.length; start += size) {
    const part = bars.slice(start, Math.min(start + size, bars.length))
    if (part.length < 3) continue
    const first = part[0]
    const last = part[part.length - 1]
    const bull = part.filter(b => b.close > b.open).length
    const bear = part.length - bull
    const direction = last.close > first.open ? '上推' : last.close < first.open ? '下压' : '横盘'
    const label = `Bar${start + 1}~Bar${start + part.length}`
    const climax = part.some(b => {
      const range = b.high - b.low
      return range > 0 && Math.abs(b.close - b.open) / range > 0.7
    })
    segments.push({
      label,
      text: `${direction}段，多头棒${bull}根、空头棒${bear}根${climax ? '，包含较强趋势棒/可能的Climax。' : '，力度中等。'}`
    })
  }
  return segments.slice(-4)
}

export function buildCoachPayload({ bars, replayIndex, review, trades = [], positions = [], selectedTrade = null }) {
  const selectedOpenIndex = selectedTrade ? nearestIndexByTime(bars, selectedTrade.openTime) : -1
  const selectedCloseIndex = selectedTrade ? nearestIndexByTime(bars, selectedTrade.closeTime) : -1
  const focusEndIndex = selectedTrade && selectedOpenIndex >= 0
    ? Math.max(selectedOpenIndex, selectedCloseIndex >= 0 ? selectedCloseIndex : replayIndex)
    : replayIndex
  const start = Math.max(0, (selectedOpenIndex >= 0 ? selectedOpenIndex : focusEndIndex) - 80)
  const end = Math.min(bars.length - 1, Math.max(0, focusEndIndex))
  const barNumbers = buildBarNumberMap(bars)
  const contextBars = bars.slice(start, end + 1).map((bar, offset) => makeAiBar(bar, start + offset, barNumbers))
  const currentBar = bars[end] ? makeAiBar(bars[end], end, barNumbers) : null
  const recentTrades = trades.filter(t => t.closeTime && currentBar && t.closeTime <= currentBar.time).slice(-5)
  const selectedTradeWithBars = selectedTrade ? {
    ...selectedTrade,
    entryBarNo: selectedOpenIndex >= 0 ? barNumbers.get(selectedOpenIndex) : undefined,
    entryBarLabel: selectedOpenIndex >= 0 ? `Bar${barNumbers.get(selectedOpenIndex)}` : '',
    exitBarNo: selectedCloseIndex >= 0 ? barNumbers.get(selectedCloseIndex) : undefined,
    exitBarLabel: selectedCloseIndex >= 0 ? `Bar${barNumbers.get(selectedCloseIndex)}` : ''
  } : null
  return {
    replayIndex: end,
    currentBar,
    contextBars,
    review,
    openPositions: positions.map(p => ({ ...p })),
    recentTrades: recentTrades.map(t => ({ ...t })),
    selectedTrade: selectedTradeWithBars,
    barLabelGuide: '引用K线时只能使用 displayLabel/entryBarLabel/exitBarLabel，例如 Bar37；time 是机器时间戳，禁止写成 Bar1773262800。'
  }
}

export function generateLocalCoachFeedback(payload) {
  const { currentBar, contextBars, review, openPositions, selectedTrade } = payload
  const issues = []
  const strengths = []
  const suggestions = []
  const planDirection = directionFromPlan(review.tradePlan)
  const candleKind = classifyCandle(currentBar)
  const focusTrade = selectedTrade || openPositions[openPositions.length - 1] || null
  const focusSide = focusTrade?.side
  const focusEntry = focusTrade?.entryPrice
  const focusEntryIndex = focusTrade ? nearestIndexByTime(contextBars, focusTrade.openTime) : -1
  const focusEntryBar = focusEntryIndex >= 0 ? contextBars[focusEntryIndex] : currentBar

  if (!review.marketState) {
    pushIssue(issues, 'warn', '缺少上下文判断', '先判断趋势、通道、区间或铁丝网，再评价单根K线。')
  } else {
    strengths.push(`已先标记市场状态为「${review.marketState}」。`)
  }

  if (!review.barType) {
    pushIssue(issues, 'warn', '缺少K线角色', '建议区分结构棒、信号棒、入场棒或确认棒。')
  }

  if (!review.alwaysIn) {
    pushIssue(issues, 'info', 'Always In 未记录', '记录 Always In 有助于避免过早逆势。')
  }

  if (review.marketState === '铁丝网' && ['做多', '做空'].includes(review.tradePlan)) {
    pushIssue(issues, 'danger', '铁丝网中主动交易', 'Al Brooks 体系里铁丝网通常意味着低可读性，优先观望。')
  }

  if (review.marketState === '交易区间' && ['做多', '做空'].includes(review.tradePlan) && !review.invalidation) {
    pushIssue(issues, 'warn', '区间交易缺少失效位', '区间内交易需要非常清楚的失败条件，避免中部反复挨打。')
  }

  if (review.signalQuality === '低质量' && ['做多', '做空'].includes(review.tradePlan)) {
    pushIssue(issues, 'warn', '低质量信号仍计划入场', '低质量信号需要更强上下文或等待二次入场。')
  }

  if (review.tradePlan === '做多' && review.alwaysIn === '空') {
    pushIssue(issues, 'danger', '计划方向逆 Always In', '逆 Always In 做多需要更强反转证据，例如突破趋势线、二次入场和强反转棒。')
  }

  if (review.tradePlan === '做空' && review.alwaysIn === '多') {
    pushIssue(issues, 'danger', '计划方向逆 Always In', '逆 Always In 做空需要更强反转证据，不能只凭一根信号棒。')
  }

  if (['做多', '做空'].includes(review.tradePlan) && !review.invalidation) {
    pushIssue(issues, 'warn', '交易计划缺少失效条件', '入场前应明确价格到哪里说明判断错了。')
  }

  if (selectedTrade) {
    const pnl = Number(selectedTrade.pnl || 0)
    const barsHeld = selectedTrade.openTime && selectedTrade.closeTime && contextBars.length > 1
      ? Math.max(1, Math.round((selectedTrade.closeTime - selectedTrade.openTime) / Math.max(1, contextBars[1].time - contextBars[0].time)))
      : null
    if (pnl > 0) {
      strengths.push(`选中交易盈利 ${pnl.toFixed(2)}，先复盘入场是否来自清晰信号，而不是只看结果。`)
    } else if (pnl < 0) {
      pushIssue(issues, 'warn', '选中交易亏损', `这笔交易亏损 ${pnl.toFixed(2)}，重点检查入场前是否有失效位，以及出场是否执行原计划。`)
    } else {
      pushIssue(issues, 'info', '选中交易基本持平', '重点看是否过早进场、过早离场，或交易区间中部成本过高。')
    }
    if (barsHeld && barsHeld <= 2 && Math.abs(pnl) > 0) {
      suggestions.push('这笔单持仓时间很短，检查是否是在入场后马上被反向K线否定。')
    }
  }

  if (focusTrade && focusEntryBar) {
    const quality = barStrength(focusEntryBar)
    const directionText = focusSide === 'long' ? '多' : '空'
    suggestions.push(`本次${directionText}单的入场棒质量为 ${quality}，复盘重点应放在入场前5-20根是否支持这个方向，而不是只看入场后一两根。`)
  }

  if (!review.note || review.note.trim().length < 10) {
    pushIssue(issues, 'info', '判断理由偏短', '建议至少写出上下文、信号质量、跟随预期和风险。')
  }

  if (planDirection !== 'none' && ['bull_trend', 'bear_trend'].includes(candleKind)) {
    const candleDirection = candleKind === 'bull_trend' ? 'long' : 'short'
    if (planDirection === candleDirection) {
      strengths.push(`当前K线客观形态接近${formatCandleLabel(candleKind)}，与计划方向一致。`)
    } else {
      pushIssue(issues, 'warn', '计划方向与当前趋势棒相反', `当前K线接近${formatCandleLabel(candleKind)}，逆向计划需要等待更多确认。`)
    }
  }

  if (!issues.some(i => i.severity === 'danger' || i.severity === 'warn')) {
    suggestions.push('当前记录没有明显硬伤，下一步重点观察后续1-2根是否有跟随。')
  } else {
    suggestions.push('先修正最高风险项，再推进下一根；不要让单根形态覆盖市场上下文。')
  }

  if (contextBars.length >= 5) {
    const lastFive = contextBars.slice(-5)
    const overlapCount = lastFive.filter((bar, idx) => {
      if (idx === 0) return false
      const prev = lastFive[idx - 1]
      return bar.high <= prev.high && bar.low >= prev.low
    }).length
    if (overlapCount >= 2 && ['做多', '做空'].includes(review.tradePlan)) {
      pushIssue(issues, 'info', '近期重叠较多', '最近5根有多根内包/重叠，注意交易区间或铁丝网风险。')
    }
  }

  const segments = makeSegments(contextBars)
  const setupItems = focusTrade ? [
    `入场K线: ${focusEntryIndex >= 0 ? `Bar${focusEntryIndex + 1}` : '当前附近'}，入场价 ${Number(focusEntry || 0).toFixed(2)} ${focusSide === 'long' ? '上方' : '下方'}`,
    `方向: ${focusSide === 'long' ? '多' : '空'}，入场棒质量: ${focusEntryBar ? barStrength(focusEntryBar) : '未知'}`,
    focusTrade.tp ? `止盈: ${Number(focusTrade.tp).toFixed(2)}` : '止盈: 观察第一目标位/Measured Move后再决定是否移动保护',
    focusTrade.sl ? `止损: ${Number(focusTrade.sl).toFixed(2)}` : '止损: 应放在信号棒/结构位失效一侧，而不是随意金额止损'
  ] : ['当前没有选中成交或未平仓单，先在交易面板选择一笔成交，或先下单再生成点评。']

  return {
    createdAt: new Date().toISOString(),
    summary: focusTrade
      ? `本次点评围绕${focusSide === 'long' ? '多' : '空'}单展开：入场附近K线为${focusEntryBar ? formatCandleLabel(classifyCandle(focusEntryBar)) : '未知'}，当前市场背景为${review.marketState || '未标记'}。`
      : `当前K线客观形态：${formatCandleLabel(candleKind)}。你的计划：${review.tradePlan || '未选择'}。`,
    score: Math.max(0, 100 - issues.reduce((sum, issue) => sum + (issue.severity === 'danger' ? 30 : issue.severity === 'warn' ? 18 : 8), 0)),
    strengths,
    issues,
    suggestions,
    sections: [
      {
        title: '开盘背景',
        body: summarizeMarket(contextBars)
      },
      {
        title: '市场周期转换识别',
        body: `按Al Brooks框架，当前更应先判断是趋势延续、趋势后的Trading Range，还是Climax后的反转尝试。若连续重叠和影线增加，先按区间处理；若突破后有强跟随，才按趋势单管理。`
      },
      {
        title: '逐K分析',
        items: segments.map(s => `${s.label}: ${s.text}`)
      },
      {
        title: '本次交易Setup',
        items: setupItems
      },
      {
        title: '操作建议',
        items: [
          focusSide === 'long'
            ? '多单优先观察入场后是否出现连续Bull bars或突破前高后的跟随；若马上出现强Bear bar并跌回信号棒低点，说明多头跟随不足。'
            : focusSide === 'short'
              ? '空单优先观察入场后是否出现连续Bear bars或跌破前低后的跟随；若马上出现强Bull bar并收回突破位，说明空头跟随不足。'
              : '先等待清晰信号棒、二次入场或突破回测，不要在区间中部追单。',
          '第一目标可按最近Swing或Measured Move处理；到达第一目标后可减半，并把剩余仓位止损推到结构保护位。',
          '如果入场点处于EMA/区间中部，胜率通常依赖更强的跟随棒；没有跟随时应快速降级为Scalp或退出。'
        ]
      },
      {
        title: '常见错误提醒',
        items: [
          '把一根大阳/大阴当成无条件趋势开始，忽略前面是否已经Climax或进入Trading Range。',
          '在区间中部入场，却使用趋势单的持仓预期。',
          '没有把止损放在结构失效位，而是按心理金额随意止损。'
        ]
      }
    ],
    payloadPreview: {
      barsUsed: contextBars.length,
      openPositions: openPositions.length,
      selectedTradeId: selectedTrade?.id,
      currentClose: currentBar?.close
    }
  }
}
