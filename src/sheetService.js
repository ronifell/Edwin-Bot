const { google } = require("googleapis");
const { config } = require("./config");

function getSheetsClient() {
  if (!config.googleSheets.enabled) return null;
  if (!config.googleSheets.sheetId || !config.googleSheets.clientEmail || !config.googleSheets.privateKey) {
    return null;
  }
  const auth = new google.auth.JWT({
    email: config.googleSheets.clientEmail,
    key: config.googleSheets.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function appendLeadRow({ name = "", phone = "", idNumber = "", deathDate = "", color = "", observations = "" }) {
  const sheets = getSheetsClient();
  if (!sheets) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSheets.sheetId,
    range: "A:F",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[name, phone, idNumber, deathDate, color, observations]],
    },
  });
}

module.exports = { appendLeadRow };
