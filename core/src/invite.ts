import { lengthM } from './geo.js';
import { edgeLine, type GraphIndex } from './graph.js';
import { maskEdges, maskLine, maskPoints } from './privacy.js';
import type { InvitePayload, PrivacyZone, Ride } from './types.js';

export interface BuildInviteInput {
  ride: Pick<Ride, 'title' | 'track' | 'edgeIds' | 'spots'>;
  message: string;
  /** 紹介する区間を絞る場合に指定（スライド3「お気に入りの区間を選ぶ」）。省略時は走行全体 */
  edgeIds?: string[];
  zones: PrivacyZone[];
}

/**
 * 道の招待状の中身を作る。
 * 戻り値は相手にそのまま渡してよいデータだけでできている（生の軌跡・時刻・隠す範囲を含まない）。
 */
export function buildInvite(idx: GraphIndex, input: BuildInviteInput): InvitePayload {
  const message = input.message.trim().slice(0, 140);
  const chosen = input.edgeIds ?? input.ride.edgeIds;
  const edgeIds = maskEdges(idx, chosen, input.zones);
  const lines = input.edgeIds
    ? edgeIds.flatMap((id) => maskLine(edgeLine(idx.graph, idx.edgeById.get(id)!), input.zones, { trimEndsM: 0 }))
    : maskLine(input.ride.track, input.zones);
  const spots = maskPoints(input.ride.spots, input.zones).map((s) => ({ lat: s.lat, lng: s.lng, title: s.title, photoIds: s.photoIds }));
  return {
    title: input.ride.title.trim().slice(0, 40) || '走った道',
    message,
    edgeIds,
    lines,
    spots,
    lengthM: lines.reduce((s, l) => s + lengthM(l), 0),
  };
}

/** 受け取った招待状を「行きたい道」に加える。すでに走った区間は除く */
export function acceptInvite(invite: Pick<InvitePayload, 'edgeIds'>, wish: Set<string>, traveled: Set<string>): Set<string> {
  const next = new Set(wish);
  for (const id of invite.edgeIds) if (!traveled.has(id)) next.add(id);
  return next;
}

/** 招待状の道を走り終えたか（スライド3「走った感想が返ってくる」の判定） */
export function inviteProgress(invite: Pick<InvitePayload, 'edgeIds'>, traveled: Set<string>) {
  const done = invite.edgeIds.filter((id) => traveled.has(id)).length;
  return { done, total: invite.edgeIds.length, completed: invite.edgeIds.length > 0 && done === invite.edgeIds.length };
}
