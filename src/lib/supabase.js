import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Fail loudly with instructions instead of rendering a blank screen when the
// Supabase keys are missing (e.g. a fresh clone with no .env file).
if (!supabaseUrl || !supabaseAnonKey) {
  const message = 'Missing Supabase configuration. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to a .env file, then restart the dev server.'
  if (typeof document !== 'undefined') {
    const root = document.getElementById('root') || document.body
    root.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;padding:24px;color:#e2e8f0;background:linear-gradient(135deg,#0a0e27,#1a0a2e 50%,#0f3460);">
        <div style="max-width:540px;background:rgba(15,23,42,.7);border:1px solid rgba(244,63,94,.4);border-radius:16px;padding:28px;backdrop-filter:blur(8px);">
          <h1 style="margin:0 0 12px;font-size:20px;color:#fca5a5;">⚠️ Supabase isn't configured</h1>
          <p style="margin:0 0 16px;line-height:1.6;font-size:14px;color:#cbd5e1;">The app can't start without its database keys. Create a <code style="background:#1e293b;padding:2px 6px;border-radius:4px;">.env</code> file in the project root:</p>
          <pre style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:14px;font-size:13px;overflow:auto;color:#93c5fd;margin:0 0 16px;">VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...your-anon-key</pre>
          <p style="margin:0;line-height:1.6;font-size:13px;color:#94a3b8;">Get both from your Supabase dashboard → <strong>Settings → API</strong>, then <strong>stop and restart</strong> <code style="background:#1e293b;padding:2px 6px;border-radius:4px;">npm run dev</code> (Vite only reads .env at startup).</p>
        </div>
      </div>`
  }
  throw new Error(message)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
