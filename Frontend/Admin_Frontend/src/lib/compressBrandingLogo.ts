/** ~80k chars ≈ ~60KB base64 payload — above this we re-encode to JPEG to avoid 413 / proxy limits. */
const COMPRESS_IF_LONGER_THAN = 80_000;
const MAX_SVG_DATA_URL_CHARS = 1_400_000;

/**
 * Decode a raster data URL, scale to fit maxEdge, export JPEG (smaller than PNG for photos).
 */
export function compressRasterDataUrlToJpeg(dataUrl: string, maxEdge: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          resolve(dataUrl);
          return;
        }
        const scale = Math.min(1, maxEdge / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        if (dataUrl.includes("image/png") || dataUrl.includes("image/webp")) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, cw, ch);
        }
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => reject(new Error("Could not decode image for resizing."));
    img.src = dataUrl;
  });
}

/**
 * Shrinks pasted / uploaded raster logos before PUT /api/admin/settings (avoids 413 and browser storage limits).
 */
export async function normalizeBrandingLogoForSave(raw: string | null): Promise<string | null> {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (!t.startsWith("data:image/")) return t;
  if (t.startsWith("data:image/svg+xml")) {
    if (t.length > MAX_SVG_DATA_URL_CHARS) {
      throw new Error(
        "SVG logo is too large to save. Use a simpler SVG, export as PNG, or host the image at an https:// URL.",
      );
    }
    return t;
  }
  if (t.length <= COMPRESS_IF_LONGER_THAN) return t;
  return compressRasterDataUrlToJpeg(t, 512, 0.86);
}
