create table users (
    id uuid primary key default gen_random_uuid(),
    issuer text not null,
    subject text not null,
    email text,
    display_name text,
    status text not null check (status in ('pending', 'approved', 'rejected', 'suspended')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (issuer, subject)
);
