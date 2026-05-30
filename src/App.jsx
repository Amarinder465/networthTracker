import { useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { supabase } from './lib/supabase'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Assets from './pages/Assets'
import Bills from './pages/Bills'
import Loans from './pages/Loans'
import Todos from './pages/Todos'
import Trips from './pages/Trips'
import SplitCheck from './pages/SplitCheck'
import Admin from './pages/Admin'
import Upgrade from './pages/Upgrade'
import Account from './pages/Account'
import SplitShare from './pages/SplitShare'

const FREE_NAV = [
  { to: '/',       label: 'Home',   icon: '📊' },
  { to: '/assets', label: 'Assets', icon: '🏦' },
  { to: '/bills',  label: 'Bills',  icon: '🧾' },
  { to: '/loans',  label: 'Loans',  icon: '📋' },
  { to: '/todos',  label: 'Trading', icon: '📈' },
  { to: '/trip',   label: 'Trips',  icon: '✈️', locked: true },
  { to: '/split',  label: 'Split',  icon: '🍽️', locked: true },
]

const PRO_NAV = [
  { to: '/',       label: 'Home',   icon: '📊' },
  { to: '/assets', label: 'Assets', icon: '🏦' },
  { to: '/bills',  label: 'Bills',  icon: '🧾' },
  { to: '/loans',  label: 'Loans',  icon: '📋' },
  { to: '/todos',  label: 'Trading', icon: '📈' },
  { to: '/trip',   label: 'Trips',  icon: '✈️' },
  { to: '/split',  label: 'Split',  icon: '🍽️' },
]

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center text-slate-400">
    <div className="text-center space-y-4">
      <div className="text-4xl animate-pulse">💰</div>
      <p className="text-sm">Loading your wealth dashboard…</p>
    </div>
  </div>
  if (!user)   return <Navigate to="/auth" replace />
  return children
}

