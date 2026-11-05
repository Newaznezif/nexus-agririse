import type { ValueKind } from '@/lib/data/types';
import type { ReportBundle, ReportFinding, ReportMode } from '@/lib/report/types';
import { citationErrors, type EvidenceFact, type EvidenceGap, type EvidencePackage } from '@/lib/report/evidencePackage';

/**
 * The Phase 4 gate: what the model is allowed to hand back, and what has to survive inspection
 * before any of it reaches a page.
 *
 * The package (`lib/report/evidencePackage.ts`) is the only thing a model is shown, so this module
 * can treat that package as the set of sayable facts. Nothing here softens a bad claim: a sentence
 * that fails is *omitted* and reported as omitted, because a rewritten claim would still be the
 * model's invention. The checks are lexical and deliberately conservative — they catch the shapes
 * we can name (an unmatched figure, a cite that was never sent, a forecast described as measured),
 * not every possible paraphrase of them, which is why the UI always prints the cited facts next to
 * the sentence rather than trusting the sentence alone.
 */

export const MAX_FINDINGS = 8;

/** What the model is asked for: one claim, the evidence it rests on, and how it is qualified. */
export interface FindingDraft {
  text: string;
  cites: string[];
  kind: 'observation' | 'interpretation' | 'recommendation';
}

export interface RejectedDraft {
  /** Whatever was readable of the claim, so a reviewer can see what was dropped. */
  preview: string;
  cites: string[];
  reason: string;
}

export interface ValidatedFindings {
  accepted: ReportFinding[];
  rejected: RejectedDraft[];
  /** True when the model answered with nothing that survived — an empty insight, not a fake one. */
  empty: boolean;
}

export type ParseOutcome = { ok: true; drafts: unknown[] } | { ok: false; error: string };

/**
 * What `POST /api/report/insights` returns. It is defined next to the validator because it is the
 * validator's output shaped for a page: the sentences that passed, the sentences that did not with
 * the reason, and only the evidence needed to resolve a citation — the client already holds the
 * bundle, so re-sending it would be a second copy of the same facts.
 */
export interface InsightsPayload {
  reference: string;
  generatedAt: string;
  mode: ReportMode;
  scope: string;
  /** Null for a production read; the demo wording must reach the page with the sentence. */
  demoNotice: string | null;
  selection: string;
  truncated: string | null;
  model: string;
  findings: ReportFinding[];
  rejected: RejectedDraft[];
  /** The facts the accepted findings cite, so a chip can show the figure behind a sentence. */
  cited: EvidenceFact[];
  /** Only the gaps an accepted finding names — a limitation the page must be able to point at. */
  gaps: EvidenceGap[];
}

export function buildInsightsPayload(
  pkg: EvidencePackage,
  findings: ValidatedFindings,
  model: string,
): InsightsPayload {
  const citedIds = new Set(findings.accepted.flatMap((f) => f.cites));
  return {
    reference: pkg.reference,
    generatedAt: pkg.generatedAt,
    mode: pkg.mode,
    scope: pkg.scope,
    demoNotice: pkg.demoNotice,
    selection: pkg.selection,
    truncated: pkg.truncated,
    model,
    findings: findings.accepted,
    rejected: findings.rejected,
    cited: pkg.facts.filter((fact) => citedIds.has(fact.evidenceId)),
    gaps: pkg.gaps.filter((gap) => citedIds.has(gap.evidenceId)),
  };
}

const KINDS = ['observation', 'interpretation', 'recommendation'] as const;

/** Words that claim a status the evidence package cannot confer. */
const STATUS_LANGUAGE = /\b(verified|verifiable|certified|certification|digitally signed|signed|notarized|guaranteed|guarantee|authorised|authorized|tamper-proof|official)\b/i;

const FORECAST_LANGUAGE = /\b(forecast|projected|projection|predicted|prediction|outlook)\b/i;
const MEASUREMENT_LANGUAGE = /\b(measured|measurement|observed|observation|recorded|reading|reading of|surveyed)\b/i;
const ESTIMATE_LANGUAGE = /\b(estimated|estimate|computed|derived|modelled|modeled|reanalysis|imputed)\b/i;

