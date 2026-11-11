import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const route = (path) => {
  for (const entry of config.routes) {
    if (!entry.src) continue;
    const match = new RegExp(`^(?:${entry.src})$`).exec(path);
    if (match) return entry.dest.replace(/\$(\d+)/g, (_, index) => match[Number(index)] ?? '');
  }
  return null;
};

for (const path of ['/api', '/api/auth/me', '/api/unknown', '/api/payments/webhooks/paypal']) {
  assert.equal(route(path), '/server/api/index.js', `${path} must reach the API`);
}
for (const path of ['/', '/login', '/violations', '/register-violation', '/analytics', '/unknown/deep/path']) {
  assert.equal(route(path), '/client/index.html', `${path} must receive the SPA document`);
}
assert.equal(route('/assets/example.js'), '/client/assets/example.js');
assert.equal(route('/favicon.svg'), '/client/favicon.svg');
const html = readFileSync(new URL('../client/dist/index.html', import.meta.url), 'utf8');
for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)/g)) {
  assert.ok(existsSync(resolve('client/dist', `.${match[1]}`)), `Built asset is missing: ${match[1]}`);
}
console.log('Routing contract passed: API precedence, SPA deep links, and built asset paths.');
console.log('This checks local configuration and output; deployed Vercel routing remains unverified.');
