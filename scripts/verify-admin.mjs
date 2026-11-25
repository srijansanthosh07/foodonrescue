// Automated admin-flow verification script.
// Uses ONLY the public anon key from .env (never service_role).
// Run from inside for-app with:
//   node --env-file=.env scripts/verify-admin.mjs
// Or via npm:
//   npm run verify:admin
//
// Beginner notes:
// - This script signs in as different test users to prove RLS/RPC permissions.
// - We use one Supabase client and sign out/in before each action.
// - Every check is recorded as PASS or FAIL in a final table.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Run with: node --env-file=.env scripts/verify-admin.mjs'
  );
  process.exit(1);
}

const PASSWORD = 'Test@1234';

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const results = [];

function record(check, passed, details) {
  results.push({
    check,
    status: passed ? 'PASS' : 'FAIL',
    details,
  });
}

async function signIn(email) {
  await supabase.auth.signOut();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  return { user: data?.user || null, error };
}

function isRejected(error, data) {
  // An RPC/update is "rejected" if Supabase returns an error, or returns no rows.
  if (error) return { rejected: true, reason: error.message };
  if (Array.isArray(data) && data.length === 0) {
    return { rejected: true, reason: '0 rows affected (blocked by RLS/policy)' };
  }
  return { rejected: false, reason: 'Operation succeeded unexpectedly' };
}

