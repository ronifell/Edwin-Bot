const axios = require("axios");
const { config } = require("./config");
const { sleep } = require("./utils");

const api = axios.create({
  baseURL: `${config.zapi.baseUrl}/instances/${config.zapi.instanceId}/token/${config.zapi.token}`,
  timeout: 15000,
  headers: {
    "Client-Token": config.zapi.clientToken,
    "Content-Type": "application/json",
  },
});

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  // Keep full international numbers as-is; only prefix local numbers.
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith(config.defaultCountryPrefix)) return digits;
  if (digits.length === 10) return `${config.defaultCountryPrefix}${digits}`;
  return digits;
}

function countPunctuationPauses(text) {
  const matches = String(text || "").match(/[.,;:!?]/g);
  return matches ? matches.length : 0;
}

function computeHumanDelayMs(text) {
  const message = String(text || "");
  const chars = message.length;
  const typingMs = Math.round((chars / Math.max(config.timing.humanCharsPerSecond, 1)) * 1000);
  const punctuationMs =
    countPunctuationPauses(message) * Math.max(config.timing.humanPausePerPunctuationMs, 0);
  // Deterministic human-like delay proportional to text length.
  const thinkingMs = Math.max(config.timing.humanMinThinkingMs, 0);
  const total = typingMs + punctuationMs + thinkingMs;
  const multiplier = Math.max(config.timing.responseDelayMultiplier || 1, 0.1);
  const scaledTotal = Math.round(total * multiplier);
  const minBound = Math.max(Math.round(config.timing.minDelayMs * multiplier), 0);
  const maxBound = Math.max(Math.round(config.timing.maxDelayMs * multiplier), minBound);
  return Math.min(Math.max(scaledTotal, minBound), maxBound);
}

async function sendTypingPresence(normalizedPhone, stage) {
  if (!config.timing.typingEffectEnabled || !normalizedPhone) return;
  const candidateCalls = [
    { url: "/send-chat-presence", body: { phone: normalizedPhone, action: stage } },
    { url: "/send-chat-presence", body: { phone: normalizedPhone, presence: stage } },
    { url: "/send-presence", body: { phone: normalizedPhone, action: stage } },
  ];

  for (const attempt of candidateCalls) {
    try {
      await api.post(attempt.url, attempt.body);
      console.log(`[ZAPI] typing stage=${stage} phone=${normalizedPhone} endpoint=${attempt.url} ok`);
      return;
    } catch (error) {
      console.warn(
        `[ZAPI] typing stage=${stage} phone=${normalizedPhone} endpoint=${attempt.url} failed status=${
          error?.response?.status || "n/a"
        }`
      );
      // Try next variant to support different Z-API presence payloads.
    }
  }
}

async function sendMessage(phone, text) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    console.warn(`[ZAPI] send-text skipped: invalid phone input="${phone}"`);
    return;
  }
  const delay = computeHumanDelayMs(text);
  console.log(
    `[ZAPI] send-text preparing phone=${normalizedPhone} delayMs=${delay} chars=${String(text || "").length}`
  );
  await sendTypingPresence(normalizedPhone, "composing");
  await sleep(delay);
  try {
    await api.post("/send-text", {
      phone: normalizedPhone,
      message: text,
    });
    console.log(`[ZAPI] send-text ok phone=${normalizedPhone}`);
  } catch (error) {
    console.error(
      `[ZAPI] send-text failed phone=${normalizedPhone} status=${error?.response?.status || "n/a"} message=${
        error?.message || "unknown_error"
      }`
    );
    throw error;
  }
  await sendTypingPresence(normalizedPhone, "paused");
}

async function preserveUnread(phone) {
  if (!config.unreadProtection?.enabled) return;
  if (config.botChannelMode !== "whatsapp") return;
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return;

  const candidateCalls = [
    { url: "/mark-as-unread", body: { phone: normalizedPhone } },
    { url: "/mark-unread", body: { phone: normalizedPhone } },
    { url: "/mark-chat-unread", body: { phone: normalizedPhone } },
    { url: "/modify-chat", body: { phone: normalizedPhone, read: false } },
  ];

  for (const attempt of candidateCalls) {
    try {
      await api.post(attempt.url, attempt.body);
      console.log(`[ZAPI] preserve-unread ok phone=${normalizedPhone} endpoint=${attempt.url}`);
      return;
    } catch (error) {
      console.warn(
        `[ZAPI] preserve-unread failed phone=${normalizedPhone} endpoint=${attempt.url} status=${
          error?.response?.status || "n/a"
        }`
      );
    }
  }

  console.warn(`[ZAPI] preserve-unread unsupported for current instance phone=${normalizedPhone}`);
}

/**
 * Z-API can mark every inbound message as read on the linked session when "auto read" is enabled
 * on the instance. That happens on Z-API/WhatsApp Web side even if this Node server is stopped.
 * @see https://developer.z-api.io/en/instance/update-auto-read-message
 */
async function disableInstanceAutoRead() {
  if (config.botChannelMode !== "whatsapp") return;
  if (!config.zapi.disableAutoReadOnStartup) return;
  if (!config.zapi.instanceId || !config.zapi.token || !config.zapi.clientToken) {
    console.warn("[ZAPI] skip disable-auto-read: missing Z-API credentials");
    return;
  }

  const body = { value: false };
  const attempts = [
    { method: "post", url: "/update-auto-read-message" },
    { method: "put", url: "/update-auto-read-message" },
  ];

  for (const { method, url } of attempts) {
    try {
      await api.request({ method, url, data: body });
      console.log(`[ZAPI] instance auto-read disabled ok method=${method.toUpperCase()} ${url}`);
      return;
    } catch (error) {
      console.warn(
        `[ZAPI] disable auto-read failed method=${method.toUpperCase()} ${url} status=${
          error?.response?.status || "n/a"
        }`
      );
    }
  }
  console.warn(
    "[ZAPI] could not disable instance auto-read; turn it off in the Z-API panel (Auto-read messages) or check API version"
  );
}

module.exports = {
  sendMessage,
  normalizePhone,
  computeHumanDelayMs,
  preserveUnread,
  disableInstanceAutoRead,
};
