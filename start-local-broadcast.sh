#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}' || true)"
LAN_IP="$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)"

if [ -z "$LAN_IP" ]; then
  echo "Could not detect the Mac LAN IP."
  exit 1
fi

export LAN_IP

python3 - <<'PY'
from pathlib import Path
import os
import re

env_path = Path(".env")
env_text = env_path.read_text()

def read_value(key: str, default: str) -> str:
    match = re.search(rf"^{re.escape(key)}=(.*)$", env_text, flags=re.MULTILINE)
    return match.group(1).strip() if match else default

signal_port = read_value("LIVEKIT_SIGNAL_PORT", "17900")
udp_port = read_value("LIVEKIT_UDP_PORT", "17901")
tcp_port = read_value("LIVEKIT_TCP_PORT", "17902")
lan_ip = os.environ["LAN_IP"]

values = {
    "LIVEKIT_NODE_IP": lan_ip,
    "LIVEKIT_PUBLIC_URL": f"ws://{lan_ip}:{signal_port}",
}

for key, value in values.items():
    line = f"{key}={value}"
    pattern = rf"^{re.escape(key)}=.*$"
    if re.search(pattern, env_text, flags=re.MULTILINE):
        env_text = re.sub(pattern, line, env_text, flags=re.MULTILINE)
    else:
        env_text = env_text.rstrip() + "\n" + line + "\n"

env_path.write_text(env_text.rstrip() + "\n")

config = f'''port: 7880

bind_addresses:
  - "0.0.0.0"

rtc:
  node_ip: {lan_ip}
  use_external_ip: false
  udp_port: {udp_port}
  tcp_port: {tcp_port}

keys:
  devkey: secret

room:
  auto_create: true

logging:
  level: info
'''

Path("livekit.yaml").write_text(config)
PY

docker compose up -d --build --force-recreate livekit backend frontend

SIGNAL_PORT="$(awk -F= '/^LIVEKIT_SIGNAL_PORT=/{print $2}' .env)"

echo
echo "DocTutorials local broadcast is ready."
echo
echo "Faculty on this Mac:"
echo "  http://localhost:5192"
echo
echo "Student on the same Wi-Fi:"
echo "  http://${LAN_IP}:5192"
echo
echo "Expected student media connection:"
echo "  ws://${LAN_IP}:${SIGNAL_PORT}"
