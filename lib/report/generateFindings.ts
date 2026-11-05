import { getEvidenceFindingsPrompt } from '@/services/prompts';
import { buildEvidencePackage, type EvidencePackage } from './evidencePackage';
import { parseFindingsPayload, validateFindings, type ValidatedFindings } from './findings';
import type { ReportBundle } from './types';

/**
 * The only place in the report path that talks to a model, and the reason the key stays on the
 * server: `services/ai.ts` reads `GEMINI_API_KEY` at call time, and so does this.
 *
 * Two differences from `services/ai.ts` are deliberate. There is no legacy-model retry — a second
 * model would produce prose that the citation set of the first cannot vouch for. And there is no
 * fallback sentence: every failure here is returned as a typed failure so the caller can say
 * "the AI did not answer" instead of printing something the publishers never supported.
 */

export const FINDINGS_MODEL = 'gemini-1.5-flash-latest';
export const FINDINGS_TIMEOUT_MS = 25_000;

export type FindingsFailureCode =
  | 'not_configured'
  | 'no_evidence'
  | 'timeout'
  | 'blocked'
  | 'provider_error'
  | 'empty'
  | 'malformed';

export interface FindingsFailure {
  code: FindingsFailureCode;
  /** Operator-facing. Sanitized: never a key, never an upstream body. */
  message: string;
}

export type ProviderAnswer = { ok: true; text: string } | { ok: false; failure: FindingsFailure };

/** Injectable so the harness can drive the real validator with deterministic fixtures. */
export type FindingsTransport = (prompt: string) => Promise<ProviderAnswer>;

export type FindingsOutcome =
  | { ok: true; model: string; package: EvidencePackage; findings: ValidatedFindings }
  | { ok: false; model: string; package: EvidencePackage; failure: FindingsFailure };

export interface GenerateOptions {
  transport?: FindingsTransport;
  timeoutMs?: number;
  model?: string;
}

export async function generateGroundedFindings(
  bundle: ReportBundle,
  options: GenerateOptions = {},
): Promise<FindingsOutcome> {
  const pkg = buildEvidencePackage(bundle);
  const model = options.model ?? FINDINGS_MODEL;

  // No figures means no grounding, and a model given an empty package will fill the page with
  // plausible text. Refuse the call rather than pay for invention.
  if (pkg.facts.length === 0) {
    return {
      ok: false,
      model,
      package: pkg,
      failure: {
        code: 'no_evidence',
        message: 'No publisher answered a figure for this scope, so there is nothing an interpretation could cite. The report stands on its facts page.',
      },
    };
  }

  const transport = options.transport ?? geminiTransport(options.timeoutMs ?? FINDINGS_TIMEOUT_MS, model);
  const answer = await transport(getEvidenceFindingsPrompt(pkg));
  if (!answer.ok) return { ok: false, model, package: pkg, failure: answer.failure };

  const parsed = parseFindingsPayload(answer.text);
  if (!parsed.ok) return { ok: false, model, package: pkg, failure: { code: 'malformed', message: parsed.error } };

  return { ok: true, model, package: pkg, findings: validateFindings(bundle, pkg, parsed.drafts, model) };
}

function geminiTransport(timeoutMs: number, model: string): FindingsTransport {
  return async (prompt) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        failure: {
          code: 'not_configured',
          message: 'GEMINI_API_KEY is not set on this server, so no interpretation can be generated. The published figures are unaffected.',
        },
      };
    }
    try {
      // Loaded only when a call is actually being made, so a test that injects a transport never
      // pulls the provider SDK into the process.
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const generative = genAI.getGenerativeModel({
        model,
        // Structured output where the provider supports it; the parser does not rely on it.
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      });
      const result = await generative.generateContent(prompt, { timeout: timeoutMs });
      const blockReason = result.response.promptFeedback?.blockReason;
      if (blockReason) {
        return { ok: false, failure: { code: 'blocked', message: `The provider declined this request (${blockReason}); nothing was generated.` } };
      }
      const text = result.response.text();
      if (!text || text.trim() === '') {
        return { ok: false, failure: { code: 'empty', message: 'The provider answered with no text.' } };
      }
      return { ok: true, text };
    } catch (error) {
      return { ok: false, failure: classify(error, timeoutMs) };
    }
  };
}

function classify(error: unknown, timeoutMs: number): FindingsFailure {
  const message = error instanceof Error ? error.message : String(error);
  const safe = sanitize(message);
  if (/timeout|timed out|abort/i.test(message)) {
    return { code: 'timeout', message: `The provider did not answer within ${Math.round(timeoutMs / 1000)} seconds. Nothing was generated.` };
  }
  if (/api key|api_key|invalid authentication|permission denied/i.test(message)) {
    // The provider's own wording, never the credential that caused it.
    return { code: 'not_configured', message: `The provider refused to authenticate this server: ${safe}` };
  }
  return { code: 'provider_error', message: `The provider did not answer: ${safe}` };
}

/** Belt-and-braces: an upstream message must never reach a page carrying a credential. */
function sanitize(message: string): string {
  return message
    .replace(/AIza[\w-]{10,}/g, '[redacted key]')
    .replace(/([?&]key=)[^\s&]+/gi, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 300);
}
