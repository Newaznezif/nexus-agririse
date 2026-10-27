-- =========================================================================================
-- 20261026000500 — satellite layer registry and point observations
-- =========================================================================================
--
-- What this is, stated precisely: the map renders NASA GIBS tiles directly (a browser
-- fetching a published tile is not our data), and the platform additionally stores the
-- VALUE IT READ OUT of a tile at a specific coordinate, with the scene date, the pixel
-- footprint and the publisher's own colour-map band. That is what makes a satellite layer
-- queryable and comparable over time instead of a picture.
--
-- What this is NOT: a raster archive, a yield estimate, or a soil measurement. Full rasters
-- belong in object storage or a tile service, not in a row-per-pixel table. NDVI is a
-- greenness index computed from surface reflectance; it says nothing directly about yield,
-- and this schema gives no column a place to imply otherwise.

-- =========================================================================================
-- 1. data.satellite_layers — the layer as the publisher defines it
-- =========================================================================================

create table if not exists data.satellite_layers (
  layer_id       text primary key,
  title          text not null,
  -- The two sentences that stop over-claiming, stored with the data rather than in JSX.
  meaning        text not null,
  caveat         text not null,
  source_id      text not null,
  source_name    text not null,
  source_url     text not null,
  license        text not null,
  resolution     text not null,
  cadence        text not null,
  matrix_set     text not null,
  tile_url_template text not null,
  min_zoom       smallint not null check (min_zoom between 0 and 24),
  max_zoom       smallint not null check (max_zoom between min_zoom and 24),
  value_range    text not null,
  units          text not null,
  value_kind     data.value_kind not null,
  -- Newest date the tile endpoint actually answered for, and how we know.
  latest_available_date date,
  availability_checked_at timestamptz,
  availability_error text,
  methodology    text not null,
  coverage       text not null,
  quality        data.quality not null default 'high',
  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now(),
  constraint satellite_layers_no_credentials_in_url check (
    tile_url_template not ilike '%api_key%'
    and tile_url_template not ilike '%token%'
    and tile_url_template not ilike '%secret%'
  ),
  -- A caveat is mandatory: a layer whose limits are unstated is the layer that gets
  -- over-read.
  constraint satellite_layers_states_limits check (
    btrim(caveat) <> '' and length(btrim(caveat)) >= 20
  )
);

comment on table data.satellite_layers is
  'Registry of published composite layers the map and the point sampler use, each with the date of its newest confirmed scene. Values, meanings and limits come from the publisher''s own GetCapabilities and colour map.';
comment on column data.satellite_layers.meaning is
  'What the numbers do represent, in the publisher''s terms, shown in the legend.';
comment on column data.satellite_layers.caveat is
  'What the numbers do NOT represent. Mandatory, and rendered next to every value: NDVI is not yield, not soil moisture and not a field measurement; IMERG is a modelled precipitation rate, not a rain-gauge reading.';
comment on column data.satellite_layers.latest_available_date is
  'The most recent scene date the tile endpoint actually served, not a date we assumed. Null with availability_error set means the check ran and failed.';
comment on column data.satellite_layers.tile_url_template is
  'Template with {date}/{z}/{y}/{x} placeholders only. Enforced to contain no credential-shaped text: these tiles are public, and a key must never reach a browser-visible URL.';

drop trigger if exists satellite_layers_touch on data.satellite_layers;
create trigger satellite_layers_touch
  before update on data.satellite_layers
  for each row execute function data.touch_replaced_at();

-- =========================================================================================
-- 2. data.satellite_observations — the value read out of one scene at one place
-- =========================================================================================

