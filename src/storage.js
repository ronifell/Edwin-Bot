const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");

const STORE_FILE = path.join(process.cwd(), "data-store.json");

const initialStore = {
  conversations: {},
  dailyStats: {},
};

function ensureStoreFile() {
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(initialStore, null, 2), "utf8");
  }
}

function readStore() {
  ensureStoreFile();
  const content = fs.readFileSync(STORE_FILE, "utf8");
  try {
    const parsed = JSON.parse(content);
    return {
      conversations:
        parsed && typeof parsed.conversations === "object" && parsed.conversations !== null ? parsed.conversations : {},
      dailyStats: parsed && typeof parsed.dailyStats === "object" && parsed.dailyStats !== null ? parsed.dailyStats : {},
    };
  } catch {
    return { ...initialStore };
  }
}

function writeStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

function withStore(operation) {
  const store = readStore();
  const result = operation(store);
  writeStore(store);
  return result;
}

function getConversation(phone) {
  const store = readStore();
  return store.conversations[phone] || null;
}

function upsertConversation(phone, patch) {
  return withStore((store) => {
    const current = store.conversations[phone] || {
      phone,
      createdAt: new Date().toISOString(),
      messages: [],
      status: "active",
      color: "purple",
      reminderCount: 0,
      awaitingData: false,
      data: {
        idNumber: "",
        deathDate: "",
        claimant: "",
      },
      metadata: {},
    };
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    store.conversations[phone] = next;
    return next;
  });
}

function appendConversationMessage(phone, message) {
  return withStore((store) => {
    const conv = store.conversations[phone] || {
      phone,
      createdAt: new Date().toISOString(),
      messages: [],
      status: "active",
      color: "purple",
      reminderCount: 0,
      awaitingData: false,
      data: { idNumber: "", deathDate: "", claimant: "" },
      metadata: {},
    };
    conv.messages = conv.messages || [];
    conv.messages.push({
      ...message,
      at: new Date().toISOString(),
    });
    conv.updatedAt = new Date().toISOString();
    store.conversations[phone] = conv;
    return conv;
  });
}

function markDailyStats(dateKey, patch) {
  return withStore((store) => {
    const existing = store.dailyStats[dateKey] || {
      total: 0,
      green: 0,
      yellow: 0,
      red: 0,
      purple: 0,
      idNumbersCollected: 0,
      deathDatesCollected: 0,
    };
    store.dailyStats[dateKey] = { ...existing, ...patch };
    return store.dailyStats[dateKey];
  });
}

function incrementDailyStat(dateKey, key, amount = 1) {
  return withStore((store) => {
    const existing = store.dailyStats[dateKey] || {
      total: 0,
      green: 0,
      yellow: 0,
      red: 0,
      purple: 0,
      idNumbersCollected: 0,
      deathDatesCollected: 0,
    };
    existing[key] = (existing[key] || 0) + amount;
    store.dailyStats[dateKey] = existing;
    return existing;
  });
}

function getTodayKey() {
  return dayjs().format("YYYY-MM-DD");
}

function getStatsForDate(dateKey) {
  const store = readStore();
  return (
    store.dailyStats[dateKey] || {
      total: 0,
      green: 0,
      yellow: 0,
      red: 0,
      purple: 0,
      idNumbersCollected: 0,
      deathDatesCollected: 0,
    }
  );
}

function getConversationsAwaitingData(cutoffIso) {
  const store = readStore();
  return Object.values(store.conversations).filter(
    (conv) =>
      conv.awaitingData &&
      conv.status === "active" &&
      (!cutoffIso || new Date(conv.updatedAt || conv.createdAt) < new Date(cutoffIso))
  );
}

function getBlockedConversations() {
  const store = readStore();
  return Object.values(store.conversations)
    .filter((conv) => conv?.metadata?.blockedByExternalBlocklist)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

function resetStore() {
  writeStore({ ...initialStore });
}

module.exports = {
  getConversation,
  upsertConversation,
  appendConversationMessage,
  markDailyStats,
  incrementDailyStat,
  getTodayKey,
  getStatsForDate,
  getConversationsAwaitingData,
  getBlockedConversations,
  resetStore,
};
