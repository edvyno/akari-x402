// MCP server over stdio: newline-delimited JSON-RPC 2.0 on stdin/stdout.
// stdout is the protocol channel — every diagnostic goes to stderr.

import readline from 'node:readline';
import { TOOLS, callTool } from './tools.js';
import { resolveOrigin } from './origin.js';
import { keyFromEnv } from './pay.js';

const PROTOCOL = '2025-06-18';
const SERVER_INFO = { name: 'akari-x402', version: '1.0.0' };

const INSTRUCTIONS = [
  'Akari Agent Services: machine-payable crypto intelligence over x402 (USDC on Base).',
  'Free: list_services, funding_edge_preview, token_safety_preview.',
  'Paid: paid_call. Without a wallet key it returns the 402 challenge and spends nothing;',
  'with AKARI_PRIVATE_KEY in the environment and confirm_pay=true it signs EIP-3009 and settles.',
  'Every number these tools return is produced by the desk\'s own scanners — no simulated rows.',
].join(' ');

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  write({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        reply(id, {
          protocolVersion: typeof requested === 'string' ? requested : PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
        return;
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return; // notifications get no response
      case 'ping':
        reply(id, {});
        return;
      case 'tools/list':
        reply(id, { tools: TOOLS });
        return;
      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments || {};
        if (!TOOLS.some((t) => t.name === name)) {
          if (isNotification) return;
          fail(id, -32602, `unknown tool: ${name}`);
          return;
        }
        const result = await callTool(name, args);
        reply(id, result);
        return;
      }
      case 'resources/list':
        reply(id, { resources: [] });
        return;
      case 'prompts/list':
        reply(id, { prompts: [] });
        return;
      default:
        if (isNotification) return;
        fail(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    if (isNotification) return;
    fail(id, -32603, e?.message || String(e));
  }
}

export function startServer() {
  const origin = resolveOrigin();
  let keyState = 'unset';
  try {
    keyState = keyFromEnv() ? 'set (env)' : 'unset';
  } catch (e) {
    keyState = 'invalid: ' + e.message;
  }
  process.stderr.write(
    `akari-x402 MCP server 1.0.0 — stdio — origin ${origin} — wallet key ${keyState}\n` +
      `tools: ${TOOLS.map((t) => t.name).join(', ')}\n`
  );

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const s = line.trim();
    if (!s) return;
    let msg;
    try {
      msg = JSON.parse(s);
    } catch {
      fail(null, -32700, 'parse error');
      return;
    }
    void handle(msg);
  });
  rl.on('close', () => process.exit(0));
}