create table if not exists data.satellite_observations (
  observation_id  bigint generated always as identity primary key,
  layer_id        text not null references data.satellite_layers (layer_id),
  location_key    text not null references data.location (location_key),
  scene_date      date not null,
  -- The exact coordinate whose pixel was sampled, kept per row so a change of sampling
  -- point is visible instead of silently reinterpreting history.
  latitude        double precision not null check (latitude  between -90  and 90),
  longitude       double precision not null check (longitude between -180 and 180),
  pixel_size_meters numeric(9, 2) check (pixel_size_meters is null or pixel_size_meters > 0),
  -- Null is a real answer: no-data, cloud/fill, or a pixel outside the mapped range. It is
  -- stored as null rather than 0, because 0 NDVI means bare ground and would otherwise be
  -- read as a crop failure.
  value           numeric(8, 5),
  value_max       numeric(8, 5),
  band            text,
  band_index      smallint,
  value_kind      data.value_kind not null,
  units           text not null,
  methodology     text not null,
  quality         data.quality not null default 'medium',
  retrieved_at    timestamptz not null default now(),
  record_added_at    timestamptz not null default now(),
  record_replaced_at timestamptz not null default now(),
  -- A sanity bound, not a scientific claim: NDVI is -1..1 and a precipitation rate from
  -- these composites is never beyond a few tens of mm/h. Anything outside this range is a
  -- mis-read palette index, so it is rejected at the door rather than charted.
  constraint satellite_observation_value_range check (
    value is null or (value between -1 and 200)
  )
);

comment on table data.satellite_observations is
  'Point readings taken from published GIBS composite tiles: one row per (layer, scene date, place). The history of a field''s greenness, with the scene date and pixel footprint that produced it.';
comment on column data.satellite_observations.scene_date is
  'The date stamped on the composite, i.e. the end of the 8-day window. A rolling composite''s scene date is older than today by design; staleness is judged against the source''s publication lag, not against now().';
comment on column data.satellite_observations.value is
  'The colour-map midpoint for the pixel''s palette index, in the layer''s units (NDVI is unitless -1..1; IMERG is mm/h). Derived from the publisher''s published colour map, so it is a reading of the product, not a re-processing of the science. NULL means the pixel''s palette index carries no value in the publisher''s colour map (fill or outside the mapped range); it is NOT stored as 0, because for NDVI 0 is a claim about bare ground.';
comment on column data.satellite_observations.band is
  'The publisher''s own band label for that palette index (e.g. "0.2 to 0.3"), stored so a reviewer can reconstruct exactly how a value was read. Null value + band = the pixel was outside the mapped range or fill.';
comment on column data.satellite_observations.pixel_size_meters is
  'Ground size of the sampled pixel at that latitude and zoom. A 612 m NDVI pixel does not describe a quarter-hectare field, and this column is what makes that limitation visible on the row.';

create unique index if not exists satellite_observation_uid
  on data.satellite_observations (layer_id, scene_date, location_key);

create index if not exists satellite_observation_place_date_idx
  on data.satellite_observations (location_key, scene_date desc);

drop trigger if exists satellite_observation_touch on data.satellite_observations;
create trigger satellite_observation_touch
  before update on data.satellite_observations
  for each row execute function data.touch_replaced_at();

-- =========================================================================================
-- 3. No convenience view here, on purpose
-- =========================================================================================
--
-- A "greenness history" view was removed during drafting: it hard-coded NDVI wording for
-- whatever layer happened to be joined, and nothing consumes it yet. The tables keep the
-- meaning, caveat, units and scene date on every row, so whoever builds the trend chart
-- reads them from the row rather than from a view's guess. Query shape when needed:
--
--   select o.scene_date, o.value, o.units, o.pixel_size_meters, l.caveat
--     from data.satellite_observations o
--     join data.satellite_layers l using (layer_id)
--    where o.location_key = 'wfp-market:480' and l.units ilike '%NDVI%'
--    order by o.scene_date;

-- =========================================================================================
-- 4. Security
-- =========================================================================================

alter table data.satellite_layers       enable row level security;
alter table data.satellite_observations enable row level security;
alter table data.satellite_layers       force row level security;
alter table data.satellite_observations force row level security;

revoke all on data.satellite_layers       from anon, authenticated;
revoke all on data.satellite_observations from anon, authenticated;

comment on table data.satellite_layers is 'RLS enabled and forced with no policies: readable only by the table owner or a bypassrls role. No anon/authenticated access.';
comment on table data.satellite_observations is 'RLS enabled and forced with no policies: readable only by the table owner or a bypassrls role. No anon/authenticated access.';
