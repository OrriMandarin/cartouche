//! The API integration tests, compiled as a single test binary.
//!
//! One binary per file would link every dependency once per file: one module per subject
//! keeps the build small and fast. Register each new test file here.

mod common;

mod account;
mod account_deletion;
mod admin_cards;
mod admin_leads;
mod admin_users;
mod auth_verifier;
mod blocked_slugs;
mod card_actions;
mod cards;
mod client_ip;
mod db_cards;
mod db_events;
mod events;
mod health;
mod lead_exports;
mod leads;
mod leads_submit;
mod media;
mod media_files;
mod media_processing;
mod media_s3;
mod media_service;
mod migrations;
mod openapi;
mod public_cards;
mod public_events;
mod slugs;
mod test_support;
mod video_ffmpeg;
