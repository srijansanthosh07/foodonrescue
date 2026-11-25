import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import AdminNavbar from '../../components/AdminNavbar';
import StatusBadge from '../../components/StatusBadge';
import LiveStatus from '../../components/LiveStatus';
import useRealtimeRefresh from '../../hooks/useRealtimeRefresh';
import { useToast } from '../../components/ToastProvider';

// Closed donations cannot be cancelled by the admin.
const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED'];

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// Some rows may use received_quantity, others received_qty. Support both.
function getReceivedQty(donation) {
  const value = donation.received_quantity ?? donation.received_qty;
  return value == null ? 0 : Number(value) || 0;
}

function displayPerson(person, fallback = '—') {
  return person?.org_name || person?.name || fallback;
}

function RoleBadge({ role }) {
  const colours = {
    donor: 'bg-emerald-100 text-emerald-800',
    ngo: 'bg-sky-100 text-sky-800',
    volunteer: 'bg-amber-100 text-amber-800',
    admin: 'bg-indigo-100 text-indigo-800',
  };
  return (
    <span
      className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
        colours[role] || 'bg-slate-100 text-slate-700'
      }`}
    >
      {role}
    </span>
  );
}

function VerifyBadge({ status }) {
  const colours = {
    pending: 'bg-amber-100 text-amber-800',
    verified: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-rose-100 text-rose-800',
  };
  return (
    <span
      className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
        colours[status] || 'bg-slate-100 text-slate-700'
      }`}
    >
      {status}
    </span>
  );
}

function EmptyState({ text }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
      <p className="text-slate-500">{text}</p>
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}

function StatCard({ label, value, color = 'text-slate-900', note }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-1">
      <p className="text-xs text-slate-500 uppercase font-medium">{label}</p>
      <p className={`text-2xl font-extrabold ${color}`}>{value}</p>
      {note && <p className="text-xs text-slate-400">{note}</p>}
    </div>
  );
}

// Lazy timeline for a donation row. Loaded only when the row is expanded.
function DonationTimeline({ donationId }) {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadEvents() {
      setLoading(true);
      setError('');
      // Join the actor profile so admins can see who made each status change.
      const { data, error: fetchError } = await supabase
        .from('donation_events')
        .select('*, actor:profiles!donation_events_actor_id_fkey(name, org_name)')
        .eq('donation_id', donationId)
        .order('created_at', { ascending: true });

      if (!mounted) return;
      if (fetchError) {
        setError(fetchError.message || 'Could not load timeline.');
        setEvents([]);
      } else {
        setEvents(data || []);
      }
      setLoading(false);
    }

    loadEvents();
    return () => {
      mounted = false;
    };
  }, [donationId]);

  if (loading) return <p className="text-xs text-slate-500 animate-pulse">Loading timeline…</p>;
  if (error) return <p className="text-xs text-rose-600">{error}</p>;
  if (!events.length) return <p className="text-xs text-slate-500">No timeline events found.</p>;

  return (
    <div className="space-y-2 border-l-2 border-slate-200 pl-3">
      {events.map((ev) => (
        <div key={ev.id} className="text-xs text-slate-600 space-y-0.5">
          <p className="text-slate-400">{formatDateTime(ev.created_at)}</p>
          <p>
            <span className="font-medium text-slate-700">{ev.from_status || '—'}</span>
            {' → '}
            <span className="font-medium text-slate-700">{ev.to_status || '—'}</span>
            {' · '}
            <span>{displayPerson(ev.actor, 'System')}</span>
          </p>
          {ev.note && <p className="text-slate-500">{ev.note}</p>}
        </div>
      ))}
    </div>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'ngo', label: 'NGO Verification' },
  { id: 'users', label: 'Users' },
  { id: 'donations', label: 'Donations' },
  { id: 'reports', label: 'Reports' },
];

