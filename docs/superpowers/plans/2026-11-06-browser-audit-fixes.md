# Browser audit fixes implementation plan

> Execute inline in the dedicated cloud checkout; the user has already requested implementation and a later independent Astra acceptance pass.

**Goal:** Repair reproducible code defects in the 2026-11-06 browser report at baseline `5eeb5426d6235022a159fb86eed102bd619359d5`.

**Architecture:** Reuse the existing MathJax, MathLive, pending review state and shared student quiz. Add focused browser regressions without changing stored answers or grading rules. Keep the existing no-build frontend.

**Spec:** Library `libfile_b010decc7b508191b8f4cf3dd39da286`, downloaded and read in this environment under `/workspace/review-input/` (PDF fallback also verified).

## Constraints

- Continue from `feat/t14-r2-r11-followup`; push a separate fix branch only. No merge or deployment.
- Use synthetic data, local storage, mock AI/TTS and a new loopback MySQL test database. No production resources.
- No video retest, actual exam recognition, model switching or product download retries/workarounds.
- D01/D02 curriculum data and UI02 password-policy redesign need authoritative scope; do not fabricate curriculum or silently change account policy.

## Review focus

- Formula rendering must escape HTML, leave edit values unchanged, and handle both historical bare LaTeX answers and delimited mixed text.
- Returning from a quiz must refresh the same subject and never submit a second time.
- Import navigation must clear stale search, batch, review, selection and view-mode state.
- Layout fixes must expose actual controls at desktop and narrow widths, without hiding overflow.
- Empty curriculum scopes must remain selectable and must clear another subject's nodes; no claim of complete curriculum.

## Tasks

- [x] 1. Reproduce report defects in `browser-audit-test.js` with real Chromium and synthetic/local fixtures; retain baseline failures.
- [x] 2. Repair UI07 read-only manual/paper preview math and student feedback/report math; verify fractions, roots, scripts, mixed text and escaping.
- [x] 3. Repair UI09 task refresh, UI10 light/dark feedback colors and UI11 import navigation; run targeted regressions.
- [x] 4. Repair D01 scope access, UI01 login text/validation, UI03 word selection state, UI05 manual width, UI06 editor keyboard, and UI08 embedded grades spacing where reproduced. Keep UI04 fixed large panel and verify reachability; record remaining suggestions.
- [x] 5. Run related existing tests and full required regression set against the synthetic test database, review diff, synchronize docs, commit and push fix branch. Report every D/UI/ENV item and retained untested boundaries.

## Execution notes

- Dedicated cloud checkout was clean. Remote main is `61a578c`, followup is `5eeb542`; no existing changes overwritten.
- No `.agents/skills` exists in this checkout or its workspace parent.
- Report paragraphs, all 22 embedded problem crops, all 93 coverage IDs and stop boundaries were read. A reported untested item is not automatically a defect.
- Default npm cache is read-only; dependency setup uses `/tmp/zhilexue-npm-cache`.

## Final verification and rulings

- 72 scripts final exit zero; browser audit 18/18; words layout 34/0. Evidence in `docs/test-results-browser-audit-20261106.json`.
- Review findings: script-only math, report close, capture/workbench navigation, keyboard flex shrink — added RED cases and verified GREEN.
- Ruling: genuine empty curriculum scopes stay selectable; missing authoritative content remains blocked rather than fabricated. Cost if wrong: curriculum acceptance stays incomplete.
- Ruling: preserve confirmed fixed large panel and existing password policy; first-screen sticky actions and password lifecycle require product scope. Cost if wrong: these suggestions remain open.
- Ruling: do not infer raw formula boundaries inside arbitrary already-delimited mixed text. Cost if wrong: ambiguous historical mixed answers need explicit formula delimiters.
- Integration follows the explicit task instruction: fix branch only, no main merge/deployment; later Astra acceptance remains pending.
