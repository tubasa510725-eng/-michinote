-- =====================================================================
-- ミチノート データベース定義（PostgreSQL 15 以上 + PostGIS）
--
-- Supabase でそのまま流せる形にしてある（auth.users と RLS を使用）。
-- 別のバックエンドを使う場合も、テーブル構成と「誰が何を見られるか」の
-- ルール（末尾の RLS）はそのまま移植すること。
--
-- 方針
--  * 生の走行軌跡と自宅などの隠す範囲は、本人以外に絶対に返さない。
--  * 他人に見せる線は、サーバー側で隠す範囲を取り除いた shared_* 列だけを使う。
--  * 初期リリース（MVP）で使うのは【MVP】の付いたテーブル。残りは段階2以降。
-- =====================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- 【MVP】プロフィール ---------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  handle        text unique not null check (handle ~ '^[a-z0-9_]{3,20}$'), -- 例: sora_rider
  display_name  text not null check (char_length(display_name) between 1 and 30),
  favorite_tags text[] not null default '{}',   -- 「海沿いの道」「温泉めぐり」など
  avatar_path   text,
  created_at    timestamptz not null default now()
);

-- 【MVP】愛車 -----------------------------------------------------------
create table public.bikes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 30), -- 例: SR400
  created_at timestamptz not null default now()
);
create index on public.bikes (user_id);

-- 【MVP】隠す範囲（自宅周辺など） ----------------------------------------
-- 本人だけが読める。他人向けデータを作るときにサーバー内部で参照する。
create table public.privacy_zones (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  label      text not null default '自宅',
  center     geography(point, 4326) not null,
  radius_m   integer not null check (radius_m between 200 and 5000),
  created_at timestamptz not null default now()
);
create index on public.privacy_zones (user_id);

-- 【MVP】道路区間 -------------------------------------------------------
-- OSM などから作った道路ネットワーク。region 単位で入れ替えられるようにしておく。
create table public.road_edges (
  id          text primary key,             -- 例: osm:123456:0
  region      text not null,                -- 例: jp-chiba
  from_node   text not null,
  to_node     text not null,
  name        text,
  road_type   text not null check (road_type in ('motorway','trunk','primary','secondary','tertiary','unclassified','residential','narrow_mountain')),
  length_m    integer not null,
  geom        geography(linestring, 4326) not null,
  coastal     boolean not null default false,
  mountain    boolean not null default false,
  lakeside    boolean not null default false,
  narrow      boolean not null default false,
  motorcycle_banned boolean not null default false,
  source_updated_at timestamptz             -- 元データの更新日。規制情報の鮮度管理に使う
);
create index on public.road_edges using gist (geom);
create index on public.road_edges (region);

-- 【MVP】走行記録 -------------------------------------------------------
create table public.rides (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  bike_id       uuid references public.bikes(id) on delete set null,
  title         text not null default '' check (char_length(title) <= 40),
  memo          text not null default '' check (char_length(memo) <= 1000),
  started_at    timestamptz not null,
  ended_at      timestamptz not null check (ended_at >= started_at),
  distance_m    integer not null default 0,
  moving_s      integer not null default 0,
  -- 本人用：間引いた軌跡（描画用）。生データは storage の rides/{user_id}/{ride_id}.json に置く
  track         geography(linestring, 4326),
  -- 他人用：隠す範囲を取り除いた軌跡（途切れるので multilinestring）
  shared_track  geography(multilinestring, 4326),
  visibility    text not null default 'private' check (visibility in ('private','friends','public')),
  created_at    timestamptz not null default now()
);
create index on public.rides (user_id, started_at desc);

-- 【MVP】走行と区間の対応（マップマッチングの結果） -----------------------
create table public.ride_edges (
  ride_id    uuid not null references public.rides(id) on delete cascade,
  edge_id    text not null references public.road_edges(id),
  first_time boolean not null default false,  -- その走行で初めて走った区間か
  primary key (ride_id, edge_id)
);
create index on public.ride_edges (edge_id);

-- 本人の「走った区間」一覧（白地図・開拓率・提案に使う）
create view public.my_traveled_edges with (security_invoker = true) as
  select distinct re.edge_id
  from public.ride_edges re join public.rides r on r.id = re.ride_id
  where r.user_id = auth.uid();

-- 【MVP】立ち寄りスポット -----------------------------------------------
create table public.spots (
  id          uuid primary key default gen_random_uuid(),
  ride_id     uuid not null references public.rides(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 40),
  location    geography(point, 4326) not null,
  visited_at  timestamptz not null,
  in_privacy_zone boolean not null default false, -- true のものは他人に出さない
  created_at  timestamptz not null default now()
);
create index on public.spots (ride_id);

-- 【MVP】写真 -----------------------------------------------------------
create table public.photos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  ride_id      uuid references public.rides(id) on delete cascade,
  spot_id      uuid references public.spots(id) on delete set null,
  storage_path text not null,               -- EXIF の位置情報は保存前に必ず削除する
  taken_at     timestamptz,
  location     geography(point, 4326),      -- アプリ内配置用。共有時は隠す範囲を判定
  placement    text not null default 'time_interpolated' check (placement in ('exif_gps','time_interpolated','manual')),
  is_shared    boolean not null default false, -- 共有アルバム・招待状に使ってよいか（本人が選ぶ）
  created_at   timestamptz not null default now()
);
create index on public.photos (ride_id);

-- 【MVP】行きたい道（招待状から保存した区間など） --------------------------
create table public.wish_edges (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  edge_id    text not null references public.road_edges(id),
  invite_id  uuid,                          -- どの招待状から来たか（任意）
  created_at timestamptz not null default now(),
  primary key (user_id, edge_id)
);

