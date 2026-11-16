import { key, type Vec3, type Workspace } from "../../../shared/document";
import { decodeImage, sampleGrid, type SampleGrid } from "../lib/pixels";
import { buildPlan, surfaceTop } from "../lib/plan";

let source: ImageData | null = null;
let sourceCanvas: HTMLCanvasElement | null = null;
let grid: SampleGrid | null = null;
let gridKey = "";
let jobSeq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** 源图的画布快照，供裁切框显示。 */
export function getReliefSource() {
  return sourceCanvas;
}

function clearCache() {
  source = null;
  sourceCanvas = null;
  grid = null;
  gridKey = "";
}

/** 世界被替换（载入/导入）时丢弃会话与缓存。 */
export function resetRelief(s: Workspace) {
  jobSeq++;
  clearTimeout(timer);
  clearCache();
  s.relief = null;
}

export async function importImage(s: Workspace, file: File) {
  const seq = ++jobSeq;
  clearTimeout(timer);
  clearCache();
  s.relief = {
    fileName: file.name,
    sourceWidth: 0,
    sourceHeight: 0,
    stage: "loading",
    placing: false,
    progress: 0.05,
    error: null,
    anchor: null,
    params: {
      width: 24,
      maxHeight: 8,
      invert: false,
      crop: { x: 0, y: 0, w: 1, h: 1 },
      baseMode: "ground",
      baseY: 2,
      fitStock: true,
      substitute: true,
    },
    plan: null,
    planRevision: 0,
    notes: [],
  };
  s.message = "正在读取图片…";
  try {
    source = await decodeImage(file);
  } catch {
    if (seq === jobSeq && s.relief) {
      s.relief.stage = "error";
      s.relief.error = "无法读取该图片，请换一张试试";
    }
    return;
  }
  if (seq !== jobSeq || !s.relief) return;
  sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = source.width;
  sourceCanvas.height = source.height;
  sourceCanvas.getContext("2d")!.putImageData(source, 0, 0);
  s.relief.sourceWidth = source.width;
  s.relief.sourceHeight = source.height;
  s.relief.placing = true;
  await rebuild(s, seq);
}

/** 参数变化后防抖重建预览。 */
export function updateParams(s: Workspace) {
  if (!s.relief) return;
  schedule(s);
}

/** 重新进入点选落点状态。 */
export function relocateRelief(s: Workspace) {
  if (!s.relief) return;
  s.relief.placing = true;
  s.message = "在场景中点击选择浮雕落点";
}

function schedule(s: Workspace) {
  clearTimeout(timer);
  const seq = ++jobSeq;
  timer = setTimeout(() => void rebuild(s, seq), 150);
}

async function rebuild(s: Workspace, seq: number) {
  const session = s.relief;
  if (!session || !source) return;
  session.stage = "loading";
  const k = JSON.stringify([
    session.params.crop,
    session.params.width,
    session.params.maxHeight,
    session.params.invert,
  ]);
  if (k !== gridKey || !grid) {
    const sampled = await sampleGrid(
      source,
      session.params,
      () => seq !== jobSeq,
      (p) => {
        if (s.relief === session) session.progress = 0.1 + p * 0.7;
      },
    );
    // 旧任务的结果不得覆盖更新的预览
    if (seq !== jobSeq || s.relief !== session) return;
    if (!sampled) return;
    grid = sampled.grid;
    gridKey = k;
    session.notes = sampled.clamped
      ? ["画面过高，纵向已压缩到 32 格以内"]
      : [];
  }
  session.stage = "ready";
  session.progress = 1;
  if (!session.anchor) {
    session.plan = null;
    session.planRevision++;
    session.placing = true;
    s.message = "在场景中点击选择浮雕落点";
    return;
  }
  session.plan = buildPlan(s.doc, grid, session.params, session.anchor);
  session.planRevision++;
  s.message = "预览已生成，确认前请检查遮挡与预算";
}

export function setReliefAnchor(s: Workspace, cell: Vec3) {
  const session = s.relief;
  if (!session) return;
  const x = Math.max(-16, Math.min(15, Math.floor(cell.x)));
  const z = Math.max(-16, Math.min(15, Math.floor(cell.z)));
  session.anchor = { x, y: 0, z };
  if (session.params.baseMode === "flat")
    session.params.baseY = surfaceTop(s.doc, x, z) + 1;
  session.placing = false;
  s.message = "落点已设置，正在生成预览…";
  schedule(s);
}

/**
 * 确认落成：用最新世界状态重算方案，重新检查遮挡、角色与库存。
 * 任何一项不满足都保留预览等待调整；通过则一次性全部落块，
 * 绝不会只落下一半浮雕。
 */
export function confirmRelief(s: Workspace) {
  const session = s.relief;
  if (!session || !grid || !session.anchor || session.stage === "loading")
    return;
  const plan = buildPlan(s.doc, grid, session.params, session.anchor);
  session.plan = plan;
  session.planRevision++;
  if (!plan.columns.length) {
    s.message = "画面内容为空，没有需要建造的方块";
    return;
  }
  if (plan.conflicts.length) {
    s.message = `有 ${plan.conflicts.length} 个位置被占用、越界或压住角色，预览已保留，请调整后再确认`;
    return;
  }
  if (!plan.fits) {
    s.message = "库存不足，预览已保留；可开启自动精简或缩小尺寸";
    return;
  }
  for (const b of plan.cells) {
    s.doc.blocks[key(b)] = b;
    s.doc.inventory[b.material]--;
  }
  s.doc.revision++;
  s.dirty = true;
  clearCache();
  s.relief = null;
  s.message = `浮雕已落成：${plan.cells.length} 个方块`;
}

/** 取消转换或放弃预览，场景保持原样。 */
export function cancelRelief(s: Workspace) {
  jobSeq++;
  clearTimeout(timer);
  clearCache();
  if (s.relief) {
    s.relief = null;
    s.message = "已取消图片浮雕，场景保持不变";
  }
}
