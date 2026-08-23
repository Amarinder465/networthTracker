// One-off importer: bulk-insert trip expenses straight into Supabase.
//
//   node scripts/seed-trip-expenses.mjs             # dry run, prints what it would insert
//   node scripts/seed-trip-expenses.mjs --apply     # actually inserts
//
// Needs a .env in the project root (already gitignored) with:
//   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=...   (Supabase dashboard → Settings → API → service_role)
//
// The service_role key bypasses RLS, so it never belongs in the browser bundle —
// it is only read here, server-side, and only for this script.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const TRIP_NAME = 'Aug Fam Trip'

// description, date label, amount, category, who paid
const TRANSACTIONS = [
  ['Arco',                              'Aug 22', 109.11, 'Gas',            'amy'],
  ['Arco',                              'Aug 22',  96.86, 'Gas',            'amy'],
  ['Mb Market',                         'Aug 21',  20.07, 'Shopping',       'amy'],
  ['Maverik',                           'Aug 21',  75.53, 'Gas',            'amy'],
  ['Maverik',                           'Aug 21',  21.75, 'Gas',            'amy'],
  ['KFC',                               'Aug 21',  65.90, 'Food',           'amy'],
  ['Golden Gate Gas',                   'Aug 21',  91.95, 'Gas',            'amy'],
  ['Turo Inc',                          'Aug 21',  98.64, 'Transportation', 'amy'],
  ['Fresh Pressd',                      'Aug 21',  89.40, 'Food',           'amy'],
  ['7 Eleven',                          'Aug 20',   6.71, 'Gas',            'amy'],
  ['REDDZ',                             'Aug 20',  70.83, 'Food',           'amy'],
  ['Summit Scoops',                     'Aug 20',  19.67, 'Food',           'amy'],
  ['Himalayan Cuisine',                 'Aug 20', 217.13, 'Food',           'amy'],
  ['Tank Full',                         'Aug 20',  81.82, 'Gas',            'amy'],
  ['Blue Sky Adventures',               'Aug 20', 410.34, 'Activities',     'amy'],
  ['City Liquors',                      'Aug 19',  66.41, 'Drinks',         'amy'],
  ['I Scream Gelato - Breckenridge CO', 'Aug 19',  25.63, 'Food',           'amy'],
  ['BRECKENRIDGE SPRT MAIN ST',         'Aug 19',  76.21, 'Shopping',       'amy'],
  ['TBar',                              'Aug 19', 178.80, 'Drinks',         'amy'],
  ['City Liquors',                      'Aug 19',  39.19, 'Drinks',         'amy'],
  ['City Market Fuel',                  'Aug 19',  73.65, 'Gas',            'amy'],
  ['Walmart',                           'Aug 18',  76.12, 'Shopping',       'amy'],
  ['Walmart',                           'Aug 18',  71.37, 'Shopping',       'amy'],
  ['Raindance',                         'Aug 17',   4.36, 'Other',          'amy'],
  ['Canyonlands National Park',         'Aug 17',  30.00, 'Activities',     'amy'],
  ['Exxon',                             'Aug 16',   4.58, 'Gas',            'amy'],
  ['City Market Fuel',                  'Aug 16',  98.39, 'Gas',            'amy'],
  ['GILIBERTOS MOAB LLC',               'Aug 16',  99.74, 'Food',           'amy'],
  ['Golden Gate-crescent J',            'Aug 16',  40.08, 'Gas',            'amy'],
  ["Papa Joe's Gas N Go",               'Aug 16',   0.23, 'Gas',            'amy'],
  ['Phillips 66',                       'Aug 16',  95.69, 'Gas',            'amy'],
  ['Maverik',                           'Aug 16',   3.49, 'Gas',            'amy'],
  ['Tomi Ramen',                        'Aug 16', 102.24, 'Food',           'amy'],
  ['Arco',                              'Aug 16', 100.00, 'Gas',            'amy'],
  ['CVS',                               'Aug 16',   6.58, 'Shopping',       'amy'],
  ['Arc Bar',                           'Aug 15',  78.01, 'Drinks',         'amy'],
  ['Uptown Gelato Nyny',                'Aug 15',  26.93, 'Food',           'amy'],
  ['In-N-Out Burger',                   'Aug 15',   3.53, 'Food',           'amy'],
  ['In-N-Out Burger',                   'Aug 15',  58.07, 'Food',           'amy'],
  ['Trip charge',                       '',       891.00, 'Other',          'ashley'],
]

