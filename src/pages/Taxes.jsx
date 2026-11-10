import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { FILING_STATUSES, TAX_YEARS } from '../lib/taxTables'
import { estimateTaxes, summarizeJournal, effectiveIncome, retirementSavings, PAY_FREQUENCIES } from '../lib/taxCalc'

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = n => usd0.format(Math.round(n || 0))
const cents = n => usd2.format(n || 0)
const pct = n => `${(n * 100).toFixed(1)}%`

const thisYear = new Date().getFullYear()
const DEFAULT_YEAR = TAX_YEARS.includes(thisYear) ? thisYear : TAX_YEARS[0]

const EMPTY_PROFILE = {
  filingStatus: 'single',
  childrenUnder17: 0,
  otherDependents: 0,
  w2s: [],
  otherIncome: '',
  itemizedDeductions: '',
  fedEstimatedPayments: '',
  caEstimatedPayments: '',
  termOverrides: {},
  retirement: {
    age50: false,
    covered: false,
    spouseCovered: false,
    alreadyIra: '',
    tradIra: '',
    rothIra: '',
    extra401k: '',
  },
}

const RETIREMENT_MONEY_KEYS = ['alreadyIra', 'tradIra', 'rothIra', 'extra401k']

const W2_FIELDS = [
  { key: 'wages', box: '1', label: 'Wages, tips, other comp.' },
  { key: 'fedWithheld', box: '2', label: 'Federal tax withheld' },
  { key: 'stateWages', box: '16', label: 'State wages' },
  { key: 'stateWithheld', box: '17', label: 'State tax withheld' },
]

// Year-to-date boxes on a pay stub, then this paycheck's (for projecting).
const STUB_YTD_FIELDS = [
  { key: 'gross', label: 'Gross pay' },
  { key: 'fedTaxable', label: 'Fed. taxable wages', hint: 'Blank = gross' },
  { key: 'fedWithheld', label: 'Federal withheld' },
  { key: 'stateWithheld', label: 'CA withheld' },
  { key: 'sdi', label: 'CA SDI', hint: 'Not income tax' },
]
const STUB_CURRENT_FIELDS = [
  { key: 'curFedTaxable', label: 'Taxable wages' },
  { key: 'curFedWithheld', label: 'Federal withheld' },
  { key: 'curStateWithheld', label: 'CA withheld' },
]

const NUMBER_KEYS = ['wages', 'fedWithheld', 'stateWages', 'stateWithheld', 'gross', 'fedTaxable', 'sdi', 'curFedTaxable', 'curFedWithheld', 'curStateWithheld']

