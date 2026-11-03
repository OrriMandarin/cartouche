//! Pure business rules for Cartouche. No I/O.

pub mod access_code;
pub mod card;
pub mod card_status;
pub mod clock;
pub mod consent;
pub mod email;
pub mod event;
pub mod form;
pub mod framing;
pub mod lead;
pub mod media;
pub mod media_files;
pub mod phone;
pub mod public_access;
pub mod public_event;
pub mod rate_limit;
pub mod slug;
pub mod text;
pub mod theme;
pub mod user;
pub mod validation;
pub mod vcard;

pub use access_code::{access_code_matches, fold_access_code};
pub use card::{
    CardContent, CardInput, ContentInput, DEFAULT_TEMPLATE, DEFAULT_THEME_PRESET, Link, LinkInput,
    LinkKind, MAX_LINKS, MAX_SETTINGS_BYTES, ValidCard, validate_card,
};
pub use card_status::{CardStatus, SupportBlockUnchanged, check_support_block, is_served};
pub use clock::{Clock, ManualClock, OverridableClock, SystemClock};
pub use consent::{consent_text, default_consent_text};
pub use email::is_valid_email;
pub use event::{
    DEFAULT_DEVICE_LIMIT, EventInput, EventNotRunning, EventPhase, MAX_ACCESS_CODE_CHARS,
    MAX_CONSENT_TEXT_CHARS, MAX_DEVICE_LIMIT, MAX_EVENT_DESCRIPTION_CHARS, MAX_EVENT_TITLE_CHARS,
    MIN_DEVICE_LIMIT, Period, TooManySimultaneousEvents, ValidEvent, check_simultaneous_limit,
    max_simultaneous, submission_grace, validate_event,
};
pub use form::{
    CustomField, CustomFieldKind, FieldMode, FormDefinition, MAX_CHOICE_OPTIONS, MAX_CUSTOM_FIELDS,
    MAX_FIELD_HELP_CHARS, MAX_FIELD_LABEL_CHARS, MAX_OPTION_CHARS, MIN_CHOICE_OPTIONS,
    StandardField, StandardFields,
};
pub use framing::{
    CropRect, Framing, PixelRect, VideoLoop, check_crop, check_loop, check_poster_time,
    crop_pixels, default_crop, default_loop,
};
pub use lead::{
    AddressInput, AnswerSnapshot, AnswersInput, DeviceLimitReached, FormChanged, PublicForm,
    StandardAnswers, ValidLead, check_device_limit, check_form_version, form_version,
    honeypot_filled, validate_lead,
};
pub use media::{
    MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_VIDEO_BYTES, MAX_VIDEO_DURATION, MediaFormat, MediaKind,
    Mp4Error, ParseMediaError, PlannedVariant, SOURCE_MAX_SIDE, Slot, UploadRejection,
    VariantFormat, classify_upload, invalid_media_refs, is_mp4_ftyp, mp4_duration,
    plan_image_variants, sniff, source_size,
};
pub use media_files::{
    ByteRange, MediaCache, RangeNotSatisfiable, card_of_key, media_access, parse_range,
    served_content_type, storage_key,
};
pub use phone::{InvalidPhone, format_international, normalize_phone};
pub use public_access::{PublicAccess, SlugMatch, public_access};
pub use public_event::{PublicFormState, UnlockOutcome, public_form_state, unlock_outcome};
pub use rate_limit::{
    RateLimit, SlidingWindow, failed_access_codes_per_ip, lead_submissions_per_ip, rate_limit_key,
};
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
