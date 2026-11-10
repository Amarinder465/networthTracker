import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// "What if I sold today?" — reads the open_positions snapshot (one row per tax
// lot, priced at snapshot time) and shows what selling would do to this
// year's realized total.
//
// Two adjustments keep it honest:
//   * A loss on a position flagged 'washed' doesn't count this year; it moves
//     onto the shares bought inside the 30-day window instead.
//   * deferred_loss is an earlier wash-sale loss already folded into a lot's
//     cost basis (SMR's $311 from 1/21). The journal counted that loss when it
//     happened, the tax return won't until the lot is sold, so it's added back
//     to "realized now" — selling the lot then releases it.

const whole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${whole.format(Math.abs(v))}`
const plColor = v => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-300')
const shares = q => Number(q).toLocaleString('en-US', { maximumFractionDigits: 4 })

const WASH = {
  clean: { icon: '✓', label: 'No wash sale', className: 'text-slate-400' },
  gray: { icon: '◐', label: 'Gray area', className: 'text-amber-300' },
  washed: { icon: '⚠', label: 'Wash sale', className: 'text-amber-300' },
}
const WASH_RANK = { clean: 0, gray: 1, washed: 2 }

// Long-term means held MORE than a year: the day after the anniversary.
function isLongTerm(openedOn, asOf) {
  if (!openedOn) return false
  const anniversary = new Date(`${openedOn}T00:00:00`)
  anniversary.setFullYear(anniversary.getFullYear() + 1)
  return asOf > anniversary
}

function groupPositions(lots) {
  const groups = new Map()
  for (const lot of lots) {
    const key = `${lot.account}|${lot.symbol}`
    const price = Number(lot.last_price)
    const qty = Number(lot.quantity)
    const cost = Number(lot.cost_basis)
    const asOf = lot.priced_at ? new Date(lot.priced_at) : new Date()
    const value = qty * price
    const long = isLongTerm(lot.opened_on, asOf)
    const g = groups.get(key) ?? {
      key, account: lot.account, symbol: lot.symbol, qty: 0, cost: 0, value: 0,
      short: 0, long: 0, deferredInBasis: 0, wash: 'clean', note: null, terms: new Set(),
    }
    g.qty += qty
    g.cost += cost
    g.value += value
    g[long ? 'long' : 'short'] += value - cost
    g.deferredInBasis += Number(lot.deferred_loss) || 0
    g.terms.add(long ? 'Long-term' : 'Short-term')
    if (WASH_RANK[lot.wash_status] > WASH_RANK[g.wash]) g.wash = lot.wash_status
    g.note = g.note ?? lot.wash_note
    groups.set(key, g)
  }
  return [...groups.values()]
    .map(g => ({ ...g, pl: g.value - g.cost, term: g.terms.size > 1 ? 'Mixed' : [...g.terms][0] }))
    .sort((a, b) => a.pl - b.pl)
}

export default function WhatIfSell({ journalRealized, year, focusSignal = 0 }) {
  const { user } = useAuth()
  const [lots, setLots] = useState(null)
  const [missing, setMissing] = useState(false)
  const [mode, setMode] = useState('all') // 'all' | 'losers'
  const sectionRef = useRef(null)
  const loaded = lots !== null

  // The page-header "What if I sold everything?" button lands here, on Everything.
  useEffect(() => {
    if (!focusSignal || !loaded) return
    setMode('all')
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focusSignal, loaded])

  useEffect(() => {
    let alive = true
    supabase
      .from('open_positions')
      .select('*')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) {
          // The table hasn't been created yet (supabase/open_positions.sql).
          setMissing(true)
          setLots([])
        } else {
          setLots(data ?? [])
        }
      })
    return () => { alive = false }
  }, [user.id])

  const positions = useMemo(() => groupPositions(lots ?? []), [lots])

  if (lots === null) return null

  if (missing || positions.length === 0) {
    return (
      <section ref={sectionRef} id="what-if" className="card scroll-mt-24">
        <h3 className="text-lg font-semibold text-white">What if you sold today</h3>
        <p className="text-sm text-slate-400 mt-2">
          {missing
            ? 'Open positions aren’t set up yet. Run supabase/open_positions.sql in Supabase, then ask Claude to load your Robinhood positions.'
            : 'No open positions loaded yet. Ask Claude to load your Robinhood positions.'}
        </p>
      </section>
    )
  }

  const selected = mode === 'losers' ? positions.filter(p => p.pl < 0) : positions
  const deferredNow = selected.filter(p => p.wash === 'washed' && p.pl < 0).reduce((s, p) => s - p.pl, 0)
  const counted = selected.filter(p => !(p.wash === 'washed' && p.pl < 0))
  const countedPL = counted.reduce((s, p) => s + p.pl, 0)
  const shortPL = counted.reduce((s, p) => s + p.short, 0)
  const longPL = counted.reduce((s, p) => s + p.long, 0)
  const selectedPL = selected.reduce((s, p) => s + p.pl, 0)
  const deferredInBasis = positions.reduce((s, p) => s + p.deferredInBasis, 0)
  const realizedNow = journalRealized + deferredInBasis
  const realizedAfter = realizedNow + countedPL
  const pricedAt = lots.reduce((latest, l) => (l.priced_at && (!latest || l.priced_at > latest) ? l.priced_at : latest), null)
  const pricedLabel = pricedAt
    ? new Date(pricedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    : 'unknown'

  return (
    <section ref={sectionRef} id="what-if" className="card scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">What if you sold today</h3>
          <p className="text-xs text-slate-400 mt-1">Prices as of {pricedLabel} · taxable accounts only, IRAs excluded</p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Which positions">
          {[['all', 'Everything'], ['losers', 'Only losers']].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                mode === value ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="card-stat">
          <p className="stat-label">Selling would realize</p>
          <p className={`text-xl sm:text-2xl font-bold mt-2 ${plColor(selectedPL)}`}>{signed(selectedPL)}</p>
          <p className="text-xs text-slate-400 mt-1.5">{selected.length} position{selected.length === 1 ? '' : 's'}</p>
        </div>
        <div className="card-stat">
          <p className="stat-label">Short / long-term</p>
          <p className="text-xl sm:text-2xl font-bold mt-2 flex flex-wrap items-baseline gap-x-1.5">
            <span className={`whitespace-nowrap ${plColor(shortPL)}`}>{signed(shortPL)}</span>
            <span className="text-slate-500">/</span>
            <span className={`whitespace-nowrap ${plColor(longPL)}`}>{signed(longPL)}</span>
          </p>
          <p className="text-xs text-slate-400 mt-1.5">Counted toward {year}</p>
        </div>
        <div className="card-stat">
          <p className="stat-label">{year} realized now</p>
          <p className={`text-xl sm:text-2xl font-bold mt-2 ${plColor(realizedNow)}`}>{signed(realizedNow)}</p>
          <p className="text-xs text-slate-400 mt-1.5">
            {deferredInBasis
              ? `Journal ${signed(journalRealized)} + ${whole.format(deferredInBasis)} wash-sale loss not yet deductible`
              : 'From the trade journal'}
          </p>
        </div>
        <div className="card-stat">
          <p className="stat-label">{year} after selling</p>
          <p className={`text-xl sm:text-2xl font-bold mt-2 ${plColor(realizedAfter)}`}>{signed(realizedAfter)}</p>
          <p className="text-xs text-slate-400 mt-1.5">
            {deferredNow ? `${whole.format(deferredNow)} of losses deferred by wash sales` : 'Every loss counts this year'}
          </p>
        </div>
      </div>

      <ul className="mt-5 divide-y divide-slate-800/70">
        {selected.map(p => {
          const wash = WASH[p.wash]
          return (
            <li key={p.key} className="py-3 flex items-start gap-3 text-sm">
              <div className="flex-1 min-w-0">
                <p className="text-slate-100 font-semibold">
                  {p.symbol} <span className="text-xs font-normal text-slate-500">· {p.account}</span>
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {shares(p.qty)} sh · cost {whole.format(p.cost)} → now {whole.format(p.value)} · {p.term}
                </p>
                <p className={`text-xs mt-0.5 ${wash.className}`} title={p.note ?? undefined}>
                  <span aria-hidden="true">{wash.icon}</span> {wash.label}
                  {p.note && p.wash !== 'clean' && <span className="text-slate-500"> — {p.note}</span>}
                </p>
              </div>
              <span className={`shrink-0 text-right font-semibold tabular-nums ${plColor(p.pl)}`}>{signed(p.pl)}</span>
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-slate-500 mt-4">
        Tax math only, not a recommendation. Buying any of these back within 30 days after selling, in any account
        (IRAs included), would also turn a loss into a wash sale.
      </p>
    </section>
  )
}
