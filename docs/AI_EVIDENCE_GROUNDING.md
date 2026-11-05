# Phase 4 — what the model is shown, and what has to survive before it prints

The interpretation layer of the evidence-backed report. Phase 2 built the bundle and its evidence
projection ([`REPORT_DATA_ARCHITECTURE.md`](REPORT_DATA_ARCHITECTURE.md)), Phase 3 put that bundle on
the page ([`INSIGHTS_REPORT_INTEGRATION.md`](INSIGHTS_REPORT_INTEGRATION.md)); this document covers
the one step that adds prose — and the gate that decides which prose reaches a farmer.

The rule the whole phase is built around: **a sentence may only say what the evidence package it was
sent already says.** The package is not context for a broader answer; it is the complete set of
sayable figures.

## Files

| File | Role |
| --- | --- |
| `lib/report/evidencePackage.ts` | Phase 2's projection, extended: `demoNotice` and `selection` now travel with the package, and the 180-fact budget is allocated by round-robin (`allocateGroups`) instead of by section sweep. Four rules added to `EVIDENCE_RULES`. |
| `services/prompts.ts` | `getEvidenceFindingsPrompt(pkg)` — renders the package as citable lines and states the rules. The old free-form analysis prompt is untouched and unused here. |
| `lib/report/findings.ts` | The gate. `parseFindingsPayload` (typed JSON refusal), `validateFindings` (every claim checked against the package), `buildInsightsPayload` (what the page renders). No provider import. |
| `lib/report/generateFindings.ts` | The only call site. `generateGroundedFindings(bundle, {transport})` — package → prompt → answer → validate. Injectable transport; typed failures; no fallback prose. |
| `app/api/report/insights/route.ts` | `POST`. `verifyCaller` first, form-urlencoded scope, bundle re-read server-side, `private, no-store` on every response. |
| `hooks/useReportInsights.ts` | The client half: the caller's own token, one POST per press, abort on supersede. |
| `lib/report/reportState.ts` | `describeInsights` — five view states (`idle · loading · ready · nothing · error`) and the three kind labels. |
| `components/report/InsightReportPanel.tsx` | `InterpretationBlock`: each sentence with its citations resolved to the fact text, dropped claims with their reasons, links into the source register. |
| `app/dashboard/insights/page.tsx` | Step 0 — the signed-out state (below). |

## Step 0 — the page no longer spins forever

`fetching` was initialised to `true` while `fetchData()` returned early when there was no user, so a
visitor without a session sat on *Syncing Intelligence Streams…* indefinitely and the report panel
was unreachable. The gate is now `loading || fetching || (user && !fetched)` — a spinner only while
work that will actually finish is outstanding — and a visitor with no session gets a stated state:
**No active session** when Supabase is configured, **Sign-in is not configured** when it is not, with
a link to `/login` (the existing redirect is unchanged). No session is simulated, no credential is
added, and the report panel renders underneath so the read-only route is still reachable and still
answers `auth_required`.

## The path a sentence takes

```
panel scope chips
  → POST /api/report/insights          body: the same buildReportQuery grammar as the GET read
  → verifyCaller(request)              401/503 before anything else — this call costs money
  → parseReportQuery(body)             one validator for browser and route
  → buildReportBundle(… caller)        nine read-only connectors, re-read on the server
  → buildEvidencePackage(bundle)       ≤180 facts, round-robin across answering items
  → getEvidenceFindingsPrompt(pkg)     the package and the rules, nothing else
  → transport(prompt)                  Gemini, 25 s, responseMimeType json, temperature 0.2
  → parseFindingsPayload(text)         typed refusal if it is not JSON with a findings array
  → validateFindings(bundle, pkg, …)   the gate
  → { findings, rejected, cited }      private, no-store
  → describeInsights → InterpretationBlock
```

The evidence is re-read server-side rather than accepted from the client, so a request cannot
smuggle its own "facts" into a report about another market. The body carries a scope and nothing
else; `caller` is never a field the client can set — `parseReportQuery`'s output type excludes it,
and the route fills it from the confirmed token's email.

## The package is the closed set

`buildEvidencePackage` copies figures out of the bundle with their evidence id, units, `valueKind`,
spatial basis, coverage, both dates, staleness and quality tier. Phase 4 added nothing to what the
model receives except four explicit rules: a stale figure must be printed with its as-of date, advice
must read as advice and state its uncertainty, a demo package must be labelled in every claim drawn
from it, and the words *verified / certified / signed / guaranteed / authorised / official* are
forbidden outright — no evidence in a package can confer that status.

`citationErrors()` (Phase 2) is reused verbatim as the citation half of the gate; there is no second
definition of what a resolvable citation is, and no second provenance model.

## The gate

Every draft is checked against the package that was actually sent. A failure drops the sentence and
records the reason — text is never softened, because an edited claim would still be the model's
invention.

