import { useEffect, useState } from 'react'
import Spinner from '../components/Spinner'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrency } from '../lib/format'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'

const CATEGORIES = ['Flights', 'Hotel', 'Car Rental', 'Food', 'Drinks', 'Gas', 'Parking', 'Transportation', 'Activities', 'Shopping', 'Other']

const CAT_ICON = {
  Flights: '✈️', Hotel: '🏨', Food: '🍽️', Drinks: '🍹',
  Gas: '⛽', Parking: '🅿️', Transportation: '🚌',
  'Car Rental': '🚗',
  Activities: '🎯', Shopping: '🛍️', Other: '📦',
}
const TABS = ['People', 'Expenses', 'Summary', 'Overview']

const EMPTY_EXPENSE = { description: '', category: 'Food', amount: '', paidBy: '', involved: [], date: '' }

// ── Paste import ──
const MONTH_RE  = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i
const SLASH_RE  = /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/
const REL_RE    = /\b(yesterday|today)\b/i
const NOISE_RE  = /^(pending|posted|approved|processing|declined|all transactions|search transactions|recent transactions|transactions|filters?|refunds?|payments?|dining|travel|groceries|gas|shopping|last month|this month|over \$\d+|[\d,]+\s*pts?|\+?[\d,]+\s*points?)$/i

const CATEGORY_RULES = [
  [/(gas n go|\bgas\b|fuel|arco|exxon|maverik|shell|chevron|phillips|sinclair|conoco|circle k|7[- ]?eleven|tank full|kum ?& ?go|loves|sunoco|texaco|speedway|mobil)/i, 'Gas'],
  [/(parking|garage|park ?mobile|meter)/i, 'Parking'],
  [/(airlines?|airways|delta air|united air|southwest air|jetblue|alaska air|frontier air|spirit air|\bairport\b)/i, 'Flights'],
  [/(hotel|motel|lodge|resort|airbnb|vrbo|marriott|hilton|hyatt|\binn\b)/i, 'Hotel'],
  [/(turo|hertz|enterprise rent|avis|budget rent|national car|alamo|sixt|dollar rent|thrifty|car rental|rent a car)/i, 'Car Rental'],
  [/(uber|lyft|taxi|cab|amtrak|transit|shuttle|metro|subway rail)/i, 'Transportation'],
  [/(liquor|brewery|brewing|winery|bar\b|\bpub\b|tavern|taproom|cocktail|distiller|wine|spirits)/i, 'Drinks'],
  [/(national park|adventure|excursion|rafting|zipline|gondola|lift ticket|museum|\btour\b|guide|rentals?)/i, 'Activities'],
  [/(restaurant|cafe|coffee|grill|kitchen|pizza|burger|taco|sushi|ramen|cuisine|bbq|deli|bakery|gelato|ice cream|scoops|creamery|diner|eatery|bistro|kfc|mcdonald|chipotle|subway|panera|starbucks|dunkin|\bfood\b)/i, 'Food'],
  [/(walmart|target|\bcvs\b|walgreens|market|grocer|safeway|kroger|costco|sprt|sport|\bshop\b|store|mall|outfitter)/i, 'Shopping'],
]

function guessCategory(description) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(description)) return cat
  return 'Other'
}

function extractAmount(line) {
  const dollar = line.match(/(-?)\$\s?([\d,]+(?:\.\d{1,2})?)/)
  if (dollar) return { value: Number(dollar[2].replace(/,/g, '')) * (dollar[1] ? -1 : 1), raw: dollar[0] }
  const bare = line.match(/(?:^|\s)(-?[\d,]+\.\d{2})(?:\s|$)/)
  if (bare) return { value: Number(bare[1].replace(/,/g, '')), raw: bare[1] }
  return null
}

function extractDate(line) {
  const m = line.match(MONTH_RE)
  if (m) return { label: `${m[1][0].toUpperCase()}${m[1].slice(1, 3).toLowerCase()} ${m[2]}`, raw: m[0] }
  const s = line.match(SLASH_RE)
  if (s) return { label: s[1], raw: s[0] }
  const r = line.match(REL_RE)
  if (r) return { label: r[1][0].toUpperCase() + r[1].slice(1).toLowerCase(), raw: r[0] }
  return null
}

function scrub(text) {
  return text
    .replace(/\b[\d,]+\s*pts?\b/gi, ' ')
    .replace(/\b(pending|posted|approved|processing)\b/gi, ' ')
    .replace(/[,;|\u00b7\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-\u2013\u2014]+|[\s\-\u2013\u2014]+$/g, '')
    .trim()
}

// Accepts one-per-line ("Walmart, Aug 18, $76.12") or stacked app-screen output
// (merchant / date / amount on separate lines). Returns editable draft rows.
function parseTransactions(text) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const rows = []
  let heldDesc = ''
  let heldDate = ''
  lines.forEach(line => {
    if (NOISE_RE.test(line)) return
    const amount = extractAmount(line)
    if (!amount) {
      const d = extractDate(line)
      const rest = d ? scrub(line.replace(d.raw, ' ')) : scrub(line)
      if (d) heldDate = d.label
      if (rest) heldDesc = heldDesc ? `${heldDesc} ${rest}` : rest
      return
    }
    let rest = line.replace(amount.raw, ' ')
    const d = extractDate(rest)
    let date = heldDate
    if (d) { date = d.label; rest = rest.replace(d.raw, ' ') }
    rest = scrub(rest)
    if (/^[\d.\s]*$/.test(rest)) rest = ''
    const description = rest || heldDesc || 'Expense'
    if (amount.value > 0) {
      rows.push({ description, date, amount: amount.value.toFixed(2), category: guessCategory(description) })
    }
    heldDesc = ''
    heldDate = ''
  })
  return rows
}

