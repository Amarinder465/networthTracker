import { useEffect, useState } from 'react'
import Spinner from '../components/Spinner'
import StatCard from '../components/StatCard'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrency, formatDate } from '../lib/format'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
import { BONUS_OFFERS, VERIFIED_ON } from '../lib/bonusOffers'

// ── date helpers (timezone-safe local dates) ──
function isoDate(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
function todayISO() { return isoDate(new Date()) }
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return isoDate(d) }
function uid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2)
}

function bonusStatus(b) {
  if (b.received) return { key: 'received', label: 'Received', color: 'emerald', icon: '🎉' }
  const tasks = b.tasks ?? []
  const done = tasks.filter(t => t.done).length
  if (tasks.length > 0 && done === tasks.length) return { key: 'ready', label: 'Ready to pay out', color: 'cyan', icon: '✅' }
  if (done > 0) return { key: 'progress', label: 'In progress', color: 'amber', icon: '⏳' }
  return { key: 'todo', label: 'Not started', color: 'slate', icon: '•' }
}

const STATUS_PILL = {
  received: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  ready:    'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  progress: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  todo:     'bg-slate-600/20 text-slate-400 border-slate-600/30',
}

const EMPTY = {
  bank: '', account_type: '', bonus_amount: '', url: '',
  open_date: '', deadline: '', expected_payout_date: '', notes: '', tasks: [],
}

