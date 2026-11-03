create table cards (
    id uuid primary key,
    owner_id uuid not null references users (id) on delete cascade,
    template text not null,
    settings jsonb not null,
    theme jsonb not null,
    first_name text,
    last_name text,
    job_title text,
    company text,
    description text,
    email text,
    phone text,
    links jsonb not null default '[]',
    header_media_id uuid,
    avatar_media_id uuid,
    owner_disabled_at timestamptz,
    support_disabled_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index cards_owner_idx on cards (owner_id, created_at);

-- Every slug ever used stays reserved to its owner, even after its card is deleted.
create table card_slugs (
    slug text primary key,
    owner_id uuid not null references users (id) on delete cascade,
    card_id uuid references cards (id) on delete set null,
    is_current boolean not null,
    created_at timestamptz not null default now(),
    check (not is_current or card_id is not null)
);

create unique index card_slugs_current_idx on card_slugs (card_id) where is_current;

create table media (
    id uuid primary key,
    card_id uuid not null references cards (id) on delete cascade,
    slot text not null check (slot in ('header', 'avatar')),
    kind text not null check (kind in ('image', 'video')),
    variants jsonb not null,
    created_at timestamptz not null default now()
);

create index media_card_idx on media (card_id);

alter table cards
    add constraint cards_header_media_fk foreign key (header_media_id) references media (id) on delete set null,
    add constraint cards_avatar_media_fk foreign key (avatar_media_id) references media (id) on delete set null;
