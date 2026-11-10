import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import { computeStats } from '../lib/tradeStats'
import { formatDate } from '../lib/format'
import WhatIfSell from './WhatIfSell'

// Chart marks use the validated blue/red diverging pair: the app's emerald/rose
// fail red-green colorblind separation (ΔE 4.6). Text values keep emerald/rose
// because they also carry a +/− sign, so color never works alone.
const GAIN = '#3987e5'
const LOSS = '#e66767'
const GRID = 'rgba(148, 163, 184, 0.12)'
const AXIS = '#94a3b8'
const TOOLTIP_STYLE = { backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 12, fontSize: 12 }

const whole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (v, fmt = whole) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt.format(Math.abs(v))}`
const pct = v => `${Math.round(v * 100)}%`
const plColor = v => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-300')
const shortAxis = v => (Math.abs(v) >= 1000 ? `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v) / 1000)}k` : `$${Math.round(v)}`)
// Round tick steps ($20k, not $19k) that always include $0. A small dip below
// zero (the first trade was a $274 loss) stays in view without dragging the
// axis down a whole step.
function niceAxis(values, target = 4) {
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const raw = (hi - lo) / target || 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw)
  const top = Math.ceil(hi / step) * step
  const bottom = lo < -step / 2 ? Math.floor(lo / step) * step : lo
  const ticks = []
  for (let t = Math.ceil(bottom / step) * step; t <= top + 1e-9; t += step) ticks.push(t + 0)
  return { domain: [bottom, top], ticks }
}

const tradeCount = (n, winRate) => (n ? `${n} trade${n === 1 ? '' : 's'} · ${pct(winRate)} won` : 'No trades')

// "Jun '24", not "Jun 24", which reads as a day of the month.
const monthYear = iso => {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00`)
  return `${d.toLocaleString('en-US', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`
}

const pad = n => String(n).padStart(2, '0')
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Rolling windows count back from today; a past year is that calendar year.
function periodRange(period, today = new Date()) {
  if (period === '1w') {
    const d = new Date(today)
    d.setDate(d.getDate() - 7)
    return { from: isoDay(d) }
  }
  if (period === '1m') {
    const d = new Date(today)
    d.setMonth(d.getMonth() - 1)
    return { from: isoDay(d) }
  }
  if (period === 'ytd') return { from: `${today.getFullYear()}-01-01` }
  if (period === 'all') return {}
  return { from: `${period}-01-01`, to: `${period}-12-31` }
}

const PERIOD_LABELS = { '1w': 'past week', '1m': 'past month', ytd: 'year to date', all: 'all time' }
const PERIOD_BUTTONS = [['1w', '1W'], ['1m', '1M'], ['ytd', 'YTD'], ['all', 'All']]

