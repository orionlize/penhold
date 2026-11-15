import { createRoot } from 'react-dom/client';
import { Editor } from './Editor';
import { Home } from './Home';
import { SystemEditor } from './SystemEditor';
import './styles.css';
import './theme'; // 主题默认跟随系统


// 兼容旧链接：去掉地址栏中的 ?t=
if (location.search.includes('t=')) history.replaceState(null, '', location.pathname);

const m = /^\/c\/([0-9a-f-]{36})$/.exec(location.pathname);
const sm = /^\/s\/([a-z0-9][a-z0-9-]{0,47})$/.exec(location.pathname);
createRoot(document.getElementById('root')!).render(m ? <Editor canvasId={m[1]} /> : sm ? <SystemEditor id={sm[1]} /> : <Home />);
