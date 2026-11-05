import { describeReport, FINDING_KIND_LABEL, sectionStatusLabel } from './reportState';
import type { InsightsPayload } from './findings';
import type { Provenance, ValueKind } from '@/lib/data/types';
import type {
  DerivedFigure,
  ReportAttribution,
  ReportBundle,
  ReportChart,
  ReportEvidence,
  ReportFinding,
  ReportMode,
  ReportScope,
  ReportTable,
  SpatialBasis,
} from './types';

/**
 * Phase 5: what the evidence PDF says, decided here — away from the drawing code.
 *
 * This module never touches jsPDF, the DOM or a network. It turns a `ReportBundle` (and, when one
 * is in hand, the validated `InsightsPayload` that belongs to it) into a list of typed blocks:
 * headings, key/value lines, paragraphs, bullets, tables and chart specifications. The renderer in
 * `services/pdfExport.ts` only decides *where* a block is drawn; it never decides *what it says*.
 * That split is the whole point — a figure can only reach the page if it is already a string in
 * one of these blocks, and every string here is traceable to a bundle field.
 *
 * Rules this module is held to:
 *  - no arithmetic: counts of rows and plotted points are the same counts `describeReport` already
 *    publishes, taken from that function rather than recomputed here,
 *  - a null stays a null, printed as an em dash — never `0`, never blank,
 *  - a chart with an `unavailableReason` becomes a block that prints that sentence in the chart's
 *    place, in the same area of the page,
 *  - every date comes from `observedAt` / `retrievedAt` / `generatedAt`. Nothing here calls
 *    `new Date()` — a PDF must not stamp a moment the bundle does not carry,
 *  - the interpretation page is drawn from the payload the citation gate returned, and only when
 *    its reference matches the bundle being printed.
 */

export type PdfColor = [number, number, number];

export interface PdfTableBlock {
  type: 'table';
  head: string[];
  rows: string[][];
  /** The three themes the layout already uses: `plain` for key/value, `grid` and `striped` for data. */
  theme: 'plain' | 'grid' | 'striped';
  headerColor: PdfColor;
  /** Column widths in mm; null lets the table library decide. */
  columnWidths: number[] | null;
  fontSize: number;
}

export interface PdfChartSeries {
  label: string;
  points: { x: string; y: number | null }[];
}

/** A chart the contract allows to be plotted. Values are the publisher's own points. */
export interface PdfChartBlock {
  type: 'chart';
  title: string;
  /** One line under the box: how many points, units, what kind of value, at what spatial basis. */
  caption: string;
  unit: string;
  series: PdfChartSeries[];
}

/** A chart the contract refuses to plot. The renderer keeps the box and prints the reason inside it. */
export interface PdfNoChartDataBlock {
  type: 'chart-unavailable';
  title: string;
  reason: string;
  caption: string;
}

export interface PdfTextBlock {
  type: 'heading' | 'subheading' | 'paragraph' | 'bullet';
  text: string;
}

export interface PdfKeyValueBlock {
  type: 'kv';
  rows: [string, string][];
}

export interface PdfBoxBlock {
  type: 'box';
  title: string;
  lines: string[];
}

export interface PdfPageBreakBlock {
  type: 'page-break';
}

export type PdfBlock = PdfTextBlock | PdfKeyValueBlock | PdfTableBlock | PdfChartBlock | PdfNoChartDataBlock | PdfBoxBlock | PdfPageBreakBlock;

export interface PdfCoverColumn {
  heading: string;
  lines: string[];
}

export interface PdfCover {
  /** The two 42pt display lines the cover layout draws. Labels only; no figure belongs here. */
  title: [string, string];
  /** Printed under the rule in the existing cover layout. Every line is a bundle field. */
  lines: string[];
  left: PdfCoverColumn;
  right: PdfCoverColumn;
  isDemo: boolean;
}

export interface PdfDocument {
  filename: string;
  /** Non-null for a demo bundle; the renderer prints it on *every* page, not once. */
  demoNotice: string | null;
  footer: string;
  cover: PdfCover;
  blocks: PdfBlock[];
}

const EMERALD: PdfColor = [5, 150, 105];
const BLUE: PdfColor = [59, 130, 246];
const NO_VALUE = '—';
const NOT_STATED = 'not stated';

