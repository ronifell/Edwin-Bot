const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  if (!args.input && positional[0]) args.input = positional[0];
  if (!args.output && positional[1] && String(positional[1]).endsWith(".json")) args.output = positional[1];
  if (!args.country && positional[1] && /^\d+$/.test(String(positional[1]))) args.country = positional[1];
  if (!args.country && positional[2] && /^\d+$/.test(String(positional[2]))) args.country = positional[2];
  return args;
}

function showHelp() {
  console.log(`
Build old-customer blocklist from contacts export.

Usage:
  node scripts/buildBlocklist.js --input "<file.vcf|file.csv>" [--output old_customers_blocklist.json] [--country 57]

Examples:
  node scripts/buildBlocklist.js --input "./contacts.vcf" --country 57
  node scripts/buildBlocklist.js --input "./contacts.csv" --output "./old_customers_blocklist.json" --country 57

CSV format expected:
  Any CSV that contains phone-like values in one or more columns.
  The script scans all cells and extracts valid phone numbers.
`);
}

function normalizePhone(raw, defaultCountryCode) {
  const value = String(raw || "").trim();
  if (!value) return "";

  const hadPlus = value.startsWith("+");
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";

  if (hadPlus) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;

  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length > 10 && digits.length <= 15) return `+${digits}`;

  return "";
}

function extractPhonesFromVcf(content, defaultCountryCode) {
  const phones = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!/^TEL/i.test(line)) continue;
    const parts = line.split(":");
    const raw = parts.slice(1).join(":").trim();
    const normalized = normalizePhone(raw, defaultCountryCode);
    if (normalized) phones.push(normalized);
  }
  return phones;
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function extractPhonesFromCsv(content, defaultCountryCode) {
  const phones = [];
  const lines = content.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const cells = splitCsvLine(line);
    for (const cell of cells) {
      const normalized = normalizePhone(cell, defaultCountryCode);
      if (normalized) phones.push(normalized);
    }
  }
  return phones;
}

function buildOutput(phones, inputPath) {
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    sourceFile: path.basename(inputPath),
    totalNumbers: phones.length,
    numbers: phones,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    showHelp();
    return;
  }

  const inputPath = args.input;
  if (!inputPath) {
    console.error("Missing required --input argument.");
    showHelp();
    process.exitCode = 1;
    return;
  }

  const resolvedInput = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`Input file not found: ${resolvedInput}`);
    process.exitCode = 1;
    return;
  }

  const outputPath = args.output
    ? path.resolve(process.cwd(), args.output)
    : path.resolve(process.cwd(), "old_customers_blocklist.json");
  const defaultCountryCode = String(args.country || "57").replace(/\D/g, "") || "57";
  const ext = path.extname(resolvedInput).toLowerCase();
  const content = fs.readFileSync(resolvedInput, "utf8");

  let extracted = [];
  if (ext === ".vcf") {
    extracted = extractPhonesFromVcf(content, defaultCountryCode);
  } else if (ext === ".csv") {
    extracted = extractPhonesFromCsv(content, defaultCountryCode);
  } else {
    console.error("Unsupported input format. Use .vcf or .csv");
    process.exitCode = 1;
    return;
  }

  const uniqueSorted = [...new Set(extracted)].sort();
  const payload = buildOutput(uniqueSorted, resolvedInput);
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Blocklist generated: ${outputPath}`);
  console.log(`Unique numbers: ${uniqueSorted.length}`);
}

main();
