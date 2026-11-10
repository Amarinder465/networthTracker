// Reads a W-2 or a pay stub PDF, entirely in the browser.
//
// The file never leaves the device and is never stored: we pull the text
// layer with pdf.js and pick out a handful of dollar amounts. Identifiers on
// the page (SSN, EIN, employee ID, bank accounts) are never read into the
// result. Everything comes back as a suggestion for the review form; the
// user confirms or fixes it.
//
// Scanned (image-only) documents have no text layer, so they come back empty
// and the page asks for manual entry.

const MONEY = /^\$?\s*-?\d{1,3}(?:,?\d{3})*\.\d{2}$/
const NUMERIC = /^\$?\s*-?[\d,]*\.?\d+$/
const toNumber = s => parseFloat(s.replace(/[$,\s]/g, ''))
const clean = s => s.replace(/\s+/g, ' ').trim()

// ── W-2 ─────────────────────────────────────────────────────────────────────

const W2_FIELDS = [
  { key: 'wages', label: s => /wages,?\s*tips/i.test(s) && !/state|local|medicare|social/i.test(s) },
  { key: 'fedWithheld', label: s => /federal\s+income\s+tax\s+withheld/i.test(s) },
  { key: 'stateWages', label: s => /state\s+wages/i.test(s) },
  { key: 'stateWithheld', label: s => /state\s+income\s+tax/i.test(s) },
]

