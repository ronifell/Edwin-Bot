const express = require("express");
const cors = require("cors");
const { validateConfig } = require("./config");
const { handleInbound, sendDailySummary, startSchedulers } = require("./botService");
const { config } = require("./config");

validateConfig();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

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

app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port} in ${config.botChannelMode} mode`);
  if (config.botChannelMode === "whatsapp") {
    startSchedulers();
  }
});
