const fs = require("fs");
const path = require("path");
const { handleInbound } = require("../src/botService");
const { resetStore } = require("../src/storage");

const SOURCE_FILE = path.join(process.cwd(), "conversation.md");
const REPORT_DIR = path.join(process.cwd(), "reports");
const REPORT_MD = path.join(REPORT_DIR, "conversation-md-full-report.md");
const REPORT_JSON = path.join(REPORT_DIR, "conversation-md-full-report.json");

function cleanLine(line) {
  return line
    .replace(/^L\d+:/, "")
    .replace(/^[-*•\s]+/, "")
    .trim();
}

function normalizeText(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseConversations(content) {
  const lines = content.split(/\r?\n/).map(cleanLine);
  const blocks = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    const startMatch =
      line.match(/^(\d+)\.\s*Conversaci[oó]n/i) ||
      line.match(/^🔹\s*CONVERSACI[OÓ]N\s*(\d+)/i) ||
      line.match(/^CONVERSACI[OÓ]N\s*(\d+)/i);

    if (startMatch) {
      if (current) blocks.push(current);
      current = { id: Number(startMatch[1]), lines: [], client: [], botReference: [] };
      continue;
    }
    if (!current) continue;
    if (!line) continue;

    current.lines.push(line);
    if (/^Cliente\s*:?/i.test(line)) {
      const text = line.replace(/^Cliente\s*:?\s*/i, "").trim();
      if (text) current.client.push(text);
      continue;
    }
    if (/^Tu\s*:?/i.test(line) || /^Tú\s*:?/i.test(line) || /^Sistema\s*:?/i.test(line)) {
      const text = line.replace(/^(Tu|Tú|Sistema)\s*:?\s*/i, "").trim();
      if (text) current.botReference.push(text);
      continue;
    }

    // Handle multiline style where role appears in previous line.
    const prev = current.lines[current.lines.length - 2] || "";
    if (/^Cliente\s*:?\s*$/i.test(prev) && line) current.client.push(line);
    if (/^(Tu|Tú|Sistema)\s*:?\s*$/i.test(prev) && line) current.botReference.push(line);
  }

  if (current) blocks.push(current);
  return blocks.sort((a, b) => a.id - b.id);
}

function expectedFromReference(block) {
  const reference = normalizeText(block.botReference.join(" "));
  if (reference.includes("no manejamos")) {
    return "closed_red";
  }
  if (reference.includes("por que se la negaron") || reference.includes("quien fallecio")) {
    return "yellow_questions";
  }
  if (
    (reference.includes("cedula") && reference.includes("fecha")) ||
    (reference.includes("envie") && reference.includes("cedula"))
  ) {
    return "green_request_data";
  }
  if (reference.includes("me encuentro bien")) {
    return "greeting";
  }
  if (reference.includes("documentos necesito")) {
    return "docs_info";
  }
  return "purple_clarification";
}

function buildInput(block) {
  if (!block.client.length) return "";
  return block.client
    .filter((line) => !line.toLowerCase().includes("(audio)") && !line.toLowerCase().includes("nota de voz"))
    .join(" ")
    .trim();
}

function responseMatches(expectedType, actualType) {
  if (expectedType === actualType) return true;
  // Keep compatibility strict to avoid false "pass" results.
  const compatible = {
    // If client already sent id+date in same block, collecting data is valid.
    green_request_data: ["data_collected"],
    // Reference examples are noisy; yellow and purple can overlap only between them.
    yellow_questions: ["purple_clarification"],
    purple_clarification: ["yellow_questions"],
  };
  return (compatible[expectedType] || []).includes(actualType);
}

async function evaluateBlock(block) {
  const input = buildInput(block);
  if (!input) {
    return {
      id: block.id,
      status: "skipped",
      reason: "no_client_text",
      expectedType: expectedFromReference(block),
      actualType: null,
      input,
      botReply: "",
    };
  }

  resetStore();
  const replies = [];
  const result = await handleInbound(
    { message: input, phone: `57${String(block.id).padStart(10, "0")}`, senderName: "SimUser" },
    {
      sendMessage: async () => {},
      onBotMessage: (text) => replies.push(text),
    }
  );

  const expectedType = expectedFromReference(block);
  const actualType = result.responseType || "unknown";
  const pass = responseMatches(expectedType, actualType);

  return {
    id: block.id,
    status: pass ? "pass" : "fail",
    expectedType,
    actualType,
    input,
    botReply: replies.join(" | "),
  };
}

function ensureReportDir() {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function writeReports(results) {
  ensureReportDir();
  fs.writeFileSync(REPORT_JSON, JSON.stringify(results, null, 2), "utf8");

  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  const lines = [];
  lines.push("# conversation.md full simulation report");
  lines.push("");
  lines.push(`- Total blocks: ${total}`);
  lines.push(`- Pass: ${passed}`);
  lines.push(`- Fail: ${failed}`);
  lines.push(`- Skipped: ${skipped}`);
  lines.push("");
  lines.push("| # | Status | Expected | Actual |");
  lines.push("|---|---|---|---|");
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.status} | ${r.expectedType || "-"} | ${r.actualType || "-"} |`);
  }
  lines.push("");
  lines.push("## Details");
  lines.push("");
  for (const r of results) {
    lines.push(`### Conversation ${r.id} - ${r.status.toUpperCase()}`);
    lines.push(`- Expected: \`${r.expectedType || "-"}\``);
    lines.push(`- Actual: \`${r.actualType || "-"}\``);
    lines.push(`- Input: ${r.input || "(none)"}`);
    lines.push(`- Bot reply: ${r.botReply || "(none)"}`);
    lines.push("");
  }

  fs.writeFileSync(REPORT_MD, lines.join("\n"), "utf8");
}

async function main() {
  const content = fs.readFileSync(SOURCE_FILE, "utf8");
  const blocks = parseConversations(content);
  const results = [];
  for (const block of blocks) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await evaluateBlock(block));
  }

  writeReports(results);

  const failed = results.filter((r) => r.status === "fail").length;
  const passed = results.filter((r) => r.status === "pass").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  console.log(`conversation.md full simulation: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`report: ${REPORT_MD}`);
  console.log(`json: ${REPORT_JSON}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
