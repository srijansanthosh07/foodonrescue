import { useEffect, useState } from 'react';
import StatusBadge from '../StatusBadge';
import { supabase } from '../../lib/supabase';

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// Different database versions may name the confirmed amount either
// received_quantity or received_qty, so accept both.
function getReceivedQuantity(donation) {
  const value = donation.received_quantity ?? donation.received_qty;
  return value == null ? null : Number(value);
}

/**
 * Fetches the rejection reason from donation_events for a REJECTED donation.
 * We look for the latest event whose note starts with "Rejected on arrival".
 * Returns the note string or null.
 */
async function fetchRejectionReason(donationId) {
  const { data, error } = await supabase
    .from('donation_events')
    .select('note')
    .eq('donation_id', donationId)
    .like('note', 'Rejected on arrival%')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return 'Reason unavailable';
  if (!data?.length) return 'No reason recorded';
  return data[0].note;
}

/**
 * A single history row that lazily loads the rejection reason (REJECTED) on mount.
 * Keeps the parent simple by isolating per-row async work here.
 */
function HistoryRow({ donation }) {
  const donorName = donation.donor?.org_name || donation.donor?.name || 'Donor';
  const volunteerName =
    donation.volunteer?.name ||
    donation.volunteer?.org_name ||
    null;

  // For REJECTED donations we need the reason from donation_events
  const [rejectReason, setRejectReason] = useState(null);

  useEffect(() => {
    if (donation.status === 'REJECTED') {
      fetchRejectionReason(donation.id)
        .then((note) => setRejectReason(note))
        .catch(() => setRejectReason('Reason unavailable'));
    }
  }, [donation.id, donation.status]);

  return (
    <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-3 hover:bg-slate-50 transition-colors">
      <div className="space-y-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-slate-900">{donation.title}</h3>
          <StatusBadge status={donation.status} />
        </div>

        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-800">
            {donation.quantity} {donation.unit}
          </span>{' '}
          • Donor: {donorName}
        </p>

        {/* Volunteer name */}
        {volunteerName && (
          <p className="text-xs text-indigo-800">
            Volunteer: <span className="font-semibold">{volunteerName}</span>
          </p>
        )}

        {/* Received quantity — only shown for COMPLETED */}
        {donation.status === 'COMPLETED' && getReceivedQuantity(donation) != null && (
          <p className="text-xs text-emerald-800 font-semibold">
            ✓ Received: {getReceivedQuantity(donation)} {donation.unit}
          </p>
        )}

        {/* Rejection reason — shown for REJECTED (loaded async) */}
        {donation.status === 'REJECTED' && (
          <p className="text-xs text-rose-700">
            Rejected:{' '}
            <span className="font-medium">
              {rejectReason ? rejectReason.replace(/^Rejected on arrival[:\s]*/i, '') : 'Loading reason…'}
            </span>
          </p>
        )}

        <p className="text-xs text-slate-500">
          Posted: {formatDateTime(donation.created_at)} • Updated: {formatDateTime(donation.updated_at)}
        </p>
      </div>
    </div>
  );
}

// Tab 3: Past donations accepted by this NGO (COMPLETED, REJECTED, CANCELLED, EXPIRED)
// Step 11: shows received_qty, volunteer name, and rejection reason.
export default function HistoryDonationsTab({ donations }) {
  if (donations.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
        <p className="text-slate-700 font-medium">No past donations yet.</p>
        <p className="text-sm text-slate-500">
          Completed, cancelled, expired, or rejected rescues will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-200">
      {donations.map((donation) => (
        <HistoryRow key={donation.id} donation={donation} />
      ))}
    </div>
  );
}
