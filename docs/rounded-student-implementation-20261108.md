# Rounded student UI implementation · 2026-11-08

## Scope

Approved source images: 01 学生首页, 02 课程学习, 07 学生错题本, 09 手机学习首页. Changes are confined to student presentation and local view state. The implementation uses actual course, lesson, task and mistake data. No backend, schema, role, stored learning data or production service changes.

Implemented:
- Desktop top navigation and mobile bottom navigation; all subjects, word training, timer, themes and logout remain available through the account navigation drawer.
- Deep-green continuing-course hero, amber CTA, mint task card, actual lesson path and self-practice actions.
- Course video entry on the left, actual unit/lesson directory on the right, lesson selection, existing playback/quiz/handout controls and course accuracy notes.
- Mistake list with collapsible answers, existing filters presented inline, mint organization/export panel, time-based reinforcement and links to uploaded questions, review status, weak points and history.
- Full-screen word-training overlay retains its viewport and scrolling priority.

## Preserved behavior and intentional source differences

- Playback still invokes the existing player dialog. The course entry is not a fake media player and does not claim to be playing before a real video is opened.
- Export still invokes the existing range-selection and Word download dialog. No unsupported checkbox-selection export, new print preview or sample paper sheet was added.
- Pending photo submissions remain available through the existing uploaded-question/review-status page, not fabricated as normal mistake records.
- Course titles, lesson counts, tasks, percentages and mistakes come from existing data. The source's design-only label and example figures are not part of production.
- Empty/ungradable accuracy retains the existing “暂无可自动判分的习题” wording.
- Existing local icon library is reused. The new decorative mint hero image contains no semantic app data.

## Verification

Final focused run: 163 tests passed, 0 failed, including all 50 paper-library search/lifecycle tests.

Command:
NODE_PATH=/home/bobo/zhilexue-releases/20261108-ui-integration-materials/test-dependencies/node_modules
NODE_OPTIONS=--require=/home/bobo/zhilexue-releases/20261108-ui-integration-materials/safe-test-preload.cjs
CHROMIUM=/usr/bin/google-chrome
node --test astra-paper-library-search-test.js astra-ui-rounded-student-test.js astra-ui-learning-space-test.js astra-ui-learning-browser-test.js astra-ui-rounded-student-browser-test.js astra-takeover-course-entry-test.js astra-takeover-course-cache-test.js astra-mistake-action-lifecycle-test.js astra-review-calendar-test.js

The final evidence is in docs/ui-evidence-20261108/rounded-student/test-results.txt.
Syntax checks for vue-app.js and bank.js and git diff --check passed.

The browser suite runs production frontend source against synthetic offline HTTP fixtures, not a database or deployed service. It covers widths 1487, 1440 and 390; home, course and mistake rendering; overflow; navigation; theme selection; task quiz entry; lesson quiz entry; video entry dispatch; mistake answer reveal, filters, redo, export range dialog and subpage return; empty/error home; grouped directory/handout access and word-stage geometry. Browser errors and failed resources were empty.

## Visual evidence

Folder: docs/ui-evidence-20261108/rounded-student/
- home-1487.png, home-1440.png, home-390.png
- home-populated-1487.png, home-populated-1440.png, home-populated-390.png
- course-1487.png, course-1440.png, course-390.png, course-grouped-390.png
- mistakes-1487.png, mistakes-1440.png, mistakes-390.png
- browser-1487.json, browser-1440.json, browser-390.json

Desktop viewport: 1487×1058 or 1440×1058, DPR 1.
Mobile viewport: 390×844, DPR 1. Content below the viewport is accessible through the app scroller.

Visual iteration fixed the old rail's shrinking content geometry, an unavailable icon, blue legacy hero art, mobile illustration/title overlap, stale subpage tabs and the inherited fixed-height word-stage override. The parent integration pass owns the combined student/quiz/admin design-QA report. Student visual QA and whole-project regression evidence are recorded in the final sections below.

## Files

Production:
- public/js/vue-app.js
- public/js/bank.js (mistake card, tab mount and subject-page presentation only)
- public/index.html
- public/css/ui-rounded-student-20261108.css