const newKey = () => Math.random().toString(36).slice(2, 10)
const blankDoc = (kind = 'w2') => ({
  key: newKey(),
  kind,
  employer: '',
  payDate: '',
  frequency: 'biweekly',
  stillEmployed: kind === 'stub',
  ...Object.fromEntries(NUMBER_KEYS.map(k => [k, ''])),
})
const toNum = v => {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const blankToNull = v => (v === '' || v == null ? null : toNum(v))
const showNum = v => (v == null ? '' : String(v))

// Postgres "relation does not exist" / PostgREST "not in schema cache".
const isMissingTable = e => Boolean(e) && (
  e.code === '42P01' || e.code === 'PGRST205' ||
  (/tax_profiles/.test(e.message ?? '') && /exist|schema cache/i.test(e.message ?? ''))
)

function fromRow(row) {
  if (!row) return { ...EMPTY_PROFILE }
  return {
    filingStatus: row.filing_status ?? 'single',
    childrenUnder17: row.dependents_under_17 ?? 0,
    otherDependents: row.other_dependents ?? 0,
    w2s: (row.w2s ?? []).map(w => ({
      ...blankDoc(w.kind === 'stub' ? 'stub' : 'w2'),
      key: w.key ?? newKey(),
      employer: w.employer ?? '',
      payDate: w.payDate ?? '',
      frequency: w.frequency ?? 'biweekly',
      stillEmployed: Boolean(w.stillEmployed),
      ...Object.fromEntries(NUMBER_KEYS.map(k => [k, showNum(w[k])])),
    })),
    otherIncome: row.other_income ? String(row.other_income) : '',
    itemizedDeductions: showNum(row.itemized_deductions),
    fedEstimatedPayments: row.fed_estimated_payments ? String(row.fed_estimated_payments) : '',
    caEstimatedPayments: row.ca_estimated_payments ? String(row.ca_estimated_payments) : '',
    termOverrides: row.term_overrides ?? {},
    retirement: {
      ...EMPTY_PROFILE.retirement,
      age50: Boolean(row.retirement?.age50),
      covered: Boolean(row.retirement?.covered),
      spouseCovered: Boolean(row.retirement?.spouseCovered),
      ...Object.fromEntries(RETIREMENT_MONEY_KEYS.map(k => [k, showNum(row.retirement?.[k])])),
    },
  }
}

function toRow(profile, year, userId) {
  return {
    user_id: userId,
    tax_year: year,
    filing_status: profile.filingStatus,
    dependents_under_17: Math.max(0, Math.floor(toNum(profile.childrenUnder17))),
    other_dependents: Math.max(0, Math.floor(toNum(profile.otherDependents))),
    w2s: profile.w2s.map(w => {
      const numbers = Object.fromEntries(
        NUMBER_KEYS.map(k => [k, blankToNull(w[k])]).filter(([, v]) => v != null),
      )
      return w.kind === 'stub'
        ? { key: w.key, kind: 'stub', employer: w.employer.trim(), payDate: w.payDate || null, frequency: w.frequency, stillEmployed: w.stillEmployed, ...numbers }
        : { key: w.key, kind: 'w2', employer: w.employer.trim(), ...numbers }
    }),
    other_income: toNum(profile.otherIncome),
    itemized_deductions: blankToNull(profile.itemizedDeductions),
    fed_estimated_payments: toNum(profile.fedEstimatedPayments),
    ca_estimated_payments: toNum(profile.caEstimatedPayments),
    term_overrides: profile.termOverrides,
    retirement: {
      age50: profile.retirement.age50,
      covered: profile.retirement.covered,
      spouseCovered: profile.retirement.spouseCovered,
      ...Object.fromEntries(RETIREMENT_MONEY_KEYS.map(k => [k, blankToNull(profile.retirement[k])]).filter(([, v]) => v != null)),
    },
  }
}

export default function Taxes() {
  const { user } = useAuth()
  const [year, setYear] = useState(DEFAULT_YEAR)
  const [profile, setProfile] = useState(EMPTY_PROFILE)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [saveState, setSaveState] = useState('idle') // idle | pending | saving | saved | error
  const [upload, setUpload] = useState(null) // { tone, text }
  const [reading, setReading] = useState(false)
  const [showTrades, setShowTrades] = useState(false)
  const fileRef = useRef(null)
  const edited = useRef(false)

  // ── Load the year's profile + journal ────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      edited.current = false
      const [profileRes, tradesRes] = await Promise.all([
        supabase.from('tax_profiles').select('*').eq('user_id', user.id).eq('tax_year', year).maybeSingle(),
        supabase.from('trades').select('id, profit_loss, notes, trade_date')
          .eq('user_id', user.id).gte('trade_date', `${year}-01-01`).lte('trade_date', `${year}-12-31`)
          .order('trade_date', { ascending: false }),
      ])
      if (cancelled) return
      if (profileRes.error && isMissingTable(profileRes.error)) setTableMissing(true)
      setProfile(fromRow(profileRes.error ? null : profileRes.data))
      setRows(tradesRes.data ?? [])
      setSaveState('idle')
      setUpload(null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [year, user.id])

  // ── Autosave (debounced) ──────────────────────────────────────────────────
  async function save(snapshot, forYear) {
    setSaveState('saving')
    const { error } = await supabase
      .from('tax_profiles')
      .upsert(toRow(snapshot, forYear, user.id), { onConflict: 'user_id,tax_year' })
    if (error) {
      if (isMissingTable(error)) setTableMissing(true)
      setSaveState('error')
    } else {
      setSaveState('saved')
    }
  }

  const pendingSave = useRef(null)
  useEffect(() => {
    if (!edited.current || tableMissing) return
    setSaveState('pending')
    const snapshot = profile
    const forYear = year
    const timer = setTimeout(() => { pendingSave.current = null; save(snapshot, forYear) }, 800)
    pendingSave.current = () => { clearTimeout(timer); return save(snapshot, forYear) }
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  async function changeYear(next) {
    if (next === year) return
    // Don't drop edits typed in the last moment before switching years.
    if (pendingSave.current) { const flush = pendingSave.current; pendingSave.current = null; await flush() }
    setYear(next)
  }

  function update(patch) {
    edited.current = true
    setProfile(p => ({ ...p, ...patch }))
  }

  function updateRetirement(patch) {
    update({ retirement: { ...profile.retirement, ...patch } })
  }

  function updateW2(key, patch) {
    update({ w2s: profile.w2s.map(w => (w.key === key ? { ...w, ...patch } : w)) })
  }

  function setTerm(trade, term) {
    const overrides = { ...profile.termOverrides }
    if (term === (trade.detected ?? 'short')) delete overrides[trade.id]
    else overrides[trade.id] = term
    update({ termOverrides: overrides })
  }

  // ── Upload (W-2 or pay stub) ──────────────────────────────────────────────
  async function readOne(file) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    if (!isPdf) {
      return { doc: blankDoc('w2'), tone: 'warn', text: `${file.name}: photos can't be read automatically, so type its numbers into the new card.` }
    }
    try {
      const { readTaxDocument } = await import('../lib/taxDocuments')
      const { kind, fields, hasText } = await readTaxDocument(file)
      const doc = blankDoc(kind)
      for (const [k, v] of Object.entries(fields)) doc[k] = typeof v === 'number' ? String(v) : v
      if (!hasText) {
        return { doc, tone: 'warn', text: `${file.name} is a scanned image with no text to read. Type its numbers into the new card.` }
      }
      if (kind === 'stub') {
        // A stub from the last ~6 weeks is probably a job you still have.
        const daysOld = doc.payDate ? (Date.now() - new Date(`${doc.payDate}T00:00:00`)) / 864e5 : Infinity
        doc.stillEmployed = daysOld >= 0 && daysOld <= 45
        const asOf = doc.payDate ? shortDate(doc.payDate) : 'its pay date'
        const wrongYear = doc.payDate && Number(doc.payDate.slice(0, 4)) !== year
        return {
          doc,
          tone: wrongYear ? 'warn' : 'ok',
          text: wrongYear
            ? `${file.name} is a pay stub from ${doc.payDate.slice(0, 4)}, not ${year}. Check the year before relying on it.`
            : `${file.name}: pay stub, year-to-date through ${asOf}. ${doc.stillEmployed ? 'Counted as a job you still have, so it\'s projected to Dec 31' : 'Counted as a job that ended, so the totals are used as they are'}. Check the numbers against the stub.`,
        }
      }
      const found = W2_FIELDS.filter(f => fields[f.key] != null).map(f => f.box)
      if (found.length === 0) {
        return { doc, tone: 'warn', text: `Couldn't find the box amounts in ${file.name}. Type them into the new card.` }
      }
      const missing = W2_FIELDS.filter(f => fields[f.key] == null).map(f => f.box)
      return {
        doc,
        tone: 'ok',
        text: `${file.name}: read W-2 box${found.length > 1 ? 'es' : ''} ${found.join(', ')}.${missing.length ? ` Fill in box${missing.length > 1 ? 'es' : ''} ${missing.join(', ')} yourself.` : ''} Check every number against your W-2.`,
      }
    } catch (err) {
      console.error('Tax document read failed', err)
      return { doc: blankDoc('w2'), tone: 'warn', text: `Couldn't open ${file.name} as a PDF. Type its numbers into the new card.` }
    }
  }

  async function onFiles(e) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (files.length === 0) return
    setReading(true)
    setUpload(null)
    const results = []
    for (const f of files) results.push(await readOne(f))
    update({ w2s: [...profile.w2s, ...results.map(r => r.doc)] })
    setUpload({
      tone: results.every(r => r.tone === 'ok') ? 'ok' : 'warn',
      lines: results.map(r => r.text),
    })
    setReading(false)
  }

  // ── Math ──────────────────────────────────────────────────────────────────
  const journal = useMemo(() => summarizeJournal(rows, profile.termOverrides), [rows, profile.termOverrides])
  const taxInput = useMemo(() => ({
    ...profile,
    shortTerm: journal.shortTerm,
    longTerm: journal.longTerm,
    interest: journal.interest,
    dividends: journal.dividends,
  }), [profile, journal])
  const est = useMemo(() => estimateTaxes(taxInput, year), [taxInput, year])
  const savings = useMemo(() => retirementSavings(taxInput, year), [taxInput, year])

  const fed = est.federal
  const ca = est.california
  const plan = est.retirement
  const sortedTrades = useMemo(() => [...journal.trades].sort((a, b) =>
    (a.detected ? 1 : 0) - (b.detected ? 1 : 0) || b.date.localeCompare(a.date)), [journal.trades])

  return (
    <div className="space-y-8 animate-fadeInUp">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white">Taxes</h1>
          <p className="text-cyan-400 font-medium mt-2">Federal + California estimate for {year}</p>
        </div>
        <div className="flex items-center gap-3">
          <SaveBadge state={tableMissing ? 'nosetup' : saveState} />
          <div className="flex gap-2">
            {TAX_YEARS.map(y => (
              <button
                key={y}
                onClick={() => changeYear(y)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  y === year ? 'bg-teal-600 text-white shadow-lg shadow-teal-500/25' : 'bg-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-700'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tableMissing && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <strong className="text-amber-100">Saving isn't set up yet.</strong> Run <code className="text-amber-100">supabase/tax_profiles.sql</code> in
          the Supabase SQL editor. Until then, the estimate works, but what you enter here is gone when you leave the page.
        </div>
      )}

      {loading ? (
        <div className="card text-center text-slate-400">⏳ Loading…</div>
      ) : (
        <>
          {/* Headline numbers */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Estimated tax" value={money(est.totalTax)} sub={`Federal ${money(fed.totalTax)} · CA ${money(ca.totalTax)}`} />
            <Stat label="Withheld & paid" value={money(est.totalPayments)} sub="Paycheck withholding + estimated payments" />
            <Stat
              label={est.balance >= 0 ? 'Estimated refund' : 'Estimated you owe'}
              value={money(Math.abs(est.balance))}
              color={est.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}
              sub={`Federal ${signed(fed.balance)} · CA ${signed(ca.balance)}`}
            />
            <Stat label="Effective rate" value={pct(est.effectiveRate)} sub={`Federal bracket ${pct(fed.marginalRate)} · CA ${pct(ca.marginalRate)}`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Inputs */}
            <div className="lg:col-span-3 space-y-6">
              {/* Household */}
              <section className="card space-y-4">
                <h2 className="text-lg font-bold text-white">Your household</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Filing status" className="sm:col-span-3">
                    <select
                      value={profile.filingStatus}
                      onChange={e => update({ filingStatus: e.target.value })}
                      className="input-field w-full text-sm"
                    >
                      {FILING_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Children under 17" hint="Child tax credit">
                    <input type="number" min="0" step="1" value={profile.childrenUnder17}
                      onChange={e => update({ childrenUnder17: e.target.value })} className="input-field w-full text-sm" />
                  </Field>
                  <Field label="Other dependents" hint="17+ or relatives">
                    <input type="number" min="0" step="1" value={profile.otherDependents}
                      onChange={e => update({ otherDependents: e.target.value })} className="input-field w-full text-sm" />
                  </Field>
                  <Field label="Other income" hint="1099, side work…">
                    <MoneyInput value={profile.otherIncome} onChange={v => update({ otherIncome: v })} />
                  </Field>
                </div>
              </section>

              {/* W-2s and pay stubs */}
              <section className="card space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-white">W-2s & pay stubs</h2>
                    <p className="text-xs text-slate-400 mt-1">PDFs are read on this device and never uploaded. Only the numbers below are saved.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => update({ w2s: [...profile.w2s, blankDoc('w2')] })} className="btn-secondary text-sm">
                      + W-2
                    </button>
                    <button onClick={() => update({ w2s: [...profile.w2s, blankDoc('stub')] })} className="btn-secondary text-sm">
                      + Pay stub
                    </button>
                    <button onClick={() => fileRef.current?.click()} disabled={reading} className="btn-primary text-sm disabled:opacity-60">
                      {reading ? 'Reading…' : '⬆ Upload PDF'}
                    </button>
                    <input ref={fileRef} type="file" multiple accept="application/pdf,.pdf,image/*" onChange={onFiles} className="hidden" data-testid="tax-doc-input" />
                  </div>
                </div>

                {upload && (
                  <div className={`text-sm rounded-lg px-3 py-2 space-y-1 ${upload.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/10 text-amber-200 border border-amber-500/30'}`}>
                    {upload.lines.map((line, i) => <p key={i}>{line}</p>)}
                  </div>
                )}

                {profile.w2s.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Nothing yet. Upload your W-2 (after year-end) or your latest pay stub from each job this year, or type the numbers in.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {profile.w2s.map((w, i) => {
                      const eff = effectiveIncome(w, year)
                      return (
                        <div key={w.key} className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3">
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md flex-shrink-0 ${w.kind === 'stub' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-purple-500/20 text-purple-300'}`}>
                              {w.kind === 'stub' ? 'Pay stub' : 'W-2'}
                            </span>
                            <input
                              value={w.employer}
                              onChange={e => updateW2(w.key, { employer: e.target.value })}
                              placeholder={`Employer ${i + 1}`}
                              className="input-field flex-1 min-w-0 text-sm font-semibold"
                            />
                            <button
                              onClick={() => update({ w2s: profile.w2s.filter(x => x.key !== w.key) })}
                              className="text-xs text-slate-500 hover:text-rose-400 px-2 py-1"
                            >
                              Remove
                            </button>
                          </div>

                          {w.kind === 'stub' ? (
                            <>
                              <div className="grid grid-cols-2 gap-3">
                                <Field label="Pay date">
                                  <input type="date" value={w.payDate} onChange={e => updateW2(w.key, { payDate: e.target.value })} className="input-field w-full text-sm" />
                                </Field>
                                <Field label="Paid">
                                  <select value={w.frequency} onChange={e => updateW2(w.key, { frequency: e.target.value })} className="input-field w-full text-sm">
                                    {PAY_FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                  </select>
                                </Field>
                              </div>
                              <p className="stat-label pt-1">Year to date</p>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
                                {STUB_YTD_FIELDS.map(f => (
                                  <Field key={f.key} label={f.label} hint={f.hint}>
                                    <MoneyInput value={w[f.key]} onChange={v => updateW2(w.key, { [f.key]: v })} />
                                  </Field>
                                ))}
                              </div>
                              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer pt-1">
                                <input
                                  type="checkbox"
                                  checked={w.stillEmployed}
                                  onChange={e => updateW2(w.key, { stillEmployed: e.target.checked })}
                                  className="w-4 h-4 accent-cyan-400"
                                />
                                I still work here — project the rest of {year}
                              </label>
                              {w.stillEmployed && (
                                <>
                                  <p className="stat-label">This paycheck <span className="normal-case tracking-normal font-normal text-slate-500">· repeated for each paycheck left</span></p>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    {STUB_CURRENT_FIELDS.map(f => (
                                      <Field key={f.key} label={f.label}>
                                        <MoneyInput value={w[f.key]} onChange={v => updateW2(w.key, { [f.key]: v })} />
                                      </Field>
                                    ))}
                                  </div>
                                </>
                              )}
                              <p className="text-xs text-slate-400 border-t border-slate-800 pt-2">
                                Counts as {money(eff.wages)} wages · {money(eff.fedWithheld)} federal withheld · {money(eff.stateWithheld)} CA withheld
                                {eff.projectedChecks > 0
                                  ? ` (year-to-date plus ${eff.projectedChecks} more paycheck${eff.projectedChecks === 1 ? '' : 's'} through Dec 31)`
                                  : w.stillEmployed ? ' (no paychecks left to project)' : ' (year-to-date, as is)'}
                              </p>
                            </>
                          ) : (
                            <div className="grid grid-cols-2 gap-3">
                              {W2_FIELDS.map(f => (
                                <Field key={f.key} label={`Box ${f.box}`} hint={f.label}>
                                  <MoneyInput value={w[f.key]} onChange={v => updateW2(w.key, { [f.key]: v })} />
                                </Field>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* Payments & deductions */}
              <section className="card space-y-4">
                <h2 className="text-lg font-bold text-white">Payments & deductions</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Federal estimated payments">
                    <MoneyInput value={profile.fedEstimatedPayments} onChange={v => update({ fedEstimatedPayments: v })} />
                  </Field>
                  <Field label="CA estimated payments">
                    <MoneyInput value={profile.caEstimatedPayments} onChange={v => update({ caEstimatedPayments: v })} />
                  </Field>
                  <Field label="Itemized deductions" hint="Blank = standard">
                    <MoneyInput value={profile.itemizedDeductions} onChange={v => update({ itemizedDeductions: v })} placeholder={money(fed.standard)} />
                  </Field>
                </div>
              </section>

              {/* Retirement contributions */}
              <section className="card space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Retirement contributions</h2>
                  <p className="text-xs text-slate-400 mt-1">
                    A Roth IRA doesn't lower this year's tax: the money goes in after tax and comes out tax-free later.
                    A traditional IRA and extra pre-tax 401(k) pay do lower it.
                  </p>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <Check checked={profile.retirement.age50} onChange={v => updateRetirement({ age50: v })}>
                    50 or older by Dec 31
                  </Check>
                  <Check checked={profile.retirement.covered} onChange={v => updateRetirement({ covered: v })}>
                    Covered by a workplace retirement plan
                    <span className="text-slate-500"> · box 13 on your W-2</span>
                  </Check>
                  {profile.filingStatus === 'mfj' && (
                    <Check checked={profile.retirement.spouseCovered} onChange={v => updateRetirement({ spouseCovered: v })}>
                      Spouse covered by a workplace plan
                    </Check>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                  <Field label={`IRA money already in for ${year}`} hint="Traditional + Roth">
                    <MoneyInput value={profile.retirement.alreadyIra} onChange={v => updateRetirement({ alreadyIra: v })} />
                  </Field>
                  <Field label="Add to a traditional IRA" hint={`By Apr 15, ${year + 1}`}>
                    <MoneyInput value={profile.retirement.tradIra} onChange={v => updateRetirement({ tradIra: v })} />
                  </Field>
                  <Field label="Add to a Roth IRA" hint="After tax">
                    <MoneyInput value={profile.retirement.rothIra} onChange={v => updateRetirement({ rothIra: v })} />
                  </Field>
                  <Field label="Extra pre-tax 401(k)" hint="Through payroll by Dec 31">
                    <MoneyInput value={profile.retirement.extra401k} onChange={v => updateRetirement({ extra401k: v })} />
                  </Field>
                </div>

                <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3 text-sm">
                  <p className="text-slate-300">
                    <strong className="text-white">{money(plan.room)}</strong> of IRA room left for {year} (limit {money(plan.iraLimit)},
                    shared by traditional and Roth; you can still contribute for {year} until Apr 15, {year + 1}).
                  </p>
                  <p className="text-xs text-slate-500">
                    Count only new contributions above. A rollover or transfer from another account doesn't use up room. If you're not sure
                    whether an IRA deposit this year was a {year} contribution, check the account's contribution summary before adding more.
                  </p>

                  <SavingsRow title="Traditional IRA" amount={savings.tradIra.total} detail={savings.tradIra}>
                    {plan.trad > 0 && plan.iraDeduction === 0 && plan.tradPhaseOut && (
                      <>Not deductible: you're covered at work and your income ({money(plan.magi)}) is above the {money(plan.tradPhaseOut[0])}–{money(plan.tradPhaseOut[1])} phase-out.</>
                    )}
                    {plan.trad > 0 && plan.iraDeduction > 0 && plan.iraDeduction < plan.trad && (
                      <>Only {money(plan.iraDeduction)} is deductible at your income ({money(plan.magi)}, phase-out {money(plan.tradPhaseOut[0])}–{money(plan.tradPhaseOut[1])}).</>
                    )}
                    {plan.trad > 0 && plan.iraDeduction === plan.trad && <>Fully deductible, federal and California.</>}
                    {plan.trad === 0 && plan.room > 0 && (
                      savings.maxTradIra.total > 0
                        ? <>Putting your {money(plan.room)} of room into a traditional IRA would save about {money(savings.maxTradIra.total)}.</>
                        : <>Not deductible at your income because you're covered by a workplace plan, so it wouldn't lower this year's tax.</>
                    )}
                  </SavingsRow>

                  <SavingsRow title="Extra pre-tax 401(k)" amount={savings.k401.total} detail={savings.k401}>
                    Lowers W-2 wages, federal and California. It has to come out of paychecks by Dec 31, so ask payroll to raise your pre-tax
                    deferral. The {year} limit is {money(plan.k401Limit)}, including what you've already put in.
                  </SavingsRow>

                  <SavingsRow title="Roth IRA" amount={0} zeroLabel="$0 this year">
                    No deduction now; it grows and comes out tax-free in retirement.{' '}
                    {plan.rothMax >= plan.iraLimit
                      ? <>At your income you can put in the full amount (phase-out {money(plan.rothPhaseOut[0])}–{money(plan.rothPhaseOut[1])}).</>
                      : plan.rothMax > 0
                        ? <>Your income limits it to {money(plan.rothMax)} (phase-out {money(plan.rothPhaseOut[0])}–{money(plan.rothPhaseOut[1])}).</>
                        : <>Your income is above the {money(plan.rothPhaseOut[0])}–{money(plan.rothPhaseOut[1])} phase-out, so you can't contribute directly.</>}
                  </SavingsRow>

                  {plan.overRoom && (
                    <p className="text-amber-300 text-xs">
                      Your traditional + Roth amounts are more than the {money(plan.room)} of room left. Only that much is counted.
                    </p>
                  )}
                  {plan.over401k && (
                    <p className="text-amber-300 text-xs">The extra 401(k) is capped at the {money(plan.k401Limit)} limit.</p>
                  )}
                </div>
              </section>

              {/* Journal */}
              <section className="card space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-white">From your trade journal</h2>
                  <p className="text-xs text-slate-400 mt-1">Pulled from the {year} entries on the Trading tab.</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Mini label="Short-term" value={journal.shortTerm} />
                  <Mini label="Long-term" value={journal.longTerm} />
                  <Mini label="Dividends" value={journal.dividends} />
                  <Mini label="Interest" value={journal.interest} />
                </div>
                {fed.capital.carryover > 0 && (
                  <p className="text-xs text-slate-400">
                    Net capital loss: {money(fed.capital.deductibleLoss)} offsets other income this year; {money(fed.capital.carryover)} carries over to next year.
                  </p>
                )}
                {journal.tradeCount > 0 && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-slate-300">
                        {journal.tradeCount} closed trade{journal.tradeCount === 1 ? '' : 's'}.
                        {journal.unknownCount > 0 && (
                          <span className="text-amber-300"> {journal.unknownCount} have no buy date in their notes, so they count as short-term.</span>
                        )}
                      </p>
                      <button onClick={() => setShowTrades(s => !s)} className="btn-secondary text-xs">
                        {showTrades ? 'Hide' : 'Review'} holding periods
                      </button>
                    </div>
                    {showTrades && (
                      <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1">
                        {sortedTrades.map(t => (
                          <div key={t.id} className="flex items-center gap-3 rounded-lg bg-slate-900/50 border border-slate-800 px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-slate-300 truncate">
                                <span className="text-slate-500 mr-2">{shortDate(t.date)}</span>
                                {t.notes.split(' · ').slice(0, 2).join(' · ')}
                              </p>
                              <p className={`text-xs font-semibold ${t.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {t.amount >= 0 ? '+' : ''}{cents(t.amount)}
                                {!t.detected && <span className="ml-2 font-normal text-amber-300/80">no buy date</span>}
                                {t.overridden && <span className="ml-2 font-normal text-cyan-300/80">changed by you</span>}
                              </p>
                            </div>
                            <div className="flex rounded-lg overflow-hidden border border-slate-700 text-[11px] font-semibold flex-shrink-0">
                              {['short', 'long'].map(term => (
                                <button
                                  key={term}
                                  onClick={() => setTerm(t, term)}
                                  className={`px-2.5 py-1 ${t.term === term ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                >
                                  {term === 'short' ? 'Short' : 'Long'}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>

            {/* Breakdown */}
            <div className="lg:col-span-2 space-y-6">
              <section className="card space-y-3">
                <h2 className="text-lg font-bold text-white">Federal</h2>
                <Line label="Wages" value={fed.grossWages} />
                {fed.wageReduction > 0 && <Line label="Extra pre-tax 401(k)" value={-fed.wageReduction} />}
                {fed.other !== 0 && <Line label="Other income" value={fed.other} />}
                <Line label="Short-term gains" value={fed.capital.ordinaryGain} />
                <Line label="Long-term gains" value={fed.capital.preferentialGain} />
                {fed.capital.deductibleLoss > 0 && <Line label="Capital loss deduction" value={-fed.capital.deductibleLoss} />}
                <Line label="Dividends + interest" value={journal.dividends + journal.interest} />
                {fed.iraDeduction > 0 && <Line label="Traditional IRA deduction" value={-fed.iraDeduction} />}
                <Line label="Adjusted gross income" value={fed.agi} strong />
                <Line label={fed.usedItemized ? 'Itemized deductions' : 'Standard deduction'} value={-fed.deduction} />
                <Line label="Taxable income" value={fed.taxable} strong />
                <Divider />
                <Line label="Tax on ordinary income" value={fed.ordinaryTax} />
                <Line label="Tax on long-term gains" value={fed.capitalGainsTax} />
                {fed.nonrefundable > 0 && <Line label="Child & dependent credits" value={-fed.nonrefundable} />}
                {fed.niit > 0 && <Line label="Net investment income tax (3.8%)" value={fed.niit} />}
                <Line label="Federal tax" value={fed.totalTax} strong />
                <Line label="Withheld from pay" value={-fed.withheld} />
                {fed.estimatedPayments > 0 && <Line label="Estimated payments" value={-fed.estimatedPayments} />}
                {fed.refundable > 0 && <Line label="Refundable child credit" value={-fed.refundable} />}
                <Result balance={fed.balance} />
              </section>

              <section className="card space-y-3">
                <h2 className="text-lg font-bold text-white">California</h2>
                <Line label="Wages" value={ca.grossWages} />
                {ca.wageReduction > 0 && <Line label="Extra pre-tax 401(k)" value={-ca.wageReduction} />}
                {ca.other !== 0 && <Line label="Other income" value={ca.other} />}
                <Line label="Capital gains (taxed as income)" value={ca.capital.includedInIncome} />
                <Line label="Dividends + interest" value={journal.dividends + journal.interest} />
                {ca.iraDeduction > 0 && <Line label="Traditional IRA deduction" value={-ca.iraDeduction} />}
                <Line label="CA adjusted gross income" value={ca.agi} strong />
                <Line label="Standard deduction" value={-ca.deduction} />
                <Line label="Taxable income" value={ca.taxable} strong />
                <Divider />
                <Line label="Tax" value={ca.baseTax} />
                <Line label="Exemption credits" value={-ca.credits} />
                {ca.bhst > 0 && <Line label="Behavioral health tax (1% over $1M)" value={ca.bhst} />}
                <Line label="California tax" value={ca.totalTax} strong />
                <Line label="Withheld from pay" value={-ca.withheld} />
                {ca.estimatedPayments > 0 && <Line label="Estimated payments" value={-ca.estimatedPayments} />}
                <Result balance={ca.balance} />
              </section>

              <p className="text-xs leading-relaxed text-slate-500">
                <strong className="text-slate-400">Estimate only, not tax advice.</strong> Uses {year} IRS brackets and FTB's {year} California
                schedules{ca.phaseOutProjected ? ' (the exemption-credit phase-out start is projected until FTB publishes it)' : ''}. It doesn't
                include AMT, the 0.9% additional Medicare tax, wash sales, lower rates on qualified dividends (all dividends are taxed as ordinary
                income, which can overstate the bill), California's exemption for U.S. Treasury interest, or the newer tips, overtime and senior
                deductions. California always uses its standard deduction here. Pay stubs for a job you still have are projected to Dec 31 by
                repeating the latest paycheck, so a raise, bonus or W-4 change will move the real numbers. CA SDI is shown on stubs but isn't
                income tax, so it's left out of the math.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function signed(n) {
  if (Math.abs(n) < 0.5) return 'even'
  return n >= 0 ? `refund ${money(n)}` : `owe ${money(-n)}`
}

function shortDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function Field({ label, hint, className = '', children }) {
  return (
    <label className={`block ${className}`}>
      <span className="stat-label block mb-1.5">
        {label}
        {hint && <span className="normal-case tracking-normal font-normal text-slate-500"> · {hint}</span>}
      </span>
      {children}
    </label>
  )
}

function MoneyInput({ value, onChange, placeholder = '0.00' }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">$</span>
      <input
        type="number"
        step="0.01"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder.replace(/^\$/, '')}
        className="input-field w-full text-sm pl-7"
      />
    </div>
  )
}

function Check({ checked, onChange, children }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-4 h-4 accent-cyan-400" />
      <span>{children}</span>
    </label>
  )
}

function SavingsRow({ title, amount, detail, zeroLabel, children }) {
  const saves = amount > 0.5
  return (
    <div className="border-t border-slate-800 pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-white">{title}</span>
        <span className={`font-bold tabular-nums ${saves ? 'text-emerald-400' : 'text-slate-400'}`}>
          {saves ? `saves ${money(amount)}` : (zeroLabel ?? 'saves $0')}
        </span>
      </div>
      {saves && detail && (
        <p className="text-xs text-slate-500 mt-0.5">{money(detail.federal)} federal · {money(detail.california)} California</p>
      )}
      <p className="text-xs text-slate-400 mt-1">{children}</p>
    </div>
  )
}

function Stat({ label, value, sub, color = 'text-slate-100' }) {
  return (
    <div className="card-stat">
      <p className="stat-label">{label}</p>
      <p className={`text-2xl sm:text-3xl font-bold mt-2 ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-1.5">{sub}</p>}
    </div>
  )
}

function Mini({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-900/50 border border-slate-800 px-3 py-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-sm font-bold ${value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{cents(value)}</p>
    </div>
  )
}

function Line({ label, value, strong = false }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-sm ${strong ? 'font-semibold text-white' : 'text-slate-300'}`}>
      <span className={strong ? '' : 'text-slate-400'}>{label}</span>
      <span className="tabular-nums">{value < 0 ? `−${money(-value)}` : money(value)}</span>
    </div>
  )
}

function Divider() {
  return <div className="border-t border-slate-700/50 my-1" />
}

function Result({ balance }) {
  const refund = balance >= 0
  return (
    <div className={`flex items-baseline justify-between rounded-lg px-3 py-2 mt-1 ${refund ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
      <span className={`text-sm font-semibold ${refund ? 'text-emerald-300' : 'text-rose-300'}`}>{refund ? 'Estimated refund' : 'Estimated you owe'}</span>
      <span className={`text-lg font-bold tabular-nums ${refund ? 'text-emerald-400' : 'text-rose-400'}`}>{money(Math.abs(balance))}</span>
    </div>
  )
}

function SaveBadge({ state }) {
  const map = {
    idle: null,
    pending: ['text-slate-400', 'Unsaved…'],
    saving: ['text-slate-400', 'Saving…'],
    saved: ['text-emerald-400', '✓ Saved'],
    error: ['text-rose-400', 'Couldn’t save'],
    nosetup: ['text-amber-300', 'Not saving'],
  }
  const entry = map[state]
  if (!entry) return null
  return <span className={`text-xs font-semibold ${entry[0]}`}>{entry[1]}</span>
}
