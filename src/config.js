const dotenv = require("dotenv");

dotenv.config();

function toBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  botChannelMode: process.env.BOT_CHANNEL_MODE || "local",
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
    enableReplyGeneration: toBool(process.env.OPENAI_ENABLE_REPLY_GENERATION, false),
  },
  adminReportNumber: process.env.ADMIN_REPORT_NUMBER || "",
  defaultCountryPrefix: process.env.DEFAULT_COUNTRY_PREFIX || "57",
  allowedInboundNumbers: String(process.env.ALLOWED_INBOUND_NUMBERS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  googleSheets: {
    enabled: toBool(process.env.GOOGLE_SHEETS_ENABLED, false),
    sheetId: process.env.GOOGLE_SHEETS_ID || "",
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },
  postgres: {
    connectionString: process.env.POSTGRES_URL || "",
    ssl: toBool(process.env.POSTGRES_SSL, true),
  },
  adminApiToken: String(process.env.ADMIN_API_TOKEN || "").trim(),
  /** Optional gate for POST /api/admin/login; returns ADMIN_API_TOKEN when password matches. */
  adminPassword: String(process.env.ADMIN_PASSWORD || "").trim(),
  timing: {
    minDelayMs: Number(process.env.MIN_TYPING_DELAY_MS || 1300),
    maxDelayMs: Number(process.env.MAX_TYPING_DELAY_MS || 3800),
    humanCharsPerSecond: Number(process.env.HUMAN_TYPING_CHARS_PER_SECOND || 7),
    humanMinThinkingMs: Number(process.env.HUMAN_MIN_THINKING_MS || 900),
    humanMaxThinkingMs: Number(process.env.HUMAN_MAX_THINKING_MS || 2400),
    humanPausePerPunctuationMs: Number(process.env.HUMAN_PAUSE_PER_PUNCTUATION_MS || 120),
    responseDelayMultiplier: Number(process.env.RESPONSE_DELAY_MULTIPLIER || 5),
    typingEffectEnabled: toBool(process.env.TYPING_EFFECT_ENABLED, true),
  },
  unreadProtection: {
    enabled: toBool(process.env.PRESERVE_UNREAD_ENABLED, true),
  },
  localTest: {
    enabled: toBool(process.env.LOCAL_TEST_UI_ENABLED, true),
  },
};

function validateConfig() {
  const required = [["OPENAI_API_KEY", config.openai.apiKey]];
  if (config.botChannelMode === "whatsapp") {
    required.push(
      ["ZAPI_INSTANCE_ID", config.zapi.instanceId],
      ["ZAPI_TOKEN", config.zapi.token],
      ["ZAPI_BASE_URL", config.zapi.baseUrl],
      ["CLIENT_TOKEN", config.zapi.clientToken]
    );
  }

  const missing = required.filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    // Do not throw hard so the app can boot in dry mode.
    console.warn(`Missing env vars: ${missing.join(", ")}`);
  }

  if (!config.postgres.connectionString) {
    console.warn("POSTGRES_URL is not configured. Lead persistence APIs will be disabled.");
  }
}

module.exports = { config, validateConfig };
