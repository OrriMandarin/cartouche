"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface Option {
  value: string;
  label: string;
}

/** A select over a short list of options, labelled by the `<Label htmlFor={id}>` next to it. */
export function OptionSelect({
  id,
  value,
  options,
  onValueChange,
  testId,
  invalid,
  describedBy,
  disabled,
}: {
  id: string;
  value: string;
  options: Option[];
  onValueChange: (value: string) => void;
  testId?: string;
  invalid?: boolean;
  describedBy?: string | undefined;
  disabled?: boolean | undefined;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} data-testid={testId} aria-invalid={invalid} aria-describedby={describedBy}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
