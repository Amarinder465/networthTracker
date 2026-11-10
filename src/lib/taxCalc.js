// Tax estimate engine for the Taxes tab. Pure functions only — no React,
// no Supabase — so the math can be checked on its own.
//
// It is an ESTIMATE. Left out on purpose (the page says so too): AMT, the
// additional 0.9% Medicare tax, wash sales, qualified-dividend rates (all
// dividends are taxed as ordinary income, which can only overstate the bill),
// California's exemption for Treasury interest, QBI, self-employment tax and
// the One Big Beautiful Bill tips / overtime / senior deductions.

import {
  federalTable, californiaTable, FEDERAL_FIXED, CALIFORNIA_FIXED,
} from './taxTables.js'

const round2 = n => Math.round(n * 100) / 100
const num = v => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// ── Trade journal → tax buckets ─────────────────────────────────────────────

const INCOME_PREFIX = /^(Interest|Dividends)\s*·/i

// "4/6/26" → Date. Two-digit years are 20xx.
function parseShortDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s.trim())
  if (!m) return null
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  return new Date(year, Number(m[1]) - 1, Number(m[2]))
}

// Held "more than one year" = sold after the first anniversary of the buy.
function isLongTerm(bought, sold) {
  const anniversary = new Date(bought.getFullYear() + 1, bought.getMonth(), bought.getDate())
  return sold > anniversary
}

// Reads the holding period out of a journal note, e.g.
//   "TSLA · 33 sh · bought 4/6/26–4/14/26 for $11,641.11 → sold 4/15/26 for …"
//   "ARM $110 Call · bought 4/17/24 for $274.03 → expired worthless 4/19/24"
// When the buy is a date range, the LATEST buy decides: if even the newest
// lot was held over a year the whole sale is long-term; otherwise it is
// counted short-term (a mixed sale is reported as short — the cautious side).
// Returns { term: 'short'|'long'|null, bought, sold } — null when the note has
// no buy date to go on.
export function detectTerm(notes, tradeDate) {
  const text = notes ?? ''
  const buy = /bought\s+(\d{1,2}\/\d{1,2}\/\d{2,4})(?:\s*[–-]\s*(\d{1,2}\/\d{1,2}\/\d{2,4}))?/i.exec(text)
  if (!buy) return { term: null, bought: null, sold: null }
  const sale = /(?:sold|expired worthless|expired)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(text)
  const bought = parseShortDate(buy[2] ?? buy[1])
  const sold = sale ? parseShortDate(sale[1]) : new Date(`${tradeDate}T00:00:00`)
  if (!bought || !sold) return { term: null, bought: null, sold: null }
  return { term: isLongTerm(bought, sold) ? 'long' : 'short', bought, sold }
}

// Splits a year's journal rows into what the tax return cares about.
// `overrides` is { [tradeId]: 'short' | 'long' } saved on the tax profile.
export function summarizeJournal(rows, overrides = {}) {
  const out = {
    shortTerm: 0, longTerm: 0, interest: 0, dividends: 0,
    trades: [], unknownCount: 0, tradeCount: 0,
  }
  for (const row of rows) {
    const amount = num(row.profit_loss)
    const notes = row.notes ?? ''
    if (INCOME_PREFIX.test(notes)) {
      if (/^Interest/i.test(notes)) out.interest += amount
      else out.dividends += amount
      continue
    }
    const detected = detectTerm(notes, row.trade_date)
    const override = overrides[row.id]
    const term = override ?? detected.term ?? 'short'
    if (!detected.term && !override) out.unknownCount++
    if (term === 'long') out.longTerm += amount
    else out.shortTerm += amount
    out.tradeCount++
    out.trades.push({
      id: row.id,
      date: row.trade_date,
      amount,
      notes,
      term,
      detected: detected.term,
      overridden: Boolean(override) && override !== detected.term,
    })
  }
  for (const k of ['shortTerm', 'longTerm', 'interest', 'dividends']) out[k] = round2(out[k])
  return out
}

// ── Shared pieces ───────────────────────────────────────────────────────────

export function bracketTax(income, brackets) {
  let tax = 0
  let lower = 0
  for (const [upper, rate] of brackets) {
    if (income <= lower) break
    tax += (Math.min(income, upper) - lower) * rate
    lower = upper
  }
  return tax
}

function marginalRate(income, brackets) {
  for (const [upper, rate] of brackets) {
    if (income <= upper) return rate
  }
  return brackets[brackets.length - 1][1]
}

