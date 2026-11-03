create table audit_log (
    id uuid primary key default gen_random_uuid(),
    actor_user_id uuid not null references users (id),
    action text not null,
    target_type text not null,
    target_id uuid not null,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now()
);

create index audit_log_target_idx on audit_log (target_type, target_id);