function loadEnv() {
  let raw = ''
  try { raw = readFileSync(new URL('../.env', import.meta.url), 'utf8') } catch { /* fall back to process env */ }
  const env = { ...process.env }
  raw.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  })
  return env
}

const env = loadEnv()
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing config. Add to .env:\n  VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co\n  SUPABASE_SERVICE_ROLE_KEY=<service_role key from Settings → API>')
  process.exit(1)
}

const apply = process.argv.includes('--apply')
const db = createClient(url, key, { auth: { persistSession: false } })

const { data: events, error: evErr } = await db
  .from('split_events')
  .select('id, name, user_id, payer, type')
  .ilike('name', `%${TRIP_NAME}%`)

if (evErr) { console.error('Lookup failed:', evErr.message); process.exit(1) }
if (!events?.length) { console.error(`No trip matching "${TRIP_NAME}". Existing trips:`);
  const { data: all } = await db.from('split_events').select('name, type')
  console.error((all ?? []).map(t => `  - ${t.name} (${t.type ?? 'trip'})`).join('\n'))
  process.exit(1)
}
if (events.length > 1) { console.error('Multiple trips matched — narrow TRIP_NAME:', events.map(e => e.name)); process.exit(1) }

const trip = events[0]

const { data: people } = await db.from('split_people').select('name').eq('event_id', trip.id)
const names = (people ?? []).map(p => p.name)
const { data: existing } = await db.from('split_expenses').select('id').eq('event_id', trip.id)

console.log(`Trip:     ${trip.name} (${trip.id})`)
console.log(`People:   ${names.length ? names.join(', ') : '(none yet)'}`)
console.log(`Existing: ${existing?.length ?? 0} expense(s) already on this trip`)

// Match payer names case-insensitively against the people already on the trip.
const resolve = n => names.find(x => x.toLowerCase() === n.toLowerCase())
const missing = [...new Set(TRANSACTIONS.map(t => t[4]))].filter(n => !resolve(n))
if (missing.length) {
  console.error(`\nStop: these payers are not on the trip yet — add them on the People tab first: ${missing.join(', ')}`)
  process.exit(1)
}
if (names.length !== 6) {
  console.warn(`\nHeads up: the trip has ${names.length} people, not 6 — every expense will be split ${names.length} ways.`)
}

const rows = TRANSACTIONS.map(([description, date, amount, category, paidBy]) => ({
  event_id: trip.id,
  user_id: trip.user_id,
  description: date ? `${description} · ${date}` : description,
  category,
  amount,
  paid_by: resolve(paidBy),
  involved: names,
}))

const total = rows.reduce((s, r) => s + r.amount, 0)
const byPayer = rows.reduce((acc, r) => ({ ...acc, [r.paid_by]: (acc[r.paid_by] ?? 0) + r.amount }), {})

console.log(`\n${rows.length} expenses, ${total.toFixed(2)} total, split ${names.length} ways (${(total / names.length).toFixed(2)} each)`)
Object.entries(byPayer).forEach(([n, amt]) => console.log(`  paid by ${n}: ${amt.toFixed(2)}`))

if (!apply) {
  console.log('\nDry run — nothing written. Re-run with --apply to insert.')
  process.exit(0)
}

const { error } = await db.from('split_expenses').insert(rows)
if (error) { console.error('Insert failed:', error.message); process.exit(1) }
console.log(`\nInserted ${rows.length} expenses into "${trip.name}".`)
