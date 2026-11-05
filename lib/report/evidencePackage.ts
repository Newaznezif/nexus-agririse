import type { QualityTier, ValueKind } from '@/lib/data/types';
import type { ReportBundle, ReportFinding, ReportMode, ReportSectionId, SpatialBasis } from './types';

/**
 * The interface between the assembled bundle and anything that has to *read* it: the AI layer and
 * the report's own summary page.
 *
 * It is a projection, not a second source of numbers — every fact here is copied out of the
 * bundle with the evidence id it came from, so a model can only be handed figures the connectors
 * actually returned, and a returned sentence can be checked back against them. This is also the
 * reason an AI outage is survivable: the bundle stands alone, and the sentences a model writes come
 * back as a separate payload instead of being folded into it.
 */

export interface EvidenceFact {
  evidenceId: string;
  /** One figure, in one sentence, with its units inside it. */
  statement: string;
  value: number | null;
  units: string;
  valueKind: ValueKind;
  spatial: SpatialBasis;
  coverage: string;
  source: string;
  observedAt: string | null;
  /** `null` for a publisher that never delivered: an evidence fact from a non-answer does not exist, and a gap is recorded instead. */
  retrievedAt: string | null;
  stale: boolean;
  quality: QualityTier;
}

export interface EvidenceGap {
  evidenceId: string;
  reason: string;
}

export interface EvidencePackage {
  reference: string;
  generatedAt: string;
  mode: ReportMode;
  scope: string;
  scopeNote: string | null;
  staleSources: string[];
  /** Non-null for a demo package: the exact wording the report prints, reused by the prompt. */
  demoNotice: string | null;
  facts: EvidenceFact[];
  gaps: EvidenceGap[];
  /** Constraints sent with the package, so they travel with the evidence instead of living only in a prompt file. */
  rules: string[];
  /** How the fact list was chosen. Printed even when nothing was dropped, so coverage claims are checkable. */
  selection: string;
  /** Set when the projection itself had to stop early — the package is then not complete. */
  truncated: string | null;
}

interface Candidate {
  fact: EvidenceFact;
  /** Index in bundle order, so the surviving facts can be re-sorted back into it. */
  position: number;
}

interface FactGroup {
  sectionId: ReportSectionId;
  evidenceId: string;
  candidates: Candidate[];
}

/**
 * Spend the budget in rotation rather than in one long sweep: with the old first-come-first-served
 * loop a wide market table could consume all 180 slots and leave the satellite and macro sections
 * unrepresented, which reads to a model as "those sources had nothing to say". Rotation guarantees
 * each answering item appears before any item is quoted twice.
 */
function allocateGroups(groups: FactGroup[], budget: number): { facts: EvidenceFact[]; omitted: { evidenceId: string; kept: number; total: number }[] } {
  const cursors = groups.map(() => 0);
  const chosen: Candidate[] = [];
  for (;;) {
    let took = false;
    for (let g = 0; g < groups.length && chosen.length < budget; g++) {
      const cursor = cursors[g];
      if (cursor < groups[g].candidates.length) {
        chosen.push(groups[g].candidates[cursor]);
        cursors[g] = cursor + 1;
        took = true;
      }
    }
    if (!took || chosen.length >= budget) break;
  }
  chosen.sort((a, b) => a.position - b.position);
  const omitted = groups
    .map((group, g) => ({ evidenceId: group.evidenceId, kept: cursors[g], total: group.candidates.length }))
    .filter((o) => o.kept < o.total);
  return { facts: chosen.map((c) => c.fact), omitted };
}

const MAX_FACTS = 180;
const MAX_POINTS_PER_SERIES = 12;

/**
 * How the budget is spent, stated once so the prompt, the docs and the tests describe the same
 * thing: candidates are taken one per evidence item in rotation, and the survivors are then
 * emitted in bundle order. Rotation decides *who is cut*; the bundle decides *reading order*.
 */
export const FACT_SELECTION = `Round-robin across the evidence items that answered, ${MAX_FACTS} facts in total: every item contributes one fact before any item contributes a second, then the selected facts are re-ordered as the bundle holds them. Selection is deterministic — the same bundle always produces the same package.`;

