import { useTranslations } from "next-intl";
import { cardPagePath } from "@/lib/card-urls";
import { FormHead } from "./FormChrome";

interface ClosedEventProps {
  slug: string;
  title: string;
}

/** An event outside its submission window (FRM-024, EVT-026): the band, no form, a way back to the card. */
export function ClosedEvent({ slug, title }: ClosedEventProps) {
  const t = useTranslations("eventForm");
  return (
    <>
      <FormHead title={title} live={false} />
      <p data-testid="event-closed" className="fm-intro">
        {t("closed")}
      </p>
      <a data-testid="event-form-back" href={cardPagePath(slug)} className="fm-link">
        {t("back")}
      </a>
    </>
  );
}
