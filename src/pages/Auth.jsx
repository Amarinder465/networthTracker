import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const redirect = new URLSearchParams(window.location.search).get('redirect') || '/'
  const [mode, setMode]       = useState('login')
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]     = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else window.location.href = redirect
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setMessage('Check your email for a confirmation link!')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center px-4">
      {/* Animated background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-600/20 rounded-full blur-3xl animate-float" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-600/20 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-purple-700/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-12">
          <div className="inline-block mb-6 animate-float">
            <div className="text-6xl">💰</div>
          </div>
          <h1 className="text-5xl font-bold mb-3">Wealth Tracker</h1>
          <p className="text-cyan-400 text-lg font-medium">Master your financial universe</p>
        </div>

        <div className="card border-purple-500/30 group">
          <div className="flex gap-2 bg-gradient-to-r from-purple-900/30 to-cyan-900/30 rounded-lg p-1.5 mb-8 border border-purple-500/20">
            <button
              onClick={() => { setMode('login'); setError(''); setMessage('') }}
              className={`flex-1 py-3 rounded-md font-bold transition-all duration-300 ${
                mode === 'login'
                  ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-lg shadow-purple-500/30'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(''); setMessage('') }}
              className={`flex-1 py-3 rounded-md font-bold transition-all duration-300 ${
                mode === 'signup'
                  ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-lg shadow-purple-500/30'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              Join Now
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2.5 uppercase tracking-wide">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2.5 uppercase tracking-wide">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-field w-full"
              />
            </div>

            {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 font-semibold backdrop-blur">{error}</p>}
            {message && <p className="text-green-400 text-sm bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 font-semibold backdrop-blur">{message}</p>}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full mt-8 py-3 text-sm font-bold"
            >
              {loading ? '⏳ Authenticating…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
