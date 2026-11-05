/* ミチノート v0.2 - ローカル保存のGPS記録テスト版。サーバーにデータを送りません。 */
(() => {
  'use strict';
  const STORE = 'michinote-v02-local';
  const DRAFT = 'michinote-v02-unsaved-gps';
  const qs = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtKm = m => (Math.round((Number(m) || 0)/100)/10).toFixed(1);
  const today = () => new Date().toLocaleDateString('sv-SE');
  const fmtTime = ms => { const s = Math.max(0, Math.floor(ms/1000)); return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
  const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
  const defaultDB = () => ({version:2,rides:[],wish:[],bikes:['マイバイク']});
  let data;
  try { const src=JSON.parse(localStorage.getItem(STORE)||'null'); data=src&&Array.isArray(src.rides)&&Array.isArray(src.wish)&&Array.isArray(src.bikes)?src:defaultDB(); } catch {data=defaultDB();}
  const ui={tab:'map',mode:'white',filter:'all',selection:null,planTime:'4',mood:'scenic',avoidHwy:true};
  let recording=null, pending=null, watchId=null, ticker=null, toastTimer=null, map=null, layerGroup=null, activeLine=null, locating=false, playbackTimer=null;
  let photoDbPromise=null, photoURLs=[];
  const panel=qs('#panel'), dialog=qs('#dialog'), modalContent=qs('#modalContent');

  function persist(){
    try{localStorage.setItem(STORE,JSON.stringify(data));return true;}
    catch(e){notify('保存容量がいっぱいです。履歴から写真・走行記録を整理してください。');return false;}
  }
  function notify(msg){const el=qs('#toast');el.textContent=msg;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,4200);}
  function closeDialog(){if(dialog.open)dialog.close();modalContent.replaceChildren();}
  function showDialog(html){modalContent.innerHTML=html;if(!dialog.open)dialog.showModal();}
  function haversine(a,b){const rad=Math.PI/180, d1=(b.lat-a.lat)*rad,d2=(b.lng-a.lng)*rad,s=Math.sin(d1/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(d2/2)**2;return 12742000*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));}
  function segments(pts){const out=[];let seg=[];for(const p of pts||[]){if(p.gap&&seg.length){out.push(seg);seg=[];}seg.push([p.lat,p.lng]);}if(seg.length)out.push(seg);return out;}
  function elapsed(){return recording?Date.now()-recording.startedAt:0;}
  const totalKm=()=>fmtKm(data.rides.reduce((a,r)=>a+(r.distanceM||0),0));
  const uniqueDays=()=>new Set(data.rides.map(r=>r.date)).size;

  function initMap(){
    if(typeof L==='undefined'){qs('#mapFallback').hidden=false;return;}
    try{
      map=L.map('map',{zoomControl:false,attributionControl:true,preferCanvas:true}).setView([35.69,139.71],10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
        maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }).addTo(map);
      L.control.zoom({position:'bottomright'}).addTo(map);
      layerGroup=L.layerGroup().addTo(map);
      map.on('click',()=>{});
      qs('#map-shell').classList.add('white-map');
      drawMap();setTimeout(()=>map.invalidateSize(),100);
    }catch(e){console.error(e);qs('#mapFallback').hidden=false;}
  }
  function drawMap(){
    if(!map||!layerGroup)return;
    layerGroup.clearLayers();activeLine=null;
    const tracks=[];
    for(const r of data.rides){for(const seg of segments(r.points)){
      if(seg.length<2)continue;
      L.polyline(seg,{color:'#338a4c',weight:5,opacity:.8,lineCap:'round'}).addTo(layerGroup);tracks.push(...seg);
    }}
    for(const w of data.wish){
      if(!Number.isFinite(w.lat)||!Number.isFinite(w.lng))continue;
      const pin=L.circleMarker([w.lat,w.lng],{radius:7,color:'#fff7ed',weight:2,fillColor:'#d97831',fillOpacity:1}).addTo(layerGroup);
      pin.bindPopup(`<b>${esc(w.title)}</b><br><small>行きたい場所</small>`);
    }
    if(recording&&recording.points.length){
      const segs=segments(recording.points);for(const seg of segs)if(seg.length>1)L.polyline(seg,{color:'#bd4243',weight:6,opacity:.92}).addTo(layerGroup);
      const last=recording.points.at(-1);
      L.circleMarker([last.lat,last.lng],{radius:7,color:'white',weight:3,fillColor:'#bd4243',fillOpacity:1}).addTo(layerGroup);
    }
  }
  function focusRide(r){
    if(!map){notify('地図を読み込めませんでした。');return;}
    const coords=(r.points||[]).map(p=>[p.lat,p.lng]);
    if(coords.length===0){notify('この記録は手入力なので地図上の軌跡はありません。');return;}
    const b=L.latLngBounds(coords);
    map.fitBounds(b.pad(.24),{maxZoom:15,animate:true});
    ui.tab='map';render();closeDialog();
  }
  function locate(){
    if(!map){notify('地図を読み込めていません。');return;}
    if(!navigator.geolocation){notify('この端末では位置情報を利用できません。');return;}
    if(locating)return;locating=true;
    navigator.geolocation.getCurrentPosition(pos=>{
      locating=false;map.setView([pos.coords.latitude,pos.coords.longitude],14);
      notify('現在地付近を表示しました');
    },err=>{locating=false;notify(geoError(err));},{enableHighAccuracy:true,timeout:15000,maximumAge:10000});
  }
  function geoError(err){if(err?.code===1)return '位置情報の使用が許可されていません。ブラウザの設定をご確認ください。';if(err?.code===2)return '位置情報を取得できません。GPSの受信状況をご確認ください。';return '現在地を取得できません。屋外で再度お試しください。';}
  function setMode(mode){ui.mode=mode;qs('#map-shell').classList.toggle('white-map',mode==='white');qs('#whiteMode').setAttribute('aria-pressed',String(mode==='white'));qs('#streetMode').setAttribute('aria-pressed',String(mode==='street'));}

  function panelMap(){
    const last=data.rides.at(-1);
    return `<p class="eyebrow">MY ROUTE MAP</p><div class="heading"><h2>走るたび、地図が育つ。</h2><span class="mini-tag">自分専用</span></div>
      <div class="stats"><div class="stat"><label>累計走行距離</label><strong>${totalKm()}<small> km</small></strong></div><div class="stat"><label>旅の記録</label><strong>${data.rides.length}<small> 回</small></strong></div><div class="stat"><label>走った日数</label><strong>${uniqueDays()}<small> 日</small></strong></div></div>
      ${data.rides.length ? `<div class="card soft"><div class="card-head"><h3>最新の冒険</h3><span class="badge-mock">MY JOURNEY</span></div><p><b>${esc(last.title)}</b> · ${esc(last.date)} · ${fmtKm(last.distanceM)} km</p><div class="btn-row"><button class="btn small-btn" data-action="latest">記録を見る</button><button class="btn small-btn" data-action="replay">地図が育つ様子を見る</button></div></div>`:
      `<div class="empty"><div class="big-icon">⌁</div><h3>まだ白紙の地図です。</h3><p>最初のツーリングを記録すると、走った道がこの地図に緑色で残ります。</p><button class="btn primary" data-tab="record">最初の道を記録する</button></div>`}
      <div class="notice">淡色表示は通常の道路地図を薄くした試験版です。道路を隠す本格的な「白地図」は今後実装します。</div>
      <div class="btn-row"><button class="btn" data-action="locate">⌾ 現在地を表示</button><button class="btn" data-action="add-wish">＋ 行きたい場所</button></div>`;
  }
  function panelRecord(){
    if(recording){
      return `<p class="eyebrow">LIVE TRACKING</p><div class="heading"><h2>冒険を記録中</h2><span class="record-indicator"><i class="pulse"></i> REC</span></div>
        <div class="record-big" id="liveDistance">${fmtKm(recording.distanceM)}<small> km</small></div>
        <div class="two-stats"><div><span>記録時間</span><b id="liveTime">${fmtTime(elapsed())}</b></div><div><span>GPS測位点</span><b id="livePoints">${recording.points.length} 点</b></div></div>
        <div class="card soft"><h3>記録はこの端末だけに保存します</h3><p>赤い線が記録中の道です。走行中は画面操作をせず、安全な場所に停車して操作してください。</p></div>
        <div class="notice">重要：Web版のため、iPhoneで画面を消したりアプリを切り替えるとGPS記録が止まる場合があります。初回の動作確認は徒歩・停車中に行ってください。</div>
        <div class="btn-row"><button class="btn danger" data-action="discard">記録を破棄</button><button class="btn primary" data-action="finish">停車して記録を終了</button></div>`;
    }
    return `<p class="eyebrow">START A JOURNEY</p><div class="heading"><h2>今日の道を残そう。</h2><span class="mini-tag">GPS RECORD</span></div>
      <div class="card soft"><h3>◉ GPSで走行を記録</h3><p>スマホの位置情報から実際の移動の軌跡を保存します。道はマイ地図に緑色で残ります。</p><button class="btn primary wide" data-action="start">● 記録を開始</button></div>
      <div class="card"><h3>✎ 過去のツーリングも残せる</h3><p>以前の旅は、日付・走行距離・感想と写真を手入力で登録できます（地図上に道は描かれません）。</p><button class="btn wide" data-action="manual">＋ 手入力で旅を追加</button></div>
      <div class="notice">GPS記録には HTTPS と位置情報への許可が必要です。ライディング中の操作は避けてください。</div>`;
  }
  function panelPlan(){
    const wishes=data.wish.map(w=>`<div class="wish-item"><div><strong>${esc(w.title)}</strong><small>${w.lat.toFixed(3)}, ${w.lng.toFixed(3)}</small></div><div class="btn-row"><button class="btn small-btn" data-action="focus-wish" data-id="${esc(w.id)}">地図</button><button class="btn small-btn" data-action="nav-wish" data-id="${esc(w.id)}">経路</button><button class="btn small-btn danger" data-action="del-wish" data-id="${esc(w.id)}">削除</button></div></div>`).join('');
    return `<p class="eyebrow">NEXT ADVENTURE</p><div class="heading"><h2>次はどこへ走ろう。</h2></div>
      <div class="card orange"><div class="card-head"><h3>未走行ルートの自動提案</h3><span class="badge-mock">開発中</span></div><p>元の試作品には3ルート提案があります。実在の道路に対応するには、道路網と二輪規制情報の整備が必要です。</p><a href="demo/index.html" target="_blank" rel="noopener" class="btn small-btn">試作品で3ルート提案を試す ↗</a></div>
      <div class="field inline"><label for="planTime">次の旅に使える時間</label><select id="planTime"><option value="2" ${ui.planTime==='2'?'selected':''}>2時間</option><option value="4" ${ui.planTime==='4'?'selected':''}>4時間</option><option value="6" ${ui.planTime==='6'?'selected':''}>6時間</option><option value="8" ${ui.planTime==='8'?'selected':''}>8時間</option></select></div>
      <div class="field inline"><label for="mood">今の気分</label><select id="mood"><option value="scenic" ${ui.mood==='scenic'?'selected':''}>景色を楽しむ</option><option value="sea" ${ui.mood==='sea'?'selected':''}>海</option><option value="pass" ${ui.mood==='pass'?'selected':''}>峠</option><option value="lake" ${ui.mood==='lake'?'selected':''}>湖・温泉</option></select></div>
      <p class="hint">条件の入力は保存しますが、まだ自動的な実走ルート生成には使用しません。</p>
      <div class="separator"></div><div class="heading"><h2>行きたい場所 <span class="muted">${data.wish.length}件</span></h2><button class="btn small-btn" data-action="add-wish">＋ 追加</button></div>
      ${data.wish.length?wishes:`<div class="empty"><div class="big-icon">◎</div><h3>行きたい場所を登録しよう</h3><p>地図の中心を指定して、行きたい場所の名前を登録できます。</p></div>`}
      <div class="notice">「経路」は外部の地図アプリを開くだけです。二輪通行規制や道路状況は出発前に必ず確認してください。</div>`;
  }
  function panelInvite(){
    const options=data.rides.map(r=>`<option value="${esc(r.id)}">${esc(r.date)} · ${esc(r.title)}</option>`).join('');
    return `<p class="eyebrow">SHARE THE ROAD</p><div class="heading"><h2>道の招待状。</h2></div>
      <div class="card orange"><h3>旅の思い出を、ひとことに。</h3><p>友達に送れる紹介文を作れます。安全のため、位置座標・自宅付近の道・走行時刻は文章に含めません。</p></div>
      ${data.rides.length?`<div class="field"><label for="inviteRide">招待状にする旅</label><select id="inviteRide">${options}</select></div><div class="field"><label for="inviteMessage">ひとこと（140字以内）</label><textarea id="inviteMessage" maxlength="140" placeholder="この道の景色が最高だった！"></textarea></div><button class="btn primary wide" data-action="share">招待状の文章を作成・共有</button>`:
      `<div class="empty"><div class="big-icon">✉</div><h3>最初に旅を記録しましょう</h3><p>旅の記録から、招待状の文章が作れるようになります。</p><button class="btn primary" data-tab="record">記録する</button></div>`}
      <div class="separator"></div><div class="card soft"><h3>友達からの招待状</h3><p>アカウント・友達機能と位置情報を安全に隠す共有機能は、次の段階で実装します。</p><span class="badge-mock">まだ受信機能はありません</span></div>`;
  }
  function panelHistory(){
    const rides=data.rides.slice().reverse().filter(r=>ui.filter==='all'||r.bike===ui.filter);
    return `<p class="eyebrow">JOURNEY ARCHIVE</p><div class="heading"><h2>旅の記録を振り返る。</h2><span class="mini-tag">${data.rides.length} TRIPS</span></div>
      <div class="field inline"><label for="bikeFilter">愛車で絞り込む</label><select id="bikeFilter"><option value="all">すべて</option>${data.bikes.map(b=>`<option value="${esc(b)}" ${ui.filter===b?'selected':''}>${esc(b)}</option>`).join('')}</select></div>
      ${rides.length?`<div class="card">${rides.map(r=>`<div class="trip-item"><div><div class="trip-title">${esc(r.title)}</div><div class="trip-meta">${esc(r.date)} · ${esc(r.bike)} ${r.manual?'· 手入力':''}</div><div style="margin-top:6px"><button class="btn small-btn" data-action="ride" data-id="${esc(r.id)}">旅のアルバムを見る</button></div></div><div class="trip-distance">${fmtKm(r.distanceM)}<small> km</small></div></div>`).join('')}</div>`:
      `<div class="empty"><div class="big-icon">▤</div><h3>まだ記録がありません。</h3><p>記録した旅が、ここに日付順に並びます。</p><button class="btn" data-tab="record">旅を記録する</button></div>`}
      <div class="btn-row"><button class="btn small-btn" data-action="export">バックアップを書き出す</button><button class="btn small-btn" data-action="import">バックアップを復元</button></div>
      <p class="hint">バックアップは位置座標を含む個人データです。写真はこの版のバックアップ対象外です。</p>`;
  }
  const pages={map:panelMap,record:panelRecord,plan:panelPlan,invite:panelInvite,history:panelHistory};
  const tabs=[...qs('#tabs').querySelectorAll('button')];
  function render(){
    const scroll=qs('.workspace').scrollTop;
    panel.innerHTML=pages[ui.tab]();
    tabs.forEach(b=>{const sel=b.dataset.tab===ui.tab;b.classList.toggle('active',sel);if(sel)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    qs('.workspace').scrollTop=scroll;
    if(map)setTimeout(()=>map.invalidateSize(),10);
    refreshLive();
  }
  function navigate(tab){ui.tab=tab;qs('.workspace').scrollTop=0;render();}
  function refreshLive(){if(!recording||ui.tab!=='record')return;const d=qs('#liveDistance'),t=qs('#liveTime'),p=qs('#livePoints');if(d)d.innerHTML=`${fmtKm(recording.distanceM)}<small> km</small>`;if(t)t.textContent=fmtTime(elapsed());if(p)p.textContent=`${recording.points.length} 点`;}
  function capture(pos){
    if(!recording)return;
    const {latitude:lat,longitude:lng,accuracy}=pos.coords;
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||accuracy>50)return;
    const t=pos.timestamp||Date.now(),next={lat,lng,t,accuracy:Math.round(accuracy)};
    const prev=recording.points.at(-1);
    if(prev){
      const dt=(t-prev.t)/1000,dist=haversine(prev,next);
      if(dt<=0)return;
      if(dist<3)return;
      // 位置の飛び／休止からの復帰を一本線でつながない
      if(dist/dt>250/3.6)return;
      if(dt>180)next.gap=true;
      else recording.distanceM+=dist;
    }
    if(recording.points.length>=12000){notify('測位点数の上限に達しました。安全な場所で記録を終了してください。');return;}
    recording.points.push(next);saveDraft();
    if(map){map.setView([lat,lng],Math.max(map.getZoom(),13),{animate:false});drawMap();}
    refreshLive();
  }
  function startRecording(){
    if(recording)return;
    if(!navigator.geolocation){notify('GPS位置情報に対応していません。');return;}
    if(!window.isSecureContext){notify('GPS記録はHTTPSで公開したページ、またはlocalhostで使ってください。');return;}
    recording={startedAt:Date.now(),points:[],distanceM:0};saveDraft();
    try{watchId=navigator.geolocation.watchPosition(capture,err=>{
      if(err.code===1){stopWatcher();recording=null;render();}
      notify(geoError(err));
    },{enableHighAccuracy:true,maximumAge:0,timeout:30000});}
    catch(e){recording=null;notify('GPSを開始できませんでした。');return;}
    navigate('record');ticker=setInterval(refreshLive,1000);
    notify('GPS記録を開始しました。位置情報を許可してください。');
  }
  function stopWatcher(){if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;}clearInterval(ticker);ticker=null;}
  function saveDraft(){try{if(recording)localStorage.setItem(DRAFT,JSON.stringify({points:recording.points,distanceM:recording.distanceM,durationMs:elapsed(),manual:false}));}catch{}}
  function clearDraft(){try{localStorage.removeItem(DRAFT);}catch{}}
  function abandon(){
    showDialog(`<h2 id="modalTitle">記録を破棄しますか？</h2><p>今回のGPS軌跡は保存されません。</p><div class="btn-row"><button class="btn" data-action="close-dialog">戻る</button><button class="btn danger" data-action="confirm-discard">破棄する</button></div>`);
  }
  function finishRecording(){
    if(!recording)return;
    stopWatcher();pending={points:recording.points.slice(),distanceM:recording.distanceM,durationMs:elapsed(),manual:false};recording=null;drawMap();render();openSaveRide();
  }
  function openSaveRide(manual=false){
    if(manual)pending={points:[],distanceM:0,durationMs:0,manual:true};
    if(!pending)return;
    showDialog(`<p class="eyebrow">SAVE YOUR JOURNEY</p><h2 id="modalTitle">旅を保存</h2>
      ${pending.manual?'':`<p>GPS軌跡 ${pending.points.length} 点 · 約 ${fmtKm(pending.distanceM)} km · ${fmtTime(pending.durationMs)}</p>`}
      <form id="saveForm"><div class="field"><label for="rideTitle">旅のタイトル</label><input id="rideTitle" required maxlength="70" placeholder="例：秋の奥多摩ツーリング" /></div>
      <div class="field"><label for="rideDate">日付</label><input id="rideDate" type="date" required value="${today()}" /></div>
      <div class="field"><label for="rideBike">愛車の名前</label><input id="rideBike" list="bikes" value="${esc(data.bikes[0]||'マイバイク')}" required maxlength="40" /><datalist id="bikes">${data.bikes.map(b=>`<option value="${esc(b)}">`).join('')}</datalist></div>
      ${pending.manual?'<div class="field"><label for="manualKm">走行距離（km）</label><input id="manualKm" type="number" min="0" max="10000" step="0.1" value="0" required /></div>':''}
      <div class="field"><label for="rideNote">メモ・立ち寄り先</label><textarea id="rideNote" maxlength="1500" placeholder="見つけた景色、おいしかったご飯、次回のためのメモ"></textarea></div>
      <div class="field"><label for="ridePhoto">旅の写真（1枚・任意）</label><input id="ridePhoto" type="file" accept="image/*" /><span class="hint">写真は再圧縮してEXIF位置情報を除いた上で、この端末にのみ保存します。</span></div>
      <div class="btn-row"><button type="button" class="btn" data-action="cancel-save">キャンセル</button><button type="submit" class="btn primary" id="saveSubmit">旅を保存する</button></div></form>`);
  }
  function photoDB(){
    if(!('indexedDB'in window))return Promise.reject(new Error('not-supported'));
    if(!photoDbPromise){photoDbPromise=new Promise((res,rej)=>{const req=indexedDB.open('michinote-photos-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('photos');req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});}
    return photoDbPromise;
  }
  async function putPhoto(key,blob){const db=await photoDB();return new Promise((res,rej)=>{const tx=db.transaction('photos','readwrite');tx.objectStore('photos').put(blob,key);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}
  async function getPhoto(key){const db=await photoDB();return new Promise((res,rej)=>{const tx=db.transaction('photos','readonly'),req=tx.objectStore('photos').get(key);req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});}
  async function deletePhoto(key){if(!key)return;try{const db=await photoDB();db.transaction('photos','readwrite').objectStore('photos').delete(key);}catch{}}
  async function compress(file){
    if(!file.type.startsWith('image/'))throw new Error('画像を選択してください');
    if(file.size>35*1024*1024)throw new Error('画像ファイルが大きすぎます（最大35MB）');
    const url=URL.createObjectURL(file);
    try{
      const im=new Image();im.src=url;await new Promise((res,rej)=>{im.onload=res;im.onerror=()=>rej(new Error('画像が読めません'));});
      const scale=Math.min(1,1280/Math.max(im.naturalWidth,im.naturalHeight));
      const cv=document.createElement('canvas');cv.width=Math.max(1,Math.round(im.naturalWidth*scale));cv.height=Math.max(1,Math.round(im.naturalHeight*scale));
      cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);
      const blob=await new Promise((res,rej)=>cv.toBlob(v=>v?res(v):rej(new Error('画像変換に失敗')),'image/jpeg',.75));
      return blob;
    } finally{URL.revokeObjectURL(url);}
  }
  async function saveRide(e){
    e.preventDefault();if(!pending)return;
    const title=qs('#rideTitle').value.trim(),date=qs('#rideDate').value,bike=qs('#rideBike').value.trim(),note=qs('#rideNote').value.trim();
    if(!title||!date||!bike){notify('必須項目を入力してください。');return;}
    const btn=qs('#saveSubmit');btn.disabled=true;
    const ride={id:id(),date,title,bike,note,manual:pending.manual,points:pending.points,
      durationMs:pending.durationMs,distanceM:pending.manual?Math.round(Math.max(0,Number(qs('#manualKm').value)||0)*1000):Math.round(pending.distanceM),createdAt:Date.now(),photoKey:null};
    const file=qs('#ridePhoto').files[0];
    if(file){try{const blob=await compress(file);await putPhoto(ride.id,blob);ride.photoKey=ride.id;}catch(err){notify(`写真は保存できませんでした：${err.message}`);}}
    data.rides.push(ride);if(!data.bikes.includes(bike))data.bikes.push(bike);
    if(!persist()){data.rides.pop();btn.disabled=false;return;}
    if(!ride.manual)clearDraft();pending=null;closeDialog();drawMap();navigate('map');
    if(ride.points.length>1){map?.fitBounds(L.latLngBounds(ride.points.map(p=>[p.lat,p.lng])).pad(.25),{maxZoom:15});}
    notify('旅を保存しました！走った道が地図に加わりました。');
  }
  function openRide(r){
    showDialog(`<p class="eyebrow">JOURNEY ALBUM</p><h2 id="modalTitle">${esc(r.title)}</h2><p>${esc(r.date)} · ${esc(r.bike)} ${r.manual?'· 手入力':'· GPS記録'}</p>
      <div class="stats"><div class="stat"><label>走行距離</label><strong>${fmtKm(r.distanceM)}<small> km</small></strong></div><div class="stat"><label>記録時間</label><strong style="font-size:15px">${fmtTime(r.durationMs||0)}</strong></div><div class="stat"><label>GPS測位</label><strong>${r.points?.length||0}<small> 点</small></strong></div></div>
      <div id="albumPhoto"></div><h3>旅のメモ</h3><p>${r.note?esc(r.note).replace(/\n/g,'<br>'):'メモはありません。'}</p>
      <div class="btn-row"><button class="btn small-btn" data-action="focus-ride" data-id="${esc(r.id)}" ${!r.points?.length?'disabled':''}>地図で見る</button><button class="btn small-btn" data-action="gpx" data-id="${esc(r.id)}" ${!r.points?.length?'disabled':''}>GPX保存</button><button class="btn small-btn danger" data-action="delete-ride" data-id="${esc(r.id)}">削除</button></div>
      <button class="btn wide" style="margin-top:12px" data-action="close-dialog">閉じる</button>`);
    if(r.photoKey)getPhoto(r.photoKey).then(blob=>{if(blob&&dialog.open){const url=URL.createObjectURL(blob);photoURLs.push(url);const img=new Image();img.className='photo-preview';img.alt='旅の写真';img.src=url;qs('#albumPhoto')?.appendChild(img);}}).catch(()=>{});
  }
  function addWish(){
    if(!map){notify('地図の読み込みが必要です。');return;}
    const c=map.getCenter();showDialog(`<p class="eyebrow">WISH LIST</p><h2 id="modalTitle">行きたい場所を保存</h2><p>地図の中心（${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}）を保存します。地図を動かしてから開き直すと位置を変えられます。</p>
      <form id="wishForm"><div class="field"><label for="wishName">場所の名前</label><input id="wishName" required maxlength="70" placeholder="例：山の展望台" /></div><div class="btn-row"><button type="button" class="btn" data-action="close-dialog">戻る</button><button type="submit" class="btn primary">この場所を保存</button></div></form>`);
    ui.wishCenter={lat:c.lat,lng:c.lng};
  }
  function makeWish(e){e.preventDefault();const title=qs('#wishName')?.value.trim();if(!title||!ui.wishCenter)return;data.wish.push({id:id(),title,...ui.wishCenter});persist();closeDialog();drawMap();navigate('plan');notify('行きたい場所に追加しました。');}
  function showHelp(){
    showDialog(`<h2 id="modalTitle">使い方と注意事項</h2>
      <p>ミチノート v0.2 は、添付された企画と試作品をもとに作成した<strong>端末内保存のテスト版</strong>です。</p>
      <h3>今できること</h3><ul><li>実際の地図表示・GPS記録と走行軌跡の保存</li><li>旅の手入力、写真1枚の追加、履歴とアルバム</li><li>行きたい場所の登録、招待状の文章共有</li><li>位置データのバックアップ・復元、GPX書き出し</li></ul>
      <h3>重要な制約</h3><ul><li>iPhoneでは画面消灯・他アプリへの切り替えで記録が止まり得ます。バックグラウンド記録は未対応です。</li><li>自動ルート提案、二輪交通規制判定、ログイン、友達への安全な地図共有は未実装です。</li><li>データは端末のブラウザ内だけです。キャッシュを削除すると消える場合があります。定期的にバックアップしてください。</li><li>実際の走行中に操作せず、停車した状態で操作してください。</li></ul>
      <p><a href="demo/index.html" target="_blank" rel="noopener">添付元の架空地図デモを開く ↗</a></p>
      <button class="btn primary wide" data-action="close-dialog">閉じる</button>`);
  }
  function download(name,body,type){const blob=new Blob([body],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  function exportData(){download(`michinote-backup-${today()}.json`,JSON.stringify({type:'michinote-backup',version:2,exportedAt:new Date().toISOString(),data:{rides:data.rides,wish:data.wish,bikes:data.bikes}},null,2),'application/json');notify('バックアップJSONを書き出しました（写真は含みません）。');}
  function importData(){showDialog(`<h2 id="modalTitle">バックアップを復元</h2><div class="notice">現在のデータに追加・上書きします。復元前に現在のバックアップを保存してください。写真は復元されません。</div><div class="field"><label for="backupFile">ミチノートのJSONバックアップ</label><input id="backupFile" type="file" accept=".json,application/json" /></div><div class="btn-row"><button class="btn" data-action="close-dialog">キャンセル</button><button class="btn primary" data-action="do-import">復元する</button></div>`);}
  async function doImport(){
    const f=qs('#backupFile')?.files[0];if(!f)return notify('JSONファイルを選択してください。');
    if(f.size>10*1024*1024)return notify('10MB以下のバックアップを選んでください。');
    try{
      const parsed=JSON.parse(await f.text());const src=parsed?.data;
      if(parsed.type!=='michinote-backup'||!Array.isArray(src?.rides)||!Array.isArray(src?.wish)||!Array.isArray(src?.bikes))throw Error('形式が違います');
      // 不正なHTMLや極端に大きいデータの混入を防ぐ。描画時は常にエスケープ。
      const rides=src.rides.filter(r=>r&&typeof r.id==='string'&&typeof r.title==='string'&&typeof r.date==='string'&&typeof r.bike==='string'&&Array.isArray(r.points)&&r.points.length<=12000)
        .map(r=>({...r,id:String(r.id).slice(0,70),title:r.title.slice(0,70),bike:r.bike.slice(0,40),date:r.date.slice(0,20),note:String(r.note||'').slice(0,1500),photoKey:null,points:r.points.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180).map(p=>({lat:p.lat,lng:p.lng,t:Number(p.t)||Date.now(),gap:!!p.gap})),distanceM:Math.max(0,Math.min(1e8,Number(r.distanceM)||0))}));
      const wish=src.wish.filter(w=>w&&typeof w.title==='string'&&Number.isFinite(w.lat)&&Number.isFinite(w.lng)&&Math.abs(w.lat)<=90&&Math.abs(w.lng)<=180).map(w=>({id:String(w.id||id()).slice(0,70),title:w.title.slice(0,70),lat:w.lat,lng:w.lng}));
      const existing=new Set(data.rides.map(r=>r.id));for(const r of rides)if(!existing.has(r.id)){data.rides.push(r);existing.add(r.id);}
      const wishlist=new Set(data.wish.map(w=>w.id));for(const w of wish)if(!wishlist.has(w.id)){data.wish.push(w);wishlist.add(w.id);}
      data.bikes=[...new Set([...data.bikes,...src.bikes.filter(b=>typeof b==='string').map(b=>b.slice(0,40))])];
      persist();closeDialog();drawMap();navigate('history');notify('バックアップの復元が完了しました。');
    }catch(e){notify(`復元できませんでした：${e.message}`);}
  }
  function exportGpx(r){
    const tracks=segments(r.points||[]);if(!tracks.length)return;
    // GPXは個人の位置データ。意図しない共有を防ぐため保存前に確認する。
    if(!confirm('GPXには実際の位置座標が含まれます。自宅などの位置が分かる可能性があります。自分の端末に書き出しますか？'))return;
    const trks=tracks.map(seg=>`<trkseg>${seg.map(([lat,lng])=>`<trkpt lat="${lat}" lon="${lng}"></trkpt>`).join('')}</trkseg>`).join('');
    const gpx=`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Michinote" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(r.title)}</name>${trks}</trk></gpx>`;
    download(`michinote-${r.date}.gpx`,gpx,'application/gpx+xml');
  }
  function replay(){
    if(!map){notify('地図の読み込みが必要です。');return;}
    const pts=data.rides.flatMap(r=>(r.points||[]).map((p,i)=>i===0?{...p,gap:true}:p));
    if(pts.length<2){notify('再生できるGPS軌跡がまだありません。');return;}
    clearInterval(playbackTimer);drawMap();
    let n=0;const group=L.layerGroup().addTo(map);const chunk=Math.max(1,Math.ceil(pts.length/90));
    playbackTimer=setInterval(()=>{n=Math.min(pts.length,n+chunk);group.clearLayers();for(const seg of segments(pts.slice(0,n)))if(seg.length>1)L.polyline(seg,{color:'#338a4c',weight:5}).addTo(group);if(n===pts.length){clearInterval(playbackTimer);playbackTimer=null;setTimeout(()=>{group.remove();drawMap();},600);}},45);
    notify('記録した道が伸びる様子を再生します。');
  }
  function share(){
    const idVal=qs('#inviteRide')?.value,r=data.rides.find(x=>x.id===idVal);if(!r)return;
    const msg=qs('#inviteMessage')?.value.trim();
    const txt=`【道の招待状／ミチノート】\n${r.title}\n走行距離：${fmtKm(r.distanceM)}km\n${msg?msg+'\n':''}いつか一緒にこの景色を見に行こう。\n※詳しい走行位置や日時は共有していません。`;
    showDialog(`<p class="eyebrow">ROAD INVITATION</p><h2 id="modalTitle">道の招待状</h2><div class="card soft"><p style="white-space:pre-wrap;color:var(--ink)">${esc(txt)}</p></div><p class="hint">位置座標は含まれていません。文章の内容をご確認ください。</p><div class="btn-row"><button class="btn" data-action="copy-invite">文章をコピー</button><button class="btn primary" data-action="native-share">共有する</button></div><button class="btn wide" style="margin-top:10px" data-action="close-dialog">閉じる</button>`);
    ui.shareText=txt;
  }
  async function copyText(s){try{await navigator.clipboard.writeText(s);notify('コピーしました。');}catch{notify('コピーできませんでした。HTTPSでお試しください。');}}
  async function action(action,target){
    const recId=target.dataset.id,r=data.rides.find(x=>x.id===recId),w=data.wish.find(x=>x.id===recId);
    switch(action){
      case 'locate':locate();break;
      case 'start':startRecording();break;
      case 'finish':finishRecording();break;
      case 'discard':abandon();break;
      case 'confirm-discard':stopWatcher();recording=null;clearDraft();closeDialog();drawMap();render();notify('記録を破棄しました。');break;
      case 'manual':openSaveRide(true);break;
      case 'cancel-save':if(pending&&!pending.manual)clearDraft();pending=null;closeDialog();render();break;
      case 'close-dialog':closeDialog();break;
      case 'restore-draft':pending=ui.recoverDraft;ui.recoverDraft=null;clearDraft();closeDialog();openSaveRide();break;
      case 'clear-draft':ui.recoverDraft=null;clearDraft();closeDialog();notify('未保存データを破棄しました。');break;
      case 'add-wish':addWish();break;
      case 'focus-wish':if(w&&map){map.setView([w.lat,w.lng],14);navigate('map');}break;
      case 'nav-wish':if(w){const url=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(w.lat+','+w.lng)}`;window.open(url,'_blank','noopener,noreferrer');}break;
      case 'del-wish':if(w&&confirm(`「${w.title}」を削除しますか？`)){data.wish=data.wish.filter(x=>x.id!==w.id);persist();drawMap();render();}break;
      case 'latest':if(data.rides.length)openRide(data.rides.at(-1));break;
      case 'ride':if(r)openRide(r);break;
      case 'focus-ride':if(r)focusRide(r);break;
      case 'gpx':if(r)exportGpx(r);break;
      case 'delete-ride':if(r&&confirm(`「${r.title}」を削除しますか？\n削除すると地図の軌跡も消えます。`)){data.rides=data.rides.filter(x=>x.id!==r.id);deletePhoto(r.photoKey);persist();closeDialog();drawMap();navigate('history');notify('走行記録を削除しました。');}break;
      case 'export':exportData();break;
      case 'import':importData();break;
      case 'do-import':doImport();break;
      case 'replay':replay();break;
      case 'share':share();break;
      case 'copy-invite':copyText(ui.shareText);break;
      case 'native-share':if(navigator.share){try{await navigator.share({title:'道の招待状／ミチノート',text:ui.shareText});}catch{}}else copyText(ui.shareText);break;
    }
  }
  qs('#app').addEventListener('click',e=>{
    const el=e.target.closest('button');if(!el)return;
    if(el.dataset.tab){navigate(el.dataset.tab);return;}
    if(el.dataset.mode){setMode(el.dataset.mode);return;}
    if(el.dataset.action)action(el.dataset.action,el);
  });
  qs('#app').addEventListener('submit',e=>{if(e.target.id==='saveForm')saveRide(e);else if(e.target.id==='wishForm')makeWish(e);});
  qs('#app').addEventListener('change',e=>{
    if(e.target.id==='bikeFilter'){ui.filter=e.target.value;render();}
    if(e.target.id==='planTime')ui.planTime=e.target.value;
    if(e.target.id==='mood')ui.mood=e.target.value;
  });
  qs('#helpButton').addEventListener('click',showHelp);
  dialog.addEventListener('close',()=>{photoURLs.forEach(u=>URL.revokeObjectURL(u));photoURLs=[];});
  window.addEventListener('beforeunload',e=>{if(recording){e.preventDefault();e.returnValue='';}});
  if('serviceWorker'in navigator&&(location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
  initMap();render();
  // GPS記録中に画面が閉じた場合も、保存済み測位点を復元できるようにする。
  try{
    const draft=JSON.parse(localStorage.getItem(DRAFT)||'null');
    if(draft&&Array.isArray(draft.points)&&draft.points.length&&draft.points.length<=12000){
      showDialog(`<h2 id="modalTitle">前回の未保存記録があります</h2><p>${draft.points.length} 点、約 ${fmtKm(draft.distanceM)}km のGPSデータが残っています。続きのGPS測位は再開せず、ここまでの記録を保存できます。</p><div class="btn-row"><button class="btn danger" data-action="clear-draft">破棄</button><button class="btn primary" data-action="restore-draft">保存する</button></div>`);
      ui.recoverDraft=draft;
    }
  }catch{}
})();
