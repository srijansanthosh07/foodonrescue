import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

import VolunteerNavbar from '../../components/VolunteerNavbar';
import RequestsSection from '../../components/volunteer/RequestsSection';
import MyTasksSection from '../../components/volunteer/MyTasksSection';
import HistorySection from '../../components/volunteer/HistorySection';
import LiveStatus from '../../components/LiveStatus';
import useRealtimeRefresh from '../../hooks/useRealtimeRefresh';
import { useToast } from '../../components/ToastProvider';

// ─── Availability options ───────────────────────────────────────────────────
// These map directly to what we store in profiles.availability
const AVAILABILITY_OPTIONS = [
  { value: 'available', label: 'Available', color: 'bg-emerald-600 text-white' },
  { value: 'busy',      label: 'Busy',      color: 'bg-amber-500 text-white'   },
  { value: 'offline',   label: 'Offline',   color: 'bg-slate-500 text-white'   },
];

export default function VolunteerDashboard() {
  const { user, profile } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  // ─── State ─────────────────────────────────────────────────────────────────
  const [requests,    setRequests]    = useState([]); // incoming assignment requests
  const [activeTasks, setActiveTasks] = useState([]); // ASSIGNED or PICKED_UP donations
  const [historyTasks,setHistoryTasks]= useState([]); // DELIVERED / COMPLETED / REJECTED

  const [availability, setAvailability] = useState(profile?.availability || 'available');
  const [loading,      setLoading]      = useState(true);
  const [busyId,       setBusyId]       = useState(null); // id being submitted right now
  const [errorMsg,     setErrorMsg]     = useState('');
  const [successMsg,   setSuccessMsg]   = useState('');
  const [nowMs,        setNowMs]        = useState(Date.now()); // drives countdown timers

  // ─── Fetch all data ─────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!user) return;
    setErrorMsg('');

    try {
      // 1. Incoming requests (assignments where status = 'requested')
      const { data: assignmentRows, error: err1 } = await supabase
        .from('assignments')
        .select(
          '*, donation:donations(*), ngo:profiles!assignments_ngo_id_fkey(name, org_name, address, phone)'
        )
        .eq('volunteer_id', user.id)
        .eq('status', 'requested')
        .order('requested_at', { ascending: false });

      if (err1) throw err1;

      // 2. Active tasks (donations ASSIGNED or PICKED_UP to this volunteer)
      const { data: activeRows, error: err2 } = await supabase
        .from('donations')
        .select(
          '*, donor:profiles!donations_donor_id_fkey(name, org_name, address, phone, lat, lng), ngo:profiles!donations_accepted_by_ngo_id_fkey(name, org_name, address, phone, lat, lng)'
        )
        .eq('assigned_volunteer_id', user.id)
        .in('status', ['ASSIGNED', 'PICKED_UP'])
        .order('updated_at', { ascending: false });

      if (err2) throw err2;

      // 3. History (DELIVERED, COMPLETED, REJECTED) — newest first
      const { data: historyRows, error: err3 } = await supabase
        .from('donations')
        .select(
          '*, donor:profiles!donations_donor_id_fkey(name, org_name)'
        )
        .eq('assigned_volunteer_id', user.id)
        .in('status', ['DELIVERED', 'COMPLETED', 'REJECTED'])
        .order('created_at', { ascending: false });

      if (err3) throw err3;

      setRequests(assignmentRows || []);
      setActiveTasks(activeRows || []);
      setHistoryTasks(historyRows || []);
    } catch (err) {
      console.error('fetchData error:', err);
      const message = 'Failed to load data. Please refresh.';
      setErrorMsg(message);
      addToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [user, addToast]);

  // ─── Mount: initial fetch, 30s data refresh, 1s countdown tick ─────────────
  useEffect(() => {
    fetchData();

    // Refresh data every 30 seconds so the volunteer sees new requests quickly
    const dataTimer = setInterval(fetchData, 30_000);

    // Tick the clock every second so countdown badges stay accurate
    const clockTimer = setInterval(() => setNowMs(Date.now()), 1_000);

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(dataTimer);
      clearInterval(clockTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchData]);

  // Realtime updates for assignments and donations (poll remains as fallback).
  const realtimeStatus = useRealtimeRefresh(['assignments', 'donations'], () => {
    fetchData();
  });

  // Keep local availability in sync when the profile loads / changes
  useEffect(() => {
    if (profile?.availability) setAvailability(profile.availability);
  }, [profile?.availability]);

  // ─── Availability toggle ────────────────────────────────────────────────────
  async function handleAvailabilityChange(value) {
    if (value === availability) return;
    setAvailability(value);       // optimistic update
    setSuccessMsg('');
    setErrorMsg('');

    const { error } = await supabase
      .from('profiles')
      .update({ availability: value })
      .eq('id', user.id);

    if (error) {
      const message = 'Could not update availability. Please try again.';
      setErrorMsg(message);
      addToast(message, 'error');
      setAvailability(availability); // roll back
    } else {
      setSuccessMsg(`Availability set to "${value}".`);
      setTimeout(() => setSuccessMsg(''), 3_000);
    }
  }

  // ─── Respond to an assignment request (Accept / Decline) ───────────────────
  async function handleRespond(assignmentId, accept) {
    setBusyId(assignmentId);
    setErrorMsg('');
    setSuccessMsg('');

    const { error } = await supabase.rpc('respond_assignment', {
      p_assignment_id: assignmentId,
      p_accept: accept,
    });

    if (error) {
      const message =
        error.message?.includes('expired') || error.message?.includes('timed_out')
          ? 'This request has expired — the 15-minute window has passed.'
          : error.message || 'Failed to respond. Please try again.';
      setErrorMsg(message);
      addToast(message, 'error');
    } else {
      setSuccessMsg(accept ? 'Task accepted! Check your active tasks below.' : 'Request declined.');
      setTimeout(() => setSuccessMsg(''), 4_000);
    }

    setBusyId(null);
    fetchData(); // refresh all sections
  }

  // ─── Upload a photo to the delivery-proofs bucket ──────────────────────────
  // Returns the public URL string, or null if no file is provided.
  async function uploadProof(file) {
    if (!file) return null;

    // Clean the filename so Supabase Storage accepts it
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${user.id}/${Date.now()}-${cleanName}`;

    const { error: uploadError } = await supabase.storage
      .from('delivery-proofs')
      .upload(path, file, { upsert: false });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('delivery-proofs').getPublicUrl(path);
    return data.publicUrl;
  }

  // ─── Mark PICKED_UP ────────────────────────────────────────────────────────
  async function handlePickedUp(donationId, photoFile) {
    setBusyId(donationId);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      // Photo is optional for pickup
      const photoUrl = await uploadProof(photoFile);

      const { error } = await supabase.rpc('mark_picked_up', {
        p_donation_id: donationId,
        p_photo_url:   photoUrl || null,
      });

      if (error) throw error;

      setSuccessMsg('Marked as picked up! Now head to the NGO for delivery.');
      setTimeout(() => setSuccessMsg(''), 5_000);
      fetchData();
    } catch (err) {
      const message = err.message || 'Failed to mark as picked up.';
      setErrorMsg(message);
      addToast(message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  // ─── Mark DELIVERED ────────────────────────────────────────────────────────
  async function handleDelivered(donationId, photoFile) {
    setBusyId(donationId);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      // Photo is required for delivery — uploadProof will throw if the upload fails
      const proofUrl = await uploadProof(photoFile);

      if (!proofUrl) {
        throw new Error('A delivery proof photo is required.');
      }

      const { error } = await supabase.rpc('mark_delivered', {
        p_donation_id: donationId,
        p_proof_url:   proofUrl,
      });

      if (error) throw error;

      setSuccessMsg('Delivery confirmed! Great work 🎉');
      setTimeout(() => setSuccessMsg(''), 5_000);
      fetchData();
    } catch (err) {
      const message = err.message || 'Failed to confirm delivery.';
      setErrorMsg(message);
      addToast(message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  // ─── Can't make it (volunteer cancel) ──────────────────────────────────────
  async function handleCantMakeIt(donationId) {
    const confirmed = window.confirm(
      "Are you sure you can't make this pickup? The NGO will need to find another volunteer."
    );
    if (!confirmed) return;

    setBusyId(donationId);
    setErrorMsg('');

    const { error } = await supabase.rpc('volunteer_cancel_task', {
      p_donation_id: donationId,
    });

    if (error) {
      const message = error.message || 'Failed to cancel task. Please try again.';
      setErrorMsg(message);
      addToast(message, 'error');
    } else {
      setSuccessMsg('Task cancelled. The NGO has been notified.');
      setTimeout(() => setSuccessMsg(''), 4_000);
      fetchData();
    }

    setBusyId(null);
  }

  // ─── Derived stats ──────────────────────────────────────────────────────────
  const completedCount = historyTasks.filter(
    (d) => d.status === 'DELIVERED' || d.status === 'COMPLETED'
  ).length;
  const activeCount  = activeTasks.length;
  const pendingCount = requests.length;

  const volunteerLat = profile?.lat;
  const volunteerLng = profile?.lng;

  // ─── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <VolunteerNavbar />
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <p className="text-slate-500 animate-pulse">Loading your dashboard…</p>
        </div>
      </>
    );
  }

  return (
    <>
      <VolunteerNavbar />

      <main className="min-h-screen bg-slate-50 pb-16">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">

          {/* ── Header with live status ─────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-bold text-slate-900">Volunteer Dashboard</h1>
            <LiveStatus status={realtimeStatus} />
          </div>

          {/* ── Global messages ─────────────────────────────────────────────── */}
          {errorMsg && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-700 font-medium">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-700 font-medium">
              {successMsg}
            </div>
          )}

          {/* ── Availability toggle ──────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-bold text-slate-900">Your Availability</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Let NGOs know if you can take new tasks right now.
                </p>
              </div>

              {/* Three buttons — one per status */}
              <div className="flex gap-2">
                {AVAILABILITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleAvailabilityChange(opt.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors border ${
                      availability === opt.value
                        ? opt.color + ' border-transparent'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* ── Stat cards ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Completed',       value: completedCount, color: 'text-emerald-700' },
              { label: 'Active tasks',    value: activeCount,    color: 'text-sky-700'     },
              { label: 'Pending requests',value: pendingCount,   color: 'text-amber-700'   },
            ].map((card) => (
              <div
                key={card.label}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 text-center space-y-1"
              >
                <p className={`text-3xl font-extrabold ${card.color}`}>{card.value}</p>
                <p className="text-xs text-slate-500 leading-tight">{card.label}</p>
              </div>
            ))}
          </div>

          {/* ── Refresh button ───────────────────────────────────────────────── */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={fetchData}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              ↻ Refresh
            </button>
          </div>

          {/* ── Section 1: Incoming requests ─────────────────────────────────── */}
          <RequestsSection
            assignments={requests}
            volunteerLat={volunteerLat}
            volunteerLng={volunteerLng}
            nowMs={nowMs}
            busyId={busyId}
            onRespond={handleRespond}
          />

          {/* ── Section 2: Active tasks ──────────────────────────────────────── */}
          <MyTasksSection
            donations={activeTasks}
            busyId={busyId}
            onPickedUp={handlePickedUp}
            onDelivered={handleDelivered}
            onCantMakeIt={handleCantMakeIt}
          />

          {/* ── Section 3: History ───────────────────────────────────────────── */}
          <HistorySection donations={historyTasks} />

        </div>
      </main>
    </>
  );
}
