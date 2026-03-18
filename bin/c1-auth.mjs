#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

// --- Argument parsing ---

let tenant = '';
let reset = false;

for (const arg of process.argv.slice(2)) {
  if (arg === '--reset') {
    reset = true;
  } else if (arg.startsWith('-')) {
    console.error(`Unknown flag: ${arg}`);
    process.exit(1);
  } else {
    tenant = arg;
  }
}

if (!tenant) {
  console.log(`c1-auth — Authenticate mcporter to ConductorOne MCP

Usage:  c1-auth <tenant> [--reset]

  <tenant>  Your ConductorOne tenant name (the part before .conductor.one)
  --reset   Clear existing credentials before re-authenticating

Examples:
  c1-auth leet            # authenticate to leet.conductor.one
  c1-auth acme --reset    # re-authenticate to acme.conductor.one
  npx c1-auth leet        # run without installing`);
  process.exit(1);
}

const TENANT_HOST = `${tenant}.conductor.one`;
const SERVER = `conductorone-${tenant}`;
const MCP_URL = `https://${TENANT_HOST}/api/v1alpha/mcp`;
const MCPORTER_DIR = path.join(os.homedir(), '.mcporter');
const CONFIG_PATH = path.join(MCPORTER_DIR, 'mcporter.json');
const CREDS_PATH = path.join(MCPORTER_DIR, 'credentials.json');

// --- Helpers ---

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

function vaultKey(name, url) {
  const descriptor = JSON.stringify({ name, url, command: null });
  return `${name}|${crypto.createHash('sha256').update(descriptor).digest('hex').slice(0, 16)}`;
}

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${options?.method || 'GET'} ${url} failed (${res.status}): ${body}`);
  }
  return res.json();
}

// --- Main ---

try {
  // Reset
  if (reset) {
    console.log(`Clearing existing credentials for ${tenant}...`);
    const vault = readJson(CREDS_PATH);
    if (vault?.entries) {
      for (const key of Object.keys(vault.entries)) {
        if (vault.entries[key].serverName === SERVER) {
          delete vault.entries[key];
        }
      }
      writeJson(CREDS_PATH, vault);
    }
  }

  // Step 1: Discover OAuth endpoints
  console.log(`\nDiscovering OAuth endpoints for ${TENANT_HOST}...`);
  let meta;
  try {
    meta = await fetchJson(`https://${TENANT_HOST}/.well-known/oauth-authorization-server`);
  } catch {
    console.error(`ERROR: Could not reach https://${TENANT_HOST}`);
    console.error(`Check that '${tenant}' is the correct tenant name.`);
    process.exit(1);
  }

  const { token_endpoint, authorization_endpoint, registration_endpoint } = meta;

  // Step 2: Dynamic client registration
  console.log('Registering OAuth client...');
  const reg = await fetchJson(registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'c1-auth',
      redirect_uris: ['http://127.0.0.1:0/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'client_secret_post',
    }),
  });

  const { client_id, client_secret } = reg;
  const redirectUri = reg.redirect_uris[0];

  // Step 3: Build PKCE auth URL
  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomUUID();

  const authUrl = new URL(authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', client_id);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'openid profile');
  authUrl.searchParams.set('resource', MCP_URL);

  console.log('\n=== Open this URL in your browser ===\n');
  console.log(`  ${authUrl.toString()}\n`);
  console.log('Log in and approve access. You\'ll be redirected to a page that');
  console.log('won\'t load \u2014 that\'s expected. Copy the URL from your browser\'s');
  console.log('address bar and paste it below.\n');

  const callbackUrl = await prompt('Paste the redirect URL here: ');

  // Step 4: Extract code and exchange for tokens
  let code;
  try {
    const parsed = new URL(callbackUrl);
    code = parsed.searchParams.get('code');
  } catch {
    // not a valid URL
  }

  if (!code) {
    console.error('Could not find authorization code in that URL.');
    process.exit(1);
  }

  console.log('\nExchanging code for tokens...');

  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id,
    client_secret,
    code_verifier: verifier,
  });

  const tokenRes = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });

  const tokens = await tokenRes.json();

  if (!tokens.access_token) {
    console.error(`ERROR: ${tokens.error_description || tokens.error || 'Token exchange failed'}`);
    process.exit(1);
  }

  // Step 5: Add server to mcporter config
  const config = readJson(CONFIG_PATH) || { mcpServers: {} };
  if (!config.mcpServers) config.mcpServers = {};

  if (!config.mcpServers[SERVER]) {
    config.mcpServers[SERVER] = {
      baseUrl: MCP_URL,
      description: `ConductorOne MCP (${tenant})`,
      auth: 'oauth',
    };
    writeJson(CONFIG_PATH, config);
    console.log(`Added '${SERVER}' to mcporter config.`);
  }

  // Step 6: Save tokens to mcporter credential vault
  const vault = readJson(CREDS_PATH) || { version: 1, entries: {} };
  if (!vault.entries) vault.entries = {};

  const key = vaultKey(SERVER, MCP_URL);
  vault.entries[key] = {
    serverName: SERVER,
    serverUrl: MCP_URL,
    updatedAt: new Date().toISOString(),
    clientInfo: {
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'],
      client_id,
      client_secret,
    },
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      token_type: tokens.token_type || 'Bearer',
      expires_in: tokens.expires_in || 3600,
    },
  };

  writeJson(CREDS_PATH, vault);

  console.log(`\nAuthenticated! Verify with:\n`);
  console.log(`  mcporter list ${SERVER}\n`);
  console.log(`To re-authenticate: c1-auth ${tenant} --reset`);
} catch (err) {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
}