function calcSettlements(people, expenses, fallbackPayer) {
  const net = {}
  people.forEach(p => { net[p.name] = 0 })
  expenses.forEach(exp => {
    const paidBy = exp.paid_by || fallbackPayer
    if (!exp.involved.length || !paidBy) return
    const share = Number(exp.amount) / exp.involved.length
    net[paidBy] = (net[paidBy] ?? 0) + Number(exp.amount)
    exp.involved.forEach(name => { net[name] = (net[name] ?? 0) - share })
  })
  const creditors = Object.entries(net).filter(([, b]) => b > 0.01).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)
  const debtors   = Object.entries(net).filter(([, b]) => b < -0.01).map(([name, amount]) => ({ name, amount: -amount })).sort((a, b) => b.amount - a.amount)
  const settlements = []
  let i = 0, j = 0
  const c = creditors.map(x => ({ ...x }))
  const d = debtors.map(x => ({ ...x }))
  while (i < c.length && j < d.length) {
    const amt = Math.min(c[i].amount, d[j].amount)
    settlements.push({ from: d[j].name, to: c[i].name, amount: Math.round(amt * 100) / 100 })
    c[i].amount -= amt; d[j].amount -= amt
    if (c[i].amount < 0.01) i++
    if (d[j].amount < 0.01) j++
  }
  return { net, settlements }
}

const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

function pad(n) { return String(n).padStart(2, '0') }

// A trip rarely spans New Year, so anchor a bare "Aug 20" to the trip's start
// year and only roll forward when the month sits well before it.
function resolveYear(month, trip) {
  const start = trip?.start_date
  if (!start) return new Date().getFullYear()
  const startYear = Number(start.slice(0, 4))
  const startMonth = Number(start.slice(5, 7)) - 1
  return month < startMonth - 6 ? startYear + 1 : startYear
}

