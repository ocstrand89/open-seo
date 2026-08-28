# Deploying from GitHub Actions

`docs/SELF_HOSTING_CLOUDFLARE.md` deploys from a laptop: `pnpm alchemy login`
opens a browser, and `.env.selfhost` (which holds your DataForSEO key) sits on
that machine. `.github/workflows/deploy-selfhost.yml` does the same deploy from
CI instead, so you can ship from any device with a browser and the key lives in
GitHub's encrypted secrets rather than on disk.

This replaces steps 2 to 4 of the Cloudflare guide. Everything else there still
applies, including `SELFHOST_DOMAIN`.

## 1) Enable Actions on the fork

GitHub disables workflows on new forks. Open the repository's **Actions** tab
once and confirm you want them enabled.

## 2) Create a Cloudflare API token

Dashboard, **My Profile** then **API Tokens**, **Create Token**, custom token.
It needs, on the account the Worker deploys into:

| Scope   | Permission                      | Why                                         |
| ------- | ------------------------------- | ------------------------------------------- |
| Account | Workers Scripts: Edit           | the Worker, its Durable Objects, Workflows  |
| Account | Workers KV Storage: Edit        | `KV` and `OAUTH_KV`                         |
| Account | D1: Edit                        | the database and its migrations             |
| Account | Workers R2 Storage: Edit        | the cache bucket                            |
| Account | Secrets Store: Read             | alchemy's state-store token                 |
| Account | Account Settings: Read          | reads the account and workers.dev subdomain |
| Account | Access: Apps and Policies: Edit | the login gate                              |
| Zone    | DNS: Edit                       | the `SELFHOST_DOMAIN` record                |

A missing permission fails the deploy with an error naming what it could not
do, so start here and widen only if it asks.

## 3) Add the repository secrets

**Settings**, **Secrets and variables**, **Actions**:

| Secret                  | Value                                                  |
| ----------------------- | ------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | the token from step 2                                  |
| `CLOUDFLARE_ACCOUNT_ID` | the account id, shown in the dashboard URL and sidebar |
| `ENV_SELFHOST`          | the entire contents of `.env.selfhost`, pasted as-is   |

`ENV_SELFHOST` is the same file the local flow uses, secrets and all:

```sh
DATAFORSEO_API_KEY=<the Base64 credential from DataForSEO>
ACCESS_ALLOWED_EMAILS=you@example.com
SELFHOST_DOMAIN=seo.example.com
```

The runner writes it to disk for the deploy and is destroyed afterwards. The
values it contains end up on the Worker as encrypted Cloudflare secrets.

## 4) Deploy

**Actions**, **Deploy self-host**, **Run workflow**. It also runs on every push
to `main`, so merging an upstream sync deploys it. Delete the `push:` block in
the workflow if you would rather every deploy be deliberate.

The last step checks that the deployed hostname redirects to a Cloudflare
Access login, and fails the run if the app answers without one.

## Changing a value later

Edit the `ENV_SELFHOST` secret and re-run the workflow. Editing Worker secrets
in the Cloudflare dashboard does not survive: alchemy reconciles the Worker's
whole environment on every deploy, so the next run overwrites them.

## Keeping your laptop as an option

Nothing here prevents the local flow. `pnpm alchemy login` and
`pnpm deploy:selfhost` still work against the same stage, as long as
`.env.selfhost` matches the `ENV_SELFHOST` secret.
