//! French labels of the exports. Documented exception to the "no hard-coded interface text" rule
//! (R-S5): the headers are written into files, outside the web interface.

use chrono_tz::Tz;

pub const FIRST_NAME: &str = "Prénom";
pub const LAST_NAME: &str = "Nom";
pub const BIRTH_DATE: &str = "Date de naissance";
pub const EMAIL: &str = "Email";
pub const PHONE: &str = "Téléphone";
pub const STREET: &str = "Rue";
pub const POSTAL_CODE: &str = "Code postal";
pub const CITY: &str = "Ville";
pub const COUNTRY: &str = "Pays";

pub const EVENT: &str = "Événement";
pub const SUBMITTED_AT: &str = "Date d'envoi";
pub const CONSENT_AT: &str = "Date du consentement";
pub const CONSENT_TEXT: &str = "Texte du consentement";
pub const SPAM: &str = "Spam";

pub const YES: &str = "Oui";
pub const NO: &str = "Non";
pub const SHEET: &str = "Contacts";
pub const EVENT_SLUG_FALLBACK: &str = "evenement";

/// The header of a time column, naming the zone used (LEA-026).
pub fn time_header(base: &str, zone: Tz) -> String {
    format!("{base} ({})", zone.name())
}
