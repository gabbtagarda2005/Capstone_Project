/**
 * Build SQL WHERE fragments for tickets table alias `t` from querystring (matches admin-portal filters).
 * Returns { clause: string, params: any[] } where clause is like " AND ... AND ..." (no leading WHERE).
 */

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function rangeFromPreset(q) {
  const preset = q.preset || "all";
  if (preset === "all") return { start: null, end: null };

  if (preset === "day" && q.day) {
    const d = new Date(`${q.day}T12:00:00`);
    if (Number.isNaN(d.getTime())) return { start: null, end: null };
    return { start: startOfDay(d), end: endOfDay(d) };
  }

  if (preset === "month" && q.month) {
    const [y, m] = String(q.month).split("-").map(Number);
    if (!y || !m) return { start: null, end: null };
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0, 23, 59, 59, 999);
    return { start, end };
  }

  if (preset === "year" && q.year) {
    const y = Number(q.year);
    if (!y) return { start: null, end: null };
    return {
      start: new Date(y, 0, 1),
      end: new Date(y, 11, 31, 23, 59, 59, 999),
    };
  }

  return { start: null, end: null };
}

function rangeFromManual(q) {
  if (!q.from && !q.to) return { start: null, end: null };
  const start = q.from ? startOfDay(new Date(`${q.from}T12:00:00`)) : null;
  const end = q.to ? endOfDay(new Date(`${q.to}T12:00:00`)) : null;
  return { start, end };
}

function buildTicketFilters(query) {
  const parts = [];
  const params = [];

  const pid = typeof query.passengerId === "string" ? query.passengerId.trim() : "";
  if (pid) {
    parts.push("t.passenger_id LIKE ?");
    params.push(`%${pid}%`);
  }

  const hasManual = Boolean(query.from || query.to);
  const { start, end } = hasManual ? rangeFromManual(query) : rangeFromPreset(query);

  if (start) {
    parts.push("t.created_at >= ?");
    params.push(start);
  }
  if (end) {
    parts.push("t.created_at <= ?");
    params.push(end);
  }

  const clause = parts.length ? ` AND ${parts.join(" AND ")}` : "";
  return { clause, params };
}

module.exports = { buildTicketFilters };
