import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'

export default function Trades() {
  const { user } = useAuth()
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ profit_loss: '', notes: '', trade_date: new Date().toISOString().split('T')[0] })
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState('month') // 'day', 'month', 'year'
  const [selectedDay, setSelectedDay] = useState(null)

  async function load() {
    const { data } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .order('trade_date', { ascending: false })
    setTrades(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function save() {
    if (!form.profit_loss || !form.trade_date) return
    setSaving(true)
    const payload = {
      profit_loss: parseFloat(form.profit_loss),
      notes: form.notes || null,
      trade_date: form.trade_date,
      user_id: user.id
    }

    if (editing) {
      await supabase.from('trades').update(payload).eq('id', editing)
    } else {
      await supabase.from('trades').insert(payload)
    }

    setSaving(false)
    setModal(false)
    setForm({ profit_loss: '', notes: '', trade_date: new Date().toISOString().split('T')[0] })
    setEditing(null)
    load()
  }

  async function deleteTrade(id) {
    await supabase.from('trades').delete().eq('id', id)
    setConfirmDelete(null)
    load()
  }

  function openEdit(trade) {
    setForm(trade)
    setEditing(trade.id)
    setModal(true)
  }

  function openAddProfit() {
    setForm({ profit_loss: '', notes: '', trade_date: selectedDay ? selectedDay.toISOString().split('T')[0] : new Date().toISOString().split('T')[0] })
    setEditing(null)
    setModal(true)
  }

  function openAddLoss() {
    setForm({ profit_loss: '', notes: '', trade_date: selectedDay ? selectedDay.toISOString().split('T')[0] : new Date().toISOString().split('T')[0] })
    setEditing(null)
    setModal(true)
  }

  // Get trades for specific date
  function getTradesForDay(day) {
    if (!day) return []
    const dateStr = day.toISOString().split('T')[0]
    return trades.filter(t => t.trade_date === dateStr)
  }

  // Calculate daily total
  function getDailyTotal(day) {
    return getTradesForDay(day).reduce((sum, t) => sum + parseFloat(t.profit_loss || 0), 0)
  }

  // Calculate monthly total
  function getMonthlyTotal(year, month) {
    return trades
      .filter(t => {
        const d = new Date(t.trade_date)
        return d.getFullYear() === year && d.getMonth() === month
      })
      .reduce((sum, t) => sum + parseFloat(t.profit_loss || 0), 0)
  }

  // Calculate yearly total
  function getYearlyTotal(year) {
    return trades
      .filter(t => new Date(t.trade_date).getFullYear() === year)
      .reduce((sum, t) => sum + parseFloat(t.profit_loss || 0), 0)
  }

  // Calendar helpers
  function getDaysInMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  }

  function getFirstDayOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
  }

  // Build calendar days
  const monthDays = getDaysInMonth(currentDate)
  const firstDay = getFirstDayOfMonth(currentDate)
  const calendarDays = []

  for (let i = firstDay - 1; i >= 0; i--) {
    calendarDays.push({ date: null, grayed: true })
  }

  for (let day = 1; day <= monthDays; day++) {
    calendarDays.push({
      date: new Date(currentDate.getFullYear(), currentDate.getMonth(), day),
      grayed: false,
    })
  }

  while (calendarDays.length < 42) {
    calendarDays.push({ date: null, grayed: true })
  }

  const monthlyTotal = getMonthlyTotal(currentDate.getFullYear(), currentDate.getMonth())
  const yearlyTotal = getYearlyTotal(currentDate.getFullYear())
  const totalTrades = trades.length
  const totalProfit = trades.reduce((sum, t) => sum + parseFloat(t.profit_loss || 0), 0)

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))

  return (
    <div className="space-y-4 md:space-y-6 overflow-x-hidden">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Trade Tracker</h1>
          <p className="text-gray-400 text-sm mt-0.5">Log your daily P&L with calendar view</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={openAddLoss}
            className="bg-red-500/20 hover:bg-red-500/30 text-red-400 px-3 sm:px-4 py-2 rounded-xl font-medium text-xs sm:text-sm transition-colors whitespace-nowrap"
          >
            − Loss
          </button>
          <button
            onClick={openAddProfit}
            className="bg-green-500/20 hover:bg-green-500/30 text-green-400 px-3 sm:px-4 py-2 rounded-xl font-medium text-xs sm:text-sm transition-colors whitespace-nowrap"
          >
            + Profit
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <StatCard label="Total Trades" value={totalTrades} color="text-white" />
        <StatCard
          label="Overall P&L"
          value={`$${totalProfit.toFixed(2)}`}
          color={totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <StatCard
          label="Monthly"
          value={`$${monthlyTotal.toFixed(2)}`}
          color={monthlyTotal >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <StatCard
          label="Yearly"
          value={`$${yearlyTotal.toFixed(2)}`}
          color={yearlyTotal >= 0 ? 'text-green-400' : 'text-red-400'}
        />
      </div>

      {/* View Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setViewMode('month')}
          className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
            viewMode === 'month'
              ? 'bg-brand-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          Month
        </button>
        <button
          onClick={() => setViewMode('year')}
          className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
            viewMode === 'year'
              ? 'bg-brand-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          Year
        </button>
      </div>

      {/* Calendar & Trades */}
      {loading ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-6 text-center text-gray-400">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 w-full">
          {/* Calendar - 2/3 width on desktop */}
          <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden w-full">
          {/* Month Header */}
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-800 flex items-center justify-between">
            <button
              onClick={prevMonth}
              className="text-gray-400 hover:text-white transition-colors text-xs sm:text-sm"
            >
              ← Prev
            </button>
            <h2 className="font-semibold text-base sm:text-lg">
              {viewMode === 'year'
                ? currentDate.getFullYear()
                : currentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
            </h2>
            <button
              onClick={nextMonth}
              className="text-gray-400 hover:text-white transition-colors text-xs sm:text-sm"
            >
              Next →
            </button>
          </div>

          {/* Calendar Grid */}
          <div className="p-3 sm:p-6 w-full">
            {viewMode === 'month' ? (
              <>
                {/* Day headers */}
                <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-1 sm:mb-2 w-full">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="text-center text-xs font-medium text-gray-500 py-1 sm:py-2">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar days */}
                <div className="grid grid-cols-7 gap-1 sm:gap-2 w-full">
                  {calendarDays.map((day, idx) => {
                    const dayTrades = day.date ? getTradesForDay(day.date) : []
                    const dailyTotal = day.date ? getDailyTotal(day.date) : 0
                    const isToday =
                      day.date &&
                      day.date.toDateString() === new Date().toDateString()
                    const isSelected =
                      selectedDay &&
                      day.date &&
                      day.date.toDateString() === selectedDay.toDateString()

                    return (
                      <button
                        key={idx}
                        onClick={() => day.date && setSelectedDay(day.date)}
                        className={`aspect-square p-1 sm:p-2 rounded-lg text-xs sm:text-sm font-medium transition-colors flex flex-col items-center justify-center relative min-w-0 ${
                          day.grayed
                            ? 'bg-gray-800/30 text-gray-600'
                            : isSelected && !isToday
                            ? 'bg-cyan-500/30 border-2 border-cyan-400 text-cyan-300 font-bold'
                            : isToday
                            ? 'bg-green-500/20 border border-green-400 text-white'
                            : 'bg-gray-800 text-white hover:bg-gray-700'
                        }`}
                      >
                        {day.date && (
                          <>
                            <span className="text-xs">{day.date.getDate()}</span>
                            {dayTrades.length > 0 && (
                              <span className={`text-[10px] sm:text-xs font-bold mt-0.5 ${
                                dailyTotal >= 0 ? 'text-green-400' : 'text-red-400'
                              }`}>
                                ${dailyTotal.toFixed(0)}
                              </span>
                            )}
                          </>
                        )}
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              /* Year view */
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4 w-full">
                {Array.from({ length: 12 }).map((_, monthIdx) => {
                  const monthTotal = getMonthlyTotal(currentDate.getFullYear(), monthIdx)
                  const monthName = new Date(currentDate.getFullYear(), monthIdx).toLocaleString('en-US', { month: 'short' })
                  return (
                    <button
                      key={monthIdx}
                      onClick={() => {
                        setCurrentDate(new Date(currentDate.getFullYear(), monthIdx, 1))
                        setViewMode('month')
                      }}
                      className="bg-gray-800 border border-gray-700 rounded-lg p-3 sm:p-4 text-center hover:border-brand-500 hover:bg-gray-700 transition-colors cursor-pointer"
                    >
                      <p className="text-xs sm:text-sm font-medium text-gray-400 mb-1 sm:mb-2">{monthName}</p>
                      <p className={`text-lg sm:text-2xl font-bold ${
                        monthTotal >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        ${monthTotal.toFixed(0)}
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

          {/* Selected Day Trades - Side Panel */}
          {selectedDay && viewMode === 'month' && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-6 overflow-hidden flex flex-col max-h-96 lg:max-h-none w-full">
              <div className="border-b border-gray-700 pb-3 sm:pb-4 mb-3 sm:mb-4">
                <h3 className="font-semibold text-base sm:text-lg mb-1 sm:mb-2">
                  {selectedDay.toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </h3>
                <span className={`text-xl sm:text-2xl font-bold ${
                  getDailyTotal(selectedDay) >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  ${getDailyTotal(selectedDay).toFixed(2)}
                </span>
              </div>
              <div className="space-y-2 overflow-y-auto flex-1">
                {getTradesForDay(selectedDay).length === 0 ? (
                  <p className="text-gray-500 text-xs sm:text-sm">No trades for this day.</p>
                ) : (
                  getTradesForDay(selectedDay).map(trade => (
                    <div
                      key={trade.id}
                      className="bg-gray-800 border border-gray-700 rounded-lg p-2 sm:p-3 flex items-start gap-2 sm:gap-3 group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`font-bold text-xs sm:text-sm ${
                          parseFloat(trade.profit_loss) >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {parseFloat(trade.profit_loss) >= 0 ? '+' : ''}${parseFloat(trade.profit_loss).toFixed(2)}
                        </p>
                        {trade.notes && (
                          <p className="text-xs text-gray-400 mt-1 break-words line-clamp-2">
                            {trade.notes}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 sm:gap-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => openEdit(trade)}
                          className="text-gray-500 hover:text-blue-400 transition-colors text-xs px-1.5 sm:px-2 py-1 rounded bg-gray-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setConfirmDelete(trade)}
                          className="text-gray-500 hover:text-red-400 transition-colors text-xs px-1.5 sm:px-2 py-1 rounded bg-gray-700"
                        >
                          Del
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <Modal title={editing ? 'Edit Trade' : 'Add Trade'} onClose={() => setModal(false)}>
          <div className="space-y-3 sm:space-y-4">
            <div>
              <label className="text-xs sm:text-sm font-medium text-gray-300 block mb-1.5">
                Amount <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  value={form.profit_loss}
                  onChange={e => setForm({ ...form, profit_loss: e.target.value })}
                  placeholder="e.g., 250.50"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 sm:py-2.5 text-sm text-white focus:outline-none focus:border-brand-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs sm:text-sm font-medium text-gray-300 block mb-1.5">
                Notes
              </label>
              <textarea
                value={form.notes ?? ''}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Add notes about this trade (optional)"
                rows="3"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 sm:py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 resize-none"
              />
            </div>

            <div>
              <label className="text-xs sm:text-sm font-medium text-gray-300 block mb-1.5">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={form.trade_date}
                onChange={e => setForm({ ...form, trade_date: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 sm:py-2.5 text-sm text-white focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
              {editing && (
                <button
                  onClick={() => setConfirmDelete({ id: editing })}
                  className="bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors"
                >
                  Delete
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setModal(false)}
                className="bg-gray-800 hover:bg-gray-700 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !form.profit_loss || !form.trade_date}
                className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors"
              >
                {saving ? '…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <ConfirmModal
          message={`Delete this trade?`}
          onConfirm={() => deleteTrade(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 sm:p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-lg sm:text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
