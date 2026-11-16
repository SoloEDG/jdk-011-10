import type { ReliefParams } from "../../../shared/document";

export interface SampleCell {
  height: number;
  r: number;
  g: number;
  b: number;
}
export interface SampleGrid {
  width: number;
  height: number;
  cells: (SampleCell | null)[];
}

const DECODE_LIMIT = 512;
const GRID_LIMIT = 32;

/** 解码图片并限制尺寸，避免大图占用过多内存。 */
export async function decodeImage(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, DECODE_LIMIT / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    bitmap.close();
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 按裁切与缩放参数把源图采样成输出网格。
 * 逐行处理并不时让出主线程，大图转换期间场景仍可操作；
 * aborted() 为真时返回 null，调用方据此丢弃过期结果。
 * 透明像素不参与颜色平均，覆盖率不足的格子保留为空洞。
 */
export async function sampleGrid(
  src: ImageData,
  params: ReliefParams,
  aborted: () => boolean,
  onProgress: (p: number) => void,
): Promise<{ grid: SampleGrid; clamped: boolean } | null> {
  const sw = src.width;
  const sh = src.height;
  const cx = clamp01(params.crop.x) * sw;
  const cy = clamp01(params.crop.y) * sh;
  const cw = Math.max(1, clamp01(params.crop.w) * sw);
  const ch = Math.max(1, clamp01(params.crop.h) * sh);
  const outW = Math.min(GRID_LIMIT, Math.max(1, Math.round(params.width)));
  let outH = Math.max(1, Math.round((outW * ch) / cw));
  const clamped = outH > GRID_LIMIT;
  outH = Math.min(GRID_LIMIT, outH);
  const cells: (SampleCell | null)[] = new Array(outW * outH).fill(null);
  const data = src.data;
  for (let j = 0; j < outH; j++) {
    if (aborted()) return null;
    const sy0 = Math.max(0, Math.floor(cy + (j / outH) * ch));
    const sy1 = Math.min(sh, Math.ceil(cy + ((j + 1) / outH) * ch));
    for (let i = 0; i < outW; i++) {
      const sx0 = Math.max(0, Math.floor(cx + (i / outW) * cw));
      const sx1 = Math.min(sw, Math.ceil(cx + ((i + 1) / outW) * cw));
      let sumA = 0,
        sumR = 0,
        sumG = 0,
        sumB = 0,
        n = 0;
      for (let y = sy0; y < sy1; y++)
        for (let x = sx0; x < sx1; x++) {
          const o = (y * sw + x) * 4;
          const a = data[o + 3] / 255;
          sumA += a;
          sumR += data[o] * a;
          sumG += data[o + 1] * a;
          sumB += data[o + 2] * a;
          n++;
        }
      const coverage = n ? sumA / n : 0;
      if (coverage < 0.5 || sumA <= 0) continue; // 透明区域保留为空洞
      const r = sumR / sumA;
      const g = sumG / sumA;
      const b = sumB / sumA;
      let t = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (params.invert) t = 1 - t;
      cells[j * outW + i] = {
        height: Math.max(1, Math.round(t * params.maxHeight)),
        r,
        g,
        b,
      };
    }
    onProgress((j + 1) / outH);
    if (j % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { grid: { width: outW, height: outH, cells }, clamped };
}
