#!/bin/bash
# OUTPUT-only nftables egress allowlist for Firecracker VM (Fly.io safe)
# - Does NOT hook/modify INPUT at all (prevents bricking console/access)

#!/bin/bash
# OUTPUT-only nftables egress allowlist (Fly.io-safe). INPUT is untouched.
# No here-strings. No shell redirections inside nft batch. Single-shot apply.

set -euo pipefail

log_info(){ printf '[INFO] %s\n' "$*" >&2; }
log_warn(){ printf '[WARN] %s\n' "$*" >&2; }
log_err(){  printf '[ERROR] %s\n' "$*" >&2; }

[[ "${TRACE:-0}" == "1" ]] && set -x

# --- preflight ---
if [[ $EUID -ne 0 ]]; then log_err "Run as root"; exit 1; fi
command -v nft >/dev/null 2>&1 || { log_err "nft not found"; exit 1; }

# Check if firewall should be skipped
if [[ "${DANGEROUSLY_SKIP_FIREWALL:-0}" == "I_UNDERSTAND" ]]; then
    log_warn "DANGEROUSLY_SKIP_FIREWALL=I_UNDERSTAND - Skipping firewall setup"
    log_warn "This thopter has NO EGRESS FILTERING - use only for development/testing"
    exit 0
fi

# this isn't expected to work (systemctl likely not found)
systemctl enable nftables >/dev/null 2>&1 || true

# --- domain allowlist ---
BASELINE_DOMAINS=(
  github.com api.github.com raw.githubusercontent.com codeload.github.com objects.githubusercontent.com
  registry.npmjs.org nodejs.org pypi.org files.pythonhosted.org pypi.python.org
  api.anthropic.com claude.ai anthropic.com
  ubuntu.com security.ubuntu.com archive.ubuntu.com keyserver.ubuntu.com
  sentry.io statsig.com update.code.visualstudio.com vscode.dev
)

