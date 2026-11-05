import type { EvidencePackage } from '@/lib/report/evidencePackage';

export const getAgribusinessPrompt = (datasetJSON: string) => {
  return `You are a professional African agribusiness intelligence analyst specializing in regional trade, agricultural economics, and market forecasting.

Analyze the following agricultural dataset and generate structured insights.

Dataset (first 50 rows max):
${datasetJSON}

Focus your analysis on:
- crop pricing
- market trends
- regional trade opportunity
- supply risk
- cross-border potential

Output your response strictly as valid JSON matching this schema exactly, with NO markdown formatting, NO code blocks, and NO additional text:
{
  "marketSummary": "Concise, professional summary of the market conditions based on the data",
  "riskLevel": "Low", // Must be exactly "Low", "Medium", or "High"
  "priceTrend": "Concise analysis of pricing trends",
  "crossBorderOpportunity": "Concise analysis of cross-border trade potential"
}`;
};

/**
 * Phase 4. Unlike the prompt above, this one hands the model nothing it can compute with: the
 * figures, units, kinds, dates and citations are already decided, and the only task left is to
 * say what they support. The rules travel inside the package (`lib/report/evidencePackage.ts`)
 * so a prompt edit cannot silently loosen them, and every constraint stated here is enforced
 * again by `validateFindings`, which drops a non-compliant sentence rather than printing it.
 */
export const getEvidenceFindingsPrompt = (package_: EvidencePackage) => {
  const pkg = describePackage(package_);
  return `You are an Ethiopian agribusiness analyst writing the interpretation page of a report. You are given an evidence package and nothing else.

Scope of this report: ${pkg.scope}${pkg.scopeNote ? ` — ${pkg.scopeNote}` : ''}
Reference: ${pkg.reference} (a lookup key for the source register, not a signature)
Mode: ${pkg.mode}${pkg.demoNotice ? ` — ${pkg.demoNotice}` : ''}
How these facts were selected: ${pkg.selection}
${pkg.truncated ? `Incomplete: ${pkg.truncated}` : 'The package below is complete for this scope.'}

Facts you may use (each line is one citable fact):
${pkg.facts}

Sources that did NOT answer, and why (you may state a limitation by citing its id):
${pkg.gaps}

Rules. These are conditions of publication, not style advice:
${pkg.rules}

Additional constraints:
- Do not perform arithmetic. Do not average, sum, difference, ratio, percentage, or count rows or facts. Restate a figure exactly as supplied, with its units.
- Do not introduce a figure, place, date, commodity, source, confidence level, or comparison that is not in the lines above.
- Copy a value kind with its figure when it matters: an observed reading is not a forecast, a modeled/reanalysis value is not a measurement, and an estimated or computed value is ours, not the publisher's.
- If the facts will not support a claim, write the limitation instead of the claim, citing the gap id.
- Prefer three to six strong sentences over eight weak ones. Never fill a quota.

Return only valid JSON, no markdown fence, no commentary:
{
  "findings": [
    {
      "text": "One sentence. Every figure in it appears verbatim in a fact you cite.",
      "cites": ["evidence id from the lines above"],
      "kind": "observation"
    }
  ]
}

"kind" is exactly one of "observation" (a figure the package states), "interpretation" (what the figures jointly suggest, with the reasoning in the sentence), or "recommendation" (advice, labelled as advice, stating what is uncertain about it).`;
};

/** Keeps the prompt honest: it can only describe what the package actually holds. */
function describePackage(pkg: EvidencePackage) {
  return {
    scope: pkg.scope,
    scopeNote: pkg.scopeNote,
    reference: pkg.reference,
    mode: pkg.mode,
    demoNotice: pkg.demoNotice,
    selection: pkg.selection,
    truncated: pkg.truncated,
    rules: pkg.rules.map((rule, i) => `${i + 1}. ${rule}`).join('\n'),
    gaps: pkg.gaps.length === 0
      ? 'none — every source in this report answered'
      : pkg.gaps.map((gap) => `${gap.evidenceId}: ${gap.reason}`).join('\n'),
    facts: pkg.facts
      .map((fact) => [
        fact.evidenceId,
        fact.value === null ? 'no value published' : `${fact.value} ${fact.units}`,
        fact.valueKind,
        fact.spatial,
        `observed ${fact.observedAt ?? 'not published'}`,
        `retrieved ${fact.retrievedAt ?? 'not recorded'}`,
        fact.stale ? 'STALE' : 'within its stated freshness',
        `${fact.quality}-quality`,
        fact.source,
        fact.statement,
      ].join(' | '))
      .join('\n'),
  };
}
