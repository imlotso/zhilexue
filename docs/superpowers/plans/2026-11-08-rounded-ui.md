# Approved rounded UI implementation plan

> **For agentic workers:** Use superpowers:executing-plans for assigned units.

**Goal:** Apply all ten approved visual references to the existing student and admin frontends without business changes.
**Architecture:** Preserve existing Vue/DOM renderers, API calls, role checks, input identifiers and handlers. Add narrowly scoped styles and present existing data in the approved layout. Start from reviewed media baseline ad6b6f8 (parent76e2254).
**Tech Stack:** Node/Express, Vue3 student, Vue2/admin DOM, CSS, local icon library, Playwright synthetic fixtures.
**Spec:** Approved PNGs 01 through10 and 智乐学UI方案说明.txt, supplied by user through the parent task.

## Constraints
- UI only. No src, DB, real records, live service or deployment lock edits.
- Retain all previous routes and permissions; never substitute mock design values in production.
- Deep forest green, mint, warm white, amber primary action, 24–28px containers and pill controls.
- Reuse existing branding and generated matching illustrations.

## Review Focus
- Empty/no-grade/pending-grade distinctions remain truthful.
- Mobile drawer/bottom navigation closes and preserves other routes.
- Quiz answer, formula, submit, AI gating and resize behavior remain intact.
- Review classification save and publish remain distinct actions.
- Course/unit/video and report scopes still use the original data flow.

## Units
- [x] Student homepage/course/mistakes/mobile: vue-app.js, ui-learning CSS, bank mistake section, index.html. Existing learning tests and new browser layout checks.
- [x] Admin review/compose/report/intake: page modules and scoped page CSS. Existing lifecycle/role tests plus rendered interactions.
- [x] Admin common shell/dashboard: admin.js presentation, new ui-rounded-shell CSS, index.html. rounded-shell-test.js and viewport browser tests.
- [x] Quiz: existing ui-quiz CSS plus small safe presentation change, existing browser/mode/formula tests.
- [x] Integrated QA: syntax, isolated takeover suite, all new UI tests, 1487/1024/390 screenshots compared with reference, document exact pass/fail/blockers.
