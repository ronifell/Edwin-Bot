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

module.exports = { sendMessage, normalizePhone, computeHumanDelayMs };
