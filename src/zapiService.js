const axios = require("axios");
const { config } = require("./config");
const { randomBetween, sleep } = require("./utils");

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

async function sendMessage(phone, text) {
  const delay = randomBetween(config.timing.minDelayMs, config.timing.maxDelayMs);
  await sleep(delay);
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return;
  await api.post("/send-text", {
    phone: normalizedPhone,
    message: text,
  });
}

module.exports = { sendMessage, normalizePhone };
