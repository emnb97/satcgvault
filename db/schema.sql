-- ==========================================================
--  S&A TCG Vault — live inventory schema (Postgres)
--
--  Postgres owns ONE thing: how many units of each SKU can be
--  bought right now. Sanity still owns everything else (name,
--  price, photos, availability, freeze, hide).
--
--  Safe to run more than once: every statement is idempotent.
--  Apply with `npm run db:setup` or paste into the Neon SQL editor.
-- ==========================================================

-- What can be bought right now. Never negative: the CHECK is the
-- last line of defence against overselling, after the conditional
-- UPDATE in the checkout function.
CREATE TABLE IF NOT EXISTS inventory (
  sku         text PRIMARY KEY,
  available   integer NOT NULL CHECK (available >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per SKU per checkout attempt. Stock leaves `inventory`
-- the moment a shopper opens checkout and sits here until Stripe
-- tells us what happened to it.
--
--   held      checkout open, not paid yet
--   pending   checkout finished, Klarna/Clearpay/bank still settling
--   sold      paid — the unit has gone
--   released  unpaid, expired, cancelled or failed — returned to inventory
--   refunded  sold then fully refunded — returned to inventory
CREATE TABLE IF NOT EXISTS holds (
  hold_id     uuid NOT NULL,
  sku         text NOT NULL REFERENCES inventory(sku),
  qty         integer NOT NULL CHECK (qty > 0),
  status      text NOT NULL DEFAULT 'held'
              CHECK (status IN ('held', 'pending', 'sold', 'released', 'refunded')),
  session_id  text,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hold_id, sku)
);
CREATE INDEX IF NOT EXISTS holds_status_expires ON holds (status, expires_at);
CREATE INDEX IF NOT EXISTS holds_session ON holds (session_id);

-- Every change to `available`, with why. This is the audit trail
-- Omar sees on the stock desk, and what you read first if a count
-- ever looks wrong.
CREATE TABLE IF NOT EXISTS stock_log (
  id               bigserial PRIMARY KEY,
  at               timestamptz NOT NULL DEFAULT now(),
  sku              text NOT NULL,
  delta            integer NOT NULL,
  available_after  integer,
  reason           text NOT NULL,
  ref              text
);
CREATE INDEX IF NOT EXISTS stock_log_at ON stock_log (at DESC);

-- Stripe events already handled. Status guards on `holds` make
-- every transition safe to repeat anyway; this is the receipt.
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id     text PRIMARY KEY,
  type         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);
