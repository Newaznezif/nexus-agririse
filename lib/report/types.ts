import type { LocationRef, Provenance, QualityTier, SourceError, ValueKind } from '@/lib/data/types';

/**
 * The contract between the verified connectors, the AI layer and the PDF renderer.
 *
 * It exists because the report used to be assembled from literals in `services/pdfExport.ts`.
 * A report page may now only draw a figure that arrives here already carrying the publisher's
 * own `Provenance` — this module deliberately defines no provenance type of its own, so there
 * is exactly one freshness and attribution vocabulary in the product (see `lib/data/types.ts`).
 *
 * Rules the types enforce:
 *  - a value the source did not answer stays `null`; it is never coerced to 0,
 *  - every table/chart names the scope its rows really cover, separate from the scope asked for,
 *  - anything computed by this app is a `DerivedFigure` with a formula and input evidence ids,
 *  - an interpretation is a `ReportFinding` and must cite evidence ids,
 *  - a section with nothing honest to show is `unavailable`, not an empty chart.
 */

/** `demo` reports are built from the same real sources but must be visibly marked as such. */
export type ReportMode = 'demo' | 'production';

export type SectionStatus = 'ready' | 'partial' | 'unavailable';

/**
 * How wide the report's claims are allowed to be. A hand-typed coordinate is its own kind
 * because no WFP market row can be attributed to a point between markets — substituting the
 * nearest town, or Addis Ababa, for a plot is the failure this enum exists to prevent.
 */
export type ReportScopeKind = 'market' | 'region' | 'national' | 'coordinate';

/**
 * What a value is a measurement OF spatially. A satellite reading for one pixel must never be
 * rendered as though it described a region, and a survey average must never be shown as a
 * farm's own number.
 */
export type SpatialBasis = 'single-pixel' | 'grid-cell' | 'market' | 'region-markets' | 'national-survey';

export interface ReportScope {
  kind: ReportScopeKind;
  /** Market centre the coordinate-scoped sections were read at, as the publisher spells it. */
  place: string | null;
  marketId: string | null;
  /** Region as the price publisher spells `admin1`; the only spelling the price filter matches. */
  region: string | null;
  /** Coordinates used for weather, agroclimatology and satellite reads. Null at national scope. */
  location: LocationRef | null;
  spatial: SpatialBasis;
  /**
   * Set when what the bundle could honour is narrower or differently-anchored than the request
   * — e.g. a region report whose climate values are read at one market centre inside it.
   */
  note: string | null;
}

export interface ReportColumn {
  key: string;
  label: string;
  /** Units for this column only, when they differ from the section's. */
  units: string | null;
}

export interface ReportTable {
  evidenceId: string;
  title: string;
  columns: ReportColumn[];
  /** Values are the publisher's own. A cell the source left blank stays null. */
  rows: Record<string, string | number | boolean | null>[];
  /**
   * Rows the connector returned but this table does not show, counted rather than dropped
   * silently, so a truncated table cannot be read as a complete one.
   */
  rowsOmitted: number;
  /** Why the table is capped or filtered, when it is. */
  omissionNote: string | null;
  provenance: Provenance;
}

export interface ChartSeries {
  label: string;
  /** `y` is null where the publisher has no value for `x`; the gap must stay visible. */
  points: { x: string; y: number | null }[];
}

export interface ReportChart {
  evidenceId: string;
  title: string;
  /** Axis units, copied from the provenance that produced the values. */
  units: string;
  valueKind: ValueKind;
  spatial: SpatialBasis;
  series: ChartSeries[];
  /**
   * Set instead of plotting: what the reader should see in the chart's place when there is no
   * honest series. `series` is empty whenever this is set.
   */
  unavailableReason: string | null;
  /** Null only when `unavailableReason` is set and no source answered at all. */
  provenance: Provenance | null;
}

/** A number this app computed. Never presented as a publisher's measurement. */
export interface DerivedFigure {
  evidenceId: string;
  label: string;
  value: number | null;
  units: string;
  /** The arithmetic actually performed, in words a reviewer can check. */
  formula: string;
  /** evidenceIds this figure consumed, so a claim can be traced to rows. */
  inputs: string[];
  /** Derived values are estimates by construction, whatever their inputs are. */
  valueKind: 'estimated';
  quality: QualityTier;
  provenance: Provenance;
}

