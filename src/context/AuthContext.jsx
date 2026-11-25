import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Create a React Context so any component can read auth state and call auth helpers
const AuthContext = createContext(null);

// Map each role to its home dashboard path
export const ROLE_DASHBOARD_PATH = {
  donor: '/donor',
  ngo: '/ngo',
  volunteer: '/volunteer',
  admin: '/admin',
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  // Keep loading = true until BOTH session and profile check have completed
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  // Used so a forced sign-out for a suspended account does not erase the error message
  const suspendedLogoutRef = useRef(false);

  // Fetch the matching row from public.profiles for the signed-in user
  async function loadUserProfile(currentSession) {
    if (!currentSession?.user) {
      setSession(null);
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentSession.user.id)
      .single();

    if (error) {
      setSession(currentSession);
      setProfile(null);
      setAuthError(error.message || 'Could not load user profile.');
      return;
    }

    // Block suspended accounts immediately by signing them out
    if (data?.suspended === true) {
      suspendedLogoutRef.current = true;
      setAuthError('Your account has been suspended. Please contact an administrator.');
      setSession(null);
      setProfile(null);
      await supabase.auth.signOut();
      return;
    }

    setAuthError('');
    setSession(currentSession);
    setProfile(data);
  }

  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      // Safety check if .env is not configured yet
      if (!supabase) {
        if (isMounted) {
          setAuthError('Supabase client is not configured. Check your .env file.');
          setLoading(false);
        }
        return;
      }

      try {
        // 1. Check current session on app startup
        const { data, error } = await supabase.auth.getSession();

        if (error && isMounted) {
          setAuthError(error.message);
        }

        // 2. If a user is logged in, fetch their profile before finishing loading
        if (isMounted) {
          await loadUserProfile(data?.session ?? null);
        }
      } catch (err) {
        if (isMounted) {
          setAuthError(err.message || 'Failed to check authentication.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    initializeAuth();

    // 3. Subscribe to login, logout, and token refresh events
    if (!supabase) return undefined;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      if (!isMounted) return;

      // Skip INITIAL_SESSION because initializeAuth() already handles startup
      if (event === 'INITIAL_SESSION') return;

      if (event === 'SIGNED_OUT') {
        setSession(null);
        setProfile(null);
        if (!suspendedLogoutRef.current) {
          setAuthError('');
        }
        suspendedLogoutRef.current = false;
        setLoading(false);
        return;
      }

      // When signing in, wait until profile is loaded before turning off loading
      if (event === 'SIGNED_IN') {
        setLoading(true);
      }

      await loadUserProfile(nextSession);

      if (isMounted) {
        setLoading(false);
      }
    });

    // Unsubscribe from the auth listener when the provider unmounts
    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Sign in an existing user with email and password
  async function signIn(email, password) {
    if (!supabase) {
      return { data: null, error: new Error('Supabase is not configured.') };
    }
    setAuthError('');
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) {
      setAuthError(result.error.message);
    }
    return result;
  }

  // Register a new user and store name + role in Supabase signup metadata.
  // Note: the database trigger blocks 'admin' and forces unknown roles to 'donor'.
  async function signUp({ email, password, name, role }) {
    if (!supabase) {
      return { data: null, error: new Error('Supabase is not configured.') };
    }
    setAuthError('');
    const result = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, role },
      },
    });
    if (result.error) {
      setAuthError(result.error.message);
    }
    return result;
  }

  // Sign out the current user and clear local auth state
  async function signOut() {
    if (!supabase) return { error: null };
    setAuthError('');
    const result = await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    return result;
  }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    error: authError,
    authError,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Custom hook for easy access to auth state in any component
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}
