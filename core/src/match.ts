import { distanceM, sampleAlong } from './geo.js';
import { edgeLine, type GraphIndex } from './graph.js';
import type { LatLng } from './types.js';

export interface MatchOptions {
  /** 道からこの距離以内の GPS 点を「その道を走った」とみなす（m）。既定 30 */
  toleranceM?: number;
  /** 区間の何割以上をカバーしたら「走った」とするか。既定 0.6 */
  minCoverage?: number;
  /** 区間上のサンプリング間隔（m）。既定 20 */
  stepM?: number;
}

/**
 * 走行軌跡から「走った区間」を判定する簡易マップマッチング。
 *
 * 区間を一定間隔でサンプリングし、その何割の近くを軌跡が通ったかで判定する。
 * 並行する道や立体交差では誤判定することがあるので、本番では
 * Valhalla / OSRM / Mapbox などのマップマッチング API に置き換えることを想定している。
 * その場合も戻り値（区間 ID の配列）の形は変えないこと。
 */
export function matchEdges(idx: GraphIndex, track: LatLng[], opts: MatchOptions = {}): string[] {
  const tol = opts.toleranceM ?? 30;
  const minCov = opts.minCoverage ?? 0.6;
  const step = opts.stepM ?? 20;
  if (track.length === 0) return [];

  // 軌跡の点を約 tol 四方のマス目に入れて、近傍検索を速くする
  const cellDeg = tol / 111_000;
  const grid = new Map<string, LatLng[]>();
  const key = (p: LatLng) => `${Math.floor(p.lat / cellDeg)}:${Math.floor(p.lng / cellDeg)}`;
  for (const p of sampleAlong(track, Math.max(5, tol / 2))) {
    const k = key(p);
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(p);
  }
  const near = (p: LatLng) => {
    const ci = Math.floor(p.lat / cellDeg);
    // 経度方向は緯度に応じてマスが細くなるので、確認するマス数を増やす
    const cj = Math.floor(p.lng / cellDeg);
    const span = Math.ceil(1 / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)));
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - span; j <= cj + span; j++) {
        const arr = grid.get(`${i}:${j}`);
        if (arr && arr.some((q) => distanceM(p, q) <= tol)) return true;
      }
    return false;
  };

  const hit: string[] = [];
  for (const e of idx.graph.edges) {
    const samples = sampleAlong(edgeLine(idx.graph, e), step);
    let c = 0;
    for (const s of samples) if (near(s)) c++;
    if (samples.length && c / samples.length >= minCov) hit.push(e.id);
  }
  return hit;
}
