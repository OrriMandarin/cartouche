import { useTranslations } from "next-intl";
import { cardPagePath } from "@/lib/card-urls";
import { BUTTON_STYLE, HEADING_STYLE } from "./styles";

interface ClosedEventProps {
  slug: string;
  title: string;
}

/** An event outside its submission window (FRM-024, EVT-026): no form, a way back to the card. */
export function ClosedEvent({ slug, title }: ClosedEventProps) {
  const t = useTranslations("eventForm");
  return (
    <div className="mx-auto max-w-md px-5 py-10 text-center">
      <h1 data-testid="event-form-title" className="text-2xl font-bold" style={HEADING_STYLE}>
        {title}
      </h1>
      <p data-testid="event-closed" className="mt-4 text-lg">
        {t("closed")}
      </p>
      <a
        data-testid="event-form-back"
        href={cardPagePath(slug)}
        className="mt-8 inline-block px-5 py-3 font-semibold"
        style={BUTTON_STYLE}
      >
        {t("back")}
      </a>
    </div>
  );
}
