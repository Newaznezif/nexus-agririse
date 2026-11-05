import type { InsightsPayload } from './findings';
import type {
  ReportAttribution,
  ReportBundle,
  ReportEvidence,
  ReportFinding,
  ReportSectionId,
  ReportWarning,
  SectionStatus,
  SourceRegisterEntry,
} from './types';

/**
 * The client-side reading of a bundle: which of the six states the panel is in, and what it is
 * allowed to say in each.
 *
 * This is a separate module rather than JSX because the mapping is the part that can lie. A
 * component that derives `partial` from the coverage map in three places will eventually disagree
 * with itself; this file decides once, from the fields the orchestrator actually filled, and the
 * harness asserts the decision against real bundles.
 *
 * Two rules:
 *  - every string here is either a status label or text taken verbatim from the bundle
 *    (`unavailableReason`, `scope.note`, `warnings[].message`, `demoNotice`, provider names). No
 *    figure, date or sentence about the data is composed here,
 *  - evidence and register entries are passed through as the objects the bundle holds, not
 *    reshaped copies, so a renderer cannot quietly drop `observedAt`, `license` or `stale` on the
 *    way to the screen.
 */

export type ReportUiState = 'idle' | 'loading' | 'ready' | 'partial' | 'no-data' | 'error';

/** What the panel knows before it asks for anything. */
export interface ReportStateInput {
  loading: boolean;
  error: { code: string; message: string } | null;
  bundle: ReportBundle | null;
}

export interface ReportSectionView {
  id: ReportSectionId;
  title: string;
  status: SectionStatus;
  statusLabel: string;
  unavailableReason: string | null;
  caveats: string[];
  /** The bundle's own evidence array, unmodified. */
  evidence: ReportEvidence[];
  /** Row and point counts, so "partial" is never read as "almost complete". */
  rows: number;
  seriesPoints: number;
}

export interface ReportStateView {
  state: ReportUiState;
  /** One line of status text; empty for `idle`. */
  headline: string;
  sections: ReportSectionView[];
  /** The register as published, whole and unfiltered. */
  register: SourceRegisterEntry[];
  warnings: ReportWarning[];
  demoNotice: string | null;
  /** Non-null only for a demo bundle — a production report must never carry it. */
  isDemo: boolean;
  attribution: ReportAttribution | null;
  scopeLine: string | null;
  scopeNote: string | null;
  reference: string | null;
  generatedAt: string | null;
  findingCount: number;
}

const STATUS_LABEL: Record<SectionStatus, string> = {
  ready: 'Published figures',
  partial: 'Partly answered',
  unavailable: 'Not available',
};

export const sectionStatusLabel = (status: SectionStatus): string => STATUS_LABEL[status];

export function describeReport(input: ReportStateInput): ReportStateView {
  if (input.loading) {
    return emptyView('loading', 'Reading the publishers. Each source answers on its own schedule.');
  }
  if (input.error) {
    return emptyView('error', input.error.message);
  }
  const bundle = input.bundle;
  if (!bundle) return emptyView('idle', '');

  const sections = bundle.sections.map((section) => ({
    id: section.id,
    title: section.title,
    status: section.status,
    statusLabel: STATUS_LABEL[section.status],
    unavailableReason: section.unavailableReason,
    caveats: section.caveats,
    evidence: section.evidence,
    rows: section.evidence.reduce((sum, e) => sum + e.tables.reduce((s, t) => s + t.rows.length, 0), 0),
    seriesPoints: section.evidence.reduce(
      (sum, e) => sum + e.charts.reduce((s, c) => s + c.series.reduce((p, x) => p + x.points.filter((pt) => pt.y !== null).length, 0), 0),
      0,
    ),
  }));

  const statuses = bundle.sections.map((s) => s.status);
  const answered = statuses.filter((s) => s !== 'unavailable').length;

  const state: ReportUiState = answered === 0 ? 'no-data' : statuses.every((s) => s === 'ready') ? 'ready' : 'partial';

  const headline =
    state === 'no-data'
      ? 'No publisher answered this scope. Nothing here is a substitute.'
      : state === 'ready'
        ? `${answered} of ${bundle.sections.length} sections answered from live sources.`
        : `${answered} of ${bundle.sections.length} sections answered; the rest report their own gap.`;

  return {
    state,
    headline,
    sections,
    register: bundle.meta.sourceRegister,
    warnings: bundle.meta.warnings,
    demoNotice: bundle.meta.demoNotice,
    isDemo: bundle.meta.mode === 'demo',
    attribution: bundle.meta.attribution,
    scopeLine: scopeLineFor(bundle),
    scopeNote: bundle.meta.scope.note,
    reference: bundle.meta.reference,
    generatedAt: bundle.meta.generatedAt,
    findingCount: bundle.findings.length,
  };
}

