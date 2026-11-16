export type MaterialId =
  "grass" | "soil" | "stone" | "wood" | "sand" | "brick" | "glass" | "leaf";
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Block extends Vec3 {
  material: MaterialId;
}
export interface WorldDocument {
  version: 1;
  name: string;
  blocks: Record<string, Block>;
  inventory: Record<MaterialId, number>;
  player: Vec3;
  revision: number;
}
export interface Region {
  a: Vec3;
  b: Vec3;
}
export type Tool = "place" | "remove" | "select";
export interface ReliefCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ReliefParams {
  width: number;
  maxHeight: number;
  invert: boolean;
  crop: ReliefCrop;
  baseMode: "ground" | "flat";
  baseY: number;
  fitStock: boolean;
  substitute: boolean;
}
export interface ReliefColumn {
  dx: number;
  dz: number;
  x: number;
  z: number;
  base: number;
  height: number;
  fullHeight: number;
  material: MaterialId;
  ideal: MaterialId;
  r: number;
  g: number;
  b: number;
}
export interface ReliefPlan {
  columns: ReliefColumn[];
  cells: Block[];
  budget: Record<MaterialId, number>;
  total: number;
  holes: number;
  conflicts: Vec3[];
  shortage: Partial<Record<MaterialId, number>>;
  fits: boolean;
  compression: number;
  notes: string[];
}
export interface ReliefSession {
  fileName: string;
  sourceWidth: number;
  sourceHeight: number;
  stage: "loading" | "ready" | "error";
  placing: boolean;
  progress: number;
  error: string | null;
  anchor: Vec3 | null;
  params: ReliefParams;
  plan: ReliefPlan | null;
  planRevision: number;
  notes: string[];
}
export interface Workspace {
  doc: WorldDocument;
  material: MaterialId;
  tool: Tool;
  region: Region | null;
  anchor: Vec3 | null;
  relief: ReliefSession | null;
  message: string;
  dirty: boolean;
  mode: "build" | "walk";
  savedAt: string | null;
}
export const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
export const inside = (p: Vec3) =>
  p.x >= -16 && p.x < 16 && p.z >= -16 && p.z < 16 && p.y >= 0 && p.y < 20;
