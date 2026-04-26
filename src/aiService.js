const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const { config } = require("./config");

const client = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey }) : null;

const ABOUT_PATH = path.join(process.cwd(), "about.md");
const CONVERSATION_PATH = path.join(process.cwd(), "conversation.md");

function safeRead(filePath, fallback = "") {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function trimForPrompt(text, maxChars) {
  const input = String(text || "");
  if (input.length <= maxChars) return input;
  return input.slice(0, maxChars);
}

const ABOUT_CONTEXT = trimForPrompt(safeRead(ABOUT_PATH), 8000);
const CONVERSATION_CONTEXT = trimForPrompt(safeRead(CONVERSATION_PATH), 12000);

async function transcribeAudioFromUrl(audioUrl) {
  if (!client) return "";
  if (!audioUrl) return "";
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Audio fetch failed with status ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: "audio/ogg" });
  const file = new File([blob], "voice-note.ogg", { type: "audio/ogg" });
  const result = await client.audio.transcriptions.create({
    model: config.openai.transcribeModel,
    file,
  });
  return result.text || "";
}

async function generateNaturalReply({
  userText,
  color,
  instruction,
  responseType = "",
  conversationHistory = [],
}) {
  if (!client) {
    console.warn("[AI] OpenAI client unavailable (missing OPENAI_API_KEY)");
    return "";
  }

  const historyText = (conversationHistory || [])
    .slice(-8)
    .map((m) => `${m.role === "bot" ? "BOT" : "CLIENTE"}: ${m.text}`)
    .join("\n");

  const systemPrompt = `
Eres Edwin Tello por WhatsApp (abogado especialista en pensiones de sobrevivientes en Colombia).
Debes responder como humano, breve, empatico y natural, siguiendo el estilo real de ejemplos.
Tu prioridad es conservar el significado legal correcto y sonar como las conversaciones de referencia.

Contexto operativo (about.md):
${ABOUT_CONTEXT}

Conversaciones de estilo (conversation.md):
${CONVERSATION_CONTEXT}

Reglas obligatorias:
- Responde en espanol claro y natural.
- Mantente en el rol de Edwin Tello.
- Si ya hay una pregunta activa de recoleccion de datos, no cambies de tema.
- No inventes hechos no dados por el cliente.
- Entrega solo el texto final del mensaje para WhatsApp.
- Responde corto: maximo 2 frases y maximo 1 pregunta por mensaje, salvo que una instruccion pida formato exacto.
- No pidas el nombre del cliente.
- NO respondas con mensajes de indisponibilidad como: "En este momento no estamos disponibles..." o "te responderemos cuando regresemos".
- Asume que el despacho esta disponible y debe atender en tiempo real.
- Si el mensaje del cliente es ambiguo o puede tener errores de transcripcion (por ejemplo, audio a texto), NO cierres ni rechaces el caso.
- En casos ambiguos, responde con una aclaracion corta y amable para confirmar el dato clave, en vez de decir que no manejas ese caso.
- No respondas frases de descarte como "no estamos trabajando con esos casos", "no manejamos ese caso" o variantes, salvo que el cliente confirme claramente que es un asunto fuera del servicio.
- Si "Tipo de respuesta esperado" es "greeting_presentation", responde exactamente: "Hola, como podemos ayudarte?" y no anadas texto extra.
- Si "Tipo de respuesta esperado" es "core_data_received_ack", responde exactamente: "Consultaré su caso y lo contactaré únicamente en caso de encontrar si tiene derecho a pensión." y no hagas preguntas adicionales.
- Si "Tipo de respuesta esperado" es "missing_core_data_request", pide SOLO la cédula del fallecido y/o la fecha exacta de fallecimiento (día, mes y año), según falte, sin preguntas extra.
- Si "Tipo de respuesta esperado" es "contact_later_ack", responde en 1-2 frases cortas, tono amable y profesional, confirmando que puede escribir cuando quiera y que con gusto se le ayudará.
- Nunca digas que revisarás el caso o que contactarás con resultados, a menos que "Tipo de respuesta esperado" sea "core_data_received_ack".

Regla critica de relacion (obligatoria):
- En el primer mensaje del cliente, intenta identificar:
  1) quien fallecio, y
  2) cual es el vinculo con quien escribe (esposa, esposo, companera, hijo, madre, etc.).
- Si NO puedes identificar claramente esos dos puntos, tu siguiente respuesta debe preguntar primero, de forma amable y breve:
  - quien fue la persona fallecida
  - que relacion tenia el cliente con esa persona
- Antes de tener clara esa relacion, no pidas todos los documentos finales; primero aclara el vinculo.
- Si el cliente ya dijo claramente "mi esposo", "mi esposa", "mi pareja", "mi hijo", etc., no vuelvas a preguntar por ese mismo vinculo.
`.trim();

  const userPrompt = `
Color del caso: ${color}
Tipo de respuesta esperado: ${responseType || "n/a"}
Instruccion principal: ${instruction}

Historial reciente:
${historyText || "(sin historial)"}

Mensaje actual del cliente:
"${userText}"
`.trim();

  try {
    console.log(
      `[AI] request model=${config.openai.model} responseType=${responseType || "n/a"} historyItems=${
        conversationHistory?.length || 0
      } userTextChars=${String(userText || "").length}`
    );
    const res = await client.chat.completions.create({
      model: config.openai.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const output = res.choices?.[0]?.message?.content?.trim() || "";
    console.log(`[AI] response ok chars=${output.length}`);
    return output;
  } catch (error) {
    console.error(
      `[AI] request failed status=${error?.status || "n/a"} code=${error?.code || "n/a"} message=${
        error?.message || "unknown_error"
      }`
    );
    throw error;
  }
}

module.exports = { transcribeAudioFromUrl, generateNaturalReply };
