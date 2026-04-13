import { fetchPublicGetJson } from "@/lib/fetchWithPublicApiBases";

export type PublicOperationsDeck = {
  operationsDeckLive: boolean;
};

export async function fetchPublicOperationsDeck(): Promise<PublicOperationsDeck> {
  const data = await fetchPublicGetJson<{ operationsDeckLive?: boolean; error?: string }>(
    "/api/public/operations-deck"
  );
  return { operationsDeckLive: data.operationsDeckLive !== false };
}
