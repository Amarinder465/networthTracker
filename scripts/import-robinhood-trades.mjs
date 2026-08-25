// One-off import: turn Robinhood activity CSVs into `trades` rows.
//
//   node scripts/import-robinhood-trades.mjs                          # dry run
//   node scripts/import-robinhood-trades.mjs --user <uuid> --apply    # writes
//   …plus --replace to clear that user's existing trades first.
//
// Needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.
//
// Robinhood exports every cash movement, not just trades. We keep the buy/sell
// legs and emit one `trades` row per instrument per closing day: the realized
// P&L, dated the day it was sold, with the buy/sell history in the notes.
//
// Two things drive how lots are matched:
//
//   * Books are kept PER ACCOUNT. The exports cover two — "Individual" and the
//     "1M dollar Port" — and they hold the same tickers at the same time. One
//     combined book lets a sale in one account eat a lot from the other, which
//     invents losses (a Mar 2026 AMD sale in the 1M port priced against a
//     costlier Feb lot sitting in Individual). ITRF share transfers move lots
//     between the books so the two stay honest.
//
//   * Lots are matched LIFO, not FIFO, because these sales are specific-lot.
//     The trading pattern is buy-a-block / sell-that-block days later, and the
//     order history confirms the pairing every time: Meta bought Jul 30 2026
//     for $21,290.60 was the Meta sold Jul 31 for $22,223.54. FIFO would price
//     that against a week-older lot and report a $2,074 loss on a $933 gain.
//     LIFO reproduces the intent and leaves the long-held shares open.
//
// For a position that fully closes, FIFO and LIFO reach the same total; they
// differ only in which basis stays on the books. That is exactly where the
// FIFO run went wrong, since a lot of these positions are still open.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const INDIVIDUAL = 'Individual'
const MILLION = '1M dollar Port'

const FILES = [
  { path: 'C:/Users/amari/OneDrive/Desktop/8688425b-e8b7-54cd-aa69-4536a7104f26.csv', account: INDIVIDUAL },      // 2024
  { path: 'C:/Users/amari/OneDrive/Desktop/a127db6e-f3e7-55ba-a5fb-a678e88f4abb (1).csv', account: INDIVIDUAL },  // 2025
  { path: 'C:/Users/amari/OneDrive/Desktop/3ae1808b-46a6-5ca5-bcb7-e0c82f3d7d0e (1).csv', account: INDIVIDUAL },  // 2026
  { path: 'C:/Users/amari/OneDrive/Desktop/41b4b7d0-abf9-51f5-ba59-7746a9e3b816 (1).csv', account: MILLION },     // 2026
]

// The 1M dollar Port export begins 1/6/2026, but the account was funded on
// 12/1/2025 and bought its opening positions over the next two weeks. Those
// buys are in no CSV — they come from the Robinhood order history, which is
// why every one of them was previously reported as a sale with no cost basis.
// Re-export that account's 2025 activity and these can be deleted.
const MISSING_2025 = [
  { date: '2025-12-02', symbol: 'SOFI', qty: 100, cost: 2953.00 },
  { date: '2025-12-02', symbol: 'MSFT', qty: 10, cost: 4897.50 },
  { date: '2025-12-02', symbol: 'NVDA', qty: 30, cost: 5441.70 },
  { date: '2025-12-04', symbol: 'EQIX', qty: 7, cost: 5138.00 },
  { date: '2025-12-04', symbol: 'XYL', qty: 30, cost: 4244.70 },
  { date: '2025-12-04', symbol: 'NEE', qty: 50, cost: 4180.00 },
  { date: '2025-12-04', symbol: 'SMR', qty: 100, cost: 2311.00 },
  { date: '2025-12-04', symbol: 'IBIT', qty: 100, cost: 5239.60 },
  { date: '2025-12-16', symbol: 'SOFI', qty: 100, cost: 2653.00 },
]

// ---------------------------------------------------------------- csv parsing

function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

