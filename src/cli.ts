#!/usr/bin/env node
// penhold-mcp 命令行入口。
//   penhold-mcp            以 stdio 方式运行 MCP 服务（薄代理，自动拉起守护进程）
//   penhold-mcp daemon     前台运行守护进程
//   penhold-mcp open       打开画布首页
//   penhold-mcp hook       SessionStart hook：上报宿主会话 id（从 stdin 读取 JSON）
const cmd = process.argv[2] ?? 'mcp';

async function main() {
  switch (cmd) {
    case 'mcp':
      return (await import('./proxy.js')).runProxy();
    case 'daemon':
      return void (await import('./server/daemon.js')).runDaemon();
    case 'hook':
      return (await import('./hook.js')).runHook();
    case 'open': {
      const { ensureDaemon } = await import('./proxy.js');
      const { openBrowser } = await import('./server/browser.js');
      const info = await ensureDaemon();
      const url = `http://127.0.0.1:${info.port}/${process.argv[3] ? `c/${process.argv[3]}` : ''}`;
      console.log(url);
      openBrowser(url);
      return;
    }
    case '-v':
    case '--version': {
      const { VERSION } = await import('./server/paths.js');
      return console.log(VERSION);
    }
    default:
      console.log('用法：penhold-mcp [mcp|daemon|open [canvasId]|hook|--version]');
      process.exitCode = cmd === '-h' || cmd === '--help' ? 0 : 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
