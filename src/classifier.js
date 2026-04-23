const GREEN_KEYWORDS = [
  "1200 semanas",
  "trabajo toda la vida",
  "trabajaba",
  "cotizaba",
  "cotizo",
  "semanas cotizadas",
  "colpensiones",
  "porvenir",
  "pension de sobrevivientes",
  "mi esposo fallecio",
  "mi papa murio",
  "mi hijo fallecio",
  "mi companero murio",
  "perdi a mi pareja",
  "dejo derecho",
  "quiero saber si tengo derecho",
  "quiero revisar si dejo pension",
];

const YELLOW_KEYWORDS = [
  "me negaron la pension",
  "no se si cotizaba",
  "no tengo los datos",
  "no tengo datos completos",
  "estaba casada con otra persona",
  "otra pareja",
  "varios hijos",
  "hace muchos anos me negaron",
  "quiero averiguar un caso",
];

const RED_KEYWORDS = [
  "docente",
  "magisterio",
  "policia",
  "militar",
  "fuerza publica",
  "ya tengo abogado",
  "ya demandaron",
  "ya demande",
  "subsidio",
  "ayuda",
  "eps",
  "incapacidad",
  "cesantias",
  "edad de pension",
  "como pensionarme",
  "quiero saber mi pension",
];

function normalize(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, " ");
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function classifyMessage(text) {
  const normalized = normalize(text);
  const isRed = includesAny(normalized, RED_KEYWORDS);
  if (isRed) {
    return { color: "red", reason: "red_keyword_match" };
  }

  const isGreen = includesAny(normalized, GREEN_KEYWORDS);
  if (isGreen) {
    return { color: "green", reason: "green_keyword_match" };
  }

  const isYellow = includesAny(normalized, YELLOW_KEYWORDS);
  if (isYellow) {
    return { color: "yellow", reason: "yellow_keyword_match" };
  }

  if (normalized.includes("victima")) {
    return { color: "yellow", reason: "victim_needs_clarification", isVictimCase: true };
  }

  return { color: "purple", reason: "unknown_or_incomplete" };
}

module.exports = { classifyMessage, normalize };
