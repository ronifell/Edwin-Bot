const dotenv = require("dotenv");

dotenv.config();

function toBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  zapi: {
    instanceId: process.env.ZAPI_INSTANCE_ID || "",
    token: process.env.ZAPI_TOKEN || "",
    baseUrl: process.env.ZAPI_BASE_URL || "https://api.z-api.io",
    clientToken: process.env.CLIENT_TOKEN || "",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
  },
  adminReportNumber: process.env.ADMIN_REPORT_NUMBER || "",
  defaultCountryPrefix: process.env.DEFAULT_COUNTRY_PREFIX || "57",
  googleSheets: {
    enabled: toBool(process.env.GOOGLE_SHEETS_ENABLED, false),
    sheetId: process.env.GOOGLE_SHEETS_ID || "",
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },
  timing: {
    minDelayMs: Number(process.env.MIN_TYPING_DELAY_MS || 1300),
    maxDelayMs: Number(process.env.MAX_TYPING_DELAY_MS || 3800),
  },
};

function validateConfig() {
  const required = [
    ["ZAPI_INSTANCE_ID", config.zapi.instanceId],
    ["ZAPI_TOKEN", config.zapi.token],
    ["ZAPI_BASE_URL", config.zapi.baseUrl],
    ["CLIENT_TOKEN", config.zapi.clientToken],
    ["OPENAI_API_KEY", config.openai.apiKey],
  ];

  const missing = required.filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    // Do not throw hard so the app can boot in dry mode.
    console.warn(`Missing env vars: ${missing.join(", ")}`);
  }
}

module.exports = { config, validateConfig };
