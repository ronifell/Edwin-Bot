const OpenAI = require("openai");
const { config } = require("./config");

const client = new OpenAI({ apiKey: config.openai.apiKey });

async function transcribeAudioFromUrl(audioUrl) {
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

async function generateNaturalReply({ userText, color, instruction }) {
  const prompt = `
Eres asistente legal por WhatsApp en Colombia, con tono humano, empatico y profesional.
Debes responder en espanol natural, corto y claro.
Color del caso: ${color}.
Instruccion principal: ${instruction}
Texto del usuario: "${userText}"

Responde solo con el mensaje listo para WhatsApp. Nada mas.
`.trim();

  const res = await client.chat.completions.create({
    model: config.openai.model,
    temperature: 0.8,
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices?.[0]?.message?.content?.trim() || "";
}

module.exports = { transcribeAudioFromUrl, generateNaturalReply };
