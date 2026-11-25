import { useEffect, useRef, useState } from 'react';

// Max file size 5 MB
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * A small modal dialog for uploading a proof photo (optional or required).
 * Props:
 *   title        – Modal heading string
 *   description  – Short instruction for the volunteer
 *   required     – Boolean: if true, Confirm is blocked until a photo is chosen
 *   submitting   – Boolean: show loading state on Confirm button
 *   onConfirm(file|null) – Called with the chosen File (or null if skipped)
 *   onCancel()   – Called when the volunteer closes the modal
 */
export default function PhotoUploadDialog({
  title,
  description,
  required = false,
  submitting = false,
  onConfirm,
  onCancel,
}) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileError, setFileError] = useState('');
  const inputRef = useRef(null);

  // Create and clean up an object URL for the preview image
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Close on Escape unless a submission is in flight
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && !submitting) onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [submitting, onCancel]);

  function handleFileChange(e) {
    setFileError('');
    const chosen = e.target.files?.[0];
    if (!chosen) return;

    if (!ALLOWED_TYPES.includes(chosen.type)) {
      setFileError('Only JPG, PNG, or WebP images are allowed.');
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setFileError('Photo must be under 5 MB.');
      return;
    }
    setFile(chosen);
    // Reset so selecting the same file again fires onChange
    e.target.value = '';
  }

  function handleConfirm() {
    if (required && !file) return;
    onConfirm(file);
  }

  const canConfirm = !submitting && (!required || Boolean(file));

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-dialog-title"
    >
      <div className="bg-white rounded-2xl border border-slate-200 max-w-sm w-full shadow-xl space-y-5 p-6">
        <div>
          <h2 id="photo-dialog-title" className="text-lg font-bold text-slate-900">
            {title}
          </h2>
          <p className="text-sm text-slate-600 mt-1">{description}</p>
        </div>

        {/* Photo picker area */}
        <div className="space-y-3">
          {preview ? (
            <div className="relative rounded-xl overflow-hidden border border-slate-200 aspect-video bg-slate-100">
              <img src={preview} alt="Upload preview" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setFileError('');
                }}
                className="absolute top-2 right-2 px-2 py-1 rounded-md bg-slate-900/80 text-white text-xs font-medium"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={submitting}
              className="w-full border-2 border-dashed border-slate-300 rounded-xl py-6 text-sm font-medium text-slate-600 hover:border-emerald-400 hover:text-emerald-700 transition-colors disabled:opacity-60"
            >
              {required ? 'Tap to choose a proof photo (required)' : 'Tap to add a photo (optional)'}
            </button>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />

          {fileError && <p className="text-xs text-rose-600">{fileError}</p>}
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Uploading...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
