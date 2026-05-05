# Deploy on Hostinger VPS — step by step

This guide configures a fresh Hostinger VPS to host SuperSDR using:

- Hostinger's native **Docker / GitHub integration** for continuous deploy
- **nginx** (already running on most Hostinger VPS images) as reverse proxy
- Plain **IP access** — no domain required

The whole flow is: `git push` → Hostinger pulls + rebuilds → app restarts → nginx serves it on port 80.

---

## 0. Prerequisites

- A Hostinger VPS plan with Docker available (most Ubuntu/Debian images include Docker; if not, install with `curl -fsSL https://get.docker.com | sh`)
- SSH access to the VPS (`ssh root@<vps-ip>`)
- A GitHub account and this repository pushed there (public)
- An OpenAI API key

---

## 1. Configure the GitHub → Docker integration on Hostinger

1. Open your VPS panel on Hostinger
2. Go to **VPS → your server → Manage → Docker / Apps**
3. Choose **Connect a GitHub repository** (the wording may vary — look for "GitHub Compose")
4. Authorize Hostinger to read your repo
5. Pick:
   - **Repository:** `<your-username>/supersdr-webhook-normalizer`
   - **Branch:** `main`
   - **Compose file path:** `docker-compose.yml`
   - **Auto-deploy on push:** enabled

Hostinger will run, on every push:

```bash
cd /opt/supersdr
git pull
docker compose pull
docker compose up -d --build
```

---

## 2. Set environment variables

In the same Hostinger panel, paste:

```
NODE_ENV=production
LOG_LEVEL=info
POSTGRES_USER=supersdr
POSTGRES_PASSWORD=<generate-a-strong-one>
POSTGRES_DB=supersdr
APP_PORT=3000
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini
WORKER_POLL_INTERVAL_MS=2000
WORKER_BATCH_SIZE=10
WORKER_MAX_ATTEMPTS=3
```

Click **Save** — Hostinger will inject these into the container.

> The app container reads `DATABASE_URL` automatically from `docker-compose.yml`,
> which composes it from the Postgres credentials above.

---

## 3. Apply database migrations once

After the first successful deploy, SSH into the VPS and run:

```bash
ssh root@<vps-ip>
cd /opt/supersdr   # or wherever Hostinger placed the checkout

# Run migrations (creates tables + seeds providers)
docker compose exec app node --experimental-vm-modules \
  -e "import('./dist/db/migrate.js')"

# Or, if you'd rather rebuild with a one-shot migration step:
docker compose run --rm app node dist/db/migrate.js
```

You should see `✓ migrations applied + providers seeded`.

---

## 4. Configure nginx as reverse proxy

Still over SSH:

```bash
# Place the config from this repo (already pulled by Hostinger)
sudo cp deploy/nginx.conf /etc/nginx/sites-available/supersdr
sudo ln -s /etc/nginx/sites-available/supersdr /etc/nginx/sites-enabled/supersdr

# Disable the default site if it captures port 80
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t        # syntax check
sudo nginx -s reload # apply
```

Now `http://<vps-ip>/webhooks/<provider>` reaches the app, and `http://<vps-ip>/health` returns the health JSON.

---

## 5. Verify

```bash
# From your laptop:
curl http://<vps-ip>/health
# → {"ok":true,"providers":[{"id":"meta",...}],"timestamp":"..."}

curl -X POST http://<vps-ip>/webhooks/meta \
  -H 'Content-Type: application/json' \
  -d @samples/meta-message.json
# → 202 {"event_id":"...","status":"received"}
```

Check the database:

```bash
docker compose exec postgres psql -U supersdr -d supersdr \
  -c "SELECT provider_id, content, intent FROM messages ORDER BY received_at DESC LIMIT 5;"
```

Tail the app logs:

```bash
docker compose logs -f app
```

---

## 6. Z-API real test

In the Z-API dashboard:

1. Create a free trial instance and pair it with a WhatsApp number via QR code
2. Open **Webhook → On Receive** and paste:
   ```
   http://<vps-ip>/webhooks/zapi
   ```
3. Send a WhatsApp message to the paired number
4. Within ~2 seconds you should see a row in `messages` with `intent` populated

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `502 Bad Gateway` on nginx | App container not running | `docker compose ps` and check logs |
| Webhook returns 404 | nginx default site still active | `sudo rm /etc/nginx/sites-enabled/default && sudo nginx -s reload` |
| `OPENAI_API_KEY is required` in logs | Env var not set | Add it in Hostinger panel and redeploy |
| Messages stay with `intent IS NULL` | LLM call failing silently | Check `docker compose logs app` for "intent classification failed" |
| `webhook_events.status = 'dead_letter'` | Adapter rejected the payload (malformed or unsupported) | Inspect `error` and `raw_payload` columns; fix the adapter or the sender |
