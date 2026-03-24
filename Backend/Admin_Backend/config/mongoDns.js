/**
 * MongoDB Atlas uses mongodb+srv:// which needs DNS SRV lookups.
 * On some Windows networks the default resolver returns querySrv ECONNREFUSED.
 * Using public DNS for this Node process often fixes it.
 *
 * Set ATLAS_USE_PUBLIC_DNS=0 in .env to skip (use corporate DNS only).
 */
function applyPublicDnsForMongo() {
  if (process.env.ATLAS_USE_PUBLIC_DNS === "0") return;
  const dns = require("dns");
  dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
}

module.exports = { applyPublicDnsForMongo };
