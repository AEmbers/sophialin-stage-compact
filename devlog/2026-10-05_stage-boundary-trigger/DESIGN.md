# DESIGN: Stage-boundary compaction trigger (AutoCompact posture)

- Task ID: `2026-10-05_stage-boundary-trigger`
- Home Repo: `billion-context`
- Created: 2026-10-05
- Status: Accepted — shape 2 approved by the owner and implemented (see REQ.md § 4)

## 1. Goals & Non-Goals

- **Goals**: make the moment of compaction a resolved *stage* rather than an occupancy line; make the summary a working state (conclusions / artifacts / next actions) instead of a digest; make continuation after a fold explicit; keep the percentage layers as a safety net only.
- **Non-Goals**: training a policy; a proxy-inferred structural stage detector; touching `acp-kernel` defaults; changing plugin-mode behaviour.

## 2. Background & Motivation

arXiv:2610.02163 measures, on SWE-bench Verified / SWE-PolyBench Verified, that a *fixed length-threshold* compaction policy scores **below** doing no compaction at all (28.8 / 18.6 vs 30.4 / 19.5 for the full-history baseline). The best training-free tier is a rubric the model applies itself (SelfCompact 31.7 / 20.6); the trained tier reaches 39.6 / 24.5. The paper's own conclusion is that prompting alone does not induce proactive compaction — so the shipping strategy has to be "give the model the trigger, the working-state contract and the continuation rule, and stop letting a percentage line speak first".

This proxy already sits on the right side of the threshold question: it has a growth layer, a pressure layer, and an emergency layer, and the philosophy text asks for compression by need. What it never had was a definition of *need*.

## 3. Current Architecture (as-is)

