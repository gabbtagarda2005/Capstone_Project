import { useMemo, useState } from "react";
import type { ReportExportSectionKey } from "@/lib/reportsCsvExport";
import {
  REPORT_EXPORT_BUNDLES,
  bundlesToCsvKeys,
  bundlesToPdfKeys,
  type ReportExportBundleId,
} from "@/lib/reportExportBundles";
import "./ReportsExportModal.css";

type Format = "pdf" | "csv" | "xlsx";

type Props = {
  open: boolean;
  onClose: () => void;
  onExportPdf: (sections: Set<string>) => void | Promise<void>;
  onExportCsv: (sections: Set<ReportExportSectionKey>) => void;
  onExportXlsx: (sections: Set<ReportExportSectionKey>) => void;
};

const DEFAULT_BUNDLES = new Set<ReportExportBundleId>([
  "passenger",
  "attendants",
  "bus",
  "route",
  "insights",
  "timeWindowPickups",
  "revenue",
]);

export function ReportsExportModal({ open, onClose, onExportPdf, onExportCsv, onExportXlsx }: Props) {
  const [format, setFormat] = useState<Format>("pdf");
  const [selectedBundles, setSelectedBundles] = useState<Set<ReportExportBundleId>>(() => new Set(DEFAULT_BUNDLES));

  const csvKeys = useMemo(() => bundlesToCsvKeys(selectedBundles), [selectedBundles]);
  const pdfKeys = useMemo(() => bundlesToPdfKeys(selectedBundles), [selectedBundles]);

  function toggleBundle(id: ReportExportBundleId) {
    setSelectedBundles((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      if (n.size === 0) n.add("passenger");
      return n;
    });
  }

  function handleExport() {
    if (selectedBundles.size === 0) return;
    if (format === "pdf") {
      if (pdfKeys.size === 0) return;
      void onExportPdf(pdfKeys);
    } else if (format === "csv") {
      onExportCsv(csvKeys);
    } else {
      onExportXlsx(csvKeys);
    }
    onClose();
  }

  if (!open) return null;

  const canPdf = pdfKeys.size > 0;
  const canGrid = csvKeys.size > 0;

  return (
    <div className="reports-export-modal" role="dialog" aria-modal="true" aria-labelledby="reports-export-title">
      <button type="button" className="reports-export-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div className="reports-export-modal__card">
        <h2 id="reports-export-title" className="reports-export-modal__title">
          Export reports
        </h2>
        <p className="reports-export-modal__hint">Choose report areas, then PDF, CSV, or Excel.</p>

        <div className="reports-export-modal__formats">
          <label className="reports-export-modal__radio">
            <input type="radio" name="export-fmt" checked={format === "pdf"} onChange={() => setFormat("pdf")} />
            PDF
          </label>
          <label className="reports-export-modal__radio">
            <input type="radio" name="export-fmt" checked={format === "csv"} onChange={() => setFormat("csv")} />
            CSV
          </label>
          <label className="reports-export-modal__radio">
            <input type="radio" name="export-fmt" checked={format === "xlsx"} onChange={() => setFormat("xlsx")} />
            Excel
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
            disabled={selectedBundles.size === 0 || (format === "pdf" ? !canPdf : !canGrid)}
            onClick={handleExport}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
