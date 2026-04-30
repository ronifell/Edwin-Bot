const express = require("express");
const cors = require("cors");
const { validateConfig } = require("./config");
const { handleInbound, sendDailySummary, startSchedulers } = require("./botService");
const { config } = require("./config");
const { ensurePostgresReady, isPostgresEnabled } = require("./db");
const {
  listLeadRecords,
  listLeadRecordsForExport,
  getLeadRecordById,
  softDeleteLeadRecord,
  restoreLeadRecord,
  permanentlyDeleteLeadRecord,
  getLeadStats,
} = require("./leadRepository");
const {
  getConversation,
  getBlockedConversations,
  clearConversationByPhone,
  clearAllConversations,
} = require("./storage");
const { verifyAdminPassword } = require("./adminAuth");
const { listBlockedNumbers, addBlockedNumber, removeBlockedNumber } = require("./blocklist");

validateConfig();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

function validateAdminAccess(req, res, next) {
  if (!config.adminApiToken) return next();
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token !== config.adminApiToken) {
    return res.status(401).json({ ok: false, error: "unauthorized_admin_access" });
  }
  return next();
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildLeadsCsv(rows) {
  const headers = ["id", "name", "phone", "id_number", "death_date", "color", "observations", "created_at", "deleted_at"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.id),
        csvEscape(row.name),
        csvEscape(row.phone),
        csvEscape(row.id_number),
        csvEscape(row.death_date),
        csvEscape(row.color),
        csvEscape(row.observations),
        csvEscape(row.created_at),
        csvEscape(row.deleted_at),
      ].join(",")
    );
  }
  return lines.join("\r\n");
}

app.post("/api/admin/login", async (req, res) => {
  if (!config.adminPassword) {
    return res.status(400).json({ ok: false, error: "login_disabled_set_ADMIN_PASSWORD" });
  }
  if (!config.adminApiToken) {
    return res.status(503).json({ ok: false, error: "login_requires_ADMIN_API_TOKEN" });
  }
  const password = String(req.body?.password || "").trim();
  if (!verifyAdminPassword(password, config.adminPassword)) {
    return res.status(401).json({ ok: false, error: "invalid_password" });
  }
  return res.json({ ok: true, token: config.adminApiToken });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "edwin-whatsapp-bot-backend" });
});

app.get("/webhook/zapi", (_req, res) => {
  res.status(200).json({
    ok: true,
    message: "Webhook endpoint is online. Use POST to deliver events.",
    method: "POST",
    path: "/webhook/zapi",
  });
});

app.post("/webhook/zapi", async (req, res) => {
  const body = req.body || {};
  const from = body?.phone || body?.from || body?.chatLid || body?.sender || "unknown";
  const fromMe = Boolean(body?.fromMe);
  const type = body?.type || "n/a";
  const isStatusReply = Boolean(body?.isStatusReply);
  const isGroup = Boolean(body?.isGroup);
  const bodyKeys = Object.keys(body || {});
  const isMessageStatusCallback = type === "MessageStatusCallback";

  // Ignore provider status callbacks early to avoid noisy logs and duplicate-event churn.
  if (isMessageStatusCallback) {
    return res.json({ ok: true, result: { ok: true, ignored: "message_status_callback" } });
  }

  console.log(
    `[WEBHOOK] incoming /webhook/zapi from=${from} mode=${config.botChannelMode} type=${type} fromMe=${fromMe} isStatusReply=${isStatusReply} isGroup=${isGroup} keys=${bodyKeys.join(
      ","
    )}`
  );
  if (config.botChannelMode !== "whatsapp") {
    console.warn(`[WEBHOOK] rejected: mode=${config.botChannelMode} (expected whatsapp)`);
    return res.status(403).json({
      ok: false,
      error: "webhook_disabled_in_local_mode",
      botChannelMode: config.botChannelMode,
    });
  }
  try {
    const result = await handleInbound(body);
    console.log(
      `[WEBHOOK] processed ok from=${from} responseType=${result?.responseType || "n/a"} ignored=${result?.ignored || "no"}`
    );
    return res.json({ ok: true, result });
  } catch (error) {
    console.error(`[WEBHOOK] failed from=${from}:`, error?.message || error);
    return res.status(500).json({ ok: false, error: "webhook_failed" });
  }
});

app.post("/api/test/chat", async (req, res) => {
  if (!config.localTest.enabled) {
    return res.status(403).json({ ok: false, error: "local_test_ui_disabled" });
  }
  if (config.botChannelMode !== "local") {
    return res.status(403).json({
      ok: false,
      error: "local_test_requires_local_mode",
      botChannelMode: config.botChannelMode,
    });
  }

  const outbound = [];
  const body = req.body || {};
  try {
    const result = await handleInbound(
      {
        message: body.message || "",
        phone: body.phone || "573000000001",
        senderName: body.senderName || "Cliente de prueba",
      },
      {
        sendMessage: async () => {},
        onBotMessage: (text) => outbound.push(text),
      }
    );
    return res.json({ ok: true, result, replies: outbound });
  } catch (error) {
    console.error("Local test chat failed:", error);
    return res.status(500).json({ ok: false, error: "local_test_chat_failed" });
  }
});