const EMPLOYER_LABEL = /employer['’]?s\s+name/i
const NOT_A_NAME = /employer|address|zip\s*code|identification|number|^\W*$|^[\d\s-]+$|^[a-f]$/i

// items: [{ str, x, y }] in PDF space (y grows upward). Pure — testable in Node.
export function extractW2Fields(items) {
  const texts = items.filter(i => i.str && i.str.trim())
  const money = texts.filter(i => MONEY.test(i.str.trim()))

  // Score every (field, label, amount) pairing: the amount should sit just
  // below its label (or on the same line to the right), lined up with it.
  const pairs = []
  for (const field of W2_FIELDS) {
    for (const label of texts.filter(t => field.label(t.str))) {
      for (const m of money) {
        const dy = label.y - m.y
        const dx = m.x - label.x
        if (dy < -3 || dy > 45 || dx < -30 || dx > 180) continue
        pairs.push({ field: field.key, item: m, score: Math.abs(dy) + 0.3 * Math.abs(dx) })
      }
    }
  }
  pairs.sort((a, b) => a.score - b.score)

  // Greedy: best pairing first, and no amount may answer two boxes.
  const result = {}
  const used = new Set()
  for (const p of pairs) {
    if (p.field in result || used.has(p.item)) continue
    result[p.field] = toNumber(p.item.str)
    used.add(p.item)
  }

  // Employer: the first line of text under "Employer's name, address…".
  let best = null
  for (const label of texts.filter(t => EMPLOYER_LABEL.test(t.str))) {
    for (const t of texts) {
      const dy = label.y - t.y
      const dx = t.x - label.x
      if (dy < 2 || dy > 40 || dx < -20 || dx > 250) continue
      if (NOT_A_NAME.test(t.str.trim()) || MONEY.test(t.str.trim())) continue
      const score = dy + 0.1 * Math.abs(dx)
      if (!best || score < best.score) best = { score, str: clean(t.str) }
    }
  }
  if (best) result.employer = best.str

  return result
}

// ── Pay stub ────────────────────────────────────────────────────────────────
// Stubs put each item on one line — label, then (hours/rate), current amount,
// year-to-date amount — so the YTD figure is the last dollar amount on the
// label's line, before the next column's text starts.

const STUB_FIELDS = {
  gross: /^(gross\s+(pay|earnings|wages)|total\s+gross(\s+pay)?)$/i,
  fedTaxable: /^fed(eral)?\.?\s+taxable(\s+(gross|wages|income|earnings))?:?$/i,
  fedWithheld: /^(fitw|fed(eral)?\.?\s+(withholding|income\s+tax|w\/?h|wh)|federal\s+income\s+tax)$/i,
  stateWithheld: /^(ca|sitw|ca\s+(withholding|sitw|w\/?h|wh|income\s+tax|state\s+(income\s+)?tax)|state\s+income\s+tax)$/i,
  sdi: /^(casdi(-e)?|ca\s*sdi(\/?ee)?|ca\s+oasdi(\/?ee)?|ca\s+vpdi|sdi)$/i,
}

const STUB_SIGNAL = /earnings\s+statement|pay\s*(stub|statement)|direct\s+deposit\s+advice|net\s+pay|pay\s+period/i
const EMPLOYER_HINT = /\b(LLP|LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Company|Co\.|Law|Group|P\.?C\.|Ltd\.?|Partners)(?=\W|$)/i

// Dollar amounts to the right of `label` on the same line, stopping at the
// next piece of text (the neighboring column).
function lineAmounts(label, texts) {
  const row = texts
    .filter(t => t !== label && Math.abs(t.y - label.y) <= 2.5 && t.x > label.x)
    .sort((a, b) => a.x - b.x)
  const amounts = []
  for (const t of row) {
    const s = t.str.trim()
    if (MONEY.test(s)) amounts.push(toNumber(s))
    else if (!NUMERIC.test(s)) break // hours / rates are numeric: skip them
  }
  return amounts
}

// "October 30, 2026" | "10/30/2026" → "2026-10-30"
function parseDate(s) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  const d = m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : new Date(s)
  if (Number.isNaN(d.getTime())) return null
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const DATE_TEXT = /\d{1,2}\/\d{1,2}\/\d{4}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/i

// The date printed after a label: same line to the right, or just below.
function dateNear(label, texts) {
  const candidates = texts
    .filter(t => t !== label && DATE_TEXT.test(t.str))
    .map(t => ({ t, dy: label.y - t.y, dx: t.x - label.x }))
    .filter(c => (Math.abs(c.dy) <= 2.5 && c.dx > 0 && c.dx < 200) || (c.dy > 2.5 && c.dy < 16 && Math.abs(c.dx) < 60))
    .sort((a, b) => (Math.abs(a.dy) + a.dx * 0.1) - (Math.abs(b.dy) + b.dx * 0.1))
  return candidates[0]?.t.str ?? null
}

function inferFrequency(beginIso, endIso) {
  if (!beginIso || !endIso) return null
  const b = new Date(`${beginIso}T00:00:00`)
  const e = new Date(`${endIso}T00:00:00`)
  const days = Math.round((e - b) / 864e5) + 1
  const lastDay = new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate()
  if ((b.getDate() === 1 && e.getDate() === 15) || (b.getDate() === 16 && e.getDate() === lastDay)) return 'semimonthly'
  if (days <= 8) return 'weekly'
  if (days <= 15) return 'biweekly'
  if (days <= 17) return 'semimonthly'
  return 'monthly'
}

export function extractPayStubFields(items) {
  const texts = items.filter(i => i.str && i.str.trim())
  if (!texts.some(t => STUB_SIGNAL.test(t.str))) return null

  const result = {}
  for (const [key, re] of Object.entries(STUB_FIELDS)) {
    const rows = texts
      .filter(t => re.test(clean(t.str)))
      .map(t => lineAmounts(t, texts))
      .filter(a => a.length > 0)
    if (rows.length === 0) continue
    // YTD is the largest year-to-date figure across repeats of the label (a
    // "current" section and a "YTD" section both say "Gross Pay").
    const ytds = rows.map(a => a[a.length - 1])
    const ytd = Math.max(...ytds)
    const best = rows[ytds.indexOf(ytd)]
    const smaller = ytds.filter(v => v < ytd)
    const current = smaller.length ? Math.max(...smaller) : best.length > 1 ? best[best.length - 2] : null
    result[key] = { ytd, current }
  }

  // A lone "Fed Taxable Income 2,825.68" in a header box is this period's
  // figure, not year-to-date. Real YTD taxable wages can't be a small slice of
  // YTD gross.
  if (result.fedTaxable && result.gross && result.fedTaxable.ytd < 0.25 * result.gross.ytd) {
    result.fedTaxable = { ytd: null, current: result.fedTaxable.ytd }
  }

  const find = re => texts.find(t => re.test(clean(t.str)))
  const checkLabel = find(/^(check|pay)\s+date:?$/i)
  const payDate = checkLabel ? parseDate(dateNear(checkLabel, texts) ?? '') : null

  let begin = null
  let end = null
  const periodLabel = find(/^pay\s+period:?$/i)
  const periodText = periodLabel ? texts.find(t => Math.abs(t.y - periodLabel.y) <= 2.5 && t.x > periodLabel.x && /\d.*[-–].*\d/.test(t.str)) : null
  if (periodText) {
    const [a, b] = periodText.str.split(/\s*[-–]\s*(?=\d{1,2}\/)/)
    begin = parseDate(a ?? '')
    end = parseDate(b ?? '')
  } else {
    const bl = find(/^period\s+(beginning|begin|start(ing)?):?$/i)
    const el = find(/^period\s+(ending|end):?$/i)
    if (bl) begin = parseDate(dateNear(bl, texts) ?? '')
    if (el) end = parseDate(dateNear(el, texts) ?? '')
  }

  const employerItem = [...texts]
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .find(t => EMPLOYER_HINT.test(t.str) && !/statement|negotiable|deposit|^\s*dba\b|\d{5}/i.test(t.str))

  return {
    employer: employerItem ? clean(employerItem.str) : undefined,
    payDate: payDate ?? undefined,
    frequency: inferFrequency(begin, end) ?? undefined,
    gross: result.gross?.ytd ?? undefined,
    fedTaxable: result.fedTaxable?.ytd ?? undefined,
    fedWithheld: result.fedWithheld?.ytd ?? undefined,
    stateWithheld: result.stateWithheld?.ytd ?? undefined,
    sdi: result.sdi?.ytd ?? undefined,
    curFedTaxable: result.fedTaxable?.current ?? result.gross?.current ?? undefined,
    curFedWithheld: result.fedWithheld?.current ?? undefined,
    curStateWithheld: result.stateWithheld?.current ?? undefined,
  }
}

// Drops undefined/null so callers can count what was found.
const compact = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null))

