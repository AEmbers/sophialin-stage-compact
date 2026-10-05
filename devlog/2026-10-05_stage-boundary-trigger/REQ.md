# REQ: Stage-boundary compaction trigger (AutoCompact posture)

- Task ID: `2026-10-05_stage-boundary-trigger`
- Home Repo: `billion-context`
- Created: 2026-10-05
- Status: **Accepted — owner chose shape 2 (2026-10-05); implemented on this branch**
- Priority: P1
- References: arXiv:2610.02163 (*AutoCompact: Learning When to Compact Context in Long-Horizon Coding Agents*); branch `2026-10-05_stage-aware-compression` (commits `95512aea`, `07e99ddb`)

## 1. Background & Problem Statement

- **Context**: compaction here is triggered by window occupancy and by absolute token growth. The kernel's `compressPhilosophy` already asks for compression "by need, not by percentage", but neither it nor `howToCompressRules` defines what *need* is or what a summary must carry — so in practice the percentage bands are the trigger and the model only ever reacts to them.
- **Current behaviour (symptom)**: a long session is folded when usage crosses a line, not when a unit of work finishes. The summary that lands carries whatever the model happened to consider important at that moment; paths, signatures, live decisions and "what not to redo" are lost, and the next stage re-derives them.
- **Expected behaviour**: the model compresses at a *resolved stage* (subtask finished, a check passed, the cause is localized, work is switching), writes a working state rather than a digest, and continues from it. Percentage thresholds stay armed only as a safety net for the turns where the model does not act.
- **Impact**: fewer wall-triggered folds; less re-derived work after each fold; the failure mode the paper measures (fixed length-threshold compaction scoring *below* no compaction at all: 28.8 vs 30.4 on SWE-bench Verified) is the one this repo currently ships.

## 2. What is already on the branch (not yet proposed for merge)

| Commit | Change | Config surface |
|---|---|---|
| `95512aea` | Default prompts gain a stage trigger and a `WORKING STATE` three-section contract; kernel text kept verbatim beneath both | **none** — `prompts` default text only; a configured `prompts` block still wins wholesale, still gated by `acknowledgePromptsRisk` |
| `07e99ddb` | A *declared* `compress.maxContextLimit` now also governs the host's #453 escalation line, so the host never forces a nudge earlier than the line the operator chose | **re-semanticizes an existing field** (disclosed below); no new field |

Measured before/after on the branch: `typecheck` 0, `build` 0, `tests/issue453-backstop.test.ts` 11/11, the 11 compression/nudge test files 92/92, full `npm test` reduced to the 4 pre-existing environment failures (dsh install/remove ×2, `#1590`, `resolveProxyDecision`) — all four reproduce on a clean `master` checkout.

## 3. Why the trigger question is *not* a detector question

An earlier draft of this proposal assumed the missing piece was a structural stage detector inside the proxy. That is wrong, and the code says so:

- `src/server.ts:3245` — `injectTools = opts.compress.injectTool && !pluginMode`. The compression tool surface is injected **unconditionally**: it is not gated on a nudge, a band, or a stage. The model can decide to compress on any turn already.
- The kernel's pressure branch (`node_modules/acp-kernel/dist/index.js:5753`) has no cadence gate: above `nudge.maxContextLimitPct` it fires every turn.

So the model can act whenever it wants; what it cannot do is avoid being *told* to act by a percentage line that fires earlier and more often than its own judgement would. The remaining work is therefore **only** about how much of the percentage layer stays armed — a defaults decision, hence this proposal.

## 4. The decision (owner call, three shapes)

