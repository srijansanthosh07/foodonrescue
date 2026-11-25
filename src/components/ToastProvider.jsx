import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

const TOAST_STYLES = {
  error: 'bg-rose-50 border-rose-200 text-rose-900',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  info: 'bg-white border-slate-200 text-slate-800',
};

// Shows small messages in the top-right corner. Toasts auto-close after 5s.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    // Auto-close after 5 seconds, but user can also close manually.
    setTimeout(() => {
      removeToast(id);
    }, 5000);
  }, [removeToast]);

  const value = useMemo(() => ({ addToast }), [addToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast stack: top-right, above navbars/modals */}
      <div className="fixed top-4 right-4 z-[100] space-y-2 w-[min(92vw,360px)]">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`border shadow-lg rounded-xl px-4 py-3 text-sm flex items-start gap-3 ${
              TOAST_STYLES[toast.type] || TOAST_STYLES.info
            }`}
          >
            <p className="flex-1">{toast.message}</p>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-700 font-bold leading-none"
              aria-label="Close notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