ADDITIONAL_DOMAINS=()
if [[ -n "${ALLOWED_DOMAINS:-}" ]]; then
  while IFS= read -r d; do
    d=$(printf '%s' "$d" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [[ -n "$d" ]] && ADDITIONAL_DOMAINS+=("$d")
  done < <(printf '%s\n' "$ALLOWED_DOMAINS" | tr ',' '\n')
fi
ALL_DOMAINS=("${BASELINE_DOMAINS[@]}" "${ADDITIONAL_DOMAINS[@]}")
log_info "domains=${#ALL_DOMAINS[@]}"

# --- resolve -> IPs (tolerant to failures) ---
RESOLVED_V4=()
RESOLVED_V6=()
i=0
for domain in "${ALL_DOMAINS[@]}"; do
  i=$((i+1)); log_info "resolve[$i/${#ALL_DOMAINS[@]}] $domain"
  v4="$(timeout 5 dig +short +time=2 +tries=2 A "$domain" 2>/dev/null | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/')"
  [[ -n "$v4" ]] && while IFS= read -r ip; do [[ -n "$ip" ]] && RESOLVED_V4+=("$ip"); done < <(printf '%s\n' "$v4")
  v6="$(timeout 5 dig +short +time=2 +tries=2 AAAA "$domain" 2>/dev/null | awk '/^[0-9a-fA-F:]+$/')"
  [[ -n "$v6" ]] && while IFS= read -r ip; do [[ -n "$ip" ]] && RESOLVED_V6+=("$ip"); done < <(printf '%s\n' "$v6")
done
readarray -t uniq_v4 < <(printf '%s\n' "${RESOLVED_V4[@]}" | awk 'NF' | sort -u)
readarray -t uniq_v6 < <(printf '%s\n' "${RESOLVED_V6[@]}" | awk 'NF' | sort -u)
log_info "uniq_v4=${#uniq_v4[@]} uniq_v6=${#uniq_v6[@]}"

TABLE=thopter
SET4=allowed_ipv4
SET6=allowed_ipv6

# Remove existing table to avoid conflicts (does not touch other tables)
if nft list table inet "$TABLE" >/dev/null 2>&1; then
  log_info "delete existing table inet $TABLE"
  nft delete table inet "$TABLE"
fi

# --- compose nft batch into a temp file (no shell syntax inside batch) ---
NF_FILE="$(mktemp /tmp/nft-apply.XXXXXX.nft)"
trap 'rm -f "$NF_FILE"' EXIT

# Create table, OUTPUT chain (policy accept during build), sets
cat >"$NF_FILE" <<EOF
add table inet $TABLE
add chain inet $TABLE output { type filter hook output priority 0; policy accept; }
add set inet $TABLE $SET4 { type ipv4_addr; flags interval; }
add set inet $TABLE $SET6 { type ipv6_addr; flags interval; }
EOF

# Populate sets (one element per command; simple and robust)
for ip in "${uniq_v4[@]}"; do
  printf 'add element inet %s %s { %s }\n' "$TABLE" "$SET4" "$ip" >>"$NF_FILE"
done
for ip in "${uniq_v6[@]}"; do
  printf 'add element inet %s %s { %s }\n' "$TABLE" "$SET6" "$ip" >>"$NF_FILE"
done

# OUTPUT rules (quotes are literal for nft)
cat >>"$NF_FILE" <<'EOF'
add rule inet thopter output oif lo accept
add rule inet thopter output ct state established,related accept

add rule inet thopter output udp dport 53 accept
add rule inet thopter output tcp dport 53 accept

add rule inet thopter output ip  protocol icmp   accept
add rule inet thopter output ip6 nexthdr  icmpv6 accept

add rule inet thopter output ip  daddr { 172.16.0.0/12, 10.0.0.0/8, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16 } accept
add rule inet thopter output ip6 daddr { fc00::/7, fe80::/10 } accept

add rule inet thopter output ip  daddr @allowed_ipv4 accept
add rule inet thopter output ip6 daddr @allowed_ipv6 accept

add rule inet thopter output log prefix "THOPTER-DROP: " level info
add rule inet thopter output drop
EOF

# NOTE: we keep chain policy at ACCEPT; the explicit final 'drop' enforces deny-by-default
# (avoids any policy-flip grammar variances across nft versions)

# Optional preview
if [[ "${DEBUG:-0}" == "1" ]]; then
  printf '--- nft batch ---\n' >&2
  sed 's/^/| /' "$NF_FILE" >&2
  printf '-----------------\n' >&2
fi

# Apply batch
log_info "apply nft batch"
nft -f "$NF_FILE"

# Persist base structure (static; dynamic set contents are populated by running this script)
CONF=/etc/nftables.conf
cat >"$CONF" <<'EOF'
#!/usr/sbin/nft -f
flush ruleset
table inet thopter {
  set allowed_ipv4 {
    type ipv4_addr
    flags interval
  }

  set allowed_ipv6 {
    type ipv6_addr
    flags interval
  }

  chain output {
    type filter hook output priority 0; policy accept
    oif lo accept
    ct state established,related accept

    udp dport 53 accept
    tcp dport 53 accept

    ip  protocol icmp   accept
    ip6 nexthdr  icmpv6 accept

    ip  daddr { 172.16.0.0/12, 10.0.0.0/8, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16 } accept
    ip6 daddr { fc00::/7, fe80::/10 } accept

    ip  daddr @allowed_ipv4 accept
    ip6 daddr @allowed_ipv6 accept

    log prefix "THOPTER-DROP: " level info
    drop
  }
}
EOF

# validate the persisted file parses
nft -c -f "$CONF" >/dev/null || log_warn "persisted config parse check failed (non-fatal)"

# Connectivity checks (won’t cause syntax errors even if they fail)
( curl -s --connect-timeout 5 --max-time 10 https://api.github.com >/dev/null 2>&1 && log_info 'GitHub: OK' ) || log_warn 'GitHub: FAIL'
( curl -s --connect-timeout 5 --max-time 10 https://registry.npmjs.org >/dev/null 2>&1 && log_info 'NPM: OK' ) || log_warn 'NPM: FAIL'
( curl -s --connect-timeout 5 --max-time 10 https://api.anthropic.com >/dev/null 2>&1 && log_info 'Anthropic: OK' ) || log_warn 'Anthropic: FAIL'
( curl -s --connect-timeout 1 --max-time 2 https://google.com/ >/dev/null 2>&1 && log_warn 'Google timeout: FAIL' ) || log_info 'Google timeout: OK'
( curl -s --connect-timeout 1 --max-time 2 https://www.craigslist.org/ >/dev/null 2>&1 && log_warn 'Craigslist timeout: FAIL' ) || log_info 'Craigslist timeout: OK'

log_info "done (domains=${#ALL_DOMAINS[@]} v4=${#uniq_v4[@]} v6=${#uniq_v6[@]})"