export const EVIDENCE_RULES = [
  'Every sentence you return must cite one or more evidenceIds from this package. A sentence that cites nothing must be dropped, not softened.',
  'Never state a figure that is not in this package. If the package has no value for something, say the source did not answer.',
  'Values carry their own kind: forecast is not observation, modeled is reanalysis rather than measurement, and estimated was computed by this application from the cited rows.',
  'Do not claim causation from coincidence. Two series moving in the same window is a correlation, and the package contains no experiment that could separate them.',
  'Do not widen a scope. A figure marked single-pixel describes one satellite pixel, market describes one surveyed market, and national-survey describes an average across markets — none of them describes a specific field.',
  'Prices in this package are WFP survey observations in ETB per the published unit. Never convert a unit, never present an international benchmark as an Ethiopian market price.',
  'Risk levels and trend directions must be derived from cited numbers, and the derivation stated. A label with no figure behind it is not an insight.',
  'When a fact is marked stale, or its observedAt is older than the report window, print the as-of date in the sentence instead of describing it as current.',
  'Write "recommend" or "consider" for advice, and mark it as a recommendation. Advice is not a measurement, and it must still cite the figures it rests on while stating what is uncertain.',
  'If the package is a demo bundle, say so in every claim drawn from it. Demo rows are samples and are never publisher evidence.',
  'Never use "verified", "certified", "signed", "guaranteed" or similar status words. Nothing in this package carries that authority.',
];

export function buildEvidencePackage(bundle: ReportBundle): EvidencePackage {
  const gaps: EvidenceGap[] = [];
  const groups: FactGroup[] = [];
  const cappedSeries: { evidenceId: string; series: string; total: number; kept: number }[] = [];
  /** Candidates keep the place they held in the bundle, so the survivors read in bundle order. */
  let position = 0;

  for (const section of bundle.sections) {
    if (section.status === 'unavailable') {
      gaps.push({ evidenceId: `section.${section.id}`, reason: section.unavailableReason ?? 'No source answered for this section.' });
    }

    for (const item of section.evidence) {
      if (item.error) {
        gaps.push({ evidenceId: item.evidenceId, reason: `${item.provider} did not answer: ${item.error.message}` });
        continue;
      }

      // One group per evidence item — the citation unit, and therefore the unit the budget is shared across.
      const candidates: Candidate[] = [];
      const collect = (fact: EvidenceFact) => {
        candidates.push({ fact, position: position++ });
      };

      for (const figure of item.derived) {
        if (figure.value === null) {
          gaps.push({ evidenceId: figure.evidenceId, reason: `${figure.label} could not be computed from the rows available.` });
          continue;
        }
        collect({
          evidenceId: figure.evidenceId,
          statement: `${figure.label}: ${figure.value} ${figure.units}. Formula: ${figure.formula}`,
          value: figure.value,
          units: figure.units,
          valueKind: figure.valueKind,
          spatial: section.scope.spatial,
          coverage: figure.provenance.coverage,
          source: `${figure.provenance.source} (computed by Nexus AgriRise)`,
          observedAt: figure.provenance.observedAt,
          retrievedAt: figure.provenance.retrievedAt,
          stale: figure.provenance.stale,
          quality: figure.quality,
        });
      }

      for (const table of item.tables) {
        if (table.rows.length === 0) {
          gaps.push({ evidenceId: table.evidenceId, reason: `${table.title} has no rows: the publisher returned none for this scope.` });
          continue;
        }
        for (const row of table.rows) {
          const readable = table.columns
            .map((c) => `${c.label} ${formatCell(row[c.key])}${c.units ? ` ${c.units}` : ''}`)
            .join('; ');
          collect({
            evidenceId: table.evidenceId,
            statement: `${table.title} — ${readable}`,
            // A row-level fact has no single scalar; the leading numeric cell is the one a
            // sentence would quote, and it is named in the statement so nothing is implied.
            value: leadingNumber(row, table),
            units: unitsForLeadingNumber(table),
            valueKind: table.provenance.valueKind,
            spatial: section.scope.spatial,
            coverage: table.provenance.coverage,
            source: table.provenance.source,
            observedAt: table.provenance.observedAt,
            retrievedAt: table.provenance.retrievedAt,
            stale: table.provenance.stale,
            quality: table.provenance.quality,
          });
        }
      }

      for (const chart of item.charts) {
        if (chart.unavailableReason) {
          gaps.push({ evidenceId: chart.evidenceId, reason: chart.unavailableReason });
          continue;
        }
        for (const series of chart.series) {
          const points = series.points.slice(-MAX_POINTS_PER_SERIES);
          if (series.points.length > points.length) {
            cappedSeries.push({
              evidenceId: chart.evidenceId,
              series: series.label,
              total: series.points.length,
              kept: points.length,
            });
          }
          for (const point of points) {
            collect({
              evidenceId: chart.evidenceId,
              statement: `${chart.title}, ${series.label} at ${point.x}: ${point.y === null ? 'no value published' : `${point.y} ${chart.units}`}`,
              value: point.y,
              units: chart.units,
              valueKind: chart.valueKind,
              spatial: chart.spatial,
              coverage: chart.provenance?.coverage ?? item.provenance.coverage,
              source: item.provenance.source,
              observedAt: chart.provenance?.observedAt ?? null,
              retrievedAt: item.provenance.retrievedAt,
              stale: item.provenance.stale,
              quality: item.provenance.quality,
            });
          }
        }
      }

      if (candidates.length > 0) {
        groups.push({ sectionId: section.id, evidenceId: item.evidenceId, candidates });
      }
    }
  }

  const { facts, omitted } = allocateGroups(groups, MAX_FACTS);
  const factBudgetNote = omitted.length === 0
    ? null
    : `Fact budget of ${MAX_FACTS} reached. ${FACT_SELECTION} Omitted: ${omitted.map((o) => `${o.evidenceId} kept ${o.kept} of ${o.total}`).join(', ')}. The gap list below is complete; only figures were dropped.`;
  /**
   * The series cap is disclosed in the same field the prompt and the page already read, rather than
   * a new one: the model must know that "the last 12 points" is not "the whole series", and a PDF
   * that plots every published point has to say its chart holds more points than the sentence did.
   */
  const seriesCapNote = cappedSeries.length === 0
    ? null
    : `Series are sent as their ${MAX_POINTS_PER_SERIES} most recent points only. Cut short: ${cappedSeries.map((c) => `${c.evidenceId} series "${c.series}" kept ${c.kept} of ${c.total}`).join('; ')}. A chart in the report can therefore hold points this package never saw.`;
  const truncated = [factBudgetNote, seriesCapNote].filter((n): n is string => n !== null).join(' ') || null;

  return {
    reference: bundle.meta.reference,
    generatedAt: bundle.meta.generatedAt,
    mode: bundle.meta.mode,
    scope: describeScopeLine(bundle),
    scopeNote: bundle.meta.scope.note,
    staleSources: [...new Set(bundle.meta.sourceRegister.filter((e) => e.stale).map((e) => e.source))],
    /** Travels with the package so a demo claim can never be read as publisher evidence. */
    demoNotice: bundle.meta.demoNotice,
    facts,
    gaps,
    rules: EVIDENCE_RULES,
    selection: FACT_SELECTION,
    truncated,
  };
}

