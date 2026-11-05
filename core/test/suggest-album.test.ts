import { describe, expect, it } from 'vitest';
import { buildTimeline, formatReasonJa, indexGraph, placePhotos, suggestRoutes } from '../src/index.js';
import { fakeTrack, idx } from './helpers.js';

const traveled = new Set(['home-A', 'A-B', 'B-C', 'C-D', 'D-E', 'B-E', 'L-home', 'L-M', 'M-N', 'N-J', 'A-J']);

describe('suggestRoutes', () => {
  it('自宅を出て自宅に戻る、時間内のルートを返す', () => {
    const cands = suggestRoutes(idx, { start: 'home', availableMinutes: 180, traveled, mood: 'sea' });
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.nodes[0]).toBe('home');
      expect(c.nodes.at(-1)).toBe('home');
      expect(c.totalMinutes).toBeLessThanOrEqual(180 + 1e-6);
      expect(new Set(c.edgeIds).size).toBe(c.edgeIds.length);
    }
  });
  it('未走行の道を含むルートを優先し、理由を説明できる', () => {
    const [best] = suggestRoutes(idx, { start: 'home', availableMinutes: 180, traveled });
    expect(best.newM).toBeGreaterThan(0);
    expect(best.reasons[0].kind).toBe('new_road');
    expect(formatReasonJa(best.reasons[0])).toMatch(/まだ走っていない/);
  });
  it('避けたい道は使わない', () => {
    const cands = suggestRoutes(idx, { start: 'home', availableMinutes: 300, traveled, avoid: ['narrow', 'motorway'], limit: 5 });
    const bad = cands.flatMap((c) => c.edgeIds).filter((id) => { const e = idx.edgeById.get(id)!; return e.type === 'narrow_mountain' || e.type === 'motorway'; });
    expect(bad).toEqual([]);
  });
  it('二輪通行止めの道は条件に関係なく使わない', () => {
    const g = structuredClone(idx.graph);
    g.edges.find((e) => e.id === 'K-home')!.tags!.motorcycleBanned = true;
    const cands = suggestRoutes(indexGraph(g), { start: 'home', availableMinutes: 300, traveled, limit: 5 });
    expect(cands.flatMap((c) => c.edgeIds)).not.toContain('K-home');
  });
  it('行きたい道を含むルートが上位に来る', () => {
    const wish = new Set(['N-O', 'O-G']);
    const [best] = suggestRoutes(idx, { start: 'home', availableMinutes: 300, traveled, wish });
    expect(best.wishM).toBeGreaterThan(0);
    expect(best.reasons.some((r) => r.kind === 'wish')).toBe(true);
  });
  it('時間が足りなければ空配列', () => {
    expect(suggestRoutes(idx, { start: 'home', availableMinutes: 5, traveled })).toEqual([]);
  });
});

describe('album', () => {
  const track = fakeTrack(['home', 'A', 'B', 'C'], 1_000_000);
  it('撮影時刻からルート上に写真を置き、置けないものは分ける', () => {
    const mid = track[Math.floor(track.length / 2)];
    const { placed, unplaced } = placePhotos([
      { id: 'a', takenAt: mid.t, url: 'a.jpg' },
      { id: 'b', takenAt: 0, url: 'b.jpg' },
      { id: 'c', lat: track[3].lat, lng: track[3].lng, url: 'c.jpg' },
    ], track);
    expect(placed.map((p) => p.photo.id).sort()).toEqual(['a', 'c']);
    expect(placed.find((p) => p.photo.id === 'a')!.source).toBe('time_interpolated');
    expect(unplaced.map((p) => p.id)).toEqual(['b']);
  });
  it('立ち寄りスポットの近くの写真はスポットにまとまる', () => {
    const p = track[40];
    const { placed } = placePhotos([{ id: 'x', takenAt: p.t, url: 'x.jpg' }], track);
    const tl = buildTimeline(placed, [{ id: 's', lat: p.lat, lng: p.lng, t: p.t, title: '休憩', photoIds: [] }]);
    expect(tl).toHaveLength(1);
    expect(tl[0].photos.map((x) => x.id)).toEqual(['x']);
  });
});
