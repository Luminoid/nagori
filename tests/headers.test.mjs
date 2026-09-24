// _headers: the content security policy names the one inline style block (404.html) by hash and nothing else needs one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('the CSP style hash matches the 404 page and no other inline style exists', async () => {
  const headers = await readFile(new URL('_headers', root), 'utf8');
  const notFound = await readFile(new URL('404.html', root), 'utf8');
  const block = /<style>([\s\S]*?)<\/style>/.exec(notFound)[1];
  const digest = createHash('sha256').update(block).digest('base64');
  assert.ok(headers.includes(`'sha256-${digest}'`), `_headers needs style-src 'sha256-${digest}'`);
  assert.ok(!headers.includes("'unsafe-inline'"));
  for (const page of ['index.html', 'song.html', 'tools.html']) assert.ok(!(await readFile(new URL(page, root), 'utf8')).includes('<style'), page);
  for (const file of await readdir(new URL('js/', root))) {
    const text = await readFile(new URL(`js/${file}`, root), 'utf8');
    assert.ok(!/style="/.test(text), `${file} sets a style attribute in markup, which the policy blocks`);
  }
});
