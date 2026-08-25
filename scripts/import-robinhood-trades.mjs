// One-off import: turn Robinhood activity CSVs into `trades` rows.
//
//   node scripts/import-robinhood-trades.mjs --user <uuid>            # dry run
//   node scripts/import-robinhood-trades.mjs --user <uuid> --apply    # writes
//
// Needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.
//
// Robinhood exports every cash movement, not just trades. We keep only the
// buy/sell legs, match them FIFO per instrument across all four exports (they
// are separate accounts, but positions move between them via ITRF, so a single
// combined book is what actually reconciles), and emit one `trades` row per
// closing day per instrument — the realized P&L, dated the day it was sold.
//
// Sells with no matching open lot (positions opened before the export window)
// have no cost basis and are reported, not imported.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const FILES = [
  'C:/Users/amari/OneDrive/Desktop/8688425b-e8b7-54cd-aa69-4536a7104f26.csv',
  'C:/Users/amari/OneDrive/Desktop/a127db6e-f3e7-55ba-a5fb-a678e88f4abb (1).csv',
  'C:/Users/amari/OneDrive/Desktop/41b4b7d0-abf9-51f5-ba59-7746a9e3b816 (1).csv',
  'C:/Users/amari/OneDrive/Desktop/3ae1808b-46a6-5ca5-bcb7-e0c82f3d7d0e (1).csv',
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
FILES.forEach((path, fileIdx) => {
  const rows = parseCsv(readFileSync(path, 'utf8'))
  const body = rows.slice(1).filter(r => r.length >= 9 && r[0] && /^\d/.test(r[0]))
  // Robinhood exports newest-first; reverse to get chronological order and keep
  // same-day fill order intact.
  body.reverse().forEach((r, i) => {
    events.push({
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

events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq))

// ------------------------------------------------------------------ the book

const lots = new Map()          // key -> [{ qty, cost, date }]
const closes = []               // realized events
const unmatched = []            // sells we cannot price

const addLot = (key, qty, cost, date) => {
  if (!lots.has(key)) lots.set(key, [])
  lots.get(key).push({ qty, cost, date })
}

// Consume `qty` from the front of the lot queue. Returns the basis consumed,
// the buy dates it came from, and anything we could not cover.
function consume(key, qty) {
  const queue = lots.get(key) ?? []
  let need = qty, cost = 0, dates = []
  while (need > 1e-9 && queue.length) {
    const lot = queue[0]
    const take = Math.min(lot.qty, need)
    const portion = lot.qty > 0 ? (take / lot.qty) * lot.cost : 0
    cost += portion
    if (!dates.includes(lot.date)) dates.push(lot.date)
    lot.qty -= take
    lot.cost -= portion
    need -= take
    if (lot.qty <= 1e-9) queue.shift()
  }
  return { cost, dates, short: need }
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

for (const e of events) {
  if (CASH_ONLY.has(e.code)) continue

  switch (e.code) {
    case 'Buy':
      addLot(e.symbol, parseQty(e.qtyRaw).qty, Math.abs(e.amount), e.date)
      break

    case 'Sell': {
      const { qty } = parseQty(e.qtyRaw)
      const { cost, dates, short: unfilled } = consume(e.symbol, qty)
      if (unfilled > 1e-4) {
        unmatched.push({ ...e, qty, unfilled })
        if (unfilled >= qty - 1e-9) break        // nothing at all to price
      }
      // Only the covered share count has a basis; price the sale pro-rata.
      const covered = qty - unfilled
      closes.push({
        date: e.date, key: e.symbol, label: e.symbol, kind: 'stock',
        qty: covered, proceeds: e.amount * (covered / qty), cost, buyDates: dates,
      })
      break
    }

    case 'BTO':
      addLot(optionKey(e.description), parseQty(e.qtyRaw).qty, Math.abs(e.amount), e.date)
      break

    case 'STC': {
      const { qty } = parseQty(e.qtyRaw)
      const key = optionKey(e.description)
      const { cost, dates, short: unfilled } = consume(key, qty)
      if (unfilled > 1e-4) {
        unmatched.push({ ...e, qty, unfilled })
        if (unfilled >= qty - 1e-9) break
      }
      const covered = qty - unfilled
      closes.push({
        date: e.date, key, label: optionLabel(e.description), kind: 'option',
        qty: covered, proceeds: e.amount * (covered / qty), cost, buyDates: dates,
      })
      break
    }

    case 'OEXP': {
      // No assignment rows appear anywhere in these exports, so every
      // expiration here is a long option going out worthless: the premium paid
      // is the whole loss.
      const { qty } = parseQty(e.qtyRaw)
      const key = optionKey(e.description)
      const { cost, dates, short: unfilled } = consume(key, qty)
      const covered = qty - unfilled
      if (covered <= 1e-9) break
      closes.push({
        date: e.date, key, label: optionLabel(e.description), kind: 'expired',
        qty: covered, proceeds: 0, cost, buyDates: dates,
      })
      break
    }

    // Share movements with no P&L. ITRF is a transfer between the user's own
    // accounts — invisible in a combined book, so it is skipped entirely rather
    // than closing a lot on one side and orphaning the sale on the other.
    case 'ITRF':
      break

    case 'SPL':   // stock split: extra shares, same total basis
    case 'REC':   // fractional shares received
    case 'SPR':   // spin-off
    case 'SXCH': { // share class exchange
      const { qty, out } = parseQty(e.qtyRaw)
      if (!e.symbol || !qty) break
      if (out) consume(e.symbol, qty)
      else addLot(e.symbol, qty, 0, e.date)
      break
    }

    default:
      console.warn(`  ? unhandled trans code ${e.code} on ${e.date} (${e.symbol})`)
  }
}

// ------------------------------------------------- one row per symbol per day

const grouped = new Map()
for (const c of closes) {
  const g = `${c.date}|${c.key}`
  if (!grouped.has(g)) grouped.set(g, { ...c, buyDates: [...c.buyDates] })
  else {
    const acc = grouped.get(g)
    acc.qty += c.qty
    acc.proceeds += c.proceeds
    acc.cost += c.cost
    c.buyDates.forEach(d => { if (!acc.buyDates.includes(d)) acc.buyDates.push(d) })
    if (acc.kind !== c.kind) acc.kind = acc.kind === 'expired' || c.kind === 'expired' ? 'expired' : acc.kind
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

// ------------------------------------------------------------------- reporting

let year = null
for (const r of rows) {
  const y = r.trade_date.slice(0, 4)
  if (y !== year) { year = y; console.log(`\n===== ${y} =====`) }
  const pl = r.profit_loss
  console.log(`${(pl >= 0 ? '+' : '') + pl.toFixed(2)}`.padStart(12) + `  ${r.notes}`)
}

const total = rows.reduce((s, r) => s + r.profit_loss, 0)
const byYear = {}
rows.forEach(r => { const y = r.trade_date.slice(0, 4); byYear[y] = (byYear[y] ?? 0) + r.profit_loss })

console.log(`\n----- summary -----`)
Object.entries(byYear).forEach(([y, v]) => console.log(`  ${y}: ${usd(round(v))}`))
console.log(`  ${rows.length} trade rows, net ${usd(round(total))}`)

if (unmatched.length) {
  console.log(`\n----- skipped: no cost basis in these exports (position opened earlier) -----`)
  for (const u of unmatched) {
    console.log(`  ${u.date}  ${u.symbol || u.description}  ${Number(u.unfilled.toFixed(6))} of ${u.qty} · proceeds ${usd(u.amount)}`)
  }
}

// ------------------------------------------------------------------- writing

const apply = process.argv.includes('--apply')
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

for (let i = 0; i < rows.length; i += 100) {
  const batch = rows.slice(i, i + 100).map(r => ({ ...r, user_id: userId }))
  const { error } = await db.from('trades').insert(batch)
  if (error) { console.error('Insert failed:', error.message); process.exit(1) }
  console.log(`  inserted ${Math.min(i + 100, rows.length)}/${rows.length}`)
}
console.log(`Done — ${rows.length} trades imported.`)
