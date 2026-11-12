import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Alert, Badge, fmtDateTime, manilaDateInput, pretty } from '@/components/ui';
import { AttachmentUploader } from '@/components/attachment-uploader';
import { ageInDays, isOverdue } from '@/lib/domain/aging';
import { STATUSES } from '@/lib/validation/schemas';
import { addCommentAction, updateTicketAction, voidTicketAction } from '../actions';

const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v);

export default async function TicketPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const { supabase, can } = await getSession();
  const { data: t } = await supabase.from('tickets')
    .select('*, client:clients(id, name, code), site:client_sites(name), category:ticket_categories(name), owner:profiles!tickets_owner_id_fkey(full_name), creator:profiles!tickets_created_by_fkey(full_name)')
    .eq('id', id).maybeSingle();
  if (!t) notFound();
  const [{ data: comments }, { data: files }, { data: people }] = await Promise.all([
    supabase.from('ticket_comments').select('id, kind, body, created_at, author:profiles!ticket_comments_author_id_fkey(full_name)').eq('ticket_id', id).order('created_at'),
    supabase.from('ticket_attachments').select('id, storage_path, file_name, size_bytes, created_at').eq('ticket_id', id).order('created_at'),
    supabase.from('profiles').select('id, full_name, role').eq('is_active', true).in('role', ['admin', 'sales', 'deployment_officer', 'finance']).order('full_name'),
  ]);
  const signed = files?.length
    ? (await supabase.storage.from('ticket-attachments').createSignedUrls(files.map((f) => f.storage_path), 300)).data ?? []
    : [];
  const urlOf = (path: string) => signed.find((s) => s.path === path)?.signedUrl ?? undefined;
  const voided = !!t.voided_at;
  const canWrite = can('tickets.write') && !voided;
  const now = new Date();
  const client = one(t.client);

  return (
    <>
      <p className="mb-1 text-sm"><Link className="text-brand hover:underline" href="/tickets">← Tickets</Link></p>
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <span className="font-mono text-stone-500">{t.code}</span>
        {voided ? <span className="badge bg-stone-800 text-white">Voided</span> : <Badge value={t.status} />}
        {isOverdue(t.due_at ? new Date(t.due_at) : null, t.status, now) && !voided && <span className="badge bg-brand text-white">Overdue</span>}
      </div>
      <h1 className="h1 mb-4">{t.subject}</h1>
      <Alert error={error} notice={notice} />
      {voided && <p className="mb-4 rounded-md bg-stone-200 p-3 text-sm">Voided on {fmtDateTime(t.voided_at)}. Reason: {t.void_reason}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="card">
            <p className="whitespace-pre-wrap text-sm">{t.description || <span className="text-stone-500">No details given.</span>}</p>
          </div>
          <div className="card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="h2">Attachments</h2>{canWrite && <AttachmentUploader ticketId={t.id} />}</div>
            <ul className="divide-y divide-stone-100">
              {(files ?? []).map((f) => (
                <li key={f.id} className="flex justify-between gap-2 py-1.5 text-sm">
                  <a className="text-brand hover:underline" href={urlOf(f.storage_path)} target="_blank" rel="noreferrer">{f.file_name}</a>
                  <span className="whitespace-nowrap text-stone-500">{Math.ceil(f.size_bytes / 1024)} KB · {fmtDateTime(f.created_at)}</span>
                </li>
              ))}
              {!files?.length && <li className="py-1.5 text-sm text-stone-500">No files yet.</li>}
            </ul>
          </div>
          <div className="card">
            <h2 className="h2 mb-2">Thread</h2>
            <ul className="space-y-3">
              {(comments ?? []).map((c) => (
                <li key={c.id} className={c.kind === 'system' ? 'border-l-4 border-stone-300 pl-3 text-sm text-stone-600' : 'rounded-md bg-stone-50 p-3 text-sm'}>
                  <div className="mb-0.5 text-xs text-stone-500">{one(c.author)?.full_name ?? 'System'} · {fmtDateTime(c.created_at)}</div>
                  <div className="whitespace-pre-wrap">{c.body}</div>
                </li>
              ))}
              {!comments?.length && <li className="text-sm text-stone-500">No comments yet.</li>}
            </ul>
            {canWrite && (
              <form action={addCommentAction} className="mt-3 space-y-2 border-t border-stone-200 pt-3">
                <input type="hidden" name="ticket_id" value={t.id} />
                <textarea className="input" name="body" rows={3} required placeholder="Add a comment. Comments cannot be edited after posting." />
                <button className="btn">Post comment</button>
              </form>
            )}
          </div>
        </div>
        <div className="space-y-4">
          <div className="card space-y-1 text-sm">
            <div><span className="text-stone-500">Client:</span> {client ? <Link className="text-brand hover:underline" href={`/clients/${client.id}`}>{client.name}</Link> : '—'}</div>
            <div><span className="text-stone-500">Site:</span> {one(t.site)?.name ?? '—'}</div>
            <div><span className="text-stone-500">Came in through:</span> {pretty(t.channel)}</div>
            <div><span className="text-stone-500">Category:</span> {one(t.category)?.name}</div>
            <div><span className="text-stone-500">Created:</span> {fmtDateTime(t.created_at)} by {one(t.creator)?.full_name ?? '—'}</div>
            <div><span className="text-stone-500">Age:</span> {ageInDays(new Date(t.created_at), now)} day(s)</div>
          </div>
          <form action={updateTicketAction} className="card space-y-3">
            <input type="hidden" name="id" value={t.id} />
            <fieldset disabled={!canWrite} className="space-y-3">
              <div><label className="label">Status</label>
                <select className="input" name="status" defaultValue={t.status}>{STATUSES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select></div>
              <div><label className="label">Owner</label>
                <select className="input" name="owner_id" defaultValue={t.owner_id ?? ''}>
                  <option value="">No owner</option>
                  {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name} ({pretty(p.role)})</option>)}
                </select></div>
              <div><label className="label">Due date</label><input className="input" type="date" name="due_at" defaultValue={manilaDateInput(t.due_at)} /></div>
              {canWrite && <button className="btn w-full">Save changes</button>}
            </fieldset>
          </form>
          {can('tickets.void') && !voided && (
            <form action={voidTicketAction} className="card space-y-2">
              <input type="hidden" name="id" value={t.id} />
              <label className="label">Void this ticket</label>
              <input className="input" name="void_reason" required placeholder="Reason (required)" />
              <button className="btn-light w-full">Void ticket</button>
              <p className="text-xs text-stone-500">Tickets are never deleted. A voided ticket keeps its number.</p>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
