import { useState } from 'react';
import StatusBadge from '../StatusBadge';
import { getAssignmentCountdown } from '../../utils/geo';
import { supabase } from '../../lib/supabase';
import { useToast } from '../ToastProvider';

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// Supabase can return technical error text. Turn the common cases into
// short, friendly sentences that make sense to an NGO user.
function friendlyDeliveryError(message, fallback) {
  const text = String(message || '').toLowerCase();
  if (text.includes('quantity')) {
    return 'Please enter a received quantity greater than 0.';
  }
  if (text.includes('status') || text.includes('not delivered') || text.includes('not picked')) {
    return 'This donation has already changed status. Refresh the page and try again.';
  }
  if (text.includes('permission') || text.includes('authorized') || text.includes('policy')) {
    return 'You are not allowed to update this donation.';
  }
  return message || fallback;
}

// ─── Confirm Receipt Dialog ───────────────────────────────────────────────────
// Shown when the NGO clicks "Confirm receipt" on a DELIVERED donation.
function ConfirmReceiptDialog({ donation, onClose, onSuccess }) {
  // Pre-fill with the original donation quantity so the NGO only changes it if needed
  const [qty, setQty] = useState(String(donation.quantity || ''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { addToast } = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    const parsed = Number(qty);
    if (!parsed || parsed <= 0) {
      const message = 'Received quantity must be greater than 0.';
      setError(message);
      addToast(message, 'error');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      // The database function checks the NGO and updates status + received quantity.
      const { error: rpcError } = await supabase.rpc('confirm_receipt', {
        p_donation_id: donation.id,
        p_received_qty: parsed,
      });

      if (rpcError) {
        const message = friendlyDeliveryError(rpcError.message, 'Could not confirm receipt. Please try again.');
        setError(message);
        addToast(message, 'error');
      } else {
        onSuccess('Receipt confirmed! Donation marked as COMPLETED.');
      }
    } catch (err) {
      const message = friendlyDeliveryError(err.message, 'Could not confirm receipt. Please try again.');
      setError(message);
      addToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-sm w-full shadow-xl p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Confirm Receipt</h2>
          <p className="text-sm text-slate-600 mt-1">
            How much of <span className="font-semibold">{donation.title}</span> did you actually
            receive?
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Received quantity ({donation.unit})
            </label>
            <input
              type="number"
              min="0.01"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              required
              className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 transition-colors"
            >
              {submitting ? 'Confirming…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Reject on Arrival Dialog ─────────────────────────────────────────────────
// Shown when the NGO clicks "Reject food" on a PICKED_UP or DELIVERED donation.
const QUICK_REASONS = [
  'Spoiled',
  'Wrong food type',
  'Quantity too low',
  'Unsafe packaging',
];

function RejectDialog({ donation, onClose, onSuccess }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { addToast } = useToast();

  function applyQuickReason(r) {
    // If the user picks a quick reason, append / replace cleanly
    setReason(r);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) {
      const message = 'Please provide a reason for the rejection.';
      setError(message);
      addToast(message, 'error');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      // The database function records the reason in donation_events and moves the
      // donation to REJECTED so it appears in History.
      const { error: rpcError } = await supabase.rpc('reject_on_arrival', {
        p_donation_id: donation.id,
        p_reason: reason.trim(),
      });

      if (rpcError) {
        const message = friendlyDeliveryError(rpcError.message, 'Could not reject donation. Please try again.');
        setError(message);
        addToast(message, 'error');
      } else {
        onSuccess('Donation rejected. It has been moved to History.');
      }
    } catch (err) {
      const message = friendlyDeliveryError(err.message, 'Could not reject donation. Please try again.');
      setError(message);
      addToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-sm w-full shadow-xl p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Reject Food on Arrival</h2>
          <p className="text-sm text-slate-600 mt-1">
            What is wrong with <span className="font-semibold">{donation.title}</span>? A reason
            is required so the donor can improve future donations.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Quick-pick buttons */}
          <div className="flex flex-wrap gap-2">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => applyQuickReason(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  reason === r
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Free-text reason */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Reason <span className="text-rose-600">*</span>
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the problem in detail…"
              required
              className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
            />
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !reason.trim()}
              className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Rejecting…' : 'Reject food'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Proof image with click-to-enlarge ───────────────────────────────────────
function ProofImage({ url, label = 'Delivery proof' }) {
  const [enlarged, setEnlarged] = useState(false);
  if (!url) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        className="block w-full rounded-xl overflow-hidden border border-slate-200 mt-2"
        title="Click to enlarge"
      >
        <img src={url} alt={label} className="w-full h-40 object-cover hover:opacity-90 transition-opacity" />
        <p className="text-xs text-center text-slate-500 py-1 bg-slate-50">Click to enlarge</p>
      </button>

      {/* Lightbox */}
      {enlarged && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setEnlarged(false)}
        >
          <img
            src={url}
            alt={label}
            className="max-w-full max-h-full rounded-xl object-contain"
          />
          <button
            type="button"
            className="absolute top-4 right-4 text-white bg-black/50 rounded-full w-9 h-9 flex items-center justify-center text-xl font-bold hover:bg-black/70"
            onClick={() => setEnlarged(false)}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}

// ─── Main exported component ──────────────────────────────────────────────────
// Tab 2: Donations accepted by this NGO
// New in Step 11: PICKED_UP shows "On the way" + photo; DELIVERED shows proof + receipt/reject dialogs.
export default function AcceptedDonationsTab({
  donations,
  volunteerMap,
  latestAssignmentMap,
  nowMs,
  busyId,
  onOpenAssignModal,
  onCancelAssignment,
  onChangeVolunteer,
  onRelease,
  onActionSuccess,  // new: called when confirm_receipt / reject_on_arrival succeeds so parent can refresh
}) {
  // Track which dialog is open: { donationId, mode: 'receipt' | 'reject' }
  const [openDialog, setOpenDialog] = useState(null);

  if (donations.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
        <p className="text-slate-700 font-medium">No active accepted donations.</p>
        <p className="text-sm text-slate-500">
          Accept a donation from &ldquo;Available nearby&rdquo; to coordinate pickup.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {donations.map((donation) => {
        const donorName = donation.donor?.org_name || donation.donor?.name || 'Donor';
        const donorPhone = donation.donor?.phone || 'Not provided';
        const assignedVolunteer = donation.assigned_volunteer_id
          ? volunteerMap[donation.assigned_volunteer_id]
          : null;
        const latestAssignment = latestAssignmentMap[donation.id] || null;
        const isBusy = busyId === donation.id;

        const latestVolunteerName = latestAssignment?.volunteer?.name || 'Volunteer';
        const latestVolunteerPhone = latestAssignment?.volunteer?.phone || '';
        const confirmedVolunteerName = assignedVolunteer?.name || latestVolunteerName;
        const confirmedVolunteerPhone = assignedVolunteer?.phone || latestVolunteerPhone;

        const countdown =
          latestAssignment?.status === 'requested'
            ? getAssignmentCountdown(latestAssignment.requested_at, nowMs)
            : { text: '', isUrgent: false, isTimedOut: false };

        const isRequestPending =
          latestAssignment?.status === 'requested' && !countdown.isTimedOut;
        const isVolunteerConfirmed =
          Boolean(donation.assigned_volunteer_id) ||
          latestAssignment?.status === 'accepted' ||
          donation.status === 'ASSIGNED';

        const canRelease =
          donation.status === 'ACCEPTED' && !isRequestPending && !isVolunteerConfirmed;

        // Is this card currently showing one of the two dialogs?
        const dialogOpen = openDialog?.donationId === donation.id;

        // ── Delivery-stage blocks (PICKED_UP / DELIVERED) ─────────────────
        // These replace / supplement the assignment block for in-transit donations.
        function renderDeliveryBlock() {
          if (donation.status === 'PICKED_UP') {
            // Show volunteer info + optional pickup photo
            const pickupPhoto = donation.image_urls?.[0];
            return (
              <div className="rounded-xl bg-sky-50 border border-sky-200 p-3.5 space-y-2">
                <p className="text-xs font-semibold text-sky-900 uppercase">On the way 🚐</p>
                <p className="text-sm text-slate-700">
                  <span className="font-semibold">{confirmedVolunteerName}</span>
                  {confirmedVolunteerPhone && (
                    <>
                      {' · '}
                      <a href={`tel:${confirmedVolunteerPhone}`} className="text-sky-700 font-semibold">
                        {confirmedVolunteerPhone}
                      </a>
                    </>
                  )}
                </p>
                {pickupPhoto && (
                  <div>
                    <p className="text-xs text-sky-700 mb-1">Pickup photo:</p>
                    <img
                      src={pickupPhoto}
                      alt="Pickup photo"
                      className="w-full h-32 object-cover rounded-lg border border-sky-200"
                    />
                  </div>
                )}
                {/* Allow rejection even while in transit */}
                <button
                  type="button"
                  onClick={() => setOpenDialog({ donationId: donation.id, mode: 'reject' })}
                  className="mt-1 px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-xs font-semibold hover:bg-rose-50 transition-colors"
                >
                  Reject food
                </button>
              </div>
            );
          }

          if (donation.status === 'DELIVERED') {
            // Pick the last image_url as proof (volunteer uploaded it on mark_delivered)
            const proofUrl =
              donation.image_urls?.length > 0
                ? donation.image_urls[donation.image_urls.length - 1]
                : null;
            return (
              <div className="rounded-xl bg-purple-50 border border-purple-200 p-3.5 space-y-2">
                <p className="text-xs font-semibold text-purple-900 uppercase">Delivered — awaiting your confirmation</p>
                <p className="text-sm text-slate-700">
                  Delivered by{' '}
                  <span className="font-semibold">{confirmedVolunteerName}</span>
                  {confirmedVolunteerPhone && (
                    <span className="text-slate-500"> ({confirmedVolunteerPhone})</span>
                  )}
                </p>

                <ProofImage url={proofUrl} label="Delivery proof" />

                <div className="flex gap-2 pt-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setOpenDialog({ donationId: donation.id, mode: 'receipt' })}
                    className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
                  >
                    ✓ Confirm receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenDialog({ donationId: donation.id, mode: 'reject' })}
                    className="flex-1 py-2 rounded-xl border border-rose-300 text-rose-700 text-xs font-semibold hover:bg-rose-50 transition-colors"
                  >
                    Reject food
                  </button>
                </div>
              </div>
            );
          }

          return null; // ACCEPTED / ASSIGNED — handled by renderAssignmentBlock below
        }

        // ── Assignment status block (unchanged logic from Step 9) ─────────
        function renderAssignmentBlock() {
          if (isVolunteerConfirmed) {
            return (
              <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-indigo-900">
                  <span className="font-semibold">
                    {confirmedVolunteerName} will pick this up
                  </span>
                  {confirmedVolunteerPhone && (
                    <span className="ml-2 text-indigo-700">({confirmedVolunteerPhone})</span>
                  )}
                </div>

                {donation.status === 'ASSIGNED' && (
                  <button
                    type="button"
                    onClick={() => onChangeVolunteer(donation)}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg border border-indigo-300 bg-white text-indigo-800 text-xs font-semibold hover:bg-indigo-100 disabled:opacity-60"
                  >
                    {isBusy ? 'Updating...' : 'Change volunteer'}
                  </button>
                )}
              </div>
            );
          }

          if (latestAssignment?.status === 'requested') {
            if (countdown.isTimedOut) {
              return (
                <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-rose-800">
                    No response (timed out) — {latestVolunteerName} did not respond within 15m
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenAssignModal(donation)}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
                    >
                      Assign volunteer
                    </button>
                    <button
                      type="button"
                      onClick={() => onCancelAssignment(donation)}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-60"
                    >
                      {isBusy ? 'Cancelling...' : 'Cancel request'}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                className={`rounded-xl border px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 ${
                  countdown.isUrgent ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`font-semibold ${countdown.isUrgent ? 'text-rose-800' : 'text-amber-900'}`}>
                    Waiting for {latestVolunteerName} to respond
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-md font-semibold ${
                      countdown.isUrgent ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {countdown.text}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onCancelAssignment(donation)}
                  disabled={isBusy}
                  className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-900 text-xs font-semibold hover:bg-amber-100 disabled:opacity-60"
                >
                  {isBusy ? 'Cancelling...' : 'Cancel request'}
                </button>
              </div>
            );
          }

          if (latestAssignment && ['declined', 'timed_out', 'cancelled'].includes(latestAssignment.status)) {
            const reasonText =
              latestAssignment.status === 'declined'
                ? `${latestVolunteerName} declined the assignment.`
                : latestAssignment.status === 'timed_out'
                ? `Request to ${latestVolunteerName} timed out.`
                : 'Previous volunteer request was cancelled.';

            return (
              <div className="rounded-xl bg-slate-100 border border-slate-200 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-medium text-slate-700">{reasonText}</span>
                {donation.status === 'ACCEPTED' && (
                  <button
                    type="button"
                    onClick={() => onOpenAssignModal(donation)}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
                  >
                    Assign another volunteer
                  </button>
                )}
              </div>
            );
          }

          return (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600">No volunteer assigned</span>
              {donation.status === 'ACCEPTED' && (
                <button
                  type="button"
                  onClick={() => onOpenAssignModal(donation)}
                  disabled={isBusy}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
                >
                  Assign volunteer
                </button>
              )}
            </div>
          );
        }

        return (
          <article
            key={donation.id}
            className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4"
          >
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="space-y-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-lg">{donation.title}</h3>
                  <StatusBadge status={donation.status} />
                </div>

                <p className="text-sm text-slate-700">
                  <span className="font-semibold">{donation.quantity} {donation.unit}</span>{' '}
                  • {donation.category} • {donation.food_type}
                </p>

                <div className="text-sm text-slate-600 space-y-1">
                  <p>
                    <span className="font-medium text-slate-800">Donor:</span> {donorName} •{' '}
                    <span className="font-medium text-slate-800">Phone:</span> {donorPhone}
                  </p>
                  <p>
                    <span className="font-medium text-slate-800">Pickup address:</span>{' '}
                    {donation.address}
                  </p>
                  <p className="text-xs text-slate-500">
                    Pickup window: {formatDateTime(donation.pickup_start)} →{' '}
                    {formatDateTime(donation.pickup_end)}
                  </p>

                  {donation.assigned_volunteer_id && (
                    <p className="text-xs text-indigo-800">
                      Assigned volunteer:{' '}
                      <span className="font-semibold">{assignedVolunteer?.name || 'Volunteer'}</span>
                      {assignedVolunteer?.phone && ` (${assignedVolunteer.phone})`}
                    </p>
                  )}
                </div>
              </div>

              {canRelease && (
                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={() => onRelease(donation)}
                    disabled={isBusy}
                    className="px-4 py-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs font-semibold hover:bg-amber-100 disabled:opacity-60 transition-colors"
                  >
                    {isBusy ? 'Releasing...' : 'Release donation'}
                  </button>
                </div>
              )}
            </div>

            {/* Show delivery-stage UI for PICKED_UP / DELIVERED; otherwise show assignment block */}
            {['PICKED_UP', 'DELIVERED'].includes(donation.status)
              ? renderDeliveryBlock()
              : renderAssignmentBlock()}

            {/* Dialogs (rendered inside the article so z-index stacks correctly) */}
            {dialogOpen && openDialog.mode === 'receipt' && (
              <ConfirmReceiptDialog
                donation={donation}
                onClose={() => setOpenDialog(null)}
                onSuccess={(msg) => {
                  setOpenDialog(null);
                  if (onActionSuccess) onActionSuccess(msg);
                }}
              />
            )}
            {dialogOpen && openDialog.mode === 'reject' && (
              <RejectDialog
                donation={donation}
                onClose={() => setOpenDialog(null)}
                onSuccess={(msg) => {
                  setOpenDialog(null);
                  if (onActionSuccess) onActionSuccess(msg);
                }}
              />
            )}
          </article>
        );
      })}
    </div>
  );
}
