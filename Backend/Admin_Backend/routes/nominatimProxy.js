/**
 * Proxies OpenStreetMap Nominatim for the admin SPA so requests are not blocked
 * by browser CORS or shared-IP rate limits (429) on nominatim.openstreetmap.org.
 * @see https://operations.osmfoundation.org/policies/nominatim/
 */
const express = require("express");
const { requireAdminJwtLite } = require("../middleware/requireAdminJwtLite");

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
/** Bukidnon + northern corridor — same default as Admin_Frontend `nominatimBukidnon.ts` */
const DEFAULT_VIEWBOX = "124.35,8.55,125.65,7.45";
const USER_AGENT =
  "BukidnonBusCompany-AdminPortal/1.2 (capstone; Nominatim usage policy; contact via org admin)";

let lastUpstreamAt = 0;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 80;
/** @type {Map<string, { expires: number; payload: unknown[] }>} */
const responseCache = new Map();

function cacheGet(key) {
  const row = responseCache.get(key);
  if (!row) return null;
  if (row.expires < Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return row.payload;
}

function cacheSet(key, payload) {
  if (responseCache.size >= CACHE_MAX) {
    const first = responseCache.keys().next().value;
    if (first != null) responseCache.delete(first);
  }
  responseCache.set(key, { expires: Date.now() + CACHE_TTL_MS, payload });
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function upstreamSearch(url) {
  return fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });
}

async function throttledUpstream(url) {
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - lastUpstreamAt));
  if (wait > 0) {
    await sleep(wait);
  }
  lastUpstreamAt = Date.now();
  let res = await upstreamSearch(url);
  if (res.status === 429) {
    await sleep(2600);
    lastUpstreamAt = Date.now();
    res = await upstreamSearch(url);
  }
  return res;
}

function createNominatimProxyRouter() {
  const r = express.Router();

  r.get("/nominatim", requireAdminJwtLite, async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) {
      return res.status(400).json({ error: "Missing q" });
    }
    const boundedRaw = String(req.query.bounded ?? "1").trim();
    const bounded = boundedRaw === "0" ? "0" : "1";
    const limitNum = parseInt(String(req.query.limit || "14"), 10);
    const limit = Number.isFinite(limitNum) ? Math.min(20, Math.max(1, limitNum)) : 14;
    const viewbox = String(req.query.viewbox || "").trim() || DEFAULT_VIEWBOX;

    const cacheKey = `${bounded}|${limit}|${viewbox}|${q}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.json(cached);
    }

    const params = new URLSearchParams({
      format: "jsonv2",
      addressdetails: "1",
      limit: String(limit),
      countrycodes: "ph",
      viewbox,
      bounded,
      q,
    });
    const url = `${NOMINATIM_BASE}?${params.toString()}`;

    try {
      const upstream = await throttledUpstream(url);
      const text = await upstream.text();
      if (!upstream.ok) {
        if (upstream.status === 429) {
          return res.status(503).json({
            error: "Geocode service is rate-limited. Wait a few seconds and try again.",
          });
        }
        return res.status(502).json({ error: `Geocode upstream error (${upstream.status})` });
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        return res.status(502).json({ error: "Invalid geocode response" });
      }
      if (!Array.isArray(json)) {
        return res.status(502).json({ error: "Unexpected geocode response shape" });
      }
      cacheSet(cacheKey, json);
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.json(json);
    } catch (e) {
      return res.status(502).json({ error: e.message || "Geocode request failed" });
    }
  });

  return r;
}

module.exports = { createNominatimProxyRouter };
