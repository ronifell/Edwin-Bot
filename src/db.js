const { Pool } = require("pg");
const { config } = require("./config");

let pool = null;
let initialized = false;

function isPostgresEnabled() {
  return Boolean(config.postgres.connectionString);
}

/**
 * Strip sslmode/ssl from URI so node-pg does not force verify-full on the connection string.
 * TLS is still used when Pool.ssl is set; use rejectUnauthorized: false for Supabase/managed DBs.
 */
function normalizeConnectionString(url) {
  let s = String(url || "").trim();
  if (!s) return s;
  s = s.replace(/([?&])sslmode=[^&#]*/gi, "$1");
  s = s.replace(/([?&])ssl=[^&#]*/gi, "$1");
  s = s.replace(/\?&+/g, "?").replace(/&&+/g, "&");
  s = s.replace(/[?&]$/g, "").replace(/\?$/, "");
  return s;
}

function getPool() {
  if (!isPostgresEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: normalizeConnectionString(config.postgres.connectionString),
      ssl: config.postgres.ssl ? { rejectUnauthorized: false } : false,
      max: 10,
    });
  }
  return pool;
}

async function ensurePostgresReady() {
  if (initialized) return;
  const activePool = getPool();
  if (!activePool) return;
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS lead_records (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      id_number TEXT NOT NULL DEFAULT '',
      death_date TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      observations TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS idx_lead_records_phone ON lead_records (phone);
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS idx_lead_records_created_at ON lead_records (created_at DESC);
  `);
  await activePool.query(`ALTER TABLE lead_records ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;`);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS idx_lead_records_deleted_at ON lead_records (deleted_at);
  `);
  initialized = true;
}

module.exports = { getPool, ensurePostgresReady, isPostgresEnabled };
