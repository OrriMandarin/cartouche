create table events (
    id uuid primary key,
    card_id uuid not null references cards (id) on delete cascade,
    title text not null,
    description text,
    starts_at timestamptz not null,
    ends_at timestamptz,
    access_code text,
    device_limit integer not null check (device_limit between 1 and 100),
    standard_fields jsonb not null,
    custom_fields jsonb not null default '[]',
    consent_text text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- `>=`: « Terminer maintenant » at the very instant of the start is allowed.
    check (ends_at is null or ends_at >= starts_at)
);

create index events_card_idx on events (card_id, starts_at);

create table leads (
    id uuid primary key,
    event_id uuid not null references events (id) on delete cascade,
    device_id uuid not null,
    submitted_at timestamptz not null,
    first_name text,
    last_name text,
    birth_date date,
    email text,
    phone text,
    street text,
    postal_code text,
    city text,
    country text,
    custom_answers jsonb not null default '[]',
    consent_at timestamptz not null,
    consent_text text not null,
    spam_at timestamptz,
    created_at timestamptz not null default now()
);

create index leads_event_submitted_idx on leads (event_id, submitted_at desc);
create index leads_event_device_idx on leads (event_id, device_id);
