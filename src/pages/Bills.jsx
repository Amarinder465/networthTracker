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
    <div className="space-y-8 animate-fadeInUp">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-5xl font-bold text-white">Bills & Subscriptions</h1>
          <p className="text-cyan-400 font-medium mt-2">{formatCurrency(monthlyTotal)}/mo · {formatCurrency(yearlyTotal)}/yr{catFilter !== 'All' ? ` — ${catFilter}` : ''}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={catFilter}
            onChange={e => setCatFilter(e.target.value)}
            className="input-field text-sm"
          >
            {billCategories.map(c => <option key={c}>{c}</option>)}
          </select>
          <button onClick={openNew} className="btn-primary text-sm">+ Add Bill</button>
        </div>
      </div>

      {import.meta.env.DEV && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-sm backdrop-blur">
          <span className="text-amber-400 font-medium">🧪 Test Mode</span>
          <span className="text-slate-400">Simulate date:</span>
          <input
            type="date"
            value={testDate}
            onChange={e => setTestDate(e.target.value)}
            className="input-field text-xs w-40"
          />
          {testDate && (
            <button onClick={() => setTestDate('')} className="text-amber-400 hover:text-amber-300 text-xs transition-colors font-medium">
              Reset
            </button>
          )}
        </div>
      )}

      {loading ? <Spinner /> : bills.length === 0 ? (
        <div className="text-center text-slate-500 mt-24">
          <p className="text-5xl mb-4">🧾</p>
          <p className="text-lg font-bold text-slate-400">No bills tracked yet</p>
          <p className="text-sm mt-2">Start tracking rent, subscriptions, utilities, and other recurring expenses.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-slate-700/50 text-slate-400 text-left">
                <th className="px-5 py-4 font-semibold">Name</th>
                <th className="px-5 py-4 font-semibold">Category</th>
                <th className="px-5 py-4 font-semibold">Frequency</th>
                <th className="px-5 py-4 font-semibold">Next Due</th>
                <th className="px-5 py-4 font-semibold">Status</th>
                <th className="px-5 py-4 font-semibold text-right">Amount</th>
                <th className="px-5 py-4 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {visibleBills.map(b => {
                const nextDue = getNextDueDate(b.due_date, b.frequency)
                const pending = isPending(b)
                return (
                  <tr key={b.id} className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                    <td className="px-5 py-4 font-medium text-slate-200">{b.name}</td>
                    <td className="px-5 py-4 text-slate-400">{b.category}</td>
                    <td className="px-5 py-4"><span className="bg-slate-700/50 text-slate-300 px-3 py-1 rounded-full text-xs capitalize font-medium">{b.frequency}</span></td>
                    <td className="px-5 py-4 text-slate-300">{nextDue ? nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td className="px-5 py-4">
                      {nextDue
                        ? pending
                          ? <span className="text-amber-400 text-xs font-bold">⏳ Due Soon</span>
                          : <span className="text-emerald-400 text-xs font-bold">✓ Scheduled</span>
                        : <span className="text-slate-600 text-xs">—</span>
                      }
                    </td>
                    <td className="px-5 py-4 text-right font-bold text-amber-400">{formatCurrency(b.amount)}</td>
                    <td className="px-5 py-4 text-right space-x-2">
                      <button onClick={() => openEdit(b)} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/60 text-slate-300 hover:bg-slate-700 transition-all hover:text-slate-100">Edit</button>
                      <button onClick={() => setConfirmId(b.id)} className="text-xs px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-all">Delete</button>
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
          <div className="space-y-5">
            <Field label="Name" required><input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Netflix" /></Field>
            <Field label="Amount ($)" required><input required type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></Field>
            <Field label="Category" required><select required value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Frequency" required><select required value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>{FREQUENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Due Date" required><input required type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></Field>
            <Field label="Notes (optional)"><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any notes…" /></Field>
            <div className="flex gap-3 pt-4">
              <button onClick={() => setModal(false)} className="btn-secondary flex-1 py-2.5">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary flex-1 py-2.5">{saving ? '⏳ Saving…' : 'Save'}</button>
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
      <label className="block text-sm font-semibold text-slate-300 mb-2">
        {label}{required && <span className="text-rose-400 ml-1">*</span>}
      </label>
      <children.type {...children.props} className="input-field w-full" />
    </div>
  )
}
