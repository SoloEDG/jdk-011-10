<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Check, Crop, ImagePlus, Layers, MapPin, X } from "lucide-vue-next";
import type { Workspace } from "../../../shared/document";
import { materials } from "../../../shared/materials";
import {
  cancelRelief,
  confirmRelief,
  getReliefSource,
  importImage,
  relocateRelief,
  updateParams,
} from "../model/relief";

const props = defineProps<{ state: Workspace }>();
const session = computed(() => props.state.relief);
const fileInput = ref<HTMLInputElement>();
const cropBox = ref<HTMLCanvasElement>();

function choose(e: Event) {
  const el = e.target as HTMLInputElement;
  const f = el.files?.[0];
  if (f) importImage(props.state, f);
  el.value = "";
}

/* ---------- 裁切框 ---------- */
let dragStart: { x: number; y: number } | null = null;
const pos = (e: PointerEvent) => {
  const r = cropBox.value!.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width,
    y: (e.clientY - r.top) / r.height,
  };
};
function down(e: PointerEvent) {
  if (!session.value) return;
  dragStart = pos(e);
  cropBox.value!.setPointerCapture(e.pointerId);
}
function move(e: PointerEvent) {
  if (!dragStart || !session.value) return;
  const p = pos(e);
  session.value.params.crop = {
    x: Math.min(dragStart.x, p.x),
    y: Math.min(dragStart.y, p.y),
    w: Math.abs(dragStart.x - p.x),
    h: Math.abs(dragStart.y - p.y),
  };
  drawCrop();
}
function up() {
  if (!dragStart || !session.value) return;
  dragStart = null;
  const c = session.value.params.crop;
  if (c.w < 0.05 || c.h < 0.05)
    session.value.params.crop = { x: 0, y: 0, w: 1, h: 1 };
  drawCrop();
  updateParams(props.state);
}
function resetCrop() {
  if (!session.value) return;
  session.value.params.crop = { x: 0, y: 0, w: 1, h: 1 };
  drawCrop();
  updateParams(props.state);
}
function drawCrop() {
  const cv = cropBox.value;
  const src = getReliefSource();
  const s = session.value;
  if (!cv || !src || !s) return;
  const w = cv.clientWidth || 240;
  const h = Math.max(40, Math.round((w * src.height) / src.width));
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(src, 0, 0, w, h);
  const c = s.params.crop;
  ctx.fillStyle = "rgba(34,44,34,.45)";
  ctx.fillRect(0, 0, w, c.y * h);
  ctx.fillRect(0, (c.y + c.h) * h, w, h - (c.y + c.h) * h);
  ctx.fillRect(0, c.y * h, c.x * w, c.h * h);
  ctx.fillRect((c.x + c.w) * w, c.y * h, w - (c.x + c.w) * w, c.h * h);
  ctx.strokeStyle = "#e9b261";
  ctx.lineWidth = 2;
  ctx.strokeRect(c.x * w + 1, c.y * h + 1, Math.max(2, c.w * w - 2), Math.max(2, c.h * h - 2));
}
watch(
  () => [session.value, session.value?.params.crop],
  () => nextTick(drawCrop),
  { deep: true },
);

/* ---------- 预算与状态 ---------- */
const budget = computed(() => {
  const p = session.value?.plan;
  if (!p) return [];
  return materials
    .filter((m) => p.budget[m.id] > 0)
    .map((m) => ({
      ...m,
      need: p.budget[m.id],
      have: props.state.doc.inventory[m.id],
    }))
    .sort((a, b) => b.need - a.need);
});
const notes = computed(() => {
  const s = session.value;
  if (!s) return [];
  return [...s.notes, ...(s.plan?.notes ?? [])];
});
const blocker = computed(() => {
  const s = session.value;
  if (!s) return "";
  if (s.stage === "error") return s.error ?? "出错了";
  if (s.stage === "loading") return "正在计算预览…";
  if (!s.plan) return s.placing ? "请在场景中点击选择落点" : "正在计算预览…";
  if (!s.plan.columns.length) return "画面内容为空";
  if (s.plan.conflicts.length)
    return `待调整：${s.plan.conflicts.length} 个位置冲突`;
  if (!s.plan.fits) return "待调整：库存不足";
  return "";
});
</script>

