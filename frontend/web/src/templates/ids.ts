// No React import: the e2e package imports this file to run its suite on every template (TPL-003).
export const TEMPLATE_IDS = ["classique"] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];
