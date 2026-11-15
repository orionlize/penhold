import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradientCss, parseGradient } from '../src/core/gradient.ts';
import { validateNodeInput } from '../src/core/schema.ts';

test('gradient round-trips through structured fields', () => {
  for (const css of [
    'linear-gradient(90deg, #FF0000 0%, rgba(0, 0, 255, 0.5) 100%)',
    'repeating-linear-gradient(45deg, #000000 0%, #FFFFFF 10%)',
    'radial-gradient(circle closest-side at 20% 30%, #000000 0%, #FFFFFF 100%)',
    'radial-gradient(#000000 0%, #FFFFFF 100%)',
    'conic-gradient(from 90deg at 10% 50%, red 0%, blue 50%, red 100%)',
  ])
    assert.equal(gradientCss(parseGradient(css)!), css);
});

test('gradient parser accepts common shorthand', () => {
  const g = parseGradient('linear-gradient(to right, red, green, blue)')!;
  assert.equal(g.angle, 90);
  assert.deepEqual(g.stops.map((s) => s.pos), [0, 50, 100]);
  assert.equal(parseGradient('radial-gradient(ellipse at top left, red, blue)')!.x, 0);
  assert.equal(parseGradient('conic-gradient(red 0deg, blue 180deg)')!.stops[1].pos, 50);
  assert.equal(parseGradient('#fff'), null);
  assert.equal(parseGradient('linear-gradient(red 10px, blue)'), null);
});

test('serialized gradients pass the style schema', () => {
  const css = gradientCss(parseGradient('radial-gradient(circle at 20% 30%, rgba(0,0,0,0.5) 0%, #fff 100%)')!);
  assert.equal((validateNodeInput({ type: 'box', style: { background: css } }) as { style: { background: string } }).style.background, css);
});
