//! The ready-made themes (TPL-009), read once from `presets.json`, the byte copy of the file
//! the web uses (`frontend/web/src/lib/theme/themes.json`).

use std::sync::LazyLock;

use serde::Deserialize;

use super::{Background, ButtonShape, Color};

pub const DEFAULT_PRESET: &str = "craie";

const SOURCE: &str = include_str!("presets.json");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preset {
    pub id: String,
    pub accent: Color,
    pub text: Color,
    pub background: Background,
    pub header_gradient: u8,
    pub button_shape: ButtonShape,
    pub font: String,
}

// The file carries more than the server needs (names, moods, contrast table...): no
// `deny_unknown_fields` here.
#[derive(Deserialize)]
struct File {
    themes: Vec<RawTheme>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTheme {
    id: String,
    accent: Color,
    text: Color,
    background: RawBackground,
    header_fade: u8,
    button_shape: ButtonShape,
    font_pair: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum RawBackground {
    Solid { color: Color },
    Gradient { from: Color, to: Color, angle: u16 },
}

impl From<RawTheme> for Preset {
    fn from(raw: RawTheme) -> Preset {
        let background = match raw.background {
            RawBackground::Solid { color } => Background::Solid { color },
            RawBackground::Gradient { from, to, angle } => Background::Gradient { from, to, angle },
        };
        Preset {
            id: raw.id,
            accent: raw.accent,
            text: raw.text,
            background,
            header_gradient: raw.header_fade,
            button_shape: raw.button_shape,
            font: raw.font_pair,
        }
    }
}

static PRESETS: LazyLock<Vec<Preset>> = LazyLock::new(|| {
    let file: File = serde_json::from_str(SOURCE).expect("presets.json is valid");
    file.themes.into_iter().map(Preset::from).collect()
});

pub fn preset(id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|preset| preset.id == id)
}

#[cfg(test)]
pub fn all() -> &'static [Preset] {
    &PRESETS
}
