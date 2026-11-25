// Reusable badge showing a distinct Tailwind color for each donation status
const STATUS_STYLES = {
  AVAILABLE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  ACCEPTED: 'bg-sky-100 text-sky-800 border-sky-200',
  ASSIGNED: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  PICKED_UP: 'bg-amber-100 text-amber-800 border-amber-200',
  DELIVERED: 'bg-purple-100 text-purple-800 border-purple-200',
  COMPLETED: 'bg-green-100 text-green-900 border-green-300',
  CANCELLED: 'bg-slate-200 text-slate-700 border-slate-300',
  EXPIRED: 'bg-orange-100 text-orange-800 border-orange-200',
  REJECTED: 'bg-rose-100 text-rose-800 border-rose-200',
};

// "label" is optional — it lets a page show friendlier text (e.g. "Expired")
// while still using the same status colours.
export default function StatusBadge({ status, label }) {
  const colorClasses =
    STATUS_STYLES[status] || 'bg-slate-100 text-slate-700 border-slate-200';

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colorClasses}`}
    >
      {label || (status ? status.replace(/_/g, ' ') : 'UNKNOWN')}
    </span>
  );
}