| Check | Refusal |
| --- | --- |
| Shape | `is a bare string with no citations attached.` / `has no sentence to print.` / `has no kind, or a kind outside …` |
| Volume | `Over the 8-finding limit for one request.` |
| Citation | Phase 2's `citationErrors`: cites nothing, cites a source that failed, cites an unknown id |
| Id shown but empty | `cites X, which is in the bundle but carried nothing for this package — the model was never shown a figure under that id.` |
| Invented figure | `states N, which appears in no fact it cites.` (every numeric token must match a cited fact's value, a number inside its statement, or a part of its dates) |
| Status claim | `claims the status "verified", which no evidence in this package can confer.` |
| Scope claim | national wording without a `national-survey` fact; regional wording on finer evidence; any field/plot claim — no evidence measures a field |
| Kind claim | forecast without a cited `forecast` value; "measured/observed" while citing only modeled/estimated; "estimated" while citing observed |
| Staleness | `uses stale evidence (…) as though it were current; state its as-of date, <date> or drop the claim.` |
| Direction | a trend word with figures from one period only, or contradicting the cited series' first→last values |
| Demo | drawn from a demo package but not labelled as one |
| Advice | no `recommend/consider/should` wording, or none of what is uncertain stated |

Accepted findings are the draft's own text, unedited, with `generatedBy` set to the model name.
`empty: true` means the model answered and nothing survived — the page then prints the published
figures and says so, which is a real state, not an error.

## Failure taxonomy

`generateGroundedFindings` returns a typed failure and never a substitute sentence. `no_evidence` is
decided **before** any call: a package with zero facts cannot ground anything, so the request is
refused rather than paid for.

| Code | Route status | Meaning |
| --- | --- | --- |
| `not_configured` | 503 | No `GEMINI_API_KEY` on this server, or the provider refused to authenticate it |
| `no_evidence` | 422 | No publisher answered a figure for this scope |
| `timeout` | 504 | No answer within 25 s |
| `blocked` | 503 | The provider's own safety refusal (`promptFeedback.blockReason`) |
| `provider_error` | 503 | Anything else upstream |
| `empty` | 503 | An answer with no text |
| `malformed` | 502 | No JSON, unparseable JSON, or no `findings` array |

Provider messages are sanitized (`AIza…`, `?key=`, `Bearer …`) before they can reach a page, and the
SDK is imported lazily inside the default transport so an injected test transport never loads it.
There is no legacy-model retry: a second model would produce prose the first model's citation set
cannot vouch for.

## The evidence budget, and what it still cannot do

The old sweep took facts in section order, so a wide market table could consume all 180 slots and
leave the satellite and macro sections unrepresented — which reads to a model as "those sources had
nothing to say". Allocation is now round-robin across the evidence items that answered: every item
contributes one fact before any item contributes a second, and the survivors are re-sorted into
bundle order, so rotation decides *who is cut* while the bundle still decides *reading order*. It is
deterministic — the same bundle always produces the same package — and the package carries its own
`selection` string, which the prompt prints, so the model is told how its facts were chosen. When the
budget is reached, `truncated` names each item's `kept N of M`.

Remaining limits, stated rather than papered over:

- The budget is shared per **evidence item**, not per **section**. A section whose items all answer
  richly still receives more total lines than a section with one item; rotation guarantees presence,
  not proportion.
- Each series is capped at 12 points (`MAX_POINTS_PER_SERIES`, the most recent slice) *before*
  allocation, so a long daily history reaches the model as a tail window. Each point carries its own
  date, which is what makes a direction claim checkable against it, but the cap itself is silent — so
  a trend that depends on the full window is a limit to state in the sentence, not something this
  layer can prove.
- The gap list is **not** capped. Refusals never compete with figures for budget, so a source that
  did not answer is always visible to the model.
- The checks are lexical and conservative. They catch the shapes we can name — an unmatched figure,
  an id that was never sent, a forecast described as measured — not every paraphrase of them. That is
  why the UI prints the cited fact beside every sentence rather than trusting the sentence alone.

## What the page shows

`InterpretationBlock` sits inside the existing report panel; no layout, colour or component of Phase
3's design changed. It offers one button, *Generate interpretation*, which is disabled until a bundle
is in hand (the model is only ever shown the figures this scope answered — the gate says so in place
of a spinner). Then:

- the demo banner, when the package is demo, above the sentences;
- each finding with its kind label (`Figure as published` / `Read from the figures` /
  `Recommendation`) and its cites;
- each cite resolved to the fact's own statement plus `valueKind`, spatial basis, observed date,
  quality, stale flag and source — and an anchor that jumps to that evidence id's row in the source
  register (`#register-row-<evidenceId>`);
- every dropped claim in a collapsed list with the gate's reason, verbatim;
- the model name, the bundle reference, the bundle's own `generatedAt`, and the truncation note when
  the budget cut anything.

A scope change clears the interpretation with the bundle (`insights.clear()`), so a sentence about
Jimma can never sit under a heading that says Adama.

## Verification

- `node scripts/check-report-data.mjs --base http://127.0.0.1:3100` → **7080/7080 assertions passed**
  (15 notes record what the publishers actually answered). Phase 4's cases: the 180-fact budget on an
  inflated copy of the live market bundle — every item that had a figure is represented, coverage per
  section, `kept N of M` in `truncated`, gaps complete, bundle order preserved, and a rebuild
  byte-identical; the gate driven with deterministic fixtures built from the live package's own facts
  (accept, fabricated id, uncited, id-carried-nothing, invented number, stale with and without an
  as-of date, forecast/measured/estimated mismatches, rose vs fell vs single-period on a synthesised
  two-point series, pixel→regional, field, market→nationwide, `verified`, demo labelling, advice label
  and uncertainty, stated limitation, unreadable shapes, the 8-finding cap, a refused source cited as
  if it had answered); the payload and parser; the generator through an injected transport (valid
  answer, prose instead of JSON, passthrough timeout, `no_evidence` with a call-count proof,
  `not_configured` with no key) and the prompt's own content; `describeInsights`; source assertions on
  the route (auth before the paid call, shared validator, identity from the token, no `request.json`,
  no key in the route) and on the panel; the signed-out page. Over HTTP: `POST /api/report/insights`
  with no credential, a garbage token and a non-bearer scheme → `auth_required`, `data: null`,
  `private, no-store`; a wrong `content-type` from an unverified caller still lands as an auth
  refusal; `GET` → `405`; and the first paint of `/dashboard/insights` carries no
  *Syncing Intelligence Streams* and does state the missing sign-in.
- `npx tsc --noEmit` clean. `npm run build` clean — `/api/report/insights` listed as a dynamic route,
  `/dashboard/insights` still prerendered. `node scripts/check-report-data.mjs` (no `--base`) clean at
  7025/7025. `npx eslint` on the nine touched files: the only problems are the three already on
  `app/dashboard/insights/page.tsx` at HEAD (two unused-import warnings and one `set-state-in-effect`
  error in the effect Phase 4 did not change) — confirmed by linting `git show HEAD:` of the same file
  and comparing.
- Fixtures are fixtures. Every mutating case is built by copying the live package and naming the
  mutation inside the fixture's own statement ("synthesised for the state check", "fixture"), and no
  fixture result is reported as a publisher answer.

## Not verified, and why

**No provider call has been made from this machine.** `GEMINI_API_KEY` is unset and `npm run dev` has
no `.env.local`, so the transport returns `not_configured` and the harness proves that path instead
of pretending otherwise. What remains to be seen on a configured deployment: a real Gemini answer
passing the gate end to end, and the real reject rate — how many of the model's sentences the gate
drops for a live bundle. The seam is covered (`no_evidence` refuses before a call, malformed answers
refuse, timeouts pass through), so what is unproven is the model's behaviour, not the plumbing.

**The signed-in browser path is still open.** Supabase is unconfigured here, so no session exists to
present and no successful POST can be made. Deny-by-default is the correct response, and it is
asserted; it is not the same as watching a farmer press the button. To close it:

```
cd C:\Users\lenovo\NexusAgririse
npm run dev -- --port 3100
```

sign in at `http://localhost:3100/login`, open **AI Insights**, build a market bundle, then press
*Generate interpretation*. Check that each sentence's citation jumps to a register row, that a demo
workspace labels its sentences as demo, and that signing out in a second tab makes the panel state
`auth_required` rather than "no data".

## What Phase 5 inherited — and did

`ReportBundle.findings` is part of Phase 2's contract and the orchestrator leaves it empty
(`buildReportBundle.ts:108`); Phase 4 deliberately does not fill it. The sentences travel in
`InsightsPayload` from the POST, because a bundle is a read that must stand on its own when the model
is unavailable. Phase 5 took that rule literally: the PDF's interpretation page is built from the
payload the panel is holding, and prints the same three things the page does — the sentence, the
evidence ids it cites, and the reason anything was dropped — plus the payload's own account of how its
figures were chosen and what was left out of its view. A PDF exported while the interpretation is
still loading, or after it failed, or with no bundle on screen, is refused by the same predicate that
disables the button, and the file then says "no interpretation was generated" instead of inventing
one. The source register and every provenance line come from the bundle, never from AI prose.

What is still unproven is the same thing this phase could not reach from this machine: a real Gemini
answer passing the gate end to end, and the live reject rate. See
[`PDF_REPORT_DATA_AUDIT.md`](PDF_REPORT_DATA_AUDIT.md) §7 for what the file prints.