app.post("/jobs/daily-summary", async (_req, res) => {
  try {
    await sendDailySummary();
    return res.json({ ok: true });
  } catch (error) {
    console.error("Manual summary failed:", error.message);
    return res.status(500).json({ ok: false, error: "summary_failed" });
  }
});

app.get("/api/admin/leads/export", validateAdminAccess, async (req, res) => {
  if (!isPostgresEnabled()) {
    return res.status(503).json({ ok: false, error: "postgres_not_configured" });
  }
  const search = String(req.query.search || "").trim();
  const color = String(req.query.color || "").trim();
  const view = req.query.view === "recycle" ? "recycle" : "active";

  try {
    const { rows } = await listLeadRecordsForExport({ search, color, view, limit: 50000 });
    const csv = buildLeadsCsv(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="leads_${view}_${Date.now()}.csv"`);
    return res.send(csv);
  } catch (error) {
    console.error("Failed to export leads:", error.message);
    return res.status(500).json({ ok: false, error: "admin_export_failed" });
  }
});

app.get("/api/admin/leads", validateAdminAccess, async (req, res) => {
  if (!isPostgresEnabled()) {
    return res.status(503).json({ ok: false, error: "postgres_not_configured" });
  }
  const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * limit;
  const search = String(req.query.search || "").trim();
  const color = String(req.query.color || "").trim();
  const view = req.query.view === "recycle" ? "recycle" : "active";

  try {
    const { rows, total } = await listLeadRecords({ search, color, limit, offset, view });
    return res.json({
      ok: true,
      rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    console.error("Failed to list lead records:", error.message);
    return res.status(500).json({ ok: false, error: "admin_list_failed" });
  }
});

app.get("/api/admin/leads/:id", validateAdminAccess, async (req, res) => {
  if (!isPostgresEnabled()) {
    return res.status(503).json({ ok: false, error: "postgres_not_configured" });
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "invalid_lead_id" });
  }
  try {
    const lead = await getLeadRecordById(id);
    if (!lead) return res.status(404).json({ ok: false, error: "lead_not_found" });
    const phone = lead.phone || "";
    const conversation = phone ? getConversation(phone) : null;
    return res.json({ ok: true, lead, conversation });
  } catch (error) {
    console.error("Failed to load lead detail:", error.message);
    return res.status(500).json({ ok: false, error: "admin_lead_detail_failed" });
  }
});

app.get("/api/admin/conversations/:phone", validateAdminAccess, async (req, res) => {
  const phone = decodeURIComponent(String(req.params.phone || "").trim());
  if (!phone) return res.status(400).json({ ok: false, error: "missing_phone" });
  try {
    const conversation = getConversation(phone);
    return res.json({ ok: true, phone, conversation });
  } catch (error) {
    console.error("Failed to load conversation:", error.message);
    return res.status(500).json({ ok: false, error: "admin_conversation_failed" });
  }
});

app.delete("/api/admin/conversations/:phone", validateAdminAccess, async (req, res) => {
  const phone = decodeURIComponent(String(req.params.phone || "").trim());
  if (!phone) return res.status(400).json({ ok: false, error: "missing_phone" });
  try {
    const result = clearConversationByPhone(phone);
    if (!result.removed && result.reason === "not_found") {
      return res.status(404).json({ ok: false, error: "conversation_not_found", phone });
    }
    return res.json({ ok: true, result });
  } catch (error) {
    console.error("Failed to clear conversation:", error.message);
    return res.status(500).json({ ok: false, error: "admin_conversation_clear_failed" });
  }
});

app.delete("/api/admin/conversations", validateAdminAccess, async (_req, res) => {
  try {
    const result = clearAllConversations();
    return res.json({ ok: true, result });
  } catch (error) {
    console.error("Failed to clear all conversations:", error.message);
    return res.status(500).json({ ok: false, error: "admin_conversation_clear_all_failed" });
  }
});

app.get("/api/admin/blocked-conversations", validateAdminAccess, async (_req, res) => {
  try {
    const rows = getBlockedConversations().map((conv) => ({
      phone: conv.phone || "",
      senderName: conv?.metadata?.senderName || "",
      status: conv.status || "",
      color: conv.color || "",
      blockedAt: conv?.metadata?.manualTakeoverAt || conv.updatedAt || conv.createdAt || "",
      updatedAt: conv.updatedAt || conv.createdAt || "",
      messageCount: Array.isArray(conv.messages) ? conv.messages.length : 0,
      blockedByExternalBlocklist: true,
    }));
    return res.json({ ok: true, rows, total: rows.length });
  } catch (error) {
    console.error("Failed to list blocked conversations:", error.message);
    return res.status(500).json({ ok: false, error: "admin_blocked_list_failed" });
  }
});

app.get("/api/admin/blocklist", validateAdminAccess, async (_req, res) => {
  try {
    const numbers = listBlockedNumbers(config.defaultCountryPrefix);
    const blockedMap = new Map(getBlockedConversations().map((conv) => [String(conv.phone || ""), conv]));
    const rows = numbers.map((phone) => {
      const byWithPlus = blockedMap.get(phone);
      const byNoPlus = blockedMap.get(phone.replace(/^\+/, ""));
      const conv = byWithPlus || byNoPlus || null;
      return {
        phone,
        seenByBot: Boolean(conv),
        status: conv?.status || "",
        senderName: conv?.metadata?.senderName || "",
        updatedAt: conv?.updatedAt || conv?.createdAt || "",
      };
    });
    return res.json({ ok: true, rows, total: rows.length });
  } catch (error) {
    console.error("Failed to list blocklist numbers:", error.message);
    return res.status(500).json({ ok: false, error: "admin_blocklist_list_failed" });
  }
});

app.post("/api/admin/blocklist", validateAdminAccess, async (req, res) => {
  const phone = String(req.body?.phone || "").trim();
  if (!phone) return res.status(400).json({ ok: false, error: "missing_phone" });
  try {
    const result = addBlockedNumber(phone, config.defaultCountryPrefix);
    if (!result.added && result.reason === "invalid_phone") {
      return res.status(400).json({ ok: false, error: "invalid_phone" });
    }
    return res.json({ ok: true, result });
  } catch (error) {
    console.error("Failed to add blocklist number:", error.message);
    return res.status(500).json({ ok: false, error: "admin_blocklist_add_failed" });
  }
});

app.delete("/api/admin/blocklist/:phone", validateAdminAccess, async (req, res) => {
  const phone = decodeURIComponent(String(req.params.phone || "").trim());
  if (!phone) return res.status(400).json({ ok: false, error: "missing_phone" });
  try {
    const result = removeBlockedNumber(phone, config.defaultCountryPrefix);
    if (!result.removed && result.reason === "invalid_phone") {
      return res.status(400).json({ ok: false, error: "invalid_phone" });
    }
    return res.json({ ok: true, result });
  } catch (error) {
    console.error("Failed to remove blocklist number:", error.message);
    return res.status(500).json({ ok: false, error: "admin_blocklist_remove_failed" });
  }
});

app.post("/api/admin/leads/:id/restore", validateAdminAccess, async (req, res) => {
  if (!isPostgresEnabled()) {
    return res.status(503).json({ ok: false, error: "postgres_not_configured" });
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "invalid_lead_id" });
  }
  try {
    const restored = await restoreLeadRecord(id);
    if (!restored) return res.status(404).json({ ok: false, error: "lead_not_found_or_not_in_recycle" });
    return res.json({ ok: true, restoredId: id });
  } catch (error) {
    console.error("Failed to restore lead:", error.message);
    return res.status(500).json({ ok: false, error: "admin_restore_failed" });
  }
});

app.get("/api/admin/stats", validateAdminAccess, async (_req, res) => {
  if (!isPostgresEnabled()) {
    return res.status(503).json({ ok: false, error: "postgres_not_configured" });
  }
  try {
    const stats = await getLeadStats();
    return res.json({ ok: true, stats });
  } catch (error) {
    console.error("Failed to read lead stats:", error.message);
    return res.status(500).json({ ok: false, error: "admin_stats_failed" });
  }
});

app.delete("/api/admin/leads/:id", validateAdminAccess, async (req, res) => {
  if (!isPostgresEnabled()) {
    return res.status(503).json({ ok: false, error: "postgres_not_configured" });
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "invalid_lead_id" });
  }

  const permanent = String(req.query.permanent || "").toLowerCase() === "true" || req.query.permanent === "1";

  try {
    if (permanent) {
      const removed = await permanentlyDeleteLeadRecord(id);
      if (!removed) return res.status(404).json({ ok: false, error: "lead_not_found_or_not_in_recycle" });
      return res.json({ ok: true, deletedId: id, permanent: true });
    }
    const soft = await softDeleteLeadRecord(id);
    if (!soft) return res.status(404).json({ ok: false, error: "lead_not_found" });
    return res.json({ ok: true, deletedId: id, permanent: false });
  } catch (error) {
    console.error("Failed to delete lead:", error.message);
    return res.status(500).json({ ok: false, error: "admin_delete_failed" });
  }
});

app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port} in ${config.botChannelMode} mode`);
  ensurePostgresReady().catch((error) => {
    console.error("PostgreSQL init failed:", error.message);
  });
  if (config.botChannelMode === "whatsapp") {
    startSchedulers();
  }
});
