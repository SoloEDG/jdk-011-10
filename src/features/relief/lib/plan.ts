import {
  inside,
  key,
  type Block,
  type MaterialId,
  type ReliefColumn,
  type ReliefParams,
  type ReliefPlan,
  type Vec3,
  type WorldDocument,
} from "../../../shared/document";
import { materials, materialSpec } from "../../../shared/materials";
import { overlapsPlayer } from "../../world/lib/queries";
import type { SampleGrid } from "./pixels";

const materialRgb = new Map<MaterialId, { r: number; g: number; b: number }>(
  materials.map((m) => {
    const n = parseInt(m.color.slice(1), 16);
    return [
      m.id,
      { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 },
    ];
  }),
);

const distTo = (id: MaterialId, r: number, g: number, b: number) => {
  const c = materialRgb.get(id)!;
  return (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
};

/** 在现有材质中找颜色最接近的一种。 */
export function nearestMaterial(r: number, g: number, b: number): MaterialId {
  let best: MaterialId = "stone";
  let bestD = Infinity;
  for (const m of materials) {
    const d = distTo(m.id, r, g, b);
    if (d < bestD) {
      bestD = d;
      best = m.id;
    }
  }
  return best;
}

/** 某一行列上现有方块的最高高度，没有方块时为 -1。 */
export function surfaceTop(doc: WorldDocument, x: number, z: number) {
  for (let y = 19; y >= 0; y--) if (doc.blocks[key({ x, y, z })]) return y;
  return -1;
}

const zeroBudget = () =>
  Object.fromEntries(materials.map((m) => [m.id, 0])) as Record<
    MaterialId,
    number
  >;

/** 缺货材质改用最接近且有余量的材质，优先搬动颜色最接近替代品的列。 */
function substituteShort(
  columns: ReliefColumn[],
  have: Record<MaterialId, number>,
  notes: string[],
) {
  const need = zeroBudget();
  for (const c of columns) need[c.material] += c.height;
  for (const m of materials) {
    let deficit = need[m.id] - have[m.id];
    if (deficit <= 0) continue;
    const candidates = materials
      .filter((o) => o.id !== m.id)
      .sort(
        (a, b) =>
          distTo(a.id, materialRgb.get(m.id)!.r, materialRgb.get(m.id)!.g, materialRgb.get(m.id)!.b) -
          distTo(b.id, materialRgb.get(m.id)!.r, materialRgb.get(m.id)!.g, materialRgb.get(m.id)!.b),
      );
    const parts: string[] = [];
    for (const cand of candidates) {
      if (deficit <= 0) break;
      const cols = columns
        .filter((c) => c.material === m.id)
        .sort((a, b) => distTo(cand.id, a.r, a.g, a.b) - distTo(cand.id, b.r, b.g, b.b));
      let moved = 0;
      for (const c of cols) {
        const spare = have[cand.id] - need[cand.id];
        if (deficit <= 0 || spare <= 0) break;
        if (c.height > spare) continue; // 整列搬迁，不拆列
        need[m.id] -= c.height;
        need[cand.id] += c.height;
        deficit -= c.height;
        c.material = cand.id;
        moved += c.height;
      }
      if (moved) parts.push(`${moved} 块改用${materialSpec(cand.id).name}`);
    }
    if (parts.length)
      notes.push(`${materialSpec(m.id).name}不足：${parts.join("，")}（近似色）`);
  }
}

/**
 * 库存适配：先近似替代，再整体压缩高度。
 * 压缩时每列至少保留 1 格，主体轮廓不会缺块。
 */
function fitToStock(
  columns: ReliefColumn[],
  inventory: Record<MaterialId, number>,
  params: ReliefParams,
  notes: string[],
): number {
  const have = { ...inventory };
  if (params.substitute) substituteShort(columns, have, notes);
  let compression = 1;
  const full = columns.reduce((a, c) => a + c.height, 0);
  const avail = materials.reduce((a, m) => a + have[m.id], 0);
  if (params.fitStock && full > avail) {
    const f = avail / full;
    for (const c of columns) c.height = Math.max(1, Math.floor(c.height * f));
    let cur = columns.reduce((a, c) => a + c.height, 0);
    while (cur > avail) {
      const tallest = columns.reduce<ReliefColumn | null>(
        (max, c) => (c.height > 1 && c.height > (max?.height ?? 1) ? c : max),
        null,
      );
      if (!tallest) break;
      tallest.height--;
      cur--;
    }
    compression = full ? cur / full : 1;
    notes.push(
      `库存有限：高度压缩至 ${Math.round(compression * 100)}%，主体轮廓完整保留`,
    );
    if (cur > avail)
      notes.push("库存仍不足以放下完整轮廓，请缩小宽度或降低层次");
  }
  if (params.substitute) substituteShort(columns, have, notes);
  return compression;
}

/**
 * 由采样网格生成放置方案：定位、定高、配色、库存适配与冲突检查。
 * 纯函数，预览与确认共用；确认时用最新的世界状态重新调用即可。
 */
export function buildPlan(
  doc: WorldDocument,
  grid: SampleGrid,
  params: ReliefParams,
  anchor: Vec3,
): ReliefPlan {
  const columns: ReliefColumn[] = [];
  let holes = 0;
  for (let idx = 0; idx < grid.cells.length; idx++) {
    const cell = grid.cells[idx];
    const dx = idx % grid.width;
    const dz = Math.floor(idx / grid.width);
    if (!cell) {
      holes++;
      continue;
    }
    const x = anchor.x + dx;
    const z = anchor.z + dz;
    const base =
      params.baseMode === "ground" ? surfaceTop(doc, x, z) + 1 : params.baseY;
    const material = nearestMaterial(cell.r, cell.g, cell.b);
    columns.push({
      dx,
      dz,
      x,
      z,
      base,
      height: cell.height,
      fullHeight: cell.height,
      material,
      ideal: material,
      r: cell.r,
      g: cell.g,
      b: cell.b,
    });
  }
  const notes: string[] = [];
  if (holes) notes.push(`已保留 ${holes} 处透明空洞`);
  const compression = fitToStock(columns, doc.inventory, params, notes);
  const cells: Block[] = [];
  const conflicts: Vec3[] = [];
  for (const c of columns)
    for (let k = 0; k < c.height; k++) {
      const p = { x: c.x, y: c.base + k, z: c.z };
      if (!inside(p) || doc.blocks[key(p)] || overlapsPlayer(p, doc.player))
        conflicts.push(p);
      else cells.push({ ...p, material: c.material });
    }
  const budget = zeroBudget();
  for (const c of columns) budget[c.material] += c.height;
  const shortage: Partial<Record<MaterialId, number>> = {};
  let fits = true;
  for (const m of materials) {
    const lack = budget[m.id] - doc.inventory[m.id];
    if (lack > 0) {
      shortage[m.id] = lack;
      fits = false;
    }
  }
  if (conflicts.length)
    notes.push(`${conflicts.length} 个位置被占用、越界或压住角色`);
  return {
    columns,
    cells,
    budget,
    total: columns.reduce((a, c) => a + c.height, 0),
    holes,
    conflicts,
    shortage,
    fits,
    compression,
    notes,
  };
}
