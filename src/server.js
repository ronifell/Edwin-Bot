const express = require("express");
const { validateConfig } = require("./config");
const { handleInbound, sendDailySummary, startSchedulers } = require("./botService");
const { config } = require("./config");

validateConfig();

const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "edwin-whatsapp-bot-backend" });
});

app.post("/webhook/zapi", async (req, res) => {
  try {
    const result = await handleInbound(req.body || {});
    return res.json({ ok: true, result });
  } catch (error) {
    console.error("Webhook failed:", error);
    return res.status(500).json({ ok: false, error: "webhook_failed" });
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
  console.log(`Server listening on port ${config.port}`);
  startSchedulers();
});
