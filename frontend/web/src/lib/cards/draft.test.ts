import { ApiError } from "@cartouche/api-client";
import { describe, expect, test } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import type { MediaView } from "@/templates/contract";
import type { CardView } from "./types";
import {
  PREVIEW_EVENT_ID,
  applyTemplateChange,
  draftFromCard,
  draftToPublicCard,
  draftToUpdateBody,
  fieldErrors,
  isDirty,
  publicBaseUrlOf,
} from "./draft";

const avatar: MediaView = {
  id: "0198a1a0-0000-7000-8000-000000000002",
  kind: "image",
  images: [{ width: 256, url: "https://media.example.test/a/s256.webp" }],
  jpeg_url: "https://media.example.test/a/s256.jpg",
};

const fullCard = cardView({
  id: "0198c8a0-0000-7000-8000-000000000001",
  slug: "eloise-daubigne",
  public_url: "http://localhost:13000/c/eloise-daubigne",
  template: "classique",
  settings: { links_layout: "icons" } as unknown as CardView["settings"],
  theme: { preset: "sable", accent: "#9a5b2e" },
  content: {
    first_name: "Éloïse",
    last_name: "D'Aubigné-Müller",
    job_title: "Cheffe de projet ✨",
    company: null,
    description: null,
    email: "eloise@example.com",
    phone: "+33612345678",
    phone_display: "+33 6 12 34 56 78",
  },
  links: [
    { kind: "website", url: "https://eloise.example", label: null },
    { kind: "custom", url: "https://podcast.example", label: "Mon podcast ✨" },
  ],
  avatar,
});

describe("draftToUpdateBody", () => {
  test("EDI-006 draft round trip: the stored card goes back unchanged, empty strings become null", () => {
    const body = draftToUpdateBody(draftFromCard(fullCard));
    expect(body).toEqual({
      slug: "eloise-daubigne",
      template: "classique",
      settings: { links_layout: "icons" },
      theme: { preset: "sable", accent: "#9a5b2e" },
      content: {
        first_name: "Éloïse",
        last_name: "D'Aubigné-Müller",
        job_title: "Cheffe de projet ✨",
        company: null,
        description: null,
        email: "eloise@example.com",
        phone: "+33612345678",
      },
      links: [
        { kind: "website", url: "https://eloise.example", label: null },
        { kind: "custom", url: "https://podcast.example", label: "Mon podcast ✨" },
      ],
      header_media_id: null,
      avatar_media_id: avatar.id,
    });
  });

  test("EDI-006 a field cleared by the user is sent as null", () => {
    const draft = draftFromCard(fullCard);
    draft.content.job_title = "";
    draft.links[1]!.label = "";
    const body = draftToUpdateBody(draft);
    expect(body.content?.job_title).toBeNull();
    expect(body.links[1]!.label).toBeNull();
  });
});

describe("draftToPublicCard", () => {
  test("TPL-014 EDI-004 preview card mirrors the draft", () => {
    const draft = draftFromCard(fullCard);
    draft.content.job_title = "Directrice";
    draft.slug = "eloise-d";
    const card = draftToPublicCard(draft, "http://localhost:13000");
    expect(card.slug).toBe("eloise-d");
    expect(card.public_url).toBe("http://localhost:13000/c/eloise-d");
    expect(card.vcard_url).toBe("/api/public/cards/eloise-d/vcard");
    expect(card.template).toBe("classique");
    expect(card.theme).toEqual({ preset: "sable", accent: "#9a5b2e" });
    expect(card.settings).toEqual({ links_layout: "icons" });
    expect(card.content).toMatchObject({
      first_name: "Éloïse",
      job_title: "Directrice",
      company: null,
      email: "eloise@example.com",
      phone: "+33612345678",
    });
    expect(card.links).toEqual(fullCard.links);
    expect(card.avatar).toEqual(avatar);
    expect(card.header).toBeNull();
  });

  test("TPL-014 an empty field reads as absent, like on the public page", () => {
    const draft = draftFromCard(cardView({ content: {} }));
    draft.content.first_name = "Alice";
    const card = draftToPublicCard(draft, "http://localhost:13000");
    expect(card.content.first_name).toBe("Alice");
    expect(card.content.job_title).toBeNull();
    expect(card.content.phone).toBeNull();
  });

  test("EDI-017 the preview event id cannot clash with a real event", () => {
    expect(PREVIEW_EVENT_ID).toBe("preview");
  });
});

