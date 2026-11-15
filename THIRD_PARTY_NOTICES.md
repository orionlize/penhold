# Third-Party Notices

penhold-mcp 的内置设计预设包含以下第三方内容。

## ui-ux-pro-max-skill

- 来源：https://github.com/nextlevelbuilder/ui-ux-pro-max-skill （`src/ui-ux-pro-max/data/` 下的 products.csv、colors.csv、styles.csv、typography.csv）
- 用于：`guides/catalog.json`（由 `scripts/import-presets.ts` 生成；字段经精简、重命名，色板列映射为本项目令牌名，已弃用的风格被去掉）
- 许可证：MIT

```
MIT License

Copyright (c) 2024 Next Level Builder

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## frontend-design skill（Anthropic）

- 来源：https://github.com/anthropics/skills （`skills/frontend-design/SKILL.md`）
- 用于：`guides/default/SKILL.md` 的第 1、3、5、7、8 节，经翻译为中文、删减，并按 penhold-mcp 的画布与工具改写（新增令牌、版式、组件约定与预设用法等内容）
- 许可证：Apache License 2.0，全文见 `guides/default/LICENSE.txt`
