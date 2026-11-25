import { Navigate } from 'react-router-dom';
import { ROLE_DASHBOARD_PATH, useAuth } from '../context/AuthContext';

// Wraps a route so only logged-in users with the matching role can view it
export default function ProtectedRoute({ role, children }) {
  const { user, profile, loading, authError, signOut } = useAuth();

  // Wait until both session and profile have been checked
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-slate-600">Loading your account...</p>
        </div>
      </div>
    );
  }

  // Not logged in -> send user to /login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Logged in, but profile failed to load -> show a helpful message instead of looping
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-900">Profile Not Available</h2>
          <p className="text-sm text-rose-700">
            {authError || 'Your profile row could not be found in the database.'}
          </p>
          <button
            type="button"
            onClick={signOut}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
          >
            Log out
          </button>
        </div>
      </div>
    );
  }

  // Logged in with a different role -> redirect to their own dashboard
  if (role && profile.role !== role) {
    const redirectPath = ROLE_DASHBOARD_PATH[profile.role] || '/login';
    return <Navigate to={redirectPath} replace />;
  }

  return children;
}
