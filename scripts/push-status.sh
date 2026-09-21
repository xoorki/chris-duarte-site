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
# 4. Edit the SERVICES list below to match what's actually running
#    (host/port or URL for each — these are just examples).
#
# 5. Test it manually:
#      bash push-status.sh
#    Then check: https://raw.githubusercontent.com/xoorki/chris-duarte-site/status-data/status.json
#
# 6. Add it to cron to run every 5 minutes:
#      crontab -e
#      */5 * * * * /full/path/to/push-status.sh >> /var/log/push-status.log 2>&1
#
# CPU/memory/uptime are read straight from /proc, so no extra tools are
# needed for those beyond bash itself (Linux only).

set -euo pipefail

REPO="xoorki/chris-duarte-site"
BRANCH="status-data"
FILE_PATH="status.json"
TOKEN_FILE="$HOME/.github-status-token"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "No token file at $TOKEN_FILE — see the setup notes at the top." >&2
  exit 1
fi

# A token any other account on the box can read is a token you have to assume
# is shared, so refuse to use one that isn't owner-only.
token_mode=$(stat -c '%a' "$TOKEN_FILE")
if [[ "${token_mode: -2}" != "00" ]]; then
  echo "$TOKEN_FILE is mode $token_mode — readable by others." >&2
  echo "Run: chmod 600 $TOKEN_FILE" >&2
  exit 1
fi

TOKEN=$(cat "$TOKEN_FILE")

# Anything passed as a command-line argument is visible in the process list
# to every user on the machine, so the token is handed to curl over stdin as
# a config file instead of with -H.
gh_api() {
  curl -s --config - "$@" <<-CFG
	header = "Authorization: Bearer ${TOKEN}"
	header = "Accept: application/vnd.github+json"
	CFG
}

# ---- Define what to check here ----
# One entry per line: "Display Name|type|target"
#   type "tcp"  -> target is host:port          (e.g. 127.0.0.1:22)
#   type "http" -> target is a full URL, counted "up" on any 2xx/3xx reply
# EDIT ME: swap in your real hosts/ports/URLs once each service is running.
SERVICES=(
  "Website|http|https://chris-duarte.com"
  "Nextcloud|http|http://127.0.0.1:8080"
  "Jellyfin|http|http://127.0.0.1:8096"
  "Immich|http|http://127.0.0.1:2283"
  "DNS|tcp|127.0.0.1:53"
)
# ------------------------------------

check_tcp() {
  local target="$1"
  local host="${target%%:*}"
  local port="${target##*:}"
  # Host and port go in as arguments rather than being pasted into the
  # command string, so a stray character in SERVICES can't become a command.
  timeout 3 bash -c 'cat < /dev/null > /dev/tcp/"$1"/"$2"' _ "$host" "$port" 2>/dev/null
}

check_http() {
  local url="$1"
  local code
  # --proto keeps a typo'd entry from turning into a file:// or scp:// fetch.
  code=$(curl -s -o /dev/null -w "%{http_code}" --proto '=http,https' \
    --max-time 5 "$url" || echo "000")
  [[ "$code" =~ ^[23] ]]
}

# ---- Host stats (CPU %, memory %, uptime) ----
# Reads straight from /proc — Linux only, no extra packages needed.

get_cpu_percent() {
  # Sample /proc/stat twice, ~0.3s apart, and compute % busy over that window.
  local a b idle1 total1 idle2 total2
  read -r _ a <<< "$(grep '^cpu ' /proc/stat)"
  # shellcheck disable=SC2206
  a=($a)
  idle1=${a[3]}
  total1=0
  for v in "${a[@]}"; do total1=$((total1 + v)); done

  sleep 0.3

  read -r _ b <<< "$(grep '^cpu ' /proc/stat)"
  # shellcheck disable=SC2206
  b=($b)
  idle2=${b[3]}
  total2=0
  for v in "${b[@]}"; do total2=$((total2 + v)); done

  local idle_delta=$((idle2 - idle1))
  local total_delta=$((total2 - total1))
  if [[ "$total_delta" -le 0 ]]; then
    echo "0"
    return
  fi
  awk -v idle="$idle_delta" -v total="$total_delta" \
    'BEGIN { printf "%.1f", (1 - idle/total) * 100 }'
}

get_mem_percent() {
  local total avail
  total=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
  avail=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  if [[ -z "$total" || -z "$avail" || "$total" -le 0 ]]; then
    echo "0"
    return
  fi
  awk -v total="$total" -v avail="$avail" \
    'BEGIN { printf "%.1f", (1 - avail/total) * 100 }'
}

get_uptime_str() {
  local secs days hours mins
  secs=$(awk '{print int($1)}' /proc/uptime)
  days=$((secs / 86400))
  hours=$(((secs % 86400) / 3600))
  mins=$(((secs % 3600) / 60))
  if [[ "$days" -gt 0 ]]; then
    echo "${days}d ${hours}h"
  elif [[ "$hours" -gt 0 ]]; then
    echo "${hours}h ${mins}m"
  else
    echo "${mins}m"
  fi
}

cpu_percent=$(get_cpu_percent)
mem_percent=$(get_mem_percent)
uptime_str=$(get_uptime_str)

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

# Fetch the current status.json once. Its SHA is needed to update the file,
# and its history array is what the trend charts on the site are drawn from —
# keeping the history here means every visitor sees a real graph on first
# load, instead of each browser having to build one up from scratch.
existing=$(gh_api "https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}")

sha=$(jq -r '.sha // empty' <<< "$existing" 2>/dev/null || true)

# Roughly the last 4 hours, at the suggested 5-minute cron interval.
prev_history='[]'
encoded_prev=$(jq -r '.content // empty' <<< "$existing" 2>/dev/null || true)
if [[ -n "$encoded_prev" ]]; then
  decoded_prev=$(printf '%s' "$encoded_prev" | tr -d '\n' | base64 -d 2>/dev/null || true)
  if [[ -n "$decoded_prev" ]]; then
    prev_history=$(jq -c '.history // []' <<< "$decoded_prev" 2>/dev/null || echo '[]')
  fi
fi

history_json=$(jq -n \
  --argjson prev "$prev_history" \
  --arg t "$updated_at" \
  --argjson cpu "$cpu_percent" \
  --argjson mem "$mem_percent" \
  '($prev + [{t: $t, cpu: $cpu, mem: $mem}])[-48:]')

payload=$(jq -n \
  --arg updated_at "$updated_at" \
  --argjson services "$services_json" \
  --argjson cpu_percent "$cpu_percent" \
  --argjson mem_percent "$mem_percent" \
  --arg uptime "$uptime_str" \
  --argjson history "$history_json" \
  '{updated_at:$updated_at, host:{cpu_percent:$cpu_percent, mem_percent:$mem_percent, uptime:$uptime}, services:$services, history:$history}')

content_b64=$(printf '%s' "$payload" | base64 -w0)

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

gh_api -X PUT \
  "https://api.github.com/repos/${REPO}/contents/${FILE_PATH}" \
  -d "$body" > /dev/null