// Schedule D netting: short and long net against each other, a net loss is
// capped at the annual limit, and only a net long-term gain gets the
// preferential rate.
function netCapitalGains(shortTerm, longTerm, lossLimit) {
  let ordinaryGain = 0
  let preferentialGain = 0
  let deductibleLoss = 0
  let carryover = 0
  const total = shortTerm + longTerm
  if (total >= 0) {
    if (longTerm >= 0 && shortTerm >= 0) { ordinaryGain = shortTerm; preferentialGain = longTerm }
    else if (longTerm >= 0) { preferentialGain = total }          // short loss eats the long gain
    else { ordinaryGain = total }                                   // long loss eats the short gain
  } else {
    deductibleLoss = Math.min(-total, lossLimit)
    carryover = -total - deductibleLoss
  }
  return {
    ordinaryGain, preferentialGain, deductibleLoss, carryover,
    includedInIncome: total >= 0 ? total : -deductibleLoss,
  }
}

// ── Federal ─────────────────────────────────────────────────────────────────

function federalEstimate(input, year) {
  const t = federalTable(year)
  const fs = input.filingStatus
  const wages = input.w2s.reduce((s, w) => s + num(w.wages), 0)
  const withheld = input.w2s.reduce((s, w) => s + num(w.fedWithheld), 0)
  const other = num(input.otherIncome)
  const cg = netCapitalGains(input.shortTerm, input.longTerm, FEDERAL_FIXED.capitalLossLimit[fs])

  const agi = wages + other + input.interest + input.dividends + cg.includedInIncome
  const standard = t.standardDeduction[fs]
  const itemized = num(input.itemizedDeductions)
  const deduction = Math.max(standard, itemized)
  const taxable = Math.max(0, agi - deduction)

  // Qualified Dividends and Capital Gain Tax Worksheet: ordinary income fills
  // the brackets first; the long-term gain stacks on top at 0/15/20%.
  const preferential = Math.min(cg.preferentialGain, taxable)
  const ordinaryTaxable = taxable - preferential
  const ordinaryTax = bracketTax(ordinaryTaxable, t.brackets[fs])
  const { zeroTo, fifteenTo } = t.capitalGains[fs]
  const atZero = Math.max(0, Math.min(preferential, zeroTo - ordinaryTaxable))
  const atFifteen = Math.max(0, Math.min(preferential - atZero, fifteenTo - ordinaryTaxable - atZero))
  const atTwenty = preferential - atZero - atFifteen
  const capitalGainsTax = atFifteen * 0.15 + atTwenty * 0.20
  const incomeTax = ordinaryTax + capitalGainsTax

  // Child tax credit + credit for other dependents, phased out together by
  // $50 for each $1,000 (or part) of AGI over the threshold.
  const kids = Math.max(0, Math.floor(num(input.childrenUnder17)))
  const others = Math.max(0, Math.floor(num(input.otherDependents)))
  const fullCredit = kids * t.childTaxCredit + others * t.otherDependentCredit
  const overBy = agi - FEDERAL_FIXED.childCreditPhaseOutStart[fs]
  const phaseOut = overBy > 0 ? Math.ceil(overBy / 1000) * 50 : 0
  const credit = Math.max(0, fullCredit - phaseOut)
  const nonrefundable = Math.min(credit, incomeTax)
  // Additional child tax credit: the unused child part comes back as a refund,
  // up to the refundable cap per child and 15% of earned income over $2,500.
  const childShare = fullCredit > 0 ? credit * (kids * t.childTaxCredit) / fullCredit : 0
  const unusedChild = Math.max(0, childShare - Math.min(childShare, incomeTax))
  const refundable = Math.min(unusedChild, kids * t.refundableChildCredit, Math.max(0, (wages - 2500) * 0.15))

  // Net investment income tax.
  const investmentIncome = Math.max(0, input.interest + input.dividends + cg.includedInIncome)
  const niitBase = Math.min(investmentIncome, Math.max(0, agi - FEDERAL_FIXED.niitThreshold[fs]))
  const niit = niitBase * FEDERAL_FIXED.niitRate

  const totalTax = Math.max(0, incomeTax - nonrefundable) + niit
  const payments = withheld + num(input.fedEstimatedPayments) + refundable

  return {
    wages, other, agi, standard, itemized, deduction,
    usedItemized: itemized > standard, taxable,
    ordinaryTaxable, preferential, ordinaryTax, capitalGainsTax, incomeTax,
    credit, creditPhaseOut: Math.min(phaseOut, fullCredit), nonrefundable, refundable,
    niit, totalTax, withheld, estimatedPayments: num(input.fedEstimatedPayments), payments,
    balance: payments - totalTax, // > 0 refund, < 0 owed
    marginalRate: marginalRate(ordinaryTaxable, t.brackets[fs]),
    capital: cg,
  }
}

// ── California ──────────────────────────────────────────────────────────────

