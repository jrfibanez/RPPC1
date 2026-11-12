import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const url = new URL('/login', request.url);
  if (request.nextUrl.searchParams.get('reason') === 'inactive') url.searchParams.set('error', 'This account is turned off. Ask the Admin.');
  return NextResponse.redirect(url, { status: 303 });
}
export const GET = signOut;
export const POST = signOut;