/**
 * The same value-kind words the dashboard uses (`components/data/ProvenanceLabel.tsx`), restated
 * here because that module is JSX and this one has to be importable by the Node harness. The
 * harness asserts the two agree.
 */
export const VALUE_KIND_WORD: Record<ValueKind, string> = {
  observed: 'Observed',
  modeled: 'Modelled',
  forecast: 'Forecast',
  estimated: 'Derived',
  imputed: 'Filled in',
};

const SPATIAL_WORD: Record<SpatialBasis, string> = {
  'single-pixel': 'one satellite pixel',
  'grid-cell': 'one grid cell',
  market: 'one surveyed market',
  'region-markets': 'markets in the region',
  'national-survey': 'the national survey',
};

export interface EvidencePdfInput {
  bundle: ReportBundle;
  /** The validated interpretation for *this* bundle, if one has been generated. */
  payload: InsightsPayload | null;
}

export function buildEvidencePdf({ bundle, payload }: EvidencePdfInput): PdfDocument {
  const view = describeReport({ loading: false, error: null, bundle });
  const meta = bundle.meta;
  const isDemo = meta.mode === 'demo';

  const blocks: PdfBlock[] = [];
  blocks.push(...statusBlocks(view, meta.mode, meta.scope, meta.warnings, meta.sourceRegister));
  blocks.push({ type: 'page-break' });
  blocks.push(...evidenceBlocks(bundle));
  blocks.push({ type: 'page-break' });
  blocks.push(...interpretationBlocks(bundle, payload));
  blocks.push({ type: 'page-break' });
  blocks.push(...sourceBlocks(meta.sourceRegister));
  blocks.push({ type: 'page-break' });
  blocks.push(...closingBlocks(meta));

  return {
    filename: `Nexus_${isDemo ? 'DEMO_' : ''}Evidence_Report_${meta.scope.kind}_${meta.reference}.pdf`,
    demoNotice: meta.demoNotice,
    footer: 'Nexus AgriRise — evidence report, generated from publisher data',
    cover: {
      isDemo,
      title: ['Evidence Report', 'Publisher figures, dated'],
      lines: [
        `Reference: ${meta.reference}`,
        `Scope: ${scopeWords(meta.scope)}`,
        `Spatial basis: ${SPATIAL_WORD[meta.scope.spatial] ?? meta.scope.spatial}`,
        `Generated: ${stamp(meta.generatedAt)}`,
        `Mode: ${meta.mode === 'demo' ? 'DEMO workspace — not live publisher evidence' : 'Production workspace'}`,
      ],
      left: coverAttribution(meta.attribution),
      right: { heading: 'REPORT DATE', lines: [stamp(meta.generatedAt), `Reference ${meta.reference}`] },
    },
    blocks,
  };
}

/**
 * The legacy per-insight export. It is kept because two dashboard components call it, but it can
 * no longer dress a stored analysis record up as an audited report: the charts, the auth code and
 * the signature block are gone, and the page says what it is not.
 */
