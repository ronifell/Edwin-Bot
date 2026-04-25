const cron = require("node-cron");
const dayjs = require("dayjs");
const { classifyMessage, normalize } = require("./classifier");
const { extractStructuredData } = require("./extractor");
const { generateNaturalReply, transcribeAudioFromUrl } = require("./aiService");
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
const { pickRandom } = require("./utils");

function buildGreenRequest() {
  const templates = [
    "Lamentamos su perdida. Oro por el eterno descanso de su ser querido. Para validar si su familiar dejo derecho a pension necesito por favor: cedula del fallecido y fecha exacta de fallecimiento (dia, mes y ano).",
    "Lamento mucho esta situacion. Oro por el eterno descanso de su ser querido. Para revisar su caso, compartame por favor la cedula del fallecido y la fecha exacta de fallecimiento con dia, mes y ano.",
  ];
  return pickRandom(templates);
}

function buildYellowQuestions() {
  return pickRandom([
    "Lamentamos su perdida. Oro por el eterno descanso de su ser querido. Para orientarle mejor necesito tres datos: quien fallecio, cuando fallecio y si cotizaba pension o trabajaba.",
    "Lamentamos su perdida. Oro por el eterno descanso de su ser querido. Para revisar viabilidad, por favor confirmeme: quien fallecio, cuando fallecio y por que le negaron la pension (si ya reclamo).",
  ]);
}

function buildRedClose() {
  return "Lamentamos su perdida y oramos por el eterno descanso de su ser querido. Siento no poder ayudarle, pero en este momento no manejamos ese tipo de casos. Gracias por escribirnos.";
}

function buildDocsInfo() {
  return "Por ahora necesito cedula de la persona fallecida y la fecha exacta de fallecimiento (dia, mes y ano) para revisar si dejo derecho a pension.";
}

function buildHowItWorksInfo() {
  return "Le explico: este proceso aplica cuando fallece un ser querido (esposa, companero, hijo o familiar directo) que trabajo o cotizo antes de morir. Con sus datos validamos si hay derecho.";
}

function hasDeathContext(normalizedText) {
  const deathTokens = ["fallecio", "murio", "mataron", "asesinaron", "muerte"];
  return deathTokens.some((token) => normalizedText.includes(token));
}

function extractInbound(payload) {
  const message = payload?.text?.message || payload?.message || payload?.body || "";
  const phone = payload?.phone || payload?.from || payload?.chatLid || payload?.sender || "";
  const senderName = payload?.senderName || payload?.pushName || "";
  const isAudio = Boolean(payload?.audio?.audioUrl || payload?.audio?.url || payload?.isAudio);
  const audioUrl = payload?.audio?.audioUrl || payload?.audio?.url || payload?.fileUrl || "";
  return { message, phone, senderName, isAudio, audioUrl };
}

function isGreetingOnly(normalizedText) {
  const hasGreetingPrompt =
    normalizedText.includes("como esta") ||
    normalizedText.includes("como estas") ||
    normalizedText.includes("como se encuentra");
  if (!hasGreetingPrompt) return false;

  const legalSignals = [
    "fallecio",
    "murio",
    "pension",
    "cotizo",
    "cotizaba",
    "cedula",
    "colpensiones",
    "beneficiario",
    "companero",
    "esposo",
    "esposa",
    "hijo",
    "hija",
  ];
  if (legalSignals.some((token) => normalizedText.includes(token))) return false;
  return normalizedText.length <= 80;
}

