-- Foreign keys that deletes and cascades look up by value, without a usable index so far
-- (`card_slugs_current_idx` only covers current slugs).
create index card_slugs_card_id_idx on card_slugs (card_id);
create index cards_header_media_idx on cards (header_media_id);
create index cards_avatar_media_idx on cards (avatar_media_id);
