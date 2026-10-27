import { SourceStatusPanel } from '@/components/data/SourceStatusPanel';

export const metadata = {
  title: 'Data Sources · Nexus AgriRise',
  description: 'Every publisher the dashboard reads from, its live connection state, publication cadence and licence.',
};

/** The same five kinds the provenance labels use, defined here so the legend cannot drift. */
const KINDS = [
  ['Observed', 'a measurement the publisher attributes to a place and a date — a rain gauge, a surveyed market, a published rate.'],
  ['Modelled', 'the output of a physical or statistical model on a grid, e.g. NASA POWER agroclimatology for a coordinate.'],
  ['Forecast', 'a forward-looking estimate. Never a measurement, never averaged with one, and always dated to the run that produced it.'],
  ['Derived', 'computed from published figures by a stated formula, e.g. a month-on-month change.'],
  ['Filled in', 'a gap we imputed so a series stays readable. Flagged wherever it appears, and never presented as a measurement.'],
] as const;

export default function SourcesPage() {
  return (
    <div className="space-y-4">
      <SourceStatusPanel />

      <section className="rounded-2xl border border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-gray-500 mb-1">What each figure is</h2>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
          Every card on this dashboard ends with a provenance line naming its publisher, the date the publisher observed
          the value, the date we retrieved it, its units, its methodology and its geographic coverage. The last of those
          is the kind of number it is — a label we never leave implied:
        </p>
        <dl className="grid gap-2 sm:grid-cols-2">
          {KINDS.map(([label, meaning]) => (
            <div key={label} className="text-[11px] leading-relaxed">
              <dt className="font-bold text-gray-700 dark:text-gray-200">{label}</dt>
              <dd className="text-gray-500 dark:text-gray-400">{meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
          A source we cannot reach stays visible as unreachable with the reason our request actually got back. There is
          no fixture, example or placeholder data in the serving path: an empty card means the publisher did not answer,
          and it is never quietly filled in with something else. Satellite readings describe vegetation greenness and
          rainfall anomalies over the last days — they are not a measurement of yield or of soil conditions, and the map
          says so on every layer.
        </p>
      </section>
    </div>
  );
}
