// Tool surface for akari-x402 — the four tools a host sees.
// Kept separate from the transport so it can be imported and tested without stdio.

import { resolveOrigin, getJson } from './origin.js';
import { challengeFromResponse, describeChallenge, signPayment, keyFromEnv, maxPriceUsd } from './pay.js';

const ok = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }], structuredContent: typeof o === 'object' ? o : undefined });
const err = (m) => ({ content: [{ type: 'text', text: String(m) }], isError: true });

export const TOOLS = [
  {
    name: 'list_services',
    description:
      'Free. Read Akari Agent Services /.well-known/agent-services.json: every paid x402 route with price, the payment rail (network, payTo, flow), the cheapest entry point and the free surfaces. Start here.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'funding_edge_preview',
    description:
      'Free. Perp funding edge ranked by REALIZED funding (what fundingHistory actually applied over 24h), net of round-trip cost, on Hyperliquid perps and the HIP-3 dexes. Returns 3 real rows in the exact paid shape plus _meta.measured (forward-vs-realized divergence computed on that call). The paid route /x402/funding-edge ($0.05) returns 30 rows.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'token_safety_preview',
    description:
      'Free. Token safety read for any Base token: real DEX liquidity, pair count, 24h volume, concentration flags and a verdict. Call this before an agent pays or routes into a token. Full pair list is /x402/token-safety ($0.03).',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string', description: 'Base token contract address (0x…)' } },
      required: ['address'],
      additionalProperties: false,
    },
  },
  {
    name: 'paid_call',
    description:
      'Call any Akari x402 route ($0.03-$49). With no key configured it returns the HTTP 402 challenge decoded (price, network, asset, payTo, EIP-712 domain) and how to pay it. With AKARI_PRIVATE_KEY (or X402_PRIVATE_KEY) in the environment and confirm_pay=true it signs an EIP-3009 authorization, re-sends the request with X-PAYMENT and returns the paid payload with the settlement receipt. The key is never a tool argument.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Route path, e.g. /x402/funding-edge or /x402/endpoint-audit?host=example.com' },
        confirm_pay: { type: 'boolean', description: 'Required true to spend. Without it the 402 challenge is returned and nothing is paid.' },
        max_price_usd: { type: 'number', description: 'Hard per-call cap. Defaults to AKARI_MAX_PRICE_USD or $1.00.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
];

export async function callTool(name, args = {}) {
  const origin = resolveOrigin();
  switch (name) {
    case 'list_services': {
      const r = await getJson(origin, '/.well-known/agent-services.json');
      if (r.status !== 200 || !r.json) return err(`list_services failed: HTTP ${r.status} from ${r.url}`);
      const svc = r.json.services || [];
      const lines = [
        `${r.json.name || 'Akari Agent Services'} — ${svc.length} paid routes (x402, ${r.json.how_to_pay?.network}, payTo ${r.json.how_to_pay?.pay_to})`,
        `cheapest: ${r.json.how_to_pay?.cheapest_route}`,
        '',
        ...svc.map((s) => `${String(s.price_usd).padStart(6)}  ${s.path}  [${s.group}] ${s.what}`),
      ];
      return ok({
        schema: r.json.schema,
        origin,
        service_count: svc.length,
        payment: r.json.how_to_pay,
        free_surfaces: r.json.free_surfaces,
        integrations: r.json.integrations,
        services: svc,
        text: lines.join('\n'),
      });
    }
    case 'funding_edge_preview': {
      const r = await getJson(origin, '/x402/funding-edge/preview');
      if (r.status !== 200 || !r.json) return err(`funding_edge_preview failed: HTTP ${r.status} from ${r.url}`);
      return ok({ origin, ...r.json });
    }
    case 'token_safety_preview': {
      const address = String(args.address || '').trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return err('address must be a 0x-prefixed 20-byte Base token address');
      const r = await getJson(origin, '/x402/token-safety/preview?address=' + encodeURIComponent(address));
      if (r.status !== 200 || !r.json) return err(`token_safety_preview failed: HTTP ${r.status} from ${r.url}`);
      return ok({ origin, address, ...r.json });
    }
    case 'paid_call': {
      const path = String(args.path || '').trim();
      if (!path.startsWith('/')) return err('path must start with "/" (e.g. /x402/funding-edge)');
      if (path.startsWith('/.well-known') || path.startsWith('/ecosystem')) return err('that path is free and not an x402 route; call it directly over HTTP');
      const cap = Number.isFinite(args.max_price_usd) ? Number(args.max_price_usd) : maxPriceUsd();
      const first = await getJson(origin, path);
      if (first.status !== 402) {
        return ok({ paid: false, status: first.status, note: first.status === 200 ? 'route answered without a 402 (free, pass or already entitled)' : 'unexpected status', body: first.json ?? first.text.slice(0, 4000) });
      }
      const chal = challengeFromResponse(first.headers, first.json);
      if (!chal) return err('route returned 402 but no decodable payment challenge');
      const view = describeChallenge(chal);

      const key = keyFromEnv();
      if (!args.confirm_pay || !key) {
        return ok({
          paid: false,
          reason: !args.confirm_pay ? 'confirm_pay not set — nothing spent' : 'no AKARI_PRIVATE_KEY / X402_PRIVATE_KEY in env — nothing spent',
          challenge: view,
          how_to_pay: {
            challenge_header: 'PAYMENT-REQUIRED (base64 JSON)',
            signature: 'EIP-3009 transferWithAuthorization over the USDC EIP-712 domain',
            then: 're-GET the same URL with X-PAYMENT: <base64 payload>; settlement is done by the facilitator',
            set_key: 'export AKARI_PRIVATE_KEY=0x… (Base wallet holding USDC) and call paid_call again with confirm_pay=true',
          },
          origin,
        });
      }

      if (view.cheapest_usd == null) return err('challenge has no priced requirement');
      if (view.cheapest_usd > cap) {
        return err(`refusing to pay $${view.cheapest_usd.toFixed(4)} — over the cap of $${cap.toFixed(2)} (raise max_price_usd or AKARI_MAX_PRICE_USD)`);
      }

      const signed = await signPayment(chal, key);
      const paid = await getJson(origin, path, { headers: { 'X-PAYMENT': signed.headerValue } });
      const receipt =
        paid.headers.get('payment-response') || paid.headers.get('x-payment-response') || paid.headers.get('x-payment-settled') || null;
      return ok({
        paid: paid.status >= 200 && paid.status < 300,
        status: paid.status,
        payer: signed.payer,
        amount_usd: signed.amountUsd,
        network: chal.accepts?.[0]?.network,
        settlement_receipt: receipt ? safeB64(receipt) : null,
        body: paid.json ?? paid.text.slice(0, 20000),
      });
    }
    default:
      return err(`unknown tool: ${name}`);
  }
}

function safeB64(v) {
  try {
    return JSON.parse(Buffer.from(v, 'base64').toString('utf8'));
  } catch {
    return v;
  }
}
