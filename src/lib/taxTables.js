// Federal and California tax tables, keyed by tax year.
//
// Brackets are listed as [upper bound of the bracket, rate]; the last one is
// open-ended (Infinity). Every figure here comes from a published source:
//
//   Federal 2026  IRS Rev. Proc. 2025-32 (inflation adjustments, incl. the
//                 One Big Beautiful Bill changes) — irs.gov newsroom, Oct 2025.
//   Federal 2025  IRS Rev. Proc. 2024-40, with the standard deduction raised
//                 by the One Big Beautiful Bill Act.
//   CA 2026       FTB Tax News, October 2026 ("2026 Indexing"): rate schedules
//                 X/Y/Z, standard deduction and exemption credits.
//   CA 2025       FTB 2025 Form 540 Personal Income Tax Booklet, page 75 and
//                 the AGI Limitation Worksheet.
//
// The one projected number: FTB has not yet announced the 2026 AGI where the
// exemption credits start to phase out, so 2026 uses the 2025 thresholds
// indexed by FTB's announced 3.4%.

export const FILING_STATUSES = [
  { value: 'single', label: 'Single' },
  { value: 'mfj', label: 'Married filing jointly' },
  { value: 'mfs', label: 'Married filing separately' },
  { value: 'hoh', label: 'Head of household' },
]

