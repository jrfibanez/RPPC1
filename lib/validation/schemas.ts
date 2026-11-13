import { z } from 'zod';

const text = (max = 200) => z.string().trim().min(1, 'Required').max(max);
const optionalText = (max = 500) => z.string().trim().max(max).optional().transform((v) => v || null);
const uuid = z.string().uuid();
const optionalUuid = z.string().optional().transform((v) => v || null).pipe(uuid.nullable());

export const CHANNELS = ['messenger', 'viber', 'whatsapp', 'email', 'call', 'visit'] as const;
export const STATUSES = ['open', 'in_progress', 'waiting_on_client', 'resolved', 'closed'] as const;
export const ISLANDS = ['luzon', 'visayas', 'mindanao'] as const;
export const ACCREDITATION = ['prospect', 'verified', 'accredited', 'suspended'] as const;
export const ROLES = ['admin', 'sales', 'deployment_officer', 'driver', 'production_officer', 'maker', 'painter',
  'guard', 'hr', 'finance', 'purchasing', 'warehouse'] as const;

export const clientSchema = z.object({
  name: text(), trade_name: optionalText(200), tin: optionalText(30), billing_address: optionalText(),
  billing_cutoff_day: z.coerce.number().int().min(1).max(28).default(10),
});
export const siteSchema = z.object({
  client_id: uuid, name: text(), address: optionalText(), island_group: z.enum(ISLANDS),
});
export const contactSchema = z.object({
  client_id: uuid, site_id: optionalUuid, name: text(), position: optionalText(100), mobile: optionalText(40),
  email: z.string().trim().optional().transform((v) => v || null).pipe(z.string().email('Enter a valid email').nullable()),
  preferred_channel: z.string().optional().transform((v) => v || null).pipe(z.enum(CHANNELS).nullable()),
});
// Manila has a fixed +08:00 offset; a date picked on screen means end of that day in Manila.
const dueDate = z.string().optional().transform((v) => (v ? `${v}T23:59:00+08:00` : null));
export const ticketSchema = z.object({
  client_id: optionalUuid, site_id: optionalUuid, channel: z.enum(CHANNELS), category_id: uuid,
  subject: text(200), description: z.string().trim().max(5000).default(''), owner_id: optionalUuid, due_at: dueDate,
});
export const ticketUpdateSchema = z.object({
  id: uuid, status: z.enum(STATUSES), owner_id: optionalUuid, due_at: dueDate,
});
export const commentSchema = z.object({ ticket_id: uuid, body: text(5000) });
export const voidSchema = z.object({ id: uuid, void_reason: text(500) });
export const attachmentSchema = z.object({
  ticket_id: uuid, storage_path: text(400), file_name: text(200),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  size_bytes: z.number().int().min(1).max(10 * 1024 * 1024),
});
export const userSchema = z.object({
  full_name: text(100), role: z.enum(ROLES),
  email: z.string().trim().toLowerCase().optional().transform((v) => v || null).pipe(z.string().email('Enter a valid email').nullable()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Location is required on every field record. Accuracy may be missing on some phones.
const gps = {
  lat: z.number({ message: 'Location is required' }).min(-90).max(90),
  lng: z.number({ message: 'Location is required' }).min(-180).max(180),
  accuracy_m: z.number().min(0).nullable(),
};
export const fieldItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clock_in'), id: uuid, at: z.string().datetime(), ...gps }),
  z.object({ kind: z.literal('clock_out'), id: uuid, shift_id: uuid, at: z.string().datetime(), ...gps }),
  z.object({
    kind: z.literal('visit'), id: uuid, at: z.string().datetime(), client_id: uuid, site_id: uuid.nullable(),
    purpose: text(200), notes: z.string().trim().max(2000).default(''), ...gps,
  }),
]);
export type FieldItem = z.infer<typeof fieldItemSchema>;

/** First validation message, for showing to the user. */
export const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return i.path.length ? `${String(i.path[0]).replace(/_/g, ' ')}: ${i.message}` : i.message;
};
