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
  "mi papa murio",
  "mi hijo fallecio",
  "hijos menores",
  "perdi a mi pareja",
  "dejo derecho",
  "quiero consultar",
  "como hago para la pension",
  "quiero revisar si dejo pension"
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
  "me negaron la pencion",
  "me negaron pension",
  "me la negaron",
  "no me dieron informacion",
  "vecinos no dieron informacion",
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
    normalized.includes("nina") ||
    normalized.includes("nino") ||
    normalized.includes("padre") ||
    normalized.includes("madre") ||
    normalized.includes("familiar");
  const hasWorkSignal =
    normalized.includes("trabajo") ||
    normalized.includes("trabajaba") ||
    normalized.includes("cotizo") ||
    normalized.includes("cotizaba") ||
    normalized.includes("empresa") ||
    normalized.includes("colpensiones") ||
    normalized.includes("comerciante");
  const selfRetirementSignal =
    !hasDeathSignal &&
    !hasRelationSignal &&
    (normalized.includes("yo ") || normalized.startsWith("yo")) &&
    (normalized.includes("cotice") ||
      normalized.includes("cotize") ||
      normalized.includes("semanas") ||
      normalized.includes("edad") ||
      normalized.includes("mi pension"));
  if (selfRetirementSignal) {
    return { color: "purple", reason: "self_retirement_help", intent: "self_retirement_help" };
  }
  const hasEligibilityIntent =
    normalized.includes("beneficiari") ||
    normalized.includes("tengo derecho") ||
    normalized.includes("quiero saber") ||
    normalized.includes("asesoria");
  const hasGeneralPensionInfoIntent =
    (normalized.includes("informacion general") || normalized.includes("informacion")) &&
    (normalized.includes("pension") || normalized.includes("pensiones"));
  const continuationSignals = [
    "ok cuando llegue",
    "cuando llegue",
    "apenas la tenga",
    "numero de cedula",
    "solo sobrevivientes",
    "puede pelear",
    "le envio",
    "le mando",
  ];
  if (continuationSignals.some((token) => normalized.includes(token))) {
    return { color: "green", reason: "continuation_signal" };
  }

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

  if (hasDeathSignal && hasWorkSignal) {
    return { color: "green", reason: "death_with_work_signal" };
  }

  // Death context without enough legal details should ask 2-3 clarifying questions.
  if (hasDeathSignal && !hasRelationSignal && !hasWorkSignal) {
    return { color: "yellow", reason: "death_context_needs_clarification" };
  }

  const isGreen = includesAny(normalized, GREEN_KEYWORDS);
  if (isGreen) {
    return { color: "green", reason: "green_keyword_match" };
  }

  if (hasDeathSignal && hasRelationSignal) {
    if (hasWorkSignal || normalized.includes("menor")) {
      return { color: "green", reason: "death_with_relation_and_strengtheners" };
    }
    return { color: "purple", reason: "death_with_relation_needs_context" };
  }

  if (hasEligibilityIntent) {
    return { color: "green", reason: "eligibility_intent_without_clear_context" };
  }

  if (hasGeneralPensionInfoIntent) {
    return { color: "green", reason: "general_pension_info_intent" };
  }

  return { color: "purple", reason: "unknown_or_incomplete" };
}

module.exports = { classifyMessage, normalize };
