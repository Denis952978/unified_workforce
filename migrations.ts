/** Database schema, applied automatically the first time the API runs (embedded, so the function needs no extra files). */
export const MIGRATIONS: [string, string][] = [
  ['001_init.sql', `-- UnifiedWorkforce: one self-contained system.
-- The app's records (company, projects, people, attendance, production, meals, reports) are stored as
-- versioned groups in app_state. Sign-in accounts, invitation links, email delivery and the audit trail
-- live in their own tables and are only ever changed by the server.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_state (
  name        text PRIMARY KEY CHECK (name IN ('core', 'days', 'sessions', 'prod', 'bookings', 'mealdocs', 'outbox', 'notes')),
  rev         bigint NOT NULL DEFAULT 0,
  json        text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);
INSERT INTO app_state (name) VALUES ('core'), ('days'), ('sessions'), ('prod'), ('bookings'), ('mealdocs'), ('outbox'), ('notes');

-- one sign-in account per person; member_id is the person's id inside the app records
CREATE TABLE accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  password_hash  text NOT NULL,
  member_id      text NOT NULL UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);
CREATE UNIQUE INDEX accounts_email_lower ON accounts (lower(email));

-- emailed links: INVITE (join and choose a password) and RESET (choose a new password)
CREATE TABLE invitations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                text NOT NULL DEFAULT 'INVITE' CHECK (kind IN ('INVITE', 'RESET')),
  member_id           text NOT NULL,
  email               text NOT NULL,
  token_hash          text NOT NULL UNIQUE,            -- sha256 of the emailed token; the token itself is never stored
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED')),
  invited_by_member   text,
  invited_by_account  uuid REFERENCES accounts(id),
  expires_at          timestamptz NOT NULL,
  sent_count          int NOT NULL DEFAULT 1,
  last_sent_at        timestamptz NOT NULL DEFAULT now(),
  accepted_at         timestamptz,
  account_id          uuid REFERENCES accounts(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invitations_one_pending ON invitations (member_id, kind) WHERE status = 'PENDING';

CREATE TABLE email_outbox (
  id               bigserial PRIMARY KEY,
  to_email         text NOT NULL,
  subject          text NOT NULL,
  text_body        text NOT NULL,
  html_body        text NOT NULL,
  ref              text,
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_outbox_due ON email_outbox (next_attempt_at) WHERE status = 'PENDING';

CREATE TABLE audit_log (
  id                 bigserial PRIMARY KEY,
  at                 timestamptz NOT NULL DEFAULT now(),
  actor_account_id   uuid REFERENCES accounts(id),
  action             text NOT NULL,
  entity             text NOT NULL,
  entity_id          text,
  detail             jsonb NOT NULL DEFAULT '{}',
  source_ip          inet
);
CREATE INDEX audit_log_at ON audit_log (at DESC);
`],
  ['002_activity.sql', `
-- Activity reported by the browser extension (working time, items submitted), kept apart from the app's own records
-- so that frequent heartbeats never block anyone else's save.
ALTER TABLE app_state DROP CONSTRAINT IF EXISTS app_state_name_check;
ALTER TABLE app_state ADD CONSTRAINT app_state_name_check CHECK (name IN ('core', 'days', 'sessions', 'prod', 'bookings', 'mealdocs', 'outbox', 'notes', 'activity'));
INSERT INTO app_state (name, json) VALUES ('activity', '{"activity":{}}') ON CONFLICT (name) DO NOTHING;
`],
  ['003_meal_reminders.sql', `
-- One reminder email per person per meal: "book your meal before your shift ends".
CREATE TABLE IF NOT EXISTS meal_reminders (
  member_id  text NOT NULL,
  meal_date  date NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, meal_date)
);
`],
];
