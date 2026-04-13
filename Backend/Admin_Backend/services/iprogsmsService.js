/**
 * IPROG SMS (Philippines) — https://www.iprogsms.com/api/v1/documentation
 * POST JSON: api_token, phone_number (09XXXXXXXXX), message
 *
 * Env: IPROG_API_TOKEN (required), optional IPROG_SMS_API_URL, IPROG_SMS_PROVIDER (0–2)
 * Do not commit real tokens; use Admin_Backend .env locally.
 */
const axios = require("axios");

const DEFAULT_URL = "https://www.iprogsms.com/api/v1/sms_messages";

/** Max single-SMS body length (safe for GSM 7-bit segments). */
const MAX_MESSAGE_LEN = 900;

function redactPhilippineMsisdnForLogs(text) {
  let s = String(text || "");
  s = s.replace(/09\d{9}/g, (m) => `09•••••${m.slice(-4)}`);
  s = s.replace(/\+639(\d{9})\b/g, (_, d) => `+639•••••${d.slice(-4)}`);
  return s;
}

/**
 * IPROG expects 11-digit Philippine mobile starting with 09.
 * @param {string} phone09
 */
function isValidPhilippine09(phone09) {
  return /^09\d{9}$/.test(String(phone09 || ""));
}

/**
 * Send one SMS via IPROG.
 * @param {string} phone09 - 09XXXXXXXXX
 * @param {string} message
 * @param {string} [logTag]
 * @returns {Promise<{ success: boolean, skipped?: boolean, error?: string, messageId?: string }>}
 */
async function sendIprogSms(phone09, message, logTag = "iprogsms") {
  const token = process.env.IPROG_API_TOKEN != null ? String(process.env.IPROG_API_TOKEN).trim() : "";
  if (!token) {
    return { success: false, skipped: true, error: "IPROG_API_TOKEN not configured" };
  }
  const num = String(phone09 || "").replace(/\D/g, "");
  let local09 = num;
  if (num.startsWith("63") && num.length === 12 && num[2] === "9") {
    local09 = `0${num.slice(2)}`;
  } else if (/^9\d{9}$/.test(num)) {
    local09 = `0${num}`;
  }
  if (!isValidPhilippine09(local09)) {
    return { success: false, error: "Invalid Philippine mobile for IPROG (need 09XXXXXXXXX)" };
  }

  const url = (process.env.IPROG_SMS_API_URL || DEFAULT_URL).replace(/\/+$/, "");
  const body = {
    api_token: token,
    phone_number: local09,
    message: String(message || "").trim().slice(0, MAX_MESSAGE_LEN),
  };
  if (!body.message) {
    return { success: false, error: "empty SMS message" };
  }

  const prov = Number(process.env.IPROG_SMS_PROVIDER);
  if (Number.isFinite(prov) && prov >= 0 && prov <= 2) {
    body.sms_provider = prov;
  }

  const senderRaw = process.env.IPROG_SENDER_NAME != null ? String(process.env.IPROG_SENDER_NAME).trim() : "";
  const senderNorm = senderRaw.replace(/\s+/g, "").toLowerCase();
  const isPlaceholderSender =
    !senderRaw ||
    senderNorm === "yourapprovedsendername" ||
    /yourapprovedsendername/i.test(senderRaw) ||
    /^your\s*approved\s*sender\s*name$/i.test(senderRaw.trim());
  if (senderRaw && !isPlaceholderSender) {
    body.sender_name = senderRaw;
  }

  try {
    const res = await axios.post(url, body, {
      timeout: 25000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      validateStatus: () => true,
    });

    const data = res.data && typeof res.data === "object" ? res.data : {};
    const st = data.status;
    // IPROG usually returns numeric 200; some proxies stringify JSON numbers.
    const ok =
      st == 200 ||
      st == 201 ||
      st === "success" ||
      (res.status >= 200 &&
        res.status < 300 &&
        data.message_id != null &&
        String(data.message_id).trim().length > 0);

    if (ok) {
      return {
        success: true,
        messageId: data.message_id != null ? String(data.message_id) : undefined,
      };
    }

    const msg =
      (typeof data.message === "string" && data.message.trim()) ||
      `IPROG error (HTTP ${res.status})`;
    console.error(`[iprogsmsService] ${logTag} failed`, {
      httpStatus: res.status,
      apiStatus: st,
      message: redactPhilippineMsisdnForLogs(msg),
    });
    return { success: false, error: msg };
  } catch (e) {
    const errMsg = e.response?.data?.message || e.message || String(e);
    console.error(`[iprogsmsService] ${logTag} request error`, redactPhilippineMsisdnForLogs(errMsg));
    return { success: false, error: errMsg };
  }
}

function isIprogSmsConfigured() {
  return Boolean(process.env.IPROG_API_TOKEN && String(process.env.IPROG_API_TOKEN).trim());
}

module.exports = {
  sendIprogSms,
  isIprogSmsConfigured,
  isValidPhilippine09,
  redactPhilippineMsisdnForLogs,
};
