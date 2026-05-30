import { useEffect } from 'react'

export default function Modal({ title, onClose, children }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md mx-0 sm:mx-4 shadow-2xl flex flex-col max-h-[75dvh] sm:max-h-[85dvh] mb-16 sm:mb-0 animate-fadeInUp">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-700/50 shrink-0">
          <h2 className="text-xl font-bold text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 transition-colors text-2xl leading-none font-bold"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  )
}
