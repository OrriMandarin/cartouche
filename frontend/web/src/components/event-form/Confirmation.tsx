import { Download } from "lucide-react";
import { useTranslations } from "next-intl";

interface ConfirmationProps {
  vcardUrl: string;
  cardHref: string;
}

/** After a successful submission: the owner's vCard, then the way back to the card (FRM-004). */
export function Confirmation({ vcardUrl, cardHref }: ConfirmationProps) {
  const t = useTranslations("eventForm.confirmation");
  return (
    <div data-testid="event-form-confirmation" role="status" className="fm-done">
      <h1 className="fm-title">{t("title")}</h1>
      <p className="fm-done-text">{t("text")}</p>
      <a data-testid="confirmation-save-contact" href={vcardUrl} download className="cc-save">
        <Download aria-hidden="true" className="ic" />
        {t("saveContact")}
      </a>
      <a data-testid="confirmation-back" href={cardHref} className="fm-link">
        {t("back")}
      </a>
    </div>
  );
}
