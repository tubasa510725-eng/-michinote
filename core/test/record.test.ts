import { describe, expect, it } from 'vitest';
import { cleanTrack, detectStops, rideStats } from '../src/index.js';
import { fakeTrack } from './helpers.js';

describe('record', () => {
  it('精度の悪い点と GPS の飛びを捨てる', () => {
    const tr = fakeTrack(['home', 'A', 'B']);
    const noisy = [...tr];
    noisy.splice(10, 0, { lat: 36, lng: 141, t: tr[9].t + 500 }); // 飛び
    noisy.splice(20, 0, { ...tr[19], t: tr[19].t + 100, acc: 300 }); // 低精度
    const cleaned = cleanTrack(noisy);
    expect(cleaned.some((p) => p.lat === 36)).toBe(false);
    expect(cleaned.some((p) => p.acc === 300)).toBe(false);
  });
  it('距離と平均速度を計算する', () => {
    const s = rideStats(fakeTrack(['home', 'A', 'B'], 0, 40));
    expect(s.distanceM).toBeGreaterThan(1000);
    expect(s.avgMovingKmh).toBeGreaterThan(38);
    expect(s.avgMovingKmh).toBeLessThan(42);
  });
  it('10 分とどまった場所を立ち寄り候補として見つける', () => {
    const a = fakeTrack(['home', 'A'], 0);
    const last = a.at(-1)!;
    const stay = Array.from({ length: 20 }, (_, i) => ({ ...last, lat: last.lat + (i % 2) * 0.00005, t: last.t + (i + 1) * 30_000 }));
    const b = fakeTrack(['A', 'B'], stay.at(-1)!.t + 1000);
    const stops = detectStops([...a, ...stay, ...b]);
    expect(stops).toHaveLength(1);
    expect(stops[0].endT - stops[0].startT).toBeGreaterThanOrEqual(5 * 60_000);
  });
});
