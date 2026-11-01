import readline from 'node:readline';
import { request } from './http.js';

/**
 * `agentalarm mcp`: a local stdio MCP server that forwards every JSON-RPC message to AgentAlarm's remote MCP
 * endpoint (Streamable HTTP) with the key from `agentalarm login`. Clients that cannot read a key from a file
 * (Cursor plugins) use it, so the key never goes into their config. stdout carries only JSON-RPC.
 */

/** JSON-RPC messages in an HTTP response: a JSON object or batch, or SSE `data:` events. */
export function messagesFrom(res) {
  const type = String(res.headers['content-type'] || '');
  if (type.includes('text/event-stream')) {
    const messages = [];
    for (const block of res.text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) continue;
      try {
        messages.push(JSON.parse(data));
      } catch {
        // Not JSON-RPC: skip.
      }
    }
    return messages;
  }
  if (res.json === undefined) return [];
  return Array.isArray(res.json) ? res.json : [res.json];
}

function rpcError(id, message) {
  return { jsonrpc: '2.0', id, error: { code: -32000, message } };
}

export function createProxy({ creds, write, post = request }) {
  let sessionId = null;
  let protocolVersion = null;

  return async function forward(message) {
    const hasId = message && typeof message === 'object' && 'id' in message && message.id !== null;
    if (!creds.key) {
      if (hasId) write(rpcError(message.id, 'AgentAlarm is not connected. Run "npx agentalarm login" in a terminal.'));
      return;
    }

    const headers = {
      Authorization: `Bearer ${creds.key}`,
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
    };

    let res;
    try {
      res = await post('POST', `${creds.baseUrl}/mcp`, { headers, body: message });
    } catch (error) {
      if (hasId) write(rpcError(message.id, error.message));
      return;
    }

    if (typeof res.headers['mcp-session-id'] === 'string') sessionId = res.headers['mcp-session-id'];
    if (res.status === 202 || res.status === 204) return;
    if (res.status < 200 || res.status >= 300) {
      if (hasId) {
        const why = res.status === 401 ? 'AgentAlarm rejected the key. Run "npx agentalarm login" again.' : `AgentAlarm answered HTTP ${res.status}.`;
        write(rpcError(message.id, why));
      }
      return;
    }

    for (const reply of messagesFrom(res)) {
      if (reply && reply.result && typeof reply.result.protocolVersion === 'string') protocolVersion = reply.result.protocolVersion;
      write(reply);
    }
  };
}

/** Reads newline-delimited JSON-RPC from `input`, one message at a time, until it closes. */
export function runMcpProxy({ creds, input = process.stdin, output = process.stdout, post }) {
  const forward = createProxy({ creds, post, write: (message) => output.write(`${JSON.stringify(message)}\n`) });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let queue = Promise.resolve();

  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      return;
    }
    queue = queue.then(() => forward(message));
  });

  return new Promise((resolve) => lines.on('close', () => queue.then(resolve)));
}
