import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { haversineKm } from '../../utils/geo';
import { useToast } from '../ToastProvider';

// Modal allowing an NGO to pick an available volunteer sorted by distance from pickup
export default function VolunteerPickerModal({
  donation,
  onClose,
  onAssigned,
}) {
  const [volunteers, setVolunteers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const { addToast } = useToast();

  // Turn RPC errors into friendly messages
  function formatAssignError(message) {
    if (!message) return 'Could not assign this volunteer. Please try again.';
    const lower = message.toLowerCase();
    if (
      lower.includes('not available') ||
      lower.includes('busy') ||
      lower.includes('offline')
    ) {
      return 'This volunteer is not available right now.';
    }
    if (lower.includes('already') || lower.includes('pending')) {
      return 'This donation already has an active volunteer request or assignment.';
    }
    return message;
  }

  const fetchAvailableVolunteers = useCallback(async () => {
    if (!donation) return;

    setLoading(true);
    setErrorMessage('');

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, phone, lat, lng, completed_count, availability')
        .eq('role', 'volunteer')
        .eq('availability', 'available');

      if (error) {
        const message = error.message || 'Could not load available volunteers.';
        setErrorMessage(message);
        addToast(message, 'error');
        setVolunteers([]);
        return;
      }

      // Compute Haversine distance from donation pickup to each volunteer, nearest first
      const enriched = (data || [])
        .map((vol) => ({
          ...vol,
          distanceKm: haversineKm(donation.lat, donation.lng, vol.lat, vol.lng),
        }))
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));

      setVolunteers(enriched);
    } catch (err) {
      const message = err.message || 'Unexpected error loading volunteers.';
      setErrorMessage(message);
      addToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [donation, addToast]);

  useEffect(() => {
    fetchAvailableVolunteers();
  }, [fetchAvailableVolunteers]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && !assigningId) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [assigningId, onClose]);

  async function handleAssign(volunteer) {
    setAssigningId(volunteer.id);
    setErrorMessage('');

    try {
      const { error } = await supabase.rpc('assign_volunteer', {
        p_donation_id: donation.id,
        p_volunteer_id: volunteer.id,
      });

      if (error) {
        const friendlyMessage = formatAssignError(error.message);
        // Refresh the list first (someone may have become busy), then show the
        // friendly error again so the refresh does not erase it.
        await fetchAvailableVolunteers();
        setErrorMessage(friendlyMessage);
        addToast(friendlyMessage, 'error');
        return;
      }

      onAssigned(`Assignment request sent to ${volunteer.name}.`);
    } catch (err) {
      const friendlyMessage = formatAssignError(err.message);
      await fetchAvailableVolunteers();
      setErrorMessage(friendlyMessage);
      addToast(friendlyMessage, 'error');
    } finally {
      setAssigningId(null);
    }
  }

  if (!donation) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="volunteer-picker-title"
    >
      <div className="bg-white rounded-2xl border border-slate-200 max-w-xl w-full max-h-[85vh] flex flex-col shadow-xl overflow-hidden">
        {/* Modal header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <h2 id="volunteer-picker-title" className="text-lg font-bold text-slate-900">
              Assign Volunteer
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              For <span className="font-semibold text-slate-700">{donation.title}</span> •{' '}
              {donation.address}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={fetchAvailableVolunteers}
              disabled={loading || Boolean(assigningId)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={Boolean(assigningId)}
              className="px-2.5 py-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 text-sm font-semibold"
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800"
            >
              {errorMessage}
            </div>
          )}

          {loading ? (
            <div className="py-10 text-center space-y-2">
              <div className="w-7 h-7 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-slate-600">Finding available volunteers...</p>
            </div>
          ) : volunteers.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <p className="text-sm font-medium text-slate-700">
                No volunteers are available right now
              </p>
              <button
                type="button"
                onClick={fetchAvailableVolunteers}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
              {volunteers.map((vol) => {
                const isAssigningThis = assigningId === vol.id;
                const completedCount = vol.completed_count ?? 0;

                return (
                  <div
                    key={vol.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white hover:bg-slate-50"
                  >
                    <div className="space-y-0.5">
                      <p className="font-semibold text-slate-900 text-sm">{vol.name}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                        <span className="font-medium text-emerald-700">
                          {vol.distanceKm !== null
                            ? `${vol.distanceKm.toFixed(1)} km away`
                            : 'distance unknown'}
                        </span>
                        <span>• {completedCount} completed tasks</span>
                        {vol.phone && <span>• {vol.phone}</span>}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleAssign(vol)}
                      disabled={Boolean(assigningId)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60 transition-colors shrink-0"
                    >
                      {isAssigningThis ? 'Assigning...' : 'Assign'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
