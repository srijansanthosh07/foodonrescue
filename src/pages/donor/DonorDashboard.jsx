import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import DonorNavbar from '../../components/DonorNavbar';
import StatusBadge from '../../components/StatusBadge';
import LiveStatus from '../../components/LiveStatus';
import { useToast } from '../../components/ToastProvider';
import useRealtimeRefresh from '../../hooks/useRealtimeRefresh';

// Statuses counted as currently active in the rescue pipeline
const ACTIVE_STATUSES = ['AVAILABLE', 'ACCEPTED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED'];

// Statuses where the donor is still allowed to cancel the donation
const CANCELLABLE_STATUSES = ['AVAILABLE', 'ACCEPTED', 'ASSIGNED'];

// Statuses where a volunteer name should be visible to the donor
const ASSIGNED_ONWARD_STATUSES = ['ASSIGNED', 'PICKED_UP', 'DELIVERED', 'COMPLETED'];

// Format date/time cleanly for display
function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// Confirmed quantity: support both possible column names from the database.
function getReceivedQuantity(donation) {
  const value = donation.received_quantity ?? donation.received_qty;
  return value == null ? null : Number(value);
}

// The volunteer adds the delivery proof as the last image on the donation.
function getProofUrl(donation) {
  if (!['DELIVERED', 'COMPLETED'].includes(donation.status)) return null;
  const images = donation.image_urls || [];
  return images.length ? images[images.length - 1] : null;
}