export function buildRecordPdf(input: {
  datasetName: string;
  datasetCountry: string | null;
  insightId: string;
  summary: string;
  riskLevel: string;
  trend: string;
  createdAt: string | null;
  requestedBy: string;
  requestedRole: string;
}): PdfDocument {
  const where = input.datasetCountry?.trim() ? input.datasetCountry : 'no country recorded on the dataset';
  return {
    filename: `Nexus_Analysis_Record_${safe(input.datasetName)}.pdf`,
    demoNotice: null,
    footer: 'Nexus AgriRise — stored analysis record, not an evidence report',
    cover: {
      isDemo: false,
      title: ['Intelligence Stream', 'Analysis Report'],
      lines: [
        `Reference: NX-REC-${safe(input.insightId).slice(0, 8).toUpperCase()}`,
        `Source stream: ${input.datasetName}`,
        `Country on the record: ${where}`,
        `Record created: ${input.createdAt ? stamp(input.createdAt) : NOT_STATED}`,
      ],
      left: { heading: 'PREPARED BY (SELECTED IN THE APP)', lines: [input.requestedBy.toUpperCase(), input.requestedRole.toUpperCase(), 'A choice made in this browser. No authentication behind it.'] },
      right: { heading: 'RECORD DATE', lines: [input.createdAt ? stamp(input.createdAt) : NOT_STATED] },
    },
    blocks: [
      { type: 'heading', text: '1.0 What this document is' },
      {
        type: 'paragraph',
        text: 'This is the analysis record stored against the dataset named above. No report bundle was read for it, so it carries no publisher evidence, no source register, no dates of observation and no charts. Figures in the summary below are a model paragraph held on the record, not measured values.',
      },
      { type: 'page-break' },
      { type: 'heading', text: '2.0 Stored analysis' },
      { type: 'subheading', text: 'Summary as held on the record' },
      { type: 'paragraph', text: input.summary },
      { type: 'kv', rows: [['Source stream', input.datasetName], ['Country on the record', where], ['Risk level (stored field)', input.riskLevel.toUpperCase()], ['Trend (stored field)', input.trend], ['Record created', input.createdAt ? stamp(input.createdAt) : NOT_STATED]] },
      { type: 'paragraph', text: 'The risk level and trend above are the record’s own stored strings. Nothing is derived from them here, and no chart or percentage is drawn from them.' },
      { type: 'page-break' },
      { type: 'box', title: '3.0 Report status', lines: [`Reference NX-REC-${safe(input.insightId).slice(0, 8).toUpperCase()} — a lookup key for the record, not a signature.`, 'This record has no source register: no publisher was read for it.', 'This file is not signed, sealed or encrypted.'] },
    ],
  };
}

/* ---------------------------------------------------------------- pages ---------------------------------------------------------------- */

function statusBlocks(
  view: ReturnType<typeof describeReport>,
  mode: ReportMode,
  scope: ReportScope,
  warnings: ReportBundle['meta']['warnings'],
  register: ReportBundle['meta']['sourceRegister'],
): PdfBlock[] {
  const out: PdfBlock[] = [
    { type: 'heading', text: '1.0 Data status and coverage' },
    { type: 'paragraph', text: view.headline },
    {
      type: 'table',
      head: ['Section', 'Status', 'Rows printed', 'Series points', 'Gap the report states'],
      rows: view.sections.map((s) => [s.title, s.statusLabel, String(s.rows), String(s.seriesPoints), s.unavailableReason ?? s.caveats[0] ?? '—']),
      theme: 'grid',
      headerColor: EMERALD,
      columnWidths: [38, 26, 18, 18, 60],
      fontSize: 7,
    },
    { type: 'paragraph', text: 'Row and point counts are the rows and non-null points the bundle actually carries. A section shown as partly answered is missing something; the last column is that section’s own words about it.' },
  ];

  if (scope.note) {
    out.push({ type: 'subheading', text: 'How wide these figures reach' });
    out.push({ type: 'paragraph', text: `${scopeWords(scope)} — ${scope.note}` });
  }

  const truncated = truncatedTables(view);
  if (truncated.length > 0) {
    out.push({ type: 'subheading', text: 'Tables the report had to cut' });
    out.push(...truncated.map((text) => ({ type: 'bullet' as const, text })));
  }

  const stale = register.filter((e) => e.stale || e.state === 'stale');
  if (stale.length > 0) {
    out.push({ type: 'subheading', text: 'Sources behind schedule' });
    out.push(...stale.map((e) => ({ type: 'bullet' as const, text: `${e.source} (${e.evidenceId}) — published as of ${e.observedAt ?? NOT_STATED}, read by this server ${stamp(e.retrievedAt)}. ${e.detail}` })));
  }

  const refused = register.filter((e) => e.state === 'unavailable');
  if (refused.length > 0) {
    out.push({ type: 'subheading', text: 'Sources that did not answer' });
    out.push(...refused.map((e) => ({ type: 'bullet' as const, text: `${e.source} (${e.evidenceId}) — ${e.detail}` })));
  }

  if (warnings.length > 0) {
    out.push({ type: 'subheading', text: 'Warnings carried with this bundle' });
    out.push(...warnings.map((w) => ({ type: 'bullet' as const, text: `${w.code}${w.evidenceId ? ` (${w.evidenceId})` : ''} — ${w.message}` })));
  }

  out.push({ type: 'subheading', text: 'What this report cannot say' });
  for (const caveat of bundleCaveats(view)) out.push({ type: 'bullet', text: caveat });

  if (mode === 'demo') {
    out.push({ type: 'box', title: 'DEMO CONTENT', lines: [view.demoNotice ?? 'This bundle was built in the demo workspace.', 'Every figure in this file is demo content. None of it is publisher evidence.'] });
  }

  return out;
}

