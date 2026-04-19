import { useEffect, useState } from 'react'
import Spinner from '../components/Spinner'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrency, formatDate } from '../lib/format'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'

const CATEGORIES  = ['Housing', 'Utilities', 'Insurance', 'Subscriptions', 'Food', 'Transportation', 'Entertainment', 'Health', 'Other']
const FREQUENCIES = ['monthly', 'yearly', 'weekly', 'one-time']
const EMPTY = { name: '', amount: '', category: 'Housing', frequency: 'monthly', due_date: '', notes: '' }

export default function Bills() {
  const { user } = useAuth()
  const [bills, setBills]     = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]     = useState(false)
  const [form, setForm]       = useState(EMPTY)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [testDate, setTestDate] = useState('')
  const [confirmId, setConfirmId] = useState(null)
  const [catFilter, setCatFilter] = useState('All')

  async function load() {
    const { data } = await supabase.from('bills').select('*').eq('user_id', user.id).order('due_date', { ascending: true, nullsFirst: false })
    setBills(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNew()   { setForm(EMPTY); setEditing(null); setModal(true) }
  function openEdit(b) { setForm({ name: b.name, amount: b.amount, category: b.category, frequency: b.frequency, due_date: b.due_date ?? '', notes: b.notes ?? '' }); setEditing(b.id); setModal(true) }

  async function save() {
    if (!form.name || !form.amount || !form.category || !form.frequency || !form.due_date) return
    setSaving(true)
    const payload = { name: form.name, amount: Number(form.amount), category: form.category, frequency: form.frequency, due_date: form.due_date || null, notes: form.notes, user_id: user.id }
    if (editing) await supabase.from('bills').update(payload).eq('id', editing)
    else         await supabase.from('bills').insert(payload)
    setSaving(false); setModal(false); load()
  }

  async function remove(id) {
    await supabase.from('bills').delete().eq('id', id)
    setConfirmId(null)
    load()
  }

  const today = testDate ? new Date(testDate + 'T00:00:00') : new Date()

  function getNextDueDate(dueDateStr, frequency) {
    if (!dueDateStr) return null
    const d = new Date(dueDateStr + 'T00:00:00')
    while (d < today) {
      if (frequency === 'monthly')     d.setMonth(d.getMonth() + 1)
      else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1)
      else if (frequency === 'weekly') d.setDate(d.getDate() + 7)
      else break
    }
    return d
  }

  const billCategories = ['All', ...Array.from(new Set(bills.map(b => b.category))).sort()]
  const visibleBills   = catFilter === 'All' ? bills : bills.filter(b => b.category === catFilter)

  const monthlyRaw   = visibleBills.filter(b => b.frequency === 'monthly').reduce((s, b) => s + Number(b.amount), 0)
  const yearlyRaw    = visibleBills.filter(b => b.frequency === 'yearly').reduce((s, b) => s + Number(b.amount), 0)
  const monthlyTotal = monthlyRaw + (yearlyRaw / 12)
  const yearlyTotal  = yearlyRaw  + (monthlyRaw * 12)

  function isPending(b) {
    const next = getNextDueDate(b.due_date, b.frequency)
    if (!next) return false
    const daysUntil = Math.ceil((next - today) / (1000 * 60 * 60 * 24))
    return daysUntil <= 7
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bills</h1>
          <p className="text-gray-400 text-sm mt-0.5">{formatCurrency(monthlyTotal)}/mo · {formatCurrency(yearlyTotal)}/yr{catFilter !== 'All' ? ` — ${catFilter}` : ''}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={catFilter}
            onChange={e => setCatFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500 transition-colors"
          >
            {billCategories.map(c => <option key={c}>{c}</option>)}
          </select>
          <button onClick={openNew} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">+ Add Bill</button>
        </div>
      </div>

      {import.meta.env.DEV && (
        <div className="flex items-center gap-3 bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-4 py-2.5 text-sm">
          <span className="text-yellow-400 font-medium">🧪 Test Mode</span>
          <span className="text-gray-400">Simulate date:</span>
          <input
            type="date"
            value={testDate}
            onChange={e => setTestDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-yellow-400"
          />
          {testDate && (
            <button onClick={() => setTestDate('')} className="text-yellow-400 hover:text-yellow-300 text-xs transition-colors">
              Reset to today
            </button>
          )}
        </div>
      )}

      {loading ? <Spinner /> : bills.length === 0 ? (
        <div className="text-center text-gray-500 mt-20">
          <p className="text-4xl mb-3">🧾</p>
          <p className="text-lg font-medium">No bills yet</p>
          <p className="text-sm mt-1">Track rent, subscriptions, utilities, and more.</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">Frequency</th>
                <th className="px-5 py-3 font-medium">Due Date</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Amount</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {visibleBills.map(b => {
                const nextDue = getNextDueDate(b.due_date, b.frequency)
                const pending = isPending(b)
                return (
                  <tr key={b.id} className="border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors">
                    <td className="px-5 py-3 font-medium">{b.name}</td>
                    <td className="px-5 py-3 text-gray-400">{b.category}</td>
                    <td className="px-5 py-3"><span className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full text-xs capitalize">{b.frequency}</span></td>
                    <td className="px-5 py-3 text-gray-400">{nextDue ? nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td className="px-5 py-3">
                      {nextDue
                        ? pending
                          ? <span className="text-yellow-400 text-xs font-medium">⏳ Due soon</span>
                          : <span className="text-brand-400 text-xs font-medium">✓ Auto-paid</span>
                        : <span className="text-gray-600 text-xs">—</span>
                      }
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-yellow-400">{formatCurrency(b.amount)}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => openEdit(b)} className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors mr-1.5">Edit</button>
                      <button onClick={() => setConfirmId(b.id)} className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">Delete</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {confirmId && (
        <ConfirmModal
          message="Delete this bill?"
          onConfirm={() => remove(confirmId)}
          onCancel={() => setConfirmId(null)}
        />
      )}

      {modal && (
        <Modal title={editing ? 'Edit Bill' : 'Add Bill'} onClose={() => setModal(false)}>
          <div className="space-y-4">
            <Field label="Name" required><input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Netflix" /></Field>
            <Field label="Amount ($)" required><input required type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></Field>
            <Field label="Category" required><select required value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Frequency" required><select required value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>{FREQUENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Due Date" required><input required type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></Field>
            <Field label="Notes (optional)"><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any notes…" /></Field>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setModal(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1.5">
        {label}{required && <span className="text-red-400 ml-1">*</span>}
      </label>
      <children.type {...children.props} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 transition-colors" />
    </div>
  )
}
