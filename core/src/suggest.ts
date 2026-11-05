import { otherEnd, type GraphIndex } from './graph.js';
import type { PoiKind, RoadEdge, RoadType } from './types.js';

/** 道の種別ごとの想定平均速度（km/h）。所要時間の「目安」用で、法定速度ではない */
export const DEFAULT_SPEED_KMH: Record<RoadType, number> = {
  motorway: 75,
  trunk: 45,
  primary: 42,
  secondary: 38,
  tertiary: 33,
  unclassified: 28,
  residential: 22,
  narrow_mountain: 22,
};

export type Mood = 'sea' | 'mountain' | 'lake' | 'cafe' | 'any';
export type Avoid = 'narrow' | 'motorway';

export interface SuggestOptions {
  /** 出発地（＝帰着地）のノード ID */
  start: string;
  /** 空き時間（分）。休憩込み */
  availableMinutes: number;
  /** 空き時間のうち休憩に回す割合。既定 0.2 */
  restRatio?: number;
  mood?: Mood;
  avoid?: Avoid[];
  /** これまでに走った区間 */
  traveled: Set<string>;
  /** 招待状などで保存した「行きたい道」 */
  wish?: Set<string>;
  /** 返す候補数。既定 3 */
  limit?: number;
  speedKmh?: Partial<Record<RoadType, number>>;
  /** 探索の打ち切り回数。大きな地域で応答が遅くならないようにする。既定 200000 */
  maxSteps?: number;
}

/** 提案理由。UI 側で文章にする（formatReasonJa を参照） */
export type Reason =
  | { kind: 'new_road'; roadName: string; lengthM: number; after?: string }
  | { kind: 'mood'; mood: 'sea' | 'mountain' | 'lake'; lengthM: number }
  | { kind: 'wish'; lengthM: number }
  | { kind: 'familiar' };

export interface Candidate {
  /** たどるノードの列（start で始まり start で終わる） */
  nodes: string[];
  edgeIds: string[];
  lengthM: number;
  /** 走行のみの時間（分） */
  driveMinutes: number;
  /** 休憩込みの目安（分） */
  totalMinutes: number;
  newM: number;
  moodM: number;
  wishM: number;
  stops: Array<{ nodeId: string; name?: string; poi: PoiKind[] }>;
  reasons: Reason[];
  score: number;
}

const isNarrow = (e: RoadEdge) => e.type === 'narrow_mountain' || !!e.tags?.narrow;

function moodMatch(e: RoadEdge, mood: Mood): boolean {
  switch (mood) {
    case 'sea': return !!e.tags?.coastal;
    case 'mountain': return !!e.tags?.mountain || e.type === 'narrow_mountain';
    case 'lake': return !!e.tags?.lakeside;
    default: return false;
  }
}

/**
 * 出発地から出て戻ってくる周回ルートを探し、
 * 「まだ走っていない道」「気分に合う道」「行きたい道」を多く含むものを提案する（スライド2）。
 *
 * 同じ区間は 2 回通らず、同じノードも（出発地以外）2 回通らない単純な周回だけを探す。
 * 地域が広い場合は、出発地から半径数十 km のサブグラフに切り出してから渡すこと。
 */
