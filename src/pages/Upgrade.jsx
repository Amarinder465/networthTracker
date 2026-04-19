import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Navigate, useNavigate } from 'react-router-dom'

const FREE_FEATURES = [
  'Dashboard & net worth tracking',
  'Asset tracking',
  'Bills & subscriptions',
  'Loan management',
  'Monthly snapshots',
  'Net worth history chart',
]

const PRO_FEATURES = [
  'Everything in Free',
  'Trip Calculator',
  'Group expense splitting (coming soon)',
  'Restaurant wishlist (coming soon)',
  'Cert tracker (coming soon)',
  'Priority new features',
]

export default function Upgrade() {
  const { isPro, isAdmin, refreshRole } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  if (isPro || isAdmin) return <Navigate to="/" replace />

  async function upgrade() {
    setLoading(true)
    await supabase.rpc('upgrade_to_pro')
    await refreshRole()
    setLoading(false)
    navigate('/')
  }

  return (
    <div className="max-w-3xl mx-auto mt-10 px-4 space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white">Choose your plan</h1>
        <p className="text-gray-400 text-sm mt-2">Upgrade anytime. No credit card required.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

        {/* Free Plan */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col">
          <div className="mb-6">
            <p className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Free</p>
            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold text-white">$0</span>
              <span className="text-gray-500 text-sm mb-1">/month</span>
            </div>
            <p className="text-gray-500 text-xs mt-1">Your current plan</p>
          </div>

          <ul className="space-y-3 flex-1">
            {FREE_FEATURES.map(f => (
              <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
                <span className="text-brand-400 mt-0.5">✓</span>
                {f}
              </li>
            ))}
          </ul>

          <button disabled className="mt-6 w-full bg-gray-800 text-gray-500 py-2.5 rounded-xl text-sm font-medium cursor-not-allowed">
            Current plan
          </button>
        </div>

        {/* Pro Plan */}
        <div className="bg-gray-900 border-2 border-brand-500 rounded-2xl p-6 flex flex-col relative">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="bg-brand-600 text-white text-xs font-semibold px-3 py-1 rounded-full">Most Popular</span>
          </div>

          <div className="mb-6">
            <p className="text-sm font-semibold text-brand-400 uppercase tracking-wide mb-2">Pro</p>
            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold text-white">$0</span>
              <span className="text-gray-500 text-sm mb-1">/month</span>
            </div>
            <p className="text-gray-500 text-xs mt-1">Free during early access</p>
          </div>

          <ul className="space-y-3 flex-1">
            {PRO_FEATURES.map(f => (
              <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
                <span className="text-brand-400 mt-0.5">✓</span>
                {f}
              </li>
            ))}
          </ul>

          <button
            onClick={upgrade}
            disabled={loading}
            className="mt-6 w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors"
          >
            {loading ? 'Upgrading…' : 'Upgrade to Pro'}
          </button>
        </div>

      </div>
    </div>
  )
}
