# LeadsFunda - working notes

## Production access

SSH is configured and works - use the alias, not a bare IP:

```
ssh onlano-prod          # root@144.91.104.65, key ~/.ssh/adminsafe-144.91.104.65-ed25519
```

`ssh root@144.91.104.65` fails with "Permission denied (publickey)" because the
default key isn't the right one; the alias in `~/.ssh/config` picks it.

- App dir: `/www/wwwroot/leadsfunda.com`
- Process: `pm2 restart leadsfunda-ui` (port 3001, one process serving both hosts)
- Marketing `leadsfunda.com` + app `app.leadsfunda.com` proxy to that same process

## Deploying

Push `saas-leadsfunda` → GitHub Actions builds **on the VPS** and restarts pm2.
Takes ~2-4 min; prod answers 500 briefly mid-rebuild, which is normal.

```
git push origin saas-leadsfunda
```

The push needs a non-default GitHub key - remote is `git@github-leadsfunda:…`
(alias in `~/.ssh/config`). The local clone at `~/Desktop/gmaps-scraper` has disk
corruption, so commits/pushes are made from a fresh clone rather than in place.

## Secrets live on the VPS, never in the repo

`.env.local` is gitignored and is **not** shipped by the deploy - the VPS owns
its own copy. Adding a new env var means editing it there and restarting:

```
ssh onlano-prod 'cd /www/wwwroot/leadsfunda.com && nano .env.local && pm2 restart leadsfunda-ui'
```

## Ahrefs Domain Rating

Free of charge but **not anonymous**: the endpoint returns 403 without a key and
401 with a bad one. `AHREFS_API_KEY` is set in `.env.local` locally and on prod
(free key from an Ahrefs account → Account settings → API keys). A 400 back just
means Ahrefs doesn't know that domain - common for dead sites, not a fault.

## Local dev

`DEV_FAKE_AUTH=1` runs the app with no database (see `web/lib/dev-auth.js`); it
is hard-disabled under `NODE_ENV=production`, so a local `next start` of a prod
build will bounce every authenticated page to `/login`. `DATABASE_URL` must stay
set even though nothing connects.

Known local-only breakage: the dashboard renders but never hydrates - no client
effects, no API calls. `/login` hydrates fine. Not reproducible on prod, so
verify UI changes there or by reasoning, not on a local dashboard page.

## Layout trap worth remembering

`app/template.js` wraps every page in `animate-page-in`, whose keyframes end on a
real `transform` with fill-mode `both`. That makes the wrapper the containing
block for **any** `position: fixed` descendant, so fixed overlays anchor to the
page rather than the viewport and land off-screen when scrolled. Anything fixed -
drawers, dialogs, docks - must portal to `<body>`. See `ui/sheet.js`,
`ui/dialog.js`, `ui/bottom-dock.js`.
