import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
import TradeStats from '../components/TradeStats'

const pad = n => String(n).padStart(2, '0')

// Calendar cells are built from local components, so they must be keyed the
// same way. toISOString() converts to UTC first, which slides the key into the
// neighbouring day for anyone west of Greenwich in the evening.
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// trade_date is a plain YYYY-MM-DD string; read the parts straight off it
// rather than through Date, which would treat it as UTC midnight and drop the
// 1st of a month into the previous one.
const yearOf = iso => Number(iso.slice(0, 4))
const monthOf = iso => Number(iso.slice(5, 7)) - 1

export default function Trades() {
  const { user } = useAuth()
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ profit_loss: '', notes: '', trade_date: dayKey(new Date()) })
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState('month') // 'month', 'year', 'stats'
  // Bumped by the "What if I sold everything?" button; Stats scrolls to the panel.
  const [whatIfSignal, setWhatIfSignal] = useState(0)

  function showWhatIf() {
    setViewMode('stats')
    setWhatIfSignal(n => n + 1)
  }
  const [selectedDay, setSelectedDay] = useState(new Date())

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
    setForm({ profit_loss: '', notes: '', trade_date: dayKey(new Date()) })
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
    setForm({ profit_loss: '', notes: '', trade_date: dayKey(selectedDay ?? new Date()) })
    setEditing(null)
    setModal(true)
  }

  function openAddLoss() {
    setForm({ profit_loss: '', notes: '', trade_date: dayKey(selectedDay ?? new Date()) })
    setEditing(null)
    setModal(true)
  }

  // Get trades for specific date
  function getTradesForDay(day) {
    if (!day) return []
    const dateStr = dayKey(day)
    return trades.filter(t => t.trade_date === dateStr)
  }

  // Calculate daily total
  function getDailyTotal(day) {
    return getTradesForDay(day).reduce((sum, t) => sum + parseFloat(t.profit_loss || 0), 0)
  }

  // Trades in a given month, newest first
  function getTradesForMonth(year, month) {
    return trades.filter(t => yearOf(t.trade_date) === year && monthOf(t.trade_date) === month)
  }

  const sumPL = list => list.reduce((sum, t) => sum + parseFloat(t.profit_loss || 0), 0)

  // Calculate monthly total
  function getMonthlyTotal(year, month) {
    return sumPL(getTradesForMonth(year, month))
  }

  // Calculate yearly total
  function getYearlyTotal(year) {
    return sumPL(trades.filter(t => yearOf(t.trade_date) === year))
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

  // Moving the calendar has to move the side panel with it. Leaving the old
  // selected day in place left the panel summarising a date that was not even
  // on screen — jump to a March and it still totalled up today in August.
  function goToMonth(year, month) {
    setCurrentDate(new Date(year, month, 1))
    const today = new Date()
    const landingOnThisMonth = today.getFullYear() === year && today.getMonth() === month
    // No day picked means the panel widens to the whole month, which is the
    // useful default when you have just jumped somewhere new.
    setSelectedDay(landingOnThisMonth ? new Date(year, month, today.getDate()) : null)
  }

  const prevMonth = () => goToMonth(currentDate.getFullYear(), currentDate.getMonth() - 1)
  const nextMonth = () => goToMonth(currentDate.getFullYear(), currentDate.getMonth() + 1)
  const prevYear = () => goToMonth(currentDate.getFullYear() - 1, currentDate.getMonth())
  const nextYear = () => goToMonth(currentDate.getFullYear() + 1, currentDate.getMonth())

  // What the side panel is currently describing: the picked day, else the month
  // on screen, else the whole year while the year grid is up.
  const panel = (() => {
    if (viewMode === 'year') {
      const list = trades.filter(t => yearOf(t.trade_date) === currentDate.getFullYear())
      return { title: String(currentDate.getFullYear()), hint: 'Pick a month to zoom in', list, showDates: true }
    }
    if (selectedDay) {
      return {
        title: selectedDay.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        hint: 'Tap the day again for the whole month',
        list: getTradesForDay(selectedDay),
        showDates: false,
      }
    }
    return {
      title: currentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      hint: 'Pick a day to narrow it down',
      list: getTradesForMonth(currentDate.getFullYear(), currentDate.getMonth()),
      showDates: true,
    }
  })()
  const panelTotal = sumPL(panel.list)

  return (
    <div className="space-y-8 overflow-x-hidden animate-fadeInUp">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-5xl font-bold text-white">Trade Journal</h1>
          <p className="text-cyan-400 font-medium mt-2">Track your P&L performance over time</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={showWhatIf}
            className="bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 px-4 py-2.5 rounded-lg font-semibold text-xs sm:text-sm transition-all whitespace-nowrap"
          >
            What if I sold everything?
          </button>
          <button
            onClick={openAddLoss}
            className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 px-4 py-2.5 rounded-lg font-semibold text-xs sm:text-sm transition-all whitespace-nowrap"
          >
            ↓ Loss
          </button>
          <button
            onClick={openAddProfit}
            className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 px-4 py-2.5 rounded-lg font-semibold text-xs sm:text-sm transition-all whitespace-nowrap"
          >
            ↑ Profit
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Trades" value={totalTrades} color="text-slate-100" />
        <StatCard
          label="Overall P&L"
          value={`$${totalProfit.toFixed(2)}`}
          color={totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}
        />
        <StatCard
          label="Monthly"
          value={`$${monthlyTotal.toFixed(2)}`}
          color={monthlyTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}
        />
        <StatCard
          label="Yearly"
          value={`$${yearlyTotal.toFixed(2)}`}
          color={yearlyTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}
        />
      </div>

      {/* View Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setViewMode('month')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            viewMode === 'month'
              ? 'bg-teal-600 text-white shadow-lg shadow-teal-500/25'
              : 'bg-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-700'
          }`}
        >
          Month
        </button>
        <button
          onClick={() => setViewMode('year')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            viewMode === 'year'
              ? 'bg-teal-600 text-white shadow-lg shadow-teal-500/25'
              : 'bg-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-700'
          }`}
        >
          Year
        </button>
        <button
          onClick={() => setViewMode('stats')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            viewMode === 'stats'
              ? 'bg-teal-600 text-white shadow-lg shadow-teal-500/25'
              : 'bg-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-700'
          }`}
        >
          Stats
        </button>
      </div>

      {/* Calendar & Trades */}
      {loading ? (
        <div className="card text-center text-slate-400">⏳ Loading…</div>
      ) : viewMode === 'stats' ? (
        <TradeStats rows={trades} whatIfSignal={whatIfSignal} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
          {/* Calendar - 2/3 width on desktop */}
          <div className="lg:col-span-2 card overflow-hidden">
          {/* Month Header */}
          <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
            <button
              onClick={viewMode === 'year' ? prevYear : prevMonth}
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
              onClick={viewMode === 'year' ? nextYear : nextMonth}
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
                        onClick={() => day.date && setSelectedDay(isSelected ? null : day.date)}
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
                        goToMonth(currentDate.getFullYear(), monthIdx)
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

          {/* Side panel — always scoped to whatever the calendar is showing */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-6 overflow-hidden flex flex-col max-h-96 lg:max-h-none w-full">
              <div className="border-b border-gray-700 pb-3 sm:pb-4 mb-3 sm:mb-4">
                <h3 className="font-semibold text-base sm:text-lg mb-1 sm:mb-2">
                  {panel.title}
                </h3>
                <span className={`text-xl sm:text-2xl font-bold ${
                  panelTotal >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  ${panelTotal.toFixed(2)}
                </span>
                <p className="text-xs text-gray-500 mt-1">
                  {panel.list.length} trade{panel.list.length === 1 ? '' : 's'} · {panel.hint}
                </p>
              </div>
              <div className="space-y-2 overflow-y-auto flex-1">
                {panel.list.length === 0 ? (
                  <p className="text-gray-500 text-xs sm:text-sm">No trades in this period.</p>
                ) : (
                  panel.list.map(trade => (
                    <div
                      key={trade.id}
                      className="bg-gray-800 border border-gray-700 rounded-lg p-2 sm:p-3 flex items-start gap-2 sm:gap-3 group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`font-bold text-xs sm:text-sm ${
                          parseFloat(trade.profit_loss) >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {parseFloat(trade.profit_loss) >= 0 ? '+' : ''}${parseFloat(trade.profit_loss).toFixed(2)}
                          {panel.showDates && (
                            <span className="text-gray-500 font-normal ml-2">
                              {new Date(`${trade.trade_date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
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
