/**
 * Outbound SMS via IPROG (ticket confirmations + SOS).
 * Env: IPROG_API_TOKEN (required). Optional: IPROG_SMS_API_URL, IPROG_SMS_PROVIDER, IPROG_SENDER_NAME
 *
 * Philippine numbers: accept 09…, +639…, 639…; IPROG receives 09XXXXXXXXX.
 */
const { sendIprogSms, isIprogSmsConfigured, redactPhilippineMsisdnForLogs } = require("./iprogsmsService");

function redactPhilippineMsisdnForLogsCompat(text) {
  return redactPhilippineMsisdnForLogs(text);
}

/**
 * Philippine mobile → E.164 +639XXXXXXXXX (validation / dedupe). IPROG send uses 09 form internally.
 */
function normalizePhilippineMobileE164(raw) {
  if (raw == null) return null;
  let cleaned = String(raw).replace(/\D/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("00")) cleaned = cleaned.slice(2);

  let national;
  if (cleaned.startsWith("0") && cleaned.length === 11 && cleaned[1] === "9") {
    national = cleaned.slice(1);
  } else if (cleaned.startsWith("63") && cleaned.length === 12 && cleaned[2] === "9") {
    national = cleaned.slice(2);
  } else if (/^9\d{9}$/.test(cleaned)) {
    national = cleaned;
  } else {
    return null;
  }

  if (!/^9\d{9}$/.test(national)) return null;
  return `+63${national}`;
}

const formatPhilippineMobileToE164 = normalizePhilippineMobileE164;

function isPhilippineMobileE164(to) {
  return /^\+639\d{9}$/.test(String(to || ""));
}

function e164ToLocal09(e164) {
  const s = String(e164 || "");
  const m = s.match(/^\+63(9\d{9})$/);
  return m ? `0${m[1]}` : null;
}

function isSmsConfigured() {
  return isIprogSmsConfigured();
}

/**
 * @param {string} toE164 - +639…
 * @param {{ ticketId: string, origin: string, destination: string, fare: number|string, category: string }} ticketDetails
 */
async function sendTicketSMS(toE164, ticketDetails) {
  if (!isSmsConfigured()) {
    return { success: false, skipped: true, error: "IPROG_API_TOKEN not configured" };
  }
  if (!isPhilippineMobileE164(toE164)) {
    return { success: false, error: "Invalid Philippine mobile (expected +639XXXXXXXXX after normalization)" };
  }
  const phone09 = e164ToLocal09(toE164);
  if (!phone09) {
    return { success: false, error: "Could not format number for IPROG" };
  }

  const ticketId = String(ticketDetails.ticketId || "").trim() || "—";
  const origin = String(ticketDetails.origin || "").trim() || "—";
  const destination = String(ticketDetails.destination || "").trim() || "—";
  const fareN = Number(ticketDetails.fare);
  const fareStr = Number.isFinite(fareN) ? fareN.toFixed(2) : String(ticketDetails.fare ?? "—");
  const category = String(ticketDetails.category || "regular").trim() || "regular";

  const message =
    `Bukidnon Transit: Ticket: ${ticketId}\n` +
    `From: ${origin}\n` +
    `To: ${destination}\n` +
    `Fare: PHP ${fareStr}\n` +
    `Type: ${category}\n` +
    `Safe travels!`;

  return sendIprogSms(phone09, message, "sendTicketSMS");
}

/**
 * Generic outbound SMS (e.g. SOS to admin mobile from portal settings).
 * @param {string} toE164
 * @param {string} bodyText
 */
async function sendRawSms(toE164, bodyText) {
  if (!isSmsConfigured()) {
    return { success: false, skipped: true, error: "IPROG_API_TOKEN not configured" };
  }
  if (!isPhilippineMobileE164(toE164)) {
    return { success: false, error: "Invalid Philippine mobile (expected +639XXXXXXXXX after normalization)" };
  }
  const phone09 = e164ToLocal09(toE164);
  if (!phone09) {
    return { success: false, error: "Could not format number for IPROG" };
  }
  const body = String(bodyText || "").trim().slice(0, 1500);
  if (!body) {
    return { success: false, error: "empty SMS body" };
  }
  const branded =
    body.startsWith("Bukidnon Transit:") || body.startsWith("SOS ALERT")
      ? body
      : `Bukidnon Transit: ${body}`;
  return sendIprogSms(phone09, branded.slice(0, 900), "sendRawSms");
}

module.exports = {
  sendTicketSMS,
  sendRawSms,
  normalizePhilippineMobileE164,
  formatPhilippineMobileToE164,
  isSmsConfigured,
  redactPhilippineMsisdnForLogs: redactPhilippineMsisdnForLogsCompat,
};
