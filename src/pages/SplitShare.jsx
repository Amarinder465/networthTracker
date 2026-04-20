import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/format'

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
  return { net, settlements }
}

export default function SplitShare() {
  const { token } = useParams()
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [notFound, setNotFound]   = useState(false)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [claiming, setClaiming]   = useState(null)
  const [toggling, setToggling]   = useState(null)
  const [debugError, setDebugError] = useState(null)

  async function load() {
    const [rpcRes, authRes] = await Promise.all([
      supabase.rpc('get_shared_split', { p_token: token }),
      supabase.auth.getUser(),
    ])
    if (rpcRes.error) { setDebugError(rpcRes.error.message); setNotFound(true); setLoading(false); return }
    if (!rpcRes.data) { setNotFound(true); setLoading(false); return }
    setData(rpcRes.data)
    setCurrentUserId(authRes?.data?.user?.id ?? null)
    setLoading(false)
  }

  useEffect(() => { load() }, [token])

  async function claimPerson(personId) {
    if (!currentUserId || !data) return
    setClaiming(personId)
    await supabase.from('split_claims').insert({
      event_id: data.event.id,
      user_id: currentUserId,
      person_id: personId,
    })
    setClaiming(null)
    load()
  }

  async function togglePaid(personId, current) {
    setToggling(personId)
    await supabase.from('split_people').update({ paid: !current }).eq('id', personId)
    setToggling(null)
    load()
  }

  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">Loading…</div>
  if (notFound) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-center px-4">
      <p className="text-4xl mb-4">🔗</p>
      <p className="text-xl font-bold text-white">Link not found</p>
      <p className="text-gray-400 text-sm mt-2">This link may have been removed or reset.</p>
      {debugError && <p className="text-red-400 text-xs mt-3 font-mono">{debugError}</p>}
    </div>
  )

  const { event } = data
  const people   = data.people   ?? []
  const expenses = data.expenses ?? []
  const claims   = data.claims   ?? []
  const payer      = event.payer ?? ''
  const isCreator  = currentUserId && currentUserId === event.creator_id
  const isNightOut = event.type === 'night_out'
  const claimedPersonIds = (claims ?? []).map(c => c.person_id)
  const myClaimedPersonId = (claims ?? []).find(c => c.user_id === currentUserId)?.person_id

  // trip calculations
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const { settlements } = people.length > 0 ? calcSettlements(people, expenses) : { settlements: [] }
  const byCategory = expenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] ?? 0) + Number(e.amount); return acc }, {})

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between sticky top-0">
        <span className="text-base font-bold tracking-tight">💰 Wealth Tracker</span>
        {!currentUserId ? (
          <a href={`/auth?redirect=/split/share/${token}`} className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">Sign in to claim your share</a>
        ) : (
          <a href="/" className="text-xs text-gray-400 hover:text-white transition-colors">← Dashboard</a>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Event header */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{isNightOut ? 'Split the Bill' : 'Shared Expenses'}</p>
          <h1 className="text-2xl font-bold">{event.name}</h1>
          {event.destination && <p className="text-sm text-gray-400 mt-1">📍 {event.destination}</p>}
          {event.start_date && (
            <p className="text-sm text-gray-400 mt-0.5">
              🗓 {new Date(event.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {event.end_date ? ` → ${new Date(event.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
            </p>
          )}
          {payer && <p className="text-sm text-gray-400 mt-1">💳 Card holder: <span className="text-white font-medium">{payer}</span></p>}
          {isCreator && (
            <p className="text-xs text-brand-400 bg-brand-600/10 border border-brand-600/20 rounded-lg px-3 py-2 mt-3">
              ✓ You created this split — only you can mark people as paid.
            </p>
          )}
        </div>

        {/* ── NIGHT OUT VIEW ── */}
        {isNightOut && (
          <>
            {/* Who pays who */}
            {settlements.length === 0 && expenses.length > 0 ? (
              <div className="text-center text-brand-400 font-medium py-6">🎉 Everyone is settled!</div>
            ) : settlements.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">Who Pays Who</h2>
                {settlements.map((s, i) => {
                  const person     = people.find(p => p.name === s.from)
                  const isClaimed  = claimedPersonIds.includes(person?.id)
                  const isMyPerson = myClaimedPersonId === person?.id
                  const canClaim   = currentUserId && !isCreator && !myClaimedPersonId && person && !isClaimed
                  return (
                    <div key={i} className={`flex items-center justify-between px-5 py-3 gap-3 ${i < settlements.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${person?.paid ? 'bg-brand-600/20 text-brand-400' : 'bg-gray-800 text-gray-400'}`}>
                          {s.from[0].toUpperCase()}
                        </div>
                        <div className="text-sm">
                          <div className="flex items-center gap-1.5">
                            <span className={person?.paid ? 'line-through text-gray-500' : 'text-red-400 font-medium'}>{s.from}</span>
                            {isMyPerson && <span className="text-xs text-brand-400">← you</span>}
                          </div>
                          <p className="text-xs text-gray-500">→ {s.to}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`font-bold ${person?.paid ? 'line-through text-gray-500' : 'text-white'}`}>{formatCurrency(s.amount)}</span>
                        {isCreator ? (
                          <button
                            disabled={toggling === person?.id}
                            onClick={() => person && togglePaid(person.id, person.paid)}
                            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${person?.paid ? 'bg-brand-600/20 text-brand-400' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}
                          >
                            {toggling === person?.id ? '…' : person?.paid ? '✓ Paid' : 'Mark Paid'}
                          </button>
                        ) : person?.paid ? (
                          <span className="text-xs text-brand-400 font-medium">✓ Paid</span>
                        ) : canClaim ? (
                          <button
                            disabled={claiming === person.id}
                            onClick={() => claimPerson(person.id)}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                          >
                            {claiming === person.id ? '…' : 'This is me'}
                          </button>
                        ) : (
                          <span className="text-xs text-yellow-400">⏳ Pending</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* What Was Spent */}
            {expenses.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">What Was Spent</h2>
                {expenses.map((exp, i) => (
                  <div key={exp.id} className={`flex items-center justify-between px-5 py-3 gap-3 ${i < expenses.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{exp.description}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        💳 {exp.paid_by} · split {exp.involved?.length ?? 1} ways
                        {exp.involved?.length > 0 && <span className="text-gray-600"> ({(exp.involved ?? []).join(', ')})</span>}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm text-white">{formatCurrency(exp.amount)}</p>
                      <p className="text-xs text-gray-500">{formatCurrency(Number(exp.amount) / (exp.involved?.length ?? 1))} each</p>
                    </div>
                  </div>
                ))}
                <div className="px-5 py-3 border-t border-gray-800 flex justify-between items-center">
                  <span className="text-xs text-gray-400">Total</span>
                  <span className="font-bold text-brand-400">{formatCurrency(total)}</span>
                </div>
              </div>
            )}

            {/* Who Paid */}
            {people.filter(p => expenses.some(e => e.paid_by === p.name)).length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">Who Paid</h2>
                {people.filter(p => expenses.some(e => e.paid_by === p.name)).map((p, i, arr) => {
                  const paid = expenses.reduce((s, e) => e.paid_by === p.name ? s + Number(e.amount) : s, 0)
                  return (
                    <div key={p.id} className={`flex items-center justify-between px-5 py-3 ${i < arr.length - 1 ? 'border-b border-gray-800/60' : ''}`}>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-brand-600/20 text-brand-400 rounded-full flex items-center justify-center text-xs font-semibold">{p.name[0].toUpperCase()}</div>
                        <span className="text-sm text-white">{p.name}</span>
                      </div>
                      <span className="text-sm font-semibold text-brand-400">💳 {formatCurrency(paid)}</span>
                    </div>
                  )
                })}
              </div>
            )}

          </>
        )}

        {/* ── TRIP VIEW ── */}
        {!isNightOut && (
          <>
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
                      <p className="text-xs text-gray-600 mt-0.5">Split between: {(exp.involved ?? []).join(', ')}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm">{formatCurrency(exp.amount)}</p>
                      {exp.involved?.length > 0 && <p className="text-xs text-gray-500">{formatCurrency(Number(exp.amount) / exp.involved.length)} each</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {people.length > 0 && expenses.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <h2 className="px-5 py-3 border-b border-gray-800 font-semibold text-sm">Per Person</h2>
                {people.map((p, i) => {
                  const owes    = expenses.reduce((s, e) => e.involved?.includes(p.name) ? s + Number(e.amount) / e.involved.length : s, 0)
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
          </>
        )}
      </main>
    </div>
  )
}
