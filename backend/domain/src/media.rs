//! Media vocabulary: where a media sits on a card, what it is, and the shape of its variants.

use std::str::FromStr;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Where a media is shown on a card.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum Slot {
    Header,
    Avatar,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum MediaKind {
    Image,
    Video,
}

/// File format of one stored variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub enum VariantFormat {
    Webp,
    Jpeg,
    Mp4,
}

/// A stored media word that is not one of the known values.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("unknown media value: {0:?}")]
pub struct ParseMediaError(pub String);

impl Slot {
    pub fn as_str(self) -> &'static str {
        match self {
            Slot::Header => "header",
            Slot::Avatar => "avatar",
        }
    }
}

impl FromStr for Slot {
    type Err = ParseMediaError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "header" => Ok(Slot::Header),
            "avatar" => Ok(Slot::Avatar),
            other => Err(ParseMediaError(other.to_string())),
        }
    }
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MediaKind::Image => "image",
            MediaKind::Video => "video",
        }
    }
}

impl FromStr for MediaKind {
    type Err = ParseMediaError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "image" => Ok(MediaKind::Image),
            "video" => Ok(MediaKind::Video),
            other => Err(ParseMediaError(other.to_string())),
        }
    }
}
