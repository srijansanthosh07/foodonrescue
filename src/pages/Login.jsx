import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ROLE_DASHBOARD_PATH, useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';

// Login page using AuthContext.signIn and role-based redirects
export default function Login() {
  const { user, profile, loading, authError, signIn } = useAuth();
  const { addToast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // If the user is already logged in (and not suspended), redirect to their role dashboard
  if (!loading && user && profile && !profile.suspended) {
    const target = ROLE_DASHBOARD_PATH[profile.role] || '/donor';
    return <Navigate to={target} replace />;
  }

  // Turn Supabase auth error strings into beginner-friendly messages
  function formatLoginError(message) {
    if (!message) return 'Unable to log in. Please try again.';
    const lower = message.toLowerCase();
    if (lower.includes('invalid login credentials')) {
      return 'Invalid email or password. Please check your credentials and try again.';
    }
    if (lower.includes('email not confirmed')) {
      return 'Your email is not confirmed yet. Please check your inbox and verify your email first.';
    }
    return message;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');

    const cleanEmail = email.trim();
    let message = '';
    if (!cleanEmail || !password) {
      message = 'Please enter both your email and password.';
    } else if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      message = 'Please enter a valid email address.';
    }
    if (message) {
      setFormError(message);
      addToast(message, 'error');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await signIn(cleanEmail, password);
      if (error) {
        message = formatLoginError(error.message);
        setFormError(message);
        addToast(message, 'error');
      }
    } catch (err) {
      message = err.message || 'Unexpected error during login.';
      setFormError(message);
      addToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // Show form-specific errors first, or AuthContext errors (such as a suspended account)
  const displayError = formError || authError;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            FOR — Food on Rescue
          </p>
          <h1 className="text-2xl font-bold text-slate-900">Log in to your account</h1>
          <p className="text-sm text-slate-600">
            Enter your email and password to access your dashboard.
          </p>
        </div>

        {/* Shows wrong credentials, unconfirmed email, or suspended account message */}
        {displayError && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800"
          >
            {displayError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              required
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Logging in...' : 'Log in'}
          </button>
        </form>

        <p className="text-sm text-center text-slate-600">
          Do not have an account?{' '}
          <Link to="/register" className="text-emerald-700 font-semibold hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
