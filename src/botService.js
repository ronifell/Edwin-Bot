const { generateNaturalReply, transcribeAudioFromUrl } = require("./aiService");
const { sendMessage } = require("./zapiService");
const { appendConversationMessage, getConversation, upsertConversation } = require("./storage");
const { config } = require("./config");

function extractInbound(payload) {
  const message = payload?.text?.message || payload?.message || payload?.body || "";
  const phone = payload?.phone || payload?.from || payload?.chatLid || payload?.sender || "";
  const senderName = payload?.senderName || payload?.pushName || "";
  const isAudio = Boolean(payload?.audio?.audioUrl || payload?.audio?.url || payload?.isAudio);
  const audioUrl = payload?.audio?.audioUrl || payload?.audio?.url || payload?.fileUrl || "";
  return { message, phone, senderName, isAudio, audioUrl };
}

async function maybeGenerateStyledReply({
  conv,
  userText
}) {
  if (!config.openai.apiKey) {
    return "Gracias por escribirnos. En este momento no tengo IA activa. Por favor configure OPENAI_API_KEY para responder con el estilo entrenado.";
  }
  try {
    const aiReply = await generateNaturalReply({
      userText,
      color: "ai",
      instruction:
        "Responde 100% en base a los estilos y lineamientos de about.md y conversation.md. No uses respuestas roboticas.",
      responseType: "ai_response",
      conversationHistory: conv?.messages || [],
    });
    return aiReply || "Gracias por escribirnos. ¿Me puede contar su caso para ayudarle?";
  } catch (error) {
    console.error("AI reply generation failed:", error.message);
    return "Gracias por escribirnos. En este momento tuve un problema temporal para responder. Puede reenviar su mensaje, por favor?";
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

  const aiReply = await maybeGenerateStyledReply({ conv, userText: text });
  await sendOutbound(phone, aiReply);
  onBotMessage(aiReply);
  appendConversationMessage(phone, { role: "bot", text: aiReply });
  upsertConversation(phone, {
    status: "active",
    metadata: { ...conv.metadata, senderName, aiDriven: true },
  });
  return { ok: true, responseType: "ai_response" };
}

async function runFollowUpCycle() {}

async function sendDailySummary() {
  if (!config.adminReportNumber) return;
  await sendMessage(config.adminReportNumber, "Resumen diario: modo AI puro activo.");
}

function startSchedulers() {}

module.exports = { handleInbound, startSchedulers, sendDailySummary, runFollowUpCycle };
