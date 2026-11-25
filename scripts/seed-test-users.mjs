// Seed script to create 4 test accounts in Supabase using ONLY the public anon key.
// Run from inside for-app with:
//   node --env-file=.env scripts/seed-test-users.mjs
// Or via npm:
//   npm run seed

import { createClient } from '@supabase/supabase-js';

// Read public Supabase settings from .env (loaded by Node's --env-file flag).
// NEVER use or commit the service_role key!
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Make sure .env is filled in and run with --env-file=.env.'
  );
  process.exit(1);
}

// Disable session persistence/auto-refresh since this is a one-off Node CLI script
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const TEST_PASSWORD = 'Test@1234';

// Sample coordinates placed a few kilometers apart (Chennai area) for distance matching tests
const TEST_ACCOUNTS = [
  {
    email: 'donor@test.com',
    role: 'donor',
    name: 'Test Donor',
    org_name: 'Test Restaurant',
    phone: '+91 90000 00001',
    address: '12 Anna Salai, Chennai',
    lat: 13.0827,
    lng: 80.2707,
  },
  {
    email: 'ngo@test.com',
    role: 'ngo',
    name: 'Test NGO',
    org_name: 'Helping Hands NGO',
    phone: '+91 90000 00002',
    address: '45 Nungambakkam High Rd, Chennai',
    lat: 13.0604,
    lng: 80.2496, // ~3.4 km from donor
  },
  {
    email: 'volunteer@test.com',
    role: 'volunteer',
    name: 'Test Volunteer',
    org_name: null,
    phone: '+91 90000 00003',
    address: '88 Royapuram Main Rd, Chennai',
    lat: 13.099,
    lng: 80.285, // ~2.4 km from donor
  },
  {
    email: 'admin@test.com',
    // Signed up as 'donor' first because the signup trigger blocks self-signup as 'admin'.
    // Promote this user to 'admin' directly in the Supabase SQL Editor when ready.
    role: 'donor',
    name: 'Test Admin',
    org_name: null,
    phone: '+91 90000 00004',
    address: '1 Egmore High Rd, Chennai',
    lat: 13.0732,
    lng: 80.2609,
  },
];

async function seedTestUsers() {
  const summary = [];

  for (const account of TEST_ACCOUNTS) {
    console.log(`Creating ${account.email} (${account.role})...`);

    try {
      // 1. Create auth user; the database trigger automatically inserts the profiles row
      const { data, error } = await supabase.auth.signUp({
        email: account.email,
        password: TEST_PASSWORD,
        options: {
          data: {
            name: account.name,
            role: account.role,
          },
        },
      });

      // Handle users that already exist in Supabase Auth
      const isAlreadyRegistered =
        error?.message?.toLowerCase().includes('already') ||
        (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0);

      if (isAlreadyRegistered) {
        console.log(`-> ${account.email}: already exists`);
        summary.push({
          email: account.email,
          role: account.role,
          result: 'already exists',
        });
        await supabase.auth.signOut();
        continue;
      }

      if (error) {
        console.error(`-> ${account.email} error:`, error.message);
        summary.push({
          email: account.email,
          role: account.role,
          result: `error: ${error.message}`,
        });
        await supabase.auth.signOut();
        continue;
      }

      // 2. If Supabase returned a session immediately, update the profile with location & contact info
      if (data?.session && data?.user) {
        const profilePatch = {
          phone: account.phone,
          address: account.address,
          lat: account.lat,
          lng: account.lng,
        };

        if (account.org_name) {
          profilePatch.org_name = account.org_name;
        }

        const { error: updateError } = await supabase
          .from('profiles')
          .update(profilePatch)
          .eq('id', data.user.id);

        if (updateError) {
          summary.push({
            email: account.email,
            role: account.role,
            result: `error updating profile: ${updateError.message}`,
          });
        } else {
          summary.push({
            email: account.email,
            role: account.role,
            result: 'success',
          });
        }
      } else {
        // Email confirmation is turned on in Supabase Auth, so no session exists yet
        summary.push({
          email: account.email,
          role: account.role,
          result: 'success (check email to confirm; profile geo fields skipped)',
        });
      }

      // 3. Sign out before creating the next account
      await supabase.auth.signOut();
    } catch (err) {
      summary.push({
        email: account.email,
        role: account.role,
        result: `error: ${err.message}`,
      });
      await supabase.auth.signOut();
    }
  }

  console.log('\nSeed summary:');
  console.table(summary);
}

seedTestUsers();
