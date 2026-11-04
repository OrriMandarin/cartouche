import type { components } from "@cartouche/api-client";

type Schemas = components["schemas"];

/** An event as its owner sees it. */
export type EventView = Schemas["EventView"];
export type EventInput = Schemas["EventInput"];
export type EventPhase = Schemas["EventPhase"];
export type StandardFields = Schemas["StandardFields"];
export type CustomField = Schemas["CustomField"];
export type CustomFieldKind = Schemas["CustomFieldKind"];
export type FieldMode = Schemas["FieldMode"];

/** A contact collected by an event, as its owner sees it. */
export type LeadView = Schemas["LeadView"];

/** A custom answer as recorded with a contact: the label and the kind the field had when it was sent (FRM-022). */
export type AnswerSnapshot = Schemas["AnswerSnapshot"];
