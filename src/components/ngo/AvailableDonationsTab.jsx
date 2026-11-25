import { useState } from 'react';
import { getExpiryCountdown } from '../../utils/geo';
import StatusBadge from '../StatusBadge';

// Format pickup start -> end cleanly for cards
function formatPickupWindow(start, end) {
  if (!start || !end) return '—';
  const startStr = new Date(start).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const endStr = new Date(end).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${startStr} – ${endStr}`;
}

// Tab 1: Available nearby donations with radius filter, countdown, Accept, and Dismiss
export default function AvailableDonationsTab({
  donations,
  dismissedDonations,
  isVerified,
  hasNgoLocation,
  radiusKm,
  showAllDistances,
  onToggleShowAllDistances,
  nowMs,
  busyId,
  onAccept,
  onDismiss,
  onUndoDismiss,
}) {
  const [showHidden, setShowHidden] = useState(false);

  return (
    <div className="space-y-4">
      {/* Filter bar + Hidden donations toggle */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showAllDistances}
              onChange={(e) => onToggleShowAllDistances(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span>Show all distances (testing)</span>
          </label>

          {!showAllDistances && (
            <span className="text-xs text-slate-500">
              {hasNgoLocation
                ? `Filtering within ${radiusKm} km of your NGO`
                : 'Your NGO profile has no coordinates yet — enable "Show all distances (testing)" to browse.'}
            </span>
          )}
          <span className="text-xs font-medium text-emerald-700">
            Priority: soonest expiry first
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowHidden((prev) => !prev)}
          className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline"
        >
          {showHidden
            ? 'Hide dismissed list'
            : `Hidden donations (${dismissedDonations.length})`}
        </button>
      </div>

      {/* Collapsible list of dismissed donations with Undo */}
      {showHidden && (
        <div className="bg-slate-100 rounded-2xl border border-slate-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Hidden donations</h3>
          {dismissedDonations.length === 0 ? (
            <p className="text-xs text-slate-500">No dismissed donations.</p>
          ) : (
            <div className="space-y-2">
              {dismissedDonations.map((item) => (
                <div
                  key={item.dismissalId}
                  className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="text-sm">
                    <p className="font-medium text-slate-900">
                      {item.donation?.title || `Donation (${item.donationId.slice(0, 8)}...)`}
                    </p>
                    {item.donation && (
                      <p className="text-xs text-slate-500">
                        {item.donation.quantity} {item.donation.unit} •{' '}
                        {item.donation.donor?.org_name || item.donation.donor?.name || 'Donor'}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onUndoDismiss(item.dismissalId)}
                    disabled={busyId === item.dismissalId}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {busyId === item.dismissalId ? 'Restoring...' : 'Undo'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Available donations feed */}
      {donations.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
          <p className="text-slate-700 font-medium">No available donations match right now.</p>
          <p className="text-sm text-slate-500">
            {showAllDistances
              ? 'Check back soon or click Refresh — new donations appear automatically every 30s.'
              : 'Try enabling "Show all distances (testing)" or check back shortly.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {donations.map((donation) => {
            const countdown = getExpiryCountdown(donation.expires_at, nowMs);
            const thumbUrl = donation.image_urls?.[0];
            const donorName =
              donation.donor?.org_name || donation.donor?.name || 'Registered Donor';
            const isBusy = busyId === donation.id;

            return (
              <article
                key={donation.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between"
              >
                <div>
                  {/* Image + distance pill */}
                  <div className="relative h-44 bg-slate-100">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={donation.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-sm text-slate-400">
                        No food photo provided
                      </div>
                    )}

                    <div className="absolute top-3 left-3">
                      <StatusBadge status={donation.status} />
                    </div>

                    {donation.distanceKm !== null && (
                      <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-slate-900/80 text-white text-xs font-semibold">
                        {donation.distanceKm.toFixed(1)} km away
                      </span>
                    )}
                  </div>

                  {/* Card details */}
                  <div className="p-4 sm:p-5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-slate-900 text-lg leading-snug">
                        {donation.title}
                      </h3>
                      <span
                        className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-md ${
                          countdown.isUrgent
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {countdown.text}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">
                        {donation.quantity} {donation.unit}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 capitalize">
                        {donation.category}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 capitalize">
                        {donation.food_type}
                      </span>
                    </div>

                    <div className="text-sm text-slate-600 space-y-1 pt-1">
                      <p>
                        <span className="font-medium text-slate-800">Donor:</span> {donorName}
                      </p>
                      <p>
                        <span className="font-medium text-slate-800">Address:</span>{' '}
                        {donation.address}
                      </p>
                      <p>
                        <span className="font-medium text-slate-800">Pickup:</span>{' '}
                        {formatPickupWindow(donation.pickup_start, donation.pickup_end)}
                      </p>
                      {donation.notes && (
                        <p className="text-xs text-slate-500 italic">Notes: {donation.notes}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onAccept(donation)}
                    disabled={!isVerified || isBusy}
                    title={
                      !isVerified
                        ? 'Your NGO must be verified by an admin before accepting donations'
                        : ''
                    }
                    className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isBusy ? 'Processing...' : 'Accept'}
                  </button>

                  <button
                    type="button"
                    onClick={() => onDismiss(donation.id)}
                    disabled={isBusy}
                    className="py-2.5 px-4 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    Not for us
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