/** Coverage the sentence claims, and the spatial basis that could support it. */
const NATIONAL_LANGUAGE = /\b(nationwide|country-wide|countrywide|across the country|throughout ethiopia|all markets|the whole country|national average)\b/i;
const REGION_LANGUAGE = /\b(region-wide|across the region|the region|regional average|regional figure|throughout the region|region average)\b/i;
const FIELD_LANGUAGE = /\b(this field|your field|your plot|this plot|the farm|this farm|your farm|on this parcel|field-level|my plot)\b/i;

const TREND_UP = /\b(rose|rising|rise|increased|increases|increasing|climbed|climbing|surged|surge|grew|growth|higher|upward|trending up)\b/i;
const TREND_DOWN = /\b(fell|falling|fall|decreased|decreases|decreasing|declined|decline|dropped|drop|lower|downward|trending down)\b/i;

const UNCERTAINTY_LANGUAGE = /\b(may|might|could|likely|unlikely|uncertain|uncertainty|assuming|assumption|if |when |depends|subject to|at most|roughly|appears|suggests|insufficient|not enough|no data|did not answer|unavailable|stale)\b/i;
const RECOMMENDATION_LABEL = /\b(recommend|recommended|we suggest|consider|should|plan to|prioritize|prioritise|prepare)\b/i;

const DATE_IN_TEXT = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b|\b\d{4}\b/i;

/**
 * Accept either `{"findings":[...]}` or a bare array, with or without a markdown fence — the same
 * tolerance `services/ai.ts` learned from the provider, without its habit of guessing at content.
 */
export function parseFindingsPayload(raw: string): ParseOutcome {
  if (!raw || raw.trim() === '') return { ok: false, error: 'The provider returned no text.' };
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const candidate = body.startsWith('{') || body.startsWith('[') ? body : (body.match(/[\[{][\s\S]*[\]}]/) ?? [])[0];
  if (!candidate) return { ok: false, error: 'The provider returned no JSON object.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { ok: false, error: 'The provider returned JSON that does not parse.' };
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { findings?: unknown }).findings;
  if (!Array.isArray(list)) return { ok: false, error: 'The provider returned no findings array.' };
  return { ok: true, drafts: list };
}

/**
 * The whole gate. `bundle` is needed because a citation may point at evidence that exists but never
 * answered, and `pkg` because the package the model was sent is the only set of figures it can cite.
 */
