// Automated database & RLS verification script for the NGO -> volunteer assignment flow.
// Uses ONLY the public anon key from .env (never a service_role key).
// Run from inside for-app with:
//   node --env-file=.env scripts/verify-assign-flow.mjs
// Or via npm:
//   npm run verify:assign
//
// Beginner notes:
// - Supabase RLS (Row Level Security) decides which rows each signed-in user may see/change.
// - We reuse ONE client and sign out/in before each action so the "current user" is correct.
// - Every check gets a row in the final PASS/FAIL table, even if we have to stop early.
// - The test donation is always cancelled at the end so it does not clutter the app.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Run with: node --env-file=.env scripts/verify-assign-flow.mjs'
  );
  process.exit(1);
}

const TEST_PASSWORD = 'Test@1234';
const DONATION_TITLE = '[TEST] assign flow';

// Create a Node-safe client without browser session storage.
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const CHECKS = [
  '1. Donor creates "[TEST] assign flow" with future expiry',
  '2. NGO accepts the donation',
  '3. ngo2 cannot assign a volunteer (skipped if absent)',
  '4. Donor cannot assign a volunteer',
  '5. NGO assigns volunteer; assignment requested, donation ACCEPTED',
  '6. Volunteer reads donation and sees one request notification',
  '7. Volunteer declines; donation ACCEPTED and NGO notified',
  '8. NGO assigns again and volunteer accepts; donation ASSIGNED',
  '9. NGO unassigns; donation ACCEPTED and assignment cancelled',
  '10. Donor cancels the test donation (cleanup)',
];

// Start every row as FAIL/"Not run" so the table always has one row per check.
const results = CHECKS.map((check) => ({ check, status: 'FAIL', details: 'Not run' }));

// Replace the placeholder row for a check with its real result.
function record(number, passed, details) {
  results[number - 1] = {
    check: CHECKS[number - 1],
    status: passed ? 'PASS' : 'FAIL',
    details,
  };
}

// Sign out first so the next sign-in definitely belongs to the requested test user.
async function signIn(email) {
  await supabase.auth.signOut();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });

  if (error || !data?.user) {
    return { user: null, error: error?.message || `No user returned for ${email}` };
  }
  return { user: data.user, error: null };
}

// maybeSingle() gives us null (not an error) when RLS hides the row.
async function readDonation(id) {
  const { data, error } = await supabase
    .from('donations')
    .select('id, title, status, donor_id, accepted_by_ngo_id, assigned_volunteer_id, expires_at')
    .eq('id', id)
    .maybeSingle();
  return { donation: data, error };
}

async function readAssignment(id) {
  const { data, error } = await supabase
    .from('assignments')
    .select('id, donation_id, ngo_id, volunteer_id, status, requested_at, responded_at')
    .eq('id', id)
    .maybeSingle();
  return { assignment: data, error };
}

async function readNotifications(userId, donationId) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, message, created_at')
    .eq('user_id', userId)
    .eq('donation_id', donationId)
    .order('created_at', { ascending: true });
  return { notifications: data ?? [], error };
}