<template>
  <section class="panel relief">
    <div class="section-title">
      <h2>图片浮雕</h2>
      <Layers :size="17" />
    </div>
    <template v-if="session">
      <div class="relief-file">
        <b>{{ session.fileName }}</b>
        <span>{{ session.sourceWidth }}×{{ session.sourceHeight }}</span>
      </div>
      <canvas
        ref="cropBox"
        class="crop"
        title="拖动框选要转换的画面区域"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up"
      ></canvas>
      <div class="row mini-actions">
        <button class="text-btn" @click="resetCrop">
          <Crop :size="12" /> 重置裁切
        </button>
        <button class="text-btn" @click="relocateRelief(state)">
          <MapPin :size="12" />
          {{ session.anchor ? `落点 ${session.anchor.x}, ${session.anchor.z}` : "选择落点" }}
        </button>
      </div>
      <label class="slider-row">
        宽度
        <input
          type="range"
          min="4"
          max="32"
          v-model.number="session.params.width"
          @input="updateParams(state)"
        />
        <b>{{ session.params.width }}</b>
      </label>
      <label class="slider-row">
        层次
        <input
          type="range"
          min="1"
          max="16"
          v-model.number="session.params.maxHeight"
          @input="updateParams(state)"
        />
        <b>{{ session.params.maxHeight }}</b>
      </label>
      <div class="check-row">
        <label>
          <input
            type="checkbox"
            v-model="session.params.invert"
            @change="updateParams(state)"
          />
          暗部凸起
        </label>
        <label>
          <input
            type="checkbox"
            v-model="session.params.fitStock"
            @change="updateParams(state)"
          />
          不足时精简
        </label>
        <label>
          <input
            type="checkbox"
            v-model="session.params.substitute"
            @change="updateParams(state)"
          />
          近似色替代
        </label>
      </div>
      <div class="base-row">
        <label>
          <input
            type="radio"
            value="ground"
            v-model="session.params.baseMode"
            @change="updateParams(state)"
          />
          贴合地面
        </label>
        <label>
          <input
            type="radio"
            value="flat"
            v-model="session.params.baseMode"
            @change="updateParams(state)"
          />
          水平基准
        </label>
        <span v-if="session.params.baseMode === 'flat'" class="stepper">
          <button
            @click="
              session.params.baseY = Math.max(0, session.params.baseY - 1);
              updateParams(state);
            "
          >
            −
          </button>
          <b>{{ session.params.baseY }}</b>
          <button
            @click="
              session.params.baseY = Math.min(19, session.params.baseY + 1);
              updateParams(state);
            "
          >
            ＋
          </button>
        </span>
      </div>
      <div v-if="session.stage === 'loading'" class="progress-row">
        <div class="progress">
          <i :style="{ width: Math.round(session.progress * 100) + '%' }"></i>
        </div>
        <button class="text-btn" @click="cancelRelief(state)">取消</button>
      </div>
      <div v-if="session.plan" class="budget">
        <div
          v-for="row in budget"
          :key="row.id"
          class="budget-row"
          :class="{ short: row.need > row.have }"
        >
          <i class="cube" :style="{ '--cube': row.color }"></i>
          <span>{{ row.name }}</span>
          <b>{{ row.need }} / {{ row.have }}</b>
        </div>
        <div class="budget-row total">
          <span>共 {{ session.plan.total }} 方块</span>
          <b v-if="session.plan.holes">空洞 {{ session.plan.holes }}</b>
        </div>
      </div>
      <ul v-if="notes.length" class="note-list">
        <li v-for="(n, i) in notes" :key="i">{{ n }}</li>
      </ul>
      <div v-if="session.plan?.conflicts.length" class="warn-box">
        {{ session.plan.conflicts.length }}
        个位置被占用、越界或压住角色（红色标示），调整落点或基准后可继续
      </div>
      <div class="row confirm-row">
        <button class="primary" :disabled="!!blocker" @click="confirmRelief(state)">
          <Check :size="14" /> {{ blocker || "确认落成" }}
        </button>
        <button class="soft danger" title="放弃预览" @click="cancelRelief(state)">
          <X :size="14" />
        </button>
      </div>
    </template>
    <div v-else class="selection-empty">
      <div class="dashed-cube">▦</div>
      <p>把截图变成立体浮雕</p>
      <small>
        按亮度生成高度，用现有材质近似颜色
        <br />
        透明背景会保留为空洞
      </small>
      <button class="soft full" @click="fileInput?.click()">
        导入图片 <ImagePlus :size="13" />
      </button>
    </div>
    <input ref="fileInput" type="file" accept="image/*" hidden @change="choose" />
  </section>
</template>