/** One connector answer, kept whole: its payload or the error that replaced it. */
export interface ReportEvidence {
  evidenceId: string;
  section: ReportSectionId;
  /** Publisher name, for the source register and the AI's citation list. */
  provider: string;
  provenance: Provenance;
  /** Set when this source did not answer; `tables`/`charts`/`derived` are then empty. */
  error: SourceError | null;
  tables: ReportTable[];
  charts: ReportChart[];
  derived: DerivedFigure[];
  caveats: string[];
}

export type ReportSectionId = 'climate' | 'geospatial' | 'market' | 'economy';

export interface ReportSection {
  id: ReportSectionId;
  title: string;
  /** `partial` means at least one source answered and at least one did not. */
  status: SectionStatus;
  /** Why the whole section is empty — scope or total source failure. Null when anything shows. */
  unavailableReason: string | null;
  scope: ReportScope;
  evidence: ReportEvidence[];
  /** What a reader must not infer from this section, even when it is `ready`. */
  caveats: string[];
}

/**
 * The interpretation slot. Filled by the AI layer in Phase 4; the factual sections stand on
 * their own when it is empty, which is what makes an AI outage survivable.
 */
export interface ReportFinding {
  evidenceId: string;
  text: string;
  /** Every finding cites the bundle it belongs to. An uncited claim is a defect. */
  cites: string[];
  kind: 'observation' | 'interpretation' | 'recommendation';
  /** Model or analyst that produced the sentence; null when the finding is measured, not stated. */
  generatedBy: string | null;
}

export interface ReportWarning {
  code: 'source_unavailable' | 'source_stale' | 'scope_downgraded' | 'insufficient_data' | 'demo_mode' | 'ai_unavailable' | 'licensing';
  message: string;
  evidenceId: string | null;
}

/** One line of the Sources & methodology page, built from provenance objects, not prose. */
export interface SourceRegisterEntry {
  evidenceId: string;
  source: string;
  sourceUrl: string;
  endpoint: string;
  license: string;
  valueKind: ValueKind;
  units: string;
  coverage: string;
  spatial: SpatialBasis;
  observedAt: string | null;
  /** `null` when the source never delivered: the register line says the publisher refused, not when it was read. */
  retrievedAt: string | null;
  stale: boolean;
  servedFromCache: boolean;
  quality: QualityTier;
  state: 'connected' | 'stale' | 'unavailable';
  /** The connector's own error message when it did not answer. */
  detail: string;
}

/**
 * Cover identity. Populated only from a token Supabase Auth confirmed; when `verified` is false
 * the PDF must omit the signature block entirely rather than print a simulated one.
 */
export interface ReportAttribution {
  verified: boolean;
  displayName: string | null;
  note: string;
}

export interface ReportMeta {
  /**
   * Cross-reference for this bundle. It is a lookup key for the source register, not a
   * cryptographic signature and not an authorization claim.
   */
  reference: string;
  generatedAt: string;
  mode: ReportMode;
  /** Text the PDF must print on every page of a demo report; null for a production bundle. */
  demoNotice: string | null;
  scope: ReportScope;
  attribution: ReportAttribution;
  warnings: ReportWarning[];
  sourceRegister: SourceRegisterEntry[];
  /** Section status by id, so a renderer can size the page count without re-walking evidence. */
  coverage: Record<ReportSectionId, SectionStatus>;
}

export interface ReportBundle {
  meta: ReportMeta;
  sections: ReportSection[];
  findings: ReportFinding[];
}

/** Input the orchestrator accepts. Identity never comes from here. */
export interface ReportRequest {
  mode?: ReportMode;
  /** A catalogued market centre, matched against the publisher's own reference table. */
  market?: string | null;
  marketId?: string | null;
  /** A region spelled as the price publisher spells `admin1`. */
  region?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Commodity to build a price series for; matched case-insensitively against `commodity`. */
  commodity?: string | null;
  /** Survey months of price history to include. */
  months?: number;
  /** Days of weather to cover, split between past and forecast by the connector. */
  forecastDays?: number;
  pastDays?: number;
  /** Satellite composites to sample for the vegetation series. */
  composites?: number;
  /**
   * The caller as the route verified it. Presence means a token was confirmed by Auth; the
   * display name is whatever that confirmed account carries, and may be null. The orchestrator
   * cannot invent either: it has no session of its own, so an unauthenticated caller has to be
   * represented by `null` rather than a plausible-looking name.
   */
  caller?: { displayName: string | null } | null;
}