const money = s => {
  if (!s) return 0
  const neg = s.includes('(')
  const n = parseFloat(s.replace(/[$,()]/g, '')) || 0
  return neg ? -n : n
}

const isoDate = s => {
  const [m, d, y] = s.split('/').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const short = iso => {
  const [y, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`
}

const usd = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ------------------------------------------------------------------- loading

const events = []
FILES.forEach(({ path, account }, fileIdx) => {
  const rows = parseCsv(readFileSync(path, 'utf8'))
  const body = rows.slice(1).filter(r => r.length >= 9 && r[0] && /^\d/.test(r[0]))
  // Robinhood exports newest-first; reverse for chronological order, which also
  // keeps same-day fill order intact (it decides LIFO ties).
  body.reverse().forEach((r, i) => {
    events.push({
      account,
      date: isoDate(r[0]),
      symbol: r[3].trim(),
      description: r[4].replace(/\s*\n\s*/g, ' ').trim(),
      code: r[5].trim(),
      qtyRaw: r[6].trim(),
      amount: money(r[8]),
      seq: fileIdx * 100000 + i,
    })
  })
})

MISSING_2025.forEach((m, i) => {
  events.push({
    account: MILLION, date: m.date, symbol: m.symbol, description: m.symbol,
    code: 'Buy', qtyRaw: String(m.qty), amount: -m.cost, seq: -1000 + i,
  })
})

events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq))

// ------------------------------------------------------------------ the books

const books = { [INDIVIDUAL]: new Map(), [MILLION]: new Map() }
const closes = []
const unmatched = []

const bookOf = acct => books[acct]
const other = acct => (acct === INDIVIDUAL ? MILLION : INDIVIDUAL)

function addLot(acct, key, qty, cost, date) {
  const b = bookOf(acct)
  if (!b.has(key)) b.set(key, [])
  b.get(key).push({ qty, cost, date })
}

// Specific-lot selling: take the most recently acquired lots first.
function consume(acct, key, qty) {
  const queue = bookOf(acct).get(key) ?? []
  let need = qty, cost = 0, dates = []
  while (need > 1e-9 && queue.length) {
    const lot = queue[queue.length - 1]
    const take = Math.min(lot.qty, need)
    const portion = lot.qty > 0 ? (take / lot.qty) * lot.cost : 0
    cost += portion
    if (!dates.includes(lot.date)) dates.push(lot.date)
    lot.qty -= take
    lot.cost -= portion
    need -= take
    if (lot.qty <= 1e-9) queue.pop()
  }
  return { cost, dates, short: need }
}

// A share ITRF leaves one account and lands in the other. Move the lots rather
// than closing them, so the eventual sale still has its real basis.
function transfer(from, key, qty) {
  const queue = bookOf(from).get(key) ?? []
  let need = qty
  while (need > 1e-9 && queue.length) {
    const lot = queue[queue.length - 1]
    const take = Math.min(lot.qty, need)
    const portion = lot.qty > 0 ? (take / lot.qty) * lot.cost : 0
    addLot(other(from), key, take, portion, lot.date)
    lot.qty -= take
    lot.cost -= portion
    need -= take
    if (lot.qty <= 1e-9) queue.pop()
  }
}

// `100S` means shares leaving the position; a bare number means arriving.
const parseQty = raw => ({ qty: Math.abs(parseFloat(raw.replace(/S$/, '')) || 0), out: raw.endsWith('S') })

const optionKey = desc => 'OPT:' + desc.replace(/^Option Expiration for\s+/i, '').trim()

// Pretty option name: "SOFI 12/19/2025 Call $31.00" -> "SOFI $31 Call 12/19/25"
function optionLabel(desc) {
  const raw = desc.replace(/^Option Expiration for\s+/i, '').trim()
  const m = raw.match(/^(\S+)\s+(\d+\/\d+\/\d{4})\s+(Call|Put)\s+\$([\d.]+)$/i)
  if (!m) return raw
  const [, sym, exp, kind, strike] = m
  const [em, ed, ey] = exp.split('/')
  const price = Number(strike)
  return `${sym} $${price % 1 === 0 ? price : price.toFixed(2)} ${kind} ${Number(em)}/${Number(ed)}/${ey.slice(2)}`
}

// Cash-only activity: interest, dividends, fees, deposits. Not trades.
const CASH_ONLY = new Set(['INT', 'GDBP', 'CDIV', 'DFEE', 'DTAX', 'AFEE', 'ACH', 'GOLD', 'GMPC', 'FUTSWP', 'SLIP'])

function close(e, key, label, kind, qty, proceeds) {
  const { cost, dates, short: unfilled } = consume(e.account, key, qty)
  if (unfilled > 1e-4) unmatched.push({ ...e, label, qty, unfilled })
  const covered = qty - unfilled
  if (covered <= 1e-9) return
  closes.push({
    date: e.date, account: e.account, key, label, kind,
    qty: covered, proceeds: proceeds * (covered / qty), cost, buyDates: dates,
  })
}

for (const e of events) {
  if (CASH_ONLY.has(e.code)) continue

  switch (e.code) {
    case 'Buy':
      addLot(e.account, e.symbol, parseQty(e.qtyRaw).qty, Math.abs(e.amount), e.date)
      break

    case 'Sell':
      close(e, e.symbol, e.symbol, 'stock', parseQty(e.qtyRaw).qty, e.amount)
      break

    case 'BTO':
      addLot(e.account, optionKey(e.description), parseQty(e.qtyRaw).qty, Math.abs(e.amount), e.date)
      break

    case 'STC':
      close(e, optionKey(e.description), optionLabel(e.description), 'option', parseQty(e.qtyRaw).qty, e.amount)
      break

    case 'OEXP':
      // No assignment rows appear anywhere in these exports, so every
      // expiration is a long option going out worthless: the premium is the
      // whole loss.
      close(e, optionKey(e.description), optionLabel(e.description), 'expired', parseQty(e.qtyRaw).qty, 0)
      break

    case 'ITRF': {
      const { qty, out } = parseQty(e.qtyRaw)
      if (e.symbol && qty && out) transfer(e.account, e.symbol, qty)
      break
    }

    case 'SPL':   // stock split: extra shares, same total basis
    case 'REC':   // fractional shares received
    case 'SPR':   // spin-off
    case 'SXCH': { // share class exchange
      const { qty, out } = parseQty(e.qtyRaw)
      if (!e.symbol || !qty) break
      if (out) consume(e.account, e.symbol, qty)
      else addLot(e.account, e.symbol, qty, 0, e.date)
      break
    }

    default:
      console.warn(`  ? unhandled trans code ${e.code} on ${e.date} (${e.symbol})`)
  }
}

// ------------------------------------- one row per instrument per closing day

const grouped = new Map()
for (const c of closes) {
  const g = `${c.date}|${c.account}|${c.key}`
  if (!grouped.has(g)) grouped.set(g, { ...c, buyDates: [...c.buyDates] })
  else {
    const acc = grouped.get(g)
    acc.qty += c.qty
    acc.proceeds += c.proceeds
    acc.cost += c.cost
    c.buyDates.forEach(d => { if (!acc.buyDates.includes(d)) acc.buyDates.push(d) })
  }
}

const round = n => Math.round(n * 100) / 100

const rows = [...grouped.values()]
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.label.localeCompare(b.label)))
  .map(t => {
    const bought = t.buyDates.slice().sort()
    const when = bought.length === 0 ? 'earlier'
      : bought.length === 1 ? short(bought[0])
      : `${short(bought[0])}–${short(bought[bought.length - 1])}`
    const size = t.kind === 'stock'
      ? `${Number(t.qty.toFixed(6))} sh`
      : `${Number(t.qty.toFixed(2))} contract${t.qty === 1 ? '' : 's'}`
    const notes = t.kind === 'expired'
      ? `${t.label} · ${size} · bought ${when} for ${usd(t.cost)} → expired worthless ${short(t.date)}`
      : `${t.label} · ${size} · bought ${when} for ${usd(t.cost)} → sold ${short(t.date)} for ${usd(t.proceeds)}`
    return { trade_date: t.date, profit_loss: round(t.proceeds - t.cost), notes }
  })

// ------------------------------------------------------------------ reporting

let year = null
for (const r of rows) {
  const y = r.trade_date.slice(0, 4)
  if (y !== year) { year = y; console.log(`\n===== ${y} =====`) }
  console.log(`${(r.profit_loss >= 0 ? '+' : '') + r.profit_loss.toFixed(2)}`.padStart(12) + `  ${r.notes}`)
}

const byYear = {}
rows.forEach(r => { const y = r.trade_date.slice(0, 4); byYear[y] = (byYear[y] ?? 0) + r.profit_loss })
const total = rows.reduce((s, r) => s + r.profit_loss, 0)
const wins = rows.filter(r => r.profit_loss > 0).length
const losses = rows.filter(r => r.profit_loss < 0).length

console.log(`\n----- summary -----`)
Object.entries(byYear).forEach(([y, v]) => console.log(`  ${y}: ${usd(round(v))}`))
console.log(`  ${rows.length} rows — ${wins} winners, ${losses} losers, net ${usd(round(total))}`)

console.log(`\n----- still open (cost basis carried, no P&L booked) -----`)
for (const acct of [INDIVIDUAL, MILLION]) {
  const held = [...bookOf(acct).entries()]
    .map(([key, lots]) => ({
      key,
      qty: lots.reduce((s, l) => s + l.qty, 0),
      cost: lots.reduce((s, l) => s + l.cost, 0),
      oldest: lots.map(l => l.date).sort()[0],
    }))
    .filter(h => h.qty > 1e-6)
    .sort((a, b) => b.cost - a.cost)
  console.log(`\n  ${acct}`)
  if (!held.length) { console.log('    (nothing)'); continue }
  for (const h of held) {
    console.log(`    ${h.key.replace(/^OPT:/, '')}`.padEnd(34) + `${Number(h.qty.toFixed(6))}`.padStart(12) + `  ${usd(h.cost).padStart(12)}  since ${short(h.oldest)}`)
  }
}

if (unmatched.length) {
  console.log(`\n----- sold with no cost basis in these exports -----`)
  for (const u of unmatched) {
    console.log(`  ${u.date}  ${u.account.padEnd(15)} ${u.label}  ${Number(u.unfilled.toFixed(6))} of ${u.qty} · proceeds ${usd(u.amount)}`)
  }
}

// -------------------------------------------------------------------- writing

const apply = process.argv.includes('--apply')
const replace = process.argv.includes('--replace')
const userId = process.argv[process.argv.indexOf('--user') + 1]

if (!apply) { console.log('\nDry run — nothing written. Re-run with --user <uuid> --apply.'); process.exit(0) }
if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) { console.error('\nPass --user <uuid>.'); process.exit(1) }

const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = { ...process.env }
raw.split(/\r?\n/).forEach(l => {
  const m = l.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
  if (m && !l.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
})

const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

if (replace) {
  const { error } = await db.from('trades').delete().eq('user_id', userId)
  if (error) { console.error('Clear failed:', error.message); process.exit(1) }
  console.log('Cleared existing trades for that user.')
}

for (let i = 0; i < rows.length; i += 100) {
  const batch = rows.slice(i, i + 100).map(r => ({ ...r, user_id: userId }))
  const { error } = await db.from('trades').insert(batch)
  if (error) { console.error('Insert failed:', error.message); process.exit(1) }
  console.log(`  inserted ${Math.min(i + 100, rows.length)}/${rows.length}`)
}
console.log(`Done — ${rows.length} trades imported.`)
