import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import ConfirmModal from '../components/ConfirmModal'

export default function Account() {
  const { user, role, refreshRole } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading]   = useState(false)
  const [confirm, setConfirm]   = useState(false)

  async function downgrade() {
    setLoading(true)
    await supabase.from('profiles').update({ role: 'free' }).eq('id', user.id)
    await refreshRole()
    setLoading(false)
    setConfirm(false)
    navigate('/')
  }

  const PLAN_COLOR = {
    free:  'bg-gray-700 text-gray-300',
    pro:   'bg-blue-500/20 text-blue-400',
    admin: 'bg-brand-500/20 text-brand-400',
  }

  return (
    <div className="max-w-md mx-auto mt-10 px-4 space-y-6">
      <h1 className="text-2xl font-bold">My Account</h1>

      {/* Profile */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Profile</p>
        <div className="flex items-center justify-between">
          <span className="text-gray-400 text-sm">Email</span>
          <span className="text-white text-sm">{user?.email}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400 text-sm">Plan</span>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${PLAN_COLOR[role] ?? PLAN_COLOR.free}`}>
            {role}
          </span>
        </div>
      </div>

      {/* Plan actions */}
      {role === 'free' && (
        <div className="bg-gray-900 border border-brand-600/40 rounded-2xl p-5 space-y-3">
          <p className="text-sm font-semibold text-white">Upgrade to Pro</p>
          <p className="text-gray-400 text-xs">Unlock Trip Calculator and more features.</p>
          <button
            onClick={() => navigate('/upgrade')}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors"
          >
            View Pro Plan
          </button>
        </div>
      )}

      {role === 'pro' && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
          <p className="text-sm font-semibold text-white">Current Plan: Pro</p>
          <p className="text-gray-400 text-xs">You have access to all Pro features.</p>
          <button
            onClick={() => setConfirm(true)}
            className="w-full bg-gray-800 hover:bg-gray-700 text-red-400 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            Downgrade to Free
          </button>
        </div>
      )}

      {role === 'admin' && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <p className="text-sm font-semibold text-white">Current Plan: Admin</p>
          <p className="text-gray-400 text-xs mt-1">Admin accounts cannot be downgraded here.</p>
        </div>
      )}

      {/* Sign out */}
      <button
        onClick={() => supabase.auth.signOut()}
        className="w-full bg-gray-900 border border-gray-800 hover:bg-gray-800 text-gray-400 py-2.5 rounded-xl text-sm font-medium transition-colors"
      >
        Sign Out
      </button>

      {confirm && (
        <ConfirmModal
          message="Downgrade to Free? You'll lose access to Pro features."
          onConfirm={downgrade}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}
