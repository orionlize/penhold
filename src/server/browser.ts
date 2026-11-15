import { spawn } from 'node:child_process';

/** 用系统默认浏览器打开 URL。设置 DESIGN_MCP_NO_BROWSER=1 可禁用（测试或手动打开）。 */
export function openBrowser(url: string): boolean {
  if (process.env.DESIGN_MCP_NO_BROWSER === '1') return false;
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
        : ['xdg-open', [url]];
  try {
    const p = spawn(cmd, args as string[], { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
    return true;
  } catch {
    return false;
  }
}
