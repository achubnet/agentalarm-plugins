import http from 'node:http';
import https from 'node:https';
import { CliError, EXIT } from './errors.js';
import { VERSION } from './version.js';

export const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export const USER_AGENT = `agentalarm-cli/${VERSION}`;

export function isLoopback(url) {
  return LOOPBACK.has(url.hostname);
}

/** HTTPS only; plain HTTP is allowed for loopback addresses (local development and tests). */
export function checkUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CliError(`Not a valid URL: ${value}`, EXIT.USAGE);
  }
  if (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    return url;
  }
  throw new CliError(`AgentAlarm only connects over HTTPS (got ${url.protocol}//${url.host}).`, EXIT.USAGE);
}

/**
 * One request, no redirects, at most TIMEOUT_MS in total. Resolves with {status, headers, text, json};
 * rejects with a CliError on network failure or timeout.
 */
export function request(method, target, { headers = {}, body, timeoutMs = TIMEOUT_MS } = {}) {
  const url = checkUrl(target);
  const lib = url.protocol === 'https:' ? https : http;
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(payload !== undefined
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new Error('response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          clearTimeout(timer);
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs);
    req.on('error', (error) => {
      clearTimeout(timer);
      const why = error.message === 'timeout' ? `no answer within ${Math.round(timeoutMs / 1000)} s` : error.message;
      reject(new CliError(`Cannot reach ${url.host}: ${why}.`, EXIT.FAILURE));
    });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
