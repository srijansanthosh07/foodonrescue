import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { haversineKm } from '../../utils/geo';
import NgoNavbar from '../../components/NgoNavbar';
import AvailableDonationsTab from '../../components/ngo/AvailableDonationsTab';
import AcceptedDonationsTab from '../../components/ngo/AcceptedDonationsTab';
import HistoryDonationsTab from '../../components/ngo/HistoryDonationsTab';
import VolunteerPickerModal from '../../components/ngo/VolunteerPickerModal';
import LiveStatus from '../../components/LiveStatus';
import useRealtimeRefresh from '../../hooks/useRealtimeRefresh';
import { useToast } from '../../components/ToastProvider';

const ACCEPTED_STATUSES = ['ACCEPTED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED'];
const HISTORY_STATUSES = ['COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED'];
const AUTO_REFRESH_MS = 30000;

export default function NgoDashboard() {
  const { user, profile } = useAuth();
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState('available'); // 'available' | 'accepted' | 'history'
  const [showAllDistances, setShowAllDistances] = useState(false);

  const [availableRows, setAvailableRows] = useState([]);
  const [dismissals, setDismissals] = useState([]);
  const [acceptedRows, setAcceptedRows] = useState([]);
  const [historyRows, setHistoryRows] = useState([]);
  const [volunteerMap, setVolunteerMap] = useState({});
  const [latestAssignmentMap, setLatestAssignmentMap] = useState({});

  // Donation currently open in the Volunteer Picker modal
  const [pickerDonation, setPickerDonation] = useState(null);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());

  const isVerified = profile?.verification_status === 'verified';
  const radiusKm = Number(profile?.service_radius_km) || 10;
  const hasNgoLocation =
    typeof profile?.lat === 'number' && typeof profile?.lng === 'number';

  // Turn raw Supabase RPC errors into beginner-friendly text
  function formatRpcError(message) {
    if (!message) return 'Action failed. Please try again.';
    const lower = message.toLowerCase();
    if (
      lower.includes('not available') ||
      lower.includes('already accepted') ||
      lower.includes('no longer available')
    ) {
      return 'Another NGO accepted this first.';
    }
    if (lower.includes('verified')) {
      return 'Your NGO must be verified by an admin before accepting donations.';
    }
    return message;
  }

  function showError(message) {
    setErrorMessage(message);
    addToast(message, 'error');
  }

  const fetchDashboardData = useCallback(
    async ({ silent = false } = {}) => {
      if (!user?.id) return;

      if (!silent) {
        setLoading(true);
      }
      setErrorMessage('');

      try {
        const nowIso = new Date().toISOString();

        // Fetch all NGO tabs and dismissals in parallel
        const [availableRes, dismissalsRes, acceptedRes, historyRes] = await Promise.all([
          supabase
            .from('donations')
            .select('*, donor:profiles!donations_donor_id_fkey(name, org_name, address)')
            .eq('status', 'AVAILABLE')
            .gt('expires_at', nowIso)
            .order('expires_at', { ascending: true }),
          supabase
            .from('donation_dismissals')
            .select('id, donation_id')
            .eq('ngo_id', user.id),
          supabase
            .from('donations')
            .select('*, donor:profiles!donations_donor_id_fkey(name, org_name, phone, address)')
            .eq('accepted_by_ngo_id', user.id)
            .in('status', ACCEPTED_STATUSES)
            .order('updated_at', { ascending: false }),
          supabase
            .from('donations')
            .select(
              '*, donor:profiles!donations_donor_id_fkey(name, org_name, address), volunteer:profiles!donations_assigned_volunteer_id_fkey(name, org_name)'
            )
            .eq('accepted_by_ngo_id', user.id)
            .in('status', HISTORY_STATUSES)
            .order('created_at', { ascending: false }),
        ]);

        if (availableRes.error) throw availableRes.error;
        if (dismissalsRes.error) throw dismissalsRes.error;
        if (acceptedRes.error) throw acceptedRes.error;
        if (historyRes.error) throw historyRes.error;

        const nextAvailable = availableRes.data || [];
        const nextDismissals = dismissalsRes.data || [];
        const nextAccepted = acceptedRes.data || [];
        const nextHistory = historyRes.data || [];

        setAvailableRows(nextAvailable);
        setDismissals(nextDismissals);
        setAcceptedRows(nextAccepted);
        setHistoryRows(nextHistory);

        // Fetch assigned volunteer profiles (name & phone) + latest assignment per accepted donation
        const volunteerIds = [
          ...new Set(nextAccepted.map((d) => d.assigned_volunteer_id).filter(Boolean)),
        ];

        const [volProfilesRes, latestAssignmentsList] = await Promise.all([
          volunteerIds.length > 0
            ? supabase.from('profiles').select('id, name, phone').in('id', volunteerIds)
            : Promise.resolve({ data: [] }),
          Promise.all(
            nextAccepted.map(async (donation) => {
              const { data, error } = await supabase
                .from('assignments')
                .select('*, volunteer:profiles!assignments_volunteer_id_fkey(name, phone)')
                .eq('donation_id', donation.id)
                .order('requested_at', { ascending: false })
                .limit(1);

              // If this lookup fails, show the same error banner as the main lists
              if (error) throw error;
              return [donation.id, data?.[0] || null];
            })
          ),
        ]);

        // Also surface errors from the volunteer profile lookup
        if (volProfilesRes.error) throw volProfilesRes.error;

        const nextVolMap = {};
        (volProfilesRes.data || []).forEach((v) => {
          nextVolMap[v.id] = v;
        });
        setVolunteerMap(nextVolMap);

        const nextAssignMap = {};
        latestAssignmentsList.forEach(([donationId, latestRow]) => {
          nextAssignMap[donationId] = latestRow;
        });
        setLatestAssignmentMap(nextAssignMap);
      } catch (err) {
        const message = err.message || 'Failed to load NGO dashboard data.';
        setErrorMessage(message);
        if (!silent) addToast(message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [user?.id, addToast]
  );

  // Initial load + automatic refresh every 30s + 1s clock tick for countdowns
  useEffect(() => {
    fetchDashboardData();

    const refreshInterval = setInterval(() => {
      fetchDashboardData({ silent: true });
    }, AUTO_REFRESH_MS);

    const clockInterval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        fetchDashboardData({ silent: true });
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(clockInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchDashboardData]);

  // Realtime updates for donations and assignments (poll remains as fallback).
  const realtimeStatus = useRealtimeRefresh(['donations', 'assignments'], () => {
    fetchDashboardData({ silent: true });
  });

  // Compute distance, filter dismissed + radius, and sort (soonest expiry, then distance)
  const { visibleAvailable, dismissedWithDetails } = useMemo(() => {
    const dismissedSet = new Set(dismissals.map((d) => d.donation_id));
    const availableById = {};

    const enriched = availableRows.map((d) => {
      const distanceKm = hasNgoLocation
        ? haversineKm(profile.lat, profile.lng, d.lat, d.lng)
        : null;
      const item = { ...d, distanceKm };
      availableById[d.id] = item;
      return item;
    });

    const filtered = enriched
      .filter((d) => {
        if (dismissedSet.has(d.id)) return false;
        if (showAllDistances) return true;
        if (!hasNgoLocation) return false;
        return d.distanceKm !== null && d.distanceKm <= radiusKm;
      })
      .sort((a, b) => {
        const expDiff = new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime();
        if (expDiff !== 0) return expDiff;
        return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      });

    const hiddenList = dismissals.map((row) => ({
      dismissalId: row.id,
      donationId: row.donation_id,
      donation: availableById[row.donation_id] || null,
    }));

    return { visibleAvailable: filtered, dismissedWithDetails: hiddenList };
  }, [availableRows, dismissals, hasNgoLocation, profile?.lat, profile?.lng, radiusKm, showAllDistances]);

  // Accept a donation atomically via Supabase RPC
  async function handleAccept(donation) {
    if (!isVerified) return;

    const confirmed = window.confirm(
      `Accept "${donation.title}" (${donation.quantity} ${donation.unit})?`
    );
    if (!confirmed) return;

    setBusyId(donation.id);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const { error } = await supabase.rpc('accept_donation', {
        p_donation_id: donation.id,
      });

      if (error) {
        showError(formatRpcError(error.message));
        await fetchDashboardData({ silent: true });
        return;
      }

      setSuccessMessage(`Accepted "${donation.title}". You can manage it under "My accepted".`);
      await fetchDashboardData({ silent: true });
    } catch (err) {
      showError(formatRpcError(err.message));
      await fetchDashboardData({ silent: true });
    } finally {
      setBusyId(null);
    }
  }

  // Dismiss a donation ("Not for us") by inserting into donation_dismissals
  async function handleDismiss(donationId) {
    setBusyId(donationId);
    setErrorMessage('');

    try {
      const { data, error } = await supabase
        .from('donation_dismissals')
        .insert([{ ngo_id: user.id, donation_id: donationId }])
        .select('id, donation_id')
        .single();

      if (error) {
        showError(`Could not dismiss donation: ${error.message}`);
        return;
      }

      setDismissals((prev) => [...prev, data]);
    } catch (err) {
      showError(err.message || 'Could not dismiss donation.');
    } finally {
      setBusyId(null);
    }
  }

  // Restore a dismissed donation by deleting its donation_dismissals row
  async function handleUndoDismiss(dismissalId) {
    setBusyId(dismissalId);
    setErrorMessage('');

    try {
      const { error } = await supabase
        .from('donation_dismissals')
        .delete()
        .eq('id', dismissalId);

      if (error) {
        showError(`Could not undo dismissal: ${error.message}`);
        return;
      }

      setDismissals((prev) => prev.filter((item) => item.id !== dismissalId));
    } catch (err) {
      showError(err.message || 'Could not undo dismissal.');
    } finally {
      setBusyId(null);
    }
  }

  // Release an ACCEPTED donation back to AVAILABLE via Supabase RPC
  async function handleRelease(donation) {
    const confirmed = window.confirm(
      `Release "${donation.title}" back so other NGOs can claim it?`
    );
    if (!confirmed) return;

    setBusyId(donation.id);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const { error } = await supabase.rpc('release_donation', {
        p_donation_id: donation.id,
      });

      if (error) {
        showError(`Could not release donation: ${error.message}`);
        return;
      }

      setSuccessMessage(`Released "${donation.title}" back to Available.`);
      await fetchDashboardData({ silent: true });
    } catch (err) {
      showError(err.message || 'Could not release donation.');
    } finally {
      setBusyId(null);
    }
  }

  // Cancel a pending volunteer request via unassign_volunteer RPC
  async function handleCancelAssignment(donation) {
    const confirmed = window.confirm(
      `Cancel the volunteer request for "${donation.title}"?`
    );
    if (!confirmed) return;

    setBusyId(donation.id);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const { error } = await supabase.rpc('unassign_volunteer', {
        p_donation_id: donation.id,
      });

      if (error) {
        showError(`Could not cancel request: ${error.message}`);
        return;
      }

      setSuccessMessage(`Volunteer request cancelled for "${donation.title}".`);
      await fetchDashboardData({ silent: true });
    } catch (err) {
      showError(err.message || 'Could not cancel request.');
    } finally {
      setBusyId(null);
    }
  }

  // Unassign the current volunteer after confirm, then reopen the Volunteer Picker modal
  async function handleChangeVolunteer(donation) {
    const confirmed = window.confirm(
      `Unassign the current volunteer from "${donation.title}" and choose another?`
    );
    if (!confirmed) return;

    setBusyId(donation.id);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const { error } = await supabase.rpc('unassign_volunteer', {
        p_donation_id: donation.id,
      });

      if (error) {
        showError(`Could not unassign volunteer: ${error.message}`);
        return;
      }

      await fetchDashboardData({ silent: true });
      setPickerDonation(donation);
    } catch (err) {
      showError(err.message || 'Could not unassign volunteer.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleVolunteerAssigned(message) {
    setPickerDonation(null);
    setSuccessMessage(message);
    await fetchDashboardData({ silent: true });
  }

  // Confirm receipt / reject on arrival both finish the delivery flow.
  // Show a friendly success message, then reload all NGO lists so the card
  // moves from "My accepted" into "History" straight away.
  async function handleDeliveryActionSuccess(message) {
    setErrorMessage('');
    setSuccessMessage(message);
    await fetchDashboardData({ silent: true });
  }

  function tabButtonClass(tabKey) {
    return `px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
      activeTab === tabKey
        ? 'bg-emerald-600 text-white shadow-sm'
        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
    }`;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <NgoNavbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Verification status banner */}
        {!isVerified && (
          <div className="rounded-2xl bg-amber-50 border border-amber-300 px-5 py-4 text-sm text-amber-900 font-medium">
            Your NGO is pending admin verification. You can browse, but you cannot accept donations
            yet.
          </div>
        )}

        {/* Header + Refresh */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">NGO Dashboard</h1>
              <LiveStatus status={realtimeStatus} />
            </div>
            <p className="text-sm text-slate-600">
              {profile?.org_name || profile?.name || user?.email} • Auto-refreshes every 30 seconds
            </p>
          </div>

          <button
            type="button"
            onClick={() => fetchDashboardData()}
            disabled={loading}
            className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 transition-colors"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Success / Error alerts */}
        {successMessage && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
            {successMessage}
          </div>
        )}
        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800"
          >
            {errorMessage}
          </div>
        )}

        {/* Three Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('available')}
            className={tabButtonClass('available')}
          >
            Available nearby ({visibleAvailable.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('accepted')}
            className={tabButtonClass('accepted')}
          >
            My accepted ({acceptedRows.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={tabButtonClass('history')}
          >
            History ({historyRows.length})
          </button>
        </div>

        {/* Loading state or active tab content */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-2">
            <div className="w-7 h-7 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-slate-600">Loading NGO donations...</p>
          </div>
        ) : activeTab === 'available' ? (
          <AvailableDonationsTab
            donations={visibleAvailable}
            dismissedDonations={dismissedWithDetails}
            isVerified={isVerified}
            hasNgoLocation={hasNgoLocation}
            radiusKm={radiusKm}
            showAllDistances={showAllDistances}
            onToggleShowAllDistances={setShowAllDistances}
            nowMs={nowMs}
            busyId={busyId}
            onAccept={handleAccept}
            onDismiss={handleDismiss}
            onUndoDismiss={handleUndoDismiss}
          />
        ) : activeTab === 'accepted' ? (
          <AcceptedDonationsTab
            donations={acceptedRows}
            volunteerMap={volunteerMap}
            latestAssignmentMap={latestAssignmentMap}
            nowMs={nowMs}
            busyId={busyId}
            onOpenAssignModal={setPickerDonation}
            onCancelAssignment={handleCancelAssignment}
            onChangeVolunteer={handleChangeVolunteer}
            onRelease={handleRelease}
            onActionSuccess={handleDeliveryActionSuccess}
          />
        ) : (
          <HistoryDonationsTab donations={historyRows} />
        )}
      </main>

      {/* Volunteer Picker Modal */}
      {pickerDonation && (
        <VolunteerPickerModal
          donation={pickerDonation}
          onClose={() => setPickerDonation(null)}
          onAssigned={handleVolunteerAssigned}
        />
      )}
    </div>
  );
}
