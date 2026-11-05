//! Colour maths and the four blocking contrast checks of a card theme (TPL-018). Mirrors
//! `frontend/web/src/lib/theme/{color,contrast}.ts`: same constants, same results.

/// Encoded sRGB channels, each from 0 to 1.
pub type Rgb = [f64; 3];

/// The four checks, with their minimum WCAG 2.x ratio.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContrastCheck {
    Text,
    MutedOnHover,
    OnAccent,
    AccentVsBackground,
}

const CHECKS: [ContrastCheck; 4] = [
    ContrastCheck::Text,
    ContrastCheck::MutedOnHover,
    ContrastCheck::OnAccent,
    ContrastCheck::AccentVsBackground,
];

impl ContrastCheck {
    pub fn minimum(self) -> f64 {
        match self {
            ContrastCheck::AccentVsBackground => 3.0,
            _ => 4.5,
        }
    }
}

/// Worst measured ratio of each check.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Measures {
    pub text: f64,
    pub muted_on_hover: f64,
    pub on_accent: f64,
    pub accent_vs_background: f64,
}

impl Measures {
    fn of(&self, check: ContrastCheck) -> f64 {
        match check {
            ContrastCheck::Text => self.text,
            ContrastCheck::MutedOnHover => self.muted_on_hover,
            ContrastCheck::OnAccent => self.on_accent,
            ContrastCheck::AccentVsBackground => self.accent_vs_background,
        }
    }
}

const WHITE: Rgb = [1.0, 1.0, 1.0];
const NEAR_BLACK: Rgb = [17.0 / 255.0, 17.0 / 255.0, 17.0 / 255.0];

/// Parses a `#rrggbb` string already validated by `Color`.
pub fn parse_hex(hex: &str) -> Rgb {
    let channel = |start: usize| {
        f64::from(u8::from_str_radix(&hex[start..start + 2], 16).unwrap_or(0)) / 255.0
    };
    [channel(1), channel(3), channel(5)]
}

fn linearize(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn encode(c: f64) -> f64 {
    if c <= 0.003_130_8 {
        12.92 * c
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

pub fn relative_luminance(rgb: Rgb) -> f64 {
    0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2])
}

/// WCAG 2.x contrast ratio, from 1 to 21.
pub fn contrast_ratio(a: Rgb, b: Rgb) -> f64 {
    let (la, lb) = (relative_luminance(a), relative_luminance(b));
    (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
}

fn to_oklab(rgb: Rgb) -> [f64; 3] {
    let [r, g, b] = rgb.map(linearize);
    let l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b).cbrt();
    let m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b).cbrt();
    let s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b).cbrt();
    [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
}

fn from_oklab([lightness, a, b]: [f64; 3]) -> Rgb {
    let l = (lightness + 0.3963377774 * a + 0.2158037573 * b).powi(3);
    let m = (lightness - 0.1055613458 * a - 0.0638541728 * b).powi(3);
    let s = (lightness - 0.0894841775 * a - 1.291485548 * b).powi(3);
    let clamped_encode = |c: f64| encode(c.clamp(0.0, 1.0));
    [
        clamped_encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        clamped_encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        clamped_encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ]
}

/// Mixes two colours in Oklab; `weight_of_a` is the share of `a`, from 0 to 1.
pub fn mix_oklab(a: Rgb, b: Rgb, weight_of_a: f64) -> Rgb {
    let (oa, ob) = (to_oklab(a), to_oklab(b));
    from_oklab([
        oa[0] * weight_of_a + ob[0] * (1.0 - weight_of_a),
        oa[1] * weight_of_a + ob[1] * (1.0 - weight_of_a),
        oa[2] * weight_of_a + ob[2] * (1.0 - weight_of_a),
    ])
}

/// A translucent `fg` laid over `bg`, on the encoded values, as a browser does.
pub fn over(fg: Rgb, bg: Rgb, alpha: f64) -> Rgb {
    [
        fg[0] * alpha + bg[0] * (1.0 - alpha),
        fg[1] * alpha + bg[1] * (1.0 - alpha),
        fg[2] * alpha + bg[2] * (1.0 - alpha),
    ]
}

/// The text colour put on the accent: white or near-black, whichever reads better; white on a tie.
pub fn on_accent_for(accent: Rgb) -> Rgb {
    if contrast_ratio(WHITE, accent) >= contrast_ratio(NEAR_BLACK, accent) {
        WHITE
    } else {
        NEAR_BLACK
    }
}

/// Worst ratio of each check; `stops` are the background colours (one, or both of a gradient).
pub fn measure(text: Rgb, accent: Rgb, stops: &[Rgb]) -> Measures {
    let first = stops[0];
    let muted = mix_oklab(text, first, 0.78);
    let worst = |ratio: &dyn Fn(Rgb) -> f64| {
        stops
            .iter()
            .map(|stop| ratio(*stop))
            .fold(f64::INFINITY, f64::min)
    };
    Measures {
        text: worst(&|stop| contrast_ratio(text, stop)),
        muted_on_hover: worst(&|stop| contrast_ratio(muted, over(text, stop, 0.12))),
        on_accent: contrast_ratio(on_accent_for(accent), accent),
        accent_vs_background: worst(&|stop| contrast_ratio(accent, over(text, stop, 0.12))),
    }
}

pub fn failed_checks(text: Rgb, accent: Rgb, stops: &[Rgb]) -> Vec<ContrastCheck> {
    let measures = measure(text, accent, stops);
    CHECKS
        .into_iter()
        .filter(|check| measures.of(*check) < check.minimum())
        .collect()
}
