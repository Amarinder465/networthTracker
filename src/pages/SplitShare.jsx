import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/format'

function calcSettlements(people, expenses, payer) {
  const net = {}
  people.forEach(p => { net[p.name] = 0 })

  expenses.forEach(exp => {
    if (!exp.involved.length) return
    const share = Number(exp.amount) / exp.involved.length
    net[payer] = (net[payer] ?? 0) + Number(exp.amount)
    exp.involved.forEach(name => {
      net[name] = (net[name] ?? 0) - share
    })
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
    c[i].amount -= amt
    d[j].amount -= amt
    if (c[i].amount < 0.01) i++
    if (d[j].amount < 0.01) j++
  }

  return { net, settlements }
}

export default function SplitShare() {
  const { token } = useParams()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: result } = await supabase.rpc('get_shared_split', { p_token: token })
      if (!result) { setNotFound(true); setLoading(false); return }
      setData(result)
      setLoading(false)
    }
    load()
  }, [token])

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">Loading…</div>
  )

  if (notFound) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-center px-4">
      <p className="text-4xl mb-4">🔗</p>
      <p className="text-xl font-bold text-white">Link not found</p>
      <p className="text-gray-400 text-sm mt-2">This link may have been removed or reset.</p>
    </div>
  )

  const { event, people, expenses } = data
  const payer = event.payer ?? ''
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const { settlements } = payer ? calcSettlements(people, expenses, payer) : { settlements: [] }

  const byCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + Number(e.amount)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between sticky top-0">
        <span className="text-base font-bold tracking-tight">💰 Wealth Tracker</span>
        <a
          href="/"
          className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
        >
          Get the app →
        </a>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Event title */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Shared Expenses</p>
          <h1 className="text-2xl font-bold">{event.name}</h1>
          {event.destination && <p className="text-sm text-gray-400 mt-1">📍 {event.destination}</p>}
          {event.start_date && (
            <p className="text-sm text-gray-400 mt-0.5">
              🗓 {new Date(event.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {event.end_date ? ` → ${new Date(event.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
            </p>
          )}
          {payer && (
            <p className="text-sm text-gray-400 mt-1">💳 Card holder: <span className="text-white font-medium">{payer}</span></p>
          )}
        </div>

        {/* Category totals */}
        {Object.keys(byCategory).length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
              <div key={cat} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <p className="text-xs text-gray-400">{cat}</p>
                <p className="text-white font-semibold text-sm mt-0.5">{formatCurrency(amt)}</p>
              </div>
            ))}
            <div className="bg-gray-900 border border-brand-600/30 rounded-xl p-3">
              <p className="text-xs text-gray-400">Total</p>
              <p className="text-brand-400 font-semibold text-sm mt-0.5">{formatCurrency(total)}</p>
            </div>
          </div>
        )}

        {/* Expenses */}
        {expenses.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">Expenses</h2>
            {expenses.map((exp, i) => (
              <div key={exp.id} className={`flex items-start justify-between px-5 py-3 gap-3 ${i < expenses.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{exp.description}</span>
                    <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{exp.category}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">Split between: {exp.involved.join(', ')}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-sm">{formatCurrency(exp.amount)}</p>
                  <p className="text-xs text-gray-500">{formatCurrency(Number(exp.amount) / exp.involved.length)} each</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Per person */}
        {people.length > 0 && expenses.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">Per Person</h2>
            {people.map((p, i) => {
              const owes    = expenses.reduce((s, e) => e.involved.includes(p.name) ? s + Number(e.amount) / e.involved.length : s, 0)
              const isPayer = p.name === payer
              const balance = isPayer ? total - owes : -owes
              return (
                <div key={p.id} className={`flex items-center justify-between px-5 py-3 ${i < people.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-brand-600/20 text-brand-400 rounded-full flex items-center justify-center text-xs font-semibold">{p.name[0].toUpperCase()}</div>
                    <span className="text-sm">{p.name}</span>
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
        )}

        {/* Settlements */}
        {settlements.length === 0 && expenses.length > 0 ? (
          <div className="text-center text-brand-400 font-medium text-sm py-4">🎉 Everyone is settled!</div>
        ) : settlements.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">Who Pays Who</h2>
            {settlements.map((s, i) => (
              <div key={i} className={`flex items-center justify-between px-5 py-3 ${i < settlements.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
                <div className="text-sm">
                  <span className="text-red-400 font-medium">{s.from}</span>
                  <span className="text-gray-500 mx-2">→</span>
                  <span className="text-brand-400 font-medium">{s.to}</span>
                </div>
                <span className="font-bold text-white">{formatCurrency(s.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
