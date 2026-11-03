//! Pure business rules for Cartouche. No I/O.

pub mod clock;
pub mod text;
pub mod user;
pub mod validation;

pub use clock::{Clock, ManualClock, OverridableClock, SystemClock};
pub use text::normalize;
pub use user::{
    InvalidTransition, SignupClosed, SignupMode, UserStatus, check_transition, initial_status,
};
pub use validation::FieldError;
