// Offline queue for field actions. Storage and sending are passed in, so the rules
// (order, retry, keep rejected items) can be tested without a phone or a server.

export type QueueItem<P = unknown> = {
  id: string;                       // same id is sent to the server, so a repeat send stores one record
  payload: P;
  photo?: Blob;
  createdAt: number;
  status: 'waiting' | 'attention';
  error?: string;
};

export interface QueueStore<P> {
  all(): Promise<QueueItem<P>[]>;
  put(item: QueueItem<P>): Promise<void>;
  remove(id: string): Promise<void>;
}

export type SendResult = { ok: true } | { ok: false; retry: boolean; error: string };
export type Sender<P> = (item: QueueItem<P>) => Promise<SendResult>;

export function createQueue<P>(store: QueueStore<P>, send: Sender<P>) {
  let running: Promise<void> | null = null;

  const list = async () => (await store.all()).sort((a, b) => a.createdAt - b.createdAt);

  async function run() {
    for (const item of await list()) {
      if (item.status !== 'waiting') continue;
      let res: SendResult;
      try { res = await send(item); } catch { res = { ok: false, retry: true, error: 'No signal' }; }
      if (res.ok) { await store.remove(item.id); continue; }
      if (res.retry) return;       // no signal or server trouble: stop, keep order, try again later
      await store.put({ ...item, status: 'attention', error: res.error });
    }
  }

  return {
    list,
    async add(item: Omit<QueueItem<P>, 'status' | 'createdAt'> & { createdAt?: number }) {
      await store.put({ ...item, createdAt: item.createdAt ?? Date.now(), status: 'waiting' });
    },
    /** Sends waiting items oldest first. Calls made while a send is running share that run. */
    sync(): Promise<void> {
      running ??= run().finally(() => { running = null; });
      return running;
    },
    async retry(id: string) {
      const item = (await store.all()).find((i) => i.id === id);
      if (item) await store.put({ ...item, status: 'waiting', error: undefined });
    },
    discard: (id: string) => store.remove(id),
  };
}

export function memoryStore<P>(): QueueStore<P> {
  const m = new Map<string, QueueItem<P>>();
  return {
    all: async () => [...m.values()],
    put: async (i) => { m.set(i.id, i); },
    remove: async (id) => { m.delete(id); },
  };
}
