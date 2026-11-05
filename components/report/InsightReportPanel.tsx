'use client';
import React, { useState } from 'react';

import { useDemoMode } from '@/context/DemoModeContext';
import { KIND_LABEL, ProvenanceLabel, SourceUnavailable } from '@/components/data/ProvenanceLabel';
import { LocationPicker, type SelectedPlace } from '@/components/data/LocationPicker';
import { useLiveData } from '@/hooks/useLiveData';
import { useReportBundle } from '@/hooks/useReportBundle';
import { useReportInsights } from '@/hooks/useReportInsights';
import { generateEvidencePdf } from '@/services/pdfExport';
import { loadUnicodeFont } from '@/services/pdfUnicodeFont';
import { buildReportQuery, REPORT_LIMITS, type ReportQueryInput } from '@/lib/report/request';
import { describeInsights, describeReport, FINDING_KIND_LABEL, type ReportSectionView } from '@/lib/report/reportState';
import type { EvidenceFact } from '@/lib/report/evidencePackage';
import type { RejectedDraft } from '@/lib/report/findings';
import type { ReportFinding, SourceRegisterEntry } from '@/lib/report/types';
import { Download, FileText, Loader2, Sparkles } from 'lucide-react';

/**
 * The report-data API, on the Insights page.
 *
 * Everything here is a view of what `/api/report/insight-data` returned. The panel composes no
 * figure of its own: counts come from the bundle's rows, every statement about a source is that
 * source's own provenance string, and an empty section prints the orchestrator's reason rather
 * than a placeholder.
 *
 * The interpretation block is the only prose on the page, and it is the model's, gated by
 * `lib/report/findings.ts`: each sentence is printed with the evidence it cites and the flags that
 * evidence carries, and the sentences that failed the gate are listed as dropped with their reason.
 *
 * Scope selection is deliberately narrower than the route's grammar. The four chips below are the
 * four scopes `resolveScope` can honour, and a request carries exactly one of them — never a
 * market plus a stale region, which the route would resolve by precedence and the reader would
 * then mislabel.
 */

type ScopeChip = 'market' | 'region' | 'national' | 'coordinate';

const SCOPE_CHIPS: { id: ScopeChip; label: string }[] = [
  { id: 'market', label: 'Market' },
  { id: 'region', label: 'Region' },
  { id: 'national', label: 'National' },
  { id: 'coordinate', label: 'My coordinates' },
];

interface LocationsPayload {
  places: { name: string; admin1: string; admin2: string; latitude: number; longitude: number }[];
  default: { name: string; admin1: string; admin2: string; latitude: number; longitude: number };
  regionNames: string[];
}

