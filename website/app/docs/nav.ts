export type DocPage = { slug: string; title: string; desc: string };
export type DocGroup = { group: string; pages: DocPage[] };

export const DOC_GROUPS: DocGroup[] = [
  {
    group: '开始',
    pages: [
      { slug: '', title: '概览', desc: 'Penhold 是什么、能做什么、数据放在哪。' },
      { slug: 'install', title: '安装', desc: '环境要求、注册 MCP 服务、第一次出稿。' },
      { slug: 'clients', title: '接入客户端', desc: 'Claude Code、Cursor、Codex CLI 与直连 HTTP 的配置。' },
    ],
  },
  {
    group: '使用',
    pages: [
      { slug: 'workflow', title: '一轮出稿的流程', desc: '从一句话需求到自检通过，AI 和你各做什么。' },
      { slug: 'canvas', title: '画布操作', desc: '选中、改样式、文字、批注、评论、快捷键。' },
      { slug: 'design-system', title: '设计系统', desc: '方向卡片、预设、导入 Tailwind / shadcn、编辑页。' },
      { slug: 'prototype', title: '交互原型', desc: '让稿子能点：tab、倒计时、跳转、表单与状态检查。' },
      { slug: 'export', title: '导出与转代码', desc: '单文件 HTML、zip、Tweaks 面板、让 AI 照稿写代码。' },
    ],
  },
  {
    group: '参考',
    pages: [
      { slug: 'tools', title: 'MCP 工具', desc: '全部 24 个工具的用途与主要参数。' },
      { slug: 'config', title: '命令与配置', desc: '命令行、环境变量、数据目录。' },
      { slug: 'faq', title: '常见问题', desc: '浏览器没打开、端口占用、画布找不回等。' },
    ],
  },
];

export const DOC_PAGES = DOC_GROUPS.flatMap((g) => g.pages);

export const docHref = (slug: string) => (slug ? `/docs/${slug}` : '/docs');

export function docMeta(slug: string) {
  const p = DOC_PAGES.find((x) => x.slug === slug)!;
  return { title: `${p.title} · Penhold 文档`, description: p.desc };
}