describe("publicBaseUrlOf", () => {
  test("LNK-029 strips the card path from the public url", () => {
    expect(publicBaseUrlOf(fullCard)).toBe("http://localhost:13000");
    expect(publicBaseUrlOf(cardView({ slug: "a-b", public_url: "https://x.test/prefix/c/a-b" }))).toBe(
      "https://x.test/prefix",
    );
  });
});

describe("isDirty", () => {
  test("EDI-016 equal drafts are clean, any edit is dirty", () => {
    const saved = draftFromCard(fullCard);
    expect(isDirty(saved, draftFromCard(fullCard))).toBe(false);
    const edited = draftFromCard(fullCard);
    edited.content.company = "Atelier";
    expect(isDirty(saved, edited)).toBe(true);
  });

  test("EDI-016 typing then erasing the text leaves the draft clean", () => {
    const saved = draftFromCard(fullCard);
    const edited = draftFromCard(fullCard);
    edited.content.company = "A";
    edited.content.company = "";
    expect(isDirty(saved, edited)).toBe(false);
  });

  test("EDI-016 reverting a setting leaves the draft clean", () => {
    const saved = draftFromCard(cardView({ settings: {} }));
    const edited = draftFromCard(cardView({ settings: {} }));
    // The editor stores every setting once one is touched: links_layout toggled and set back to its default.
    edited.settings = { links_layout: "list", animate_events: true };
    expect(isDirty(saved, edited)).toBe(false);
    edited.settings = { links_layout: "icons", animate_events: true };
    expect(isDirty(saved, edited)).toBe(true);
  });

  test("EDI-016 a stored setting changed to the default counts, an equal one does not", () => {
    const saved = draftFromCard(fullCard);
    const same = draftFromCard(fullCard);
    same.settings = { links_layout: "icons", animate_events: true };
    expect(isDirty(saved, same)).toBe(false);
    same.settings = { links_layout: "list" };
    expect(isDirty(saved, same)).toBe(true);
  });

  test("EDI-016 an unset theme override is the same as an absent one", () => {
    const saved = draftFromCard(cardView({ theme: { preset: "clair" } }));
    const edited = draftFromCard(cardView({ theme: { preset: "clair", accent: null } }));
    expect(isDirty(saved, edited)).toBe(false);
    edited.links = [{ kind: "website", url: "https://a.example", label: "" }];
    expect(isDirty(saved, edited)).toBe(true);
  });
});

describe("applyTemplateChange", () => {
  test("TPL-005 another template starts from its own default settings", () => {
    const draft = draftFromCard(fullCard);
    const next = applyTemplateChange(draft, "other");
    expect(next.template).toBe("other");
    expect(next.settings).toEqual({});
    expect(next.content).toEqual(draft.content);
    expect(next.theme).toEqual(draft.theme);
    expect(draft.settings).toEqual({ links_layout: "icons" });
  });
});

describe("fieldErrors", () => {
  function validationError(fields: { field: string; code: string }[]) {
    return new ApiError({ status: 400, code: "validation_failed", message: "x", requestId: "r", fields });
  }

  test("EDI-015 field errors map to paths", () => {
    const errors = fieldErrors(
      validationError([
        { field: "links[0].url", code: "invalid_url" },
        { field: "content.email", code: "invalid_email" },
        { field: "avatar_media_id", code: "invalid_media" },
      ]),
    );
    expect(errors).toEqual({
      "links[0].url": "fieldErrors.invalid_url",
      "content.email": "fieldErrors.invalid_email",
      avatar_media_id: "fieldErrors.invalid_media",
    });
  });

  test("EDI-015 LNK-022 a taken or reserved slug is an error of the slug field", () => {
    for (const code of ["slug_taken", "slug_reserved"]) {
      const error = new ApiError({ status: 409, code, message: "x", requestId: "r" });
      expect(fieldErrors(error)).toEqual({ slug: `fieldErrors.${code}` });
    }
  });

  test("EDI-015 other failures have no field", () => {
    expect(fieldErrors(new ApiError({ status: 500, code: "internal_error", message: "x", requestId: null }))).toEqual({});
    expect(fieldErrors(new Error("network"))).toEqual({});
    expect(fieldErrors(null)).toEqual({});
  });

  test("EDI-015 the first error of a field wins", () => {
    expect(
      fieldErrors(validationError([{ field: "slug", code: "invalid_slug" }, { field: "slug", code: "too_long" }])),
    ).toEqual({ slug: "fieldErrors.invalid_slug" });
  });
});
