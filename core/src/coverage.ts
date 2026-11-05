import type { GraphIndex } from './graph.js';
import type { Ride } from './types.js';

/** 走行を古い順に並べる */
export const sortRides = <T extends Pick<Ride, 'startedAt'>>(rides: T[]) =>
  rides.slice().sort((a, b) => a.startedAt - b.startedAt);

/** これまでに走った区間の集合 */
export function traveledEdges(rides: Pick<Ride, 'edgeIds'>[]): Set<string> {
  const s = new Set<string>();
  for (const r of rides) for (const id of r.edgeIds) s.add(id);
  return s;
}

/**
 * その走行で「初めて走った区間」。
 * 比較するのはその走行より前に始まった走行だけ。
 */
export function firstTimeEdges(ride: Pick<Ride, 'id' | 'startedAt' | 'edgeIds'>, all: Pick<Ride, 'id' | 'startedAt' | 'edgeIds'>[]): string[] {
  const before = traveledEdges(all.filter((r) => r.id !== ride.id && r.startedAt < ride.startedAt));
  return [...new Set(ride.edgeIds)].filter((id) => !before.has(id));
}

export interface Coverage {
  traveledM: number;
  totalM: number;
  /** 0〜1 */
  ratio: number;
}

/**
 * 開拓率。グラフ全体（＝読み込んでいる地域）のうち何割を走ったか。
 * 高速道路を分母に含めるかなどは好みが分かれるので filter で調整できるようにしてある。
 */
export function coverage(idx: GraphIndex, traveled: Set<string>, filter: (id: string) => boolean = () => true): Coverage {
  let total = 0;
  let done = 0;
  for (const e of idx.graph.edges) {
    if (!filter(e.id)) continue;
    total += e.lengthM;
    if (traveled.has(e.id)) done += e.lengthM;
  }
  return { traveledM: done, totalM: total, ratio: total ? done / total : 0 };
}

export interface GrowthStep {
  rideId: string;
  startedAt: number;
  newEdgeIds: string[];
  cumulativeM: number;
}

/** 「地図が育つ様子」の再生用データ（スライド1・6） */
export function growthTimeline(idx: GraphIndex, rides: Pick<Ride, 'id' | 'startedAt' | 'edgeIds'>[]): GrowthStep[] {
  const seen = new Set<string>();
  let cum = 0;
  return sortRides(rides).map((r) => {
    const fresh: string[] = [];
    for (const id of r.edgeIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      fresh.push(id);
      cum += idx.edgeById.get(id)?.lengthM ?? 0;
    }
    return { rideId: r.id, startedAt: r.startedAt, newEdgeIds: fresh, cumulativeM: cum };
  });
}
