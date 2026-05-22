#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Try to guess LAN IP of this machine (works on most Linux/macOS setups)
LAN_IP=""

if command -v hostname >/dev/null 2>&1; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')" || true
fi

if [ -z "${LAN_IP}" ] && command -v ipconfig >/dev/null 2>&1; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
fi

if [ -z "${LAN_IP}" ]; then
  echo "Kunne ikke finne LAN IP automatisk."
  echo "Skriv inn IP-adressen til PC-en din (f.eks. 192.168.1.50):"
  read -r LAN_IP
fi

export EXPO_PUBLIC_API_URL="http://${LAN_IP}:8000"

# Pick a free Metro port (8081 is default but often left running)
DEFAULT_PORT=8081
PORT="${DEFAULT_PORT}"

port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -q ":${p} "
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null | grep -q ":${p}"
  else
    return 1
  fi
}

while port_in_use "${PORT}"; do
  PORT=$((PORT + 1))
  if [ "${PORT}" -gt 8095 ]; then
    echo "Fant ingen ledig port mellom 8081-8095."
    echo "Tips: stopp gammel Expo/Metro med: pkill -f \"expo start\" || true"
    exit 1
  fi
done

echo ""
echo "Backend (må kjøre separat): ${EXPO_PUBLIC_API_URL}"
echo "Expo/Metro port:          ${PORT}"
echo ""
MODE="${EXPO_MODE:-lan}"

echo "Starter Expo i modus: ${MODE}"
echo "Hvis du vil stoppe Expo senere:"
echo "  ./mobile/scripts/stop_mobile.sh"
echo ""

echo "Tips: Hvis Expo Go viser 'Something went wrong' i TUNNEL, prøv LAN."
echo "Du kan styre med: EXPO_MODE=lan  eller  EXPO_MODE=tunnel"
echo ""

npm install

# Use npx to ensure correct expo binary.
# --clear helps if Expo Go shows 'Something went wrong' due to stale bundler cache.
if [ "${MODE}" = "tunnel" ]; then
  npx expo start --tunnel --clear --port "${PORT}"
else
  npx expo start --lan --clear --port "${PORT}"
fi
