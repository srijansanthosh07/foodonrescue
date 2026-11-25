import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Subscribes to Supabase Realtime postgres_changes for the given tables.
// When any change happens, it calls onChange after a short debounce so we
// don't refetch many times in a row. Returns a simple status for the UI.
export default function useRealtimeRefresh(tables, onChange, options = {}) {
  const { enabled = true, debounceMs = 500 } = options;
  const [status, setStatus] = useState('connecting');
  const onChangeRef = useRef(onChange);
  const timerRef = useRef(null);

  // Keep the latest callback without resubscribing every render.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled || !supabase) {
      setStatus('offline');
      return undefined;
    }

    // Unique channel name prevents React StrictMode/dev double-mount issues.
    const channelName = `rt-refresh-${tables.join('-')}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase.channel(channelName);

    tables.forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          // Debounce: wait a bit so bursts of changes cause one refresh.
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            try {
              onChangeRef.current?.();
            } catch (err) {
              console.error('Realtime refresh callback failed:', err);
            }
          }, debounceMs);
        }
      );
    });

    channel.subscribe((subscriptionStatus) => {
      if (subscriptionStatus === 'SUBSCRIBED') setStatus('live');
      if (
        subscriptionStatus === 'CHANNEL_ERROR' ||
        subscriptionStatus === 'TIMED_OUT' ||
        subscriptionStatus === 'CLOSED'
      ) {
        setStatus('offline');
      }
    });

    return () => {
      // Cleanup prevents duplicate subscriptions and memory leaks.
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
  }, [enabled, debounceMs, tables.join('|')]);

  return status;
}
