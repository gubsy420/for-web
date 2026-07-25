#!/usr/bin/env bash
# Fetch upstream, find the latest release, and attempt to merge it into the
# current branch. Emits three outputs for the workflow:
#   action  = skip | clean | conflict
#   tag     = the upstream release tag (e.g. stoat-for-web-v0.13.1)
#   version = docker-safe image tag derived from it (e.g. 0.13.1)
set -euo pipefail

git remote add upstream "$UPSTREAM_REPO" 2>/dev/null \
  || git remote set-url upstream "$UPSTREAM_REPO"
git fetch --quiet --tags upstream

TAG=$(gh api "repos/${UPSTREAM_SLUG}/releases/latest" --jq .tag_name)
if [ -z "$TAG" ] || [ "$TAG" = "null" ]; then
  echo "::error::Could not determine the latest upstream release."
  exit 1
fi
echo "Latest upstream release: $TAG"

# stoat-for-web-v0.13.1 -> 0.13.1, then restrict to valid docker tag characters.
VERSION=$(printf '%s' "$TAG" | sed -E 's/^stoat-for-web-//; s/^v//' | tr -c 'A-Za-z0-9_.-' '-')

{
  echo "tag=$TAG"
  echo "version=$VERSION"
} >> "$GITHUB_OUTPUT"

# Already merged? (the release commit is an ancestor of HEAD)
if [ "${FORCE:-false}" != "true" ] && git merge-base --is-ancestor "$TAG" HEAD 2>/dev/null; then
  echo "Release $TAG is already merged; nothing to do."
  echo "action=skip" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "Merging $TAG ..."
if git merge --no-edit --no-ff "$TAG"; then
  echo "Clean merge."
  echo "action=clean" >> "$GITHUB_OUTPUT"
else
  echo "Merge produced conflicts; handing off for resolution."
  echo "action=conflict" >> "$GITHUB_OUTPUT"
fi
