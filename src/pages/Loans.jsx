import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrency, formatDate } from '../lib/format'
import Modal from '../components/Modal'

const CATEGORIES = ['Mortgage', 'Auto', 'Student', 'Personal', 'Credit Card', 'Medical', 'Business', 'Other']

const EMPTY = {
  name: '', lender: '', category: 'Personal', balance: '', original_balance: '',
  interest_rate: '', min_payment: '', term_months: '', start_date: '', due_date: '', notes: '',
  pmi: '', property_tax: '', home_insurance: '', hoa: '',
}
const EMPTY_PAYMENT = { amount: '', note: '', payment_date: new Date().toISOString().split('T')[0] }

function calcAmortization(balance, interestRate, piPayment) {
  if (!interestRate) return { interest: 0, principal: piPayment, newBalance: Math.max(balance - piPayment, 0) }
  const interest  = Math.round(balance * (interestRate / 100 / 12) * 100) / 100
  const principal = Math.min(piPayment - interest, balance)
  return { interest, principal, newBalance: Math.max(balance - principal, 0) }
}

// Months remaining based on start date + original term (matches lender schedule)
function calcMonthsRemainingFromStart(startDate, termMonths) {
  if (!startDate || !termMonths) return null
  const start = new Date(startDate + 'T00:00:00')
  const now   = new Date()
  const elapsed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  return Math.max(termMonths - elapsed, 0)
}

function isMortgage(category) { return category === 'Mortgage' }

