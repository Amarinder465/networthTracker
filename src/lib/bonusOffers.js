// Curated bank-bonus offers used by the "Browse Offers" picker on the Bonuses page.
// Each offer is a TEMPLATE: clicking "Track this" pre-fills the Add form so you can
// tweak amounts/dates before saving.
//
// `tasks[].dueInDays` is an offset (in days) from the day you add the offer — it
// becomes a concrete due date when instantiated.
//
// ⚠️ Bank bonuses change constantly and vary by region/eligibility. Offers marked
// `verified: true` were checked against the live offer page on 2026-06-17. Everything
// else is a well-known recurring offer — ALWAYS confirm the exact amount, promo code,
// and terms on the bank's page (the link is included) before relying on it.

export const BONUS_OFFERS = [
  {
    id: 'wells-fargo-business-400',
    bank: 'Wells Fargo',
    accountType: 'Initiate Business Checking',
    amount: 400,
    category: 'Business',
    url: 'https://accountoffers.wellsfargo.com/businesscheckinga/',
    offerEnds: '2026-07-07',
    payoutDays: 90,
    verified: true,
    note: 'New business checking customers only. You must enter the bonus offer code when opening. Bonus paid within ~30 days after the 60-day qualification period.',
    tasks: [
      { label: 'Open eligible business checking account (enter bonus code at signup)', target: null, dueInDays: 20 },
      { label: 'Deposit $2,500 or more into the account', target: 2500, dueInDays: 30 },
      { label: 'Maintain a $2,500 minimum daily balance through day 60', target: 2500, dueInDays: 60 },
      { label: 'Keep the account open through the 60-day qualification period', target: null, dueInDays: 60 },
    ],
  },
  {
    id: 'chase-total-checking-400',
    bank: 'Chase',
    accountType: 'Total Checking',
    amount: 400,
    category: 'Personal',
    url: 'https://account.chase.com/consumer/banking/seo',
    offerEnds: '2026-07-15',
    payoutDays: 20,
    verified: true,
    note: 'New Chase checking customers only (one new-checking bonus every 2 years). Bonus paid within 15 days after requirements are met.',
    tasks: [
      { label: 'Open a new Chase Total Checking account', target: null, dueInDays: 10 },
      { label: 'Receive direct deposits totaling $1,000 or more', target: 1000, dueInDays: 90 },
      { label: 'Keep the account open and in good standing at payout', target: null, dueInDays: 90 },
    ],
  },
  {
    id: 'capital-one-business-500',
    bank: 'Capital One',
    accountType: 'Business Basic / Enhanced Checking',
    amount: 500,
    category: 'Business',
    url: 'https://www.capitalone.com/small-business/bank/bizchecking500/',
    offerEnds: null,
    payoutDays: 120,
    verified: true,
    note: 'Apply online with promo code SBOFFER500. Reported to the IRS on Form 1099-INT. Bonus paid within 60–90 days after all requirements are met.',
    tasks: [
      { label: 'Open account online using promo code SBOFFER500', target: null, dueInDays: 10 },
      { label: 'Deposit $5,000 from an external source', target: 5000, dueInDays: 30 },
      { label: 'Maintain a $5,000 end-of-day balance for 60 days (within first 90)', target: 5000, dueInDays: 90 },
      { label: 'Complete 10 electronic transactions (ACH / wire / mobile deposit)', target: 10, dueInDays: 90 },
    ],
  },

  // ── Other well-known recurring offers — verify current terms on the bank's page ──
  {
    id: 'boa-advantage-300',
    bank: 'Bank of America',
    accountType: 'Advantage Banking',
    amount: 300,
    category: 'Personal',
    url: 'https://www.bankofamerica.com/deposits/bank-account-bonus-offers/',
    offerEnds: null,
    payoutDays: 90,
    verified: false,
    note: 'Recurring ~$300 personal checking offer. Typically requires an offer code + qualifying direct deposits. Verify current amount and terms.',
    tasks: [
      { label: 'Open an Advantage Banking account with the offer code', target: null, dueInDays: 14 },
      { label: 'Receive 2 qualifying direct deposits of $2,000+ each', target: 2000, dueInDays: 90 },
    ],
  },
  {
    id: 'chase-business-complete-300',
    bank: 'Chase',
    accountType: 'Business Complete Banking',
    amount: 300,
    category: 'Business',
    url: 'https://www.chase.com/business/banking/business-complete-banking',
    offerEnds: null,
    payoutDays: 90,
    verified: false,
    note: 'Recurring business checking offer (often $300). Usually needs new-money deposit + qualifying transactions. Verify current terms.',
    tasks: [
      { label: 'Open a Business Complete Banking account with the coupon', target: null, dueInDays: 14 },
      { label: 'Deposit $2,000 in new money', target: 2000, dueInDays: 30 },
      { label: 'Maintain a $2,000 balance for 60 days', target: 2000, dueInDays: 60 },
      { label: 'Complete 5 qualifying transactions', target: 5, dueInDays: 90 },
    ],
  },
  {
    id: 'us-bank-business-450',
    bank: 'U.S. Bank',
    accountType: 'Business Checking',
    amount: 450,
    category: 'Business',
    url: 'https://www.usbank.com/business-banking/business-checking-accounts.html',
    offerEnds: null,
    payoutDays: 75,
    verified: false,
    note: 'Business checking bonuses have ranged $400–$900 depending on deposit tier. Confirm the current promo code and amount.',
    tasks: [
      { label: 'Open a business checking account with the promo code', target: null, dueInDays: 14 },
      { label: 'Deposit $5,000 in new money', target: 5000, dueInDays: 30 },
      { label: 'Maintain the qualifying balance for 60 days', target: 5000, dueInDays: 60 },
    ],
  },
  {
    id: 'pnc-virtual-wallet-400',
    bank: 'PNC',
    accountType: 'Virtual Wallet',
    amount: 400,
    category: 'Personal',
    url: 'https://www.pnc.com/en/personal-banking/banking/checking/virtual-wallet.html',
    offerEnds: null,
    payoutDays: 90,
    verified: false,
    note: 'Virtual Wallet bonuses scale with direct-deposit total (often up to $400). Verify the current tier and required code.',
    tasks: [
      { label: 'Open a Virtual Wallet account with the offer code', target: null, dueInDays: 14 },
      { label: 'Receive qualifying direct deposits totaling $5,000', target: 5000, dueInDays: 60 },
    ],
  },
  {
    id: 'sofi-checking-savings-300',
    bank: 'SoFi',
    accountType: 'Checking & Savings',
    amount: 300,
    category: 'Personal',
    url: 'https://www.sofi.com/banking/',
    offerEnds: null,
    payoutDays: 30,
    verified: false,
    note: 'Up to $300 for setting up a qualifying direct deposit (tiered by deposit amount). Verify the current maximum.',
    tasks: [
      { label: 'Open a SoFi Checking & Savings account', target: null, dueInDays: 7 },
      { label: 'Set up a qualifying direct deposit of $5,000+', target: 5000, dueInDays: 25 },
    ],
  },
  {
    id: 'citi-checking-325',
    bank: 'Citibank',
    accountType: 'Regular Checking',
    amount: 325,
    category: 'Personal',
    url: 'https://www.citi.com/banking',
    offerEnds: null,
    payoutDays: 90,
    verified: false,
    note: 'Citi runs tiered checking bonuses (deposit more → larger bonus). Confirm the current tier table and enrollment requirement.',
    tasks: [
      { label: 'Open an eligible checking account and enroll in the offer', target: null, dueInDays: 14 },
      { label: 'Deposit qualifying new funds and keep them 60 days', target: null, dueInDays: 60 },
    ],
  },
]
