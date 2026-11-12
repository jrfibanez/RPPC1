'use server';
import { redirect } from 'next/navigation';
import { explain, getSession } from '@/lib/auth';
import { createIntake } from '@/lib/intake';
import { attachmentSchema, commentSchema, firstIssue, ticketSchema, ticketUpdateSchema, voidSchema } from '@/lib/validation/schemas';

const back = (path: string, error: string): never => redirect(`${path}?error=${encodeURIComponent(error)}`);
const denied = 'You are not allowed to do this.';

export async function createTicketAction(form: FormData) {
  const { supabase } = await getSession();
  const parsed = ticketSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return back('/tickets/new', firstIssue(parsed.error));
  const t = parsed.data;
  let ticketId: string;
  try {
    ({ ticketId } = await createIntake(supabase).ingest({
      source: 'manual', channel: t.channel, categoryId: t.category_id, subject: t.subject, text: t.description,
      clientId: t.client_id, siteId: t.site_id, ownerId: t.owner_id, dueAt: t.due_at,
    }));
  } catch (e) {
    return back('/tickets/new', explain(e as { code?: string; message: string }));
  }
  redirect(`/tickets/${ticketId}?notice=Ticket+created.+Attach+the+chat+screenshot+below.`);
}

export async function updateTicketAction(form: FormData) {
  const { supabase } = await getSession();
  const parsed = ticketUpdateSchema.safeParse(Object.fromEntries(form));
  const id = String(form.get('id'));
  if (!parsed.success) return back(`/tickets/${id}`, firstIssue(parsed.error));
  const { id: _id, ...patch } = parsed.data;
  const { data, error } = await supabase.from('tickets').update(patch).eq('id', id).select('id');
  if (error || !data?.length) return back(`/tickets/${id}`, error ? explain(error) : denied);
  redirect(`/tickets/${id}?notice=Saved`);
}

export async function addCommentAction(form: FormData) {
  const { supabase, user } = await getSession();
  const parsed = commentSchema.safeParse(Object.fromEntries(form));
  const id = String(form.get('ticket_id'));
  if (!parsed.success) return back(`/tickets/${id}`, firstIssue(parsed.error));
  const { error } = await supabase.from('ticket_comments').insert({ ...parsed.data, author_id: user.id });
  if (error) return back(`/tickets/${id}`, explain(error));
  redirect(`/tickets/${id}`);
}

export async function voidTicketAction(form: FormData) {
  const { supabase } = await getSession();
  const parsed = voidSchema.safeParse(Object.fromEntries(form));
  const id = String(form.get('id'));
  if (!parsed.success) return back(`/tickets/${id}`, 'A reason is required to void a ticket.');
  const { data, error } = await supabase.from('tickets')
    .update({ voided_at: new Date().toISOString(), void_reason: parsed.data.void_reason }).eq('id', id).select('id');
  if (error || !data?.length) return back(`/tickets/${id}`, error ? explain(error) : denied);
  redirect(`/tickets/${id}?notice=Ticket+voided`);
}

/** Called by the browser after it has uploaded a file straight to private storage. */
export async function recordAttachmentAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const { supabase, user } = await getSession();
  const parsed = attachmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  if (!parsed.data.storage_path.startsWith(`${parsed.data.ticket_id}/`)) return { ok: false, error: 'Bad file path.' };
  const { error } = await supabase.from('ticket_attachments').insert({ ...parsed.data, uploaded_by: user.id });
  return error ? { ok: false, error: explain(error) } : { ok: true };
}
