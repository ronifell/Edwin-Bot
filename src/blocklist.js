const fs = require("fs");
const path = require("path");

const BLOCKLIST_FILE = path.join(process.cwd(), "old_customers_blocklist.json");

let cache = {
  mtimeMs: 0,
  entries: new Set(),
};

function normalizeDigits(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) return digits.slice(2);
  return digits;
}

function variantsForPhone(digits, defaultCountryPrefix = "57") {
  const variants = new Set();
  if (!digits) return variants;
  variants.add(digits);

  const prefix = String(defaultCountryPrefix || "").replace(/\D/g, "");
  if (prefix) {
    if (digits.startsWith(prefix) && digits.length > 10) {
      variants.add(digits.slice(prefix.length));
    }
    if (digits.length === 10) {
      variants.add(`${prefix}${digits}`);
    }
  }
  return variants;
}

function parseBlocklistFile(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.numbers)) return parsed.numbers;
  return [];
}

function readRawNumbersFromDisk() {
  if (!fs.existsSync(BLOCKLIST_FILE)) return [];
  const content = fs.readFileSync(BLOCKLIST_FILE, "utf8");
  const list = parseBlocklistFile(content);
  return list.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeForStorage(raw, defaultCountryPrefix = "57") {
  const value = String(raw || "").trim();
  if (!value) return "";
  const hasPlus = value.startsWith("+");
  const digits = normalizeDigits(value);
  if (!digits) return "";
  if (hasPlus) return `+${digits}`;
  const prefix = String(defaultCountryPrefix || "").replace(/\D/g, "");
  if (prefix && digits.length === 10) return `+${prefix}${digits}`;
  return `+${digits}`;
}

function writeBlocklistNumbers(numbers) {
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFile: path.basename(BLOCKLIST_FILE),
    totalNumbers: numbers.length,
    numbers,
  };
  fs.writeFileSync(BLOCKLIST_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  cache = { mtimeMs: 0, entries: new Set() };
}

function ensureLoaded(defaultCountryPrefix = "57") {
  if (!fs.existsSync(BLOCKLIST_FILE)) {
    cache = { mtimeMs: 0, entries: new Set() };
    return;
  }
  const stat = fs.statSync(BLOCKLIST_FILE);
  if (cache.mtimeMs === stat.mtimeMs) return;

  const content = fs.readFileSync(BLOCKLIST_FILE, "utf8");
  const list = parseBlocklistFile(content);
  const entries = new Set();

  for (const item of list) {
    const digits = normalizeDigits(item);
    for (const variant of variantsForPhone(digits, defaultCountryPrefix)) {
      entries.add(variant);
    }
  }

  cache = {
    mtimeMs: stat.mtimeMs,
    entries,
  };
}

function isPhoneBlocked(phone, defaultCountryPrefix = "57") {
  try {
    ensureLoaded(defaultCountryPrefix);
  } catch (error) {
    console.error("[BLOCKLIST] failed to load blocklist:", error.message);
    return false;
  }

  if (!cache.entries.size) return false;
  const phoneDigits = normalizeDigits(phone);
  if (!phoneDigits) return false;

  for (const variant of variantsForPhone(phoneDigits, defaultCountryPrefix)) {
    if (cache.entries.has(variant)) return true;
  }
  return false;
}

function listBlockedNumbers(defaultCountryPrefix = "57") {
  const raw = readRawNumbersFromDisk();
  const normalized = [...new Set(raw.map((item) => normalizeForStorage(item, defaultCountryPrefix)).filter(Boolean))].sort();
  return normalized;
}

function addBlockedNumber(phone, defaultCountryPrefix = "57") {
  const normalized = normalizeForStorage(phone, defaultCountryPrefix);
  if (!normalized) return { added: false, reason: "invalid_phone" };
  const existing = listBlockedNumbers(defaultCountryPrefix);
  if (existing.includes(normalized)) return { added: false, reason: "already_exists", phone: normalized };
  const next = [...existing, normalized].sort();
  writeBlocklistNumbers(next);
  return { added: true, phone: normalized, total: next.length };
}

function removeBlockedNumber(phone, defaultCountryPrefix = "57") {
  const normalized = normalizeForStorage(phone, defaultCountryPrefix);
  if (!normalized) return { removed: false, reason: "invalid_phone" };
  const existing = listBlockedNumbers(defaultCountryPrefix);
  if (!existing.includes(normalized)) return { removed: false, reason: "not_found", phone: normalized };
  const next = existing.filter((item) => item !== normalized);
  writeBlocklistNumbers(next);
  return { removed: true, phone: normalized, total: next.length };
}

module.exports = { isPhoneBlocked, listBlockedNumbers, addBlockedNumber, removeBlockedNumber };
