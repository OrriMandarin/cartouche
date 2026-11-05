import { describe, expect, test } from "vitest";
import { errorFields } from "./error-fields";

describe("errorFields", () => {
  test("EDI-027 each refused path names its field, its section and the element to reach", () => {
    expect(
      errorFields(["theme", "content.email", "links[1].url", "slug", "avatar_media_id", "links[0].label"]),
    ).toEqual([
      { path: "slug", section: "identity", targetId: "slug-input", label: { key: "cards.slug.label" } },
      { path: "content.email", section: "contact", targetId: "editor-email", label: { key: "editor.content.email" } },
      {
        path: "links[0].label",
        section: "links",
        targetId: "link-label-0",
        label: { key: "editor.errorFields.linkLabel", values: { index: 1 } },
      },
      {
        path: "links[1].url",
        section: "links",
        targetId: "link-url-1",
        label: { key: "editor.errorFields.linkUrl", values: { index: 2 } },
      },
      {
        path: "avatar_media_id",
        section: "media",
        targetId: "field-error-avatar-media-id",
        label: { key: "editor.media.avatar" },
      },
      { path: "theme", section: "theme", targetId: "field-error-theme", label: { key: "editor.sections.theme" } },
    ]);
  });

  test("EDI-027 a path the editor does not know still links to its message, last of the identity section", () => {
    expect(errorFields(["content.first_name", "settings", "something"])).toEqual([
      {
        path: "content.first_name",
        section: "identity",
        targetId: "editor-first_name",
        label: { key: "editor.content.first_name" },
      },
      { path: "something", section: "identity", targetId: "field-error-something", label: { key: "editor.errorFields.other" } },
      {
        path: "settings",
        section: "template",
        targetId: "field-error-settings",
        label: { key: "editor.sections.settings" },
      },
    ]);
  });
});
