import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { supabase } from './lib/supabase'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Assets from './pages/Assets'
import Bills from './pages/Bills'
import Loans from './pages/Loans'
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
  { to: '/trip',   label: 'Trips',  icon: '✈️', locked: true },
  { to: '/split',  label: 'Split',  icon: '🍽️', locked: true },
]

const PRO_NAV = [
  { to: '/',       label: 'Home',   icon: '📊' },
  { to: '/assets', label: 'Assets', icon: '🏦' },
  { to: '/bills',  label: 'Bills',  icon: '🧾' },
  { to: '/loans',  label: 'Loans',  icon: '📋' },
  { to: '/trip',   label: 'Trips',  icon: '✈️' },
  { to: '/split',  label: 'Split',  icon: '🍽️' },
]

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">Loading…</div>
  if (!user)   return <Navigate to="/auth" replace />
  return children
}

function Layout() {
  const { user, isAdmin, isPro, loading } = useAuth()
  const NAV = isPro ? PRO_NAV : FREE_NAV


  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      {/* Top header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        <span className="text-base font-bold tracking-tight text-white">💰 Wealth Tracker</span>

        {/* Desktop nav */}
        <nav className="hidden md:flex gap-1">
          {NAV.map(({ to, label, locked }) => locked ? (
            <NavLink
              key={to}
              to={to}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 flex items-center gap-1"
            >
              {label} <span className="text-xs">🔒</span>
            </NavLink>
          ) : (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
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
                `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-600 text-white' : 'text-brand-400 hover:text-white hover:bg-gray-800'
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
              `flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`
            }
          >
            <span className="text-base">👤</span>
            <span className="hidden sm:block truncate max-w-[120px]">{user?.email?.split('@')[0]}</span>
          </NavLink>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full pb-24 md:pb-6">
        <Routes>
          <Route path="/"       element={<Dashboard />} />
          <Route path="/assets" element={<Assets />}    />
          <Route path="/bills"  element={<Bills />}     />
          <Route path="/loans"  element={<Loans />}     />
          <Route path="/trip"   element={loading ? null : isPro ? <Trips />      : <UpgradePrompt feature="Trips" />} />
          <Route path="/split"  element={loading ? null : isPro ? <SplitCheck /> : <UpgradePrompt feature="Split the Bill" />} />
          <Route path="/admin"   element={loading ? null : isAdmin ? <Admin /> : <Navigate to="/" replace />} />
          <Route path="/upgrade" element={<Upgrade />} />
          <Route path="/account" element={<Account />} />
        </Routes>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-800 flex">
        {NAV.map(({ to, label, icon, locked }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-medium transition-colors ${
                locked ? 'text-gray-600' : isActive ? 'text-brand-400' : 'text-gray-500'
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
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-medium transition-colors ${
                isActive ? 'text-brand-400' : 'text-gray-500'
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
    <div className="text-center mt-20 px-4">
      <p className="text-5xl mb-4">🔒</p>
      <p className="text-xl font-bold text-white">{feature}</p>
      <p className="text-gray-400 text-sm mt-2 max-w-xs mx-auto">This feature is available on Pro.</p>
      <button
        onClick={() => navigate('/upgrade')}
        className="mt-6 bg-brand-600 hover:bg-brand-700 text-white px-6 py-3 rounded-xl font-semibold text-sm transition-colors"
      >
        Upgrade to Pro — It's Free
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