export default function BankBonuses() {
  const { user } = useAuth()
  const [bonuses, setBonuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]     = useState(false)
  const [browse, setBrowse]   = useState(false)
  const [form, setForm]       = useState(EMPTY)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const [filter, setFilter]   = useState('All')

  async function load() {
    const { data } = await supabase
      .from('bank_bonuses')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    setBonuses(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNew()  { setForm(EMPTY); setEditing(null); setModal(true) }
  function openEdit(b) {
    setForm({
      bank: b.bank ?? '', account_type: b.account_type ?? '',
      bonus_amount: b.bonus_amount ?? '', url: b.url ?? '',
      open_date: b.open_date ?? '', deadline: b.deadline ?? '',
      expected_payout_date: b.expected_payout_date ?? '', notes: b.notes ?? '',
      tasks: (b.tasks ?? []).map(t => ({ ...t })),
    })
    setEditing(b.id); setModal(true)
  }

  // Instantiate a curated offer template into the Add form
  function useOffer(o) {
    setForm({
      bank: o.bank, account_type: o.accountType, bonus_amount: String(o.amount),
      url: o.url ?? '', open_date: '',
      deadline: o.offerEnds ?? '',
      expected_payout_date: o.payoutDays ? addDays(o.payoutDays) : '',
      notes: o.note ?? '',
      tasks: (o.tasks ?? []).map(t => ({
        id: uid(), label: t.label, target: t.target ?? null,
        due_date: t.dueInDays != null ? addDays(t.dueInDays) : '', done: false,
      })),
    })
    setEditing(null); setBrowse(false); setModal(true)
  }

  // ── task editor (inside Add/Edit form) ──
  function addTask()  { setForm(f => ({ ...f, tasks: [...f.tasks, { id: uid(), label: '', target: null, due_date: '', done: false }] })) }
  function updateTask(i, patch) { setForm(f => ({ ...f, tasks: f.tasks.map((t, idx) => idx === i ? { ...t, ...patch } : t) })) }
  function removeTask(i) { setForm(f => ({ ...f, tasks: f.tasks.filter((_, idx) => idx !== i) })) }

  async function save() {
    if (!form.bank || form.bonus_amount === '') return
    setSaving(true)
    const tasks = (form.tasks || [])
      .filter(t => t.label && t.label.trim())
      .map(t => ({
        id: t.id || uid(),
        label: t.label.trim(),
        target: t.target === '' || t.target == null ? null : Number(t.target),
        due_date: t.due_date || null,
        done: !!t.done,
      }))
    const payload = {
      bank: form.bank.trim(),
      account_type: form.account_type?.trim() || null,
      bonus_amount: Number(form.bonus_amount) || 0,
      url: form.url?.trim() || null,
      open_date: form.open_date || null,
      deadline: form.deadline || null,
      expected_payout_date: form.expected_payout_date || null,
      notes: form.notes?.trim() || null,
      tasks,
      user_id: user.id,
    }
    if (editing) await supabase.from('bank_bonuses').update(payload).eq('id', editing)
    else         await supabase.from('bank_bonuses').insert(payload)
    setSaving(false); setModal(false); load()
  }

  async function remove(id) {
    await supabase.from('bank_bonuses').delete().eq('id', id)
    setConfirmId(null); load()
  }

  // Toggle a single requirement (optimistic, then persist)
  async function toggleTask(b, taskId) {
    const tasks = (b.tasks ?? []).map(t => t.id === taskId ? { ...t, done: !t.done } : t)
    setBonuses(prev => prev.map(x => x.id === b.id ? { ...x, tasks } : x))
    await supabase.from('bank_bonuses').update({ tasks }).eq('id', b.id)
  }

  async function markReceived(b, received) {
    const patch = { received, received_date: received ? todayISO() : null }
    setBonuses(prev => prev.map(x => x.id === b.id ? { ...x, ...patch } : x))
    await supabase.from('bank_bonuses').update(patch).eq('id', b.id)
  }

  // ── derived totals ──
  const withStatus = bonuses.map(b => ({ b, s: bonusStatus(b) }))
  const inProgress  = withStatus.filter(x => !x.b.received)
  const ready       = withStatus.filter(x => x.s.key === 'ready')
  const received    = withStatus.filter(x => x.b.received)
  const sum = arr => arr.reduce((t, x) => t + Number(x.b.bonus_amount || 0), 0)

  const visible = withStatus.filter(({ b, s }) => {
    if (filter === 'All')         return true
    if (filter === 'In progress') return !b.received && s.key !== 'ready'
    if (filter === 'Ready')       return s.key === 'ready'
    if (filter === 'Received')    return b.received
    return true
  })

  return (
    <div className="space-y-8 animate-fadeInUp">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-5xl font-bold text-white">Bank Bonuses 🎁</h1>
          <p className="text-cyan-400 font-medium mt-2">
            {formatCurrency(sum(inProgress))} in progress · {formatCurrency(sum(received))} earned
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => setBrowse(true)} className="btn-secondary text-sm">✨ Browse Offers</button>
          <button onClick={openNew} className="btn-primary text-sm">+ Add Bonus</button>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="In Progress" value={formatCurrency(sum(inProgress))} sub={`${inProgress.length} bonus${inProgress.length === 1 ? '' : 'es'} working`} color="text-amber-300" />
        <StatCard label="Ready to Pay Out" value={formatCurrency(sum(ready))} sub={`${ready.length} done — awaiting payout`} color="text-cyan-300" />
        <StatCard label="Received" value={formatCurrency(sum(received))} sub={`${received.length} collected 🎉`} color="text-emerald-300" />
      </div>

      {/* "You're done!" banner */}
      {ready.length > 0 && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 backdrop-blur">
          <p className="text-emerald-300 font-bold">🎉 You finished {ready.length} bonus{ready.length === 1 ? '' : 'es'}!</p>
          <div className="mt-2 space-y-1.5">
            {ready.map(({ b }) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-emerald-100">
                  <strong>{b.bank}</strong> — {formatCurrency(b.bonus_amount)}
                  {b.expected_payout_date ? <span className="text-emerald-300/70"> · expected by {formatDate(b.expected_payout_date)}</span> : null}
                </span>
                <button onClick={() => markReceived(b, true)} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 transition-all font-semibold">
                  Mark received
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      {bonuses.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {['All', 'In progress', 'Ready', 'Received'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all border ${
                filter === f ? 'bg-purple-600/30 text-white border-purple-500/40' : 'text-slate-400 border-slate-700/50 hover:text-white hover:border-purple-500/30'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {loading ? <Spinner /> : bonuses.length === 0 ? (
        <div className="text-center text-slate-500 mt-20">
          <p className="text-5xl mb-4">🎁</p>
          <p className="text-lg font-bold text-slate-400">No bonuses tracked yet</p>
          <p className="text-sm mt-2">Track checking & savings sign-up bonuses, check off each requirement, and get told the moment you've earned it.</p>
          <button onClick={() => setBrowse(true)} className="btn-primary mt-6 text-sm">✨ Browse offers to get started</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {visible.map(({ b, s }) => <BonusCard key={b.id} b={b} s={s} onToggle={toggleTask} onReceived={markReceived} onEdit={openEdit} onDelete={setConfirmId} />)}
        </div>
      )}

      {confirmId && (
        <ConfirmModal message="Delete this bonus?" onConfirm={() => remove(confirmId)} onCancel={() => setConfirmId(null)} />
      )}

      {browse && <BrowseModal onClose={() => setBrowse(false)} onPick={useOffer} />}

      {modal && (
        <Modal title={editing ? 'Edit Bonus' : 'Add Bonus'} onClose={() => setModal(false)}>
          <div className="space-y-5">
            <Field label="Bank" required><input required value={form.bank} onChange={e => setForm(f => ({ ...f, bank: e.target.value }))} placeholder="e.g. Chase" /></Field>
            <Field label="Account type"><input value={form.account_type} onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))} placeholder="e.g. Total Checking" /></Field>
            <Field label="Bonus amount ($)" required><input required type="number" min="0" step="1" value={form.bonus_amount} onChange={e => setForm(f => ({ ...f, bonus_amount: e.target.value }))} placeholder="400" /></Field>
            <Field label="Offer link"><input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://…" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Opened on"><input type="date" value={form.open_date} onChange={e => setForm(f => ({ ...f, open_date: e.target.value }))} /></Field>
              <Field label="Offer ends / deadline"><input type="date" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} /></Field>
            </div>
            <Field label="Expected payout date"><input type="date" value={form.expected_payout_date} onChange={e => setForm(f => ({ ...f, expected_payout_date: e.target.value }))} /></Field>

            {/* Requirement checklist editor */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-semibold text-slate-300">What you need to do</label>
                <button type="button" onClick={addTask} className="text-xs px-2.5 py-1 rounded-lg bg-purple-600/30 text-purple-200 hover:bg-purple-600/40 transition-all font-semibold">+ Requirement</button>
              </div>
              {form.tasks.length === 0 ? (
                <p className="text-xs text-slate-500">No requirements yet — add the steps you must complete (e.g. “Deposit $5,000 within 30 days”).</p>
              ) : (
                <div className="space-y-2">
                  {form.tasks.map((t, i) => (
                    <div key={t.id} className="flex items-center gap-2">
                      <input value={t.label} onChange={e => updateTask(i, { label: e.target.value })} placeholder="Requirement…" className="input-field w-full text-sm flex-1" />
                      <input type="date" value={t.due_date || ''} onChange={e => updateTask(i, { due_date: e.target.value })} title="Due date" className="input-field text-xs w-36" />
                      <button type="button" onClick={() => removeTask(i)} className="text-rose-400 hover:text-rose-300 text-lg leading-none px-1" title="Remove">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Field label="Notes"><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Promo code, eligibility notes…" /></Field>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setModal(false)} className="btn-secondary flex-1 py-2.5">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary flex-1 py-2.5">{saving ? '⏳ Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function BonusCard({ b, s, onToggle, onReceived, onEdit, onDelete }) {
  const tasks = b.tasks ?? []
  const done  = tasks.filter(t => t.done).length
  const pct   = tasks.length ? Math.round((done / tasks.length) * 100) : 0
  const today = todayISO()
  const next  = tasks
    .filter(t => !t.done && t.due_date)
    .sort((a, c) => a.due_date.localeCompare(c.due_date))[0]

  return (
    <div className="card flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-white truncate">{b.bank}</h3>
          {b.account_type && <p className="text-sm text-slate-400 truncate">{b.account_type}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold text-emerald-300">{formatCurrency(b.bonus_amount)}</p>
          <span className={`inline-block mt-1 text-[11px] font-bold px-2.5 py-1 rounded-full border ${STATUS_PILL[s.key]}`}>{s.icon} {s.label}</span>
        </div>
      </div>

      {/* progress */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
          <span>{done} of {tasks.length} done</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-700/50 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-cyan-400 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* checklist */}
      {tasks.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {tasks.map(t => {
            const overdue = !t.done && t.due_date && t.due_date < today
            return (
              <li key={t.id}>
                <button onClick={() => onToggle(b, t.id)} className="w-full flex items-start gap-2.5 text-left group">
                  <span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 transition-all ${t.done ? 'bg-emerald-500/80 border-emerald-400 text-white' : 'border-slate-500 group-hover:border-cyan-400'}`}>{t.done ? '✓' : ''}</span>
                  <span className="flex-1 text-sm">
                    <span className={t.done ? 'text-slate-500 line-through' : 'text-slate-200'}>{t.label}</span>
                    {t.due_date && (
                      <span className={`ml-2 text-xs ${overdue ? 'text-rose-400 font-semibold' : 'text-slate-500'}`}>
                        {overdue ? '⚠ ' : ''}by {formatDate(t.due_date)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* done banner */}
      {s.key === 'ready' && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <p className="text-emerald-300 text-sm font-bold">🎉 All requirements complete!</p>
          <p className="text-emerald-200/80 text-xs mt-1">
            Your {formatCurrency(b.bonus_amount)} bonus should post{b.expected_payout_date ? ` by ${formatDate(b.expected_payout_date)}` : ' soon'}. Mark it received when it lands.
          </p>
        </div>
      )}

      {/* meta footer */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        {b.deadline && <span>Offer ends <span className="text-slate-400">{formatDate(b.deadline)}</span></span>}
        {b.received && b.received_date && <span className="text-emerald-400">Received {formatDate(b.received_date)}</span>}
        {!b.received && s.key !== 'ready' && next && <span>Next: <span className="text-slate-400">{next.label}</span></span>}
        {b.url && <a href={b.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">View offer ↗</a>}
      </div>

      {/* actions */}
      <div className="mt-4 pt-4 border-t border-slate-700/40 flex items-center gap-2">
        {b.received ? (
          <button onClick={() => onReceived(b, false)} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/60 text-slate-300 hover:bg-slate-700 transition-all">↩ Undo received</button>
        ) : (
          <button onClick={() => onReceived(b, true)} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-all font-semibold">✓ Mark received</button>
        )}
        <div className="flex-1" />
        <button onClick={() => onEdit(b)} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/60 text-slate-300 hover:bg-slate-700 transition-all">Edit</button>
        <button onClick={() => onDelete(b.id)} className="text-xs px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-all">Delete</button>
      </div>
    </div>
  )
}

function BrowseModal({ onClose, onPick }) {
  return (
    <Modal title="✨ Browse Bank Bonus Offers" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          Tap an offer to load it into the tracker — then tweak the amount and dates before saving.
          Terms change often, so always confirm on the bank’s page.
        </p>
        {BONUS_OFFERS.map(o => (
          <div key={o.id} className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 hover:border-purple-500/40 transition-all">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-slate-100">{o.bank} <span className="text-slate-400 font-medium">· {o.accountType}</span></p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300">{o.category}</span>
                  {o.verified
                    ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">✓ Verified {VERIFIED_ON}</span>
                    : <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">Verify terms</span>}
                </div>
              </div>
              <p className="text-xl font-bold text-emerald-300 shrink-0">{formatCurrency(o.amount)}</p>
            </div>
            {o.note && <p className="text-xs text-slate-400 mt-2">{o.note}</p>}
            <ul className="mt-2 space-y-1">
              {o.tasks.map((t, i) => (
                <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5"><span className="text-purple-400">•</span>{t.label}</li>
              ))}
            </ul>
            <div className="flex items-center gap-3 mt-3">
              <button onClick={() => onPick(o)} className="btn-primary text-xs py-1.5 px-4">Track this</button>
              {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 hover:text-cyan-300">View offer ↗</a>}
              {o.offerEnds && <span className="text-xs text-slate-500">Ends {formatDate(o.offerEnds)}</span>}
            </div>
          </div>
        ))}
      </div>
    </Modal>
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
