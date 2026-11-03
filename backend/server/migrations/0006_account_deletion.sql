-- Slugs of deleted accounts, kept only as a hash, with no link to a person (LNK-015, LNK-031).
create table blocked_slugs (
    slug_hash bytea primary key check (octet_length(slug_hash) = 32)
);

-- Audit entries outlive the accounts they name (ACC-024): the actor stays as a bare identifier.
alter table audit_log drop constraint audit_log_actor_user_id_fkey;
