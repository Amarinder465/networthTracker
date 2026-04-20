import { useEffect, useState } from 'react'
import Spinner from '../components/Spinner'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrency } from '../lib/format'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'

const CATEGORIES = ['Flights', 'Hotel', 'Food', 'Drinks', 'Gas', 'Parking', 'Transportation', 'Activities', 'Shopping', 'Other']

const CAT_ICON = {
  Flights: '✈️', Hotel: '🏨', Food: '🍽️', Drinks: '🍹',
  Gas: '⛽', Parking: '🅿️', Transportation: '🚗',
  Activities: '🎯', Shopping: '🛍️', Other: '📦',
}
const TABS = ['People', 'Expenses', 'Summary', 'Overview']

const EMPTY_EXPENSE = { description: '', category: 'Food', amount: '', involved: [] }

function calcSettlements(people, expenses, payer) {
  const net = {}
  people.forEach(p => { net[p.name] = 0 })
  expenses.forEach(exp => {
    if (!exp.involved.length) return
    const share = Number(exp.amount) / exp.involved.length
    net[payer] = (net[payer] ?? 0) + Number(exp.amount)
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
  const [settled, setSettled]     = useState({})
  const [gearOpen, setGearOpen]   = useState(false)
  const [copying, setCopying]     = useState(false)
  const [view, setView]           = useState('active') // 'active' | 'archived'

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
    setTab(trip.payer ? 'Expenses' : 'People')
    setSettled({})
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
  }

  async function savePayer(name) {
    setPayer(name)
    await supabase.from('split_events').update({ payer: name }).eq('id', active.id)
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
    setExpForm({ ...EMPTY_EXPENSE, involved: people.map(p => p.name) })
    setEditExpense(null)
    setExpenseModal(true)
  }

  function openEditExpense(exp) {
    setExpForm({ description: exp.description, category: exp.category, amount: exp.amount, involved: exp.involved })
    setEditExpense(exp)
    setExpenseModal(true)
  }

  async function saveExpense() {
    if (!expForm.description || !expForm.amount || !expForm.involved.length) return
    setSaving(true)
    const payload = {
      event_id: active.id, user_id: user.id,
      description: expForm.description,
      category: expForm.category,
      amount: Number(expForm.amount),
      paid_by: payer,
      involved: expForm.involved,
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

  function toggleInvolved(name) {
    setExpForm(f => ({
      ...f,
      involved: f.involved.includes(name) ? f.involved.filter(n => n !== name) : [...f.involved, name]
    }))
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const { settlements } = (active && payer) ? calcSettlements(people, expenses, payer) : { settlements: [] }
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
              {tab === 'Expenses' && people.length > 0 && payer && (
                <button onClick={openNewExpense} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">+ Add Expense</button>
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
              const locked = (t === 'Expenses' || t === 'Summary') && (!payer || people.length === 0)
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
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-brand-600/20 text-brand-400 rounded-full flex items-center justify-center text-sm font-semibold">{p.name[0].toUpperCase()}</div>
                          <span className="text-white text-sm">{p.name}</span>
                        </div>
                        <button onClick={() => removePerson(p.id)} className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">Remove</button>
                      </div>
                    ))}
                  </div>

                  {/* Card holder */}
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">Who used their card?</p>
                        <p className="text-xs text-gray-500">All expenses will be assumed paid by this person.</p>
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
                        <span className="ml-auto text-brand-400 text-xs">💳 Locked</span>
                      </div>
                    ) : (
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
                    )}
                  </div>

                  {payer && (
                    <button onClick={() => { setPayerLocked(true); setTab('Expenses') }} className="w-full bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">
                      Next — Add Expenses →
                    </button>
                  )}
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
                  <p className="text-xs text-gray-500">💳 {payer}</p>
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
                  {expenses.map((exp, i) => (
                    <div key={exp.id} className={`px-5 py-4 flex items-center gap-4 ${i < expenses.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
                      {/* Category icon */}
                      <div className="w-10 h-10 bg-gray-800 rounded-xl flex items-center justify-center text-lg shrink-0">
                        {CAT_ICON[exp.category] ?? '📦'}
                      </div>

                      {/* Description + avatars */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-white truncate">{exp.description}</p>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
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
                  {/* Per person */}
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                    <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">Per Person</h2>
                    {people.map(p => {
                      const owes    = expenses.reduce((s, e) => e.involved.includes(p.name) ? s + Number(e.amount) / e.involved.length : s, 0)
                      const isPayer = p.name === payer
                      const balance = isPayer ? total - owes : -owes
                      return (
                        <div key={p.id} className="flex items-center justify-between px-5 py-3 border-b border-gray-800/60 last:border-0">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 bg-brand-600/20 text-brand-400 rounded-full flex items-center justify-center text-xs font-semibold">{p.name[0].toUpperCase()}</div>
                            <span className="text-sm text-white">{p.name}</span>
                            {isPayer && <span className="text-xs text-gray-500">💳</span>}
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
                      {settlements.map((s, i) => (
                        <div key={i} className={`flex items-center justify-between px-5 py-3 border-b border-gray-800/60 last:border-0 ${settled[i] ? 'opacity-40' : ''}`}>
                          <div className="text-sm">
                            <span className="text-red-400 font-medium">{s.from}</span>
                            <span className="text-gray-500 mx-2">→</span>
                            <span className="text-brand-400 font-medium">{s.to}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-white">{formatCurrency(s.amount)}</span>
                            <button
                              onClick={() => setSettled(prev => ({ ...prev, [i]: !prev[i] }))}
                              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${settled[i] ? 'bg-brand-600/20 text-brand-400' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                            >
                              {settled[i] ? '✓ Settled' : 'Mark Settled'}
                            </button>
                          </div>
                        </div>
                      ))}
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
              <button onClick={saveExpense} disabled={saving || !expForm.description || !expForm.amount || !expForm.involved.length} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {confirmTrip && <ConfirmModal message={`Delete "${confirmTrip.name}"? All expenses will be lost.`} onConfirm={() => deleteTrip(confirmTrip)} onCancel={() => setConfirmTrip(null)} />}
      {confirmExpense && <ConfirmModal message="Delete this expense?" onConfirm={() => deleteExpense(confirmExpense)} onCancel={() => setConfirmExpense(null)} />}
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
