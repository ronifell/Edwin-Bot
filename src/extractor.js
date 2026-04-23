const { normalize } = require("./classifier");

const idRegex = /(?:cc|cedula|c\.c\.|c c|id)?\s*[:#-]?\s*(\d[\d\.\s]{5,14}\d)/i;
const dateRegex =
  /(\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b|\b\d{1,2}\s+de\s+[a-zA-Z]+\s+de?\s*\d{2,4}\b|\b\d{1,2}\s+[a-zA-Z]+\s+\d{2,4}\b)/i;

function normalizeId(raw) {
  return String(raw || "").replace(/[^\d]/g, "");
}

function extractStructuredData(text) {
  const normalizedText = normalize(text);
  const idMatch = text.match(idRegex);
  const dateMatch = text.match(dateRegex);

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
    idNumber: idMatch ? normalizeId(idMatch[1]) : "",
    deathDate: dateMatch ? dateMatch[1] : "",
    claimant,
    hasAllRequired: Boolean(idMatch && dateMatch),
  };
}

module.exports = { extractStructuredData };
