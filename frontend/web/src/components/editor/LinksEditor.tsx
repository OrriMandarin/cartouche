"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_LINKS, type DraftLink } from "@/lib/cards/draft";
import { LINK_KINDS, type LinkKind } from "@/templates/contract";
import { describedBy, FieldMessage } from "./Field";
import { OptionSelect } from "./OptionSelect";

/** spec: PUB-012, PUB-022. The links of the card, in the order the owner chooses. */
export function LinksEditor({
  value,
  onChange,
  errors,
}: {
  value: DraftLink[];
  /** `fixed` lists the field paths this change corrects, so their messages can go. */
  onChange: (links: DraftLink[], fixed: string[]) => void;
  /** Translated messages by field path. */
  errors: Record<string, string>;
}) {
  const t = useTranslations("editor.links");
  const tKinds = useTranslations("publicCard.links");
  const linkPaths = Object.keys(errors).filter((path) => path.startsWith("links"));

  function edit(index: number, patch: Partial<DraftLink>) {
    const fixed = Object.keys(patch).map((key) => `links[${index}].${key}`);
    onChange(value.map((link, i) => (i === index ? { ...link, ...patch } : link)), fixed);
  }

  function move(index: number, by: -1 | 1) {
    const next = [...value];
    const [link] = next.splice(index, 1);
    next.splice(index + by, 0, link!);
    onChange(next, linkPaths);
  }

  return (
    <div className="space-y-4">
      {value.length === 0 ? <p className="text-muted-foreground text-sm">{t("empty")}</p> : null}
      <FieldMessage path="links" message={errors.links} />
      <ul className="space-y-4">
        {value.map((link, index) => {
          const urlPath = `links[${index}].url`;
          const labelPath = `links[${index}].label`;
          const n = index + 1;
          return (
            <li
              key={index}
              data-testid={`link-row-${index}`}
              className="bg-card space-y-3 rounded-lg border p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{t("item", { index: n })}</p>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-testid={`link-up-${index}`}
                    aria-label={t("moveUp", { index: n })}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-testid={`link-down-${index}`}
                    aria-label={t("moveDown", { index: n })}
                    disabled={index === value.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-testid={`link-remove-${index}`}
                    aria-label={t("remove", { index: n })}
                    onClick={() => onChange(value.filter((_, i) => i !== index), linkPaths)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                <div className="space-y-2">
                  <Label htmlFor={`link-kind-${index}`}>{t("kind")}</Label>
                  <OptionSelect
                    id={`link-kind-${index}`}
                    testId={`link-kind-${index}`}
                    value={link.kind}
                    options={LINK_KINDS.map((kind) => ({ value: kind, label: tKinds(kind) }))}
                    onValueChange={(kind) => edit(index, { kind: kind as LinkKind })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`link-url-${index}`}>{t("url")}</Label>
                  <Input
                    id={`link-url-${index}`}
                    data-testid={`link-url-${index}`}
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="https://"
                    value={link.url}
                    aria-invalid={errors[urlPath] ? true : undefined}
                    aria-describedby={describedBy(urlPath, errors[urlPath])}
                    onChange={(event) => edit(index, { url: event.target.value })}
                  />
                  <FieldMessage path={urlPath} message={errors[urlPath]} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`link-label-${index}`}>{t("label")}</Label>
                <Input
                  id={`link-label-${index}`}
                  data-testid={`link-label-${index}`}
                  autoComplete="off"
                  value={link.label}
                  aria-invalid={errors[labelPath] ? true : undefined}
                  aria-describedby={describedBy(labelPath, errors[labelPath])}
                  onChange={(event) => edit(index, { label: event.target.value })}
                />
                <FieldMessage path={labelPath} message={errors[labelPath]} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          data-testid="link-add"
          disabled={value.length >= MAX_LINKS}
          onClick={() => onChange([...value, { kind: "website", url: "", label: "" }], linkPaths)}
        >
          <Plus />
          {t("add")}
        </Button>
        {value.length >= MAX_LINKS ? <p className="text-muted-foreground text-sm">{t("max")}</p> : null}
      </div>
    </div>
  );
}
