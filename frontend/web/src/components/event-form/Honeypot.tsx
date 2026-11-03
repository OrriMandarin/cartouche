import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";

// Off-screen rather than `display: none`, which some robots skip (ABU-005).
const OFF_SCREEN: CSSProperties = {
  position: "absolute",
  left: "-10000px",
  top: "auto",
  width: "1px",
  height: "1px",
  overflow: "hidden",
};

interface HoneypotProps {
  value: string;
  onChange(value: string): void;
}

/** The trap field (ABU-002, ABU-005): a person never sees it, never reaches it with the keyboard nor hears it. */
export function Honeypot({ value, onChange }: HoneypotProps) {
  const t = useTranslations("eventForm");
  return (
    <div aria-hidden="true" style={OFF_SCREEN}>
      <label htmlFor="lead-fax">{t("honeypot")}</label>
      <input
        id="lead-fax"
        type="text"
        name="fax"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