export default function AdminDashboard() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const [tab, setTab] = useState('overview');
  const [profiles, setProfiles] = useState([]);
  const [donations, setDonations] = useState([]);
  const [reportEvents, setReportEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Users tab filters
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('ALL');

  // Donations tab filters
  const [donationSearch, setDonationSearch] = useState('');
  const [donationStatusFilter, setDonationStatusFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedDonationId, setExpandedDonationId] = useState(null);

  function showError(message) {
    setErrorMsg(message);
    addToast(message, 'error');
  }

  const fetchAll = useCallback(async ({ silent = false } = {}) => {
    setErrorMsg('');
    if (!silent) setLoading(true);

    try {
      // Load all profiles for overview/users/NGO verification.
      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select('id, role, name, phone, org_name, address, verification_status, suspended, created_at')
        .order('created_at', { ascending: false });
      if (profileError) throw profileError;

      // Load all donations with donor/NGO/volunteer names for admin tables/reports.
      const { data: donationRows, error: donationError } = await supabase
        .from('donations')
        .select(
          '*, donor:profiles!donations_donor_id_fkey(id, name, org_name), ngo:profiles!donations_accepted_by_ngo_id_fkey(id, name, org_name), volunteer:profiles!donations_assigned_volunteer_id_fkey(id, name, org_name)'
        )
        .order('created_at', { ascending: false });
      if (donationError) throw donationError;

      // Events are used for reports (response time).
      const { data: eventRows, error: eventError } = await supabase
        .from('donation_events')
        .select('id, donation_id, from_status, to_status, actor_id, note, created_at')
        .order('created_at', { ascending: true });
      if (eventError) throw eventError;

      setProfiles(profileRows || []);
      setDonations(donationRows || []);
      setReportEvents(eventRows || []);
    } catch (err) {
      console.error('Admin fetchAll error:', err);
      const message = err.message || 'Failed to load admin data.';
      setErrorMsg(message);
      if (!silent) addToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // Initial load, 30-second polling fallback, and refetch when tab becomes visible
  useEffect(() => {
    fetchAll();

    const refreshInterval = setInterval(() => {
      fetchAll({ silent: true });
    }, 30_000);

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        fetchAll({ silent: true });
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchAll]);

  // Realtime updates for admin lists (poll remains as fallback).
  const realtimeStatus = useRealtimeRefresh(['donations', 'assignments'], () => {
    fetchAll({ silent: true });
  });

  function flash(msg) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  }

  // ─── NGO verification ────────────────────────────────────────────────────
  async function handleVerifyNgo(ngoProfile, approve) {
    const actionLabel = approve ? 'Verify' : 'Reject';
    const confirmed = window.confirm(
      `${actionLabel} ${ngoProfile.org_name || ngoProfile.name || 'this NGO'}?`
    );
    if (!confirmed) return;

    setBusyId(ngoProfile.id);
    setErrorMsg('');
    try {
      // This RPC updates verification_status and handles related admin logic.
      const { error } = await supabase.rpc('admin_verify_ngo', {
        p_ngo_id: ngoProfile.id,
        p_approve: approve,
      });
      if (error) throw error;
      flash(approve ? 'NGO verified.' : 'NGO rejected.');
      await fetchAll();
    } catch (err) {
      showError(err.message || 'Could not update NGO verification.');
    } finally {
      setBusyId(null);
    }
  }

  // ─── Suspend / reactivate user ───────────────────────────────────────────
  async function handleToggleSuspend(profileRow) {
    if (profileRow.id === user?.id) {
      showError('You cannot suspend your own admin account.');
      return;
    }

    const nextSuspended = !profileRow.suspended;
    const action = nextSuspended ? 'Suspend' : 'Reactivate';
    const confirmed = window.confirm(`${action} ${profileRow.name || 'this user'}?`);
    if (!confirmed) return;

    setBusyId(profileRow.id);
    setErrorMsg('');
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ suspended: nextSuspended })
        .eq('id', profileRow.id);
      if (error) throw error;
      flash(`User ${nextSuspended ? 'suspended' : 'reactivated'}.`);
      await fetchAll();
    } catch (err) {
      showError(err.message || 'Could not update user suspension status.');
    } finally {
      setBusyId(null);
    }
  }

  // ─── Cancel donation ─────────────────────────────────────────────────────
  async function handleCancelDonation(donation) {
    const reason = window.prompt(`Reason for cancelling "${donation.title}"?`);
    if (reason === null) return; // user clicked cancel in prompt
    if (!reason.trim()) {
      showError('A reason is required to cancel a donation.');
      return;
    }

    setBusyId(donation.id);
    setErrorMsg('');
    try {
      // Admin cancellation must go through the RPC so events/notifications are recorded.
      const { error } = await supabase.rpc('admin_cancel_donation', {
        p_donation_id: donation.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      flash('Donation cancelled.');
      await fetchAll();
    } catch (err) {
      showError(err.message || 'Could not cancel donation.');
    } finally {
      setBusyId(null);
    }
  }

  // ─── Derived data ────────────────────────────────────────────────────────
  const ngoProfiles = useMemo(() => profiles.filter((p) => p.role === 'ngo'), [profiles]);
  const pendingNgos = useMemo(
    () => ngoProfiles.filter((p) => p.verification_status === 'pending'),
    [ngoProfiles]
  );
  const verifiedNgos = useMemo(
    () => ngoProfiles.filter((p) => p.verification_status === 'verified'),
    [ngoProfiles]
  );
  const rejectedNgos = useMemo(
    () => ngoProfiles.filter((p) => p.verification_status === 'rejected'),
    [ngoProfiles]
  );

  const countsByRole = useMemo(() => {
    const counts = { donor: 0, ngo: 0, volunteer: 0, admin: 0 };
    profiles.forEach((p) => {
      counts[p.role] = (counts[p.role] || 0) + 1;
    });
    return counts;
  }, [profiles]);

  const countsByStatus = useMemo(() => {
    const counts = {};
    donations.forEach((d) => {
      counts[d.status] = (counts[d.status] || 0) + 1;
    });
    return counts;
  }, [donations]);

  const completedDonations = useMemo(
    () => donations.filter((d) => d.status === 'COMPLETED'),
    [donations]
  );

  const totalFoodRescued = useMemo(
    () => completedDonations.reduce((sum, d) => sum + getReceivedQty(d), 0),
    [completedDonations]
  );

  const donationsPerDay = useMemo(() => {
    // Build the last 14 days (including today) so the chart always has labels.
    const days = [];
    const today = new Date();
    for (let i = 13; i >= 0; i -= 1) {
      const date = new Date(today);
      date.setHours(0, 0, 0, 0);
      date.setDate(today.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      days.push({
        key,
        label: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        count: 0,
      });
    }
    const byKey = Object.fromEntries(days.map((d) => [d.key, d]));
    donations.forEach((d) => {
      const key = new Date(d.created_at).toISOString().slice(0, 10);
      if (byKey[key]) byKey[key].count += 1;
    });
    return days;
  }, [donations]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase().trim();
    return profiles.filter((p) => {
      const matchesRole = userRoleFilter === 'ALL' || p.role === userRoleFilter;
      const matchesSearch =
        !q ||
        p.name?.toLowerCase().includes(q) ||
        p.phone?.toLowerCase().includes(q) ||
        p.org_name?.toLowerCase().includes(q);
      return matchesRole && matchesSearch;
    });
  }, [profiles, userSearch, userRoleFilter]);

  const filteredDonations = useMemo(() => {
    const q = donationSearch.toLowerCase().trim();
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    return donations.filter((d) => {
      const matchesStatus = donationStatusFilter === 'ALL' || d.status === donationStatusFilter;
      const matchesSearch = !q || d.title?.toLowerCase().includes(q);
      const createdMs = new Date(d.created_at).getTime();
      const matchesFrom = fromMs == null || createdMs >= fromMs;
      const matchesTo = toMs == null || createdMs <= toMs;
      return matchesStatus && matchesSearch && matchesFrom && matchesTo;
    });
  }, [donations, donationSearch, donationStatusFilter, dateFrom, dateTo]);

  // ─── Reports ─────────────────────────────────────────────────────────────
  const reports = useMemo(() => {
    // Average NGO response time: donation created -> first ACCEPTED event.
    const createdByDonation = new Map();
    donations.forEach((d) => createdByDonation.set(d.id, new Date(d.created_at).getTime()));
    const firstAcceptedByDonation = new Map();
    reportEvents.forEach((ev) => {
      if (ev.to_status === 'ACCEPTED' && !firstAcceptedByDonation.has(ev.donation_id)) {
        firstAcceptedByDonation.set(ev.donation_id, new Date(ev.created_at).getTime());
      }
    });
    const responseHours = [];
    firstAcceptedByDonation.forEach((acceptedMs, donationId) => {
      const createdMs = createdByDonation.get(donationId);
      if (createdMs && acceptedMs >= createdMs) {
        responseHours.push((acceptedMs - createdMs) / 36e5);
      }
    });
    const avgResponseHours = responseHours.length
      ? responseHours.reduce((a, b) => a + b, 0) / responseHours.length
      : null;

    // Volunteer completion rate: completed / assigned+ lifecycle.
    const completedByVolunteer = donations.filter((d) => d.status === 'COMPLETED').length;
    const assignedByVolunteer = donations.filter((d) =>
      ['ASSIGNED', 'PICKED_UP', 'DELIVERED', 'COMPLETED'].includes(d.status)
    ).length;
    const completionRate = assignedByVolunteer
      ? (completedByVolunteer / assignedByVolunteer) * 100
      : null;

    // Top donors by completed received quantity.
    const donorTotals = new Map();
    completedDonations.forEach((d) => {
      const key = d.donor_id || d.donor?.id || 'unknown';
      const prev = donorTotals.get(key) || {
        name: displayPerson(d.donor, 'Unknown donor'),
        total: 0,
      };
      prev.total += getReceivedQty(d);
      donorTotals.set(key, prev);
    });
    const topDonors = Array.from(donorTotals.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return { avgResponseHours, completionRate, completedByVolunteer, assignedByVolunteer, topDonors };
  }, [donations, reportEvents, completedDonations]);

  function downloadDonationsCsv() {
    // Export the currently filtered donations table so admins can share/report.
    const headers = [
      'id',
      'title',
      'status',
      'donor',
      'ngo',
      'volunteer',
      'quantity',
      'unit',
      'received_quantity',
      'created_at',
      'expires_at',
    ];
    const rows = filteredDonations.map((d) => [
      d.id,
      d.title,
      d.status,
      displayPerson(d.donor, ''),
      displayPerson(d.ngo, ''),
      displayPerson(d.volunteer, ''),
      d.quantity ?? '',
      d.unit ?? '',
      getReceivedQty(d),
      d.created_at || '',
      d.expires_at || '',
    ]);
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `donations-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <>
        <AdminNavbar />
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-slate-500">Loading admin data…</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AdminNavbar />
      <main className="min-h-screen bg-slate-50 pb-16">
        <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-extrabold text-slate-900">Admin Dashboard</h1>
                <LiveStatus status={realtimeStatus} />
              </div>
              <p className="text-sm text-slate-500">Manage NGOs, users, donations, and platform reports.</p>
            </div>
            <button
              type="button"
              onClick={fetchAll}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              ↻ Refresh
            </button>
          </div>

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

          <div className="flex gap-1 bg-slate-200 p-1 rounded-xl w-full overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 min-w-max py-2 px-3 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                  tab === t.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
                {t.id === 'ngo' && pendingNgos.length > 0 && (
                  <span className="ml-1.5 inline-block bg-amber-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {pendingNgos.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <section className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Donors" value={countsByRole.donor || 0} color="text-emerald-700" />
                <StatCard label="NGOs" value={countsByRole.ngo || 0} color="text-sky-700" />
                <StatCard label="Volunteers" value={countsByRole.volunteer || 0} color="text-amber-700" />
                <StatCard label="Admins" value={countsByRole.admin || 0} color="text-indigo-700" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total Donations" value={donations.length} />
                <StatCard label="Completed" value={completedDonations.length} color="text-emerald-700" />
                <StatCard label="Food Rescued" value={totalFoodRescued} color="text-green-700" note="Sum of received quantity (COMPLETED)" />
                <StatCard label="Pending NGOs" value={pendingNgos.length} color="text-amber-700" />
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                <h2 className="text-lg font-bold text-slate-900">Donations by Status</h2>
                {donations.length === 0 ? (
                  <p className="text-sm text-slate-500">No donations yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(countsByStatus).map(([status, count]) => (
                      <div key={status} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                        <StatusBadge status={status} />
                        <span className="text-sm font-semibold text-slate-700">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                <h2 className="text-lg font-bold text-slate-900">Donations Per Day (Last 14 Days)</h2>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={donationsPerDay}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>
          )}

          {tab === 'ngo' && (
            <section className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Pending NGO Verification</h2>
                <p className="text-sm text-slate-500">Approve or reject NGOs before they can accept donations.</p>
              </div>
              {pendingNgos.length === 0 ? (
                <EmptyState text="No NGOs are waiting for verification." />
              ) : (
                <div className="space-y-3">
                  {pendingNgos.map((ngo) => {
                    const isBusy = busyId === ngo.id;
                    return (
                      <article key={ngo.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-bold text-slate-900">{ngo.org_name || ngo.name || 'NGO'}</h3>
                              <VerifyBadge status={ngo.verification_status} />
                            </div>
                            <p className="text-sm text-slate-600">Contact: {ngo.name || '—'} {ngo.phone ? `· ${ngo.phone}` : ''}</p>
                            <p className="text-sm text-slate-600">Address: {ngo.address || '—'}</p>
                            <p className="text-xs text-slate-400">Registered: {formatDateTime(ngo.created_at)}</p>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" disabled={isBusy} onClick={() => handleVerifyNgo(ngo, true)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60">
                              {isBusy ? '…' : 'Verify'}
                            </button>
                            <button type="button" disabled={isBusy} onClick={() => handleVerifyNgo(ngo, false)} className="px-4 py-2 rounded-lg border border-rose-300 text-rose-700 text-sm font-semibold hover:bg-rose-50 disabled:opacity-60">
                              {isBusy ? '…' : 'Reject'}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                  <h3 className="font-bold text-slate-900">Verified NGOs</h3>
                  {verifiedNgos.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : (
                    <div className="space-y-2">
                      {verifiedNgos.map((ngo) => (
                        <div key={ngo.id} className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl p-3">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{ngo.org_name || ngo.name}</p>
                            <p className="text-xs text-slate-500">{ngo.phone || 'No phone'}</p>
                          </div>
                          <button type="button" disabled={busyId === ngo.id} onClick={() => handleVerifyNgo(ngo, false)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-60">Reject</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                  <h3 className="font-bold text-slate-900">Rejected NGOs</h3>
                  {rejectedNgos.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
                    <div className="space-y-2">
                      {rejectedNgos.map((ngo) => (
                        <div key={ngo.id} className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl p-3">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{ngo.org_name || ngo.name}</p>
                            <p className="text-xs text-slate-500">{ngo.phone || 'No phone'}</p>
                          </div>
                          <button type="button" disabled={busyId === ngo.id} onClick={() => handleVerifyNgo(ngo, true)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">Verify</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {tab === 'users' && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-900">Users ({filteredUsers.length})</h2>
                <div className="flex gap-2 flex-wrap">
                  <input type="search" placeholder="Search name, org, phone…" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  <select value={userRoleFilter} onChange={(e) => setUserRoleFilter(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="ALL">All roles</option>
                    <option value="donor">donor</option>
                    <option value="ngo">ngo</option>
                    <option value="volunteer">volunteer</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
              </div>
              {filteredUsers.length === 0 ? (
                <EmptyState text="No users match your search/filter." />
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <Th>Name / Org</Th>
                        <Th>Phone</Th>
                        <Th>Role</Th>
                        <Th>Verification</Th>
                        <Th>Status</Th>
                        <Th>Action</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredUsers.map((u) => {
                        const isSelf = u.id === user?.id;
                        const isBusy = busyId === u.id;
                        return (
                          <tr key={u.id} className="hover:bg-slate-50">
                            <Td>
                              <p className="font-semibold text-slate-900">{u.name || '—'}</p>
                              {u.org_name && <p className="text-xs text-slate-500">{u.org_name}</p>}
                            </Td>
                            <Td>{u.phone || '—'}</Td>
                            <Td><RoleBadge role={u.role} /></Td>
                            <Td><VerifyBadge status={u.verification_status || 'verified'} /></Td>
                            <Td>
                              {u.suspended ? <span className="text-xs font-semibold text-rose-700">Suspended</span> : <span className="text-xs font-semibold text-emerald-700">Active</span>}
                            </Td>
                            <Td>
                              {isSelf ? (
                                <span className="text-xs text-slate-400 italic">You</span>
                              ) : (
                                <button type="button" disabled={isBusy} onClick={() => handleToggleSuspend(u)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-60 transition-colors ${u.suspended ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'border border-rose-300 text-rose-700 hover:bg-rose-50'}`}>
                                  {isBusy ? '…' : u.suspended ? 'Reactivate' : 'Suspend'}
                                </button>
                              )}
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === 'donations' && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Donations ({filteredDonations.length})</h2>
                  <p className="text-xs text-slate-500">Expand a row to see its timeline.</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <input type="search" placeholder="Search title…" value={donationSearch} onChange={(e) => setDonationSearch(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  <select value={donationStatusFilter} onChange={(e) => setDonationStatusFilter(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="ALL">All statuses</option>
                    {['AVAILABLE', 'ACCEPTED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED'].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              {filteredDonations.length === 0 ? (
                <EmptyState text="No donations match your filters." />
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <Th>Donation</Th>
                        <Th>Donor</Th>
                        <Th>NGO</Th>
                        <Th>Volunteer</Th>
                        <Th>Status</Th>
                        <Th>Created</Th>
                        <Th>Action</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredDonations.map((d) => {
                        const isBusy = busyId === d.id;
                        const isExpanded = expandedDonationId === d.id;
                        const canCancel = !CLOSED_STATUSES.includes(d.status);
                        return (
                          <FragmentRow
                            key={d.id}
                            donation={d}
                            isBusy={isBusy}
                            isExpanded={isExpanded}
                            canCancel={canCancel}
                            onToggle={() => setExpandedDonationId(isExpanded ? null : d.id)}
                            onCancel={() => handleCancelDonation(d)}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === 'reports' && (
            <section className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-900">Reports</h2>
                <button type="button" onClick={downloadDonationsCsv} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors">
                  Download CSV
                </button>
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                <StatCard label="Avg NGO Response Time" value={reports.avgResponseHours == null ? '—' : `${reports.avgResponseHours.toFixed(1)} hrs`} color="text-sky-700" note="Donation created → first ACCEPTED event" />
                <StatCard label="Volunteer Completion Rate" value={reports.completionRate == null ? '—' : `${reports.completionRate.toFixed(0)}%`} color="text-emerald-700" note={`${reports.completedByVolunteer} completed / ${reports.assignedByVolunteer} assigned+`} />
                <StatCard label="Completed Donations" value={completedDonations.length} color="text-green-700" note="Used for donor rankings" />
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                <h3 className="font-bold text-slate-900">Top Donors by Completed Quantity</h3>
                {reports.topDonors.length === 0 ? (
                  <p className="text-sm text-slate-500">No completed donations yet.</p>
                ) : (
                  <div className="space-y-2">
                    {reports.topDonors.map((donor, idx) => (
                      <div key={`${donor.name}-${idx}`} className="flex items-center justify-between border border-slate-100 rounded-xl px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">{idx + 1}</span>
                          <span className="text-sm font-medium text-slate-900">{donor.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-emerald-700">{donor.total}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <p className="text-sm text-slate-600">
                  CSV export uses the current filters from the <span className="font-semibold">Donations</span> tab. Open Donations, apply filters, then come back here to download.
                </p>
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  );
}

// Separate row component so the timeline expander can render a second <tr>.
function FragmentRow({ donation, isBusy, isExpanded, canCancel, onToggle, onCancel }) {
  return (
    <>
      <tr className="hover:bg-slate-50 transition-colors">
        <Td>
          <button type="button" onClick={onToggle} className="text-left">
            <p className="font-semibold text-slate-900 hover:text-indigo-700">
              {isExpanded ? '▾' : '▸'} {donation.title}
            </p>
            <p className="text-xs text-slate-500">{donation.category} · {donation.food_type} · {donation.quantity} {donation.unit}</p>
          </button>
        </Td>
        <Td>{displayPerson(donation.donor)}</Td>
        <Td>{displayPerson(donation.ngo)}</Td>
        <Td>{displayPerson(donation.volunteer)}</Td>
        <Td><StatusBadge status={donation.status} /></Td>
        <Td><span className="text-xs text-slate-500">{formatDateTime(donation.created_at)}</span></Td>
        <Td>
          {canCancel ? (
            <button type="button" disabled={isBusy} onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-xs font-semibold hover:bg-rose-50 disabled:opacity-60">
              {isBusy ? '…' : 'Cancel donation'}
            </button>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </Td>
      </tr>
      {isExpanded && (
        <tr className="bg-slate-50/70">
          <td colSpan={7} className="px-4 py-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-700 uppercase">Donation Timeline</p>
              <p className="text-xs text-slate-500">
                Expires: {formatDateTime(donation.expires_at)} · Pickup: {formatDateTime(donation.pickup_start)} → {formatDateTime(donation.pickup_end)}
              </p>
              <DonationTimeline donationId={donation.id} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