-- 【MVP】道の招待状 -----------------------------------------------------
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  ride_id     uuid references public.rides(id) on delete set null,
  title       text not null check (char_length(title) between 1 and 40),
  message     text not null default '' check (char_length(message) <= 140),
  edge_ids    text[] not null,              -- 隠す範囲を除いた区間
  shared_lines geography(multilinestring, 4326) not null, -- 隠す範囲を除いた形状
  cover_photo_id uuid references public.photos(id) on delete set null,
  -- リンクで受け取る場合のトークン（推測できない長さにする）
  share_token text unique default encode(gen_random_bytes(18), 'hex'),
  created_at  timestamptz not null default now()
);

create table public.invite_recipients (
  invite_id    uuid not null references public.invites(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  saved_at     timestamptz,                 -- 地図に保存した日時
  completed_at timestamptz,                 -- 全区間を走った日時
  notify_sender boolean not null default false, -- 実走を送り主に知らせるか（受け取った本人が選ぶ）
  primary key (invite_id, recipient_id)
);

-- 段階2：友達・ブロック ---------------------------------------------------
create table public.friendships (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- 段階3：現地メモ（スライド5） ---------------------------------------------
create table public.spot_notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  place_name   text not null,
  location     geography(point, 4326) not null,
  parking      text,
  surface      text check (surface in ('paved','gravel','dirt')),
  slope        boolean,
  narrow_entry boolean,
  stay_minutes integer,
  visited_on   date not null,               -- 情報の鮮度表示に必須
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.spot_notes using gist (location);

-- =====================================================================
-- 行レベルセキュリティ（誰が何を見られるか）
-- =====================================================================
alter table public.profiles          enable row level security;
alter table public.bikes             enable row level security;
alter table public.privacy_zones     enable row level security;
alter table public.road_edges        enable row level security;
alter table public.rides             enable row level security;
alter table public.ride_edges        enable row level security;
alter table public.spots             enable row level security;
alter table public.photos            enable row level security;
alter table public.wish_edges        enable row level security;
alter table public.invites           enable row level security;
alter table public.invite_recipients enable row level security;
alter table public.friendships       enable row level security;
alter table public.blocks            enable row level security;
alter table public.spot_notes        enable row level security;

-- プロフィールはログインユーザーなら読める。書けるのは本人だけ
create policy "profiles_read"  on public.profiles for select to authenticated using (true);
create policy "profiles_write" on public.profiles for all    to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- 本人だけのテーブル
create policy "own_bikes"   on public.bikes         for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own_zones"   on public.privacy_zones for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own_rides"   on public.rides         for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own_spots"   on public.spots         for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own_photos"  on public.photos        for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own_wish"    on public.wish_edges    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own_ride_edges" on public.ride_edges for all to authenticated
  using (exists (select 1 from public.rides r where r.id = ride_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.rides r where r.id = ride_id and r.user_id = auth.uid()));

-- 道路データは誰でも読める（書き込みはサービスロールのみ）
create policy "roads_read" on public.road_edges for select to authenticated using (true);

-- 招待状：送り主と受取人だけが読める。作れるのは送り主本人
-- （invites と invite_recipients のポリシーが互いを参照すると無限再帰になるため、判定関数を挟む）
create or replace function public.is_invite_sender(p_invite uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invites where id = p_invite and sender_id = auth.uid());
$$;
create or replace function public.is_invite_recipient(p_invite uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invite_recipients where invite_id = p_invite and recipient_id = auth.uid());
$$;

create policy "invites_read" on public.invites for select to authenticated
  using (sender_id = auth.uid() or public.is_invite_recipient(id));
create policy "invites_insert" on public.invites for insert to authenticated with check (sender_id = auth.uid());
create policy "invites_delete" on public.invites for delete to authenticated using (sender_id = auth.uid());

-- 受取人の行：送り主は宛先を追加・確認でき、受取人は自分の行を更新できる
create policy "recipients_read" on public.invite_recipients for select to authenticated
  using (recipient_id = auth.uid() or public.is_invite_sender(invite_id));
create policy "recipients_insert" on public.invite_recipients for insert to authenticated with check (
  public.is_invite_sender(invite_id)
  and not exists (select 1 from public.blocks b where b.blocker_id = recipient_id and b.blocked_id = auth.uid())
);
create policy "recipients_update" on public.invite_recipients for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- 友達・ブロック
create policy "friend_read"   on public.friendships for select to authenticated using (auth.uid() in (requester_id, addressee_id));
create policy "friend_insert" on public.friendships for insert to authenticated with check (requester_id = auth.uid());
create policy "friend_update" on public.friendships for update to authenticated using (addressee_id = auth.uid());
create policy "friend_delete" on public.friendships for delete to authenticated using (auth.uid() in (requester_id, addressee_id));
create policy "own_blocks"    on public.blocks      for all    to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- 現地メモ：読むのはログインユーザー全員、書くのは本人
create policy "notes_read"  on public.spot_notes for select to authenticated using (true);
create policy "notes_write" on public.spot_notes for all    to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 招待状に描く線は、送信前にサーバー側で隠す範囲を取り除くこと。
-- 例：PostGIS で隠す範囲を除く関数（Edge Function などから呼ぶ）
create or replace function public.mask_line_for_user(p_user uuid, p_line geography)
returns geography language sql stable security definer set search_path = public as $$
  select coalesce(
    (select st_difference(p_line::geometry, st_union(st_buffer(z.center, z.radius_m)::geometry))::geography
       from public.privacy_zones z where z.user_id = p_user),
    p_line);
$$;
revoke all on function public.mask_line_for_user(uuid, geography) from public, anon, authenticated;
