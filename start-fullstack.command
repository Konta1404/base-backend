#!/bin/bash
# macOS: double-click to stop any running base-backend / base-frontend stacks
# and start everything from docker-compose.fullstack.yml.
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

[ -f .env ] || cp .env.example .env

echo "Stopping previously started stacks (data volumes are kept)..."
docker compose -p base-backend down --remove-orphans 2>/dev/null
docker compose -p base-frontend down --remove-orphans 2>/dev/null
docker compose -f docker-compose.fullstack.yml down --remove-orphans 2>/dev/null

# If base-frontend is already running locally (npm run dev on :3000), start only db + api for it.
services=""
busy=0
for port in 3000 4000 5432 6379; do
  pid=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [ -n "$pid" ] && ! ps -p "$pid" -o comm= | grep -qi docker; then
    cmd=$(ps -p "$pid" -o command= | cut -c1-100)
    if [ "$port" = 3000 ] && echo "$cmd" | grep -q "next"; then
      echo "Frontend already running locally on :3000 ($cmd) -> starting only Postgres + Redis + API."
      services="db redis api"
    else
      echo "Port $port is already used by: $pid $cmd"
      busy=1
    fi
  fi
done
if [ "$busy" = 1 ]; then
  echo "Stop the process(es) above (or close that app/terminal), then run this again."
  exit 1
fi

echo "Starting ${services:-Postgres + Redis + API + frontend}..."
echo "  frontend http://localhost:3000   API http://localhost:4000/docs"
echo "  login: demo@example.com / password123   (Ctrl+C to stop)"
# -V renews the node_modules volumes so dependency changes are picked up.
docker compose -f docker-compose.fullstack.yml up --build -V $services
