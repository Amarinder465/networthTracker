import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrency } from '../lib/format'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'

const CATEGORIES = ['Cash', 'Checking / Savings', 'Investment', 'Retirement', 'Real Estate', 'Vehicle', 'Crypto', 'Other']
const EMPTY = { name: '', category: 'Cash', value: '', notes: '' }

export default function Assets() {
  const { user } = useAuth()
  const [assets, setAssets]   = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]     = useState(false)
  const [form, setForm]       = useState(EMPTY)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [confirmId, setConfirmId] = useState(null)

  async function load() {
    const { data } = await supabase.from('assets').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
    setAssets(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNew()   { setForm(EMPTY); setEditing(null); setModal(true) }
  function openEdit(a) { setForm({ name: a.name, category: a.category, value: a.value, notes: a.notes ?? '' }); setEditing(a.id); setModal(true) }

  async function save() {
    if (!form.name || !form.value) return
    setSaving(true)
    const payload = { name: form.name, category: form.category, value: Number(form.value), notes: form.notes, user_id: user.id }
    if (editing) await supabase.from('assets').update(payload).eq('id', editing)
    else         await supabase.from('assets').insert(payload)
    setSaving(false); setModal(false); load()
  }

  async function remove(id) {
    await supabase.from('assets').delete().eq('id', id)
    setConfirmId(null)
    load()
  }

  async function toggleNetWorth(a) {
    await supabase.from('assets').update({ include_in_net_worth: !a.include_in_net_worth }).eq('id', a.id)
    setAssets(prev => prev.map(x => x.id === a.id ? { ...x, include_in_net_worth: !a.include_in_net_worth } : x))
  }

  const total = assets.reduce((s, a) => s + Number(a.value), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Assets</h1>
          <p className="text-gray-400 text-sm mt-0.5">Total: {formatCurrency(total)}</p>
        </div>
        <button onClick={openNew} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">+ Add Asset</button>
      </div>

      {loading ? <p className="text-gray-400">Loading…</p> : assets.length === 0 ? (
        <div className="text-center text-gray-500 mt-20">
          <p className="text-4xl mb-3">🏦</p>
          <p className="text-lg font-medium">No assets yet</p>
          <p className="text-sm mt-1">Add cash, investments, property, and more.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assets.map(a => (
            <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{a.name}</span>
                    <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{a.category}</span>
                  </div>
                  {a.notes && <p className="text-gray-500 text-xs mt-1 truncate">{a.notes}</p>}
                  <div className="flex items-center gap-3 mt-2">
                    <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
                      <input type="checkbox" checked={a.include_in_net_worth ?? true} onChange={() => toggleNetWorth(a)} className="w-3.5 h-3.5 accent-green-500 cursor-pointer" />
                      Net Worth
                    </label>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-brand-400">{formatCurrency(a.value)}</p>
                  <div className="flex gap-3 mt-1 justify-end">
                    <button onClick={() => openEdit(a)} className="text-gray-400 hover:text-white text-xs transition-colors">Edit</button>
                    <button onClick={() => setConfirmId(a.id)} className="text-red-500 hover:text-red-400 text-xs transition-colors">Delete</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmId && (
        <ConfirmModal
          message="Delete this asset?"
          onConfirm={() => remove(confirmId)}
          onCancel={() => setConfirmId(null)}
        />
      )}

      {modal && (
        <Modal title={editing ? 'Edit Asset' : 'Add Asset'} onClose={() => setModal(false)}>
          <div className="space-y-4">
            <Field label="Name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Chase Checking" /></Field>
            <Field label="Category">
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Value ($)"><input type="number" min="0" step="0.01" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="0.00" /></Field>
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

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1.5">{label}</label>
      <children.type {...children.props} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 transition-colors" />
    </div>
  )
}
