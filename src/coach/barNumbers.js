export const INTRADAY_BAR_NUMBER_RESET = 'Asia/Shanghai 08:00'

export function chinaEightSessionKey(time) {
  const d = new Date(Number(time) * 1000)
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
}

export function buildBarNumberMap(bars) {
  const numbers = new Map()
  let count = 0
  let previousSession = ''
  bars.forEach((bar, index) => {
    const session = chinaEightSessionKey(bar.time)
    count = session !== previousSession ? 1 : count + 1
    previousSession = session
    numbers.set(index, count)
  })
  return numbers
}
