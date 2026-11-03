//! Pure business rules for Cartouche. No I/O.

pub mod card;
pub mod card_status;
pub mod clock;
pub mod email;
pub mod phone;
pub mod slug;
pub mod text;
pub mod theme;
pub mod user;
pub mod validation;

pub use card::{
    CardContent, CardInput, ContentInput, DEFAULT_TEMPLATE, DEFAULT_THEME_PRESET, Link, LinkInput,
    LinkKind, MAX_LINKS, MAX_SETTINGS_BYTES, ValidCard, validate_card,
};
pub use card_status::{CardStatus, is_served};
pub use clock::{Clock, ManualClock, OverridableClock, SystemClock};
pub use email::is_valid_email;
pub use phone::{InvalidPhone, format_international, normalize_phone};
pub use slug::{
    InvalidSlug, Slug, SlugClaim, SlugClaimError, SlugRecord, decide_claim, suggest_base,
    with_suffix,
};
pub use text::normalize;
pub use theme::{Background, ButtonShape, Color, InvalidTheme, Theme};
pub use user::{
    InvalidTransition, SignupClosed, SignupMode, UserStatus, check_transition, initial_status,
};
pub use validation::FieldError;
