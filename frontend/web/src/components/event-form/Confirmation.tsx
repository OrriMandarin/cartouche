import { Check, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { contactLabel } from "@/lib/event-form/contact-label";

interface ConfirmationProps {
  /** The first name the prospect sent; empty if none. */
  firstName: string;
  /** The card's full name and first name. */
  ownerName: string;
  ownerFirstName: string;
  vcardUrl: string;
  cardHref: string;
}

/** After a successful submission: thanks, the owner's vCard, then the way back to the card (FRM-004, FRM-047). */
export function Confirmation({ firstName, ownerName, ownerFirstName, vcardUrl, cardHref }: ConfirmationProps) {
  const t = useTranslations("eventForm.confirmation");
  const save = contactLabel(ownerFirstName);
  return (
    <div data-testid="event-form-confirmation" role="status" className="fm-done">
      <div className="fm-done-mark">
        <Check className="ic" aria-hidden="true" />
      </div>
      <h1 className="fm-title">{firstName === "" ? t("titleAnonymous") : t("title", { firstName })}</h1>
      <p className="fm-done-text">{t("text", { name: ownerName })}</p>
      <a data-testid="confirmation-save-contact" href={vcardUrl} download className="cc-save">
        <UserPlus aria-hidden="true" className="ic" />
        {t(save.key, save.values)}
      </a>
      <a data-testid="confirmation-back" href={cardHref} className="fm-link">
        {t("back")}
      </a>
    </div>
  );
}
