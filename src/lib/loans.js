import { supabase } from './supabase'

/**
 * Process auto-pay for any loans whose due_date has passed.
 *
 * For each overdue cycle on each loan:
 *   1. Compute interest = balance * (annual_rate / 100 / 12)
 *   2. Compute principal = piPayment - interest, capped at balance
 *      (final payment uses balance + interest as P&I instead of full piPayment)
 *   3. Insert a loan_payments row (payment_date = the due_date being paid,
 *      amount = P&I + escrow, note = 'Auto-pay')
 *   4. Update the loan: balance -= principal, due_date += 1 month
 *
 * Escrow (PMI / property tax / home insurance / HOA) passes through to the
 * payment row but does NOT reduce balance.
 *
 * Per-cycle writes are intentional: if the loan update fails, the next page
 * load picks up from the unchanged due_date and re-tries that cycle only —
 * the already-logged payment row stays. This is safer than batching writes
 * because a partial batch could double-charge on retry.
 *
 * @param {Array}  loans  - loans with at least: id, user_id, balance,
 *   interest_rate, min_payment, due_date, pmi, property_tax,
 *   home_insurance, hoa
 * @param {Date}   today  - reference "now" (driven by testDate in DEV)
 * @returns {Promise<{ processedByLoan: Object<string,number>, totalCycles: number }>}
 */
export async function processLoanAutoPay(loans, today) {
  const processedByLoan = {}
  let totalCycles = 0

  for (const loan of loans) {
    if (!loan.due_date || !loan.min_payment) continue
    if (Number(loan.balance) <= 0) continue

    let balance     = Number(loan.balance)
    let dueDate     = new Date(loan.due_date + 'T00:00:00')
    const rate      = Number(loan.interest_rate ?? 0)
    const piPayment = Number(loan.min_payment)
    const escrow    = Number(loan.pmi ?? 0)
                    + Number(loan.property_tax ?? 0)
                    + Number(loan.home_insurance ?? 0)
                    + Number(loan.hoa ?? 0)

    let cycles = 0

    while (dueDate < today && balance > 0) {
      const interest = Math.round(balance * (rate / 100 / 12) * 100) / 100

      // Final-payment guard: don't overpay principal past the remaining balance.
      let principal = piPayment - interest
      let piActual  = piPayment
      if (principal >= balance) {
        principal = balance
        piActual  = balance + interest
      }
      principal = Math.max(principal, 0)

      const newBalance  = Math.max(balance - principal, 0)
      const totalPaid   = piActual + escrow
      const paymentDate = dueDate.toISOString().split('T')[0]

      const nextDue = new Date(dueDate)
      nextDue.setMonth(nextDue.getMonth() + 1)
      const nextDueStr = nextDue.toISOString().split('T')[0]

      // 1) Log the auto-payment first.
      const { error: payErr } = await supabase.from('loan_payments').insert({
        user_id:       loan.user_id,
        loan_id:       loan.id,
        amount:        totalPaid,
        principal:     principal,
        interest:      interest,
        balance_after: newBalance,
        payment_date:  paymentDate,
        note:          'Auto-pay',
      })
      if (payErr) {
        console.error('[auto-pay] log failed for loan', loan.id, payErr)
        break
      }

      // 2) Advance the loan.
      const { error: loanErr } = await supabase.from('loans').update({
        balance:  newBalance,
        due_date: nextDueStr,
      }).eq('id', loan.id)
      if (loanErr) {
        console.error('[auto-pay] advance failed for loan', loan.id, loanErr)
        break
      }

      balance = newBalance
      dueDate = nextDue
      cycles++

      // Safety valve: if testDate is way in the future, cap at 60 cycles
      // (5 years) so an accidental click doesn't wipe a loan.
      if (cycles >= 60) break
    }

    if (cycles > 0) {
      processedByLoan[loan.id] = cycles
      totalCycles += cycles
    }
  }

  return { processedByLoan, totalCycles }
}
