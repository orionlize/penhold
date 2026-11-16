// 位图单页 PDF：RGB 像素 Flate 无损压缩后嵌入；页面尺寸按 CSS 像素换算为 pt（1px = 0.75pt）。

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  // CompressionStream('deflate') 输出 zlib 格式，正是 PDF FlateDecode 需要的
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 由 RGB 像素生成单页 PDF（不依赖 DOM，便于测试）。 */
export async function rgbToPdf(rgb: Uint8Array, pxW: number, pxH: number, cssW: number, cssH: number): Promise<Blob> {
  const data = await deflate(rgb);
  // PDF 页面边长上限 14400 单位：超长页面用 UserUnit 放大单位
  let pw = cssW * 0.75;
  let ph = cssH * 0.75;
  const unit = Math.max(1, Math.max(pw, ph) / 14400);
  pw /= unit;
  ph /= unit;
  const f = (n: number) => n.toFixed(2).replace(/\.?0+$/, '');
  const content = `q ${f(pw)} 0 0 ${f(ph)} 0 0 cm /Im0 Do Q`;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (p: Uint8Array | string) => {
    const b = typeof p === 'string' ? enc.encode(p) : p;
    parts.push(b);
    len += b.length;
  };
  const obj = (n: number, body: string, stream?: Uint8Array) => {
    offsets[n] = len;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };
  push('%PDF-1.6\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}]${unit > 1 ? ` /UserUnit ${f(unit)}` : ''} /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>`, data);
  const cs = enc.encode(content);
  obj(5, `<< /Length ${cs.length} >>`, cs);
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
