import { describe, expect, it } from 'vitest';
import { acceptInvite, buildInvite, demoHome, distanceM, inviteProgress, maskLine, type PrivacyZone } from '../src/index.js';
import { fakeTrack, idx } from './helpers.js';

const zones: PrivacyZone[] = [{ center: demoHome, radiusM: 1500 }];

describe('privacy', () => {
  it('隠す範囲の中の点は 1 つも残らない', () => {
    const lines = maskLine(fakeTrack(['home', 'A', 'B', 'A', 'home']), zones);
    const all = lines.flat();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((p) => distanceM(p, demoHome) > 1500)).toBe(true);
  });
  it('範囲を出入りすると線が分かれる', () => {
    // 自宅を通り抜けるルート：西の谷 → 自宅 → 駅前
    expect(maskLine(fakeTrack(['L', 'home', 'A']), zones, { trimEndsM: 0 }).length).toBe(2);
  });
});

describe('invite', () => {
  const ride = { title: '海沿い', track: fakeTrack(['home', 'A', 'B', 'C', 'D', 'E', 'B', 'A', 'home']),
    edgeIds: ['home-A', 'A-B', 'B-C', 'C-D', 'D-E', 'B-E'],
    spots: [{ id: 's1', lat: demoHome.lat, lng: demoHome.lng, t: 0, title: '自宅前', photoIds: [] },
            { id: 's2', ...idx.graph.nodes.D, t: 0, title: '岬', photoIds: ['p1'] }] };
  it('自宅周辺の区間・スポットを含まず、生の時刻も含まない', () => {
    const inv = buildInvite(idx, { ride, message: '  走ってみて！ ', zones });
    expect(inv.edgeIds).not.toContain('home-A');
    expect(inv.spots.map((s) => s.title)).toEqual(['岬']);
    expect(inv.message).toBe('走ってみて！');
    expect(JSON.stringify(inv)).not.toMatch(/"t":/);
  });
  it('区間を選んで招待状にできる', () => {
    const inv = buildInvite(idx, { ride, message: 'ここ', edgeIds: ['C-D', 'D-E'], zones });
    expect(inv.edgeIds).toEqual(['C-D', 'D-E']);
    expect(inv.lengthM).toBeGreaterThan(1000);
  });
  it('受け取ると未走行の区間だけが行きたい道になり、走ると完了になる', () => {
    const wish = acceptInvite({ edgeIds: ['N-O', 'O-G', 'A-B'] }, new Set(), new Set(['A-B']));
    expect([...wish].sort()).toEqual(['N-O', 'O-G']);
    expect(inviteProgress({ edgeIds: ['N-O', 'O-G'] }, new Set(['N-O', 'O-G'])).completed).toBe(true);
  });
});
