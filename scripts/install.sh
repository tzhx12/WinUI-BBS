#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo bash.' >&2; exit 1; }
source /etc/os-release
[[ "$ID" == debian || "$ID" == ubuntu ]] || { echo 'Supported: Debian 12/13, Ubuntu 22.04/24.04 (systemd).' >&2; exit 1; }
[[ -d /run/systemd/system ]] || { echo 'systemd is required.' >&2; exit 1; }
root=/opt/winui-bbs
[[ ! -e "$root/current" && ! -e "$root/shared/.env" ]] || { echo 'Already installed. Use Site settings to update.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates gnupg tar xz-utils openssl
install -d -m 755 "$root/releases" "$root/shared"
task_tmp=$(mktemp -d)
trap 'rm -rf -- "$task_tmp"' EXIT

if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||a===22&&b>=12?0:1)'; then
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo 'Supported CPU: x64, arm64' >&2; exit 1 ;; esac
  curl -fsSL --proto '=https' https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$task_tmp/node-sums"
  node_archive=$(awk -v arch="$arch" '$2 ~ "linux-" arch ".tar.xz$" { print $2 }' "$task_tmp/node-sums")
  [[ -n "$node_archive" ]] || exit 1
  curl -fsSL --proto '=https' "https://nodejs.org/dist/latest-v22.x/$node_archive" -o "$task_tmp/$node_archive"
  (cd "$task_tmp" && awk -v name="$node_archive" '$2 == name' node-sums | sha256sum -c -)
  install -d "$root/runtime"
  tar -xJf "$task_tmp/$node_archive" --strip-components=1 -C "$root/runtime"
  export PATH="$root/runtime/bin:$PATH"
fi
node_bin=$(command -v node)
npm_bin=$(command -v npm)
runtime_path="$(dirname "$node_bin"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if ! dpkg-query -W -f='${Status}' postgresql-17 2>/dev/null | grep -q 'install ok installed'; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL --proto '=https' https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  printf 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt %s-pgdg main\n' "$VERSION_CODENAME" > /etc/apt/sources.list.d/pgdg.list
  apt-get update
  apt-get install -y postgresql-17 postgresql-client-17
fi
systemctl enable --now postgresql
read -r pg_cluster pg_port < <(pg_lsclusters --no-header | awk '$1 == 17 { print $2, $3; exit }') || true
if [[ -z "${pg_cluster:-}" ]]; then
  pg_createcluster 17 main --start
  read -r pg_cluster pg_port < <(pg_lsclusters --no-header | awk '$1 == 17 { print $2, $3; exit }')
fi
pg_isready --port "$pg_port" >/dev/null || pg_ctlcluster 17 "$pg_cluster" start

curl -fsSL --proto '=https' https://api.github.com/repos/tzhx12/WinUI-BBS/releases/latest -o "$task_tmp/release.json"
release_url=$(node --input-type=module - "$task_tmp/release.json" <<'NODE'
import { readFileSync } from 'node:fs'
const r=JSON.parse(readFileSync(process.argv[2], 'utf8'))
if(r.draft||r.prerelease||!/^v\d+\.\d+\.\d+$/.test(r.tag_name))throw new Error('No stable release')
const expected=`https://github.com/tzhx12/WinUI-BBS/releases/download/${r.tag_name}/winui-bbs.tar.gz`
if(!r.assets.some(a=>a.name==='winui-bbs.tar.gz'&&a.browser_download_url===expected))throw new Error('Release package missing')
console.log(expected)
NODE
)
version=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).tag_name.slice(1)' "$task_tmp/release.json")
target="$root/releases/$version"
curl -fL --retry 3 --proto '=https' "$release_url" -o "$task_tmp/release.tar.gz"
tar -tzf "$task_tmp/release.tar.gz" | node --input-type=module -e 'let s="";for await(const b of process.stdin)s+=b;for(const p of s.trim().split("\n"))if(p.startsWith("/")||p.split("/").includes(".."))throw Error("Unsafe archive")'
if tar -tvzf "$task_tmp/release.tar.gz" | grep -Eq '^[lh]'; then echo 'Archive contains links' >&2; exit 1; fi
install -d "$target"
tar -xzf "$task_tmp/release.tar.gz" --no-same-owner -C "$target"
[[ "$(node -p 'require(process.argv[1]).version' "$target/package.json")" == "$version" ]] || exit 1
(cd "$target" && "$npm_bin" ci --omit=dev --workspace=apps/api --include-workspace-root=false --ignore-scripts)

