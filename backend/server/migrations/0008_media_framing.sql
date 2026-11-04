-- MED-025 to MED-028: the source kept for re-framing, the framing, and a video's duration.
-- All three stay null for media uploaded before plan 6 (MED-033).
alter table media
    add column source jsonb,
    add column framing jsonb,
    add column duration_ms integer check (duration_ms is null or duration_ms >= 0);
