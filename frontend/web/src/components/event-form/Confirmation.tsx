import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { BUTTON_STYLE, HEADING_STYLE } from "./styles";

interface ConfirmationProps {
  vcardUrl: string;
  cardHref: string;
}

/** After a successful submission: the owner's vCard, then the way back to the card (FRM-004). */
export function Confirmation({ vcardUrl, cardHref }: ConfirmationProps) {
  const t = useTranslations("eventForm.confirmation");
  return (
    <div data-testid="event-form-confirmation" role="status" className="py-6 text-center">
      <h1 className="text-2xl font-bold" style={HEADING_STYLE}>
        {t("title")}
      </h1>
      <p className="mt-3 text-lg">{t("text")}</p>
      <div className="mt-8 flex flex-col items-center gap-4">
        <a
          data-testid="confirmation-save-contact"
          href={vcardUrl}
          download
          className="inline-flex items-center gap-2 px-5 py-3 font-semibold"
          style={BUTTON_STYLE}
        >
          <Download aria-hidden="true" className="h-5 w-5" />
          {t("saveContact")}
        </a>
        <a data-testid="confirmation-back" href={cardHref} className="underline">
          {t("back")}
        </a>
      </div>
    </div>
  );
}
