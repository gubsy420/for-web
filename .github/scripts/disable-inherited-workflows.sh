#!/usr/bin/env bash
# Disables every workflow in this fork except our own sync workflow.
#
# A fork inherits upstream's workflows, and merging a new upstream release can
# introduce new ones that are ACTIVE by default. Upstream's canary-release.yml
# triggers on `push: branches: [main]`, which is precisely what this pipeline
# does on every sync — it would have run on our behalf against upstream's
# release infrastructure.
#
# Idempotent and self-healing: run it after every push and any newly arrived
# upstream workflow gets switched off. Workflow disable state persists across
# pushes, so already-disabled ones are skipped.
set -euo pipefail

REPO="${REPO:?REPO is required}"
KEEP="${KEEP:?KEEP is required}"

disabled=0
while IFS=$'\t' read -r id path name; do
  [ -z "${id:-}" ] && continue
  if [ "$path" = "$KEEP" ]; then
    echo "keeping   $path"
    continue
  fi
  echo "disabling $path ($name)"
  if gh api -X PUT "repos/${REPO}/actions/workflows/${id}/disable" >/dev/null 2>&1; then
    disabled=$((disabled + 1))
  else
    # Non-fatal: a workflow can be un-disableable (e.g. already removed).
    echo "::warning title=Could not disable workflow::${path}"
  fi
done < <(
  gh api "repos/${REPO}/actions/workflows" --paginate \
    --jq '.workflows[] | select(.state == "active") | [.id, .path, .name] | @tsv'
)

echo "Disabled ${disabled} inherited workflow(s)."
