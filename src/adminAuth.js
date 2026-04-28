const crypto = require("crypto");

function verifyAdminPassword(input, expectedPlaintext) {
  const a = String(input ?? "").trim();
  const e = String(expectedPlaintext ?? "").trim();
  if (!e || !a) return false;
  const hi = crypto.createHash("sha256").update(a, "utf8").digest();
  const he = crypto.createHash("sha256").update(e, "utf8").digest();
  try {
    return crypto.timingSafeEqual(hi, he);
  } catch {
    return false;
  }
}

module.exports = { verifyAdminPassword };
