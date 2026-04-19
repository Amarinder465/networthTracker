import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Navigate } from 'react-router-dom'
import ConfirmModal from '../components/ConfirmModal'

const ROLES = ['free', 'pro', 'admin']

const ROLE_COLOR = {
  free:       'bg-gray-700 text-gray-300',
  pro:        'bg-blue-500/20 text-blue-400',
  admin:      'bg-brand-500/20 text-brand-400',
  superadmin: 'bg-yellow-500/20 text-yellow-400',
}

export default function Admin() {
  const { isAdmin, isSuperAdmin, user } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]       = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  if (!isAdmin) return <Navigate to="/" replace />

  async function load() {
    const { data } = await supabase.rpc('get_all_profiles')
    setProfiles(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function removeUser(id) {
    await supabase.rpc('delete_user', { target_id: id })
    setProfiles(prev => prev.filter(p => p.id !== id))
    setConfirmDelete(null)
  }

  async function updateRole(id, newRole) {
    setSaving(id)
    await supabase.rpc('update_user_role', { target_id: id, new_role: newRole })
    setProfiles(prev => prev.map(p => p.id === id ? { ...p, role: newRole } : p))
    setSaving(null)
  }

  const total = profiles.length
  const byRole = ROLES.reduce((acc, r) => ({ ...acc, [r]: profiles.filter(p => p.role === r).length }), {})

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Console</h1>
        <p className="text-gray-400 text-sm mt-0.5">Manage users and access levels</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Users" value={total} color="text-white" />
        <StatCard label="Free" value={byRole.free ?? 0} color="text-gray-400" />
        <StatCard label="Pro" value={byRole.pro ?? 0} color="text-blue-400" />
        <StatCard label="Admins" value={byRole.admin ?? 0} color="text-brand-400" />
      </div>

      {/* User Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="font-semibold">Users</h2>
          <span className="text-gray-500 text-sm">{total} total</span>
        </div>

        {loading ? (
          <p className="text-gray-400 p-5">Loading…</p>
        ) : profiles.length === 0 ? (
          <p className="text-gray-500 p-5 text-center">No users yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Joined</th>
                  <th className="px-5 py-3 font-medium">Change Role</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {profiles.map(p => (
                  <tr key={p.id} className={`border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors ${p.id === user.id ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-3 text-gray-200">
                      {p.email}
                      {p.id === user.id && <span className="ml-2 text-xs text-gray-500">(you)</span>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${ROLE_COLOR[p.role] ?? ROLE_COLOR.free}`}>
                        {p.role}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400">
                      {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3">
                      {p.role === 'superadmin' || p.id === user.id || !isSuperAdmin ? (
                        <span className="text-gray-600 text-xs">—</span>
                      ) : (
                        <div className="flex gap-1 flex-wrap">
                          {ROLES.filter(r => r !== p.role).map(r => (
                            <button
                              key={r}
                              onClick={() => updateRole(p.id, r)}
                              disabled={saving === p.id}
                              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                                r === 'admin' ? 'bg-brand-600/20 hover:bg-brand-600/40 text-brand-400' :
                                r === 'pro'   ? 'bg-blue-600/20 hover:bg-blue-600/40 text-blue-400' :
                                               'bg-gray-700 hover:bg-gray-600 text-gray-300'
                              }`}
                            >
                              {saving === p.id ? '…' : `Make ${r}`}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {p.role !== 'superadmin' && p.id !== user.id && isSuperAdmin && (
                        <button onClick={() => setConfirmDelete(p)} className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          message={`Remove ${confirmDelete.email}? This will delete their account and all data permanently.`}
          onConfirm={() => removeUser(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Access Guide */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h2 className="font-semibold mb-4">Access Levels</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 space-y-2">
            <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-700 text-gray-300">free</span>
            <p className="text-sm font-medium text-white">Free Plan</p>
            <ul className="space-y-1">
              {['Dashboard', 'Assets', 'Bills', 'Loans'].map(f => (
                <li key={f} className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="text-gray-600">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 space-y-2">
            <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400">pro</span>
            <p className="text-sm font-medium text-white">Pro Plan</p>
            <ul className="space-y-1">
              {['Everything in Free', 'Trips & Expense Splitting', 'Future pro features'].map(f => (
                <li key={f} className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="text-blue-500">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-brand-500/5 border border-brand-500/20 rounded-xl p-4 space-y-2">
            <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-500/20 text-brand-400">admin</span>
            <p className="text-sm font-medium text-white">Admin</p>
            <ul className="space-y-1">
              {['Everything in Pro', 'View admin console', 'Read-only access'].map(f => (
                <li key={f} className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="text-brand-400">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 space-y-2">
            <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-yellow-500/20 text-yellow-400">superadmin</span>
            <p className="text-sm font-medium text-white">Super Admin</p>
            <ul className="space-y-1">
              {['Everything in Admin', 'Manage users & roles', 'Delete users', 'Cannot be removed'].map(f => (
                <li key={f} className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="text-yellow-400">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