| # | Shape | Effect | Cost |
|---|---|---|---|
| **1** | **Backstop only** — keep the shipped defaults; an operator who wants model-driven triggering writes `{"compress": {"maxContextLimit": "90%"}}` | Fork default unchanged; the documented posture is now actually reachable (before `07e99ddb` it was not) | None |
| **2** | **Demote the fork default** — ship `maxContextLimit` at `"90%"` (host line follows it) | Out-of-the-box posture becomes "the model decides; 90% is the net" | Changes a documented default for every deployment of the fork |
| **3** | **Remove the host #453 escalation line entirely** — the kernel band is the only percentage trigger | Strongest demotion; nothing the operator can configure | Deletes a production regression guard (#453: silent climb then upstream 400 on input+output). `tests/issue453-backstop.test.ts:208` encodes it and would be rewritten — this was tried first on the branch and reverted for exactly that reason |

**Recommendation: 1 now, 2 as an explicit fork decision, 3 only if the operator accepts losing #453's guard.** Shapes 2 and 3 both require sign-off *before* implementation per rule 3; shape 1 needs none and is already on the branch.

**Owner decision (2026-10-05): shape 2.** The fork's default posture is demoted. Consequences recorded at the moment of the decision: the shipped band becomes `0.90`, the host #453 escalation line reads that same band (so no forced nudge exists below 90%), and the pre-band forcing that #453 introduced — the 70%→75% window — is retired by design rather than by accident. The regression coverage is rewritten to assert the new posture *and* to keep a positive control (a band declared at 70% still forces at 72%), so silence at the default band cannot be mistaken for a broken escalation.

## 5. Constraints & Non-Goals

- **Constraints**:
  - Backward compatibility: an absent `compress` block must behave exactly as today, bit-for-bit.
  - `AGENTS.md` § "Configuration Surface Discipline" — no new config shape without prior owner sign-off; any re-semantics of an existing field is disclosed under a "config surface" heading.
  - Any change to nudge/wire behaviour must hold in **both** plugin mode and proxy mode (§ "Configuration Surface Discipline" neighbours, and the plugin surface is where desktop hosts run).
  - No `as any`, no `@ts-ignore`; server-side logging through `loggerLog`.
- **Non-Goals** (explicitly out of scope):
  - A proxy-side structural stage detector inferred from wire traffic. It is not needed for the trigger (§ 3), and inventing one would add a config shape that the existing three-level `compress` hierarchy cannot justify.
  - Training a compaction policy (the paper's SFT→RL tier). The fork stays training-free.
  - Changing the kernel's own defaults, which would diverge from upstream on every merge.

## 6. Acceptance Criteria (must be testable)

- **Correctness**:
  - [x] With no `compress.maxContextLimit` declared, the host escalation line is unchanged at 70% and `#453 escalation` still fires at 72%.
  - [x] With `compress.maxContextLimit: "80%"` declared, 72% produces no nudge and the message count matches a 60% control.
  - [x] A configured `prompts` block still replaces the affected key wholesale; the stage additions are never appended to an operator override.
  - [x] Kernel prompt text remains byte-identical beneath the additions.
- **Performance / Stability**:
  - [x] `npm run typecheck` and `npm run build` clean.
  - [ ] For shape 2 or 3: re-run the #453 and silent-backend lanes and state explicitly which guarantee is being retired.
- **Regression**:
  - [x] New/modified cases added to the suite (`tests/issue453-backstop.test.ts` 11/11) and passing.
  - [x] Full `npm test` shows no failure beyond the four pre-existing environment failures.

## 7. Proposed Approach (for the accepted shape)

- **Affected modules & entry files**: `src/compress-settings.ts` (prompt resolution), `src/server/budget.ts` (escalation line), `src/server.ts` (four call sites: `3376`, `3608`, `3856`, `4148`), `CONFIGURATION.md` + `CONFIGURATION.zh-CN.md`, `CHANGELOG.md`, `dist/`.
- **Risks**: shape 2/3 lengthen the window between the last nudge and the hard preflight wall, so a session whose model ignores the policy folds later and harder; the preflight wall itself is unchanged and still fails fast rather than sending an oversized payload.
- **Rollback strategy**: the whole branch is one `git revert` of two commits; shape 1 ships behind nothing and changes no default, so a revert is behavioural no-op for every deployment that declares no band.