export default function TradeStats({ rows, whatIfSignal = 0 }) {
  const thisYear = new Date().getFullYear()
  const pastYears = useMemo(
    () => [...new Set(rows.map(r => Number(r.trade_date.slice(0, 4))))].filter(y => y < thisYear).sort((a, b) => b - a),
    [rows, thisYear],
  )
  const [period, setPeriod] = useState('ytd')
  const [showMonthTable, setShowMonthTable] = useState(false)
  const [showAllSymbols, setShowAllSymbols] = useState(false)
  const s = useMemo(() => computeStats(rows, periodRange(period)), [rows, period])
  // The what-if panel is about this year's tax bill whatever period is picked.
  const realizedThisYear = useMemo(() => computeStats(rows, { from: `${thisYear}-01-01` }).net, [rows, thisYear])

  const empty = s.count === 0
  const scopeLabel = PERIOD_LABELS[period] ?? period
  // A week or a month is a handful of bars as months, so switch to days.
  const daily = period === '1w' || period === '1m'
  const buckets = daily ? s.days : s.months
  const bucketWord = daily ? 'day' : 'month'
  const winners = s.symbols.filter(x => x.pl > 0)
  const losers = s.symbols.filter(x => x.pl < 0).reverse()
  const shownWinners = showAllSymbols ? winners : winners.slice(0, 8)
  const shownLosers = showAllSymbols ? losers : losers.slice(0, 5)
  const payoff = s.avgLoss ? s.avgWin / -s.avgLoss : null
  const curveAxis = niceAxis(s.curve.map(p => p.total))
  // Within about a year, label ticks by day ("Apr 9"); month labels repeat
  // when several ticks land in the same month.
  const spanDays = s.curve.length > 1
    ? (new Date(s.curve[s.curve.length - 1].date) - new Date(s.curve[0].date)) / 864e5
    : 0
  const curveTick = spanDays > 400
    ? monthYear
    : iso => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className="space-y-6">
      {/* One filter row scopes everything below it */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
        {[...PERIOD_BUTTONS, ...pastYears.map(y => [String(y), String(y)])].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setPeriod(value)}
            aria-pressed={period === value}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
              period === value ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Headline tiles */}
      {empty ? (
        <div className="card text-center text-slate-400">No closed trades in the {scopeLabel}.</div>
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Tile label="Realized P&L" value={signed(s.net)} valueClass={plColor(s.net)} sub={`${s.count} trades · ${scopeLabel}`} />
        <Tile label="Win rate" value={pct(s.winRate)} sub={`${s.wins} wins · ${s.losses} losses`} />
        <Tile
          label="Avg win / avg loss"
          value={<span className="flex flex-wrap items-baseline gap-x-1.5"><span className="text-emerald-400 whitespace-nowrap">{signed(s.avgWin)}</span><span className="text-slate-500">/</span><span className="text-rose-400 whitespace-nowrap">{signed(s.avgLoss)}</span></span>}
          sub={payoff ? `Wins are ${payoff.toFixed(2)}× the size of losses` : 'No losses yet'}
        />
        <Tile
          label="Profit factor"
          value={s.profitFactor ? s.profitFactor.toFixed(2) : '—'}
          sub={s.profitFactor ? `${cents.format(s.profitFactor)} made per $1 lost` : 'No losses yet'}
        />
        <Tile
          label="Best trade"
          value={signed(s.best.pl)}
          valueClass={plColor(s.best.pl)}
          sub={`${s.best.symbol} · ${formatDate(s.best.date)}`}
        />
        <Tile
          label="Worst trade"
          value={signed(s.worst.pl)}
          valueClass={plColor(s.worst.pl)}
          sub={`${s.worst.symbol}${s.worst.isOption ? ' option' : ''} · ${formatDate(s.worst.date)}`}
        />
        <Tile
          label="Max drawdown"
          value={s.drawdown.amount ? `−${whole.format(s.drawdown.amount)}` : '$0'}
          valueClass={s.drawdown.amount ? 'text-rose-400' : 'text-slate-300'}
          sub={s.drawdown.amount ? `${s.drawdown.from ? formatDate(s.drawdown.from) : 'Start'} → ${formatDate(s.drawdown.to)}` : 'Never dipped below a high'}
        />
        <Tile
          label="Green days"
          value={pct(s.greenDayRate)}
          sub={`${s.tradingDays} trading days · best run ${s.longestGreen} in a row`}
        />
      </div>
      )}

      <WhatIfSell journalRealized={realizedThisYear} year={thisYear} focusSignal={whatIfSignal} />

      {!empty && (<>
      {/* Running total */}
      <section className="card">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Cumulative realized P&L</h3>
            <p className="text-xs text-slate-400 mt-1">Running total of closed trades, {scopeLabel}</p>
          </div>
          <p className={`text-2xl font-bold ${plColor(s.net)}`}>{signed(s.net)}</p>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={s.curve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GAIN} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={GAIN} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: AXIS, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                minTickGap={40}
                tickFormatter={curveTick}
              />
              <YAxis
                tick={{ fill: AXIS, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={shortAxis}
                domain={curveAxis.domain}
                ticks={curveAxis.ticks}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={d => formatDate(d)}
                formatter={(v, name, item) => [
                  `${cents.format(v)} (day ${signed(item.payload.dayPL, cents)})`,
                  'Running total',
                ]}
                cursor={{ stroke: AXIS, strokeWidth: 1 }}
              />
              <Area type="monotone" dataKey="total" stroke={GAIN} strokeWidth={2} fill="url(#equityFill)" dot={false} activeDot={{ r: 4, stroke: '#0a0e27', strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Monthly bars (daily for short periods) */}
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white">{daily ? 'Daily' : 'Monthly'} P&L</h3>
            <p className="text-xs text-slate-400 mt-1">
              {buckets.filter(m => m.pl > 0).length} of {buckets.length} {bucketWord}s positive
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Legend />
            <button onClick={() => setShowMonthTable(v => !v)} className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold">
              {showMonthTable ? 'Show chart' : 'Show table'}
            </button>
          </div>
        </div>
        {showMonthTable ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-700/50">
                  <th className="py-2 font-medium">{daily ? 'Day' : 'Month'}</th>
                  <th className="py-2 font-medium text-right">Trades</th>
                  <th className="py-2 font-medium text-right">Win rate</th>
                  <th className="py-2 font-medium text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map(m => (
                  <tr key={m.key} className="border-b border-slate-800/60">
                    <td className="py-2 text-slate-300">{m.label}</td>
                    <td className="py-2 text-right text-slate-300">{m.n}</td>
                    <td className="py-2 text-right text-slate-300">{pct(m.winRate)}</td>
                    <td className={`py-2 text-right font-semibold ${plColor(m.pl)}`}>{signed(m.pl, cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%" maxBarSize={48}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={8} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={52} tickFormatter={shortAxis} />
                <ReferenceLine y={0} stroke="rgba(148, 163, 184, 0.35)" />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                  formatter={(v, name, item) => [`${signed(v, cents)} · ${item.payload.n} trades · ${pct(item.payload.winRate)} won`, 'P&L']}
                />
                <Bar dataKey="pl" shape={<PolarityBar />} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By ticker */}
        <section className="card">
          <div className="flex items-start justify-between gap-2 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">By ticker</h3>
              <p className="text-xs text-slate-400 mt-1">{s.symbols.length} tickers traded</p>
            </div>
            {(winners.length > 8 || losers.length > 5) && (
              <button onClick={() => setShowAllSymbols(v => !v)} className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold">
                {showAllSymbols ? 'Show top only' : 'Show all'}
              </button>
            )}
          </div>
          <BarList
            title="Biggest winners"
            items={shownWinners.map(x => ({ key: x.symbol, label: x.symbol, value: x.pl, meta: tradeCount(x.n, x.winRate) }))}
            scale={Math.max(...s.symbols.map(x => Math.abs(x.pl)))}
          />
          {losers.length > 0 && (
            <div className="mt-5">
              <BarList
                title="Biggest losers"
                items={shownLosers.map(x => ({ key: x.symbol, label: x.symbol, value: x.pl, meta: tradeCount(x.n, x.winRate) }))}
                scale={Math.max(...s.symbols.map(x => Math.abs(x.pl)))}
              />
            </div>
          )}
        </section>

        <div className="space-y-6">
          {/* Holding time */}
          <section className="card">
            <h3 className="text-lg font-semibold text-white">How long you held</h3>
            {s.timedCount === 0 ? (
              <p className="text-sm text-slate-400 mt-2">
                None of the {s.count} trades in this period have a buy date in their notes, so there’s no holding time to show.
              </p>
            ) : (
              <>
                <p className="text-xs text-slate-400 mt-1 mb-4">
                  Median hold {s.medianDaysHeld} day{s.medianDaysHeld === 1 ? '' : 's'} · based on the {s.timedCount} of {s.count} trades with a buy date in the notes
                </p>
                <BarList
                  items={s.holding.map(h => ({ key: h.label, label: h.label, value: h.pl, meta: tradeCount(h.n, h.winRate) }))}
                  scale={Math.max(...s.holding.map(h => Math.abs(h.pl)))}
                  labelWidth="w-32"
                />
              </>
            )}
          </section>

          {/* Stocks vs options, weekdays */}
          <section className="card">
            <h3 className="text-lg font-semibold text-white mb-4">What and when</h3>
            <BarList
              items={s.types.map(t => ({ key: t.label, label: t.label, value: t.pl, meta: tradeCount(t.n, t.winRate) }))}
              scale={Math.max(...s.types.map(t => Math.abs(t.pl)))}
              labelWidth="w-32"
            />
            <div className="mt-5">
              <BarList
                title="Day you sold"
                items={s.weekdays.map(w => ({ key: w.label, label: w.label, value: w.pl, meta: tradeCount(w.n, w.winRate) }))}
                scale={Math.max(...s.weekdays.map(w => Math.abs(w.pl)))}
                labelWidth="w-32"
              />
            </div>
          </section>

          {(s.income.dividends > 0 || s.income.interest > 0) && (
            <section className="card">
              <h3 className="text-lg font-semibold text-white">Income</h3>
              <p className="text-xs text-slate-400 mt-1 mb-4">Not counted in the trade stats above</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="card-stat">
                  <p className="stat-label">Dividends</p>
                  <p className="text-xl font-bold text-emerald-400 mt-2">{signed(s.income.dividends, cents)}</p>
                </div>
                <div className="card-stat">
                  <p className="stat-label">Interest</p>
                  <p className="text-xl font-bold text-emerald-400 mt-2">{signed(s.income.interest, cents)}</p>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
      </>)}
    </div>
  )
}

function Tile({ label, value, sub, valueClass = 'text-slate-100' }) {
  return (
    <div className="card-stat">
      <p className="stat-label">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-2 ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1.5">{sub}</p>}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-400">
      <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: GAIN }} />Gain</span>
      <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: LOSS }} />Loss</span>
    </div>
  )
}

// A ranked list with thin inline bars. It doubles as the table view: every
// value is printed, so nothing depends on hover or on color alone.
function BarList({ title, items, scale, labelWidth = 'w-16' }) {
  return (
    <div>
      {title && <p className="stat-label mb-2">{title}</p>}
      <ul className="space-y-2.5">
        {items.map(item => (
          <li key={item.key} className="flex items-center gap-3 text-sm">
            <span className={`${labelWidth} shrink-0 text-slate-200 font-medium truncate`}>{item.label}</span>
            <div className="flex-1 min-w-0">
              <div className="h-1.5 rounded-full bg-slate-800/80">
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${scale ? Math.max(2, (Math.abs(item.value) / scale) * 100) : 0}%`, background: item.value >= 0 ? GAIN : LOSS }}
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1 truncate">{item.meta}</p>
            </div>
            <span className={`w-24 shrink-0 text-right font-semibold tabular-nums ${plColor(item.value)}`}>{signed(item.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Rounded at the data end whichever way the bar points, square on the zero line.
function PolarityBar({ x, y, width, height, payload }) {
  if (!width || !height) return null
  const top = Math.min(y, y + height)
  const h = Math.abs(height)
  const r = Math.min(4, h, width / 2)
  const right = x + width
  const bottom = top + h
  const d = payload.pl >= 0
    ? `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${right - r} Q${right},${top} ${right},${top + r} V${bottom} Z`
    : `M${x},${top} V${bottom - r} Q${x},${bottom} ${x + r},${bottom} H${right - r} Q${right},${bottom} ${right},${bottom - r} V${top} Z`
  return <path d={d} fill={payload.pl >= 0 ? GAIN : LOSS} />
}
