import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { AddRouteForm } from "@/components/AddRouteForm";
import { CorridorRouteGlassCard } from "@/components/CorridorRouteGlassCard";
import { ViewDetailsModal, ViewDetailsDl, ViewDetailsRow } from "@/components/ViewDetailsModal";
import {
  createCorridorRoute,
  deleteCorridorRoute,
  fetchCorridorBuilderContext,
  fetchCorridorRoutes,
} from "@/lib/api";
import type { CorridorRouteRow } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

function routeInitials(originLabel: string, destLabel: string): string {
  const a = firstSegChar(originLabel);
  const b = firstSegChar(destLabel);
  return `${a}${b}`.toUpperCase();
}

function firstSegChar(label: string): string {
  const seg = label.split(",")[0]?.trim() || label.trim();
  return seg[0] ?? "?";
}

export function RouteManagementPanel() {
  const { user } = useAuth();
  const isSuper = user?.role === "Admin" && user?.adminTier === "super";
  const { showError, showSuccess, showInfo } = useToast();
  const [terminals, setTerminals] = useState<Awaited<ReturnType<typeof fetchCorridorBuilderContext>>["terminals"]>(
    []
  );
  const [routes, setRoutes] = useState<CorridorRouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewRoute, setViewRoute] = useState<CorridorRouteRow | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ctx, list] = await Promise.all([fetchCorridorBuilderContext(), fetchCorridorRoutes()]);
      setTerminals(ctx.terminals);
      setRoutes(list.items);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to load corridor data");
      setTerminals([]);
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSave(
    payload: Parameters<NonNullable<ComponentProps<typeof AddRouteForm>["onSave"]>>[0]
  ) {
    setSaving(true);
    try {
      await createCorridorRoute(payload);
      showSuccess("Corridor route saved.");
      await refresh();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not save route");
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteCorridorRoute(id);
      showSuccess("Route removed.");
      setViewRoute((v) => (v && v._id === id ? null : v));
      await refresh();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  const vr = viewRoute;

  if (loading) {
    return <p className="mgmt-mod__unknown">Loading corridor builder…</p>;
  }

  return (
    <div className="route-mgmt-panel">
      <AddRouteForm terminals={terminals} saving={saving} onSave={handleSave} />

      {routes.length === 0 ? null : (
        <section className="route-mgmt-panel__cards-section">
          <div className="mgmt-att-panel__cards route-mgmt-panel__cards">
            {routes.map((r) => (
              <CorridorRouteGlassCard
                key={r._id}
                route={r}
                initials={routeInitials(r.originLabel, r.destLabel)}
                busy={deletingId === r._id}
                canDelete={isSuper}
                onView={() => setViewRoute(r)}
                onEdit={() =>
                  showInfo(
                    "To change start, destination, or via locations, remove this corridor and create a new one."
                  )
                }
                onDelete={() => {
                  if (!window.confirm("Remove this corridor from the network?")) return;
                  void handleDelete(r._id);
                }}
              />
            ))}
          </div>
        </section>
      )}

      <ViewDetailsModal open={Boolean(vr)} title={vr ? vr.displayName || "Corridor route" : ""} onClose={() => setViewRoute(null)}>
        {vr ? (
          <ViewDetailsDl>
            <ViewDetailsRow label="Display name" value={vr.displayName || "—"} />
            <ViewDetailsRow label="Origin" value={vr.originLabel} />
            <ViewDetailsRow label="Destination" value={vr.destLabel} />
            <ViewDetailsRow
              label="Via"
              value={vr.viaLabels && vr.viaLabels.length > 0 ? vr.viaLabels.join(" · ") : "—"}
            />
            <ViewDetailsRow label="Status" value="Active" />
          </ViewDetailsDl>
        ) : null}
      </ViewDetailsModal>
    </div>
  );
}
