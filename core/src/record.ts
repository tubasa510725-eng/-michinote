import { distanceM } from './geo.js';
import type { TrackPoint } from './types.js';

export interface CleanOptions {
  /** これより精度の悪い点は捨てる（m）。既定 50 */
  maxAccuracyM?: number;
  /** 前の点からこの速度を超える移動は GPS の飛びとみなして捨てる（km/h）。既定 250 */
  maxSpeedKmh?: number;
  /** 前の点からこの距離未満なら記録しない（m）。停車中の点の積み上がりを防ぐ。既定 3 */
  minStepM?: number;
}

/**
 * GPS の生データからノイズを取り除く。
 * 端末から届いた順（時刻順）に並んでいる前提。
 */
export function cleanTrack(points: TrackPoint[], opts: CleanOptions = {}): TrackPoint[] {
  const maxAcc = opts.maxAccuracyM ?? 50;
  const maxV = (opts.maxSpeedKmh ?? 250) / 3.6;
  const minStep = opts.minStepM ?? 3;
  const out: TrackPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.acc !== undefined && p.acc > maxAcc) continue;
    const prev = out[out.length - 1];
    if (prev) {
      if (p.t <= prev.t) continue;
      const d = distanceM(prev, p);
      if (d / ((p.t - prev.t) / 1000) > maxV) continue;
      if (d < minStep) continue;
    }
    out.push(p);
  }
  return out;
}

export interface RideStats {
  distanceM: number;
  /** 走っていた時間（停車を除く、ミリ秒） */
  movingMs: number;
  /** 記録開始から終了まで（ミリ秒） */
  elapsedMs: number;
  /** 平均速度（停車を除く、km/h） */
  avgMovingKmh: number;
  maxKmh: number;
}

/**
 * 走行の統計を計算する。
 * @param stopSpeedKmh この速度未満の区間は停車とみなす
 */
export function rideStats(track: TrackPoint[], stopSpeedKmh = 5): RideStats {
  let dist = 0;
  let moving = 0;
  let maxV = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    const d = distanceM(a, b);
    const dt = b.t - a.t;
    if (dt <= 0) continue;
    const v = (d / (dt / 1000)) * 3.6;
    dist += d;
    if (v >= stopSpeedKmh) moving += dt;
    maxV = Math.max(maxV, v);
  }
  const elapsed = track.length > 1 ? track[track.length - 1].t - track[0].t : 0;
  return {
    distanceM: dist,
    movingMs: moving,
    elapsedMs: elapsed,
    avgMovingKmh: moving > 0 ? dist / 1000 / (moving / 3_600_000) : 0,
    maxKmh: maxV,
  };
}

export interface Stop {
  lat: number;
  lng: number;
  startT: number;
  endT: number;
}

/**
 * 一定時間とどまった場所（休憩・立ち寄りの候補）を見つける。
 * 保存画面で「ここに立ち寄りましたか？」と提案するのに使う。
 */
export function detectStops(track: TrackPoint[], radiusM = 60, minMinutes = 5): Stop[] {
  const stops: Stop[] = [];
  let i = 0;
  while (i < track.length) {
    let j = i + 1;
    while (j < track.length && distanceM(track[i], track[j]) <= radiusM) j++;
    const last = track[j - 1];
    if (last.t - track[i].t >= minMinutes * 60_000) {
      const seg = track.slice(i, j);
      stops.push({
        lat: seg.reduce((s, p) => s + p.lat, 0) / seg.length,
        lng: seg.reduce((s, p) => s + p.lng, 0) / seg.length,
        startT: track[i].t,
        endT: last.t,
      });
      i = j;
    } else {
      i++;
    }
  }
  return stops;
}