export function validateFindings(
  bundle: ReportBundle,
  pkg: EvidencePackage,
  drafts: unknown[],
  generatedBy: string,
): ValidatedFindings {
  const byId = new Map<string, EvidenceFact[]>();
  for (const fact of pkg.facts) {
    const list = byId.get(fact.evidenceId);
    if (list) list.push(fact);
    else byId.set(fact.evidenceId, [fact]);
  }
  const gapIds = new Set(pkg.gaps.map((g) => g.evidenceId));
  const sectionIds = new Set(bundle.sections.map((s) => `section.${s.id}`));

  const accepted: ReportFinding[] = [];
  const rejected: RejectedDraft[] = [];
  const shaped: ReportFinding[] = [];

  drafts.forEach((raw, index) => {
    const id = `finding-${index + 1}`;
    const draft = readDraft(raw);
    if (!draft) {
      rejected.push({ preview: previewOf(raw), cites: [], reason: draftReason(raw) });
      return;
    }
    if (shaped.length + rejected.length >= MAX_FINDINGS) {
      rejected.push({ preview: draft.text.slice(0, 160), cites: draft.cites, reason: `Over the ${MAX_FINDINGS}-finding limit for one request.` });
      return;
    }
    shaped.push({ ...draft, evidenceId: id, generatedBy });
  });

  // Reuse the Phase 2 citation check rather than redefining what a resolvable citation is.
  const citationProblems = new Map<string, string[]>();
  for (const message of citationErrors(bundle, shaped)) {
    const id = message.split(':')[0];
    const list = citationProblems.get(id);
    if (list) list.push(message.slice(id.length + 2));
    else citationProblems.set(id, [message.slice(id.length + 2)]);
  }

  for (const finding of shaped) {
    const problems = [...(citationProblems.get(finding.evidenceId) ?? [])];
    for (const cite of finding.cites) {
      if (!byId.has(cite) && !gapIds.has(cite) && !sectionIds.has(cite)) {
        problems.push(`cites ${cite}, which is in the bundle but carried nothing for this package — the model was never shown a figure under that id.`);
      }
    }
    const cited = finding.cites.flatMap((cite) => byId.get(cite) ?? []);
    problems.push(...statusProblems(finding));
    problems.push(...scopeProblems(finding, cited));
    problems.push(...figureProblems(finding, cited));
    problems.push(...kindProblems(finding, cited));
    problems.push(...staleProblems(finding, cited));
    problems.push(...trendProblems(finding, cited));
    if (pkg.demoNotice && !/\b(demo|sample|illustrative)\b/i.test(finding.text)) {
      problems.push('drawn from a demo package but not labelled as one.');
    }
    if (finding.kind === 'recommendation') {
      if (!RECOMMENDATION_LABEL.test(finding.text)) problems.push('is advice that does not read as advice.');
      if (!UNCERTAINTY_LANGUAGE.test(finding.text)) problems.push('recommends without stating what is uncertain.');
    }

    if (problems.length > 0) {
      rejected.push({ preview: finding.text.slice(0, 160), cites: finding.cites, reason: problems.join(' ') });
      continue;
    }
    accepted.push(finding);
  }

  return { accepted, rejected, empty: accepted.length === 0 };
}

function readDraft(raw: unknown): Omit<ReportFinding, 'evidenceId' | 'generatedBy'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  const kind = KINDS.includes(record.kind as (typeof KINDS)[number]) ? (record.kind as FindingDraft['kind']) : null;
  const cites = Array.isArray(record.cites)
    ? [...new Set(record.cites.filter((c): c is string => typeof c === 'string' && c.trim() !== '').map((c) => c.trim()))]
    : [];
  if (!text || !kind) return null;
  return { text, cites, kind };
}

function draftReason(raw: unknown): string {
  if (typeof raw === 'string') return 'is a bare string with no citations attached.';
  if (!raw || typeof raw !== 'object') return 'is not an object.';
  const record = raw as Record<string, unknown>;
  if (typeof record.text !== 'string' || record.text.trim() === '') return 'has no sentence to print.';
  return 'has no kind, or a kind outside observation / interpretation / recommendation.';
}

function previewOf(raw: unknown): string {
  if (typeof raw === 'string') return raw.slice(0, 160);
  if (raw && typeof raw === 'object') {
    const text = (raw as Record<string, unknown>).text;
    if (typeof text === 'string') return text.slice(0, 160);
  }
  return '(unreadable draft)';
}

function statusProblems(finding: ReportFinding): string[] {
  const match = finding.text.match(STATUS_LANGUAGE);
  return match
    ? [`claims the status "${match[0]}", which no evidence in this package can confer.`]
    : [];
}

function scopeProblems(finding: ReportFinding, cited: EvidenceFact[]): string[] {
  const problems: string[] = [];
  const spatials = new Set(cited.map((f) => f.spatial));
  if (FIELD_LANGUAGE.test(finding.text)) {
    problems.push('describes a specific field or plot; no evidence in this package measures one.');
  }
  if (NATIONAL_LANGUAGE.test(finding.text) && !spatials.has('national-survey')) {
    problems.push(`claims national coverage while citing ${[...spatials].join(', ') || 'nothing spatial'}.`);
  }
  if (REGION_LANGUAGE.test(finding.text) && spatials.size > 0 && !spatials.has('region-markets') && !spatials.has('national-survey')) {
    problems.push(`claims regional coverage while citing ${[...spatials].join(', ')}, which is finer than a region.`);
  }
  return problems;
}

