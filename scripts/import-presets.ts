// 从 ui-ux-pro-max-skill（MIT，https://github.com/nextlevelbuilder/ui-ux-pro-max-skill）的数据表生成内置预设目录 guides/catalog.json。
// 用法：tsx scripts/import-presets.ts <含 products.csv / colors.csv / styles.csv / typography.csv 的目录>
// 数据表位于上游仓库 src/ui-ux-pro-max/data/；更新时重新下载并运行本脚本，再检查 git diff。
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('用法：tsx scripts/import-presets.ts <数据目录>');
  process.exit(1);
}

/** RFC 4180 CSV 解析（支持引号内逗号、换行与 "" 转义）。 */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const read = (f: string) => parseCsv(fs.readFileSync(path.join(dir, f), 'utf8'));
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const list = (s: string) =>
  s
    .split(/[,|]/)
    .map((x) => x.trim())
    .filter(Boolean);
const opt = (s: string | undefined) => (s && s !== '-' && s.toLowerCase() !== 'n/a' ? s : undefined);

const products = read('products.csv');
const colors = new Map(read('colors.csv').map((r) => [r['Product Type'], r]));
const styles = read('styles.csv');
const fonts = read('typography.csv');

// 色板列 → 本项目令牌名
const COLOR_KEYS: [string, string][] = [
  ['Primary', 'color.primary'],
  ['On Primary', 'color.on-primary'],
  ['Secondary', 'color.secondary'],
  ['On Secondary', 'color.on-secondary'],
  ['Accent', 'color.accent'],
  ['On Accent', 'color.on-accent'],
  ['Background', 'color.bg'],
  ['Foreground', 'color.fg'],
  ['Card', 'color.card'],
  ['Card Foreground', 'color.card-fg'],
  ['Muted', 'color.muted'],
  ['Muted Foreground', 'color.muted-fg'],
  ['Border', 'color.border'],
  ['Destructive', 'color.danger'],
  ['On Destructive', 'color.on-danger'],
  ['Ring', 'color.ring'],
];

const out = {
  source: {
    name: 'ui-ux-pro-max-skill',
    url: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    license: 'MIT',
    copyright: 'Copyright (c) 2024 Next Level Builder',
    note: '字段经精简与重命名，色板列映射为本项目令牌名。',
  },
  products: products.map((p) => {
    const c = colors.get(p['Product Type']);
    const tokens: Record<string, string> = {};
    if (c) for (const [col, key] of COLOR_KEYS) if (/^#[0-9a-f]{3,8}$/i.test(c[col] ?? '')) tokens[key] = c[col].toUpperCase();
    return {
      id: slug(p['Product Type']),
      name: p['Product Type'],
      keywords: list(p['Keywords']).map((k) => k.toLowerCase()),
      style: p['Primary Style Recommendation'],
      secondary: opt(p['Secondary Styles'])?.replace(/\s+,/g, ','),
      landing: opt(p['Landing Page Pattern']),
      dashboard: opt(p['Dashboard Style (if applicable)']),
      color_focus: opt(p['Color Palette Focus']),
      considerations: opt(p['Key Considerations']),
      palette_note: opt(c?.['Notes']),
      tokens,
    };
  }),
  styles: styles
    .filter((s) => s['Status'] !== 'deprecated')
    .map((s) => ({
      id: s['Style ID'] || slug(s['Style Category']),
      name: s['Style Category'],
      aliases: list(s['Aliases'] ?? ''),
      keywords: list(s['Keywords']).map((k) => k.toLowerCase()),
      colors: [opt(s['Primary Colors']), opt(s['Secondary Colors'])].filter(Boolean).join('; '),
      effects: opt(s['Effects & Animation']),
      best_for: opt(s['Best For']),
      avoid_for: opt(s['Do Not Use For']),
      variables: opt(s['Design System Variables']),
      dark_mode: s['Dark Mode ✓'] === 'supported',
    })),
  fonts: fonts.map((f) => ({
    name: f['Font Pairing Name'],
    category: f['Category'],
    heading: f['Heading Font'],
    body: f['Body Font'],
    mood: list(f['Mood/Style Keywords']).map((k) => k.toLowerCase()),
    best_for: opt(f['Best For']),
    notes: opt(f['Notes']),
  })),
};

const dest = path.resolve(import.meta.dirname, '../guides/catalog.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + '\n');
console.log(`写入 ${dest}：${out.products.length} 个产品类型，${out.styles.length} 种风格，${out.fonts.length} 组字体`);