const STATE_CLS: Record<SourceRegisterEntry['state'], string> = {
  connected: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
  stale: 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400',
  unavailable: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

const CHIP_CLS = (active: boolean) =>
  `px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-colors ${
    active
      ? 'bg-emerald-600 text-white'
      : 'bg-gray-50 dark:bg-zinc-800 text-gray-500 dark:text-gray-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
  }`;

const FIELD_CLS =
  'w-full px-2.5 py-1.5 rounded-lg text-sm bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none';

export const InsightReportPanel = () => {
  const { isDemoMode } = useDemoMode();
  const locations = useLiveData<LocationsPayload>('/api/data/locations');
  const report = useReportBundle();
  const insights = useReportInsights();

  const [scope, setScope] = useState<ScopeChip>('market');
  const [picked, setPicked] = useState<SelectedPlace | null>(null);
  const [pickedRegion, setPickedRegion] = useState<string | null>(null);
  const [commodity, setCommodity] = useState('');
  const [months, setMonths] = useState(String(REPORT_LIMITS.months.fallback));
  const [composites, setComposites] = useState(String(REPORT_LIMITS.composites.fallback));

  // The starting place and region are read from the fetched payload rather than copied into state
  // by an effect: the publisher's own `default` row is the only coordinate this panel ever offers
  // before a farmer picks one.
  const place = picked ?? (locations.data ? toSelected(locations.data.default) : null);
  const regions = locations.data?.regionNames ?? [];
  const region = pickedRegion ?? regions[0] ?? '';

  // A typed point is not a market town. Moving the chip keeps the label honest: the route reads
  // weather at that point and reports no price row for it, and the panel says so as "My coordinates".
  const pickPlace = (next: SelectedPlace) => {
    setPicked(next);
    if (next.admin1 === null && scope === 'market') setScope('coordinate');
    if (next.admin1 !== null && scope === 'coordinate') setScope('market');
  };

  const blockedHint = () => {
    if (scope === 'market' && (!place || place.admin1 === null)) return 'Pick a market the publisher lists, or switch to My coordinates.';
    if (scope === 'region' && !region) return 'No region is selectable yet.';
    if (scope === 'coordinate' && !place) return 'Enter a latitude and longitude first.';
    return null;
  };
  const blocked = blockedHint();

  const placeHint = () => {
    if (locations.loading) return "Loading the publisher's market list…";
    if (locations.error) return `Market list unavailable: ${locations.error.message}`;
    return 'The publisher list answered with no places, so no market can be named.';
  };

  const given = (): ReportQueryInput => {
    const shared = {
      mode: isDemoMode ? 'demo' as const : 'production' as const,
      commodity: commodity.trim() === '' ? null : commodity.trim(),
      months: numberWithin(months, REPORT_LIMITS.months),
      composites: numberWithin(composites, REPORT_LIMITS.composites),
    };
    // Exactly one scope selector per request.
    if (scope === 'market') return { ...shared, market: place?.name ?? null };
    if (scope === 'region') return { ...shared, region };
    if (scope === 'coordinate') return { ...shared, latitude: place?.latitude ?? null, longitude: place?.longitude ?? null };
    return shared;
  };

  const view = describeReport({ loading: report.loading, error: report.error, bundle: report.bundle });

  // An interpretation belongs to one scope. Changing the scope or rebuilding invalidates the answer
  // already on screen, so the build path drops it rather than letting it linger under a new bundle.
  const build = () => {
    insights.clear();
    report.request(given());
  };

  const insightBlocked = () => {
    if (blocked !== null) return blocked;
    if (report.bundle === null) return 'Build report data first: the model is only ever shown the figures this scope answered.';
    return null;
  };
  const insightView = describeInsights({
    loading: insights.loading,
    error: insights.error,
    payload: insights.payload,
    blocked: insightBlocked(),
  });

  /* ------------------------------------------------------------ export ------------------------------------------------------------ */

  // The PDF is drawn from the bundle this panel is showing, plus the interpretation only when the
  // route returned one for it. Both are React state, so a rebuild that is still in flight cannot
  // export a mixture of the new scope's figures and the old scope's sentences.
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  /**
   * The form can be edited without rebuilding, and the bundle on the page would then belong to a
   * scope the reader no longer sees selected. The query the page was read with is compared with the
   * query the form would send, so an export is always the current selection rather than the last one.
   */
  const formDiverged = (): boolean => report.queriedAs !== null && buildReportQuery(given()) !== report.queriedAs;

  const exportBlocked = (): string | null => {
    if (report.loading) return 'Report data is still being read. Export waits for a complete bundle.';
    if (insights.loading) return 'The interpretation is still arriving. Export waits so its sentences are in the file.';
    if (view.state === 'idle') return 'Build report data first. An empty file is not a report.';
    if (view.state === 'error') return 'The last read failed, so there is nothing to export.';
    if (view.state === 'no-data') return 'No publisher answered this scope. A report with no evidence would be a blank page with our name on it.';
    if (formDiverged()) return 'The form no longer matches the read on the page. Build report data first, so the file is the scope you are looking at.';
    return null;
  };
  const exportHint = exportBlocked();

  const exportPdf = async () => {
    const bundle = report.bundle;
    if (!bundle || exportHint !== null) return;
    setExporting(true);
    setExportError(null);
    setExportNotice(null);
    try {
      // The scope on the page and its interpretation, read from state at click time. An
      // interpretation from an earlier reference is withheld by the document builder rather than
      // re-anchored onto these figures, so a stale answer cannot travel into the file.
      const { blob, filename, unrendered } = await generateEvidencePdf({ bundle, payload: insights.payload }, loadUnicodeFont);
      if (unrendered.length > 0) {
        setExportNotice(
          `${unrendered.length} character${unrendered.length === 1 ? '' : 's'} in this report are in a script the PDF fonts cannot draw; they appear as [?] and are listed at the end of the file.`,
        );
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Revoke on the next tick so the browser has handed the blob to the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(error instanceof Error ? `Could not build the PDF: ${error.message}` : 'Could not build the PDF from this bundle.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-xs font-black uppercase tracking-widest text-gray-400">Evidence report data</h2>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Read-only. {isDemoMode ? 'Demo workspace — every bundle is labelled DEMO.' : 'Production workspace.'}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {SCOPE_CHIPS.map((chip) => (
          <button key={chip.id} type="button" onClick={() => setScope(chip.id)} className={CHIP_CLS(scope === chip.id)}>
            {chip.label}
          </button>
        ))}
      </div>

      {scope === 'national' ? (
        <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          National scope is the country-wide survey. Point products (weather, satellite) are not answered for a
          country, so those sections will report their own gap instead of borrowing another location&apos;s number.
        </p>
      ) : scope === 'region' ? (
        <div className="mt-3">
          <label htmlFor="report-region" className="text-xs font-black uppercase tracking-widest text-gray-400">
            Region (as the price publisher spells it)
          </label>
          {locations.loading && <p className="mt-1.5 text-[11px] text-gray-500">Loading the published region list…</p>}
          {locations.error && (
            <p className="mt-1.5 text-[11px] text-orange-600 dark:text-orange-400">
              Region list could not be loaded: {locations.error.message}
            </p>
          )}
          <select
            id="report-region"
            value={region}
            onChange={(e) => setPickedRegion(e.target.value)}
            className={`mt-1.5 ${FIELD_CLS}`}
          >
            {regions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            This list is <code className="font-mono">/api/data/locations</code> &apos;regionNames&apos;, the same set the
            report route accepts — a region that cannot be filtered is not offered.
          </p>
        </div>
      ) : (
        <div className="mt-3">
          {place === null ? (
            <p className="text-[11px] text-gray-500">{placeHint()}</p>
          ) : (
            <LocationPicker value={place} onChange={pickPlace} label={scope === 'coordinate' ? 'Your coordinates' : 'Market centre'} />
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label htmlFor="report-commodity" className="text-xs font-black uppercase tracking-widest text-gray-400">
            Commodity
          </label>
          <input
            id="report-commodity"
            value={commodity}
            onChange={(e) => setCommodity(e.target.value)}
            placeholder="as the survey spells it"
            className={`mt-1.5 ${FIELD_CLS}`}
          />
        </div>
        <div>
          <label htmlFor="report-months" className="text-xs font-black uppercase tracking-widest text-gray-400">
            Survey months ({REPORT_LIMITS.months.min}–{REPORT_LIMITS.months.max})
          </label>
          <input
            id="report-months"
            inputMode="numeric"
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            className={`mt-1.5 ${FIELD_CLS}`}
          />
        </div>
        <div>
          <label htmlFor="report-composites" className="text-xs font-black uppercase tracking-widest text-gray-400">
            NDVI composites ({REPORT_LIMITS.composites.min}–{REPORT_LIMITS.composites.max})
          </label>
          <input
            id="report-composites"
            inputMode="numeric"
            value={composites}
            onChange={(e) => setComposites(e.target.value)}
            className={`mt-1.5 ${FIELD_CLS}`}
          />
        </div>
        <div className="flex items-end gap-2">
          <button
            type="button"
            disabled={exportHint !== null || exporting}
            onClick={() => void exportPdf()}
            title={exportHint ?? 'Download this bundle as a PDF, with its sources page'}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {isDemoMode ? 'Export DEMO PDF' : 'Export evidence PDF'}
          </button>
          <button
            type="button"
            disabled={report.loading || blocked !== null}
            onClick={build}
            className="px-4 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Build report data
          </button>
          {report.bundle !== null && !report.loading && (
            <button
              type="button"
              onClick={report.reload}
              className="px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
            >
              Re-read
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {exportHint !== null && !exporting && <p className="text-[11px] text-gray-500 dark:text-gray-400">{exportHint}</p>}
        {exportError !== null && (
          <p className="text-[11px] text-orange-600 dark:text-orange-400">{exportError}</p>
        )}
        {exportNotice !== null && (
          <p className="text-[11px] text-orange-600 dark:text-orange-400">{exportNotice}</p>
        )}
        {exportHint === null && exportError === null && !exporting && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Prints the figures, dates and sources this bundle holds{insights.payload ? ' and the interpretation that cites them' : ', with no interpretation attached'}. Not signed, not encrypted.
          </p>
        )}
      </div>

      {blocked && view.state === 'idle' && (
        <p className="mt-2 text-[11px] text-orange-600 dark:text-orange-400">{blocked}</p>
      )}

      <div className="mt-4 border-t border-gray-100 dark:border-zinc-800 pt-4">
        <ReportStateView view={view} receivedAt={report.receivedAt}>
          <InterpretationBlock
            view={insightView}
            receivedAt={insights.receivedAt}
            onGenerate={() => insights.request(given())}
            register={view.register}
          />
        </ReportStateView>
      </div>
    </section>
  );
};

/** Refuses a hand-typed number the range does not allow, rather than silently sending it. */
function numberWithin(raw: string, limits: { min: number; max: number; fallback: number }): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return limits.fallback;
  return Math.max(limits.min, Math.min(limits.max, Math.trunc(value)));
}

function toSelected(place: LocationsPayload['default']): SelectedPlace {
  return { name: place.name, admin1: place.admin1, admin2: place.admin2, latitude: place.latitude, longitude: place.longitude };
}

const ReportStateView = ({
  view,
  receivedAt,
  children,
}: {
  view: ReturnType<typeof describeReport>;
  receivedAt: string | null;
  /** The interpretation block, rendered only once a bundle is actually on screen. */
  children?: React.ReactNode;
}) => {
  if (view.state === 'idle') {
    return (
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        No bundle requested yet. Building one reads the live publishers; nothing is cached on this page.
      </p>
    );
  }

  if (view.state === 'loading') {
    return (
      <div className="flex items-center gap-2">
        <Loader2 size={16} className="animate-spin text-emerald-600" />
        <p className="text-sm text-gray-600 dark:text-gray-300">{view.headline}</p>
      </div>
    );
  }

  if (view.state === 'error') {
    return <SourceUnavailable error={{ code: 'report', message: view.headline }} />;
  }

  return (
    <div className="space-y-4">
      {view.demoNotice && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 p-3">
          <p className="text-[11px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-300">Demo content</p>
          <p className="text-[11px] text-amber-900 dark:text-amber-200 mt-1 leading-relaxed">{view.demoNotice}</p>
        </div>
      )}

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className={`text-sm font-bold ${view.state === 'no-data' ? 'text-orange-700 dark:text-orange-400' : 'text-gray-900 dark:text-white'}`}>
          {view.headline}
        </p>
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{stateWord(view.state)}</span>
      </div>

      {view.scopeLine && <p className="text-[11px] text-gray-600 dark:text-gray-300">{view.scopeLine}</p>}
      {view.scopeNote && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          <span className="font-black uppercase tracking-widest text-gray-400">Scope note · </span>
          {view.scopeNote}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {view.sections.map((section) => (
          <SectionChip key={section.id} section={section} />
        ))}
      </div>

      {view.state === 'no-data'
        ? view.sections.filter((s) => s.unavailableReason).map((s) => (
            <p key={s.id} className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
              <span className="font-semibold">{s.title}:</span> {s.unavailableReason}
            </p>
          ))
        : view.sections.filter((s) => s.status !== 'unavailable').map((section) => <SectionDetail key={section.id} section={section} />)}

      {view.warnings.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Warnings carried with this bundle</p>
          <ul className="mt-1.5 space-y-1">
            {view.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`} className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
                <code className="font-mono text-gray-400">{w.code}</code> — {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {children}

      <RegisterTable entries={view.register} />

      <div className="text-[11px] text-gray-500 dark:text-gray-400 space-y-1">
        {view.attribution && (
          <p>
            <span className="font-black uppercase tracking-widest text-gray-400">Authorisation · </span>
            {view.attribution.verified
              ? `Verified session${view.attribution.displayName ? `: ${view.attribution.displayName}` : ' (no display name on the account)'}. `
              : 'No verified session. '}
            {view.attribution.note}
          </p>
        )}
        <p>
          <span className="font-black uppercase tracking-widest text-gray-400">Reference · </span>
          <code className="font-mono">{view.reference}</code> — a lookup key for the register below, not a signature.
          Bundle generated {stamp(view.generatedAt)}; received by this browser {stamp(receivedAt)}.
        </p>
        <p className="text-gray-400 dark:text-gray-500">
          Everything above is a publisher value or a stated arithmetic derivation. The only prose on this page is the
          interpretation block above, and each of its sentences carries the evidence id it was drawn from.
        </p>
      </div>
    </div>
  );
};

const stateWord = (state: string) =>
  state === 'ready' ? 'Complete answer' : state === 'partial' ? 'Partial data' : state === 'no-data' ? 'No data' : state;

const INSIGHT_STATE_WORD: Record<ReturnType<typeof describeInsights>['state'], string> = {
  idle: 'not generated',
  loading: 'generating',
  ready: 'grounded',
  nothing: 'nothing supported',
  error: 'not generated',
};

/**
 * The model's sentences, printed with what they cite. Nothing here paraphrases the evidence: a
 * citation line shows the fact statement the package carried, and the flags that fact carries —
 * its value kind, its spatial basis, its as-of date, whether it is stale, and its quality tier.
 * That is the whole claim of "evidence-grounded" made checkable by eye.
 */
const InterpretationBlock = ({
  view,
  receivedAt,
  onGenerate,
  register,
}: {
  view: ReturnType<typeof describeInsights>;
  receivedAt: string | null;
  onGenerate: () => void;
  register: SourceRegisterEntry[];
}) => {
  const { payload } = view;

  const factsById = new Map<string, EvidenceFact[]>();
  for (const fact of payload?.cited ?? []) {
    const list = factsById.get(fact.evidenceId);
    if (list) list.push(fact);
    else factsById.set(fact.evidenceId, [fact]);
  }
  const gapsById = new Map((payload?.gaps ?? []).map((gap) => [gap.evidenceId, gap.reason]));
  const registerIds = register.map((entry) => entry.evidenceId);

  return (
    <div className="rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50/60 dark:bg-zinc-950/30 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-emerald-600 dark:text-emerald-400" />
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Interpretation · {INSIGHT_STATE_WORD[view.state]}
          </p>
        </div>
        <button
          type="button"
          disabled={view.state === 'loading' || view.blocked !== null}
          onClick={onGenerate}
          className="px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {payload ? 'Generate again' : 'Generate interpretation'}
        </button>
      </div>

      {view.blocked && view.state !== 'ready' && view.state !== 'nothing' && (
        <p className="text-[11px] text-orange-600 dark:text-orange-400">{view.blocked}</p>
      )}

      {view.headline && (
        <p className={`text-[11px] leading-relaxed ${view.state === 'error' || view.state === 'nothing' ? 'text-orange-700 dark:text-orange-400' : 'text-gray-600 dark:text-gray-300'}`}>
          {view.headline}
        </p>
      )}

      {payload?.demoNotice && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 p-2.5">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-300">Demo interpretation</p>
          <p className="text-[11px] text-amber-900 dark:text-amber-200 mt-1 leading-relaxed">{payload.demoNotice}</p>
        </div>
      )}

      {payload && payload.findings.length > 0 && (
        <ul className="space-y-2.5">
          {payload.findings.map((finding) => (
            <Finding key={finding.evidenceId} finding={finding} factsById={factsById} gapsById={gapsById} registerIds={registerIds} />
          ))}
        </ul>
      )}

      {payload && payload.rejected.length > 0 && (
        <details className="rounded-xl border border-gray-200 dark:border-zinc-800 p-2.5">
          <summary className="cursor-pointer text-[11px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {payload.rejected.length} claim{payload.rejected.length === 1 ? '' : 's'} dropped by the citation check
          </summary>
          <ul className="mt-2 space-y-2">
            {payload.rejected.map((draft, i) => (
              <Rejected key={i} draft={draft} registerIds={registerIds} />
            ))}
          </ul>
        </details>
      )}

      {payload && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
          Generated from a fresh server read by <code className="font-mono">{payload.model}</code>; reference{' '}
          <code className="font-mono">{payload.reference}</code>, published {stamp(payload.generatedAt)}, received by this browser{' '}
          {stamp(receivedAt)}. The facts it was shown are the ones above{payload.truncated ? `, less what its own budget dropped: ${payload.truncated}` : '.'}
        </p>
      )}
    </div>
  );
};

const Finding = ({
  finding,
  factsById,
  gapsById,
  registerIds,
}: {
  finding: ReportFinding;
  factsById: Map<string, EvidenceFact[]>;
  gapsById: Map<string, string>;
  registerIds: string[];
}) => (
  <li className="space-y-1">
    <p className="text-[12px] text-gray-800 dark:text-gray-100 leading-relaxed">
      <span className="mr-1.5 px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">
        {FINDING_KIND_LABEL[finding.kind]}
      </span>
      {finding.text}
    </p>
    <ul className="flex flex-col gap-1">
      {finding.cites.map((cite) => (
        <Citation key={cite} cite={cite} facts={factsById.get(cite) ?? []} gap={gapsById.get(cite) ?? null} registerIds={registerIds} />
      ))}
    </ul>
  </li>
);

const Citation = ({
  cite,
  facts,
  gap,
  registerIds,
}: {
  cite: string;
  facts: EvidenceFact[];
  gap: string | null;
  registerIds: string[];
}) => {
  // A citation resolves to the register row that publishes it, so a sentence is never further from
  // a source than one click. Derived figures cite a child id, so the parent source row is matched.
  const rowId = registerIds.find((id) => id === cite || cite.startsWith(`${id}.`) || id.startsWith(`${cite}.`)) ?? null;
  const href = rowId ? `#register-row-${rowId}` : undefined;

  return (
    <li className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
      <a
        href={href}
        className={`font-mono ${href ? 'underline decoration-gray-300 underline-offset-2' : 'text-gray-400 dark:text-gray-500'}`}
        title={href ? 'Jump to this source in the register below' : 'No register row carries this id'}
      >
        {cite}
      </a>
      {gap !== null && facts.length === 0 ? <span className="ml-1.5 text-gray-500 dark:text-gray-400">did not answer — {gap}</span> : null}
      {facts.map((fact, i) => (
        <p key={`${fact.evidenceId}-${i}`} className="ml-2 mt-0.5">
          <span className="text-gray-800 dark:text-gray-100">{fact.statement}</span>
          <span className="text-gray-400 dark:text-gray-500">
            {' '}· {fact.valueKind} · {fact.spatial} · observed {fact.observedAt ?? 'not published'} · {fact.quality}-quality
            {fact.stale ? ' · stale' : ''} · {fact.source}
          </span>
        </p>
      ))}
    </li>
  );
};

const Rejected = ({ draft, registerIds }: { draft: RejectedDraft; registerIds: string[] }) => (
  <li className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
    <p className="text-gray-600 dark:text-gray-300">“{draft.preview}”</p>
    <p>
      dropped: {draft.reason}
      {draft.cites.length > 0 && (
        <span className="font-mono text-gray-400 dark:text-gray-500">
          {' '}· cited {draft.cites.filter((c) => registerIds.includes(c) || registerIds.some((r) => c.startsWith(`${r}.`))).length} of {draft.cites.length} ids recognised
        </span>
      )}
    </p>
  </li>
);

const SectionChip = ({ section }: { section: ReportSectionView }) => (
  <span
    className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${
      section.status === 'ready'
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
        : section.status === 'partial'
          ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400'
          : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
    }`}
    title={section.unavailableReason ?? section.caveats.join('\n')}
  >
    {section.title} · {section.statusLabel} · {section.rows} rows · {section.seriesPoints} points
  </span>
);

const SectionDetail = ({ section }: { section: ReportSectionView }) => (
  <div className="rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50/60 dark:bg-zinc-950/30 p-3 space-y-2">
    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
      {section.title} — {section.statusLabel}
    </p>
    {section.unavailableReason && <p className="text-[11px] text-gray-600 dark:text-gray-300">{section.unavailableReason}</p>}
    {section.evidence.map((evidence) => (
      <div key={evidence.evidenceId} className="space-y-1.5">
        {evidence.error ? (
          <SourceUnavailable error={{ code: evidence.error.code, message: evidence.error.message }} source={evidence.provider} />
        ) : (
          <>
            <ProvenanceLabel provenance={evidence.provenance} context={evidence.provider} />
            {evidence.tables.map((table) => (
              <div key={table.evidenceId} className="overflow-x-auto">
                <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                  {table.title}
                  <span className="text-gray-400"> · {table.rows.length} row{table.rows.length === 1 ? '' : 's'}{table.rowsOmitted > 0 ? ` (${table.rowsOmitted} not shown: ${table.omissionNote ?? 'capped'})` : ''}</span>
                </p>
                <table className="mt-1 w-full text-[11px] text-left">
                  <thead className="text-gray-400">
                    <tr>
                      {table.columns.map((col) => (
                        <th key={col.key} className="pr-3 pb-1 font-semibold whitespace-nowrap">
                          {col.label}
                          {col.units ? <span className="text-gray-400"> ({col.units})</span> : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-gray-700 dark:text-gray-200">
                    {table.rows.slice(0, 8).map((row, i) => (
                      <tr key={i}>
                        {table.columns.map((col) => (
                          <td key={col.key} className="pr-3 py-0.5 whitespace-nowrap">
                            {cell(row[col.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {evidence.charts.map((chart) => (
              <p key={chart.evidenceId} className="text-[11px] text-gray-600 dark:text-gray-300">
                <span className="font-semibold">{chart.title}</span>{' '}
                {chart.unavailableReason
                  ? `— not plotted: ${chart.unavailableReason}`
                  : `— ${chart.series.reduce((n, s) => n + s.points.filter((p) => p.y !== null).length, 0)} points · ${chart.units} · ${chart.spatial}`}
              </p>
            ))}
            {evidence.derived.map((d) => (
              <p key={d.evidenceId} className="text-[11px] text-gray-600 dark:text-gray-300">
                <span className="font-semibold">{d.label}</span> = {cell(d.value)} {d.units} · {d.formula} · inputs{' '}
                <code className="font-mono text-gray-400">{d.inputs.join(', ')}</code>
              </p>
            ))}
          </>
        )}
      </div>
    ))}
    {section.caveats.length > 0 && (
      <ul className="space-y-0.5">
        {section.caveats.map((caveat, i) => (
          <li key={i} className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            {caveat}
          </li>
        ))}
      </ul>
    )}
  </div>
);

const RegisterTable = ({ entries }: { entries: SourceRegisterEntry[] }) => {
  if (entries.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Sources &amp; methodology</p>
      <table className="mt-1.5 w-full text-[11px] text-left">
        <thead className="text-gray-400">
          <tr>
            {['Source', 'State', 'Observed', 'Retrieved', 'Kind', 'Units', 'Coverage', 'Spatial', 'From cache', 'Licence', 'Detail'].map((h) => (
              <th key={h} className="pr-3 pb-1 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="text-gray-700 dark:text-gray-200 align-top">
          {entries.map((e) => (
            <tr key={e.evidenceId} id={`register-row-${e.evidenceId}`}>
              <td className="pr-3 py-1">
                <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-gray-300 underline-offset-2">
                  {e.source}
                </a>
              </td>
              <td className="pr-3 py-1">
                <span className={`px-1.5 py-0.5 rounded-md font-semibold ${STATE_CLS[e.state]}`}>{e.state}</span>
                {e.stale ? <span className="ml-1 text-orange-600 dark:text-orange-400">stale</span> : null}
              </td>
              <td className="pr-3 py-1 whitespace-nowrap">{e.observedAt ?? 'not stated'}</td>
              <td className="pr-3 py-1 whitespace-nowrap">{e.retrievedAt ?? 'not fetched'}</td>
              <td className="pr-3 py-1 whitespace-nowrap">{KIND_LABEL[e.valueKind]?.label ?? e.valueKind}</td>
              <td className="pr-3 py-1">{e.units}</td>
              <td className="pr-3 py-1">{e.coverage}</td>
              <td className="pr-3 py-1">{e.spatial}</td>
              <td className="pr-3 py-1">{e.retrievedAt === null ? '—' : e.servedFromCache ? 'cached' : 'live'}</td>
              <td className="pr-3 py-1">{e.license}</td>
              <td className="pr-3 py-1">{e.detail || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function stamp(value: string | null): string {
  if (!value) return 'not stated';
  const t = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(t)) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Addis_Ababa' }).format(new Date(t));
}
