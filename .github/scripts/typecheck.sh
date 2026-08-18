#!/usr/bin/env bash
# Typechecks the tree after Claude has resolved a merge, BEFORE anything is
# built, pushed, or published.
#
# Why this exists: the image build runs `vite build`, which uses esbuild and
# therefore only strips types — it never typechecks. A resolution that wires a
# customisation onto the wrong API, or drops an import, can build a perfectly
# valid image that is broken at runtime. `tsc --noEmit` is the only gate that
# actually catches that, so it runs on the conflict path before the build.
#
# Mirrors the codegen order in the repo Dockerfile. If that Dockerfile changes
# its build steps, this needs the same change.
set -euo pipefail

corepack enable
corepack prepare pnpm@11.3.0 --activate

# Submodule pointers moved with the merge; the workflow already ran
# `git submodule update --init --recursive` before this script.
pnpm install --frozen-lockfile

# stoat.js is a workspace package consumed by the client for its types. Without
# building it first, tsc reports dozens of phantom "has no exported member"
# errors that look like a bad merge but are just an unbuilt dependency.
pnpm --filter stoat.js build
pnpm --filter solid-livekit-components build

# Generated modules the client imports: styled-system/* and the lingui catalogs.
# tsc cannot resolve them until these have run.
pnpm --filter client exec panda codegen
pnpm --filter client exec lingui compile --typescript

echo "Typechecking..."
pnpm --filter client exec tsc --noEmit
echo "Typecheck passed."
