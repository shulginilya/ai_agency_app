#!/usr/bin/env node
/**
 * Refreshes contracts/openapi.json from a running server.
 *
 *   npm run contract:pull                       # http://localhost:8000
 *   npm run contract:pull -- --url http://…     # somewhere else
 *   npm run contract:pull -- --check            # exit 1 if the pinned copy is stale
 *
 * `--check` is what CI runs when it has the API available: it proves the pinned
 * spec is still what the server serves, without writing anything. The everyday
 * `npm test` path needs no server at all — it reads the pinned file.
 *
 * The spec is normalised (keys sorted, one trailing newline) so that a pull with
 * no real change produces an empty diff. FastAPI's key order is not stable
 * across versions and an unsorted file turns every refresh into noise nobody
 * reads.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '..', 'contracts', 'openapi.json');

const args = process.argv.slice(2);
const check = args.includes('--check');
const urlIndex = args.indexOf('--url');
const baseUrl = (urlIndex >= 0 ? args[urlIndex + 1] : process.env.API_URL) ?? 'http://localhost:8000';
const specUrl = new URL('/openapi.json', baseUrl).toString();

/** Sorts object keys everywhere so a re-pull diffs only on real changes. */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortDeep(value[key])]),
    );
  }
  return value;
}

const response = await fetch(specUrl).catch((cause) => {
  console.error(`Cannot reach ${specUrl} — is the API running?\n  ${cause.message}`);
  process.exit(2);
});

if (!response.ok) {
  console.error(`${specUrl} answered ${response.status}`);
  process.exit(2);
}

const next = `${JSON.stringify(sortDeep(await response.json()), null, 2)}\n`;
const current = existsSync(target) ? readFileSync(target, 'utf8') : null;

if (current === next) {
  console.log(`contracts/openapi.json is up to date with ${specUrl}`);
  process.exit(0);
}

if (check) {
  console.error(
    `contracts/openapi.json is stale — the server at ${specUrl} serves a different spec.\n` +
      `Run: npm run contract:pull -- --url ${baseUrl}\n` +
      `Then read the diff: it is the list of things that changed about your API.`,
  );
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, next);
console.log(
  current === null
    ? `Wrote contracts/openapi.json from ${specUrl}`
    : `Updated contracts/openapi.json from ${specUrl} — check the diff, then run npm test`,
);
