export default function Spinner() {
  return (
    <div className="flex items-center justify-center mt-24">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 border-2 border-slate-700 rounded-full" />
        <div className="absolute inset-0 border-2 border-transparent border-t-teal-500 rounded-full animate-spin" />
      </div>
    </div>
  )
}
