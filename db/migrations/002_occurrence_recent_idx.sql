create index if not exists media_occurrences_asset_recent_idx
  on media_occurrences (asset_id, observed_at desc);
