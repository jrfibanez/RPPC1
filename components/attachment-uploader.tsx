'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { recordAttachmentAction } from '@/app/(app)/tickets/actions';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX = 10 * 1024 * 1024;

export function AttachmentUploader({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    setError(''); setBusy(true);
    const supabase = createClient();
    for (const f of files) {
      if (!ALLOWED.includes(f.type)) { setError(`${f.name}: only images and PDF files are allowed.`); continue; }
      if (f.size > MAX) { setError(`${f.name}: larger than 10 MB.`); continue; }
      const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
      const path = `${ticketId}/${crypto.randomUUID()}-${safe}`;
      const up = await supabase.storage.from('ticket-attachments').upload(path, f, { contentType: f.type });
      if (up.error) { setError(`${f.name}: upload failed. ${up.error.message}`); continue; }
      const res = await recordAttachmentAction({ ticket_id: ticketId, storage_path: path, file_name: f.name.slice(0, 200), mime_type: f.type, size_bytes: f.size });
      if (!res.ok) setError(`${f.name}: ${res.error}`);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <label className={`btn-light ${busy ? 'opacity-50' : ''}`}>
        {busy ? 'Uploading…' : 'Attach screenshot or PDF'}
        <input type="file" className="hidden" multiple accept={ALLOWED.join(',')} onChange={onPick} disabled={busy} />
      </label>
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
