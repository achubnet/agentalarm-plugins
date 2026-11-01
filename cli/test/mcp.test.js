import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { createProxy, messagesFrom, runMcpProxy } from '../src/mcp.js';
import { startFakeServer } from '../test-support/fake-server.js';

const KEY = '7|aa_0123456789abcdef';

test('SSE and JSON responses', () => {
  const sse = { headers: { 'content-type': 'text/event-stream' }, text: 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n' };
  assert.deepEqual(messagesFrom(sse), [{ jsonrpc: '2.0', id: 1, result: {} }]);
  assert.deepEqual(messagesFrom({ headers: { 'content-type': 'application/json' }, json: [{ id: 1 }, { id: 2 }] }), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(messagesFrom({ headers: {}, json: undefined }), []);
});

test('forwards stdio JSON-RPC to the remote endpoint with the key and session headers', async (t) => {
  const server = await startFakeServer({
    'POST /mcp': (req) => {
      if (req.body.method === 'initialize') {
        return { status: 200, headers: { 'Mcp-Session-Id': 's-1' }, json: { jsonrpc: '2.0', id: req.body.id, result: { protocolVersion: '2025-06-18' } } };
      }
      if (req.body.method === 'notifications/initialized') return { status: 202 };
      return { status: 200, headers: { 'Content-Type': 'text/event-stream' }, text: `data: ${JSON.stringify({ jsonrpc: '2.0', id: req.body.id, result: { tools: [] } })}\n\n` };
    },
  });
  t.after(() => server.close());

  const input = new PassThrough();
  const output = new PassThrough();
  let out = '';
  output.on('data', (chunk) => (out += chunk));
  const done = runMcpProxy({ creds: { key: KEY, baseUrl: server.url }, input, output });
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
  input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  input.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
  input.write('not json\n');
  input.end();
  await done;

  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.id), [null, 1, 2]); // the parse error is answered at once
  assert.equal(lines[0].error.code, -32700);
  assert.equal(server.requests.length, 3);
  assert.ok(server.requests.every((r) => r.headers.authorization === `Bearer ${KEY}`));
  assert.equal(server.requests[0].headers['mcp-session-id'], undefined);
  assert.equal(server.requests[2].headers['mcp-session-id'], 's-1');
  assert.equal(server.requests[2].headers['mcp-protocol-version'], '2025-06-18');
});

test('without a key, requests get an error that says how to log in, and nothing is sent', async () => {
  const written = [];
  let posts = 0;
  const forward = createProxy({ creds: { key: null, baseUrl: 'https://x.test' }, write: (m) => written.push(m), post: async () => posts++ });
  await forward({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
  await forward({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(posts, 0);
  assert.equal(written.length, 1);
  assert.match(written[0].error.message, /agentalarm login/);
});

test('HTTP errors become JSON-RPC errors', async () => {
  const written = [];
  const forward = createProxy({ creds: { key: KEY, baseUrl: 'https://x.test' }, write: (m) => written.push(m), post: async () => ({ status: 401, headers: {}, text: '' }) });
  await forward({ jsonrpc: '2.0', id: 9, method: 'tools/call' });
  assert.deepEqual([written[0].id, /rejected the key/.test(written[0].error.message)], [9, true]);
});
