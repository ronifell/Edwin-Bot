const GREEN_KEYWORDS = [
  "1200 semanas",
  "trabajo toda la vida",
  "trabajaba",
  "cotizaba",
  "cotizo",
  "estaba cotizando",
  "tenia semanas",
  "creo que tenia semanas",
  "semanas cotizadas",
  "colpensiones",
  "porvenir",
  "pension de sobrevivientes",
  "indemnizacion",
  "mi esposo fallecio",
  "mi papa murio",
  "mi hijo fallecio",
  "mi familiar fallecio",
  "mi pareja fallecio",
  "mi companero murio",
  "mi companero fallecio",
  "companero fallecio",
  "hijos menores",
  "perdi a mi pareja",
  "dejo derecho",
  "quiero consultar",
  "quiero saber si soy beneficiario",
  "como hago para la pension",
  "quiero saber si tengo derecho",
  "quiero revisar si dejo pension",
  "murio hace",
];

const YELLOW_KEYWORDS = [
  "me negaron la pension",
  "no se si cotizaba",
  "no tengo los datos",
  "no tengo datos completos",
  "no se que hacer",
  "estaba casada con otra persona",
  "otra pareja",
  "varios hijos",
  "quiero averiguar",
  "hace muchos anos me negaron",
  "quiero averiguar un caso",
];

const RED_KEYWORDS = [
  "docente",
  "docentes",
  "magisterio",
  "policia",
  "policias",
  "militar",
  "militares",
  "fuerza publica",
  "ya tengo abogado",
  "contrate abogado",
  "ya demandaron",
  "ya demande",
  "ya presentaron demanda",
  "desplazado",
  "desplazada",
  "victima sin fallecimiento",
  "subsidio",
  "subsidios",
  "salud",
  "eps",
  "incapacidad",
  "incapacidades",
  "cesantias",
  "edad de pension",
  "como pensionarme",
  "quiero saber mi pension",
];

function normalize(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, words) {
  return words.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`);
    return pattern.test(text);
  });
}

function classifyMessage(text) {
  const normalized = normalize(text);
  const hasDeathSignal =
    normalized.includes("fallecio") ||
    normalized.includes("fallecida") ||
    normalized.includes("fallecido") ||
    normalized.includes("murio") ||
    normalized.includes("muerto") ||
    normalized.includes("muerta") ||
    normalized.includes("perdi") ||
    normalized.includes("perdio") ||
    normalized.includes("mataron") ||
    normalized.includes("asesinaron") ||
    normalized.includes("muerte");
  const hasRelationSignal =
    normalized.includes("esposo") ||
    normalized.includes("esposa") ||
    normalized.includes("companero") ||
    normalized.includes("pareja") ||
    normalized.includes("hijo") ||
    normalized.includes("hija") ||
    normalized.includes("padre") ||
    normalized.includes("madre") ||
    normalized.includes("familiar");

  if (normalized.includes("victima")) {
    if (normalized.includes("sin fallecimiento")) {
      return { color: "red", reason: "victim_without_death_context" };
    }
    return { color: "yellow", reason: "victim_needs_clarification", isVictimCase: true };
  }

  // Fast intent for non-case informational questions.
  if (normalized.includes("que documentos necesito")) {
    return { color: "purple", reason: "docs_question", intent: "docs" };
  }
  if (normalized.includes("como funciona la pension")) {
    return { color: "purple", reason: "how_it_works", intent: "how_it_works" };
  }

  const isRed = includesAny(normalized, RED_KEYWORDS);
  if (isRed) {
    return { color: "red", reason: "red_keyword_match" };
  }

  const isYellow = includesAny(normalized, YELLOW_KEYWORDS);
  if (isYellow) {
    return { color: "yellow", reason: "yellow_keyword_match" };
  }

  // Death context without enough legal details should ask 2-3 clarifying questions.
  if (hasDeathSignal && !hasRelationSignal) {
    return { color: "yellow", reason: "death_context_needs_clarification" };
  }

  const isGreen = includesAny(normalized, GREEN_KEYWORDS);
  if (isGreen) {
    return { color: "green", reason: "green_keyword_match" };
  }

  // If death + relation is mentioned but still low detail, prioritize intake quickly.
  if (hasDeathSignal && hasRelationSignal) {
    return { color: "green", reason: "death_with_relationship_signal" };
  }

  return { color: "purple", reason: "unknown_or_incomplete" };
}

module.exports = { classifyMessage, normalize };
