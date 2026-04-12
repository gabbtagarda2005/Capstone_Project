import type { ReactNode } from "react";
import { CommandCenterSubNav, type CommandCenterSubNavPage } from "@/components/CommandCenterSubNav";

type Props = {
  page: CommandCenterSubNavPage;
  children: ReactNode;
};

/** Top row: back + section links; divider; then title + body below. */
export function CommandCenterSubPageShell({ page, children }: Props) {
  return (
    <div className="command-center__sub-layout command-center__sub-layout--stacked">
      <div className="command-center__sub-topbar">
        <CommandCenterSubNav page={page} />
      </div>
      <div className="command-center__sub-divider" aria-hidden />
      <div className="command-center__sub-main">{children}</div>
    </div>
  );
}
