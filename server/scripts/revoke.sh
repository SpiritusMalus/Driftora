#!/usr/bin/env bash
# Отозвать ключ подписки (вторая половина grant.sh). Ничего не удаляет:
# оплаченный период обрезается «сейчас», запись и история платежей остаются.
# Доступ у человека погаснет при следующем запуске приложения (клиент шлёт
# /billing/register на каждом старте) — та же задержка, что у возврата в сторе.
#
# Секрет — тот же, что у grant.sh:
#   echo -n 'ваш-секрет' > ~/.driftora-admin-token && chmod 600 ~/.driftora-admin-token
#
# Использование:
#   ./scripts/revoke.sh XXXX-XXXX-XXXX-XXXX   # отозвать ключ
#   ./scripts/revoke.sh --list                # показать все выданные ключи
#
# Повторный отзыв того же ключа безвреден — вернётся первая отметка времени.
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

if [ "${1:-}" = "" ]; then
  echo "Использование: $0 <ключ> | --list" >&2
  exit 1
fi

# Секрет уходит заголовком из stdin, а не в argv: аргументы видны в `ps` всем на машине.
if [ "$1" = "--list" ]; then
  response="$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl -s -S --config - \
    -w '\n%{http_code}' "$API/billing/licenses")"
else
  KEY="$(printf '%s' "$1" | tr -d '"\\[:cntrl:]')"
  response="$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl -s -S --config - \
    -w '\n%{http_code}' -X POST "$API/billing/revoke" \
    -H 'Content-Type: application/json' -d "{\"key\":\"$KEY\"}")"
fi

status="$(printf '%s' "$response" | tail -n1)"
payload="$(printf '%s' "$response" | sed '$d')"

if [ "$status" != "200" ]; then
  echo "Не вышло (HTTP $status): $payload" >&2
  [ "$status" = "404" ] && echo "404 — либо BILLING_ADMIN_TOKEN не задан на сервере, либо ключ не наш." >&2
  [ "$status" = "401" ] && echo "401 — секрет не тот." >&2
  exit 1
fi

if [ "${1:-}" = "--list" ]; then
  # Одна строка на лицензию; jq на сервере есть не везде — sed достаточно.
  printf '%s\n' "$payload" | sed 's/},{/}\n{/g' | sed 's/^.*"licenses":\[//; s/\]}$//'
else
  echo "Отозван: $(printf '%s' "$payload" | sed -n 's/.*"key":"\([^"]*\)".*/\1/p')"
fi
