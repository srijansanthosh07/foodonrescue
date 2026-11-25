import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ROLE_DASHBOARD_PATH, useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/ToastProvider';

// Registration page for Donor, NGO, and Volunteer accounts (Admin signup is not allowed)
export default function Register() {
  const { user, profile, loading, signUp } = useAuth();
  const { addToast } = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('donor');
  const [orgName, setOrgName] = useState('');
  const [address, setAddress] = useState('');

  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Wait until submitting finishes before redirecting an authenticated user away from /register
  if (!loading && !submitting && user && profile && !profile.suspended) {
    const target = ROLE_DASHBOARD_PATH[profile.role] || '/donor';
    return <Navigate to={target} replace />;
  }

  // Only donors and NGOs have an organization name field
  const showsOrgName = role === 'donor' || role === 'ngo';

  function validateForm() {
    if (!name.trim()) return 'Please enter your full name.';
    if (!email.trim() || !email.includes('@')) return 'Please enter a valid email address.';
    if (password.length < 6) return 'Password must be at least 6 characters long.';
    if (password !== confirmPassword) return 'Passwords do not match.';
    if (!phone.trim()) return 'Please enter your phone number.';
    if (showsOrgName && !orgName.trim()) {
      return role === 'ngo'
        ? 'Please enter your NGO organization name.'
        : 'Please enter your restaurant, hotel, or organization name.';
    }
    if (!address.trim()) return 'Please enter your address.';
    return '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage('');
    setInfoMessage('');

    const validationError = validateForm();
    if (validationError) {
      setErrorMessage(validationError);
      addToast(validationError, 'error');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Create the Supabase Auth user (DB trigger automatically inserts the profiles row)
      const { data, error } = await signUp({
        email: email.trim(),
        password,
        name: name.trim(),
        role,
      });

      if (error) {
        const message = error.message || 'Could not create account.';
        setErrorMessage(message);
        addToast(message, 'error');
        return;
      }

      // 2. If Supabase requires email confirmation, there is no active session yet
      if (!data?.session) {
        setInfoMessage(
          'Registration successful! Please check your email to verify your account before logging in.'
        );
        return;
      }

      // 3. If a session exists right away, update the newly created profile with extra fields
      if (data?.user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            phone: phone.trim(),
            org_name: showsOrgName ? orgName.trim() : null,
            address: address.trim(),
          })
          .eq('id', data.user.id);

        if (profileError) {
          const message = `Account created, but saving extra profile details failed: ${profileError.message}`;
          setErrorMessage(message);
          addToast(message, 'error');
          return;
        }
      }

      // Once submitting becomes false, the redirect above sends the user to their dashboard
    } catch (err) {
      const message = err.message || 'Unexpected error during registration.';
      setErrorMessage(message);
      addToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="max-w-lg w-full bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            FOR — Food on Rescue
          </p>
          <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
          <p className="text-sm text-slate-600">
            Join as a Donor, NGO, or Volunteer to help rescue surplus food.
          </p>
        </div>

        {/* Friendly validation or Supabase error banner */}
        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800"
          >
            {errorMessage}
          </div>
        )}

        {/* Email confirmation banner when Supabase does not return an immediate session */}
        {infoMessage && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800 space-y-1">
            <p className="font-semibold">Check your email</p>
            <p>{infoMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="reg-name" className="block text-sm font-medium text-slate-700 mb-1">
                Full Name
              </label>
              <input
                id="reg-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                required
              />
            </div>

            <div>
              <label htmlFor="reg-phone" className="block text-sm font-medium text-slate-700 mb-1">
                Phone Number
              </label>
              <input
                id="reg-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="reg-email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              id="reg-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              required
            />
          </div>

          {/* Role selector: intentionally restricted to donor, ngo, and volunteer */}
          <div>
            <label htmlFor="reg-role" className="block text-sm font-medium text-slate-700 mb-1">
              Role
            </label>
            <select
              id="reg-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            >
              <option value="donor">Donor (Hotel / Restaurant / Bakery / Event)</option>
              <option value="ngo">NGO (Food Distribution Organization)</option>
              <option value="volunteer">Volunteer (Pickup &amp; Delivery)</option>
            </select>
          </div>

          {/* Required verification notice for NGOs */}
          {role === 'ngo' && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900">
              NGO accounts must be verified by an admin before they can accept donations.
            </div>
          )}

          {/* Organization name shown only for Donor and NGO */}
          {showsOrgName && (
            <div>
              <label htmlFor="reg-org" className="block text-sm font-medium text-slate-700 mb-1">
                {role === 'ngo' ? 'NGO Organization Name' : 'Organization / Business Name'}
              </label>
              <input
                id="reg-org"
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder={role === 'ngo' ? 'Helping Hands Trust' : 'Green Leaf Kitchen'}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                required
              />
            </div>
          )}

          <div>
            <label htmlFor="reg-address" className="block text-sm font-medium text-slate-700 mb-1">
              Address
            </label>
            <textarea
              id="reg-address"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, area, city"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="reg-password"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Password (min 6 chars)
              </label>
              <input
                id="reg-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="reg-confirm-password"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Confirm Password
              </label>
              <input
                id="reg-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-sm text-center text-slate-600">
          Already have an account?{' '}
          <Link to="/login" className="text-emerald-700 font-semibold hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
