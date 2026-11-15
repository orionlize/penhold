import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTransform, transformCss } from '../src/core/transform.ts';

test('transform parses into an ordered list and round-trips', () => {
  for (const css of ['translate(4px, 0) rotate(8deg) scale(1.05)', 'rotate(-45deg) translate(50%, 2rem)', 'scale(1, 2) skew(10deg, 0deg)', 'rotate(10deg) translate(5px, 0) rotate(-10deg)'])
    assert.equal(transformCss(parseTransform(css)!), css);
  assert.deepEqual(parseTransform('translateX(10px) translateY(-5px) rotate(0.25turn) scaleX(120%)'), [
    { fn: 'translate', x: 10, y: 0 },
    { fn: 'translate', x: 0, y: -5 },
    { fn: 'rotate', x: 90, y: 0 },
    { fn: 'scale', x: 1.2, y: 1 },
  ]);
  assert.deepEqual(parseTransform('scale(2)'), [{ fn: 'scale', x: 2, y: 2 }]);
  assert.deepEqual(parseTransform(''), []);
  assert.equal(transformCss([]), null);
});

test('unsupported transforms are not parsed', () => {
  for (const css of ['matrix(1, 0, 0, 1, 0, 0)', 'rotate3d(1, 1, 1, 45deg)', 'rotateX(10deg)', 'translateZ(1px)', 'translate(calc(1px + 2px))', 'rotate(10)', 'rotate(1deg) junk'])
    assert.equal(parseTransform(css), null, css);
});
