#!/usr/bin/env bash
#
# THESIS — the 24/7 half of the product.
#
# Calls the recheck endpoint on a schedule. Every live thesis is re-evaluated
# against current filings and prices, and one check is appended to its log.
# This is what makes "last checked 18 minutes ago" a fact rather than a number
# we drew on a screen.
#
# A recheck costs ZERO model calls — the tripwires were written once, and
# asking whether a stored numeric condition is currently true is just reading
# data. That is what makes a 15-minute cadence affordable rather than a claim.
#
# INSTALL ON THE VPS
#
#   sudo mkdir -p /opt/thesis /var/log/thesis
#   sudo cp recheck.sh /opt/thesis/
#   sudo chmod +x /opt/thesis/recheck.sh
#
#   sudo tee /etc/thesis.env >/dev/null <<'EOF'
#   THESIS_URL=https://your-deployment.vercel.app
#   RECHECK_SECRET=paste-the-same-secret-that-is-in-vercel
#   EOF
#   sudo chmod 600 /etc/thesis.env      # the secret must not be world-readable
#
#   sudo crontab -e
#   */15 * * * * /opt/thesis/recheck.sh >> /var/log/thesis/recheck.log 2>&1
#
# CHECK IT IS WORKING
#
#   tail -f /var/log/thesis/recheck.log
#
set -euo pipefail

ENV_FILE="${THESIS_ENV_FILE:-/etc/thesis.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

: "${THESIS_URL:?THESIS_URL is not set — put it in $ENV_FILE}"
: "${RECHECK_SECRET:?RECHECK_SECRET is not set — put it in $ENV_FILE}"

STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
URL="${THESIS_URL%/}/api/recheck"

# --max-time is the important flag. Without it a hung request holds a cron slot
# open until the next one starts, and they pile up until the box notices.
RESPONSE="$(curl -sS \
  --max-time 120 \
  --retry 2 --retry-delay 5 --retry-connrefused \
  -w '\n%{http_code}' \
  -X POST "$URL" \
  -H "authorization: Bearer ${RECHECK_SECRET}" \
  -H 'accept: application/json' 2>&1)" || {
    echo "$STAMP  UNREACHABLE  $URL"
    echo "$RESPONSE" | sed 's/^/                             /'
    exit 1
  }

STATUS="$(printf '%s' "$RESPONSE" | tail -n1)"
BODY="$(printf '%s' "$RESPONSE" | sed '$d')"

case "$STATUS" in
  200)
    # Pull the headline numbers out without needing jq installed.
    summary="$(printf '%s' "$BODY" | grep -oE '"(considered|checked|skipped|deferred|failed|modelCalls|ms)":[0-9]+' | tr '\n' ' ')"
    echo "$STAMP  OK    $summary"

    # A recheck that somehow spent model calls means something got wired into
    # this path that should not be. Say so loudly — quota is the scarce resource.
    if printf '%s' "$BODY" | grep -qE '"modelCalls":[1-9]'; then
      echo "$STAMP  WARN  a recheck spent model calls — this path is meant to be free"
    fi
    if printf '%s' "$BODY" | grep -qE '"failed":[1-9]'; then
      echo "$STAMP  WARN  at least one thesis failed to check:"
      printf '%s' "$BODY" | grep -oE '"reason":"[^"]*"' | sed 's/^/                             /'
    fi
    ;;
  401)
    echo "$STAMP  AUTH  the secret here does not match the one on the deployment"
    exit 1
    ;;
  503)
    echo "$STAMP  DOWN  $BODY"
    exit 1
    ;;
  30[0-9])
    echo "$STAMP  BLOCKED  got a redirect ($STATUS)."
    echo "                             Vercel Deployment Protection is almost certainly on."
    echo "                             Turn it off, or the endpoint is unreachable to anyone but you."
    exit 1
    ;;
  *)
    echo "$STAMP  HTTP $STATUS  $BODY"
    exit 1
    ;;
esac
