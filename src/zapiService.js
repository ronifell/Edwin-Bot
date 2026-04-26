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
  if (digits.startsWith(config.defaultCountryPrefix)) return digits;
  return `${config.defaultCountryPrefix}${digits}`;
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
  const minBound = Math.max(config.timing.minDelayMs, 0);
  const maxBound = Math.max(config.timing.maxDelayMs, minBound);
  return Math.min(Math.max(total, minBound), maxBound);
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
      return;
    } catch {
      // Try next variant to support different Z-API presence payloads.
    }
  }
}

async function sendMessage(phone, text) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return;
  const delay = computeHumanDelayMs(text);
  await sendTypingPresence(normalizedPhone, "composing");
  await sleep(delay);
  await api.post("/send-text", {
    phone: normalizedPhone,
    message: text,
  });
  await sendTypingPresence(normalizedPhone, "paused");
}

module.exports = { sendMessage, normalizePhone, computeHumanDelayMs };
