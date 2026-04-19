import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrency } from '../lib/format'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'

const CATEGORIES = ['Flights', 'Hotel', 'Food', 'Activities', 'Transportation', 'Shopping', 'Misc']

const EMPTY_TRIP = { name: '', destination: '', start_date: '', end_date: '', travelers: '1' }
const EMPTY_ITEM = { category: 'Flights', label: '', budgeted: '', actual: '' }

export default function TripCalculator() {
  const { user } = useAuth()
  const [trips, setTrips]       = useState([])
  const [items, setItems]       = useState([])
  const [active, setActive]     = useState(null) // selected trip
  const [loading, setLoading]   = useState(true)
  const [tripModal, setTripModal] = useState(false)
  const [itemModal, setItemModal] = useState(false)
  const [tripForm, setTripForm] = useState(EMPTY_TRIP)
  const [itemForm, setItemForm] = useState(EMPTY_ITEM)
  const [editTrip, setEditTrip] = useState(null)
  const [editItem, setEditItem] = useState(null)
  const [saving, setSaving]     = useState(false)
  const [confirmTrip, setConfirmTrip] = useState(null)
  const [confirmItem, setConfirmItem] = useState(null)

  async function loadTrips() {
    const { data } = await supabase.from('trips').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
    setTrips(data ?? [])
    setLoading(false)
  }

  async function loadItems(tripId) {
    const { data } = await supabase.from('trip_items').select('*').eq('trip_id', tripId).order('created_at', { ascending: true })
    setItems(data ?? [])
  }

  useEffect(() => { loadTrips() }, [])
  useEffect(() => { if (active) loadItems(active.id) }, [active])

  function openNewTrip()   { setTripForm(EMPTY_TRIP); setEditTrip(null); setTripModal(true) }
  function openEditTrip(t) { setTripForm({ name: t.name, destination: t.destination ?? '', start_date: t.start_date ?? '', end_date: t.end_date ?? '', travelers: t.travelers ?? '1' }); setEditTrip(t); setTripModal(true) }
  function openNewItem()   { setItemForm(EMPTY_ITEM); setEditItem(null); setItemModal(true) }
  function openEditItem(i) { setItemForm({ category: i.category, label: i.label ?? '', budgeted: i.budgeted, actual: i.actual ?? '' }); setEditItem(i); setItemModal(true) }

  async function saveTrip() {
    if (!tripForm.name) return
    setSaving(true)
    const payload = {
      name: tripForm.name,
      destination: tripForm.destination || null,
      start_date: tripForm.start_date || null,
      end_date: tripForm.end_date || null,
      travelers: Number(tripForm.travelers) || 1,
      user_id: user.id,
    }
    if (editTrip) {
      await supabase.from('trips').update(payload).eq('id', editTrip.id)
      if (active?.id === editTrip.id) setActive({ ...active, ...payload })
    } else {
      const { data } = await supabase.from('trips').insert(payload).select().single()
      if (data) setActive(data)
    }
    setSaving(false); setTripModal(false); loadTrips()
  }

  async function deleteTrip(t) {
    await supabase.from('trips').delete().eq('id', t.id)
    if (active?.id === t.id) { setActive(null); setItems([]) }
    setConfirmTrip(null)
    loadTrips()
  }

  async function saveItem() {
    if (!itemForm.budgeted || !active) return
    setSaving(true)
    const payload = {
      trip_id: active.id, user_id: user.id,
      category: itemForm.category,
      label: itemForm.label || null,
      budgeted: Number(itemForm.budgeted),
      actual: itemForm.actual !== '' ? Number(itemForm.actual) : null,
    }
    if (editItem) await supabase.from('trip_items').update(payload).eq('id', editItem.id)
    else          await supabase.from('trip_items').insert(payload)
    setSaving(false); setItemModal(false); loadItems(active.id)
  }

  async function deleteItem(id) {
    await supabase.from('trip_items').delete().eq('id', id)
    setConfirmItem(null)
    loadItems(active.id)
  }

  async function updateActual(id, value) {
    await supabase.from('trip_items').update({ actual: value !== '' ? Number(value) : null }).eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? { ...i, actual: value !== '' ? Number(value) : null } : i))
  }

  const travelers   = Math.max(Number(active?.travelers) || 1, 1)
  const totalBudget = items.reduce((s, i) => s + Number(i.budgeted || 0), 0)
  const totalActual = items.reduce((s, i) => s + Number(i.actual  ?? 0), 0)
  const hasActual   = items.some(i => i.actual !== null && i.actual !== undefined)
  const nights      = active?.start_date && active?.end_date
    ? Math.max(Math.round((new Date(active.end_date) - new Date(active.start_date)) / 86400000), 0)
    : null

  const byCategory = items.reduce((acc, i) => {
    acc[i.category] = (acc[i.category] ?? 0) + Number(i.budgeted || 0)
    return acc
  }, {})

  if (loading) return <div className="text-gray-400 mt-10 text-center">Loading…</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {active && (
            <button onClick={() => { setActive(null); setItems([]) }} className="text-gray-400 hover:text-white transition-colors text-sm">← Trips</button>
          )}
          <h1 className="text-2xl font-bold">{active ? active.name : 'Trip Calculator'}</h1>
          {active?.destination && <span className="text-gray-400 text-sm">{active.destination}</span>}
          {active && nights !== null && <span className="text-gray-500 text-sm">{nights} night{nights !== 1 ? 's' : ''}</span>}
        </div>
        <div className="flex gap-2">
          {active ? (
            <>
              <button onClick={() => openEditTrip(active)} className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">Edit Trip</button>
              <button onClick={openNewItem} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">+ Add Expense</button>
            </>
          ) : (
            <button onClick={openNewTrip} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">+ New Trip</button>
          )}
        </div>
      </div>

      {/* Trip List */}
      {!active && (
        trips.length === 0 ? (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-4xl mb-3">✈️</p>
            <p className="text-lg font-medium">No trips yet</p>
            <p className="text-sm mt-1">Create a trip to start planning your budget.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {trips.map(t => (
              <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 cursor-pointer hover:border-gray-600 transition-colors" onClick={() => setActive(t)}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-base">{t.name}</p>
                    {t.destination && <p className="text-gray-400 text-sm mt-0.5">{t.destination}</p>}
                    {t.start_date && t.end_date && (
                      <p className="text-gray-500 text-xs mt-1">
                        {new Date(t.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(t.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                    <p className="text-gray-500 text-xs mt-1">{t.travelers} traveler{t.travelers !== 1 ? 's' : ''}</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setConfirmTrip(t) }} className="text-red-500 hover:text-red-400 text-xs transition-colors">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Trip Detail */}
      {active && (
        <>
          {/* Summary Cards */}
          {items.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <SummaryCard label="Total Budget" value={formatCurrency(totalBudget)} color="text-brand-400" />
              <SummaryCard label="Per Person" value={formatCurrency(totalBudget / travelers)} color="text-blue-400" />
              {hasActual && <SummaryCard label="Actual Spent" value={formatCurrency(totalActual)} color="text-yellow-400" />}
              {hasActual && (
                <SummaryCard
                  label={totalActual <= totalBudget ? 'Under Budget' : 'Over Budget'}
                  value={formatCurrency(Math.abs(totalBudget - totalActual))}
                  color={totalActual <= totalBudget ? 'text-brand-400' : 'text-red-400'}
                />
              )}
            </div>
          )}

          {/* Expense Table */}
          {items.length === 0 ? (
            <div className="text-center text-gray-500 mt-10">
              <p className="text-4xl mb-3">🧾</p>
              <p className="text-lg font-medium">No expenses yet</p>
              <p className="text-sm mt-1">Add flights, hotel, food, and activities.</p>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[540px]">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-left">
                    <th className="px-5 py-3 font-medium">Category</th>
                    <th className="px-5 py-3 font-medium">Label</th>
                    <th className="px-5 py-3 font-medium text-right">Budgeted</th>
                    <th className="px-5 py-3 font-medium text-right">Per Person</th>
                    <th className="px-5 py-3 font-medium text-right">Actual</th>
                    <th className="px-5 py-3 font-medium text-right">+/−</th>
                    <th className="px-5 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const diff = item.actual !== null && item.actual !== undefined ? Number(item.budgeted) - Number(item.actual) : null
                    return (
                      <tr key={item.id} className="border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors">
                        <td className="px-5 py-3"><span className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full text-xs">{item.category}</span></td>
                        <td className="px-5 py-3 text-gray-400">{item.label || '—'}</td>
                        <td className="px-5 py-3 text-right font-semibold text-white">{formatCurrency(item.budgeted)}</td>
                        <td className="px-5 py-3 text-right text-blue-400">{formatCurrency(Number(item.budgeted) / travelers)}</td>
                        <td className="px-5 py-3 text-right">
                          <input
                            type="number" min="0" step="0.01"
                            defaultValue={item.actual ?? ''}
                            onBlur={e => updateActual(item.id, e.target.value)}
                            placeholder="—"
                            className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-right text-white text-xs focus:outline-none focus:border-brand-500"
                          />
                        </td>
                        <td className="px-5 py-3 text-right text-xs font-medium">
                          {diff !== null
                            ? <span className={diff >= 0 ? 'text-brand-400' : 'text-red-400'}>{diff >= 0 ? '+' : ''}{formatCurrency(diff)}</span>
                            : <span className="text-gray-600">—</span>
                          }
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => openEditItem(item)} className="text-gray-400 hover:text-white mr-3 transition-colors text-xs">Edit</button>
                          <button onClick={() => setConfirmItem(item.id)} className="text-red-500 hover:text-red-400 transition-colors text-xs">Delete</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-700 font-semibold">
                    <td colSpan={2} className="px-5 py-3 text-gray-400">Total</td>
                    <td className="px-5 py-3 text-right text-white">{formatCurrency(totalBudget)}</td>
                    <td className="px-5 py-3 text-right text-blue-400">{formatCurrency(totalBudget / travelers)}</td>
                    <td className="px-5 py-3 text-right text-yellow-400">{hasActual ? formatCurrency(totalActual) : '—'}</td>
                    <td className="px-5 py-3 text-right text-xs">
                      {hasActual && (() => { const d = totalBudget - totalActual; return <span className={d >= 0 ? 'text-brand-400' : 'text-red-400'}>{d >= 0 ? '+' : ''}{formatCurrency(d)}</span> })()}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              </div>
            </div>
          )}

          {/* Category Breakdown */}
          {Object.keys(byCategory).length > 1 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Budget by Category</h2>
              <div className="space-y-2">
                {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                  <div key={cat}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-300">{cat}</span>
                      <span className="text-white font-medium">{formatCurrency(amt)} <span className="text-gray-500 font-normal text-xs">({Math.round(amt / totalBudget * 100)}%)</span></span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-500 rounded-full" style={{ width: `${(amt / totalBudget) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {confirmTrip && (
        <ConfirmModal
          message={`Delete trip "${confirmTrip.name}"?`}
          onConfirm={() => deleteTrip(confirmTrip)}
          onCancel={() => setConfirmTrip(null)}
        />
      )}

      {confirmItem && (
        <ConfirmModal
          message="Delete this expense?"
          onConfirm={() => deleteItem(confirmItem)}
          onCancel={() => setConfirmItem(null)}
        />
      )}

      {/* Trip Modal */}
      {tripModal && (
        <Modal title={editTrip ? 'Edit Trip' : 'New Trip'} onClose={() => setTripModal(false)}>
          <div className="space-y-4">
            <Field label="Trip Name *"><input value={tripForm.name} onChange={e => setTripForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Summer Vacation" /></Field>
            <Field label="Destination (optional)"><input value={tripForm.destination} onChange={e => setTripForm(f => ({ ...f, destination: e.target.value }))} placeholder="e.g. Paris, France" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start Date"><input type="date" value={tripForm.start_date} onChange={e => setTripForm(f => ({ ...f, start_date: e.target.value }))} /></Field>
              <Field label="End Date"><input type="date" value={tripForm.end_date} onChange={e => setTripForm(f => ({ ...f, end_date: e.target.value }))} /></Field>
            </div>
            <Field label="# of Travelers"><input type="number" min="1" value={tripForm.travelers} onChange={e => setTripForm(f => ({ ...f, travelers: e.target.value }))} placeholder="1" /></Field>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setTripModal(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">Cancel</button>
              <button onClick={saveTrip} disabled={saving || !tripForm.name} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Item Modal */}
      {itemModal && (
        <Modal title={editItem ? 'Edit Expense' : 'Add Expense'} onClose={() => setItemModal(false)}>
          <div className="space-y-4">
            <Field label="Category">
              <select value={itemForm.category} onChange={e => setItemForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Label (optional)"><input value={itemForm.label} onChange={e => setItemForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Round-trip flights" /></Field>
            <Field label="Budgeted ($) *"><input type="number" min="0" step="0.01" value={itemForm.budgeted} onChange={e => setItemForm(f => ({ ...f, budgeted: e.target.value }))} placeholder="0.00" /></Field>
            <Field label="Actual ($) (optional)"><input type="number" min="0" step="0.01" value={itemForm.actual} onChange={e => setItemForm(f => ({ ...f, actual: e.target.value }))} placeholder="0.00" /></Field>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setItemModal(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">Cancel</button>
              <button onClick={saveItem} disabled={saving || !itemForm.budgeted} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">{saving ? 'Saving…' : 'Save'}</button>
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

function SummaryCard({ label, value, color }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  )
}
