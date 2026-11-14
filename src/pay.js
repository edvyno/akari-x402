// x402 exact-scheme payment helper (EVM, Base mainnet, USDC).
//
// Rules baked in:
//  * the key is read from the environment only (AKARI_PRIVATE_KEY or X402_PRIVATE_KEY).
//    It is never accepted as a tool argument, never logged, never written to disk.
//  * a spend cap is mandatory: the price in the 402 challenge must be <= AKARI_MAX_PRICE_USD
//    (default $1.00). A package an agent installs must not be able to drain a wallet by accident.
//  * signing is EIP-3009 transferWithAuthorization, which is off-chain: nothing is broadcast here.
//    Settlement is done by the facilitator when the seller re-GETs with the X-PAYMENT header.

import crypto from 'node:crypto';

export function keyFromEnv() {
  const raw = (process.env.AKARI_PRIVATE_KEY || process.env.X402_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  const key = raw.startsWith('0x') ? raw : '0x' + raw;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('AKARI_PRIVATE_KEY is set but is not a 32-byte hex private key');
  }
  return key;
}

export function maxPriceUsd() {
  const v = Number(process.env.AKARI_MAX_PRICE_USD ?? '1.00');
  return Number.isFinite(v) && v > 0 ? v : 1.0;
}

// Decode the 402 challenge. x402 v2 puts it in a base64 `PAYMENT-REQUIRED` header;
// v1 used `X-PAYMENT-REQUIRED`. Some servers only put it in the body. Accept all three.
export function challengeFromResponse(headers, body) {
  for (const name of ['payment-required', 'x-payment-required']) {
    const raw = headers.get(name);
    if (!raw) continue;
    try {
      return { ...JSON.parse(Buffer.from(raw, 'base64').toString('utf8')), _source: 'header:' + name };
    } catch {
      /* try the next source */
    }
  }
  if (body && typeof body === 'object' && Array.isArray(body.accepts)) {
    return { ...body, _source: 'body' };
  }
  return null;
}

export function describeChallenge(chal) {
  const accepts = chal?.accepts || [];
  const out = accepts.map((a) => ({
    scheme: a.scheme,
    network: a.network,
    asset: a.asset,
    amount_atomic: a.amount,
    amount_usd: a.amount ? Number(a.amount) / 1e6 : null,
    pay_to: a.payTo,
    max_timeout_seconds: a.maxTimeoutSeconds,
    eip712_domain: a.extra || null,
  }));
  return {
    x402_version: chal?.x402Version ?? 1,
    resource: chal?.resource?.url ?? chal?.resource ?? null,
    description: chal?.resource?.description ?? chal?.description ?? null,
    accepts: out,
    cheapest_usd: out.reduce((m, a) => (a.amount_usd != null && (m == null || a.amount_usd < m) ? a.amount_usd : m), null),
    source: chal?._source ?? null,
  };
}

// Build + sign the EIP-3009 authorization for the first acceptable EVM requirement.
export async function signPayment(chal, privateKey) {
  const { privateKeyToAccount } = await import('viem/accounts');
  const accepts = (chal?.accepts || []).filter((a) => a.scheme === 'exact' && String(a.network).startsWith('eip155:'));
  if (!accepts.length) throw new Error('no acceptable "exact" EVM payment requirement in the challenge');
  const req = accepts[0];

  const chainId = Number(String(req.network).split(':')[1]);
  const account = privateKeyToAccount(privateKey);

  const validAfter = Math.floor(Date.now() / 1000) - 600;
  const validBefore = Math.floor(Date.now() / 1000) + Number(req.maxTimeoutSeconds || 300);
  const nonce = '0x' + crypto.randomBytes(32).toString('hex');

  const domain = {
    name: req.extra?.name || 'USD Coin',
    version: req.extra?.version || '2',
    chainId,
    verifyingContract: req.asset,
  };
  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };
  const message = {
    from: account.address,
    to: req.payTo,
    value: BigInt(req.amount),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce,
  };
  const signature = await account.signTypedData({ domain, types, primaryType: 'TransferWithAuthorization', message });

  const payload = {
    x402Version: chal?.x402Version ?? 2,
    scheme: 'exact',
    network: req.network,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: req.payTo,
        value: String(req.amount),
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce,
      },
    },
  };
  return {
    headerValue: Buffer.from(JSON.stringify(payload)).toString('base64'),
    payload,
    payer: account.address,
    chainId,
    amountUsd: Number(req.amount) / 1e6,
  };
}
