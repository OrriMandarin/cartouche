"use client";

import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { Option } from "./OptionSelect";

/**
 * A choice among a few options as the segmented control of the design: a radio group named by `label`.
 * `label` is a node, so a setting can add a muted suffix to it.
 */
export function SegmentedSelect({
  label,
  value,
  options,
  onValueChange,
  testId,
  disabled,
  block,
}: {
  label: React.ReactNode;
  value: string;
  options: Option[];
  onValueChange: (value: string) => void;
  testId?: string;
  disabled?: boolean | undefined;
  /** Fills the width, the options sharing it. */
  block?: boolean;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm leading-none font-semibold">
        {label}
      </span>
      <RadioGroup
        aria-labelledby={labelId}
        data-testid={testId}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        className={cn("self-start", block && "flex w-full self-stretch")}
      >
        {options.map((option) => (
          <RadioGroupItem
            key={option.value}
            value={option.value}
            data-testid={testId ? `${testId}-${option.value}` : undefined}
            className={block ? "flex-1" : undefined}
          >
            {option.label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
    </div>
  );
}