Tests:
- astra-page-api-lifecycle-test.js (new exact count/empty-state markup with original valid-host lifecycle retained)
- astra-paper-library-search-test.js (models the new inline tab mount separately from the legacy mount, and loads the real shared optText helper; all original assertions retained)
- astra-ui-rounded-student-test.js
- astra-ui-rounded-student-browser-test.js
- astra-ui-learning-browser-test.js (desktop navigation assertion follows the approved topbar)
- test/fixtures/ui-learning/learning-live.html (loads the new production CSS)

The shared original learning stylesheet is left unchanged. No commit was made.

## Whole-project regression continuation

After the parent integration run exposed an old overview-card assertion, astra-page-api-lifecycle-test.js was updated to require the new exact zero-count markup and empty-state heading. Its original valid-host quiz/onDone flow remains, with added assertions that one pending question is present before completion and the old question stem disappears afterward. This is a presentation-contract update; no production business logic changed.

The isolated lifecycle file passed 11/11. The complete npm run test:takeover then finished with TAKEOVER_EXIT:0 and no failing tests. Evidence: evidence/rounded-validation/takeover-student-continuation.log. The combined visual design-QA gate remains owned by the parent integration pass.

## Final student visual QA: approved 01 / 02 / 07 / 09

Scope: only the four student surfaces owned by this implementation. The parent still owns the combined student/quiz/admin design-QA report. This section does not substitute for real-account integration acceptance.

### Evidence and comparison method

Each approved image and its corresponding latest browser screenshot was opened together in the same tool comparison output, not assessed from file names or memory. The desktop pairs use identical 1487×1058 pixel dimensions, CSS viewport 1487×1058 and deviceScaleFactor 1. The mobile source is actually 852×1846 pixels; it was width-normalized to 390×845 for the final paired inspection against the browser's 390×844 CSS-pixel/DPR-1 screenshot. The 1px height difference does not affect the result. No device bezel or browser chrome is included. All implementation images are rendered production frontend code against synthetic offline fixture responses, not screenshots of real student records.

Approved source folder: /workspace/scratch/a1ed3e1d0429/zhilexue-design/output/.
Implementation evidence folder: docs/ui-evidence-20261108/rounded-student/.

| Approved source | Latest implementation | Compared state and conclusion |
| --- | --- | --- |
| 01-学生首页.png | home-1487.png; home-populated-1487.png supplements nonempty tasks | Empty task state is paired with the reference. White top navigation, large dark-green greeting, approximately 2.65:1 hero/tasks grid, amber CTA, mint empty-task card, learning rows and practice region follow the source. The actual fixture has one returned lesson and different course/progress data, so row count and whitespace intentionally differ. Populated tasks retain their original start/retry behavior. |
| 02-课程学习.png | course-1487.png; course-grouped-390.png supplements grouped access | Default selected lesson before playback. Left large rounded video entry, three category pills, lesson statistics and practice banner align with the right white unit-directory card and amber summary. The fixture returns one flat lesson instead of the reference's multi-group example. Group expansion, selected lesson, handout and group actions are separately covered. The entry deliberately opens the existing player dialog rather than drawing inactive timeline/volume/fullscreen controls. |
| 07-学生错题本.png | mistakes-1487.png | Mathematics tab with two pending mistakes, answers collapsed. Main visual regions match: green title, rounded filter bar, white question cards, mint answer disclosure and mint right organization panel. Real question options make cards taller. Existing time/count filters and review actions are retained. The right panel launches the original range-based Word export, rather than pretending that unsupported selected-checkbox export or a new print preview exists. |
| 09-手机学习首页.png | home-390.png | Mobile empty-task state. The corrected capture shows one green hero, a compact single-line mint task summary, both self-practice actions above the fixed bottom navigation, and no clipping or horizontal overflow. The original account/menu remains available, unlike the reference's simplified header. Data, illustration scale and the omitted design-only badge account for remaining small differences. |

Titles, lesson quantities, task counts and percentages in these screenshots are synthetic fixture values used only for safe testing. Production uses existing API values; no reference sample values are hard-coded into app data. Differences in subject/edition, number of lessons or selected task states are not treated as pixel-fidelity defects.

### Findings, correction and post-fix comparison

