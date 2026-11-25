import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from './ToastProvider';

function formatRelativeTime(value) {
  if (!value) return '';
  const diffMs = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function NotificationBell({ dark = false }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);

  // Load latest 20 notifications for this user.
  const fetchNotifications = useCallback(async () => {
    if (!user?.id || !supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, message, read, created_at, donation_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setNotifications(data || []);
    } catch (err) {
      console.error('Failed to load notifications:', err);
      addToast('Could not load notifications.', 'error');
    } finally {
      setLoading(false);
    }
  }, [user?.id, addToast]);

  // Count unread rows efficiently (no row data, just exact count).
  const fetchUnreadCount = useCallback(async () => {
    if (!user?.id || !supabase) return;
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false);
      if (error) throw error;
      setUnreadCount(count || 0);
    } catch (err) {
      console.error('Failed to load unread notification count:', err);
    }
  }, [user?.id]);

  // Initial load when user changes.
  useEffect(() => {
    fetchNotifications();
    fetchUnreadCount();
  }, [fetchNotifications, fetchUnreadCount]);

  // Realtime: listen for INSERTs on this user's notifications.
  useEffect(() => {
    if (!user?.id || !supabase) return undefined;

    // Unique channel name per user avoids duplicate subscriptions in StrictMode.
    const channel = supabase.channel(`notifications-user-${user.id}`);

    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      },
      (payload) => {
        const row = payload.new;
        if (!row) return;
        // Put newest notification at top, keep max 20 in dropdown.
        setNotifications((prev) => [row, ...prev.filter((n) => n.id !== row.id)].slice(0, 20));
        setUnreadCount((c) => c + 1);
        addToast(row.message || 'New notification');
      }
    );

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Notification realtime status:', status);
      }
    });

    return () => {
      // Important cleanup: remove channel on unmount/re-render.
      supabase.removeChannel(channel);
    };
  }, [user?.id, addToast]);

  // Close dropdown when clicking outside the bell component.
  useEffect(() => {
    function handleClickOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function markOneRead(notification) {
    if (!notification || notification.read || !supabase) return;
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true }) // only update the read column
        .eq('id', notification.id);
      if (error) throw error;
      setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (err) {
      console.error('Failed to mark notification read:', err);
      addToast('Could not mark this notification as read.', 'error');
    }
  }

  async function markAllRead() {
    if (!user?.id || !supabase || unreadCount === 0) return;
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true }) // only update read column
        .eq('user_id', user.id)
        .eq('read', false);
      if (error) throw error;
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all notifications read:', err);
      addToast('Could not mark all notifications as read.', 'error');
    }
  }

  const badgeText = unreadCount > 9 ? '9+' : String(unreadCount);
  const bellBtnClass = dark
    ? 'relative p-2 rounded-lg text-indigo-100 hover:bg-indigo-600'
    : 'relative p-2 rounded-lg text-slate-600 hover:bg-slate-100';

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={bellBtnClass}
        aria-label="Notifications"
      >
        {/* Simple bell icon using SVG so we don't add icon libraries */}
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
            {badgeText}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <p className="font-semibold text-slate-900 text-sm">Notifications</p>
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 disabled:text-slate-400"
              disabled={unreadCount === 0}
            >
              Mark all as read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-slate-500">Loading...</p>
            ) : notifications.length === 0 ? (
              <p className="p-6 text-sm text-slate-500 text-center">No notifications yet</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => markOneRead(n)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ${
                    n.read ? 'bg-white' : 'bg-emerald-50/60'
                  }`}
                >
                  <p className={`text-sm ${n.read ? 'text-slate-700' : 'text-slate-900 font-medium'}`}>
                    {n.message}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{formatRelativeTime(n.created_at)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
