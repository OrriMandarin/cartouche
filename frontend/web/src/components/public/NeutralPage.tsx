import { Link2Off } from "lucide-react";
import { useTranslations } from "next-intl";
import { neutralTheme } from "@/lib/theme/resolve";
import { CardStage } from "./CardStage";

/**
 * The page of a card that is not served, unknown, disabled or blocked alike (LNK-023, LNK-027, LNK-034): the
 * same neutral theme and texts for every reason, nothing of the card. The status is 404.
 */
export function NeutralPage() {
  const t = useTranslations("publicCard.unavailable");

  return (
    <CardStage theme={neutralTheme()}>
      <article className="cc">
        <div className="cc-off" data-testid="card-unavailable">
          <div className="cc-off-mark">
            <Link2Off className="ic" aria-hidden="true" />
          </div>
          <h1 className="cc-off-title">{t("title")}</h1>
          <p className="cc-off-text">{t("text")}</p>
        </div>
      </article>
    </CardStage>
  );
}
