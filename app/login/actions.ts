'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

export async function login(form: FormData) {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect('/login?error=' + encodeURIComponent('Enter your email and password.'));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirect('/login?error=' + encodeURIComponent('Wrong email or password, or the account is turned off.'));
  redirect('/');
}
