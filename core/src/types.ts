/**
 * ミチノート コアの型定義。
 *
 * UI フレームワーク・地図ライブラリ・バックエンドに依存しない「データの形」だけを置く。
 * Web(PWA) でもスマホアプリ(React Native / Expo)でも、このまま import して使える。
 */

/** 緯度経度（WGS84） */
export interface LatLng {
  lat: number;
  lng: number;
}

/** GPS で取れた 1 点 */
export interface TrackPoint extends LatLng {
  /** 取得時刻（UNIX ミリ秒） */
  t: number;
  /** 水平精度（メートル）。端末が返さない場合は undefined */
  acc?: number;
  /** 速度（m/s）。端末が返さない場合は undefined */
  speed?: number;
}

/**
 * 道の種別。OpenStreetMap の highway タグに近い粒度にしてある。
 * narrow_mountain は「狭い山道」（林道・すれ違い困難な峠道など）として独自に分けたもの。
 */
export type RoadType =
  | 'motorway' // 高速道路・自動車専用道
  | 'trunk' // 国道（主要）
  | 'primary' // 国道・主要地方道
  | 'secondary' // 県道
  | 'tertiary' // 市町村道（幹線）
  | 'unclassified' // その他の道
  | 'residential' // 生活道路
  | 'narrow_mountain'; // 狭い山道・林道

/** 道の特徴。ルート提案の「気分」や「避けたい道」の判定に使う */
export interface RoadTags {
  coastal?: boolean; // 海沿い
  mountain?: boolean; // 峠・山岳
  lakeside?: boolean; // 湖畔
  narrow?: boolean; // 幅員が狭い
  /** 二輪通行止め・二輪規制あり。true の道は提案に絶対使わない */
  motorcycleBanned?: boolean;
}

/** 交差点・分岐点など、道のつなぎ目 */
export interface RoadNode extends LatLng {
  id: string;
  name?: string;
  /** その地点の近くにある立ち寄り先 */
  poi?: PoiKind[];
}

export type PoiKind = 'cafe' | 'viewpoint' | 'michi_no_eki' | 'parking' | 'onsen' | 'shrine';

/** ノード間を結ぶ 1 区間の道（向きは持たない＝双方向として扱う） */
export interface RoadEdge {
  id: string;
  from: string;
  to: string;
  name?: string;
  type: RoadType;
  /** 区間の長さ（メートル） */
  lengthM: number;
  /** 区間の形状（from から to へ）。無ければ直線とみなす */
  geometry?: LatLng[];
  tags?: RoadTags;
}

/** 道路ネットワーク。実運用では OSM などから地域ごとに切り出して作る */
export interface RoadGraph {
  nodes: Record<string, RoadNode>;
  edges: RoadEdge[];
}

/** 公開範囲 */
export type Visibility = 'private' | 'friends' | 'public';

/** 現地メモ（スライド5）。訪問日を必ず持たせ、情報の鮮度を表示できるようにする */
export interface SpotNote {
  parking?: string; // 駐輪場所の説明
  surface?: 'paved' | 'gravel' | 'dirt';
  slope?: boolean; // 入口に坂がある
  narrowEntry?: boolean; // 進入路が狭い
  stayMinutes?: number;
  /** 投稿者が訪れた日（YYYY-MM-DD） */
  visitedOn: string;
}

/** 立ち寄りスポット */
export interface Spot extends LatLng {
  id: string;
  /** 立ち寄った時刻（UNIX ミリ秒） */
  t: number;
  title: string;
  photoIds: string[];
  note?: SpotNote;
}

/** 写真（ファイル本体はストレージに置き、ここには参照だけを持つ） */
export interface Photo {
  id: string;
  /** EXIF の撮影日時（UNIX ミリ秒） */
  takenAt?: number;
  /** EXIF の位置。無い写真も多い */
  lat?: number;
  lng?: number;
  url: string;
}

/** 1 回の走行記録 */
export interface Ride {
  id: string;
  userId: string;
  bikeId?: string;
  title: string;
  memo?: string;
  startedAt: number;
  endedAt: number;
  /** 生の走行軌跡。本人以外には絶対に渡さない */
  track: TrackPoint[];
  /** 走行軌跡を道路ネットワークに当てはめた結果（走った区間の ID） */
  edgeIds: string[];
  spots: Spot[];
  visibility: Visibility;
}

/**
 * 自宅周辺など、共有時に隠す範囲。
 * 本人の端末とサーバー内部だけで使い、他人に渡すデータには含めない。
 */
export interface PrivacyZone {
  center: LatLng;
  radiusM: number;
}

/** 道の招待状（スライド3）。相手に渡してよいデータだけで構成する */
export interface InvitePayload {
  title: string;
  message: string;
  /** 自宅周辺を取り除いた区間 ID */
  edgeIds: string[];
  /** 自宅周辺を取り除いた形状。途切れる場合があるので複数の線になる */
  lines: LatLng[][];
  spots: Array<Pick<Spot, 'lat' | 'lng' | 'title' | 'photoIds'>>;
  lengthM: number;
}