// Turns whatever the paste parser found ("Aug 20", "8/20", "Yesterday") into
// the YYYY-MM-DD the date column wants.
function labelToISO(label, trip) {
  if (!label) return ''
  const rel = label.match(/^(yesterday|today)$/i)
  if (rel) {
    const d = new Date()
    if (rel[1].toLowerCase() === 'yesterday') d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  const named = label.match(/^([a-z]{3,})\.?\s+(\d{1,2})$/i)
  if (named) {
    const month = MONTH_INDEX[named[1].slice(0, 3).toLowerCase()]
    if (month === undefined) return ''
    return `${resolveYear(month, trip)}-${pad(month + 1)}-${pad(Number(named[2]))}`
  }
  const slash = label.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (slash) {
    const month = Number(slash[1]) - 1
    const year = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : resolveYear(month, trip)
    return `${year}-${pad(month + 1)}-${pad(Number(slash[2]))}`
  }
  return ''
}

function groupLabel(iso) {
  if (!iso) return 'No date'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Default a new expense to today when the trip is happening now, otherwise to
// the day it started.
function defaultExpenseDate(trip) {
  if (!trip?.start_date) return ''
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  if (today >= trip.start_date && (!trip.end_date || today <= trip.end_date)) return today
  return trip.start_date
}

function calcNights(start, end) {
  if (!start || !end) return null
  const diff = new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')
  return Math.round(diff / (1000 * 60 * 60 * 24))
}

function fmt(date) {
  if (!date) return null
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Trips() {
  const { user } = useAuth()
  const [trips, setTrips]         = useState([])
  const [active, setActive]       = useState(null)
  const [people, setPeople]       = useState([])
  const [expenses, setExpenses]   = useState([])
  const [payer, setPayer]         = useState('')
  const [payerLocked, setPayerLocked] = useState(false)
  const [lateAdded, setLateAdded] = useState([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState('People')
  const [tripModal, setTripModal] = useState(false)
  const [expenseModal, setExpenseModal] = useState(false)
  const [tripForm, setTripForm]   = useState({ name: '', destination: '', start_date: '', end_date: '' })
  const [newPerson, setNewPerson] = useState('')
  const [expForm, setExpForm]     = useState(EMPTY_EXPENSE)
  const [editExpense, setEditExpense] = useState(null)
  const [saving, setSaving]       = useState(false)
  const [confirmTrip, setConfirmTrip]     = useState(null)
  const [editingTrip, setEditingTrip]     = useState(null)
  const [tripFormError, setTripFormError] = useState('')
  const [confirmExpense, setConfirmExpense] = useState(null)
  const [gearOpen, setGearOpen]   = useState(false)
  const [confirmPerson, setConfirmPerson] = useState(null)
  const [editingPerson, setEditingPerson] = useState(null) // { id, name }
  const [editPersonName, setEditPersonName] = useState('')
  const [copying, setCopying]     = useState(false)
  const [view, setView]           = useState('active') // 'active' | 'archived'
  const [importModal, setImportModal] = useState(false)
  const [importText, setImportText]   = useState('')
  const [importRows, setImportRows]   = useState([])
  const [importInvolved, setImportInvolved] = useState([])
  const [importing, setImporting]     = useState(false)

  async function loadTrips() {
    const { data } = await supabase.from('split_events').select('*').eq('user_id', user.id).or('type.eq.trip,type.is.null').order('created_at', { ascending: false })
    setTrips(data ?? [])
    setLoading(false)
  }

  async function loadTrip(trip) {
    const [p, e] = await Promise.all([
      supabase.from('split_people').select('*').eq('event_id', trip.id),
      supabase.from('split_expenses').select('*').eq('event_id', trip.id).order('id', { ascending: true }),
    ])
    setPeople(p.data ?? [])
    setExpenses(e.data ?? [])
    setPayer(trip.payer ?? '')
    setPayerLocked(!!(trip.payer))
    setLateAdded([])
    setActive(trip)
    setTab((trip.payer || (e.data?.length ?? 0) > 0) ? 'Expenses' : 'People')
    setEditingPerson(null)
    setEditPersonName('')
  }

  useEffect(() => { loadTrips() }, [])

  useEffect(() => {
    if (!gearOpen) return
    const close = () => setGearOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [gearOpen])

  function openEditTrip(trip) {
    setTripForm({ name: trip.name, destination: trip.destination ?? '', start_date: trip.start_date ?? '', end_date: trip.end_date ?? '' })
    setEditingTrip(trip.id)
    setTripModal(true)
  }

  async function createTrip() {
    if (!tripForm.name.trim()) return
    if (tripForm.start_date && tripForm.end_date && tripForm.end_date < tripForm.start_date) {
      setTripFormError('End date cannot be before start date.')
      return
    }
    setTripFormError('')
    setSaving(true)
    if (editingTrip) {
      await supabase.from('split_events').update({
        name: tripForm.name.trim(),
        destination: tripForm.destination || null,
        start_date: tripForm.start_date || null,
        end_date: tripForm.end_date || null,
      }).eq('id', editingTrip)
      setSaving(false); setTripModal(false); setTripForm({ name: '', destination: '', start_date: '', end_date: '' }); setEditingTrip(null)
      await loadTrips()
      if (active?.id === editingTrip) setActive(prev => ({ ...prev, name: tripForm.name.trim(), destination: tripForm.destination || null, start_date: tripForm.start_date || null, end_date: tripForm.end_date || null }))
      return
    }
    const { data } = await supabase.from('split_events').insert({
      name: tripForm.name.trim(),
      destination: tripForm.destination || null,
      start_date: tripForm.start_date || null,
      end_date: tripForm.end_date || null,
      type: 'trip',
      user_id: user.id,
    }).select().single()
    setSaving(false); setTripModal(false); setTripForm({ name: '', destination: '', start_date: '', end_date: '' })
    if (data) { await loadTrips(); loadTrip(data) }
  }

  async function deleteTrip(trip) {
    await supabase.from('split_events').delete().eq('id', trip.id)
    setConfirmTrip(null)
    if (active?.id === trip.id) { setActive(null); setPeople([]); setExpenses([]) }
    loadTrips()
  }

  async function archiveTrip(trip, archived) {
    await supabase.from('split_events').update({ archived }).eq('id', trip.id)
    loadTrips()
  }

  async function addPerson() {
    if (!newPerson.trim() || !active) return
    if (people.some(p => p.name.toLowerCase() === newPerson.trim().toLowerCase())) return
    const { data } = await supabase.from('split_people').insert({ event_id: active.id, user_id: user.id, name: newPerson.trim() }).select().single()
    if (data) {
      setPeople(prev => [...prev, data])
      if (expenses.length > 0) setLateAdded(prev => [...prev, data.name])
    }
    setNewPerson('')
  }

  async function removePerson(id) {
    await supabase.from('split_people').delete().eq('id', id)
    setPeople(prev => prev.filter(p => p.id !== id))
    setConfirmPerson(null)
  }

  // Renaming has to cascade: expenses store payer and split members by name,
  // so a bare rename would orphan every expense referencing the old one.
  async function renamePerson() {
    const name = editPersonName.trim()
    if (!name || !editingPerson) return
    const oldName = editingPerson.name
    if (name === oldName) { setEditingPerson(null); setEditPersonName(''); return }
    if (people.some(p => p.id !== editingPerson.id && p.name.toLowerCase() === name.toLowerCase())) return

    await supabase.from('split_people').update({ name }).eq('id', editingPerson.id)
    await supabase.from('split_expenses').update({ paid_by: name }).eq('event_id', active.id).eq('paid_by', oldName)

    const { data: affected } = await supabase.from('split_expenses').select('id, involved').eq('event_id', active.id)
    await Promise.all((affected ?? []).filter(e => e.involved?.includes(oldName)).map(e =>
      supabase.from('split_expenses').update({ involved: e.involved.map(n => n === oldName ? name : n) }).eq('id', e.id)
    ))

    if (payer === oldName) {
      await supabase.from('split_events').update({ payer: name }).eq('id', active.id)
      setPayer(name)
      setActive(prev => ({ ...prev, payer: name }))
    }

    const { data: updated } = await supabase.from('split_expenses').select('*').eq('event_id', active.id).order('id', { ascending: true })
    setExpenses(updated ?? [])
    setPeople(prev => prev.map(p => p.id === editingPerson.id ? { ...p, name } : p))
    setLateAdded(prev => prev.map(n => n === oldName ? name : n))
    setEditingPerson(null)
    setEditPersonName('')
  }

  async function togglePaid(personId, current) {
    await supabase.from('split_people').update({ paid: !current }).eq('id', personId)
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, paid: !current } : p))
  }

  async function savePayer(name) {
    setPayer(name ?? '')
    if (!name) setPayerLocked(false)
    await supabase.from('split_events').update({ payer: name || null }).eq('id', active.id)
  }

  async function generateLink() {
    const token = crypto.randomUUID()
    await supabase.from('split_events').update({ share_token: token }).eq('id', active.id)
    setActive(prev => ({ ...prev, share_token: token }))
    setGearOpen(false)
    copyLink(token)
  }

  async function removeLink() {
    await supabase.from('split_events').update({ share_token: null }).eq('id', active.id)
    setActive(prev => ({ ...prev, share_token: null }))
    setGearOpen(false)
  }

  async function copyLink(token) {
    const url = `${window.location.origin}/split/share/${token}`
    await navigator.clipboard.writeText(url)
    setCopying(true)
    setTimeout(() => setCopying(false), 2000)
  }

  function openNewExpense() {
    setExpForm({ ...EMPTY_EXPENSE, paidBy: payer || (people.length === 1 ? people[0].name : ''), involved: people.map(p => p.name), date: defaultExpenseDate(active) })
    setEditExpense(null)
    setExpenseModal(true)
  }

  function openEditExpense(exp) {
    setExpForm({ description: exp.description, category: exp.category, amount: exp.amount, paidBy: exp.paid_by || payer || '', involved: exp.involved, date: exp.expense_date ?? '' })
    setEditExpense(exp)
    setExpenseModal(true)
  }

  async function saveExpense() {
    if (!expForm.description || !expForm.amount || !expForm.paidBy || !expForm.involved.length) return
    setSaving(true)
    const payload = {
      event_id: active.id, user_id: user.id,
      description: expForm.description,
      category: expForm.category,
      amount: Number(expForm.amount),
      paid_by: expForm.paidBy,
      involved: expForm.involved,
      expense_date: expForm.date || null,
    }
    if (editExpense) await supabase.from('split_expenses').update(payload).eq('id', editExpense.id)
    else             await supabase.from('split_expenses').insert(payload)
    setSaving(false); setExpenseModal(false)
    const { data } = await supabase.from('split_expenses').select('*').eq('event_id', active.id).order('id', { ascending: true })
    setExpenses(data ?? [])
  }

  async function deleteExpense(id) {
    await supabase.from('split_expenses').delete().eq('id', id)
    setExpenses(prev => prev.filter(e => e.id !== id))
    setConfirmExpense(null)
  }

  function openImport() {
    setImportText('')
    setImportRows([])
    setImportInvolved(people.map(p => p.name))
    setImportModal(true)
  }

  function readImportText(text) {
    setImportText(text)
    const fallback = payer || (people.length === 1 ? people[0].name : '')
    setImportRows(parseTransactions(text).map(r => ({ ...r, paidBy: fallback, date: labelToISO(r.date, active) || defaultExpenseDate(active) })))
  }

  function updateImportRow(i, patch) {
    setImportRows(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

  function setAllImportPayers(name) {
    setImportRows(rows => rows.map(r => ({ ...r, paidBy: name })))
  }

  async function saveImport() {
    const rows = importRows.filter(r => r.description.trim() && Number(r.amount) > 0 && r.paidBy)
    if (!rows.length || !importInvolved.length) return
    setImporting(true)
    await supabase.from('split_expenses').insert(rows.map(r => ({
      event_id: active.id,
      user_id: user.id,
      description: r.description.trim(),
      category: r.category,
      amount: Number(r.amount),
      paid_by: r.paidBy,
      involved: importInvolved,
      expense_date: r.date || null,
    })))
    const { data } = await supabase.from('split_expenses').select('*').eq('event_id', active.id).order('id', { ascending: true })
    setExpenses(data ?? [])
    setImporting(false)
    setImportModal(false)
  }

  function toggleInvolved(name) {
    setExpForm(f => ({
      ...f,
      involved: f.involved.includes(name) ? f.involved.filter(n => n !== name) : [...f.involved, name]
    }))
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const paidTotals = expenses.reduce((acc, e) => {
    const name = e.paid_by || payer
    if (name) acc[name] = (acc[name] ?? 0) + Number(e.amount)
    return acc
  }, {})
  const payerNames = Object.keys(paidTotals).sort((a, b) => paidTotals[b] - paidTotals[a])
  const datedExpenses = [...expenses].sort((a, b) => {
    if (a.expense_date === b.expense_date) return a.id - b.id
    if (!a.expense_date) return 1
    if (!b.expense_date) return -1
    return a.expense_date < b.expense_date ? -1 : 1
  })
  const expenseGroups = datedExpenses.reduce((groups, e) => {
    const label = groupLabel(e.expense_date)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(e)
    else groups.push({ label, items: [e] })
    return groups
  }, [])
  const { settlements } = (active && people.length > 0) ? calcSettlements(people, expenses, payer) : { settlements: [] }
  const byCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + Number(e.amount)
    return acc
  }, {})

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {active && (
            <button onClick={() => { setActive(null); setPeople([]); setExpenses([]) }} className="text-gray-400 hover:text-white transition-colors text-sm">← Trips</button>
          )}
          <h1 className="text-2xl font-bold">{active ? active.name : 'Trips'}</h1>
        </div>

        <div className="flex items-center gap-2">
          {!active ? (
            <>
              <button
                onClick={() => setView(v => v === 'archived' ? 'active' : 'archived')}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${view === 'archived' ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                {view === 'archived' ? '← Active' : '🗃 Archived'}
              </button>
              {view !== 'archived' && (
                <button onClick={() => setTripModal(true)} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">+ New Trip</button>
              )}
            </>
          ) : (
            <>
              {tab === 'Expenses' && people.length > 0 && (
                <>
                  <button onClick={openImport} className="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-3 py-2 rounded-xl text-sm font-medium transition-colors">\u2193 Import</button>
                  <button onClick={openNewExpense} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">+ Add Expense</button>
                </>
              )}
              <div className="relative">
                <button
                  onClick={e => { e.stopPropagation(); setGearOpen(o => !o) }}
                  className="px-3 py-2 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                >
                  Share
                </button>
                {gearOpen && (
                  <div className="absolute right-0 top-10 bg-gray-900 border border-gray-700 rounded-xl shadow-xl w-52 z-50 overflow-hidden">
                    {active.share_token ? (
                      <>
                        <button onClick={() => { copyLink(active.share_token); setGearOpen(false) }} className="w-full text-left px-4 py-3 text-sm text-white hover:bg-gray-800 transition-colors flex items-center gap-2">
                          <span>🔗</span> {copying ? 'Copied!' : 'Copy Share Link'}
                        </button>
                        <button onClick={generateLink} className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:bg-gray-800 transition-colors flex items-center gap-2 border-t border-gray-800">
                          <span>🔄</span> Reset Link
                        </button>
                        <button onClick={removeLink} className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-gray-800 transition-colors flex items-center gap-2 border-t border-gray-800">
                          <span>🗑️</span> Remove Link
                        </button>
                      </>
                    ) : (
                      <button onClick={generateLink} className="w-full text-left px-4 py-3 text-sm text-white hover:bg-gray-800 transition-colors flex items-center gap-2">
                        <span>🔗</span> Generate Share Link
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Trip List */}
      {!active && (() => {
        const filtered = trips.filter(t => view === 'archived' ? t.archived : !t.archived)
        return filtered.length === 0 ? (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-4xl mb-3">{view === 'archived' ? '🗃' : '✈️'}</p>
            <p className="text-lg font-medium">{view === 'archived' ? 'No archived trips' : 'No trips yet'}</p>
            <p className="text-sm mt-1">{view === 'archived' ? 'Archived trips will appear here.' : 'Create a trip to start tracking and splitting expenses.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.map(trip => (
              <div key={trip.id} onClick={() => loadTrip(trip)} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 cursor-pointer hover:border-gray-600 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{trip.name}</p>
                    {trip.destination && <p className="text-gray-400 text-xs mt-0.5">📍 {trip.destination}</p>}
                    {(trip.start_date || trip.end_date) && (
                      <p className="text-gray-500 text-xs mt-0.5">
                        {fmt(trip.start_date)}{trip.start_date && trip.end_date ? ' → ' : ''}{fmt(trip.end_date)}
                      </p>
                    )}
                    {!trip.destination && !trip.start_date && (
                      <p className="text-gray-600 text-xs mt-0.5">{new Date(trip.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    )}
                  </div>
                  <div className="flex gap-1.5 ml-3 shrink-0">
                    {view !== 'archived' && <button onClick={e => { e.stopPropagation(); openEditTrip(trip) }} className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">Edit</button>}
                    <button onClick={e => { e.stopPropagation(); archiveTrip(trip, !trip.archived) }} className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">
                      {trip.archived ? 'Unarchive' : '🗃 Archive'}
                    </button>
                    <button onClick={e => { e.stopPropagation(); setConfirmTrip(trip) }} className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Trip Detail */}
      {active && (
        <>
          {/* Trip meta */}
          {(active.destination || active.start_date) && (
            <div className="flex items-center gap-4 text-xs text-gray-400">
              {active.destination && <span>📍 {active.destination}</span>}
              {active.start_date && <span>🗓 {fmt(active.start_date)}{active.end_date ? ` → ${fmt(active.end_date)}` : ''}</span>}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
            {TABS.map(t => {
              const locked = (t === 'Expenses' || t === 'Summary') && people.length === 0
              return (
                <button key={t} onClick={() => !locked && setTab(t)} disabled={locked}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    locked ? 'text-gray-600 cursor-not-allowed' :
                    tab === t ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}>
                  {t}
                </button>
              )
            })}
          </div>

          {/* People Tab */}
          {tab === 'People' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  value={newPerson} onChange={e => setNewPerson(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addPerson()}
                  placeholder="Add a person..."
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500"
                />
                <button onClick={addPerson} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">Add</button>
              </div>

              {people.length === 0 ? (
                <p className="text-gray-500 text-sm text-center mt-6">Add people to get started.</p>
              ) : (
                <>
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                    {people.map((p, i) => (
                      <div key={p.id} className={`flex items-center justify-between px-5 py-3 ${i < people.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-8 h-8 bg-brand-600/20 text-brand-400 rounded-full flex items-center justify-center text-sm font-semibold shrink-0">
                            {(editingPerson?.id === p.id ? editPersonName[0] : p.name[0])?.toUpperCase() ?? '?'}
                          </div>
                          {editingPerson?.id === p.id ? (
                            <input
                              autoFocus
                              value={editPersonName}
                              onChange={e => setEditPersonName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') renamePerson(); if (e.key === 'Escape') { setEditingPerson(null); setEditPersonName('') } }}
                              className="flex-1 min-w-0 bg-gray-800 border border-brand-500 rounded-lg px-2.5 py-1 text-sm text-white focus:outline-none"
                            />
                          ) : (
                            <span className="text-white text-sm truncate">{p.name}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          {editingPerson?.id === p.id ? (
                            <>
                              <button onClick={renamePerson} className="text-xs px-2.5 py-1 rounded-lg bg-brand-600/20 text-brand-400 hover:bg-brand-600/30 transition-colors">Save</button>
                              <button onClick={() => { setEditingPerson(null); setEditPersonName('') }} className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditingPerson(p); setEditPersonName(p.name) }} className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 text-gray-400 hover:text-white transition-colors">Edit</button>
                              <button onClick={() => setConfirmPerson(p.id)} className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">Remove</button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Card holder */}
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">Who used their card?</p>
                        <p className="text-xs text-gray-500">Sets the default on new expenses. If several people paid, pick the payer on each expense.</p>
                      </div>
                      {payerLocked && payer && (
                        <button onClick={() => setPayerLocked(false)} className="text-xs text-gray-400 hover:text-white transition-colors px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700">
                          Change
                        </button>
                      )}
                    </div>

                    {payerLocked && payer ? (
                      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-brand-500 bg-brand-500/10">
                        <div className="w-6 h-6 bg-brand-600/20 text-brand-400 rounded-full flex items-center justify-center text-xs font-semibold shrink-0">{payer[0].toUpperCase()}</div>
                        <span className="text-white text-sm font-medium">{payer}</span>
                        <span className="ml-auto text-brand-400 text-xs">💳 Default</span>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          {people.map(p => (
                            <button key={p.id} onClick={() => savePayer(p.name)}
                              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                                payer === p.name ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-gray-700 bg-gray-800 text-gray-400 hover:text-white hover:border-gray-600'
                              }`}>
                              <div className="w-6 h-6 bg-brand-600/20 text-brand-400 rounded-full flex items-center justify-center text-xs font-semibold shrink-0">{p.name[0].toUpperCase()}</div>
                              {p.name}
                            </button>
                          ))}
                        </div>
                        <button onClick={() => savePayer(null)}
                          className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                            payer ? 'border-gray-700 bg-gray-800 text-gray-400 hover:text-white hover:border-gray-600' : 'border-brand-500 bg-brand-500/10 text-white'
                          }`}>
                          <span>👥</span> Multiple cards — pick per expense
                        </button>
                      </>
                    )}
                  </div>

                  <button onClick={() => { if (payer) setPayerLocked(true); setTab('Expenses') }} className="w-full bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">
                    Next — Add Expenses →
                  </button>
                </>
              )}
            </div>
          )}

          {/* Expenses Tab */}
          {tab === 'Expenses' && (
            <div className="space-y-4">
              {/* Late added warning */}
              {lateAdded.length > 0 && (
                <div className="flex items-start gap-2 text-xs bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 rounded-xl px-4 py-3">
                  <span className="mt-0.5">⚠️</span>
                  <span><span className="font-medium">{lateAdded.join(', ')}</span> {lateAdded.length === 1 ? 'was' : 'were'} added after expenses existed. Review existing expenses to include them.</span>
                </div>
              )}

              {/* Summary widgets */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Total card */}
                <div className="col-span-2 sm:col-span-1 bg-gray-900 border border-brand-600/40 rounded-2xl p-4 flex flex-col gap-1">
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Total Spent</p>
                  <p className="text-xl font-bold text-brand-400">{formatCurrency(total)}</p>
                  <p className="text-xs text-gray-500">
                    {payerNames.length === 0 ? '—' : payerNames.length === 1 ? `💳 ${payerNames[0]}` : `💳 ${payerNames.length} cards`}
                  </p>
                </div>

                {/* Per person card */}
                {people.length > 0 && (
                  <div className="col-span-2 sm:col-span-1 bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col gap-1">
                    <p className="text-xs text-gray-400 uppercase tracking-wide">Per Person</p>
                    <p className="text-xl font-bold text-white">{formatCurrency(people.length > 0 ? total / people.length : 0)}</p>
                    <p className="text-xs text-gray-500">{people.length} people</p>
                  </div>
                )}

                {/* Category cards */}
                {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                  <div key={cat} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col gap-1">
                    <p className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-1">
                      <span>{CAT_ICON[cat] ?? '📦'}</span> {cat}
                    </p>
                    <p className="text-lg font-bold text-white">{formatCurrency(amt)}</p>
                    <p className="text-xs text-gray-500">{Math.round((amt / total) * 100)}% of total</p>
                  </div>
                ))}
              </div>

              {/* Expense list */}
              {expenses.length === 0 ? (
                <p className="text-gray-500 text-sm text-center mt-6">No expenses yet. Tap + Add Expense above.</p>
              ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Expenses</p>
                    <p className="text-xs text-gray-500">{expenses.length} item{expenses.length !== 1 ? 's' : ''}</p>
                  </div>
                  {expenseGroups.map(group => (
                    <div key={group.label}>
                      <div className="px-5 py-2 bg-gray-800/40 border-y border-gray-800/60 flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{group.label}</span>
                        <span className="text-xs text-gray-500">{formatCurrency(group.items.reduce((s, e) => s + Number(e.amount), 0))}</span>
                      </div>
                      {group.items.map((exp, i) => (
                    <div key={exp.id} className={`px-5 py-4 flex items-center gap-4 ${i < group.items.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
                      {/* Category icon */}
                      <div className="w-10 h-10 bg-gray-800 rounded-xl flex items-center justify-center text-lg shrink-0">
                        {CAT_ICON[exp.category] ?? '📦'}
                      </div>

                      {/* Description + avatars */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-white truncate">{exp.description}</p>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <span className="inline-flex items-center bg-gray-800 text-gray-400 text-xs px-2 py-0.5 rounded-full">
                            {exp.category}
                          </span>
                          {(exp.paid_by || payer) && (
                            <span className="inline-flex items-center gap-1 bg-brand-600/20 text-brand-300 text-xs px-2 py-0.5 rounded-full font-medium">
                              💳 {exp.paid_by || payer}
                            </span>
                          )}
                          {exp.involved.map(name => (
                            <span key={name} className="inline-flex items-center gap-1 bg-gray-800 text-gray-300 text-xs px-2 py-0.5 rounded-full">
                              <span className="w-4 h-4 bg-brand-600/30 text-brand-400 rounded-full flex items-center justify-center text-[10px] font-semibold">{name[0].toUpperCase()}</span>
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Amount + actions */}
                      <div className="text-right shrink-0">
                        <p className="font-bold text-white">{formatCurrency(exp.amount)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{formatCurrency(Number(exp.amount) / exp.involved.length)} each</p>
                        <div className="flex gap-1.5 mt-1.5 justify-end">
                          <button onClick={() => openEditExpense(exp)} className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">Edit</button>
                          <button onClick={() => setConfirmExpense(exp.id)} className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">Delete</button>
                        </div>
                      </div>
                    </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Summary Tab */}
          {tab === 'Summary' && (
            <div className="space-y-4">
              {expenses.length === 0 ? (
                <p className="text-gray-500 text-sm text-center mt-6">Add expenses first to see the summary.</p>
              ) : (
                <>
                  {/* Who paid */}
                  {payerNames.length > 1 && (
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                      <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">Who Paid</h2>
                      {payerNames.map(name => (
                        <div key={name} className="flex items-center justify-between px-5 py-3 border-b border-gray-800/60 last:border-0">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 bg-brand-600/20 text-brand-400 rounded-full flex items-center justify-center text-xs font-semibold">{name[0].toUpperCase()}</div>
                            <span className="text-sm text-white">{name}</span>
                          </div>
                          <span className="text-sm font-semibold text-brand-400">💳 {formatCurrency(paidTotals[name])}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Per person */}
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                    <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">Per Person</h2>
                    {people.map(p => {
                      const owes    = expenses.reduce((s, e) => e.involved.includes(p.name) ? s + Number(e.amount) / e.involved.length : s, 0)
                      const paid    = paidTotals[p.name] ?? 0
                      const balance = paid - owes
                      return (
                        <div key={p.id} className="flex items-center justify-between px-5 py-3 border-b border-gray-800/60 last:border-0">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 bg-brand-600/20 text-brand-400 rounded-full flex items-center justify-center text-xs font-semibold">{p.name[0].toUpperCase()}</div>
                            <span className="text-sm text-white">{p.name}</span>
                            {paid > 0 && <span className="text-xs text-gray-500">💳 paid {formatCurrency(paid)}</span>}
                          </div>
                          <div className="text-right text-xs">
                            <p className="text-gray-400">Share: <span className="text-white">{formatCurrency(owes)}</span></p>
                            <p className={`font-semibold mt-0.5 ${balance > 0.01 ? 'text-brand-400' : balance < -0.01 ? 'text-red-400' : 'text-gray-500'}`}>
                              {balance > 0.01 ? `Gets back ${formatCurrency(balance)}` : balance < -0.01 ? `Owes ${formatCurrency(-balance)}` : 'Settled ✓'}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Settlements */}
                  {settlements.length === 0 ? (
                    <div className="text-center text-brand-400 font-medium text-sm py-4">🎉 Everyone is settled!</div>
                  ) : (
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                      <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">Who Pays Who</h2>
                      {settlements.map((s, i) => {
                        const person = people.find(p => p.name === s.from)
                        return (
                          <div key={i} className={`flex items-center justify-between px-5 py-3 border-b border-gray-800/60 last:border-0 ${person?.paid ? 'opacity-40' : ''}`}>
                            <div className="text-sm">
                              <span className="text-red-400 font-medium">{s.from}</span>
                              <span className="text-gray-500 mx-2">→</span>
                              <span className="text-brand-400 font-medium">{s.to}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-white">{formatCurrency(s.amount)}</span>
                              {person && (
                                <button
                                  onClick={() => togglePaid(person.id, person.paid)}
                                  className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${person.paid ? 'bg-brand-600/20 text-brand-400' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                                >
                                  {person.paid ? '✓ Paid' : 'Mark Paid'}
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {/* Overview Tab */}
          {tab === 'Overview' && active && (() => {
            const nights = calcNights(active.start_date, active.end_date)
            const costPerNight = nights > 0 ? total / nights : null
            const costPerPersonPerNight = (nights > 0 && people.length > 0) ? total / nights / people.length : null
            return (
              <div className="space-y-4">
                {/* Dates & nights */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
                  <h2 className="font-semibold text-sm">Trip Details</h2>
                  {active.destination && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">Destination</span>
                      <span className="text-white">📍 {active.destination}</span>
                    </div>
                  )}
                  {active.start_date && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">Check-in</span>
                      <span className="text-white">{fmt(active.start_date)}</span>
                    </div>
                  )}
                  {active.end_date && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">Check-out</span>
                      <span className="text-white">{fmt(active.end_date)}</span>
                    </div>
                  )}
                  {nights !== null && nights >= 0 && (
                    <div className="flex items-center justify-between text-sm border-t border-gray-800 pt-3">
                      <span className="text-gray-400">Duration</span>
                      <span className="text-white font-semibold">🌙 {nights} night{nights !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {people.length > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">Travellers</span>
                      <span className="text-white">{people.length} {people.length === 1 ? 'person' : 'people'}</span>
                    </div>
                  )}
                </div>

                {/* Cost breakdown */}
                {expenses.length > 0 && (
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
                    <h2 className="font-semibold text-sm">Cost Breakdown</h2>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">Total spent</span>
                      <span className="text-brand-400 font-semibold">{formatCurrency(total)}</span>
                    </div>
                    {people.length > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Per person</span>
                        <span className="text-white font-semibold">{formatCurrency(total / people.length)}</span>
                      </div>
                    )}
                    {costPerNight !== null && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Per night</span>
                        <span className="text-white font-semibold">{formatCurrency(costPerNight)}</span>
                      </div>
                    )}
                    {costPerPersonPerNight !== null && (
                      <div className="flex items-center justify-between text-sm border-t border-gray-800 pt-3">
                        <span className="text-gray-400">Per person / per night</span>
                        <span className="text-white font-semibold">{formatCurrency(costPerPersonPerNight)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Category breakdown */}
                {Object.keys(byCategory).length > 0 && (
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                    <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">By Category</h2>
                    {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt], i, arr) => (
                      <div key={cat} className={`flex items-center justify-between px-5 py-3 ${i < arr.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
                        <div className="flex items-center gap-2 text-sm">
                          <span>{CAT_ICON[cat] ?? '📦'}</span>
                          <span className="text-gray-300">{cat}</span>
                        </div>
                        <div className="text-right text-sm">
                          <span className="text-white font-medium">{formatCurrency(amt)}</span>
                          <span className="text-gray-500 ml-2 text-xs">{Math.round((amt / total) * 100)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {expenses.length === 0 && (
                  <p className="text-gray-500 text-sm text-center mt-6">Add expenses to see cost breakdown.</p>
                )}
              </div>
            )
          })()}
        </>
      )}

      {/* New Trip Modal */}
      {tripModal && (
        <Modal title={editingTrip ? 'Edit Trip' : 'New Trip'} onClose={() => { setTripModal(false); setEditingTrip(null); setTripForm({ name: '', destination: '', start_date: '', end_date: '' }); setTripFormError('') }}>
          <div className="space-y-4">
            <Field label="Trip Name">
              <input value={tripForm.name} onChange={e => setTripForm(f => ({ ...f, name: e.target.value }))} onKeyDown={e => e.key === 'Enter' && createTrip()} placeholder="e.g. Vegas, Cancun 2025" />
            </Field>
            <Field label="Destination (optional)">
              <input value={tripForm.destination} onChange={e => setTripForm(f => ({ ...f, destination: e.target.value }))} placeholder="e.g. Las Vegas, NV" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start Date">
                <input type="date" value={tripForm.start_date} onChange={e => setTripForm(f => ({ ...f, start_date: e.target.value }))} />
              </Field>
              <Field label="End Date">
                <input type="date" value={tripForm.end_date} onChange={e => { setTripForm(f => ({ ...f, end_date: e.target.value })); setTripFormError('') }} />
              </Field>
              {tripForm.start_date && tripForm.end_date && calcNights(tripForm.start_date, tripForm.end_date) >= 0 && (
                <p className="text-xs text-brand-400 -mt-1">🌙 {calcNights(tripForm.start_date, tripForm.end_date)} night{calcNights(tripForm.start_date, tripForm.end_date) !== 1 ? 's' : ''}</p>
              )}
              {tripFormError && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-3 py-2">{tripFormError}</p>}
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setTripModal(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">Cancel</button>
              <button onClick={createTrip} disabled={saving || !tripForm.name.trim()} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">{saving ? 'Saving…' : editingTrip ? 'Save Changes' : 'Create Trip'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add/Edit Expense Modal */}
      {expenseModal && (
        <Modal title={editExpense ? 'Edit Expense' : 'Add Expense'} onClose={() => setExpenseModal(false)}>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <Field label="Description">
              <input value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Dinner at Nobu" />
            </Field>
            <Field label="Category">
              <select value={expForm.category} onChange={e => setExpForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Amount ($)">
              <input type="number" min="0" step="0.01" value={expForm.amount} onChange={e => setExpForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
            </Field>
            <Field label="Date">
              <input type="date" value={expForm.date} onChange={e => setExpForm(f => ({ ...f, date: e.target.value }))} />
            </Field>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Who paid?</label>
              <div className="grid grid-cols-2 gap-2">
                {people.map(p => (
                  <button key={p.id} type="button" onClick={() => setExpForm(f => ({ ...f, paidBy: p.name }))}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      expForm.paidBy === p.name ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-gray-700 bg-gray-800 text-gray-400 hover:text-white hover:border-gray-600'
                    }`}>
                    <div className="w-6 h-6 bg-brand-600/20 text-brand-400 rounded-full flex items-center justify-center text-xs font-semibold shrink-0">{p.name[0].toUpperCase()}</div>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Who was involved?</label>
              <div className="grid grid-cols-2 gap-2">
                {people.map(p => (
                  <label key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors text-sm ${expForm.involved.includes(p.name) ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-gray-700 bg-gray-800 text-gray-400'}`}>
                    <input type="checkbox" checked={expForm.involved.includes(p.name)} onChange={() => toggleInvolved(p.name)} className="accent-green-500" />
                    {p.name}
                  </label>
                ))}
              </div>
              {expForm.involved.length > 0 && expForm.amount && (
                <p className="text-xs text-gray-500 mt-2">{formatCurrency(Number(expForm.amount) / expForm.involved.length)} per person ({expForm.involved.length} people)</p>
              )}
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setExpenseModal(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">Cancel</button>
              <button onClick={saveExpense} disabled={saving || !expForm.description || !expForm.amount || !expForm.paidBy || !expForm.involved.length} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Import Transactions Modal */}
      {importModal && (
        <Modal title="Import Transactions" onClose={() => setImportModal(false)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Paste transactions</label>
              <textarea
                value={importText}
                onChange={e => readImportText(e.target.value)}
                rows={importRows.length ? 4 : 9}
                placeholder={'Walmart, Aug 18, $76.12\nTBar, Aug 19, $178.80\n\nOr paste straight from your bank app.'}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-brand-500 transition-colors"
              />
              <p className="text-xs text-gray-500 mt-1.5">
                {importRows.length > 0
                  ? `Found ${importRows.length} transaction${importRows.length !== 1 ? 's' : ''} \u00b7 ${formatCurrency(importRows.reduce((s, r) => s + Number(r.amount || 0), 0))}`
                  : 'Merchant, date and amount \u2014 one per line, or stacked.'}
              </p>
            </div>

            {importRows.length > 0 && (
              <>
                {people.length > 0 && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Set all to paid by</label>
                    <div className="grid grid-cols-2 gap-2">
                      {people.map(p => (
                        <button key={p.id} type="button" onClick={() => setAllImportPayers(p.name)}
                          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-700 bg-gray-800 text-gray-400 hover:text-white hover:border-gray-600 text-sm font-medium transition-colors">
                          <div className="w-5 h-5 bg-brand-600/20 text-brand-400 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0">{p.name[0].toUpperCase()}</div>
                          {p.name}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5">You can still change the payer on any single row below.</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Who was involved? (applies to all)</label>
                  <div className="grid grid-cols-2 gap-2">
                    {people.map(p => (
                      <label key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors text-sm ${importInvolved.includes(p.name) ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-gray-700 bg-gray-800 text-gray-400'}`}>
                        <input type="checkbox" checked={importInvolved.includes(p.name)} className="accent-green-500"
                          onChange={() => setImportInvolved(list => list.includes(p.name) ? list.filter(n => n !== p.name) : [...list, p.name])} />
                        {p.name}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm text-gray-400">Review \u0026 edit</label>
                  {importRows.map((r, i) => (
                    <div key={i} className="bg-gray-800/60 border border-gray-700 rounded-xl p-2.5 space-y-2">
                      <div className="flex gap-2">
                        <input value={r.description} onChange={e => updateImportRow(i, { description: e.target.value })}
                          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500" />
                        <input value={r.amount} onChange={e => updateImportRow(i, { amount: e.target.value })} inputMode="decimal"
                          className="w-20 shrink-0 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-white text-right focus:outline-none focus:border-brand-500" />
                        <button onClick={() => setImportRows(rows => rows.filter((_, idx) => idx !== i))}
                          className="shrink-0 px-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs transition-colors">\u2715</button>
                      </div>
                      <div className="flex gap-2">
                        <select value={r.category} onChange={e => updateImportRow(i, { category: e.target.value })}
                          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500">
                          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                        <select value={r.paidBy} onChange={e => updateImportRow(i, { paidBy: e.target.value })}
                          className={`flex-1 min-w-0 bg-gray-800 border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-brand-500 ${r.paidBy ? 'border-gray-700 text-white' : 'border-red-500/50 text-red-400'}`}>
                          <option value="">Who paid?</option>
                          {people.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                        </select>
                        <input type="date" value={r.date} onChange={e => updateImportRow(i, { date: e.target.value })}
                          className="shrink-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500" />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={() => setImportModal(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">Cancel</button>
              <button onClick={saveImport}
                disabled={importing || !importRows.length || !importInvolved.length || importRows.some(r => !r.paidBy || !(Number(r.amount) > 0))}
                className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">
                {importing ? 'Adding\u2026' : `Add ${importRows.length} expense${importRows.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirmTrip && <ConfirmModal message={`Delete "${confirmTrip.name}"? All expenses will be lost.`} onConfirm={() => deleteTrip(confirmTrip)} onCancel={() => setConfirmTrip(null)} />}
      {confirmExpense && <ConfirmModal message="Delete this expense?" onConfirm={() => deleteExpense(confirmExpense)} onCancel={() => setConfirmExpense(null)} />}
      {confirmPerson && <ConfirmModal message="Remove this person? Expenses that name them keep the old name." onConfirm={() => removePerson(confirmPerson)} onCancel={() => setConfirmPerson(null)} />}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1.5">{label}</label>
      <children.type {...children.props} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 transition-colors" />
    </div>
  )
}