| Layer | Line | Fires when | Gate |
|---|---|---|---|
| Growth | `nudge.growthFloor` / `nudgeGrowthTokens` | absolute token growth since the last nudge | cadence-gated; adaptive band |
| Pressure | `nudge.maxContextLimitPct` (`compress.maxContextLimit`, default 0.75) | usage ≥ band | **no cadence gate** (`node_modules/acp-kernel/dist/index.js:5753`) |
| Emergency | `nudge.emergencyThresholdPct` (default 0.95) | usage ≥ line | forced nudge + truncation |
| Host escalation (#453) | `src/server/budget.ts:21` = 0.70 | usage ≥ line and compressible content exists | host-side, overrides the kernel's cadence silence |

The compression tool surface, by contrast, is injected unconditionally — `src/server.ts:3245`, `const injectTools = opts.compress.injectTool && !pluginMode;` — so the model may already compress on any turn. Nothing in the proxy prevented a stage-driven decision; the percentage lines simply made one unnecessary.

## 4. Proposed Design (to-be)

**Shape 1 — landed on the branch.**

1. `src/compress-settings.ts` — `resolveCompressPrompts` returns `stageAwarePrompts()` on all three no-override paths: the kernel's `compressPhilosophy` + a stage trigger and continuation rule, and `WORKING STATE` + the kernel's `howToCompressRules`. Kernel text is appended verbatim underneath, so upstream edits still land. A string the operator supplies still replaces that key wholesale; a non-string still never clobbers a default.
2. `src/server/budget.ts` — new `escalationLine(band, declared)`: returns `band` when the operator declared one, `undefined` otherwise so `emergencyNudge` keeps its 0.70 default. The four call sites in `src/server.ts` (`3376`, `3608`, `3856`, `4148`) pass it.
3. Docs + CHANGELOG carry the rationale and the backstop recipe.

**Shape 2 — accepted and shipped (owner decision, 2026-10-05).** The default posture itself is demoted:

1. `src/config.ts` — new exported `DEFAULT_MAX_CONTEXT_LIMIT_PCT = 0.9`, applied to the base kernel config by `withForkNudgeBand()` at the `loadOptions` return. A declared `compress.maxContextLimit` still wins, because `applyCompressSettings` runs per request on top of that base.
2. `src/server/budget.ts` — `escalationLine()` is deleted; the host line is simply `config.nudge.maxContextLimitPct`. With the band at 0.90 nothing forces a nudge below 90%, so the host's remaining role is the kernel's `minPressureBenefit` override rather than an earlier trigger.
3. `tests/issue453-backstop.test.ts` — the two integration cases are rewritten: 72% is silent at the shipped band, and a band declared at 70% still forces at 72% (positive control). The `emergencyNudge` unit cases are untouched, since they drive the line explicitly.
4. Docs (both languages) and CHANGELOG state the new default, the growth layer that still nudges underneath, and the one-line way back (`{"compress": {"maxContextLimit": "75%"}}`).

### Config surface (required disclosure — AGENTS.md rule 1)

- **What is changed**: `compress.maxContextLimit` is **re-semanticized**, not added. It already meant "context-usage threshold that triggers forced compression nudges"; it now also sets the host's #453 escalation line, so the host cannot force a nudge *earlier* than the line the operator chose. `units` and `semantics` are unchanged (ratio or percent string, deeper level wins); only the consequence of declaring it widens.
- **Why the existing surface cannot express it as-is**: today a declared band is silently overridden below 0.70 by a hard-coded host constant. An operator who declares 0.90 gets a 0.70 trigger and no indication of it. Honouring the declared value needs no new field — the field already says what the line should be.
- **Existing mechanisms considered**: (a) the three-level `compress` hierarchy — used, no new shape; (b) the `providers[<name>]` key species — not applicable, this is per-request compaction behaviour, not a route; (c) a `BILI_*` env var — rejected, the surface already has a per-request config path and env vars are documented as overrides of last resort; (d) a new nested object inside `compress` (the `absorb` / `ccr` / `search` species) — **this is the shape any future stage-trigger knob should take**, and it is deliberately not taken now because shape 1 needs no new field.
- **Compat / migration**: undeclared → byte-identical behaviour (the 0.70 default and the #453 guard are untouched, proven by `#453 escalation` still firing at 72%). Declared → the operator's own line, which is what the documentation always promised. No migration step, no config rewrite.

## 5. Alternatives Considered

| Option | Pros | Cons | Decision |
|---|---|---|---|
| Ship the prompts only, leave both percentage layers as they are | Zero config-surface exposure; smallest diff | The documented backstop recipe does not work; the trigger stays at 70% | Rejected — leaves the field lying |
| **Shape 1** (landed): prompts + a declared band governs the host line | No new field; default behaviour untouched; the documented posture becomes real | Does not demote the *default* posture | **Chosen for this branch** |
| Shape 2: ship `maxContextLimit` at `"90%"` | Out-of-the-box model-driven posture | Re-semanticizes a documented default for every deployment | Owner decision (REQ.md § 4) |
| Shape 3: delete the host escalation line | Strongest demotion, nothing to configure | Retires #453's guard; `tests/issue453-backstop.test.ts:208` must be rewritten | Tried first, reverted; owner decision |
| Change `acp-kernel`'s own defaults | No fork-side divergence | Permanent conflict at every upstream merge; the kernel is a pinned dependency | Rejected |
| Proxy-side structural stage detector | Would fire without the model | Not needed — the tool is already unconditionally injected; invents a config shape the `compress` hierarchy cannot justify | Rejected as a non-goal |

## 6. Risks & Trade-offs

- **Backward compatibility**: shape 1 — none (undeclared behaviour identical). Shapes 2/3 — behavioural by definition; documented per shape.
- **Performance**: none. No extra per-turn work; `escalationLine` is a branch on an already-resolved value.
- **Cross-platform** (Node ≥ 20; Linux / macOS / Windows): none; no new I/O, no path handling.
- **Longer pre-fold window (shapes 2/3)**: a session whose model ignores the policy folds later and harder. The hard preflight wall and the output clamp are unchanged, so an oversized payload still fails fast rather than reaching the upstream.

## 7. Open Questions

1. Which shape — 1 (default unchanged), 2 (fork default demoted to 90%), or 3 (host line removed, #453 guard retired)?
2. If shape 2: is `90%` the intended default, or should the emergency layer move with it?
3. Do the later AutoCompact mechanisms (salvaging confirmed fragments from rejected summaries, a cross-round log-trend advisor, per-stage briefing) belong in this repo at all, and if so as prompts, as `compress`-nested options, or as tooling?
