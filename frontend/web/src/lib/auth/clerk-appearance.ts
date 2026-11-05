import type { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";

type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

const FONT = "'Inter Variable', Inter, system-ui, sans-serif";

/**
 * The look of the Clerk widgets, on the dashboard tokens (design handoff 6.1). Clerk draws in its own DOM, so
 * the values are literal colors rather than `--app-*` variables.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: "#1C1B19",
    colorPrimaryForeground: "#FFFFFF",
    colorForeground: "#1C1B19",
    colorMutedForeground: "#5C5850",
    colorBackground: "#FFFFFF",
    colorInput: "#FFFFFF",
    colorInputForeground: "#1C1B19",
    colorBorder: "#8C877E",
    colorNeutral: "#1C1B19",
    colorRing: "#1C1B19",
    colorShadow: "#1C1B19",
    colorDanger: "#B3261E",
    colorSuccess: "#1D6B43",
    colorWarning: "#8A4500",
    colorModalBackdrop: "rgb(28 27 25 / .5)",
    borderRadius: "0.625rem",
    fontFamily: FONT,
    fontFamilyButtons: FONT,
    fontSize: "0.9375rem",
    fontWeight: { normal: 400, medium: 500, semibold: 600, bold: 700 },
  },
  // Touch targets of at least 44 px (accessibility).
  elements: {
    formFieldInput: { minHeight: "44px" },
    formButtonPrimary: { minHeight: "44px" },
    socialButtonsBlockButton: { minHeight: "44px" },
  },
} satisfies Appearance;
