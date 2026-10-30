-- =========================================================================================
-- 20261030000100 — geospatial reference layers: registry, features, raster scene references
-- =========================================================================================
--
-- STATUS: PROPOSED, NOT APPLIED. This file has been parsed by PostgreSQL's own grammar and
-- reviewed by reading, and it has NEVER been run against this project's database. It is in
-- this directory so the schema can be reviewed as SQL rather than as prose. Nothing in the
-- application reads or writes these tables until it is applied — see the `geo-vectors` task
-- in lib/data/sync.ts, which preflights `data.geo_vector_layers` and stays out of the run
-- when the table is absent, rather than reporting a sync it did not perform.
--
-- WHAT THE CODE THAT SHIPS WITH IT DOES: the gated task writes section 1 (the registry, with
-- the publisher's own count, our measured count, vintage, licence and the staleness clock).
-- It deliberately does NOT write section 2 yet. Storing geometries needs the archive fetch to
-- come back as GeoJSON with the publisher's own ring grouping (`f=geojson`), and that response
-- form has not been verified against these three services — the live route uses `f=json` and
-- re-groups rings here, which is fine for drawing and not something to bake into an archive
-- untested. Verifying `f=geojson` per service is the stated next prerequisite, so this file
-- describes the end state while the code only claims the part it can perform.
--
-- What this is: the twelve published vector layers the map already serves live from their
-- own ArcGIS services (lib/data/geoVector.ts) stored as queryable rows, so that a woreda, a
-- dam or a sub-basin can be joined to a price or a rainfall observation instead of only
-- being drawn. The geometry is the publisher's, generalised by a stated tolerance; the
-- attributes are the publisher's, unmodified; the counts on the registry row are what the
-- publisher itself reported the last time anyone asked.
--
-- What this is NOT:
--   - a raster archive. GIBS scenes are stored as REFERENCES (date, matrix, tile template,
--     pixel size) in data.geo_raster_scenes. No tile bytes, no per-pixel rows: a 612 m
--     NDVI scene is ~3.7 million pixels for Ethiopia alone, and a row per pixel would be a
--     table nobody can query and a bill nobody should pay. Point readings already have their
--     own home — data.satellite_observations in file 0005.
--   - a boundary authority. Every row here is a generalised copy of someone else's data with
--     a tolerance measured in metres; the `tolerance_*` columns exist so no query can lose
--     that fact.
--   - current administrative truth. The Ethiopian admin layers carry a 2020 vintage and still
--     publish SNNPR as one region. `publisher_vintage` is on the registry row for that reason.
--   - a source of observation dates. `observed_at` is the PUBLISHER's stated vintage, and it
--     is NULL for every layer whose publisher states none (all five CDE layers do
--     not). `retrieved_at` is when we fetched it. The two are separate columns because
--     conflating them would date a 2021 settlement layer to the day we happened to download it.

-- =========================================================================================
-- 0. Preflight — this file refuses to run on a database that cannot hold geometry
-- =========================================================================================
--
-- PostGIS is the one dependency this pack cannot degrade gracefully without: a
-- `geometry` column that does not exist aborts at the first `create table`, with a message
-- about a type nobody recognises, which is a worse report than the one below. So the check
-- is explicit, and it names the fix instead of guessing at it.
--
-- The check reads `pg_type`, not `pg_available_extensions`: what matters is whether a
-- `geometry` type is actually reachable here, and Supabase installs PostGIS into the
-- `extensions` schema, which is on the search_path.

do $$
declare
  v_geometry_oid oid;
begin
  select t.oid into v_geometry_oid
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
   where t.typname = 'geometry'
     and n.nspname in ('extensions', 'public', 'postgis')
   limit 1;

  if v_geometry_oid is null then
    raise exception
      'PREREQUISITE NOT MET: no PostGIS `geometry` type is reachable from this database. '
      'Enable the extension first — `create extension if not exists postgis with schema extensions;` — '
      'or, if the project should not carry PostGIS, delete the three geometry-bearing columns below '
      'and this file cannot be used as written. This migration will not create tables whose primary '
      'column type does not exist.';
  end if;

  raise notice 'OK: PostGIS geometry type found in namespace %',
    (select n.nspname from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.oid = v_geometry_oid);
end $$;

-- The schema itself, so this file also works when run on its own rather than only after 0001.
create schema if not exists data;

-- =========================================================================================
-- 1. data.geo_vector_layers — one row per published layer, as the publisher describes it
-- =========================================================================================

create table if not exists data.geo_vector_layers (
  layer_id       text primary key,
  title          text not null,
  -- The same two sentences the map renders beside every layer. They live here so a query
  -- result can carry its own limits instead of relying on whoever wrote the chart.
  meaning        text not null,
  caveat         text not null,
  layer_group    text not null check (layer_group in ('administrative', 'settlement', 'hydrology')),
  source_id      text not null,
  provider       text not null,
  -- Exactly as verified against the service: "Basins/MapServer/0", "3", "Urban Extents".
  service_path   text not null,
  publisher_layer text not null,
  geometry_kind  text not null check (geometry_kind in ('point', 'polygon')),
  name_fields    text[] not null default '{}',
  keep_fields    text[] not null default '{}',

  -- The publisher's own count and ours, kept apart on purpose: a layer where the two differ
  -- is a layer whose copy has gone stale, and that is the only way to notice.
  source_count   integer check (source_count is null or source_count >= 0),
  measured_count integer check (measured_count is null or measured_count >= 0),
  count_checked_at timestamptz,
  -- The staleness signal these publishers actually offer: their own count moved since the
  -- last check. Null means "first checked", which is a different fact from "did not change".
  count_changed  boolean,
  features_stored  integer not null default 0 check (features_stored >= 0),

  -- How much of the layer a single request is allowed to carry, and how much it was
  -- generalised by. A polygon stored without its tolerance is a polygon that will be read
  -- as a boundary.
  feature_limit    integer check (feature_limit is null or feature_limit > 0),
  tolerance_degrees numeric(9, 6) check (tolerance_degrees is null or (tolerance_degrees >= 0 and tolerance_degrees < 1)),
  tolerance_meters  numeric(10, 2) check (tolerance_meters is null or (tolerance_meters >= 0 and tolerance_meters < 200000)),
  vertices_stored  integer check (vertices_stored is null or vertices_stored >= 0),

  -- True for the layers too dense to serve country-wide (kebele, watershed, built-up index):
  -- they are read per view extent, so a stored copy is a set of extents, not the layer.
  needs_bbox     boolean not null default false,
  extent_filtered boolean,

  color          text not null,
  value_kind     data.value_kind not null,
  units          text not null,
  attribute_notes text not null,
  vintage_note   text not null,
  -- The publisher's stated date for the layer, or null when it states none. Never defaulted.
  publisher_vintage date,
  license        text not null,
  source_url     text not null,
  storage_srid   integer,
  storage_crs_text text,

  last_full_sync_at timestamptz,
  last_error     text,

  -- The provenance triple every row in `data` carries, so a reader of this registry can tell
  -- a generalised outline from a surveyed boundary without joining to an observation. Same
  -- three columns, same order and types, as data.satellite_layers.
  methodology    text not null,
  coverage       text not null,
  quality        data.quality not null default 'high',

  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now(),

  constraint geo_vector_layers_states_limits check (
    btrim(caveat) <> '' and length(btrim(caveat)) >= 20
  ),
  constraint geo_vector_layers_no_credentials_in_url check (
    source_url not ilike '%api_key%'
    and source_url not ilike '%token%'
    and source_url not ilike '%secret%'
  ),
  -- A publisher count and a measured count that disagree is a legitimate state, but only
  -- when both were actually taken; storing one without the other is how a stale copy looks
  -- like a complete one.
  constraint geo_vector_layers_counts_agree check (
    (source_count is null and measured_count is null)
    or (source_count is not null and measured_count is not null)
  )
);

comment on table data.geo_vector_layers is
  'Registry of the published vector layers the map serves: each one''s publisher, licence, stated vintage, generalisation tolerance and the feature count the publisher itself reported. One row per layer, written by the sync and read by anything that needs to say what a geometry is. RLS enabled and forced with no policies: readable only by the table owner or a bypassrls role, no anon/authenticated access.';
comment on column data.geo_vector_layers.source_count is
  'What the publisher says exists, from its own returnCountOnly query. Null means nobody has asked since this row was created.';
comment on column data.geo_vector_layers.measured_count is
  'The count taken by hand when the layer was verified against the service. Stored beside source_count rather than instead of it: the pair is how a partial or drifting copy becomes visible.';
comment on column data.geo_vector_layers.count_checked_at is
  'When the publisher was last asked for its own count. Age is judged against this column rather than stored as a flag, so the re-read threshold can change without rewriting history.';
comment on column data.geo_vector_layers.count_changed is
  'True when this run''s publisher count differs from the one recorded last run — the only staleness signal an ArcGIS feature service offers. NULL means this is the first time the layer was counted, which is not the same claim as unchanged.';
comment on column data.geo_vector_layers.tolerance_degrees is
  'maxAllowableOffset the publisher applied, in DEGREES because the request asks for outSR=4326. tolerance_meters is its approximate ground distance at this latitude. Generalised geometry without this column would be read as survey-grade.';
comment on column data.geo_vector_layers.publisher_vintage is
  'The date the publisher states for the layer, and NULL when it states none — which is true of all five CDE layers. A reference dataset''s vintage is not an observation date, and this column is not allowed to imply one.';
comment on column data.geo_vector_layers.needs_bbox is
  'True when the layer is only served for a view extent (kebele, watershed, built-up index). A stored copy of such a layer is a collection of extents, not the whole layer, and `extent_filtered` says which of the two the last run produced.';

drop trigger if exists geo_vector_layers_touch on data.geo_vector_layers;
create trigger geo_vector_layers_touch
  before update on data.geo_vector_layers
  for each row execute function data.touch_replaced_at();

-- =========================================================================================
-- 2. data.geo_vector_features — the geometries and the publisher's own attributes
-- =========================================================================================

create table if not exists data.geo_vector_features (
  feature_id       bigint generated always as identity primary key,
  layer_id         text not null references data.geo_vector_layers (layer_id) on delete cascade,
  -- The publisher's OBJECTID/FID, kept as text so a 64-bit id survives and so the value a
  -- caller can cite from the map is the value that is stored here.
  source_feature_id text not null,
  name             text,
  -- The publisher's fields, unmodified and un-renamed. Nothing is coerced: a null the
  -- publisher sends stays a null, and an empty string is not silently turned into one.
  attributes       jsonb not null default '{}'::jsonb,
  geom             geometry(Geometry, 4326) not null,
  -- Centroid and own extent kept as plain numbers too, so a reviewer without PostGIS in
  -- their client can still check where a feature claims to be, and so ordering a list does
  -- not need a spatial function per row.
  centroid_latitude  double precision not null check (centroid_latitude  between -90 and 90),
  centroid_longitude double precision not null check (centroid_longitude between -180 and 180),
  min_latitude     double precision not null,
  min_longitude    double precision not null,
  max_latitude     double precision not null,
  max_longitude    double precision not null,
  vertices         integer not null default 0 check (vertices >= 0),
  -- Which of the three generalisation levels this row came from. Two rows for one feature at
  -- different details are different facts, and the unique key has to say so.
  detail           text not null check (detail in ('overview', 'standard', 'detailed')),
  tolerance_degrees numeric(9, 6) check (tolerance_degrees is null or (tolerance_degrees >= 0 and tolerance_degrees < 1)),
  -- False for a record the publisher sent whose own extent never touches Ethiopia. Several of
  -- these services publish region-wide layers, so a lake in Kenya is a real row — counted and
  -- labelled rather than quietly clipped away.
  within_ethiopia  boolean not null,
  value_kind       data.value_kind not null,
  units            text not null,
  source_name      text not null,
  source_url       text not null,
  license          text not null,
  method_url       text,
  methodology      text not null,
  coverage         text not null,
  quality          data.quality not null default 'high',
  -- When the publisher says the data was observed/published. Null when it does not say.
  observed_at      timestamptz,
  -- When we fetched it. Never presented as the vintage, and the two are separate columns so
  -- no query can accidentally confuse them.
  retrieved_at     timestamptz not null default now(),
  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now(),

  constraint geo_vector_feature_uid unique (layer_id, source_feature_id, detail),
  constraint geo_vector_features_attributes_are_object check (jsonb_typeof(attributes) = 'object'),
  constraint geo_vector_features_bbox_ordered check (
    min_latitude <= max_latitude and min_longitude <= max_longitude
  ),
  -- A generous sanity box, not a claim about the data: every one of these publishers serves
  -- Ethiopia or the surrounding region, and anything outside this box is a coordinate that
  -- was parsed wrong (a lon/lat swap is the usual suspect), not a distant feature.
  constraint geo_vector_features_bbox_plausible check (
    min_latitude between -60 and 80 and max_latitude between -60 and 80
    and min_longitude between -180 and 180 and max_longitude between -180 and 180
  ),
  -- The stored extent must contain the stored centroid, or one of the two was miscalculated.
  constraint geo_vector_features_centroid_in_bbox check (
    centroid_latitude between min_latitude and max_latitude
    and centroid_longitude between min_longitude and max_longitude
  ),
  constraint geo_vector_features_no_credentials_in_url check (
    source_url not ilike '%api_key%' and source_url not ilike '%token%' and source_url not ilike '%secret%'
  )
);

comment on table data.geo_vector_features is
  'Published vector features as stored rows: the publisher''s geometry (generalised at a stated tolerance), the publisher''s attributes verbatim, its own feature id, and both timestamps kept apart — observed_at for what the publisher states, retrieved_at for when we fetched. One row per (layer, feature, detail level). RLS enabled and forced with no policies: readable only by the table owner or a bypassrls role, no anon/authenticated access.';
comment on column data.geo_vector_features.attributes is
  'The publisher''s own fields, unmodified, including nulls. This is the column the map''s "Selected feature" panel reads, so a rename or a coercion here would put a figure on screen that the publisher never published.';
comment on column data.geo_vector_features.geom is
  'WGS84 (EPSG:4326) because every request asks the publisher for outSR=4326; the CDE services store 3857 and reproject on the way out, which is why the geometry is kept in the CRS the caller was served rather than the one the server happens to use.';
comment on column data.geo_vector_features.detail is
  'overview / standard / detailed, i.e. the generalisation level this row was fetched at. A coarse row and a fine row for the same feature are both true copies and are both kept; queries that want one level must say which.';
comment on column data.geo_vector_features.observed_at is
  'The publisher''s stated vintage for this record, NULL when unstated. It is NOT the retrieval time and must never be rendered as one.';

create index if not exists geo_vector_features_geom_idx
  on data.geo_vector_features using gist (geom);

create index if not exists geo_vector_features_layer_name_idx
  on data.geo_vector_features (layer_id, name);

create index if not exists geo_vector_features_layer_retrieved_idx
  on data.geo_vector_features (layer_id, retrieved_at desc);

-- Attributes are the only searchable text here, and the fields differ per layer, so they are
-- indexed as jsonb rather than as columns: a per-layer column set would be a schema change
-- every time a publisher renames a field.
create index if not exists geo_vector_features_attributes_idx
  on data.geo_vector_features using gin (attributes jsonb_path_ops);

drop trigger if exists geo_vector_features_touch on data.geo_vector_features;
create trigger geo_vector_features_touch
  before update on data.geo_vector_features
  for each row execute function data.touch_replaced_at();

-- =========================================================================================
-- 3. data.geo_raster_scenes — references to published composites, never their bytes
-- =========================================================================================

create table if not exists data.geo_raster_scenes (
  layer_id       text not null,
  scene_date     date not null,
  title          text not null,
  matrix_set     text not null,
  tile_url_template text not null,
  tile_size      smallint not null default 256 check (tile_size in (128, 256, 512)),
  min_zoom       smallint not null check (min_zoom between 0 and 24),
  max_zoom       smallint not null check (max_zoom between min_zoom and 24),
  -- Ground resolution of one pixel at the equator, at the layer's own ceiling zoom.
  pixel_meters_at_equator numeric(9, 2) check (pixel_meters_at_equator is null or pixel_meters_at_equator > 0),
  units          text not null,
  value_range    text not null,
  license        text not null,
  -- The composite's publication lag, stated by the product, not measured by us.
  cadence        text not null,
  -- Null with availability_error set is a check that ran and failed, which is a different
  -- fact from a check that never ran.
  availability_checked_at timestamptz,
  availability_error text,
  retrieved_at   timestamptz not null default now(),
  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now(),
  primary key (layer_id, scene_date),
  constraint geo_raster_scenes_no_credentials_in_url check (
    tile_url_template not ilike '%api_key%'
    and tile_url_template not ilike '%token%'
    and tile_url_template not ilike '%secret%'
  )
);

comment on table data.geo_raster_scenes is
  'Which published satellite composites exist for which scene date, with the tile matrix and template needed to fetch them. Deliberately a reference table: raster bytes belong in object storage or a tile service, never in rows, and the values read out of these scenes live in data.satellite_observations. RLS enabled and forced with no policies: readable only by the table owner or a bypassrls role, no anon/authenticated access.';
comment on column data.geo_raster_scenes.scene_date is
  'The date stamped on the composite — for a rolling 8-day product this is the end of the window, and the product is published with a lag, so a scene older than today is correct rather than stale.';
comment on column data.geo_raster_scenes.tile_url_template is
  'Placeholders {date}/{z}/{y}/{x} only, enforced to hold no credential-shaped text: these tiles are public and a key must never reach a browser-visible URL.';

drop trigger if exists geo_raster_scenes_touch on data.geo_raster_scenes;
create trigger geo_raster_scenes_touch
  before update on data.geo_raster_scenes
  for each row execute function data.touch_replaced_at();

-- =========================================================================================
-- 4. No view here, on purpose
-- =========================================================================================
--
-- A "features joined to their layer" view was dropped during drafting for the same reason
-- file 0005 removed its greenness-history view: it would hard-code wording for whatever it
-- happened to join, and nothing consumes it yet. Every row already carries its own meaning,
-- caveat, units, licence and both timestamps, so the query shape when needed is explicit:
--
--   select f.name, f.geom, f.detail, f.tolerance_degrees, l.publisher_vintage, l.license
--     from data.geo_vector_features f
--     join data.geo_vector_layers l using (layer_id)
--    where l.layer_group = 'hydrology' and f.detail = 'standard'
--      and st_intersects(f.geom, st_makeenvelope(38, 8, 40, 10, 4326));
--
-- Note the `detail` predicate. Without it a feature appears once per generalisation level,
-- which is correct for a store and wrong for a count.

-- =========================================================================================
-- 5. Security
-- =========================================================================================
--
-- Same posture as every other table in this pack, and stricter than "public users are
-- read-only": the browser never reads these tables. It calls /api/data/geospatial, which
-- answers from the publisher through a cached server-side connector, so a direct client
-- grant would only widen the blast radius without being used by anything. Writes are the
-- service-role sync task alone.
--
-- If a future revision wants the dashboard to query these tables from the client, that is a
-- separate, reviewable migration adding `grant select` — not a loosening of this file.

alter table data.geo_vector_layers  enable row level security;
alter table data.geo_vector_features enable row level security;
alter table data.geo_raster_scenes  enable row level security;
alter table data.geo_vector_layers  force row level security;
alter table data.geo_vector_features force row level security;
alter table data.geo_raster_scenes  force row level security;

revoke all on data.geo_vector_layers  from anon, authenticated;
revoke all on data.geo_vector_features from anon, authenticated;
revoke all on data.geo_raster_scenes  from anon, authenticated;

-- The posture is stated by extending each table's own comment rather than re-issuing
-- `comment on table`: a second statement REPLACES the first, and an earlier revision of this
-- file did exactly that — the security note overwrote the description, so production would
-- have carried three tables whose purpose nobody had recorded.
