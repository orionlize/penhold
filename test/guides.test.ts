import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findDesignGuides } from '../src/server/guides.ts';

test('发现项目内设计 skill、设计文档与 DESIGN_MCP_GUIDES 指定的文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-guides-'));
  fs.mkdirSync(path.join(root, '.git'));
  const skill = path.join(root, '.claude/skills/brand-ui/SKILL.md');
  const other = path.join(root, '.claude/skills/sql-helper/SKILL.md');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(skill, '---\nname: brand-ui\ndescription: 品牌设计规范：主色、字体与组件写法\n---\n# Brand');
  fs.writeFileSync(other, '---\nname: sql-helper\ndescription: Write SQL queries\n---\n');
  fs.writeFileSync(path.join(root, 'DESIGN.md'), '# 设计规范');
  const extra = path.join(root, 'tokens.md');
  fs.writeFileSync(extra, '# tokens');
  const sub = path.join(root, 'packages/app');
  fs.mkdirSync(sub, { recursive: true });

  const prev = process.env.DESIGN_MCP_GUIDES;
  process.env.DESIGN_MCP_GUIDES = extra;
  try {
    const g = findDesignGuides(sub);
    const byPath = new Map(g.map((x) => [x.path, x]));
    assert.equal(byPath.get(extra)?.kind, 'custom');
    assert.equal(byPath.get(skill)?.kind, 'skill');
    assert.equal(byPath.get(skill)?.name, 'brand-ui');
    assert.equal(byPath.get(path.join(root, 'DESIGN.md'))?.kind, 'doc');
    assert.ok(!byPath.has(other), '与设计无关的 skill 不应列出');
    assert.equal(g[0].path, extra, '显式指定的排在最前');
  } finally {
    if (prev === undefined) delete process.env.DESIGN_MCP_GUIDES;
    else process.env.DESIGN_MCP_GUIDES = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
