export function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value ?? 0)
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function getNextDueDate(dueDateStr, frequency) {
  if (!dueDateStr) return null
  const today = new Date()
  const d = new Date(dueDateStr + 'T00:00:00')
  while (d < today) {
    if (frequency === 'monthly')     d.setMonth(d.getMonth() + 1)
    else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1)
    else if (frequency === 'weekly') d.setDate(d.getDate() + 7)
    else break
  }
  return d
}
