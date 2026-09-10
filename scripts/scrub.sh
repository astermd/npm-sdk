#!/usr/bin/env bash
# Pre-release hygiene check. Must print nothing and exit 0.
# Adapted from the PHP package's scrub grep for a Node repository.
set -uo pipefail

status=0

if grep -rniE \
  "codeclouds|besimplified|simply-ai|simplified.health|sandbox|staging|youtrack|gitlab|mongodb|kafka|registry/api-docs|design-spec|PENDING\.md|md_integrations" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=coverage \
  --exclude-dir=.git \
  --exclude-dir=.superpowers \
  --exclude-dir=superpowers \
  --exclude=package-lock.json \
  --exclude=CLAUDE.local.md \
  --exclude=.gitignore \
  --exclude=scrub.sh \
  . ; then
  echo "scrub: forbidden term found in a tracked file" >&2
  status=1
fi

for path in CLAUDE.local.md docs/PENDING.md docs/superpowers .claude/settings.local.json; do
  if git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
    echo "scrub: $path must not be tracked" >&2
    status=1
  fi
done

if node -e "process.exit(Object.keys(require('./package.json').dependencies ?? {}).length === 0 ? 0 : 1)"; then
  :
else
  echo "scrub: package.json has runtime dependencies; this package must have none" >&2
  status=1
fi

exit "$status"