function evidenceBlocks(bundle: ReportBundle): PdfBlock[] {
  const out: PdfBlock[] = [{ type: 'heading', text: '2.0 Evidence by section' }];

  bundle.sections.forEach((section, index) => {
    out.push({ type: 'subheading', text: `2.${index + 1} ${section.title} — ${sectionStatusLabel(section.status)}` });
    out.push({ type: 'paragraph', text: `Scope of these figures: ${scopeWords(section.scope)}.` });
    if (section.unavailableReason) {
      out.push({ type: 'box', title: 'Nothing to show', lines: [section.unavailableReason] });
    }

    for (const evidence of section.evidence) {
      out.push(...evidenceItemBlocks(evidence));
    }

    for (const caveat of section.caveats) out.push({ type: 'bullet', text: caveat });
  });

  return out;
}

function evidenceItemBlocks(evidence: ReportEvidence): PdfBlock[] {
  const out: PdfBlock[] = [{ type: 'paragraph', text: `${evidence.provider} — ${evidence.evidenceId}` }];

  if (evidence.error) {
    out.push({ type: 'box', title: 'This source did not answer', lines: [`${evidence.error.code}: ${evidence.error.message}`, 'No table, chart or figure is drawn in its place.'] });
    return out;
  }

  out.push({ type: 'kv', rows: provenanceRows(evidence.provenance, evidence.provider) });

  for (const table of evidence.tables) out.push(...tableBlocks(table));
  for (const chart of evidence.charts) out.push(chartBlock(chart, evidence));
  for (const derived of evidence.derived) out.push(...derivedBlocks(derived));
  for (const caveat of evidence.caveats) out.push({ type: 'bullet', text: caveat });

  return out;
}

function tableBlocks(table: ReportTable): PdfBlock[] {
  const head = table.columns.map((c) => (c.units ? `${c.label} (${c.units})` : c.label));
  const rows = table.rows.map((row) => table.columns.map((c) => cell(row[c.key])));
  const out: PdfBlock[] = [
    { type: 'paragraph', text: `${table.title} — ${table.rows.length} row${table.rows.length === 1 ? '' : 's'}, ${table.provenance.units || NOT_STATED}` },
    {
      type: 'table',
      head,
      rows,
      theme: 'grid',
      headerColor: EMERALD,
      columnWidths: null,
      fontSize: head.length > 5 ? 6 : 7,
    },
  ];

  if (table.rowsOmitted > 0) {
    out.push({ type: 'bullet', text: `Not shown: ${table.rowsOmitted} further row${table.rowsOmitted === 1 ? '' : 's'} the source returned. ${table.omissionNote ?? 'The table is capped for page space.'}` });
  }
  const blanks = rows.flat().filter((v) => v === NO_VALUE).length;
  if (blanks > 0) {
    out.push({ type: 'bullet', text: `${blanks} cell${blanks === 1 ? '' : 's'} above are printed as ${NO_VALUE}: the publisher supplied no value there. A dash is not zero.` });
  }
  out.push({ type: 'bullet', text: `Units, kind and dates for these rows: ${table.provenance.source}, ${VALUE_KIND_WORD[table.provenance.valueKind] ?? table.provenance.valueKind}, coverage ${table.provenance.coverage}, observed ${table.provenance.observedAt ?? NOT_STATED}, retrieved ${stamp(table.provenance.retrievedAt)}.` });
  return out;
}

