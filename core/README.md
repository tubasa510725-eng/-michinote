# @michinote/core

ミチノートの中核ロジックです。画面・地図ライブラリ・バックエンドに依存しないので、Webアプリ（PWA）でもスマホアプリ（React Native / Expo）でもそのまま使えます。

## できること

| ファイル | 内容 | 主な関数 |
|---|---|---|
| `types.ts` | データの形 | `Ride` `RoadGraph` `PrivacyZone` `InvitePayload` など |
| `geo.ts` | 距離・間引き・補間 | `distanceM` `simplify` `sampleAlong` `positionAt` |
| `graph.ts` | 道路ネットワークの索引 | `indexGraph` `nodePathLine` |
| `record.ts` | GPS記録の整形と統計 | `cleanTrack` `rideStats` `detectStops` |
| `match.ts` | 走った区間の判定（簡易版） | `matchEdges` |
| `coverage.ts` | 白地図・開拓率・育つ様子 | `traveledEdges` `firstTimeEdges` `coverage` `growthTimeline` |
| `privacy.ts` | 自宅周辺を隠す | `maskLine` `maskEdges` `maskPoints` |
| `suggest.ts` | 未走行ルート提案 | `suggestRoutes` `formatReasonJa` |
| `album.ts` | 写真の配置とタイムライン | `placePhotos` `buildTimeline` |
| `invite.ts` | 道の招待状 | `buildInvite` `acceptInvite` `inviteProgress` |
| `demo-graph.ts` | 試作品と同じ架空の道路網 | `demoGraph` `demoHome` |

## 使い方

```bash
npm install
npm test        # 自動テスト（25件）
npm run build   # dist/ に出力
```

### 走行を保存するときの流れ

```ts
import {
  indexGraph, cleanTrack, rideStats, detectStops, matchEdges, firstTimeEdges, simplify,
} from '@michinote/core';

const idx = indexGraph(roadGraph);            // 地域の道路データを読み込んだら1回だけ

const track = cleanTrack(rawGpsPoints);       // ノイズ除去
const stats = rideStats(track);               // 距離・走行時間・平均速度
const stopCandidates = detectStops(track);    // 「ここに立ち寄りましたか？」の候補
const edgeIds = matchEdges(idx, track);       // 走った区間
const isNew = firstTimeEdges({ id, startedAt, edgeIds }, previousRides); // 初めての道
const forDrawing = simplify(track, 10);       // 保存・描画用に間引く
```

### ルートを提案する

```ts
import { suggestRoutes, formatReasonJa, traveledEdges } from '@michinote/core';

const candidates = suggestRoutes(idx, {
  start: homeNodeId,
  availableMinutes: 180,          // 休憩込み
  mood: 'sea',                    // 'sea' | 'mountain' | 'lake' | 'cafe' | 'any'
  avoid: ['narrow'],              // 'narrow' | 'motorway'
  traveled: traveledEdges(myRides),
  wish: myWishEdges,
});
candidates[0].reasons.map(formatReasonJa);
// → ['いつもの「県道8号」の先に、まだ走っていない「茶屋峠道」が4.2kmあります。']
```

### 招待状をつくる

```ts
import { buildInvite } from '@michinote/core';

const payload = buildInvite(idx, { ride, message: 'この道、走ってみて！', zones: myPrivacyZones });
// payload には自宅周辺の線・スポット、走行時刻が含まれない。そのまま相手に送ってよい。
```

## 本番に向けて置き換えるもの

- `matchEdges`：並行する道・立体交差で誤判定し得る簡易版。Valhalla / OSRM / Mapbox のマップマッチングに置き換える（戻り値の形は変えない）。
- `suggestRoutes`：単純な周回の全探索。広い地域では出発地から半径数十kmに切り出したグラフを渡す。さらに広げるならサーバー側で計算する。
- `DEFAULT_SPEED_KMH`：所要時間の目安用の仮の速度。実走データで調整する。
