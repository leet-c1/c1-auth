# c1-auth

Authenticate [mcporter](https://github.com/steipete/mcporter) to [ConductorOne](https://www.conductorone.com) MCP on remote/headless machines where a browser callback can't reach localhost.

## The problem

ConductorOne's MCP server uses OAuth. Tools like `mcporter auth` open a browser and expect the OAuth callback to hit `127.0.0.1` — but on a remote machine, that callback never arrives.

## How it works

`c1-auth` handles the OAuth flow with a copy-paste approach:

1. Registers a dynamic OAuth client with your ConductorOne tenant
2. Prints an authorization URL for you to open in your local browser
3. You log in, then copy the redirect URL from your browser (the page won't load — that's expected)
4. Paste it back, and `c1-auth` exchanges the code for tokens and saves them where mcporter expects them

## Install

```bash
npm install -g c1-auth
```

## Usage

```bash
c1-auth <tenant>
```

Where `<tenant>` is the subdomain of your ConductorOne instance (e.g. `leet` for `leet.conductor.one`).

```
$ c1-auth leet

Discovering OAuth endpoints for leet.conductor.one...
Registering OAuth client...

=== Open this URL in your browser ===

  https://leet.conductor.one/auth/v1/authorize?...

Log in and approve access. You'll be redirected to a page that
won't load — that's expected. Copy the URL from your browser's
address bar and paste it below.

Paste the redirect URL here: http://127.0.0.1:0/callback?code=abc123&state=...

Exchanging code for tokens...
Added 'conductorone-leet' to mcporter config.

Authenticated! Verify with:

  mcporter list conductorone-leet
```

### Re-authenticate

```bash
c1-auth leet --reset
```

### Multiple tenants

Each tenant gets its own mcporter server entry, so you can authenticate to several at once:

```bash
c1-auth leet
c1-auth acme
mcporter list  # shows both conductorone-leet and conductorone-acme
```

## Requirements

- Node.js >= 18
- [mcporter](https://github.com/steipete/mcporter) (for using the MCP tools after auth)

## Token refresh (`c1-refresh`)

### Why this is needed

ConductorOne issues two tokens during OAuth:

- **Access token** (~15 min TTL) — used for API requests. mcporter's MCP SDK handles refreshing these automatically using the refresh token.
- **Refresh token** (~20 hr TTL) — used to obtain new access tokens. When this expires, the SDK falls back to a full browser-based re-authorization flow, which **fails on headless machines** because there is no browser to complete the interactive approval.

Without periodic refresh, your agent will eventually report that the OAuth session expired and prompt for browser approval — even though the initial `c1-auth` setup succeeded.

### How it works

`c1-refresh` uses the current refresh token to perform a `refresh_token` grant against ConductorOne's token endpoint. This returns a new access token *and* a new refresh token, resetting the 20-hour clock. As long as it runs before the refresh token expires, the session stays alive indefinitely with no browser interaction.

The script iterates all entries in `~/.mcporter/credentials.json`, so it handles multiple tenants automatically.

### Manual usage

```bash
c1-refresh
# or
node ~/c1-auth/bin/c1-refresh.mjs
```

```
[conductorone] Refreshed (access_token expires in 899s)
[conductorone-leet] Refreshed (access_token expires in 899s)
Credentials saved.
```

### Cron setup

To keep tokens alive on a headless server, set up a cron job that runs well within the 20-hour refresh token window. Every 12 hours is a safe default:

```bash
crontab -e
```

Add this line:

```cron
0 */12 * * * /usr/bin/node /home/YOUR_USER/c1-auth/bin/c1-refresh.mjs >> /home/YOUR_USER/.mcporter/refresh.log 2>&1
```

Or as a one-liner (replaces any existing crontab):

```bash
echo '0 */12 * * * /usr/bin/node /path/to/c1-auth/bin/c1-refresh.mjs >> ~/.mcporter/refresh.log 2>&1' | crontab -
```

- **`0 */12 * * *`** — runs at the top of the hour, every 12 hours (00:00 and 12:00)
- **`>> ~/.mcporter/refresh.log 2>&1`** — appends stdout and stderr to a log file for debugging

Verify the cron is installed:

```bash
crontab -l
```

Check recent refresh activity:

```bash
tail ~/.mcporter/refresh.log
```

## How tokens are stored

Tokens are saved to `~/.mcporter/credentials.json` in mcporter's native vault format. The server definition is added to `~/.mcporter/mcporter.json`. No additional files or config are created.

## License

MIT
