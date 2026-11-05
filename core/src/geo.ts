import type { LatLng, TrackPoint } from './types.js';

const R = 6371008.8; // 地球の平均半径（m）
const rad = (d: number) => (d * Math.PI) / 180;

/** 2 点間の距離（メートル、ハバーサイン公式） */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 線の長さ（メートル） */
export function lengthM(line: LatLng[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += distanceM(line[i - 1], line[i]);
  return s;
}

/**
 * 基準点まわりの平面座標（メートル）に変換する。
 * 数十 km 程度の範囲なら誤差は実用上問題ない。
 */
export function toLocal(p: LatLng, origin: LatLng): { x: number; y: number } {
  return {
    x: rad(p.lng - origin.lng) * R * Math.cos(rad(origin.lat)),
    y: rad(p.lat - origin.lat) * R,
  };
}

/** 点 p から線分 ab までの距離（メートル） */
export function pointToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const P = toLocal(p, a);
  const B = toLocal(b, a);
  const len2 = B.x * B.x + B.y * B.y;
  if (len2 === 0) return Math.hypot(P.x, P.y);
  const t = Math.max(0, Math.min(1, (P.x * B.x + P.y * B.y) / len2));
  return Math.hypot(P.x - t * B.x, P.y - t * B.y);
}

/**
 * ダグラス・ポーカー法で線を間引く。
 * 保存容量と描画負荷を下げるために、保存前・共有前に使う。
 * @param toleranceM この距離以内のズレは無視する（目安 5〜15m）
 */
export function simplify<T extends LatLng>(line: T[], toleranceM: number): T[] {
  if (line.length <= 2) return line.slice();
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, line.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointToSegmentM(line[i], line[s], line[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/** 線上を一定間隔で区切った点を返す（区間の判定・描画のサンプリング用） */
export function sampleAlong(line: LatLng[], stepM: number): LatLng[] {
  if (line.length === 0) return [];
  const out: LatLng[] = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const d = distanceM(a, b);
    let pos = stepM - carry;
    while (pos <= d) {
      const t = pos / d;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      pos += stepM;
    }
    carry = d - (pos - stepM);
  }
  const last = line[line.length - 1];
  const tail = out[out.length - 1];
  if (tail.lat !== last.lat || tail.lng !== last.lng) out.push(last);
  return out;
}

/**
 * 時刻 t における走行位置を、前後の GPS 点から線形補間して求める。
 * 走行時間の外側なら undefined を返す。
 */
export function positionAt(track: TrackPoint[], t: number): LatLng | undefined {
  if (track.length === 0 || t < track[0].t || t > track[track.length - 1].t) return undefined;
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = track[lo];
  const b = track[hi];
  if (b.t === a.t) return { lat: a.lat, lng: a.lng };
  const r = (t - a.t) / (b.t - a.t);
  return { lat: a.lat + (b.lat - a.lat) * r, lng: a.lng + (b.lng - a.lng) * r };
}

/** 範囲（南西・北東） */
export function bounds(points: LatLng[]): { sw: LatLng; ne: LatLng } | undefined {
  if (!points.length) return undefined;
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const p of points) {
    s = Math.min(s, p.lat); n = Math.max(n, p.lat);
    w = Math.min(w, p.lng); e = Math.max(e, p.lng);
  }
  return { sw: { lat: s, lng: w }, ne: { lat: n, lng: e } };
}