function Layout() {
  const { user, isAdmin, isPro, loading } = useAuth()
  const NAV = isPro ? PRO_NAV : FREE_NAV
  const [showNavSettings, setShowNavSettings] = useState(false)
  const [visibleNav, setVisibleNav] = useState(() => {
    if (typeof window === 'undefined') return NAV.map(n => n.to)
    try {
      const saved = localStorage.getItem('visibleNav')
      if (saved) {
        const parsed = JSON.parse(saved)
        const defaultNav = NAV.map(n => n.to)
        // Filter to only include items that still exist in NAV
        const valid = parsed.filter(v => defaultNav.includes(v))
        return valid.length > 0 ? valid : defaultNav
      }
    } catch (e) {
      console.error('Error reading visibleNav from localStorage:', e)
    }
    return NAV.map(n => n.to)
  })

  const handleToggleNav = (to) => {
    const updated = visibleNav.includes(to)
      ? visibleNav.filter(v => v !== to)
      : [...visibleNav, to]
    setVisibleNav(updated)
    localStorage.setItem('visibleNav', JSON.stringify(updated))
  }

  const filteredNav = NAV.filter(n => visibleNav.includes(n.to))

  return (
    <div className="min-h-screen flex flex-col bg-black">
      {/* Top header */}
      <header className="relative border-b border-purple-500/20 px-4 py-4 flex items-center justify-between sticky top-0 z-40 backdrop-blur-xl" style={{background: 'rgba(10, 14, 39, 0.4)'}}>
        <div className="flex items-center gap-3 sm:gap-4">
          <span className="text-xl font-bold tracking-tight text-white">💰 <span className="hidden sm:inline text-gradient">Wealth</span></span>
          <div className="relative">
            <button
              onClick={() => setShowNavSettings(!showNavSettings)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                showNavSettings
                  ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-purple-900/20 border border-purple-500/20'
              }`}
              title="Customize navigation"
            >
              <span className="text-base">⚙️</span>
              <span className="text-xs font-bold hidden sm:inline">Menu</span>
            </button>
            {showNavSettings && (
              <div className="absolute top-12 left-0 rounded-lg shadow-2xl p-4 space-y-2 w-56 z-50 border border-purple-500/30 backdrop-blur-xl" style={{background: 'rgba(26, 31, 58, 0.6)'}}>
                <p className="text-xs font-bold text-purple-300 px-2 mb-3 uppercase tracking-wider">Navigation</p>
                {NAV.map(item => (
                  <label key={item.to} className="flex items-center gap-2 cursor-pointer hover:bg-purple-500/20 p-2 rounded transition-colors">
                    <input
                      type="checkbox"
                      checked={visibleNav.includes(item.to)}
                      onChange={() => handleToggleNav(item.to)}
                      className="w-4 h-4 accent-cyan-400"
                    />
                    <span className="text-sm text-slate-300">{item.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex gap-2">
          {filteredNav.map(({ to, label, locked }) => locked ? (
            <NavLink
              key={to}
              to={to}
              className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 flex items-center gap-1 bg-slate-900/30"
            >
              {label} <span className="text-xs">🔒</span>
            </NavLink>
          ) : (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  isActive ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-lg shadow-purple-500/30' : 'text-slate-400 hover:text-white hover:bg-purple-900/20 border border-purple-500/20'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  isActive ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-lg shadow-purple-500/30' : 'text-cyan-400 hover:text-cyan-300 hover:bg-cyan-900/20 border border-cyan-500/20'
                }`
              }
            >
              ⚙️ Admin
            </NavLink>
          )}
        </nav>

        <div className="flex items-center gap-2">
          <NavLink
            to="/account"
            className={({ isActive }) =>
              `flex items-center gap-2 text-xs px-3 py-2 rounded-lg font-bold transition-all ${
                isActive ? 'bg-gradient-to-r from-cyan-600 to-cyan-500 text-white' : 'text-slate-400 hover:text-white hover:bg-cyan-900/20 border border-cyan-500/20'
              }`
            }
          >
            <span className="text-base">👤</span>
            <span className="hidden sm:block truncate max-w-[120px]">{user?.email?.split('@')[0]}</span>
          </NavLink>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full pb-24 md:pb-6">
        <Routes>
          <Route path="/"       element={<Dashboard />} />
          <Route path="/assets" element={<Assets />}    />
          <Route path="/bills"  element={<Bills />}     />
          <Route path="/loans"  element={<Loans />}     />
          <Route path="/todos"  element={<Todos />}     />
          <Route path="/trip"   element={loading ? null : isPro ? <Trips />      : <UpgradePrompt feature="Trips" />} />
          <Route path="/split"  element={loading ? null : isPro ? <SplitCheck /> : <UpgradePrompt feature="Split the Bill" />} />
          <Route path="/admin"   element={loading ? null : isAdmin ? <Admin /> : <Navigate to="/" replace />} />
          <Route path="/upgrade" element={<Upgrade />} />
          <Route path="/account" element={<Account />} />
        </Routes>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-purple-500/20 backdrop-blur-xl flex" style={{background: 'rgba(10, 14, 39, 0.4)'}}>
        {filteredNav.map(({ to, label, icon, locked }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-3 gap-1 text-[10px] font-bold transition-all ${
                locked ? 'text-slate-600' : isActive ? 'text-purple-400' : 'text-slate-500 hover:text-slate-300'
              }`
            }
          >
            <span className="text-lg leading-none">{locked ? '🔒' : icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-3 gap-1 text-[10px] font-bold transition-all ${
                isActive ? 'text-purple-400' : 'text-slate-500 hover:text-slate-300'
              }`
            }
          >
            <span className="text-lg leading-none">⚙️</span>
            <span>Admin</span>
          </NavLink>
        )}
      </nav>
    </div>
  )
}

function UpgradePrompt({ feature }) {
  const navigate = useNavigate()
  return (
    <div className="text-center mt-32 px-4">
      <p className="text-6xl mb-6 animate-bounce">🔒</p>
      <p className="text-2xl font-bold text-slate-100">{feature}</p>
      <p className="text-slate-400 text-sm mt-3 max-w-sm mx-auto">This feature is exclusive to Pro members.</p>
      <button
        onClick={() => navigate('/upgrade')}
        className="btn-primary mt-8"
      >
        Unlock with Pro — It's Free
      </button>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<AuthRoute />} />
          <Route path="/split/share/:token" element={<SplitShare />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

function AuthRoute() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user)    return <Navigate to="/" replace />
  return <Auth />
}