async function run() {
  let createdDonationId = null;
  let freshNgoId = null;
  let freshNgoEmail = null;

  try {
    // ---------------------------------------------------------------------
    // Check 1: donor cannot call admin_verify_ngo; NGO cannot call admin_cancel_donation
    // ---------------------------------------------------------------------
    try {
      const donorSignIn = await signIn('donor@test.com');
      if (donorSignIn.error) throw donorSignIn.error;

      const { data, error } = await supabase.rpc('admin_verify_ngo', {
        p_ngo_id: donorSignIn.user.id, // dummy id; call should be rejected by role check
        p_approve: true,
      });
      const rej = isRejected(error, data);
      record(
        '1a. donor@test.com calling admin_verify_ngo is rejected',
        rej.rejected,
        rej.reason
      );
    } catch (err) {
      record('1a. donor@test.com calling admin_verify_ngo is rejected', false, err.message);
    }

    try {
      const ngoSignIn = await signIn('ngo@test.com');
      if (ngoSignIn.error) throw ngoSignIn.error;

      // Use a fake UUID; the RPC should reject before/due to permission.
      const fakeDonationId = '00000000-0000-0000-0000-000000000000';
      const { data, error } = await supabase.rpc('admin_cancel_donation', {
        p_donation_id: fakeDonationId,
        p_reason: 'test',
      });
      const rej = isRejected(error, data);
      record(
        '1b. ngo@test.com calling admin_cancel_donation is rejected',
        rej.rejected,
        rej.reason
      );
    } catch (err) {
      record('1b. ngo@test.com calling admin_cancel_donation is rejected', false, err.message);
    }

    // ---------------------------------------------------------------------
    // Check 2: donor can read only own + related profiles; admin can read all
    // ---------------------------------------------------------------------
    try {
      const donorSignIn = await signIn('donor@test.com');
      if (donorSignIn.error) throw donorSignIn.error;
      const { data: donorProfiles, error: donorErr } = await supabase
        .from('profiles')
        .select('id, role');
      if (donorErr) throw donorErr;

      const adminSignIn = await signIn('admin@test.com');
      if (adminSignIn.error) throw adminSignIn.error;
      const { data: adminProfiles, error: adminErr } = await supabase
        .from('profiles')
        .select('id, role');
      if (adminErr) throw adminErr;

      const donorCount = donorProfiles?.length || 0;
      const adminCount = adminProfiles?.length || 0;
      const passed = adminCount > donorCount;
      record(
        '2. Admin sees more profiles than donor (RLS visibility)',
        passed,
        `donor saw ${donorCount} profile(s), admin saw ${adminCount} profile(s)`
      );
    } catch (err) {
      record('2. Admin sees more profiles than donor (RLS visibility)', false, err.message);
    }

    // ---------------------------------------------------------------------
    // Check 3: donor cannot update own profile role to admin
    // ---------------------------------------------------------------------
    try {
      const donorSignIn = await signIn('donor@test.com');
      if (donorSignIn.error) throw donorSignIn.error;

      const { data, error } = await supabase
        .from('profiles')
        .update({ role: 'admin' })
        .eq('id', donorSignIn.user.id)
        .select('id, role');

      // Also read back to be sure role did not actually change.
      const { data: after, error: readErr } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', donorSignIn.user.id)
        .single();
      if (readErr) throw readErr;

      const rej = isRejected(error, data);
      const stillDonor = after?.role === 'donor';
      const passed = rej.rejected || stillDonor;
      record(
        '3. donor@test.com cannot change own role to admin',
        passed,
        `update=${rej.rejected ? 'rejected' : 'not rejected'}, role after=${after?.role}`
      );
    } catch (err) {
      record('3. donor@test.com cannot change own role to admin', false, err.message);
    }

    // ---------------------------------------------------------------------
    // Check 4: fresh NGO signup is pending; admin verify/reject works + notification
    // ---------------------------------------------------------------------
    try {
      freshNgoEmail = `ngo-test-${Date.now()}@test.com`;
      // Register a fresh NGO user through normal auth signup.
      const { data: signupData, error: signupErr } = await supabase.auth.signUp({
        email: freshNgoEmail,
        password: PASSWORD,
        options: {
          data: {
            name: 'Test NGO User',
            role: 'ngo',
            org_name: 'Test NGO Org',
            phone: '9999999999',
            address: 'Test Address',
          },
        },
      });
      if (signupErr) throw signupErr;
      freshNgoId = signupData?.user?.id || null;

      // If email confirmation is enabled, sign in may fail; try sign in anyway.
      if (!signupData?.session) {
        const trySignIn = await supabase.auth.signInWithPassword({
          email: freshNgoEmail,
          password: PASSWORD,
        });
        if (!trySignIn.error && trySignIn.data?.user) {
          freshNgoId = trySignIn.data.user.id;
        }
      }

      if (!freshNgoId) {
        record(
          '4a. Fresh NGO signup creates pending NGO',
          false,
          'Could not obtain fresh NGO user id (email confirmation may be required)'
        );
      } else {
        // Read profile as admin to avoid RLS visibility issues.
        const adminSignIn = await signIn('admin@test.com');
        if (adminSignIn.error) throw adminSignIn.error;

        const { data: pendingProfile, error: pendingErr } = await supabase
          .from('profiles')
          .select('id, verification_status')
          .eq('id', freshNgoId)
          .single();
        if (pendingErr) throw pendingErr;

        record(
          '4a. Fresh NGO signup creates pending NGO',
          pendingProfile.verification_status === 'pending',
          `verification_status=${pendingProfile.verification_status}`
        );

        // Approve = true
        const { error: approveErr } = await supabase.rpc('admin_verify_ngo', {
          p_ngo_id: freshNgoId,
          p_approve: true,
        });
        if (approveErr) throw approveErr;

        const { data: verifiedProfile, error: verifiedErr } = await supabase
          .from('profiles')
          .select('verification_status')
          .eq('id', freshNgoId)
          .single();
        if (verifiedErr) throw verifiedErr;

        const { data: ngoNotifs, error: notifErr } = await supabase
          .from('notifications')
          .select('id, message')
          .eq('user_id', freshNgoId)
          .order('created_at', { ascending: false })
          .limit(5);
        if (notifErr) throw notifErr;

        record(
          '4b. admin_verify_ngo(approve=true) verifies NGO and creates notification',
          verifiedProfile.verification_status === 'verified' && (ngoNotifs?.length || 0) > 0,
          `verification_status=${verifiedProfile.verification_status}, notifications=${ngoNotifs?.length || 0}`
        );

        // Approve = false (reject)
        const { error: rejectErr } = await supabase.rpc('admin_verify_ngo', {
          p_ngo_id: freshNgoId,
          p_approve: false,
        });
        if (rejectErr) throw rejectErr;

        const { data: rejectedProfile, error: rejectedErr } = await supabase
          .from('profiles')
          .select('verification_status')
          .eq('id', freshNgoId)
          .single();
        if (rejectedErr) throw rejectedErr;

        record(
          '4c. admin_verify_ngo(approve=false) rejects NGO',
          rejectedProfile.verification_status === 'rejected',
          `verification_status=${rejectedProfile.verification_status}`
        );
      }
    } catch (err) {
      record('4. Fresh NGO verification flow', false, err.message);
    }

    // ---------------------------------------------------------------------
    // Check 5: admin cancel donation flow
    // ---------------------------------------------------------------------
    try {
      // Donor creates a test donation.
      const donorSignIn = await signIn('donor@test.com');
      if (donorSignIn.error) throw donorSignIn.error;

      const now = Date.now();
      const { data: donation, error: createErr } = await supabase
        .from('donations')
        .insert([
          {
            donor_id: donorSignIn.user.id,
            title: '[TEST] admin cancel',
            category: 'veg',
            food_type: 'cooked',
            quantity: 5,
            unit: 'servings',
            prepared_at: new Date(now - 15 * 60 * 1000).toISOString(),
            expires_at: new Date(now + 120 * 60 * 1000).toISOString(),
            pickup_start: new Date(now + 15 * 60 * 1000).toISOString(),
            pickup_end: new Date(now + 60 * 60 * 1000).toISOString(),
            address: 'Test Address',
            lat: 13.0827,
            lng: 80.2707,
            image_urls: [],
            notes: 'Admin cancel verification test',
          },
        ])
        .select('id, status')
        .single();
      if (createErr) throw createErr;
      createdDonationId = donation.id;

      // Admin cancels it.
      const adminSignIn = await signIn('admin@test.com');
      if (adminSignIn.error) throw adminSignIn.error;
      const { error: cancelErr } = await supabase.rpc('admin_cancel_donation', {
        p_donation_id: createdDonationId,
        p_reason: 'test',
      });
      if (cancelErr) throw cancelErr;

      // Check donation status.
      const { data: cancelledDonation, error: donationReadErr } = await supabase
        .from('donations')
        .select('id, status')
        .eq('id', createdDonationId)
        .single();
      if (donationReadErr) throw donationReadErr;

      // Check donation event note.
      const { data: events, error: eventErr } = await supabase
        .from('donation_events')
        .select('note, to_status')
        .eq('donation_id', createdDonationId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (eventErr) throw eventErr;
      const hasAdminNote = (events || []).some(
        (e) => e.to_status === 'CANCELLED' && String(e.note || '').startsWith('Cancelled by admin')
      );

      // Check donor notification.
      const { data: donorNotifs, error: donorNotifErr } = await supabase
        .from('notifications')
        .select('id, message, donation_id')
        .eq('user_id', donorSignIn.user.id)
        .eq('donation_id', createdDonationId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (donorNotifErr) throw donorNotifErr;

      record(
        '5a. admin_cancel_donation cancels donation, logs event, notifies donor',
        cancelledDonation.status === 'CANCELLED' && hasAdminNote && (donorNotifs?.length || 0) > 0,
        `status=${cancelledDonation.status}, adminNote=${hasAdminNote}, donorNotifications=${donorNotifs?.length || 0}`
      );

      // Second cancel should be rejected (already closed).
      const { data: secondData, error: secondErr } = await supabase.rpc('admin_cancel_donation', {
        p_donation_id: createdDonationId,
        p_reason: 'test again',
      });
      const rej = isRejected(secondErr, secondData);
      record('5b. Second admin_cancel_donation is rejected', rej.rejected, rej.reason);
    } catch (err) {
      record('5. Admin cancel donation flow', false, err.message);
    }
  } finally {
    // Best-effort cleanup: leave test data harmless; do not use service role.
    await supabase.auth.signOut();

    console.log('\nAdmin Flow Verification Results:');
    console.table(results);

    const failed = results.filter((r) => r.status === 'FAIL').length;
    const passed = results.length - failed;
    console.log(`\n${passed} PASS / ${failed} FAIL`);
    if (failed > 0) process.exitCode = 1;
  }
}

run();
