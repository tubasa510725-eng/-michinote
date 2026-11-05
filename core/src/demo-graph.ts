import { lengthM } from './geo.js';
import type { LatLng, PoiKind, RoadEdge, RoadGraph, RoadTags, RoadType } from './types.js';

/**
 * 開発・テスト用の架空の地域（試作品 prototype/index.html と同じ道路網）。
 * 実データに置き換えるまで、画面づくりやロジックの確認に使う。
 * 座標は房総半島あたりの海上・陸上に適当に置いたもので、実在の道とは関係ない。
 */
const px = (x: number, y: number): LatLng => ({ lat: 35.3 - y * 0.0011, lng: 139.9 + x * 0.0013 });

const NODES: Record<string, [number, number, string, PoiKind[]?]> = {
  home: [90, 400, '自宅'], A: [150, 380, '駅前'], B: [210, 410, '川沿いの町'], C: [280, 452, '港町', ['cafe']],
  D: [336, 382, '岬の展望台', ['viewpoint', 'cafe']], E: [312, 302, '海の駅', ['michi_no_eki', 'cafe']], F: [306, 228, '灯台', ['viewpoint']],
  G: [272, 150, '白浜', ['parking']], H: [248, 72, '北の漁港'], I: [228, 252, '茶屋の峠', ['viewpoint']], J: [178, 302, '里山'],
  K: [118, 318, '棚田', ['shrine']], L: [48, 300, '西の谷'], M: [72, 178, '湖畔', ['viewpoint']], N: [156, 158, '湖の東', ['cafe']],
  O: [204, 128, '高原牧場', ['parking']], P: [128, 88, '山頂ゲート'], Q: [52, 96, '源流の村', ['onsen']], R: [168, 470, '南IC'],
};

type T = 'nat' | 'cty' | 'coast' | 'mtn' | 'narrow' | 'hwy' | 'lake';
const MAP: Record<T, [RoadType, RoadTags]> = {
  nat: ['primary', {}], cty: ['secondary', {}], coast: ['secondary', { coastal: true }], mtn: ['tertiary', { mountain: true }],
  narrow: ['narrow_mountain', { mountain: true, narrow: true }], hwy: ['motorway', {}], lake: ['tertiary', { lakeside: true }],
};
const EDGES: Array<[string, string, T, string, number]> = [
  ['home','A','nat','国道12号',6],['A','B','nat','国道12号',-5],['B','C','nat','国道12号',6],
  ['C','D','coast','岬ライン',10],['D','E','coast','潮風ライン',-8],['E','F','coast','潮風ライン',6],
  ['F','G','coast','白浜シーサイド',-8],['G','H','coast','北浜街道',6],['B','E','cty','県道30号',-10],
  ['A','J','cty','県道8号',8],['J','I','mtn','茶屋峠道',-12],['I','F','mtn','灯台坂',8],['I','E','cty','県道31号',10],
  ['J','K','cty','里山みち',-6],['K','home','cty','棚田農道',6],['K','L','narrow','谷の細道',-8],['L','home','cty','県道5号',10],
  ['L','M','mtn','西湖道',-14],['M','N','lake','湖畔ロード',14],['N','J','cty','県道8号',-10],['N','O','mtn','高原ライン',-8],
  ['O','I','mtn','牧場坂',12],['O','G','cty','白浜みち',-8],['O','H','narrow','北尾根林道',10],['N','P','mtn','山頂道路',8],
  ['P','Q','narrow','源流林道',-10],['Q','M','cty','湖西道',-8],['P','O','mtn','雲上スカイライン',-10],['P','H','mtn','尾根スカイライン',-12],
  ['home','R','hwy','南海道(高速)',8],['R','C','hwy','南海道(高速)',10],['R','B','cty','県道2号',-6],
];

function curve(a: [number, number], b: [number, number], bend: number): LatLng[] {
  const [ax, ay] = a, [bx, by] = b, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  const cx = (ax + bx) / 2 - (dy / len) * bend, cy = (ay + by) / 2 + (dx / len) * bend;
  const pts: LatLng[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, u = 1 - t;
    pts.push(px(u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by));
  }
  return pts;
}

export const demoGraph: RoadGraph = {
  nodes: Object.fromEntries(Object.entries(NODES).map(([id, [x, y, name, poi]]) => [id, { id, name, poi, ...px(x, y) }])),
  edges: EDGES.map(([a, b, t, name, bend]): RoadEdge => {
    const geometry = curve([NODES[a][0], NODES[a][1]], [NODES[b][0], NODES[b][1]], bend);
    const [type, tags] = MAP[t];
    return { id: `${a}-${b}`, from: a, to: b, name, type, tags: { ...tags }, geometry, lengthM: Math.round(lengthM(geometry)) };
  }),
};

export const demoHome = demoGraph.nodes.home;
