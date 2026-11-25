import { getAssignmentCountdown, haversineKm } from '../../utils/geo';

function formatPickup(start, end) {
  if (!start || !end) return '—';
  return (
    new Date(start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
    ' – ' +
    new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

/**
 * Section 1 — incoming assignment requests (status = 'requested', within 15-min window).
 * Props:
 *   assignments   – Array of rows from the assignments table (with donation + ngo joins)
 *   volunteerLat  – Volunteer's current lat (from profile)
 *   volunteerLng  – Volunteer's current lng (from profile)
 *   nowMs         – Current time in ms (passed down so countdowns update together)
 *   busyId        – assignment.id currently being processed (shows loading state)
 *   onRespond(assignmentId, accept) – calls respond_assignment RPC
 */
export default function RequestsSection({
  assignments,
  volunteerLat,
  volunteerLng,
  nowMs,
  busyId,
  onRespond,
}) {
  // Filter out requests whose 15-minute window has already expired
  const liveRequests = assignments.filter((a) => {
    const cd = getAssignmentCountdown(a.requested_at, nowMs);
    return !cd.isTimedOut;
  });

  if (liveRequests.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">Incoming Requests</h2>
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-1">
          <p className="font-medium text-slate-700">No requests right now</p>
          <p className="text-sm text-slate-500">
            NGOs will send you assignment requests when they need a pickup.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-slate-900">
        Incoming Requests ({liveRequests.length})
      </h2>

      <div className="space-y-3">
        {liveRequests.map((assignment) => {
          const donation = assignment.donation;
          const ngo = assignment.ngo;
          const countdown = getAssignmentCountdown(assignment.requested_at, nowMs);
          const isBusy = busyId === assignment.id;

          // Compute distance from volunteer to donation pickup point
          const distKm = haversineKm(
            volunteerLat,
            volunteerLng,
            donation?.lat,
            donation?.lng
          );

          return (
            <article
              key={assignment.id}
              className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-3"
            >
              {/* Request header: countdown badge */}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-slate-500 uppercase font-medium">New request from</p>
                  <p className="font-bold text-slate-900 text-lg leading-tight">
                    {ngo?.org_name || ngo?.name || 'An NGO'}
                  </p>
                </div>

                <span
                  className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${
                    countdown.isUrgent
                      ? 'bg-rose-100 text-rose-700 border border-rose-200'
                      : 'bg-amber-100 text-amber-800 border border-amber-200'
                  }`}
                >
                  {countdown.text}
                </span>
              </div>

              {/* Donation & pickup details */}
              <div className="text-sm text-slate-700 space-y-1">
                <p>
                  <span className="font-semibold text-slate-900">{donation?.title}</span>
                  {donation && (
                    <span className="ml-2 text-slate-600">
                      {donation.quantity} {donation.unit} • {donation.category}
                    </span>
                  )}
                </p>
                <p>
                  <span className="font-medium text-slate-800">Pickup:</span>{' '}
                  {donation?.address || '—'}
                </p>
                <p>
                  <span className="font-medium text-slate-800">Window:</span>{' '}
                  {formatPickup(donation?.pickup_start, donation?.pickup_end)}
                </p>
                <p>
                  <span className="font-medium text-slate-800">Distance:</span>{' '}
                  {distKm !== null ? `${distKm.toFixed(1)} km away` : 'distance unknown'}
                </p>
                {ngo?.phone && (
                  <p>
                    <span className="font-medium text-slate-800">NGO phone:</span>{' '}
                    <a href={`tel:${ngo.phone}`} className="text-emerald-700 font-semibold">
                      {ngo.phone}
                    </a>
                  </p>
                )}
              </div>

              {/* Accept / Decline buttons */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => onRespond(assignment.id, true)}
                  disabled={isBusy}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                >
                  {isBusy ? 'Processing...' : 'Accept'}
                </button>
                <button
                  type="button"
                  onClick={() => onRespond(assignment.id, false)}
                  disabled={isBusy}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 transition-colors"
                >
                  Decline
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
