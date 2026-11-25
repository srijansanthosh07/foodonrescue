-- ============================================================================
-- FOR (Food on Rescue) — Step 2: Database Schema, Indexes & Triggers
-- Run this entire script once in the Supabase Dashboard -> SQL Editor.
-- Safe to re-run: enums, tables, indexes, functions, and triggers use
-- IF NOT EXISTS / OR REPLACE / DROP IF EXISTS guards.
-- ============================================================================


-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================

-- Roles a user can have in the platform
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('donor', 'ngo', 'volunteer', 'admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Donation lifecycle statuses
DO $$ BEGIN
  CREATE TYPE public.donation_status AS ENUM (
    'AVAILABLE',
    'ACCEPTED',
    'ASSIGNED',
    'PICKED_UP',
    'DELIVERED',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Verification state (primarily used by Admin to verify NGOs)
DO $$ BEGIN
  CREATE TYPE public.verification_status AS ENUM ('pending', 'verified', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Status of an individual volunteer assignment request
DO $$ BEGIN
  CREATE TYPE public.assignment_status AS ENUM (
    'requested',
    'accepted',
    'declined',
    'timed_out',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 2. TABLES
-- ============================================================================

-- User profiles (1-to-1 with Supabase Auth users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.user_role NOT NULL DEFAULT 'donor',
  name text NOT NULL DEFAULT '',
  phone text,
  org_name text,
  address text,
  lat double precision,
  lng double precision,
  -- Defaults to 'pending' (used for NGOs awaiting admin approval)
  verification_status public.verification_status NOT NULL DEFAULT 'pending',
  -- Used for volunteers ('available', 'busy', 'offline')
  availability text CHECK (availability IS NULL OR availability IN ('available', 'busy', 'offline')),
  -- Admin can suspend an account; suspended users are signed out on login
  suspended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Surplus food donations posted by donors
CREATE TABLE IF NOT EXISTS public.donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL,      -- e.g. 'veg', 'non-veg'
  food_type text NOT NULL,     -- e.g. 'cooked', 'packaged'
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,          -- e.g. 'servings', 'kg'
  prepared_at timestamptz,
  expires_at timestamptz NOT NULL,
  pickup_start timestamptz NOT NULL,
  pickup_end timestamptz NOT NULL,
  address text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  image_urls text[] NOT NULL DEFAULT '{}',
  notes text,
  status public.donation_status NOT NULL DEFAULT 'AVAILABLE',
  accepted_by_ngo_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_volunteer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Volunteer assignment requests created when an NGO assigns a volunteer
CREATE TABLE IF NOT EXISTS public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id uuid NOT NULL REFERENCES public.donations(id) ON DELETE CASCADE,
  ngo_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  volunteer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.assignment_status NOT NULL DEFAULT 'requested',
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

-- Immutable audit trail of every donation status transition
CREATE TABLE IF NOT EXISTS public.donation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id uuid NOT NULL REFERENCES public.donations(id) ON DELETE CASCADE,
  from_status public.donation_status,
  to_status public.donation_status NOT NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- In-app notifications for donors, NGOs, volunteers, and admins
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message text NOT NULL,
  donation_id uuid REFERENCES public.donations(id) ON DELETE CASCADE,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- ============================================================================
-- 3. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_donations_status
  ON public.donations (status);

CREATE INDEX IF NOT EXISTS idx_donations_donor_id
  ON public.donations (donor_id);

CREATE INDEX IF NOT EXISTS idx_assignments_volunteer_id
  ON public.assignments (volunteer_id);


-- ============================================================================
-- 4. AUTO-CREATE PROFILE ON SIGNUP TRIGGER
--    Reads role and name from auth.users.raw_user_meta_data.
--    Security rule: never allow self-signup as 'admin' (forced to 'donor').
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_role text;
  safe_role public.user_role;
  user_name text;
BEGIN
  -- Normalize metadata role; default to 'donor' if missing
  raw_role := lower(trim(coalesce(NEW.raw_user_meta_data ->> 'role', 'donor')));

  -- Block 'admin' (and any unknown value) from client signup metadata
  IF raw_role IN ('donor', 'ngo', 'volunteer') THEN
    safe_role := raw_role::public.user_role;
  ELSE
    safe_role := 'donor'::public.user_role;
  END IF;

  -- Read display name from metadata, falling back to email prefix
  user_name := coalesce(
    nullif(trim(NEW.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(NEW.email, ''), '@', 1),
    'User'
  );

  INSERT INTO public.profiles (
    id,
    role,
    name,
    phone,
    org_name,
    address,
    lat,
    lng,
    verification_status,
    availability
  )
  VALUES (
    NEW.id,
    safe_role,
    user_name,
    nullif(trim(NEW.raw_user_meta_data ->> 'phone'), ''),
    nullif(trim(NEW.raw_user_meta_data ->> 'org_name'), ''),
    nullif(trim(NEW.raw_user_meta_data ->> 'address'), ''),
    CASE
      WHEN (NEW.raw_user_meta_data ->> 'lat') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (NEW.raw_user_meta_data ->> 'lat')::double precision
      ELSE NULL
    END,
    CASE
      WHEN (NEW.raw_user_meta_data ->> 'lng') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (NEW.raw_user_meta_data ->> 'lng')::double precision
      ELSE NULL
    END,
    -- NGOs start as 'pending' until Admin verifies them; donors/volunteers start 'verified'
    CASE
      WHEN safe_role = 'ngo' THEN 'pending'::public.verification_status
      ELSE 'verified'::public.verification_status
    END,
    -- Volunteers start as 'available'
    CASE
      WHEN safe_role = 'volunteer' THEN 'available'
      ELSE NULL
    END
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ============================================================================
-- 5. AUTO-UPDATE donations.updated_at TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_donations_set_updated_at ON public.donations;
CREATE TRIGGER trg_donations_set_updated_at
  BEFORE UPDATE ON public.donations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
