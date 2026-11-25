// Small header badge that shows whether Supabase Realtime is connected.
export default function LiveStatus({ status }) {
  const live = status === 'live';

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
        live ? 'text-emerald-700' : 'text-slate-400'
      }`}
      title={live ? 'Live updates connected' : 'Live updates unavailable; polling still active'}
    >
      <span
        className={`w-2 h-2 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}
      />
      {live ? 'Live' : 'Offline'}
    </span>
  );
}
