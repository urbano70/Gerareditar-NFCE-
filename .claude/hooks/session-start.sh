#!/bin/bash
set -euo pipefail

# Only run in Claude Code remote (web) sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

echo "=== [SessionStart] Instalando dependências npm ==="
npm install

echo "=== [SessionStart] Iniciando servidor de desenvolvimento (porta 3000) ==="
# Start Express + Vite dev server in background; persists for the session lifetime
npm run dev > /tmp/nfce-app.log 2>&1 &
APP_PID=$!
echo $APP_PID > /tmp/nfce-app.pid
echo "Servidor iniciado (PID: $APP_PID)"

# Wait up to 20 seconds for the server to be ready
echo "Aguardando servidor ficar disponível..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:3000/ -o /dev/null 2>/dev/null; then
    echo "=== Servidor pronto em http://localhost:3000 ==="
    exit 0
  fi
  sleep 1
done

echo "AVISO: Servidor pode não ter iniciado a tempo. Verifique /tmp/nfce-app.log"
exit 0
