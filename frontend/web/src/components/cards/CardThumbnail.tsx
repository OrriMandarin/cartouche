import { initials } from "@/templates/link-display";
import { resolveTheme } from "@/lib/theme/resolve";
import { themeToCssVars } from "@/lib/theme/css-vars";
import { cn } from "@/lib/utils";

/**
 * A miniature of the card in its own colors: header, initials, a name bar and a button bar. The `--c-*`
 * variables stay on this element (TPL-026); the dashboard around it keeps the `--app-*` ones.
 */
export function CardThumbnail({
  theme,
  firstName,
  lastName,
  className,
}: {
  theme: unknown;
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      data-testid="card-thumbnail"
      style={{
        ...themeToCssVars(resolveTheme(theme)),
        background: "linear-gradient(var(--bg-angle), var(--c-bg), var(--c-bg-2))",
      }}
      className={cn("relative h-[60px] w-11 flex-none overflow-hidden rounded-lg ring-1 ring-black/10 @min-[848px]:h-[76px] @min-[848px]:w-14", className)}
    >
      <div
        className="h-[45%]"
        style={{ background: "linear-gradient(var(--c-accent), color-mix(in srgb, var(--c-accent) 30%, var(--c-bg)))" }}
      />
      <div
        className="absolute top-[29%] left-[30%] grid aspect-square w-[40%] place-items-center rounded-full border-2 border-[var(--c-bg)] bg-[var(--c-accent)] text-[8px] leading-none font-bold text-[var(--c-on-accent)]"
      >
        {initials(firstName, lastName)}
      </div>
      <div className="absolute top-[66%] left-[20%] h-[3px] w-[60%] rounded-sm bg-[var(--c-text)]" />
      <div className="absolute top-[78%] left-[15%] h-[6px] w-[70%] rounded-[3px] bg-[var(--c-accent)]" />
    </div>
  );
}