export function suggestRoutes(idx: GraphIndex, o: SuggestOptions): Candidate[] {
  const restRatio = o.restRatio ?? 0.2;
  const budget = o.availableMinutes * (1 - restRatio);
  const mood = o.mood ?? 'any';
  const avoid = new Set(o.avoid ?? []);
  const wish = o.wish ?? new Set<string>();
  const speed = { ...DEFAULT_SPEED_KMH, ...o.speedKmh };
  const maxSteps = o.maxSteps ?? 200_000;
  if (!idx.adjacency.has(o.start)) throw new Error(`出発地 ${o.start} がグラフにありません`);

  const minutesOf = (e: RoadEdge) => (e.lengthM / 1000 / speed[e.type]) * 60;
  const allowed = (e: RoadEdge) =>
    !e.tags?.motorcycleBanned && !(avoid.has('narrow') && isNarrow(e)) && !(avoid.has('motorway') && e.type === 'motorway');

  const found: Array<{ nodes: string[]; edges: RoadEdge[]; minutes: number }> = [];
  let steps = 0;
  const nodes = [o.start];
  const edges: RoadEdge[] = [];
  const usedNodes = new Set([o.start]);

  const dfs = (cur: string, minutes: number) => {
    for (const e of idx.adjacency.get(cur)!) {
      if (++steps > maxSteps) return;
      if (!allowed(e) || edges.includes(e)) continue;
      const nt = minutes + minutesOf(e);
      if (nt > budget) continue;
      const nb = otherEnd(e, cur);
      if (nb === o.start) {
        if (edges.length >= 2) found.push({ nodes: [...nodes, nb], edges: [...edges, e], minutes: nt });
        continue;
      }
      if (usedNodes.has(nb)) continue;
      usedNodes.add(nb); nodes.push(nb); edges.push(e);
      dfs(nb, nt);
      usedNodes.delete(nb); nodes.pop(); edges.pop();
    }
  };
  dfs(o.start, 0);

  const scored: Candidate[] = found.map((f) => {
    let len = 0, newM = 0, moodM = 0, wishM = 0, motorwayM = 0;
    for (const e of f.edges) {
      len += e.lengthM;
      if (!o.traveled.has(e.id)) newM += e.lengthM;
      if (moodMatch(e, mood)) moodM += e.lengthM;
      if (wish.has(e.id)) wishM += e.lengthM;
      if (e.type === 'motorway') motorwayM += e.lengthM;
    }
    const stops = [...new Set(f.nodes)]
      .map((id) => ({ nodeId: id, name: idx.graph.nodes[id].name, poi: idx.graph.nodes[id].poi ?? [] }))
      .filter((s) => s.poi.length > 0);
    const cafeBonus = mood === 'cafe' ? stops.filter((s) => s.poi.includes('cafe')).length * 3000 : 0;
    const fill = f.minutes / budget;
    // 重みは試作で調整した初期値。実データで要チューニング（docs/02 参照）
    const score = newM * 2.5 + moodM * 3 + wishM * 5 - motorwayM * 2 + cafeBonus + (fill > 0.55 ? 8000 : 0);
    return {
      nodes: f.nodes,
      edgeIds: f.edges.map((e) => e.id),
      lengthM: len,
      driveMinutes: f.minutes,
      totalMinutes: f.minutes / (1 - restRatio),
      newM, moodM, wishM, stops, score,
      reasons: [],
    };
  });
  scored.sort((a, b) => b.score - a.score);

  // 似たルートばかりにならないよう、区間の重なりが大きいものは外す
  const picked: Candidate[] = [];
  for (const c of scored) {
    const s = new Set(c.edgeIds);
    const ok = picked.every((p) => p.edgeIds.filter((id) => s.has(id)).length / s.size < 0.55);
    if (ok) picked.push(c);
    if (picked.length >= (o.limit ?? 3)) break;
  }
  for (const c of picked) c.reasons = explain(idx, c, o.traveled, mood);
  return picked;
}

function explain(idx: GraphIndex, c: Candidate, traveled: Set<string>, mood: Mood): Reason[] {
  const edges = c.edgeIds.map((id) => idx.edgeById.get(id)!);
  const reasons: Reason[] = [];
  // 理由に挙げる道：未走行の道のうち、気分に合う道を優先し、高速道路は後回しにする
  const byName = new Map<string, { m: number; w: number }>();
  for (const e of edges) {
    if (traveled.has(e.id)) continue;
    const name = e.name ?? '名前のない道';
    const cur = byName.get(name) ?? { m: 0, w: 0 };
    const w = e.lengthM * (e.type === 'motorway' ? 0.3 : 1) * (moodMatch(e, mood) ? 1.5 : 1);
    byName.set(name, { m: cur.m + e.lengthM, w: cur.w + w });
  }
  const topEntry = [...byName.entries()].sort((a, b) => b[1].w - a[1].w)[0];
  const top = topEntry ? ([topEntry[0], topEntry[1].m] as const) : undefined;
  if (top) {
    const firstIdx = edges.findIndex((e) => (e.name ?? '名前のない道') === top[0] && !traveled.has(e.id));
    let after: string | undefined;
    for (let i = firstIdx - 1; i >= 0; i--) if (traveled.has(edges[i].id)) { after = edges[i].name; break; }
    reasons.push({ kind: 'new_road', roadName: top[0], lengthM: top[1], after });
  } else reasons.push({ kind: 'familiar' });
  if (c.wishM > 0) reasons.push({ kind: 'wish', lengthM: c.wishM });
  if (mood !== 'any' && mood !== 'cafe' && c.moodM > 0) reasons.push({ kind: 'mood', mood, lengthM: c.moodM });
  return reasons;
}

const km = (m: number) => `${(m / 1000).toFixed(1)}km`;

/** 提案理由を日本語の文にする */
export function formatReasonJa(r: Reason): string {
  switch (r.kind) {
    case 'new_road':
      return r.after
        ? `いつもの「${r.after}」の先に、まだ走っていない「${r.roadName}」が${km(r.lengthM)}あります。`
        : `まだ走っていない「${r.roadName}」を${km(r.lengthM)}走れます。`;
    case 'wish':
      return `招待状で届いた道を${km(r.lengthM)}通ります。`;
    case 'mood':
      return `${{ sea: '海沿いの区間', mountain: '峠道', lake: '湖畔の道' }[r.mood]}が${km(r.lengthM)}あります。`;
    case 'familiar':
      return '全区間が走ったことのある道です。慣れた道でゆっくり走れます。';
  }
}
