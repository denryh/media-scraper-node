create extension if not exists pg_trgm;

-- id is a deterministic hash of the URL → idempotency key.
create table scrape_jobs (
  id           text primary key,    -- sha1(url) hex
  url          text not null unique,
  status       text not null check (status in ('queued','running','done','failed')),
  attempts     smallint not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create table media_assets (
  id               bigserial primary key,
  media_url        text not null unique,
  media_type       text not null check (media_type in ('image','video')),
  occurrence_count integer not null default 0,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);
create index on media_assets (media_type, id desc);
create index on media_assets using gin (media_url gin_trgm_ops);

create table media_occurrences (
  id          bigserial primary key,
  asset_id    bigint not null references media_assets(id) on delete cascade,
  job_id      text   not null references scrape_jobs(id)   on delete cascade,
  source_url  text   not null,
  alt_text    text,
  observed_at timestamptz not null default now(),
  unique (asset_id, job_id)
);
create index on media_occurrences using gin (alt_text gin_trgm_ops);

-- Counter is bumped from a trigger so it only fires on actual inserts.
-- ON CONFLICT DO NOTHING in the page-level upsert (added in Phase 3) skips
-- the trigger, so intra-page duplicates and worker retries cannot drift it.
create function bump_occurrence_count() returns trigger as $$
begin
  update media_assets
     set occurrence_count = occurrence_count + 1, last_seen_at = now()
   where id = new.asset_id;
  return new;
end $$ language plpgsql;

create trigger trg_bump after insert on media_occurrences
  for each row execute function bump_occurrence_count();
