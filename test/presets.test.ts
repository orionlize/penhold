import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { catalog, DEFAULT_GUIDE, defaultGuideText, matchPresets, presetDetail } from '../src/server/design/presets.ts';
import { validateTokens } from '../src/core/schema.ts';

test('内置规范与预设目录随包提供', () => {
  assert.ok(fs.existsSync(DEFAULT_GUIDE));
  assert.match(defaultGuideText(), /^---\nname: penhold-mcp-default\n/);
  const c = catalog();
  assert.ok(c.products.length > 100);
  assert.equal(new Set(c.products.map((p) => p.id)).size, c.products.length, '预设 id 唯一');
});

test('每个预设都有可用的色板令牌与可解析的风格', () => {
  for (const p of catalog().products) {
    assert.ok(p.tokens['color.primary'] && p.tokens['color.bg'] && p.tokens['color.fg'], `${p.id} 缺少基础色`);
    validateTokens(p.tokens);
    const d = presetDetail(p.id)!;
    assert.ok(d.styles.length > 0, `${p.id} 的风格 ${p.style} 无法解析`);
    assert.equal(d.fonts.length, 3);
  }
});

test('按英文与中文需求匹配产品类型', () => {
  const top = (q: string) => matchPresets(q, 3).map((m) => m.id);
  assert.ok(top('personal finance budget tracker app').includes('personal-finance-tracker'));
  assert.ok(top('food delivery').includes('food-delivery-on-demand'));
  assert.ok(top('做一个记账 App').includes('personal-finance-tracker'));
  assert.ok(top('外卖点餐小程序').includes('food-delivery-on-demand'));
  assert.ok(top('医院挂号问诊').some((id) => /health|medical|clinic|patient/.test(id)));
  assert.deepEqual(matchPresets('zzqx'), []);
  assert.deepEqual(matchPresets('邮件'), [], '“ai”等短词不应误命中长单词内部');
});

test('未知 id 返回 undefined', () => {
  assert.equal(presetDetail('no-such-preset'), undefined);
});
