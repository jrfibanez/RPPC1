/** Every permission the system checks, with a plain description for the Admin screen. */
export const PERMISSIONS: [string, string][] = [
  ['admin.users', 'Create users, change roles, turn accounts off'],
  ['admin.permissions', 'Change this permission table'],
  ['audit.read', 'Read the audit log'],
  ['clients.read_all', 'See all clients, sites and contacts'],
  ['clients.read_own', 'See own accounts only'],
  ['clients.write_all', 'Add and edit any client'],
  ['clients.write_own', 'Add clients and edit own accounts'],
  ['clients.accredit', 'Set a client as accredited or suspended'],
  ['tickets.read_all', 'See all tickets'],
  ['tickets.read_own', 'See tickets owned or for own accounts'],
  ['tickets.write', 'Create tickets, update and comment on tickets they can see'],
  ['tickets.void', 'Void a ticket'],
  ['tickets.categories', 'Edit the ticket category list'],
  ['field.use', 'Clock in/out and log client visits'],
  ['field.read_all', 'See everyone\'s attendance and visits'],
  ['field.close_shift', 'Close a shift someone forgot to end'],
];
export const LOCKED = new Set(['admin:admin.users', 'admin:admin.permissions', 'admin:audit.read']);
