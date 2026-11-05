import { distanceM, lengthM, sampleAlong } from './geo.js';
import { edgeLine, type GraphIndex } from './graph.js';
import type { LatLng, PrivacyZone } from './types.js';

export const insideAny = (p: LatLng, zones: PrivacyZone[]) => zones.some((z) => distanceM(p, z.center) <= z.radiusM);

export interface MaskOptions {
  /**
   * 線の始点と終点をさらにこの距離だけ削る（m）。既定 200。
   * 隠す範囲の外から出発した場合でも、出発地・到着地をそのまま見せないための保険。
   */
  trimEndsM?: number;
  /** 判定の細かさ（m）。既定 10 */
  stepM?: number;
}

/**
 * 共有用に、隠す範囲の中を通る部分を取り除いた線を返す。
 * 範囲を出入りすると線が途切れるので、戻り値は線の配列になる。
 *
 * 他人に渡すデータ（招待状・公開アルバム・地図の重ね合わせ）は必ずこれを通すこと。
 * 隠す範囲の中心や半径そのものは、他人に渡すデータに含めない。
 */
export function maskLine(line: LatLng[], zones: PrivacyZone[], opts: MaskOptions = {}): LatLng[][] {
  const step = opts.stepM ?? 10;
  const trim = opts.trimEndsM ?? 200;
  const pts = sampleAlong(line, step);
  // 両端を削る
  let start = 0;
  let acc = 0;
  while (start < pts.length - 1 && acc < trim) acc += distanceM(pts[start], pts[++start]);
  let end = pts.length - 1;
  acc = 0;
  while (end > start && acc < trim) acc += distanceM(pts[end], pts[--end]);
  const out: LatLng[][] = [];
  let cur: LatLng[] = [];
  for (let i = start; i <= end; i++) {
    if (insideAny(pts[i], zones)) {
      if (cur.length >= 2) out.push(cur);
      cur = [];
    } else cur.push(pts[i]);
  }
  if (cur.length >= 2) out.push(cur);
  return out.filter((l) => lengthM(l) >= step);
}

/** 隠す範囲に一部でもかかる区間を除いた区間 ID */
export function maskEdges(idx: GraphIndex, edgeIds: string[], zones: PrivacyZone[]): string[] {
  return edgeIds.filter((id) => {
    const e = idx.edgeById.get(id);
    if (!e) return false;
    return !sampleAlong(edgeLine(idx.graph, e), 20).some((p) => insideAny(p, zones));
  });
}

/** 隠す範囲の中にある点（スポット・写真の位置など）を取り除く */
export function maskPoints<T extends LatLng>(points: T[], zones: PrivacyZone[]): T[] {
  return points.filter((p) => !insideAny(p, zones));
}