function californiaEstimate(input, year) {
  const t = californiaTable(year)
  const fs = input.filingStatus
  // Box 16 when the W-2 has it; otherwise fall back to federal wages.
  const wages = input.w2s.reduce((s, w) => s + (num(w.stateWages) || num(w.wages)), 0)
  const withheld = input.w2s.reduce((s, w) => s + num(w.stateWithheld), 0)
  const other = num(input.otherIncome)
  const cg = netCapitalGains(input.shortTerm, input.longTerm, CALIFORNIA_FIXED.capitalLossLimit[fs])

  // California taxes every gain, dividend and interest dollar as ordinary income.
  const agi = wages + other + input.interest + input.dividends + cg.includedInIncome
  const deduction = t.standardDeduction[fs]
  const taxable = Math.max(0, agi - deduction)
  const baseTax = bracketTax(taxable, t.brackets[fs])

  const kids = Math.max(0, Math.floor(num(input.childrenUnder17)))
  const others = Math.max(0, Math.floor(num(input.otherDependents)))
  const dependents = kids + others
  const personalCount = fs === 'mfj' ? 2 : 1
  const fullCredit = t.personalCredit[fs] + dependents * t.dependentCredit
  const over = agi - t.creditPhaseOutStart[fs]
  const steps = over > 0 ? Math.ceil(over / CALIFORNIA_FIXED.creditPhaseOutStep[fs]) : 0
  const reduction = steps * CALIFORNIA_FIXED.creditPhaseOutPerStep * (personalCount + dependents)
  const credits = Math.min(Math.max(0, fullCredit - reduction), baseTax)

  const bhst = Math.max(0, taxable - CALIFORNIA_FIXED.bhstThreshold) * CALIFORNIA_FIXED.bhstRate
  const totalTax = Math.max(0, baseTax - credits) + bhst
  const payments = withheld + num(input.caEstimatedPayments)

  return {
    wages, other, agi, deduction, taxable, baseTax, credits, bhst, totalTax,
    withheld, estimatedPayments: num(input.caEstimatedPayments), payments,
    balance: payments - totalTax,
    marginalRate: marginalRate(taxable, t.brackets[fs]),
    phaseOutProjected: t.creditPhaseOutProjected,
    capital: cg,
  }
}

// ── Pay stubs → year-end wages ──────────────────────────────────────────────

export const PAY_FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'monthly', label: 'Monthly' },
]

// Paychecks still to come after `payDate` (YYYY-MM-DD) through Dec 31.
export function remainingPaychecks(payDate, frequency, year) {
  if (!payDate) return 0
  const d = new Date(`${payDate}T00:00:00`)
  if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) return 0
  const end = new Date(year, 11, 31)
  const days = Math.round((end - d) / 864e5)
  if (days <= 0) return 0
  switch (frequency) {
    case 'weekly': return Math.floor(days / 7)
    case 'biweekly': return Math.floor(days / 14)
    case 'semimonthly': {
      let n = 0
      for (let m = d.getMonth(); m <= 11; m++) {
        for (const day of [15, new Date(year, m + 1, 0).getDate()]) {
          if (new Date(year, m, day) > d) n++
        }
      }
      return n
    }
    case 'monthly': return 11 - d.getMonth()
    default: return 0
  }
}

// What one income document counts as for the year. A W-2 is taken as is. A
// pay stub's year-to-date totals are used as is for a job that has ended, or
// projected to Dec 31 with this paycheck's amounts for a job that hasn't.
export function effectiveIncome(doc, year) {
  if (doc.kind !== 'stub') {
    return {
      wages: num(doc.wages),
      fedWithheld: num(doc.fedWithheld),
      stateWages: num(doc.stateWages) || num(doc.wages),
      stateWithheld: num(doc.stateWithheld),
      projectedChecks: 0,
    }
  }
  const ytdWages = num(doc.fedTaxable) || num(doc.gross)
  const n = doc.stillEmployed ? remainingPaychecks(doc.payDate, doc.frequency, year) : 0
  const perCheck = num(doc.curFedTaxable)
  return {
    wages: ytdWages + n * perCheck,
    fedWithheld: num(doc.fedWithheld) + n * num(doc.curFedWithheld),
    stateWages: ytdWages + n * perCheck,
    stateWithheld: num(doc.stateWithheld) + n * num(doc.curStateWithheld),
    projectedChecks: n,
  }
}

// input: { filingStatus, childrenUnder17, otherDependents, w2s: [W-2s and
//          pay stubs], otherIncome, itemizedDeductions, fedEstimatedPayments,
//          caEstimatedPayments, shortTerm, longTerm, interest, dividends }
export function estimateTaxes(rawInput, year) {
  const input = { ...rawInput, w2s: (rawInput.w2s ?? []).map(d => effectiveIncome(d, year)) }
  const federal = federalEstimate(input, year)
  const california = californiaEstimate(input, year)
  const totalTax = federal.totalTax + california.totalTax
  const grossIncome = Math.max(0, federal.agi)
  return {
    federal,
    california,
    totalTax,
    totalPayments: federal.payments + california.payments,
    balance: federal.balance + california.balance,
    effectiveRate: grossIncome > 0 ? totalTax / grossIncome : 0,
  }
}
