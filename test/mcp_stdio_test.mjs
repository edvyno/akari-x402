#!/usr/bin/env node
// End-to-end stdio test: speaks MCP to the packaged server exactly as a host would.
// Usage: node test/mcp_stdio_test.mjs [toolName] [jsonArgs]
// Exits 0 only when initialize + tools/list + one tools/call all succeed against the live origin.

import { spawn } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'bin', 'akari-x402.js');
const tool = process.argv[2] || 'funding_edge_preview';
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};

const child = spawn(process.execPath, [bin], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
const pending = new Map();
const log = [];
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    log.push({ at: new Date().toISOString(), from_server: msg });
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
let stderr = '';
child.stderr.on('data', (d) => (stderr += d.toString()));

let idc = 1;
function send(method, params) {
  const id = idc++;
  const p = new Promise((res) => pending.set(id, res));
  const msg = { jsonrpc: '2.0', id, method, params };
  log.push({ at: new Date().toISOString(), to_server: msg });
  child.stdin.write(JSON.stringify(msg) + '\n');
  return p;
}

const t0 = Date.now();
const init = await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'akari-stdio-test', version: '1.0.0' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const list = await send('tools/list', {});
const call = await send('tools/call', { name: tool, arguments: args });
await new Promise((r) => setTimeout(r, 400));
child.stdin.end();

const result = {
  ok:
    init.result?.serverInfo?.name === 'akari-x402' &&
    (list.result?.tools?.length || 0) >= 4 &&
    call.result != null &&
    !call.result.isError,
  elapsed_ms: Date.now() - t0,
  server: init.result?.serverInfo,
  protocolVersion: init.result?.protocolVersion,
  tools: (list.result?.tools || []).map((t) => t.name),
  called: tool,
  call_status: call.result?.isError ? 'isError' : 'ok',
  call_preview: JSON.stringify(call.result).slice(0, 1200),
  stderr,
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
