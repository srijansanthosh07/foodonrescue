import { createClient } from '@supabase/supabase-js';

// Read public Supabase credentials from Vite environment variables.
// IMPORTANT: Never put the Supabase service_role key in frontend code!
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Create and export the Supabase client (returns null if .env is not set yet so the UI can show a helpful error)
export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;
