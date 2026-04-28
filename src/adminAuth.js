const crypto = require("crypto");

function verifyAdminPassword(input, expectedHashPlaintext) {
  if (!expectedHashPlaintext) return false;
  const hi = crypto.createHash("sha256").update(String(input), "utf8").digest();
  const he = crypto.createHash("sha256").update(String(expectedHashPlaintext), "utf8").digest();
  return crypto.timingSafeEqual(hi, he);
}

module.exports = { verifyAdminPassword };