function chartBlock(chart: ReportChart, evidence: ReportEvidence): PdfBlock {
  const points = chart.series.reduce((n, s) => n + s.points.length, 0);
  const plotted = chart.series.reduce((n, s) => n + s.points.filter((p) => p.y !== null).length, 0);
  const missing = points - plotted;
  const source = chart.provenance ?? evidence.provenance;
  const caption = `${chart.title} — ${plotted} of ${points} published points${missing > 0 ? `, ${missing} with no value (left as gaps)` : ''} · ${chart.units} · ${VALUE_KIND_WORD[chart.valueKind] ?? chart.valueKind} · ${SPATIAL_WORD[chart.spatial] ?? chart.spatial} · observed ${source.observedAt ?? NOT_STATED}, retrieved ${stamp(source.retrievedAt)}`;

  if (chart.unavailableReason) {
    return { type: 'chart-unavailable', title: chart.title, reason: chart.unavailableReason, caption };
  }
  return { type: 'chart', title: chart.title, caption, unit: chart.units, series: chart.series.map((s) => ({ label: s.label, points: s.points })) };
}

function derivedBlocks(derived: DerivedFigure): PdfBlock[] {
  return [
    {
      type: 'kv',
      rows: [
        ['Figure computed by this application', derived.label],
        ['Value', `${cell(derived.value)} ${derived.units}`],
        ['Kind', `${VALUE_KIND_WORD[derived.valueKind]} — estimated, not a publisher measurement`],
        ['Arithmetic performed', derived.formula],
        ['Evidence ids it consumed', derived.inputs.join(', ') || NOT_STATED],
        ['Quality', derived.quality],
      ],
    },
  ];
}

function interpretationBlocks(bundle: ReportBundle, payload: InsightsPayload | null): PdfBlock[] {
  const out: PdfBlock[] = [{ type: 'heading', text: '3.0 Interpretation — model-written, evidence-checked' }];

  if (!payload) {
    out.push({ type: 'paragraph', text: 'No interpretation was generated for this bundle. The report above is the publishers’ own figures, and it stands without one: the interpretation is a separate request that spends a model call, and it was not made for this file.' });
    out.push({ type: 'paragraph', text: 'Nothing on the evidence pages is model prose. Every sentence there is a publisher value, a stated derivation, or the report’s own gap note.' });
    return out;
  }

  if (payload.reference !== bundle.meta.reference) {
    out.push({ type: 'box', title: 'Interpretation withheld', lines: [`The interpretation in this browser belongs to reference ${payload.reference}, not to the ${bundle.meta.reference} being printed. A newer or different scope was read, so its sentences are not attached to these figures.`] });
    return out;
  }

  out.push({
    type: 'paragraph',
    text: `Each sentence below cites the evidence ids it was drawn from, and was checked against the figures this bundle carries before it was printed here. Every figure quoted in a sentence appears on the evidence pages of this same file. Sentences the check dropped are listed after them, with the reason, so the omissions are visible rather than silent.`,
  });
  out.push({ type: 'kv', rows: [['Model', payload.model], ['Reference', payload.reference], ['Interpretation generated', stamp(payload.generatedAt)], ['Mode', payload.mode === 'demo' ? 'DEMO — the sentences below rest on demo figures' : 'Production'], ['How its figures were chosen', payload.selection], ['What was left out of its view', payload.truncated ?? 'Nothing: the package the model was sent holds every figure this bundle carries.']] });
  if (payload.demoNotice) out.push({ type: 'box', title: 'DEMO CONTENT', lines: [payload.demoNotice] });
  out.push({ type: 'paragraph', text: 'The charts on the evidence pages plot every point the publisher returned. A sentence above was written from the points its package held, which the line just above names when they were fewer than a chart shows.' });

  if (payload.findings.length === 0) {
    out.push({ type: 'paragraph', text: payload.rejected.length === 0 ? 'The model returned no claim for this scope. The published figures stand on their own.' : `The model wrote ${payload.rejected.length} claim${payload.rejected.length === 1 ? '' : 's'} and the evidence check supported none of them, so none is printed here.` });
  }

  for (const finding of payload.findings) out.push(findingBlock(finding));

  if (payload.rejected.length > 0) {
    out.push({ type: 'subheading', text: `Dropped by the evidence check (${payload.rejected.length})` });
    for (const rejected of payload.rejected) {
      out.push({ type: 'bullet', text: `“${rejected.preview}”${rejected.cites.length ? ` [cites: ${rejected.cites.join(', ')}]` : ''} — ${rejected.reason}` });
    }
  }

  out.push({ type: 'paragraph', text: 'Recommendations above are advice, not measurements: each is labelled, cites the figures it rests on, and states what is uncertain about it.' });
  return out;
}

