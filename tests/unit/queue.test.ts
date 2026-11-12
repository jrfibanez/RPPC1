import { describe, expect, it } from 'vitest';
import { createQueue, memoryStore, type SendResult } from '@/lib/offline/queue';

const setup = (answers: (id: string) => SendResult | 'throw') => {
  const sent: string[] = [];
  const q = createQueue<string>(memoryStore(), async (item) => {
    sent.push(item.id);
    const a = answers(item.id);
    if (a === 'throw') throw new Error('offline');
    return a;
  });
  return { q, sent };
};

describe('offline queue', () => {
  it('sends oldest first and removes what was accepted', async () => {
    const { q, sent } = setup(() => ({ ok: true }));
    await q.add({ id: 'b', payload: 'x', createdAt: 2 });
    await q.add({ id: 'a', payload: 'x', createdAt: 1 });
    await q.sync();
    expect(sent).toEqual(['a', 'b']);
    expect(await q.list()).toHaveLength(0);
  });

  it('keeps everything and stops when there is no signal', async () => {
    const { q, sent } = setup(() => 'throw');
    await q.add({ id: 'a', payload: 'x', createdAt: 1 });
    await q.add({ id: 'b', payload: 'x', createdAt: 2 });
    await q.sync();
    expect(sent).toEqual(['a']);                 // b must not jump ahead of a
    expect((await q.list()).map((i) => i.status)).toEqual(['waiting', 'waiting']);
  });

  it('sends again later and the item keeps the same id', async () => {
    let online = false;
    const { q, sent } = setup(() => (online ? { ok: true } : { ok: false, retry: true, error: 'down' }));
    await q.add({ id: 'a', payload: 'x' });
    await q.sync();
    online = true;
    await q.sync();
    expect(sent).toEqual(['a', 'a']);
    expect(await q.list()).toHaveLength(0);
  });

  it('keeps a rejected item, marked for attention with the reason, and carries on', async () => {
    const { q } = setup((id) => (id === 'a' ? { ok: false, retry: false, error: 'Already clocked in' } : { ok: true }));
    await q.add({ id: 'a', payload: 'x', createdAt: 1 });
    await q.add({ id: 'b', payload: 'x', createdAt: 2 });
    await q.sync();
    const left = await q.list();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: 'a', status: 'attention', error: 'Already clocked in' });
  });

  it('does not resend an item needing attention until the user retries it', async () => {
    let reject = true;
    const { q, sent } = setup(() => (reject ? { ok: false, retry: false, error: 'no' } : { ok: true }));
    await q.add({ id: 'a', payload: 'x' });
    await q.sync(); await q.sync();
    expect(sent).toEqual(['a']);
    reject = false;
    await q.retry('a'); await q.sync();
    expect(await q.list()).toHaveLength(0);
  });

  it('does not send the same item twice when sync is pressed twice at once', async () => {
    const { q, sent } = setup(() => ({ ok: true }));
    await q.add({ id: 'a', payload: 'x' });
    await Promise.all([q.sync(), q.sync()]);
    expect(sent).toEqual(['a']);
  });
});
