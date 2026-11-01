import http from 'node:http';

/**
 * A local AgentAlarm stand-in. `routes` maps "METHOD /path" to (req, body) => {status, json?, text?, headers?};
 * unknown routes are 404. Every request is recorded with its headers and parsed body.
 */
export async function startFakeServer(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      const record = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body };
      requests.push(record);
      const handler = routes[`${req.method} ${url.pathname}`];
      if (handler === 'hang') return; // never answers
      const out = handler ? handler(record) : { status: 404, json: { message: 'Not found.' } };
      const headers = { ...(out.headers ?? {}) };
      let payload = out.text ?? '';
      if (out.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(out.json);
      }
      res.writeHead(out.status ?? 200, headers);
      res.end(payload);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}
