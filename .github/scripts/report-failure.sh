#!/usr/bin/env bash
# Opens (or updates) a GitHub issue when a sync run fails, for ANY reason.
#
# This exists because the original workflow only reported failures on the
# conflict path. When pushes started being rejected on 2026-08-01 (upstream
# added .github/workflows/canary-release.yml, which GITHUB_TOKEN may not write),
# ten consecutive runs failed and produced no issue and no notification. The
# fork silently fell 36 commits behind.
#
# Idempotent: one issue per upstream tag. Repeat failures add a comment rather
# than opening a new issue every day.
set -euo pipefail

TAG="${TAG:-unknown}"
ACTION="${ACTION:-unknown}"
RUN_URL="${RUN_URL:?RUN_URL is required}"
LABEL="upstream-sync"
TITLE="Upstream sync failed for ${TAG}"

# The label may not exist yet; create it once, ignore if it already does.
gh label create "$LABEL" --color B60205 --description "Automated upstream sync" 2>/dev/null || true

BODY=$(cat <<EOF
The automated upstream sync failed.

| | |
|---|---|
| Upstream release | \`${TAG}\` |
| Merge result | \`${ACTION}\` |
| Run | ${RUN_URL} |

**If the run log shows \`refusing to allow a GitHub App to create or update workflow\`:**
upstream changed a file under \`.github/workflows/\`, and \`GITHUB_TOKEN\` is not
permitted to push those. Add a PAT with the \`workflow\` scope as the repository
secret \`SYNC_PAT\`. There is no \`permissions:\` scope that grants this.

**If the merge result is \`conflict\`:** Claude could not fully resolve it. The
merge was aborted, so the branch is clean — resolve it locally and push.
EOF
)

existing=$(gh issue list --state open --label "$LABEL" --search "$TITLE in:title" \
             --json number,title --jq "map(select(.title == \"${TITLE}\")) | .[0].number // empty" 2>/dev/null || true)

if [ -n "$existing" ]; then
  echo "Issue #${existing} already open for ${TAG}; adding a comment."
  gh issue comment "$existing" --body "Failed again — ${RUN_URL}"
else
  echo "Opening a new issue for ${TAG}."
  gh issue create --title "$TITLE" --body "$BODY" --label "$LABEL" \
    || gh issue create --title "$TITLE" --body "$BODY"
fi
