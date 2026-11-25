// Automated database & RLS verification script for the Donor flow.
// Uses ONLY the public anon key from .env.
// Run from inside for-app with:
//   node --env-file=.env scripts/verify-donor-flow.mjs
// Or via npm:
//   npm run verify:donor

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Run with: node --env-file=.env scripts/verify-donor-flow.mjs'
  );
  process.exit(1);
}

// Create a Node-safe Supabase client without browser session persistence
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

async function runVerification() {
  let donorUser = null;
  let volunteerUser = null;
  let createdDonationId = null;

  try {
    // Sign in as test donor
    const { data: donorAuth, error: donorSignInErr } = await supabase.auth.signInWithPassword({
      email: 'donor@test.com',
      password: 'Test@1234',
    });

    if (donorSignInErr || !donorAuth?.user) {
      record('0. Donor sign-in', false, donorSignInErr?.message || 'Could not sign in as donor@test.com');
      console.table(results);
      process.exit(1);
    }

    donorUser = donorAuth.user;

    // Build valid future timestamps for expiry and pickup window
    const now = Date.now();
    const preparedAt = new Date(now - 15 * 60 * 1000).toISOString();
    const pickupStart = new Date(now + 15 * 60 * 1000).toISOString();
    const pickupEnd = new Date(now + 60 * 60 * 1000).toISOString();
    const expiresAt = new Date(now + 120 * 60 * 1000).toISOString();

    // ------------------------------------------------------------------------
    // Check 1: Insert valid donation (expect success + status AVAILABLE)
    // ------------------------------------------------------------------------
    const { data: insertedRow, error: insertErr } = await supabase
      .from('donations')
      .insert([
        {
          donor_id: donorUser.id,
          title: '[TEST] verify script',
          category: 'veg',
          food_type: 'cooked',
          quantity: 10,
          unit: 'servings',
          prepared_at: preparedAt,
          expires_at: expiresAt,
          pickup_start: pickupStart,
          pickup_end: pickupEnd,
          address: '12 Anna Salai, Chennai',
          lat: 13.0827,
          lng: 80.2707,
          image_urls: [],
          notes: 'Automated donor verification test',
        },
      ])
      .select()
      .single();

    if (!insertErr && insertedRow?.id && insertedRow.status === 'AVAILABLE') {
      createdDonationId = insertedRow.id;
      record('1. Insert valid donation', true, `Created ${createdDonationId} with status AVAILABLE`);
    } else {
      record(
        '1. Insert valid donation',
        false,
        insertErr?.message || `Unexpected status: ${insertedRow?.status}`
      );
    }

    // ------------------------------------------------------------------------
    // Check 2: Read it back with .eq('donor_id', user.id)
    // ------------------------------------------------------------------------
    if (createdDonationId) {
      const { data: readRows, error: readErr } = await supabase
        .from('donations')
        .select('*')
        .eq('donor_id', donorUser.id)
        .eq('id', createdDonationId);

      const found = !readErr && Array.isArray(readRows) && readRows.length === 1;
      record(
        '2. Read back own donation',
        found,
        found ? 'Found 1 matching donation row' : readErr?.message || 'Donation not returned'
      );
    } else {
      record('2. Read back own donation', false, 'Skipped because Check 1 did not create a row');
    }

    // ------------------------------------------------------------------------
    // Check 3: Try to insert a donation directly with status 'ACCEPTED' (expect RLS rejection)
    // ------------------------------------------------------------------------
    const { data: badInsert, error: badInsertErr } = await supabase
      .from('donations')
      .insert([
        {
          donor_id: donorUser.id,
          title: '[TEST] illegal ACCEPTED insert',
          category: 'veg',
          food_type: 'cooked',
          quantity: 5,
          unit: 'servings',
          expires_at: expiresAt,
          pickup_start: pickupStart,
          pickup_end: pickupEnd,
          address: '12 Anna Salai, Chennai',
          lat: 13.0827,
          lng: 80.2707,
          image_urls: [],
          status: 'ACCEPTED',
        },
      ])
      .select();

    const insertRejected = Boolean(badInsertErr) || !badInsert || badInsert.length === 0;
    record(
      '3. Reject insert with status ACCEPTED',
      insertRejected,
      insertRejected
        ? `Rejected as expected (${badInsertErr?.message || '0 rows'})`
        : 'Security failure: ACCEPTED insert was allowed!'
    );

    // ------------------------------------------------------------------------
    // Check 4: Try to update test donation to 'COMPLETED' (expect rejection)
    // ------------------------------------------------------------------------
    if (createdDonationId) {
      const { data: compData, error: compErr } = await supabase
        .from('donations')
        .update({ status: 'COMPLETED' })
        .eq('id', createdDonationId)
        .select();

      const compRejected = Boolean(compErr) || !compData || compData.length === 0;
      record(
        '4. Reject update to COMPLETED',
        compRejected,
        compRejected
          ? `Rejected as expected (${compErr?.message || '0 rows updated'})`
          : 'Security failure: donor was able to set status to COMPLETED!'
      );
    } else {
      record('4. Reject update to COMPLETED', false, 'Skipped because Check 1 did not create a row');
    }

    // ------------------------------------------------------------------------
    // Check 5: Update test donation to 'CANCELLED' (expect success)
    // ------------------------------------------------------------------------
    if (createdDonationId) {
      const { data: cancelData, error: cancelErr } = await supabase
        .from('donations')
        .update({ status: 'CANCELLED' })
        .eq('id', createdDonationId)
        .select()
        .single();

      const cancelledOk = !cancelErr && cancelData?.status === 'CANCELLED';
      record(
        '5. Cancel own donation',
        cancelledOk,
        cancelledOk ? 'Updated status to CANCELLED' : cancelErr?.message || 'Cancel failed'
      );
    } else {
      record('5. Cancel own donation', false, 'Skipped because Check 1 did not create a row');
    }

    // ------------------------------------------------------------------------
    // Check 6: Sign out, sign in as volunteer@test.com, try to read cancelled donation
    // ------------------------------------------------------------------------
    await supabase.auth.signOut();

    const { data: volAuth, error: volSignInErr } = await supabase.auth.signInWithPassword({
      email: 'volunteer@test.com',
      password: 'Test@1234',
    });

    if (volSignInErr || !volAuth?.user) {
      record(
        '6. Volunteer cannot read cancelled donation',
        false,
        volSignInErr?.message || 'Could not sign in as volunteer@test.com'
      );
    } else {
      volunteerUser = volAuth.user;
      if (createdDonationId) {
        const { data: volRead, error: volReadErr } = await supabase
          .from('donations')
          .select('*')
          .eq('id', createdDonationId);

        const zeroRows = !volReadErr && Array.isArray(volRead) && volRead.length === 0;
        record(
          '6. Volunteer cannot read cancelled donation',
          zeroRows,
          zeroRows
            ? 'Returned 0 rows as expected'
            : volReadErr?.message || `Returned ${volRead?.length} row(s)`
        );
      } else {
        record(
          '6. Volunteer cannot read cancelled donation',
          false,
          'Skipped because Check 1 did not create a row'
        );
      }
    }

    // ------------------------------------------------------------------------
    // Check 7: Storage RLS — upload to own folder, reject other folder, delete own file
    // ------------------------------------------------------------------------
    await supabase.auth.signOut();
    await supabase.auth.signInWithPassword({
      email: 'donor@test.com',
      password: 'Test@1234',
    });

    const sampleFile = new Blob(['donor verification test'], { type: 'text/plain' });
    const ownPath = `${donorUser.id}/verify-${Date.now()}.txt`;
    const otherUserId = volunteerUser?.id || '00000000-0000-0000-0000-000000000000';
    const otherPath = `${otherUserId}/verify-blocked-${Date.now()}.txt`;

    const { error: ownUploadErr } = await supabase.storage
      .from('donation-images')
      .upload(ownPath, sampleFile);

    const { error: otherUploadErr } = await supabase.storage
      .from('donation-images')
      .upload(otherPath, sampleFile);

    let removeErr = null;
    if (!ownUploadErr) {
      const removeRes = await supabase.storage.from('donation-images').remove([ownPath]);
      removeErr = removeRes.error;
    }

    const storagePassed = !ownUploadErr && Boolean(otherUploadErr) && !removeErr;
    record(
      '7. Storage own upload, cross-user reject, delete',
      storagePassed,
      storagePassed
        ? 'Own upload OK, cross-user upload rejected, own file deleted'
        : `ownUpload=${ownUploadErr?.message || 'ok'}, otherUpload=${
            otherUploadErr?.message || 'ALLOWED (unexpected)'
          }, delete=${removeErr?.message || 'ok'}`
    );

    await supabase.auth.signOut();
  } catch (err) {
    record('Unexpected script error', false, err.message);
  }

  console.log('\nDonor Flow Verification Results:');
  console.table(results);

  const anyFailed = results.some((r) => r.status === 'FAIL');
  if (anyFailed) {
    process.exit(1);
  }
}

runVerification();
