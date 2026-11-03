//! Consent text shown with the event form and recorded with each lead (FRM-007 to FRM-011,
//! FRM-026 to FRM-028).
//!
//! The text is French and lives here rather than in `fr.json`: the server must record the exact
//! text the prospect accepted, so it composes it itself (ruling R-S11).

use crate::CardContent;

/// The text the prospect accepts: the owner's custom text as is, or the default one when there
/// is none or it is blank (FRM-007, FRM-028).
pub fn consent_text(custom: Option<&str>, card: &CardContent, event_title: &str) -> String {
    match custom.filter(|text| !text.trim().is_empty()) {
        Some(text) => text.to_string(),
        None => default_consent_text(card, event_title),
    }
}

/// The default consent text, word for word as FRM-026 and FRM-027 give it.
pub fn default_consent_text(card: &CardContent, event_title: &str) -> String {
    let controller = controller_name(card);
    let contact = match &card.email {
        Some(email) => format!("en écrivant à {email}"),
        None => format!("auprès de {controller}"),
    };
    format!(
        "En cochant cette case, j'accepte que {controller} conserve les informations saisies \
         dans ce formulaire afin de me recontacter à des fins commerciales en lien avec \
         l'événement « {event_title} ». {controller} est responsable de ce traitement. Je peux \
         à tout moment demander l'accès à mes données, leur rectification ou leur suppression \
         {contact}."
    )
}

/// First and last name of the card (whichever exist, PUB-018), then the company in parentheses.
fn controller_name(card: &CardContent) -> String {
    let name = [card.first_name.as_deref(), card.last_name.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    match &card.company {
        Some(company) => format!("{name} ({company})"),
        None => name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alice() -> CardContent {
        CardContent {
            first_name: Some("Alice".into()),
            last_name: Some("Durand".into()),
            job_title: None,
            company: Some("Atelier Durand & Fils".into()),
            description: None,
            email: Some("alice@example.test".into()),
            phone: None,
        }
    }

    // spec: FRM-007, FRM-009, FRM-010, FRM-026, FRM-027
    #[test]
    fn default_text_names_the_card_owner() {
        assert_eq!(
            default_consent_text(&alice(), "Salon du Mariage Clermont 2027"),
            "En cochant cette case, j'accepte que Alice Durand (Atelier Durand & Fils) conserve \
             les informations saisies dans ce formulaire afin de me recontacter à des fins \
             commerciales en lien avec l'événement « Salon du Mariage Clermont 2027 ». \
             Alice Durand (Atelier Durand & Fils) est responsable de ce traitement. Je peux à \
             tout moment demander l'accès à mes données, leur rectification ou leur suppression \
             en écrivant à alice@example.test."
        );
    }

    // spec: FRM-026
    #[test]
    fn default_text_uses_ordinary_spaces_inside_the_guillemets() {
        let text = default_consent_text(&alice(), "Salon");
        assert!(text.contains("l'événement « Salon »."));
        assert!(!text.contains('\u{a0}'));
    }

    // spec: FRM-027
    #[test]
    fn default_text_without_company_or_email() {
        let card = CardContent {
            first_name: Some("Éloïse".into()),
            last_name: None,
            company: None,
            email: None,
            ..alice()
        };
        let text = default_consent_text(&card, "Salon");
        assert!(text.contains("j'accepte que Éloïse conserve"), "{text}");
        assert!(text.contains("Éloïse est responsable de ce traitement."));
        assert!(
            text.ends_with("leur rectification ou leur suppression auprès de Éloïse."),
            "{text}"
        );
    }

    // spec: FRM-027
    #[test]
    fn default_text_with_only_a_last_name() {
        let card = CardContent {
            first_name: None,
            last_name: Some("D’Aubigné-Müller".into()),
            company: None,
            ..alice()
        };
        let text = default_consent_text(&card, "Salon");
        assert!(
            text.contains("j'accepte que D’Aubigné-Müller conserve"),
            "{text}"
        );
    }

    // spec: FRM-011
    #[test]
    fn default_text_commits_to_no_retention_period() {
        let text = default_consent_text(&alice(), "Salon du Mariage");
        assert!(!text.chars().any(|c| c.is_ascii_digit()), "{text}");
        for word in ["pendant", "durée", "jours", "mois"] {
            assert!(!text.contains(word), "{word}");
        }
        assert!(!text.split_whitespace().any(|w| w == "an" || w == "ans"));
    }

    // spec: FRM-007, FRM-028
    #[test]
    fn custom_text_wins() {
        let custom = "Vos coordonnées restent chez nous.";
        assert_eq!(consent_text(Some(custom), &alice(), "Salon"), custom);
        assert_eq!(
            consent_text(None, &alice(), "Salon"),
            default_consent_text(&alice(), "Salon")
        );
    }

    // spec: FRM-028
    #[test]
    fn blank_custom_text_falls_back_to_the_default() {
        assert_eq!(
            consent_text(Some("  \n "), &alice(), "Salon"),
            default_consent_text(&alice(), "Salon")
        );
    }
}
