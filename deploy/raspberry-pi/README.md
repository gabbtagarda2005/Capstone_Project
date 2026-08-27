# Admin_Backend on Raspberry Pi + Tailscale Funnel

Goal: give `Backend/Admin_Backend` a **stable public HTTPS address** the bus's cellular SIM can reach, without a router port-forward or an owned domain (add a real domain later via Cloudflare Tunnel — just repoint `SERVER_HOST` on both ends when that happens).

MongoDB already lives on Atlas (cloud), so the Pi only needs to run the stateless Node/Express+Socket.io app itself.

## Why Tailscale Funnel

A Pi on home/office WiFi is almost always behind NAT (often CGNAT), so it has no public IP to forward a port to. Tailscale Funnel exposes a local port to the public internet over HTTPS without any router configuration, and gives a stable `*.ts.net` hostname for free.

## 1. Prep the Pi

- Raspberry Pi OS (64-bit recommended), SSH enabled, connected to your network.
- `git clone` this repo onto the Pi (wherever you like, e.g. `~/Capstone-Project`).

## 2. Copy the secrets that git won't bring

Both are gitignored on purpose — copy them from your dev machine, don't commit them:

```
scp "Backend/Admin_Backend/.env" pi@<pi-ip>:~/Capstone-Project/Backend/Admin_Backend/.env
scp -r "Backend/Admin_Backend/secrets" pi@<pi-ip>:~/Capstone-Project/Backend/Admin_Backend/secrets
```

In the copied `.env` on the Pi, make sure `DEVICE_INGEST_SECRET` is actually set to a real random string (it's the shared secret the field firmware sends as `x-device-secret` — leaving it blank means the hardware-telemetry endpoint accepts unauthenticated posts from anyone who finds the URL).

## 3. Run the setup script

SSH into the Pi, then:

```bash
cd ~/Capstone-Project/deploy/raspberry-pi
chmod +x setup.sh
./setup.sh ~/Capstone-Project/Backend/Admin_Backend
```

This installs Node 18+, npm deps, Tailscale, and an `admin-backend` systemd service (auto-starts on boot, restarts on crash).

## 4. Start the backend

```bash
sudo systemctl start admin-backend
sudo systemctl status admin-backend   # should show "active (running)"
journalctl -u admin-backend -f        # tail logs
```

## 5. Tailscale login + Funnel

```bash
sudo tailscale up
```

Follow the printed link to authenticate in a browser (any Google/Microsoft/GitHub account works for a personal Tailscale account — free tier is enough here).

**If this is the first Funnel use on your Tailscale account**, Funnel may need enabling in the admin console first: go to [login.tailscale.com/admin/acls](https://login.tailscale.com/admin/acls) and check that Funnel isn't blocked — newer accounts usually have it on by default; if `tailscale funnel` errors about it being disabled, add to the ACL's top level:

```json
"nodeAttrs": [
  {"target": ["autogroup:member"], "attr": ["funnel"]}
]
```

Then expose the backend:

```bash
sudo tailscale funnel --bg 4001
tailscale funnel status
```

The last command prints your public address, e.g.:

```
https://raspberrypi.your-tailnet-name.ts.net (Funnel on)
|-- / proxy http://127.0.0.1:4001
```

`--bg` persists the Funnel config in `tailscaled`'s state so it survives reboots (as long as `tailscaled` itself is running, which it is by default as a systemd service).

## 6. Verify end-to-end before touching the firmware

From any machine (not just the Pi's LAN):

```bash
curl -i https://raspberrypi.your-tailnet-name.ts.net/api/buses/hardware-telemetry \
  -H "Content-Type: application/json" \
  -H "x-device-secret: <same value as DEVICE_INGEST_SECRET in .env>" \
  -d '{"imei":"<15-digit IMEI already registered in Fleet>","lat":8.1477,"lng":125.1324}'
```

Expect `204 No Content`. A `401` means the secret doesn't match; `404` means that IMEI isn't registered on a bus in Fleet yet.

## 7. Point the firmware here

In `hardware/lilygo_ta7670e_cellular_telemetry/config.h`:

```c
#define SERVER_HOST "raspberrypi.your-tailnet-name.ts.net"
#define SERVER_PORT 443
#define DEVICE_INGEST_SECRET "<same value as .env>"
```

## Later: swapping in a real domain

Once you buy a domain, add it to a free Cloudflare account, install `cloudflared` on the Pi, and run `cloudflared tunnel` pointed at `127.0.0.1:4001` with a named tunnel bound to that domain — it replaces Funnel as the public entry point. Only `SERVER_HOST` in the firmware config needs to change; nothing else in the backend or the AT-command HTTPS logic depends on which hostname is in front of it.
