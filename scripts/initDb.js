/**
 * Ensures PostgreSQL tables exist (same as backend startup migration).
 * Requires POSTGRES_URL in root .env
 *
 * Usage: node scripts/initDb.js   or   npm run db:init
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { ensurePostgresReady, isPostgresEnabled } = require("../src/db");

async function main() {
  if (!isPostgresEnabled()) {
    console.error("POSTGRES_URL is missing. Set it in project root .env");
    process.exit(1);
  }

  await ensurePostgresReady();
  console.log("Done: lead_records table and indexes are ready.");
}

main().catch((error) => {
  console.error(error.message || error);
  if (String(error.message || "").includes("password authentication failed")) {
    console.error(
      "\nHint: Confirm POSTGRES_URL in .env matches Supabase → Settings → Database copy (URI). URL-encode special characters in the password (@, #, etc.). Save the file and retry."
    );
  }
  process.exit(1);
});
