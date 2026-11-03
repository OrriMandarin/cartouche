//! Pure business rules for Cartouche. No I/O.

pub mod card;
pub mod card_status;
pub mod clock;
pub mod email;
pub mod media;
pub mod media_files;
pub mod phone;
pub mod public_access;
pub mod slug;
pub mod text;
pub mod theme;
pub mod user;
pub mod validation;
pub mod vcard;

pub use card::{
    CardContent, CardInput, ContentInput, DEFAULT_TEMPLATE, DEFAULT_THEME_PRESET, Link, LinkInput,
    LinkKind, MAX_LINKS, MAX_SETTINGS_BYTES, ValidCard, validate_card,
};
pub use card_status::{CardStatus, SupportBlockUnchanged, check_support_block, is_served};
pub use clock::{Clock, ManualClock, OverridableClock, SystemClock};
pub use email::is_valid_email;
pub use media::{
    MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_VIDEO_BYTES, MAX_VIDEO_DURATION, MediaFormat, MediaKind,
    Mp4Error, ParseMediaError, PlannedVariant, Slot, UploadRejection, VariantFormat,
    classify_upload, invalid_media_refs, is_mp4_ftyp, mp4_duration, plan_image_variants, sniff,
};
pub use media_files::{
    ByteRange, MediaCache, RangeNotSatisfiable, card_of_key, media_access, parse_range,
    served_content_type, storage_key,
};
pub use phone::{InvalidPhone, format_international, normalize_phone};
pub use public_access::{PublicAccess, SlugMatch, public_access};
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
pub use vcard::{VCard, render as render_vcard};
