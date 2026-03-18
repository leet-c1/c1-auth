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
npm install -g github:leet-c1/c1-auth
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

## How tokens are stored

Tokens are saved to `~/.mcporter/credentials.json` in mcporter's native vault format. The server definition is added to `~/.mcporter/mcporter.json`. No additional files or config are created.

## License

MIT
