import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Master-key client. Use ONLY for creating and managing login accounts, after checking admin.users. */
export const createAdminClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
