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
    "Para validar si su familiar dejo derecho a pension necesito por favor estos datos: cedula del fallecido, nombre completo del fallecido, fecha exacta de fallecimiento (dia, mes y ano), y si trabajaba o cotizaba (si sabe la empresa o fondo, me la indica).",
    "Para revisar su caso, compartame por favor: cedula del fallecido, nombre completo, fecha exacta de fallecimiento con dia, mes y ano, y si trabajaba o cotizaba.",
  ];
  return pickRandom(templates);
}

function buildYellowQuestions() {
  return pickRandom([
    "Para orientarle mejor necesito tres datos: quien fallecio, cuando fallecio y si cotizaba pension o trabajaba.",
    "Para revisar viabilidad, por favor confirmeme: quien fallecio, cuando fallecio y por que le negaron la pension (si ya reclamo).",
  ]);
}

function buildRedClose() {
  return "Siento no poder ayudarle, pero en este momento no manejamos ese tipo de casos. Gracias por escribirnos.";
}

function buildDocsInfo() {
  return "Por ahora necesito cedula de la persona fallecida, nombre completo del fallecido, fecha exacta de fallecimiento (dia, mes y ano), y si trabajaba o cotizaba para revisar si dejo derecho a pension.";
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
  const greetingTokens = [
    "hola",
    "buen dia",
    "buenos dias",
    "buena tarde",
    "buenas tardes",
    "buenas noches",
    "que tal",
    "como esta",
    "como estas",
    "como se encuentra",
    "saludos",
  ];
  const hasGreetingPrompt = greetingTokens.some((token) => normalizedText.includes(token));
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
    "beneficiario",
    "beneficiaria",
    "derecho",
    "reclamar",
    "reclamo",
    "consulta",
    "asesoria",
    "ayuda",
    "quiero",
    "quisiera",
    "gustaria",
    "saber",
  ];
  if (legalSignals.some((token) => normalizedText.includes(token))) return false;
  const words = normalizedText.split(" ").filter(Boolean).length;
  return normalizedText.length <= 40 && words <= 6;
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

function hasUnmarriedConcern(normalizedText) {
  const unmarriedSignals = [
    "no nos casamos",
    "no se casaron",
    "no estaban casados",
    "no estabamos casados",
    "no me case",
    "no estaba casada",
    "no estaba casado",
    "union libre",
  ];
  return unmarriedSignals.some((token) => normalizedText.includes(token));
}

