import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type PassengerSpaSection = "eta" | "planner" | "support" | "station";

type PassengerDashboardSpaStateValue = {
  activeSection: PassengerSpaSection;
  setActiveSection: (section: PassengerSpaSection) => void;
  sheetCollapsed: boolean;
  collapseSheet: () => void;
  expandSheet: () => void;
  toggleSheet: () => void;
};

const PassengerDashboardSpaStateContext = createContext<PassengerDashboardSpaStateValue | null>(null);

export function PassengerDashboardSpaStateProvider({
  children,
  initialSection = "planner",
  initialCollapsed = false,
}: {
  children: ReactNode;
  initialSection?: PassengerSpaSection;
  initialCollapsed?: boolean;
}) {
  const [activeSection, setActiveSection] = useState<PassengerSpaSection>(initialSection);
  const [sheetCollapsed, setSheetCollapsed] = useState<boolean>(initialCollapsed);

  const value = useMemo<PassengerDashboardSpaStateValue>(
    () => ({
      activeSection,
      setActiveSection,
      sheetCollapsed,
      collapseSheet: () => setSheetCollapsed(true),
      expandSheet: () => setSheetCollapsed(false),
      toggleSheet: () => setSheetCollapsed((v) => !v),
    }),
    [activeSection, sheetCollapsed]
  );

  return (
    <PassengerDashboardSpaStateContext.Provider value={value}>
      {children}
    </PassengerDashboardSpaStateContext.Provider>
  );
}

export function usePassengerDashboardSpaState() {
  const ctx = useContext(PassengerDashboardSpaStateContext);
  if (!ctx) {
    throw new Error("usePassengerDashboardSpaState must be used within PassengerDashboardSpaStateProvider");
  }
  return ctx;
}
