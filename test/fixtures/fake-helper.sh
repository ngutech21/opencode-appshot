#!/usr/bin/env bash
# Stand-in for bin/appshot-helper in tests. It appends its arguments to
# $FAKE_HELPER_ARGS (one per line, then a blank line) and prints
# $FAKE_HELPER_STDOUT, or fails with $FAKE_HELPER_STDERR when
# $FAKE_HELPER_EXIT is set.
set -euo pipefail
if [[ -n "${FAKE_HELPER_ARGS:-}" ]]; then
  printf '%s\n' "$@" "" >> "$FAKE_HELPER_ARGS"
fi
if [[ -n "${FAKE_HELPER_EXIT:-}" ]]; then
  printf '%s' "${FAKE_HELPER_STDERR:-}" >&2
  exit "$FAKE_HELPER_EXIT"
fi
printf '%s' "${FAKE_HELPER_STDOUT:-}"
