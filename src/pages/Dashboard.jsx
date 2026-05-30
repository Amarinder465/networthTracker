import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCurrency, getNextDueDate } from '../lib/format'
import { processLoanAutoPay } from '../lib/loans'
import StatCard from '../components/StatCard'
import ConfirmModal from '../components/ConfirmModal'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'

const PIE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4']

function formatSnapshotDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function Dashboard() {
  const { user } = useAuth()
  const [assets, setAssets]   = useState([])
  const [loans, setLoans]     = useState([])
  const [bills, setBills]     = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [snapNote, setSnapNote] = useState('')
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [testDate, setTestDate] = useState('')
  const [billFilter, setBillFilter] = useState('All')
  const [confirmId, setConfirmId] = useState(null)

  async function load() {
    const [a, l, b, h] = await Promise.all([
      supabase.from('assets').select('*').eq('user_id', user.id),
      supabase.from('loans').select('*').eq('user_id', user.id),
      supabase.from('bills').select('*').eq('user_id', user.id),
      supabase.from('net_worth_history').select('*').eq('user_id', user.id).order('snapshot_date', { ascending: true }),
    ])
    const loanRows = l.data ?? []

    // Auto-pay any overdue loan cycles, using REAL today (testDate on this
    // page is display-only — explicit auto-pay testing happens on /loans).
    const { totalCycles } = await processLoanAutoPay(loanRows, new Date())
    let finalLoans = loanRows
    if (totalCycles > 0) {
      const { data: refreshed } = await supabase.from('loans').select('*').eq('user_id', user.id)
      finalLoans = refreshed ?? []
    }

    setAssets(a.data ?? [])
    setLoans(finalLoans)
    setBills(b.data  ?? [])
    setHistory(h.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const totalAssets  = assets.filter(a => a.include_in_net_worth ?? true).reduce((s, a) => s + Number(a.value), 0)
  const totalDebt    = loans.filter(l  => l.include_in_net_worth ?? true).reduce((s, l)  => s + Number(l.balance), 0)
  const netWorth     = totalAssets - totalDebt
  const today = testDate ? new Date(testDate + 'T00:00:00') : new Date()
  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  const upcomingBills = bills.filter(b => { const n = getNextDueDate(b.due_date, b.frequency); return n && n >= today && n <= thisMonthEnd })
  const upcomingLoans = loans.filter(l => { const n = getNextDueDate(l.due_date, 'monthly'); return n && n >= today && n <= thisMonthEnd })
  const upcomingTotal = [
    ...upcomingBills.map(b => Number(b.amount)),
    ...upcomingLoans.map(l => Number(l.min_payment ?? 0) + Number(l.pmi ?? 0) + Number(l.property_tax ?? 0) + Number(l.home_insurance ?? 0) + Number(l.hoa ?? 0)),
  ].reduce((s, v) => s + v, 0)
  const upcomingCount = upcomingBills.length + upcomingLoans.length

  const monthlyBillsRaw = bills.filter(b => b.frequency === 'monthly').reduce((s, b) => s + Number(b.amount), 0)
  const yearlyBillsRaw  = bills.filter(b => b.frequency === 'yearly').reduce((s, b) => s + Number(b.amount), 0)

  const billCategories = ['All', ...Array.from(new Set(bills.map(b => b.category))).sort()]
  const filteredBills  = billFilter === 'All' ? bills : bills.filter(b => b.category === billFilter)
  const filteredMonthlyRaw = filteredBills.filter(b => b.frequency === 'monthly').reduce((s, b) => s + Number(b.amount), 0)
  const filteredYearlyRaw  = filteredBills.filter(b => b.frequency === 'yearly').reduce((s, b) => s + Number(b.amount), 0)

  // Per-loan monthly payment amount
  const loanMonthlyPayment = l =>
    Number(l.min_payment ?? 0) + Number(l.pmi ?? 0) + Number(l.property_tax ?? 0) + Number(l.home_insurance ?? 0) + Number(l.hoa ?? 0)

  // How many months this loan has left (capped at 12 for annual calc)
  const loanMonthsThisYear = l => {
    const months = l.term_months ? Math.min(l.term_months, 12) : 12
    return months
  }

  const monthlyLoans   = loans.reduce((s, l) => s + loanMonthlyPayment(l), 0)
  const annualLoans    = loans.reduce((s, l) => s + loanMonthlyPayment(l) * loanMonthsThisYear(l), 0)

  const monthlyBills   = monthlyBillsRaw + (yearlyBillsRaw / 12) + monthlyLoans
  const yearlyBills    = yearlyBillsRaw  + (monthlyBillsRaw * 12) + annualLoans

  const monthlyMinPayments = monthlyLoans

  const assetsByCategory = assets.reduce((acc, a) => {
    acc[a.category] = (acc[a.category] ?? 0) + Number(a.value)
    return acc
  }, {})
  const pieData = Object.entries(assetsByCategory).map(([name, value]) => ({ name, value }))

  const chartData = history.map(h => ({
    date:      formatSnapshotDate(h.snapshot_date),
    'Net Worth':  Number(h.net_worth),
    'Assets':     Number(h.total_assets),
    'Debt':       Number(h.total_debt),
  }))

  async function saveSnapshot() {
    setSaving(true)
    await supabase.from('net_worth_history').insert({
      snapshot_date: new Date().toISOString().split('T')[0],
      total_assets:  totalAssets,
      total_debt:    totalDebt,
      net_worth:     netWorth,
      note:          snapNote || null,
      user_id:       user.id,
    })
    setSnapNote('')
    setShowNoteInput(false)
    setSaving(false)
    load()
  }

  async function deleteSnapshot(id) {
    await supabase.from('net_worth_history').delete().eq('id', id)
    setConfirmId(null)
    load()
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-8 animate-fadeInUp">
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

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-5xl font-bold text-white mb-2">Dashboard</h1>
          <p className="text-cyan-400 font-medium">Your financial universe at a glance</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {showNoteInput && (
            <input
              value={snapNote}
              onChange={e => setSnapNote(e.target.value)}
              placeholder="Optional note (e.g. April 2026)"
              className="input-field w-56"
            />
          )}
          <button
            onClick={() => showNoteInput ? saveSnapshot() : setShowNoteInput(true)}
            disabled={saving}
            className="btn-primary text-sm"
          >
            {saving ? '⏳ Saving…' : '📸 Snapshot'}
          </button>
          {showNoteInput && (
            <button onClick={() => setShowNoteInput(false)} className="text-slate-400 hover:text-white text-sm px-4 py-2 border border-purple-500/20 rounded-lg transition-all font-bold">Cancel</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Net Worth" value={formatCurrency(netWorth)} color={netWorth >= 0 ? 'text-lime-400' : 'text-red-400'} />
        <StatCard label="Total Assets" value={formatCurrency(totalAssets)} color="text-cyan-400" />
        <StatCard label="Total Debt" value={formatCurrency(totalDebt)} color="text-red-400" />
        <StatCard label="Monthly Obligations" value={formatCurrency(monthlyBills)} sub="bills + loans" color="text-orange-400" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Monthly Cost" value={formatCurrency(monthlyBills)} sub="bills + loans (all-in)" color="text-orange-400" />
        <StatCard label="Annual Cost" value={formatCurrency(yearlyBills)} sub="bills + loans × months left" color="text-orange-300" />
        <StatCard label="Upcoming This Month" value={formatCurrency(upcomingTotal)} sub={`${upcomingCount} due (bills + loans)`} color="text-rose-400" />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <span className="text-sm text-slate-300 font-medium">Filter by category:</span>
          <select
            value={billFilter}
            onChange={e => setBillFilter(e.target.value)}
            className="input-field text-sm w-48"
          >
            {billCategories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label={`Monthly Bills${billFilter !== 'All' ? ` — ${billFilter}` : ''}`}
            value={formatCurrency(filteredMonthlyRaw + filteredYearlyRaw / 12)}
            sub="excl. loans"
            color="text-violet-400"
          />
          <StatCard
            label={`Annual Bills${billFilter !== 'All' ? ` — ${billFilter}` : ''}`}
            value={formatCurrency(filteredYearlyRaw + filteredMonthlyRaw * 12)}
            sub="excl. loans"
            color="text-violet-300"
          />
        </div>
      </div>

      {pieData.length > 0 && (
        <div className="card">
          <h2 className="text-xl font-bold text-slate-100 mb-6">Asset Allocation</h2>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={70} outerRadius={110} paddingAngle={3} dataKey="value">
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={v => formatCurrency(v)} contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 12 }} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length >= 2 && (
        <div className="card">
          <h2 className="text-xl font-bold text-slate-100 mb-6">Net Worth Trajectory</h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip formatter={v => formatCurrency(v)} contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 12 }} />
              <Line type="monotone" dataKey="Net Worth" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="Assets"    stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="Debt"      stroke="#f87171" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {history.length > 0 && (
        <div className="card overflow-hidden">
          <h2 className="text-xl font-bold text-slate-100 mb-4">Snapshot History</h2>
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead>
              <tr className="border-b border-slate-700/50 text-slate-400 text-left">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold text-right">Assets</th>
                <th className="px-4 py-3 font-semibold text-right">Debt</th>
                <th className="px-4 py-3 font-semibold text-right">Net Worth</th>
                <th className="px-4 py-3 font-semibold">Note</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map(h => (
                <tr key={h.id} className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                  <td className="px-4 py-3 text-slate-300">{formatSnapshotDate(h.snapshot_date)}</td>
                  <td className="px-4 py-3 text-right text-cyan-400 font-medium">{formatCurrency(h.total_assets)}</td>
                  <td className="px-4 py-3 text-right text-rose-400 font-medium">{formatCurrency(h.total_debt)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${Number(h.net_worth) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(h.net_worth)}</td>
                  <td className="px-4 py-3 text-slate-500">{h.note || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setConfirmId(h.id)} className="text-rose-500 hover:text-rose-400 transition-colors text-xs font-medium">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {assets.length === 0 && loans.length === 0 && bills.length === 0 && (
        <div className="text-center text-slate-500 mt-24">
          <p className="text-5xl mb-4">📊</p>
          <p className="text-lg font-bold text-slate-400">No financial data yet</p>
          <p className="text-sm mt-2 text-slate-500">Start by adding your assets, bills, and loans to track your wealth.</p>
        </div>
      )}

      {confirmId && (
        <ConfirmModal
          message="Delete this snapshot?"
          onConfirm={() => deleteSnapshot(confirmId)}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </div>
  )
}
