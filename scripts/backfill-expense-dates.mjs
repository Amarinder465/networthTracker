// One-off migration: move dates out of expense descriptions into expense_date.
//
//   node scripts/backfill-expense-dates.mjs             # dry run, prints every change
//   node scripts/backfill-expense-dates.mjs --apply     # writes
//
// Run supabase/split_expense_date.sql first. Needs the same .env as
// scripts/seed-trip-expenses.mjs (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
//
// Descriptions looked like "Tank Full · Aug 20". A range such as
// "moab aug 16-18" resolves to its start date. Anything with no month+day
// mention is left alone with a null date.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const DATE_IN_TEXT = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/gi
const DATE_SUFFIX = /\s*[·–—-]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\s*$/i

// Merchants that should land in the new Car Rental category.
const CAR_RENTAL = /(turo|hertz|enterprise rent|avis|budget rent|national car|alamo|sixt|dollar rent|thrifty|car rental|rent a car)/i

const pad = n => String(n).padStart(2, '0')

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

function parseDate(description, trip) {
  const matches = [...(description ?? '').matchAll(DATE_IN_TEXT)]
  if (!matches.length) return null
  const [, month, day] = matches[matches.length - 1]
  const m = MONTH_INDEX[month.slice(0, 3).toLowerCase()]
  const d = Number(day)
  if (m === undefined || !(d >= 1 && d <= 31)) return null

  const startYear = trip?.start_date ? Number(trip.start_date.slice(0, 4)) : new Date().getFullYear()
  const startMonth = trip?.start_date ? Number(trip.start_date.slice(5, 7)) - 1 : null
  const year = (startMonth !== null && m < startMonth - 6) ? startYear + 1 : startYear
  return `${year}-${pad(m + 1)}-${pad(d)}`
}

const env = loadEnv()
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1) }

const apply = process.argv.includes('--apply')
const db = createClient(url, key, { auth: { persistSession: false } })

const probe = await db.from('split_expenses').select('expense_date').limit(1)
if (probe.error) {
  console.error('Run supabase/split_expense_date.sql first —', probe.error.message)
  process.exit(1)
}

const { data: trips, error: tripErr } = await db
  .from('split_events').select('id, name, start_date, end_date').or('type.eq.trip,type.is.null')
if (tripErr) { console.error('Trip lookup failed:', tripErr.message); process.exit(1) }

let dated = 0, renamed = 0, recategorised = 0, untouched = 0
const writes = []

for (const trip of trips ?? []) {
  const { data: expenses } = await db
    .from('split_expenses').select('id, description, category, expense_date').eq('event_id', trip.id).order('id')
  if (!expenses?.length) continue

  console.log(`\n${trip.name}`)
  for (const exp of expenses) {
    const patch = {}

    if (!exp.expense_date) {
      const iso = parseDate(exp.description, trip)
      if (iso) { patch.expense_date = iso; dated++ }
    }

    const stripped = (exp.description ?? '').replace(DATE_SUFFIX, '').trim()
    if (stripped && stripped !== exp.description) { patch.description = stripped; renamed++ }

    if (exp.category !== 'Car Rental' && CAR_RENTAL.test(exp.description ?? '')) {
      patch.category = 'Car Rental'
      recategorised++
    }

    if (!Object.keys(patch).length) {
      untouched++
      console.log(`  · ${exp.description}  (no date found, left as-is)`)
      continue
    }

    const bits = []
    if (patch.expense_date) bits.push(`date=${patch.expense_date}`)
    if (patch.description) bits.push(`"${exp.description}" → "${patch.description}"`)
    if (patch.category) bits.push(`${exp.category} → Car Rental`)
    console.log(`  ✓ ${bits.join('  |  ')}`)
    writes.push({ id: exp.id, patch })
  }
}

console.log(`\n${writes.length} row(s) to update — ${dated} dated, ${renamed} description(s) cleaned, ${recategorised} recategorised, ${untouched} untouched.`)

if (!apply) { console.log('Dry run — nothing written. Re-run with --apply.'); process.exit(0) }

for (const { id, patch } of writes) {
  const { error } = await db.from('split_expenses').update(patch).eq('id', id)
  if (error) { console.error(`Update failed on ${id}:`, error.message); process.exit(1) }
}
console.log(`Updated ${writes.length} row(s).`)