// ── Loader ──────────────────────────────────────────────────────────────────

async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

// Returns { kind: 'w2' | 'stub', fields, hasText }.
export async function readTaxDocument(file) {
  const pdfjs = await loadPdfJs()
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise
  const pages = doc.numPages
  let best = { kind: 'w2', fields: {} }
  let hasText = false
  try {
    for (let p = 1; p <= Math.min(pages, 6); p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const items = content.items
        .filter(i => typeof i.str === 'string')
        .map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5] }))
      if (items.some(i => i.str.trim())) hasText = true

      const stub = extractPayStubFields(items)
      const stubFields = stub ? compact(stub) : {}
      const w2Fields = compact(extractW2Fields(items))
      const stubScore = ['gross', 'fedWithheld', 'stateWithheld'].filter(k => k in stubFields).length
      const w2Score = ['wages', 'fedWithheld', 'stateWithheld'].filter(k => k in w2Fields).length
      const candidate = stubScore > w2Score ? { kind: 'stub', fields: stubFields } : { kind: 'w2', fields: w2Fields }
      if (Object.keys(candidate.fields).length > Object.keys(best.fields).length) best = candidate
      if (Math.max(stubScore, w2Score) >= 2) break
    }
  } finally {
    doc.destroy()
  }
  return { ...best, hasText }
}
