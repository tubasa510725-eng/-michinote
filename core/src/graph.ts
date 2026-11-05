import type { LatLng, RoadEdge, RoadGraph } from './types.js';

/** 区間の形状を from→to の向きで返す（geometry が無ければ両端の直線） */
export function edgeLine(g: RoadGraph, e: RoadEdge): LatLng[] {
  if (e.geometry && e.geometry.length >= 2) return e.geometry;
  const a = g.nodes[e.from];
  const b = g.nodes[e.to];
  return [
    { lat: a.lat, lng: a.lng },
    { lat: b.lat, lng: b.lng },
  ];
}

/** 区間を指定ノードから出発する向きで返す */
export function edgeLineFrom(g: RoadGraph, e: RoadEdge, fromNode: string): LatLng[] {
  const line = edgeLine(g, e);
  return e.from === fromNode ? line : line.slice().reverse();
}

export interface GraphIndex {
  graph: RoadGraph;
  edgeById: Map<string, RoadEdge>;
  /** ノード ID → そのノードにつながる区間 */
  adjacency: Map<string, RoadEdge[]>;
}

/** 検索を速くするための索引を作る。グラフを読み込んだら 1 回だけ呼ぶ */
export function indexGraph(graph: RoadGraph): GraphIndex {
  const edgeById = new Map<string, RoadEdge>();
  const adjacency = new Map<string, RoadEdge[]>();
  for (const id of Object.keys(graph.nodes)) adjacency.set(id, []);
  for (const e of graph.edges) {
    if (!graph.nodes[e.from] || !graph.nodes[e.to]) {
      throw new Error(`区間 ${e.id} が存在しないノードを参照しています`);
    }
    edgeById.set(e.id, e);
    adjacency.get(e.from)!.push(e);
    adjacency.get(e.to)!.push(e);
  }
  return { graph, edgeById, adjacency };
}

/** 区間の反対側のノード */
export function otherEnd(e: RoadEdge, node: string): string {
  return e.from === node ? e.to : e.from;
}

/** 区間 ID の列を、たどったノードの列に変換する（つながっていなければ例外） */
export function edgesToNodePath(idx: GraphIndex, start: string, edgeIds: string[]): string[] {
  const path = [start];
  for (const id of edgeIds) {
    const e = idx.edgeById.get(id);
    if (!e) throw new Error(`不明な区間 ${id}`);
    const cur = path[path.length - 1];
    if (e.from !== cur && e.to !== cur) throw new Error(`区間 ${id} は ${cur} につながっていません`);
    path.push(otherEnd(e, cur));
  }
  return path;
}

/** ノードの列を 1 本の線にする（地図への描画用） */
export function nodePathLine(idx: GraphIndex, nodes: string[]): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const e = idx.adjacency.get(nodes[i - 1])!.find((x) => otherEnd(x, nodes[i - 1]) === nodes[i]);
    if (!e) throw new Error(`${nodes[i - 1]} と ${nodes[i]} を結ぶ区間がありません`);
    const seg = edgeLineFrom(idx.graph, e, nodes[i - 1]);
    out.push(...(out.length ? seg.slice(1) : seg));
  }
  return out;
}
