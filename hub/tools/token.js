#!/usr/bin/env node
// hub/tools/token.js: mint, list and revoke agent tokens on a running hub.
// Talks to the API as the boss, never to state.json: the hub is the only writer.
//
//   node hub/tools/token.js mint <agent> <project,project|*> [label]
//   node hub/tools/token.js list
//   node hub/tools/token.js revoke <token-id>
//
// Reads BUREAU_BOSS_TOKEN and PORT from the environment or hub/.env, and the
// hub's address from BUREAU_URL (default http://localhost:<PORT>).
'use strict';
require('../lib/env').load();

const BASE = (process.env.BUREAU_URL || `http://localhost:${process.env.PORT || 8100}`).replace(/\/$/, '');
const BOSS = process.env.BUREAU_BOSS_TOKEN;

async function call(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { authorization: `Bearer ${BOSS}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status}: ${j.error || 'refused'}`);
  return j;
}

const USAGE = 'usage: token.js mint <agent> <project,project|*> [label] | list | revoke <id>';

async function main() {
  const [cmd, a, b, label] = process.argv.slice(2);
  if (!BOSS) throw new Error('BUREAU_BOSS_TOKEN is not set: this tool acts as the boss');
  if (cmd === 'mint' && a && b) {
    const t = await call('POST', '/api/tokens', { agent: a, projects: b.split(',').map(s => s.trim()).filter(Boolean), label });
    console.log(`minted ${t.id} for ${t.agent}, projects: ${t.projects.join(', ')}`);
    console.log(`token (shown once): ${t.token}`);
    console.log(`MCP URL: ${t.mcp_url}`);
  } else if (cmd === 'list') {
    const r = await call('GET', '/api/tokens');
    for (const t of r.tokens) console.log(`${t.id}  ${t.agent}  ${t.projects.join(',')}  ${t.revoked_at ? `revoked ${t.revoked_at}` : `last used ${t.last_used || 'never'}`}${t.label ? `  (${t.label})` : ''}`);
    console.log(`shared token last used: ${r.shared_token_last_used || 'not since the last restart'}`);
  } else if (cmd === 'revoke' && a) {
    const t = await call('DELETE', `/api/tokens/${a}`);
    console.log(`revoked ${t.id} (${t.agent})`);
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}

main().catch((e) => { console.error(`token.js: ${e.message}`); process.exitCode = 1; });