id winui-bbs >/dev/null 2>&1 || useradd --system --home-dir "$root/shared" --shell /usr/sbin/nologin winui-bbs
install -d -o winui-bbs -g winui-bbs -m 750 "$root/shared/data" "$root/shared/update"
touch "$root/shared/update/enabled"
chmod 644 "$root/shared/update/enabled"
db_password=$(openssl rand -hex 24)
if runuser -u postgres -- psql --port "$pg_port" -tAc "SELECT 1 FROM pg_roles WHERE rolname='winui_bbs'" | grep -q 1; then echo 'Database role winui_bbs already exists; choose manual deployment.' >&2; exit 1; fi
if runuser -u postgres -- psql --port "$pg_port" -tAc "SELECT 1 FROM pg_database WHERE datname='winui_bbs'" | grep -q 1; then echo 'Database winui_bbs already exists; choose manual deployment.' >&2; exit 1; fi
runuser -u postgres -- psql --port "$pg_port" -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE winui_bbs LOGIN PASSWORD '$db_password';
CREATE DATABASE winui_bbs OWNER winui_bbs;
SQL
umask 077
cat > "$root/shared/.env" <<ENV
DATABASE_URL=postgresql://winui_bbs:$db_password@127.0.0.1:$pg_port/winui_bbs
JWT_SECRET=$(openssl rand -hex 48)
MAIL_ENCRYPTION_KEY=$(openssl rand -base64 32)
SITE_TIMEZONE=Asia/Singapore
HOST=0.0.0.0
PORT=4000
FORUM_WEB_ROOT=$root/current/apps/web/dist
FORUM_UPDATE_DIR=$root/shared/update
PATH=$runtime_path
ENV
ln -s "$root/shared/data" "$target/apps/api/data"
ln -s "$target" "$root/current"
cat > /etc/systemd/system/winui-bbs.service <<UNIT
[Unit]
Description=WinUI-BBS
After=network.target postgresql.service
[Service]
User=winui-bbs
Group=winui-bbs
WorkingDirectory=$root/current/apps/api
EnvironmentFile=$root/shared/.env
ExecStart=$node_bin $root/current/apps/api/dist/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$root/shared/data $root/shared/update
UMask=0027
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/winui-bbs-update.service <<UNIT
[Unit]
Description=Update WinUI-BBS
After=network-online.target
[Service]
Type=oneshot
EnvironmentFile=$root/shared/.env
ExecStart=$node_bin $root/current/scripts/update.mjs
TimeoutStartSec=1800
UMask=0022
UNIT
cat > /etc/systemd/system/winui-bbs-update.path <<UNIT
[Unit]
Description=Watch WinUI-BBS update requests
[Path]
PathExists=$root/shared/update/request.json
[Install]
WantedBy=multi-user.target
UNIT
chmod 644 /etc/systemd/system/winui-bbs{,-update}.service /etc/systemd/system/winui-bbs-update.path
systemctl daemon-reload
systemctl enable --now winui-bbs winui-bbs-update.path
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:4000/api/health >/dev/null; then
    echo "WinUI-BBS $version installed. Open http://YOUR_SERVER_IP:4000/ to create the administrator."
    exit 0
  fi
  sleep 1
done
echo 'Startup failed. Check: journalctl -u winui-bbs -n 80' >&2
exit 1
