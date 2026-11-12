// Ticket intake. Every way a concern enters the system goes through `ingest`.
// Today there is one source: the New Ticket form ("manual"). A Messenger or WhatsApp
// webhook is added later as another caller of `ingest`, with no table changes.
import type { SupabaseClient } from '@supabase/supabase-js';

export type IntakeSource = 'manual' | 'messenger' | 'whatsapp';

export interface InboundMessage {
  source: IntakeSource;
  /** Conversation id on the channel. Messages in the same thread join the same ticket. */
  externalThreadId?: string;
  /** Unique id of this message on the channel. Prevents duplicates when a webhook retries. */
  externalMessageId?: string;
  channel: 'messenger' | 'viber' | 'whatsapp' | 'email' | 'call' | 'visit';
  categoryId: string;
  subject: string;
  text: string;
  clientId?: string | null;
  siteId?: string | null;
  ownerId?: string | null;
  dueAt?: string | null;
}

export interface TicketIntake {
  ingest(msg: InboundMessage): Promise<{ ticketId: string; created: boolean }>;
}

export function createIntake(db: SupabaseClient): TicketIntake {
  return {
    async ingest(msg) {
      // A retried message that is already stored changes nothing.
      if (msg.externalMessageId) {
        const { data } = await db.from('ticket_comments').select('ticket_id').eq('external_message_id', msg.externalMessageId).maybeSingle();
        if (data) return { ticketId: data.ticket_id, created: false };
      }
      // A new message in a known conversation is added to its ticket.
      if (msg.externalThreadId) {
        const { data: existing } = await db.from('tickets').select('id')
          .eq('source', msg.source).eq('external_thread_id', msg.externalThreadId).maybeSingle();
        if (existing) {
          const { error } = await db.from('ticket_comments').insert({
            ticket_id: existing.id, body: msg.text, external_message_id: msg.externalMessageId ?? null,
          });
          if (error && error.code !== '23505') throw error;
          return { ticketId: existing.id, created: false };
        }
      }
      const { data, error } = await db.from('tickets').insert({
        source: msg.source, external_thread_id: msg.externalThreadId ?? null, channel: msg.channel,
        category_id: msg.categoryId, subject: msg.subject, description: msg.text,
        client_id: msg.clientId ?? null, site_id: msg.siteId ?? null, owner_id: msg.ownerId ?? null, due_at: msg.dueAt ?? null,
      }).select('id').single();
      if (error) throw error;
      return { ticketId: data.id, created: true };
    },
  };
}
