//! Theme settings of a card (TPL-010, TPL-017). Every value is checked against a closed
//! grammar so it can be rendered into CSS without escaping concerns.

use serde::{Deserialize, Serialize};

use crate::card::DEFAULT_THEME_PRESET;

const MAX_GRADIENT_ANGLE: u16 = 360;
const MAX_HEADER_GRADIENT: u8 = 100;

/// The theme value is not valid (TPL-017).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("invalid theme")]
pub struct InvalidTheme;

/// A `#rrggbb` color, stored in lowercase.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "utoipa", schema(value_type = String, example = "#1a2b3c"))]
pub struct Color(String);

impl Color {
    pub fn parse(input: &str) -> Result<Color, InvalidTheme> {
        let valid = input.len() == 7
            && input.starts_with('#')
            && input[1..].bytes().all(|b| b.is_ascii_hexdigit());
        if valid {
            Ok(Color(input.to_ascii_lowercase()))
        } else {
            Err(InvalidTheme)
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Color {
    type Error = InvalidTheme;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Color::parse(&value)
    }
}

impl From<Color> for String {
    fn from(color: Color) -> String {
        color.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum Background {
    Solid {
        color: Color,
    },
    /// Linear gradient; `angle` is in degrees, 0 to 360.
    Gradient {
        from: Color,
        to: Color,
        angle: u16,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum ButtonShape {
    Square,
    Rounded,
    Pill,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct Theme {
    /// Preset identifier; an unknown one is accepted and falls back at render time.
    pub preset: String,
    /// Font pair identifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<Background>,
    /// Intensity of the header gradient, 0 to 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_gradient: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub button_shape: Option<ButtonShape>,
}

impl Theme {
    /// The theme of a new card: the default preset and nothing else.
    pub fn default_theme() -> Theme {
        Theme {
            preset: DEFAULT_THEME_PRESET.to_string(),
            font: None,
            accent: None,
            text: None,
            background: None,
            header_gradient: None,
            button_shape: None,
        }
    }

    /// Reads a stored or submitted theme, refusing any value outside the grammar of TPL-017.
    pub fn parse(value: &serde_json::Value) -> Result<Theme, InvalidTheme> {
        let theme: Theme = serde_json::from_value(value.clone()).map_err(|_| InvalidTheme)?;
        theme.check()?;
        Ok(theme)
    }

    fn check(&self) -> Result<(), InvalidTheme> {
        let identifiers_ok =
            is_identifier(&self.preset) && self.font.as_deref().is_none_or(is_identifier);
        let angle_ok = match &self.background {
            Some(Background::Gradient { angle, .. }) => *angle <= MAX_GRADIENT_ANGLE,
            _ => true,
        };
        let gradient_ok = self
            .header_gradient
            .is_none_or(|g| g <= MAX_HEADER_GRADIENT);
        if identifiers_ok && angle_ok && gradient_ok {
            Ok(())
        } else {
            Err(InvalidTheme)
        }
    }
}

/// `^[a-z0-9-]{1,32}$`
fn is_identifier(value: &str) -> bool {
    (1..=32).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // spec: TPL-017, Review Focus 4
    #[test]
    fn theme_rejects_css_injection() {
        for bad in [
            json!({ "preset": "clair", "accent": "url(https://x)" }),
            json!({ "preset": "clair", "accent": "red" }),
            json!({ "preset": "clair", "accent": "#12345" }),
            json!({ "preset": "clair", "accent": "#12345g" }),
            json!({ "preset": "clair", "accent": "#1234567" }),
            json!({ "preset": "clair", "text": "#fff; background:url(x)" }),
            json!({ "preset": "clair", "font": "x;}body{display:none" }),
            json!({ "preset": "clair", "font": "" }),
            json!({ "preset": "Clair" }),
            json!({ "preset": "a".repeat(33) }),
            json!({ "preset": "clair", "background": { "kind": "gradient", "from": "#000000", "to": "#ffffff", "angle": 361 } }),
            json!({ "preset": "clair", "background": { "kind": "gradient", "from": "#000000", "to": "#ffffff", "angle": -1 } }),
            json!({ "preset": "clair", "background": { "kind": "solid", "color": "blue" } }),
            json!({ "preset": "clair", "background": { "kind": "image", "color": "#000000" } }),
            json!({ "preset": "clair", "header_gradient": 101 }),
            json!({ "preset": "clair", "header_gradient": -1 }),
            json!({ "preset": "clair", "button_shape": "hexagon" }),
            json!({ "preset": "clair", "extra": true }),
            json!({ "accent": "#000000" }),
            json!("clair"),
            json!(null),
        ] {
            assert_eq!(Theme::parse(&bad), Err(InvalidTheme), "{bad}");
        }
    }

    // spec: TPL-017
    #[test]
    fn theme_accepts_full_settings() {
        let value = json!({
            "preset": "sombre",
            "font": "editorial-2",
            "accent": "#AABBCC",
            "text": "#0F0F0F",
            "background": { "kind": "gradient", "from": "#FF0000", "to": "#00FF00", "angle": 360 },
            "header_gradient": 100,
            "button_shape": "pill"
        });
        let theme = Theme::parse(&value).unwrap();
        assert_eq!(theme.preset, "sombre");
        assert_eq!(theme.font.as_deref(), Some("editorial-2"));
        assert_eq!(theme.accent.as_ref().map(Color::as_str), Some("#aabbcc"));
        assert_eq!(theme.text.as_ref().map(Color::as_str), Some("#0f0f0f"));
        assert_eq!(theme.header_gradient, Some(100));
        assert_eq!(theme.button_shape, Some(ButtonShape::Pill));
        let Some(Background::Gradient { from, to, angle }) = &theme.background else {
            panic!("expected a gradient");
        };
        assert_eq!(
            (from.as_str(), to.as_str(), *angle),
            ("#ff0000", "#00ff00", 360)
        );

        let stored = serde_json::to_value(&theme).unwrap();
        assert_eq!(stored["accent"], "#aabbcc");
        assert_eq!(stored["background"]["from"], "#ff0000");
        assert_eq!(stored["background"]["kind"], "gradient");
        assert_eq!(Theme::parse(&stored).unwrap(), theme);
    }

    // spec: TPL-017
    #[test]
    fn theme_accepts_minimal_and_solid_settings() {
        let minimal = Theme::parse(&json!({ "preset": "clair" })).unwrap();
        assert_eq!(minimal.background, None);
        assert_eq!(
            serde_json::to_value(&minimal).unwrap(),
            json!({ "preset": "clair" })
        );

        let solid = Theme::parse(&json!({
            "preset": "clair",
            "background": { "kind": "solid", "color": "#112233" },
            "button_shape": "square",
            "header_gradient": 0
        }))
        .unwrap();
        assert!(matches!(solid.background, Some(Background::Solid { .. })));
        assert_eq!(solid.button_shape, Some(ButtonShape::Square));
    }

    // spec: TPL-017
    #[test]
    fn default_theme_uses_the_default_preset() {
        let theme = Theme::default_theme();
        assert_eq!(theme.preset, "clair");
        assert_eq!(
            Theme::parse(&serde_json::to_value(&theme).unwrap()),
            Ok(theme)
        );
    }
}
