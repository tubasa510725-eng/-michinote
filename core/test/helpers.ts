import { demoGraph, indexGraph, nodePathLine, sampleAlong, type TrackPoint } from '../src/index.js';

export const idx = indexGraph(demoGraph);

/** ノードの列から、時速 kmh で走ったような GPS 軌跡を作る */
export function fakeTrack(nodes: string[], startT = Date.UTC(2026, 4, 18, 0, 0), kmh = 40, stepM = 15): TrackPoint[] {
  const pts = sampleAlong(nodePathLine(idx, nodes), stepM);
  const dt = (stepM / (kmh / 3.6)) * 1000;
  return pts.map((p, i) => ({ ...p, t: startT + Math.round(i * dt), acc: 8 }));
}
