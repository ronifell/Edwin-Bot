const cron = require("node-cron");
const dayjs = require("dayjs");
const { generateNaturalReply, transcribeAudioFromUrl } = require("./aiService");
const { classifyMessage } = require("./classifier");
const { extractStructuredData } = require("./extractor");
const { appendLeadRow } = require("./sheetService");
const { sendMessage } = require("./zapiService");
const { isPhoneBlocked } = require("./blocklist");
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

const PROCESSED_EVENT_TTL_MS = 10 * 60 * 1000;
const processedEventCache = new Map();

function cleanupProcessedEventCache(now = Date.now()) {
  for (const [key, ts] of processedEventCache.entries()) {
    if (now - ts > PROCESSED_EVENT_TTL_MS) processedEventCache.delete(key);
  }
}

function normalizeForKey(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFallbackEventKey({ phone, type, message, isAudio }) {
  const normalizedText = normalizeForKey(message).slice(0, 120);
  return `fp:${phone}|${type || "n/a"}|audio:${isAudio ? 1 : 0}|${normalizedText}`;
}

function shouldSkipFingerprintDedupe(message, conv) {
  const normalized = normalizeForKey(message);
  if (!normalized) return false;

  const shortInteractiveReplies = new Set(["si", "no", "ok", "gracias"]);
  if (!shortInteractiveReplies.has(normalized)) return false;

  const lastBotMessage = [...(conv?.messages || [])].reverse().find((item) => item.role === "bot");
  return Boolean(lastBotMessage?.text);
}

function extractInbound(payload) {
  const message =
    payload?.text?.message ||
    payload?.message ||
    payload?.body ||
    payload?.conversation ||
    payload?.caption ||
    payload?.extendedTextMessage?.text ||
    payload?.audio?.transcription ||
    payload?.transcription ||
    "";
  const phone = payload?.phone || payload?.from || payload?.chatLid || payload?.sender || "";
  const senderName = payload?.senderName || payload?.pushName || "";
  const audioUrl =
    payload?.audio?.audioUrl ||
    payload?.audio?.url ||
    payload?.fileUrl ||
    payload?.file?.url ||
    payload?.voice?.url ||
    payload?.ptt?.url ||
    payload?.mediaUrl ||
    "";
  const mimeType =
    payload?.audio?.mimetype || payload?.audio?.mimeType || payload?.mimetype || payload?.mimeType || "";
  const isAudio = Boolean(
    payload?.isAudio ||
      audioUrl ||
      /^audio\//i.test(String(mimeType || "")) ||
      /audio|voice|ptt/i.test(String(payload?.type || ""))
  );
  const fromMe = Boolean(payload?.fromMe);
  const isStatusReply = Boolean(payload?.isStatusReply);
  const type = payload?.type || "";
  const isGroup = Boolean(payload?.isGroup);
  const messageId =
    payload?.messageId ||
    payload?.ids?.id ||
    (Array.isArray(payload?.ids) ? payload.ids[0] : "") ||
    "";
  return { message, phone, senderName, isAudio, audioUrl, fromMe, isStatusReply, type, isGroup, messageId };
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
    "buenas",
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

function isContactLaterIntent(input) {
  const normalized = normalizeForKey(input);
  if (!normalized) return false;
  const immediateReturnSignals = [
    "espere un momento",
    "espera un momento",
    "un momento",
    "en un momento",
    "dame un momento",
    "deme un momento",
    "ahorita",
    "ya le escribo",
    "ya te escribo",
    "ahora le escribo",
    "ahora te escribo",
    "enseguida",
  ];
  if (immediateReturnSignals.some((token) => normalized.includes(token))) return false;

  const laterSignals = [
    "luego te escribo",
    "luego le escribo",
    "despues te escribo",
    "despues le escribo",
    "mas tarde",
    "te contacto luego",
    "le contacto luego",
    "cuando pueda",
    "ahorita no puedo",
    "ahora no puedo",
    "en un rato",
    "te aviso luego",
    "le aviso luego",
    "mas adelante",
  ];
  return laterSignals.some((token) => normalized.includes(token));
}

function isContactSoonIntent(input) {
  const normalized = normalizeForKey(input);
  if (!normalized) return false;
  const immediateReturnSignals = [
    "espere un momento",
    "espera un momento",
    "un momento",
    "en un momento",
    "dame un momento",
    "deme un momento",
    "ahorita",
    "ya le escribo",
    "ya te escribo",
    "ahora le escribo",
    "ahora te escribo",
    "enseguida",
  ];
  return immediateReturnSignals.some((token) => normalized.includes(token));
}

function getMissingCoreDataFields(data) {
  const missing = [];
  if (!data?.idNumber) missing.push("idNumber");
  if (!data?.deathDate) missing.push("deathDate");
  return missing;
}

function isAffirmative(input) {
  const normalized = normalizeForKey(input);
  return (
    normalized === "si" ||
    normalized === "sí" ||
    normalized === "yes" ||
    normalized.includes("si ") ||
    normalized.includes("es por fallecimiento") ||
    normalized.includes("fallecimiento de un familiar")
  );
}

function isNegative(input) {
  const normalized = normalizeForKey(input);
  return (
    normalized === "no" ||
    normalized.includes("no ") ||
    normalized.includes("no es por fallecimiento") ||
    normalized.includes("no hay fallecimiento")
  );
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
  const { message, phone, senderName, isAudio, audioUrl, fromMe, isStatusReply, type, isGroup, messageId } =
    extractInbound(payload);
  console.log(
    `[BOT] inbound received phone=${phone || "missing"} sender=${senderName || "unknown"} isAudio=${isAudio} type=${
      type || "n/a"
    } fromMe=${fromMe} isStatusReply=${isStatusReply} isGroup=${isGroup} messageId=${messageId || "n/a"}`
  );
  if (!phone) {
    console.warn("[BOT] ignored: missing_phone");
    return { ok: true, ignored: "missing_phone" };
  }

  let existingConv = getConversation(phone);
  const phoneIsBlocked = isPhoneBlocked(phone, config.defaultCountryPrefix);

  if (phoneIsBlocked) {
    upsertConversation(phone, {
      status: "blocked",
      awaitingData: false,
      metadata: {
        ...(existingConv?.metadata || {}),
        senderName,
        manualTakeover: true,
        manualTakeoverAt: existingConv?.metadata?.manualTakeoverAt || new Date().toISOString(),
        blockedByExternalBlocklist: true,
      },
    });
    console.log(`[BOT] ignored: phone_blocklisted phone=${phone}`);
    return { ok: true, ignored: "phone_blocklisted" };
  }

  // If a number was previously blocked by external blocklist but was later removed,
  // release the automatic manual-takeover lock so bot can process new inbound again.
  if (existingConv?.metadata?.blockedByExternalBlocklist) {
    upsertConversation(phone, {
      metadata: {
        ...existingConv.metadata,
        blockedByExternalBlocklist: false,
        manualTakeover: false,
      },
    });
    existingConv = getConversation(phone);
  }

  if (fromMe) {
    if (existingConv) {
      upsertConversation(phone, {
        awaitingData: false,
        metadata: {
          ...existingConv.metadata,
          senderName,
          manualTakeover: true,
          manualTakeoverAt: new Date().toISOString(),
        },
      });
    }
    console.log(`[BOT] ignored: manual_takeover_by_human phone=${phone}`);
    return { ok: true, ignored: "from_me" };
  }

  if (isStatusReply) {
    console.log(`[BOT] ignored: status reply event phone=${phone}`);
    return { ok: true, ignored: "status_reply_event" };
  }

  if (isGroup) {
    console.log(`[BOT] ignored: group message phone=${phone}`);
    return { ok: true, ignored: "group_message" };
  }

  cleanupProcessedEventCache();
  const stableKey = messageId ? `mid:${phone}|${type || "n/a"}|${messageId}` : "";
  const fallbackKey = buildFallbackEventKey({ phone, type, message, isAudio });
  const now = Date.now();
  if (existingConv?.metadata?.manualTakeover) {
    console.log(`[BOT] ignored: manual_takeover_active phone=${phone}`);
    return { ok: true, ignored: "manual_takeover_active" };
  }
  const skipFingerprintDedupe = shouldSkipFingerprintDedupe(message, existingConv);

  if (stableKey && processedEventCache.has(stableKey)) {
    console.log(`[BOT] ignored: duplicate_message by messageId phone=${phone} messageId=${messageId}`);
    return { ok: true, ignored: "duplicate_message" };
  }
  // Fallback dedupe for providers that resend without stable messageId.
  const previousByFingerprint = processedEventCache.get(fallbackKey);
  if (!skipFingerprintDedupe && previousByFingerprint && now - previousByFingerprint < 30 * 1000) {
    console.log(`[BOT] ignored: duplicate_message by fingerprint phone=${phone}`);
    return { ok: true, ignored: "duplicate_message" };
  }

  if (stableKey) processedEventCache.set(stableKey, now);
  processedEventCache.set(fallbackKey, now);

  let text = message || "";
  if (isAudio && audioUrl) {
    try {
      console.log(`[BOT] transcribing audio phone=${phone} urlPresent=${Boolean(audioUrl)}`);
      const transcription = await transcribeAudioFromUrl(audioUrl);
      if (transcription) {
        text = transcription;
        console.log(`[BOT] audio transcription ok phone=${phone} chars=${transcription.length}`);
      } else {
        console.warn(`[BOT] audio transcription empty phone=${phone}`);
      }
    } catch (error) {
      console.error(`[BOT] audio transcription error phone=${phone}:`, error.message);
    }
  }

  const hasConversationalPayload = Boolean(text.trim()) || isAudio;
  if (!hasConversationalPayload) {
    console.log(`[BOT] ignored: non-conversational event phone=${phone} type=${type || "n/a"}`);
    return { ok: true, ignored: "non_conversational_event" };
  }

  if (!text.trim()) {
    if (isAudio) {
      const audioClarification = await maybeGenerateStyledReply({
        conv: getConversation(phone),
        userText: "audio_sin_transcripcion",
        responseType: "audio_clarification",
        instruction:
          "Si recibes audio pero no se puede transcribir, pide amablemente que repita el audio con mejor claridad o que lo envie por texto. Mensaje breve y humano.",
        fallback:
          "Gracias. No pude escuchar bien el audio. ¿Podrías repetirlo con mejor claridad o enviarme ese mensaje por texto?",
      });
      await sendOutbound(phone, audioClarification);
      onBotMessage(audioClarification);
      appendConversationMessage(phone, { role: "bot", text: audioClarification });
      console.warn(`[BOT] audio message without transcription phone=${phone}`);
      return { ok: true, responseType: "audio_clarification" };
    }
    console.warn(`[BOT] ignored: empty_message phone=${phone}`);
    return { ok: true, ignored: "empty_message" };
  }

  let conv = getConversation(phone);
  if (!conv) {
    console.log(`[BOT] creating new conversation phone=${phone}`);
    conv = upsertConversation(phone, { metadata: { senderName } });
  } else {
    console.log(
      `[BOT] existing conversation phone=${phone} status=${conv.status || "n/a"} color=${conv.color || "n/a"}`
    );
  }

  appendConversationMessage(phone, { role: "user", text, rawType: isAudio ? "audio" : "text" });

  if (conv.metadata?.victimClarificationPending) {
    if (isNegative(text)) {
      const redDiscardReply = await maybeGenerateStyledReply({
        conv,
        userText: text,
        responseType: "closed_red",
        instruction:
          "El cliente confirma que NO es un caso por fallecimiento de familiar. Responde en 1-2 frases cortas, profesionales y amables, indicando que este caso no lo manejamos.",
        fallback: "Gracias por la información. Este tipo de caso no lo manejamos actualmente.",
      });
      await sendOutbound(phone, redDiscardReply);
      onBotMessage(redDiscardReply);
      appendConversationMessage(phone, { role: "bot", text: redDiscardReply });
      upsertConversation(phone, {
        status: "closed",
        color: "red",
        awaitingData: false,
        metadata: { ...conv.metadata, senderName, aiDriven: true, victimClarificationPending: false },
      });
      console.log(`[BOT] victim clarification resolved as red discard phone=${phone}`);
      return { ok: true, responseType: "closed_red" };
    }
    if (isAffirmative(text)) {
      upsertConversation(phone, {
        metadata: { ...conv.metadata, senderName, aiDriven: true, victimClarificationPending: false },
      });
      conv = getConversation(phone) || conv;
      console.log(`[BOT] victim clarification confirmed death-related phone=${phone}`);
    }
  }

  if (isSimpleGreeting(text)) {
    console.log(`[BOT] simple greeting detected phone=${phone}`);
    const presentation = await maybeGenerateStyledReply({
      conv,
      userText: text,
      responseType: "greeting_presentation",
      instruction:
        "Si el cliente envia solo un saludo, responde breve, humana y profesionalmente, preguntando como puedes ayudar.",
      fallback: "Hola, ¿cómo puedo ayudarle?",
    });
    await sendOutbound(phone, presentation);
    onBotMessage(presentation);
    appendConversationMessage(phone, { role: "bot", text: presentation });
    upsertConversation(phone, {
      status: "active",
      metadata: { ...conv.metadata, senderName, aiDriven: true },
    });
    console.log(`[BOT] greeting response sent phone=${phone}`);
    return { ok: true, responseType: "greeting_presentation" };
  }

  if (isContactSoonIntent(text)) {
    const soonReply = await maybeGenerateStyledReply({
      conv,
      userText: text,
      responseType: "contact_soon_ack",
      instruction:
        'El cliente indica que vuelve en un momento. Responde en una sola frase corta, tipo "Sí, entendido." con tono amable y profesional, sin pedir datos adicionales.',
      fallback: "Sí, entendido.",
    });
    await sendOutbound(phone, soonReply);
    onBotMessage(soonReply);
    appendConversationMessage(phone, { role: "bot", text: soonReply });
    upsertConversation(phone, {
      status: "active",
      metadata: { ...conv.metadata, senderName, aiDriven: true },
    });
    console.log(`[BOT] contact-soon response sent phone=${phone}`);
    return { ok: true, responseType: "contact_soon_ack" };
  }

  if (isContactLaterIntent(text)) {
    const laterReply = await maybeGenerateStyledReply({
      conv,
      userText: text,
      responseType: "contact_later_ack",
      instruction:
        "El cliente indica que volvera a escribir despues. Responde con tono amable y profesional, en 1-2 frases cortas, confirmando que puede escribir cuando quiera y que con gusto se le ayudara.",
      fallback: "Entendido. Puede escribirme en cualquier momento. Con gusto le ayudo.",
    });
    await sendOutbound(phone, laterReply);
    onBotMessage(laterReply);
    appendConversationMessage(phone, { role: "bot", text: laterReply });
    upsertConversation(phone, {
      status: "active",
      metadata: { ...conv.metadata, senderName, aiDriven: true },
    });
    console.log(`[BOT] contact-later response sent phone=${phone}`);
    return { ok: true, responseType: "contact_later_ack" };
  }

  const classification = classifyMessage(text);
  const color = classification.color || "purple";
  console.log(
    `[BOT] classified phone=${phone} color=${color} reason=${classification.reason || "n/a"} intent=${
      classification.intent || "n/a"
    }`
  );
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

  const hasCoreData = Boolean(mergedData.idNumber && mergedData.deathDate);
  const hadCoreDataBefore = Boolean(conv.data?.idNumber && conv.data?.deathDate);
  const missingCoreFields = getMissingCoreDataFields(mergedData);

  if (classification.isVictimCase) {
    const victimClarificationReply = "¿El caso es por fallecimiento de un familiar?";
    await sendOutbound(phone, victimClarificationReply);
    onBotMessage(victimClarificationReply);
    appendConversationMessage(phone, { role: "bot", text: victimClarificationReply });
    upsertConversation(phone, {
      status: "active",
      color: "yellow",
      awaitingData: true,
      data: mergedData,
      metadata: { ...conv.metadata, senderName, aiDriven: true, victimClarificationPending: true },
    });
    console.log(`[BOT] victim clarification requested phone=${phone}`);
    return { ok: true, responseType: "victim_clarification" };
  }

  if (color === "red") {
    const redDiscardReply = await maybeGenerateStyledReply({
      conv,
      userText: text,
      responseType: "closed_red",
      instruction:
        "Caso ROJO. Responde en 1-2 frases cortas, profesionales y amables, indicando que ese tipo de caso no lo manejamos.",
      fallback: "Gracias por la información. Este tipo de caso no lo manejamos actualmente.",
    });
    await sendOutbound(phone, redDiscardReply);
    onBotMessage(redDiscardReply);
    appendConversationMessage(phone, { role: "bot", text: redDiscardReply });
    upsertConversation(phone, {
      status: "closed",
      color: "red",
      awaitingData: false,
      reminderCount: 0,
      data: mergedData,
      metadata: { ...conv.metadata, senderName, aiDriven: true, followUpAt: "", victimClarificationPending: false },
    });
    if (extracted.idNumber) incrementDailyStat(getTodayKey(), "idNumbersCollected");
    if (extracted.deathDate) incrementDailyStat(getTodayKey(), "deathDatesCollected");
    console.log(`[BOT] completed phone=${phone} responseType=closed_red`);
    return { ok: true, responseType: "closed_red" };
  }

  if (missingCoreFields.length) {
    const missingFieldsLabel = missingCoreFields
      .map((field) => (field === "idNumber" ? "cedula del fallecido" : "fecha exacta de fallecimiento"))
      .join(" y ");
    const missingCoreDataPrompt = await maybeGenerateStyledReply({
      conv,
      userText: text,
      responseType: "missing_core_data_request",
      instruction:
        `Responde en maximo 2 frases cortas y 1 pregunta. No pidas nombre. Regla previa obligatoria: antes de aplicar cualquier escenario, confirme la relacion entre quien escribe y el fallecido; si no está clara, pregunte primero por esa relacion y espere respuesta. Solo cuando la relacion quede clara, aplique esta lógica: objetivo final siempre cédula del fallecido + fecha exacta. Si quien escribe es esposa/companera/pareja, vaya directo a pedir esos datos. Si NO es pareja (hijo, hermano, padre u otro familiar), valide beneficiarios en este orden exacto, una pregunta por mensaje: 1) ¿El fallecido dejó esposa, compañera o pareja?, 2) ¿Dejó hijos menores de edad?, 3) ¿Dejó padres con vida?, 4) ¿Dejó algún dependiente con discapacidad?. Solo pida datos cuando en alguno de esos pasos la respuesta sea sí. Si todas son no, cierre con el mensaje jurídico de no beneficiarios directos. IMPORTANTE: en este turno solo faltan estos datos: ${missingFieldsLabel}. Pida unicamente esos faltantes y no vuelva a pedir datos ya entregados.`,
      fallback:
        missingCoreFields.length === 2
          ? "Para continuar, por favor envíeme la cédula del fallecido y la fecha exacta de fallecimiento (día, mes y año). Si el fallecido no era su pareja, primero debo validar beneficiarios."
          : missingCoreFields[0] === "idNumber"
          ? "Para continuar, por favor envíeme la cédula del fallecido."
          : "Para continuar, por favor envíeme la fecha exacta de fallecimiento (día, mes y año).",
    });
    await sendOutbound(phone, missingCoreDataPrompt);
    onBotMessage(missingCoreDataPrompt);
    appendConversationMessage(phone, { role: "bot", text: missingCoreDataPrompt });

    upsertConversation(phone, {
      status: color === "red" ? "closed" : "active",
      color,
      awaitingData: color !== "red",
      reminderCount: color !== "red" ? conv.reminderCount || 0 : 0,
      data: mergedData,
      metadata: {
        ...conv.metadata,
        senderName,
        aiDriven: true,
        followUpAt: color !== "red" ? dayjs().add(7, "hour").toISOString() : "",
      },
    });

    if (extracted.idNumber) incrementDailyStat(getTodayKey(), "idNumbersCollected");
    if (extracted.deathDate) incrementDailyStat(getTodayKey(), "deathDatesCollected");

    console.log(
      `[BOT] completed phone=${phone} responseType=missing_core_data_request missing=${missingCoreFields.join(",")}`
    );
    return { ok: true, responseType: "missing_core_data_request" };
  }

  if (hasCoreData) {
    console.log(`[BOT] core data received phone=${phone} hadCoreDataBefore=${hadCoreDataBefore}`);

    // Metrics required by about.md
    if (extracted.idNumber) incrementDailyStat(getTodayKey(), "idNumbersCollected");
    if (extracted.deathDate) incrementDailyStat(getTodayKey(), "deathDatesCollected");

    upsertConversation(phone, {
      // Leave chat ready for human takeover once core legal data is complete.
      status: "pending_human_takeover",
      color,
      awaitingData: false,
      reminderCount: 0,
      data: mergedData,
      metadata: {
        ...conv.metadata,
        senderName,
        aiDriven: true,
        manualClosePending: true,
        manualTakeover: true,
        manualTakeoverAt: new Date().toISOString(),
        followUpAt: "",
      },
    });

    // Persist lead once when core data is first completed.
    if (!hadCoreDataBefore) {
      console.log(`[BOT] appending lead row phone=${phone}`);
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
      console.log(`[BOT] lead row appended phone=${phone}`);
    }

    console.log(`[BOT] completed phone=${phone} responseType=core_data_received_handover_no_reply`);
    return { ok: true, responseType: "core_data_received_handover_no_reply" };
  }

  const aiReply = await maybeGenerateStyledReply({ conv, userText: text });
  console.log(`[BOT] ai reply generated phone=${phone} chars=${aiReply.length}`);
  await sendOutbound(phone, aiReply);
  onBotMessage(aiReply);
  appendConversationMessage(phone, { role: "bot", text: aiReply });

  const isGreenAutoClosed = color === "green";
  const awaitingData = !hasCoreData && color !== "red" && !isGreenAutoClosed;
  const status = isGreenAutoClosed
    ? "closed"
    : hasCoreData
    ? "pending_legal_review"
    : color === "red"
    ? "closed"
    : "active";
  console.log(
    `[BOT] state update phone=${phone} status=${status} awaitingData=${awaitingData} hasCoreData=${hasCoreData}`
  );

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
    console.log(`[BOT] appending lead row phone=${phone}`);
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
    console.log(`[BOT] lead row appended phone=${phone}`);
  }

  console.log(`[BOT] completed phone=${phone} responseType=ai_response`);
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