function stripCondolencePhrases(text) {
  return String(text || "")
    .replace(/lamentamos su perdida\.?/gi, "")
    .replace(/lamento mucho esta situacion\.?/gi, "")
    .replace(/oro por el eterno descanso de su ser querido\.?/gi, "")
    .replace(/y oramos por el eterno descanso de su ser querido\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function withCondolenceOnce(conv, baseText, includeCondolence = true) {
  const alreadySent = Boolean(conv?.metadata?.condolenceSent);
  const cleanBaseText = stripCondolencePhrases(baseText);
  if (!includeCondolence) return { text: cleanBaseText, metadataPatch: {} };
  if (alreadySent) return { text: cleanBaseText, metadataPatch: {} };
  const condolence = "Lamentamos su perdida. Oro por el eterno descanso de su ser querido.";
  return { text: `${condolence} ${cleanBaseText}`.trim(), metadataPatch: { condolenceSent: true } };
}

function buildMissingFieldsPrompt(missingFields) {
  const labels = {
    idNumber: "el numero de cedula del fallecido",
    deceasedName: "el nombre completo del fallecido",
    deathDate: "la fecha exacta de fallecimiento (dia, mes y ano)",
    workInfo: "si la persona fallecida trabajaba o cotizaba (y, si sabe, en que empresa o fondo)",
  };
  const requested = missingFields.map((field) => labels[field]).filter(Boolean);
  if (!requested.length) return "";
  if (requested.length === 1) {
    return `Gracias por la informacion. Para continuar, por favor envieme ${requested[0]}.`;
  }
  const last = requested[requested.length - 1];
  const first = requested.slice(0, -1).join(" y ");
  return `Gracias por la informacion. Para continuar, por favor envieme ${first} y ${last}.`;
}

function hasAllRequestedData(mergedData, requestedFields) {
  return requestedFields.every((field) => Boolean(mergedData[field]));
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
  const deathContextDetected =
    hasDeathContext(normalizedText) || Boolean(conv.metadata?.deathContextDetected) || Boolean(conv.data?.deathDate);
  if (isGreetingOnly(normalizedText)) {
    const greeting = [
      "Hola, gracias por escribirnos.",
      "Soy Edwin Tello, abogado especialista en pensiones de sobrevivientes a nivel nacional.",
      "Cómo podemos ayudarle?",
    ].join("\n");
    await sendOutbound(phone, greeting);
    onBotMessage(greeting);
    appendConversationMessage(phone, { role: "bot", text: greeting });
    return { ok: true, responseType: "greeting" };
  }

  if (conv.status === "pending_legal_review") {
    if (looksLikeNewCaseIntent(normalizedText)) {
      const reopenBase =
        "Perfecto, iniciamos un nuevo caso. Para revisarlo necesito por favor la cedula del fallecido y la fecha exacta de fallecimiento (dia, mes y ano).";
      const reopenMsg = withCondolenceOnce(conv, reopenBase);
      await sendOutbound(phone, reopenMsg.text);
      onBotMessage(reopenMsg.text);
      appendConversationMessage(phone, { role: "bot", text: reopenMsg.text });

      upsertConversation(phone, {
        status: "active",
        awaitingData: true,
        reminderCount: 0,
        color: "purple",
        data: { idNumber: "", deathDate: "", deceasedName: "", workInfo: "", claimant: "" },
        metadata: {
          ...conv.metadata,
          ...reopenMsg.metadataPatch,
          deathContextDetected,
          senderName,
          requestedFields: ["idNumber", "deceasedName", "deathDate", "workInfo"],
          reopenedAt: new Date().toISOString(),
        },
      });
      conv = getConversation(phone);
      return { ok: true, responseType: "reopened_new_case" };
    } else {
      const alreadyBase =
        "Gracias. Ya tengo sus datos en revision. Si encuentro derecho a pension, la contactare directamente.";
      const alreadyReceived = withCondolenceOnce(conv, alreadyBase);
      await sendOutbound(phone, alreadyReceived.text);
      onBotMessage(alreadyReceived.text);
      appendConversationMessage(phone, { role: "bot", text: alreadyReceived.text });
      upsertConversation(phone, {
        metadata: { ...conv.metadata, ...alreadyReceived.metadataPatch, deathContextDetected, senderName },
      });
      return { ok: true, responseType: "already_in_review" };
    }
  }

  const extracted = extractStructuredData(text);
  const mergedData = {
    idNumber: extracted.idNumber || conv.data?.idNumber || "",
    deathDate: extracted.deathDate || conv.data?.deathDate || "",
    deceasedName: extracted.deceasedName || conv.data?.deceasedName || "",
    workInfo: extracted.workInfo || conv.data?.workInfo || "",
    claimant: extracted.claimant || conv.data?.claimant || "",
  };
  const requestedFields =
    conv.metadata?.requestedFields && conv.metadata.requestedFields.length
      ? conv.metadata.requestedFields
      : conv.awaitingData
        ? ["idNumber", "deceasedName", "deathDate", "workInfo"]
        : [];
  const userProvidedTrackedFieldInThisMessage = Boolean(
    extracted.idNumber || extracted.deathDate || extracted.deceasedName || extracted.workInfo
  );
  if (conv.awaitingData && requestedFields.length && userProvidedTrackedFieldInThisMessage) {
    const missingFields = requestedFields.filter((field) => !mergedData[field]);
    if (missingFields.length) {
      const missingPrompt = withCondolenceOnce(
        conv,
        buildMissingFieldsPrompt(missingFields),
        deathContextDetected
      );
      await sendOutbound(phone, missingPrompt.text);
      onBotMessage(missingPrompt.text);
      upsertConversation(phone, {
        awaitingData: true,
        data: mergedData,
        metadata: { ...conv.metadata, ...missingPrompt.metadataPatch, deathContextDetected, senderName },
      });
      appendConversationMessage(phone, { role: "bot", text: missingPrompt.text });
      return { ok: true, responseType: "request_missing_data" };
    }
  }

  const classification = classifyMessage(text);
  const color = classification.color;
  if (classification.intent === "docs") {
    const docsBase = buildDocsInfo();
    const docsComposed = hasDeathContext(normalizedText)
      ? withCondolenceOnce(conv, docsBase)
      : { text: docsBase, metadataPatch: {} };
    const docs = docsComposed.text;
    await sendOutbound(phone, docs);
    onBotMessage(docs);
    upsertConversation(phone, {
      color: "purple",
      status: "active",
      awaitingData: true,
      metadata: {
        ...conv.metadata,
        ...docsComposed.metadataPatch,
        deathContextDetected,
        senderName,
        requestedFields: ["idNumber", "deceasedName", "deathDate", "workInfo"],
      },
    });
    appendConversationMessage(phone, { role: "bot", text: docs });
    return { ok: true, responseType: "docs_info" };
  }

  if (classification.intent === "how_it_works") {
    const infoBase = buildHowItWorksInfo();
    const infoComposed = hasDeathContext(normalizedText)
      ? withCondolenceOnce(conv, infoBase)
      : { text: infoBase, metadataPatch: {} };
    const info = infoComposed.text;
    await sendOutbound(phone, info);
    onBotMessage(info);
    upsertConversation(phone, {
      color: "purple",
      status: "active",
      awaitingData: true,
      metadata: {
        ...conv.metadata,
        ...infoComposed.metadataPatch,
        deathContextDetected,
        senderName,
        requestedFields: ["idNumber", "deceasedName", "deathDate", "workInfo"],
      },
    });
    appendConversationMessage(phone, { role: "bot", text: info });
    return { ok: true, responseType: "how_it_works_info" };
  }

  if (classification.intent === "self_retirement_help") {
    const reply = "Y necesita alguna ayuda con eso o puede hacerlo usted mismo?";
    await sendOutbound(phone, reply);
    onBotMessage(reply);
    upsertConversation(phone, {
      color: "purple",
      status: "active",
      awaitingData: false,
      data: mergedData,
      metadata: { ...conv.metadata, deathContextDetected, senderName },
    });
    appendConversationMessage(phone, { role: "bot", text: reply });
    return { ok: true, responseType: "self_retirement_help" };
  }

  const previousColor = conv.color || "purple";
  if (color !== previousColor || isNewConversation) {
    incrementDailyStat(getTodayKey(), color);
  }

  if (classification.isVictimCase && !normalizedText.includes("si esta relacionada")) {
    const victimPromptBase =
      "Gracias por contarnos. Para continuar, confirmeme por favor si el caso de victima esta directamente relacionado con el fallecimiento que daria derecho a pension (si o no).";
    const victimPrompt = withCondolenceOnce(conv, victimPromptBase, deathContextDetected);
    await sendOutbound(phone, victimPrompt.text);
    onBotMessage(victimPrompt.text);
    upsertConversation(phone, {
      color: "yellow",
      awaitingData: false,
      status: "active",
      metadata: {
        ...conv.metadata,
        ...victimPrompt.metadataPatch,
        deathContextDetected,
        awaitingVictimRelation: true,
        senderName,
      },
      data: mergedData,
    });
    appendConversationMessage(phone, { role: "bot", text: victimPrompt.text });
    return { ok: true, responseType: "victim_clarification" };
  }

  if (conv.metadata?.awaitingVictimRelation) {
    if (normalizedText.includes("no")) {
      const msg = withCondolenceOnce(conv, buildRedClose(), deathContextDetected);
      await sendOutbound(phone, msg.text);
      onBotMessage(msg.text);
      upsertConversation(phone, {
        color: "red",
        status: "closed",
        awaitingData: false,
        metadata: { ...conv.metadata, deathContextDetected, awaitingVictimRelation: false },
      });
      appendConversationMessage(phone, { role: "bot", text: msg.text });
      return { ok: true, responseType: "victim_rejected" };
    }
    upsertConversation(phone, {
      metadata: { ...conv.metadata, awaitingVictimRelation: false },
    });
  }

  // If data is complete, confirm and close as candidate for manual legal check.
  const completeForCurrentRequest = hasAllRequestedData(
    mergedData,
    requestedFields.length ? requestedFields : ["idNumber", "deceasedName", "deathDate", "workInfo"]
  );
  if (completeForCurrentRequest) {
    incrementDailyStat(getTodayKey(), "idNumbersCollected");
    incrementDailyStat(getTodayKey(), "deathDatesCollected");

    const confirmation1 =
      "Perfecto, muchas gracias por la informacion. Estare consultando si la persona fallecida dejo derecho a pension para usted y/o los demas beneficiarios.";
    const composedConfirmation = withCondolenceOnce(conv, confirmation1, deathContextDetected);
    const confirmation2 =
      "La contactare unica y exclusivamente si encuentro que dejo derecho a pension. Si no me vuelvo a comunicar, probablemente no se encontro derecho.";

    await sendOutbound(phone, composedConfirmation.text);
    onBotMessage(composedConfirmation.text);
    await sendOutbound(phone, confirmation2);
    onBotMessage(confirmation2);

    upsertConversation(phone, {
      status: "pending_legal_review",
      awaitingData: false,
      color: color === "red" ? "yellow" : color,
      data: mergedData,
      metadata: {
        ...conv.metadata,
        ...composedConfirmation.metadataPatch,
        deathContextDetected,
        senderName,
        requestedFields: [],
      },
    });

    appendConversationMessage(phone, { role: "bot", text: composedConfirmation.text });
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
    const messageToSend = withCondolenceOnce(conv, buildRedClose(), deathContextDetected);
    await sendOutbound(phone, messageToSend.text);
    onBotMessage(messageToSend.text);
    upsertConversation(phone, {
      color: "red",
      status: "closed",
      awaitingData: false,
      data: mergedData,
      metadata: { ...conv.metadata, ...messageToSend.metadataPatch, deathContextDetected, senderName },
    });
    appendConversationMessage(phone, { role: "bot", text: messageToSend.text });
    return { ok: true, responseType: "closed_red" };
  }

  if (color === "green") {
    let messageToSend = buildGreenRequest();
    let allowAiRewrite = true;
    if (hasUnmarriedConcern(normalizedText)) {
      messageToSend = [
        "Buen dia.",
        "No importa que no se hayan casado.",
        "Por favor enviar numero de cedula de el, nombre completo, fecha de fallecimiento con dia mes y ano, y si trabajaba o cotizaba.",
      ].join(" ");
      allowAiRewrite = false;
    }
    if (config.openai.enableReplyGeneration && allowAiRewrite) {
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

    const greenReply = withCondolenceOnce(conv, messageToSend, deathContextDetected);
    await sendOutbound(phone, greenReply.text);
    onBotMessage(greenReply.text);
    upsertConversation(phone, {
      color: "green",
      status: "active",
      awaitingData: true,
      reminderCount: 0,
      data: mergedData,
      metadata: {
        ...conv.metadata,
        ...greenReply.metadataPatch,
        deathContextDetected,
        senderName,
        requestedFields: ["idNumber", "deceasedName", "deathDate", "workInfo"],
        followUpAt: dayjs().add(7, "hour").toISOString(),
      },
    });
    appendConversationMessage(phone, { role: "bot", text: greenReply.text });
    return { ok: true, responseType: "green_request_data" };
  }

  if (color === "yellow") {
    const messageToSend = withCondolenceOnce(conv, buildYellowQuestions(), deathContextDetected);
    await sendOutbound(phone, messageToSend.text);
    onBotMessage(messageToSend.text);
    upsertConversation(phone, {
      color: "yellow",
      status: "active",
      awaitingData: true,
      reminderCount: 0,
      data: mergedData,
      metadata: {
        ...conv.metadata,
        ...messageToSend.metadataPatch,
        deathContextDetected,
        senderName,
        requestedFields: ["idNumber", "deceasedName", "deathDate", "workInfo"],
        followUpAt: dayjs().add(7, "hour").toISOString(),
      },
    });
    appendConversationMessage(phone, { role: "bot", text: messageToSend.text });
    return { ok: true, responseType: "yellow_questions" };
  }

  // Purple (uncertain): keep lead alive and ask a clarifying question.
  const purpleQuestion = withCondolenceOnce(
    conv,
    "Para poder ayudarle bien, me confirma por favor: quien fallecio, si trabajaba o cotizaba, y la fecha aproximada del fallecimiento?",
    deathContextDetected
  );
  await sendOutbound(phone, purpleQuestion.text);
  onBotMessage(purpleQuestion.text);
  upsertConversation(phone, {
    color: "purple",
    status: "active",
    awaitingData: true,
    reminderCount: 0,
    data: mergedData,
    metadata: {
      ...conv.metadata,
      ...purpleQuestion.metadataPatch,
      deathContextDetected,
      senderName,
      requestedFields: ["idNumber", "deceasedName", "deathDate", "workInfo"],
      followUpAt: dayjs().add(7, "hour").toISOString(),
    },
  });
  appendConversationMessage(phone, { role: "bot", text: purpleQuestion.text });
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
