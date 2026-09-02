#!/usr/bin/env bash
# Surfaces Claude tool-permission denials immediately after a resolution pass.
#
# Why: on 2026-08-28 claude-code-action started denying the tools this workflow's
# prompts depend on. Claude still reported "success", burned 55 turns and ~$1.71,
# and changed nothing -- because every Edit and every `git` command was denied.
# The only evidence was "permission_denials_count": 18 buried in a 1200-line log,
# and six days of runs failed identically before anyone read it.
#
# The action restricts tools by default and requires --allowedTools in
# claude_args. If resolution stops making progress, check this first.
set -uo pipefail

LOG="${CLAUDE_LOG:-/home/runner/work/_temp/claude-execution-output.json}"

if [ ! -f "$LOG" ]; then
  echo "No Claude execution log at $LOG — skipping denial check."
  exit 0
fi

count=$(grep -oE '"permission_denials_count"[[:space:]]*:[[:space:]]*[0-9]+' "$LOG" \
          | head -1 | grep -oE '[0-9]+$' || true)
count="${count:-0}"

echo "Claude tool-permission denials this pass: ${count}"

if [ "$count" -gt 0 ]; then
  echo "::error title=Claude was denied ${count} tool call(s)::claude-code-action restricts tools by default. The --allowedTools list in sync-upstream.yml is missing something the prompt asks for (file edits, or a git subcommand). This is the exact failure that stalled the sync from 2026-08-28."
fi

exit 0 # diagnostic only; never fail the run on its own
