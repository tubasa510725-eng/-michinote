import { describe, expect, it } from 'vitest';
import { distanceM, positionAt, sampleAlong, simplify } from '../src/index.js';

describe('geo', () => {
  it('東京駅〜大阪駅の距離がおよそ 400km', () => {
    const d = distanceM({ lat: 35.6812, lng: 139.7671 }, { lat: 34.7025, lng: 135.4959 });
    expect(d / 1000).toBeGreaterThan(395);
    expect(d / 1000).toBeLessThan(405);
  });
  it('一直線上の点は間引かれる', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ lat: 35 + i * 0.0001, lng: 139 }));
    expect(simplify(line, 1)).toHaveLength(2);
  });
  it('一定間隔でサンプリングし、終点を含む', () => {
    const line = [{ lat: 35, lng: 139 }, { lat: 35.01, lng: 139 }];
    const pts = sampleAlong(line, 100);
    expect(pts.length).toBeGreaterThanOrEqual(11);
    expect(pts.at(-1)).toEqual(line[1]);
  });
  it('時刻から位置を補間する', () => {
    const tr = [{ lat: 35, lng: 139, t: 0 }, { lat: 36, lng: 139, t: 1000 }];
    expect(positionAt(tr, 500)!.lat).toBeCloseTo(35.5);
    expect(positionAt(tr, 2000)).toBeUndefined();
  });
});
