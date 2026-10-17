/* ============================================================
   Postgres connection, shared by every function.

   DATABASE_URL unset  -> inventory is off and checkout behaves
   exactly as it did before (Sanity stock check only). That lets
   this code deploy before the database exists.

   Use Neon's POOLED connection string (host contains "-pooler").
   prepare:false is required behind a transaction-mode pooler.
   ============================================================ */
import postgres from "postgres";

let client = null;

export function inventoryEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

export function db() {
  if (client) return client;
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");

  /* Neon appends channel_binding=require, which the driver would pass
     to the server as an unknown setting. Strip it; TLS still applies. */
  const url = new URL(raw);
  url.searchParams.delete("channel_binding");
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (!local) url.searchParams.set("sslmode", "require");

  client = postgres(url.toString(), {
    max: 1,               // one connection per warm function instance
    idle_timeout: 20,
    connect_timeout: 8,
    prepare: false,
    onnotice: () => {}
  });
  return client;
}

/* Tests swap in their own connection. */
export function __setDb(sql) { client = sql; }
