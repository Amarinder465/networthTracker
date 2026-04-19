import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [role, setRole]       = useState(null)
  const [loading, setLoading] = useState(true)

  async function fetchRole(userId) {
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).single()
    setRole(data?.role ?? 'free')
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null
      setUser(u)
      if (u) fetchRole(u.id).finally(() => setLoading(false))
      else setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      if (u) fetchRole(u.id)
      else setRole(null)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const isSuperAdmin = role === 'superadmin'
  const isAdmin      = role === 'admin' || role === 'superadmin'
  const isPro        = role === 'pro' || role === 'admin' || role === 'superadmin'

  async function refreshRole() {
    if (user) await fetchRole(user.id)
  }

  return (
    <AuthContext.Provider value={{ user, role, isAdmin, isSuperAdmin, isPro, loading, refreshRole }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
