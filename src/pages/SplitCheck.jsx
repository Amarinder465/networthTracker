import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrency } from '../lib/format'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
import Spinner from '../components/Spinner'

const CATEGORIES = ['Food', 'Drinks', 'Activities', 'Cover', 'Transport', 'Hotel', 'Shopping', 'Other']
const CAT_ICON   = { Food: '🍽️', Drinks: '🍹', Activities: '🎯', Cover: '🎟️', Transport: '🚗', Hotel: '🏨', Shopping: '🛍️', Other: '📦' }
const TABS       = ['People', 'Expenses', 'Summary']

const EMPTY_EXPENSE = { description: '', category: 'Food', amount: '', paidBy: '', involved: [] }

function fmt(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function calcSettlements(people, expenses) {
  const net = {}
  people.forEach(p => { net[p.name] = 0 })
  expenses.forEach(exp => {
    const involved = exp.involved?.length ? exp.involved : people.map(p => p.name)
    const paidBy   = exp.paid_by
    if (!involved.length || !paidBy) return
    const share = Number(exp.amount) / involved.length
    net[paidBy] = (net[paidBy] ?? 0) + Number(exp.amount)
    involved.forEach(name => { net[name] = (net[name] ?? 0) - share })
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
  return settlements
}

export default function SplitCheck() {
  const { user } = useAuth()

  // View state
  const [view, setView]           = useState('list') // 'list' | 'archived' | 'received'
  const [splits, setSplits]       = useState([])
  const [received, setReceived]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [createModal, setCreateModal] = useState(false)
  const [newForm, setNewForm]     = useState({ name: '', date: '' })
  const [creating, setCreating]   = useState(false)
  const [confirmSplit, setConfirmSplit] = useState(null)
  const [copying, setCopying]     = useState(null)
  const [gearOpen, setGearOpen]   = useState(false)

  // Active split state
  const [active, setActive]       = useState(null)
  const [people, setPeople]       = useState([])
  const [expenses, setExpenses]   = useState([])
  const [tab, setTab]             = useState('People')
  const [detailLoading, setDetailLoading] = useState(false)

  // People
  const [newPerson, setNewPerson] = useState('')
  const [confirmPerson, setConfirmPerson] = useState(null)
  const [editingPerson, setEditingPerson] = useState(null) // { id, name }
  const [editPersonName, setEditPersonName] = useState('')

  // Expense modal
  const [expenseModal, setExpenseModal] = useState(false)
  const [expForm, setExpForm]       = useState(EMPTY_EXPENSE)
  const [editExpense, setEditExpense] = useState(null)
  const [saving, setSaving]         = useState(false)
  const [confirmExpense, setConfirmExpense] = useState(null)

  // Summary
  const [settled, setSettled] = useState({})

  async function loadList() {
    setLoading(true)
    const [splitsRes, recvRes] = await Promise.all([
      supabase.from('split_events').select('*').eq('user_id', user.id).eq('type', 'night_out').order('created_at', { ascending: false }),
      supabase.from('split_claims').select('*, split_people(id, name, paid), split_events(id, name, share_token, start_date)').eq('user_id', user.id),
    ])
    setSplits(splitsRes.data ?? [])
    setReceived(recvRes.data ?? [])
    setLoading(false)
  }

  async function loadSplit(ev) {
    setDetailLoading(true)
    setActive(ev)
    setTab('People')
    setSettled({})
    setGearOpen(false)
    const [pRes, eRes] = await Promise.all([
      supabase.from('split_people').select('*').eq('event_id', ev.id).order('id'),
      supabase.from('split_expenses').select('*').eq('event_id', ev.id).order('id'),
    ])
    setPeople(pRes.data ?? [])
    setExpenses(eRes.data ?? [])
    setDetailLoading(false)
  }

  useEffect(() => { loadList() }, [])

  // Create split
  async function createSplit() {
    if (!newForm.name.trim()) return
    setCreating(true)
    const { data: ev } = await supabase.from('split_events').insert({
      name: newForm.name.trim(),
      start_date: newForm.date || null,
      type: 'night_out',
      user_id: user.id,
    }).select().single()
    setCreating(false)
    setCreateModal(false)
    setNewForm({ name: '', date: '' })
    await loadList()
    if (ev) loadSplit(ev)
  }

  async function deleteSplit(id) {
    await supabase.from('split_events').delete().eq('id', id)
    setConfirmSplit(null)
    if (active?.id === id) setActive(null)
    loadList()
  }

  async function archiveSplit(id, archived) {
    await supabase.from('split_events').update({ archived }).eq('id', id)
    loadList()
  }

  // People
  async function addPerson() {
    const name = newPerson.trim()
    if (!name || !active) return
    const { data } = await supabase.from('split_people').insert({ event_id: active.id, name, user_id: user.id }).select().single()
    if (data) setPeople(p => [...p, data])
    setNewPerson('')
  }

  async function removePerson(id) {
    await supabase.from('split_people').delete().eq('id', id)
    setPeople(p => p.filter(x => x.id !== id))
    setConfirmPerson(null)
  }

  async function renamePerson() {
    const name = editPersonName.trim()
    if (!name || !editingPerson) return
    const oldName = editingPerson.name

    await supabase.from('split_people').update({ name }).eq('id', editingPerson.id)

    // Update paid_by on expenses that used the old name
    await supabase.from('split_expenses').update({ paid_by: name }).eq('event_id', active.id).eq('paid_by', oldName)

    // Update involved arrays — fetch and patch each affected expense
    const { data: affected } = await supabase.from('split_expenses').select('id, involved').eq('event_id', active.id)
    const toUpdate = (affected ?? []).filter(e => e.involved?.includes(oldName))
    await Promise.all(toUpdate.map(e =>
      supabase.from('split_expenses').update({ involved: e.involved.map(n => n === oldName ? name : n) }).eq('id', e.id)
    ))

    // Refresh local state
    const { data: updatedExp } = await supabase.from('split_expenses').select('*').eq('event_id', active.id).order('id')
    setExpenses(updatedExp ?? [])
    setPeople(p => p.map(x => x.id === editingPerson.id ? { ...x, name } : x))
    setEditingPerson(null)
    setEditPersonName('')
  }

  // Share link
  async function generateLink() {
    if (!active) return
    const token = crypto.randomUUID()
    await supabase.from('split_events').update({ share_token: token }).eq('id', active.id)
    setActive(a => ({ ...a, share_token: token }))
    copyLink(token)
    setGearOpen(false)
    loadList()
  }

  async function resetLink() {
    const token = crypto.randomUUID()
    await supabase.from('split_events').update({ share_token: token }).eq('id', active.id)
    setActive(a => ({ ...a, share_token: token }))
    copyLink(token)
    setGearOpen(false)
  }

  async function removeLink() {
    await supabase.from('split_events').update({ share_token: null }).eq('id', active.id)
    setActive(a => ({ ...a, share_token: null }))
    setGearOpen(false)
  }

  async function copyLink(token) {
    const url = `${window.location.origin}/split/share/${token}`
    setCopying(token)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const el = document.createElement('textarea')
      el.value = url
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setTimeout(() => setCopying(null), 2000)
  }

  // Expenses
  function openNewExpense() {
    setExpForm({ ...EMPTY_EXPENSE, involved: people.map(p => p.name), paidBy: people[0]?.name ?? '' })
    setEditExpense(null)
    setExpenseModal(true)
  }

  function openEditExpense(exp) {
    setExpForm({ description: exp.description, category: exp.category, amount: exp.amount, paidBy: exp.paid_by ?? '', involved: exp.involved ?? people.map(p => p.name) })
    setEditExpense(exp)
    setExpenseModal(true)
  }

  function toggleInvolved(name) {
    setExpForm(f => ({
      ...f,
      involved: f.involved.includes(name) ? f.involved.filter(n => n !== name) : [...f.involved, name],
    }))
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
    }
    if (editExpense) await supabase.from('split_expenses').update(payload).eq('id', editExpense.id)
    else             await supabase.from('split_expenses').insert(payload)
    setSaving(false)
    setExpenseModal(false)
    const { data } = await supabase.from('split_expenses').select('*').eq('event_id', active.id).order('id')
    setExpenses(data ?? [])
  }

  async function deleteExpense(id) {
    await supabase.from('split_expenses').delete().eq('id', id)
    setExpenses(prev => prev.filter(e => e.id !== id))
    setConfirmExpense(null)
  }

  // Summary
  async function togglePaid(personId, current) {
    await supabase.from('split_people').update({ paid: !current }).eq('id', personId)
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, paid: !current } : p))
  }

  const total       = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const byCategory  = expenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] ?? 0) + Number(e.amount); return acc }, {})
  const settlements = people.length > 0 ? calcSettlements(people, expenses) : []

  if (loading) return <Spinner />

  return (
    <div className="space-y-6" onClick={() => gearOpen && setGearOpen(false)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {active && (
            <button onClick={() => { setActive(null); loadList() }} className="text-gray-400 hover:text-white transition-colors text-sm">← Splits</button>
          )}
          <h1 className="text-2xl font-bold">{active ? active.name : 'Split the Bill'}</h1>
        </div>

        <div className="flex items-center gap-2">
          {!active ? (
            <>
              <button
                onClick={() => setView(v => v === 'archived' ? 'list' : 'archived')}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${view === 'archived' ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                {view === 'archived' ? '← Active' : '🗃 Archived'}
              </button>
              <button
                onClick={() => setView(v => v === 'received' ? 'list' : 'received')}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${view === 'received' ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                {view === 'received' ? '← My Splits' : `Received${received.length > 0 ? ` (${received.length})` : ''}`}
              </button>
              {view === 'list' && (
                <button onClick={() => setCreateModal(true)} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">+ New Split</button>
              )}
            </>
          ) : (
            <>
              {tab === 'Expenses' && people.length > 0 && (
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
                        <button onClick={resetLink} className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:bg-gray-800 transition-colors flex items-center gap-2 border-t border-gray-800">
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

      {/* ── SPLIT LIST ── */}
      {!active && (view === 'list' || view === 'archived') && (() => {
        const filtered = splits.filter(s => view === 'archived' ? s.archived : !s.archived)
        return filtered.length === 0 ? (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-4xl mb-3">{view === 'archived' ? '🗃' : '🍽️'}</p>
            <p className="text-lg font-medium">{view === 'archived' ? 'No archived splits' : 'No splits yet'}</p>
            <p className="text-sm mt-1">{view === 'archived' ? 'Archived splits will appear here.' : 'Create a split and share the link with your group.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.map(sp => (
              <div key={sp.id} onClick={() => loadSplit(sp)} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 cursor-pointer hover:border-gray-600 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{sp.name}</p>
                    {sp.start_date
                      ? <p className="text-gray-500 text-xs mt-0.5">{fmt(sp.start_date)}</p>
                      : <p className="text-gray-600 text-xs mt-0.5">{new Date(sp.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    }
                    {sp.share_token && <p className="text-xs text-brand-400 mt-1">🔗 Link active</p>}
                  </div>
                  <div className="flex gap-1.5 ml-3 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); archiveSplit(sp.id, !sp.archived) }}
                      className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                    >
                      {sp.archived ? 'Unarchive' : '🗃 Archive'}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmSplit(sp) }}
                      className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* ── RECEIVED ── */}
      {!active && view === 'received' && (
        received.length === 0 ? (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-4xl mb-3">📬</p>
            <p className="text-lg font-medium">No received splits</p>
            <p className="text-sm mt-1">When someone shares a split link with you, open it and claim your name — it'll appear here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {received.map(claim => {
              const person = claim.split_people
              const event  = claim.split_events
              return (
                <div key={claim.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{event?.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Claimed as <span className="text-white">{person?.name}</span></p>
                    {event?.start_date && <p className="text-xs text-gray-600 mt-0.5">{fmt(event.start_date)}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-xs font-medium ${person?.paid ? 'text-brand-400' : 'text-yellow-400'}`}>
                      {person?.paid ? '✓ Paid' : '⏳ Pending'}
                    </span>
                    {event?.share_token && (
                      <a
                        href={`/split/share/${event.share_token}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-xs text-gray-500 hover:text-gray-300 mt-1 transition-colors"
                      >
                        View split →
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* ── SPLIT DETAIL ── */}
      {active && (
        <>
          {detailLoading ? <Spinner /> : (
            <>
              {active.start_date && (
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <span>🗓 {fmt(active.start_date)}</span>
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

              {/* ── People Tab ── */}
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
                                  className="flex-1 bg-gray-800 border border-brand-500 rounded-lg px-2.5 py-1 text-sm text-white focus:outline-none"
                                />
                              ) : (
                                <span className="text-white text-sm">{p.name}</span>
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

                      <button onClick={() => setTab('Expenses')} className="w-full bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">
                        Next — Add Expenses →
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* ── Expenses Tab ── */}
              {tab === 'Expenses' && (
                <div className="space-y-4">
                  {/* Summary widgets */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="col-span-2 sm:col-span-1 bg-gray-900 border border-brand-600/40 rounded-2xl p-4 flex flex-col gap-1">
                      <p className="text-xs text-gray-400 uppercase tracking-wide">Total Spent</p>
                      <p className="text-xl font-bold text-brand-400">{formatCurrency(total)}</p>
                      <p className="text-xs text-gray-500">{people.length} people</p>
                    </div>
                    {people.length > 0 && (
                      <div className="col-span-2 sm:col-span-1 bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col gap-1">
                        <p className="text-xs text-gray-400 uppercase tracking-wide">Per Person</p>
                        <p className="text-xl font-bold text-white">{formatCurrency(total / people.length)}</p>
                        <p className="text-xs text-gray-500">avg</p>
                      </div>
                    )}
                    {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                      <div key={cat} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col gap-1">
                        <p className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-1"><span>{CAT_ICON[cat] ?? '📦'}</span>{cat}</p>
                        <p className="text-lg font-bold text-white">{formatCurrency(amt)}</p>
                        <p className="text-xs text-gray-500">{total > 0 ? Math.round((amt / total) * 100) : 0}% of total</p>
                      </div>
                    ))}
                  </div>

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
                          <div className="w-10 h-10 bg-gray-800 rounded-xl flex items-center justify-center text-lg shrink-0">
                            {CAT_ICON[exp.category] ?? '📦'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-white truncate">{exp.description}</p>
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              {exp.paid_by && (
                                <span className="inline-flex items-center gap-1 bg-brand-600/20 text-brand-300 text-xs px-2 py-0.5 rounded-full">
                                  💳 {exp.paid_by}
                                </span>
                              )}
                              {(exp.involved ?? []).filter(n => n !== exp.paid_by).map(name => (
                                <span key={name} className="inline-flex items-center gap-1 bg-gray-800 text-gray-300 text-xs px-2 py-0.5 rounded-full">
                                  <span className="w-4 h-4 bg-brand-600/30 text-brand-400 rounded-full flex items-center justify-center text-[10px] font-semibold">{name[0].toUpperCase()}</span>
                                  {name}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-bold text-white">{formatCurrency(exp.amount)}</p>
                            {exp.involved?.length > 0 && <p className="text-xs text-gray-500 mt-0.5">{formatCurrency(Number(exp.amount) / exp.involved.length)} each</p>}
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

              {/* ── Summary Tab ── */}
              {tab === 'Summary' && (
                <div className="space-y-4">
                  {expenses.length === 0 ? (
                    <p className="text-gray-500 text-sm text-center mt-6">Add expenses first to see the summary.</p>
                  ) : (
                    <>
                      {/* Per person */}
                      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                        <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">Per Person</h2>
                        {people.map((p, i) => {
                          const spent = expenses.reduce((s, e) => e.paid_by === p.name ? s + Number(e.amount) : s, 0)
                          const owes  = expenses.reduce((s, e) => {
                            const inv = e.involved?.length ? e.involved : people.map(x => x.name)
                            return inv.includes(p.name) ? s + Number(e.amount) / inv.length : s
                          }, 0)
                          const net = spent - owes
                          return (
                            <div key={p.id} className="flex items-center justify-between px-5 py-3 border-b border-gray-800/60 last:border-0">
                              <div className="flex items-center gap-2">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${p.paid ? 'bg-brand-600/20 text-brand-400' : 'bg-brand-600/20 text-brand-400'}`}>{p.name[0].toUpperCase()}</div>
                                <span className="text-sm text-white">{p.name}</span>
                                {spent > 0 && <span className="text-xs text-gray-500">💳 paid {formatCurrency(spent)}</span>}
                              </div>
                              <div className="text-right text-xs">
                                <p className="text-gray-400">Share: <span className="text-white">{formatCurrency(owes)}</span></p>
                                <p className={`font-semibold mt-0.5 ${net > 0.01 ? 'text-brand-400' : net < -0.01 ? 'text-red-400' : 'text-gray-500'}`}>
                                  {net > 0.01 ? `Gets back ${formatCurrency(net)}` : net < -0.01 ? `Owes ${formatCurrency(-net)}` : 'Settled ✓'}
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
                              <div key={i} className={`flex items-center justify-between px-5 py-3 border-b border-gray-800/60 last:border-0 ${settled[i] ? 'opacity-40' : ''}`}>
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
            </>
          )}
        </>
      )}

      {/* Confirm modals */}
      {confirmSplit  && <ConfirmModal message="Delete this split?" onConfirm={() => deleteSplit(confirmSplit.id)} onCancel={() => setConfirmSplit(null)} />}
      {confirmPerson && <ConfirmModal message="Remove this person?" onConfirm={() => removePerson(confirmPerson)} onCancel={() => setConfirmPerson(null)} />}
      {confirmExpense && <ConfirmModal message="Delete this expense?" onConfirm={() => deleteExpense(confirmExpense)} onCancel={() => setConfirmExpense(null)} />}

      {/* Create Modal */}
      {createModal && (
        <Modal title="New Split" onClose={() => { setCreateModal(false); setNewForm({ name: '', date: '' }) }}>
          <div className="space-y-4">
            <Field label="Name">
              <input value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} onKeyDown={e => e.key === 'Enter' && createSplit()} placeholder="e.g. Dinner at Nobu, Vegas Night" autoFocus />
            </Field>
            <Field label="Date (optional)">
              <input type="date" value={newForm.date} onChange={e => setNewForm(f => ({ ...f, date: e.target.value }))} />
            </Field>
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setCreateModal(false); setNewForm({ name: '', date: '' }) }} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">Cancel</button>
              <button onClick={createSplit} disabled={creating} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">{creating ? 'Creating…' : 'Create'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Expense Modal */}
      {expenseModal && (
        <Modal title={editExpense ? 'Edit Expense' : 'Add Expense'} onClose={() => setExpenseModal(false)}>
          <div className="space-y-4">
            <Field label="Description">
              <input value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Dinner, Uber, Drinks" autoFocus />
            </Field>
            <Field label="Amount ($)">
              <input type="number" min="0" step="0.01" value={expForm.amount} onChange={e => setExpForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
            </Field>
            <Field label="Category">
              <select value={expForm.category} onChange={e => setExpForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>

            {/* Who paid */}
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

            {/* Who was involved */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">Who was involved?</label>
              <div className="grid grid-cols-2 gap-2">
                {people.map(p => (
                  <label key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors text-sm ${expForm.involved.includes(p.name) ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-gray-700 bg-gray-800 text-gray-400'}`}>
                    <input type="checkbox" checked={expForm.involved.includes(p.name)} onChange={() => toggleInvolved(p.name)} className="accent-green-500" />
                    <div className="w-5 h-5 bg-brand-600/20 text-brand-400 rounded-full flex items-center justify-center text-xs font-semibold shrink-0">{p.name[0].toUpperCase()}</div>
                    {p.name}
                  </label>
                ))}
              </div>
              {expForm.involved.length > 0 && expForm.amount && (
                <p className="text-xs text-gray-500 mt-2">{formatCurrency(Number(expForm.amount) / expForm.involved.length)} per person ({expForm.involved.length} people)</p>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setExpenseModal(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">Cancel</button>
              <button onClick={saveExpense} disabled={saving || !expForm.description || !expForm.amount || !expForm.paidBy || !expForm.involved.length} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}
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
