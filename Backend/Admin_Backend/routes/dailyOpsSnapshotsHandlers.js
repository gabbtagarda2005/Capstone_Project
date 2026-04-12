const path = require("path");
const { createReadStream } = require("fs");
const fs = require("fs").promises;
const { getConfiguredSnapshotDir } = require("../services/dailyOperationsReportCron");

/** Allowed snapshot basenames (no path segments). */
const DAILY_OPS_SNAPSHOT_NAME_RE =
  /^(\d{4}-\d{2}-\d{2})_[A-Za-z0-9_-]+\.(json|pdf)$|^daily-ops-\d{4}-\d{2}-\d{2}\.json$/;

async function listDailyOpsSnapshots(_req, res) {
  try {
    const dir = getConfiguredSnapshotDir();
    if (!dir) {
      return res.json({
        items: [],
        configured: false,
        message: "Daily ops snapshots are not enabled on this server (no snapshot folder configured).",
      });
    }
    const names = await fs.readdir(dir);
    const items = [];
    for (const name of names) {
      if (!DAILY_OPS_SNAPSHOT_NAME_RE.test(name)) continue;
      const fp = path.join(dir, name);
      try {
        const st = await fs.stat(fp);
        if (!st.isFile()) continue;
        items.push({ name, size: st.size, modifiedAt: st.mtime.toISOString() });
      } catch (_) {
        /* skip */
      }
    }
    items.sort((a, b) => (a.name < b.name ? 1 : -1));
    res.json({ items, configured: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "list snapshots failed" });
  }
}

async function downloadDailyOpsSnapshot(req, res) {
  try {
    const f = String(req.query.f || "").trim();
    if (!f || f.includes("/") || f.includes("..") || !DAILY_OPS_SNAPSHOT_NAME_RE.test(f)) {
      return res.status(400).json({ error: "Invalid file name" });
    }
    const dir = getConfiguredSnapshotDir();
    if (!dir) return res.status(503).json({ error: "Snapshots not configured" });
    const resolvedDir = path.resolve(dir);
    const fp = path.resolve(path.join(resolvedDir, path.basename(f)));
    if (!fp.startsWith(resolvedDir + path.sep)) {
      return res.status(400).json({ error: "Invalid path" });
    }
    const st = await fs.stat(fp);
    if (!st.isFile()) return res.status(404).json({ error: "Not found" });
    const ext = path.extname(f).toLowerCase();
    const ct = ext === ".pdf" ? "application/pdf" : "application/json";
    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(f)}"`);
    const stream = createReadStream(fp);
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).json({ error: "read failed" });
    });
    stream.pipe(res);
  } catch (e) {
    if (e.code === "ENOENT") return res.status(404).json({ error: "Not found" });
    res.status(500).json({ error: e.message || "download failed" });
  }
}

module.exports = {
  DAILY_OPS_SNAPSHOT_NAME_RE,
  listDailyOpsSnapshots,
  downloadDailyOpsSnapshot,
};
