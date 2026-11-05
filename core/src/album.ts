import { distanceM, positionAt } from './geo.js';
import type { LatLng, Photo, Spot, TrackPoint } from './types.js';

export interface PlacedPhoto {
  photo: Photo;
  position: LatLng;
  /** 位置をどう決めたか。UI で「位置を確認してください」と出すかの判断に使う */
  source: 'exif_gps' | 'time_interpolated';
}

export interface PlaceOptions {
  /**
   * カメラの時計のズレ（ミリ秒）。カメラ時刻 + offset = 実時刻。
   * スマホで撮った写真なら 0 でよい。
   */
  cameraOffsetMs?: number;
  /** EXIF の位置が軌跡からこれ以上離れていたら信用しない（m）。既定 500 */
  maxGpsDeviationM?: number;
}

/**
 * 写真を走行ルート上に配置する（スライド6「写真をルートに並べる」）。
 * 1. EXIF に位置があり、軌跡の近くならそれを使う
 * 2. なければ撮影時刻から走行位置を補間する
 * 3. どちらも無理なら unplaced に入れ、ユーザーに手で置いてもらう
 */
export function placePhotos(photos: Photo[], track: TrackPoint[], opts: PlaceOptions = {}) {
  const offset = opts.cameraOffsetMs ?? 0;
  const maxDev = opts.maxGpsDeviationM ?? 500;
  const placed: PlacedPhoto[] = [];
  const unplaced: Photo[] = [];
  for (const photo of photos) {
    if (photo.lat !== undefined && photo.lng !== undefined) {
      const p = { lat: photo.lat, lng: photo.lng };
      if (track.length === 0 || track.some((q) => distanceM(p, q) <= maxDev)) {
        placed.push({ photo, position: p, source: 'exif_gps' });
        continue;
      }
    }
    const pos = photo.takenAt !== undefined ? positionAt(track, photo.takenAt + offset) : undefined;
    if (pos) placed.push({ photo, position: pos, source: 'time_interpolated' });
    else unplaced.push(photo);
  }
  placed.sort((a, b) => (a.photo.takenAt ?? 0) - (b.photo.takenAt ?? 0));
  return { placed, unplaced };
}

export interface TimelineEntry {
  t: number;
  position: LatLng;
  photos: Photo[];
  spot?: Spot;
}

/**
 * アルバムのタイムライン。近い場所・近い時刻の写真を 1 つにまとめ、
 * 立ち寄りスポットがあればそこに寄せる。
 */
export function buildTimeline(placed: PlacedPhoto[], spots: Spot[], mergeRadiusM = 150, mergeGapMs = 20 * 60_000): TimelineEntry[] {
  const entries: TimelineEntry[] = spots.map((s) => ({ t: s.t, position: { lat: s.lat, lng: s.lng }, photos: [], spot: s }));
  for (const pp of placed) {
    const t = pp.photo.takenAt ?? 0;
    const hit = entries.find((e) => distanceM(e.position, pp.position) <= mergeRadiusM && Math.abs(e.t - t) <= mergeGapMs);
    if (hit) hit.photos.push(pp.photo);
    else entries.push({ t, position: pp.position, photos: [pp.photo] });
  }
  return entries.sort((a, b) => a.t - b.t);
}
