// 图片素材搜索：设计稿需要照片而用户没有提供素材时，从图库找可用的图片。
// 来源是 Openverse（聚合 Wikimedia、Flickr 等的 CC 授权图片，不需要密钥）。DESIGN_MCP_IMAGES=off 关闭。
// 搜索词会发送给所选图库；图片本身在 node_insert 时由 assets.ts 下载入库。

export type Orientation = 'landscape' | 'portrait' | 'square';

export interface ImageHit {
  /** 可直接用作 props.src 的图片地址。 */
  url: string;
  width?: number;
  height?: number;
  title: string;
  /** 授权，如 "CC BY 2.0"、"CC0"。 */
  license: string;
  /** 署名文字（交付或上线时需要保留）。 */
  credit: string;
  /** 图片来源页面。 */
  page?: string;
  thumbnail?: string;
}

export interface ImageSearch {
  query: string;
  count?: number;
  orientation?: Orientation;
  /** 原图最小宽度（px）。 */
  minWidth?: number;
}

export interface ImageSearchResult {
  provider: 'openverse';
  hits: ImageHit[];
}

type Fetch = typeof fetch;
const UA = 'design-canvas/1.0';

export class ImageSearchError extends Error {}

export function imageProvider(env: NodeJS.ProcessEnv = process.env): 'openverse' | 'off' {
  return /^(off|0|false|none)$/i.test(env.DESIGN_MCP_IMAGES ?? '') ? 'off' : 'openverse';
}

async function getJson(fetchImpl: Fetch, url: string, headers: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new ImageSearchError(`图库请求失败（${(e as Error).message}）：检查网络，或请用户提供图片`);
  }
  if (res.status === 429) throw new ImageSearchError('图库请求过于频繁，稍后再试，或请用户提供图片');
  if (res.status === 401 || res.status === 403) throw new ImageSearchError(`图库拒绝了请求（HTTP ${res.status}），稍后再试，或请用户提供图片`);
  if (!res.ok) throw new ImageSearchError(`图库返回 HTTP ${res.status}`);
  return res.json();
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function fitsOrientation(w: number | undefined, h: number | undefined, o: Orientation | undefined): boolean {
  if (!o || !w || !h) return true;
  const r = w / h;
  return o === 'landscape' ? r >= 1.15 : o === 'portrait' ? r <= 0.87 : r > 0.87 && r < 1.15;
}

async function searchOpenverse(q: ImageSearch, n: number, fetchImpl: Fetch): Promise<ImageHit[]> {
  const p = new URLSearchParams({
    q: q.query,
    // 多取一些，过滤尺寸与方向后再截断
    page_size: String(Math.min(n * 4, 20)),
    // 只要允许商用和修改的授权（CC0、公有领域、BY、BY-SA）
    license_type: 'commercial,modification',
    mature: 'false',
    extension: 'jpg,jpeg,png,webp',
  });
  if (q.orientation) p.set('aspect_ratio', q.orientation === 'landscape' ? 'wide' : q.orientation === 'portrait' ? 'tall' : 'square');
  const data = (await getJson(fetchImpl, `https://api.openverse.org/v1/images/?${p}`, {})) as { results?: Array<Record<string, unknown>> };
  return (data.results ?? []).flatMap((r): ImageHit[] => {
    const url = str(r.url);
    if (!/^https:\/\//.test(url)) return [];
    const lic = str(r.license).toLowerCase();
    const license = lic === 'cc0' ? 'CC0' : lic === 'pdm' ? '公有领域' : `CC ${lic.toUpperCase()}${r.license_version ? ` ${str(r.license_version)}` : ''}`;
    const title = str(r.title).slice(0, 80) || '未命名';
    const creator = str(r.creator);
    return [
      {
        url,
        width: num(r.width),
        height: num(r.height),
        title,
        license,
        credit: `${title}${creator ? `，作者 ${creator}` : ''}，${license}`,
        page: str(r.foreign_landing_url) || undefined,
        thumbnail: str(r.thumbnail) || undefined,
      },
    ];
  });
}

/** 搜索图片；按方向与最小宽度过滤，同一地址去重。 */
export async function searchImages(q: ImageSearch, opts: { env?: NodeJS.ProcessEnv; fetchImpl?: Fetch } = {}): Promise<ImageSearchResult> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const provider = imageProvider(env);
  if (provider === 'off') throw new ImageSearchError('图片搜索已关闭（DESIGN_MCP_IMAGES=off）：请用户提供图片，或用与题材相关的色块加简单图形占位');
  const query = q.query.trim();
  if (!query) throw new ImageSearchError('query 不能为空');
  const n = Math.min(Math.max(q.count ?? 4, 1), 6);
  const minWidth = q.minWidth ?? 600;
  const raw = await searchOpenverse({ ...q, query }, n, fetchImpl);
  const seen = new Set<string>();
  const hits = raw.filter((h) => {
    if (seen.has(h.url)) return false;
    seen.add(h.url);
    return (h.width === undefined || h.width >= minWidth) && fitsOrientation(h.width, h.height, q.orientation);
  });
  return { provider, hits: hits.slice(0, n) };
}

/** 由原图地址推出小图地址（图库的缩略图代理失败时使用）：Wikimedia（只提供固定几档宽度）与 Flickr 有固定的小图规则。 */
export function derivedThumbnail(url: string): string | undefined {
  const wiki = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[a-z0-9_-]+)\/([0-9a-f]\/[0-9a-f]{2}\/([^/?#]+\.(?:jpe?g|png|webp)))$/i.exec(url);
  if (wiki) return `${wiki[1]}/thumb/${wiki[2]}/500px-${wiki[3]}`;
  const flickr = /^(https:\/\/live\.staticflickr\.com\/[^?#]+?)(?:_[a-z0-9])?\.jpg$/i.exec(url);
  if (flickr) return `${flickr[1]}_z.jpg`;
  return undefined;
}

/** 依次尝试图库缩略图与推出的小图。 */
export async function hitThumbnail(hit: ImageHit, fetchImpl: Fetch = fetch): Promise<{ data: string; mimeType: string } | undefined> {
  for (const u of [hit.thumbnail, derivedThumbnail(hit.url)]) {
    const t = u ? await fetchThumbnail(u, fetchImpl) : undefined;
    if (t) return t;
  }
  return undefined;
}

/** 取缩略图（供 AI 目视挑选）；失败或过大时返回 undefined。 */
export async function fetchThumbnail(url: string, fetchImpl: Fetch = fetch): Promise<{ data: string; mimeType: string } | undefined> {
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return undefined;
    const mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 400_000) return undefined;
    return { data: buf.toString('base64'), mimeType };
  } catch {
    return undefined;
  }
}
