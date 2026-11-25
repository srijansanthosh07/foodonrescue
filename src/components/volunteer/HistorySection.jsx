import { useEffect, useState } from 'react';
import StatusBadge from '../StatusBadge';
import { supabase } from '../../lib/supabase';

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// The NGO writes the rejection reason into donation_events.
// Read the newest event whose note starts with "Rejected on arrival".
function RejectionReason({ donationId }) {
  const [reason, setReason] = useState(null);

  useEffect(() => {
    supabase
      .from('donation_events')
      .select('note')
      .eq('donation_id', donationId)
      .like('note', 'Rejected on arrival%')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (error) {
          setReason('Reason unavailable');
        } else if (data?.length) {
          // Remove the prefix so only the NGO's own reason is shown.
          setReason(data[0].note.replace(/^Rejected on arrival[:\s]*/i, ''));
        } else {
          setReason('No reason recorded');
        }
      });
  }, [donationId]);

  return <span className="font-medium">{reason ?? 'Loading reason…'}</span>;
}

// Accept both possible names for the confirmed quantity column.
function getReceivedQuantity(donation) {
  const value = donation.received_quantity ?? donation.received_qty;
  return value == null ? null : Number(value);
}

/**
 * Section 3 — historical tasks (DELIVERED, COMPLETED, REJECTED), newest first.
 * Step 11: COMPLETED shows "Completed" with a note; REJECTED shows the rejection reason.
 * Props:
 *   donations – Array of donation rows with donor join
 */
export default function HistorySection({ donations }) {
  if (donations.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">History</h2>
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-1">
          <p className="font-medium text-slate-700">No completed tasks yet</p>
          <p className="text-sm text-slate-500">Your finished deliveries will appear here.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-slate-900">History ({donations.length})</h2>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-200">
        {donations.map((donation) => {
          const proofUrl = donation.image_urls?.[0];
          const donorName = donation.donor?.org_name || donation.donor?.name || 'Donor';
          const isCompleted = donation.status === 'COMPLETED';
          const isRejected = donation.status === 'REJECTED';
          const receivedQty = getReceivedQuantity(donation);

          return (
            <div
              key={donation.id}
              className="p-4 flex gap-4 items-start hover:bg-slate-50 transition-colors"
            >
              {/* Proof thumbnail or fallback */}
              {proofUrl ? (
                <img
                  src={proofUrl}
                  alt="Delivery proof"
                  className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-xs text-slate-400 shrink-0">
                  No photo
                </div>
              )}

              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-900 truncate">{donation.title}</h3>
                  <StatusBadge status={donation.status} />
                </div>

                <p className="text-sm text-slate-600">
                  {donation.quantity} {donation.unit} • Donor: {donorName}
                </p>

                {/* COMPLETED: show a clear completion message and confirmed quantity */}
                {isCompleted && (
                  <p className="text-xs text-emerald-700 font-semibold">
                    {receivedQty != null
                      ? `Completed • NGO received ${receivedQty} ${donation.unit}`
                      : 'Completed'}
                  </p>
                )}

                {/* REJECTED: read the reason from donation_events for this donation */}
                {isRejected && (
                  <p className="text-xs text-rose-700">
                    Rejected: <RejectionReason donationId={donation.id} />
                  </p>
                )}

                <p className="text-xs text-slate-500">
                  {isCompleted ? 'Completed' : isRejected ? 'Rejected' : 'Updated'}:{' '}
                  {formatDateTime(donation.updated_at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
