import SwaggerParser from '@apidevtools/swagger-parser';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const specification = fileURLToPath(new URL('../openapi.json', import.meta.url));
const api = await SwaggerParser.validate(specification, { resolve: { http: false } });
const serverBase = new URL(api.servers?.[0]?.url || '/', 'http://localhost').pathname.replace(/\/$/, '');
const documented = new Set();
for (const [path, operations] of Object.entries(api.paths)) {
  for (const method of Object.keys(operations)) {
    if (/^(get|post|put|patch|delete|head|options)$/.test(method)) documented.add(`${method.toUpperCase()} ${serverBase}${path}`);
  }
}
const actual = new Set();
const appSource = readFileSync(new URL('../server/src/app.js', import.meta.url), 'utf8');
const normalize = (path) => path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
for (const match of appSource.matchAll(/app\.(get|post|put|patch|delete|head|options)\(['"](\/api[^'"]*)['"]/g)) {
  actual.add(`${match[1].toUpperCase()} ${normalize(match[2])}`);
}
for (const mount of appSource.matchAll(/app\.use\(['"](\/api[^'"]*)['"],\s*require\(['"]\.\/routes\/([^'"]+)['"]\)\)/g)) {
  const source = readFileSync(new URL(`../server/src/routes/${mount[2].replace(/\.js$/, '')}.js`, import.meta.url), 'utf8');
  for (const route of source.matchAll(/router\.(get|post|put|patch|delete|head|options)\(['"]([^'"]*)['"]/g)) {
    actual.add(`${route[1].toUpperCase()} ${normalize(`${mount[1]}${route[2] === '/' ? '' : route[2]}`)}`);
  }
  for (const chain of source.matchAll(/router\.route\(['"]([^'"]*)['"]\)([^;]+);/g)) {
    for (const method of chain[2].matchAll(/\.(get|post|put|patch|delete|head|options)\(/g)) {
      actual.add(`${method[1].toUpperCase()} ${normalize(`${mount[1]}${chain[1] === '/' ? '' : chain[1]}`)}`);
    }
  }
}
assert.ok(actual.size > 0, 'No server routes were discovered.');
assert.deepEqual([...documented].sort(), [...actual].sort(), 'OpenAPI operations must match implemented routes.');
console.log(`OpenAPI schema valid; ${actual.size} operations match implemented server routes.`);
