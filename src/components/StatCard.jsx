export default function StatCard({ label, value, sub, color = 'text-slate-100' }) {
  return (
    <div className="card-stat group relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-700/0 to-slate-600/0 group-hover:from-slate-700/10 group-hover:to-slate-600/20 transition-all duration-300"></div>
      <div className="relative">
        <p className="stat-label text-slate-500">{label}</p>
        <p className={`text-3xl font-bold ${color} mt-3`}>{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-2 font-medium">{sub}</p>}
      </div>
    </div>
  )
}
