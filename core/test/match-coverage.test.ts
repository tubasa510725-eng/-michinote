import { describe, expect, it } from 'vitest';
import { coverage, firstTimeEdges, growthTimeline, matchEdges, traveledEdges } from '../src/index.js';
import { fakeTrack, idx } from './helpers.js';

describe('matchEdges', () => {
  it('走った区間だけを返す', () => {
    const got = matchEdges(idx, fakeTrack(['home', 'A', 'B', 'C', 'D']));
    expect(got.sort()).toEqual(['A-B', 'B-C', 'C-D', 'home-A'].sort());
  });
  it('ノイズが乗っても判定できる', () => {
    const noisy = fakeTrack(['home', 'K', 'J']).map((p, i) => ({ ...p, lat: p.lat + ((i % 3) - 1) * 0.00008 }));
    expect(matchEdges(idx, noisy).sort()).toEqual(['J-K', 'K-home'].sort());
  });
});

describe('coverage', () => {
  const rides = [
    { id: 'r2', startedAt: 2, edgeIds: ['home-A', 'A-J'] },
    { id: 'r1', startedAt: 1, edgeIds: ['home-A', 'A-B'] },
  ];
  it('初めて走った区間は前の走行だけと比べる', () => {
    expect(firstTimeEdges(rides[0], rides)).toEqual(['A-J']);
    expect(firstTimeEdges(rides[1], rides)).toEqual(['home-A', 'A-B']);
  });
  it('開拓率は 0〜1', () => {
    const c = coverage(idx, traveledEdges(rides));
    expect(c.ratio).toBeGreaterThan(0);
    expect(c.ratio).toBeLessThan(1);
  });
  it('育つ様子は古い順に累積する', () => {
    const g = growthTimeline(idx, rides);
    expect(g.map((s) => s.rideId)).toEqual(['r1', 'r2']);
    expect(g[1].newEdgeIds).toEqual(['A-J']);
    expect(g[1].cumulativeM).toBeGreaterThan(g[0].cumulativeM);
  });
});