/**
 * Names the scope only from what the bundle resolved. A region request that was answered at one
 * market centre is printed as that centre plus the bundle's own note, so the label cannot be
 * wider than the evidence.
 */
function scopeLineFor(bundle: ReportBundle): string {
  const { scope } = bundle.meta;
  const coverage = bundle.meta.coverage;
  const parts = [
    `Market prices: ${coverage.market === 'unavailable' ? 'none' : `${countRows(bundle, 'market')} rows`}`,
    `Climate: ${coverage.climate === 'unavailable' ? 'not answered' : 'answered'}`,
    `Satellite: ${coverage.geospatial === 'unavailable' ? 'not answered' : 'answered'}`,
    `Economy: ${coverage.economy === 'unavailable' ? 'not answered' : 'answered'}`,
  ];

  const where =
    scope.kind === 'market' ? `${scope.place} market`
    : scope.kind === 'region' ? `${scope.region} — read at ${scope.place}`
    : scope.kind === 'coordinate'
      ? `${scope.location ? scope.location.name : 'the given point'} (${scope.location ? `${round(scope.location.latitude)}, ${round(scope.location.longitude)}` : 'coordinates unavailable'})`
      : 'Ethiopia, national survey';

  return `${where} · ${parts.join(' · ')}`;
}

function round(value: number): string {
  return value.toFixed(4);
}

function countRows(bundle: ReportBundle, id: ReportSectionId): number {
  const section = bundle.sections.find((s) => s.id === id);
  if (!section) return 0;
  return section.evidence.reduce((sum, e) => sum + e.tables.reduce((s, t) => s + t.rows.length, 0), 0);
}

function emptyView(state: ReportUiState, headline: string): ReportStateView {
  return {
    state,
    headline,
    sections: [],
    register: [],
    warnings: [],
    demoNotice: null,
    isDemo: false,
    attribution: null,
    scopeLine: null,
    scopeNote: null,
    reference: null,
    generatedAt: null,
    findingCount: 0,
  };
}

/**
 * The Phase 4 reading of the interpretation block, with the same discipline as above: a state is
 * derived from the payload the route returned, and every string is either a status label or text
 * the route itself carried — a failure message, a rejection reason, a finding's own sentence.
 */

export type InsightUiState = 'idle' | 'loading' | 'ready' | 'nothing' | 'error';

export const FINDING_KIND_LABEL: Record<ReportFinding['kind'], string> = {
  observation: 'Figure as published',
  interpretation: 'Read from the figures',
  recommendation: 'Recommendation',
};

export interface InsightStateInput {
  loading: boolean;
  error: { code: string; message: string } | null;
  payload: InsightsPayload | null;
  /** Why a run is not possible yet, in the panel's own words. Null when it is. */
  blocked: string | null;
}

export interface InsightStateView {
  state: InsightUiState;
  headline: string;
  blocked: string | null;
  payload: InsightsPayload | null;
}

export function describeInsights(input: InsightStateInput): InsightStateView {
  if (input.loading) {
    return view('loading', 'Re-reading the publishers, then asking the model what those figures support. It is shown the evidence and nothing else.', input.blocked, null);
  }
  if (input.error) {
    return view('error', input.error.message, input.blocked, null);
  }
  const payload = input.payload;
  if (!payload) return view('idle', '', input.blocked, null);

  if (payload.findings.length === 0) {
    const headline = payload.rejected.length === 0
      ? 'The model returned no claim for this scope. The published figures above stand on their own.'
      : `The model wrote ${payload.rejected.length} claim${payload.rejected.length === 1 ? '' : 's'} and none was supported by the figures it was sent, so none is printed. The published figures above stand on their own.`;
    return view('nothing', headline, input.blocked, payload);
  }

  const dropped = payload.rejected.length;
  return view(
    'ready',
    `${payload.findings.length} statement${payload.findings.length === 1 ? '' : 's'} the evidence supports${dropped ? `, ${dropped} dropped for want of a citation` : ''}.`,
    input.blocked,
    payload,
  );
}

function view(state: InsightUiState, headline: string, blocked: string | null, payload: InsightsPayload | null): InsightStateView {
  return { state, headline, blocked, payload };
}