export default function Loans() {
  const { user } = useAuth()
  const [loans, setLoans]             = useState([])
  const [payments, setPayments]       = useState({})
  const [loading, setLoading]         = useState(true)
  const [modal, setModal]             = useState(false)
  const [payModal, setPayModal]       = useState(null)
  const [histModal, setHistModal]     = useState(null)
  const [form, setForm]               = useState(EMPTY)
  const [payForm, setPayForm]         = useState(EMPTY_PAYMENT)
  const [editing, setEditing]         = useState(null)
  const [saving, setSaving]           = useState(false)
  const [savedMonths, setSavedMonths] = useState(null)
  const [unlockDates, setUnlockDates] = useState(false)

  async function load() {
    const { data } = await supabase.from('loans').select('*').eq('user_id', user.id).order('balance', { ascending: false })
    setLoans(data ?? [])
    setLoading(false)
  }

  async function loadPayments(loanId) {
    const { data } = await supabase.from('loan_payments').select('*').eq('loan_id', loanId).order('payment_date', { ascending: false })
    setPayments(p => ({ ...p, [loanId]: data ?? [] }))
  }

  useEffect(() => { load() }, [])

  function openNew()   { setForm(EMPTY); setEditing(null); setUnlockDates(false); setModal(true) }
  function openEdit(l) {
    setForm({
      name: l.name, lender: l.lender ?? '', category: l.category,
      balance: l.balance, original_balance: l.original_balance ?? '',
      interest_rate: l.interest_rate ?? '', min_payment: l.min_payment ?? '',
      term_months: l.term_months ?? '', start_date: l.start_date ?? '',
      due_date: l.due_date ?? '', notes: l.notes ?? '',
      pmi: l.pmi ?? '', property_tax: l.property_tax ?? '', home_insurance: l.home_insurance ?? '', hoa: l.hoa ?? '',
    })
    setEditing(l.id); setUnlockDates(false); setModal(true)
  }

  function openPay(l) {
    // Pre-fill with full monthly payment (P&I + escrow) for display, but only P&I reduces balance
    const total = Number(l.min_payment ?? 0) + Number(l.pmi ?? 0) + Number(l.property_tax ?? 0) + Number(l.home_insurance ?? 0) + Number(l.hoa ?? 0)
    setPayModal(l)
    setPayForm({ ...EMPTY_PAYMENT, amount: total || (l.min_payment ?? '') })
  }
  async function openHist(l) { await loadPayments(l.id); setHistModal(l) }

  async function save() {
    if (!form.name || !form.lender || !form.balance || !form.original_balance || !form.interest_rate || !form.min_payment || !form.term_months || (!editing && (!form.start_date || !form.due_date))) return
    setSaving(true)
    const payload = {
      name: form.name, lender: form.lender || null, category: form.category,
      balance: Number(form.balance),
      original_balance: form.original_balance ? Number(form.original_balance) : Number(form.balance),
      interest_rate:  form.interest_rate  ? Number(form.interest_rate)  : null,
      min_payment:    form.min_payment    ? Number(form.min_payment)    : null,
      term_months:    form.term_months    ? Number(form.term_months)    : null,
      pmi:            form.pmi            ? Number(form.pmi)            : null,
      property_tax:   form.property_tax   ? Number(form.property_tax)   : null,
      home_insurance: form.home_insurance ? Number(form.home_insurance) : null,
      hoa:            form.hoa            ? Number(form.hoa)            : null,
      notes: form.notes, user_id: user.id,
      ...(!editing || unlockDates ? { start_date: form.start_date || null, due_date: form.due_date || null } : {}),
    }
    if (editing) await supabase.from('loans').update(payload).eq('id', editing)
    else         await supabase.from('loans').insert(payload)
    setSaving(false); setModal(false); load()
  }

  async function makePayment() {
    if (!payForm.amount || !payModal) return
    setSaving(true)

    // Only P&I (min_payment) reduces the balance — escrow doesn't
    const piPayment = Number(payModal.min_payment ?? payForm.amount)
    const { interest, principal, newBalance } = calcAmortization(Number(payModal.balance), Number(payModal.interest_rate), piPayment)

    const oldMonths  = calcMonthsRemainingFromStart(payModal.start_date, payModal.term_months)
    const newMonths  = oldMonths ? Math.max(oldMonths - 1, 0) : null
    const monthsSaved = null // lump sum month savings handled separately below

    let nextDueDate = null
    if (payModal.due_date) {
      const d = new Date(payModal.due_date + 'T00:00:00')
      d.setMonth(d.getMonth() + 1)
      nextDueDate = d.toISOString().split('T')[0]
    }

    // If lump sum (paid more than P&I), extra principal reduces balance further
    const totalPaid   = Number(payForm.amount)
    const escrow      = Number(payModal.pmi ?? 0) + Number(payModal.property_tax ?? 0) + Number(payModal.home_insurance ?? 0) + Number(payModal.hoa ?? 0)
    const extraPrincipal = Math.max(totalPaid - piPayment - escrow, 0)
    const finalBalance   = Math.max(newBalance - extraPrincipal, 0)

    await supabase.from('loans').update({
      balance: finalBalance,
      ...(nextDueDate && { due_date: nextDueDate }),
    }).eq('id', payModal.id)

    await supabase.from('loan_payments').insert({
      user_id: user.id, loan_id: payModal.id,
      amount: totalPaid, principal: principal + extraPrincipal, interest,
      balance_after: finalBalance,
      payment_date: payForm.payment_date,
      note: payForm.note || null,
    })

    setSaving(false); setPayModal(null)
    if (extraPrincipal > 0 && oldMonths) {
      const actualNewMonths = calcMonthsRemainingFromStart(payModal.start_date, payModal.term_months)
      const saved = oldMonths - (actualNewMonths ?? oldMonths)
      if (saved > 0) setSavedMonths({ name: payModal.name, months: saved, newMonths: actualNewMonths })
    }
    load()
  }

  async function remove(id) {
    if (!confirm('Delete this loan?')) return
    await supabase.from('loans').delete().eq('id', id)
    load()
  }

  async function toggleNetWorth(l) {
    await supabase.from('loans').update({ include_in_net_worth: !l.include_in_net_worth }).eq('id', l.id)
    setLoans(prev => prev.map(x => x.id === l.id ? { ...x, include_in_net_worth: !l.include_in_net_worth } : x))
  }

  const totalDebt    = loans.reduce((s, l) => s + Number(l.balance), 0)
  const totalMonthly = loans.reduce((s, l) =>
    s + Number(l.min_payment ?? 0) + Number(l.pmi ?? 0) + Number(l.property_tax ?? 0) + Number(l.home_insurance ?? 0) + Number(l.hoa ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Loans</h1>
          <p className="text-gray-400 text-sm mt-0.5">Total debt: {formatCurrency(totalDebt)} · Monthly payments: {formatCurrency(totalMonthly)}/mo</p>
        </div>
        <button onClick={openNew} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">+ Add Loan</button>
      </div>

      {loading ? <p className="text-gray-400">Loading…</p> : loans.length === 0 ? (
        <div className="text-center text-gray-500 mt-20">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-lg font-medium">No loans yet</p>
          <p className="text-sm mt-1">Add mortgages, car loans, student loans, credit cards, and more.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {loans.map(l => {
            const progress    = l.original_balance ? Math.round((1 - Number(l.balance) / Number(l.original_balance)) * 100) : null
            const monthsLeft  = calcMonthsRemainingFromStart(l.start_date, l.term_months)
            const escrow      = Number(l.pmi ?? 0) + Number(l.property_tax ?? 0) + Number(l.home_insurance ?? 0) + Number(l.hoa ?? 0)
            const totalMonthlyPayment = Number(l.min_payment ?? 0) + escrow
            const mortgage    = isMortgage(l.category)
            return (
              <div key={l.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-base">{l.name}</span>
                      <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{l.category}</span>
                      {l.lender && <span className="text-xs text-gray-500">{l.lender}</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-gray-400">
                      {l.interest_rate && <span>{l.interest_rate}% APR</span>}
                      {l.term_months   && <span>Term: {l.term_months} mo</span>}
                      {monthsLeft !== null && <span className="text-white font-medium">Remaining: {monthsLeft} mo</span>}
                      {l.due_date      && <span>Due: {formatDate(l.due_date)}</span>}
                    </div>

                    {/* Mortgage payment breakdown */}
                    {mortgage && (
                      <div className="mt-3 grid grid-cols-2 sm:flex sm:flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 bg-gray-800/50 rounded-xl px-3 py-2">
                        {l.min_payment    && <span>P&I: <span className="text-white">{formatCurrency(l.min_payment)}</span></span>}
                        {l.pmi            && <span>PMI: <span className="text-white">{formatCurrency(l.pmi)}</span></span>}
                        {l.property_tax   && <span>Tax: <span className="text-white">{formatCurrency(l.property_tax)}</span></span>}
                        {l.home_insurance && <span>Insurance: <span className="text-white">{formatCurrency(l.home_insurance)}</span></span>}
                        {l.hoa            && <span>HOA: <span className="text-white">{formatCurrency(l.hoa)}</span></span>}
                        <span className="text-yellow-400 font-medium">Total: {formatCurrency(totalMonthlyPayment)}/mo</span>
                      </div>
                    )}

                    {/* Non-mortgage min payment */}
                    {!mortgage && l.min_payment && (
                      <div className="mt-1 text-sm text-gray-400">Min: {formatCurrency(l.min_payment)}/mo</div>
                    )}

                    {progress !== null && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>{progress}% paid off</span>
                          <span>{formatCurrency(l.balance)} remaining</span>
                        </div>
                        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="sm:text-right shrink-0">
                    <p className="text-xl font-bold text-red-400">{formatCurrency(l.balance)}</p>
                    <div className="flex gap-2 mt-2 flex-wrap items-center sm:justify-end">
                      <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none" title="Include in net worth">
                        <input type="checkbox" checked={l.include_in_net_worth ?? true} onChange={() => toggleNetWorth(l)} className="w-3.5 h-3.5 accent-green-500 cursor-pointer" />
                        Net Worth
                      </label>
                      <button onClick={() => openPay(l)}  className="bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">💳 Pay</button>
                      <button onClick={() => openHist(l)} className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">History</button>
                      <button onClick={() => openEdit(l)} className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">Edit</button>
                      <button onClick={() => remove(l.id)} className="bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">Delete</button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit Loan Modal */}
      {modal && (
        <Modal title={editing ? 'Edit Loan' : 'Add Loan'} onClose={() => setModal(false)}>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <Field label="Name" required><input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Car Loan" /></Field>
            <Field label="Lender" required><input required value={form.lender} onChange={e => setForm(f => ({ ...f, lender: e.target.value }))} placeholder="e.g. Wells Fargo" /></Field>
            <Field label="Category" required><select required value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Current Balance ($)" required><input required type="number" min="0" step="0.01" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} placeholder="0.00" /></Field>
            <Field label="Original Balance ($)" required><input required type="number" min="0" step="0.01" value={form.original_balance} onChange={e => setForm(f => ({ ...f, original_balance: e.target.value }))} placeholder="0.00" /></Field>
            <Field label="Interest Rate %" required><input required type="number" min="0" step="0.001" value={form.interest_rate} onChange={e => setForm(f => ({ ...f, interest_rate: e.target.value }))} placeholder="e.g. 3.75" /></Field>
            <Field label={isMortgage(form.category) ? "P&I Payment ($/mo) — principal & interest only" : "Min Monthly Payment ($)"} required>
              <input required type="number" min="0" step="0.01" value={form.min_payment} onChange={e => setForm(f => ({ ...f, min_payment: e.target.value }))} placeholder="0.00" />
            </Field>
            {isMortgage(form.category) && (
              <>
                <Field label="PMI ($/mo) (optional)"><input type="number" min="0" step="0.01" value={form.pmi} onChange={e => setForm(f => ({ ...f, pmi: e.target.value }))} placeholder="0.00" /></Field>
                <Field label="Property Tax ($/mo) (optional)"><input type="number" min="0" step="0.01" value={form.property_tax} onChange={e => setForm(f => ({ ...f, property_tax: e.target.value }))} placeholder="0.00" /></Field>
                <Field label="Home Insurance ($/mo) (optional)"><input type="number" min="0" step="0.01" value={form.home_insurance} onChange={e => setForm(f => ({ ...f, home_insurance: e.target.value }))} placeholder="0.00" /></Field>
                <Field label="HOA ($/mo) (optional)"><input type="number" min="0" step="0.01" value={form.hoa} onChange={e => setForm(f => ({ ...f, hoa: e.target.value }))} placeholder="0.00" /></Field>
              </>
            )}
            <Field label="Term (months)" required><input required type="number" min="1" value={form.term_months} onChange={e => setForm(f => ({ ...f, term_months: e.target.value }))} placeholder="e.g. 360" /></Field>
            {!editing && <Field label="Start Date" required><input required type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></Field>}
            {!editing && <Field label="First Due Date" required><input required type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></Field>}
            {editing && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Date Fields</span>
                  <button type="button" onClick={() => setUnlockDates(v => !v)} className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors">
                    {unlockDates ? '🔓 Click to lock' : '🔒 Locked — click to edit'}
                  </button>
                </div>
                {unlockDates ? (
                  <div className="space-y-3 pt-1">
                    <p className="text-xs text-yellow-400">⚠️ Only change these if you made a mistake. Due date auto-updates after payments.</p>
                    <Field label="Start Date"><input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></Field>
                    <Field label="Next Due Date"><input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></Field>
                  </div>
                ) : (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-gray-400">Start Date</span><span>{formatDate(form.start_date) || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Next Due Date</span><span>{formatDate(form.due_date) || '—'}</span></div>
                  </div>
                )}
              </div>
            )}
            <Field label="Notes (optional)"><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any notes…" /></Field>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setModal(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Make a Payment Modal */}
      {payModal && (() => {
        const escrow   = Number(payModal.pmi ?? 0) + Number(payModal.property_tax ?? 0) + Number(payModal.home_insurance ?? 0)
        const piAmt    = Number(payModal.min_payment ?? payForm.amount)
        const mortgage = isMortgage(payModal.category)
        const { interest, principal, newBalance } = payForm.amount && Number(payForm.amount) > 0
          ? calcAmortization(Number(payModal.balance), Number(payModal.interest_rate), piAmt)
          : { interest: 0, principal: 0, newBalance: Number(payModal.balance) }
        const extraPrincipal = payForm.amount ? Math.max(Number(payForm.amount) - piAmt - escrow, 0) : 0
        const finalBalance   = Math.max(newBalance - extraPrincipal, 0)
        return (
          <Modal title={`Pay — ${payModal.name}`} onClose={() => setPayModal(null)}>
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-xl p-4 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-400">Current balance</span><span className="font-semibold">{formatCurrency(payModal.balance)}</span></div>
                {payModal.interest_rate && <div className="flex justify-between"><span className="text-gray-400">Interest rate</span><span>{payModal.interest_rate}%</span></div>}
                {mortgage && (
                  <>
                    {payModal.min_payment    && <div className="flex justify-between"><span className="text-gray-400">P&I</span><span>{formatCurrency(payModal.min_payment)}</span></div>}
                    {payModal.pmi            && <div className="flex justify-between"><span className="text-gray-400">PMI</span><span>{formatCurrency(payModal.pmi)}</span></div>}
                    {payModal.property_tax   && <div className="flex justify-between"><span className="text-gray-400">Property Tax</span><span>{formatCurrency(payModal.property_tax)}</span></div>}
                    {payModal.home_insurance && <div className="flex justify-between"><span className="text-gray-400">Home Insurance</span><span>{formatCurrency(payModal.home_insurance)}</span></div>}
                    {payModal.hoa            && <div className="flex justify-between"><span className="text-gray-400">HOA</span><span>{formatCurrency(payModal.hoa)}</span></div>}
                    <div className="flex justify-between font-medium border-t border-gray-700 pt-1 mt-1"><span className="text-gray-400">Total Monthly</span><span>{formatCurrency(piAmt + escrow)}</span></div>
                  </>
                )}
                {!mortgage && payModal.min_payment && <div className="flex justify-between"><span className="text-gray-400">Min payment</span><span>{formatCurrency(payModal.min_payment)}</span></div>}
              </div>

              {payForm.amount && Number(payForm.amount) > 0 && (
                <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-gray-400">Goes to interest</span><span className="text-red-400">{formatCurrency(interest)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Goes to principal</span><span className="text-brand-400">{formatCurrency(principal)}</span></div>
                  {mortgage && escrow > 0 && <div className="flex justify-between"><span className="text-gray-400">Escrow (tax/ins/pmi/hoa)</span><span className="text-gray-300">{formatCurrency(escrow)}</span></div>}
                  {extraPrincipal > 0 && <div className="flex justify-between"><span className="text-gray-400">Extra principal</span><span className="text-brand-400">+{formatCurrency(extraPrincipal)}</span></div>}
                  <div className="flex justify-between font-semibold border-t border-gray-700 pt-1 mt-1"><span className="text-gray-400">New balance</span><span>{formatCurrency(finalBalance)}</span></div>
                </div>
              )}

              <Field label="Total Payment Amount ($)"><input type="number" min="0" step="0.01" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" autoFocus /></Field>
              <Field label="Payment Date"><input type="date" value={payForm.payment_date} onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))} /></Field>
              <Field label="Note (optional)"><input value={payForm.note} onChange={e => setPayForm(f => ({ ...f, note: e.target.value }))} placeholder="e.g. Lump sum payment" /></Field>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setPayModal(null)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">Cancel</button>
                <button onClick={makePayment} disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">{saving ? 'Processing…' : 'Make Payment'}</button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* Months saved toast */}
      {savedMonths && (
        <div className="fixed bottom-6 right-6 z-50 bg-brand-600 text-white px-5 py-4 rounded-2xl shadow-2xl max-w-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold">🎉 {savedMonths.months} month{savedMonths.months > 1 ? 's' : ''} ahead of schedule!</p>
              <p className="text-sm text-brand-100 mt-0.5">{savedMonths.name} — {savedMonths.newMonths} months remaining</p>
            </div>
            <button onClick={() => setSavedMonths(null)} className="text-brand-200 hover:text-white text-lg leading-none mt-0.5">✕</button>
          </div>
        </div>
      )}

      {/* Payment History Modal */}
      {histModal && (
        <Modal title={`Payment History — ${histModal.name}`} onClose={() => setHistModal(null)}>
          <div className="max-h-[60vh] overflow-y-auto">
            {!payments[histModal.id] ? (
              <p className="text-gray-400 text-sm">Loading…</p>
            ) : payments[histModal.id].length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-6">No payments recorded yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-left">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium text-right">Amount</th>
                    <th className="pb-2 font-medium text-right">Principal</th>
                    <th className="pb-2 font-medium text-right">Interest</th>
                    <th className="pb-2 font-medium text-right">Balance After</th>
                  </tr>
                </thead>
                <tbody>
                  {payments[histModal.id].map(p => (
                    <tr key={p.id} className="border-b border-gray-800/60">
                      <td className="py-2 text-gray-300">{formatDate(p.payment_date)}</td>
                      <td className="py-2 text-right font-medium">{formatCurrency(p.amount)}</td>
                      <td className="py-2 text-right text-brand-400">{formatCurrency(p.principal)}</td>
                      <td className="py-2 text-right text-red-400">{formatCurrency(p.interest)}</td>
                      <td className="py-2 text-right text-gray-300">{formatCurrency(p.balance_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
