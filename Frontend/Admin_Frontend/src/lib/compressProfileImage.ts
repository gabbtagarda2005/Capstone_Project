/** Target longest edge — keeps data URL small for Mongo (same idea as branding logo). */
const MAX_EDGE_PX = 384;

/** Server allows 400k chars; stay under for safety. */
export const MAX_PROFILE_IMAGE_DATA_URL_CHARS = 390_000;

type DecodedSource = {
  width: number;
  height: number;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  dispose?: () => void;
};

async function decodeViaImageElement(file: File): Promise<DecodedSource> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image. Try JPG or PNG."));
    };
    i.src = url;
  });
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    draw(ctx, w, h) {
      ctx.drawImage(img, 0, 0, w, h);
    },
    dispose() {
      URL.revokeObjectURL(url);
    },
  };
}

async function decodeImageFile(file: File): Promise<DecodedSource> {
  try {
    const opts: ImageBitmapOptions = { imageOrientation: "from-image" };
    const bitmap = await createImageBitmap(file, opts);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw(ctx, w, h) {
        ctx.drawImage(bitmap, 0, 0, w, h);
      },
      dispose() {
        bitmap.close();
      },
    };
  } catch {
    return decodeViaImageElement(file);
  }
}

/**
 * Resize + JPEG data URL — same pattern as Settings sidebar logo (no Firebase).
 * Sent as `profileImageUrl` on save-attendant; backend stores up to 400k chars.
 */
export async function profileImageFileToDataUrl(file: File): Promise<string> {
  const source = await decodeImageFile(file);
  try {
    let w = source.width;
    let h = source.height;
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not prepare image.");

    source.draw(ctx, w, h);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    if (!dataUrl.startsWith("data:image/jpeg") || dataUrl.length < 64) {
      throw new Error("Could not compress image.");
    }
    return dataUrl;
  } finally {
    source.dispose?.();
  }
}
