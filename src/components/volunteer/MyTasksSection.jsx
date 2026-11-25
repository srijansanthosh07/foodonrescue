import { useState } from 'react';
import StatusBadge from '../StatusBadge';
import PhotoUploadDialog from './PhotoUploadDialog';

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function mapsLink(lat, lng) {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/**
 * Section 2 — donations where the volunteer is assigned (ASSIGNED, PICKED_UP).
 * Props:
 *   donations     – Array of donation rows (with donor and ngo joins)
 *   busyId        – donation.id being submitted right now
 *   onPickedUp(donationId, photoFile|null)  – called when volunteer confirms pickup
 *   onDelivered(donationId, photoFile)      – called when volunteer confirms delivery
 *   onCantMakeIt(donationId)               – calls volunteer_cancel_task RPC
 */
export default function MyTasksSection({
  donations,
  busyId,
  onPickedUp,
  onDelivered,
  onCantMakeIt,
}) {
  // Track which dialog is open: { donationId, mode: 'pickup' | 'delivery' }
  const [openDialog, setOpenDialog] = useState(null);

  if (donations.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">My Tasks</h2>
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-1">
          <p className="font-medium text-slate-700">No active tasks</p>
          <p className="text-sm text-slate-500">
            Accept a request above to start a pickup task.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-slate-900">My Tasks ({donations.length})</h2>

      <div className="space-y-4">
        {donations.map((donation) => {
          const donor = donation.donor;
          const ngo = donation.ngo;
          const thumbUrl = donation.image_urls?.[0];
          const isBusy = busyId === donation.id;
          const isAssigned = donation.status === 'ASSIGNED';
          const isPickedUp = donation.status === 'PICKED_UP';

          const donorMapsUrl = mapsLink(donation.lat, donation.lng);
          const ngoMapsUrl = mapsLink(ngo?.lat, ngo?.lng);

          const isThisDialogOpen = openDialog?.donationId === donation.id;

          return (
            <article
              key={donation.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
            >
              {/* Food image banner */}
              {thumbUrl && (
                <img
                  src={thumbUrl}
                  alt={donation.title}
                  className="w-full h-40 object-cover"
                />
              )}

              <div className="p-4 sm:p-5 space-y-4">
                {/* Title + status */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <h3 className="font-bold text-slate-900 text-lg leading-snug">
                      {donation.title}
                    </h3>
                    <p className="text-sm text-slate-600">
                      {donation.quantity} {donation.unit} • {donation.category} • {donation.food_type}
                    </p>
                  </div>
                  <StatusBadge status={donation.status} />
                </div>

                {donation.notes && (
                  <p className="text-xs text-slate-500 italic bg-slate-50 rounded-lg px-3 py-2">
                    Notes: {donation.notes}
                  </p>
                )}

                <div className="text-sm text-slate-600 space-y-1.5">
                  <p className="text-xs text-slate-500">
                    Pickup window: {formatDateTime(donation.pickup_start)} →{' '}
                    {formatDateTime(donation.pickup_end)} • Expires:{' '}
                    {formatDateTime(donation.expires_at)}
                  </p>
                </div>

                {/* Donor info + map link */}
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 space-y-1">
                  <p className="text-xs font-semibold text-emerald-900 uppercase">
                    Pickup from donor
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {donor?.org_name || donor?.name || 'Donor'}
                  </p>
                  <p className="text-xs text-slate-700">{donation.address}</p>
                  {donor?.phone && (
                    <a
                      href={`tel:${donor.phone}`}
                      className="inline-block text-xs font-semibold text-emerald-700"
                    >
                      📞 {donor.phone}
                    </a>
                  )}
                  {donorMapsUrl && (
                    <a
                      href={donorMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs font-semibold text-sky-700 mt-1"
                    >
                      🗺 Open in Google Maps
                    </a>
                  )}
                </div>

                {/* NGO drop-off info + map link */}
                {ngo && (
                  <div className="rounded-xl bg-sky-50 border border-sky-200 p-3.5 space-y-1">
                    <p className="text-xs font-semibold text-sky-900 uppercase">
                      Deliver to NGO
                    </p>
                    <p className="text-sm font-semibold text-slate-900">
                      {ngo.org_name || ngo.name}
                    </p>
                    {ngo.address && (
                      <p className="text-xs text-slate-700">{ngo.address}</p>
                    )}
                    {ngo.phone && (
                      <a
                        href={`tel:${ngo.phone}`}
                        className="inline-block text-xs font-semibold text-sky-700"
                      >
                        📞 {ngo.phone}
                      </a>
                    )}
                    {ngoMapsUrl && (
                      <a
                        href={ngoMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs font-semibold text-sky-700 mt-1"
                      >
                        🗺 Open in Google Maps
                      </a>
                    )}
                  </div>
                )}

                {/* Action buttons per status */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {isAssigned && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenDialog({ donationId: donation.id, mode: 'pickup' })
                        }
                        disabled={isBusy}
                        className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                      >
                        {isBusy ? 'Updating...' : 'Mark picked up'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onCantMakeIt(donation.id)}
                        disabled={isBusy}
                        className="flex-1 py-2.5 rounded-xl border border-rose-300 text-rose-700 text-sm font-semibold hover:bg-rose-50 disabled:opacity-60 transition-colors"
                      >
                        Can&apos;t make it
                      </button>
                    </>
                  )}

                  {isPickedUp && (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenDialog({ donationId: donation.id, mode: 'delivery' })
                      }
                      disabled={isBusy}
                      className="flex-1 py-2.5 rounded-xl bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 disabled:opacity-60 transition-colors"
                    >
                      {isBusy ? 'Uploading...' : 'Mark delivered'}
                    </button>
                  )}
                </div>
              </div>

              {/* Photo upload dialog for pickup (optional) */}
              {isThisDialogOpen && openDialog.mode === 'pickup' && (
                <PhotoUploadDialog
                  title="Confirm Pickup"
                  description="Optionally add a photo of the food you are collecting. Tap Confirm when ready."
                  required={false}
                  submitting={isBusy}
                  onConfirm={(photoFile) => {
                    setOpenDialog(null);
                    onPickedUp(donation.id, photoFile);
                  }}
                  onCancel={() => setOpenDialog(null)}
                />
              )}

              {/* Photo upload dialog for delivery (required proof) */}
              {isThisDialogOpen && openDialog.mode === 'delivery' && (
                <PhotoUploadDialog
                  title="Confirm Delivery"
                  description="Please add a proof photo of the delivered food. The Confirm button unlocks once you choose a photo."
                  required={true}
                  submitting={isBusy}
                  onConfirm={(photoFile) => {
                    setOpenDialog(null);
                    onDelivered(donation.id, photoFile);
                  }}
                  onCancel={() => setOpenDialog(null)}
                />
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