/** Every figure in the sentence must be a figure the model was actually shown. */
function figureProblems(finding: ReportFinding, cited: EvidenceFact[]): string[] {
  if (cited.length === 0) return [];
  const allowed = new Set<string>();
  for (const fact of cited) {
    if (fact.value !== null) allowed.add(normalizeNumber(String(fact.value)));
    for (const token of fact.statement.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []) allowed.add(normalizeNumber(token));
    for (const date of [fact.observedAt, fact.retrievedAt]) {
      if (!date) continue;
      for (const token of date.match(/\d+/g) ?? []) allowed.add(normalizeNumber(token));
    }
  }
  const offenders: string[] = [];
  for (const token of finding.text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []) {
    if (!allowed.has(normalizeNumber(token))) offenders.push(token);
  }
  return offenders.length === 0
    ? []
    : [`states ${[...new Set(offenders)].join(', ')}, which appears in no fact it cites.`];
}

function kindProblems(finding: ReportFinding, cited: EvidenceFact[]): string[] {
  if (cited.length === 0) return [];
  const kinds = new Set(cited.map((f) => f.valueKind));
  const problems: string[] = [];
  if (FORECAST_LANGUAGE.test(finding.text) && !kinds.has('forecast')) {
    problems.push('reads as a forecast while citing no forecast value.');
  }
  if (MEASUREMENT_LANGUAGE.test(finding.text) && kinds.size > 0 && !kinds.has('observed')) {
    problems.push(`reads as a measurement while citing only ${[...kinds].join(', ')}.`);
  }
  if (ESTIMATE_LANGUAGE.test(finding.text) && !hasEstimate(kinds)) {
    problems.push('calls a figure estimated or modeled when the cited value is not.');
  }
  return problems;
}

function hasEstimate(kinds: Set<ValueKind>): boolean {
  return kinds.has('estimated') || kinds.has('modeled') || kinds.has('imputed');
}

function staleProblems(finding: ReportFinding, cited: EvidenceFact[]): string[] {
  const stale = cited.filter((f) => f.stale);
  if (stale.length === 0 || DATE_IN_TEXT.test(finding.text)) return [];
  const asOf = stale.map((f) => f.observedAt).filter((d): d is string => Boolean(d))[0];
  return [
    `uses stale evidence (${[...new Set(stale.map((f) => f.source))].join(', ')}) as though it were current; state its as-of date${asOf ? `, ${asOf}` : ''} or drop the claim.`,
  ];
}

/**
 * A direction claim needs at least two periods from one cited source, and the periods have to agree
 * with it. Where the cited rows are one snapshot, the direction is not supported at all.
 */
function trendProblems(finding: ReportFinding, cited: EvidenceFact[]): string[] {
  const up = TREND_UP.test(finding.text);
  const down = TREND_DOWN.test(finding.text);
  if (!up && !down) return [];
  const byEvidence = new Map<string, EvidenceFact[]>();
  for (const fact of cited) {
    if (fact.value === null) continue;
    const list = byEvidence.get(fact.evidenceId);
    if (list) list.push(fact);
    else byEvidence.set(fact.evidenceId, [fact]);
  }
  const series = [...byEvidence.values()].filter((list) => list.length >= 2);
  if (series.length === 0) return ['states a direction while citing figures from a single period.'];
  for (const list of series) {
    const dates = list.map((f) => f.observedAt ?? '');
    if (dates.every((d) => d === dates[0])) continue;
    const ordered = [...list].sort((a, b) => (a.observedAt ?? '').localeCompare(b.observedAt ?? ''));
    const first = ordered[0].value as number;
    const last = ordered[ordered.length - 1].value as number;
    if (up && last < first) return [`says the figure rose, but the cited series moves from ${first} to ${last}.`];
    if (down && last > first) return [`says the figure fell, but the cited series moves from ${first} to ${last}.`];
  }
  return [];
}

function normalizeNumber(token: string): string {
  const value = Number(token.replace(/,/g, ''));
  return Number.isFinite(value) ? String(value) : token;
}
