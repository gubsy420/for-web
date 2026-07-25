#!/usr/bin/env bash
# Runs after Claude has resolved an in-progress merge. Refuses to complete the
# merge unless the tree is genuinely clean, so a half-resolved merge can never be
# committed or shipped.
set -euo pipefail

# 1. No conflict markers may remain anywhere in the tree (exclude our own docs).
if git grep -nEI '^(<{7}|={7}|>{7})([ \t]|$)' -- . ':(exclude).github/**' ':(exclude)FORK_CUSTOMISATIONS.md' >/tmp/markers 2>/dev/null; then
  echo "::error::Conflict markers still present after resolution:"
  cat /tmp/markers
  exit 1
fi

# 2. No unmerged index entries may remain.
if [ -n "$(git ls-files -u)" ]; then
  echo "::error::Unmerged paths remain after resolution:"
  git ls-files -u
  exit 1
fi

# 3. Complete the merge, if one is still in progress.
if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
  git add -A
  git commit --no-edit
  echo "Merge committed."
else
  echo "No merge in progress (already committed?) — continuing."
fi
