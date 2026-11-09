#!/usr/bin/env node
// Proves the runs are isolated from the user's hooks. Two runs against a scratch
// hub: a control that loads the user settings (the UserPromptSubmit hook must
// fire and show up in the scratch hub's call log) and an isolated one with the
// eval's flags (no hook event, no call). The control's hook is pointed at the
// scratch hub through its own environment variables, so it never reaches a real hub.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs, need, readJsonl, writeJson, childEnv, isolationFlags, runClaude, startHub, HUB_TOKEN } = require('./lib');

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const brain = need(o, 'brain'), out = need(o, 'out'), model = o.model || 'claude-sonnet-5-5', port = Number(o.port || 8192);
  const dir = path.join(out, 'isolation');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cwd = path.join(dir, 'cwd');
  fs.mkdirSync(cwd);
  const hubBrain = path.join(dir, 'brain');
  fs.cpSync(brain, hubBrain, { recursive: true });
  const hub = await startHub({ brain: hubBrain, dataDir: path.join(dir, 'data'), port, log: path.join(dir, 'hub.log') });
  const env = childEnv(dir, { BUREAU_URL: hub.url, BUREAU_TOKEN: HUB_TOKEN });
  const system = 'You answer briefly.';
  const prompt = 'What does the deploy recipe say about restarting the site? Reply with one word.';

  const calls = () => readJsonl(path.join(dir, 'data', 'context-log.jsonl')).filter((e) => e.type === 'call' && e.surface === 'claude-code').length;

  const control = await runClaude({ prompt, system, model, cwd, env, flags: ['--setting-sources', 'user', '--no-session-persistence'], timeoutMs: 120000 });
  const afterControl = calls();
  const isolated = await runClaude({ prompt, system, model, cwd, env, flags: isolationFlags(), timeoutMs: 120000 });
  const afterIsolated = calls();
  await hub.stop();

  const report = {
    control: { flags: 'user settings loaded', hook_events: control.hookEvents, scratch_hub_calls: afterControl, exit: control.code, is_error: control.result ? control.result.is_error : null },
    isolated: { flags: isolationFlags(), hook_events: isolated.hookEvents, new_scratch_hub_calls: afterIsolated - afterControl, tools: isolated.init ? isolated.init.tools : null, mcp_servers: isolated.init ? isolated.init.mcp_servers : null, exit: isolated.code, is_error: isolated.result ? isolated.result.is_error : null },
  };
  report.proved = report.control.scratch_hub_calls >= 1 && report.isolated.new_scratch_hub_calls === 0 && report.isolated.hook_events === 0;
  writeJson(path.join(out, 'isolation.json'), report);
  console.log(JSON.stringify(report, null, 1));
  if (!report.proved) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