function findingBlock(finding: ReportFinding): PdfBlock {
  return {
    type: 'kv',
    rows: [
      [FINDING_KIND_LABEL[finding.kind], finding.text],
      ['Cites', finding.cites.join(', ') || 'nothing — an uncited claim is not printed'],
      ['Written by', finding.generatedBy ?? NOT_STATED],
    ],
  };
}

function sourceBlocks(register: ReportBundle['meta']['sourceRegister']): PdfBlock[] {
  const out: PdfBlock[] = [
    { type: 'heading', text: '4.0 Sources and methodology' },
    { type: 'paragraph', text: 'One line per evidence id in this bundle, taken from the source register the orchestrator built. Where a field is empty the register does not carry it, and this page says so rather than filling it in.' },
    {
      type: 'table',
      head: ['Evidence id', 'Source', 'Licence or attribution required', 'Link the publisher gives'],
      rows: register.map((e) => [e.evidenceId, orNotSupplied(e.source), orNotSupplied(e.license), orNotSupplied(e.sourceUrl)]),
      theme: 'striped',
      headerColor: BLUE,
      columnWidths: [34, 40, 46, 40],
      fontSize: 6,
    },
    {
      type: 'table',
      head: ['Evidence id', 'Kind of value', 'Coverage', 'Spatial basis', 'Observed / published', 'Retrieved', 'Status'],
      rows: register.map((e) => [
        e.evidenceId,
        `${VALUE_KIND_WORD[e.valueKind] ?? e.valueKind} (${e.valueKind})`,
        orNotSupplied(e.coverage),
        SPATIAL_WORD[e.spatial] ?? e.spatial,
        e.observedAt ?? NOT_STATED,
        stamp(e.retrievedAt),
        e.state === 'unavailable' ? `did not answer — ${e.detail}` : e.stale || e.state === 'stale' ? `behind schedule — ${e.detail}` : `answered — ${e.detail}`,
      ]),
      theme: 'grid',
      headerColor: EMERALD,
      columnWidths: [26, 20, 24, 20, 22, 18, 30],
      fontSize: 6,
    },
  ];

  const units = register.filter((e) => e.units.trim() !== '');
  if (units.length > 0) {
    out.push({ type: 'subheading', text: 'Units as published' });
    out.push(...units.map((e) => ({ type: 'bullet' as const, text: `${e.evidenceId}: ${e.units}` })));
  }
  out.push({ type: 'paragraph', text: 'Licences and links above are the strings the connectors were given by their publishers. No licence, link, verification status or observation date has been added to this page that the register does not already hold.' });
  return out;
}

function closingBlocks(meta: ReportBundle['meta']): PdfBlock[] {
  const attribution = meta.attribution;
  return [
    { type: 'heading', text: '5.0 Report status' },
    {
      type: 'kv',
      rows: [
        ['Reference', `${meta.reference} — a lookup key for the sources page above. It is not a signature, a seal or an authorisation.`],
        ['Generated', stamp(meta.generatedAt)],
        ['Workspace', meta.mode === 'demo' ? 'DEMO. Every figure in this file is demo content, and every page says so.' : 'Production'],
        ['Authentication', attributionLine(attribution)],
        ['This file is', 'not signed, not sealed and not encrypted. Nothing in it is a substitute for a figure a publisher did not supply.'],
      ],
    },
    { type: 'box', title: 'How to read this report', lines: ['A dash means no value was published. A section labelled Not available was not filled in from anywhere else.', 'A figure marked Derived was computed by this application from the rows it names. A figure marked Modelled or Forecast is not a measurement.', 'The scope line on each page names how wide a claim the evidence supports. A pixel, a market and a national survey are not interchangeable.'] },
  ];
}

/* ---------------------------------------------------------------- helpers ---------------------------------------------------------------- */