- P2 found in 09: the initial empty-task card was 91.19px high and the second self-practice action ended at 869.45px, below the fixed navigation starting at 761.61px. The two-line task summary and excess hero/row spacing materially changed the approved first-screen density.
- Fix: mobile-only CSS compacts the hero's internal rhythm, presents only the true empty-task state as a single row, and reduces practice-row spacing. Populated task cards and error/reload states remain full content. No handler, API, data or navigation route changed.
- Regression: added browser assertions that the mobile empty-task summary is at most 68px and both self-practice actions fit above the navigation in the matched fixture. The first run failed on the measured old geometry; the corrected run passed. Evidence: mobile-density-red.txt and browser-postqa.txt.
- Capture correction: the test now waits until the navigation drawer's closing animation fully leaves the viewport before taking the empty-task screenshot. This removes a transient partial drawer from evidence; application behavior was not changed.
- Post-fix: reopened the width-normalized 09 reference and latest home-390.png together. Both practice actions are fully visible, the green hero remains dominant, text does not collide with the mint illustration, and the task row matches the intended compact hierarchy. The final full browser capture suite passed 4/4; the focused combined suite passed 163/163 after the CSS correction.

### Five fidelity surfaces

- Typography: local CJK fallback remains; large green display headings, bold card titles and smaller muted metadata reproduce the source hierarchy. Long fixture course/lesson titles remain readable and do not overlap the illustration or controls. Exact generated-reference glyphs are not a shipped font dependency.
- Spacing/layout: desktop two-column proportions, round cards, generous margins and pill controls match the intended composition. The identified mobile first-screen density mismatch is fixed. Dynamic extra rows still scroll normally; they are not hidden to imitate the mock.
- Colors/tokens: warm off-white page, deep-green hero/text, pale-mint cards and amber primary CTA match the approved family. Existing eye-care/green themes remain functional. Flat production fills intentionally avoid imitating image-generation texture.
- Image quality: the generated transparent mint book/ruler/card/yellow-pencil asset is sharp, correctly masked and free of white rectangular backgrounds. Existing brand/avatar assets and icon font are retained. No new CSS drawings replace the reference illustration. Remaining illustration scale/pose and icon-shape differences are non-blocking P3 refinements.
- Copy/content: design-only labels and sample lesson numbers are omitted; headings and actions describe existing functionality. Empty states, ungradable accuracy, range-based export, and pending-upload access retain honest business semantics. No fake controls or records were added to chase visual similarity.

The full images render at sufficient resolution to read headings, button labels, filter labels, card tags and supporting text; no additional crop was necessary for these four comparisons. Remaining P3: generated illustration pose/scale, local icon silhouettes, avatar treatment and subtle background texture. There are no remaining actionable P0/P1/P2 findings within these four student pages.

### Intentional original-interaction differences

1. Video entry opens the existing player dialog, where actual playback controls belong. No in-page player or new playback state is fabricated.
2. Export opens the existing range/contents Word dialog. The source's per-card selection, decorative paper preview and separate print-preview button are not new product features in this UI-only change.
3. Pending photo uploads use the existing uploads/review-status route, not a fake editable/redoable mistake record.
4. Existing keyword/filter flows remain reachable through the original all-mistakes/filter route; the overview exposes supported source/point/time/count controls rather than inventing a new search contract.
5. Word learning, timer, all subjects, account actions and themes remain accessible in the account drawer. Mobile keeps that account/menu control even though the visual mock omits it.
6. Task lists, lesson groups, progress and answer results use returned data. Multi-row content may extend below the fold rather than being discarded to mimic a static mock.

Student visual QA final result: passed. No commit was made.

## Exact full takeover accounting after visual correction

The full command was rerun after the mobile CSS correction and completed with TAKEOVER_EXIT:0. Final log: evidence/rounded-validation/takeover-post-student-visual-qa.log. Earlier continuation logs are historical evidence, not the final run.

Invocation:

    NODE_PATH=/home/bobo/zhilexue-releases/20261108-ui-integration-materials/test-dependencies/node_modules NODE_OPTIONS=--require=/home/bobo/zhilexue-releases/20261108-ui-integration-materials/safe-test-preload.cjs CHROMIUM=/usr/bin/google-chrome CHROMIUM_PATH=/usr/bin/google-chrome npm run test:takeover

