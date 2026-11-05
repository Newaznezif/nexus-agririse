/**
 * The fetch-time rule, restated for the harnesses.
 *
 * `lib/data/sources.ts` `nonAnswerProvenance` is the implementation the app runs: an envelope for a
 * request that never got the file back dates nothing, because a timestamp beside a refusal reads as
 * "we downloaded this at 14:03" to everything that trusts the field. The fixtures module needs the
 * same rule to build bundles that look like the real ones, and the assertion modules need it to know
 * which envelopes they may expect a date in.
 *
 * This file is a mirror, not the contract. `check-report-data.mjs` compares it against the connector
 * on every run, so a list that drifts from `NO_PAYLOAD` fails loudly instead of letting a dated
 * refusal pass.
 */

/** Mirrors `NO_PAYLOAD` in `lib/data/sources.ts`. */
export const NO_PAYLOAD_CODES = new Set([
  'publisher_blocked', 'empty_response', 'network', 'timeout', 'rate_limited',
  'http_status', 'payload_too_large', 'auth_required', 'not_configured',
]);

/**
 * Mirrors `nonAnswerProvenance`. `no_data`, `bad_input` and `parse_failed` are absent on purpose:
 * there the publisher answered, or nothing was requested, so the fetch really happened and its
 * timestamp stands.
 */
export function nonAnswerProvenance(provenance, error) {
  if (!error || !NO_PAYLOAD_CODES.has(error.code)) return provenance;
  return { ...provenance, retrievedAt: null, stale: true, servedFromCache: false };
}