function provenanceRows(provenance: Provenance, provider: string): [string, string][] {
  return [
    ['Source', `${provenance.source}${provider === provenance.source ? '' : ` (${provider})`}`],
    ['What it is', `${VALUE_KIND_WORD[provenance.valueKind] ?? provenance.valueKind} — ${provenance.methodology}`],
    ['Units', orNotSupplied(provenance.units)],
    ['Coverage', orNotSupplied(provenance.coverage)],
    ['Observed / published', provenance.observedAt ?? NOT_STATED],
    ['Retrieved by this server', stamp(provenance.retrievedAt)],
    ['Freshness', `${provenance.stale ? 'BEHIND SCHEDULE' : 'within the source’s own freshness window'} (max age ${Math.round(provenance.maxAgeSeconds / 60)} min)${provenance.servedFromCache ? ', served from this server’s cache' : ''}`],
    ['Quality', provenance.quality],
    ['Licence', orNotSupplied(provenance.license)],
  ];
}

function coverAttribution(attribution: ReportAttribution): PdfCoverColumn {
  if (attribution.verified && attribution.displayName) {
    return { heading: 'REQUESTED BY (CONFIRMED SESSION)', lines: [attribution.displayName.toUpperCase(), attribution.note] };
  }
  return { heading: 'AUTHENTICATION', lines: ['NO CONFIRMED SESSION', attribution.note] };
}

function attributionLine(attribution: ReportAttribution): string {
  if (attribution.verified) {
    return `Confirmed session${attribution.displayName ? `: ${attribution.displayName}` : ' (the confirmed account carries no display name)'}. ${attribution.note}`;
  }
  return `Unverified. ${attribution.note} No name, signature or authorisation is printed for this report.`;
}

function scopeWords(scope: ReportScope): string {
  const coordinate = scope.location ? `(${round(scope.location.latitude)}, ${round(scope.location.longitude)})` : '(coordinates unavailable)';
  if (scope.kind === 'market') return `${scope.place ?? 'the market asked for'} — one surveyed market`;
  if (scope.kind === 'region') return `${scope.region ?? 'the region asked for'} — regional markets, read at ${scope.place ?? 'no catalogue centre'}`;
  if (scope.kind === 'coordinate') return `${scope.location?.name ?? 'the given point'} ${coordinate} — a point between markets`;
  return 'Ethiopia — national survey';
}

function bundleCaveats(view: ReturnType<typeof describeReport>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const section of view.sections) {
    for (const caveat of section.caveats) {
      if (!seen.has(caveat)) {
        seen.add(caveat);
        out.push(`${section.title}: ${caveat}`);
      }
    }
    for (const evidence of section.evidence) {
      if (evidence.error) out.push(`${evidence.provider} did not answer: ${evidence.error.message}`);
    }
  }
  return out;
}

function truncatedTables(view: ReturnType<typeof describeReport>): string[] {
  const out: string[] = [];
  for (const section of view.sections) {
    for (const evidence of section.evidence) {
      for (const table of evidence.tables) {
        if (table.rowsOmitted > 0) out.push(`${table.title} (${table.evidenceId}): ${table.rowsOmitted} row${table.rowsOmitted === 1 ? '' : 's'} not shown — ${table.omissionNote ?? 'capped for page space'}.`);
      }
    }
  }
  return out;
}

/** The panel prints a null cell the same way; the PDF must not be freer with a publisher's blanks. */
function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return NO_VALUE;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function orNotSupplied(value: string): string {
  return value.trim() === '' ? 'not supplied' : value;
}

function round(value: number): string {
  return value.toFixed(4);
}

/**
 * Render a date the bundle carries. Nothing here asks the clock: a bare `YYYY-MM-DD` published
 * date is printed as a date (a publisher's day is not a moment in some timezone), while a full
 * timestamp is printed in the report's own reference zone so an as-of time is not read as local.
 */
function stamp(value: string | null): string {
  if (!value) return NOT_STATED;
  const dateOnly = value.length === 10;
  const parsed = Date.parse(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed)) return value;
  const date = new Intl.DateTimeFormat('en-GB', dateOnly
    ? { timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit' }
    : { timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' },
  ).format(new Date(parsed));
  return dateOnly ? `${date} (published date, no time given)` : `${date} ET`;
}

function safe(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}
