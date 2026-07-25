import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createApp } from '../src/app.js';

/**
 * Keeps `openapi.yaml` honest. A spec nobody checks is worse than no spec: it
 * reads like a contract while quietly describing a service that no longer
 * exists. This asserts the two directions that actually rot —
 *
 *   · a route added to the service but never documented, and
 *   · a documented route that has been renamed or removed
 *
 * — by reading the routes off the live Express app rather than a hand-kept list.
 *
 * The YAML is read with a regex instead of a parser on purpose: this service
 * ships three runtime dependencies, and a spec-drift test is not worth a fourth.
 * The pattern only has to find top-level `paths:` keys and their methods, and
 * the file that must satisfy it lives right here in the repository.
 */

const spec = readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8');

/** `{ '/food/parse': ['post'], … }` as written in the spec. */
function specRoutes(): Map<string, string[]> {
  const lines = spec.split('\n');
  const start = lines.findIndex((line) => line === 'paths:');
  assert.ok(start >= 0, 'openapi.yaml has no top-level `paths:` block');

  const routes = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines.slice(start + 1)) {
    // A new top-level block (e.g. `components:`) ends the paths section.
    if (/^[a-z]/.test(line)) break;
    const path = /^ {2}(\/[A-Za-z0-9/_-]*):\s*$/.exec(line);
    if (path?.[1]) {
      current = path[1];
      routes.set(current, []);
      continue;
    }
    const method = /^ {4}(get|post|put|patch|delete|head|options):\s*$/.exec(line);
    if (method?.[1] && current) routes.get(current)?.push(method[1]);
  }
  return routes;
}

/** `{ '/food/parse': ['post'], … }` as actually registered by createApp(). */
function appRoutes(): Map<string, string[]> {
  const app = createApp() as unknown as {
    router?: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  };
  const stack = app.router?.stack ?? [];
  const routes = new Map<string, string[]>();
  for (const layer of stack) {
    if (!layer.route) continue;
    const methods = Object.entries(layer.route.methods)
      .filter(([, on]) => on)
      .map(([name]) => name);
    routes.set(layer.route.path, [...(routes.get(layer.route.path) ?? []), ...methods]);
  }
  return routes;
}

test('every route the service registers is documented', () => {
  const documented = specRoutes();
  const undocumented = [...appRoutes().keys()].filter((path) => !documented.has(path));
  assert.deepEqual(undocumented, [], `routes missing from openapi.yaml: ${undocumented.join(', ')}`);
});

test('every documented route still exists', () => {
  const live = appRoutes();
  const stale = [...specRoutes().keys()].filter((path) => !live.has(path));
  assert.deepEqual(stale, [], `openapi.yaml documents routes the service no longer has: ${stale.join(', ')}`);
});

test('the documented method matches the registered one', () => {
  const live = appRoutes();
  for (const [path, methods] of specRoutes()) {
    const actual = live.get(path);
    if (!actual) continue; // covered by the test above
    for (const method of methods) {
      assert.ok(
        actual.includes(method),
        `openapi.yaml documents ${method.toUpperCase()} ${path}, but the service registers ${actual
          .map((m) => m.toUpperCase())
          .join('/')}`,
      );
    }
  }
});

test('the spec parses to the routes we expect (guards the regex itself)', () => {
  const documented = specRoutes();
  // If the reader silently matched nothing, every assertion above would pass
  // vacuously in one direction — so pin a couple of known entries.
  assert.ok(documented.size >= 8, `only ${documented.size} paths found — the spec reader is broken`);
  assert.deepEqual(documented.get('/food/parse'), ['post']);
  assert.deepEqual(documented.get('/health'), ['get']);
});

test('every error code the service can emit is in the documented enum', () => {
  const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const emitted = new Set([...appSource.matchAll(/fail\(res, \d+, '([a-z_]+)'/g)].map((m) => m[1] as string));
  assert.ok(emitted.size > 0, 'found no fail() calls — the extractor is broken');

  const enumBlock = /code:\s*\n\s*type: string\s*\n\s*enum:\s*\n([\s\S]*?)\n\s{12}message:/.exec(spec);
  assert.ok(enumBlock?.[1], 'could not find the error-code enum in openapi.yaml');
  const documented = new Set(
    enumBlock[1]
      .replace(/[[\]]/g, ' ')
      .split(/[\s,]+/)
      .filter(Boolean),
  );

  const missing = [...emitted].filter((code) => !documented.has(code));
  assert.deepEqual(missing, [], `error codes missing from openapi.yaml: ${missing.join(', ')}`);
});
