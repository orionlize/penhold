import Link from 'next/link';
import { DOC_PAGES, docHref, docMeta } from './nav';
import { DocHead, H2, Table } from './ui';

export const metadata = docMeta('');

export default function Overview() {
  return (
    <>
      <DocHead
        eyebrow="Docs / 概览"
        title="Penhold 文档"
        lede="Penhold（npm 包名 penhold-mcp）是一个跑在本机的设计画布。你的 Agent 通过 MCP 工具在画布上画 UI 稿，你在浏览器里拖边距、改颜色、写评论，画完导出单文件 HTML。"
      />

      <H2 id="what">它解决什么问题</H2>
      <p>
        让 Agent 直接写前端代码，效果好坏全靠一次生成；让它出图，你又改不了。Penhold 在中间放了一块双方都能动的画布：
      </p>
      <ul>
        <li>
          <strong>AI 负责结构</strong>：插入区块、排布局、定令牌、写交互逻辑。
        </li>
        <li>
          <strong>你负责微调</strong>：在画布上改盒模型、颜色、字号、文字，改动立即落盘。AI 下一步会先读你的改动再动手，不会覆盖。
        </li>
        <li>
          <strong>每轮都自检</strong>：AI 画完要对改过的画板截图，服务端附上对比度、点击区域、溢出、交互状态等检查结果，有问题必须修好。
        </li>
      </ul>

      <H2 id="how">工作方式</H2>
      <Table
        head={['组件', '作用']}
        rows={[
          [<code key="a">penhold-mcp</code>, 'stdio MCP 服务，由你的 Agent 启动。它只是一个薄代理，第一次调用时自动拉起守护进程。'],
          ['守护进程', '监听 127.0.0.1:4470（被占用时递增），保存画布、执行工具、提供画布网页。空闲 30 分钟自动退出。'],
          ['画布网页', '在默认浏览器里打开，与守护进程用 WebSocket 实时同步。AI 写入时自动打开。'],
          [<code key="b">~/.penhold/</code>, '全部数据：画布、设计系统、导出文件。不上传，不需要账号。'],
        ]}
      />

      <H2 id="pages">从哪里读起</H2>
      <p>
        第一次用：先看 <Link href="/docs/install">安装</Link>，再看 <Link href="/docs/workflow">一轮出稿的流程</Link>。
      </p>
      <div className="dcards">
        {DOC_PAGES.filter((p) => p.slug).map((p) => (
          <Link key={p.slug} href={docHref(p.slug)} className="dcard">
            <b>{p.title}</b>
            <span>{p.desc}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
