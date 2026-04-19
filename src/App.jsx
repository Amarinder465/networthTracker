import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { supabase } from './lib/supabase'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Assets from './pages/Assets'
import Bills from './pages/Bills'
import Loans from './pages/Loans'
import TripCalculator from './pages/TripCalculator'

const NAV = [
  { to: '/',       label: 'Dashboard', icon: '📊' },
  { to: '/assets', label: 'Assets',    icon: '🏦' },
  { to: '/bills',  label: 'Bills',     icon: '🧾' },
  { to: '/loans',  label: 'Loans',     icon: '📋' },
  { to: '/trip',   label: 'Trip',      icon: '✈️' },
]

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">Loading…</div>
  if (!user)   return <Navigate to="/auth" replace />
  return children
}

function Layout() {
  const { user } = useAuth()

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      {/* Top header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        <span className="text-base font-bold tracking-tight text-white">💰 Wealth Tracker</span>

        {/* Desktop nav */}
        <nav className="hidden md:flex gap-1">
          {NAV.map(({ to, label }) => (
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
        </nav>

        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs hidden sm:block truncate max-w-[140px]">{user?.email}</span>
          <button
            onClick={signOut}
            className="text-gray-400 hover:text-white text-xs px-2.5 py-1.5 rounded-lg hover:bg-gray-800 transition-colors whitespace-nowrap"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full pb-24 md:pb-6">
        <Routes>
          <Route path="/"       element={<Dashboard />} />
          <Route path="/assets" element={<Assets />}    />
          <Route path="/bills"  element={<Bills />}     />
          <Route path="/loans"  element={<Loans />}     />
          <Route path="/trip"   element={<TripCalculator />} />
        </Routes>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-800 flex">
        {NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors ${
                isActive ? 'text-brand-400' : 'text-gray-500'
              }`
            }
          >
            <span className="text-lg leading-none">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<AuthRoute />} />
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
