#!/usr/bin/env bash
# Выдать ключ подписки руками. Секрет НЕ хранится в этом файле:
#
#   echo -n 'ваш-секрет' > ~/.driftora-admin-token && chmod 600 ~/.driftora-admin-token
#
# Использование:
#   ./scripts/grant.sh                      # месяц
#   ./scripts/grant.sh yearly               # год
#   ./scripts/grant.sh yearly "Пете за баг" # год + пометка, за что
#
# Повторный вызов с той же пометкой вернёт ТОТ ЖЕ ключ, а не второй период.
set -euo pipefail

API="${DRIFTORA_API:-https://food.family-pie.ru}"
TOKEN_FILE="${DRIFTORA_ADMIN_TOKEN_FILE:-$HOME/.driftora-admin-token}"
TOKEN="${DRIFTORA_ADMIN_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  if [ ! -f "$TOKEN_FILE" ]; then
    echo "Нет секрета. Положите его в $TOKEN_FILE (chmod 600) или в \$DRIFTORA_ADMIN_TOKEN." >&2
    exit 1
  fi
  TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
fi

PLAN="${1:-monthly}"
REFERENCE="${2:-}"

body="{\"plan\":\"$PLAN\""
[ -n "$REFERENCE" ] && body="$body,\"reference\":\"$(printf '%s' "$REFERENCE" | tr -d '"\\[:cntrl:]')\""
body="$body}"

# Секрет уходит заголовком из stdin, а не в argv: аргументы видны в `ps` всем на машине.
response="$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl -s -S --config - \
  -w '\n%{http_code}' -X POST "$API/billing/grant" \
  -H 'Content-Type: application/json' -d "$body")"

status="$(printf '%s' "$response" | tail -n1)"
payload="$(printf '%s' "$response" | sed '$d')"

if [ "$status" != "200" ]; then
  echo "Не выдано (HTTP $status): $payload" >&2
  [ "$status" = "404" ] && echo "404 — либо BILLING_ADMIN_TOKEN не задан на сервере, либо он короче 24 символов, либо совпадает с APP_TOKEN." >&2
  [ "$status" = "401" ] && echo "401 — секрет не тот." >&2
  exit 1
fi

key="$(printf '%s' "$payload" | sed -n 's/.*"key":"\([^"]*\)".*/\1/p')"
until_ms="$(printf '%s' "$payload" | sed -n 's/.*"paid_until":\([0-9]*\).*/\1/p')"
if [ -n "$until_ms" ]; then
  # BSD date на macOS, GNU date на сервере.
  until_human="$(date -r "$((until_ms / 1000))" '+%d.%m.%Y' 2>/dev/null || date -d "@$((until_ms / 1000))" '+%d.%m.%Y' 2>/dev/null || echo '')"
else
  until_human=''
fi

echo "$key"
[ -n "$until_human" ] && echo "тариф $PLAN, действует до $until_human" >&2
