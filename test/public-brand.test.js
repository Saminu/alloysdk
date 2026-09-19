import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('public pages share COMPUT branding without inventing a deployed endpoint', () => {
  for (const file of ['index.html', 'enterprise.html', 'enterprise-getting-started.html']) {
    const html = readFileSync(new URL('../docs/' + file, import.meta.url), 'utf8');
    assert.match(html, /<span>COMPUT<\/span>/);
    assert.match(html, /comput-brand\.css\?v=/);
    assert.match(html, /family=Inter/);
    assert.match(html, /COMPUT_API_KEY/);
    assert.doesNotMatch(html, /alloyapi\.ai\.studio|brand-mark|Libre\+Baskerville/);
  }
  const home = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
  assert.match(home, /Make every<br><em>token compute\./);
  assert.match(home, /'alloy-sdk'/);
  assert.match(home, /new<\/span> Alloy/);
  const css = readFileSync(new URL('../docs/comput-brand.css', import.meta.url), 'utf8');
  for (const color of ['#0A0A0A', '#C7FF3D', '#F5F3EE', '#DDE2E6']) assert.ok(css.includes(color));
});
