// Stats for the trade journal, computed straight from `trades` rows.
//
// Most rows carry their story in `notes`, written by the Robinhood importer:
//   "META · 45 sh · bought 8/18/26 for $24,486.55 → sold 8/21/26 for $24,873.01"
//   "SLV $73 Call 7/17/26 · 4 contracts · bought 5/15/26 for $2,000.16 → expired worthless 7/17/26"
// Rows added later may only have "bought for $X → sold M/D/YY", and hand-typed
// rows may just be a ticker. Everything below degrades gracefully: a row with
// no buy date simply drops out of the holding-time breakdown.
//
// Interest and dividend rows ("Interest · Oct 2026 · …", "Dividends · …") live
// in the same table but are income, not trades, so they are split out.

const INCOME = /^(Interest|Dividends) ·/
const OPTION = /\$\d+(?:\.\d+)? (?:Call|Put)\b/
const DATE = '(\\d{1,2}/\\d{1,2}/\\d{2})'
const BUY_DATES = new RegExp(`bought ${DATE}(?:–${DATE})?`)
const SELL_DATE = new RegExp(`(?:sold|expired worthless) ${DATE}`)
const COST = /bought[^$→]*for \$([\d,]+\.\d{2})/

export const isIncomeRow = row => INCOME.test(row.notes || '')

const sumBy = (list, f) => list.reduce((s, x) => s + f(x), 0)
const fromMDY = s => {
  const [m, d, y] = s.split('/').map(Number)
  return new Date(2000 + y, m - 1, d)
}
// trade_date is a plain YYYY-MM-DD; build it locally so it never slides a day.
const fromISO = iso => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))

export function parseTrade(row) {
  const notes = row.notes || ''
  const buy = notes.match(BUY_DATES)
  const sell = notes.match(SELL_DATE)
  const cost = notes.match(COST)
  const soldOn = sell ? fromMDY(sell[1]) : fromISO(row.trade_date)
  // "bought 1/15/26–7/24/26" is several lots. Measure from the last buy so an
  // early starter position doesn't stretch a short swing into a long hold.
  const lastBuy = buy ? fromMDY(buy[2] || buy[1]) : null
  return {
    id: row.id,
    date: row.trade_date,
    pl: Number(row.profit_loss) || 0,
    symbol: notes.split(/[\s·$]/)[0] || 'Untitled',
    isOption: OPTION.test(notes),
    cost: cost ? Number(cost[1].replace(/,/g, '')) : null,
    daysHeld: lastBuy ? Math.max(0, Math.round((soldOn - lastBuy) / 864e5)) : null,
  }
}

const HOLD_BUCKETS = [
  { label: 'Same or next day', max: 1 },
  { label: '2–7 days', max: 7 },
  { label: '8–30 days', max: 30 },
  { label: '1–6 months', max: 182 },
  { label: 'Over 6 months', max: Infinity },
]

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

function summarize(list) {
  const n = list.length
  const wins = list.filter(t => t.pl > 0).length
  return { n, pl: sumBy(list, t => t.pl), winRate: n ? wins / n : 0 }
}

function groupBy(list, key) {
  const map = new Map()
  for (const item of list) {
    const k = key(item)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(item)
  }
  return map
}

// rows: every `trades` row for the user.
// range: { from, to } as inclusive YYYY-MM-DD strings; leave either out for open-ended.
export function computeStats(rows, { from = null, to = null } = {}) {
  const inScope = r => (!from || r.trade_date >= from) && (!to || r.trade_date <= to)
  const scoped = rows.filter(inScope)

  const trades = scoped
    .filter(r => !isIncomeRow(r))
    .map(parseTrade)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  const incomeRows = scoped.filter(isIncomeRow)
  const income = {
    dividends: sumBy(incomeRows.filter(r => r.notes.startsWith('Dividends')), r => Number(r.profit_loss)),
    interest: sumBy(incomeRows.filter(r => r.notes.startsWith('Interest')), r => Number(r.profit_loss)),
  }

  const wins = trades.filter(t => t.pl > 0)
  const losses = trades.filter(t => t.pl < 0)
  const grossWin = sumBy(wins, t => t.pl)
  const grossLoss = -sumBy(losses, t => t.pl)
  const best = trades.reduce((a, t) => (!a || t.pl > a.pl ? t : a), null)
  const worst = trades.reduce((a, t) => (!a || t.pl < a.pl ? t : a), null)

  // Day-by-day running total, and the deepest peak-to-trough drop in it.
  const byDay = [...groupBy(trades, t => t.date)].map(([date, list]) => ({ date, pl: sumBy(list, t => t.pl) }))
  let running = 0
  let peak = 0
  let peakDate = null // null = the $0 starting point, before the first trade
  const drawdown = { amount: 0, from: null, to: null }
  const curve = byDay.map(d => {
    running += d.pl
    if (running > peak) { peak = running; peakDate = d.date }
    if (peak - running > drawdown.amount) {
      drawdown.amount = peak - running
      drawdown.from = peakDate
      drawdown.to = d.date
    }
    return { date: d.date, dayPL: d.pl, total: running }
  })

  // Winning/losing streaks counted in trading days, not individual rows.
  let longestGreen = 0
  let streak = 0
  for (const d of byDay) {
    streak = d.pl > 0 ? streak + 1 : 0
    longestGreen = Math.max(longestGreen, streak)
  }

  const months = [...groupBy(trades, t => t.date.slice(0, 7))].map(([key, list]) => {
    const d = fromISO(`${key}-01`)
    return {
      key,
      label: `${d.toLocaleString('en-US', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`,
      ...summarize(list),
    }
  })

  // Short periods (a week, a month) read better as daily bars than one or two monthly ones.
  const days = [...groupBy(trades, t => t.date)].map(([key, list]) => ({
    key,
    label: fromISO(key).toLocaleString('en-US', { month: 'short', day: 'numeric' }),
    ...summarize(list),
  }))

  const symbols = [...groupBy(trades, t => t.symbol)]
    .map(([symbol, list]) => ({ symbol, ...summarize(list) }))
    .sort((a, b) => b.pl - a.pl)

  const timed = trades.filter(t => t.daysHeld != null)
  const holding = HOLD_BUCKETS.map((b, i) => {
    const min = i === 0 ? 0 : HOLD_BUCKETS[i - 1].max + 1
    return { label: b.label, ...summarize(timed.filter(t => t.daysHeld >= min && t.daysHeld <= b.max)) }
  })
  const sortedDays = timed.map(t => t.daysHeld).sort((a, b) => a - b)
  const medianDaysHeld = sortedDays.length ? sortedDays[Math.floor(sortedDays.length / 2)] : null

  const types = [
    { label: 'Stocks & ETFs', ...summarize(trades.filter(t => !t.isOption)) },
    { label: 'Options', ...summarize(trades.filter(t => t.isOption)) },
  ]

  const byWeekday = groupBy(trades, t => fromISO(t.date).getDay())
  const weekdays = WEEKDAYS.map((label, i) => ({ label, ...summarize(byWeekday.get(i + 1) ?? []) }))

  return {
    count: trades.length,
    net: sumBy(trades, t => t.pl),
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : null,
    best,
    worst,
    drawdown,
    greenDayRate: byDay.length ? byDay.filter(d => d.pl > 0).length / byDay.length : 0,
    tradingDays: byDay.length,
    longestGreen,
    curve,
    months,
    days,
    symbols,
    holding,
    timedCount: timed.length,
    medianDaysHeld,
    types,
    weekdays,
    income,
  }
}
