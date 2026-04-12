import { useCallback, useEffect, useState } from "react";
import { downloadDailyOpsSnapshotFile, fetchDailyOpsSnapshotList } from "@/lib/api";
import type { DailyOpsSnapshotFileDto } from "@/lib/types";
import { useToast } from "@/context/ToastContext";
import "./ReportsSnapshotsArchive.css";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ReportsSnapshotsArchive() {
  const { showError } = useToast();
  const [items, setItems] = useState<DailyOpsSnapshotFileDto[]>([]);
  const [configured, setConfigured] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setBanner(null);
    try {
      const r = await fetchDailyOpsSnapshotList();
      setItems(r.items ?? []);
      setConfigured(r.configured !== false);
      if (r.configured === false && r.message) setBanner(r.message);
    } catch (e) {
      setItems([]);
      showError(e instanceof Error ? e.message : "Could not load snapshot archive");
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDownload(name: string) {
    setDownloading(name);
    try {
      await downloadDailyOpsSnapshotFile(name);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  }

  if (loading) {
    return (
      <section className="reports-archive" aria-label="Report snapshots archive">
        <p className="reports-archive__empty">Loading snapshot archive…</p>
      </section>
    );
  }

  return (
    <section className="reports-archive" aria-label="Report snapshots archive">
      <div className="reports-archive__head">
        <h2>Daily ops archive</h2>
        <p className="reports-archive__tagline">
          Files the server saves when the automated daily ops job runs. Use this list to download a past JSON/PDF copy. If nothing is
          configured on the server, the list stays empty.
        </p>
      </div>

      {banner ? <p className="reports-page__banner">{banner}</p> : null}

      {!configured ? null : items.length === 0 ? (
        <p className="reports-archive__empty">No files yet.</p>
      ) : (
        <div className="reports-archive__table-wrap">
          <table className="reports-archive__table">
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Modified</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.name}>
                  <td className="reports-archive__mono">{row.name}</td>
                  <td>{formatBytes(row.size)}</td>
                  <td className="reports-archive__mono">{row.modifiedAt.replace("T", " ").slice(0, 19)}</td>
                  <td>
                    <button
                      type="button"
                      className="reports-archive__btn"
                      disabled={downloading === row.name}
                      onClick={() => void onDownload(row.name)}
                    >
                      {downloading === row.name ? "…" : "Download"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {configured && items.length > 0 ? (
        <p style={{ marginTop: "0.75rem", fontSize: "0.72rem", color: "rgba(148,163,184,0.85)" }}>
          <button type="button" className="reports-archive__btn" onClick={() => void load()}>
            Refresh list
          </button>
        </p>
      ) : null}
    </section>
  );
}
