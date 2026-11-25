import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import DonorNavbar from '../../components/DonorNavbar';
import LocationPicker from '../../components/LocationPicker';
import { useToast } from '../../components/ToastProvider';

// Madurai fallback coordinates if the donor's profile has no saved lat/lng
const MADURAI_COORDS = { lat: 9.9252, lng: 78.1198 };

// Allowed image MIME types and max file size (5 MB)
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export default function CreateDonation() {
  const { user, profile } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  // Default map center comes from donor's profile lat/lng, or Madurai
  const initialCenter =
    typeof profile?.lat === 'number' && typeof profile?.lng === 'number'
      ? { lat: profile.lat, lng: profile.lng }
      : MADURAI_COORDS;

  // Form fields
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('veg');
  const [foodType, setFoodType] = useState('cooked');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('servings');
  const [preparedAt, setPreparedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [pickupStart, setPickupStart] = useState('');
  const [pickupEnd, setPickupEnd] = useState('');
  const [address, setAddress] = useState(profile?.address || '');
  const [notes, setNotes] = useState('');
  const [pin, setPin] = useState(
    typeof profile?.lat === 'number' && typeof profile?.lng === 'number'
      ? { lat: profile.lat, lng: profile.lng }
      : null
  );
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);

  // Selected image files and their local preview URLs
  const [images, setImages] = useState([]);
  const [previews, setPreviews] = useState([]);

  // Validation and submission states
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Clean up object preview URLs when images change or component unmounts
  useEffect(() => {
    const urls = images.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [images]);

  function handleFileChange(e) {
    const chosen = Array.from(e.target.files || []);
    if (chosen.length === 0) return;

    const combined = [...images, ...chosen];
    if (combined.length > 3) {
      setFieldErrors((prev) => ({
        ...prev,
        images: 'You can upload a maximum of 3 images.',
      }));
      e.target.value = '';
      return;
    }

    for (const file of chosen) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setFieldErrors((prev) => ({
          ...prev,
          images: `"${file.name}" is not supported. Only JPG, PNG, or WebP images are allowed.`,
        }));
        e.target.value = '';
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setFieldErrors((prev) => ({
          ...prev,
          images: `"${file.name}" exceeds the 5 MB size limit.`,
        }));
        e.target.value = '';
        return;
      }
    }

    setFieldErrors((prev) => ({ ...prev, images: '' }));
    setImages(combined);
    // Reset input so selecting the same file again triggers onChange
    e.target.value = '';
  }

  function removeImage(indexToRemove) {
    setImages((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  }

  function validateForm() {
    const errors = {};
    const now = new Date();

    if (!title.trim()) errors.title = 'Food title is required.';

    const numQty = Number(quantity);
    if (!quantity || Number.isNaN(numQty) || numQty <= 0) {
      errors.quantity = 'Quantity must be greater than 0.';
    }

    if (!expiresAt) {
      errors.expiresAt = 'Expiry time is required.';
    } else if (new Date(expiresAt) <= now) {
      errors.expiresAt = 'Expiry time must be in the future.';
    }

    if (!pickupStart) {
      errors.pickupStart = 'Pickup start time is required.';
    }

    if (!pickupEnd) {
      errors.pickupEnd = 'Pickup end time is required.';
    } else {
      const startDate = pickupStart ? new Date(pickupStart) : null;
      const endDate = new Date(pickupEnd);
      const expDate = expiresAt ? new Date(expiresAt) : null;

      if (startDate && endDate <= startDate) {
        errors.pickupEnd = 'Pickup end must be after pickup start.';
      } else if (expDate && endDate > expDate) {
        errors.pickupEnd = 'Pickup end cannot be after expiry time.';
      }
    }

    if (!address.trim()) errors.address = 'Pickup address is required.';

    if (!pin || typeof pin.lat !== 'number' || typeof pin.lng !== 'number') {
      errors.pin = 'Please drop a pin on the map for the pickup location.';
    }

    if (images.length < 1 || images.length > 3) {
      errors.images = 'Please upload 1 to 3 food images (JPG, PNG, or WebP, max 5 MB each).';
    }

    if (!safetyConfirmed) {
      errors.safetyConfirmed = 'You must confirm the food safety declaration.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      addToast('Please fix the highlighted fields before posting.', 'error');
      return false;
    }
    return true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError('');

    if (!validateForm()) return;

    setSubmitting(true);
    let uploadedPaths = [];

    try {
      // 1. Upload 1-3 images to the "donation-images" bucket under `${user.id}/...`
      const imageUrls = [];

      for (let i = 0; i < images.length; i += 1) {
        const file = images[i];
        // Folder MUST start with user.id so Supabase Storage RLS accepts it
        const filePath = `${user.id}/${Date.now()}-${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from('donation-images')
          .upload(filePath, file);

        if (uploadError) {
          throw new Error(`Image upload failed (${file.name}): ${uploadError.message}`);
        }

        uploadedPaths.push(filePath);

        const { data: publicUrlData } = supabase.storage
          .from('donation-images')
          .getPublicUrl(filePath);

        imageUrls.push(publicUrlData.publicUrl);

        // Brief 2ms pause if more files remain so Date.now() stays unique
        if (i < images.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
      }

      // 2. Insert ONLY the allowed fields (DB defaults handle status, NGO, and volunteer)
      const payload = {
        donor_id: user.id,
        title: title.trim(),
        category,
        food_type: foodType,
        quantity: Number(quantity),
        unit,
        prepared_at: preparedAt ? new Date(preparedAt).toISOString() : null,
        expires_at: new Date(expiresAt).toISOString(),
        pickup_start: new Date(pickupStart).toISOString(),
        pickup_end: new Date(pickupEnd).toISOString(),
        address: address.trim(),
        lat: pin.lat,
        lng: pin.lng,
        image_urls: imageUrls,
        notes: notes.trim() || null,
      };

      const { error: insertError } = await supabase.from('donations').insert([payload]);

      if (insertError) {
        const message = `Your images were uploaded, but saving the donation failed: ${insertError.message}`;
        setSubmitError(message);
        addToast(message, 'error');
        return;
      }

      addToast('Donation posted. Nearby verified NGOs have been notified.', 'success');
      navigate('/donor');
    } catch (err) {
      const message =
        uploadedPaths.length > 0
          ? `Images uploaded, but creating the donation failed: ${err.message}`
          : err.message || 'Could not create donation.';
      setSubmitError(message);
      addToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DonorNavbar />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Create New Donation</h1>
              <p className="text-sm text-slate-600">
                Share surplus food details so nearby verified NGOs can rescue it quickly.
              </p>
            </div>
            <Link
              to="/donor"
              className="text-sm font-medium text-slate-600 hover:text-slate-900 shrink-0"
            >
              Back
            </Link>
          </div>

          {submitError && (
            <div
              role="alert"
              className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800"
            >
              {submitError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Food Title */}
            <div>
              <label htmlFor="don-title" className="block text-sm font-medium text-slate-700 mb-1">
                Food Title *
              </label>
              <input
                id="don-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Vegetable Biryani & Raita"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {fieldErrors.title && (
                <p className="text-xs text-rose-600 mt-1">{fieldErrors.title}</p>
              )}
            </div>

            {/* Category & Food Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="don-category"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Category *
                </label>
                <select
                  id="don-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="veg">Veg</option>
                  <option value="non-veg">Non-Veg</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="don-food-type"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Food Type *
                </label>
                <select
                  id="don-food-type"
                  value={foodType}
                  onChange={(e) => setFoodType(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="cooked">Cooked</option>
                  <option value="packaged">Packaged</option>
                </select>
              </div>
            </div>

            {/* Quantity & Unit */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="don-qty" className="block text-sm font-medium text-slate-700 mb-1">
                  Quantity *
                </label>
                <input
                  id="don-qty"
                  type="number"
                  min="0.1"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g., 50"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {fieldErrors.quantity && (
                  <p className="text-xs text-rose-600 mt-1">{fieldErrors.quantity}</p>
                )}
              </div>

              <div>
                <label htmlFor="don-unit" className="block text-sm font-medium text-slate-700 mb-1">
                  Unit *
                </label>
                <select
                  id="don-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="servings">Servings</option>
                  <option value="kg">Kilograms (kg)</option>
                  <option value="packets">Packets</option>
                </select>
              </div>
            </div>

            {/* Prepared & Expiry times */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="don-prepared"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Prepared At (optional)
                </label>
                <input
                  id="don-prepared"
                  type="datetime-local"
                  value={preparedAt}
                  onChange={(e) => setPreparedAt(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label
                  htmlFor="don-expires"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Best Before / Expiry Time *
                </label>
                <input
                  id="don-expires"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {fieldErrors.expiresAt && (
                  <p className="text-xs text-rose-600 mt-1">{fieldErrors.expiresAt}</p>
                )}
              </div>
            </div>

            {/* Pickup window */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="don-pickup-start"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Pickup Window Start *
                </label>
                <input
                  id="don-pickup-start"
                  type="datetime-local"
                  value={pickupStart}
                  onChange={(e) => setPickupStart(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {fieldErrors.pickupStart && (
                  <p className="text-xs text-rose-600 mt-1">{fieldErrors.pickupStart}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="don-pickup-end"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Pickup Window End *
                </label>
                <input
                  id="don-pickup-end"
                  type="datetime-local"
                  value={pickupEnd}
                  onChange={(e) => setPickupEnd(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {fieldErrors.pickupEnd && (
                  <p className="text-xs text-rose-600 mt-1">{fieldErrors.pickupEnd}</p>
                )}
              </div>
            </div>

            {/* Pickup Address */}
            <div>
              <label
                htmlFor="don-address"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Pickup Address *
              </label>
              <textarea
                id="don-address"
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Building, street, landmark, city"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {fieldErrors.address && (
                <p className="text-xs text-rose-600 mt-1">{fieldErrors.address}</p>
              )}
            </div>

            {/* Leaflet Map Pin Picker */}
            <div>
              <span className="block text-sm font-medium text-slate-700 mb-1">
                Pickup Map Location *
              </span>
              <LocationPicker
                initialCenter={initialCenter}
                position={pin}
                onChange={(coords) => {
                  setPin(coords);
                  setFieldErrors((prev) => ({ ...prev, pin: '' }));
                }}
                error={fieldErrors.pin}
              />
            </div>

            {/* Food Images (1-3) */}
            <div className="space-y-2">
              <label htmlFor="don-images" className="block text-sm font-medium text-slate-700">
                Food Images (1 to 3 photos, JPG/PNG/WebP, max 5 MB each) *
              </label>
              <input
                id="don-images"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleFileChange}
                disabled={images.length >= 3}
                className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
              />
              {fieldErrors.images && (
                <p className="text-xs text-rose-600">{fieldErrors.images}</p>
              )}

              {previews.length > 0 && (
                <div className="grid grid-cols-3 gap-3 pt-2">
                  {previews.map((src, idx) => (
                    <div
                      key={src}
                      className="relative rounded-xl overflow-hidden border border-slate-200 aspect-square bg-slate-100"
                    >
                      <img src={src} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-md bg-slate-900/80 text-white text-xs font-medium hover:bg-slate-900"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <label htmlFor="don-notes" className="block text-sm font-medium text-slate-700 mb-1">
                Notes (optional)
              </label>
              <textarea
                id="don-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Allergens, container instructions, gate entry details..."
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Mandatory food safety confirmation (UI-only, not saved) */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-1">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={safetyConfirmed}
                  onChange={(e) => setSafetyConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-sm text-slate-700">
                  I confirm this food is safe, fresh and stored hygienically
                </span>
              </label>
              {fieldErrors.safetyConfirmed && (
                <p className="text-xs text-rose-600 pl-6">{fieldErrors.safetyConfirmed}</p>
              )}
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Uploading & Posting Donation...' : 'Post Surplus Food Donation'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