There are 33 top-level command groups. Of these, 28 Node TAP groups report 749 tests passed, zero failures/cancellations/skips/todos. The other five custom runners report 58 checks passed (15 + 8 + 8 + 15 + 12). These are stated separately because their units differ. Do not add nested printed assertions such as the course-cache runner's 12 checks on top of its one TAP wrapper test. Do not describe all 807 entries as browser or end-to-end tests.

| # | Top-level command | Verified result |
| --- | --- | --- |
| 1 | npm run test:multer | 24 TAP tests passed |
| 2 | npm run test:access | 264 TAP tests passed |
| 3 | node --test t13-font-fit-test.js | 5 TAP tests passed |
| 4 | node --test astra-readonly-tree-cli-test.js | 14 TAP tests passed |
| 5 | node --test astra-tree-cli-offline-e2e-test.js | 9 TAP tests passed |
| 6 | node --test astra-paper-library-search-test.js | 50 TAP tests passed |
| 7 | node --test astra-page-api-lifecycle-test.js | 11 TAP tests passed |
| 8 | node --test astra-mistake-action-lifecycle-test.js | 36 TAP tests passed |
| 9 | node --test astra-primary-grade-coverage-test.js | 43 TAP tests passed |
| 10 | node --test astra-review-calendar-test.js | 29 TAP tests passed |
| 11 | node --test astra-paper-preview-content-test.js | 10 TAP tests passed |
| 12 | node --test astra-paper-deadline-test.js | 11 TAP tests passed |
| 13 | node --test astra-review-legacy-sentinel-test.js | 15 TAP tests passed |
| 14 | node --test astra-assignment-deadline-test.js | 11 TAP tests passed |
| 15 | node --test astra-pending-review-filter-test.js | 9 TAP tests passed |
| 16 | node --test astra-lesson-rich-preview-test.js | 7 TAP tests passed |
| 17 | node --test astra-admin-paper-rich-preview-test.js | 12 TAP tests passed |
| 18 | node --test astra-student-edition-select-test.js | 4 TAP tests passed |
| 19 | node --test astra-teacher-intake-lifecycle-test.js astra-manual-intake-draft-test.js | 30 TAP tests passed |
| 20 | node --test astra-takeover-treeio-test.js | 27 TAP tests passed |
| 21 | node astra-takeover-accuracy-test.js | 15 custom checks passed (non-TAP) |
| 22 | node astra-takeover-word-layout-test.js | 8 custom checks passed (non-TAP) |
| 23 | node astra-takeover-password-safety-test.js | 8 custom checks passed (non-TAP) |
| 24 | node --test astra-takeover-sort-import-test.js | 36 TAP tests passed |
| 25 | node --test astra-takeover-course-cache-test.js | 1 TAP tests passed |
| 26 | node --test astra-takeover-course-entry-test.js | 28 TAP tests passed |
| 27 | node --test astra-takeover-binding-scope-test.js | 6 TAP tests passed |
| 28 | node --test astra-takeover-role-scope-test.js | 14 TAP tests passed |
| 29 | node --test astra-assignment-idempotency-test.js | 11 TAP tests passed |
| 30 | node --test astra-takeover-paper-transaction-test.js | 6 TAP tests passed |
| 31 | node astra-takeover-word-responsive-test.js | 15 custom checks passed (non-TAP) |
| 32 | node astra-takeover-admin-responsive-test.js | 12 custom checks passed (non-TAP) |
| 33 | node --test astra-care-store-test.js astra-reassignment-entry-test.js | 26 TAP tests passed |

The two npm subcommands expand to security/access test files as defined in package.json; they remain one command group each in the table. The package's explicit notes that word-layout/browser geometry is pending and that admin-responsive checks are source contracts remain respected. The independent rounded-student browser suite is the evidence for the student UI geometry and interactions, not those source-only checks.

Safety and coverage boundary: this is isolated frontend/unit/fixture regression, not verification against real APIs, live accounts, production MySQL or real student data. The safe-test preload rejects application database initialization, private configuration reads, nonfixture sockets, and connections/listeners on live service/database ports. Tests may use in-memory synthetic data and local fixture HTTP servers. No real video CDN, live AI, persistent production database, account mutation or service3000 was exercised. A later isolated real-backend integration pass remains necessary before making claims about live business acceptance.
