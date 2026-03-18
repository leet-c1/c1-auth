#!/usr/bin/env node

// c1-refresh — Refresh ConductorOne OAuth tokens before they expire.
// Designed to run via cron to keep mcporter sessions alive on headless machines.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MCPORTER_DIR = path.join(os.homedir(), '.mcporter');
const CREDS_PATH = path.join(MCPORTER_DIR, 'credentials.json');

function readJson(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filepath, data) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const tmp = filepath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, filepath);
}

async function refreshEntry(key, entry) {
  const { serverName, serverUrl, clientInfo, tokens } = entry;

  if (!tokens?.refresh_token || !clientInfo?.client_id) {
    console.log(`[${serverName}] No refresh token or client_id — skipping`);
    return false;
  }

  // Discover the token endpoint
  const url = new URL(serverUrl);
  const wellKnownUrl = `${url.protocol}//${url.host}/.well-known/oauth-authorization-server`;

  let meta;
  try {
    const res = await fetch(wellKnownUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    meta = await res.json();
  } catch (err) {
    console.error(`[${serverName}] Failed to discover OAuth metadata: ${err.message}`);
    return false;
  }

  const { token_endpoint } = meta;
  if (!token_endpoint) {
    console.error(`[${serverName}] No token_endpoint in OAuth metadata`);
    return false;
  }

  // Exchange refresh token for new tokens
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: clientInfo.client_id,
  });

  if (clientInfo.client_secret) {
    body.set('client_secret', clientInfo.client_secret);
  }

  let newTokens;
  try {
    const res = await fetch(token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    newTokens = await res.json();
    if (!newTokens.access_token) {
      throw new Error(newTokens.error_description || newTokens.error || 'No access_token in response');
    }
  } catch (err) {
    console.error(`[${serverName}] Token refresh failed: ${err.message}`);
    return false;
  }

  // Update the entry
  entry.tokens = {
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token || tokens.refresh_token,
    token_type: newTokens.token_type || 'Bearer',
    expires_in: newTokens.expires_in || 900,
  };
  entry.updatedAt = new Date().toISOString();

  console.log(`[${serverName}] Refreshed (access_token expires in ${entry.tokens.expires_in}s)`);
  return true;
}

// --- Main ---

const vault = readJson(CREDS_PATH);
if (!vault?.entries || Object.keys(vault.entries).length === 0) {
  console.log('No credentials found — nothing to refresh.');
  process.exit(0);
}

let anyRefreshed = false;

for (const [key, entry] of Object.entries(vault.entries)) {
  const ok = await refreshEntry(key, entry);
  if (ok) anyRefreshed = true;
}

if (anyRefreshed) {
  writeJson(CREDS_PATH, vault);
  console.log('Credentials saved.');
} else {
  console.log('No tokens were refreshed.');
}
