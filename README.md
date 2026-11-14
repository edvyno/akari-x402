# akari-x402

An [MCP](https://modelcontextprotocol.io) server for **Akari Agent Services** — machine-payable crypto
intelligence sold over **x402 (HTTP 402, USDC on Base)**. Install it and your agent gets three free
tools plus a paid-call helper that understands the 402 handshake.

No account, no API key, no signup. Prices are per call, settled in USDC.

```bash
# run it (stdio). Host config: { "command": "npx", "args": ["-y", "akari-x402"] }
npx -y akari-x402
```

If the npm package is not resolvable yet, the same code installs straight from git:

```bash
npx -y github:edvyno/akari-x402
```

## Tools

| tool | price | what it does |
|---|---|---|
| `list_services` | free | Reads `/.well-known/agent-services.json`: every paid route, its price, the payment rail (network, `payTo`, flow), the cheapest entry point and the free surfaces. |
| `funding_edge_preview` | free | 3 real rows of the perp funding ranking built on **realized** funding (`fundingHistory` summed over 24h, net of round-trip cost) on Hyperliquid perps + the HIP-3 dexes, plus `_meta.measured` recomputed on every call. |
| `token_safety_preview` | free | Liquidity, pairs, 24h volume, concentration flags and a verdict for any Base token — before an agent pays or routes into it. |
| `paid_call` | $0.03–$49 | Calls any x402 route. No key: returns the decoded 402 challenge (price, network, asset, `payTo`, EIP-712 domain) and spends **nothing**. With a key: signs EIP-3009 and returns the paid payload + settlement receipt. |

## Paying

The key is read **only** from the environment. It is never a tool argument and never logged.

```bash
export AKARI_PRIVATE_KEY=0x…      # a Base wallet holding USDC (no ETH needed: the facilitator pays gas)
export AKARI_MAX_PRICE_USD=1.00   # hard per-call cap, enforced before signing (default $1.00)
```

Then call `paid_call` with `confirm_pay: true`. Flow per call:

1. `GET` the route → `402` with a base64 `PAYMENT-REQUIRED` header.
2. Sign EIP-3009 `TransferWithAuthorization` over the USDC EIP-712 domain (chain 8453).
3. Re-`GET` with `X-PAYMENT: <base64 payload>` → `200` + `PAYMENT-RESPONSE` receipt.

Nothing is broadcast locally: the authorization is off-chain and the facilitator settles it.
Every call is bounded by `AKARI_MAX_PRICE_USD`, so an agent cannot spend more than you allow.

## Point it at another origin

```bash
AKARI_ORIGIN=https://your-mirror.example npx -y akari-x402   # or AKARI_ORIGIN_FILE=/path/to/url.txt
```

Default origin: `https://03s9tr085tfe5agke0tpqng34o.ingress.quanglong.org` (the desk's stable Akash
ingress — a mirror that relays the origin verbatim, including the 402 challenge bytes).

## Host config examples

Claude Desktop / Cursor / Cline (`mcpServers`):

```json
{
  "mcpServers": {
    "akari-x402": {
      "command": "npx",
      "args": ["-y", "akari-x402"],
      "env": { "AKARI_MAX_PRICE_USD": "1.00" }
    }
  }
}
```

Remote alternative (no install, JSON-RPC over HTTP): `POST https://03s9tr085tfe5agke0tpqng34o.ingress.quanglong.org/mcp`
— the same desk also runs a remote MCP endpoint, listed in the official MCP registry as
`io.github.edvyno/akari-crypto-intel`.

## What this package will not do

- It will not invent data. Every row comes from the live scanner that produces the paid product;
  if the origin is down the tool returns the HTTP status, not a plausible-shaped fake.
- It will not spend without `confirm_pay: true` and a key you exported yourself.
- It will not ship a retired hostname as its default. If the origin moves, change `AKARI_ORIGIN`.

## Test it yourself

```bash
node test/mcp_stdio_test.mjs funding_edge_preview   # initialize + tools/list + one live tool call
```

## Builder program

40 % of every settled sale referred by `?ref=0xYourWallet` goes to that wallet — fork this server,
add your ref, ship it. Terms: `/x402/affiliate`. Program page:
<https://edvyno.github.io/akari-proof/builder.html>

MIT.
