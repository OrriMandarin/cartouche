import { fieldErrorId } from "@/lib/field-errors";
import { CONTENT_FIELDS, type ContentField } from "./draft";
import { EDITOR_SECTIONS, type EditorSection } from "./section-summary";

const CONTACT_FIELDS: readonly ContentField[] = ["email", "phone"];

export interface ErrorField {
  /** The refused path, as the server names it (`content.email`, `links[0].url`…). */
  path: string;
  /** The section of the editor that holds the field. */
  section: EditorSection;
  /** Id of the element the error summary links to: the input when there is one, its message otherwise. */
  targetId: string;
  /** How the summary names the field. */
  label: { key: string; values?: Record<string, number> };
}

const LINK_FIELD = /^links\[(\d+)\]\.(url|label|kind)$/;

const LINK_LABEL_KEYS = {
  kind: "editor.errorFields.linkKind",
  label: "editor.errorFields.linkLabel",
  url: "editor.errorFields.linkUrl",
} as const;

function describe(path: string): Omit<ErrorField, "path"> {
  const messageId = fieldErrorId(path);
  if (path === "slug") return { section: "identity", targetId: "slug-input", label: { key: "cards.slug.label" } };
  if (path.startsWith("content.")) {
    const field = path.slice("content.".length) as ContentField;
    if (CONTENT_FIELDS.includes(field)) {
      return {
        section: CONTACT_FIELDS.includes(field) ? "contact" : "identity",
        targetId: `editor-${field}`,
        label: { key: `editor.content.${field}` },
      };
    }
  }
  const link = LINK_FIELD.exec(path);
  if (link) {
    const [, index, part] = link;
    return {
      section: "links",
      targetId: `link-${part}-${index}`,
      label: {
        key: LINK_LABEL_KEYS[part as keyof typeof LINK_LABEL_KEYS],
        values: { index: Number(index) + 1 },
      },
    };
  }
  if (path === "links" || path.startsWith("links[")) {
    return { section: "links", targetId: messageId, label: { key: "editor.sections.links" } };
  }
  if (path === "header_media_id") return { section: "media", targetId: messageId, label: { key: "editor.media.header" } };
  if (path === "avatar_media_id") return { section: "media", targetId: messageId, label: { key: "editor.media.avatar" } };
  if (path === "template") return { section: "template", targetId: messageId, label: { key: "editor.sections.template" } };
  if (path === "settings") return { section: "template", targetId: messageId, label: { key: "editor.sections.settings" } };
  if (path === "theme") return { section: "theme", targetId: messageId, label: { key: "editor.sections.theme" } };
  return { section: "identity", targetId: messageId, label: { key: "editor.errorFields.other" } };
}

const LINK_PARTS = ["kind", "label", "url"];
const LAST = Number.MAX_SAFE_INTEGER;

/**
 * Order of a path inside its section, as the form shows them: the slug first, the content fields in their
 * order, the links by index then field; anything else last.
 */
function rank(path: string): number {
  if (path === "slug") return -1;
  if (path.startsWith("content.")) {
    const content = CONTENT_FIELDS.indexOf(path.slice("content.".length) as ContentField);
    return content >= 0 ? content : LAST;
  }
  const link = LINK_FIELD.exec(path);
  if (link) return Number(link[1]) * LINK_PARTS.length + LINK_PARTS.indexOf(link[2]!);
  return LAST;
}

/**
 * spec: EDI-027, EDI-015. The refused fields of a save, in the order of the form, each with its section and
 * the element the error summary links to.
 */
export function errorFields(paths: readonly string[]): ErrorField[] {
  return paths
    .map((path) => ({ path, ...describe(path) }))
    .sort(
      (a, b) =>
        EDITOR_SECTIONS.indexOf(a.section) - EDITOR_SECTIONS.indexOf(b.section) || rank(a.path) - rank(b.path),
    );
}
