import type { ReactNode } from "react";
import { themeToCssVars } from "@/lib/theme/css-vars";
import type { ResolvedTheme } from "@/lib/theme/resolve";
import "./public-page.css";

/**
 * The page around a card: full screen on mobile, a 28rem card centred from 40rem (PUB-037). The theme
 * variables sit on this wrapper, never on `html` or `body` (TPL-026).
 */
export function CardStage({ theme, children }: { theme: ResolvedTheme; children: ReactNode }) {
  return (
    <div className="cc-page" style={themeToCssVars(theme)}>
      <div className="cc-stage">{children}</div>
    </div>
  );
}
