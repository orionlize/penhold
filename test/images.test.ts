import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivedThumbnail, fetchThumbnail, hitThumbnail, ImageSearchError, searchImages } from '../src/server/design/images.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('Openverse：只请求可商用可修改的授权，按宽度与方向过滤并去重', async () => {
  let asked = '';
  const fetchImpl = (async (url: string) => {
    asked = String(url);
    return json({
      results: [
        { url: 'https://img.example/a.jpg', width: 1600, height: 1000, title: 'Bass', creator: 'Ann', license: 'by', license_version: '2.0', foreign_landing_url: 'https://src.example/a', thumbnail: 'https://t.example/a' },
        { url: 'https://img.example/a.jpg', width: 1600, height: 1000, title: '重复', license: 'by' },
        { url: 'https://img.example/small.jpg', width: 300, height: 200, title: '太小', license: 'cc0' },
        { url: 'https://img.example/tall.jpg', width: 800, height: 1400, title: '竖图', license: 'cc0' },
        { url: 'http://img.example/insecure.jpg', width: 1600, height: 1000, title: '非 https', license: 'cc0' },
        { url: 'https://img.example/b.jpg', width: 1200, height: 800, title: '', license: 'cc0' },
      ],
    });
  }) as unknown as typeof fetch;
  const r = await searchImages({ query: ' largemouth bass ', orientation: 'landscape', count: 3 }, { env: {}, fetchImpl });
  assert.equal(r.provider, 'openverse');
  assert.match(asked, /api\.openverse\.org\/v1\/images\/\?q=largemouth\+bass&/);
  assert.match(asked, /license_type=commercial%2Cmodification/);
  assert.match(asked, /aspect_ratio=wide/);
  assert.deepEqual(r.hits.map((h) => h.url), ['https://img.example/a.jpg', 'https://img.example/b.jpg']);
  assert.equal(r.hits[0].license, 'CC BY 2.0');
  assert.match(r.hits[0].credit, /Bass，作者 Ann，CC BY 2\.0/);
  assert.equal(r.hits[1].license, 'CC0');
});

test('关闭、限流与网络错误给出可操作的提示', async () => {
  await assert.rejects(searchImages({ query: 'x y' }, { env: { DESIGN_MCP_IMAGES: 'off' } }), ImageSearchError);
  await assert.rejects(searchImages({ query: 'fish' }, { env: {}, fetchImpl: (async () => json({}, 429)) as unknown as typeof fetch }), /过于频繁/);
  await assert.rejects(
    searchImages({ query: 'fish' }, { env: {}, fetchImpl: (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch }),
    /请用户提供图片/,
  );
  const empty = await searchImages({ query: 'fish' }, { env: {}, fetchImpl: (async () => json({ results: [] })) as unknown as typeof fetch });
  assert.deepEqual(empty.hits, []);
});

test('缩略图：只接受体积合理的位图', async () => {
  const img = (type: string, size: number) => (async () => new Response(Buffer.alloc(size, 1), { headers: { 'content-type': type } })) as unknown as typeof fetch;
  assert.equal((await fetchThumbnail('https://t.example/a', img('image/jpeg', 1000)))?.mimeType, 'image/jpeg');
  assert.equal(await fetchThumbnail('https://t.example/a', img('image/svg+xml', 1000)), undefined);
  assert.equal(await fetchThumbnail('https://t.example/a', img('image/jpeg', 500_000)), undefined);
  assert.equal(await fetchThumbnail('https://t.example/a', (async () => new Response('', { status: 404 })) as unknown as typeof fetch), undefined);
});

test('缩略图代理失败时回退到来源站的小图', async () => {
  assert.equal(derivedThumbnail('https://upload.wikimedia.org/wikipedia/commons/5/57/Freshwater_fishing_floats.jpg'), 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Freshwater_fishing_floats.jpg/500px-Freshwater_fishing_floats.jpg');
  assert.equal(derivedThumbnail('https://live.staticflickr.com/7/9726119_8cb60eac90_b.jpg'), 'https://live.staticflickr.com/7/9726119_8cb60eac90_z.jpg');
  assert.equal(derivedThumbnail('https://img.example/a.jpg'), undefined);
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    asked.push(String(url));
    return String(url).includes('openverse') ? new Response('{}', { status: 424 }) : new Response(Buffer.alloc(2000, 1), { headers: { 'content-type': 'image/jpeg' } });
  }) as unknown as typeof fetch;
  const hit = { url: 'https://live.staticflickr.com/7/1_ab_b.jpg', title: 't', license: 'CC0', credit: 'c', thumbnail: 'https://api.openverse.org/v1/images/x/thumb/' };
  assert.ok(await hitThumbnail(hit, fetchImpl));
  assert.deepEqual(asked, ['https://api.openverse.org/v1/images/x/thumb/', 'https://live.staticflickr.com/7/1_ab_z.jpg']);
});
