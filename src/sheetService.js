async function appendLeadRow({ name = "", phone = "", idNumber = "", deathDate = "", color = "", observations = "" }) {
  const { insertLeadRecord } = require("./leadRepository");
  await insertLeadRecord({ name, phone, idNumber, deathDate, color, observations });
}

module.exports = { appendLeadRow };