/**
 * A finding is only usable if every citation resolves to evidence that actually answered.
 * Phase 4 rejects what fails here; keeping the check next to the projection means the rule
 * cannot drift from the format.
 */
export function citationErrors(bundle: ReportBundle, findings: ReportFinding[]): string[] {
  const answerable = new Set<string>();
  const failed = new Set<string>();
  for (const section of bundle.sections) {
    answerable.add(`section.${section.id}`);
    for (const item of section.evidence) {
      (item.error ? failed : answerable).add(item.evidenceId);
      for (const t of item.tables) answerable.add(t.evidenceId);
      for (const c of item.charts) if (!c.unavailableReason) answerable.add(c.evidenceId);
      for (const d of item.derived) answerable.add(d.evidenceId);
    }
  }

  const errors: string[] = [];
  for (const finding of findings) {
    if (finding.cites.length === 0) errors.push(`${finding.evidenceId}: a finding with no citation cannot be printed.`);
    for (const cite of finding.cites) {
      if (failed.has(cite)) errors.push(`${finding.evidenceId}: cites ${cite}, which did not answer.`);
      else if (!answerable.has(cite)) errors.push(`${finding.evidenceId}: cites ${cite}, which is not in this bundle.`);
    }
  }
  return errors;
}

function formatCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return 'not published';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/** The first numeric cell in the row, which is what a sentence about that row would quote. */
function leadingNumber(row: Record<string, string | number | boolean | null>, table: { columns: { key: string; units: string | null }[] }): number | null {
  for (const column of table.columns) {
    const value = row[column.key];
    if (typeof value === 'number') return value;
  }
  return null;
}

function unitsForLeadingNumber(table: { columns: { key: string; units: string | null }[] }): string {
  for (const column of table.columns) {
    if (column.units) return column.units;
  }
  return 'units as stated in the statement';
}

function describeScopeLine(bundle: ReportBundle): string {
  const s = bundle.meta.scope;
  if (s.kind === 'market') return `Market: ${s.place}${s.region ? `, ${s.region}` : ''}`;
  if (s.kind === 'region') return `Region: ${s.region} (markets surveyed within it)`;
  if (s.kind === 'national') return 'Ethiopia, national survey';
  return s.location ? `Coordinate ${s.location.latitude.toFixed(4)}, ${s.location.longitude.toFixed(4)}` : 'Unspecified scope';
}
