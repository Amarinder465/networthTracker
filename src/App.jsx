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
  { to: '/',      label: 'Dashboard' },
  { to: '/assets', label: 'Assets'   },
  { to: '/bills',  label: 'Bills'    },
  { to: '/loans',  label: 'Loans'    },
  { to: '/trip',   label: 'Trip'     },
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
    <div className="min-h-screen flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-8">
        <span className="text-xl font-bold tracking-tight text-white">💰 Wealth Tracker</span>
        <nav className="flex gap-1 flex-1">
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
        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-sm hidden sm:block">{user?.email}</span>
          <button
            onClick={signOut}
            className="text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <Routes>
          <Route path="/"       element={<Dashboard />} />
          <Route path="/assets" element={<Assets />}    />
          <Route path="/bills"  element={<Bills />}     />
          <Route path="/loans"  element={<Loans />}     />
          <Route path="/trip"   element={<TripCalculator />} />
        </Routes>
      </main>
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
