const cron = require("node-cron");
const dayjs = require("dayjs");
const { generateNaturalReply, transcribeAudioFromUrl } = require("./aiService");
const { classifyMessage } = require("./classifier");
const { extractStructuredData } = require("./extractor");
const { appendLeadRow } = require("./sheetService");
const { sendMessage } = require("./zapiService");
const {
  appendConversationMessage,
  getConversation,
  getConversationsAwaitingData,
  getStatsForDate,
  getTodayKey,
  incrementDailyStat,
  markDailyStats,
  upsertConversation,
} = require("./storage");
const { config } = require("./config");

function extractInbound(payload) {
  const message = payload?.text?.message || payload?.message || payload?.body || "";
  const phone = payload?.phone || payload?.from || payload?.chatLid || payload?.sender || "";
  const senderName = payload?.senderName || payload?.pushName || "";
  const isAudio = Boolean(payload?.audio?.audioUrl || payload?.audio?.url || payload?.isAudio);
  const audioUrl = payload?.audio?.audioUrl || payload?.audio?.url || payload?.fileUrl || "";
  return { message, phone, senderName, isAudio, audioUrl };
}

function normalizeForGreeting(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSimpleGreeting(input) {
  const normalized = normalizeForGreeting(input);
  const greetingTokens = [
    "hola",
    "buen dia",
    "buenos dias",
    "buena tarde",
    "buenas tardes",
    "buenas noches",
    "saludos",
    "que tal",
  ];
  const hasGreeting = greetingTokens.some((token) => normalized.includes(token));
  if (!hasGreeting) return false;

  const nonGreetingSignals = [
    "fallecio",
    "murio",
    "muerte",
    "pension",
    "beneficiario",
    "beneficiaria",
    "cotizo",
    "cotizaba",
    "reclamar",
    "derecho",
    "caso",
    "consulta",
    "ayuda",
    "pregunta",
  ];
  if (nonGreetingSignals.some((token) => normalized.includes(token))) return false;

  const words = normalized.split(" ").filter(Boolean).length;
  return words <= 6;
}

async function maybeGenerateStyledReply({
  conv,
  userText,
  instruction,
  responseType = "ai_response",
  fallback = "Gracias por escribirnos. ¿Me puede contar su caso para ayudarle?",
}) {
  if (!config.openai.apiKey) {
    return "Gracias por escribirnos. En este momento no tengo IA activa. Por favor configure OPENAI_API_KEY para responder con el estilo entrenado.";
  }
  try {
    const aiReply = await generateNaturalReply({
      userText,
      color: "ai",
      instruction:
        instruction ||
        "Responde 100% en base a los estilos y lineamientos de about.md y conversation.md. No uses respuestas roboticas.",
      responseType,
      conversationHistory: conv?.messages || [],
    });
    return aiReply || fallback;
  } catch (error) {
    console.error("AI reply generation failed:", error.message);
    return fallback;
  }
}

async function handleInbound(payload, options = {}) {
  const sendOutbound = options.sendMessage || sendMessage;
  const onBotMessage = options.onBotMessage || (() => {});
  const { message, phone, senderName, isAudio, audioUrl } = extractInbound(payload);
  if (!phone) return { ok: true, ignored: "missing_phone" };

  let text = message || "";
  if (isAudio && audioUrl) {
    try {
      const transcription = await transcribeAudioFromUrl(audioUrl);
      if (transcription) {
        text = transcription;
      }
    } catch (error) {
      console.error("Audio transcription error:", error.message);
    }
  }

  if (!text.trim()) return { ok: true, ignored: "empty_message" };

  let conv = getConversation(phone);
  if (!conv) {
    conv = upsertConversation(phone, { metadata: { senderName } });
  }

  appendConversationMessage(phone, { role: "user", text, rawType: isAudio ? "audio" : "text" });

  if (isSimpleGreeting(text)) {
    const presentation = await maybeGenerateStyledReply({
      conv,
      userText: text,
      responseType: "greeting_presentation",
      instruction:
        'Si el cliente envia solo un saludo, responde con un mensaje de presentacion en estilo humano similar a: "Hola, gracias por escribirnos. Soy Edwin Tello, abogado especialista en pensión de sobrevivientes a nivel nacional. ¿Cómo podemos ayudarle?". Mantener 2-4 lineas, tono profesional y cercano.',
      fallback: [
        "Hola, gracias por escribirnos.",
        "",
        "Soy Edwin Tello, abogado especialista en pensión de sobrevivientes a nivel nacional.",
        "",
        "¿Cómo podemos ayudarle?",
      ].join("\n"),
    });
    await sendOutbound(phone, presentation);
    onBotMessage(presentation);
    appendConversationMessage(phone, { role: "bot", text: presentation });
    upsertConversation(phone, {
      status: "active",
      metadata: { ...conv.metadata, senderName, aiDriven: true },
    });
    return { ok: true, responseType: "greeting_presentation" };
  }

  const classification = classifyMessage(text);
  const color = classification.color || "purple";
  const extracted = extractStructuredData(text);
  const mergedData = {
    idNumber: extracted.idNumber || conv.data?.idNumber || "",
    deathDate: extracted.deathDate || conv.data?.deathDate || "",
    claimant: extracted.claimant || conv.data?.claimant || "",
    deceasedName: extracted.deceasedName || conv.data?.deceasedName || "",
    workInfo: extracted.workInfo || conv.data?.workInfo || "",
  };

  // Stats: track first contact and color mix for daily report.
  const previousColor = conv.color || "purple";
  if (!conv.createdAt || !conv.messages?.length) {
    incrementDailyStat(getTodayKey(), "total");
  }
  if (color !== previousColor || !conv.messages?.length) {
    incrementDailyStat(getTodayKey(), color);
  }

  const aiReply = await maybeGenerateStyledReply({ conv, userText: text });
  await sendOutbound(phone, aiReply);
  onBotMessage(aiReply);
  appendConversationMessage(phone, { role: "bot", text: aiReply });

  const hasCoreData = Boolean(mergedData.idNumber && mergedData.deathDate);
  const awaitingData = !hasCoreData && color !== "red";
  const status = hasCoreData ? "pending_legal_review" : color === "red" ? "closed" : "active";

  // Metrics required by about.md
  if (extracted.idNumber) incrementDailyStat(getTodayKey(), "idNumbersCollected");
  if (extracted.deathDate) incrementDailyStat(getTodayKey(), "deathDatesCollected");

  upsertConversation(phone, {
    status,
    color,
    awaitingData,
    reminderCount: awaitingData ? conv.reminderCount || 0 : 0,
    data: mergedData,
    metadata: {
      ...conv.metadata,
      senderName,
      aiDriven: true,
      followUpAt: awaitingData ? dayjs().add(7, "hour").toISOString() : conv.metadata?.followUpAt || "",
    },
  });

  // Preferred CRM/Sheets persistence with claimant + phone context.
  if (hasCoreData && conv.status !== "pending_legal_review") {
    await appendLeadRow({
      name: senderName,
      phone,
      idNumber: mergedData.idNumber,
      deathDate: mergedData.deathDate,
      color,
      observations: mergedData.claimant
        ? `Quien reclama: ${mergedData.claimant}`
        : "Quien reclama: pendiente",
    });
  }

  return { ok: true, responseType: "ai_response" };
}

async function runFollowUpCycle() {
  const now = dayjs();
  const conversations = getConversationsAwaitingData(now.subtract(6, "hour").toISOString());
  for (const conv of conversations) {
    const reminderCount = conv.reminderCount || 0;
    if (reminderCount >= 1) {
      upsertConversation(conv.phone, {
        status: "closed",
        awaitingData: false,
        metadata: { ...conv.metadata, discardedReason: "no_data_after_first_reminder" },
      });
      continue;
    }

    const reminder1 = "Hola, espero se encuentre bien. Quedo atento a los datos para poder validar su caso.";
    const reminder2 =
      "Recuerde que con la cedula del fallecido y la fecha exacta de fallecimiento (dia, mes y ano) puedo realizar la consulta.";
    await sendMessage(conv.phone, reminder1);
    await sendMessage(conv.phone, reminder2);
    appendConversationMessage(conv.phone, { role: "bot", text: reminder1 });
    appendConversationMessage(conv.phone, { role: "bot", text: reminder2 });
    upsertConversation(conv.phone, {
      reminderCount: reminderCount + 1,
      status: "active",
      awaitingData: true,
      metadata: { ...conv.metadata, followUpAt: dayjs().add(24, "hour").toISOString() },
    });
  }
}

async function sendDailySummary() {
  if (!config.adminReportNumber) return;
  const today = getTodayKey();
  const stats = getStatsForDate(today);
  const report = [
    `Resumen diario (${today})`,
    `- Conversaciones totales: ${stats.total || 0}`,
    `- Verdes: ${stats.green || 0}`,
    `- Amarillos: ${stats.yellow || 0}`,
    `- Rojos: ${stats.red || 0}`,
    `- Morados: ${stats.purple || 0}`,
    `- Cedulas recibidas: ${stats.idNumbersCollected || 0}`,
    `- Fechas de fallecimiento recibidas: ${stats.deathDatesCollected || 0}`,
  ].join("\n");
  await sendMessage(config.adminReportNumber, report);
}

function startSchedulers() {
  cron.schedule("0 * * * *", () => {
    runFollowUpCycle().catch((error) => console.error("Follow-up cycle failed:", error.message));
  });

  cron.schedule("0 20 * * *", () => {
    sendDailySummary().catch((error) => console.error("Daily summary failed:", error.message));
    markDailyStats(getTodayKey(), getStatsForDate(getTodayKey()));
  });
}

module.exports = { handleInbound, startSchedulers, sendDailySummary, runFollowUpCycle };