function looksLikeNewCaseIntent(normalizedText) {
  const restartPhrases = [
    "otro caso",
    "nueva consulta",
    "nuevo caso",
    "ahora",
    "tambien",
    "adicional",
    "otra persona",
  ];
  const caseSignals = [
    "fallecio",
    "murio",
    "mataron",
    "esposo",
    "esposa",
    "companero",
    "pareja",
    "hijo",
    "hija",
    "padre",
    "madre",
    "cedula",
    "pension",
  ];

  return (
    restartPhrases.some((token) => normalizedText.includes(token)) &&
    caseSignals.some((token) => normalizedText.includes(token))
  );
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
  const isNewConversation = !conv;
  if (!conv) {
    conv = upsertConversation(phone, { metadata: { senderName } });
    incrementDailyStat(getTodayKey(), "total");
  }

  appendConversationMessage(phone, { role: "user", text, rawType: isAudio ? "audio" : "text" });

  const normalizedText = normalize(text);
  if (isGreetingOnly(normalizedText)) {
    const greeting = "Me encuentro bien, gracias a Dios. Y usted como esta?";
    await sendOutbound(phone, greeting);
    onBotMessage(greeting);
    appendConversationMessage(phone, { role: "bot", text: greeting });
    return { ok: true, responseType: "greeting" };
  }

  if (conv.status === "pending_legal_review") {
    if (looksLikeNewCaseIntent(normalizedText)) {
      const reopenMsg =
        "Lamentamos su perdida. Oro por el eterno descanso de su ser querido. Perfecto, iniciamos un nuevo caso. Para revisarlo necesito por favor la cedula del fallecido y la fecha exacta de fallecimiento (dia, mes y ano).";
      await sendOutbound(phone, reopenMsg);
      onBotMessage(reopenMsg);
      appendConversationMessage(phone, { role: "bot", text: reopenMsg });

      upsertConversation(phone, {
        status: "active",
        awaitingData: true,
        reminderCount: 0,
        color: "purple",
        data: { idNumber: "", deathDate: "", claimant: "" },
        metadata: { ...conv.metadata, senderName, reopenedAt: new Date().toISOString() },
      });
      conv = getConversation(phone);
      return { ok: true, responseType: "reopened_new_case" };
    } else {
    const alreadyReceived =
      "Lamentamos su perdida y oramos por el eterno descanso de su ser querido. Gracias. Ya tengo sus datos en revision. Si encuentro derecho a pension, la contactare directamente.";
    await sendOutbound(phone, alreadyReceived);
    onBotMessage(alreadyReceived);
    appendConversationMessage(phone, { role: "bot", text: alreadyReceived });
    return { ok: true, responseType: "already_in_review" };
    }
  }

  const extracted = extractStructuredData(text);
  const mergedData = {
    idNumber: extracted.idNumber || conv.data?.idNumber || "",
    deathDate: extracted.deathDate || conv.data?.deathDate || "",
    claimant: extracted.claimant || conv.data?.claimant || "",
  };

  const classification = classifyMessage(text);
  const color = classification.color;
  if (classification.intent === "docs") {
    const docsBase = buildDocsInfo();
    const docs = hasDeathContext(normalizedText)
      ? `Lamentamos su perdida. Oro por el eterno descanso de su ser querido. ${docsBase}`
      : docsBase;
    await sendOutbound(phone, docs);
    onBotMessage(docs);
    upsertConversation(phone, {
      color: "purple",
      status: "active",
      awaitingData: true,
      metadata: { ...conv.metadata, senderName },
    });
    appendConversationMessage(phone, { role: "bot", text: docs });
    return { ok: true, responseType: "docs_info" };
  }

  if (classification.intent === "how_it_works") {
    const infoBase = buildHowItWorksInfo();
    const info = hasDeathContext(normalizedText)
      ? `Lamentamos su perdida. Oro por el eterno descanso de su ser querido. ${infoBase}`
      : infoBase;
    await sendOutbound(phone, info);
    onBotMessage(info);
    upsertConversation(phone, {
      color: "purple",
      status: "active",
      awaitingData: true,
      metadata: { ...conv.metadata, senderName },
    });
    appendConversationMessage(phone, { role: "bot", text: info });
    return { ok: true, responseType: "how_it_works_info" };
  }

  const previousColor = conv.color || "purple";
  if (color !== previousColor || isNewConversation) {
    incrementDailyStat(getTodayKey(), color);
  }

  if (classification.isVictimCase && !normalizedText.includes("si esta relacionada")) {
    const victimPrompt =
      "Lamentamos su perdida. Oro por el eterno descanso de su ser querido. Gracias por contarnos. Para continuar, confirmeme por favor si el caso de victima esta directamente relacionado con el fallecimiento que daria derecho a pension (si o no).";
    await sendOutbound(phone, victimPrompt);
    onBotMessage(victimPrompt);
    upsertConversation(phone, {
      color: "yellow",
      awaitingData: false,
      status: "active",
      metadata: { ...conv.metadata, awaitingVictimRelation: true, senderName },
      data: mergedData,
    });
    appendConversationMessage(phone, { role: "bot", text: victimPrompt });
    return { ok: true, responseType: "victim_clarification" };
  }

  if (conv.metadata?.awaitingVictimRelation) {
    if (normalizedText.includes("no")) {
      const msg = buildRedClose();
      await sendOutbound(phone, msg);
      onBotMessage(msg);
      upsertConversation(phone, {
        color: "red",
        status: "closed",
        awaitingData: false,
        metadata: { ...conv.metadata, awaitingVictimRelation: false },
      });
      appendConversationMessage(phone, { role: "bot", text: msg });
      return { ok: true, responseType: "victim_rejected" };
    }
    upsertConversation(phone, {
      metadata: { ...conv.metadata, awaitingVictimRelation: false },
    });
  }

  // If data is complete, confirm and close as candidate for manual legal check.
  if (mergedData.idNumber && mergedData.deathDate) {
    incrementDailyStat(getTodayKey(), "idNumbersCollected");
    incrementDailyStat(getTodayKey(), "deathDatesCollected");

    const confirmation1 = "Perfecto, muchas gracias por la informacion. Estare consultando su caso.";
    const empatheticConfirmation1 =
      "Lamentamos su perdida. Oro por el eterno descanso de su ser querido. Perfecto, muchas gracias por la informacion. Estare consultando su caso.";
    const confirmation2 =
      "La contactare unica y exclusivamente si encuentro que dejo derecho a pension. Si no me vuelvo a comunicar, probablemente no se encontro derecho.";

    await sendOutbound(phone, empatheticConfirmation1);
    onBotMessage(empatheticConfirmation1);
    await sendOutbound(phone, confirmation2);
    onBotMessage(confirmation2);

    upsertConversation(phone, {
      status: "pending_legal_review",
      awaitingData: false,
      color: color === "red" ? "yellow" : color,
      data: mergedData,
      metadata: { ...conv.metadata, senderName },
    });

    appendConversationMessage(phone, { role: "bot", text: empatheticConfirmation1 });
    appendConversationMessage(phone, { role: "bot", text: confirmation2 });

    await appendLeadRow({
      name: senderName,
      phone,
      idNumber: mergedData.idNumber,
      deathDate: mergedData.deathDate,
      color: color === "red" ? "yellow" : color,
      observations: "Datos completos recibidos",
    });

    return { ok: true, responseType: "data_collected" };
  }

  if (color === "red") {
    const messageToSend = buildRedClose();
    await sendOutbound(phone, messageToSend);
    onBotMessage(messageToSend);
    upsertConversation(phone, {
      color: "red",
      status: "closed",
      awaitingData: false,
      data: mergedData,
      metadata: { ...conv.metadata, senderName },
    });
    appendConversationMessage(phone, { role: "bot", text: messageToSend });
    return { ok: true, responseType: "closed_red" };
  }

  if (color === "green") {
    let messageToSend = buildGreenRequest();
    if (config.openai.enableReplyGeneration) {
      try {
        const aiReply = await generateNaturalReply({
          userText: text,
          color: "green",
          instruction: "Pide cedula del fallecido y fecha exacta de fallecimiento en tono humano.",
        });
        if (aiReply) messageToSend = aiReply;
      } catch (error) {
        console.error("AI green reply failed:", error.message);
      }
    }

    await sendOutbound(phone, messageToSend);
    onBotMessage(messageToSend);
    upsertConversation(phone, {
      color: "green",
      status: "active",
      awaitingData: true,
      reminderCount: 0,
      data: mergedData,
      metadata: { ...conv.metadata, senderName, followUpAt: dayjs().add(7, "hour").toISOString() },
    });
    appendConversationMessage(phone, { role: "bot", text: messageToSend });
    return { ok: true, responseType: "green_request_data" };
  }

  if (color === "yellow") {
    const messageToSend = buildYellowQuestions();
    await sendOutbound(phone, messageToSend);
    onBotMessage(messageToSend);
    upsertConversation(phone, {
      color: "yellow",
      status: "active",
      awaitingData: true,
      reminderCount: 0,
      data: mergedData,
      metadata: { ...conv.metadata, senderName, followUpAt: dayjs().add(7, "hour").toISOString() },
    });
    appendConversationMessage(phone, { role: "bot", text: messageToSend });
    return { ok: true, responseType: "yellow_questions" };
  }

  // Purple (uncertain): keep lead alive and ask a clarifying question.
  const purpleQuestion =
    "Lamentamos su perdida. Oro por el eterno descanso de su ser querido. Para poder ayudarle bien, me confirma por favor: quien fallecio, si trabajaba o cotizaba, y la fecha aproximada del fallecimiento?";
  await sendOutbound(phone, purpleQuestion);
  onBotMessage(purpleQuestion);
  upsertConversation(phone, {
    color: "purple",
    status: "active",
    awaitingData: true,
    reminderCount: 0,
    data: mergedData,
    metadata: { ...conv.metadata, senderName, followUpAt: dayjs().add(7, "hour").toISOString() },
  });
  appendConversationMessage(phone, { role: "bot", text: purpleQuestion });
  return { ok: true, responseType: "purple_clarification" };
}

async function runFollowUpCycle() {
  const now = dayjs();
  const conversations = getConversationsAwaitingData(now.subtract(6, "hour").toISOString());
  for (const conv of conversations) {
    const reminderCount = conv.reminderCount || 0;
    if (reminderCount >= 1) {
      // After first reminder and still no data by next cycle, discard.
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
  // Every hour: check pending follow-ups.
  cron.schedule("0 * * * *", () => {
    runFollowUpCycle().catch((error) => console.error("Follow-up cycle failed:", error.message));
  });

  // Every day at 20:00 local time.
  cron.schedule("0 20 * * *", () => {
    sendDailySummary().catch((error) => console.error("Daily summary failed:", error.message));
    markDailyStats(getTodayKey(), getStatsForDate(getTodayKey()));
  });
}

module.exports = { handleInbound, startSchedulers, sendDailySummary, runFollowUpCycle };