async function runVerification() {
  let donationId = null;
  let assignmentId = null;
  let ngoUser = null;
  let volunteerUser = null;
  let currentCheck = 1;

  try {
    // Setup: we need the volunteer's real auth UUID for assign_volunteer.
    // Signing in here is only a lookup; the assign RPC itself is called by the NGO later.
    const volunteerLookup = await signIn('volunteer@test.com');
    volunteerUser = volunteerLookup.user;
    const volunteerId = volunteerUser?.id ?? null;

    // ------------------------------------------------------------------------
    // Check 1: donor creates a valid donation with an expiry in the future.
    // ------------------------------------------------------------------------
    currentCheck = 1;
    const donorSignIn = await signIn('donor@test.com');
    if (!donorSignIn.user) {
      record(1, false, donorSignIn.error);
      return;
    }

    const now = Date.now();
    const expiresAt = new Date(now + 120 * 60 * 1000).toISOString();
    const { data: created, error: createError } = await supabase
      .from('donations')
      .insert([
        {
          donor_id: donorSignIn.user.id,
          title: DONATION_TITLE,
          category: 'veg',
          food_type: 'cooked',
          quantity: 10,
          unit: 'servings',
          prepared_at: new Date(now - 15 * 60 * 1000).toISOString(),
          expires_at: expiresAt,
          pickup_start: new Date(now + 15 * 60 * 1000).toISOString(),
          pickup_end: new Date(now + 60 * 60 * 1000).toISOString(),
          address: '12 Anna Salai, Chennai',
          lat: 13.0827,
          lng: 80.2707,
          image_urls: [],
          notes: 'Automated assignment-flow verification test',
        },
      ])
      .select()
      .single();

    if (createError || !created?.id) {
      record(1, false, createError?.message || 'Insert returned no row');
      return;
    }

    donationId = created.id;
    record(
      1,
      created.status === 'AVAILABLE',
      `Created ${donationId} with status ${created.status}, expires ${expiresAt}`
    );

    // ------------------------------------------------------------------------
    // Check 2: only ngo@test.com may accept it; then confirm the new status.
    // ------------------------------------------------------------------------
    currentCheck = 2;
    const ngoSignIn = await signIn('ngo@test.com');
    if (!ngoSignIn.user) {
      record(2, false, ngoSignIn.error);
      return;
    }
    ngoUser = ngoSignIn.user;

    const { error: acceptError } = await supabase.rpc('accept_donation', {
      p_donation_id: donationId,
    });
    if (acceptError) {
      record(2, false, acceptError.message);
      return;
    }

    const acceptedRead = await readDonation(donationId);
    const acceptOk =
      !acceptedRead.error && acceptedRead.donation?.status === 'ACCEPTED';
    record(
      2,
      acceptOk,
      acceptOk
        ? `Status ACCEPTED by NGO ${ngoUser.id}`
        : acceptedRead.error?.message || `Unexpected status: ${acceptedRead.donation?.status}`
    );
    if (!acceptOk) return;

    // ------------------------------------------------------------------------
    // Check 3: a second NGO must be rejected. If ngo2 was never seeded, this
    // is a SKIP (recorded as PASS) rather than a false FAIL.
    // ------------------------------------------------------------------------
    currentCheck = 3;
    const ngo2SignIn = await signIn('ngo2@test.com');
    if (!ngo2SignIn.user) {
      record(3, true, `SKIPPED: ngo2@test.com is not available (${ngo2SignIn.error})`);
    } else if (!volunteerId) {
      record(3, false, 'Cannot test because volunteer@test.com sign-in failed');
    } else {
      const { error: ngo2AssignError } = await supabase.rpc('assign_volunteer', {
        p_donation_id: donationId,
        p_volunteer_id: volunteerId,
      });
      record(
        3,
        Boolean(ngo2AssignError),
        ngo2AssignError
          ? `Rejected as expected: ${ngo2AssignError.message}`
          : 'SECURITY FAILURE: ngo2 was allowed to assign!'
      );
    }

    // ------------------------------------------------------------------------
    // Check 4: a donor must also be rejected by the assign_volunteer RPC.
    // ------------------------------------------------------------------------
    currentCheck = 4;
    const donorAgainSignIn = await signIn('donor@test.com');
    if (!donorAgainSignIn.user) {
      record(4, false, donorAgainSignIn.error);
    } else if (!volunteerId) {
      record(4, false, 'Cannot test because volunteer@test.com sign-in failed');
    } else {
      const { error: donorAssignError } = await supabase.rpc('assign_volunteer', {
        p_donation_id: donationId,
        p_volunteer_id: volunteerId,
      });
      record(
        4,
        Boolean(donorAssignError),
        donorAssignError
          ? `Rejected as expected: ${donorAssignError.message}`
          : 'SECURITY FAILURE: donor was allowed to assign!'
      );
    }

    // ------------------------------------------------------------------------
    // Check 5: the owning NGO assigns the volunteer. The assignment starts as
    // 'requested'; the donation stays ACCEPTED until the volunteer answers.
    // ------------------------------------------------------------------------
    currentCheck = 5;
    const ngoAgainSignIn = await signIn('ngo@test.com');
    if (!ngoAgainSignIn.user) {
      record(5, false, ngoAgainSignIn.error);
      return;
    }
    ngoUser = ngoAgainSignIn.user;

    if (!volunteerId) {
      record(5, false, 'Cannot test because volunteer@test.com sign-in failed');
      return;
    }

    const { error: assignError } = await supabase.rpc('assign_volunteer', {
      p_donation_id: donationId,
      p_volunteer_id: volunteerId,
    });
    if (assignError) {
      record(5, false, assignError.message);
      return;
    }

    const { data: assignmentRows, error: assignmentQueryError } = await supabase
      .from('assignments')
      .select('id, status, ngo_id, volunteer_id')
      .eq('donation_id', donationId)
      .eq('ngo_id', ngoUser.id)
      .eq('volunteer_id', volunteerId)
      .order('requested_at', { ascending: false })
      .limit(1);
    const assignmentRow = assignmentRows?.[0] ?? null;
    assignmentId = assignmentRow?.id ?? null;

    const donationAfterAssign = await readDonation(donationId);
    const assignOk =
      !assignmentQueryError &&
      assignmentRow?.status === 'requested' &&
      !donationAfterAssign.error &&
      donationAfterAssign.donation?.status === 'ACCEPTED';
    record(
      5,
      assignOk,
      assignOk
        ? `Assignment ${assignmentId} is requested; donation still ACCEPTED`
        : assignmentQueryError?.message ||
          donationAfterAssign.error?.message ||
          `assignment=${assignmentRow?.status}, donation=${donationAfterAssign.donation?.status}`
    );
    if (!assignOk) return;

    // ------------------------------------------------------------------------
    // Check 6: the volunteer can now see the donation and exactly one notice.
    // ------------------------------------------------------------------------
    currentCheck = 6;
    const volunteerSignIn = await signIn('volunteer@test.com');
    if (!volunteerSignIn.user) {
      record(6, false, volunteerSignIn.error);
      return;
    }
    volunteerUser = volunteerSignIn.user;

    const { data: visibleDonations, error: visibleError } = await supabase
      .from('donations')
      .select('id, status')
      .eq('id', donationId);
    const volunteerNotices = await readNotifications(volunteerUser.id, donationId);
    const readOk = !visibleError && visibleDonations?.length === 1;
    const noticeOk = !volunteerNotices.error && volunteerNotices.notifications.length === 1;
    record(
      6,
      readOk && noticeOk,
      `Visible rows=${visibleDonations?.length ?? '?'}, notifications=${volunteerNotices.notifications.length}` +
        (volunteerNotices.notifications[0]?.message
          ? ` ("${volunteerNotices.notifications[0].message}")`
          : '') +
        (visibleError || volunteerNotices.error
          ? ` [${visibleError?.message || volunteerNotices.error?.message}]`
          : '')
    );

    // ------------------------------------------------------------------------
    // Check 7: volunteer declines. The donation must remain ACCEPTED and the
    // owning NGO should receive a notification about the decline.
    // ------------------------------------------------------------------------
    currentCheck = 7;
    const { error: declineError } = await supabase.rpc('respond_assignment', {
      p_assignment_id: assignmentId,
      p_accept: false,
    });
    if (declineError) {
      record(7, false, declineError.message);
      return;
    }

    // Read the assignment as the volunteer (they own it), but read the
    // donation as the NGO: after declining, RLS may hide it from the volunteer.
    const declinedAssignment = await readAssignment(assignmentId);

    const ngoForNoticeSignIn = await signIn('ngo@test.com');
    if (!ngoForNoticeSignIn.user) {
      record(7, false, ngoForNoticeSignIn.error);
      return;
    }
    ngoUser = ngoForNoticeSignIn.user;
    const donationAfterDecline = await readDonation(donationId);
    const ngoNotices = await readNotifications(ngoUser.id, donationId);

    const declineOk =
      !declinedAssignment.error &&
      declinedAssignment.assignment?.status === 'declined' &&
      !donationAfterDecline.error &&
      donationAfterDecline.donation?.status === 'ACCEPTED' &&
      !ngoNotices.error &&
      ngoNotices.notifications.length >= 1;
    record(
      7,
      declineOk,
      declineOk
        ? `Assignment declined, donation ACCEPTED, NGO notices=${ngoNotices.notifications.length}`
        : `assignment=${declinedAssignment.assignment?.status}, donation=${donationAfterDecline.donation?.status}, NGO notices=${ngoNotices.notifications.length}` +
          (declinedAssignment.error || donationAfterDecline.error || ngoNotices.error
            ? ` [${declinedAssignment.error?.message || donationAfterDecline.error?.message || ngoNotices.error?.message}]`
            : '')
    );
    if (!declineOk) return;

    // ------------------------------------------------------------------------
    // Check 8: NGO assigns again; this time the volunteer accepts, which is
    // the moment the donation officially becomes ASSIGNED.
    // ------------------------------------------------------------------------
    currentCheck = 8;
    const { error: assignAgainError } = await supabase.rpc('assign_volunteer', {
      p_donation_id: donationId,
      p_volunteer_id: volunteerId,
    });
    if (assignAgainError) {
      record(8, false, assignAgainError.message);
      return;
    }

    const { data: secondRows, error: secondQueryError } = await supabase
      .from('assignments')
      .select('id, status')
      .eq('donation_id', donationId)
      .eq('ngo_id', ngoUser.id)
      .eq('volunteer_id', volunteerId)
      .order('requested_at', { ascending: false })
      .limit(1);
    assignmentId = secondRows?.[0]?.id ?? assignmentId;

    const volunteerAcceptSignIn = await signIn('volunteer@test.com');
    if (!volunteerAcceptSignIn.user) {
      record(8, false, volunteerAcceptSignIn.error);
      return;
    }

    const { error: acceptAssignmentError } = await supabase.rpc('respond_assignment', {
      p_assignment_id: assignmentId,
      p_accept: true,
    });
    if (acceptAssignmentError) {
      record(8, false, acceptAssignmentError.message);
      return;
    }

    const ngoFinalSignIn = await signIn('ngo@test.com');
    if (!ngoFinalSignIn.user) {
      record(8, false, ngoFinalSignIn.error);
      return;
    }
    ngoUser = ngoFinalSignIn.user;

    const assignedDonation = await readDonation(donationId);
    const acceptedAssignment = await readAssignment(assignmentId);
    const finalAssignOk =
      !secondQueryError &&
      !assignedDonation.error &&
      assignedDonation.donation?.status === 'ASSIGNED' &&
      assignedDonation.donation?.assigned_volunteer_id === volunteerUser.id &&
      !acceptedAssignment.error &&
      acceptedAssignment.assignment?.status === 'accepted';
    record(
      8,
      finalAssignOk,
      finalAssignOk
        ? `Donation ASSIGNED to volunteer ${volunteerUser.id}`
        : secondQueryError?.message ||
          assignedDonation.error?.message ||
          acceptedAssignment.error?.message ||
          `donation=${assignedDonation.donation?.status}, assigned_volunteer_id=${assignedDonation.donation?.assigned_volunteer_id}, assignment=${acceptedAssignment.assignment?.status}`
    );
    if (!finalAssignOk) return;

    // ------------------------------------------------------------------------
    // Check 9: unassign returns the donation to ACCEPTED and cancels the row.
    // ------------------------------------------------------------------------
    currentCheck = 9;
    const { error: unassignError } = await supabase.rpc('unassign_volunteer', {
      p_donation_id: donationId,
    });
    if (unassignError) {
      record(9, false, unassignError.message);
      return;
    }

    const unassignedDonation = await readDonation(donationId);
    const cancelledAssignment = await readAssignment(assignmentId);
    const unassignOk =
      !unassignedDonation.error &&
      unassignedDonation.donation?.status === 'ACCEPTED' &&
      unassignedDonation.donation?.assigned_volunteer_id === null &&
      !cancelledAssignment.error &&
      cancelledAssignment.assignment?.status === 'cancelled';
    record(
      9,
      unassignOk,
      unassignOk
        ? 'Donation ACCEPTED, assigned_volunteer_id null, assignment cancelled'
        : unassignedDonation.error?.message ||
          cancelledAssignment.error?.message ||
          `donation=${unassignedDonation.donation?.status}, assigned_volunteer_id=${unassignedDonation.donation?.assigned_volunteer_id}, assignment=${cancelledAssignment.assignment?.status}`
    );
  } catch (err) {
    record(currentCheck, false, `Unexpected script error: ${err.message}`);
  } finally {
    // ----------------------------------------------------------------------
    // Check 10: always try to clean up, even if an earlier check failed.
    // ----------------------------------------------------------------------
    currentCheck = 10;
    if (donationId) {
      const cleanupSignIn = await signIn('donor@test.com');
      if (!cleanupSignIn.user) {
        record(10, false, `Could not sign in for cleanup: ${cleanupSignIn.error}`);
      } else {
        const { data: cancelled, error: cancelError } = await supabase
          .from('donations')
          .update({ status: 'CANCELLED' })
          .eq('id', donationId)
          .select('id, status')
          .single();
        record(
          10,
          !cancelError && cancelled?.status === 'CANCELLED',
          cancelError?.message || `Donation ${donationId} is ${cancelled?.status}`
        );
      }
    } else {
      record(10, false, 'No test donation was created, so nothing to cancel');
    }

    await supabase.auth.signOut();

    console.log('\nAssignment Flow Verification Results:');
    console.table(results);

    const passed = results.filter((row) => row.status === 'PASS').length;
    const failed = results.length - passed;
    console.log(`\n${passed} PASS / ${failed} FAIL`);
    if (failed > 0) process.exitCode = 1;
  }
}

runVerification();
