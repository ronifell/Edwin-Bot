const { ensurePostgresReady, getPool, isPostgresEnabled } = require("./db");

const BASE_SELECT = `
  id, name, phone, id_number, death_date, color, observations,
  created_at, updated_at, deleted_at
`;

function activeClause(view) {
  if (view === "recycle") return "deleted_at IS NOT NULL";
  return "deleted_at IS NULL";
}

async function insertLeadRecord({ name = "", phone = "", idNumber = "", deathDate = "", color = "", observations = "" }) {
  if (!isPostgresEnabled()) return null;
  await ensurePostgresReady();
  const pool = getPool();
  const { rows } = await pool.query(
    `
      INSERT INTO lead_records (name, phone, id_number, death_date, color, observations)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING ${BASE_SELECT}
    `,
    [name, phone, idNumber, deathDate, color, observations]
  );
  return rows[0] || null;
}

async function listLeadRecords({ search = "", color = "", limit = 50, offset = 0, view = "active" }) {
  if (!isPostgresEnabled()) return { rows: [], total: 0 };
  await ensurePostgresReady();
  const pool = getPool();

  const values = [];
  const filters = [activeClause(view)];

  if (search) {
    values.push(`%${search}%`);
    const searchParam = `$${values.length}`;
    filters.push(
      `(name ILIKE ${searchParam} OR phone ILIKE ${searchParam} OR id_number ILIKE ${searchParam} OR death_date ILIKE ${searchParam} OR observations ILIKE ${searchParam})`
    );
  }

  if (color) {
    values.push(color.toLowerCase());
    filters.push(`LOWER(color) = $${values.length}`);
  }

  const whereClause = `WHERE ${filters.join(" AND ")}`;

  const countResult = await pool.query(`SELECT COUNT(*)::INT AS total FROM lead_records ${whereClause}`, values);

  values.push(limit);
  values.push(offset);
  const limitParam = `$${values.length - 1}`;
  const offsetParam = `$${values.length}`;

  const dataResult = await pool.query(
    `
      SELECT ${BASE_SELECT}
      FROM lead_records
      ${whereClause}
      ORDER BY ${view === "recycle" ? "deleted_at DESC" : "created_at DESC"}
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    values
  );

  return { rows: dataResult.rows, total: countResult.rows[0]?.total || 0 };
}

async function getLeadRecordById(id) {
  if (!isPostgresEnabled()) return null;
  await ensurePostgresReady();
  const pool = getPool();
  const { rows } = await pool.query(`SELECT ${BASE_SELECT} FROM lead_records WHERE id = $1`, [id]);
  return rows[0] || null;
}

/** Rows matching filters for CSV export (no pagination cap internally — caller passes sane limit). */
async function listLeadRecordsForExport({ search = "", color = "", view = "active", limit = 10000 }) {
  const capped = Math.min(Math.max(Number(limit) || 10000, 1), 50000);
  return listLeadRecords({ search, color, limit: capped, offset: 0, view });
}

async function softDeleteLeadRecord(id) {
  if (!isPostgresEnabled()) return false;
  await ensurePostgresReady();
  const pool = getPool();
  const result = await pool.query(
    `UPDATE lead_records SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  return result.rowCount > 0;
}

async function restoreLeadRecord(id) {
  if (!isPostgresEnabled()) return false;
  await ensurePostgresReady();
  const pool = getPool();
  const result = await pool.query(
    `UPDATE lead_records SET deleted_at = NULL, updated_at = NOW() WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id`,
    [id]
  );
  return result.rowCount > 0;
}

async function permanentlyDeleteLeadRecord(id) {
  if (!isPostgresEnabled()) return false;
  await ensurePostgresReady();
  const pool = getPool();
  const result = await pool.query(`DELETE FROM lead_records WHERE id = $1 AND deleted_at IS NOT NULL`, [id]);
  return result.rowCount > 0;
}

async function getLeadStats() {
  if (!isPostgresEnabled()) {
    return {
      total: 0,
      recycle: 0,
      byColor: { green: 0, yellow: 0, red: 0, purple: 0 },
      today: 0,
    };
  }

  await ensurePostgresReady();
  const pool = getPool();
  const [totalRes, recycleRes, colorRes, todayRes] = await Promise.all([
    pool.query(`SELECT COUNT(*)::INT AS total FROM lead_records WHERE deleted_at IS NULL`),
    pool.query(`SELECT COUNT(*)::INT AS total FROM lead_records WHERE deleted_at IS NOT NULL`),
    pool.query(
      `SELECT LOWER(color) AS color, COUNT(*)::INT AS count FROM lead_records WHERE deleted_at IS NULL GROUP BY LOWER(color) ORDER BY color`
    ),
    pool.query(
      `SELECT COUNT(*)::INT AS total FROM lead_records WHERE deleted_at IS NULL AND created_at::date = NOW()::date`
    ),
  ]);

  const byColor = { green: 0, yellow: 0, red: 0, purple: 0 };
  for (const row of colorRes.rows) {
    if (row.color in byColor) byColor[row.color] = row.count;
  }

  return {
    total: totalRes.rows[0]?.total || 0,
    recycle: recycleRes.rows[0]?.total || 0,
    byColor,
    today: todayRes.rows[0]?.total || 0,
  };
}

module.exports = {
  insertLeadRecord,
  listLeadRecords,
  listLeadRecordsForExport,
  getLeadRecordById,
  softDeleteLeadRecord,
  restoreLeadRecord,
  permanentlyDeleteLeadRecord,
  getLeadStats,
};
