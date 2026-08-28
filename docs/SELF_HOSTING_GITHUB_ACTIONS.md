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

| Scope   | Permission                                                  | Why                                                |
| ------- | ----------------------------------------------------------- | -------------------------------------------------- |
| Account | Workers Scripts: Edit                                       | the Worker, its Durable Objects, Workflows         |
| Account | Workers KV Storage: Edit                                    | `KV` and `OAUTH_KV`                                |
| Account | D1: Edit                                                    | the database and its migrations                    |
| Account | Workers R2 Storage: Edit                                    | the cache bucket                                   |
| Account | Secrets Store: Edit                                         | the store alchemy keeps its state-store token in   |
| Account | Account Settings: Read                                      | the account and its workers.dev subdomain          |
| Account | Access: Organizations, Identity Providers, and Groups: Read | the Zero Trust team domain the login page lives on |
| Account | Access: Apps and Policies: Edit                             | the login gate itself                              |
| Zone    | Workers Routes: Edit                                        | attaches `SELFHOST_DOMAIN` to the Worker           |
| Zone    | DNS: Edit                                                   | the record that hostname needs                     |

Secrets Store has to be Edit, not Read. On the very first deploy alchemy has no
state store yet, so it creates one, and creating it means creating an
account-wide Secrets Store to hold its auth token. The failure if the token only
has Read is a bare `Unauthorized: Authentication error` naming no resource,
logged right after `Deploying Cloudflare State Store 'alchemy-state-store'`.

The two Access rows are separate permissions and both are needed. Without the
first, the deploy stops at `Could not read the Zero Trust organization:
Unauthorized`, and the error goes on to suggest re-running `pnpm alchemy login`,
which is not the fix when the deploy runs on an API token. Read is enough there
as long as the account already has a Zero Trust team; if it has none, the deploy
creates one and the permission has to be Edit.

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
