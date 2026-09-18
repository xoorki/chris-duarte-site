#!/usr/bin/env bash
#
# Runs ON the homelab machine (not on GitHub). Checks a list of local
# services and pushes the result to the "status-data" branch of this repo
# as status.json, which homelab.html reads to show a live status dashboard.
#
# Deliberately pushes to a separate branch (status-data), not main — that
# way frequent status updates never touch the actual site content or
# trigger a GitHub Pages rebuild.
#
# ---- One-time setup ----
#
# 1. Create a fine-grained GitHub personal access token:
#      https://github.com/settings/personal-access-tokens/new
#    - Repository access: "Only select repositories" -> chris-duarte-site
#    - Permissions: Repository -> Contents -> Read and write
#    - Nothing else. This token can only touch this one repo.
#
# 2. Save the token where only you can read it:
#      echo "paste-your-token-here" > ~/.github-status-token
#      chmod 600 ~/.github-status-token
#
# 3. Install dependencies (Debian/Ubuntu):
#      sudo apt install curl jq
#
# 4. Edit the SERVICES list below to match what's actually running.
#
# 5. Test it manually:
#      bash push-status.sh
#    Then check: https://raw.githubusercontent.com/xoorki/chris-duarte-site/status-data/status.json
#
# 6. Add it to cron to run every 5 minutes:
#      crontab -e
#      */5 * * * * /full/path/to/push-status.sh >> /var/log/push-status.log 2>&1

set -euo pipefail

REPO="xoorki/chris-duarte-site"
BRANCH="status-data"
FILE_PATH="status.json"
TOKEN_FILE="$HOME/.github-status-token"
TOKEN=$(cat "$TOKEN_FILE")

# ---- Define what to check here ----
# One entry per line: "Display Name|type|target"
#   type "tcp"  -> target is host:port          (e.g. 127.0.0.1:22)
#   type "http" -> target is a full URL, counted "up" on any 2xx/3xx reply
SERVICES=(
  "Homelab Server|tcp|127.0.0.1:22"
)
# ------------------------------------

check_tcp() {
  local target="$1"
  local host="${target%%:*}"
  local port="${target##*:}"
  timeout 3 bash -c "cat < /dev/null > /dev/tcp/${host}/${port}" 2>/dev/null
}

check_http() {
  local url="$1"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" || echo "000")
  [[ "$code" =~ ^[23] ]]
}

services_json="[]"
for entry in "${SERVICES[@]}"; do
  IFS='|' read -r name type target <<< "$entry"

  start=$(date +%s%N)
  if [[ "$type" == "tcp" ]]; then
    if check_tcp "$target"; then status="up"; else status="down"; fi
  else
    if check_http "$target"; then status="up"; else status="down"; fi
  fi
  end=$(date +%s%N)
  latency_ms=$(( (end - start) / 1000000 ))

  services_json=$(jq -c \
    --arg name "$name" \
    --arg status "$status" \
    --argjson latency "$latency_ms" \
    '. += [{"name":$name,"status":$status,"latency_ms":$latency}]' \
    <<< "$services_json")
done

updated_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
payload=$(jq -n \
  --arg updated_at "$updated_at" \
  --argjson services "$services_json" \
  '{updated_at:$updated_at, services:$services}')

content_b64=$(printf '%s' "$payload" | base64 -w0)

# Look up the current file's SHA on the status-data branch (needed to update
# an existing file; harmless if the file doesn't exist yet).
sha=$(curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}" \
  | jq -r '.sha // empty')

if [[ -n "$sha" ]]; then
  body=$(jq -n \
    --arg message "Update status.json" \
    --arg content "$content_b64" \
    --arg sha "$sha" \
    --arg branch "$BRANCH" \
    '{message:$message, content:$content, sha:$sha, branch:$branch}')
else
  body=$(jq -n \
    --arg message "Create status.json" \
    --arg content "$content_b64" \
    --arg branch "$BRANCH" \
    '{message:$message, content:$content, branch:$branch}')
fi

curl -s -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/contents/${FILE_PATH}" \
  -d "$body" > /dev/null
