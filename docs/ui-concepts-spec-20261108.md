# Approved UI concept implementation

The user approved the three concept images on 2026-11-08 and requested parallel UI development with close visual comparison. This is implementation in an isolated copy, not authorization to deploy or publish.

Visual source: ../zhilexue-ui-concepts-20261108/01-智乐学-学生学习空间-概念图.png, 02-智乐学-固定答题工作台-概念图.png, 03-智乐学-后台逐题审核-概念图.png. All are 1487 × 1058. Target uses near-white surfaces, royal blue controls, dark navy text, thin blue-gray separators, modest radii, outline icons and open rows rather than repeated heavy cards.

1. Student learning space: approximately 218 px light-blue navigation, 82 px top bar, heading, a wide pale-blue continuing-course hero with real course/progress data, task rows and two self-practice actions. All existing subjects, account/theme/logout and training paths remain accessible. Empty data must produce truthful empty states, never hardcoded concept numbers.
2. Answer workbench: full viewport, slim titlebar, progress strip, ~66% question region and ~34% answer-card/AI region. Existing validation, rich math/media, answer types, submit flow, explanation gating, progress and navigation retained. Wrong/right states use both text/icon and color; no answer or analysis before authorization. Controls remain accessible on small screens.
3. Admin review: dark navy sidebar, title/workflow header, compact source/status filters, left question list, center full preview and right classification panel, bottom previous/next and guarded commit. Preserve all provenance, original-page, crop/merge, content/image review, AI suggestion confirmation, batch and pagination safeguards. No UI-only fake confirmation or direct bypass of existing commit checks.

Use existing local icon font and brand assets where possible. Illustration assets are decorative and should not contain semantic data. Core production UI must use real API data only. Browser fixtures are synthetic, isolated, clearly marked in evidence and never production source.

No backend/database/schema/security changes are intended. Keep existing native frontend runtime. Produce a narrow verified patch with before/after hashes, screenshots at source-size plus 1440/390 responsiveness, test results and limitations. The 450-file safe source snapshot matches deployment commit 17840bc core paths, but omits full historical/config files; never use it as a whole-repository replacement.
