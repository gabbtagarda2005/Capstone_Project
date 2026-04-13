import { fetchPublicGetJson } from "@/lib/fetchWithPublicApiBases";

export type CommandFeedCategory =
  | "Weather alert"
  | "Traffic & delays"
  | "Terminal notice"
  | "Passenger demand"
  | "Operations";

export type PublicCommandFeedItem = {
  id: string;
  category: string;
  title: string;
  body: string;
  publishedAt: string;
};

/**
 * Admin_Backend GET /api/public/command-feed (via Passenger API proxy when configured).
 */
export async function fetchPublicCommandFeed(): Promise<PublicCommandFeedItem[]> {
  try {
    const d = await fetchPublicGetJson<{ items?: unknown }>("/api/public/command-feed");
    const raw = d.items;
    if (!Array.isArray(raw)) return [];
    const out: PublicCommandFeedItem[] = [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      const category = typeof o.category === "string" ? o.category.trim() : "";
      const title = typeof o.title === "string" ? o.title.trim() : "";
      const body = typeof o.body === "string" ? o.body.trim() : "";
      const publishedAt = typeof o.publishedAt === "string" ? o.publishedAt.trim() : "";
      if (!id || !title || !publishedAt) continue;
      out.push({
        id,
        category: category || "Terminal notice",
        title,
        body: body || "",
        publishedAt,
      });
    }
    return out;
  } catch {
    return [];
  }
}