const FEDERAL = {
  2026: {
    standardDeduction: { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 },
    brackets: {
      single: [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [Infinity, 0.37]],
      mfj:    [[24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [Infinity, 0.37]],
      mfs:    [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [384350, 0.35], [Infinity, 0.37]],
      hoh:    [[17700, 0.10], [67450, 0.12], [105700, 0.22], [201750, 0.24], [256200, 0.32], [640600, 0.35], [Infinity, 0.37]],
    },
    // Taxable-income ceilings for the 0% and 15% long-term capital gains rates.
    capitalGains: {
      single: { zeroTo: 49450, fifteenTo: 545500 },
      mfj:    { zeroTo: 98900, fifteenTo: 613700 },
      mfs:    { zeroTo: 49450, fifteenTo: 306850 },
      hoh:    { zeroTo: 66200, fifteenTo: 579600 },
    },
    childTaxCredit: 2200,
    refundableChildCredit: 1700,
    otherDependentCredit: 500,
  },
  2025: {
    standardDeduction: { single: 15750, mfj: 31500, mfs: 15750, hoh: 23625 },
    brackets: {
      single: [[11925, 0.10], [48475, 0.12], [103350, 0.22], [197300, 0.24], [250525, 0.32], [626350, 0.35], [Infinity, 0.37]],
      mfj:    [[23850, 0.10], [96950, 0.12], [206700, 0.22], [394600, 0.24], [501050, 0.32], [751600, 0.35], [Infinity, 0.37]],
      mfs:    [[11925, 0.10], [48475, 0.12], [103350, 0.22], [197300, 0.24], [250525, 0.32], [375800, 0.35], [Infinity, 0.37]],
      hoh:    [[17000, 0.10], [64850, 0.12], [103350, 0.22], [197300, 0.24], [250500, 0.32], [626350, 0.35], [Infinity, 0.37]],
    },
    capitalGains: {
      single: { zeroTo: 48350, fifteenTo: 533400 },
      mfj:    { zeroTo: 96700, fifteenTo: 600050 },
      mfs:    { zeroTo: 48350, fifteenTo: 300000 },
      hoh:    { zeroTo: 64750, fifteenTo: 566700 },
    },
    childTaxCredit: 2200,
    refundableChildCredit: 1700,
    otherDependentCredit: 500,
  },
}

// Not indexed for inflation — fixed in the statute.
export const FEDERAL_FIXED = {
  childCreditPhaseOutStart: { single: 200000, mfj: 400000, mfs: 200000, hoh: 200000 },
  niitThreshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
  niitRate: 0.038,
  capitalLossLimit: { single: 3000, mfj: 3000, mfs: 1500, hoh: 3000 },
}

const CALIFORNIA = {
  2026: {
    standardDeduction: { single: 5900, mfj: 11800, mfs: 5900, hoh: 11800 },
    brackets: {
      single: [[11456, 0.01], [27157, 0.02], [42861, 0.04], [59498, 0.06], [75197, 0.08], [384109, 0.093], [460927, 0.103], [768213, 0.113], [Infinity, 0.123]],
      mfj:    [[22912, 0.01], [54314, 0.02], [85722, 0.04], [118996, 0.06], [150394, 0.08], [768218, 0.093], [921854, 0.103], [1536426, 0.113], [Infinity, 0.123]],
      mfs:    [[11456, 0.01], [27157, 0.02], [42861, 0.04], [59498, 0.06], [75197, 0.08], [384109, 0.093], [460927, 0.103], [768213, 0.113], [Infinity, 0.123]],
      hoh:    [[22927, 0.01], [54316, 0.02], [70018, 0.04], [86654, 0.06], [102356, 0.08], [522385, 0.093], [626864, 0.103], [1044771, 0.113], [Infinity, 0.123]],
    },
    personalCredit: { single: 158, mfj: 316, mfs: 158, hoh: 158 },
    dependentCredit: 491,
    // Projected: 2025 thresholds × 1.034 (FTB's announced 2026 indexing).
    creditPhaseOutStart: { single: 260778, mfj: 521561, mfs: 260778, hoh: 391173 },
    creditPhaseOutProjected: true,
  },
  2025: {
    standardDeduction: { single: 5706, mfj: 11412, mfs: 5706, hoh: 11412 },
    brackets: {
      single: [[11079, 0.01], [26264, 0.02], [41452, 0.04], [57542, 0.06], [72724, 0.08], [371479, 0.093], [445771, 0.103], [742953, 0.113], [Infinity, 0.123]],
      mfj:    [[22158, 0.01], [52528, 0.02], [82904, 0.04], [115084, 0.06], [145448, 0.08], [742958, 0.093], [891542, 0.103], [1485906, 0.113], [Infinity, 0.123]],
      mfs:    [[11079, 0.01], [26264, 0.02], [41452, 0.04], [57542, 0.06], [72724, 0.08], [371479, 0.093], [445771, 0.103], [742953, 0.113], [Infinity, 0.123]],
      hoh:    [[22173, 0.01], [52530, 0.02], [67716, 0.04], [83805, 0.06], [98990, 0.08], [505208, 0.093], [606251, 0.103], [1010417, 0.113], [Infinity, 0.123]],
    },
    personalCredit: { single: 153, mfj: 306, mfs: 153, hoh: 153 },
    dependentCredit: 475,
    creditPhaseOutStart: { single: 252203, mfj: 504411, mfs: 252203, hoh: 378310 },
    creditPhaseOutProjected: false,
  },
}

export const CALIFORNIA_FIXED = {
  // Behavioral Health Services Tax (formerly Mental Health Services Tax).
  bhstThreshold: 1000000,
  bhstRate: 0.01,
  // Each exemption credit drops $6 per $2,500 of AGI over the threshold
  // ($1,250 when married filing separately).
  creditPhaseOutStep: { single: 2500, mfj: 2500, mfs: 1250, hoh: 2500 },
  creditPhaseOutPerStep: 6,
  capitalLossLimit: { single: 3000, mfj: 3000, mfs: 1500, hoh: 3000 },
}

// IRA and 401(k) limits. 2026: IRS Notice 2025-67 / newsroom release
// "401(k) limit increases to $24,500 for 2026, IRA limit increases to $7,500".
// 2025: Notice 2024-80. Phase-outs are MAGI ranges [start, end].
const RETIREMENT = {
  2026: {
    iraLimit: 7500,
    iraCatchUp: 1100,
    k401Limit: 24500,
    k401CatchUp: 8000,
    // Traditional IRA deduction when YOU are covered by a workplace plan.
    tradCoveredPhaseOut: { single: [81000, 91000], hoh: [81000, 91000], mfj: [129000, 149000], mfs: [0, 10000] },
    // Traditional IRA deduction when only your SPOUSE is covered (MFJ).
    tradSpouseCoveredPhaseOut: [242000, 252000],
    rothPhaseOut: { single: [153000, 168000], hoh: [153000, 168000], mfj: [242000, 252000], mfs: [0, 10000] },
  },
  2025: {
    iraLimit: 7000,
    iraCatchUp: 1000,
    k401Limit: 23500,
    k401CatchUp: 7500,
    tradCoveredPhaseOut: { single: [79000, 89000], hoh: [79000, 89000], mfj: [126000, 146000], mfs: [0, 10000] },
    tradSpouseCoveredPhaseOut: [236000, 246000],
    rothPhaseOut: { single: [150000, 165000], hoh: [150000, 165000], mfj: [236000, 246000], mfs: [0, 10000] },
  },
}

export const TAX_YEARS = Object.keys(FEDERAL).map(Number).sort((a, b) => b - a)

export function retirementTable(year) {
  return RETIREMENT[year] ?? RETIREMENT[TAX_YEARS[0]]
}

export function federalTable(year) {
  return FEDERAL[year] ?? FEDERAL[TAX_YEARS[0]]
}

export function californiaTable(year) {
  return CALIFORNIA[year] ?? CALIFORNIA[TAX_YEARS[0]]
}
