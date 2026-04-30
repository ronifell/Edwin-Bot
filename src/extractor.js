const { normalize } = require("./classifier");

const dateRegex =
  /(\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b|\b\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b|\b\d{1,2}\s+de\s+[a-zA-Z]+\s+(?:de\s+)?\d{2,4}\b|\b\d{1,2}\s+[a-zA-Z]+\s+\d{2,4}\b)/i;

function normalizeId(raw) {
  return String(raw || "").replace(/[^\d]/g, "");
}

function extractIdNumber(text) {
  const labeledIdRegex =
    /\b(?:cc|cedula|c\.c\.|c c|id)\b\s*[:#-]?\s*(\d[\d\.\s]{4,20}\d)\b/i;
  const labeledMatch = text.match(labeledIdRegex);
  if (labeledMatch) {
    const normalized = normalizeId(labeledMatch[1]);
    if (normalized.length >= 5 && normalized.length <= 15) return normalized;
  }

  const plainCandidates = text.match(/\b\d{5,15}\b/g) || [];
  for (const candidate of plainCandidates) {
    return candidate;
  }

  const groupedCandidates = text.match(/\b\d{1,3}(?:[.,\s]\d{3})+\b/g) || [];
  for (const candidate of groupedCandidates) {
    const normalized = normalizeId(candidate);
    if (normalized.length >= 5 && normalized.length <= 15) return normalized;
  }
  return "";
}

function extractDeceasedName(text) {
  const explicitNameMatch = text.match(
    /\b(?:nombre(?:\s+completo)?(?:\s+del\s+fallecido)?)\s*[:\-]?\s*([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ\s]{4,})$/i
  );
  if (explicitNameMatch) return explicitNameMatch[1].trim();

  const calledMatch = text.match(
    /\b(?:mi\s+(?:esposo|esposa|companero|compañero|pareja|hijo|hija|padre|madre)\s+)?se\s+llama\s+([a-zA-ZÀ-ÿ]+(?:\s+[a-zA-ZÀ-ÿ]+){0,4})/i
  );
  if (calledMatch) return calledMatch[1].trim();

  return "";
}

function extractWorkInfo(normalizedText) {
  const workSignals = [
    "trabajo",
    "trabajaba",
    "cotizo",
    "cotizaba",
    "empresa",
    "colpensiones",
    "porvenir",
    "comerciante",
    "historia laboral",
  ];
  return workSignals.some((token) => normalizedText.includes(token))
    ? "reportado_por_cliente"
    : "";
}

function extractStructuredData(text) {
  const normalizedText = normalize(text);
  const idNumber = extractIdNumber(text);
  const dateMatch = text.match(dateRegex);
  const deceasedName = extractDeceasedName(text);
  const workInfo = extractWorkInfo(normalizedText);

  let claimant = "";
  const claimantPatterns = [
    { key: "esposa", value: "esposa" },
    { key: "companera", value: "companera" },
    { key: "pareja", value: "pareja" },
    { key: "hijo", value: "hijo/hija" },
    { key: "hija", value: "hijo/hija" },
    { key: "madre", value: "madre" },
    { key: "padre", value: "padre" },
  ];

  for (const item of claimantPatterns) {
    if (normalizedText.includes(item.key)) {
      claimant = item.value;
      break;
    }
  }

  return {
    idNumber,
    deathDate: dateMatch ? dateMatch[1] : "",
    deceasedName,
    workInfo,
    claimant,
    hasAllRequired: Boolean(idNumber && dateMatch && (deceasedName || workInfo)),
  };
}

module.exports = { extractStructuredData };
