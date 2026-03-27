import { useMemo, useState } from "react";
import type { ReportExportSectionKey } from "@/lib/reportsCsvExport";
import {
  REPORT_EXPORT_BUNDLES,
  bundlesToCsvKeys,
  bundlesToPdfKeys,
  type ReportExportBundleId,
} from "@/lib/reportExportBundles";
import "./ReportsExportModal.css";

type Format = "pdf" | "csv";

type Props = {
  open: boolean;
  onClose: () => void;
  onExportPdf: (sections: Set<string>) => void | Promise<void>;
  onExportCsv: (sections: Set<ReportExportSectionKey>) => void;
};

export function ReportsExportModal({ open, onClose, onExportPdf, onExportCsv }: Props) {
  const [format, setFormat] = useState<Format>("pdf");
  const [selectedBundles, setSelectedBundles] = useState<Set<ReportExportBundleId>>(
    () => new Set<ReportExportBundleId>(["everything"])
  );

  const csvKeys = useMemo(() => bundlesToCsvKeys(selectedBundles), [selectedBundles]);
  const pdfKeys = useMemo(() => bundlesToPdfKeys(selectedBundles), [selectedBundles]);

  function toggleBundle(id: ReportExportBundleId) {
    setSelectedBundles((prev) => {
      if (id === "everything") {
        if (prev.has("everything")) return new Set();
        return new Set<ReportExportBundleId>(["everything"]);
      }
      const n = new Set(prev);
      n.delete("everything");
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function handleExport() {
    if (selectedBundles.size === 0) return;
    if (format === "pdf") {
      if (pdfKeys.size === 0) return;
      void onExportPdf(pdfKeys);
    } else {
      onExportCsv(csvKeys);
    }
    onClose();
  }

  if (!open) return null;

  const canPdf = pdfKeys.size > 0;
  const canCsv = csvKeys.size > 0;

  return (
    <div className="reports-export-modal" role="dialog" aria-modal="true" aria-labelledby="reports-export-title">
      <button type="button" className="reports-export-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div className="reports-export-modal__card">
        <h2 id="reports-export-title" className="reports-export-modal__title">
          Export reports
        </h2>
        <p className="reports-export-modal__hint">
          Choose which hub areas to include. PDF includes summary tables; CSV adds full day / month / year trend grids where
          available. Pick <strong>Everything</strong> for the full package, or combine individual areas.
        </p>

        <div className="reports-export-modal__formats">
          <label className="reports-export-modal__radio">
            <input type="radio" name="export-fmt" checked={format === "pdf"} onChange={() => setFormat("pdf")} />
            PDF
          </label>
          <label className="reports-export-modal__radio">
            <input type="radio" name="export-fmt" checked={format === "csv"} onChange={() => setFormat("csv")} />
            CSV
          </label>
        </div>

        <ul className="reports-export-modal__list reports-export-modal__list--bundles">
          {REPORT_EXPORT_BUNDLES.map((o) => (
            <li key={o.id}>
              <label className="reports-export-modal__check reports-export-modal__check--bundle">
                <input type="checkbox" checked={selectedBundles.has(o.id)} onChange={() => toggleBundle(o.id)} />
                <span className="reports-export-modal__bundle-text">
                  <span className="reports-export-modal__bundle-label">{o.label}</span>
                  <span className="reports-export-modal__bundle-desc">{o.description}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="reports-export-modal__actions">
          <button type="button" className="reports-export-modal__btn reports-export-modal__btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="reports-export-modal__btn reports-export-modal__btn--primary"
            disabled={selectedBundles.size === 0 || (format === "pdf" ? !canPdf : !canCsv)}
            onClick={handleExport}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
