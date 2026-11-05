"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const HEX = /^#?([0-9a-fA-F]{6})$/;

/**
 * spec: TPL-010, TPL-017. A colour setting: a swatch that opens the system picker, and the hex value in a
 * field. The field applies a value once it is a complete `#RRGGBB`; until then it keeps what is typed, and
 * goes back to the setting when it loses the focus.
 */
export function ColorField({
  id,
  label,
  pickLabel,
  value,
  onChange,
  disabled,
  describedBy,
  invalid,
}: {
  id: string;
  label: string;
  /** Name of the swatch button, « Choisir la couleur … ». */
  pickLabel: string;
  /** Lowercase `#rrggbb`. */
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean | undefined;
  describedBy?: string | undefined;
  /** The colour fails a check of the theme. */
  invalid?: boolean;
}) {
  const picker = useRef<HTMLInputElement>(null);
  // What the owner is typing, while it differs from the setting.
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? value;
  const incomplete = typed !== null && !HEX.test(typed);

  function type(text: string) {
    setTyped(text);
    const match = HEX.exec(text.trim());
    if (match) onChange(`#${match[1]!.toLowerCase()}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="font-semibold">
        {label}
      </Label>
      <div className="relative flex items-center gap-2">
        <button
          type="button"
          aria-label={pickLabel}
          data-testid={`${id}-swatch`}
          disabled={disabled}
          style={{ background: value }}
          onClick={() => picker.current?.click()}
          className="rounded-app size-11 flex-none cursor-pointer border-0 shadow-[inset_0_0_0_1px_rgb(28_27_25/0.2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)] disabled:cursor-not-allowed disabled:opacity-45"
        />
        <input
          ref={picker}
          type="color"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="pointer-events-none absolute top-0 left-0 size-11 opacity-0"
        />
        <Input
          id={id}
          data-testid={id}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={7}
          disabled={disabled}
          value={shown}
          aria-invalid={invalid || incomplete || undefined}
          aria-describedby={describedBy}
          onChange={(event) => type(event.target.value)}
          onBlur={() => setTyped(null)}
          className="font-app-mono"
        />
      </div>
    </div>
  );
}