// ─── Timeline expander ────────────────────────────────────────────────────────
// Shows the donation_events audit trail for a single donation.
// Events are loaded lazily on first open so we don't over-fetch.
function TimelineExpander({ donationId }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState(null); // null = not yet loaded
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  async function loadEvents() {
    if (events !== null) return; // already loaded
    setLoading(true);
    setLoadError('');
    // donation_events is the immutable history of every status change.
    const { data, error } = await supabase
      .from('donation_events')
      .select('*')
      .eq('donation_id', donationId)
      .order('created_at', { ascending: true });
    setLoading(false);
    if (error) {
      setLoadError('Could not load the timeline. Please try again.');
    } else {
      setEvents(data || []);
    }
  }

  async function handleToggle() {
    if (!open) await loadEvents();
    setOpen((v) => !v);
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleToggle}
        className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1 transition-colors"
      >
        {open ? '▾' : '▸'} Timeline
      </button>

      {open && (
        <div className="mt-2 ml-2 border-l-2 border-slate-200 pl-3 space-y-2">
          {loading && <p className="text-xs text-slate-400 animate-pulse">Loading…</p>}
          {loadError && <p className="text-xs text-rose-600">{loadError}</p>}
          {events?.length === 0 && (
            <p className="text-xs text-slate-400">No events recorded yet.</p>
          )}
          {events?.map((ev) => (
            <div key={ev.id} className="text-xs text-slate-600 space-y-0.5">
              <p className="text-slate-400">{formatDateTime(ev.created_at)}</p>
              <p>
                {ev.from_status ? (
                  <>
                    <span className="font-medium">{ev.from_status}</span>
                    {' → '}
                    <span className="font-medium">{ev.to_status}</span>
                  </>
                ) : (
                  <span className="font-medium">{ev.to_status || '—'}</span>
                )}
                {ev.note && <span className="text-slate-500"> — {ev.note}</span>}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DonorDashboard() {
  const { user, profile } = useAuth();
  const { addToast } = useToast();

  const [donations, setDonations] = useState([]);
  // Lookup table of { [profileId]: { id, name, org_name, phone } } for NGO & Volunteer names
  const [profileMap, setProfileMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [cancellingId, setCancellingId] = useState(null);

  const fetchDonations = useCallback(async ({ silent = false } = {}) => {
    if (!user?.id) return;

    if (!silent) setLoading(true);
    setErrorMessage('');

    try {
      // 1. Load this donor's donations, newest first
      const { data, error } = await supabase
        .from('donations')
        .select('*')
        .eq('donor_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        const message = error.message || 'Failed to load donations.';
        setErrorMessage(message);
        if (!silent) addToast(message, 'error');
        setDonations([]);
        return;
      }

      const rows = data || [];
      setDonations(rows);

      // 2. Collect unique NGO and Volunteer IDs so we can show their names + phone
      const relatedIds = [
        ...new Set(
          rows
            .flatMap((d) => [d.accepted_by_ngo_id, d.assigned_volunteer_id])
            .filter(Boolean)
        ),
      ];

      if (relatedIds.length > 0) {
        const { data: relatedProfiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, name, org_name, phone')
          .in('id', relatedIds);

        if (profilesError) {
          const message = profilesError.message || 'Could not load NGO or volunteer names.';
          setErrorMessage(message);
          if (!silent) addToast(message, 'error');
        }

        const nextMap = {};
        (relatedProfiles || []).forEach((p) => {
          nextMap[p.id] = p;
        });
        setProfileMap(nextMap);
      } else {
        setProfileMap({});
      }
    } catch (err) {
      const message = err.message || 'Unexpected error while loading donations.';
      setErrorMessage(message);
      if (!silent) addToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [user?.id, addToast]);

  // Initial load, 30-second polling fallback, and refetch when tab becomes visible
  useEffect(() => {
    fetchDonations();

    const refreshInterval = setInterval(() => {
      fetchDonations({ silent: true });
    }, 30_000);

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        fetchDonations({ silent: true });
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchDonations]);

  // Realtime updates for donation status changes (poll remains as fallback).
  const realtimeStatus = useRealtimeRefresh(['donations'], () => {
    fetchDonations({ silent: true });
  });

  // Cancel a donation by sending ONLY { status: 'CANCELLED' }
  async function handleCancel(donation) {
    const confirmed = window.confirm(
      `Cancel "${donation.title}"? Matched NGOs and volunteers will no longer see it as active.`
    );
    if (!confirmed) return;

    setCancellingId(donation.id);
    setErrorMessage('');

    try {
      const { error } = await supabase
        .from('donations')
        .update({ status: 'CANCELLED' })
        .eq('id', donation.id);

      if (error) {
        const message = `Could not cancel donation: ${error.message}`;
        setErrorMessage(message);
        addToast(message, 'error');
        return;
      }

      await fetchDonations();
    } catch (err) {
      const message = err.message || 'Unexpected error cancelling donation.';
      setErrorMessage(message);
      addToast(message, 'error');
    } finally {
      setCancellingId(null);
    }
  }

  // ── Stats cards ──────────────────────────────────────────────────────────────
  const totalDonations = donations.length;
  const activeDonations = donations.filter((d) => ACTIVE_STATUSES.includes(d.status)).length;
  const completedRows  = donations.filter((d) => d.status === 'COMPLETED');
  const completedCount = completedRows.length;
  // Count only the amount the NGO actually confirmed as received.
  const totalQuantityCompleted = completedRows.reduce(
    (sum, d) => sum + (getReceivedQuantity(d) || 0),
    0
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <DonorNavbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Page heading + actions */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">Donor Dashboard</h1>
              <LiveStatus status={realtimeStatus} />
            </div>
            <p className="text-sm text-slate-600">
              Welcome back, <span className="font-semibold">{profile?.name || user?.email}</span>.
              Manage your surplus food donations below.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchDonations}
              disabled={loading}
              className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 transition-colors"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <Link
              to="/donor/create"
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm"
            >
              + New donation
            </Link>
          </div>
        </div>

        {/* Error banner */}
        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800"
          >
            {errorMessage}
          </div>
        )}

        {/* Stats cards */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Total Donations</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{totalDonations}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Active</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{activeDonations}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Completed</p>
            <p className="text-2xl font-bold text-green-700 mt-1">{completedCount}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Quantity Received</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{totalQuantityCompleted}</p>
            <p className="text-xs text-slate-400 mt-0.5">actual received by NGOs</p>
          </div>
        </section>

        {/* Donations list */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Your Donations</h2>
            <span className="text-xs text-slate-500">Newest first</span>
          </div>

          {loading ? (
            <div className="p-10 text-center space-y-2">
              <div className="w-7 h-7 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-slate-600">Loading your donations...</p>
            </div>
          ) : donations.length === 0 ? (
            <div className="p-10 text-center space-y-4">
              <p className="text-slate-700 font-medium">You have not posted any donations yet.</p>
              <p className="text-sm text-slate-500">
                Share surplus food with nearby verified NGOs in under 2 minutes.
              </p>
              <Link
                to="/donor/create"
                className="inline-block px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
              >
                Create your first donation
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {donations.map((donation) => {
                const ngo = donation.accepted_by_ngo_id
                  ? profileMap[donation.accepted_by_ngo_id]
                  : null;
                const volunteer = donation.assigned_volunteer_id
                  ? profileMap[donation.assigned_volunteer_id]
                  : null;
                const canCancel = CANCELLABLE_STATUSES.includes(donation.status);
                const thumbUrl = donation.image_urls?.[0];

                // Delivery proof is the last image uploaded by the volunteer.
                const proofUrl = getProofUrl(donation);

                return (
                  <div
                    key={donation.id}
                    className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      {/* Left side: thumbnail + food details */}
                      <div className="flex items-start gap-4 min-w-0">
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={donation.title}
                            className="w-16 h-16 rounded-xl object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-xs text-slate-400 shrink-0">
                            No image
                          </div>
                        )}

                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-slate-900 truncate">
                              {donation.title}
                            </h3>
                            <StatusBadge
                              status={donation.status}
                              label={donation.status === 'EXPIRED' ? 'Expired' : undefined}
                            />
                          </div>

                          <p className="text-sm text-slate-600">
                            <span className="font-medium text-slate-800">
                              {donation.quantity} {donation.unit}
                            </span>{' '}
                            • {donation.category} • {donation.food_type}
                          </p>

                          {/* Expiry — shown for all; clearly labelled EXPIRED */}
                          <p className="text-xs text-slate-500">
                            {donation.status === 'EXPIRED' ? (
                              <span className="text-rose-600 font-semibold">
                                Expired: {formatDateTime(donation.expires_at)}
                              </span>
                            ) : (
                              <>Expires: {formatDateTime(donation.expires_at)}</>
                            )}
                          </p>

                          {/* NGO name */}
                          {(ngo || donation.accepted_by_ngo_id) && (
                            <p className="text-xs text-sky-800">
                              NGO:{' '}
                              <span className="font-semibold">
                                {ngo?.org_name || ngo?.name || 'Accepted'}
                              </span>
                            </p>
                          )}

                          {/* Volunteer name */}
                          {ASSIGNED_ONWARD_STATUSES.includes(donation.status) &&
                            (volunteer || donation.assigned_volunteer_id) && (
                              <p className="text-xs text-indigo-800">
                                Volunteer:{' '}
                                <span className="font-semibold">
                                  {volunteer?.name || 'Assigned'}
                                </span>
                              </p>
                            )}

                          {/* Received quantity (COMPLETED) */}
                          {donation.status === 'COMPLETED' && getReceivedQuantity(donation) != null && (
                            <p className="text-xs text-emerald-800 font-semibold">
                              ✓ Received: {getReceivedQuantity(donation)} {donation.unit}
                            </p>
                          )}

                          {/* Delivery proof photo (DELIVERED / COMPLETED) */}
                          {proofUrl && (
                            <div className="mt-2 max-w-xs">
                              <p className="text-xs text-slate-500 mb-1">Delivery proof:</p>
                              <img
                                src={proofUrl}
                                alt="Delivery proof"
                                className="w-full h-28 object-cover rounded-xl border border-slate-200"
                              />
                            </div>
                          )}

                          {/* Rejection reason (REJECTED) — read from donation_events lazily */}
                          {donation.status === 'REJECTED' && (
                            <RejectionReasonInline donationId={donation.id} />
                          )}

                          {/* Timeline expander — always available, loads on click */}
                          <TimelineExpander donationId={donation.id} />
                        </div>
                      </div>

                      {/* Right side: Cancel button (only for AVAILABLE/ACCEPTED/ASSIGNED) */}
                      <div className="flex items-start gap-2 shrink-0">
                        {canCancel && (
                          <button
                            type="button"
                            onClick={() => handleCancel(donation)}
                            disabled={cancellingId === donation.id}
                            className="px-3.5 py-2 rounded-xl border border-rose-300 text-rose-700 text-xs font-semibold hover:bg-rose-50 disabled:opacity-60 transition-colors"
                          >
                            {cancellingId === donation.id ? 'Cancelling...' : 'Cancel'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// ─── Inline rejection reason (lazy-loaded from donation_events) ───────────────
// Separated into its own component so each card handles its own fetch independently.
function RejectionReasonInline({ donationId }) {
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
          // Strip the prefix so we just show the reason itself
          setReason(data[0].note.replace(/^Rejected on arrival[:\s]*/i, ''));
        } else {
          setReason('No reason recorded');
        }
      });
  }, [donationId]);

  return (
    <p className="text-xs text-rose-700">
      Rejected:{' '}
      <span className="font-medium">{reason ?? 'Loading reason…'}</span>
    </p>
  );
}
