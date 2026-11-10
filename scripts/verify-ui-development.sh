#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1 && [ -x /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node ]; then
  export PATH="/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
fi
mkdir -p evidence
npm run test:takeover > evidence/final-takeover.log 2>&1
npm run test:ui-concepts:unit > evidence/final-ui-unit.log 2>&1
node --test astra-ui-learning-browser-test.js > docs/ui-evidence-20261108/learning/browser-test.txt 2>&1
node --test astra-ui-quiz-workbench-test.js > evidence/quiz-browser-run.log 2>&1
node ui-review-concept-test.js --browser > evidence/review-browser-run.log 2>&1
node scripts/ui-compare-captures.js > evidence/comparison-render.log 2>&1
for file in public/js/vue-app.js public/js/bank.js public/admin/pendingui.js public/admin/admin.js; do node --check "$file"; done
git diff --check
printf 'PASS: takeover, UI unit, 3 browser suites, comparison capture, syntax, and diff checks\n'
