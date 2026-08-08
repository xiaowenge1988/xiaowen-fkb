/* ===== 客户房源管理系统 - 核心逻辑 ===== */
/* 全局错误捕获 — 防止白屏闪退，在页面底部显示错误信息 */
window.addEventListener('error',function(e){
  console.error('[全局错误]',e.error?e.error.stack:e.message);
  var d=document.getElementById('globalErrorBar');
  if(!d){d=document.createElement('div');d.id='globalErrorBar';d.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#dc2626;color:#fff;padding:8px 12px;font-size:12px;z-index:99999;word-break:break-all';document.body.appendChild(d)}
  d.textContent='JS错误: '+(e.error?e.error.message:e.message)+' (请刷新页面，如持续报错请联系管理员)';
  d.style.display='block';
});
window.addEventListener('unhandledrejection',function(e){
  console.error('[未捕获Promise]',e.reason);
});
(function(){
'use strict';

/* ========== Config ========== */
var AREAS=['临平','余杭','萧山','拱墅','西湖','上城','滨江','钱塘','富阳','临安'];
/* 区域下拉选项：白名单之外的已有值（如海宁/德清等外溢城市）也要保留，否则内联编辑一保存就把区域清空 */
/* 表单区域下拉：若当前值不在白名单里，动态补一个 option，防止编辑保存时区域被静默改写 */
function _ensureDistrictOption(cur){
  if(!cur)return;
  var sel=document.getElementById('pfDistrict');
  if(!sel)return;
  for(var i=0;i<sel.options.length;i++){if(sel.options[i].value===cur||sel.options[i].text===cur)return;}
  var o=document.createElement('option');o.value=cur;o.text=cur;sel.appendChild(o);
}
function _districtOpts(cur){
  var list=AREAS.slice();
  if(cur&&list.indexOf(cur)<0)list.push(cur);
  return list.map(function(a){return'<option'+(cur===a?' selected':'')+'>'+a+'</option>'}).join('');
}
/* 杭州各城区板块/商圈数据（参考贝壳/我爱我家/政府官方命名） */
var AREA_BLOCKS={
  '临平':['临平新城','临平老城','临平东湖','临平运河','临平塘栖','临平星桥','临平崇贤','临平乔司','临平超山','临平南站'],
  '余杭':['未来科技城','老余杭','闲林','仓前','瓶窑','径山','良渚','勾庄','仁和','瓶窑'],
  '萧山':['市北','萧山开发区','钱江世纪城','湘湖','萧山老城','南部卧城','新塘','衙前','瓜沥','临浦','义桥','戴村','进化','河上'],
  '拱墅':['运河新城','拱墅老城','申花','祥符','和睦','大关','湖墅','半山','康桥','上塘','三塘','华丰'],
  '西湖':['文教','黄龙','蒋村','三墩','转塘','留下','之江','西溪','古荡','翠苑','文新','申花西路'],
  '上城':['钱江新城','城站','近江','南星桥','望江','采荷','凯旋','笕桥','丁桥','九堡','彭埠','火车东站'],
  '滨江':['滨江区政府','浦沿','西兴','长河','滨和路','滨康路','网易区块','阿里区块'],
  '钱塘':['下沙','大学城北','沿江南','大江东','河庄','义蓬','新湾','临江','前进'],
  '富阳':['富阳城区','银湖','东洲','鹿山','春江','大源','龙门','新登','场口'],
  '临安':['临安主城区','青山湖','锦城','锦北','锦南','玲珑','板桥','太湖源','於潜','昌化']
};
var SK_C='xwg_fkb_clients_v6', SK_P='xwg_fkb_props_v6', SK_T='xwg_fkb_tx_v6', SK_AUTH='xwg_fkb_auth_v6', SK_USER='xwg_fkb_user_v6', SK_MEMO='xwg_fkb_memos_v6', SK_MEMO_DRAFT='xwg_fkb_memo_draft_v6';

/* ========== State ========== */
var S={
  clients:[], properties:[], transactions:[], search:'', filters:{}, propFilters:{}, txFilters:{},
  sort:'smart', propSort:'updatedAt', txSort:'transactionDate', tab:'clients', subtab:'secondhand',
  curClientId:null, curPropId:null, curTxId:null, editClientId:null, editPropId:null, editTxId:null,
  editTags:[], editPhones:[], editAreas:[], editPropTags:[], editAreaSegs:[],
  batchMode:false, batchSel:[],
  propBatchMode:false, checkedPropIds:[],
  mediaList:[], mediaIdx:0, dueReminders:[], currentUser:null, allUsers:[], filterCreatedBy:'', smartClients:[], clientView:'card', pinnedIds:[], propViewMode:'card', smartProps:[], pinnedPropIds:[], smartImages:[], communityDetail:null, communityStatusFilter:'all', memos:[], mdViewers:[], logs:[]
};

/* ========== Storage (本地缓存 + 云端同步) ========== */
var API_BASE='';
var SYNC_ENABLED=true;
var syncTimer=null;

function getAuthHeader(){
  var token=localStorage.getItem(SK_AUTH);
  return token?{'Content-Type':'application/json','Authorization':'Bearer '+token}:{'Content-Type':'application/json'};
}

function loadC(){try{var r=localStorage.getItem(SK_C);if(r)S.clients=JSON.parse(r).map(migrateClient)}catch(e){S.clients=[]}}
function saveC(){markRemindersDirty();try{localStorage.setItem(SK_C,JSON.stringify(S.clients));}catch(e){console.warn('[storage] 客户缓存写入失败',e.message)}syncToServer()}
function loadP(){
  try{
    var r=localStorage.getItem(SK_P);
    if(r)S.properties=JSON.parse(r);
    /* 安全防护：剔除可能残留的旧版MD数据（saveP已不再存MD，但旧缓存可能有） */
    S.properties=(S.properties||[]).filter(function(p){return p.type!=='md';});
  }catch(e){S.properties=[]}
}
/* 房源MD（业主名单）动辄 2 万多条、15MB+，不能塞进 localStorage（会超容量抛错），
   所以本地缓存只保留非 MD 的房源；MD 走按需 /api/md 拉取，常驻内存即可。 */
function saveP(){
  markRemindersDirty();
  try{
    var _nm=(S.properties||[]).filter(function(p){return p.type!=='md';});
    localStorage.setItem(SK_P,JSON.stringify(_nm));
  }catch(e){console.warn('[storage] 房源缓存写入失败(可能超容量)，仅保留内存数据',e.message)}
  syncToServer();
}
function loadT(){try{var r=localStorage.getItem(SK_T);if(r)S.transactions=JSON.parse(r)}catch(e){S.transactions=[]}}
function saveT(){markRemindersDirty();try{localStorage.setItem(SK_T,JSON.stringify(S.transactions));}catch(e){console.warn('[storage] 成交缓存写入失败',e.message)}syncToServer()}
/* --- 备忘录（私有，每用户独立） --- */
function loadMemos(){try{var r=localStorage.getItem(SK_MEMO);if(r)S.memos=JSON.parse(r)}catch(e){S.memos=[]}}
function saveMemos(){localStorage.setItem(SK_MEMO,JSON.stringify(S.memos));syncToServer()}
function addMemo(text){
  if(!text||!text.trim())return;
  S.memos.unshift({id:'m'+Date.now()+Math.random().toString(36).slice(2,8), text:text.trim(), createdAt:Date.now(), userId:S.currentUser?S.currentUser.id:null});
  saveMemos();
  /* 保存成功后清空草稿；未保存关闭时草稿保留以便恢复 */
  try{localStorage.removeItem(SK_MEMO_DRAFT)}catch(e){}
  if(S.tab==='dashboard')renderDashboard();
}
function deleteMemo(id){
  S.memos=S.memos.filter(function(m){return m.id!==id});
  saveMemos();
  renderDashboard();
}
/* 备忘录删除按钮用内联 onclick 调用，必须挂到 window（脚本整体在 IIFE 内，函数默认非全局） */
window.deleteMemo=deleteMemo;


/* --- 删除待同步标记（供服务端按ID删除，避免「保留不在入参里的记录」把已删记录复活） --- */
function markDeleted(kind,id){
  S.pendingDeletes=S.pendingDeletes||{clients:[],properties:[],transactions:[]};
  if(S.pendingDeletes[kind].indexOf(id)<0)S.pendingDeletes[kind].push(id);
}

/* ========== 操作日志（溯源） ========== */
function logAction(action, entityType, entityId, entityName){
  if(!S.currentUser)return;
  S.logs=S.logs||[];
  S.logs.unshift({
    id:uuid(),
    timestamp:now(),
    userId:S.currentUser.id,
    userName:S.currentUser.name,
    action:action,
    entityType:entityType,
    entityId:entityId,
    entityName:entityName||''
  });
  if(S.logs.length>500)S.logs=S.logs.slice(0,500);
}
function actionLabel(action){
  return {create:'新增',edit:'编辑',delete:'删除'}[action]||action;
}
function entityTypeLabel(type){
  return {client:'客户',property:'房源',transaction:'成交'}[type]||type;
}
function logActionText(action,entityType,entityName){
  return actionLabel(action)+entityTypeLabel(entityType)+'「'+entityName+'」';
}

/* --- 云端同步 ---
   debounce 由 1500ms 收紧到 400ms；关键动作（发起/接受合作等）走 syncNow() 立即推送。 */
var SYNC_DEBOUNCE=400;
function doSyncPost(){
  S.pendingDeletes=S.pendingDeletes||{clients:[],properties:[],transactions:[]};
  var data={clients:S.clients,properties:S.properties,transactions:S.transactions,deleted:S.pendingDeletes,memos:S.memos,mdViewers:S.mdViewers,logs:S.logs};
  return fetch(API_BASE+"/api/sync",{
    method:"POST",
    headers:getAuthHeader(),
    body:JSON.stringify(data)
  }).then(function(r){return r.json()}).then(function(d){
    S.syncDirty=false;
    if(d&&d.ok){
      S.pendingDeletes={clients:[],properties:[],transactions:[]};
      S.logs=[]; /* 日志已同步，清空本地缓冲区 */
      if(d.rev)S._lastRev=d.rev;
      console.log("[同步] 数据已同步到云端")
    }
    else if(d&&d.error){console.warn("[同步] 错误:",d.error);if(d.error==="未授权")doLogout()}
    return d;
  }).catch(function(e){S.syncDirty=false;console.warn("[同步] 同步失败（离线模式可用）:",e.message);return null});
}
function syncToServer(){
  if(!SYNC_ENABLED||!S.currentUser)return;
  S.syncDirty=true;
  clearTimeout(syncTimer);
  syncTimer=setTimeout(doSyncPost,SYNC_DEBOUNCE);
}
/* 立即推送（不等 debounce），用于合作邀请等需要秒达的动作 */
function syncNow(){
  if(!SYNC_ENABLED||!S.currentUser)return Promise.resolve(null);
  clearTimeout(syncTimer);S.syncDirty=true;
  return doSyncPost();
}

function loadFromServer(){
  var token=localStorage.getItem(SK_AUTH);
  if(!token)return Promise.resolve(null);
  var timeout=new Promise(function(res){setTimeout(function(){res(null)},30000)});
  var req=fetch(API_BASE+'/api/sync',{headers:getAuthHeader()}).then(function(r){
    if(!r.ok){if(r.status===401){doLogout();throw new Error('未授权')}throw new Error('HTTP '+r.status)}
    return r.json();
  }).then(function(d){
    if(d&&d.clients){
      if(d.allUsers)S.allUsers=d.allUsers;
      if(d.mdViewers)S.mdViewers=d.mdViewers;
      if(d.logs)S.logs=d.logs; /* 从服务端加载日志 */
      return d;
    }
    return null;
  }).catch(function(e){
    console.warn('[同步] 无法连接服务器:',e.message);
    return null;
  });
  return Promise.race([req,timeout]);
}

/* 周期性从云端拉取（让成员实时看到他人更新，如合作邀请）
   用 S.syncDirty 保护：本地方有未同步改动时不覆盖，避免丢失编辑。 */
function isInteracting(){
  try{
    if(document.querySelector('.modal.show'))return true;
    if(document.querySelector('.quick-followup.show'))return true;
  }catch(e){}
  return false;
}
/* ========== 房源MD（业主名单）按需「筛选拉取」 ==========
   业主名单 2 万多条、15MB+，绝不能一次性拉进浏览器——
   旧方案把全部 22k 拉进内存（首屏 4s+ / 占 9MB），导致进 MD 页要等 10 秒以上。
   正确做法：MD 页只展示「当前筛选条件下」的名单（上限 400 条），随筛随查、服务端过滤，
   单次要拉的数据仅 ~150KB、耗时 <0.6s；变更（上架/删除）经 saveP→/api/sync upsert 落库
   （服务端按 id 合并，不会误删其余 2 万条）。小区列表另走轻量的 /api/md/communities。 */
/* 把「筛选拉回的业主名单子集」合入 S.properties 的 md 记录（替换旧的 md，保留非 md 的房源/联动房源） */
function mergeMDSubset(items){
  var mdMap={}; (items||[]).forEach(function(m){ mdMap[m.id]=m; });
  var out=[];
  (S.properties||[]).forEach(function(p){
    if(p.type==='md'){
      if(mdMap[p.id]){ out.push(mdMap[p.id]); delete mdMap[p.id]; } /* 用服务端最新覆盖本地 */
    } else out.push(p); /* 非 md（二手/租赁/新盘/联动房源）原样保留 */
  });
  Object.keys(mdMap).forEach(function(id){ out.push(mdMap[id]); });
  S.properties=out; S._mdLoaded=true;
}
/* 拉取「当前筛选」对应的业主名单子集（服务端过滤）塞进 S.properties 的 md 记录，
   回调返回 {items,total,listed}；用 S._mdReqSeq 防乱序响应覆盖。 */
function fetchMDSubset(f, cb){
  cb=cb||function(){};
  var seq=(S._mdReqSeq=(S._mdReqSeq||0)+1);
  var q=[];
  if(f.community)q.push('community='+encodeURIComponent(f.community));
  if(f.room)q.push('keyword='+encodeURIComponent(f.room));
  if(f.onlyListed)q.push('onlyListed=1');
  q.push('page=1'); q.push('pageSize=400');
  var url=API_BASE+'/api/md?'+q.join('&');
  fetch(url,{headers:getAuthHeader()})
    .then(function(r){ if(!r.ok){ if(r.status===401){doLogout();throw new Error('未授权');} throw new Error('HTTP '+r.status);} return r.json(); })
    .then(function(d){
      if(seq!==S._mdReqSeq) return; /* 已有更新的请求，丢弃本次陈旧结果 */
      var items=(d&&d.items)||[];
      mergeMDSubset(items);
      S._mdDisplay=items;
      S._mdTotal=(d&&typeof d.total!=='undefined')?d.total:items.length;
      S._mdListed=(d&&typeof d.listed!=='undefined')?d.listed:0;
      cb(null,{items:items,total:S._mdTotal,listed:S._mdListed});
    })
    .catch(function(e){ if(seq!==S._mdReqSeq)return; console.error('[fetchMDSubset]',e); cb(e); });
}

/* 轻量版本探测：每 5s 只请求 /api/rev（几十字节），rev 变化才做全量拉取，
   兼顾「秒级收到合作邀请」和「不给服务器压力」。 */
function checkRev(){
  if(!SYNC_ENABLED||!S.currentUser)return;
  if(S.syncDirty)return;
  if(document.hidden)return;                 // 页面在后台不轮询，省流量省电
  fetch(API_BASE+"/api/rev",{headers:getAuthHeader()})
    .then(function(r){return r.ok?r.json():null})
    .then(function(d){
      if(!d||typeof d.rev!=="number")return;
      if(S._lastRev===undefined){S._lastRev=d.rev;return}
      if(d.rev!==S._lastRev){S._lastRev=d.rev;periodicPull()}
    }).catch(function(){});
}
/* 合并本地与服务端数据：按 id upsert，updatedAt 冲突取较新者；
   本地有而服务端没有的（刚新增还没上传上去的，如刚打的带看）予以保留，
   避免 periodicPull 整体替换把本地未同步的新增改动吞掉。 */
function mergeById(localArr, serverArr, migrateFn){
  var lmap={};
  (localArr||[]).forEach(function(x){ if(x&&x.id) lmap[x.id]=x; });
  var out=[];
  (serverArr||[]).forEach(function(sv){
    var m = migrateFn?migrateFn(sv):sv;
    var l = lmap[m.id];
    if(l){ out.push((l.updatedAt||0)>=(m.updatedAt||0)?l:m); delete lmap[m.id]; }
    else { out.push(m); }
  });
  Object.keys(lmap).forEach(function(id){ out.push(lmap[id]); }); /* 保留本地独有（新增未同步） */
  return out;
}
function _collSig(arr){var m=0,n=0;for(var i=0;i<arr.length;i++){var p=arr[i];if(!p||p.type==='md')continue;n++;var u=p.updatedAt||0;if(u>m)m=u;}return n+'|'+m;}
function periodicPull(){
  if(!SYNC_ENABLED||!S.currentUser)return;
  if(S.syncDirty)return; // 本地有未同步改动，跳过本周期
  var before=(typeof getPendingCollabInvites==="function")?getPendingCollabInvites().length:0;
  loadFromServer().then(function(serverData){
    if(serverData&&serverData.clients){
      var _tab=S.tab;
      var _sigB=_tab==='clients'?_collSig(S.clients):_tab==='properties'?_collSig(S.properties):_tab==='transactions'?_collSig(S.transactions):null;
      S.clients=mergeById(S.clients, serverData.clients, migrateClient);
      S.properties=mergeById(S.properties, serverData.properties, null);
      S.transactions=mergeById(S.transactions, serverData.transactions, null);
      /* 删除传播：服务端已删的记录，从本地（含本地独有副本）移除 */
      var _del=serverData.deleted||{};
      if(_del.clients&&_del.clients.length)S.clients=S.clients.filter(function(c){return _del.clients.indexOf(c.id)<0});
      if(_del.properties&&_del.properties.length)S.properties=S.properties.filter(function(p){return _del.properties.indexOf(p.id)<0});
      if(_del.transactions&&_del.transactions.length)S.transactions=S.transactions.filter(function(t){return _del.transactions.indexOf(t.id)<0});
      /* 备忘录：服务端直接替换（每用户独立，无需 upsert） */
      if(serverData.memos&&Array.isArray(serverData.memos)){S.memos=serverData.memos;}
      /* 只写本地缓存，不再触发一次反向 POST（原来 saveC/saveP/saveT 会引发多余的整库回传）；房源剥离 MD 防御 */
      try{
        localStorage.setItem(SK_C,JSON.stringify(S.clients));
        localStorage.setItem(SK_P,JSON.stringify((S.properties||[]).filter(function(p){return p.type!=='md';})));
        localStorage.setItem(SK_T,JSON.stringify(S.transactions));
        localStorage.setItem(SK_MEMO,JSON.stringify(S.memos));
      }catch(e){}
      if(typeof serverData.rev==="number")S._lastRev=serverData.rev;
      if(serverData.allUsers&&serverData.allUsers.length)S.allUsers=serverData.allUsers;
      S.mdViewers=serverData.mdViewers||S.mdViewers;
      markRemindersDirty(); /* 云端数据已变，提醒缓存失效 */
      try{
        var _sigA=_tab==='clients'?_collSig(S.clients):_tab==='properties'?_collSig(S.properties):_tab==='transactions'?_collSig(S.transactions):null;
        /* 渲染守卫：当前视图数据未变则不重渲网格，避免管理员改别的数据时非管理员反复重渲卡顿 */
        if(_sigB!==_sigA){
          if(_tab==='clients'){updateCollabBadge(); if(!isInteracting())renderClientList();}
          else if(_tab==='properties'){if(!isInteracting())renderPropertyList();}
          else if(_tab==='transactions'){if(!isInteracting())renderTxList();}
        } else { updateCollabBadge(); }
      }catch(e){}
      // 非管理员：若拉到新的合作邀请，弹提示（横幅已在 renderClientList 内更新）
      if(S.currentUser&&!isAdmin()){
        var after=getPendingCollabInvites().length;
        if(after>before){toast("📨 你收到 "+after+" 条客户合作邀请，去「客户」页查看","info")}
      }
      updateNotifBadge();
    }
  }).catch(function(){});
}

/* ========== Auth ========== */
function isLoggedIn(){return!!S.currentUser}
function isAdmin(){return S.currentUser&&S.currentUser.role==='admin'}
/* 房源MD（业主名单）：仅管理员 + 被授权成员可见；名单内容在云端已对非授权成员剥离 */
function canViewMD(){return isAdmin()||!!(S.currentUser&&S.mdViewers&&S.mdViewers.indexOf(S.currentUser.id)>=0)}
function grantMDView(uid){
  if(!isAdmin()){toast('仅管理员可授权','error');return}
  S.mdViewers=S.mdViewers||[];
  if(S.mdViewers.indexOf(uid)<0){S.mdViewers.push(uid);saveP();syncNow();toast('已授权查看房源MD','success')}
}
function revokeMDView(uid){
  if(!isAdmin()){toast('仅管理员可操作','error');return}
  S.mdViewers=S.mdViewers||[];
  var i=S.mdViewers.indexOf(uid);
  if(i>=0){S.mdViewers.splice(i,1);saveP();syncNow();toast('已取消授权','success')}
}

/* ========== 客户合作机制 ========== */
/* 客户 c.collabs = [{userId,userName,status:'pending'|'accepted',invitedBy,invitedByName,invitedAt,acceptedAt}] */
function isClientOwner(c){return !!(S.currentUser&&c&&c.createdBy&&c.createdBy===S.currentUser.id)}
function getCollabs(c){return (c&&Array.isArray(c.collabs))?c.collabs:[]}
function isClientCollaborator(c){
  if(!S.currentUser||!c)return false;
  var uid=S.currentUser.id;
  return getCollabs(c).some(function(x){return x.userId===uid&&x.status==='accepted'});
}
function hasPendingCollab(c){
  if(!S.currentUser||!c)return false;
  var uid=S.currentUser.id;
  return getCollabs(c).some(function(x){return x.userId===uid&&x.status==='pending'});
}
/* 可查看：管理员 / 录入人 / 已接收的合作人 */
function canAccessClient(c){return isAdmin()||isClientOwner(c)||isClientCollaborator(c)}

/* ===== 权限模型：删除仅管理员；修改限录入人/已接收合作人；无时间锁 ===== */
/* 可编辑客户：管理员 / 录入人 / 已接收合作人 */
function canEditClient(c){
  if(isAdmin())return true;
  if(!c||!S.currentUser)return false;
  return isClientOwner(c)||isClientCollaborator(c);
}
/* 可删除客户：仅管理员（普通成员只能标记无效，不能删除） */
function canDeleteClient(c){return isAdmin()}
/* 管理员参与的客户（管理员录入，或已接受合作的管理员）→ 联系电话对非管理员只读 */
function adminInvolvedClient(c){
  if(!c)return false;
  if(c.createdBy==='admin')return true;
  return getCollabs(c).some(function(x){return (x.userId==='admin'||x.invitedBy==='admin')&&x.status==='accepted'});
}
/* 可编辑客户联系电话：管理员任意；管理员参与的非管理员只读；其余走 canEditClient */
function canEditClientPhone(c){
  if(isAdmin())return true;
  if(!c||!S.currentUser)return false;
  if(adminInvolvedClient(c))return false;
  return canEditClient(c);
}
/* 房源：可编辑=管理员或录入人；可删除=仅管理员 */
function canEditProp(p){
  if(isAdmin())return true;
  if(!p||!S.currentUser)return false;
  return isOwnProperty(p);
}
function canDeleteProp(p){return isAdmin()}
/* 无效机制：客户=录入人或管理员直接标记；房源=录入人或管理员可发起（非管理员→待管理员审核） */
function canMarkClientInvalid(c){return isAdmin()||isClientOwner(c)}
function canRequestPropInvalid(p){return isAdmin()||isOwnProperty(p)}
/* 客户：录入人/管理员标记无效（二次确认）；管理员可恢复 */
function markClientInvalid(clientId){
  var c=findClient(clientId);if(!c)return;
  if(!canMarkClientInvalid(c)){toast('无权限','error');return}
  confirmDialog('标记为无效','确定将客户「'+c.name+'」标记为无效吗？标记后将在列表中置灰并可在筛选中隐藏。',function(){
    c.invalid=true;c.invalidAt=now();c.invalidBy=S.currentUser?S.currentUser.id:'';c.updatedAt=now();saveC();
    toast('已标记为无效','success');closeModal('clientDetailModal');renderClientList();
  });
}
function restoreClientInvalid(clientId){
  var c=findClient(clientId);if(!c)return;
  if(!isAdmin()){toast('仅管理员可恢复','error');return}
  confirmDialog('恢复有效','确定将该客户恢复为有效状态吗？',function(){
    c.invalid=false;c.invalidAt=null;c.invalidBy=null;c.updatedAt=now();saveC();
    toast('已恢复为有效','success');closeModal('clientDetailModal');renderClientList();
  });
}
/* 房源：录入人/管理员提交无效申请；管理员直接生效或审批待审请求 */
function requestPropInvalid(propId){
  var p=findProp(propId);if(!p)return;
  if(!canRequestPropInvalid(p)){toast('无权限','error');return}
  if(isAdmin()){
    confirmDialog('标记为无效','确定将房源「'+p.title+'」标记为无效吗？',function(){
      p.invalid=true;p.invalidAt=now();p.invalidBy='admin';p.invalidPending=null;saveP();
      toast('已标记为无效','success');closeModal('propDetailModal');renderPropertyList();
    });
    return;
  }
  confirmDialog('申请无效','确定向管理员申请将房源「'+p.title+'」标记为无效吗？需管理员审核通过后生效。',function(){
    p.invalidPending={by:S.currentUser?S.currentUser.id:'',byName:S.currentUser?S.currentUser.name:'',at:now(),status:'pending'};
    p.updatedAt=now();saveP();
    toast('已提交无效申请，等待管理员审核','success');closeModal('propDetailModal');renderPropertyList();
  });
}
function restorePropInvalid(propId){
  var p=findProp(propId);if(!p)return;
  if(!isAdmin()){toast('仅管理员可恢复','error');return}
  confirmDialog('恢复有效','确定将该房源恢复为有效状态吗？',function(){
    p.invalid=false;p.invalidAt=null;p.invalidBy=null;p.invalidPending=null;p.updatedAt=now();saveP();
    toast('已恢复为有效','success');closeModal('propDetailModal');renderPropertyList();
  });
}
function approvePropInvalid(propId){
  var p=findProp(propId);if(!p)return;
  if(!isAdmin()){toast('仅管理员可审核','error');return}
  confirmDialog('通过无效申请','确定通过该房源的无效申请吗？',function(){
    p.invalid=true;p.invalidAt=now();p.invalidBy='admin';p.invalidPending=null;saveP();
    toast('已通过，房源标记为无效','success');closeModal('propDetailModal');renderPropertyList();
  });
}
function rejectPropInvalid(propId){
  var p=findProp(propId);if(!p)return;
  if(!isAdmin()){toast('仅管理员可审核','error');return}
  confirmDialog('拒绝无效申请','确定拒绝该房源的无效申请吗？',function(){
    p.invalidPending=null;p.updatedAt=now();saveP();
    toast('已拒绝无效申请','success');closeModal('propDetailModal');renderPropertyList();
  });
}
/* 我收到的全部待处理合作邀请 */
function getPendingCollabInvites(){
  if(!S.currentUser)return[];
  var uid=S.currentUser.id;
  return S.clients.filter(function(c){
    return getCollabs(c).some(function(x){return x.userId===uid&&x.status==='pending'});
  });
}
/* 合作人名单（已接收），用于详情展示 */
function collabNames(c){
  return getCollabs(c).filter(function(x){return x.status==='accepted'})
    .map(function(x){return x.userName||'未知'});
}

function checkAuthStatus(){
  return fetch(API_BASE+'/api/auth/status').then(function(r){return r.json()}).then(function(d){
    return d.needSetup;
  }).catch(function(){return false});
}

function doLogin(username,password){
  return fetch(API_BASE+'/api/auth/login',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:username,password:password})
  }).then(function(r){return r.json()});
}

function doSetup(username,password,name,phone){
  return fetch(API_BASE+'/api/auth/setup',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:username,password:password,name:name,phone:phone})
  }).then(function(r){return r.json()});
}

function doLogout(){
  localStorage.removeItem(SK_AUTH);
  localStorage.removeItem(SK_USER);
  localStorage.removeItem(SK_C);localStorage.removeItem(SK_P);localStorage.removeItem(SK_T);
  S.currentUser=null;S.clients=[];S.properties=[];S.transactions=[];S.memos=[];S.allUsers=[];S.mdViewers=[];
  showLoginScreen();
}

function showLoginScreen(){
  // 关键：先同步显示登录页，绝不等待任何网络请求（避免弱网/服务端慢时白屏等待）
  var ov=document.getElementById('lockOverlay');
  if(ov)ov.style.display='flex';
  checkAuthStatus().then(function(needSetup){
    var isSetup=needSetup;
    document.getElementById('lockSubtitle').textContent=isSetup?'首次使用，请创建管理员账号':'请登录';
    document.getElementById('lockUnlockBtn').textContent=isSetup?'创建管理员':'登录';

    // 显示/隐藏字段
    var nameGroup=document.getElementById('lockNameGroup');
    var phoneGroup=document.getElementById('lockPhoneGroup');
    var userGroup=document.getElementById('lockUsernameGroup');
    var pwConfirmGroup=document.getElementById('lockPwConfirmGroup');
    var pwGroup=document.getElementById('lockPwGroup');
    if(nameGroup)nameGroup.style.display=isSetup?'':'none';
    if(phoneGroup)phoneGroup.style.display=isSetup?'':'none';
    if(userGroup)userGroup.style.display='';
    if(pwGroup)pwGroup.style.display='';
    if(pwConfirmGroup)pwConfirmGroup.style.display=isSetup?'':'none';

    document.getElementById('lockHint').textContent=isSetup?'管理员可管理全部数据，并授权其他人使用':'联系管理员获取账号';
    document.getElementById('lockError').textContent='';
    document.getElementById('lockPassword').value='';
    var lu=document.getElementById('lockUsername');if(lu)lu.value='';
    var lp=document.getElementById('lockPhone');if(lp)lp.value='';
    var ln=document.getElementById('lockName');if(ln)ln.value='';
    var lpw=document.getElementById('lockPasswordConfirm');if(lpw)lpw.value='';
    setTimeout(function(){if(lu)lu.focus();else document.getElementById('lockPassword').focus()},100);
  }).catch(function(){
    // 网络异常也不影响登录页展示（已在上方同步显示）
  });
}

function hideLoginScreen(){document.getElementById('lockOverlay').style.display='none'}

function tryAuth(){
  var username=((document.getElementById('lockUsername')||{}).value||'').trim();
  var pw=(document.getElementById('lockPassword').value||'').trim();
  var errEl=document.getElementById('lockError');
  if(!username){errEl.textContent='请输入用户名';return}
  if(!pw){errEl.textContent='请输入密码';return}

  // 检查是否首次设置
  var isSetup=document.getElementById('lockPwConfirmGroup').style.display!=='none';
  if(isSetup){
    var name=(document.getElementById('lockName')||{}).value||'管理员';
    var phone=(document.getElementById('lockPhone')||{}).value||'';
    var cf=(document.getElementById('lockPasswordConfirm')||{}).value;
    if(pw.length<4){errEl.textContent='密码至少4位';return}
    if(pw!==cf){errEl.textContent='两次输入不一致';return}
    errEl.textContent='正在创建管理员账号…';
    doSetup(username,pw,name,phone).then(function(d){
      if(d.ok){
        localStorage.setItem(SK_AUTH,d.token);localStorage.setItem(SK_USER,JSON.stringify(d.user));
        S.currentUser=d.user;
        hideLoginScreen();
        toast('管理员账号创建成功','success');
        initAfterLogin();
      }else{
        errEl.textContent=d.error||'创建失败';
      }
    }).catch(function(){errEl.textContent='网络错误，请重试'});
  }else{
    errEl.textContent='正在登录…';
    doLogin(username,pw).then(function(d){
      if(d.ok){
        localStorage.setItem(SK_AUTH,d.token);localStorage.setItem(SK_USER,JSON.stringify(d.user));
        S.currentUser=d.user;
        hideLoginScreen();
        toast('登录成功，欢迎回来，'+d.user.name,'success');
        initAfterLogin();
      }else{
        errEl.textContent=d.error||'登录失败';
        document.getElementById('lockPassword').value='';
      }
    }).catch(function(){errEl.textContent='网络错误，请重试'});
  }
}

/* --- 用户管理 --- */
function loadUsers(){
  return fetch(API_BASE+'/api/users',{headers:getAuthHeader()}).then(function(r){return r.json()}).then(function(d){
    if(Array.isArray(d)){S.allUsers=d;return d}
    return[];
  }).catch(function(){return[]});
}

function addUser(username,password,name,phone){
  return fetch(API_BASE+'/api/users',{
    method:'POST',
    headers:getAuthHeader(),
    body:JSON.stringify({username:username,password:password,name:name,phone:phone})
  }).then(function(r){return r.json()});
}

function deleteUser(id){
  return fetch(API_BASE+'/api/users/'+encodeURIComponent(id),{
    method:'DELETE',
    headers:getAuthHeader()
  }).then(function(r){return r.json()});
}

function toggleUserStatus(id,active){
  return fetch(API_BASE+'/api/users/'+encodeURIComponent(id),{
    method:'PUT',
    headers:getAuthHeader(),
    body:JSON.stringify({active:active})
  }).then(function(r){return r.json()});
}

function renderUserList(){
  loadUsers().then(function(users){
    var listEl=document.getElementById('memberList');
    if(!listEl)return;
    if(users.length<=1){
      listEl.innerHTML='<p style="text-align:center;padding:20px;color:var(--gray-400);font-size:.875rem">暂无其他成员，在下方添加</p>';
      return;
    }
    listEl.innerHTML=users.filter(function(u){return u.role!=='admin'}).map(function(u){
      return'<div class="settings-item" style="cursor:default">'
        +'<div class="icon '+(u.active?'green':'gray')+'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>'
        +'<div class="text"><div class="title">'+esc(u.name)+' <span class="user-role-badge">'+(u.active?'活跃':'已停用')+'</span> <span style="font-size:.8125rem;color:var(--gray-400)">'+u.clientCount+'个客户</span></div>'
        +'<div class="desc">'+esc(u.username)+(u.phone?' · '+esc(u.phone):'')+'</div></div>'
        +'<div style="display:flex;gap:6px;flex-shrink:0">'
        +'<button class="btn btn-outline" style="padding:4px 10px;font-size:.8125rem" onclick="toggleMemberStatus(\''+u.id+'\','+(u.active?'false':'true')+')">'+(u.active?'停用':'启用')+'</button>'
        +'<button class="btn btn-outline" style="padding:4px 10px;font-size:.8125rem;color:var(--danger)" onclick="removeMember(\''+u.id+'\')">删除</button>'
        +'</div></div>';
    }).join('');
    // Store users for global access
    S._memberList=users;
  });
}

window.toggleMemberStatus=function(id,active){
  toggleUserStatus(id,active).then(function(d){
    if(d.ok){toast(active?'已启用':'已停用','success');renderUserList()}
    else{toast(d.error||'操作失败','error')}
  });
};
window.resetMemberPw=function(id){
  confirmDialog('重置密码','将为该成员生成一个随机新密码并显示。确定？',function(){
    fetch(API_BASE+'/api/users/'+encodeURIComponent(id)+'/reset-password',{method:'PUT',headers:getAuthHeader()})
    .then(function(r){return r.json()})
    .then(function(d){
      if(d&&d.ok){toast('密码已重置：'+(d.newPassword||''),'success',5000);renderUserList()}
      else{toast((d&&d.error)||'重置失败','error')}
    })
    .catch(function(){toast('网络错误','error')});
  });
};
window.removeMember=function(id){
  confirmDialog('删除成员','删除后该成员将无法登录，但已录入的客户数据保留。确定删除？',function(){
    deleteUser(id).then(function(d){
      if(d.ok){toast('成员已删除','success');renderUserList()}
      else{toast(d.error||'删除失败','error')}
    });
  });
};
function migrateClient(c){
  if(c.phones)return c;
  return{id:c.id,name:c.name,phones:[{label:'手机',number:c.phone||''}],wechat:c.wechat||'',gender:c.gender||'未知',source:c.source||'自来客',grade:c.grade||'B',purpose:c.purpose||'刚需',propertyType:c.propertyType||'住宅',unitType:c.unitType||'不限',budgetMin:c.budgetMin||0,budgetMax:c.budgetMax||0,targetAreas:c.targetAreas||[],requirements:c.requirements||'',status:c.status||'待联系',notes:c.notes||'',customTags:[],followUps:c.followUps||[],viewings:[],referrals:[],createdAt:c.createdAt||now(),updatedAt:c.updatedAt||now()};
}

/* ========== MediaDB (IndexedDB + 云端同步) ========== */
var MediaDB=(function(){
  var db=null;
  function init(){return new Promise(function(resolve){
    try{var req=indexedDB.open('xwg_media_db',1);
      req.onupgradeneeded=function(e){db=e.target.result;if(!db.objectStoreNames.contains('media'))db.createObjectStore('media',{keyPath:'id'})};
      req.onsuccess=function(e){db=e.target.result;resolve()};
      req.onerror=function(){resolve()};
    }catch(err){resolve()}
  })}
  function save(m){return new Promise(function(resolve){
    if(!db){resolve();return}
    var tx=db.transaction(['media'],'readwrite');tx.objectStore('media').put(m);
    tx.oncomplete=function(){
      /* raw 文件已经通过 upload-raw 上传到服务器，不需要再同步 base64 */
      if(SYNC_ENABLED&&S.currentUser&&!m.isRawFile){
        fetch(API_BASE+'/api/media',{
          method:'POST',
          headers:getAuthHeader(),
          body:JSON.stringify(m)
        }).then(function(r){return r.json()}).then(function(d){
          if(d&&d.ok)console.log('[媒体] 已上传:',m.id)
        }).catch(function(e){console.warn('[媒体] 上传失败:',e.message)});
      }
      resolve()
    };tx.onerror=function(){resolve()}
  })}
  function list(pid){return new Promise(function(resolve){
    if(!db){resolve([]);return}
    var tx=db.transaction(['media'],'readonly');var req=tx.objectStore('media').openCursor();var r=[];
    req.onsuccess=function(e){var c=e.target.result;if(c){if(c.value.propertyId===pid)r.push(c.value);c.continue()}else{
      if(r.length>0){
        resolve(r)
      }else{
        listFromServer(pid).then(resolve)
      }
    }};
    req.onerror=function(){resolve([])}
  })}
  function listFromServer(pid){
    if(!SYNC_ENABLED||!S.currentUser)return Promise.resolve([]);
    return fetch(API_BASE+'/api/media/list/'+encodeURIComponent(pid),{headers:getAuthHeader()}).then(function(r){
      if(!r.ok)throw new Error('HTTP '+r.status);
      return r.json()
    }).then(function(items){
      if(items&&items.length>0){
        if(db){
          var tx=db.transaction(['media'],'readwrite');
          var store=tx.objectStore('media');
          items.forEach(function(item){store.put(item)});
        }
        console.log('[媒体] 从云端拉取',items.length,'个文件');
        return items
      }
      return []
    }).catch(function(e){
      console.warn('[媒体] 从云端拉取失败:',e.message);
      return []
    })
  }
  function remove(id){return new Promise(function(resolve){
    if(!db){resolve();return}
    var tx=db.transaction(['media'],'readwrite');tx.objectStore('media').delete(id);
    tx.oncomplete=function(){
      if(SYNC_ENABLED&&S.currentUser){
        fetch(API_BASE+'/api/media/'+encodeURIComponent(id),{method:'DELETE',headers:getAuthHeader()})
          .catch(function(e){console.warn('[媒体] 云端删除失败:',e.message)});
      }
      resolve()
    };tx.onerror=function(){resolve()}
  })}
  function removeAll(pid){
    return list(pid).then(function(items){
      return Promise.all(items.map(function(i){return remove(i.id)}))
    }).then(function(){
      if(SYNC_ENABLED&&S.currentUser){
        return fetch(API_BASE+'/api/media/removeAll/'+encodeURIComponent(pid),{method:'DELETE',headers:getAuthHeader()})
          .catch(function(e){console.warn('[媒体] 批量删除失败:',e.message)})
      }
    })
  }
  return{init:init,save:save,list:list,remove:remove,removeAll:removeAll,listFromServer:listFromServer}
})();

/* ========== Utils ========== */
function uuid(){return'x'+Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function now(){return Date.now()}
function pad(n){return n<10?('0'+n):n}
function fmtDate(ts){if(!ts)return'—';var d=new Date(ts);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function fmtDateTime(ts){if(!ts)return'—';var d=new Date(ts);return fmtDate(ts)+' '+pad(d.getHours())+':'+pad(d.getMinutes())}
function fmtBudget(min,max){if(!min&&!max)return'不限';if(min&&max)return min+'-'+max+'万';if(min)return min+'万以上';return max+'万以下'}
function esc(s){if(!s)return'';return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]})}
function truncateText(s,n){if(!s)return'';s=String(s);if(s.length<=n)return s;return s.substring(0,n)+'…'}
/* CSV 导出 */
function csvEscape(val){if(val==null||val===undefined)return'';var s=String(val);if(s.indexOf(',')>=0||s.indexOf('"')>=0||s.indexOf('\n')>=0||s.indexOf('\r')>=0)return'"'+s.replace(/"/g,'""')+'"';return s;}
function exportCSV(rows,columns,filename){
  if(!rows||!rows.length){toast('无数据可导出','warn');return;}
  var BOM='\uFEFF'; // Excel 识别 UTF-8 中文
  var header=columns.map(function(c){return csvEscape(c.label)}).join(',');
  var body=rows.map(function(r){return columns.map(function(c){return csvEscape(typeof c.val==='function'?c.val(r):(r[c.val]||''))}).join(',')}).join('\n');
  var csv=BOM+header+'\n'+body;
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');a.href=url;a.download=filename;a.click();
  URL.revokeObjectURL(url);
}
/* 按当前筛选结果导出 */
function exportCurrentCSV(type){
  if(!isAdmin()){toast('仅管理员可导出数据','error');return;}
  var curUid=S.currentUser?S.currentUser.id:null;
  if(type==='clients'){
    var list=getFilteredClients();
    if(!isAdmin()) list=list.filter(function(c){return c.createdBy===curUid});
    var cols=[
      {label:'姓名',val:function(r){return r.name}},
      {label:'电话',val:function(r){return (r.phones||[]).map(function(p){return p.number}).join(';')}},
      {label:'等级',val:'grade'},{label:'状态',val:'status'},{label:'来源',val:'source'},
      {label:'购房目的',val:'purpose'},{label:'户型需求',val:'unitType'},
      {label:'预算(万)',val:function(r){return fmtBudget(r.budgetMin,r.budgetMax)}},
      {label:'目标区域',val:function(r){return (r.targetAreas||[]).join(';')}},
      {label:'合作人',val:function(r){return (r.collabs||[]).map(function(x){return x.userName}).join(';')}},
      {label:'创建人',val:'createdByName'},{label:'创建时间',val:function(r){return fmtDate(r.createdAt)}},
      {label:'最后跟进',val:function(r){var lf=lastFollowup(r);return lf?fmtDate(lf):'未跟进'}},
      {label:'无效',val:function(r){return r.invalid?'是':'否'}}
    ];
    exportCSV(list,cols,'客户列表_'+fmtDate(Date.now())+'.csv');
  }else if(type==='properties'){
    var propList=getFilteredProperties();
    var cols=[
      {label:'类型',val:function(r){var m={secondhand:'二手房',rental:'租赁',newdev:'新楼盘',md:'业主名单'};return m[r.type]||r.type}},
      {label:'小区',val:'community'},{label:'楼幢',val:'building'},{label:'单元',val:'unit'},{label:'房号',val:'room'},
      {label:'面积',val:function(r){return r.area?r.area+'㎡':''}},
      {label:'户型',val:function(r){return (r.layout||'')+'/'+(r.bedrooms||'')+'室'+(r.livingrooms||'')+'厅'}},
      {label:'楼层',val:function(r){return r.floor?r.floor+'/'+r.totalFloor:''}},
      {label:'总价(万)',val:'totalPrice'},{label:'单价',val:'averagePrice'},
      {label:'状态',val:'status'},{label:'朝向',val:'orientation'},{label:'装修',val:'decoration'},
      {label:'创建人',val:'createdByName'},{label:'创建时间',val:function(r){return fmtDate(r.createdAt)}}
    ];
    exportCSV(propList,cols,'房源列表_'+fmtDate(Date.now())+'.csv');
  }else if(type==='transactions'){
    var txList=S.transactions.slice();
    if(!isAdmin()) txList=txList.filter(function(t){return t.createdBy===curUid});
    var typeMap={newdev:'新房',secondhand:'二手房'};
    txList.sort(function(a,b){return(b.transactionDate||0)-(a.transactionDate||0)});
    var cols=[
      {label:'客户',val:'clientName'},{label:'房源',val:'propertyTitle'},
      {label:'成交类型',val:function(r){return typeMap[r.dealType]||r.dealType}},
      {label:'成交价(万)',val:'transactionPrice'},{label:'佣金',val:'commission'},
      {label:'成交日期',val:function(r){return fmtDate(r.transactionDate)}},
      {label:'录入人',val:'createdByName'}
    ];
    exportCSV(txList,cols,'成交记录_'+fmtDate(Date.now())+'.csv');
  }
}
function trimEmpty(s){return s?s.replace(/^\s+|\s+$/g,''):''}
function daysSince(ts){if(!ts)return 999;return Math.floor((Date.now()-ts)/86400000)}
function relDate(ts){if(!ts)return'—';var d=daysSince(ts);if(d===0)return'今天';if(d===1)return'昨天';if(d<7)return d+'天前';if(d<30)return Math.floor(d/7)+'周前';return fmtDate(ts)}
function tomorrowStr(){var d=new Date(Date.now()+86400000);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function lastFollowup(c){if(!c.followUps||!c.followUps.length)return null;var l=0;c.followUps.forEach(function(f){if(f.date>l)l=f.date});return l}
function needFollowup(c){var l=lastFollowup(c)||c.updatedAt||c.createdAt;if(c.status==='已成交'||c.status==='暂缓')return false;return daysSince(l)>=7}
function updateFilterBadge(toggleId,filters){
  var toggle=document.getElementById(toggleId);if(!toggle)return;
  var count=0;for(var k in filters){if(filters[k])count++}
  var badge=toggle.querySelector('.filter-badge');
  if(!badge){badge=document.createElement('span');badge.className='filter-badge';var span=toggle.querySelector('span');if(span)span.appendChild(badge)}
  badge.textContent=count;badge.style.display=count>0?'inline-flex':'none';
}
function findClient(id){return S.clients.find(function(c){return c.id===id})}
function findProp(id){return S.properties.find(function(p){return p.id===id})}
function closeModal(id){var el=document.getElementById(id);if(el)el.classList.remove('show')}
/* 全局关闭委托：无论 setupHandlers 是否中途报错、弹窗是否由 JS 动态生成，关闭/× 都生效 */
if(!window.__globalCloseBound){
  window.__globalCloseBound=true;
  document.addEventListener('click',function(e){
    var cl=e.target.closest?e.target.closest('[data-close]'):null;
    if(cl){closeModal(cl.getAttribute('data-close'));return;}
    if(e.target.classList&&e.target.classList.contains('modal-overlay')){e.target.classList.remove('show');}
  });
}

var toastTimer;
function toast(msg,type){var el=document.getElementById('toast');el.textContent=msg;el.className='toast show'+(type?' '+type:'');clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.className='toast'},2500)}

function confirmDialog(title,msg,cb){
  document.getElementById('confirmTitle').textContent=title;
  document.getElementById('confirmMsg').innerHTML=msg; /* 改 innerHTML：支持按钮/输入框等富交互内容 */
  document.getElementById('confirmOverlay').classList.add('show');
  var ok=document.getElementById('confirmOK'),cancel=document.getElementById('confirmCancel');
  var onOK=function(){document.getElementById('confirmOverlay').classList.remove('show');ok.removeEventListener('click',onOK);cancel.removeEventListener('click',onCancel);cb()};
  var onCancel=function(){document.getElementById('confirmOverlay').classList.remove('show');ok.removeEventListener('click',onOK);cancel.removeEventListener('click',onCancel)};
  ok.addEventListener('click',onOK);cancel.addEventListener('click',onCancel)
}

/* ========== Image Compression ========== */
function compressImage(file,maxW,quality,cb){
  var reader=new FileReader();
  reader.onload=function(e){
    var img=new Image();
    img.onload=function(){
      var w=img.width,h=img.height;
      if(w>maxW){h=Math.round(h*(maxW/w));w=maxW}
      var cv=document.createElement('canvas');cv.width=w;cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      cb(cv.toDataURL('image/jpeg',quality));
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}
function fileToDataUrl(file,cb){var r=new FileReader();r.onload=function(e){cb(e.target.result)};r.readAsDataURL(file)}

/* ========== Tab Navigation ========== */
/* ========== 杭州购房政策 + 贷款/税费计算器模块 ========== */
var DEFAULT_POLICY = {
  updatedAt: '2026-08-03',
  source: '综合财政部/税务总局/住建部、杭州公积金中心、杭州市住保房管局、中国人民银行LPR等官方信源。',
  purchaseLimit: { text: '杭州新房、二手房已全面放开限购，不限制户籍、社保、购买套数。取得合法产权住宅后可申请落户。', source: '杭州市住保房管局（2026年继续执行）' },
  commercialLoan: { minDownPayment: 0.15, rateFormula: 'LPR - 45BP', lpr5y: 3.5, lprDate: '2026-07-20', currentRate: 3.05, note: '利率各大银行略有浮动，以银行实际审批为准。', source: '中国人民银行；杭州商业贷款政策' },
  providentFund: { maxFamily: 180, maxIndividual: 90, multiplier: 20, rateFirst: { le5: 2.1, gt5: 2.6 }, rateSecond: { le5: 2.525, gt5: 3.075 }, upFloat: { '新市民/青年人': 20, '多子女家庭': 50, '高层次人才家庭': 50, '绿色低碳建筑/以旧换新': 20, '最高叠加': 70 }, loanCountReduce: '2026-04-01 至 2026-12-31，原公积金贷款住房已出售可核减次数。', extract: '可提取支付契税、物业费（每年每家庭1套，≤1万元）。', effectiveDate: '2026-04-01', source: '杭州住房公积金管委会《关于优化住房公积金使用政策的通知》(2026-03-30)' },
  taxes: {
    sale: { rule: '个人销售购买不足2年的住房，按3%征收率全额缴纳增值税；满2年免征。', effective: '2026-01-01起由5%降至3%', source: '财政部《关于个人销售住房增值税政策的公告》' },
    deed: { rule: '家庭唯一/第二套 ≤140㎡ 减按1%；>140㎡ 唯一1.5%、二套2%；三套及以上或非住宅3%。', hangzhouNote: '上城、拱墅、西湖、滨江四中心城区视为一个区域，套数不互认（按区认定）。', source: '财政部/税务总局/住建部公告2024年第16号；杭州三部门2025-04-18发文' },
    person: { rule: '非“满五唯一”：总价1%或差额20%；满五唯一免征。', source: '《个人所得税法》及实施细则' },
    refund: { rule: '2026-01-01 至 2027-12-31，卖后1年内同城市重买退个税；新购≥现住房转让金额全额退，否则按比例退。', conditions: '①同城市；②须为新购住房产权人或之一。', source: '财政部/税务总局/住建部公告2026年第3号（2026-01-12）' }
  },
  subsidies: [
    { region: '余杭区', type: '新建商品住宅', standard: '5万元/套（现金补助）', condition: '全区新建商品住宅，办证后申报', period: '2026-05-29 至 2026-06-30', status: '已结束', source: '余杭区住建 2026' },
    { region: '临平区', type: '新建商品住宅', standard: '10万元/套（消费券，名额200）', condition: '参与活动楼盘', period: '2026-06-10 至 2026-06-30', status: '已结束', source: '临平区住建 2026' },
    { region: '富阳区', type: '新建商品住宅', standard: '“购房+消费券”补贴', condition: '新建商品住宅', period: '购房2026-06-01~06-30；消费券07-20~10-31', status: '已结束', source: '富阳区 2026' },
    { region: '临安区', type: '新建商品住宅', standard: '10万元/套（现金，名额200）', condition: '指定20个楼盘', period: '2026-03-15 至 2026-06-30', status: '已结束', source: '临安区 2026' },
    { region: '钱塘区', type: '新建商品住宅', standard: '最高10万消费券+5万汽车券（抽签）', condition: '指定9个楼盘', period: '2026-01-14 至 2026-03-31', status: '已结束', source: '钱塘区 2026' },
    { region: '萧山区', type: '新建商品住宅', standard: '分档3/4.5/6万元消费券', condition: '按街道分档；先到先得', period: '2026-03-07 至 2026-03-31（已领完）', status: '已结束', source: '萧山区 2026' },
    { region: '拱墅区', type: '新建非住宅', standard: '总价1.5%，最高10万元', condition: '新建非住宅（商铺/写字楼）', period: '2026-01-01 至 2026-03-31', status: '已结束', source: '拱墅区 2026' },
    { region: '上城/滨江/西湖', type: '—', standard: '不参与本轮购房补贴', condition: '—', period: '—', status: '不参与', source: '杭州市政府 2025-12' }
  ],
  subsidyNote: '以上为2026年阶段性活动，多数已于2026-06-30结束。新一轮以各区官方最新公告为准，管理员可在系统内更新。'
};
var _policyCache = null;
function fetchPolicy(cb) {
  fetch(API_BASE + '/api/policy', { headers: getAuthHeader() })
    .then(function (r) { return r.json(); })
    .then(function (d) { _policyCache = d; cb(d); })
    .catch(function () { _policyCache = DEFAULT_POLICY; cb(DEFAULT_POLICY); });
}

function renderPolicy() {
  var c = document.getElementById('tab-policy');
  c.innerHTML =
    '<div class="app">' +
    '  <div class="policy-head">' +
    '    <div><h2 style="margin:0 0 4px">杭州购房政策 · 工具箱</h2>' +
    '      <div class="policy-meta" id="policyMeta">数据加载中…</div></div>' +
    '    <button class="btn btn-outline" id="policyEditBtn" style="display:none">管理员更新政策数据</button>' +
    '  </div>' +
    '  <div class="policy-grid">' +
    '    <div class="policy-card"><h3>一、购房资格（限购）</h3><div id="policyLimit"></div></div>' +
    '    <div class="policy-card"><h3>二、商业贷款</h3><div id="policyComm"></div></div>' +
    '    <div class="policy-card"><h3>三、公积金贷款（2026-04-01新政）</h3><div id="policyFund"></div></div>' +
    '    <div class="policy-card"><h3>四、税费政策</h3><div id="policyTax"></div></div>' +
    '    <div class="policy-card"><h3>五、换购住房个税退税</h3><div id="policyRefund"></div></div>' +
    '    <div class="policy-card"><h3>六、各区购房补贴</h3><div id="policySubsidy"></div></div>' +
    '  </div>' +
    '</div>';
  fetchPolicy(renderPolicyData);
  var eb = document.getElementById('policyEditBtn');
  if (eb && S.currentUser && S.currentUser.role === 'admin') { eb.style.display = ''; eb.addEventListener('click', openPolicyEdit); }
}

function renderCalculator(){
  var c=document.getElementById('tab-calculator');
  if(!c)return;
  c.innerHTML=
    '<div class="app">'+
    '  <div class="calc-page-head"><h2 style="margin:0 0 4px">工具</h2><div class="policy-meta">贷款月供测算与二手交易税费估算（结果仅供参考，以窗口核定为准）</div></div>'+
    '  <div class="calc-tabs">'+
    '    <button class="calc-tab active" data-calc="loan">🏦 贷款计算器</button>'+
    '    <button class="calc-tab" data-calc="tax">🧾 税费计算器</button>'+
    '  </div>'+
    '  <div id="loanCalc" class="calc-pane"></div>'+
    '  <div id="taxCalc" class="calc-pane" style="display:none"></div>'+
    '</div>';
  renderLoanCalc();
  renderTaxCalc();
  var tabs=c.querySelectorAll('.calc-tab');
  tabs.forEach(function(btn){
    btn.addEventListener('click',function(){
      tabs.forEach(function(b){b.classList.remove('active')});
      btn.classList.add('active');
      var which=btn.getAttribute('data-calc');
      var lc=document.getElementById('loanCalc'),tc=document.getElementById('taxCalc');
      if(lc)lc.style.display=which==='loan'?'':'none';
      if(tc)tc.style.display=which==='tax'?'':'none';
    });
  });
}
function renderPolicyData(d) {
  d = d || DEFAULT_POLICY;
  var meta = document.getElementById('policyMeta');
  if (meta) meta.innerHTML = '数据更新于 <b>' + esc(d.updatedAt || '—') + '</b> ｜ 信源：' + esc(d.source || '—');
  var lim = document.getElementById('policyLimit');
  if (lim) lim.innerHTML = '<p>' + esc((d.purchaseLimit && d.purchaseLimit.text) || '') + '</p><div class="policy-src">信源：' + esc((d.purchaseLimit && d.purchaseLimit.source) || '—') + '</div>';
  var cl = d.commercialLoan || {}, pf = d.providentFund || {}, tx = (d.taxes || {});
  var comm = document.getElementById('policyComm');
  if (comm) comm.innerHTML =
    '<ul class="policy-ul">' +
    '<li>最低首付比例：<b>' + ((cl.minDownPayment || 0) * 100) + '%</b>（不区分首套/二套）</li>' +
    '<li>利率公式：<b>' + esc(cl.rateFormula || '') + '</b></li>' +
    '<li>5年期以上 LPR（' + esc(cl.lprDate || '') + '）：<b>' + (cl.lpr5y || '') + '%</b> → 实际利率约 <b>' + (cl.currentRate || '') + '%</b></li>' +
    '<li>' + esc(cl.note || '') + '</li></ul><div class="policy-src">信源：' + esc(cl.source || '—') + '</div>';
  var fund = document.getElementById('policyFund');
  if (fund) fund.innerHTML =
    '<ul class="policy-ul">' +
    '<li>家庭最高额度 <b>' + (pf.maxFamily || '') + '万</b>，个人最高 <b>' + (pf.maxIndividual || '') + '万</b>，计算倍数 <b>' + (pf.multiplier || '') + '倍</b></li>' +
    '<li>利率：首套5年以上 <b>' + (pf.rateFirst && pf.rateFirst.gt5) + '%</b>，二套5年以上 <b>' + (pf.rateSecond && pf.rateSecond.gt5) + '%</b></li>' +
    '<li>上浮：' + Object.keys(pf.upFloat || {}).map(function (k) { return k + ' +' + pf.upFloat[k] + '%'; }).join('；') + '</li>' +
    '<li>' + esc(pf.loanCountReduce || '') + '</li>' +
    '<li>' + esc(pf.extract || '') + '</li></ul><div class="policy-src">信源：' + esc(pf.source || '—') + '（施行 ' + esc(pf.effectiveDate || '') + '）</div>';
  var tax = document.getElementById('policyTax');
  if (tax) tax.innerHTML =
    '<ul class="policy-ul">' +
    '<li><b>契税：</b>' + esc(tx.deed && tx.deed.rule) + '</li>' +
    '<li style="color:#c0392b">※ ' + esc(tx.deed && tx.deed.hangzhouNote) + '</li>' +
    '<li><b>增值税：</b>' + esc(tx.sale && tx.sale.rule) + '（' + esc(tx.sale && tx.sale.effective) + '）</li>' +
    '<li><b>个税：</b>' + esc(tx.person && tx.person.rule) + '</li></ul><div class="policy-src">信源：' + esc(tx.deed && tx.deed.source) + '；' + esc(tx.sale && tx.sale.source) + '</div>';
  var rf = document.getElementById('policyRefund');
  if (rf) rf.innerHTML = '<ul class="policy-ul"><li>' + esc(tx.refund && tx.refund.rule) + '</li><li>条件：' + esc(tx.refund && tx.refund.conditions) + '</li></ul><div class="policy-src">信源：' + esc(tx.refund && tx.refund.source) + '</div>';
  var sub = document.getElementById('policySubsidy');
  if (sub) {
    var rows = (d.subsidies || []).map(function (s) {
      var cls = s.status === '进行中' ? 'st-ok' : (s.status === '不参与' ? 'st-no' : 'st-end');
      return '<tr><td>' + esc(s.region) + '</td><td>' + esc(s.type) + '</td><td>' + esc(s.standard) + '</td><td>' + esc(s.condition) + '</td><td>' + esc(s.period) + '</td><td class="' + cls + '">' + esc(s.status) + '</td><td class="policy-src">' + esc(s.source) + '</td></tr>';
    }).join('');
    sub.innerHTML = '<table class="policy-table"><thead><tr><th>区域</th><th>类型</th><th>标准</th><th>条件</th><th>活动时间</th><th>状态</th><th>信源</th></tr></thead><tbody>' + rows + '</tbody></table><div class="policy-note">' + esc(d.subsidyNote || '') + '</div>';
  }
}

/* ---- 贷款计算器 ---- */
function calcMonthly(P, annualRate, months, method) {
  if (P <= 0) return { month: 0, interest: 0, decrease: 0 };
  var r = annualRate / 12;
  if (method === 'equal') {
    if (r === 0) { var m1 = P / months; return { month: m1, interest: 0, decrease: 0 }; }
    var f = Math.pow(1 + r, months);
    var m = P * r * f / (f - 1);
    return { month: m, interest: m * months - P, decrease: 0 };
  } else {
    var principal = P / months;
    var first = principal + P * r;
    var interest = P * r * (months + 1) / 2;
    return { month: first, interest: interest, decrease: principal * r };
  }
}
function fmtYuan(x){return Math.round(x).toLocaleString('en-US');}
/* 生成完整还款计划（每月本金/利息/月供/剩余本金） */
function loanSchedule(P, annualRate, months, method){
  var rows=[];
  if(P<=0||months<=0)return rows;
  var r=annualRate/12;
  var balance=P;
  var m;
  if(method==='equal'){
    if(r===0){
      var mp=P/months;
      for(m=1;m<=months;m++){
        balance-=mp;if(m===months)balance=0;
        rows.push({m:m,principal:mp,interest:0,payment:mp,balance:Math.max(balance,0)});
      }
    }else{
      var f=Math.pow(1+r,months);
      var mp2=P*r*f/(f-1);
      for(m=1;m<=months;m++){
        var interest=balance*r;
        var principal=mp2-interest;
        balance-=principal;if(m===months){balance=0;principal=mp2-interest;}
        rows.push({m:m,principal:principal,interest:interest,payment:mp2,balance:Math.max(balance,0)});
      }
    }
  }else{
    var pf=P/months;
    for(m=1;m<=months;m++){
      var interest2=balance*r;
      var pay=pf+interest2;
      balance-=pf;if(m===months)balance=0;
      rows.push({m:m,principal:pf,interest:interest2,payment:pay,balance:Math.max(balance,0)});
    }
  }
  return rows;
}
function renderLoanCalc() {
  var box = document.getElementById('loanCalc');
  if (!box) return;
  box.innerHTML =
    '<div class="calc-layout">' +
      '<div class="calc-panel">' +
        '<div class="calc-sec"><h4>房屋与首付</h4><div class="calc-grid">' +
          '<div class="calc-field"><label>房屋总价（万）</label><input type="number" id="loanTotal" value="300" min="0"></div>' +
          '<div class="calc-field" id="loanDownWrap"><label>首付比例（%）</label><input type="number" id="loanDownPct" value="15" min="0" max="100"></div>' +
          '<div class="calc-field"><label>贷款年限（年）</label><input type="number" id="loanYears" value="30" min="1" max="30"></div>' +
          '<div class="calc-field"><label>贷款类型</label><select id="loanType"><option value="commercial">商业贷款</option><option value="provident">公积金贷款</option><option value="combo">组合贷</option></select></div>' +
        '</div></div>' +
        '<div class="calc-sec"><h4>还款方式</h4><div class="calc-grid">' +
          '<div class="calc-field"><label>还款方式</label><select id="loanMethod"><option value="equal">等额本息</option><option value="principal">等额本金</option></select></div>' +
          '<div class="calc-field" id="loanComboWrap" style="display:none"><label>商贷金额（万）</label><input type="number" id="loanCCom" value="180" min="0"></div>' +
          '<div class="calc-field" id="loanComboWrap2" style="display:none"><label>公积金金额（万）</label><input type="number" id="loanPCom" value="120" min="0"></div>' +
        '</div></div>' +
        '<div class="calc-sec"><h4>利率</h4><div class="calc-grid">' +
          '<div class="calc-field"><label>商贷利率（%）</label><input type="number" id="loanCRate" value="3.05" step="0.01"></div>' +
          '<div class="calc-field"><label>公积金利率（%）</label><input type="number" id="loanPRate" value="2.6" step="0.01"></div>' +
        '</div></div>' +
      '</div>' +
      '<div class="calc-side"><div class="calc-result" id="loanResult"></div></div>' +
    '</div>' +
    '<div class="calc-schedule-head">每月还款明细（单位：元，可滚动查看）</div>' +
    '<div class="amort-wrap" id="loanSchedule"></div>';
  ['loanTotal', 'loanDownPct', 'loanYears', 'loanType', 'loanMethod', 'loanCCom', 'loanPCom', 'loanCRate', 'loanPRate'].forEach(function (id) {
    var el = document.getElementById(id); if (el) { el.addEventListener('input', computeLoan); el.addEventListener('change', computeLoan); }
  });
  document.getElementById('loanType').addEventListener('change', function () {
    var t = this.value;
    var cw = document.getElementById('loanComboWrap'); if (cw) cw.style.display = t === 'combo' ? '' : 'none';
    var cw2 = document.getElementById('loanComboWrap2'); if (cw2) cw2.style.display = t === 'combo' ? '' : 'none';
    var dw = document.getElementById('loanDownWrap'); if (dw) dw.style.display = t === 'combo' ? 'none' : '';
    computeLoan();
  });
  computeLoan();
}
function computeLoan() {
  var total = parseFloat(document.getElementById('loanTotal').value) || 0;
  var type = document.getElementById('loanType').value;
  var years = parseFloat(document.getElementById('loanYears').value) || 30;
  var method = document.getElementById('loanMethod').value;
  var cRate = parseFloat(document.getElementById('loanCRate').value) || 3.05;
  var pRate = parseFloat(document.getElementById('loanPRate').value) || 2.6;
  var loanC = 0, loanP = 0, down = 0;
  if (type === 'combo') {
    loanC = parseFloat(document.getElementById('loanCCom').value) || 0;
    loanP = parseFloat(document.getElementById('loanPCom').value) || 0;
    down = total - loanC - loanP;
  } else {
    var dp = parseFloat(document.getElementById('loanDownPct').value) || 15;
    down = total * dp / 100;
    var loan = total - down;
    if (type === 'commercial') loanC = loan; else loanP = loan;
  }
  var months = years * 12;
  var mc = calcMonthly(loanC * 10000, cRate / 100, months, method);
  var mp = calcMonthly(loanP * 10000, pRate / 100, months, method);
  var monthPay = (mc.month + mp.month) / 10000;
  var totalInterest = (mc.interest + mp.interest) / 10000;
  var totalPay = (loanC + loanP) + totalInterest;
  var dec = (mc.decrease + mp.decrease) / 10000;
  var label = method === 'equal' ? '月供（固定）' : '首月月供（等额本金，每月递减 ' + dec.toFixed(1) + ' 万）';
  var summary =
    '<div class="calc-out"><span>' + label + '</span><b>' + monthPay.toFixed(2) + ' 万</b></div>' +
    '<div class="calc-out"><span>首付</span><b>' + down.toFixed(2) + ' 万</b></div>' +
    '<div class="calc-out"><span>贷款总额</span><b>' + (loanC + loanP).toFixed(2) + ' 万</b></div>' +
    '<div class="calc-out"><span>利息总额</span><b>' + totalInterest.toFixed(2) + ' 万</b></div>' +
    '<div class="calc-out"><span>还款总额（本+息）</span><b>' + totalPay.toFixed(2) + ' 万</b></div>';
  var schedule = '';
  var totalLoanYuan = loanC * 10000 + loanP * 10000;
  if (totalLoanYuan > 0 && months > 0) {
    var rowsC = loanSchedule(loanC * 10000, cRate / 100, months, method);
    var rowsP = loanSchedule(loanP * 10000, pRate / 100, months, method);
    var rows = [];
    for (var mi = 0; mi < months; mi++) {
      var rc = rowsC[mi] || { principal: 0, interest: 0, payment: 0, balance: 0 };
      var rp = rowsP[mi] || { principal: 0, interest: 0, payment: 0, balance: 0 };
      rows.push({ m: mi + 1, principal: rc.principal + rp.principal, interest: rc.interest + rp.interest, payment: rc.payment + rp.payment, balance: Math.max(rc.balance, rp.balance) });
    }
    schedule = '<table class="amort-table"><thead><tr><th>期数</th><th>月供</th><th>本金</th><th>利息</th><th>剩余本金</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + r.m + '</td><td>' + fmtYuan(r.payment) + '</td><td>' + fmtYuan(r.principal) + '</td><td>' + fmtYuan(r.interest) + '</td><td>' + fmtYuan(r.balance) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  var lr = document.getElementById('loanResult'); if (lr) lr.innerHTML = summary;
  var ls = document.getElementById('loanSchedule'); if (ls) ls.innerHTML = schedule;
}

/* ---- 税费计算器 ---- */
function renderTaxCalc() {
  var box = document.getElementById('taxCalc');
  if (!box) return;
  box.innerHTML =
    '<div class="tax-type-bar">' +
    '  <button class="tax-tab active" data-tax="second" onclick="switchTaxTab(this)">🏠 二手住宅</button>' +
    '  <button class="tax-tab" data-tax="comm" onclick="switchTaxTab(this)">🏢 非住宅（商铺/公寓）</button>' +
    '</div>' +
    '<div id="taxPanelSecond" class="tax-panel">' +
    '  <div class="calc-row">' +
    '    <div class="calc-field"><label>建筑面积（㎡）</label><input type="number" id="taxArea" value="89" min="0"></div>' +
    '    <div class="calc-field"><label>成交总价（万）</label><input type="number" id="taxTotal" value="200" min="0"></div>' +
    '  </div>' +
    '  <div class="calc-row">' +
    '    <div class="calc-field"><label>家庭住房情况</label><select id="taxCase"><option value="only">唯一住房</option><option value="second">第二套</option><option value="third">第三套及以上</option></select></div>' +
    '    <div class="calc-field"><label>满二</label><select id="taxFull2"><option value="no">不满2年</option><option value="yes">满2年</option></select></div>' +
    '    <div class="calc-field"><label>满五唯一</label><select id="taxFull5"><option value="no">否</option><option value="yes">是</option></select></div>' +
    '  </div>' +
    '  <div class="calc-row">' +
    '    <div class="calc-field"><label>个税方式</label><select id="taxPit"><option value="1pct">全额1%</option><option value="20pct">差额20%</option></select></div>' +
    '    <div class="calc-field"><label>上一手买入价（万）</label><input type="number" id="taxBuy" value="150" min="0"></div>' +
    '  </div>' +
    '</div>' +
    '<div id="taxPanelComm" class="tax-panel" style="display:none">' +
    '  <div class="comm-input-grid">' +
    '    <div class="calc-field comm-highlight"><label>① 转让价（元，含税核定价）</label><input type="number" id="txPrice" value="500000" min="0" step="1000"></div>' +
    '    <div class="calc-field comm-highlight"><label>② 购入价（元，发票金额）</label><input type="number" id="buyPrice" value="300000" min="0" step="1000"></div>' +
    '    <div class="calc-field comm-highlight"><label>③ 持有年限（年，满半年按1年）</label><input type="number" id="holdYears" value="3" min="0" step="0.5"></div>' +
    '  </div>' +
    '  <p class="policy-note" style="margin:6px 0 10px;font-size:.75rem;color:#666">💡 个人出售非住宅（商铺/商住/写字楼），土地增值税按<strong>四级超率累进税率</strong>计算。灰色区域输入后自动算出买卖双方税费。</p>' +
    '</div>' +
    '<div class="calc-result" id="taxResult"></div>';
  // Bind second-hand inputs
  ['taxArea','taxTotal','taxCase','taxFull2','taxFull5','taxPit','taxBuy'].forEach(function(id){
    var el=document.getElementById(id);if(el){el.addEventListener('input',computeTax);el.addEventListener('change',computeTax);}
  });
  // Bind commercial inputs
  ['txPrice','buyPrice','holdYears'].forEach(function(id){
    var el=document.getElementById(id);if(el){el.addEventListener('input',computeTax);el.addEventListener('change',computeTax);}
  });
  computeTax();
}
function switchTaxTab(btn){
  document.querySelectorAll('.tax-tab').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  var t=btn.getAttribute('data-tax');
  var ps=document.getElementById('taxPanelSecond'),pc=document.getElementById('taxPanelComm');
  if(ps)ps.style.display=(t==='second')?'':'none';
  if(pc)pc.style.display=(t==='comm')?'':'none';
  computeTax();
}
window.switchTaxTab=switchTaxTab;
function computeTax() {
  var activeTab=document.querySelector('.tax-tab.active');
  var t=activeTab?activeTab.getAttribute('data-tax'):'second';
  if(t==='comm'){computeTaxComm();return;}
  /* ===== 二手住宅 ===== */
  var area=parseFloat(document.getElementById('taxArea').value)||0;
  var total=parseFloat(document.getElementById('taxTotal').value)||0;
  var rows=[];
  function add(name,val,note){rows.push({name:name,val:val,note:note||''});}
  var deed=0,vat=0,pit=0,stamp=0;
  var tcase=document.getElementById('taxCase').value;
  if(tcase==='third')deed=total*0.03;
  else if(area<=140)deed=total*0.01;
  else deed=(tcase==='only')?total*0.015:total*0.02;
  add('契税',deed,tcase==='third'?'三套及以上3%':(area<=140?'≤140㎡ 1%':(tcase==='only'?'>140㎡唯一1.5%':'>140㎡ 2%')));
  var full2=document.getElementById('taxFull2').value;
  vat=(full2==='no')?total*0.03:0;
  add('增值税',vat,full2==='yes'?'满2年免征':'不足2年 3%');
  var pitMode=document.getElementById('taxPit').value;
  if(document.getElementById('taxFull5').value==='yes'){pit=0;add('个人所得税',0,'满五唯一免征');}
  else if(pitMode==='1pct'){pit=total*0.01;add('个人所得税',pit,'全额1%');}
  else{var buy=parseFloat(document.getElementById('taxBuy').value)||0;pit=Math.max(0,total-buy)*0.2;add('个人所得税',pit,'差额20%');}
  stamp=total*0.0005;
  add('印花税',stamp,'产权转移 0.05%');
  var sum=rows.reduce(function(s,r){return s+r.val;},0);
  var html=rows.map(function(r){
    return '<div class="calc-out"><span>'+r.name+(r.note?' <span class="calc-sub">'+r.note+'</span>':'')+'</span><b>'+r.val.toFixed(2)+' 万</b></div>';
  }).join('')+
    '<div class="calc-out" style="border-top:2px solid #eee;padding-top:8px"><span><b>税费合计</b></span><b>'+sum.toFixed(2)+' 万</b></div>'+
    '<div class="policy-note">※ 住宅税费依据当前政策口径估算。最终以税务/不动产登记窗口核定为准。</div>';
  var tr=document.getElementById('taxResult');if(tr)tr.innerHTML=html;
}

/* ===== 非住宅商业 — 四级超率累进税率（完全对照Excel公式） ===== */
function computeTaxComm(){
  var txPrice=parseFloat(document.getElementById('txPrice').value)||0;
  var buyPrice=parseFloat(document.getElementById('buyPrice').value)||0;
  var years=parseFloat(document.getElementById('holdYears').value)||0;
  if(txPrice<=0||buyPrice<=0){
    document.getElementById('taxResult').innerHTML='<div class="comm-err">请先输入转让价和购入价</div>';
    return;
  }

  // ── 严格按Excel公式计算 ──
  var diff=txPrice-buyPrice;                        // 3 差额＝转让价－购入价
  var vat=round2(diff/1.05*0.05);                   // 4 增值税＝差额÷1.05×5%
  var surcharge=round2(vat*0.12/2);                 // 5 附加税＝增值税×0.12÷2
  var buyDeed=round2(buyPrice/1.05*0.03);           // 6 购入契税＝购入价÷1.05× 3%
  var buyStamp=round2(buyPrice*0.0005/2);           // 7 购入印花＝购入价× 0.05% ÷ 2
  var depr=round2(buyPrice*0.05*years);             // 8 折旧＝购入价×5%×年限
  var deduct=round2(buyPrice+surcharge+buyDeed+buyStamp+depr); // 9 扣除项
  var gain=round2(txPrice-vat-deduct);               // 10 增值额＝转让价－增值税－扣除项
  var gainRate=deduct>0?gain/deduct*100:0;           // 11 增值率％

  // 12 四级超率累进税率
  var lvRate,lvQuick;
  if(gainRate<=50){lvRate=0.30;lvQuick=0;}
  else if(gainRate<=100){lvRate=0.40;lvQuick=0.05;}
  else if(gainRate<=200){lvRate=0.50;lvQuick=0.15;}
  else{lvRate=0.60;lvQuick=0.35;}

  var landVat=Math.max(0,round2(gain*lvRate-deduct*lvQuick)); // 14 土增
  var sellStamp=round2(txPrice*0.0005/2);            // 17 卖方印花
  var pitA=Math.max(0,round2((txPrice-buyPrice-vat-surcharge-buyDeed-landVat-sellStamp)*0.20));
  var pitB=round2((txPrice-vat)*0.01);               // 15B 个税核定＝(转让价－增值税)×1%
  var vatTotal=round2(vat+surcharge);                // 16 增值税及附加
  var buyerDeed=round2((txPrice-vat)*0.03);          // 19 买方契税＝(转让价-增值税)× 3%
  var buyerStamp=round2(txPrice*0.0005/2);           // 20 买方印花

  var sellTotal=round2(landVat+Math.max(pitA,pitB)+vatTotal+sellStamp);
  var buyerTotal=round2(buyerDeed+buyerStamp);

  // ── 数据行 ──
  var R=[];
  function add(no,name,fm,val,hl){R.push({no:no,n:name,fm:fm,v:val,h:!!hl});}
  add(1,'转让价','录入核定价（含税）',txPrice,1);
  add(2,'购入价','录入购入发票金额',buyPrice,1);
  add(3,'买进卖出差额','＝转让价－购入价',diff);
  add(4,'本次增值税','＝差额÷1.05×5%',vat);
  add(5,'本次附加税','＝增值税×0.12÷2',surcharge);
  add(6,'购入契税','＝购入价÷1.05× 3%',buyDeed);
  add(7,'购入印花税','＝购入价× 0.05% ÷ 2',buyStamp);
  add(8,'年限折旧','＝购入价×5%×'+years+'年',depr);
  add(9,'扣除项目金额','＝购入价＋附加＋契税＋印花＋折旧',deduct);
  add(10,'增值额','＝转让价－增值税－扣除项',gain,1);
  add(11,'增值率','＝(增值额÷扣除项)×100%',fixp(gainRate)+'%',0);
  add(12,'土地增值税适用税率',rateLabel(gainRate),fixp(lvRate*100)+'%',0);
  add(13,'速算扣除系数',quickLabel(lvRate),fixp(lvQuick*100)+'%',0);
  add(14,'应缴土地增值税','＝增值额×税率－扣除项×速扣',landVat,1);
  add(15,'应缴个人所得税','A:(转让-购入-增-附-契-土增-印)×20%\nB:(转让价－增值税)×1%',Math.max(pitA,pitB),1);
  add(16,'增值税及附加','＝增值税＋附加',vatTotal);
  add(17,'卖方印花税','＝转让价× 0.05% ÷ 2',sellStamp);

  function fmt(n){return n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function fixp(n){return Number(n).toFixed(2);}
  function rateLabel(gr){if(gr<=50)return'≤50% → 30%';if(gr<=100)return'50%~100% → 40%';if(gr<=200)return'100%~200% → 50%';return'>200% → 60%';}
  function quickLabel(r){if(r===0.30)return'30% \u2192 0';if(r===0.40)return'40% \u2192 5%';if(r===0.50)return'50% \u2192 15%';return'60% \u2192 35%';}
  function round2(n){return Math.round(n*100)/100;}

  // ── 渲染：结果在上 + 可折叠明细在下 ──
  var body=R.map(function(row){
    return '<div class="ctr'+(row.h?' comm-hl':'')+'">'+
      '<span class="ctr-no">'+(row.no||'')+'</span>'+
      '<span class="ctr-nm">'+row.n+'</span>'+
      '<span class="ctr-fm">'+row.fm.replace(/\n/g,'<br>')+'</span>'+
      '<span class="ctr-vl">'+fmt(row.v)+'</span>'+
    '</div>';
  }).join('');

  var html=

    // ════════════ 买卖双方合计结果（置顶，仅显示总金额）════════════
    '<div class="comm-results-top">'+

    // 卖方合计（紧凑：标题+金额）
    '<div class="comm-summary comm-summary-sell">'+
    '<div class="comm-sum-compact">'+
    '<span class="comm-sum-label">\ud83d\udccb 卖方应缴税费</span>'+
    '<span class="comm-sum-num sell-num">'+fmt(sellTotal)+' 元</span>'+
    '</div></div>'+

    // 买方合计（紧凑）
    '<div class="comm-summary comm-summary-buy">'+
    '<div class="comm-sum-compact">'+
    '<span class="comm-sum-label">\ud83d\udccb 买方应缴税费</span>'+
    '<span class="comm-sum-num buy-num">'+fmt(buyerTotal)+' 元</span>'+
    '</div></div>'+

    '</div>'+

    // ════════════ 计算过程明细（底部折叠，默认收起）════════════
    '<details class="comm-detail-wrap">'+
    '<summary>查看计算过程明细</summary>'+
    '<div class="comm-result">'+
    '<div class="ctr-head"><span class="ctr-no">项次</span><span class="ctr-nm">项目</span><span class="ctr-fm">计算公式</span><span class="ctr-vl">金额（元）</span></div>'+
    body+
    '</div></details>';

  document.getElementById('taxResult').innerHTML=html;
}

/* ---- 管理员更新政策数据 ---- */
function openPolicyEdit() {
  fetchPolicy(function (cur) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.innerHTML = '<div class="modal" style="max-width:720px"><div class="modal-header"><h3>更新购房政策数据（管理员）</h3><button class="modal-close" data-close="pe">&times;</button></div>' +
      '<div class="modal-body"><p class="policy-note">粘贴最新的政策 JSON（可修改数值/补贴/信源），保存后全员可见。建议每次更新同步修改 updatedAt 与 source。当前基线更新于 ' + esc(cur.updatedAt || '-') + '。</p>' +
      '<textarea id="policyJson" style="width:100%;height:360px;font-family:monospace;font-size:12px;padding:8px">' + esc(JSON.stringify(cur, null, 2)) + '</textarea>' +
      '<div id="policyErr" class="policy-note" style="color:#c0392b"></div></div>' +
      '<div class="modal-footer"><button class="btn btn-outline" data-close="pe">取消</button><button class="btn btn-primary" id="policySave">保存并更新</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { overlay.remove(); }); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.getElementById('policySave').addEventListener('click', function () {
      var txt = document.getElementById('policyJson').value;
      var obj; try { obj = JSON.parse(txt); } catch (e) { document.getElementById('policyErr').textContent = 'JSON 格式错误：' + e.message; return; }
      fetch(API_BASE + '/api/policy', { method: 'POST', headers: getAuthHeader(), body: JSON.stringify(obj) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) { _policyCache = d.policy; renderPolicyData(d.policy); overlay.remove(); toast('政策数据已更新', 'success'); }
          else document.getElementById('policyErr').textContent = d.error || '保存失败';
        }).catch(function (e) { document.getElementById('policyErr').textContent = '网络错误：' + e.message; });
    });
  });
}

function switchTab(tab){
  S.tab=tab;
  document.body.setAttribute('data-tab',tab);
  document.querySelectorAll('.tab-content').forEach(function(el){el.classList.remove('active')});
  var tc=document.getElementById('tab-'+tab);
  if(tc)tc.classList.add('active');
  document.querySelectorAll('.sidebar-nav-item').forEach(function(el){el.classList.remove('active')});
  document.querySelectorAll('.bottom-nav-item').forEach(function(el){el.classList.remove('active')});
  var sbItem=document.querySelector('.sidebar-nav-item[data-tab="'+tab+'"]');
  if(sbItem)sbItem.classList.add('active');
  var bnItem=document.querySelector('.bottom-nav-item[data-tab="'+tab+'"]');
  if(bnItem)bnItem.classList.add('active');
  var fab=document.getElementById('fab');
  if(fab)fab.style.display='flex';
  if(tab==='clients')renderClientList();
  if(tab==='properties')renderPropertyList();
  if(tab==='transactions')renderTxList();
  if(tab==='dashboard')renderDashboard();
  if(tab==='policy')renderPolicy();
  if(tab==='calculator')renderCalculator();
}
/* 子页签切换入场动画：仅动 opacity+translateY(GPU 合成层)，不依赖网络、不触发重排。
   在 switchSubtab / _renderMDToolbar 切换完成后调用，重启动画。 */
function playViewEnter(){
  try{
    var grid=document.getElementById('propertyGrid');
    var table=document.getElementById('propertyTable');
    var el=grid;
    if(table && table.style.display!=='none'){el=table;}
    if(!el)return;
    el.classList.remove('view-enter');
    void el.offsetWidth; /* 强制重排，确保动画重新触发 */
    el.classList.add('view-enter');
  }catch(e){}
}
function switchSubtab(sub){
  try{
  S.subtab=sub;
  document.body.setAttribute('data-subtab',sub);
  document.querySelectorAll('.subtab').forEach(function(el){el.classList.remove('active')});
  document.querySelector('[data-subtab="'+sub+'"]').classList.add('active');
  /* 新楼盘tab下，新增按钮文案改为"新增楼盘" */
  var addBtn=document.getElementById('addPropBtn');
  if(addBtn){
    if(sub==='newdev'){
      addBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增楼盘';
    }else if(sub==='rental'){
      addBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增出租房';
    }else if(sub==='md'){
      addBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>录入名单';
    }else{
      addBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增房源';
    }
  }
  /* 根据subtab显示/隐藏筛选项 */
  updateFilterVisibility(sub);
  /* 更新板块下拉选项 */
  updateBlockOptions(sub);
  renderPropertyList();
  playViewEnter();
  }catch(err){console.error('[switchSubtab]',err);toast('切换失败: '+err.message,'error')}
}
/* 根据subtab显示/隐藏筛选项 */
function updateFilterVisibility(sub){
  document.querySelectorAll('[data-filter-show]').forEach(function(el){
    var show=el.getAttribute('data-filter-show')||'';
    var types=show.split(',').map(function(s){return s.trim()});
    el.style.display=types.indexOf(sub)>=0?'':'none';
  });
}
/* 更新板块下拉选项 */
function updateBlockOptions(sub){
  var areaSelect=document.getElementById('pfFilterArea');
  var blockSelect=document.getElementById('pfFilterBlock');
  if(!blockSelect)return;
  var area=areaSelect?areaSelect.value:'';
  var blocks=area&&AREA_BLOCKS[area]?AREA_BLOCKS[area]:[];
  var cur=S.propFilters.block||'';
  blockSelect.innerHTML='<option value="">全部</option>'+blocks.map(function(b){return'<option value="'+esc(b)+'"'+(b===cur?' selected':'')+'>'+esc(b)+'</option>'}).join('');
}

/* ========== Client: Stats ========== */
function renderClientStats(){
  var total=S.clients.length,gA=0,gB=0,gC=0,closed=0,nf=0;
  S.clients.forEach(function(c){
    if(c.grade==='A')gA++;if(c.grade==='B')gB++;if(c.grade==='C')gC++;
    if(c.status==='已成交')closed++;if(needFollowup(c))nf++;
  });
  document.getElementById('statsBar').innerHTML=
    statCard('','全部客户',total,'')+
    statCard('danger','A级客户',gA,'A')+
    statCard('warning','需跟进',nf,'needFollow')+
    statCard('success','已成交',closed,'已成交');
  document.querySelectorAll('#statsBar .stat-card').forEach(function(card){
    card.addEventListener('click',function(){
      var f=card.getAttribute('data-filter');
      var els={grade:'fGrade',status:'fStatus',needFollow:'fNeedFollow'};
      if(f==='needFollow'){document.getElementById('fNeedFollow').value='7';S.filters.needFollow='7';}
      else if(f==='已成交'){document.getElementById('fStatus').value='已成交';S.filters.status='已成交';}
      else if(f==='A'||f==='B'){document.getElementById('fGrade').value=f;S.filters.grade=f;}
      else{document.getElementById('fGrade').value='';document.getElementById('fStatus').value='';document.getElementById('fNeedFollow').value='';S.filters={};}
      renderClientList();
    });
  });
}
function statCard(cls,label,num,filter){
  return'<div class="stat-card '+cls+'" data-filter="'+filter+'"><div class="stat-num">'+num+'</div><div class="stat-label">'+label+'</div></div>';
}

/* ========== Client: Filter & Sort ========== */
function getFilteredClients(){
  var list=S.clients.slice();var f=S.filters;var q=S.search.trim().toLowerCase();
  /* 非管理员：只看自己录入的 + 已接受合作的客户 */
  if(!isAdmin()&&S.currentUser){
    list=list.filter(function(c){return isClientOwner(c)||isClientCollaborator(c)});
  }
  // 录入人筛选（仅admin）
  if(isAdmin()&&S.filterCreatedBy){
    if(S.filterCreatedBy==='__unassigned'){
      list=list.filter(function(c){return !c.createdBy});
    }else{
      list=list.filter(function(c){return c.createdBy===S.filterCreatedBy});
    }
  }
  if(q){list=list.filter(function(c){
    var h=[c.name,c.wechat,c.notes,c.requirements,(c.customTags||[]).join(' ')].join(' ').toLowerCase();
    (c.phones||[]).forEach(function(p){h+=' '+p.number});
    (c.followUps||[]).forEach(function(fu){h+=' '+fu.content});
    return h.indexOf(q)>=0;
  })}
  if(f.grade)list=list.filter(function(c){return c.grade===f.grade});
  if(f.status)list=list.filter(function(c){return c.status===f.status});
  if(f.purpose)list=list.filter(function(c){return c.purpose===f.purpose});
  if(f.source)list=list.filter(function(c){return c.source===f.source});
  if(f.area)list=list.filter(function(c){return(c.targetAreas||[]).indexOf(f.area)>=0});
  if(f.budgetMin)list=list.filter(function(c){return(!c.budgetMax||c.budgetMax>=f.budgetMin)});
  if(f.budgetMax)list=list.filter(function(c){return(!c.budgetMin||c.budgetMin<=f.budgetMax)});
  if(f.layout)list=list.filter(function(c){return(c.requiredLayouts||c.layout||'').indexOf(f.layout)>=0||(c.notes||'').indexOf(f.layout)>=0});
  if(f.areaSeg){var seg=f.areaSeg.split('-');var lo=parseFloat(seg[0]);var hi=parseFloat(seg[1]);list=list.filter(function(c){
    var a=parseFloat(c.requiredAreaMin)||parseFloat(c.requiredArea)||0;
    if(!a)return true;return a>=lo&&a<hi;
  })}
  if(f.tag)list=list.filter(function(c){return(c.customTags||[]).indexOf(f.tag)>=0});
  if(f.quick){var qq=f.quick.toLowerCase();list=list.filter(function(c){
    if((c.name||'').toLowerCase().indexOf(qq)>=0)return true;
    return(c.phones||[]).some(function(p){return(p.number||'').indexOf(qq)>=0});
  })}
  if(f.special==='pinned')list=list.filter(function(c){return(S.pinnedIds||[]).indexOf(c.id)>=0});
  if(f.special==='hasReminder')list=list.filter(function(c){return(c.reminders||[]).length>0});
  if(f.special==='noPhone')list=list.filter(function(c){return!c.phones||c.phones.length===0||!c.phones[0].number});
  if(f.special==='hasTransaction')list=list.filter(function(c){return S.transactions.some(function(t){return t.clientId===c.id})});
  if(f.needFollow){
    if(f.needFollow==='overdue'){
      list=list.filter(function(c){return c.status!=='已成交'&&c.status!=='暂缓'&&needFollowup(c)});
    }else if(f.needFollow==='today'){
      var today=new Date().toISOString().slice(0,10);
      list=list.filter(function(c){return(c.reminders||[]).some(function(r){return r.date===today})});
    }else if(f.needFollow==='never'){
      list=list.filter(function(c){return!(c.followUps||[]).length});
    }else{var d=parseInt(f.needFollow);list=list.filter(function(c){
      if(c.status==='已成交'||c.status==='暂缓')return false;
      var l=lastFollowup(c)||c.updatedAt||c.createdAt;return daysSince(l)>=d;
    })}
  }
  if(f.creator)list=list.filter(function(c){return c.createdBy===f.creator});
  if(f.special==='invalid')list=list.filter(function(c){return !!c.invalid});
  var sk=S.sort;
  list.sort(function(a,b){
    /* 无效客户永远沉底 */
    var ia=a.invalid?1:0,ib=b.invalid?1:0;if(ia!==ib)return ia-ib;
    if(sk==='smart')return smartClientScore(b)-smartClientScore(a);
    if(sk==='name')return(a.name||'').localeCompare(b.name||'');
    if(sk==='grade'){var o={'A':0,'B':1,'C':2};return(o[a.grade]||3)-(o[b.grade]||3)}
    if(sk==='lastFollowup'){return(lastFollowup(b)||0)-(lastFollowup(a)||0)}
    if(sk==='createdAt')return(b.createdAt||0)-(a.createdAt||0);
    return(b.updatedAt||0)-(a.updatedAt||0);
  });
  return list;
}

/* ===== 批量选择客户 & 批量发起合作 ===== */
function toggleBatchMode(on){
  S.batchMode=(on===undefined)?!S.batchMode:!!on;
  if(!S.batchMode)S.batchSel=[];
  var bar=document.getElementById('batchBar');
  if(bar)bar.classList.toggle('show',S.batchMode);
  var btn=document.getElementById('batchModeBtn');
  if(btn){btn.classList.toggle('btn-primary',S.batchMode);btn.classList.toggle('btn-outline',!S.batchMode)}
  /* 轻量切换：只切 class + 更新选中态，不重建整个列表（避免卡顿） */
  var _grid=document.getElementById('clientGrid');
  if(_grid)_grid.querySelectorAll('.client-card').forEach(function(c){c.classList.toggle('batch-mode',S.batchMode)});
  var _tbl=document.getElementById('clientTable');
  if(_tbl){_tbl.classList.toggle('batch-mode',S.batchMode);
    /* 表格视图：同时给内部 <table> 元素加 class（CSS 选择器依赖 .client-table.batch-mode） */
    var _innerTbl=_tbl.querySelector('.client-table');
    if(_innerTbl)_innerTbl.classList.toggle('batch-mode',S.batchMode);}
  refreshBatchSelection();
}
/* 暴露到全局：供 index.html 内联 onclick 调用（IIFE 内的函数默认不在 window 上） */
window.toggleBatchMode=toggleBatchMode;
window.exportCurrentCSV=exportCurrentCSV;

/* ===== 房源批量选择模式（二手房/租赁/新楼盘） ===== */
function togglePropBatchMode(on){
  S.propBatchMode=(on===undefined)?!S.propBatchMode:!!on;
  if(!S.propBatchMode)S.checkedPropIds=[];
  var btn=document.getElementById('propBatchModeBtn');
  if(btn){btn.classList.toggle('btn-primary',S.propBatchMode);btn.classList.toggle('btn-outline',!S.propBatchMode)}
  /* 刷新当前视图以显示/隐藏 checkbox */
  if(S.propViewMode==='table'){ renderPropertyTable(); }
  else { renderPropertyList(); }
}
window.togglePropBatchMode=togglePropBatchMode;
/* ========== 备忘录 Modal ========== */
function openMemoModal(){
  var overlay=document.getElementById('memoModalOverlay');
  var input=document.getElementById('memoInput');
  if(overlay&&input){
    overlay.classList.add('show');
    /* 恢复未保存的草稿，临时记录不被清空，即开即用 */
    try{input.value=localStorage.getItem(SK_MEMO_DRAFT)||''}catch(e){input.value=''}
    input.focus();
    try{var _l=input.value.length;input.setSelectionRange(_l,_l)}catch(e){}
  }
}
function closeMemoModal(){
  var overlay=document.getElementById('memoModalOverlay');
  if(overlay)overlay.classList.remove('show');
}
window.openMemoModal=openMemoModal;
window.closeMemoModal=closeMemoModal;

/* ========== 密码可见性切换（小眼睛）========== */
function togglePwVis(inputId,btn){
  var inp=document.getElementById(inputId);
  if(!inp)return;
  if(inp.type==='password'){inp.type='text';btn.style.color='var(--primary)'}
  else{inp.type='password';btn.style.color=''}
}
window.togglePwVis=togglePwVis;

/* ========== 会话超时检测（1小时无操作自动登出）========== */
var INACTIVITY_MS=3600000;
var _inactivityTimer=null;
function resetInactivityTimer(){
  if(_inactivityTimer)clearTimeout(_inactivityTimer);
  _inactivityTimer=setTimeout(function(){
    var bar=document.getElementById('sessionTimeoutBar');
    if(bar){bar.style.display='block';setTimeout(function(){bar.style.display='none'},4000)}
    setTimeout(function(){doLogout()},1200);
  },INACTIVITY_MS);
}
function startInactivityMonitor(){
  ['click','keydown','scroll','touchmove','mousemove'].forEach(function(ev){
    document.addEventListener(ev,resetInactivityTimer,{passive:true});
  });
  resetInactivityTimer();
}
window.startInactivityMonitor=startInactivityMonitor;


/* 备忘录事件绑定 */
(function(){
  var overlay=document.getElementById('memoModalOverlay');
  var input=document.getElementById('memoInput');
  var saveBtn=document.getElementById('memoSaveBtn');
  var cancelBtn=document.getElementById('memoCancelBtn');
  var closeBtn=document.getElementById('memoCloseBtn');
  if(!overlay)return;
  if(saveBtn)saveBtn.addEventListener('click',function(){addMemo(input.value||'');closeMemoModal();});
  if(cancelBtn)cancelBtn.addEventListener('click',closeMemoModal);
  if(closeBtn)closeBtn.addEventListener('click',closeMemoModal);
  if(overlay)overlay.addEventListener('click',function(e){if(e.target===overlay)closeMemoModal();});
  /* Ctrl+Enter / Cmd+Enter 快捷保存 */
  if(input)input.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();addMemo(input.value||'');closeMemoModal();}});
  /* 输入即自动暂存草稿：未保存关闭也能恢复 */
  if(input)input.addEventListener('input',function(){try{localStorage.setItem(SK_MEMO_DRAFT,input.value)}catch(e){}});
})();

function updateBatchCount(){
  var el=document.getElementById('bbCount');
  if(el)el.textContent='已选 '+((S.batchSel||[]).length)+' 位客户';
}
function toggleBatchPick(id,on){
  S.batchSel=S.batchSel||[];
  var i=S.batchSel.indexOf(id);
  if(on&&i<0)S.batchSel.push(id);
  if(!on&&i>=0)S.batchSel.splice(i,1);
  updateBatchCount();
}
function openBatchCollab(){
  var ids=(S.batchSel||[]).slice();
  if(!ids.length){toast('请先勾选客户','error');return}
  var sel=document.getElementById('bcUserSelect');
  var me=S.currentUser?S.currentUser.id:'';
  sel.innerHTML='<option value="">请选择成员</option>'+(S.allUsers||[]).filter(function(u){return u.id!==me&&u.active!==false})
    .map(function(u){return'<option value="'+esc(u.id)+'">'+esc(u.name)+(u.role==='admin'?'（管理员）':'')+'</option>'}).join('');
  var box=document.getElementById('bcClientList');
  box.innerHTML=ids.map(function(id){
    var c=findClient(id);if(!c)return'';
    var ok=isClientOwner(c)||isAdmin();
    return'<div style="'+(ok?'':'color:var(--text-tertiary);text-decoration:line-through')+'">'+esc(c.name)+' · '+esc(c.grade)+'级'+(ok?'':'（非本人录入，将跳过）')+'</div>';
  }).join('');
  document.getElementById('batchCollabModal').classList.add('show');
}
function doBatchCollab(){
  var uid=document.getElementById('bcUserSelect').value;
  if(!uid){toast('请选择合作人','error');return}
  var u=(S.allUsers||[]).filter(function(x){return x.id===uid})[0];
  if(!u){toast('成员不存在','error');return}
  var ids=(S.batchSel||[]).slice();
  var okN=0,skipOwner=0,skipDup=0;
  ids.forEach(function(id){
    var c=findClient(id);if(!c)return;
    if(!isClientOwner(c)&&!isAdmin()){skipOwner++;return}
    if(!Array.isArray(c.collabs))c.collabs=[];
    if(c.collabs.some(function(x){return x.userId===uid})){skipDup++;return}
    c.collabs.push({userId:uid,userName:u.name,status:'pending',
      invitedBy:S.currentUser?S.currentUser.id:'',invitedByName:S.currentUser?S.currentUser.name:'',
      invitedAt:now(),acceptedAt:null});
    c.updatedAt=now();okN++;
  });
  if(okN){saveC();syncNow();}
  closeModal('batchCollabModal');
  toast('已向 '+u.name+' 发起 '+okN+' 条合作邀请'+(skipDup?('，跳过'+skipDup+'条已合作'):'')+(skipOwner?('，跳过'+skipOwner+'条无权限'):''),okN?'success':'error');
  toggleBatchMode(false);
}
function doBatchInvalid(){
  var ids=(S.batchSel||[]).slice();
  if(!ids.length){toast('请先勾选客户','error');return}
  var allow=ids.filter(function(id){var c=findClient(id);return c&&canMarkClientInvalid(c)&&!c.invalid});
  if(!allow.length){toast('所选客户中没有可标记无效的','error');return}
  confirmDialog('批量标记无效','确定将选中的 '+allow.length+' 位客户标记为无效吗？标记后将置灰并排到列表最后。',function(){
    allow.forEach(function(id){var c=findClient(id);if(!c)return;
      c.invalid=true;c.invalidAt=now();c.invalidBy=S.currentUser?S.currentUser.id:'';c.updatedAt=now();});
    saveC();toast('已标记 '+allow.length+' 位客户为无效','success');toggleBatchMode(false);
  });
}
/* ===== 批量改状态 / 改级别 / 导出选中 / 批量删除（#259） ===== */
function doBatchStatus(){
  if(!S.batchSel.length){toast('请先选择客户','error');return}
  var statuses=['待联系','已联系','看房中','谈判中','已成交','暂缓'];
  var colors={'待联系':'#94a3b8','已联系':'#3b82f6','看房中':'#f59e0b','谈判中':'#7c3aed','已成交':'#16a34a','暂缓':'#64748b'};
  showBatchPicker('将 '+S.batchSel.length+' 位客户状态改为：',statuses.map(function(s){
    return{label:s,color:colors[s],value:s};
  }),function(status){
    var count=0;
    S.batchSel.forEach(function(cid){var c=findClient(cid);if(c&&canEditClient(c)){c.status=status;c.updatedAt=now();count++}});
    saveC();renderClientList();refreshBatchSelection();
    logAction('edit','client',null,'批量改状态('+count+'位→'+status+')');
    toast('已将 '+count+' 位客户状态改为「'+status+'」','success');
  });
}
function doBatchGrade(){
  if(!S.batchSel.length){toast('请先选择客户','error');return}
  var grades=[{label:'A级（高意向）',color:'#dc2626',value:'A'},{label:'B级（中意向）',color:'#f59e0b',value:'B'},{label:'C级（低意向）',color:'#2563eb',value:'C'}];
  showBatchPicker('将 '+S.batchSel.length+' 位客户级别改为：',grades,function(grade){
    var count=0;
    S.batchSel.forEach(function(cid){var c=findClient(cid);if(c&&canEditClient(c)){c.grade=grade;c.updatedAt=now();count++}});
    saveC();renderClientList();refreshBatchSelection();
    logAction('edit','client',null,'批量改级别('+count+'位→'+grade+'级)');
    toast('已将 '+count+' 位客户级别改为「'+grade+'级」','success');
  });
}
function doBatchExport(){
  if(!isAdmin()){toast('仅管理员可导出数据','error');return;}
  if(!S.batchSel.length){toast('请先选择客户','error');return}
  var list=S.batchSel.map(function(id){return findClient(id)}).filter(function(c){return c});
  if(!isAdmin()){list=list.filter(function(c){return c.createdBy===(S.currentUser?S.currentUser.id:'')})}
  if(!list.length){toast('没有可导出的客户','error');return}
  var cols=[['name','姓名'],['phones','电话'],['source','来源'],['grade','级别'],['status','状态'],['budgetMin','预算下限'],['budgetMax','预算上限'],['targetAreas','目标区域'],['purpose','购房目的'],['propertyType','物业类型'],['unitType','户型'],['wechat','微信'],['notes','备注'],['createdAt','录入时间']];
  exportCSV(list,cols,'选中客户_'+fmtDate(Date.now())+'.csv');
  toast('已导出 '+list.length+' 位客户','success');
}
function doBatchDelete(){
  if(!isAdmin()){toast('仅管理员可批量删除','error');return}
  if(!S.batchSel.length){toast('请先选择客户','error');return}
  var ids=S.batchSel.slice();
  var allow=ids.filter(function(id){var c=findClient(id);return c&&canDeleteClient(c)});
  if(!allow.length){toast('所选客户中没有可删除的','error');return}
  confirmDialog('批量删除','确定删除选中的 '+allow.length+' 位客户吗？此操作不可撤销！',function(){
    allow.forEach(function(id){var c=findClient(id);if(!c)return;
      markDeleted('client',c.id);logAction('delete','client',c.id,c.name);
      S.clients=S.clients.filter(function(x){return x.id!==id});
    });
    S.batchSel=[];saveC();renderClientList();toggleBatchMode(false);
    toast('已删除 '+allow.length+' 位客户','success');
  });
}
function showBatchPicker(title,options,callback){
  var picker=document.getElementById('batchPicker');
  if(!picker){picker=document.createElement('div');picker.id='batchPicker';picker.className='batch-picker-overlay';document.body.appendChild(picker)}
  picker.innerHTML='<div class="batch-picker-panel"><div class="bp-title">'+esc(title)+'</div><div class="bp-options">'
    +options.map(function(o){return'<button class="bp-option" data-val="'+esc(o.value)+'"><span class="bp-dot" style="background:'+o.color+'"></span>'+esc(o.label)+'</button>'}).join('')
    +'</div><button class="bp-cancel">取消</button></div>';
  picker.classList.add('show');
  picker.querySelectorAll('[data-val]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var val=btn.getAttribute('data-val');
      picker.classList.remove('show');
      callback(val);
    });
  });
  picker.querySelector('.bp-cancel').addEventListener('click',function(){picker.classList.remove('show')});
  picker.addEventListener('click',function(e){if(e.target===picker)picker.classList.remove('show')});
}
window.doBatchStatus=doBatchStatus;
window.doBatchGrade=doBatchGrade;
window.doBatchExport=doBatchExport;
window.doBatchDelete=doBatchDelete;

/* ===== 批量选择：轻量级 DOM 刷新（替代 renderClientList 全量重建） ===== */
function refreshBatchSelection(){
  /* O(1) 查找缓存：用对象 key 代替 Array.indexOf */
  var selMap={};(S.batchSel||[]).forEach(function(id){selMap[id]=true});
  var isSel=function(id){return !!selMap[id]};
  var grid=document.getElementById('clientGrid');
  var table=document.getElementById('clientTable');
  if(grid&&grid.style.display!=='none'){
    /* 卡片视图：只改 class / checkbox / 选中态，不重建 HTML */
    var cards=grid.querySelectorAll('.client-card');
    cards.forEach(function(card){
      var cid=card.getAttribute('data-id');
      card.classList.toggle('is-selected',isSel(cid));
      var cb=card.querySelector('.batch-cb');
      if(cb)cb.checked=isSel(cid);
    });
  }
  if(table&&table.style.display!=='none'){
    /* 表格视图：只改行 class + checkbox */
    var rows=table.querySelectorAll('tbody tr[data-id]');
    rows.forEach(function(row){
      var rid=row.getAttribute('data-id');
      row.classList.toggle('is-selected',isSel(rid));
      var cb=row.querySelector('.client-batch-cb');
      if(cb)cb.checked=isSel(rid);
    });
    var cca=document.getElementById('clientCheckAll');
    if(cca){var allChecked=true,hasRow=false;rows.forEach(function(r){hasRow=true;if(!isSel(r.getAttribute('data-id')))allChecked=false});cca.checked=hasRow&&allChecked}
  }
  updateBatchCount();
}

/* ===== 带看房源下拉：二手房 / 二手租赁 / 新楼盘 分组 ===== */
function propOptionLabel(p){
  if(p.type==='secondhand'||p.type==='rental'){
    var loc=[cleanCommunityName(p.community)||p.title||'未命名',p.building,p.unit,p.room].filter(Boolean).join(' ');
    var price=p.type==='rental'?(p.rentPrice?p.rentPrice+'元/月':''):(p.totalPrice?p.totalPrice+'万':'');
    return loc+(price?(' · '+price):'')+(p.district?(' · '+p.district):'');
  }
  return (p.title||'未命名')+(p.averagePriceText?(' · '+p.averagePriceText):(p.averagePrice?(' · '+p.averagePrice+'元/㎡'):''))+(p.district?(' · '+p.district):'');
}
function buildViewingPropOptions(selectedId){
  var groups=[{k:'secondhand',n:'二手房源'},{k:'rental',n:'二手租赁'},{k:'newdev',n:'新楼盘'}];
  return groups.map(function(g){
    var arr=(S.properties||[]).filter(function(p){return p.type===g.k&&!p.invalid});
    if(!arr.length)return '';
    arr.sort(function(a,b){return(b.updatedAt||0)-(a.updatedAt||0)});
    return'<optgroup label="'+g.n+'（'+arr.length+'）">'+arr.map(function(p){
      return'<option value="'+p.id+'"'+(selectedId===p.id?' selected':'')+'>'+esc(propOptionLabel(p))+'</option>';
    }).join('')+'</optgroup>';
  }).join('');
}

/* ===== 智能排序：最近跟进 / A类 / 新录入 孰先原则 ===== */
function smartClientScore(c){
  if(!c)return -99999;
  var s=0;
  if((S.pinnedIds||[]).indexOf(c.id)>=0)s+=1000;               /* 置顶最优先 */
  var lf=lastFollowup(c);
  if(lf){var d=daysSince(lf);
    if(d<=0)s+=120;else if(d<=1)s+=100;else if(d<=3)s+=75;else if(d<=7)s+=45;else if(d<=15)s+=18;
  }
  var g=c.grade;s+=(g==='A'?70:(g==='B'?30:(g==='C'?8:0)));    /* 等级 */
  var cd=daysSince(c.createdAt||0);
  if(cd<=0)s+=90;else if(cd<=1)s+=75;else if(cd<=3)s+=50;else if(cd<=7)s+=22;  /* 新录入 */
  if(needFollowup(c))s+=35;                                     /* 该跟进了 */
  if(c.status==='谈判中')s+=25;else if(c.status==='看房中')s+=18;
  else if(c.status==='已成交')s-=60;else if(c.status==='暂缓')s-=45;
  return s;
}

/* ========== Client: List ========== */
function renderClientList(){
  renderClientStats();
  updateFilterBadge('filterToggle',S.filters);
  var grid=document.getElementById('clientGrid');
  var table=document.getElementById('clientTable');
  if(S.clientView==='table'){
    grid.style.display='none';
    table.style.display='';
    renderClientTable();
    return;
  }
  grid.style.display='';
  table.style.display='none';
  var list=getFilteredClients();
  document.getElementById('resultCount').innerHTML='共 <b>'+list.length+'</b> 位客户 '+(isAdmin()?'<button class="btn btn-sm btn-outline" onclick="exportCurrentCSV(\x27clients\x27)" style="margin-left:12px;font-size:.75rem" title="导出客户列表为CSV">📥 导出CSV</button>':'');
  if(list.length===0){
    var isEmptyAll=S.clients.length===0;
    grid.innerHTML='<div class="empty" style="grid-column:1/-1"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><h3>'+(isEmptyAll?'还没有客户档案':'没有符合条件的客户')+'</h3><p>'+(isEmptyAll?'点击「新增客户」按钮录入，或加载示例数据体验功能':'试试调整筛选条件')+'</p>'+(isEmptyAll?'<button class="sample-btn" id="loadSampleBtn">加载示例数据</button>':'')+'</div>';
    var lsb=document.getElementById('loadSampleBtn');
    if(lsb)lsb.addEventListener('click',function(){
      confirmDialog('加载示例数据','将导入5位客户+4套房源+2条成交记录作为演示数据，可随时清空。',function(){
        S.clients=getSampleClients();S.properties=getSampleProperties();S.transactions=getSampleTransactions();
        saveC();saveP();saveT();renderClientList();renderPropertyList();renderTxList();
        toast('示例数据已加载','success');
      });
    });
    return;
  }
  grid.innerHTML=list.map(function(c){
    var lf=lastFollowup(c),nf=needFollowup(c);
    var tags=(c.customTags||[]).map(function(t){return'<span class="client-tag custom">'+esc(t)+'</span>'}).join('');
    if(c.purpose)tags+='<span class="client-tag">'+esc(c.purpose)+'</span>';
    if(c.propertyType)tags+='<span class="client-tag">'+esc(c.propertyType)+'</span>';
    if(c.unitType&&c.unitType!=='不限')tags+='<span class="client-tag">'+esc(c.unitType)+'</span>';
    if(c.targetAreas&&c.targetAreas.length)tags+='<span class="client-tag">'+esc(c.targetAreas.slice(0,2).join('·')+(c.targetAreas.length>2?'…':''))+'</span>';
    var mainPhone=(c.phones&&c.phones[0])?c.phones[0].number:'';
    var followupRel=lf?relDate(lf):'未跟进';
    var followupCls=nf?'overdue':(lf&&daysSince(lf)<3?'recent':'ok');
    return'<div class="client-card'+(c.invalid?' is-invalid':'')+(S.batchMode?' batch-mode':'')+(S.batchMode&&S.batchSel&&S.batchSel.indexOf(c.id)>=0?' is-selected':'')+'" data-grade="'+esc(c.grade)+'" data-id="'+c.id+'">'
      +'<label class="batch-check"><input type="checkbox" class="batch-cb" data-id="'+c.id+'"'+((S.batchSel||[]).indexOf(c.id)>=0?' checked':'')+'></label>'
      +(nf&&!c.invalid?'<div class="need-followup" title="需要跟进"></div>':'')
      +'<div class="client-card-top"><div><div class="client-name">'+esc(c.name)+' <span class="grade-badge" data-grade="'+esc(c.grade)+'">'+esc(c.grade)+'级</span>'+(c.invalid?'<span class="invalid-badge">无效</span>':'')+'</div>'
      +'<div class="client-phone"><a href="tel:'+esc(mainPhone)+'">'+esc(mainPhone)+'</a>'+(c.phones&&c.phones.length>1?' +'+(c.phones.length-1):'')+'</div></div>'
      +'<span class="status-badge" data-status="'+esc(c.status)+'">'+esc(c.status)+'</span></div>'
      +(isAdmin()&&c.createdByName?'<div class="creator-badge" title="录入人">'+esc(c.createdByName)+'</div>':'')
      +(tags?'<div class="client-tags">'+tags+'</div>':'')
      +'<div class="client-meta"><span>预算 <b>'+esc(fmtBudget(c.budgetMin,c.budgetMax))+'</b></span><span>来源 <b>'+esc(c.source||'—')+'</b></span><span>跟进 <b class="followup-rel '+followupCls+'">'+followupRel+'</b></span></div>'
      +'<div class="card-actions">'
      +'<button data-action="call" data-id="'+c.id+'">电话</button>'
      +'<button data-action="quick-followup" data-id="'+c.id+'">跟进</button>'
      +'<button data-action="view" data-id="'+c.id+'">详情</button>'
      +'<button data-action="edit" data-id="'+c.id+'">编辑</button>'
      +'</div>'
      +'<div class="quick-followup" id="qf-'+c.id+'">'
      +'<textarea id="qf-text-'+c.id+'" placeholder="添加最新跟进内容…" rows="2"></textarea>'
      +'<div class="quick-followup-bar">'
      +'<select id="qf-status-'+c.id+'"><option value="">不改状态</option><option>待联系</option><option>已联系</option><option>看房中</option><option>谈判中</option><option>已成交</option><option>暂缓</option></select>'
      +'<button class="btn btn-primary btn-sm" data-action="save-quick-followup" data-id="'+c.id+'">提交</button>'
      +'</div></div>'
      +'</div>';
  }).join('');
  // Card click
  grid.querySelectorAll('.client-card').forEach(function(card){
    card.addEventListener('click',function(e){
      if(e.target.closest('button')||e.target.closest('a')||e.target.closest('textarea')||e.target.closest('select'))return;
      var cid=card.getAttribute('data-id');
      if(S.batchMode){
        var cb=card.querySelector('.batch-cb'), will=!(S.batchSel&&S.batchSel.indexOf(cid)>=0);
        if(cb)cb.checked=will;
        toggleBatchPick(cid,will);
        card.classList.toggle('is-selected',will);
        if(e.target.classList&&e.target.classList.contains('batch-check'))e.preventDefault();
        return;
      }
      showClientDetail(cid);
    });
  });
  grid.querySelectorAll('.card-actions button').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();var a=btn.getAttribute('data-action'),id=btn.getAttribute('data-id');
      if(a==='view')showClientDetail(id);
      if(a==='edit')openClientForm(id);
      if(a==='call'){
        var c=findClient(id);if(!c||!c.phones||!c.phones.length)return;
        window.location.href='tel:'+c.phones[0].number;
      }
      if(a==='quick-followup'){
        var qf=document.getElementById('qf-'+id);
        if(qf){
          qf.classList.toggle('show');
          if(qf.classList.contains('show')){
            var ta=document.getElementById('qf-text-'+id);if(ta)setTimeout(function(){ta.focus()},50);
            var sel=document.getElementById('qf-status-'+id);if(sel){sel.value='';var cl=findClient(id);if(cl)sel.value=cl.status}
          }
        }
      }
      if(a==='save-quick-followup'){
        var text=document.getElementById('qf-text-'+id).value.trim();
        if(!text){toast('请输入跟进内容','error');return}
        var cl=findClient(id);if(!cl)return;
        var newStatus=document.getElementById('qf-status-'+id).value;
        if(!cl.followUps)cl.followUps=[];
        cl.followUps.push({id:uuid(),content:text,date:now(),reminderDate:null,authorId:S.currentUser?S.currentUser.id:'',authorName:S.currentUser?S.currentUser.name:''});
        if(newStatus&&newStatus!==cl.status){cl.status=newStatus}
        cl.updatedAt=now();saveC();renderClientList();toast('跟进已记录','success');
      }
    });
  });
  updateCollabBadge();
}

function renderClientTable(){
  var list=getFilteredClients();
  var table=document.getElementById('clientTable');
  document.getElementById('resultCount').innerHTML='共 <b>'+list.length+'</b> 位客户 '+(isAdmin()?'<button class="btn btn-sm btn-outline" onclick="exportCurrentCSV(\x27clients\x27)" style="margin-left:12px;font-size:.75rem" title="导出客户列表为CSV">📥 导出CSV</button>':'');

  if(list.length===0){
    var isEmptyAll=S.clients.length===0;
    table.innerHTML='<div class="empty" style="padding:40px"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><h3>'+(isEmptyAll?'还没有客户档案':'没有符合条件的客户')+'</h3><p>'+(isEmptyAll?'点击「新增客户」按钮录入，或加载示例数据体验功能':'试试调整筛选条件')+'</p>'+(isEmptyAll?'<button class="sample-btn" id="loadSampleBtn2">加载示例数据</button>':'')+'</div>';
    var btn=document.getElementById('loadSampleBtn2');
    if(btn)btn.addEventListener('click',function(){
      confirmDialog('加载示例数据','将导入5位客户+4套房源+2条成交记录作为演示数据，可随时清空。',function(){
        S.clients=getSampleClients();S.properties=getSampleProperties();S.transactions=getSampleTransactions();
        saveC();saveP();saveT();renderClientList();renderPropertyList();renderTxList();
        toast('示例数据已加载','success');
      });
    });
    return;
  }

  var html='<div class="client-table-wrap"><table class="client-table"><thead><tr>'
    +'<th style="width:44px" id="batchHdrCell"><input type="checkbox" id="clientCheckAll" title="全选/取消全选" style="width:20px;height:20px;cursor:pointer;accent-color:var(--primary)"></th>'
    +'<th>等级</th>'
    +'<th>客户</th>'
    +'<th>电话</th>'
    +'<th>来源</th>'
    +'<th>区域</th>'
    +'<th>预算</th>'
    +'<th>状态</th>'
    +'<th style="width:120px;max-width:160px">需求 / 备注</th>'
    +'<th style="min-width:180px">跟进</th>'
    +'<th>归属</th>'
    +'<th>录入时间</th>'
    +'<th>操作</th>'
    +'</tr></thead><tbody>';

  for(var i=0;i<list.length;i++){
    var c=list[i];
    var lf=lastFollowup(c);
    var nf=needFollowup(c);
    var mainPhone=(c.phones&&c.phones[0])?c.phones[0].number:'';
    var followupRel=lf?relDate(lf):'<span style="color:var(--danger)">未跟进</span>';
    var followupContent=lf?(c.followUps.filter(function(f){return f.date===lf})[0]||{}).content||'暂无跟进记录':'点击右侧跟进按钮开始记录';
    var pinned=(S.pinnedIds||[]).indexOf(c.id)>=0;
    var inactive=c.status==='暂缓'||c.status==='已流失';
    var completed=c.status==='已成交';

    var rowCls=['grade-'+((c.grade||'C')).toLowerCase()];
    if(pinned)rowCls.push('is-pinned');
    if(inactive)rowCls.push('invalid');
    if(completed)rowCls.push('is-completed');
    html+='<tr data-id="'+c.id+'" class="'+rowCls.join(' ')+(S.batchMode&&S.batchSel&&S.batchSel.indexOf(c.id)>=0?' is-selected':'')+'">'
      +'<td class="ct-batch-td"><label class="ct-batch-cb-wrap"><input type="checkbox" class="client-batch-cb" data-id="'+c.id+'"'+(S.batchSel&&S.batchSel.indexOf(c.id)>=0?' checked':'')+'></label>'+(pinned?'<span title="重点关注" style="color:var(--warning);margin-left:4px;font-size:.85rem">⭐</span>':'')+'</td>'
      +'<td><span class="ct-grade-'+esc(c.grade)+'" title="'+esc(c.grade)+'级">'+esc(c.grade||'?')+'</span></td>'
      +'<td><span class="ct-name" title="'+esc(c.name||'')+'">'+esc(c.name||'未命名')+'</span>'
      +(c.customTags&&c.customTags.length?' <span style="font-size:.75rem;color:var(--danger)">🏷</span>':'')
      +(completed?' <span style="display:inline-block;padding:1px 4px;background:#dcfce7;color:#166534;font-size:.75rem;border-radius:3px;font-weight:600">已购</span>':'')
      +(inactive?' <span style="display:inline-block;padding:1px 4px;background:var(--gray-200);color:var(--text-muted);font-size:.75rem;border-radius:3px;font-weight:600">暂缓</span>':'')
      +(nf?' <span style="display:inline-block;padding:1px 4px;background:var(--danger-light);color:var(--danger);font-size:.75rem;border-radius:3px;font-weight:600">需跟进</span>':'')
      +'</td>'
      +'<td><a class="ct-phone" href="tel:'+esc(mainPhone)+'">'+esc(mainPhone)+(c.phones&&c.phones.length>1?'+'+(c.phones.length-1):'')+'</a></td>'
      +'<td><span class="ct-source">'+esc(c.source||'—')+'</span></td>'
      +'<td><span class="ct-area" title="'+(c.targetAreas||[]).join('·')+'">'+(c.targetAreas&&c.targetAreas.length?esc(c.targetAreas.slice(0,2).join('·')+(c.targetAreas.length>2?'…':'')):'—')+'</span></td>'
      +'<td><span class="ct-budget">'+esc(fmtBudget(c.budgetMin,c.budgetMax))+'</span></td>'
      +'<td><select class="ct-status-select" data-status-id="'+c.id+'" data-current="'+esc(c.status||'待联系')+'">'
      +'<option value="待联系"'+(c.status==='待联系'?' selected':'')+'>待联系</option>'
      +'<option value="已联系"'+(c.status==='已联系'?' selected':'')+'>已联系</option>'
      +'<option value="看房中"'+(c.status==='看房中'?' selected':'')+'>看房中</option>'
      +'<option value="谈判中"'+(c.status==='谈判中'?' selected':'')+'>谈判中</option>'
      +'<option value="已成交"'+(c.status==='已成交'?' selected':'')+'>已成交</option>'
      +'<option value="暂缓"'+(c.status==='暂缓'?' selected':'')+'>暂缓</option>'
      +'</select></td>'
      +'<td class="ct-req-td"><span class="ct-requirements ct-req-text" title="'+esc(c.notes||c.requirements||'')+'">'+(c.notes||c.requirements?esc(c.notes||c.requirements):'<span style="color:var(--gray-400)">—</span>')+'</span></td>'
      +'<td>'
      +'<div class="ct-followup-content">'+esc(followupContent)+'</div>'
      +'<div class="ct-followup-time">'+followupRel+'</div>'
      +'<button class="ct-followup-btn" data-followup-id="'+c.id+'">+ 跟进</button>'
      +'</td>'
      +'<td><span class="ct-owner">'+(c.createdByName?esc(c.createdByName):'<span style="color:var(--gray-400)">—</span>')+'</span></td>'
      +'<td><span class="ct-time">'+esc(fmtDate(c.createdAt))+'</span></td>'
      +'<td>'
      +'<button class="ct-action-btn" data-pin-id="'+c.id+'" title="'+(pinned?'取消重点':'标为重点')+'">'+(pinned?'⭐':'☆')+'</button>'
      +'<button class="ct-action-btn" data-view-id="'+c.id+'" title="详情">详情</button>'
      +'</td>'
      +'</tr>';
  }
  html+='</tbody></table></div>';
  table.innerHTML=html;

  /* sticky header: 让表格容器有固定高度，thead sticky 生效 */
  (function(){
    var wrap=table.querySelector('.client-table-wrap');
    if(!wrap)wrap=table.parentElement;
    if(!wrap)return;
    var vh=window.innerHeight||document.documentElement.clientHeight||600;
    var rect=wrap.getBoundingClientRect();
    var offsetTop=rect.top+window.scrollY;
    var avail=Math.max(300,vh-offsetTop-20/*底部留白*/);
    wrap.style.maxHeight=avail+'px';
  })();

  /* attach event handlers */
  /* status change */
  table.querySelectorAll('.ct-status-select').forEach(function(sel){
    sel.addEventListener('change',function(e){
      e.stopPropagation();
      var id=sel.getAttribute('data-status-id');
      var newStatus=sel.value;
      var c=findClient(id);
      if(!c)return;
      var oldStatus=c.status;
      c.status=newStatus;c.updatedAt=now();
      /* if changed to 已成交, add a followup note */
      if(newStatus!==oldStatus&&newStatus==='已成交'){
        if(!cc.followUps)cc.followUps=[];
        cc.followUps.push({id:uuid(),content:'状态变更为「已成交」',date:now(),reminderDate:null,authorId:S.currentUser?S.currentUser.id:'',authorName:S.currentUser?S.currentUser.name:''});
      }else if(newStatus!==oldStatus){
        if(!c.followUps)c.followUps=[];
        c.followUps.push({id:uuid(),content:'状态变更为「'+newStatus+'」',date:now(),reminderDate:null,authorId:S.currentUser?S.currentUser.id:'',authorName:S.currentUser?S.currentUser.name:''});
      }
      saveC();renderClientStats();renderClientTable();
      toast('已更新为：'+newStatus,'success');
    });
    sel.addEventListener('click',function(e){e.stopPropagation()});
  });

  /* followup button */
  table.querySelectorAll('[data-followup-id]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      var id=btn.getAttribute('data-followup-id');
      quickFollowupPrompt(id);
    });
  });

  /* pin/unpin */
  table.querySelectorAll('[data-pin-id]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      var id=btn.getAttribute('data-pin-id');
      S.pinnedIds=S.pinnedIds||[];
      var idx=S.pinnedIds.indexOf(id);
      if(idx>=0)S.pinnedIds.splice(idx,1);
      else S.pinnedIds.push(id);
      renderClientTable();
      toast(idx>=0?'已取消重点':'已标为重点关注','success');
    });
  });

  /* view detail */
  table.querySelectorAll('[data-view-id]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      showClientDetail(btn.getAttribute('data-view-id'));
    });
  });

  /* row click -> detail / 批量勾选 */
  table.querySelectorAll('tbody tr').forEach(function(row){
    row.addEventListener('click',function(e){
      if(e.target.closest('button')||e.target.closest('select')||e.target.closest('a'))return;
      var rid=row.getAttribute('data-id');
      if(e.target.closest('.ct-batch-cb-wrap')){
        var cb=row.querySelector('.client-batch-cb'), will=!(S.batchSel&&S.batchSel.indexOf(rid)>=0);
        if(!S.batchMode){S.batchMode=true;var _bar=document.getElementById('batchBar');if(_bar)_bar.classList.add('show');var _btn=document.getElementById('batchModeBtn');if(_btn){_btn.classList.add('btn-primary');_btn.classList.remove('btn-outline')}}
        if(cb)cb.checked=will;
        toggleBatchPick(rid,will);
        row.classList.toggle('is-selected',will);
        e.preventDefault();e.stopPropagation();
        updateBatchCount();
        return;
      }
      if(S.batchMode){
        var cb=row.querySelector('.client-batch-cb'), will=!(S.batchSel&&S.batchSel.indexOf(rid)>=0);
        if(cb)cb.checked=will;
        toggleBatchPick(rid,will);
        row.classList.toggle('is-selected',will);
        return;
      }
      showClientDetail(rid);
    });
  });
  var _cca=document.getElementById('clientCheckAll');
  if(_cca){
    _cca.addEventListener('change',function(){
      if(!S.batchMode){S.batchMode=true;var _bar=document.getElementById('batchBar');if(_bar)_bar.classList.add('show');var _btn=document.getElementById('batchModeBtn');if(_btn){_btn.classList.add('btn-primary');_btn.classList.remove('btn-outline')}}
      table.querySelectorAll('tbody tr').forEach(function(r){var id=r.getAttribute('data-id');var b=r.querySelector('.client-batch-cb');if(b){b.checked=_cca.checked;if(_cca.checked&&S.batchSel.indexOf(id)<0)S.batchSel.push(id);if(!_cca.checked){var k=S.batchSel.indexOf(id);if(k>=0)S.batchSel.splice(k,1)}}r.classList.toggle('is-selected',_cca.checked)});
      updateBatchCount();
    });
  }
}

function quickFollowupPrompt(id){
  var c=findClient(id);if(!c)return;
  /* 自定义模态框替代原生 prompt()（原生 prompt 在手机端会显示"JavaScript"标识） */
  var _qfId=id;
  _removeQfModal();
  var overlay=document.createElement('div');
  overlay.id='qfModalOverlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML='<div style="background:#fff;border-radius:12px;width:100%;max-width:400px;padding:20px;box-shadow:0 8px 30px rgba(0,0,0,.15)"><h3 style="margin:0 0 12px;font-size:1rem;font-weight:600;color:var(--text-primary)">记录跟进</h3><div style="font-size:.8125rem;color:var(--text-muted);margin-bottom:10px">客户：'+esc(c.name)+' · 状态：'+esc(c.status||'待联系')+'</div><textarea id="qfContent" rows="3" placeholder="输入跟进内容..." style="width:100%;border:1px solid var(--gray-300);border-radius:8px;padding:10px;font-size:.875rem;resize:vertical;box-sizing:border-box;outline:none"></textarea><div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end"><button id="qfCancel" type="button" style="padding:8px 18px;border:1px solid var(--gray-300);border-radius:8px;background:var(--gray-50);color:var(--text-secondary);font-size:.875rem;cursor:pointer">取消</button><button id="qfConfirm" type="button" style="padding:8px 18px;border:none;border-radius:8px;background:var(--primary);color:#fff;font-size:.875rem;cursor:pointer;font-weight:500">确定</button></div></div>';
  document.body.appendChild(overlay);
  var ta=document.getElementById('qfContent');
  if(ta)ta.focus();
  document.getElementById('qfCancel').addEventListener('click',_removeQfModal);
  document.getElementById('qfConfirm').addEventListener('click',function(){
    var content=(document.getElementById('qfContent').value||'').trim();
    if(!content){toast('请输入跟进内容');return;}
    var client=findClient(_qfId);if(!client)return;
    if(!client.followUps)client.followUps=[];
    client.followUps.push({id:uuid(),content:content,date:now(),reminderDate:null,authorId:S.currentUser?S.currentUser.id:'',authorName:S.currentUser?S.currentUser.name:''});
    client.updatedAt=now();
    saveC();renderClientStats();
    if(S.clientView==='table')renderClientTable();
    else renderClientList();
    toast('跟进已记录','success');
    _removeQfModal();
  });
  overlay.addEventListener('click',function(e){if(e.target===overlay)_removeQfModal()});
}
function _removeQfModal(){var el=document.getElementById('qfModalOverlay');if(el)el.remove()}

/* ========== Client: Form ========== */
function openClientForm(id){
  try{
  S.editClientId=id||null;S.editTags=[];S.editPhones=[];S.editAreas=[];
  document.getElementById('clientFormTitle').textContent=id?'编辑客户':'新增客户';
  document.getElementById('cfId').value=id||'';
  var c=id?findClient(id):{};
  document.getElementById('cfName').value=c.name||'';
  document.getElementById('cfWechat').value=c.wechat||'';
  document.getElementById('cfGender').value=c.gender||'未知';
  var _srcSel=document.getElementById('cfSource');
  ensureSourceOption(_srcSel,c.source);
  _srcSel.value=c.source||'自来客';
  document.getElementById('cfGrade').value=c.grade||'B';
  document.getElementById('cfPurpose').value=c.purpose||'刚需';
  document.getElementById('cfPropertyType').value=c.propertyType||'住宅';
  document.getElementById('cfUnitType').value=c.unitType||'不限';
  document.getElementById('cfBudgetMin').value=c.budgetMin||'';
  document.getElementById('cfBudgetMax').value=c.budgetMax||'';
  document.getElementById('cfRequirements').value=c.requirements||'';
  document.getElementById('cfStatus').value=c.status||'待联系';
  document.getElementById('cfNotes').value=c.notes||'';
  document.getElementById('cfBirthday').value=c.birthday||'';
  S.editPhones=(c.phones||(c.phone?[{label:'手机',number:c.phone}]:[{label:'手机',number:''}])).map(function(p){return{label:p.label,number:p.number}});
  S.editTags=(c.customTags||[]).slice();
  S.editAreas=(c.targetAreas||[]).slice();
  /* 需求画像字段 */
  document.getElementById('cfUrgency').value=c.urgency||'';
  document.getElementById('cfPaymentMethod').value=c.paymentMethod||'';
  document.getElementById('cfDownPayment').value=c.downPayment||'';
  document.getElementById('cfMonthlyBudget').value=c.monthlyBudget||'';
  document.getElementById('cfOrientation').value=c.preferredOrientation||'';
  document.getElementById('cfPreferredFloor').value=c.preferredFloor||'';
  document.getElementById('cfDecorationReq').value=c.decorationReq||'';
  document.getElementById('cfSchoolReq').value=c.schoolReq||'';
  document.getElementById('cfParkingReq').value=c.parkingReq||'';
  document.getElementById('cfCommuteTarget').value=c.commuteTarget||'';
  document.getElementById('cfCommuteTime').value=c.commuteTime||'';
  document.getElementById('cfFamilyInfo').value=c.familyInfo||'';
  S.editMustHaves=(c.mustHaves||[]).slice();
  S.editDealBreakers=(c.dealBreakers||[]).slice();
  /* 管理员发起合作的客户：非管理员编辑时联系电话只读，不可删改（改删权归管理员） */
  S.cfPhoneReadOnly=!!(id&&!isAdmin()&&adminInvolvedClient(c));
  S.cfOriginalPhoneCount=S.editPhones.length;
  renderPhoneList();renderTagChips();renderAreaCheckboxes();renderMustHaves();renderDealBreakers();
  document.getElementById('clientFormModal').classList.add('show');
  var cfMb=document.querySelector('#clientFormModal .modal-body');if(cfMb)cfMb.scrollTop=0;
  }catch(err){
    console.error('[openClientForm]',err);
    toast('打开客户表单失败: '+(err&&err.message||err),'error');
  }
}
function renderPhoneList(){
  var ro=S.cfPhoneReadOnly;
  var origCnt=S.cfOriginalPhoneCount||0;
  document.getElementById('cfPhoneList').innerHTML=S.editPhones.map(function(p,i){
    var isOrig=ro&&(i<origCnt);
    return'<div class="phone-row"><select class="phone-label"'+(isOrig?' disabled':'')+'><option value="手机"'+(p.label==='手机'?' selected':'')+'>手机</option><option value="座机"'+(p.label==='座机'?' selected':'')+'>座机</option><option value="家属"'+(p.label==='家属'?' selected':'')+'>家属</option><option value="其他"'+(p.label==='其他'?' selected':'')+'>其他</option></select><input type="tel" class="phone-num" value="'+esc(p.number)+'" placeholder="电话号码" maxlength="11"'+(isOrig?' readonly':'')+'><button type="button" class="del-phone" data-idx="'+i+'"'+(isOrig?' style="display:none"':'')+'><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  }).join('');
  /* 添加按钮始终显示（非管理员也可添加新号码） */
  var addBtn=document.getElementById('cfAddPhone');if(addBtn)addBtn.style.display='';
  if(ro){
    var tip=document.getElementById('cfPhoneReadOnlyTip');if(tip){tip.textContent='🔒 原有电话只读，可以添加新电话';tip.style.display=''}
  }else{
    var tip=document.getElementById('cfPhoneReadOnlyTip');if(tip)tip.style.display='none'
  }
  document.querySelectorAll('#cfPhoneList .del-phone').forEach(function(btn){
    btn.addEventListener('click',function(){syncPhonesToState();S.editPhones.splice(parseInt(btn.getAttribute('data-idx')),1);renderPhoneList()});
  });
}
function syncPhonesToState(){
  S.editPhones=[];
  document.querySelectorAll('#cfPhoneList .phone-row').forEach(function(row){
    S.editPhones.push({label:row.querySelector('.phone-label').value,number:row.querySelector('.phone-num').value.trim()});
  });
}
function renderTagChips(){
  var container=document.getElementById('cfTagContainer');
  var chips=S.editTags.map(function(t,i){return'<span class="tag-chip">'+esc(t)+'<span class="remove" data-idx="'+i+'">×</span></span>'}).join('');
  container.innerHTML=chips+'<input type="text" id="cfTagInput" placeholder="输入后回车添加">';
  var input=document.getElementById('cfTagInput');
  input.addEventListener('keydown',function(e){
    if(e.key==='Enter'||e.key===','){e.preventDefault();var v=this.value.trim();if(v&&S.editTags.indexOf(v)<0){S.editTags.push(v);renderTagChips();}else{this.value=''}}
  });
  container.querySelectorAll('.tag-chip .remove').forEach(function(el){
    el.addEventListener('click',function(){S.editTags.splice(parseInt(el.getAttribute('data-idx')),1);renderTagChips()});
  });
  input.focus();
}
function renderAreaCheckboxes(){
  document.getElementById('cfAreaGroup').innerHTML=AREAS.map(function(a){
    var ck=S.editAreas.indexOf(a)>=0;
    return'<span class="checkbox-item'+(ck?' checked':'')+'" data-area="'+a+'">'+a+'</span>';
  }).join('');
  document.querySelectorAll('#cfAreaGroup .checkbox-item').forEach(function(el){
    el.addEventListener('click',function(){
      var a=el.getAttribute('data-area');var i=S.editAreas.indexOf(a);
      if(i>=0){S.editAreas.splice(i,1);el.classList.remove('checked')}else{S.editAreas.push(a);el.classList.add('checked')}
    });
  });
}
/* ===== 需求画像：必须满足 / 不可接受 标签渲染 ===== */
function renderMustHaves(){
  var container=document.getElementById('cfMustHavesContainer');
  if(!container)return;
  var chips=S.editMustHaves.map(function(t,i){return'<span class="tag-chip" style="background:var(--success-light);color:var(--success)">'+esc(t)+'<span class="remove" data-idx="'+i+'">×</span></span>'}).join('');
  container.innerHTML=chips+'<input type="text" id="cfMustHavesInput" placeholder="输入后回车添加，如：南北通透、学区、地铁500米内">';
  var input=document.getElementById('cfMustHavesInput');
  input.addEventListener('keydown',function(e){
    if(e.key==='Enter'||e.key===','){e.preventDefault();var v=this.value.trim();if(v&&S.editMustHaves.indexOf(v)<0){S.editMustHaves.push(v);renderMustHaves();}else{this.value=''}}
  });
  container.querySelectorAll('.tag-chip .remove').forEach(function(el){
    el.addEventListener('click',function(){S.editMustHaves.splice(parseInt(el.getAttribute('data-idx')),1);renderMustHaves()});
  });
  input.focus();
}
function renderDealBreakers(){
  var container=document.getElementById('cfDealBreakersContainer');
  if(!container)return;
  var chips=S.editDealBreakers.map(function(t,i){return'<span class="tag-chip" style="background:#fee2e2;color:#dc2626">'+esc(t)+'<span class="remove" data-idx="'+i+'">×</span></span>'}).join('');
  container.innerHTML=chips+'<input type="text" id="cfDealBreakersInput" placeholder="输入后回车添加，如：临高架、顶楼、暗卫">';
  var input=document.getElementById('cfDealBreakersInput');
  input.addEventListener('keydown',function(e){
    if(e.key==='Enter'||e.key===','){e.preventDefault();var v=this.value.trim();if(v&&S.editDealBreakers.indexOf(v)<0){S.editDealBreakers.push(v);renderDealBreakers();}else{this.value=''}}
  });
  container.querySelectorAll('.tag-chip .remove').forEach(function(el){
    el.addEventListener('click',function(){S.editDealBreakers.splice(parseInt(el.getAttribute('data-idx')),1);renderDealBreakers()});
  });
  input.focus();
}
/* ===== 需求画像卡：详情页渲染 ===== */
function renderNeedProfileCard(c){
  var hasProfile=c.urgency||c.paymentMethod||c.downPayment||c.monthlyBudget||c.preferredOrientation||c.preferredFloor||c.decorationReq||c.schoolReq||c.parkingReq||c.commuteTarget||c.commuteTime||c.familyInfo||(c.mustHaves&&c.mustHaves.length)||(c.dealBreakers&&c.dealBreakers.length);
  var html='<div class="detail-section"><h3>购房需求</h3><div class="detail-grid">'
    +di('购房目的',c.purpose)+di('物业类型',c.propertyType)+di('户型',c.unitType)+di('预算',fmtBudget(c.budgetMin,c.budgetMax))+di('目标区域',(c.targetAreas&&c.targetAreas.length)?c.targetAreas.join('、'):'不限')+di('其他需求',c.requirements)
    +'</div></div>';
  if(hasProfile){
    var urgencyColor={'急购':'#dc2626','1-3月':'#ea580c','3-6月':'#d97706','半年以上':'#65a30d','观望中':'#6b7280'};
    var uc=urgencyColor[c.urgency]||'#6b7280';
    html+='<div class="need-profile-card">'
      +'<div class="npc-header"><span class="npc-icon">🎯</span><span class="npc-title">需求画像</span></div>'
      +'<div class="npc-body">';
    /* 第一行：紧迫度 + 付款方式 + 首付 + 月供 */
    var row1='';
    if(c.urgency)row1+='<div class="npc-item"><span class="npc-label">紧迫度</span><span class="npc-value" style="color:'+uc+';font-weight:600">'+esc(c.urgency)+'</span></div>';
    if(c.paymentMethod)row1+='<div class="npc-item"><span class="npc-label">付款方式</span><span class="npc-value">'+esc(c.paymentMethod)+'</span></div>';
    if(c.downPayment)row1+='<div class="npc-item"><span class="npc-label">首付</span><span class="npc-value">'+c.downPayment+'万</span></div>';
    if(c.monthlyBudget)row1+='<div class="npc-item"><span class="npc-label">月供≤</span><span class="npc-value">'+c.monthlyBudget+'元</span></div>';
    if(row1)html+='<div class="npc-row">'+row1+'</div>';
    /* 第二行：朝向 + 楼层 + 装修 + 车位 */
    var row2='';
    if(c.preferredOrientation)row2+='<div class="npc-item"><span class="npc-label">朝向</span><span class="npc-value">'+esc(c.preferredOrientation)+'</span></div>';
    if(c.preferredFloor)row2+='<div class="npc-item"><span class="npc-label">楼层</span><span class="npc-value">'+esc(c.preferredFloor)+'</span></div>';
    if(c.decorationReq)row2+='<div class="npc-item"><span class="npc-label">装修</span><span class="npc-value">'+esc(c.decorationReq)+'</span></div>';
    if(c.parkingReq)row2+='<div class="npc-item"><span class="npc-label">车位</span><span class="npc-value">'+esc(c.parkingReq)+'</span></div>';
    if(row2)html+='<div class="npc-row">'+row2+'</div>';
    /* 第三行：学区 + 通勤 + 家庭 */
    var row3='';
    if(c.schoolReq)row3+='<div class="npc-item"><span class="npc-label">学区</span><span class="npc-value">'+esc(c.schoolReq)+'</span></div>';
    if(c.commuteTarget)row3+='<div class="npc-item"><span class="npc-label">通勤至</span><span class="npc-value">'+esc(c.commuteTarget)+(c.commuteTime?'（≤'+c.commuteTime+'分钟）':'')+'</span></div>';
    if(c.familyInfo)row3+='<div class="npc-item"><span class="npc-label">家庭</span><span class="npc-value">'+esc(c.familyInfo)+'</span></div>';
    if(row3)html+='<div class="npc-row">'+row3+'</div>';
    /* 必须满足 + 不可接受 */
    if(c.mustHaves&&c.mustHaves.length){
      html+='<div class="npc-tags-section"><span class="npc-tags-label" style="color:var(--success)">✓ 必须满足</span><div class="npc-tags">'+c.mustHaves.map(function(t){return'<span class="npc-tag must">'+esc(t)+'</span>'}).join('')+'</div></div>';
    }
    if(c.dealBreakers&&c.dealBreakers.length){
      html+='<div class="npc-tags-section"><span class="npc-tags-label" style="color:#dc2626">✗ 不可接受</span><div class="npc-tags">'+c.dealBreakers.map(function(t){return'<span class="npc-tag dealbreaker">'+esc(t)+'</span>'}).join('')+'</div></div>';
    }
    html+='</div></div>';
  }
  return html;
}
/* ===== 客户专属选房报告（面向客户的房源短名单 + 匹配理由） ===== */
function buildSelectionReport(clientId){
  var c=findClient(clientId); if(!c)return null;
  var props=(S.properties||[]).filter(function(p){return p.type!=='md'&&p.type!=='community'&&!p.invalid;});
  var matched=[];
  props.forEach(function(p){
    var reasons=[]; var score=0;
    if(c.targetAreas&&c.targetAreas.length&&p.district&&c.targetAreas.indexOf(p.district)>=0){score+=3;reasons.push('区域匹配·'+p.district);}
    var price=p.totalPrice||(p.type==='rental'?Math.round((p.rentPrice||0)/10000):0);
    if(c.budgetMax&&price&&price<=c.budgetMax){score+=2;reasons.push('总价在预算内（'+price+'万）');}
    else if(c.budgetMin&&price&&price>=c.budgetMin){score+=1;reasons.push('总价达标');}
    if(c.unitType&&c.unitType!=='不限'&&p.layout&&p.layout.indexOf(c.unitType.replace(/室.*/,'室'))>=0){score+=1;reasons.push('户型符合·'+c.unitType);}
    if(c.mustHaves&&c.mustHaves.length){
      c.mustHaves.forEach(function(mh){
        if((p.metro&&p.metro.indexOf(mh)>=0)||(p.school&&p.school.indexOf(mh)>=0)||(p.orientation&&p.orientation.indexOf(mh)>=0)){reasons.push('满足：'+mh);score+=1;}
      });
    }
    if(score>0)matched.push({p:p,s:score,reasons:reasons});
  });
  matched.sort(function(a,b){return b.s-a.s;});
  return {c:c,top:matched.slice(0,6)};
}
function _propPriceText(p){
  if(p.type==='rental')return p.rentPrice?p.rentPrice+'元/月':'—';
  if(p.totalPrice)return p.totalPrice+'万';
  return p.averagePriceText||(p.averagePrice?p.averagePrice+'元/㎡':'—');
}
function _propTitle(p){return (p.type==='secondhand'||p.type==='rental')?cleanCommunityName(p.community):(p.title||'未命名');}
function showSelectionReport(clientId){
  var r=buildSelectionReport(clientId); if(!r)return;
  S._curSelReport=r;
  var c=r.c, top=r.top;
  var need=[];
  need.push('· 购房目的：'+(c.purpose||'—'));
  need.push('· 预算：'+(fmtBudget(c.budgetMin,c.budgetMax)||'—'));
  need.push('· 目标区域：'+((c.targetAreas&&c.targetAreas.length)?c.targetAreas.join('、'):'不限'));
  if(c.unitType&&c.unitType!=='不限')need.push('· 户型：'+c.unitType);
  if(c.mustHaves&&c.mustHaves.length)need.push('· 必须满足：'+c.mustHaves.join('、'));
  var cards=top.map(function(m,i){
    var p=m.p;
    var info=[(p.district&&p.block?(p.district+'·'+p.block):(p.district||'')),p.area?p.area+'㎡':'',p.layout||'',p.orientation||''].filter(Boolean).join(' / ');
    return '<div class="sr-card"><div class="sr-rank">'+(i+1)+'</div>'
      +'<div class="sr-main"><div class="sr-title">'+esc(_propTitle(p))+'</div>'
      +'<div class="sr-meta">'+esc(info)+'</div>'
      +'<div class="sr-price">'+esc(_propPriceText(p))+'</div>'
      +'<div class="sr-reasons">'+m.reasons.map(function(x){return '<span class="sr-reason">✓ '+esc(x)+'</span>'}).join('')+'</div></div></div>';
  }).join('');
  var html='<div class="sr-need"><b>'+esc(c.name)+'</b> 的选房需求：<br>'+need.join('<br>')+'</div>'
    +(top.length?'<div class="sr-list">'+cards+'</div>':'<div class="memo-empty">暂无可匹配的房源，建议扩充房源库或放宽条件</div>');
  document.getElementById('selReportBody').innerHTML=html;
  document.getElementById('selReportModal').classList.add('show');
}
window.showSelectionReport=showSelectionReport;
/* ===== 客户专属购房方案书 ===== */
function matchPropsForClient(c){
  var props=(S.properties||[]).filter(function(p){return p.type!=='md'&&p.type!=='community'&&!p.invalid;});
  var out=[];
  props.forEach(function(p){
    var score=0;
    if(c.targetAreas&&c.targetAreas.length&&p.district&&c.targetAreas.indexOf(p.district)>=0)score+=3;
    var price=p.totalPrice||(p.type==='rental'?Math.round((p.rentPrice||0)/10000):0);
    if(c.budgetMin&&price&&price>=c.budgetMin)score+=1;
    if(c.budgetMax&&price&&price<=c.budgetMax)score+=2;
    if((!c.budgetMin||!c.budgetMax)&&price)score+=1;
    if(c.unitType&&c.unitType!=='不限'&&p.layout&&p.layout.indexOf(c.unitType.replace(/室.*/,'室'))>=0)score+=1;
    if(score>0)out.push({p:p,s:score});
  });
  out.sort(function(a,b){return b.s-a.s||(b.p.updatedAt||0)-(a.p.updatedAt||0)});
  return out.slice(0,5).map(function(x){return x.p});
}
function estimateMonthly(loanWan,years){
  if(!loanWan||loanWan<=0)return 0;
  var r=0.042/12, n=years*12;
  var m=loanWan*10000*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1);
  return Math.round(m);
}
function generatePurchasePlan(clientId){
  var c=findClient(clientId);if(!c)return;
  S._curPlanClientId=clientId;
  var budgetTxt=fmtBudget(c.budgetMin,c.budgetMax);
  /* 资金方案估算 */
  var total=c.budgetMax||c.budgetMin||0;
  var down=c.downPayment||(total?Math.round(total*0.3):0);
  var loan=Math.max(0,total-down);
  var monthly=estimateMonthly(loan,30);
  var matched=matchPropsForClient(c);
  /* 纯文本版（可复制/发客户） */
  var L=[];
  L.push('【'+c.name+' 购房方案书】');
  L.push('生成时间：'+fmtDateTime(now()));
  L.push('');
  L.push('一、客户画像');
  L.push('· 购房目的：'+(c.purpose||'—'));
  L.push('· 预算范围：'+(budgetTxt||'—'));
  L.push('· 目标区域：'+((c.targetAreas&&c.targetAreas.length)?c.targetAreas.join('、'):'不限'));
  if(c.urgency)L.push('· 购房紧迫度：'+c.urgency);
  if(c.paymentMethod)L.push('· 付款方式：'+c.paymentMethod);
  if(c.downPayment)L.push('· 首付预算：'+c.downPayment+'万');
  if(c.monthlyBudget)L.push('· 月供承受：'+c.monthlyBudget+'元');
  if(c.preferredOrientation||c.preferredFloor||c.decorationReq){
    L.push('· 偏好：'+[c.preferredOrientation,c.preferredFloor,c.decorationReq].filter(Boolean).join(' / '));
  }
  if(c.schoolReq)L.push('· 学区需求：'+c.schoolReq);
  if(c.mustHaves&&c.mustHaves.length)L.push('· 必须满足：'+c.mustHaves.join('、'));
  if(c.dealBreakers&&c.dealBreakers.length)L.push('· 不可接受：'+c.dealBreakers.join('、'));
  L.push('');
  L.push('二、资金方案（参考估算）');
  if(total){
    L.push('· 总预算：'+total+'万');
    L.push('· 首付：'+down+'万（'+(c.downPayment?c.downPayment:Math.round(total*0.3))+'万，约'+(total?Math.round(down/total*100):30)+'%）');
    L.push('· 贷款：'+loan+'万，30年商贷月供约'+monthly+'元');
  }else{
    L.push('· 尚未录入预算，建议先确认总预算与首付能力');
  }
  L.push('');
  L.push('三、推荐房源（按匹配度，共'+matched.length+'套）');
  if(matched.length){
    matched.forEach(function(p,i){
      var name=cleanCommunityName(p.community)||p.title||'未命名';
      var addr=[p.building?p.building+'幢':'',p.unit&&p.unit!=='1单元'?p.unit.replace(/单元$/,'')+'单元':'',p.room?p.room+'室':''].filter(Boolean).join(' ');
      var price=p.type==='rental'?(p.rentPrice?p.rentPrice+'元/月':'—'):(p.totalPrice?p.totalPrice+'万':'—');
      var up=p.type==='rental'?'':(p.unitPrice?(' / '+p.unitPrice+'元/㎡'):'');
      L.push((i+1)+'. '+name+(addr?(' '+addr):'')+' — '+price+up);
    });
  }else{
    L.push('· 暂无匹配的在售房源，建议扩大区域或预算范围');
  }
  L.push('');
  L.push('四、下一步建议');
  L.push('· 优先安排匹配度高的房源带看');
  L.push('· 准备资金证明与购房资格材料');
  if(c.schoolReq)L.push('· 核实学区名额与落户政策');
  if(c.parkingReq==='需要')L.push('· 确认车位产权/租赁情况');
  L.push('· 签约前完成交易风险尽调');
  L.push('');
  L.push('— 本方案由掌房系统自动生成，具体以实际房源及政策为准 —');
  S._curPlanText=L.join('\n');
  /* 富文本版 */
  var html='<div class="plan-doc">';
  html+='<div class="plan-h">'+esc(c.name)+' · 购房方案书</div>';
  html+='<div class="plan-sub">生成时间：'+fmtDateTime(now())+'</div>';
  html+='<div class="plan-sec"><div class="plan-sec-t">一、客户画像</div><div class="plan-lines">'
    +'<div>· 购房目的：'+(c.purpose||'—')+'</div>'
    +'<div>· 预算范围：'+(budgetTxt||'—')+'</div>'
    +'<div>· 目标区域：'+((c.targetAreas&&c.targetAreas.length)?c.targetAreas.join('、'):'不限')+'</div>'
    +(c.urgency?'<div>· 紧迫度：'+esc(c.urgency)+'</div>':'')
    +(c.paymentMethod?'<div>· 付款方式：'+esc(c.paymentMethod)+'</div>':'')
    +(c.downPayment?'<div>· 首付：'+c.downPayment+'万</div>':'')
    +(c.monthlyBudget?'<div>· 月供≤：'+c.monthlyBudget+'元</div>':'')
    +((c.preferredOrientation||c.preferredFloor||c.decorationReq)?'<div>· 偏好：'+[c.preferredOrientation,c.preferredFloor,c.decorationReq].filter(Boolean).map(esc).join(' / ')+'</div>':'')
    +(c.schoolReq?'<div>· 学区：'+esc(c.schoolReq)+'</div>':'')
    +(c.mustHaves&&c.mustHaves.length?'<div>· 必须满足：'+c.mustHaves.map(esc).join('、')+'</div>':'')
    +(c.dealBreakers&&c.dealBreakers.length?'<div>· 不可接受：'+c.dealBreakers.map(esc).join('、')+'</div>':'')
    +'</div></div>';
  html+='<div class="plan-sec"><div class="plan-sec-t">二、资金方案（参考估算）</div><div class="plan-lines">'
    +(total
      ?('<div>· 总预算：'+total+'万</div><div>· 首付：'+down+'万（约'+(total?Math.round(down/total*100):30)+'%）</div><div>· 贷款：'+loan+'万，30年商贷月供约'+monthly+'元</div>')
      :'<div>· 尚未录入预算，建议先确认总预算与首付能力</div>')
    +'</div></div>';
  html+='<div class="plan-sec"><div class="plan-sec-t">三、推荐房源（'+matched.length+'套）</div>';
  if(matched.length){
    html+='<div class="plan-props">';
    matched.forEach(function(p,i){
      var name=cleanCommunityName(p.community)||p.title||'未命名';
      var addr=[p.building?p.building+'幢':'',p.unit&&p.unit!=='1单元'?p.unit.replace(/单元$/,'')+'单元':'',p.room?p.room+'室':''].filter(Boolean).join(' ');
      var price=p.type==='rental'?(p.rentPrice?p.rentPrice+'元/月':'—'):(p.totalPrice?p.totalPrice+'万':'—');
      var up=p.type==='rental'?'':(p.unitPrice?(' / '+p.unitPrice+'元/㎡'):'');
      html+='<div class="plan-prop"><span class="pp-idx">'+(i+1)+'</span><span class="pp-name">'+esc(name)+(addr?(' '+esc(addr)):'')+'</span><span class="pp-price">'+esc(price+up)+'</span></div>';
    });
    html+='</div>';
  }else{
    html+='<div class="plan-lines"><div>· 暂无匹配的在售房源，建议扩大区域或预算范围</div></div>';
  }
  html+='</div>';
  html+='<div class="plan-sec"><div class="plan-sec-t">四、下一步建议</div><div class="plan-lines">'
    +'<div>· 优先安排匹配度高的房源带看</div>'
    +'<div>· 准备资金证明与购房资格材料</div>'
    +(c.schoolReq?'<div>· 核实学区名额与落户政策</div>':'')
    +(c.parkingReq==='需要'?'<div>· 确认车位产权/租赁情况</div>':'')
    +'<div>· 签约前完成交易风险尽调</div>'
    +'</div></div>';
  html+='<div class="plan-foot">— 本方案由掌房系统自动生成，具体以实际房源及政策为准 —</div>';
  html+='</div>';
  document.getElementById('planBody').innerHTML=html;
  document.getElementById('planModal').classList.add('show');
}
function saveClient(){
  var name=document.getElementById('cfName').value.trim();
  if(!name){toast('请输入客户姓名','error');return}
  syncPhonesToState();
  var phones=S.cfPhoneReadOnly?(c.phones||S.editPhones).filter(function(p){return p&&p.number}):S.editPhones.filter(function(p){return p.number});
  if(!S.cfPhoneReadOnly){
    if(phones.length===0){toast('请至少输入一个电话号码','error');return}
    if(phones[0].number.replace(/[^0-9]/g,'').length<5){toast('请输入有效的电话号码','error');return}
  }else if(phones.length===0){
    phones=(c.phones||[]).slice(); // 只读模式下保底使用原始号码
  }
  var id=document.getElementById('cfId').value;var isEdit=!!id;var c=isEdit?findClient(id):{};
  c.name=name;c.phones=phones;c.wechat=document.getElementById('cfWechat').value.trim();
  c.gender=document.getElementById('cfGender').value;c.source=document.getElementById('cfSource').value;
  c.grade=document.getElementById('cfGrade').value;c.purpose=document.getElementById('cfPurpose').value;
  c.propertyType=document.getElementById('cfPropertyType').value;c.unitType=document.getElementById('cfUnitType').value;
  c.budgetMin=parseInt(document.getElementById('cfBudgetMin').value)||0;c.budgetMax=parseInt(document.getElementById('cfBudgetMax').value)||0;
  c.targetAreas=S.editAreas.slice();c.requirements=document.getElementById('cfRequirements').value.trim();
  c.status=document.getElementById('cfStatus').value;c.notes=document.getElementById('cfNotes').value.trim();c.birthday=document.getElementById('cfBirthday').value||'';
  c.customTags=S.editTags.slice();
  /* 需求画像字段保存 */
  c.urgency=document.getElementById('cfUrgency').value||'';
  c.paymentMethod=document.getElementById('cfPaymentMethod').value||'';
  c.downPayment=parseInt(document.getElementById('cfDownPayment').value)||0;
  c.monthlyBudget=parseInt(document.getElementById('cfMonthlyBudget').value)||0;
  c.preferredOrientation=document.getElementById('cfOrientation').value||'';
  c.preferredFloor=document.getElementById('cfPreferredFloor').value||'';
  c.decorationReq=document.getElementById('cfDecorationReq').value||'';
  c.schoolReq=document.getElementById('cfSchoolReq').value.trim();
  c.parkingReq=document.getElementById('cfParkingReq').value||'';
  c.commuteTarget=document.getElementById('cfCommuteTarget').value.trim();
  c.commuteTime=parseInt(document.getElementById('cfCommuteTime').value)||0;
  c.familyInfo=document.getElementById('cfFamilyInfo').value.trim();
  c.mustHaves=S.editMustHaves.slice();
  c.dealBreakers=S.editDealBreakers.slice();
  c.updatedAt=now();
  if(!isEdit){c.id=uuid();c.createdAt=now();c.followUps=[];c.viewings=[];c.referrals=[];c.createdBy=S.currentUser?S.currentUser.id:'';c.createdByName=S.currentUser?S.currentUser.name:'';S.clients.push(c)}
  else if(!c.createdBy&&S.currentUser){c.createdBy=S.currentUser.id;c.createdByName=S.currentUser.name}
  saveC();closeModal('clientFormModal');renderClientList();toast(isEdit?'客户信息已更新':'客户已添加','success');
  logAction(isEdit?'edit':'create','client',c.id,c.name);
}

/* ========== Client: Smart Input ========== */
var SOURCES=['自来客','转介绍','老客户','贝壳','抖音','视频号','小红书','公众号'];
var GRADES=['A','B','C'];
var STATUSES=['待联系','已联系','看房中','谈判中','已成交','暂缓'];

/* 客户来源下拉框：由 SOURCES 单一数据源动态重建，保证手机端/电脑端/表单/筛选一致 */
function populateSourceSelects(){
  try{
    var fs=document.getElementById('fSource');
    if(fs){ fs.innerHTML='<option value="">全部</option>'+SOURCES.map(function(s){return'<option>'+s+'</option>'}).join(''); }
    var cs=document.getElementById('cfSource');
    if(cs){ cs.innerHTML=SOURCES.map(function(s){return'<option>'+s+'</option>'}).join(''); }
  }catch(e){ console.error('[populateSourceSelects]',e); }
}
/* 编辑客户时，若其来源不在新选项内（旧数据），临时补一个选项，避免被静默改成首项 */
function ensureSourceOption(sel,val){
  if(!sel||!val)return;
  var exists=false;
  for(var i=0;i<sel.options.length;i++){ if(sel.options[i].value===val){exists=true;break;} }
  if(!exists){ var o=document.createElement('option');o.value=val;o.textContent=val;sel.appendChild(o); }
}


function openSmartInput(){
  document.getElementById('smartInputArea').value='';
  document.getElementById('smartPreviewWrap').style.display='none';
  document.getElementById('smartImportBtn').style.display='none';
  document.getElementById('smartReparseBtn').style.display='none';
  document.getElementById('smartParseHint').textContent='';
  document.getElementById('smartInputModal').classList.add('show');
  setTimeout(function(){document.getElementById('smartInputArea').focus()},100);
}

function parseSmartInput(text){
  /* 0) OCR文本预处理（如果是图片OCR来的文本，先清洗UI噪声） */
  var preCleaned=typeof preprocessOcrText==='function'?preprocessOcrText(text):text;
  var lines=preCleaned.trim().split(/\n/);
  var results=[];
  var headers=null;
  var hasData=false;
  var _expectHeader=false;

  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();
    if(!line)continue;
    /* v6.31: 图片/Sheet 边界 → 推哨兵，防止跨图把两个客户串成一个 */
    if(line.indexOf('# img:')===0||line.indexOf('# sheet:')===0){headers=null;_expectHeader=true;results.push({_boundary:true});continue}
    hasData=true;

    /* detect delimiter */
    var fields;
    if(line.indexOf('\t')>=0){
      fields=line.split('\t').map(function(f){return f.trim()});
    }else if(line.indexOf('，')>=0&&line.split('，').length>=2){
      fields=line.split('，').map(function(f){return f.trim()});
    }else if(line.indexOf(',')>=0&&line.split(',').length>=2&&!line.match(/^1[3-9]\d{9}/)){
      fields=line.split(',').map(function(f){return f.trim()});
    }else if(line.indexOf(' ')>=0){
      fields=line.split(/\s+/).filter(function(f){return f});
    }else{
      fields=[line];
    }

    /* check header row（首行，或每个图片/Sheet 边界之后的第一行） */
    if((i===0||_expectHeader)&&isHeaderRow(fields)){
      headers=mapHeaders(fields);
      _expectHeader=false;
      continue;
    }
    _expectHeader=false;

    var client={name:'',phones:[],source:'',grade:'',status:'',budgetMin:0,budgetMax:0,areas:[],notes:'',wechat:'',gender:'未知',tags:[]};

    if(headers){
      for(var j=0;j<fields.length;j++){
        if(j>=headers.length)break;
        var h=headers[j];var v=fields[j];
        if(!v)continue;
        assignField(client,h,v);
      }
    }else{
      /* check if line has key:value pairs */
      var kvParsed=parseKeyValueLine(line);
      if(kvParsed){
        for(var key in kvParsed){
          assignField(client,key,kvParsed[key]);
        }
      }else{
        autoDetectFields(client,fields,line);
      }
    }

    /* fallback: extract all phone(s) from raw line */
    if(client.phones.length===0){
      var allCp=line.match(/1[3-9]\d{9}/g);
      if(allCp){
        for(var cpi=0;cpi<allCp.length;cpi++){
          client.phones.push({label:'手机',number:allCp[cpi]});
        }
      }
    }

    /* fallback: name from first non-phone field if empty */
    if(!client.name){
      for(var k=0;k<fields.length;k++){
        var f=fields[k];
        if(f&&!f.match(/1[3-9]\d{9}/)&&!f.match(/^A[级]?$/i)&&!f.match(/^B[级]?$/i)&&!f.match(/^C[级]?$/i)&&SOURCES.indexOf(f)<0){
          if(f.length>=2&&f.length<=6){
            client.name=f.replace(/[：:，,]/g,'');
            break;
          }
        }
      }
    }

    if(client.name||client.phones.length>0){
      results.push(client);
    }
  }

  /* 顺序邻近合并：同一张卡片上的碎片（姓名行/电话行/等级行）合并为1个客户 */
  return mergeSequentialClients(results);
}

/* 客户碎片顺序合并（与 mergeSequentialProps 同理）
   核心规则：
   - 两者都有姓名且不同 → 新客户
   - 两者都有电话且不同 → 新客户（除非新碎片只有电话，作为第二电话合并）
   - 否则 → 合并（补充字段） */
function mergeSequentialClients(rawClients){
  if(!rawClients)return[];
  var hasB=rawClients.some(function(x){return x&&x._boundary});
  if(rawClients.length<=1)return hasB?[]:rawClients;
  var merged=[];
  var current=null;
  for(var i=0;i<rawClients.length;i++){
    var c=rawClients[i];
    /* v6.31: 图片边界 → 强制收口 */
    if(c&&c._boundary){if(current){merged.push(current);current=null}continue}
    if(current===null){
      current=_cloneClient(c);
      continue;
    }
    if(_shouldStartNewClient(current,c)){
      merged.push(current);
      current=_cloneClient(c);
    }else{
      _mergeClientFields(current,c);
    }
  }
  if(current)merged.push(current);
  return merged;
}
function _cloneClient(c){
  return{
    name:c.name||'',
    phones:(c.phones||[]).map(function(p){return{label:p.label,number:p.number}}),
    source:c.source||'',
    grade:c.grade||'',
    status:c.status||'',
    budgetMin:c.budgetMin||0,
    budgetMax:c.budgetMax||0,
    areas:(c.areas||[]).slice(),
    notes:c.notes||'',
    wechat:c.wechat||'',
    gender:c.gender||'未知',
    tags:(c.tags||[]).slice()
  };
}
function _shouldStartNewClient(current,c){
  /* 两者都有姓名且不同 → 新客户 */
  if(c.name&&current.name&&c.name!==current.name)return true;
  /* 两者都有姓名且相同 → 重复，合并 */
  if(c.name&&current.name&&c.name===current.name)return false;
  /* 两者都有电话 */
  var curPhones=current.phones.map(function(p){return p.number});
  var cPhones=c.phones.map(function(p){return p.number});
  var hasDifferentPhone=false;
  for(var pi=0;pi<cPhones.length;pi++){
    if(curPhones.indexOf(cPhones[pi])<0){hasDifferentPhone=true;break}
  }
  if(hasDifferentPhone){
    /* 新碎片有姓名 → 新客户 */
    if(c.name)return true;
    /* 新碎片只有电话（无姓名/其他关键字段）→ 合并为第二电话 */
    if(!c.source&&!c.grade&&!c.areas.length)return false;
    /* 新碎片有其他字段 → 新客户 */
    return true;
  }
  /* 默认：合并 */
  return false;
}
function _mergeClientFields(target,source){
  if(!target.name&&source.name)target.name=source.name;
  if(!target.source&&source.source)target.source=source.source;
  if(!target.grade&&source.grade)target.grade=source.grade;
  if(!target.status&&source.status)target.status=source.status;
  if(!target.budgetMin&&source.budgetMin)target.budgetMin=source.budgetMin;
  if(!target.budgetMax&&source.budgetMax)target.budgetMax=source.budgetMax;
  if(!target.wechat&&source.wechat)target.wechat=source.wechat;
  if(target.gender==='未知'&&source.gender&&source.gender!=='未知')target.gender=source.gender;
  if(!target.notes&&source.notes)target.notes=source.notes;
  /* 合并电话（去重） */
  for(var pi=0;pi<source.phones.length;pi++){
    var pn=source.phones[pi].number;
    var exists=target.phones.some(function(p){return p.number===pn});
    if(!exists)target.phones.push({label:source.phones[pi].label,number:pn});
  }
  /* 合并区域（去重） */
  for(var ai=0;ai<source.areas.length;ai++){
    if(target.areas.indexOf(source.areas[ai])<0)target.areas.push(source.areas[ai]);
  }
  /* 合并标签（去重） */
  for(var ti=0;ti<source.tags.length;ti++){
    if(target.tags.indexOf(source.tags[ti])<0)target.tags.push(source.tags[ti]);
  }
}

function isHeaderRow(fields){
  var headerKeywords=['姓名','名称','名字','客户','电话','手机','手机号','联系方式','来源','渠道','等级','状态','预算','价格','区域','地段','目标','备注','微信','性别','标签','需求'];
  var matchCount=0;
  for(var i=0;i<fields.length;i++){
    var f=fields[i].toLowerCase();
    for(var j=0;j<headerKeywords.length;j++){
      if(f.indexOf(headerKeywords[j])>=0){matchCount++;break}
    }
  }
  return matchCount>=2;
}

function mapHeaders(fields){
  var mapping=[];
  for(var i=0;i<fields.length;i++){
    var f=fields[i].toLowerCase();
    if(f.indexOf('姓名')>=0||f.indexOf('名称')>=0||f.indexOf('名字')>=0||f==='客户'||f.indexOf('客户名')>=0)mapping.push('name');
    else if(f.indexOf('电话')>=0||f.indexOf('手机')>=0||f.indexOf('联系')>=0)mapping.push('phone');
    else if(f.indexOf('来源')>=0||f.indexOf('渠道')>=0)mapping.push('source');
    else if(f.indexOf('等级')>=0||f.indexOf('意向')>=0)mapping.push('grade');
    else if(f.indexOf('状态')>=0)mapping.push('status');
    else if(f.indexOf('预算')>=0||f.indexOf('价格')>=0||f.indexOf('总价')>=0)mapping.push('budget');
    else if(f.indexOf('区域')>=0||f.indexOf('地段')>=0||f.indexOf('目标')>=0||f.indexOf('意向区域')>=0)mapping.push('area');
    else if(f.indexOf('备注')>=0||f.indexOf('说明')>=0||f.indexOf('描述')>=0)mapping.push('notes');
    else if(f.indexOf('微信')>=0)mapping.push('wechat');
    else if(f.indexOf('性别')>=0)mapping.push('gender');
    else if(f.indexOf('标签')>=0)mapping.push('tag');
    else if(f.indexOf('需求')>=0)mapping.push('requirements');
    else mapping.push('');
  }
  return mapping;
}

function parseKeyValueLine(line){
  /* detect patterns like: 姓名：王先生 电话：13812345678 */
  var seps=['：','：',':','＝'];
  var hasKV=false;
  for(var s=0;s<seps.length;s++){
    if(line.indexOf(seps[s])>=0){hasKV=true;break}
  }
  if(!hasKV)return null;

  var result={};
  /* split by common delimiters while keeping key:value pairs */
  var parts=line.split(/[\s,，;；]+/);
  for(var p=0;p<parts.length;p++){
    var part=parts[p].trim();
    if(!part)continue;
    var idx=-1;var sep='';
    for(var s=0;s<seps.length;s++){
      idx=part.indexOf(seps[s]);
      if(idx>0){sep=seps[s];break}
    }
    if(idx>0){
      var key=part.substring(0,idx).trim();
      var val=part.substring(idx+sep.length).trim();
      var normKey=normalizeKey(key);
      if(normKey)result[normKey]=val;
    }
  }
  return Object.keys(result).length>=1?result:null;
}

function normalizeKey(key){
  key=key.toLowerCase();
  if(key.indexOf('姓名')>=0||key.indexOf('名称')>=0||key.indexOf('名字')>=0)return'name';
  if(key.indexOf('电话')>=0||key.indexOf('手机')>=0||key.indexOf('联系')>=0)return'phone';
  if(key.indexOf('来源')>=0||key.indexOf('渠道')>=0)return'source';
  if(key.indexOf('等级')>=0||key.indexOf('意向')>=0)return'grade';
  if(key.indexOf('状态')>=0)return'status';
  if(key.indexOf('预算')>=0||key.indexOf('价格')>=0||key.indexOf('总价')>=0)return'budget';
  if(key.indexOf('区域')>=0||key.indexOf('地段')>=0||key.indexOf('目标')>=0)return'area';
  if(key.indexOf('备注')>=0||key.indexOf('说明')>=0)return'notes';
  if(key.indexOf('微信')>=0)return'wechat';
  if(key.indexOf('性别')>=0)return'gender';
  if(key.indexOf('标签')>=0)return'tag';
  if(key.indexOf('需求')>=0)return'requirements';
  return'';
}

function assignField(client,key,val){
  val=(val||'').trim();
  if(!val)return;
  switch(key){
    case'name':
      if(!client.name)client.name=val.replace(/[：:，,]/g,'');
      break;
    case'phone':
      var nums=val.match(/1[3-9]\d{9}/g)||val.match(/0\d{2,3}-?\d{7,8}/g);
      if(nums){
        for(var n=0;n<nums.length;n++){
          if(!client.phones.some(function(p){return p.number===nums[n]})){
            client.phones.push({label:'手机',number:nums[n]});
          }
        }
      }else if(val.replace(/[^0-9]/g,'').length>=5){
        client.phones.push({label:'手机',number:val.replace(/[^0-9]/g,'')});
      }
      break;
    case'source':
      var src=matchSource(val);
      if(src)client.source=src;
      break;
    case'grade':
      var g=matchGrade(val);
      if(g)client.grade=g;
      break;
    case'status':
      var st=matchStatus(val);
      if(st)client.status=st;
      break;
    case'budget':
      var bg=parseBudget(val);
      if(bg){client.budgetMin=bg.min;client.budgetMax=bg.max}
      break;
    case'area':
      var ar=matchArea(val);
      if(ar&&client.areas.indexOf(ar)<0)client.areas.push(ar);
      break;
    case'notes':
      if(!client.notes)client.notes=val;else client.notes+=' '+val;
      break;
    case'wechat':
      if(!client.wechat)client.wechat=val;
      break;
    case'gender':
      if(val.indexOf('男')>=0)client.gender='男';
      else if(val.indexOf('女')>=0)client.gender='女';
      break;
    case'tag':
      if(client.tags.indexOf(val)<0)client.tags.push(val);
      break;
    case'requirements':
      if(!client.notes)client.notes=val;else client.notes+=' '+val;
      break;
  }
}

function matchSource(val){
  for(var i=0;i<SOURCES.length;i++){
    if(val.indexOf(SOURCES[i])>=0||SOURCES[i].indexOf(val)>=0)return SOURCES[i];
  }
  if(val.indexOf('介绍')>=0)return'转介绍';
  if(val.indexOf('自')>=0||val.indexOf('到店')>=0||val.indexOf('来访')>=0)return'自来客';
  if(val.indexOf('线上')>=0||val.indexOf('网络')>=0||val.indexOf('咨询')>=0)return'公众号';
  if(val.indexOf('老')>=0&&val.indexOf('客')>=0)return'老客户';
  if(val.indexOf('贝壳')>=0||val.indexOf('链家')>=0)return'贝壳';
  if(val.indexOf('抖')>=0&&!(val.indexOf('视频号')>=0))return'抖音';
  if(val.indexOf('视频号')>=0)return'视频号';
  if(val.indexOf('小红书')>=0||val.indexOf('红书')>=0)return'小红书';
  if(val.indexOf('公')>=0&&(val.indexOf('众')>=0||val.indexOf('号')>=0))return'公众号';
  return'';
}

function matchGrade(val){
  var v=val.toUpperCase();
  if(v.indexOf('A')>=0)return'A';
  if(v.indexOf('B')>=0)return'B';
  if(v.indexOf('C')>=0)return'C';
  if(val.indexOf('高')>=0)return'A';
  if(val.indexOf('中')>=0)return'B';
  if(val.indexOf('低')>=0)return'C';
  return'';
}

function matchStatus(val){
  for(var i=0;i<STATUSES.length;i++){
    if(val.indexOf(STATUSES[i])>=0)return STATUSES[i];
  }
  return'';
}

function parseBudget(val){
  var num=parseInt(val.replace(/[^0-9]/g,''));
  if(!num)return null;
  if(val.indexOf('-')>=0||val.indexOf('~')>=0||val.indexOf('至')>=0){
    var parts=val.split(/[-~至]/);
    var min=parseInt(parts[0].replace(/[^0-9]/g,''))||0;
    var max=parseInt(parts[1].replace(/[^0-9]/g,''))||0;
    return{min:min,max:max};
  }
  return{min:0,max:num};
}

function matchArea(val){
  for(var i=0;i<AREAS.length;i++){
    if(val.indexOf(AREAS[i])>=0)return AREAS[i];
  }
  return'';
}

function autoDetectFields(client,fields,rawLine){
  for(var i=0;i<fields.length;i++){
    var f=fields[i].trim();
    if(!f)continue;

    /* phone number — 提取所有号码，已有去重 */
    if(f.match(/1[3-9]\d{9}/)){
      var cpms=f.match(/1[3-9]\d{9}/g);
      if(cpms){
        for(var cpi2=0;cpi2<cpms.length;cpi2++){
          if(!client.phones.some(function(p){return p.number===cpms[cpi2]})){
            client.phones.push({label:'手机',number:cpms[cpi2]});
          }
        }
      }
      continue;
    }
    /* landline */
    if(f.match(/0\d{2,3}-?\d{7,8}/)){
      var lm=f.match(/0\d{2,3}-?\d{7,8}/);
      if(lm)client.phones.push({label:'座机',number:lm[0]});
      continue;
    }

    /* grade */
    if(f.match(/^[ABCabc][级]?$/)){
      client.grade=f.toUpperCase().charAt(0);
      continue;
    }
    if(f.indexOf('高意向')>=0||f.indexOf('A级')>=0){client.grade='A';continue}
    if(f.indexOf('中意向')>=0||f.indexOf('B级')>=0){client.grade='B';continue}
    if(f.indexOf('低意向')>=0||f.indexOf('C级')>=0){client.grade='C';continue}

    /* source */
    var src=matchSource(f);
    if(src){client.source=src;continue}

    /* budget */
    if(f.indexOf('预算')>=0||f.match(/\d+万/)||f.match(/\d{2,4}w/i)){
      var bg=parseBudget(f.replace('预算','').replace('万','').replace('w','').replace('W',''));
      if(bg){client.budgetMin=bg.min;client.budgetMax=bg.max;continue}
    }

    /* area */
    var ar=matchArea(f);
    if(ar){if(client.areas.indexOf(ar)<0)client.areas.push(ar);continue}

    /* wechat */
    if(f.indexOf('微信')>=0||f.indexOf('wx')>=0||f.indexOf('WX')>=0||f.indexOf('v信')>=0){
      var wx=f.replace(/微信|微|wx|WX|v信/g,'').replace(/[：:]/g,'');
      if(wx)client.wechat=wx;
      continue;
    }

    /* gender */
    if(f==='男'||f.indexOf('先生')>=0){client.gender='男';if(!client.name)client.name=f;continue}
    if(f==='女'||f.indexOf('女士')>=0||f.indexOf('小姐')>=0){client.gender='女';if(!client.name)client.name=f;continue}
    if(f.indexOf('总')>=0&&f.length<=4){client.gender='男';if(!client.name)client.name=f;continue}

    /* status */
    var st=matchStatus(f);
    if(st){client.status=st;continue}

    /* name: 2-6 chars, mostly Chinese */
    if(!client.name&&f.length>=2&&f.length<=6&&f.match(/^[\u4e00-\u9fa5A-Za-z]/)){
      client.name=f.replace(/[：:，,]/g,'');
      continue;
    }

    /* everything else -> notes */
    if(f.length>1){
      if(!client.notes)client.notes=f;else client.notes+=' '+f;
    }
  }
}

function renderSmartPreview(clients){
  var wrap=document.getElementById('smartPreviewWrap');
  var table=document.getElementById('smartPreviewTable');
  var count=document.getElementById('smartPreviewCount');

  if(!clients||clients.length===0){
    wrap.style.display='none';
    document.getElementById('smartParseHint').textContent='未识别到有效客户数据';
    document.getElementById('smartParseHint').style.color='var(--warning)';
    return;
  }

  count.textContent='共识别 '+clients.length+' 条';
  wrap.style.display='block';

  var html='<table><thead><tr>'+
    '<th style="width:30px">#</th>'+
    '<th>姓名</th>'+
    '<th>电话</th>'+
    '<th>来源</th>'+
    '<th>等级</th>'+
    '<th>预算(万)</th>'+
    '<th>区域</th>'+
    '<th>备注</th>'+
    '<th style="width:30px"></th>'+
    '</tr></thead><tbody>';

  for(var i=0;i<clients.length;i++){
    var c=clients[i];
    var phoneStr=c.phones.map(function(p){return p.number}).join('; ');
    var areaStr=c.areas.join(',');
    var hasPhone=c.phones.length>0;
    var hasName=!!c.name;
    var status=hasName&&hasPhone?'<span class="spv-ok">✓</span>':'<span class="spv-warn">缺'+(!hasName?'姓名':'电话')+'</span>';

    html+='<tr data-idx="'+i+'">'+
      '<td style="text-align:center;color:var(--text-muted)">'+(i+1)+'</td>'+
      '<td><input type="text" data-field="name" value="'+esc(c.name)+'" placeholder="姓名"></td>'+
      '<td><input type="text" data-field="phone" value="'+esc(phoneStr)+'" placeholder="电话"></td>'+
      '<td><select data-field="source"><option value="">选择</option>'+SOURCES.map(function(s){return'<option'+(c.source===s?' selected':'')+'>'+s+'</option>'}).join('')+'</select></td>'+
      '<td><select data-field="grade" style="width:50px"><option value="">-</option>'+GRADES.map(function(g){return'<option value="'+g+'"'+(c.grade===g?' selected':'')+'>'+g+'</option>'}).join('')+'</select></td>'+
      '<td><input type="text" data-field="budget" value="'+(c.budgetMax?c.budgetMin+'-'+c.budgetMax:'')+'" placeholder="如300" style="width:60px"></td>'+
      '<td><input type="text" data-field="area" value="'+esc(areaStr)+'" placeholder="区域"></td>'+
      '<td><input type="text" data-field="notes" value="'+esc(c.notes)+'" placeholder="备注"></td>'+
      '<td><span class="spv-del" data-del="'+i+'">×</span></td>'+
      '</tr>';
  }
  html+='</tbody></table>';
  table.innerHTML=html;

  /* attach del handlers */
  table.querySelectorAll('.spv-del').forEach(function(el){
    el.addEventListener('click',function(){
      var idx=parseInt(el.getAttribute('data-del'));
      S.smartClients.splice(idx,1);
      renderSmartPreview(S.smartClients);
    });
  });
}

function collectSmartClients(){
  var rows=document.querySelectorAll('#smartPreviewTable tbody tr');
  var clients=[];
  rows.forEach(function(row){
    var name=row.querySelector('[data-field="name"]').value.trim();
    var phoneStr=row.querySelector('[data-field="phone"]').value.trim();
    var source=row.querySelector('[data-field="source"]').value;
    var grade=row.querySelector('[data-field="grade"]').value;
    var budgetStr=row.querySelector('[data-field="budget"]').value.trim();
    var areaStr=row.querySelector('[data-field="area"]').value.trim();
    var notes=row.querySelector('[data-field="notes"]').value.trim();

    if(!name&&!phoneStr)return;

    var phones=[];
    var phoneNums=phoneStr.match(/1[3-9]\d{9}/g)||phoneStr.match(/0\d{2,3}-?\d{7,8}/g);
    if(phoneNums){
      phoneNums.forEach(function(n){phones.push({label:'手机',number:n})});
    }else if(phoneStr.replace(/[^0-9]/g,'').length>=5){
      phones.push({label:'手机',number:phoneStr.replace(/[^0-9]/g,'')});
    }

    var budgetMin=0,budgetMax=0;
    if(budgetStr){
      if(budgetStr.indexOf('-')>=0||budgetStr.indexOf('~')>=0){
        var parts=budgetStr.split(/[-~]/);
        budgetMin=parseInt(parts[0].replace(/[^0-9]/g,''))||0;
        budgetMax=parseInt(parts[1].replace(/[^0-9]/g,''))||0;
      }else{
        budgetMax=parseInt(budgetStr.replace(/[^0-9]/g,''))||0;
      }
    }

    var areas=[];
    if(areaStr){
      AREAS.forEach(function(a){
        if(areaStr.indexOf(a)>=0)areas.push(a);
      });
    }

    clients.push({
      name:name||'未命名',
      phones:phones,
      source:source||'自来客',
      grade:grade||'B',
      status:'待联系',
      budgetMin:budgetMin,
      budgetMax:budgetMax,
      targetAreas:areas,
      notes:notes,
      wechat:'',
      gender:'未知',
      customTags:[],
      requirements:''
    });
  });
  return clients;
}

function batchImportClients(){
  var clients=collectSmartClients();
  if(clients.length===0){toast('没有可录入的客户','error');return}

  /* v6.35 智能查重：电话匹配则更新已有客户，不再静默跳过 */
  var imported=0,updated=0,skipped=0;
  for(var i=0;i<clients.length;i++){
    var c=clients[i];
    if(!c.name||c.phones.length===0){skipped++;continue}

    /* 按电话查重 */
    var matched=null;
    for(var j=0;j<S.clients.length;j++){
      var existing=S.clients[j];
      if(existing.phones&&existing.phones.some(function(p){
        return c.phones.some(function(np){return p.number===np.number});
      })){matched=existing;break}
    }

    if(matched){
      /* 更新已有客户：有值才覆盖 */
      var changed=false;
      var clientFields=['name','intent','budget','district','block','areas','source',
        'status','level','notes','tags','wechat'];
      for(var f=0;f<clientFields.length;f++){
        var key=clientFields[f];
        if(c[key]!==undefined&&c[key]!==''&&c[key]!==null){
          matched[key]=c[key];changed=true;
        }
      }
      /* 电话合并去重 */
      if(c.phones&&c.phones.length){
        matched.phones=matched.phones||[];
        for(var pn=0;pn<c.phones.length;pn++){
          var np=c.phones[pn];
          if(!matched.phones.some(function(ep){return ep.number===np.number})){
            matched.phones.push(np);changed=true;
          }
        }
      }
      if(changed){matched.updatedAt=now();updated++}
      else{skipped++}
    }else{
      c.id=uuid();c.createdAt=now();c.updatedAt=now();
      c.followUps=[];c.viewings=[];c.referrals=[];
      c.createdBy=S.currentUser?S.currentUser.id:'';
      c.createdByName=S.currentUser?S.currentUser.name:'';
      S.clients.push(c);
      imported++;
    }
  }

  saveC();renderClientList();closeModal('smartInputModal');
  var msg='成功录入 '+imported+' 位客户';
  if(updated>0)msg+='，更新 '+updated+' 位已有客户';
  if(skipped>0)msg+='，跳过 '+skipped+' 条（信息不全）';
  toast(msg,'success');
}

/* ========== Smart Property Input ========== */
var DECORATIONS=['精装','简装','毛坯','豪装'];
var ORIENTATIONS=['南北通透','朝南','朝北','朝东','朝西','东南','西南'];
var PROP_STATUSES=['在售','在租','空置待租','已租','暂缓','已售','下架','待售','售罄','到期可看'];

function openSmartPropInput(mode,targetId){
  /* mode: 'batch'(默认批量新增/更新) | 'single'(更新单个楼盘) */
  S.smartPropMode=mode||'batch';
  S.smartPropTargetId=targetId||null;

  var titleEl=document.querySelector('#smartPropInputModal .modal-title');
  var importBtn=document.getElementById('smartPropImportBtn');
  var guideEl=document.querySelector('#smartPropInputModal .smart-input-guide');

  if(S.smartPropMode==='single'&&targetId){
    /* 单楼盘更新模式 */
    var p=findProp(targetId);
    titleEl.textContent='录入楼盘信息 — '+(p?p.title:'');
    importBtn.textContent='更新楼盘信息';
    if(guideEl)guideEl.style.display='none';
    /* 预填当前楼盘信息到文本框，方便用户在原文基础上修改 */
    var ta=document.getElementById('smartPropArea');
    if(p){
      var lines=[];
      if(p.title)lines.push('楼盘名称：'+p.title);
      if(p.developer)lines.push('开发商：'+p.developer);
      if(p.averagePriceText)lines.push('均价：'+p.averagePriceText);
      else if(p.averagePrice)lines.push('均价：'+p.averagePrice+'元/㎡');
      if(p.onSaleBuildings)lines.push('在售楼幢：'+p.onSaleBuildings);
      if(p.additionalBuildings)lines.push('加推楼幢：'+p.additionalBuildings);
      if(p.additionalPrice)lines.push('加推价格：'+p.additionalPrice);
      if(p.saleStatus)lines.push('认购状态：'+p.saleStatus);
      if(p.propertyType)lines.push('物业类型：'+p.propertyType);
      if(p.openingDate)lines.push('开盘时间：'+p.openingDate);
      if(p.deliveryDate)lines.push('交房时间：'+p.deliveryDate);
      if(p.availableLayouts)lines.push('在售户型：'+p.availableLayouts);
      if(p.totalUnits)lines.push('总户数：'+p.totalUnits);
      if(p.greenRate)lines.push('绿化率：'+p.greenRate);
      if(p.plotRatio)lines.push('容积率：'+p.plotRatio);
      if(p.contactName)lines.push('对接人：'+p.contactName);
      if(p.contactPhone)lines.push('联系电话：'+p.contactPhone);
      if(p.commission)lines.push('佣金：'+p.commission);
      if(p.district)lines.push('区域：'+p.district);
      if(p.address)lines.push('地址：'+p.address);
      if(p.school)lines.push('学区：'+p.school);
      if(p.metro)lines.push('地铁：'+p.metro);
      if(p.description)lines.push('描述：'+p.description);
      ta.value=lines.join('\n');
    }
  }else{
    /* 批量模式 */
    if(S.subtab==='newdev'){
      titleEl.textContent='智能录入楼盘';
      importBtn.textContent='全部录入';
    }else if(S.subtab==='md'){
      titleEl.textContent='智能录入业主名单';
      importBtn.textContent='全部录入名单';
    }else{
      titleEl.textContent='智能录入房源';
      importBtn.textContent='全部录入';
    }
    if(guideEl)guideEl.style.display='';
  }

  document.getElementById('smartPropPreviewWrap').style.display='none';
  document.getElementById('smartPropImportBtn').style.display='none';
  document.getElementById('smartPropReparseBtn').style.display='none';
  document.getElementById('smartPropParseHint').textContent='';
  S.smartImages=[];renderSmartImageGallery();
  document.getElementById('smartPropInputModal').classList.add('show');
  setTimeout(function(){document.getElementById('smartPropArea').focus()},100);
}

/* ========== OCR文本预处理 + 智能分组 ========== */

/* OCR识别后图片里常带的一些UI界面提示词（按钮文字、placeholder、表头截断等），识别时需要过滤 */
var OCR_NOISE_PATTERNS=[
  /^电话查看$/, /^详情查看$/, /^查看$/, /^更多$/, /^展开$/, /^收起$/, /^全部$/,
  /^必填$/, /^选填$/, /^请填写$/, /^请输入$/, /^请选择$/, /^点击上传$/, /^上传$/, /^删除$/,
  /^编辑$/, /^保存$/, /^取消$/, /^确定$/, /^返回$/, /^关闭$/, /^提交$/, /^重置$/, /^搜索$/,
  /^提示[：:]?$/, /^说明[：:]?$/, /^备注[：:]?$/, /^添加图片$/, /^更换图片$/, /^暂无数据$/,
  /* v6.30: 表头行（列表图的"小区名字 物业地址 面积"等） */
  /^小区名字.*地址.*面积$/, /^小区名字.*物业地址.*面积$/, /^小区.*物业地址.*面积$/,
  /^小区名.*地.*址.*面.*$/, /.*图片分隔.*/, /.*分隔.*/, /^---+.*---+$/,
  /^加载中/, /^加载失败/, /^暂无/, /^点击/, /^双击/, /^长按/, /^滑动/, /^右键/,
  /^公盘电话/, /^名单来源/, /^时六知理员/, /^知理员$/, /^六知理员$/,
  /^填写跟进/, /^跟进后关机/, /^填写后/, /^跟进$/,
  /^未到访$/, /^已到访$/, /^已参观$/, /^已带看$/,
  /^来源[：:]?$/, /^渠道[：:]?$/,
  /^业主电话[：:]?$/, /^业主[：:]?$/, /^业主姓名[：:]?$/, /^联系方式[：:]?$/,
  /^联系电话[：:]?$/, /^小区[：:]?$/, /^物业地址[：:]?$/, /^地址[：:]?$/, /^面积[：:]?$/, /^楼层[：:]?$/, /^户型[：:]?$/,
  /^物业[：:]?$/, /^楼盘[：:]?$/, /^开发商[：:]?$/, /^单价[：:]?$/, /^总价[：:]?$/, /^均价[：:]?$/
];
var OCR_NOISE_SUBSTR=['必填填写跟进后关机本','必填填写跟进','填写跟进后','电话查看','详情查看','必填填写','跟进后关机','时六知理员','名单来源','填写跟进','列表来源','理员','项源','查看更多','点击查看','点击详情','公盘电话','填写','跟进后','关机','公盘'];

function isOcrNoiseLine(line){
  if(!line)return true;
  var t=line.trim();
  if(t.length<2)return true;
  /* "楼号-房号"格式（如16-1704、3-501、5-2-301）不是噪声，是有效数据（必须优先于"纯数字"判断） */
  if(/^\d+\s*[\-－—\/／]\s*\d+/.test(t))return false;
  /* 11位手机号不是噪声（重要：之前这里被误判为噪声，导致多张图的电话全丢） */
  if(/^1[3-9]\d{9}$/.test(t))return false;
  /* 11位手机号+分隔符+11位手机号（如"13867551300 / 13867497887"）也不是噪声 */
  if(/^1[3-9]\d{9}[\s\/／,，]+1[3-9]\d{9}/.test(t))return false;
  /* 纯数字+标点+无中文/英文 → 噪声（但已经排除上面的电话、房号格式） */
  if(/^[\d\s\-_,\.，。:：()（）\/\\]+$/.test(t)&&!/[\u4e00-\u9fa5a-zA-Z]/.test(t))return true;
  for(var i=0;i<OCR_NOISE_PATTERNS.length;i++){
    if(OCR_NOISE_PATTERNS[i].test(t))return true;
  }
  for(var j=0;j<OCR_NOISE_SUBSTR.length;j++){
    if(t.indexOf(OCR_NOISE_SUBSTR[j])>=0&&t.length<=12)return true;
  }
  return false;
}

/* OCR文本清洗：去除UI噪声词、空白行合并、把字段标签（"小区："）前的纯标签词剥离开 */
function preprocessOcrText(text){
  if(!text)return'';
  var lines=text.split(/\n/);
  var cleanLines=[];
  /* 已知字段标签（OCR识别图片里的字段前缀），需要把这些标签和冒号/空格剥离开 */
  var FIELD_LABELS=['小区','楼盘','楼盘名','项目','项目名称','房源','房源名称','地址','物业地址',
    '楼栋','楼幢','楼号','楼','幢','座','栋','单元','室号','门牌','门牌号','房号','房间号',
    '面积','建面','建筑面积','户型','房型','楼层','朝向','装修','总价','售价','单价','均价',
    '业主','业主姓名','业主电话','电话','手机','手机号','联系方式','联系人','对接人','对接人电话',
    '佣金','保护期','状态','备注','描述','说明','标签','业主电话',
    '开发商','开盘','交付','交房','交付时间','开盘时间','总户数','绿化率','容积率','物业类型','物业费'];
  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();
    if(!line)continue;
    /* v6.31: 图片/Sheet 边界标记必须原样保留，供解析层做"一张图=一组连续字段"的硬断开 */
    if(line.indexOf('# img:')===0||line.indexOf('# sheet:')===0){cleanLines.push(line);continue}
    /* 跳过明显的噪声行 */
    if(isOcrNoiseLine(line))continue;
    var preserved=line;
    /* v6.30.x: 表头行（OCR 常把"小区名字 物业地址 面积"识别成"小 区 名 字 物业 地 址 面积"，每字带空格）
       整体去空格后匹配表头模式 → 直接丢弃，避免"小区"前缀被当成标签剥掉、残留"名字物业地址面积"变成假小区名 */
    var _despaced0=line.replace(/\s+/g,'');
    if(/^小区名字?物业地址面积$/.test(_despaced0)||/^小区.*(物业|地址).*面积$/.test(_despaced0)){continue}
    /* 有用内容判断：去除噪声子串后还有数字/中文/英文就算有用。
   用于剥离"小区 BEREH 详情查看"这种 value 里含子串噪声的情况 */
    var hasUsefulContent=function(v){
      v=(v||'').trim();
      if(!v)return false;
      var cleaned=v;
      for(var ck=0;ck<OCR_NOISE_SUBSTR.length;ck++){
        cleaned=cleaned.split(OCR_NOISE_SUBSTR[ck]).join('');
      }
      cleaned=cleaned.trim();
      if(!cleaned)return false;
      if(/[\d\u4e00-\u9fa5a-zA-Z]/.test(cleaned))return true;
      return false;
    };

    /* 1) 标签+冒号+值的剥离："小区: BEREH" → "BEREH" */
    var m1=preserved.match(/^([^：:]{1,8})[：:]\s*(.{1,})$/);
    if(m1){
      var label1=m1[1].trim();
      var value1=m1[2].trim();
      if(FIELD_LABELS.indexOf(label1)>=0&&hasUsefulContent(value1)){
        preserved=value1;
      }
    }
    /* 2) 标签+空格+值的剥离（OCR可能把冒号识别成空格）：
          "小区 BEREH" → "BEREH"、"业主电话 18072979236" → "18072979236"。
          多次尝试（防止"小区"被剥离成"详情查看"又被剥离失败）。
          这里不能简单用 isOcrNoiseLine(value)，因为 value 可能含"详情查看"等子串噪声
          
          v6.30 增强：OCR 常把标签内部也插入空格（如"物业地 址"、"业主 电话"），
          匹配时先把候选标签去空格后再查 FIELD_LABELS
          
          v6.30 增强2：先尝试"整行去空格前缀匹配"
          "物业地 址 16-1504" → 去空格 → "物业地址16-1504" → 匹配"物业地址" → 保留 "16-1504" */
    /* 2a) 整行去空格前缀匹配（处理标签内部被空格截断的情况）
        "物业地 址 16-1504" → 匹配 "物业地址"（允许字间有空格）→ 保留 "16-1504"
        用逐字符允许空格的正则来匹配，确保截取位置正确 */
    for(var preI=0;preI<FIELD_LABELS.length;preI++){
      var fl=FIELD_LABELS[preI];
      /* 构建允许字间空格的正则：如 "物业地址" → /物\s*业\s*地\s*址/ */
      var siRegex=new RegExp('^'+fl.split('').join('\\s*')+'\\s+(.{1,})$');
      var siMatch=preserved.match(siRegex);
      if(siMatch&&siMatch[1]&&hasUsefulContent(siMatch[1])){
        preserved=siMatch[1];break;
      }
    }
    /* 2b) 逐词剥离（原有逻辑，增强去空格模糊匹配） */
    for(var tryI=0;tryI<4;tryI++){
      var m2=preserved.match(/^([\u4e00-\u9fa5]{2,8})\s+(.{1,})$/);
      if(m2){
        var label2=m2[1].trim();
        var value2=m2[2].trim();
        /* 先尝试精确匹配 */
        if(FIELD_LABELS.indexOf(label2)>=0&&hasUsefulContent(value2)){
          preserved=value2;
        }else{
          /* v6.30: 去掉标签内部空格后模糊匹配（处理 "物业地 址"→"物业地址"、"业主 电话"→"业主电话"） */
          var labelNoSpace=label2.replace(/\s+/g,'');
          if(FIELD_LABELS.indexOf(labelNoSpace)>=0&&hasUsefulContent(value2)){
            preserved=value2;
          }else{break}
        }
      }else{break}
    }
    /* 2.5) 中文OCR漏字容错：压缩"中文+空格+中文"模式
            例："绿荷 翠翠轩"（"叠"被OCR识别成空格） → "绿荷翠翠轩"
            例："湘 湖 怡景" → "湘湖怡景"
            v6.30 增强：循环压缩直到稳定（处理"绿 荷 倒 翠 轩"这种多空格情况） */
    var prev;
    do{prev=preserved;preserved=preserved.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g,'$1$2')}while(prev!==preserved);
    /* 3) 去除行内的噪声子串 */
    for(var k=0;k<OCR_NOISE_SUBSTR.length;k++){
      preserved=preserved.split(OCR_NOISE_SUBSTR[k]).join('');
    }
    preserved=preserved.trim();
    if(!preserved||isOcrNoiseLine(preserved))continue;
    cleanLines.push(preserved);
  }
  /* 第二阶段：行级拆解 — 把"业主 电话 X / Y"这类含多字段的行拆成多个独立字段行 */
  return expandSmartPropLines(cleanLines.join('\n'));
}

/* 把"多字段杂糅在一行"的OCR文本拆成多个独立字段行，便于后续按行解析
   关键场景（用户绿荷叠翠轩截图）：
   1. "业主 电话 18368857920 / 18868605857" → "业主电话: 18368857920" + "业主电话: 18868605857"
   2. "18368857920 / 18868605857"             → "18368857920" + "18868605857"
   3. "小区 绿荷 翠翠轩" → 已经被 preprocessOcrText 阶段剥离成 "绿荷翠翠轩"
   4. "物业 地址 16-1703" → "16-1703"（"物业地址"是 FIELD_LABELS 标签，但被拆成 "物业"和"地址"两个独立词，
      剥离循环会把"物业"识别为标签但"物业"不在FIELD_LABELS中（只有"物业地址"），所以保留整行；
      这里特殊处理：如果整行匹配"物业地址+数字"模式，直接提取数字作为房号）*/
function expandSmartPropLines(text){
  if(!text)return'';
  var lines=text.split(/\n/);
  var outLines=[];
  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();
    if(!line){outLines.push(line);continue}

    /* 模式A：行尾是"标签+两个电话号"格式（如"业主 电话 18368857920 / 18868605857"）
       提取两个电话号，每个变成一行 "业主电话: 号码" */
    var labelPrefix=line.match(/^([\u4e00-\u9fa5]{2,8})\s+(\d{11})[\s\/／,，]+(\d{11})\s*$/);
    if(labelPrefix){
      var lbl=labelPrefix[1];
      var ph1=labelPrefix[2];
      var ph2=labelPrefix[3];
      /* 提取核心标签（去掉"电话/业主"等后缀，避免重复添加） */
      var coreLabel=lbl;
      /* 标准化标签：小区/业主/物业等 */
      if(/^业主/.test(lbl)||/电话/.test(lbl)||/手机/.test(lbl)){
        outLines.push('业主电话: '+ph1);
        outLines.push('业主电话: '+ph2);
      }else{
        outLines.push(lbl+': '+ph1);
        outLines.push(lbl+': '+ph2);
      }
      continue;
    }

    /* 模式B：单纯两个电话号行（"18368857920 / 18868605857"） */
    var dualPhone=line.match(/^(\d{11})[\s\/／,，]+(\d{11})\s*$/);
    if(dualPhone){
      outLines.push(dualPhone[1]);
      outLines.push(dualPhone[2]);
      continue;
    }

    /* 模式C："物业 地址 X" 或 "物业地址X" 后面紧跟数字（房号）
       整行提取数字部分作为房号 */
    var propAddrMatch=line.match(/^(物业\s*地址|物业地址|地址)\s*[::]?\s*(.{1,})$/);
    if(propAddrMatch){
      var val=propAddrMatch[2].trim();
      /* 如果value是房号格式（X-Y或X-Y-Z或X号楼Y室），整行直接就是房号 */
      if(/^\d+\s*[-\/／]\s*\d+/.test(val)||/^\d+栋\s*\d+/.test(val)||/^\d+幢\s*\d+/.test(val)){
        outLines.push(val);
        continue;
      }
      /* 否则保留原行（可能是真地址） */
    }

    outLines.push(line);
  }
  return outLines.join('\n');
}

/* 顺序邻近合并算法（v6.27 重写）
   核心原理：OCR 文本中，同一张图片/卡片的字段是连续的。
   按顺序遍历所有碎片 prop，当遇到"新小区名"或"不同房号"时，
   判定为新房源；否则将碎片合并到当前房源。
   解决问题：多张卡片图被合并成1条 / 单张卡片碎片无法合并 */
function mergeSequentialProps(rawProps){
  if(!rawProps)return[];
  rawProps=rawProps.filter(function(x){return x&&(!x._boundary||true)});
  if(rawProps.length===0)return[];
  if(rawProps.length===1)return rawProps[0]._boundary?[]:rawProps;
  var merged=[];
  var current=null;
  for(var i=0;i<rawProps.length;i++){
    var p=rawProps[i];
    /* v6.31: 图片/Sheet 边界 → 强制收口当前房源，绝不跨图合并 */
    if(p&&p._boundary){if(current){merged.push(current);current=null}continue}
    if(current===null){
      current=_cloneProp(p);
      continue;
    }
    if(_shouldStartNewProp(current,p)){
      merged.push(current);
      current=_cloneProp(p);
    }else{
      _mergeFields(current,p);
    }
  }
  if(current)merged.push(current);
  return merged;
}
function _cloneProp(p){
  var c={};
  for(var f in p){
    if(f==='_uniqId'||f==='_duplicate'||f==='_duplicateId'||f==='_rawLine')continue;
    c[f]=p[f];
  }
  return c;
}
function _countKeyFields(p){
  var n=0;
  if(p.community)n++;
  if(p.building)n++;
  if(p.room)n++;
  if(p.ownerPhone)n++;
  if(p.area)n++;
  return n;
}
function _shouldStartNewProp(current,p){
  /* 规则1：两者都有小区名 */
  if(p.community&&current.community){
    /* 完全相同（小区+楼号+房号）→ 重复，合并 */
    if(p.community===current.community&&
       p.building===current.building&&p.room===current.room)return false;
    /* 不同小区名 → 新房源 */
    if(p.community!==current.community)return true;
    /* 同小区，但当前已完整（有楼号+房号）→ 新房源 */
    if(current.building&&current.room)return true;
    /* 同小区，当前不完整 → 合并（补充字段） */
    return false;
  }
  /* 规则2：两者都有楼号+房号 */
  if(p.building&&p.room&&current.building&&current.room){
    /* 相同楼号+房号 → 合并（重复/互补） */
    if(p.building===current.building&&p.room===current.room)return false;
    /* 不同 → 新房源 */
    return true;
  }
  /* 规则3：两者都有电话（不同号码） */
  if(p.ownerPhone&&current.ownerPhone&&p.ownerPhone!==current.ownerPhone){
    var pFieldCount=_countKeyFields(p);
    /* p 只有电话（无其他关键字段）→ 合并为第二个电话 */
    if(pFieldCount<=1)return false;
    /* p 还有其他字段（小区/楼号）→ 新房源 */
    return true;
  }
  /* 默认：合并（p 补充 current 缺失的字段） */
  return false;
}
function _mergeFields(target,source){
  for(var f in source){
    if(f==='_uniqId'||f==='_duplicate'||f==='_duplicateId'||f==='_rawLine'||f==='type')continue;
    if(source[f]!==undefined&&source[f]!==''&&source[f]!==0&&source[f]!==null){
      if(target[f]===undefined||target[f]===''||target[f]===0||target[f]===null){
        target[f]=source[f];
      }else if(f==='ownerPhone'&&target[f]!==source[f]){
        /* 多个电话：用分隔符连接，避免重复（源号码可能已是目标的一部分） */
        var tParts=target[f].split(/\s*\/\s*/);
        var sParts=source[f].split(/\s*\/\s*/);
        for(var sp=0;sp<sParts.length;sp++){
          if(tParts.indexOf(sParts[sp])<0)tParts.push(sParts[sp]);
        }
        target[f]=tParts.join(' / ');
      }
    }
  }
}

/* 列表模式检测：识别"小区\t房号\t面积"的多行表格（如房号列表图）
   用户场景：上传一张小区房号列表（每行一个房号+面积，没有电话），系统应该识别为多套独立房源，而不是合并成1条。
   判定条件：
   1. 至少 3 行"小区\t房号-房号\t面积"格式
   2. 大多数行的小区名相同（>= 70%）
   3. 行内含"楼号-房号"格式（如 16-1704、3-501）
   返回 {isListMode, mainCommunity} 或 null */
function detectListMode(cleanedText){
  if(!cleanedText)return null;
  var lines=cleanedText.split(/\n/).map(function(l){return l.trim()}).filter(Boolean);
  if(lines.length<3)return null;
  /* 1) 跳过表头行（首行可能含"小区名字/物业地址/面积"等表头） */
  var startIdx=0;
  if(/小区.*(地址|房号)|地址.*面积|小区名字/.test(lines[0]))startIdx=1;
  var dataLines=lines.slice(startIdx);
  if(dataLines.length<3)return null;
  /* 2) 统计每行的"小区名"（第一列）和"是否有楼号-房号"
     v6.30 增强：OCR 输出常用空格分隔（如 "绿荷 倒 翠 轩 16-1604 122.25m"），
     先尝试 tab/逗号分割，若只有1列则回退到空格分割 */
  var communityCount={};
  var validRowCount=0;
  for(var i=0;i<dataLines.length;i++){
    var line=dataLines[i];
    var fields=line.split(/[\t,，]/).map(function(f){return f.trim()}).filter(Boolean);
    /* v6.30: 若 tab/逗号分割只有1列（说明是空格分隔），回退到空格分割 */
    if(fields.length<2)fields=line.split(/\s+/).map(function(f){return f.trim()}).filter(Boolean);
    if(fields.length<2)continue;
    /* 第1列(或多列中文)组合为小区名：OCR 可能把 "绿荷叠翠轩" 拆成 "绿荷 倒 翠 轩"
       策略：从第1列开始，连续取纯中文字段组合为小区名，直到遇到数字或字段结束 */
    var cn='';
    for(var ci=0;ci<fields.length;ci++){
      var cf=fields[ci];
      if(/^[\u4e00-\u9fa5]{2,}$/.test(cf)&&!/^\d+$/.test(cf)){cn+=(cn?' ':'' )+cf}
      else break;
    }
    cn=cn.trim();
    if(cn.length<2||cn.length>20)continue;
    /* 后面某列含"楼号-房号"格式 */
    var hasRoom=false;
    for(var j=1;j<fields.length;j++){
      if(/\d+\s*[\-－—\/／]\s*\d{2,5}/.test(fields[j])){hasRoom=true;break}
    }
    if(!hasRoom)continue;
    communityCount[cn]=(communityCount[cn]||0)+1;
    validRowCount++;
  }
  if(validRowCount<3)return null;
  /* 3) 找出现频率最高的小区名（>=70%且>=3次） */
  var mainCommunity='';
  var maxCount=0;
  for(var k in communityCount){
    if(communityCount[k]>maxCount){maxCount=communityCount[k];mainCommunity=k}
  }
  if(!mainCommunity||maxCount<3||maxCount/validRowCount<0.7)return null;
  return{isListMode:true,mainCommunity:mainCommunity,rowCount:validRowCount};
}

/* ============================================================
   意图理解（v6.31）
   ------------------------------------------------------------
   一段文字/一批图片到底是"客户需求"还是"房源信息"？是二手、租赁还是新盘？
   靠关键词打分判断，只用于给出提示（"你可能贴错窗口了"），
   绝不自动改 tab / 改 type，避免误判把数据写到错的地方。
   ============================================================ */
var INTENT_RULES={
  client:[['求购',3],['想买',3],['预算',3],['意向客户',3],['客户需求',3],['找房',2],['看房需求',3],
          ['首付',2],['置换',2],['刚需',2],['改善',1],['几口人',2],['小孩上学',2],['落户',1],
          ['意向',1],['客源',3],['带看需求',2],['微信',1],['来电',2],['到访',2],['渠道',1]],
  prop:[['业主',3],['房东',3],['底价',3],['挂牌',3],['满五',2],['满二',2],['唯一',2],['产权',2],
        ['钥匙',2],['物业地址',3],['房源',2],['在售',2],['幢',1],['单元',1],['室',1],['朝向',1],
        ['装修',1],['楼层',1],['建筑面积',2],['建面',2],['房号',2],['看房',1]],
  rental:[['租金',4],['月租',4],['押一付三',4],['押二付三',4],['整租',4],['合租',4],['出租',3],
          ['元/月',4],['租期',3],['起租',3],['随时入住',2],['拎包入住',1]],
  newdev:[['开盘',4],['交付',3],['容积率',4],['绿化率',4],['开发商',4],['均价',2],['得房率',3],
          ['备案价',3],['认筹',4],['摇号',4],['样板房',3],['一房一价',3],['总户数',3],['分销',2],['佣金',2]]
};
function _intentScore(text,rules){
  var n=0,hits=[];
  for(var i=0;i<rules.length;i++){
    var kw=rules[i][0],w=rules[i][1];
    if(text.indexOf(kw)>=0){n+=w;if(hits.length<4)hits.push(kw)}
  }
  return{score:n,hits:hits};
}
function detectSmartIntent(text){
  if(!text)return null;
  var t=String(text);
  var c=_intentScore(t,INTENT_RULES.client);
  var p=_intentScore(t,INTENT_RULES.prop);
  var r=_intentScore(t,INTENT_RULES.rental);
  var n=_intentScore(t,INTENT_RULES.newdev);
  /* 手机号密度高 + 无房源字段 → 更像客户名单 */
  var phones=(t.match(/1[3-9]\d{9}/g)||[]).length;
  var kind=p.score>=c.score?'prop':'client';
  if(p.score===0&&c.score===0)kind=phones>0?'client':'prop';
  var type='secondhand',typeHits=p.hits;
  if(kind==='prop'){
    if(r.score>=4&&r.score>=n.score){type='rental';typeHits=r.hits}
    else if(n.score>=6&&n.score>r.score){type='newdev';typeHits=n.hits}
    else{type='secondhand'}
  }
  var top=Math.max(c.score,p.score);
  return{
    kind:kind,
    type:type,
    confidence:top>=8?'高':(top>=4?'中':'低'),
    hits:(kind==='prop'?p.hits:c.hits).concat(kind==='prop'&&typeHits!==p.hits?typeHits:[]).slice(0,5),
    phones:phones,
    scores:{client:c.score,prop:p.score,rental:r.score,newdev:n.score}
  };
}
function intentLabel(it){
  if(!it)return'';
  if(it.kind==='client')return'客户名单/需求';
  return it.type==='rental'?'租赁房源':(it.type==='newdev'?'新楼盘信息':'二手房源');
}

/* 清理小区名：剥离尾部的楼幢号/单元/房号等数字信息
   例："绿荷叠翠轩 16-1103 16" → "绿荷叠翠轩"
   例："阳光郡 5幢 2单元 1201" → "阳光郡" */
function cleanCommunityName(raw){
  if(!raw)return raw;
  var s=raw.trim();
  /* 匹配模式：中文小区名(2-15字)后面跟着数字/字母/横线/空格/幢/单元等 → 截断到纯中文名 */
  var m=s.match(/^([一-龥]{2,15}(?:[·\-·]?[一-龥]{0,8})?)/);
  if(m&&m[1]&&m[1].length<s.length)return m[1];
  /* 兜底：找到第一个数字前截断（排除带数字的小区名如"万达广场1期"） */
  var dIdx=s.search(/(?<![期期号#])\d/);
  if(dIdx>4)return s.substring(0,dIdx).trim();
  return s;
}

/* v6.35 中介房源清单专用解析器
   覆盖3种最常见的房产中介内部房源清单格式：
   格式A: 小区名\t楼-房号\t电话              (3列，最简清单)
   格式B: "小区名 楼-房号"\t面积\t楼层\t套型\t电话  (4-5列，详细清单，小区名和房号在同一列)
   格式C: 序号\t小区名\t楼-房号\t电话          (4列，带行号的Excel导出)
   
   返回解析成功的prop数组，若无法识别返回null（让通用管线继续处理）
*/
function _parseAgentListFormat(text){
  if(!text)return null;
  var lines=text.split('\n');
  var dataLines=[];
  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();
    if(!line)continue;
    /* 跳过Sheet边界和图片边界标记 */
    if(line.indexOf('# sheet:')===0||line.indexOf('# img:')===0)continue;
    dataLines.push(line);
  }
  if(dataLines.length<1)return null;

  var lockedType=(S&&(S.subtab==='newdev'||S.subtab==='md'))?S.subtab:'secondhand';
  var results=[];
  var formatDetected=null;
  var matchCount=0;

  for(var li=0;li<dataLines.length;li++){
    var line=dataLines[li];
    var fields=[];
    if(line.indexOf('\t')>=0)fields=line.split('\t').map(function(f){return f.trim()}).filter(Boolean);
    else if(line.indexOf(' ')>=0)fields=line.split(/\s+/).map(function(f){return f.trim()}).filter(Boolean);
    else continue;
    if(fields.length<3)continue;

    var prop={title:'',community:'',building:'',unit:'1单元',room:'',area:0,layout:'',floor:'',totalFloors:'',orientation:'',decoration:'',ownerPhone:'',ownerName:'',totalPrice:0,type:lockedType,status:(lockedType==='md'?'未上架':'在售'),tags:[],description:'',district:'',address:'',createdBy:S&&S.currentUser?S.currentUser.id:'',createdByName:S&&S.currentUser?S.currentUser.name:''};

    /* ---- 尝试匹配格式C：序号|小区名|楼-房号|电话 (4列，首列是纯数字序号) ---- */
    if(fields.length>=4&&!formatDetected){
      var isFormatC=/^\d+$/.test(fields[0])                /* 首列纯数字 */
        &&/^[\u4e00-\u9fa5]{2,}$/.test(fields[1])         /* 第2列中文小区名 */
        &&window.looksLikeRoomField(fields[2])          /* 第3列 楼-房号 */
        &&/1[3-9]\d{9}/.test(fields[fields.length-1]);     /* 末列有手机号 */
      if(isFormatC){formatDetected='C';matchCount++}
    }
    if(formatDetected==='C'||(fields.length>=4&&/^\d+$/.test(fields[0])&&/^[\u4e00-\u9fa5]{2,}$/.test(fields[1])&&window.looksLikeRoomField(fields[2])&&/1[3-9]\d{9}/.test(fields[fields.length-1]))){
      prop.community=fields[1];
      var _srC=window.splitRoomField(fields[2]);if(_srC.building)prop.building=_srC.building;if(_srC.unit)prop.unit=_srC.unit;if(_srC.room)prop.room=_srC.room
      /* 最后一列提取所有电话 */
      for(var ci=2;ci<fields.length;ci++){
        var phs=fields[ci].match(/1[3-9]\d{9}/g);
        if(phs)for(var pi=0;pi<phs.length;pi++){
          if(!prop.ownerPhone)prop.ownerPhone=phs[pi];
          else if(prop.ownerPhone.indexOf(phs[pi])<0)prop.ownerPhone+=' / '+phs[pi];
        }
      }
      prop.title=prop.community+(prop.area?prop.area+'㎡':'');
      results.push(prop);continue;
    }

    /* ---- 尝试匹配格式A：小区名|楼-房号|电话 (3列) ---- */
    if(fields.length>=3&&!formatDetected){
      var isFormatA=/^[\u4e00-\u9fa5]{2,}$/.test(fields[0])     /* 中文小区名 */
        &&window.looksLikeRoomField(fields[1])            /* 楼-房号 */
        &&/1[3-9]\d{9}/.test(fields[2]);                     /* 有手机号 */
      if(isFormatA){formatDetected='A';matchCount++}
    }
    if(formatDetected==='A'||(fields.length>=3&&/^[\u4e00-\u9fa5]{2,}$/.test(fields[0])&&window.looksLikeRoomField(fields[1])&&/1[3-9]\d{9}/.test(fields[fields.length-1]))){
      prop.community=fields[0];
      var _srA=window.splitRoomField(fields[1]);if(_srA.building)prop.building=_srA.building;if(_srA.unit)prop.unit=_srA.unit;if(_srA.room)prop.room=_srA.room
      for(var ai=2;ai<fields.length;ai++){
        var phsA=fields[ai].match(/1[3-9]\d{9}/g);
        if(phsA)for(var pa=0;pa<phsA.length;pa++){
          if(!prop.ownerPhone)prop.ownerPhone=phsA[pa];
          else if(prop.ownerPhone.indexOf(phsA[pa])<0)prop.ownerPhone+=' / '+phsA[pa];
        }
      }
      prop.title=prop.community;
      results.push(prop);continue;
    }

    /* ---- 尝试匹配格式B："小区名 楼-房号"|面积|楼层|套型|电话 (4-5列，首列含小区名+房号) ---- */
    if(fields.length>=4&&!formatDetected){
      var f0=fields[0];
      var hasCommunityInF0=/^[\u4e00-\u9fa5]{2,}/.test(f0);
      var hasRoomInF0=/\d+[-\/－—]\d{2,5}/.test(f0);
      var hasArea=false,hasFloor=false,hasPhone=false;
      for(var bi=1;bi<fields.length;bi++){
        if(/\d+(\.\d+)?\s*(㎡|m²|m2|平方|平米)$/i.test(fields[bi]))hasArea=true;
        if(/^\d+\s*层/.test(fields[bi])||/^\d+[\/／]\d+/.test(fields[bi]))hasFloor=true;
        if(/1[3-9]\d{9}/.test(fields[bi]))hasPhone=true;
      }
      var isFormatB=hasCommunityInF0&&hasRoomInF0&&(hasArea||hasFloor)&&hasPhone;
      if(isFormatB){formatDetected='B';matchCount++}
    }
    if(formatDetected==='B'){
      /* 从首列分离小区名和房号 */
      var f0b=fields[0];
      var roomM=f0b.match(/([\u4e00-\u9fa5]+)\s+(\d+[-\/－—]\d{2,5})/);
      if(roomM){prop.community=roomM[1];var rbM=roomM[2].match(/(\d+)\s*[-\/－—]\s*(\d{2,5})/);if(rbM){prop.building=rbM[1];prop.room=rbM[2]}}
      else{prop.community=cleanCommunityName(f0b)}
      /* 剩余字段按位置识别 */
      for(var bfi=1;bfi<fields.length;bfi++){
        var bf=fields[bfi];
        if(!bf)continue;
        var areaM=bf.match(/^(\d+(\.\d+)?)\s*(㎡|m²|m2|平方|平米)$/i);
        if(areaM&&!prop.area){prop.area=parseFloat(areaM[1]);continue}
        var floorM=bf.match(/(\d+)\s*[\/／]?\s*(\d+)?\s*层?/);
        if(floorM&&!prop.floor){prop.floor=floorM[1];if(floorM[2])prop.totalFloors=floorM[2];continue}
        if(/中间套|边套|夹角/.test(bf)&&!prop.orientation){prop.orientation=bf;continue}
        var bPhs=bf.match(/1[3-9]\d{9}/g);
        if(bPhs)for(var bpi=0;bpi<bPhs.length;bpi++){
          if(!prop.ownerPhone)prop.ownerPhone=bPhs[bpi];
          else if(prop.ownerPhone.indexOf(bPhs[bpi])<0)prop.ownerPhone+=' / '+bPhs[bpi];
        }
      }
      prop.title=prop.community+(prop.area?prop.area+'㎡':'');
      results.push(prop);continue;
    }

    /* 未匹配任何格式 → 不计入results */
  }

  /* 只有当超过半数行匹配成功时才认定是中介清单格式（避免误判） */
  if(results.length>=Math.ceil(dataLines.length*0.3)&&results.length>0){
    return results;
  }
  return null; /* 让通用管线处理 */
}
window._parseAgentListFormat=_parseAgentListFormat;

function parseSmartProp(text){
  if(!text||!text.trim())return [];
  /* 0.0) 规整表格快速通道（Excel/CSV 粘贴）：优先于 OCR 预处理，避免列结构被破坏 */
  var _tableResult=_parseDelimitedTable(text);
  if(_tableResult&&_tableResult.length>0)return _tableResult;

  /* 规整表格快速通道：tab/逗号/中文逗号分隔 + 首行是房源表头 → 直接按列解析（绕过 preprocessOcrText，避免列结构被破坏） */
  function _parseDelimitedTable(text){
    if(!text)return null;
    var rawLines=text.split('\n').map(function(l){return l.trim()}).filter(Boolean);
    if(rawLines.length<2)return null;
    var delim=null;
    if(rawLines[0].indexOf('\t')>=0)delim='\t';
    else if(rawLines[0].indexOf('，')>=0&&rawLines[0].split('，').length>=2)delim='，';
    else if(rawLines[0].indexOf(',')>=0&&rawLines[0].split(',').length>=2)delim=',';
    else return null;
    var header=rawLines[0].split(delim).map(function(f){return f.trim()});
    if(header.length<2)return null;
    if(!isPropHeaderRow(header))return null;
    var colMap=mapPropHeaders(header);
    var lockedType=(S&&(S.subtab==='newdev'||S.subtab==='md'))?S.subtab:'secondhand';
    var results=[];
    for(var i=1;i<rawLines.length;i++){
      var f=rawLines[i].split(delim).map(function(x){return x.trim()});
      if(f.join('').length<2)continue;
      if(f.length<2&&!/1[3-9]\d{9}/.test(f[0]))continue;
      var prop={title:'',community:'',developer:'',district:'',address:'',totalPrice:0,area:0,layout:'',floor:'',totalFloors:'',orientation:'',decoration:'',buildingAge:'',propertyRights:'',hasKey:false,viewingMethod:'',school:'',metro:'',ownerName:'',ownerPhone:'',ownerReserve:'',contactName:'',contactPhone:'',commission:'',propertyType:'',openingDate:'',deliveryDate:'',availableLayouts:'',totalUnits:'',greenRate:'',plotRatio:'',type:lockedType,status:(lockedType==='md'?'未上架':'在售'),tags:[],description:'',averagePrice:0,building:'',unit:'',room:'',createdBy:S&&S.currentUser?S.currentUser.id:'',createdByName:S&&S.currentUser?S.currentUser.name:'',_rawLine:rawLines[i]};
      for(var j=0;j<f.length&&j<colMap.length;j++){
        var key=colMap[j];if(!key)continue;
        var v=f[j];if(!v)continue;
        assignPropField(prop,key,v);
      }
      if(prop.type==='secondhand'&&!prop.ownerPhone){
        var phs=rawLines[i].match(/1[3-9]\d{9}/g);
        if(phs)prop.ownerPhone=phs.join(' / ');
      }
      if(prop.community||prop.room||prop.ownerPhone||prop.area||prop.title||prop.building||prop.totalPrice){
        if(!prop.title&&prop.community)prop.title=prop.community+(prop.area?prop.area+'㎡':'');
        results.push(prop);
      }
    }
    return results.length?results:null;
  }

  /* 0) OCR文本预处理：清洗UI噪声词（电话查看、详情查看、必填填写跟进等） */
  var cleanedText=preprocessOcrText(text);
  if(!cleanedText.trim())return [];

  /* v6.35 0.5) 中介房源清单快速通道 —— 覆盖3种最常见的房产中介清单格式
     在进入通用管线前先尝试专用匹配，命中则直接返回，避免通用管线的各种误判
     格式A: 小区名\t楼-房号\t电话          (3列，最简)
     格式B: 小区名 楼-房号\t面积\t楼层\t套型\t电话  (4-5列，详细)
     格式C: 序号\t小区名\t楼-房号\t电话      (4列，带序号)
  */
  var _agentResult=_parseAgentListFormat(cleanedText);
  if(_agentResult&&_agentResult.length>0)return _agentResult;

  /* 列表模式检测（仅用于辅助判断，不再全局控制合并行为）
     v6.30 关键修复：之前全局 isListMode=true 会导致单卡片图的数据也不走合并，
     造成"小区""物业地""电话"各自变成独立条目。
     新策略：逐行判断是否为列表行，列表行直接独立成条，非列表行走合并管线 */
  var listModeInfo=detectListMode(cleanedText);

  /* 1) 先检测是否是结构化表格（第一行是表头 + 后续有多行数据） */
  var rawLines=cleanedText.split('\n');
  var firstLineFields=null;
  if(rawLines.length>0){
    var fl=rawLines[0].trim();
    if(fl.indexOf('\t')>=0)firstLineFields=fl.split('\t').map(function(f){return f.trim()});
    else if(fl.indexOf('，')>=0&&fl.split('，').length>=2)firstLineFields=fl.split('，').map(function(f){return f.trim()});
    else if(fl.indexOf(',')>=0&&fl.split(',').length>=2)firstLineFields=fl.split(',').map(function(f){return f.trim()});
    else firstLineFields=[fl];
  }
  var isStructuredTable=firstLineFields&&firstLineFields.length>=2&&isPropHeaderRow(firstLineFields)&&rawLines.length>=2;

  /* 2) 非结构化表格（纯文本段落）才尝试公众号文章模式 */
  if(!isStructuredTable){
    var wechatResult=parseWechatArticle(text);
    if(wechatResult){
      return [wechatResult];
    }
  }

  /* 3) 走按行循环解析（处理表格、键值对、纯文本）
     v6.30: 双轨制 —— 列表行(community+room+area无电话)直接独立成条，
     卡片碎片(有电话/字段标签)收集后走 mergeSequentialProps 合并 */
  var lines=rawLines;
  var results=[];
  var rawProps=[];  /* 收集每行识别出的碎片prop（非列表行），最后按"小区+楼幢+房号"分组合并 */
  var headers=null;
  var _pendingBuilding=null; /* v20260807c: 楼幢表头行继承 —— 遇到"17幢1元"行时暂存，后续数据行自动补上 */
  var _pendingUnit=null;
  var currentIsNewdev=(S&&S.subtab==='newdev')||false;

  var isListMode=listModeInfo&&listModeInfo.isListMode;
  var listModeMainCommunity=listModeInfo?listModeInfo.mainCommunity:'';

  /* v6.30: 辅助函数 —— 判断一行是否为"列表模式行"（小区名+房号+面积，无电话） */
  function _isListRow(line,fields){
    if(!isListMode)return false;
    /* 有电话 → 不是纯列表行，可能是卡片数据混入 */
    if(/1[3-9]\d{9}/.test(line))return false;
    /* 有已知字段标签（小区/物业地址/业主电话）→ 不是列表行 */
    if(/^(小区|楼盘|物业地址|业主电话|业主|电话)\s*[:：]?/.test(line))return false;
    /* 必须同时包含：中文小区名(第一列) + 楼号-房号 + 数字(面积) */
    var hasChineseName=false,hasRoom=false,hasArea=false;
    for(var fi=0;fi<fields.length;fi++){
      var fv=fields[fi].trim();
      if(!fv)continue;
      if(/^[\u4e00-\u9fa5]{3,}$/.test(fv)&&!/^\d+$/.test(fv))hasChineseName=true;
      if(/\d+\s*[-\/－—]\s*\d{2,5}/.test(fv))hasRoom=true;
      if(/\d+(\.\d+)?\s*(㎡|m²|m2|平方|平米|m|r4)/i.test(fv)||/^\d+(\.\d+)?$/.test(fv)&&parseFloat(fv)>10&&parseFloat(fv)<1000)hasArea=true;
    }
    return hasChineseName&&hasRoom&&(hasArea||fields.length>=3);
  }

  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();
    if(!line)continue;

    /* Sheet 边界标记：每个 Sheet 独立解析表头，避免 Sheet1 表头被错用到 Sheet2 数据上 */
    if(line.indexOf('# sheet:')===0){
      headers=null;
      _pendingBuilding=null;_pendingUnit=null; /* 重置楼幢继承上下文 */
      rawProps.push({_boundary:true});
      continue;
    }
    /* v6.31 图片边界：批量识别时每张图前会插入 "# img: 文件名"，
       这里推入哨兵，让顺序合并算法在图与图之间硬断开，杜绝"10张图合成1条" */
    if(line.indexOf('# img:')===0){
      headers=null;
      _pendingBuilding=null;_pendingUnit=null; /* 重置楼幢继承上下文 */
      rawProps.push({_boundary:true,_imgName:line.slice(6).trim()});
      continue;
    }

    var fields;
    if(line.indexOf('\t')>=0){
      fields=line.split('\t').map(function(f){return f.trim()});
    }else if(line.indexOf('，')>=0&&line.split('，').length>=2){
      fields=line.split('，').map(function(f){return f.trim()});
    }else if(line.indexOf(',')>=0&&line.split(',').length>=2&&!line.match(/^1[3-9]\d{9}/)){
      fields=line.split(',').map(function(f){return f.trim()});
    }else if(line.indexOf(' ')>=0){
      fields=line.split(/\s+/).filter(function(f){return f});
    }else{
      fields=[line];
    }

    /* v20260807c: 楼幢表头行识别与继承
       原始表格常有"17幢1单元"或"16幢  2单元"这样的独立表头行，
       后续数据行只有房号(101/102)。此处拦截这类行，暂存楼幢+单元，
       后续数据行自动继承，解决万泰成章等楼盘 building 全为空的问题。
       匹配规则：整行只有楼幢+单元信息，无电话、无面积、无中文人名 */
    var _bldHdr=line.match(/^(\d+)\s*(幢|栋|号楼)\s*(\d*)\s*(单元)?\s*$/);
    if(_bldHdr){
      _pendingBuilding=_bldHdr[1]+(_bldHdr[2]||'幢');
      _pendingUnit=(_bldHdr[3]?_bldHdr[3]+'单元':'');
      if(_bldHdr[4])_pendingUnit=_bldHdr[3]+'单元';
      continue; /* 楼幢表头行不生成数据记录 */
    }
    /* 纯"X单元"行（楼幢已在上一行） */
    var _unitOnly=line.match(/^(\d+)\s*单元\s*$/);
    if(_unitOnly){
      _pendingUnit=_unitOnly[1]+'单元';
      continue;
    }

    /* check header row — 每个 Sheet 第一次见到疑似表头行就锁定，避免 i===0 漏掉（因为 sheet 边界会 continue 占用 i） */
    if(!headers&&isPropHeaderRow(fields)){
      headers=mapPropHeaders(fields);
      continue;
    }

    /* type 锁定规则（用户明确要求"新楼盘和二手房是分开的，绝对不能交叉录入"）：
       1) 用户在哪个 tab 打开智能录入弹窗，数据就归属哪个 type，绝不跨 tab
       2) 表头特征只能用来辅助推断该行字段归属（让白名单正确过滤），不能用来切换 type
       3) 完全去除 HZXFXM 强信号自动切二手房的逻辑，避免上传二手房格式被误塞进新楼盘 */
    var currentTab=S&&S.subtab;
    var lockedType=(currentTab==='newdev'||currentTab==='secondhand'||currentTab==='md')?currentTab:'secondhand';
    var defaultType=lockedType;

    var prop={title:'',community:'',developer:'',district:'',address:'',totalPrice:0,area:0,layout:'',floor:'',totalFloors:'',orientation:'',decoration:'',buildingAge:'',propertyRights:'',hasKey:false,viewingMethod:'',school:'',metro:'',ownerName:'',ownerPhone:'',ownerReserve:'',contactName:'',contactPhone:'',commission:'',propertyType:'',openingDate:'',deliveryDate:'',availableLayouts:'',totalUnits:'',greenRate:'',plotRatio:'',type:defaultType,status:(defaultType==='md'?'未上架':'在售'),tags:[],description:'',averagePrice:0,building:'',unit:'',room:'',_rawLine:line};

    /* v20260807c: 继承楼幢表头行的 building/unit（如果本行没有自己解析出的话） */
    if(_pendingBuilding&&!prop.building)prop.building=_pendingBuilding;
    if(_pendingUnit&&!prop.unit)prop.unit=_pendingUnit;

    /* 增强：识别"楼幢-房号"格式（如 16-1704、3-2-501、5栋302 等），
       把楼幢和房号拆出来作为分组键的关键字段 */
    var roomPatterns=[
      /(\d+)\s*[-\/－—]\s*(\d{2,5})/,  /* 16-1704、3/501、5-2-501 会优先匹配前面 */
      /(\d+)\s*栋\s*(\d+)/,
      /(\d+)\s*幢\s*(\d+)/,
      /(\d+)\s*号楼\s*(\d+)/,
      /(\d+)\s*座\s*(\d+)/
    ];
    for(var rp=0;rp<roomPatterns.length;rp++){
      var rm=line.match(roomPatterns[rp]);
      if(rm){
        if(!prop.building)prop.building=rm[1];
        if(!prop.room)prop.room=rm[2];
        break;
      }
    }

    if(headers){
      for(var j=0;j<fields.length;j++){
        if(j>=headers.length)break;
        var h=headers[j];var v=fields[j];
        if(!v)continue;
        assignPropField(prop,h,v);
      }
    }else{
      var kvParsed=parsePropKeyValueLine(line);
      if(kvParsed){
        for(var key in kvParsed){
          assignPropField(prop,key,kvParsed[key]);
        }
      }else{
        autoDetectPropFields(prop,fields,line);
      }
    }

    /* fallback: extract all phone(s) from raw line, add any not already captured */
    if(prop.type==='secondhand'){
      var allPm=line.match(/1[3-9]\d{9}/g);
      if(allPm){
        for(var fpi=0;fpi<allPm.length;fpi++){
          var fph=allPm[fpi];
          if(!prop.ownerPhone){
            prop.ownerPhone=fph;
          }else if(prop.ownerPhone.indexOf(fph)<0){
            prop.ownerPhone=prop.ownerPhone+' / '+fph;
          }
        }
      }
    }

    /* fallback: title from community or first non-phone field */
    if(!prop.title){
      if(prop.community)prop.title=prop.community+(prop.area?prop.area+'㎡':'')+(prop.layout?prop.layout:'');
      else{
        for(var k=0;k<fields.length;k++){
          var f=fields[k];
          if(f&&!f.match(/1[3-9]\d{9}/)&&!f.match(/^\d+万?$/)&&f.length>=2){
            prop.title=f.replace(/[：:，,]/g,'');
            break;
          }
        }
      }
    }

    /* v6.30 双轨制：判断这行是"列表行"还是"卡片碎片"
       列表行（小区+房号+面积，无电话/标签）→ 直接独立成条，不走合并
       卡片碎片（有电话/字段标签/小区名）→ 收集到 rawProps 后统一合并 */
    if(prop.title||prop.ownerPhone||prop.community||prop.building||prop.room||prop.area){
      var thisIsListRow=_isListRow(line,fields);
      if(thisIsListRow){
        /* 列表行：补全小区名，直接作为独立房源 */
        if(!prop.community&&listModeMainCommunity)prop.community=listModeMainCommunity;
        if(!prop.title&&prop.community)prop.title=prop.community+(prop.area?prop.area+'㎡':'');
        prop._isListRow=true;
        results.push(prop);
      }else{
        /* 卡片碎片：收集到 rawProps，后续走 mergeSequentialProps */
        /* v6.35 智能去重：按地址指纹而非标题（避免同小区89套全被标重复） */
        var _pType=prop.type||S.subtab||'secondhand';
        if(_pType==='secondhand'||_pType==='rental'){
          var _fp=[prop.community||'',prop.building||'',prop.unit||'',prop.room||''].join('|');
          if(_fp.replace(/\|/g,'').length>2){
            for(var ei=0;ei<S.properties.length;ei++){
              var ep=S.properties[ei];
              var _ef=[ep.community||'',ep.building||'',ep.unit||'',ep.room||''].join('|');
              if(_ef===_fp){prop._duplicate=true;prop._duplicateId=ep.id;prop._dupReason='地址相同';break}
            }
          }
        }else if(_pType==='newdev'){
          var _nt=(prop.title||'').replace(/\s+/g,'').toLowerCase();
          if(_nt){for(var ei=0;ei<S.properties.length;ei++){var ep=S.properties[ei];var _et=((ep.title||'')).replace(/\s+/g,'').toLowerCase();if(_et&&_nt===_et){prop._duplicate=true;prop._duplicateId=ep.id;prop._dupReason='楼盘同名';break}}}
        rawProps.push(prop);
      }
    }
  }

  /* v6.30 双轨制合并：
     results 中已有列表行（独立房源）
     rawProps 中是卡片碎片 → 顺序邻近合并为完整房源
     最终 results = 列表行 + 合并后的卡片房源 */
  var mergedCards=mergeSequentialProps(rawProps);
  results=results.concat(mergedCards);

  /* v6.30 后处理：OCR 容错修正
     1) 小区名 OCR 错字归一化（"绿荷重翠轩"/"绿荷倒翠轩" → "绿荷叠翠轩"）
     2) 面积单位修正（r4/m → ㎡）*/
  var _ocrCommunityFixes={
    '绿荷重翠轩':'绿荷叠翠轩','绿荷倒翠轩':'绿荷叠翠轩','绿荷重翠':'绿荷叠翠轩','绿荷倒翠':'绿荷叠翠轩'
  };
  for(var ri=0;ri<results.length;ri++){
    var rp=results[ri];
    if(rp.community&&_ocrCommunityFixes[rp.community])rp.community=_ocrCommunityFixes[rp.community];
    if(rp.title){
      for(var fixSrc in _ocrCommunityFixes){if(rp.title.indexOf(fixSrc)>=0)rp.title=rp.title.replace(fixSrc,_ocrCommunityFixes[fixSrc])}
    }
  }

  /* title 字段缺失时尝试用合并后的 community 补上 */
  for(var ri=0;ri<results.length;ri++){
    var rp=results[ri];
    if(!rp.title&&rp.community){
      rp.title=rp.community+(rp.area?rp.area+'㎡':'')+(rp.layout?rp.layout:'')+(rp.building?' '+rp.building+'幢':'')+(rp.room?' '+rp.room:'');
    }
  }

  /* v6.30.x: 去重 —— 同一(小区+楼幢+房号)只保留一条，字段互补合并。
     解决：① 同一张房号列表图在不同图片里重复出现（如 16-1604 在两张列表图都有）；
           ② 列表行(无电话) 与 卡片(有电话) 指向同一套房 → 合并电话进去，而不是各成一条。
     注：只对有楼幢+房号的条目做去重键；纯文本/无房号碎片不参与。 */
  var _seen={};
  var _deduped=[];
  for(var di=0;di<results.length;di++){
    var dp=results[di];
    if(dp.building&&dp.room){
      var dkey=(dp.community||'')+'|'+dp.building+'|'+dp.room;
      if(_seen[dkey]){
        var ex=_seen[dkey];
        var _mergeKeys=['ownerPhone','area','layout','orientation','decoration','totalPrice','unitPrice','district','address','buildingAge','floor','ownerName'];
        for(var mk=0;mk<_mergeKeys.length;mk++){
          var kk=_mergeKeys[mk];
          if(!ex[kk]&&dp[kk])ex[kk]=dp[kk];
        }
        continue;
      }
      _seen[dkey]=dp;
    }
    _deduped.push(dp);
  }
  results=_deduped;

  return results;
}

/* ========== 智能录入字段相关性：解析完成后智能判断 type ========== */
/* 用户反馈"自动识别的内容需要和表头内容相关，不相关的就不要添加进去"。
   解析时已经在 assignPropField 里按 type 做了字段白名单过滤。
   此处再扫描一遍结果集，根据实际识别出的字段特征重新判断每条数据的真实 type，
   避免用户在二手tab上传了新楼盘表格、或反之时，type 被错定。 */
window.autoDetectPropType=function(results){
  /* 用户明确要求"新楼盘和二手房绝对不能交叉录入"。
     type 在 parseSmartProp 里已经按当前 tab 锁定，这里**不再修改任何 prop.type**，
     只做字段特征统计，供上层判断"用户上传的内容是否和当前 tab 匹配"，便于提示。 */
  var newdevSignals=['developer','commission','deliveryDate','availableLayouts','propertyType','projectTag','businessDistrict','viewingRule','protectionPeriod','remaining','highlights','preferential','propertyFee','openingDate','totalUnits','greenRate','plotRatio','averagePrice'];
  var secondhandSignals=['ownerPhone','ownerName','floor','orientation','hasKey','buildingAge','propertyRights','area','layout','unitPrice','totalFloors'];
  var stats={newdev:0,secondhand:0,mismatch:0,typeMismatch:false};
  for(var i=0;i<results.length;i++){
    var p=results[i];
    var newScore=0,secScore=0;
    for(var k=0;k<newdevSignals.length;k++){if(p[newdevSignals[k]])newScore++;}
    for(var k2=0;k2<secondhandSignals.length;k2++){if(p[secondhandSignals[k2]])secScore++;}
    if(p.type==='newdev'){
      stats.newdev++;
      /* 检查是否含有大量二手特征字段 → 标记 mismatch 提示 */
      if(secScore>newScore+2)stats.mismatch++;
    }else if(p.type==='secondhand'){
      stats.secondhand++;
      if(newScore>secScore+2)stats.mismatch++;
    }
  }
  stats.typeMismatch=stats.mismatch>0;
  return stats;
}

/* ========== 公众号文章智能解析 ========== */
/* 公众号文章复制全文后的典型特征：
   - 开头是公众号名+ "已关注" / "关注公众号"
   - 标题（通常独占一行，长度15-50字）
   - 日期 "2024年12月31日 09:00" 或 "刚刚"
   - 多个段落正文
   - 末尾 "阅读全文" / "点击关注" / "分享" / "点赞" / "在看" / "扫码" 等公众号固定字
   - 大量"微信""公众号"等字眼
   - 有"小图标 听全文"等
*/
function parseWechatArticle(text){
  if(!text)return null;
  var t=text.trim();
  /* 必须够长才算文章（避免误判） */
  if(t.length<200)return null;
  /* 公众号文章特征字命中数 */
  var wechatKeywords=['阅读全文','点击关注','关注公众号','在看','已关注','分享','赞','扫码','二维码','小程序','微信','公众号','听全文','收藏','评论','精选留言','展开阅读全文'];
  var hitCount=0;
  for(var i=0;i<wechatKeywords.length;i++){
    if(t.indexOf(wechatKeywords[i])>=0)hitCount++;
  }
  /* 至少命中2个公众号特征字 */
  if(hitCount<2)return null;

  /* 进入公众号文章模式 */
  var lines=t.split(/\n/).map(function(l){return l.trim()}).filter(Boolean);

  /* 1) 提取标题：通常是第一个看起来像标题的较长行（15-60字，无标点句号结尾） */
  var title='';
  for(var j=0;j<lines.length;j++){
    var ln=lines[j];
    if(ln.length<8||ln.length>80)continue;
    /* 跳过明显的公众号固定字 */
    if(/^(小闻歌|公众号|微信|分享|关注|扫码|阅读全文)/.test(ln))continue;
    /* 跳过日期行 */
    if(/^\d{4}年\d{1,2}月\d{1,2}日/.test(ln))continue;
    /* 跳过"刚刚" */
    if(ln==='刚刚')continue;
    /* 标题特征：长度适中，不含"。"句号 */
    if(!/[\.\。]/.test(ln)&&!/(已关注|点击关注|关注公众号|阅读全文)/.test(ln)){
      title=ln;
      break;
    }
  }
  if(!title){
    /* 兜底：用第一行作为标题 */
    title=lines[0]||'微信公众号文章';
  }

  /* 2) 提取关键信息 */
  var prop={
    title:title,
    community:'',
    developer:'',
    district:'',
    address:'',
    totalPrice:0,
    area:0,
    layout:'',
    floor:'',
    totalFloors:'',
    orientation:'',
    decoration:'',
    buildingAge:'',
    propertyRights:'',
    hasKey:false,
    viewingMethod:'',
    school:'',
    metro:'',
    ownerName:'',
    ownerPhone:'',
    contactName:'',
    contactPhone:'',
    commission:'',
    type:S.subtab||'secondhand',
    status:(lockedType==='md'?'未上架':'在售'),
    tags:['公众号文章'],
    description:t,
    averagePrice:0
  };

  /* 3) 从正文提取关键数据 */

  /* 开发商：常见表述"由XX开发"、"XX开发"、"开发商：XX"、"XX出品" */
  var devMatch=t.match(/(?:开发商[：:]?\s*|由\s*|由\s*\S+\s*开发|由\s*(\S+)\s*集团)(\S{2,8}(?:地产|置业|房产|集团|发展|建设|开发|控股|实业)?)/);
  if(devMatch)prop.developer=(devMatch[2]||devMatch[1]||'').replace(/[，。、\s]+$/,'');

  /* 单价/均价：XXX元/㎡ 或 XXX元/平米 */
  var priceMatch=t.match(/(\d[\d,\.]*)\s*元\s*[\/／]\s*[㎡平平]?[米m]?[²2]?/);
  if(priceMatch)prop.averagePrice=parseFloat(priceMatch[1].replace(/,/g,''));

  /* 总价：总价XXX万 / XXX万 */
  var totalPriceMatch=t.match(/总价\s*[:：]?\s*(\d[\d,\.]*)\s*万/);
  if(totalPriceMatch){
    prop.totalPrice=parseFloat(totalPriceMatch[1].replace(/,/g,''));
  }

  /* 面积：XXX㎡ 或 XXX平米 */
  var areaMatch=t.match(/(\d{2,4}(?:\.\d+)?)\s*[㎡平]?\s*[米]?[²2]?/);
  if(areaMatch){
    var areaVal=parseFloat(areaMatch[1]);
    if(areaVal>=20&&areaVal<=1000)prop.area=areaVal;
  }

  /* 户型：X室X厅X卫 或 X房X厅 */
  var layoutMatch=t.match(/(\d)\s*[室房][^X\d]*?(\d)\s*厅|(\d)\s*室\s*(\d)\s*厅|(\d)\s*[房室]/);
  if(layoutMatch){
    var r1=layoutMatch[1]||layoutMatch[3]||layoutMatch[5];
    var r2=layoutMatch[2]||layoutMatch[4]||'';
    prop.layout=r1+'室'+(r2?r2+'厅':'');
  }

  /* 区域：常见"XX区" "XX板块" "位于XX" */
  var districtMatch=t.match(/(?:位于|地处|在|选址)\s*(\S{0,4}(?:区|县|市))/);
  if(districtMatch)prop.district=districtMatch[1];
  if(!prop.district){
    var dMatch=t.match(/(余杭区|临平区|拱墅区|上城区|西湖区|滨江区|萧山区|钱塘区|富阳区|临安区)/);
    if(dMatch)prop.district=dMatch[1];
  }

  /* 学区/学区房字眼 */
  if(/学区房|学区|学校/.test(t))prop.school='是';

  /* 地铁 */
  if(/地铁\d+号线|距地铁|地铁口|近地铁/.test(t)){
    var metroMatch=t.match(/地铁(\d+号线?)/);
    if(metroMatch)prop.metro=metroMatch[1];
    else prop.metro='近地铁';
  }

  /* 装修：精装修/毛坯/简装 */
  if(/精装修|精装/.test(t))prop.decoration='精装';
  else if(/毛坯交付|毛坯/.test(t))prop.decoration='毛坯';
  else if(/简装/.test(t))prop.decoration='简装';

  /* 朝向 */
  var orientMatch=t.match(/(南向|南北通透|朝南|正南|东南|西南|朝东|朝西|朝北|东向|西向|北向)/);
  if(orientMatch)prop.orientation=orientMatch[1];

  /* 楼层 */
  var floorMatch=t.match(/(\d+)\s*[\/／]\s*(\d+)\s*层/);
  if(floorMatch){
    prop.floor=floorMatch[1];
    prop.totalFloors=floorMatch[2];
  }

  /* 小区名尝试：取第一个引号/书名号内的 */
  var communityMatch=t.match(/[\"「《]([^\"」》]{4,30})[\"」》]/);
  if(communityMatch&&!prop.community)prop.community=communityMatch[1];

  /* 联系电话 */
  var phoneMatch=t.match(/1[3-9]\d{9}/);
  if(phoneMatch)prop.ownerPhone=phoneMatch[0];

  /* 佣金：常见表述"佣金X%" / "佣金X万/套" / "佣金：X%" / "佣金比例X%" / "分销佣金X%" */
  var commissionMatch=t.match(/(?:分销)?佣金(?:比例|点数)?[：:]?\s*(\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*万?\/?套?|面议)/);
  if(commissionMatch)prop.commission=commissionMatch[1].replace(/\s+/g,'');

  /* 对接人：常见表述"对接人：张经理" / "联系人：王经理" / "销售：李经理" / "案场：XXX" */
  var contactMatch=t.match(/(?:对接人|联系人|案场|销售(?:经理)?|置业顾问)[：:]\s*([^\s,，。；;]{2,8})/);
  if(contactMatch)prop.contactName=contactMatch[1];
  /* 对接人电话：跟在对接人姓名后面的电话 */
  if(contactMatch){
    var afterContact=t.substring(contactMatch.index);
    var cpMatch=afterContact.match(/1[3-9]\d{9}/);
    if(cpMatch)prop.contactPhone=cpMatch[0];
  }

  /* 自动计算单价 */
  if(prop.totalPrice&&prop.area&&!prop.averagePrice){
    prop.averagePrice=Math.round(prop.totalPrice*10000/prop.area);
  }

  /* tags 增强 */
  if(prop.developer)prop.tags.push(prop.developer);
  if(prop.district)prop.tags.push(prop.district);
  if(prop.metro)prop.tags.push('近'+prop.metro);

  /* 去重 */
  prop.tags=[...new Set(prop.tags)];

  return prop;
}

function isPropHeaderRow(fields){
  var kw=['小区','名称','标题','房源','面积','户型','总价','价格','均价','楼层','朝向','装修','区域','地址','业主','电话','手机','状态','备注','描述','建成','产权','钥匙','学区','地铁','标签',    '开发商','房号','单元','楼幢','联系',
    /* 新楼盘表格头 */
    '行政区','项目名称','项目标签','商圈','物业类型','物业费','在售面积','起步总价','基本卖点','优惠政策','地铁线路','预计交付时间','佣金情况','带看规则','剩余房源','保护期','按揭',
    '在售楼幢','加推楼幢','加推价格','带看流程','认购状态','交付时间'];
  var mc=0;
  for(var i=0;i<fields.length;i++){
    var f=fields[i].toLowerCase();
    for(var j=0;j<kw.length;j++){
      if(f.indexOf(kw[j])>=0){mc++;break}
    }
  }
  return mc>=2;
}

function mapPropHeaders(fields){
  var m=[];
  for(var i=0;i<fields.length;i++){
    var f=fields[i].toLowerCase();
    /* 小区/名称/标题/房源名 → title */
    if(f.indexOf('小区')>=0||f.indexOf('楼盘')>=0)m.push('community');
    else if(f.indexOf('项目名称')>=0||f.indexOf('标题')>=0||f.indexOf('房源名')>=0)m.push('title');
    /* —— 新楼盘楼幢类字段：必须先于下方"楼幢/幢/栋→building"与"价格→totalPrice"规则拦截 —— */
    else if(f.indexOf('加推价格')>=0||f.indexOf('加推均价')>=0)m.push('additionalPrice');
    else if(f.indexOf('加推')>=0)m.push('additionalBuildings');
    else if(f.indexOf('在售楼幢')>=0||f.indexOf('在售楼栋')>=0||f.indexOf('在售房源楼幢')>=0)m.push('onSaleBuildings');
    else if(f.indexOf('认购状态')>=0||f.indexOf('认购方式')>=0||f.indexOf('销售状态')>=0)m.push('saleStatus');
    else if(f.indexOf('在售面积')>=0||f.indexOf('主推户型')>=0||f.indexOf('在售户型')>=0)m.push('availableLayouts');
    else if(f.indexOf('面积')>=0)m.push('area');
    else if(f.indexOf('户型')>=0||f.indexOf('房型')>=0)m.push('layout');
    else if(f.indexOf('优惠政策')>=0||f.indexOf('优惠')>=0)m.push('preferential');
    else if(f.indexOf('起步总价')>=0||(f.indexOf('总价')>=0)||(f.indexOf('价格')>=0&&f.indexOf('均价')<0))m.push('totalPrice');
    else if(f.indexOf('均价')>=0)m.push('averagePrice');
    else if(f.indexOf('楼层')>=0)m.push('floor');
    else if(f.indexOf('总楼层')>=0)m.push('totalFloors');
    else if(f.indexOf('朝向')>=0)m.push('orientation');
    else if(f.indexOf('装修')>=0)m.push('decoration');
    else if(f.indexOf('行政区')>=0||f.indexOf('区域')>=0||f.indexOf('地段')>=0)m.push('district');
    else if(f.indexOf('商圈')>=0)m.push('businessDistrict');
    else if(f.indexOf('地址')>=0)m.push('address');
    else if(f.indexOf('业主')>=0){
      if(f.indexOf('姓名')>=0||f.indexOf('名字')>=0)m.push('ownerName');
      else m.push('ownerPhone'); /* 业主电话/业主联系方式/联系电话 均归业主电话 */
    }
    else if((f.indexOf('联系')>=0)&&(f.indexOf('电话')>=0||f.indexOf('手机')>=0))m.push('ownerPhone');
    else if(f.indexOf('电话')>=0||f.indexOf('手机')>=0)m.push('ownerPhone');
    else if(f.indexOf('建成')>=0||f.indexOf('年代')>=0)m.push('buildingAge');
    else if(f.indexOf('产权')>=0)m.push('propertyRights');
    else if(f.indexOf('钥匙')>=0)m.push('hasKey');
    else if(f.indexOf('看房')>=0||f.indexOf('带看')>=0)m.push('viewingRule');
    else if(f.indexOf('保护期')>=0)m.push('protectionPeriod');
    else if(f.indexOf('学区')>=0)m.push('school');
    else if(f.indexOf('地铁')>=0)m.push('metro');
    else if(f.indexOf('开发商')>=0)m.push('developer');
    else if(f.indexOf('物业类型')>=0||f.indexOf('物业费')>=0)m.push('propertyType');
    /* 注：之前"物业费"映射到propertyFee（金额字段），但用户表格"物业费"列实际写的是"普通住宅/住宅/商业"等文字（物业类型），
       所以统一映射到propertyType，propertyFee字段不再使用 */
    else if(f.indexOf('按揭')>=0)m.push('protectionPeriod');
    else if(f.indexOf('剩余房源')>=0||f.indexOf('房源数')>=0)m.push('remaining');
    else if(f.indexOf('预计交付')>=0||f.indexOf('交付时间')>=0||f.indexOf('交房时间')>=0)m.push('deliveryDate');
    else if(f.indexOf('开盘')>=0)m.push('openingDate');
    else if(f.indexOf('佣金')>=0)m.push('commission');
    else if(f.indexOf('基本卖点')>=0||f.indexOf('卖点')>=0)m.push('highlights');
    else if(f.indexOf('项目标签')>=0)m.push('projectTag');
    else if(f.indexOf('状态')>=0)m.push('status');
    else if(f.indexOf('备注')>=0||f.indexOf('描述')>=0||f.indexOf('说明')>=0)m.push('description');
    else if(f.indexOf('标签')>=0)m.push('tag');
    else if(f.indexOf('楼幢')>=0||f.indexOf('楼栋')>=0||f.indexOf('楼号')>=0||f.indexOf('幢')>=0||f.indexOf('栋')>=0)m.push('building');
    else if(f.indexOf('单元')>=0)m.push('unit');
    else if(f.indexOf('房号')>=0||f.indexOf('房间号')>=0||f.indexOf('室号')>=0||f.indexOf('门牌')>=0)m.push('room');
    else m.push('');
  }
  return m;
}

function parsePropKeyValueLine(line){
  var seps=['：',':','＝'];
  var hasKV=false;
  for(var s=0;s<seps.length;s++){
    if(line.indexOf(seps[s])>=0){hasKV=true;break}
  }
  if(!hasKV)return null;

  var result={};
  var parts=line.split(/[\s,，;；]+/);
  for(var p=0;p<parts.length;p++){
    var part=parts[p].trim();
    if(!part)continue;
    var idx=-1;var sep='';
    for(var s=0;s<seps.length;s++){
      idx=part.indexOf(seps[s]);
      if(idx>0){sep=seps[s];break}
    }
    if(idx>0){
      var key=part.substring(0,idx).trim();
      var val=part.substring(idx+sep.length).trim();
      var nk=normalizePropKey(key);
      if(nk)result[nk]=val;
    }
  }
  return Object.keys(result).length>=1?result:null;
}

function normalizePropKey(key){
  key=key.toLowerCase();
  /* —— 新楼盘楼幢类字段：先于"价格/楼盘/状态"等宽泛规则拦截 —— */
  if(key.indexOf('加推价格')>=0||key.indexOf('加推均价')>=0)return'additionalPrice';
  if(key.indexOf('加推')>=0)return'additionalBuildings';
  if(key.indexOf('在售楼幢')>=0||key.indexOf('在售楼栋')>=0)return'onSaleBuildings';
  if(key.indexOf('认购状态')>=0||key.indexOf('认购方式')>=0||key.indexOf('销售状态')>=0)return'saleStatus';
  if(key.indexOf('小区')>=0||key.indexOf('名称')>=0||key.indexOf('标题')>=0)return'title';
  if(key.indexOf('面积')>=0)return'area';
  if(key.indexOf('户型')>=0||key.indexOf('房型')>=0)return'layout';
  if(key.indexOf('总价')>=0||key.indexOf('价格')>=0&&key.indexOf('均价')<0)return'totalPrice';
  if(key.indexOf('均价')>=0)return'averagePrice';
  if(key.indexOf('楼层')>=0&&key.indexOf('总')<0)return'floor';
  if(key.indexOf('总楼层')>=0)return'totalFloors';
  if(key.indexOf('朝向')>=0)return'orientation';
  if(key.indexOf('装修')>=0)return'decoration';
  if(key.indexOf('区域')>=0||key.indexOf('地段')>=0)return'district';
  if(key.indexOf('地址')>=0)return'address';
  if(key.indexOf('业主')>=0&&key.indexOf('电话')<0&&key.indexOf('手机')<0)return'ownerName';
  if(key.indexOf('电话')>=0||key.indexOf('手机')>=0||key.indexOf('联系')>=0)return'ownerPhone';
  if(key.indexOf('建成')>=0||key.indexOf('年代')>=0)return'buildingAge';
  if(key.indexOf('产权')>=0)return'propertyRights';
  if(key.indexOf('钥匙')>=0)return'hasKey';
  if(key.indexOf('看房')>=0)return'viewingMethod';
  if(key.indexOf('学区')>=0)return'school';
  if(key.indexOf('地铁')>=0)return'metro';
  if(key.indexOf('开发商')>=0)return'developer';
  if(key.indexOf('楼盘名')>=0||key.indexOf('楼盘')>=0)return'title';
  if(key.indexOf('对接人')>=0||key.indexOf('联系人')>=0||key.indexOf('案场')>=0||key.indexOf('销售经理')>=0||key.indexOf('置业顾问')>=0)return'contactName';
  if(key.indexOf('联系电话')>=0)return'contactPhone';
  if(key.indexOf('佣金')>=0)return'commission';
  if(key.indexOf('开盘')>=0)return'openingDate';
  if(key.indexOf('交房')>=0||key.indexOf('交付')>=0)return'deliveryDate';
  if(key.indexOf('在售户型')>=0||key.indexOf('主推户型')>=0)return'availableLayouts';
  if(key.indexOf('总户数')>=0)return'totalUnits';
  if(key.indexOf('绿化')>=0)return'greenRate';
  if(key.indexOf('容积率')>=0)return'plotRatio';
  if(key.indexOf('物业类型')>=0||key.indexOf('物业费')>=0)return'propertyType';
  if(key.indexOf('状态')>=0)return'status';
  if(key.indexOf('备注')>=0||key.indexOf('描述')>=0||key.indexOf('说明')>=0)return'description';
  return'';
}

function assignPropField(prop,key,val){
  val=(val||'').trim();
  if(!val)return;
  /* 字段相关性过滤：用户要求"自动识别的内容需要和表头内容相关，不相关的就不要添加进去"。
     根据 prop.type 严格控制哪些字段可以填，杜绝把二手字段塞进新楼盘（或反向） */
  var NEWDEV_KEYS={title:1,district:1,developer:1,propertyType:1,availableLayouts:1,totalPrice:1,totalPriceText:1,averagePrice:1,averagePriceText:1,onSaleBuildings:1,additionalBuildings:1,additionalPrice:1,saleStatus:1,openingDate:1,deliveryDate:1,totalUnits:1,greenRate:1,plotRatio:1,contactName:1,contactPhone:1,commission:1,propertyFee:1,businessDistrict:1,projectTag:1,viewingRule:1,metro:1,highlights:1,preferential:1,remaining:1,protectionPeriod:1,decoration:1,address:1,community:1,description:1,tags:1,status:1,viewingMethod:1,school:1,building:1,unit:1,room:1};
  var SECONDHAND_KEYS={title:1,area:1,layout:1,totalPrice:1,unitPrice:1,averagePrice:1,floor:1,totalFloors:1,orientation:1,decoration:1,district:1,address:1,community:1,ownerName:1,ownerPhone:1,contactName:1,contactPhone:1,commission:1,hasKey:1,viewingMethod:1,school:1,metro:1,buildingAge:1,propertyRights:1,status:1,description:1,tags:1,building:1,unit:1,room:1};
  var MD_KEYS={community:1,district:1,block:1,building:1,unit:1,room:1,area:1,layout:1,ownerName:1,ownerPhone:1,ownerReserve:1,address:1,description:1,tags:1,status:1,title:1};
  if(prop.type==='newdev'&&!NEWDEV_KEYS[key])return;          /* 新楼盘模式：拒绝二手专属字段 */
  if(prop.type==='secondhand'&&!SECONDHAND_KEYS[key])return;  /* 二手模式：拒绝新楼盘专属字段 */
  if(prop.type==='md'&&!MD_KEYS[key])return;                  /* 房源MD模式：仅接受名单相关字段 */
  if(prop.type==='md'&&key==='status')return;                /* 名单上架状态由用户在列表手动选择，不从表格"状态"列导入 */
  /* 描述类字段追加而不是覆盖，便于多列内容合并 */
  var _appendDesc=function(prefix){
    if(!val)return;
    var line=(prefix?prefix+'：':'')+val;
    if(!prop.description)prop.description=line;
    else if(prop.description.indexOf(line)<0)prop.description+='\n'+line;
  };
  switch(key){
    case'title':
      if(!prop.title)prop.title=val.replace(/[：:，,]/g,'');
      else if(!prop.community)prop.community=val.replace(/[：:，,]/g,'');
      break;
    case'community':
      prop.community=cleanCommunityName(val.replace(/[：:，,]/g,''));
      if(!prop.title)prop.title=prop.community;
      break;
    case'area':
      var ar=parseFloat(val.replace(/[^0-9.]/g,''));
      if(ar>0)prop.area=ar;
      break;
    case'layout':
      prop.layout=val;
      break;
    case'totalPrice':
      /* 起步总价兼容区间写法："700-900万" 取首段 700；"1000-1500万" 取 1000；"700万"取 700 */
      var tpStr=val;
      var dashIdx=tpStr.search(/[-—~～]/);
      if(dashIdx>0)tpStr=tpStr.substring(0,dashIdx);
      var tp=parseFloat(tpStr.replace(/[^0-9.]/g,''));
      if(tp>0)prop.totalPrice=tp;
      /* 原文留档：像"住宅：400-700万，叠墅1150-2300万"这类分档写法，只存数字会丢信息 */
      if(prop.type==='newdev'&&val){var _tpn=String(val).replace(/\s/g,'');if(_tpn!==String(tp)&&_tpn!==String(tp)+'万'&&_tpn!==String(tp)+'万元')prop.totalPriceText=String(val).trim();}
      break;
    case'averagePrice':
      /* 均价兼容写法：
         "4.6万/平" -> 46000；"39500元/平" -> 39500；"45166元/㎡" -> 45166；纯数字 32000 -> 32000
         区间/分档写法只取第一段数字："55000-60000元" -> 55000；"高层50000元，排屋8-10万" -> 50000 */
      var apVal=val;
      if(/万/i.test(apVal)){
        var apM=apVal.match(/(\d+(?:\.\d+)?)/);
        if(apM){var ap=Math.round(parseFloat(apM[1])*10000);if(ap>0)prop.averagePrice=ap;}
      }else{
        var apM2=apVal.match(/\d+/);            /* 只取首个数字串，避免"55000-60000"被拼成5500060000 */
        var ap2=apM2?parseInt(apM2[0],10):0;
        if(ap2>0)prop.averagePrice=ap2;
      }
      /* 原文留档：像"叠墅45000元""高层50000元，排屋80000-100000元"这类写法 */
      if(prop.type==='newdev'&&val){var _apn=String(val).replace(/\s/g,''),_apv=prop.averagePrice||0;
        if(_apn!==String(_apv)&&_apn!==_apv+'元'&&_apn!==_apv+'元/㎡'&&_apn!==_apv+'元/平'&&_apn!==_apv+'元/平米'&&_apn!==_apv+'元/方')prop.averagePriceText=String(val).trim();}
      break;
    case'onSaleBuildings':
      prop.onSaleBuildings=val;
      break;
    case'additionalBuildings':
      prop.additionalBuildings=val;
      break;
    case'additionalPrice':
      prop.additionalPrice=val;
      break;
    case'saleStatus':
      prop.saleStatus=val;
      break;
    case'floor':
      var fm=val.match(/(\d+)\s*[\/／]?\s*(\d+)?/);
      if(fm){prop.floor=fm[1];if(fm[2])prop.totalFloors=fm[2]}
      else prop.floor=val;
      break;
    case'totalFloors':
      prop.totalFloors=val.replace(/[^0-9]/g,'');
      break;
    case'building':
      prop.building=val.replace(/[^0-9a-zA-Z一-鿿]/g,'');
      break;
    case'unit':
      prop.unit=val.replace(/[^0-9a-zA-Z一-鿿]/g,'');
      break;
    case'room':
      var _sr=window.splitRoomField(val);
      if(_sr.building&&!prop.building)prop.building=_sr.building;
      if(_sr.unit&&!prop.unit)prop.unit=_sr.unit;
      if(_sr.room)prop.room=_sr.room;
      break;
    case'orientation':
      for(var d=0;d<ORIENTATIONS.length;d++){
        if(val.indexOf(ORIENTATIONS[d])>=0){prop.orientation=ORIENTATIONS[d];break}
      }
      if(!prop.orientation)prop.orientation=val;
      break;
    case'decoration':
      for(var d=0;d<DECORATIONS.length;d++){
        if(val.indexOf(DECORATIONS[d])>=0){prop.decoration=DECORATIONS[d];break}
      }
      if(!prop.decoration)prop.decoration=val;
      break;
    case'district':
      for(var i=0;i<AREAS.length;i++){
        if(val.indexOf(AREAS[i])>=0){prop.district=AREAS[i];break}
      }
      if(!prop.district)prop.district=val;
      break;
    /* 新楼盘：商圈并入 tags 和 district（若未填），独立字段也存到 prop.businessDistrict（修复：之前没赋给 businessDistrict，导致表格"商圈"列一直显示空） */
    case'businessDistrict':
      prop.businessDistrict=val;
      prop.district=prop.district||val;
      if(prop.tags.indexOf('商圈·'+val)<0)prop.tags.push('商圈·'+val);
      break;
    case'address':
      prop.address=val;
      break;
    case'ownerName':
      prop.ownerName=val.replace(/[：:，,]/g,'');
      break;
    case'ownerPhone':
      /* 提取所有手机号（一行多号场景），已有的不重复，新号追加 ' / ' 分隔 */
      var allPhones=val.match(/1[3-9]\d{9}/g);
      if(allPhones){
        for(var pi=0;pi<allPhones.length;pi++){
          var ph=allPhones[pi];
          if(!prop.ownerPhone){
            prop.ownerPhone=ph;
          }else if(prop.ownerPhone.indexOf(ph)<0){
            prop.ownerPhone=prop.ownerPhone+' / '+ph;
          }
        }
      }else if(val.replace(/[^0-9]/g,'').length>=5){
        var cleanPhone=val.replace(/[^0-9]/g,'');
        if(!prop.ownerPhone){
          prop.ownerPhone=cleanPhone;
        }else if(prop.ownerPhone.indexOf(cleanPhone)<0){
          prop.ownerPhone=prop.ownerPhone+' / '+cleanPhone;
        }
      }
      break;
    case'contactName':
      prop.contactName=val.replace(/[：:，,]/g,'');
      break;
    case'contactPhone':
      var cpn=val.match(/1[3-9]\d{9}/);
      if(cpn)prop.contactPhone=cpn[0];
      else if(val.replace(/[^0-9-]/g,'').length>=5)prop.contactPhone=val;
      break;
    case'commission':
      prop.commission=val;
      break;
    case'openingDate':
      prop.openingDate=val;
      break;
    case'deliveryDate':
      /* 兼容 Excel date serial number（如 46722 = 2027-12-01）和普通日期字符串 */
      if(/^\d{4,6}$/.test(val)){
        var sn=parseInt(val,10);
        if(sn>30000&&sn<80000){
          var d=new Date((sn-25569)*86400*1000);
          if(!isNaN(d.getTime())){
            prop.deliveryDate=d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
            break;
          }
        }
      }
      prop.deliveryDate=val;
      break;
    case'availableLayouts':
      prop.availableLayouts=val;
      break;
    case'totalUnits':
      prop.totalUnits=val.replace(/[^0-9]/g,'');
      break;
    case'greenRate':
      prop.greenRate=val;
      break;
    case'plotRatio':
      prop.plotRatio=val;
      break;
    case'propertyType':
      prop.propertyType=val;
      break;
    case'propertyFee':
      prop.propertyFee=val;
      break;
    case'businessDistrict':
      prop.businessDistrict=val;
      break;
    case'buildingAge':
      /* 值校验：建成年代必须是合理年份格式，不能是房号/地址等。
         合法的形式：4位数字年份(1900-2099)、"2018年"、"2018年建"、"约2018"等；
         拒绝：含"-"的房号(16-1704)、纯数字范围、地址格式等 */
      if(val){
        var ageOk=false;
        var yearMatch=val.match(/(\d{4})\s*年?建?/);
        if(yearMatch){
          var y=parseInt(yearMatch[1]);
          if(y>=1900&&y<=2099)ageOk=true;
        }
        /* 也接受"约2018"、"2018年左右"等模糊表达 */
        if(!ageOk&&/(\d{4})/.test(val)&&val.length<=15)ageOk=true;
        if(ageOk)prop.buildingAge=val;
      }
      break;
    case'propertyRights':
      prop.propertyRights=val;
      break;
    case'hasKey':
      prop.hasKey=val.indexOf('有')>=0||val==='1'||val===true;
      break;
    case'viewingMethod':
      prop.viewingMethod=val;
      break;
    /* 新楼盘：带看规则 → 独立字段 */
    case'viewingRule':
      prop.viewingRule=(prop.viewingRule?prop.viewingRule+'\n':'')+val;
      break;
    case'school':
      prop.school=val;
      break;
    case'metro':
      prop.metro=val;
      break;
    case'developer':
      prop.developer=val;
      break;
    case'status':
      var _stHit='';
      for(var i=0;i<PROP_STATUSES.length;i++){
        if(val.indexOf(PROP_STATUSES[i])>=0){_stHit=PROP_STATUSES[i];break}
      }
      if(_stHit)prop.status=_stHit;
      if(prop.type==='newdev'){
        /* 一手汇总表的「状态」列填的多是认购方式（直接下定/直接认购/摇号），不是房源状态：
           认购方式单独存 saleStatus，房源状态默认「在售」，含暂停/停售才置「暂缓」 */
        if(/下定|认购|摇号|排卡|登记|意向金|诚意金|开盘/.test(val))prop.saleStatus=String(val).trim();
        if(!_stHit)prop.status=/暂停|停止|停售|暂缓|待开/.test(val)?'暂缓':'在售';
      }
      break;
    case'description':
      _appendDesc('');
      break;
    /* 新楼盘：基本卖点 → 独立字段 */
    case'highlights':
      prop.highlights=(prop.highlights?prop.highlights+'\n':'')+val;
      break;
    /* 新楼盘：优惠政策 → 独立字段 */
    case'preferential':
      prop.preferential=(prop.preferential?prop.preferential+'\n':'')+val;
      break;
    /* 新楼盘：剩余房源 → 独立字段 + 标签 */
    case'remaining':
      prop.remaining=val;
      if(prop.tags.indexOf('剩余'+val)<0)prop.tags.push('剩余'+val);
      break;
    /* 新楼盘：项目标签（主推/新上/高性价比）→ 独立字段 + 标签 */
    case'projectTag':
      prop.projectTag=val;
      var tags=val.split(/[\/／、,，\s]+/).filter(function(x){return x});
      for(var pt=0;pt<tags.length;pt++){
        if(prop.tags.indexOf(tags[pt])<0)prop.tags.push(tags[pt]);
      }
      break;
    case'protectionPeriod':
      prop.protectionPeriod=(prop.protectionPeriod?prop.protectionPeriod+'\n':'')+val;
      break;
    case'tag':
      var tags=val.split(/[，,]/).filter(function(x){return x});
      for(var pt=0;pt<tags.length;pt++){
        if(prop.tags.indexOf(tags[pt])<0)prop.tags.push(tags[pt]);
      }
      break;
    case'building':
      prop.building=val.replace(/^[幢栋座号楼]*/,'').replace(/[幢栋座号楼]$/,'');
      break;
    case'unit':
      prop.unit=val;
      break;
    case'room':
      prop.room=val.replace(/^0*/,'').replace(/[室号]$/,'');
      if(!prop.room)prop.room=val;
      break;
  }
}

function autoDetectPropFields(prop,fields,rawLine){
  /* 字段白名单：根据 prop.type 严格控制哪些字段可以填，与 assignPropField 保持一致 */
  var NEWDEV_KEYS={title:1,district:1,developer:1,propertyType:1,availableLayouts:1,totalPrice:1,totalPriceText:1,averagePrice:1,averagePriceText:1,onSaleBuildings:1,additionalBuildings:1,additionalPrice:1,saleStatus:1,openingDate:1,deliveryDate:1,totalUnits:1,greenRate:1,plotRatio:1,contactName:1,contactPhone:1,commission:1,propertyFee:1,businessDistrict:1,projectTag:1,viewingRule:1,metro:1,highlights:1,preferential:1,remaining:1,protectionPeriod:1,decoration:1,address:1,community:1,description:1,tags:1,status:1,viewingMethod:1,school:1,building:1,unit:1,room:1};
  var SECONDHAND_KEYS={title:1,area:1,layout:1,totalPrice:1,unitPrice:1,averagePrice:1,floor:1,totalFloors:1,orientation:1,decoration:1,district:1,address:1,community:1,ownerName:1,ownerPhone:1,contactName:1,contactPhone:1,commission:1,hasKey:1,viewingMethod:1,school:1,metro:1,buildingAge:1,propertyRights:1,status:1,description:1,tags:1,building:1,unit:1,room:1};
  var allowKey=function(k){
    if(prop.type==='newdev')return !!NEWDEV_KEYS[k];
    if(prop.type==='secondhand')return !!SECONDHAND_KEYS[k];
    return true;  /* type 未确定时全部允许，等 autoDetectPropType 之后做最终判断 */
  };

  for(var i=0;i<fields.length;i++){
    var f=fields[i].trim();
    if(!f)continue;

    /* phone number — 提取所有号码，已有的不重复 */
    if(f.match(/1[3-9]\d{9}/)){
      if(allowKey('ownerPhone')){
        var detectedPhones=f.match(/1[3-9]\d{9}/g);
        for(var dpi=0;dpi<detectedPhones.length;dpi++){
          var dph=detectedPhones[dpi];
          if(!prop.ownerPhone){
            prop.ownerPhone=dph;
          }else if(prop.ownerPhone.indexOf(dph)<0){
            prop.ownerPhone=prop.ownerPhone+' / '+dph;
          }
        }
      }
      continue;
    }

    /* area: XX㎡ / XXm / XXm² / XXm2 / XXr4 / XX平方 / XX平米
       v6.30.x: OCR 常把面积单位识别成 "m"（122.25m）或错字 "r4"（96.02r4），需全部兼容 */
    if(f.match(/^\d+(\.\d+)?\s*(㎡|m²|m2|平方|平米|m|r4)$/i)){
      if(!allowKey('area'))continue;
      var ar=parseFloat(f.replace(/[^0-9.]/g,''));
      if(ar>0&&ar<10000){prop.area=ar;if(!prop.title&&prop.community)prop.title=prop.community+ar+'㎡';continue}
    }

    /* total price: XX万 or XXw — 排除纯整数序号(1~999且无小数点、无万单位) */
    if((f.match(/^\d+(\.\d+)?\s*万$/)||f.match(/^\d{2,4}w$/i))||(f.match(/^\d+$/)&&parseFloat(f)>=10&&parseFloat(f)<=50000&&fields.length<=3)){
      if(!allowKey('totalPrice'))continue;
      var tp=parseFloat(f.replace(/[^0-9.]/g,''));
      /* v6.35: 纯1-3位整数且字段>=4个时，很可能是序号而非总价，跳过 */
      if(/^\d{1,3}$/.test(f)&&fields.length>=4)/* skip sequence number */;
      else if(tp>0&&tp<100000){prop.totalPrice=tp;continue}
    }

    /* average price: XX元/㎡ or XXXXX */
    if(f.indexOf('元')>=0&&f.indexOf('㎡')>=0){
      if(!allowKey('averagePrice'))continue;
      var ap=parseInt(f.replace(/[^0-9]/g,''));
      if(ap>0)prop.averagePrice=ap;
      continue;
    }

    /* floor: X/Y层 */
    if(f.match(/^\d+\s*[\/／]\s*\d+/)||f.match(/^\d+层?$/)){
      if(!allowKey('floor'))continue;
      var fm=f.match(/(\d+)\s*[\/／]?\s*(\d+)?/);
      if(fm){prop.floor=fm[1];if(fm[2])prop.totalFloors=fm[2]}
      continue;
    }

    /* orientation */
    var orFound=false;
    for(var d=0;d<ORIENTATIONS.length;d++){
      if(f.indexOf(ORIENTATIONS[d])>=0){
        if(allowKey('orientation'))prop.orientation=ORIENTATIONS[d];
        orFound=true;break}
    }
    if(orFound)continue;

    /* decoration */
    var decoFound=false;
    for(var d=0;d<DECORATIONS.length;d++){
      if(f.indexOf(DECORATIONS[d])>=0){
        if(allowKey('decoration'))prop.decoration=DECORATIONS[d];
        decoFound=true;break}
    }
    if(decoFound)continue;

    /* district */
    var ar2=matchArea(f);
    if(ar2){
      if(!allowKey('district'))continue;
      prop.district=ar2;if(!prop.title&&!prop.community)prop.community=f;continue
    }

    /* layout: contains 室/厅 */
    if(f.indexOf('室')>=0||f.indexOf('厅')>=0||f.indexOf('居')>=0){
      if(!allowKey('layout'))continue;
      prop.layout=f;continue;
    }

    /* building age */
    var ageYearMatch=f.match(/(\d{4})\s*年?建?/);
    if((ageYearMatch&&parseInt(ageYearMatch[1])>=1900&&parseInt(ageYearMatch[1])<=2099)||f.indexOf('年代')>=0||f.indexOf('建成')>=0){
      if(!allowKey('buildingAge'))continue;
      /* 排除房号/地址格式（如16-1704），只接受合理的年份格式 */
      if(!/^\d+\s*[-—\/／]\s*\d+/.test(f)&&!/^\d+\s*[\/／]\s*\d+$/.test(f)){
        prop.buildingAge=f;continue;
      }
    }

    /* has key */
    if(f.indexOf('钥匙')>=0||f.indexOf('有钥匙')>=0){
      if(!allowKey('hasKey'))continue;
      prop.hasKey=true;continue;
    }

    /* status */
    var stFound=false;
    for(var d=0;d<PROP_STATUSES.length;d++){
      if(f.indexOf(PROP_STATUSES[d])>=0){
        if(allowKey('status'))prop.status=PROP_STATUSES[d];
        stFound=true;break}
    }
    if(stFound)continue;

    /* community/title: 2+ chars, likely Chinese */
    if(!prop.community&&f.length>=2&&f.match(/^[\u4e00-\u9fa5]/)){
      if(!allowKey('community'))continue;
      prop.community=f.replace(/[：:，,]/g,'');
      if(!prop.title)prop.title=f.replace(/[：:，,]/g,'');
      continue;
    }

    /* fallback to description */
    if(f.length>1){
      if(!allowKey('description'))continue;
      if(!prop.description)prop.description=f;
      else prop.description+=' '+f;
    }
  }
  /* 后处理：清理 community 字段（剥离尾部的楼幢/单元/房号数字）+ 单元默认值 */
  if(prop.community)prop.community=cleanCommunityName(prop.community);
  if(prop.title&&prop.community&&prop.title.indexOf(prop.community)===0&&prop.title!==prop.community){
    /* title 以 community 开头但更长，说明 title 也被污染了，重建 title */
    var _parts=[];
    if(prop.area)_parts.push(prop.area+'㎡');
    if(prop.layout)_parts.push(prop.layout);
    if(prop.building)_parts.push(prop.building+'幢');
    if(prop.room)_parts.push(prop.room);
    prop.title=prop.community+(_parts.length?' '+_parts.join(' '):'');
  }
  if((prop.type==='secondhand'||prop.type==='rental')&&!prop.unit)prop.unit='1单元';
}

function renderSmartPropPreview(props){
  var wrap=document.getElementById('smartPropPreviewWrap');
  var table=document.getElementById('smartPropPreviewTable');
  var count=document.getElementById('smartPropPreviewCount');

  if(!props||props.length===0){
    wrap.style.display='none';
    document.getElementById('smartPropParseHint').textContent='未识别到有效房源数据';
    document.getElementById('smartPropParseHint').style.color='var(--warning)';
    return;
  }

  /* 修复：识别成功必须把预览区显示出来（之前默认display:none没打开，导致"全部录入"按钮不见） */
  wrap.style.display='block';

  /* 统计重复项 */
  var dupCount=0;
  for(var di=0;di<props.length;di++){if(props[di]._duplicate)dupCount++}
  var dupBadge=dupCount>0?'<span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:3px;font-size:.8125rem;margin-left:8px">ℹ️ '+dupCount+' 条与已有房源匹配（地址相同），录入时将自动更新</span>':'';
  var includeDupHtml=dupCount>0?'<label style="margin-left:12px;font-size:.8125rem;cursor:pointer;display:flex;align-items:center;gap:4px"><input type="checkbox" id="smartIncludeDup"> 包含重复项</label>':'';
  count.innerHTML='共识别 <b>'+props.length+'</b> 条'+dupBadge+includeDupHtml;

  var html='<table><thead><tr>'+
    '<th style="width:30px">#</th>'+
    '<th>状态</th>'+
    '<th>标题/小区</th>'+
    '<th>面积</th>'+
    '<th>户型</th>'+
    '<th>总价(万)</th>'+
    '<th>楼层</th>'+
    '<th>业主电话</th>'+
    '<th>区域</th>'+
    '<th style="width:30px"></th>'+
    '</tr></thead><tbody>';

  /* v6.31 按小区分组：同一小区的房源聚在一起，头部显示套数，方便核对批量识别结果。
     注意：行仍带 data-idx 指回 S.smartProps 的原始下标，collectSmartProps 按 data-idx 取值，
     所以分组重排不会错位。 */
  var _groupOrder=[],_groupMap={};
  for(var gi=0;gi<props.length;gi++){
    var gk=(props[gi].community||props[gi].title||'未识别小区').trim()||'未识别小区';
    if(!_groupMap[gk]){_groupMap[gk]=[];_groupOrder.push(gk)}
    _groupMap[gk].push(gi);
  }
  var _useGroup=_groupOrder.length>1&&props.length>=3;
  var _flat=[];
  if(_useGroup){_groupOrder.forEach(function(k){_flat.push({g:k,n:_groupMap[k].length});_groupMap[k].forEach(function(ix){_flat.push({i:ix})})})}
  else{for(var fi=0;fi<props.length;fi++)_flat.push({i:fi})}

  for(var fk=0;fk<_flat.length;fk++){
    if(_flat[fk].g!==undefined){
      html+='<tr class="spv-group"><td colspan="10" style="background:var(--bg-secondary);font-weight:600;font-size:.8125rem;padding:6px 8px;color:var(--text-primary)">🏘️ '+esc(_flat[fk].g)+' <span style="font-weight:400;color:var(--text-secondary)">（'+_flat[fk].n+' 套）</span></td></tr>';
      continue;
    }
    var i=_flat[fk].i;
    var p=props[i];
    var hasTitle=!!p.title;
    var status=hasTitle?'<span class="spv-ok">✓</span>':'<span class="spv-warn">缺标题</span>';
    var dupTag=p._duplicate?'<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:.75rem;padding:1px 4px;border-radius:3px;margin-left:4px" title="已存在同名楼盘（ID: '+esc(p._duplicateId||'')+'）">⚠️ 重名</span>':'';
    var dupRowCls=p._duplicate?' style="background:#fffbeb"':'';
    var dupAttr=p._duplicate?' data-duplicate="1"':'';

    html+='<tr data-idx="'+i+'"'+dupAttr+dupRowCls+'>'+
      '<td style="text-align:center;color:var(--text-muted)">'+(i+1)+'</td>'+
      '<td style="text-align:center">'+status+dupTag+'</td>'+
      '<td><input type="text" data-field="title" value="'+esc(p.title)+'" placeholder="标题/小区"></td>'+
      '<td><input type="text" data-field="area" value="'+(p.area||'')+'" placeholder="㎡" style="width:50px"></td>'+
      '<td><input type="text" data-field="layout" value="'+esc(p.layout)+'" placeholder="户型" style="width:70px"></td>'+
      '<td><input type="text" data-field="totalPrice" value="'+(p.totalPrice||'')+'" placeholder="万" style="width:50px"></td>'+
      '<td><input type="text" data-field="floor" value="'+esc(p.floor)+'" placeholder="楼层" style="width:50px"></td>'+
      '<td><input type="text" data-field="ownerPhone" value="'+esc(p.ownerPhone)+'" placeholder="电话"></td>'+
      '<td><select data-field="district"><option value="">选择</option>'+_districtOpts(p.district)+'</select></td>'+
      '<td><span class="spv-del" data-del="'+i+'">×</span></td>'+
      '</tr>';
  }
  html+='</tbody></table>';
  table.innerHTML=html;

  /* "包含重复项"切换时实时刷新预览（仅刷新样式不影响行内容） */
  var includeDupEl=document.getElementById('smartIncludeDup');
  if(includeDupEl){
    includeDupEl.addEventListener('change',function(){
      var rows=document.querySelectorAll('#smartPropPreviewTable tbody tr');
      rows.forEach(function(r){
        if(r.getAttribute('data-duplicate')==='1'){
          r.style.display=includeDupEl.checked?'':'none';
        }
      });
    });
    /* 初始隐藏 */
    var dupRows=document.querySelectorAll('#smartPropPreviewTable tbody tr[data-duplicate="1"]');
    dupRows.forEach(function(r){r.style.display='none'});
  }

  table.querySelectorAll('.spv-del').forEach(function(el){
    el.addEventListener('click',function(){
      var idx=parseInt(el.getAttribute('data-del'));
      S.smartProps.splice(idx,1);
      renderSmartPropPreview(S.smartProps);
    });
  });
}

function collectSmartProps(){
  var rows=document.querySelectorAll('#smartPropPreviewTable tbody tr');
  var props=[];
  var includeDup=document.getElementById('smartIncludeDup')&&document.getElementById('smartIncludeDup').checked;
  rows.forEach(function(row){
    /* v6.31: 预览表按小区分组后 DOM 顺序 ≠ 数组顺序，必须用 data-idx 回指原始下标；
       分组标题行没有 data-idx，直接跳过 */
    if(!row.hasAttribute('data-idx'))return;
    var rowIdx=parseInt(row.getAttribute('data-idx'),10);
    /* 优先复用 S.smartProps 里已经识别出的完整数据（developer/commission/availableLayouts/deliveryDate/metro/propertyType/tags/description 等），
       然后用预览表里用户编辑过的字段覆盖（用户在表格里改了什么就用什么） */
    var src=(S.smartProps&&S.smartProps[rowIdx])||{};

    var title=row.querySelector('[data-field="title"]').value.trim()||src.title||'';
    var areaStr=row.querySelector('[data-field="area"]').value.trim();
    var layout=row.querySelector('[data-field="layout"]').value.trim();
    var priceStr=row.querySelector('[data-field="totalPrice"]').value.trim();
    var floor=row.querySelector('[data-field="floor"]').value.trim();
    var phone=row.querySelector('[data-field="ownerPhone"]').value.trim();
    var district=row.querySelector('[data-field="district"]').value;

    /* 重复项默认跳过，除非用户勾选"包含重复" */
    /* v6.35: 不再静默跳过重复项，全部返回由导入函数统一处理 */
    /* 保留 data-duplicate 属性供参考，但不 return */

    if(!title&&!phone&&!src.title&&!src.community)return;

    var fm=floor.match(/(\d+)\s*[\/／]?\s*(\d+)?/);
    var floorNum=fm?fm[1]:(src.floor||'');
    var totalFloors=fm&&fm[2]?fm[2]:(src.totalFloors||'');

    var out=Object.assign({},src);
    out.title=title||src.title||'未命名楼盘';
    out.community=src.community||out.title;
    out.type=src.type||S.subtab||'secondhand';
    out.area=parseFloat(areaStr)||src.area||0;
    out.layout=layout||src.layout||'';
    out.totalPrice=parseFloat(priceStr)||src.totalPrice||0;
    out.floor=floorNum;
    out.totalFloors=totalFloors;
    out.ownerPhone=(function(){
      var wpa=phone.match(/1[3-9]\d{9}/g);
      if(wpa&&wpa.length>0)return wpa.join(' / ');
      return phone||src.ownerPhone||'';
    })();
    out.district=district||src.district||'临平';
    out.status=src.status||'在售';
    out.tags=src.tags||[];
    out.description=src.description||'';
    /* 列表中没展示的字段：developer/commission/availableLayouts/deliveryDate/openingDate/propertyType/metro/contactName/contactPhone/highlights/带看规则等保留 */
    props.push(out);
  });
  return props;
}

function batchImportProps(){
  var props=collectSmartProps();
  if(props.length===0){toast('没有可录入的数据','error');return}

  /* 模式1: 更新单个楼盘 */
  if(S.smartPropMode==='single'&&S.smartPropTargetId){
    var target=findProp(S.smartPropTargetId);
    if(!target){toast('目标楼盘不存在','error');return}
    var src=props[0];
    var updated=[];
    var fieldMap=[
      ['title','title'],['community','community'],['developer','developer'],
      ['district','district'],['address','address'],['averagePrice','averagePrice'],
      ['propertyType','propertyType'],['openingDate','openingDate'],['deliveryDate','deliveryDate'],
      ['availableLayouts','availableLayouts'],['totalUnits','totalUnits'],['greenRate','greenRate'],
      ['plotRatio','plotRatio'],['contactName','contactName'],['contactPhone','contactPhone'],
      ['commission','commission'],['school','school'],['metro','metro'],
      ['orientation','orientation'],['decoration','decoration'],['status','status'],
      /* v6.37 新楼盘扩展字段 */
      ['businessDistrict','businessDistrict'],['totalPrice','totalPrice'],['totalPriceText','totalPriceText'],
      ['averagePriceText','averagePriceText'],['onSaleBuildings','onSaleBuildings'],
      ['additionalBuildings','additionalBuildings'],['additionalPrice','additionalPrice'],
      ['saleStatus','saleStatus'],['preferential','preferential'],['protectionPeriod','protectionPeriod'],
      ['viewingRule','viewingRule'],['highlights','highlights'],['remaining','remaining']
    ];
    for(var i=0;i<fieldMap.length;i++){
      var k=fieldMap[i][0];
      if(src[k]!==undefined&&src[k]!==''&&src[k]!==0){
        target[k]=src[k];
        updated.push(k);
      }
    }
    if(src.description&&!target.description){target.description=src.description;updated.push('description')}
    if(src.tags&&src.tags.length){
      target.tags=target.tags||[];
      for(var t=0;t<src.tags.length;t++){if(target.tags.indexOf(src.tags[t])<0)target.tags.push(src.tags[t])}
    }
    target.updatedAt=now();
    saveP();if(S.subtab==='community'&&S.communityDetail){renderCommunityDetail()}else if(S.subtab==='community'){renderCommunityList()}else{renderPropertyList()}
    var imgCount=S.smartImages.length;
    uploadSmartImagesToProp(target.id).then(function(n){
      if(S.curPropId===target.id){showPropertyDetail(target.id)}
      toast('已更新「'+target.title+'」的 '+updated.length+' 个字段'+(n>0?'，'+n+' 张图片已加入相册':''),'success');
    });
    closeModal('smartPropInputModal');
    return;
  }

  /* 模式2: 批量模式 — v6.35 智能查重 */
  var _cleanProp=function(p){
    delete p._rawLine;delete p._duplicate;delete p._duplicateId;
    delete p._origType;delete p._autoTypeSwitched;delete p._dupReason;
    return p;
  };

  /* Step 1: 构建已有房源的地址指纹索引 */
  var addrIndex={}; /* key="community|building|unit|room" -> prop */
  for(var ai=0;ai<S.properties.length;ai++){
    var ap=S.properties[ai];
    var ak=[ap.community||'',ap.building||'',ap.unit||'',ap.room||''].join('|');
    if(ak.replace(/|/g,'').length>2)addrIndex[ak]=ap;
  }
  /* 标题索引（新楼盘用）*/
  var titleIndex={};
  for(var ti=0;ti<S.properties.length;ti++){
    var tp=S.properties[ti];
    var tk=(tp.title||'').replace(/\s+/g,'').toLowerCase();
    if(tk)titleIndex[tk]=tp;
  }

  var imported=0,updated=0,skipped=0,dupDetails=[];
  for(var i=0;i<props.length;i++){
    var p=props[i];
    if(!p.title&&!p.community){skipped++;continue}
    var pType=p.type||S.subtab||'secondhand';
    var matched=null;
    var matchReason='';

    if(pType==='secondhand'||pType==='rental'||pType==='md'){
      /* 用地址指纹精确匹配；房源MD只与已有的 md 条目互去重，避免误匹配到已提拔的二手房/租赁房源 */
      var pk=[p.community||'',p.building||'',p.unit||'',p.room||''].join('|');
      var _cand=addrIndex[pk];
      if(pk.replace(/|/g,'').length>2&&_cand&&(pType!=='md'||_cand.type==='md')){matched=_cand;matchReason='地址相同('+p.community+' '+p.building+p.unit+p.room+')'}
    }else{
      /* 新楼盘用标题匹配 */
      var pt=(p.title||'').replace(/\s+/g,'').toLowerCase();
      if(pt&&titleIndex[pt]){matched=titleIndex[pt];matchReason='楼盘同名「'+p.title+'」'}
    }

    if(matched){
      /* 更新已有房源：有值才覆盖 */
      var fieldsToUpdate=['developer','averagePrice','propertyType','openingDate','deliveryDate',
        'availableLayouts','totalUnits','greenRate','plotRatio','contactName','contactPhone',
        'commission','district','address','school','metro','orientation','decoration','status',
        'totalPrice','area','layout','floor','totalFloors','ownerName','ownerPhone'];
      var changed=false;
      for(var f=0;f<fieldsToUpdate.length;f++){
        var key=fieldsToUpdate[f];
        if(p[key]!==undefined&&p[key]!==''&&p[key]!==0&&p[key]!=='—'){
          matched[key]=p[key];
          changed=true;
        }
      }
      if(p.tags&&p.tags.length){
        matched.tags=matched.tags||[];
        for(var tg=0;tg<p.tags.length;tg++){if(matched.tags.indexOf(p.tags[tg])<0)matched.tags.push(p.tags[tg])}
        changed=true;
      }
      if(p.description&&(!matched.description||p.description.length>matched.description.length)){
        matched.description=p.description;changed=true;
      }
      if(changed){matched.updatedAt=now();updated++}
      else{skipped++}
      dupDetails.push({action:'更新',title:p.title||p.community,reason:matchReason});
    }else{
      /* 新增 */
      if(p.area>0)p.unitPrice=p.totalPrice>0?Math.round(p.totalPrice*10000/p.area):0;
      p.id=uuid();p.createdAt=now();p.updatedAt=now();
      p.linkedClientIds=[];
      p.createdBy=S.currentUser?S.currentUser.id:'';
      p.createdByName=S.currentUser?S.currentUser.name:'';
      _cleanProp(p);
      S.properties.push(p);
      imported++;
    }
  }

  saveP();if(S.subtab==='community'&&S.communityDetail){renderCommunityDetail()}else if(S.subtab==='community'){renderCommunityList()}else{renderPropertyList()}  saveP();if(S.subtab==='community'&&S.communityDetail){renderCommunityDetail()}else if(S.subtab==='community'){renderCommunityList()}else{renderPropertyList()}
    /* 上传提取的图片到楼盘相册 */
    var imgCount=S.smartImages.length;
    uploadSmartImagesToProp(target.id).then(function(n){
      if(S.curPropId===target.id){showPropertyDetail(target.id)}
      toast('已更新「'+target.title+'」的 '+updated.length+' 个字段'+(n>0?'，'+n+' 张图片已加入相册':''),'success');
    });
    closeModal('smartPropInputModal');
    return;
  }

  /* 模式2: 批量模式 — 优先匹配更新已有楼盘，未匹配的新增 */
  /* 清理内部临时字段，避免污染 S.properties */
  var _cleanProp=function(p){
    delete p._rawLine;delete p._duplicate;delete p._duplicateId;
    delete p._origType;delete p._autoTypeSwitched;
    return p;
  };
  var imported=0,updated=0,skipped=0;
  for(var i=0;i<props.length;i++){
    var p=props[i];
    if(!p.title&&!p.community){skipped++;continue}

    /* 尝试匹配已有楼盘（按 title 或 community 模糊匹配） */
    var matched=null;
    for(var j=0;j<S.properties.length;j++){
      var ex=S.properties[j];
      /* 完全匹配 title */
      if(p.title&&ex.title===p.title){matched=ex;break}
      /* community 匹配且 type 相同 */
      if(p.community&&ex.community===p.community&&ex.type===(p.type||S.subtab)){matched=ex;break}
      /* 模糊匹配：title 包含 community 或 community 包含 title */
      if(p.title&&ex.community&&ex.community.indexOf(p.title)>=0){matched=ex;break}
      if(p.community&&ex.title&&ex.title.indexOf(p.community)>=0){matched=ex;break}
    }

    if(matched){
      /* 更新已有楼盘字段（只更新有值的新字段，特别是佣金） */
      var fieldsToUpdate=['developer','averagePrice','propertyType','openingDate','deliveryDate',
        'availableLayouts','totalUnits','greenRate','plotRatio','contactName','contactPhone',
        'commission','district','address','school','metro','orientation','decoration','status',
        'totalPrice','area','layout','floor','totalFloors','ownerName','ownerPhone'];
      var changed=false;
      for(var f=0;f<fieldsToUpdate.length;f++){
        var key=fieldsToUpdate[f];
        if(p[key]!==undefined&&p[key]!==''&&p[key]!==0&&p[key]!=='—'){
          matched[key]=p[key];
          changed=true;
        }
      }
      /* tags 合并 */
      if(p.tags&&p.tags.length){
        matched.tags=matched.tags||[];
        for(var tg=0;tg<p.tags.length;tg++){
          if(matched.tags.indexOf(p.tags[tg])<0)matched.tags.push(p.tags[tg]);
        }
        changed=true;
      }
      /* description 更新 */
      if(p.description&&(!matched.description||p.description.length>matched.description.length)){
        matched.description=p.description;
        changed=true;
      }
      if(changed){
        matched.updatedAt=now();
        updated++;
      }else{
        skipped++;
      }
    }else{
      /* 新增 */
      /* dedup: same title + phone sets overlap (subset/superset) → treat as duplicate */
      var dup=false;
      for(var d=0;d<S.properties.length;d++){
        var e=S.properties[d];
        if(e.title===p.title&&p.ownerPhone&&e.ownerPhone){
          var setA=e.ownerPhone.split(/\s*\/\s*/);
          var setB=p.ownerPhone.split(/\s*\/\s*/);
          var overlap=false;
          for(var sa=0;sa<setA.length;sa++){if(setB.indexOf(setA[sa])>=0){overlap=true;break}}
          if(overlap)dup=true;
        }
      }
      if(dup){skipped++;continue}

      if(p.area>0)p.unitPrice=p.totalPrice>0?Math.round(p.totalPrice*10000/p.area):0;
      p.id=uuid();p.createdAt=now();p.updatedAt=now();
      p.linkedClientIds=[];
      p.createdBy=S.currentUser?S.currentUser.id:'';
      p.createdByName=S.currentUser?S.currentUser.name:'';
      _cleanProp(p);
      S.properties.push(p);
      imported++;
    }
  }

  saveP();if(S.subtab==='community'&&S.communityDetail){renderCommunityDetail()}else if(S.subtab==='community'){renderCommunityList()}else{renderPropertyList()}
  /* 如果有提取的图片，上传到第一个新增/更新的楼盘 */
  var msg='';
  if(imported>0)msg+='新增 '+imported+' 个';
  if(updated>0)msg+=(msg?'，':'')+'更新 '+updated+' 个已有';
  if(skipped>0)msg+=(msg?'，':'')+'跳过 '+skipped+' 个（信息不全或无变化）';
  if(!msg)msg='没有变化';
  if(S.smartImages.length>0){
    /* 找到目标楼盘：优先第一个新增的，其次第一个更新的 */
    var targetProp=null;
    for(var pi=S.properties.length-1;pi>=0;pi--){
      if(S.properties[pi].type==='newdev'||S.properties[pi].type===S.subtab){targetProp=S.properties[pi];break}
    }
    if(targetProp){
      var imgN=S.smartImages.length;
      uploadSmartImagesToProp(targetProp.id).then(function(n){
        toast(msg+'，'+n+' 张图片已加入「'+targetProp.title+'」相册','success');
      });
    }else{
      S.smartImages=[];renderSmartImageGallery();
      toast(msg,'success');
    }
  }else{
    toast(msg,'success');
  }
  closeModal('smartPropInputModal');
}

/* 修复(parseSmartProp括号错位导致函数被吞): 以下两函数在 IIFE 顶层重新定义，确保全局可访问 */
window.autoDetectPropType=function(results){
  /* 用户明确要求"新楼盘和二手房绝对不能交叉录入"。
     type 在 parseSmartProp 里已经按当前 tab 锁定，这里**不再修改任何 prop.type**，
     只做字段特征统计，供上层判断"用户上传的内容是否和当前 tab 匹配"，便于提示。 */
  var newdevSignals=['developer','commission','deliveryDate','availableLayouts','propertyType','projectTag','businessDistrict','viewingRule','protectionPeriod','remaining','highlights','preferential','propertyFee','openingDate','totalUnits','greenRate','plotRatio','averagePrice'];
  var secondhandSignals=['ownerPhone','ownerName','floor','orientation','hasKey','buildingAge','propertyRights','area','layout','unitPrice','totalFloors'];
  var stats={newdev:0,secondhand:0,mismatch:0,typeMismatch:false};
  for(var i=0;i<results.length;i++){
    var p=results[i];
    var newScore=0,secScore=0;
    for(var k=0;k<newdevSignals.length;k++){if(p[newdevSignals[k]])newScore++;}
    for(var k2=0;k2<secondhandSignals.length;k2++){if(p[secondhandSignals[k2]])secScore++;}
    if(p.type==='newdev'){
      stats.newdev++;
      /* 检查是否含有大量二手特征字段 → 标记 mismatch 提示 */
      if(secScore>newScore+2)stats.mismatch++;
    }else if(p.type==='secondhand'){
      stats.secondhand++;
      if(newScore>secScore+2)stats.mismatch++;
    }
  }
  stats.typeMismatch=stats.mismatch>0;
  return stats;
}


window.batchImportProps=function(){
  var props=collectSmartProps();
  if(props.length===0){toast('没有可录入的数据','error');return}

  /* 模式1: 更新单个楼盘 */
  if(S.smartPropMode==='single'&&S.smartPropTargetId){
    var target=findProp(S.smartPropTargetId);
    if(!target){toast('目标楼盘不存在','error');return}
    var src=props[0];
    var updated=[];
    var fieldMap=[
      ['title','title'],['community','community'],['developer','developer'],
      ['district','district'],['address','address'],['averagePrice','averagePrice'],
      ['propertyType','propertyType'],['openingDate','openingDate'],['deliveryDate','deliveryDate'],
      ['availableLayouts','availableLayouts'],['totalUnits','totalUnits'],['greenRate','greenRate'],
      ['plotRatio','plotRatio'],['contactName','contactName'],['contactPhone','contactPhone'],
      ['commission','commission'],['school','school'],['metro','metro'],
      ['orientation','orientation'],['decoration','decoration'],['status','status'],
      /* v6.37 新楼盘扩展字段 */
      ['businessDistrict','businessDistrict'],['totalPrice','totalPrice'],['totalPriceText','totalPriceText'],
      ['averagePriceText','averagePriceText'],['onSaleBuildings','onSaleBuildings'],
      ['additionalBuildings','additionalBuildings'],['additionalPrice','additionalPrice'],
      ['saleStatus','saleStatus'],['preferential','preferential'],['protectionPeriod','protectionPeriod'],
      ['viewingRule','viewingRule'],['highlights','highlights'],['remaining','remaining']
    ];
    for(var i=0;i<fieldMap.length;i++){
      var k=fieldMap[i][0];
      if(src[k]!==undefined&&src[k]!==''&&src[k]!==0){
        target[k]=src[k];
        updated.push(k);
      }
    }
    if(src.description&&!target.description){target.description=src.description;updated.push('description')}
    if(src.tags&&src.tags.length){
      target.tags=target.tags||[];
      for(var t=0;t<src.tags.length;t++){if(target.tags.indexOf(src.tags[t])<0)target.tags.push(src.tags[t])}
    }
    target.updatedAt=now();
    saveP();if(S.subtab==='community'&&S.communityDetail){renderCommunityDetail()}else if(S.subtab==='community'){renderCommunityList()}else{renderPropertyList()}
    var imgCount=S.smartImages.length;
    uploadSmartImagesToProp(target.id).then(function(n){
      if(S.curPropId===target.id){showPropertyDetail(target.id)}
      toast('已更新「'+target.title+'」的 '+updated.length+' 个字段'+(n>0?'，'+n+' 张图片已加入相册':''),'success');
    });
    closeModal('smartPropInputModal');
    return;
  }

  /* 模式2: 批量模式 — v6.35 智能查重 */
  var _cleanProp=function(p){
    delete p._rawLine;delete p._duplicate;delete p._duplicateId;
    delete p._origType;delete p._autoTypeSwitched;delete p._dupReason;
    return p;
  };

  /* Step 1: 构建已有房源的地址指纹索引 */
  var addrIndex={}; /* key="community|building|unit|room" -> prop */
  for(var ai=0;ai<S.properties.length;ai++){
    var ap=S.properties[ai];
    var ak=[ap.community||'',ap.building||'',ap.unit||'',ap.room||''].join('|');
    if(ak.replace(/|/g,'').length>2)addrIndex[ak]=ap;
  }
  /* 标题索引（新楼盘用）*/
  var titleIndex={};
  for(var ti=0;ti<S.properties.length;ti++){
    var tp=S.properties[ti];
    var tk=(tp.title||'').replace(/\s+/g,'').toLowerCase();
    if(tk)titleIndex[tk]=tp;
  }

  var imported=0,updated=0,skipped=0,dupDetails=[];
  for(var i=0;i<props.length;i++){
    var p=props[i];
    if(!p.title&&!p.community){skipped++;continue}
    var pType=p.type||S.subtab||'secondhand';
    var matched=null;
    var matchReason='';

    if(pType==='secondhand'||pType==='rental'){
      /* 用地址指纹精确匹配 */
      var pk=[p.community||'',p.building||'',p.unit||'',p.room||''].join('|');
      if(pk.replace(/|/g,'').length>2&&addrIndex[pk]){matched=addrIndex[pk];matchReason='地址相同('+p.community+' '+p.building+p.unit+p.room+')'}
    }else{
      /* 新楼盘用标题匹配 */
      var pt=(p.title||'').replace(/\s+/g,'').toLowerCase();
      if(pt&&titleIndex[pt]){matched=titleIndex[pt];matchReason='楼盘同名「'+p.title+'」'}
    }

    if(matched){
      /* 更新已有房源：有值才覆盖 */
      var fieldsToUpdate=['developer','averagePrice','propertyType','openingDate','deliveryDate',
        'availableLayouts','totalUnits','greenRate','plotRatio','contactName','contactPhone',
        'commission','district','address','school','metro','orientation','decoration','status',
        'totalPrice','area','layout','floor','totalFloors','ownerName','ownerPhone'];
      var changed=false;
      for(var f=0;f<fieldsToUpdate.length;f++){
        var key=fieldsToUpdate[f];
        if(p[key]!==undefined&&p[key]!==''&&p[key]!==0&&p[key]!=='—'){
          matched[key]=p[key];
          changed=true;
        }
      }
      if(p.tags&&p.tags.length){
        matched.tags=matched.tags||[];
        for(var tg=0;tg<p.tags.length;tg++){if(matched.tags.indexOf(p.tags[tg])<0)matched.tags.push(p.tags[tg])}
        changed=true;
      }
      if(p.description&&(!matched.description||p.description.length>matched.description.length)){
        matched.description=p.description;changed=true;
      }
      if(changed){matched.updatedAt=now();updated++}
      else{skipped++}
      dupDetails.push({action:'更新',title:p.title||p.community,reason:matchReason});
    }else{
      /* 新增 */
      if(p.area>0)p.unitPrice=p.totalPrice>0?Math.round(p.totalPrice*10000/p.area):0;
      p.id=uuid();p.createdAt=now();p.updatedAt=now();
      p.linkedClientIds=[];
      p.createdBy=S.currentUser?S.currentUser.id:'';
      p.createdByName=S.currentUser?S.currentUser.name:'';
      _cleanProp(p);
      S.properties.push(p);
      imported++;
    }
  }

  saveP();if(S.subtab==='community'&&S.communityDetail){renderCommunityDetail()}else if(S.subtab==='community'){renderCommunityList()}else{renderPropertyList()}
  toast('录入完成：新增 '+imported+' 套，更新 '+updated+' 套'+(skipped>0?'，跳过 '+skipped+' 套':''),'success');
  closeModal('smartPropInputModal');
}


/* 同上修复: renderSmartPropPreview 也被 parseSmartProp 括号错位吞入, 此处重新定义 */
window.renderSmartPropPreview=function(props){
  var wrap=document.getElementById('smartPropPreviewWrap');
  var table=document.getElementById('smartPropPreviewTable');
  var count=document.getElementById('smartPropPreviewCount');

  if(!props||props.length===0){
    wrap.style.display='none';
    document.getElementById('smartPropParseHint').textContent='未识别到有效房源数据';
    document.getElementById('smartPropParseHint').style.color='var(--warning)';
    return;
  }

  /* 修复：识别成功必须把预览区显示出来（之前默认display:none没打开，导致"全部录入"按钮不见） */
  wrap.style.display='block';

  /* 统计重复项 */
  var dupCount=0;
  for(var di=0;di<props.length;di++){if(props[di]._duplicate)dupCount++}
  var dupBadge=dupCount>0?'<span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:3px;font-size:.8125rem;margin-left:8px">ℹ️ '+dupCount+' 条与已有房源匹配（地址相同），录入时将自动更新</span>':'';
  var includeDupHtml=dupCount>0?'<label style="margin-left:12px;font-size:.8125rem;cursor:pointer;display:flex;align-items:center;gap:4px"><input type="checkbox" id="smartIncludeDup"> 包含重复项</label>':'';
  count.innerHTML='共识别 <b>'+props.length+'</b> 条'+dupBadge+includeDupHtml;

  var html='<table><thead><tr>'+
    '<th style="width:30px">#</th>'+
    '<th>状态</th>'+
    '<th>标题/小区</th>'+
    '<th>面积</th>'+
    '<th>户型</th>'+
    '<th>总价(万)</th>'+
    '<th>楼层</th>'+
    '<th>业主电话</th>'+
    '<th>区域</th>'+
    '<th style="width:30px"></th>'+
    '</tr></thead><tbody>';

  /* v6.31 按小区分组：同一小区的房源聚在一起，头部显示套数，方便核对批量识别结果。
     注意：行仍带 data-idx 指回 S.smartProps 的原始下标，collectSmartProps 按 data-idx 取值，
     所以分组重排不会错位。 */
  var _groupOrder=[],_groupMap={};
  for(var gi=0;gi<props.length;gi++){
    var gk=(props[gi].community||props[gi].title||'未识别小区').trim()||'未识别小区';
    if(!_groupMap[gk]){_groupMap[gk]=[];_groupOrder.push(gk)}
    _groupMap[gk].push(gi);
  }
  var _useGroup=_groupOrder.length>1&&props.length>=3;
  var _flat=[];
  if(_useGroup){_groupOrder.forEach(function(k){_flat.push({g:k,n:_groupMap[k].length});_groupMap[k].forEach(function(ix){_flat.push({i:ix})})})}
  else{for(var fi=0;fi<props.length;fi++)_flat.push({i:fi})}

  for(var fk=0;fk<_flat.length;fk++){
    if(_flat[fk].g!==undefined){
      html+='<tr class="spv-group"><td colspan="10" style="background:var(--bg-secondary);font-weight:600;font-size:.8125rem;padding:6px 8px;color:var(--text-primary)">🏘️ '+esc(_flat[fk].g)+' <span style="font-weight:400;color:var(--text-secondary)">（'+_flat[fk].n+' 套）</span></td></tr>';
      continue;
    }
    var i=_flat[fk].i;
    var p=props[i];
    var hasTitle=!!p.title;
    var status=hasTitle?'<span class="spv-ok">✓</span>':'<span class="spv-warn">缺标题</span>';
    var dupTag=p._duplicate?'<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:.75rem;padding:1px 4px;border-radius:3px;margin-left:4px" title="已存在同名楼盘（ID: '+esc(p._duplicateId||'')+'）">⚠️ 重名</span>':'';
    var dupRowCls=p._duplicate?' style="background:#fffbeb"':'';
    var dupAttr=p._duplicate?' data-duplicate="1"':'';

    html+='<tr data-idx="'+i+'"'+dupAttr+dupRowCls+'>'+
      '<td style="text-align:center;color:var(--text-muted)">'+(i+1)+'</td>'+
      '<td style="text-align:center">'+status+dupTag+'</td>'+
      '<td><input type="text" data-field="title" value="'+esc(p.title)+'" placeholder="标题/小区"></td>'+
      '<td><input type="text" data-field="area" value="'+(p.area||'')+'" placeholder="㎡" style="width:50px"></td>'+
      '<td><input type="text" data-field="layout" value="'+esc(p.layout)+'" placeholder="户型" style="width:70px"></td>'+
      '<td><input type="text" data-field="totalPrice" value="'+(p.totalPrice||'')+'" placeholder="万" style="width:50px"></td>'+
      '<td><input type="text" data-field="floor" value="'+esc(p.floor)+'" placeholder="楼层" style="width:50px"></td>'+
      '<td><input type="text" data-field="ownerPhone" value="'+esc(p.ownerPhone)+'" placeholder="电话"></td>'+
      '<td><select data-field="district"><option value="">选择</option>'+_districtOpts(p.district)+'</select></td>'+
      '<td><span class="spv-del" data-del="'+i+'">×</span></td>'+
      '</tr>';
  }
  html+='</tbody></table>';
  table.innerHTML=html;

  /* "包含重复项"切换时实时刷新预览（仅刷新样式不影响行内容） */
  var includeDupEl=document.getElementById('smartIncludeDup');
  if(includeDupEl){
    includeDupEl.addEventListener('change',function(){
      var rows=document.querySelectorAll('#smartPropPreviewTable tbody tr');
      rows.forEach(function(r){
        if(r.getAttribute('data-duplicate')==='1'){
          r.style.display=includeDupEl.checked?'':'none';
        }
      });
    });
    /* 初始隐藏 */
    var dupRows=document.querySelectorAll('#smartPropPreviewTable tbody tr[data-duplicate="1"]');
    dupRows.forEach(function(r){r.style.display='none'});
  }

  table.querySelectorAll('.spv-del').forEach(function(el){
    el.addEventListener('click',function(){
      var idx=parseInt(el.getAttribute('data-del'));
      S.smartProps.splice(idx,1);
      renderSmartPropPreview(S.smartProps);
    });
  });
}

/* 同上修复: collectSmartProps 也被 parseSmartProp 括号错位吞入, 此处重新定义 */
window.collectSmartProps=function(){
  var rows=document.querySelectorAll('#smartPropPreviewTable tbody tr');
  var props=[];
  var includeDup=document.getElementById('smartIncludeDup')&&document.getElementById('smartIncludeDup').checked;
  rows.forEach(function(row){
    /* v6.31: 预览表按小区分组后 DOM 顺序 ≠ 数组顺序，必须用 data-idx 回指原始下标；
       分组标题行没有 data-idx，直接跳过 */
    if(!row.hasAttribute('data-idx'))return;
    var rowIdx=parseInt(row.getAttribute('data-idx'),10);
    /* 优先复用 S.smartProps 里已经识别出的完整数据（developer/commission/availableLayouts/deliveryDate/metro/propertyType/tags/description 等），
       然后用预览表里用户编辑过的字段覆盖（用户在表格里改了什么就用什么） */
    var src=(S.smartProps&&S.smartProps[rowIdx])||{};

    var title=row.querySelector('[data-field="title"]').value.trim()||src.title||'';
    var areaStr=row.querySelector('[data-field="area"]').value.trim();
    var layout=row.querySelector('[data-field="layout"]').value.trim();
    var priceStr=row.querySelector('[data-field="totalPrice"]').value.trim();
    var floor=row.querySelector('[data-field="floor"]').value.trim();
    var phone=row.querySelector('[data-field="ownerPhone"]').value.trim();
    var district=row.querySelector('[data-field="district"]').value;

    /* 重复项默认跳过，除非用户勾选"包含重复" */
    /* v6.35: 不再静默跳过重复项，全部返回由导入函数统一处理 */
    /* 保留 data-duplicate 属性供参考，但不 return */

    if(!title&&!phone&&!src.title&&!src.community)return;

    var fm=floor.match(/(\d+)\s*[\/／]?\s*(\d+)?/);
    var floorNum=fm?fm[1]:(src.floor||'');
    var totalFloors=fm&&fm[2]?fm[2]:(src.totalFloors||'');

    var out=Object.assign({},src);
    out.title=title||src.title||'未命名楼盘';
    out.community=src.community||out.title;
    out.type=src.type||S.subtab||'secondhand';
    out.area=parseFloat(areaStr)||src.area||0;
    out.layout=layout||src.layout||'';
    out.totalPrice=parseFloat(priceStr)||src.totalPrice||0;
    out.floor=floorNum;
    out.totalFloors=totalFloors;
    out.ownerPhone=(function(){
      var wpa=phone.match(/1[3-9]\d{9}/g);
      if(wpa&&wpa.length>0)return wpa.join(' / ');
      return phone||src.ownerPhone||'';
    })();
    out.district=district||src.district||'临平';
    out.status=src.status||'在售';
    out.tags=src.tags||[];
    out.description=src.description||'';
    /* 列表中没展示的字段：developer/commission/availableLayouts/deliveryDate/openingDate/propertyType/metro/contactName/contactPhone/highlights/带看规则等保留 */
    props.push(out);
  });
  return props;
}


/* ========== File Upload & Recognition ========== */
function handleSmartFileUpload(file,targetId){
  var hintEl=document.getElementById(targetId);
  var isClient=targetId.indexOf('Prop')<0;
  var textareaId=isClient?'smartInputArea':'smartPropArea';

  if(!file){return}
  var name=file.name.toLowerCase();
  var ext=name.split('.').pop();

  if(ext==='xlsx'||ext==='xls'){
    /* use SheetJS from CDN */
    hintEl.textContent='正在解析Excel文件...';hintEl.style.color='var(--warning)';
    loadSheetJS().then(function(){
      var reader=new FileReader();
      reader.onload=function(e){
        try{
          var data=new Uint8Array(e.target.result);
          var wb=XLSX.read(data,{type:'array'});
          var sheets=wb.SheetNames;
          var allText='';
          for(var s=0;s<sheets.length;s++){
            var ws=wb.Sheets[sheets[s]];
            /* 用 sheet_to_json 直接拿二维数组（避免 sheet_to_csv 把单元格内换行展开成多行），
               每个 cell 把 换行/制表符 替换为占位符 \u0001（按行循环不会被切碎） */
            var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,blankrows:false});
            /* 关键修复：每个Sheet前插入一个 sheet 边界标记 `# sheet: <名称>`，
               让 parseSmartProp 能识别 Sheet 边界，每个 Sheet 独立解析表头，
               避免 Sheet1 的 16 列表头被错用到 Sheet2 的 13 列数据上 */
            if(s>0)allText+='\n';
            allText+='# sheet: '+sheets[s]+'\n';
            var lines=[];
            for(var r=0;r<rows.length;r++){
              var row=rows[r]||[];
              var cells=[];
              for(var ci=0;ci<row.length;ci++){
                var v=row[ci];
                v=(v==null?'':String(v));
                /* 关键：把单元格内的 \r \n \t 全部替换为占位符，避免被当作字段/行分隔 */
                v=v.replace(/[\r\n\t]/g,'\u0001');
                cells.push(v);
              }
              lines.push(cells.join('\t'));
            }
            allText+=lines.join('\n')+'\n';
          }
          var ta=document.getElementById(textareaId);
          ta.value=(ta.value?ta.value+'\n':'')+allText;
          hintEl.textContent='Excel解析完成，共'+sheets.length+'个工作表，请点击「识别数据」';hintEl.style.color='var(--success)';
        }catch(err){
          hintEl.textContent='Excel解析失败：'+err.message;hintEl.style.color='var(--danger)';
        }
      };
      reader.readAsArrayBuffer(file);
    }).catch(function(){
      hintEl.textContent='Excel解析库加载失败，请重试或直接粘贴';hintEl.style.color='var(--danger)';
    });
  }else if(ext==='csv'||ext==='txt'){
    hintEl.textContent='正在读取文件...';hintEl.style.color='var(--warning)';
    var reader=new FileReader();
    reader.onload=function(e){
      var text=e.target.result;
      var ta=document.getElementById(textareaId);
      ta.value=(ta.value?ta.value+'\n':'')+text;
      hintEl.textContent='文件读取完成，请点击「识别数据」';hintEl.style.color='var(--success)';
    };
    reader.readAsText(file);
  }else if(ext==='png'||ext==='jpg'||ext==='jpeg'||ext==='webp'||ext==='bmp'||ext==='heic'){
    /* v6.31 批量图片：交给串行队列，绝不并发（并发会让多张图的文本交叉插入，字段串行错乱） */
    enqueueOcrFile(file,hintEl,textareaId,isClient);
  }else{
    hintEl.textContent='不支持的文件格式，请上传Excel/CSV/TXT/PNG/JPG';hintEl.style.color='var(--danger)';
  }
}

/* v6.35 全局文件上传封装（内联onclick兜底） */
window.triggerSmartPropFileUpload=function(){
  document.getElementById('smartPropFileInput').click();
};
window.triggerSmartClientFileUpload=function(){
  document.getElementById('smartFileInput').click();
};
/* 文件change事件：确保即使addEventListener失效也能工作 */
window.handleSmartPropFileChange=function(e){
  var files=Array.from(e.target.files||[]);
  files.forEach(function(f){handleSmartFileUpload(f,'smartPropFileHint')});
  e.target.value='';
};
window.handleSmartClientFileChange=function(e){
  var files=Array.from(e.target.files||[]);
  files.forEach(function(f){handleSmartFileUpload(f,'smartFileHint')});
  e.target.value='';
};

/* ============================================================
   批量图片 OCR 串行队列（v6.31）
   ------------------------------------------------------------
   原实现对多张图并发调用 worker.recognize，Tesseract 单 worker 会把请求排队，
   但回调顺序不可控 → 多张图的文字交叉写进同一个 textarea，
   同一张卡片的字段被别的图片截断，"顺序邻近合并"算法直接失效
   （典型症状：一次传 10 张卡片图，只识别出 1~2 条房源）。
   现改为严格串行：一张识别完再下一张，每张前插入 "# img: 文件名" 边界，
   解析层遇到边界硬断开，保证「一张图 = 一条（或一组）独立记录」。
   ============================================================ */
var _ocrQueue=[],_ocrRunning=false,_ocrDone=0,_ocrTotal=0,_ocrFail=0,_ocrHintEl=null;
function _ocrSay(msg,color){
  if(!_ocrHintEl)return;
  _ocrHintEl.textContent=msg;
  _ocrHintEl.style.color=color||'var(--warning)';
}
function enqueueOcrFile(file,hintEl,textareaId,isClient){
  _ocrQueue.push({file:file,textareaId:textareaId,isClient:isClient});
  _ocrTotal++;_ocrHintEl=hintEl||_ocrHintEl;
  _ocrSay('🖼️ 已排队 '+_ocrTotal+' 张图片，正在逐张识别（首次加载引擎约 10-30 秒）…');
  if(!_ocrRunning){_ocrRunning=true;_ocrRunNext()}
}
function _ocrRunNext(){
  if(_ocrQueue.length===0){
    _ocrRunning=false;
    var okN=_ocrDone-_ocrFail;
    if(_ocrDone>0){
      _ocrSay('✅ 识别完成：成功 '+okN+' 张'+(_ocrFail?('，失败 '+_ocrFail+' 张'):'')+'，请点击「识别数据」',_ocrFail?'var(--warning)':'var(--success)');
    }
    _ocrDone=0;_ocrTotal=0;_ocrFail=0;
    return;
  }
  var job=_ocrQueue.shift();
  var idx=_ocrDone+1;
  _ocrSay('🖼️ 正在识别第 '+idx+'/'+_ocrTotal+' 张：'+job.file.name+(_ocrQueue.length?('（还剩 '+_ocrQueue.length+' 张）'):''));
  /* 房源模式：同步把图片压缩后加入相册 */
  if(!job.isClient){
    try{compressImage(job.file,1200,0.7,function(dataUrl){addSmartImage(dataUrl,job.file.name,'相册')})}catch(e){}
  }
  loadTesseract().then(function(worker){
    return worker.recognize(job.file);
  }).then(function(result){
    var text=(result&&result.data&&result.data.text)||'';
    text=text.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
    var ta=document.getElementById(job.textareaId);
    if(ta){
      ta.value=(ta.value?ta.value+'\n':'')+'# img: '+job.file.name+'\n'+(text||'（未提取到文字）');
      ta.scrollTop=ta.scrollHeight;
    }
    if(!text)_ocrFail++;
    _ocrDone++;
    _ocrRunNext();
  }).catch(function(err){
    console.error('[OCR]',job.file.name,err);
    var ta=document.getElementById(job.textareaId);
    if(ta)ta.value=(ta.value?ta.value+'\n':'')+'# img: '+job.file.name+'\n（识别失败：'+((err&&err.message)||err)+'）';
    _ocrFail++;_ocrDone++;
    _ocrRunNext();
  });
}

function loadSheetJS(){
  return new Promise(function(resolve,reject){
    if(window.XLSX){resolve();return}
    var script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload=function(){resolve()};
    script.onerror=function(){reject(new Error('load failed'))};
    document.head.appendChild(script);
  });
}

/* OCR worker 缓存：避免每次识别都重新加载语言模型 */
var _ocrWorker=null;
var _ocrLoading=null;

function loadTesseract(){
  /* 已经创建过 worker，直接复用 */
  if(_ocrWorker)return Promise.resolve(_ocrWorker);
  /* 正在加载中，复用同一个 Promise */
  if(_ocrLoading)return _ocrLoading;

  _ocrLoading=new Promise(function(resolve,reject){
    /* 已经载入 Tesseract v5 全局，直接创建 worker */
    if(window.Tesseract&&window.Tesseract.createWorker){
      window.Tesseract.createWorker('chi_sim+eng',1,{
        logger:function(m){
          if(m&&m.status){
            /* 可以在这里更新进度提示 */
            console.log('[OCR]',m.status,m.progress);
          }
        }
      }).then(function(w){_ocrWorker=w;resolve(w)}).catch(function(e){_ocrLoading=null;reject(e)});
      return;
    }
    /* 加载脚本：jsdelivr 优先，失败回退 unpkg */
    var cdns=[
      'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/tesseract.min.js',
      'https://unpkg.com/tesseract.js@5.0.4/dist/tesseract.min.js'
    ];
    var idx=0;
    function tryLoad(){
      if(idx>=cdns.length){_ocrLoading=null;reject(new Error('所有CDN都加载失败，请检查网络'));return}
      var script=document.createElement('script');
      script.src=cdns[idx++];
      script.onload=function(){
        if(window.Tesseract&&window.Tesseract.createWorker){
          /* 创建 worker（首次加载语言模型约需10-30秒） */
          window.Tesseract.createWorker('chi_sim+eng',1,{
            logger:function(m){/* console.log('[OCR]',m) */}
          }).then(function(w){_ocrWorker=w;resolve(w)}).catch(function(e){_ocrLoading=null;reject(e)});
        }else{
          _ocrLoading=null;
          reject(new Error('Tesseract加载完成但createWorker不可用'));
        }
      };
      script.onerror=function(){tryLoad()};
      document.head.appendChild(script);
    }
    tryLoad();
  });
  return _ocrLoading;
}

/* ========== Smart Image Extraction (粘贴图片/截图/公众号图片) ========== */
function addSmartImage(dataUrl,name,category){
  if(!dataUrl)return;
  /* 去重：同一 dataUrl 不重复添加 */
  for(var i=0;i<S.smartImages.length;i++){
    if(S.smartImages[i].dataUrl===dataUrl)return;
  }
  S.smartImages.push({dataUrl:dataUrl,name:name||('image_'+(S.smartImages.length+1)),category:category||'相册'});
  renderSmartImageGallery();
}
function guessImageCategory(text){
  if(!text)return '相册';
  var t=text.toLowerCase();
  if(t.indexOf('户型')>=0)return '户型图';
  if(t.indexOf('楼栋')>=0||t.indexOf('分布')>=0||t.indexOf('总平')>=0)return '楼栋分布图';
  if(t.indexOf('效果')>=0)return '效果图';
  if(t.indexOf('实景')>=0||t.indexOf('现场')>=0)return '实景图';
  if(t.indexOf('沙盘')>=0)return '沙盘图';
  if(t.indexOf('配套')>=0||t.indexOf('区位')>=0||t.indexOf('位置')>=0)return '区位图';
  return '相册';
}
function renderSmartImageGallery(){
  var gallery=document.getElementById('smartImageGallery');
  if(!gallery)return;
  if(S.smartImages.length===0){gallery.style.display='none';return}
  gallery.style.display='';
  document.getElementById('smartImgCount').textContent=S.smartImages.length+' 张';
  var list=document.getElementById('smartImageList');
  var cats=['相册','效果图','户型图','楼栋分布图','实景图','沙盘图','区位图'];
  list.innerHTML=S.smartImages.map(function(img,idx){
    var opts=cats.map(function(c){return'<option value="'+c+'"'+(img.category===c?' selected':'')+'>'+c+'</option>'}).join('');
    return'<div class="smart-image-item">'
      +'<img src="'+img.dataUrl+'" loading="lazy" data-idx="'+idx+'">'
      +'<select class="smart-img-cat" data-idx="'+idx+'">'+opts+'</select>'
      +'<button class="smart-img-del" data-idx="'+idx+'">×</button>'
      +'</div>';
  }).join('');
  list.querySelectorAll('.smart-img-cat').forEach(function(sel){
    sel.addEventListener('change',function(){
      S.smartImages[parseInt(this.getAttribute('data-idx'))].category=this.value;
    });
  });
  list.querySelectorAll('.smart-img-del').forEach(function(btn){
    btn.addEventListener('click',function(){
      S.smartImages.splice(parseInt(this.getAttribute('data-idx')),1);
      renderSmartImageGallery();
    });
  });
  list.querySelectorAll('.smart-image-item img').forEach(function(im){
    im.addEventListener('click',function(){
      openLightbox(S.smartImages.map(function(x){return{type:'image',dataUrl:x.dataUrl,name:x.name}}),parseInt(this.getAttribute('data-idx')));
    });
  });
}
function extractImagesFromHtml(html){
  /* 从粘贴的HTML中提取图片URL，通过后端代理获取 */
  var imgRegex=/<img[^>]+src=["']([^"']+)["']/gi;
  var altRegex=/<img[^>]+alt=["']([^"']*)["']/gi;
  var urls=[],alts=[],match;
  while((match=imgRegex.exec(html))!==null){
    var src=match[1];
    if(src.startsWith('http')&&!src.includes('data:image'))urls.push(src);
  }
  while((match=altRegex.exec(html))!==null){alts.push(match[1])}
  /* 过滤掉小图标（通常URL含 icon/logo/qrcode/avatar） */
  urls=urls.filter(function(u){
    var l=u.toLowerCase();
    return l.indexOf('icon')<0&&l.indexOf('logo')<0&&l.indexOf('qrcode')<0&&l.indexOf('avatar')<0&&l.indexOf('emoji')<0;
  });
  if(urls.length===0)return;
  toast('正在提取 '+urls.length+' 张图片…','');
  var done=0,ok=0;
  urls.forEach(function(u,idx){
    var alt=alts[idx]||'';
    var cat=guessImageCategory(alt);
    var proxyUrl=API_BASE+'/api/proxy/image?url='+encodeURIComponent(u);
    fetch(proxyUrl).then(function(r){return r.json()}).then(function(d){
      if(d&&d.ok&&d.dataUrl){
        addSmartImage(d.dataUrl,alt||('图片'+(idx+1)),cat);
        ok++;
      }
    }).catch(function(){}).then(function(){
      done++;
      if(done===urls.length)toast('图片提取完成：'+ok+'/'+urls.length+' 张','success');
    });
  });
}
function uploadSmartImagesToProp(propId){
  if(!S.smartImages.length||!propId)return Promise.resolve(0);
  var promises=S.smartImages.map(function(img){
    return MediaDB.save({
      id:uuid(),propertyId:propId,type:'image',
      name:img.name,dataUrl:img.dataUrl,category:img.category
    });
  });
  return Promise.all(promises).then(function(){return S.smartImages.length}).then(function(n){
    S.smartImages=[];renderSmartImageGallery();return n;
  });
}

/* ========== Client: Detail ========== */
/* ========== 客户合作：UI 区块 + 操作 ========== */
function buildCollabSection(c){
  var collabs=getCollabs(c);
  var accepted=collabs.filter(function(x){return x.status==='accepted'});
  var pending=collabs.filter(function(x){return x.status==='pending'});
  var owner=isClientOwner(c);
  var iAmPending=hasPendingCollab(c);
  var ownerName=c.createdByName||'未知';

  var rows='';
  rows+='<div class="collab-row"><span class="collab-role owner">录入人</span><span class="collab-name">'+esc(ownerName)+'</span></div>';
  var me=(S.currentUser&&S.currentUser.id)||'';
  accepted.forEach(function(x){
    var iAmPartner=(x.userId===me);
    var reqByMe=(x.terminateReqBy&&x.terminateReqBy===me);
    var reqByOther=(x.terminateReqBy&&x.terminateReqBy!==me);
    var btns='';
    if(iAmPartner){
      btns=reqByMe
        ?'<button type="button" class="collab-mini-btn" onclick="cancelTerminateCollab(\''+esc(c.id)+'\')">撤销申请</button>'
        :'<button type="button" class="collab-mini-btn danger" onclick="requestTerminateCollab(\''+esc(c.id)+'\')">解除合作</button>';
    }else if(owner||isAdmin()){
      btns=reqByOther
        ?'<button type="button" class="collab-mini-btn danger" onclick="approveTerminateCollab(\''+esc(c.id)+'\',\''+esc(x.userId)+'\')">同意解除</button>'
        :'<button type="button" class="collab-mini-btn danger" onclick="removeCollab(\''+esc(c.id)+'\',\''+esc(x.userId)+'\')">解除</button>';
    }
    var hint=reqByMe?'<span class="collab-wait">· 待对方确认</span>':(reqByOther?'<span class="collab-wait">· 申请解除中</span>':'');
    rows+='<div class="collab-row"><span class="collab-role partner">合作人</span><span class="collab-name">'+esc(x.userName||'未知')+'</span>'+hint+btns+'</div>';
  });
  pending.forEach(function(x){
    rows+='<div class="collab-row"><span class="collab-role pending">待接收</span><span class="collab-name">'+esc(x.userName||'未知')+'</span>'
      +((owner||isAdmin())?'<button type="button" class="collab-mini-btn" onclick="removeCollab(\''+esc(c.id)+'\',\''+esc(x.userId)+'\')">撤回</button>':'')
      +'</div>';
  });

  var actions='';
  if(iAmPending){
    actions='<div class="collab-invite-box">'
      +'<div class="collab-invite-tip">📨 '+esc((collabs.filter(function(x){return x.userId===S.currentUser.id})[0]||{}).invitedByName||'对方')+' 邀请你合作跟进该客户</div>'
      +'<div class="collab-invite-actions">'
      +'<button type="button" class="btn btn-primary btn-sm" onclick="acceptCollab(\''+esc(c.id)+'\')">接受合作</button>'
      +'<button type="button" class="btn btn-outline btn-sm" onclick="rejectCollab(\''+esc(c.id)+'\')">拒绝</button>'
      +'</div></div>';
  }else if(owner||isAdmin()){
    /* 可邀请的成员：排除自己、排除已在名单里的 */
    var exist={};collabs.forEach(function(x){exist[x.userId]=1});
    var me=S.currentUser?S.currentUser.id:'';
    var cands=(S.allUsers||[]).filter(function(u){return u.id!==me&&u.id!==c.createdBy&&!exist[u.id]});
    if(cands.length){
      actions='<div class="collab-add"><select id="collabUserSelect"><option value="">选择合作人…</option>'
        +cands.map(function(u){return'<option value="'+esc(u.id)+'">'+esc(u.name)+(u.role==='admin'?'（管理员）':'')+'</option>'}).join('')
        +'</select><button type="button" class="btn btn-primary btn-sm" onclick="inviteCollab(\''+esc(c.id)+'\')">发起合作</button></div>';
    }else{
      actions='<div class="collab-empty-tip">暂无可邀请的成员</div>';
    }
  }

  return'<div class="detail-section"><h3>👥 客户合作 <span class="count">('+(accepted.length?accepted.length+'人合作中':'未合作')+')</span></h3>'
    +'<div class="collab-list">'+rows+'</div>'+actions+'</div>';
}
function inviteCollab(clientId){
  var c=findClient(clientId);if(!c)return;
  if(!isClientOwner(c)&&!isAdmin()){toast('只有客户录入人可以发起合作','error');return}
  var sel=document.getElementById('collabUserSelect');
  var uid=sel?sel.value:'';
  if(!uid){toast('请先选择合作人');return}
  var u=(S.allUsers||[]).filter(function(x){return x.id===uid})[0];
  if(!u){toast('成员不存在','error');return}
  if(!Array.isArray(c.collabs))c.collabs=[];
  if(c.collabs.some(function(x){return x.userId===uid})){toast('该成员已在合作名单中');return}
  c.collabs.push({
    userId:uid,userName:u.name,status:'pending',
    invitedBy:S.currentUser?S.currentUser.id:'',
    invitedByName:S.currentUser?S.currentUser.name:'',
    invitedAt:now(),acceptedAt:null
  });
  c.updatedAt=now();saveC();syncNow();
  toast('已向 '+u.name+' 发起合作邀请','success');
  showClientDetail(clientId);
}
function acceptCollab(clientId){
  var c=findClient(clientId);if(!c||!S.currentUser)return;
  var uid=S.currentUser.id;
  var row=getCollabs(c).filter(function(x){return x.userId===uid&&x.status==='pending'})[0];
  if(!row){toast('没有待处理的邀请');return}
  row.status='accepted';row.acceptedAt=now();
  c.updatedAt=now();saveC();syncNow();
  toast('已接受合作，现在可以查看和编辑该客户','success');
  showClientDetail(clientId);renderClientList();updateCollabBadge();
}
function rejectCollab(clientId){
  var c=findClient(clientId);if(!c||!S.currentUser)return;
  var uid=S.currentUser.id;
  c.collabs=getCollabs(c).filter(function(x){return !(x.userId===uid&&x.status==='pending')});
  c.updatedAt=now();saveC();syncNow();
  toast('已拒绝合作邀请');
  closeModal('clientDetailModal');renderClientList();updateCollabBadge();
}
function removeCollab(clientId,userId){
  var c=findClient(clientId);if(!c)return;
  if(!isClientOwner(c)&&!isAdmin()){toast('只有客户录入人可以操作','error');return}
  var row=getCollabs(c).filter(function(x){return x.userId===userId})[0];
  var nm=row?(row.userName||'该成员'):'该成员';
  confirmDialog('解除合作','确定解除与「'+nm+'」的合作吗？对方将无法再查看该客户。',function(){
    c.collabs=getCollabs(c).filter(function(x){return x.userId!==userId});
    c.updatedAt=now();saveC();
    toast('已解除合作','success');
    showClientDetail(clientId);renderClientList();
  });
}
/* 合作人主动发起解除（需发出方同意）*/
function requestTerminateCollab(clientId){
  var c=findClient(clientId);if(!c||!S.currentUser)return;
  var uid=S.currentUser.id;
  var row=getCollabs(c).filter(function(x){return x.userId===uid&&x.status==='accepted'})[0];
  if(!row){toast('你不是该客户的合作人','error');return}
  if(row.terminateReqBy===uid){toast('已发起解除申请，等待对方确认','info');return}
  row.terminateReqBy=uid;row.terminateReqByName=S.currentUser.name;row.terminateReqAt=now();
  c.updatedAt=now();saveC();syncNow();
  toast('已申请解除合作，等待对方确认','success');
  showClientDetail(clientId);renderClientList();
}
function approveTerminateCollab(clientId,userId){
  var c=findClient(clientId);if(!c)return;
  if(!isClientOwner(c)&&!isAdmin()){toast('只有客户录入人可确认解除','error');return}
  var row=getCollabs(c).filter(function(x){return x.userId===userId})[0];
  var nm=row?(row.userName||'该成员'):'该成员';
  confirmDialog('同意解除合作','确定同意与「'+nm+'」解除合作吗？对方将无法再查看该客户。',function(){
    c.collabs=getCollabs(c).filter(function(x){return x.userId!==userId});
    c.updatedAt=now();saveC();syncNow();
    toast('已解除与「'+nm+'」的合作','success');
    showClientDetail(clientId);renderClientList();
  });
}
function cancelTerminateCollab(clientId){
  var c=findClient(clientId);if(!c||!S.currentUser)return;
  var uid=S.currentUser.id;
  var row=getCollabs(c).filter(function(x){return x.userId===uid})[0];
  if(!row)return;
  delete row.terminateReqBy;delete row.terminateReqByName;delete row.terminateReqAt;
  c.updatedAt=now();saveC();syncNow();
  toast('已撤销解除申请','info');
  showClientDetail(clientId);renderClientList();
}
/* owner/admin 视角：待确认的解除申请 */
function getPendingTerminateRequests(){
  if(!S.currentUser)return[];
  var me=S.currentUser.id;var out=[];
  S.clients.forEach(function(c){
    if(!isClientOwner(c)&&!isAdmin())return;
    getCollabs(c).forEach(function(x){
      if(x.terminateReqBy&&x.terminateReqBy!==me)out.push(Object.assign({},c,{_termCollab:x}));
    });
  });
  return out;
}
window.inviteCollab=inviteCollab;window.acceptCollab=acceptCollab;
window.rejectCollab=rejectCollab;window.removeCollab=removeCollab;
window.requestTerminateCollab=requestTerminateCollab;
window.approveTerminateCollab=approveTerminateCollab;
window.cancelTerminateCollab=cancelTerminateCollab;

/* 待处理合作邀请提示（客户页顶部横幅） */
function updateCollabBadge(){
  var wrap=document.getElementById('collabInviteBanner');
  if(!wrap)return;
  var pend=getPendingCollabInvites();
  updateNotifBadge();
  if(!pend.length||isAdmin()){wrap.style.display='none';wrap.innerHTML='';return}
  wrap.style.display='';
  wrap.innerHTML='<span class="cib-ico">📨</span><span class="cib-text">你有 <b>'+pend.length+'</b> 条客户合作邀请待处理</span>'
    +'<button type="button" class="cib-btn" onclick="openFirstCollabInvite()">去查看</button>';
}
function openFirstCollabInvite(){
  var pend=getPendingCollabInvites();
  if(pend.length)showClientDetail(pend[0].id);
}
window.openFirstCollabInvite=openFirstCollabInvite;

/* ========== 客户旅程时间线（#261 成交+跟进闭环） ========== */
function buildClientJourney(c){
  var events=[];
  /* 建档 */
  if(c.createdAt){
    events.push({type:'create',time:c.createdAt,icon:'👤',color:'#94a3b8',label:'建档',
      content:'客户录入系统'+(c.source?' · 来源: '+c.source:'')});
  }
  /* 跟进 */
  (c.followUps||[]).forEach(function(f){
    events.push({type:'followup',time:f.date,icon:'💬',color:'#3b82f6',label:'跟进',
      content:f.content,author:f.authorName,reminderDate:f.reminderDate});
  });
  /* 带看 */
  (c.viewings||[]).forEach(function(v){
    events.push({type:'viewing',time:v.date||0,icon:'🏠',color:'#f59e0b',label:'带看',
      content:v.propertyTitle+(v.feedback?' — '+v.feedback:'')});
  });
  /* 成交 */
  var txs=S.transactions.filter(function(t){
    return(t.clientId&&t.clientId===c.id)||(t.clientName&&t.clientName===c.name);
  });
  txs.forEach(function(t){
    events.push({type:'transaction',time:t.transactionDate||t.createdAt||0,icon:'💰',color:'#16a34a',label:'成交',
      content:(t.propertyTitle||'')+' · '+(t.transactionPrice||0)+'万'+(t.commission?' · 佣金'+t.commission+'元':''),
      txId:t.id});
  });
  /* 按时间倒序 */
  events.sort(function(a,b){return b.time-a.time});
  return events;
}
function renderClientJourney(c){
  var events=buildClientJourney(c);
  if(!events.length)return'';
  var html=events.map(function(e,idx){
    var isHidden=idx>=5?' journey-hidden':'';
    var authorTag=e.author?'<span class="j-author">'+esc(e.author)+'</span>':'';
    var reminderTag=e.reminderDate?'<span class="j-reminder">⏰ '+fmtDate(e.reminderDate)+'</span>':'';
    var clickable=e.txId?' data-tx-id="'+e.txId+'" style="cursor:pointer"':'';
    return'<div class="journey-item'+isHidden+'" data-jtype="'+e.type+'"'+clickable+'>'
      +'<div class="j-dot" style="background:'+e.color+';box-shadow:0 0 0 3px '+e.color+'22">'+e.icon+'</div>'
      +'<div class="j-body">'
      +'<div class="j-meta"><span class="j-label" style="color:'+e.color+'">'+e.label+'</span>'
      +'<span class="j-date">'+fmtDate(e.time)+'</span>'+authorTag+reminderTag+'</div>'
      +'<div class="j-content">'+esc(e.content)+'</div>'
      +'</div></div>';
  }).join('');
  var moreBtn=events.length>5?'<div class="fu-collapse"><button class="fu-collapse-btn" id="journeyCollapseBtn">展开全部（'+(events.length-5)+'条）</button></div>':'';
  return'<div class="detail-section"><h3>🗺️ 客户旅程 <span class="count">('+events.length+'个节点)</span></h3>'
    +'<div class="journey-timeline" id="journeyTimeline">'+html+'</div>'+moreBtn+'</div>';
}

function showClientDetail(id){
  var c=findClient(id);if(!c)return;
  /* 权限：管理员 / 录入人 / 合作人（含待接收，需能看到邀请）可打开 */
  if(!canAccessClient(c)&&!hasPendingCollab(c)){toast('无权查看该客户','error');return}
  S.curClientId=id;
  /* 按钮权限：编辑=可编辑者；删除=仅管理员；无效=录入人或管理员且未无效 */
  var eb=document.getElementById('editClientBtn');if(eb)eb.style.display=canEditClient(c)?'':'none';
  var db=document.getElementById('deleteClientBtn');if(db)db.style.display=canDeleteClient(c)?'':'none';
  var mib=document.getElementById('markClientInvalidBtn');if(mib)mib.style.display=(canMarkClientInvalid(c)&&!c.invalid)?'':'none';
  var rib=document.getElementById('restoreClientInvalidBtn');if(rib)rib.style.display=(isAdmin()&&c.invalid)?'':'none';
  /* 管理员合作客户的电话：非管理员只读，提示 */
  var phoneLockEl=document.getElementById('clientPhoneLockTip');
  if(phoneLockEl){
    if(!isAdmin()&&adminInvolvedClient(c)){
      phoneLockEl.textContent='🔒 该客户由管理员发起合作，联系电话仅管理员可修改';
      phoneLockEl.style.display='';
    }else{phoneLockEl.style.display='none'}
  }
  var lf=lastFollowup(c);var fups=(c.followUps||[]).slice().sort(function(a,b){return b.date-a.date});
  var mainPhone=(c.phones&&c.phones[0])?c.phones[0].number:'';
  var phonesHtml=(c.phones||[]).map(function(p){return'<div style="font-size:.8125rem;color:var(--text-muted)">'+esc(p.label)+': <a href="tel:'+esc(p.number)+'" style="color:var(--primary)">'+esc(p.number)+'</a></div>'}).join('');
  var tagsHtml=(c.customTags||[]).map(function(t){return'<span class="client-tag custom">'+esc(t)+'</span>'}).join('');
  var tlHtml=fups.length?fups.map(function(f,idx){
    var rd=daysSince(f.date);
    var relCls=rd===0?'rel-today':(rd<=3?'rel-recent':'');
    var reminderTag=f.reminderDate?'<span class="reminder-tag">提醒:'+fmtDate(f.reminderDate)+'</span>':'';
    var authorTag=f.authorName?'<span class="fu-author">'+esc(f.authorName)+'</span>':'';
    return'<div class="timeline-item'+(f.reminderDate?' has-reminder':'')+'"><div class="timeline-date"><span class="'+relCls+'">'+relDate(f.date)+'</span> · '+fmtDateTime(f.date)+' '+authorTag+' '+reminderTag+'</div><div class="timeline-content">'+esc(f.content)+'</div></div>';
  }).join(''):'<div class="timeline-empty">暂无跟进记录</div>';
  var viewingsHtml=(c.viewings||[]).slice().sort(function(a,b){return (b.date||0)-(a.date||0)}).map(function(v){
    var vp=v.propertyId?findProp(v.propertyId):null;
    var vtl=v.propertyTypeLabel||(vp?(vp.type==='rental'?'租赁':(vp.type==='newdev'?'新楼盘':'二手房')):'');
    return'<div class="viewing-item viewing-item-record"'+(v.propertyId?' style="cursor:pointer" data-prop-id="'+v.propertyId+'"':'')+'><div class="vi-top"><span class="vi-prop">'+(vtl?'<span class="client-tag">'+esc(vtl)+'</span> ':'')+esc(v.propertyTitle||'未知房源')+'</span><span class="vi-date">'+fmtDate(v.date)+'</span></div>'+(v.feedback?'<div class="vi-feedback">'+esc(v.feedback)+'</div>':'')+'</div>';
  }).join('')||'<div class="timeline-empty">暂无带看记录</div>';
  var areaStr=(c.targetAreas&&c.targetAreas.length)?c.targetAreas.join('、'):'不限';
  document.getElementById('clientDetailBody').innerHTML=
    '<div class="detail-header"><div class="detail-avatar">'+esc((c.name||'?').charAt(0))+'</div><div class="detail-info"><h2>'+esc(c.name)+'</h2></div>'
    +'<div class="sub">'+phonesHtml+(c.wechat?'<div style="font-size:.8125rem;color:var(--text-muted)">微信: '+esc(c.wechat)+'</div>':'')+'</div>'
    +'<div class="detail-badges"><span class="grade-badge" data-grade="'+esc(c.grade)+'">'+esc(c.grade)+'级</span><span class="status-badge" data-status="'+esc(c.status)+'">'+esc(c.status)+'</span><span class="status-badge" data-status="已联系">'+esc(c.source)+'</span></div></div></div>'
    +(tagsHtml?'<div class="detail-section"><h3>标签</h3><div class="client-tags">'+tagsHtml+'</div></div>':'')
    +'<div class="detail-section"><h3>基本信息</h3><div class="detail-grid">'+di('性别',c.gender)+di('来源',c.source)+di('生日',c.birthday||'—')+di('录入时间',fmtDate(c.createdAt))+'</div></div>'
    +buildCollabSection(c)
    +renderNeedProfileCard(c)
    +(c.notes?'<div class="detail-section"><h3>备注</h3><div class="timeline-content" style="background:var(--warning-light)">'+esc(c.notes)+'</div></div>':'')
    +renderClientJourney(c)
    +'<div class="detail-section"><h3>跟进记录 <span class="count">('+(fups.length)+'条 · 最近 '+(lf?fmtDate(lf):'未跟进')+')</span></h3>'
    +'<div class="followup-input"><div class="fu-textarea-wrap"><textarea id="followupText" placeholder="添加最新跟进内容…"></textarea><button class="fu-confirm-btn" id="addFollowupBtn" style="display:none">确认添加</button></div></div>'
    +'<div class="followup-options"><label><input type="checkbox" id="setReminder"> 设置提醒</label><input type="date" id="reminderDate" style="display:none"></div></div>'
    +'<div class="timeline" id="followupTimeline">'+tlHtml+'</div>'+(fups.length>2?'<div class="fu-collapse"><button class="fu-collapse-btn" id="fuCollapseBtn">查看全部跟进（'+(fups.length-2)+'条）</button></div>':'')+'</div>'
    +'<div class="detail-section"><h3>带看记录 <span class="count">('+(c.viewings||[]).length+'条)</span></h3>'
    +'<div id="viewingToggleArea"><button class="btn btn-outline btn-sm" id="toggleViewingForm" style="width:100%;border-style:dashed">＋ 添加带看</button></div>'
    +'<div id="viewingAddForm" style="display:none;margin-top:10px;padding:12px;background:var(--bg-secondary);border-radius:var(--radius-md);border:1px solid var(--border)">'
    +'<div class="vp-layout"><div class="vp-row"><input type="text" id="viewingSearch" class="form-input vp-search" placeholder="搜索小区 / 房号"><input type="text" id="viewingDate" class="vp-date" placeholder="带看日期" onfocus="this.type=&quot;date&quot;" onblur="if(!this.value)this.type=&quot;text&quot;"></div><div class="vp-type-row" id="viewingTypeFilter"><button type="button" data-t="all" class="active">全部</button><button type="button" data-t="secondhand">二手</button><button type="button" data-t="rental">租赁</button><button type="button" data-t="newdev">新楼盘</button></div><div class="vp-results" id="viewingResults"><div class="vp-hint">输入关键词或点上方分类筛选房源</div></div><input type="hidden" id="viewingPropSelect"></div>'
    +'<textarea id="viewingFeedback" placeholder="客户看房反馈（选填）" style="width:100%;margin-top:8px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);padding:8px;font-size:.875rem;min-height:40px;resize:vertical"></textarea>'
    +'<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-primary btn-sm" id="addViewingBtn">确认添加此带看</button><button class="btn btn-sm" id="cancelViewingBtn" style="background:var(--gray-100)">取消</button></div>'
    +'</div>'
    +'<div style="margin-top:8px" id="viewingListWrap">'+viewingsHtml+'</div>'+((c.viewings||[]).length>2?'<div class="fu-collapse"><button class="fu-collapse-btn" id="viewingCollapseBtn">查看全部带看（'+((c.viewings||[]).length-2)+'条）</button></div>':'')+'</div>';
  document.getElementById('clientDetailModal').classList.add('show');
  /* 无权限或已无效：隐藏新增跟进/带看入口（查看仍开放） */
  if(!canEditClient(c)||c.invalid){
    ['toggleViewingForm','viewingAddForm','viewingPropSelect','viewingDate','viewingFeedback','addViewingBtn','cancelViewingBtn'].forEach(function(id){
      var el=document.getElementById(id);if(el)el.style.display='none';
    });
  }
  // Followup handler
  document.getElementById('setReminder').addEventListener('change',function(){
    var rd=document.getElementById('reminderDate');
    rd.style.display=this.checked?'':'none';
    if(this.checked&&!rd.value)rd.value=tomorrowStr();
  });
  (function(){var tl=document.getElementById('followupTimeline');if(tl){var btn=document.getElementById('fuCollapseBtn');if(btn){btn.addEventListener('click',function(){var items=tl.querySelectorAll('.timeline-item');var expanded=tl.getAttribute('data-expanded')!=='0';if(expanded){for(var k=2;k<items.length;k++){items[k].classList.add('fu-hidden')}tl.setAttribute('data-expanded','0');btn.textContent='查看全部跟进（'+(items.length-2)+'条）'}else{for(var k=0;k<items.length;k++){items[k].classList.remove('fu-hidden')}tl.setAttribute('data-expanded','1');btn.textContent='收起'}});if(fups.length>2){var _fi=tl.querySelectorAll('.timeline-item');for(var _fk=2;_fk<_fi.length;_fk++)_fi[_fk].classList.add('fu-hidden');tl.setAttribute('data-expanded','0')}}}})();
  (function(){var vl=document.getElementById('viewingListWrap');var vbtn=document.getElementById('viewingCollapseBtn');if(vbtn){vbtn.addEventListener('click',function(){var vis=vl.querySelectorAll('.viewing-item-record');var exp=vl.getAttribute('data-expanded')!=='0';if(exp){for(var vk=2;vk<vis.length;vk++)vis[vk].classList.add('fu-hidden');vl.setAttribute('data-expanded','0');vbtn.textContent='查看全部带看（'+(vis.length-2)+'条）'}else{for(var vk=0;vk<vis.length;vk++)vis[vk].classList.remove('fu-hidden');vl.setAttribute('data-expanded','1');vbtn.textContent='收起'}});if((c.viewings||[]).length>2){var _vi=vl.querySelectorAll('.viewing-item-record');for(var _vk=2;_vk<_vi.length;_vk++)_vi[_vk].classList.add('fu-hidden');vl.setAttribute('data-expanded','0')}}})();
  /* 客户旅程折叠 + 成交节点点击 */
  (function(){var jt=document.getElementById('journeyTimeline');if(!jt)return;
    var jbtn=document.getElementById('journeyCollapseBtn');
    if(jbtn){jbtn.addEventListener('click',function(){var items=jt.querySelectorAll('.journey-item');var hidden=jt.querySelectorAll('.journey-hidden');var expanded=hidden.length===0;if(expanded){items.forEach(function(it,idx){if(idx>=5)it.classList.add('journey-hidden')});jbtn.textContent='展开全部（'+(items.length-5)+'条）'}else{items.forEach(function(it){it.classList.remove('journey-hidden')});jbtn.textContent='收起'}});}
    /* 成交节点点击跳转 */
    jt.querySelectorAll('[data-tx-id]').forEach(function(el){
      el.addEventListener('click',function(){
        var txId=el.getAttribute('data-tx-id');
        closeModal('clientDetailModal');
        setTimeout(function(){showTxDetail(txId)},200);
      });
    });
  })();
  (function(){var ta=document.getElementById('followupText'),cb=document.getElementById('addFollowupBtn');ta.addEventListener('input',function(){cb.style.display=this.value.trim()?'inline-flex':'none'});ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey&&this.value.trim()){e.preventDefault();cb.click()}})})();
  document.getElementById('addFollowupBtn').addEventListener('click',function(){
    var cc=findClient(id); if(!cc){toast('客户不存在','error');return} if(!canEditClient(cc)){toast('无权限：仅管理员、录入人或合作人可添加跟进','error');return}
    var text=document.getElementById('followupText').value.trim();
    if(!text){toast('请输入跟进内容','error');return}
    var reminder=null;
    if(document.getElementById('setReminder').checked){reminder=document.getElementById('reminderDate').value||null}
    if(!cc.followUps)cc.followUps=[];
    cc.followUps.push({id:uuid(),content:text,date:now(),reminderDate:reminder,authorId:S.currentUser?S.currentUser.id:'',authorName:S.currentUser?S.currentUser.name:''});
    cc.updatedAt=now();saveC();renderClientList();showClientDetail(id);toast('跟进记录已添加','success');
  });
  /* 带看表单展开/收起 */
  document.getElementById('toggleViewingForm').addEventListener('click',function(){
    document.getElementById('viewingAddForm').style.display='';
    this.parentElement.style.display='none';
    var _vs=document.getElementById('viewingSearch');if(_vs)_vs.focus();
  });
  document.getElementById('cancelViewingBtn').addEventListener('click',function(){
    document.getElementById('viewingAddForm').style.display='none';
    document.getElementById('viewingToggleArea').style.display='';
    document.getElementById('viewingSearch').value='';
    document.getElementById('viewingDate').value='';
    document.getElementById('viewingFeedback').value='';
    document.getElementById('viewingPropSelect').value='';
    document.getElementById('viewingResults').innerHTML='<div class="vp-hint">输入关键词或点上方分类筛选房源</div>';
  });
  document.getElementById('addViewingBtn').addEventListener('click',function(){
    if(!canEditClient(c)){toast('无权限：仅管理员、录入人或合作人可添加带看','error');return}
    var pid=document.getElementById('viewingPropSelect').value;
    var date=document.getElementById('viewingDate').value;
    var fb=document.getElementById('viewingFeedback').value.trim();
    if(!pid){toast('请选择房源','error');return}
    if(!date){toast('请选择看房日期','error');return}
    var p=findProp(pid);if(!c.viewings)c.viewings=[];
    var ptype=p?(p.type==='rental'?'租赁':(p.type==='newdev'?'新楼盘':'二手房')):'';
    var ptitle=p?(((p.type==='secondhand'||p.type==='rental')&&p.community)?[p.community,p.building,p.unit,p.room].filter(Boolean).join(' '):(p.title||'未命名')):'未知房源';
    c.viewings.push({id:uuid(),propertyId:pid,propertyTitle:ptitle,propertyType:p?p.type:'',propertyTypeLabel:ptype,date:new Date(date).getTime(),feedback:fb});
    c.updatedAt=now();saveC();renderClientList();showClientDetail(id);toast('带看记录已添加','success');
    /* 添加成功后自动收起表单 */
    var _vaf=document.getElementById('viewingAddForm');if(_vaf){_vaf.style.display='none'}
    var _vta=document.getElementById('viewingToggleArea');if(_vta)_vta.style.display='';
  });
  /* 带看房源选择器：搜索 + 类型筛选 */
  S._vType='all';
  var _vs=document.getElementById('viewingSearch');
  var _vtf=document.getElementById('viewingTypeFilter');
  function renderViewingResults(){
    var kw=(_vs.value||'').trim().toLowerCase();
    var tf=S._vType;
    var box=document.getElementById('viewingResults');
    if(!kw&&tf==='all'){box.innerHTML='<div class="vp-hint">输入关键词，或点上方分类，即可筛选房源</div>';return;}
    var arr=(S.properties||[]).filter(function(p){
      if(p.invalid)return false;
      if(tf!=='all'&&p.type!==tf)return false;
      if(!kw)return true;
      var hay=((p.community||'')+' '+(p.building||'')+' '+(p.unit||'')+' '+(p.room||'')+' '+(p.title||'')+' '+propOptionLabel(p)).toLowerCase();
      return hay.indexOf(kw)>=0;
    });
    arr.sort(function(a,b){return (b.updatedAt||0)-(a.updatedAt||0)});
    if(!arr.length){box.innerHTML='<div class="vp-hint">没有匹配的房源</div>';return;}
    var cur=document.getElementById('viewingPropSelect').value;
    box.innerHTML=arr.map(function(p){
      var tag=p.type==='rental'?'<span class="vp-tag rental">租赁</span>':(p.type==='newdev'?'<span class="vp-tag newdev">新楼盘</span>':'<span class="vp-tag secondhand">二手</span>');
      return'<div class="vp-item'+(cur===p.id?' selected':'')+'" data-pid="'+p.id+'">'+tag+'<span class="vp-label">'+esc(propOptionLabel(p))+'</span></div>';
    }).join('');
    box.querySelectorAll('.vp-item').forEach(function(it){
      it.addEventListener('click',function(){
        document.getElementById('viewingPropSelect').value=it.getAttribute('data-pid');
        _vs.value=it.querySelector('.vp-label').textContent;
        box.querySelectorAll('.vp-item').forEach(function(x){x.classList.remove('selected')});
        it.classList.add('selected');
      });
    });
  }
  if(_vs)_vs.addEventListener('input',renderViewingResults);
  if(_vtf)_vtf.querySelectorAll('button').forEach(function(b){
    b.addEventListener('click',function(){
      _vtf.querySelectorAll('button').forEach(function(x){x.classList.remove('active')});
      b.classList.add('active');S._vType=b.getAttribute('data-t');renderViewingResults();
    });
  });
  renderViewingResults();
  document.querySelectorAll('[data-prop-id]').forEach(function(el){
    el.addEventListener('click',function(){closeModal('clientDetailModal');setTimeout(function(){showPropertyDetail(el.getAttribute('data-prop-id'))},200)});
  });
}
function di(label,value){return'<div class="detail-item"><div class="label">'+esc(label)+'</div><div class="value">'+esc(value||'—')+'</div></div>'}
/* 多号码电话展示：支持 "a / b / c" 拆成多个可点击 tel: 链接 */
function diPhone(label,phoneStr){
  if(!phoneStr)return'<div class="detail-item"><div class="label">'+esc(label)+'</div><div class="value">—</div></div>';
  var phs=phoneStr.split(/\s*\/\s*/).filter(Boolean);
  var links=phs.map(function(ph){return'<a href="tel:'+esc(ph)+'" style="color:var(--primary)">'+esc(ph)+'</a>'}).join('&nbsp;&nbsp;');
  return'<div class="detail-item"><div class="label">'+esc(label)+'</div><div class="value">'+links+'</div></div>';
}

/* ========== 敏感字段脱敏（店长/管理员可见，普通经纪显 ***） ========== */
function canSeeSensitive(){ return S.currentUser && (S.currentUser.role==='admin'||S.currentUser.role==='manager'); }
function diMask(label,value){
  if(canSeeSensitive()) return di(label,value);
  return '<div class="detail-item"><div class="label">'+esc(label)+'</div><div class="value sensitive-masked" title="仅店长/管理员可见">***<span class="lock">🔒</span></div></div>';
}
function diPhoneMask(label,phoneStr){
  if(canSeeSensitive()) return diPhone(label,phoneStr);
  return '<div class="detail-item"><div class="label">'+esc(label)+'</div><div class="value sensitive-masked" title="仅店长/管理员可见">***<span class="lock">🔒</span></div></div>';
}

/* ========== 业主电话每日查看限额（非管理员 20 个/天，自己录入的不限） ========== */
var SK_PHONEVIEW='xwg_fkb_phoneview_v6';
var PHONE_DAILY_LIMIT=20;
function _todayStr(){
  var d=new Date(),m=d.getMonth()+1,dy=d.getDate();
  return d.getFullYear()+'-'+(m<10?'0':'')+m+'-'+(dy<10?'0':'')+dy;
}
function getPhoneViewLog(){
  var uid=S.currentUser?S.currentUser.id:'';
  var blank={date:_todayStr(),uid:uid,ids:[]};
  try{
    var raw=localStorage.getItem(SK_PHONEVIEW);
    if(!raw)return blank;
    var o=JSON.parse(raw);
    if(!o||o.date!==_todayStr()||o.uid!==uid)return blank;
    if(!Array.isArray(o.ids))o.ids=[];
    return o;
  }catch(e){return blank}
}
function savePhoneViewLog(o){try{localStorage.setItem(SK_PHONEVIEW,JSON.stringify(o))}catch(e){}}
function isOwnProperty(p){return !!(S.currentUser&&p&&p.createdBy&&p.createdBy===S.currentUser.id)}
/* 房源 可编辑/可删除 权限见上方权限模型区块（canEditProp/canDeleteProp） */
function phoneViewUsed(){return getPhoneViewLog().ids.length}
function phoneViewRemaining(){return Math.max(0,PHONE_DAILY_LIMIT-phoneViewUsed())}
function isPhoneUnlocked(p){
  if(canSeeSensitive())return true;
  if(isOwnProperty(p))return true;
  if(!p||!p.id)return false;
  return getPhoneViewLog().ids.indexOf(p.id)>=0;
}
/* 消耗一次额度；已解锁过的同一房源不重复计数 */
function consumePhoneView(p){
  if(canSeeSensitive()||isOwnProperty(p))return true;
  if(!p||!p.id)return false;
  var o=getPhoneViewLog();
  if(o.ids.indexOf(p.id)>=0)return true;
  if(o.ids.length>=PHONE_DAILY_LIMIT)return false;
  o.ids.push(p.id);savePhoneViewLog(o);return true;
}
function unlockOwnerPhone(propId){
  var p=S.properties.filter(function(x){return x.id===propId})[0];
  if(!p){toast('房源不存在','error');return}
  if(!consumePhoneView(p)){
    toast('今日业主电话查看次数已用完（'+PHONE_DAILY_LIMIT+'个/天），明天再试','error');
    return;
  }
  toast('已解锁，今日剩余 '+phoneViewRemaining()+' 次','success');
  // 详情弹窗开着就刷详情，否则刷列表
  var dm=document.getElementById('propDetailModal');
  if(dm&&dm.classList.contains('show')&&typeof showPropertyDetail==='function'){showPropertyDetail(propId);}
  else if(typeof renderPropertyList==='function'){renderPropertyList();}
}
window.unlockOwnerPhone=unlockOwnerPhone;
/* 带限额的业主电话展示 */
function diPhoneLimited(label,phoneStr,p){
  if(!phoneStr)return'<div class="detail-item"><div class="label">'+esc(label)+'</div><div class="value">—</div></div>';
  if(isPhoneUnlocked(p)){
    var tip=(!canSeeSensitive()&&isOwnProperty(p))?'<span style="font-size:.72rem;color:var(--gray-400);margin-left:6px">我的房源</span>':'';
    var phs=phoneStr.split(/\s*\/\s*/).filter(Boolean);
    var links=phs.map(function(ph){return'<a href="tel:'+esc(ph)+'" style="color:var(--primary)">'+esc(ph)+'</a>'}).join('&nbsp;&nbsp;');
    return'<div class="detail-item"><div class="label">'+esc(label)+'</div><div class="value">'+links+tip+'</div></div>';
  }
  var rem=phoneViewRemaining();
  var masked=phoneStr.replace(/\d/g,'*').slice(0,11);
  if(rem<=0){
    return'<div class="detail-item"><div class="label">'+esc(label)+'</div>'+
      '<div class="value sensitive-masked" title="今日额度已用完">'+esc(masked)+
      '<span style="font-size:.72rem;color:var(--danger);margin-left:6px">今日额度已用完</span></div></div>';
  }
  return'<div class="detail-item"><div class="label">'+esc(label)+'</div>'+
    '<div class="value"><span class="sensitive-masked">'+esc(masked)+'</span>'+
    '<button type="button" class="phone-unlock-btn" onclick="unlockOwnerPhone(\''+esc(p.id)+'\')">👁 查看（剩'+rem+'次）</button>'+
    '</div></div>';
}

function _mapLink(addr,lng,lat){if(!addr)return'';var encoded=encodeURIComponent(addr);var url=lng&&lat?'https://uri.amap.com/marker?position='+lng+','+lat+'&name='+encoded:'https://uri.amap.com/marker?name='+encoded;return'<a href="'+url+'" target="_blank" class="map-link" title="在地图中打开" style="color:var(--primary);text-decoration:none">🗺️ '+esc(addr)+'</a>';}

/* ===== 房源对比 ===== */
function _renderPropCompare(ids){
  var props=ids.map(function(id){return findProp(id)}).filter(Boolean);
  if(props.length<2)return;
  var types={};props.forEach(function(p){types[p.type]=(types[p.type]||0)+1});
  var sameType=Object.keys(types).length===1;
  var typ=props[0].type;
  function cell(v,f){f=f||function(x){return esc(x||'—')};return'<td style="text-align:center;padding:8px 6px;font-size:.8125rem">'+f(v)+'</td>'}
  function row(label,getVal,f){f=f||function(x){return esc(x||'—')};
    return'<tr><td style="font-weight:600;color:var(--text-muted);font-size:.8125rem;padding:6px 8px;white-space:nowrap;background:var(--gray-50)">'+label+'</td>'+props.map(function(p){return cell(getVal(p),f)}).join('')+'</tr>'}
  var rows=[];
  /* Header */
  rows.push('<tr style="background:var(--accent-soft)"><th style="min-width:70px;padding:10px 6px;font-size:.8125rem">字段</th>'+props.map(function(p,i){var t=p.community?cleanCommunityName(p.community):(p.title||'未命名');return'<th style="text-align:center;padding:10px 6px;font-size:.875rem;font-weight:700"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:'+['#2563eb','#7c3aed','#0d9488','#f59e0b'][i]+';margin-right:4px;vertical-align:middle"></span>'+esc(t)+'</th>'}).join('')+'</tr>');
  /* 基础信息 */
  rows.push(row('区域',function(p){return p.district+(p.block?' · '+p.block:'')}));
  rows.push(row('状态',function(p){return p.status}));
  rows.push(row('地址',function(p){return [p.building?p.building+'幢':'',p.unit&&p.unit!=='1单元'?p.unit.replace(/单元$/,'')+'单元':'',p.room?p.room+'室':''].filter(Boolean).join(' ')||p.address||'—'}));
  /* 价格 */
  if(sameType&&typ==='secondhand'){
    rows.push(row('总价',function(p){return p.totalPrice},function(v){return v?v+'万':'—'}));
    rows.push(row('单价',function(p){return p.unitPrice},function(v){return v?v+'元/㎡':'—'}));
    rows.push(row('面积',function(p){return p.area},function(v){return v?v+'㎡':'—'}));
    rows.push(row('户型',function(p){return p.layout}));
    rows.push(row('楼层',function(p){return p.floor+(p.totalFloors?'/'+p.totalFloors+'层':'')}));
    rows.push(row('朝向',function(p){return p.orientation}));
    rows.push(row('装修',function(p){return p.decoration}));
    rows.push(row('建成年份',function(p){return p.buildingAge}));
    rows.push(row('产权',function(p){return p.propertyRights}));
    rows.push(row('钥匙',function(p){return p.hasKey?'有':'无'}));
    rows.push(row('看房',function(p){return p.viewingMethod}));
    rows.push(row('学区',function(p){return p.school}));
    rows.push(row('地铁',function(p){return p.metro}));
    rows.push(row('业主底价',function(p){return p.ownerReserve}));
  }else if(sameType&&typ==='rental'){
    rows.push(row('月租',function(p){return p.rentPrice},function(v){return v?v+'元/月':'—'}));
    rows.push(row('面积',function(p){return p.area},function(v){return v?v+'㎡':'—'}));
    rows.push(row('户型',function(p){return p.layout}));
    rows.push(row('楼层',function(p){return p.floor+(p.totalFloors?'/'+p.totalFloors+'层':'')}));
    rows.push(row('押付方式',function(p){return p.depositType}));
    rows.push(row('租赁方式',function(p){return p.rentType}));
    rows.push(row('租期',function(p){return p.leaseTerm}));
    rows.push(row('钥匙',function(p){return p.hasKey?'有':'无'}));
    rows.push(row('看房',function(p){return p.viewingMethod}));
    rows.push(row('学区',function(p){return p.school}));
    rows.push(row('地铁',function(p){return p.metro}));
  }else if(sameType&&typ==='newdev'){
    rows.push(row('均价',function(p){return p.averagePriceText||(p.averagePrice?p.averagePrice+'元/㎡':'')}));
    rows.push(row('起步总价',function(p){return p.totalPriceText||(p.totalPrice?p.totalPrice+'万起':'')}));
    rows.push(row('开发商',function(p){return p.developer}));
    rows.push(row('物业类型',function(p){return p.propertyType}));
    rows.push(row('在售面积',function(p){return p.availableLayouts}));
    rows.push(row('在售楼幢',function(p){return p.onSaleBuildings}));
    rows.push(row('加推楼幢',function(p){return p.additionalBuildings}));
    rows.push(row('加推价格',function(p){return p.additionalPrice}));
    rows.push(row('认购状态',function(p){return p.saleStatus}));
    rows.push(row('交付时间',function(p){return p.deliveryDate}));
    rows.push(row('地铁',function(p){return p.metro}));
    rows.push(row('佣金',function(p){return p.commission}));
    rows.push(row('保护期',function(p){return p.protectionPeriod}));
  }else{
    /* 混类型：只比通用字段 */
    var priceRow=props.map(function(p){
      if(p.type==='secondhand')return p.totalPrice?p.totalPrice+'万':'—';
      if(p.type==='rental')return p.rentPrice?p.rentPrice+'元/月':'—';
      return p.averagePriceText||(p.averagePrice?p.averagePrice+'元/㎡':'—');
    });
    rows.push('<tr><td style="font-weight:600;color:var(--text-muted);font-size:.8125rem;padding:6px 8px;white-space:nowrap;background:var(--gray-50)">价格</td>'+priceRow.map(function(v){return'<td style="text-align:center;padding:8px 6px;font-size:.8125rem">'+esc(v)+'</td>'}).join('')+'</tr>');
    rows.push(row('面积',function(p){return p.area},function(v){return v?v+'㎡':'—'}));
    rows.push(row('户型',function(p){return p.layout}));
    rows.push(row('朝向',function(p){return p.orientation}));
    rows.push(row('装修',function(p){return p.decoration}));
    rows.push(row('地铁',function(p){return p.metro}));
    rows.push(row('学区',function(p){return p.school}));
  }
  var html='<div style="overflow:auto"><table class="compare-table" style="width:100%;border-collapse:collapse;font-size:.8125rem">'+rows.join('')+'</table></div>';
  var hint='<div style="margin-top:8px;font-size:.75rem;color:var(--text-muted);text-align:center">对比 '+(sameType?'':'（不同房源类型，仅展示通用字段）')+' 共 '+props.length+' 条</div>';
  document.getElementById('propCompareBody').innerHTML=html+hint;
}


/* 纯SVG饼图 */
function _pieChart(data,colors,size){
  size=size||160;
  var total=data.reduce(function(s,d){return s+d.value},0);
  if(total===0)return'<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:.8125rem">暂无数据</div>';
  var cx=size/2,cy=size/2,r=size/2-8,startAngle=-Math.PI/2;
  var paths=[],legends=[];
  data.forEach(function(d,i){
    var angle=d.value/total*2*Math.PI;
    var endAngle=startAngle+angle;
    var x1=cx+r*Math.cos(startAngle),y1=cy+r*Math.sin(startAngle);
    var x2=cx+r*Math.cos(endAngle),y2=cy+r*Math.sin(endAngle);
    var la=angle>Math.PI?1:0;
    paths.push('<path d="M'+cx+','+cy+' L'+x1.toFixed(1)+','+y1.toFixed(1)+' A'+r+','+r+' 0 '+la+',1 '+x2.toFixed(1)+','+y2.toFixed(1)+' Z" fill="'+colors[i%colors.length]+'" stroke="#fff" stroke-width="1.5"/>');
    var pct=Math.round(d.value/total*100);
    legends.push('<div style="display:flex;align-items:center;gap:6px;font-size:.75rem"><span style="width:10px;height:10px;border-radius:2px;background:'+colors[i%colors.length]+';flex-shrink:0"></span><span>'+esc(d.label)+'</span><span style="color:var(--text-muted);margin-left:auto">'+d.value+' ('+pct+'%)</span></div>');
    startAngle=endAngle;
  });
  return'<div style="display:flex;align-items:center;gap:16px;justify-content:center;flex-wrap:wrap">'+
    '<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" style="flex-shrink:0">'+paths.join('')+'</svg>'+
    '<div style="display:flex;flex-direction:column;gap:4px;min-width:140px">'+legends.join('')+'</div></div>';
}

/* ========== 通知中心 ========== */
var _notifUnread=0;
/* 通知类型图标映射 */
function notifTypeIcon(type){
  var map={client:'👤',property:'🏠',transaction:'💰',price:'📊',collab:'🤝',coop:'🤝',followup:'📝',viewing:'🔑',todo:'✅',owner_maintain:'🏠',system:'📢'};
  return map[type]||'🔔';
}
/* 通知类型中文标签 */
function notifTypeLabel(type){
  var map={client:'新客户',property:'新房源',transaction:'新成交',price:'改价',collab:'合作邀请',coop:'合作邀请',followup:'跟进',viewing:'带看',todo:'待办',owner_maintain:'业主维护',system:'系统'};
  return map[type]||'通知';
}
/* 相对时间：xxx前 */
function relTime(ts){
  if(!ts)return '';
  var diff=Date.now()-ts;
  if(diff<60000)return '刚刚';
  if(diff<3600000)return Math.floor(diff/60000)+'分钟前';
  if(diff<86400000)return Math.floor(diff/3600000)+'小时前';
  if(diff<2592000000)return Math.floor(diff/86400000)+'天前';
  return Math.floor(diff/2592000000)+'个月前';
}
function updateNotifBadge(){
  var show=!!S.currentUser;
  ['notifBtn','notifBtnMobile'].forEach(function(id){var el=document.getElementById(id);if(el)el.style.display=show?'flex':'none';});
  var n=_notifUnread||0;
  /* 凡是值得提醒的都汇总到铃铛标徽：未读通知 + 待处理合作邀请 + 待确认解除合作 + 智能提醒 */
  var pend=(typeof getPendingCollabInvites==="function")?getPendingCollabInvites().length:0;
  var term=(typeof getPendingTerminateRequests==="function")?getPendingTerminateRequests().length:0;
  var rem=(typeof getReminders==="function")?getReminders().length:0;
  n+=pend+term+rem;
  ['notifBadge','notifBadgeMobile'].forEach(function(id){
    var el=document.getElementById(id); if(!el)return;
    if(show&&n>0){el.style.display='';el.className='badge-dot badge-dot-num';el.textContent=n>99?'99+':String(n);}else{el.style.display='none';el.className='badge-dot';}
  });
}
function openNotifPanel(){
  var panel=document.getElementById('notifPanel');
  if(panel)panel.classList.add('show');
  renderNotifList();
}
function renderNotifList(){
  fetchNotifUnread();
}
function fetchNotifUnread(){
  var box=document.getElementById('notifList');
  if(!S.currentUser)return;
  /* ====== 第一步：立即渲染本地合作邀请卡片（不依赖服务器）====== */
  var pend=(typeof getPendingCollabInvites==='function')?getPendingCollabInvites():[];
  var pendHtml='';
  if(pend.length){
    pendHtml='<div class="notif-section-title">待处理合作邀请</div>'+pend.map(function(c){
      var inv=getCollabs(c).filter(function(x){return x.userId===S.currentUser.id&&x.status==='pending'})[0];
      var fromName=inv&&inv.invitedByName?inv.invitedByName:'管理员';
      return '<div class="notif-item collab-invite" data-cid="'+c.id+'">'+
        '<div class="notif-ic">🤝</div>'+
        '<div class="notif-main"><div class="notif-text">'+esc(S.currentUser.name)+'，你有来自 <b>'+esc(fromName)+'</b> 的客户「'+esc(c.name||c.community||'客户')+'」合作邀请</div>'+
        '<div class="notif-meta"><span class="notif-type">合作邀请</span> · 待处理</div></div>'+
        '<div class="collab-invite-actions"><button type="button" class="ci-accept" data-cid="'+c.id+'">接受</button><button type="button" class="ci-reject" data-cid="'+c.id+'">拒绝</button></div>'+
      '</div>';
    }).join('');
  }
  /* 待确认的解除合作申请（owner/admin 视角）*/
  var termReqs=getPendingTerminateRequests();
  var termHtml='';
  if(termReqs.length){
    termHtml='<div class="notif-section-title">待处理解除申请</div>'+termReqs.map(function(c){
      var x=c._termCollab;
      return '<div class="notif-item collab-terminate" data-cid="'+c.id+'">'+
        '<div class="notif-ic">🔓</div>'+
        '<div class="notif-main"><div class="notif-text">'+esc(x.userName||'合作人')+' 申请解除客户「'+esc(c.name||c.community||'客户')+'」的合作</div>'+
        '<div class="notif-meta"><span class="notif-type">解除合作</span> · 待你确认</div></div>'+
        '<div class="collab-invite-actions"><button type="button" class="ct-approve" data-cid="'+c.id+'" data-uid="'+esc(x.userId)+'">同意解除</button><button type="button" class="ct-view" data-cid="'+c.id+'">查看</button></div>'+
      '</div>';
    }).join('');
  }
  /* 智能提醒（生日/关键节点/置换周期/待跟进）也汇总到铃铛面板 */
  var rems=(typeof getReminders==='function')?getReminders():[];
  var remHtml='';
  if(rems.length){
    remHtml='<div class="notif-section-title">智能提醒</div>'+rems.map(function(r){
      var nav=r.clientId?' data-dash-client="'+r.clientId+'"':'';
      return '<div class="notif-item reminder-item"'+nav+' style="cursor:pointer">'+
        '<div class="notif-ic">'+reminderEmoji(r.type)+'</div>'+
        '<div class="notif-main"><div class="notif-text">'+esc(r.title)+'</div>'+
        '<div class="notif-meta"><span class="notif-type">提醒</span> · '+esc(r.sub||'')+'</div></div>'+
      '</div>';
    }).join('');
  }
  /* 立即显示合作邀请卡片 + 解除申请卡片 + 智能提醒 */
  if(pendHtml||termHtml||remHtml){box.innerHTML=pendHtml+termHtml+remHtml;bindCollabCardEvents(box);bindReminderItemClicks(box);}
  /* ====== 第二步：异步拉取服务端通知（带认证头）====== */
  var h=getAuthHeader();
  fetch('/api/notifications',{headers:h}).then(function(r){
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.json();
  }).then(function(d){
    if(d&&d.notifications){
      _notifUnread=d.unread||0;updateNotifBadge();
      if(!d.notifications.length&&!pend.length){
        if(!pendHtml)box.innerHTML='<div class="timeline-empty">暂无通知</div>';
        return;
      }
      var realHtml='';
      try{
        realHtml=d.notifications.map(function(n){
          var navAttr='';if(n.clientId)navAttr+=' data-notif-client="'+n.clientId+'"';if(n.propertyId)navAttr+=' data-notif-prop="'+n.propertyId+'"';if(n.txId)navAttr+=' data-notif-tx="'+n.txId+'"';
          return '<div class="notif-item'+(n.read?' read':'')+'" data-id="'+n.id+'"'+navAttr+' style="cursor:pointer">'+
            '<div class="notif-ic">'+notifTypeIcon(n.type)+'</div>'+
            '<div class="notif-main"><div class="notif-text">'+esc(n.text)+'</div>'+
            '<div class="notif-meta"><span class="notif-type">'+notifTypeLabel(n.type)+'</span> · '+relTime(n.createdAt)+(n.fromUserName?' · '+esc(n.fromUserName):'')+'</div></div>'+
            (n.read?'':'<div class="notif-dot"></div>')+'</div>';
        }).join('');
      }catch(e){console.error('[fetchNotifUnread] render error:',e);}
      var _lead=pendHtml+termHtml+remHtml;
      box.innerHTML=_lead+(_lead&&realHtml?'<div class="notif-section-title">其他通知</div>':'')+realHtml;
      bindCollabCardEvents(box);
      bindNotifItemClicks(box);
      bindReminderItemClicks(box);
    } else {
      /* 服务端返回空或异常，保留已渲染的合作邀请卡片 */
      if(!pendHtml)box.innerHTML='<div class="timeline-empty">暂无通知</div>';
    }
  }).catch(function(err){
    console.error('[fetchNotifUnread]',err);
    /* 失败也不覆盖合作邀请卡片 */
    if(!pendHtml)box.innerHTML='<div class="timeline-empty">通知加载失败</div>';
  });
}
/* 辅助：绑定合作邀请卡片事件 */
function bindCollabCardEvents(box){
  box.querySelectorAll('.collab-invite').forEach(function(el){
    el.addEventListener('click',function(e){
      if(e.target.classList.contains('ci-accept')||e.target.classList.contains('ci-reject'))return;
      var cid=el.getAttribute('data-cid');
      var panel=document.getElementById('notifPanel');if(panel)panel.classList.remove('show');
      if(cid){switchTab('clients');setTimeout(function(){showClientDetail(cid)},250);}
    });
  });
  box.querySelectorAll('.ci-accept').forEach(function(btn){
    btn.addEventListener('click',function(e){e.stopPropagation();var cid=btn.getAttribute('data-cid');var panel=document.getElementById('notifPanel');if(panel)panel.classList.remove('show');acceptCollab(cid);});
  });
  box.querySelectorAll('.ci-reject').forEach(function(btn){
    btn.addEventListener('click',function(e){e.stopPropagation();var cid=btn.getAttribute('data-cid');var panel=document.getElementById('notifPanel');if(panel)panel.classList.remove('show');rejectCollab(cid);});
  });
  box.querySelectorAll('.collab-terminate').forEach(function(el){
    el.addEventListener('click',function(e){
      if(e.target.classList.contains('ct-approve')||e.target.classList.contains('ct-view'))return;
      var cid=el.getAttribute('data-cid');
      var panel=document.getElementById('notifPanel');if(panel)panel.classList.remove('show');
      if(cid){switchTab('clients');setTimeout(function(){showClientDetail(cid)},250);}
    });
  });
  box.querySelectorAll('.collab-terminate .ct-approve').forEach(function(btn){
    btn.addEventListener('click',function(e){e.stopPropagation();var cid=btn.getAttribute('data-cid');var uid=btn.getAttribute('data-uid');var panel=document.getElementById('notifPanel');if(panel)panel.classList.remove('show');approveTerminateCollab(cid,uid);});
  });
  box.querySelectorAll('.collab-terminate .ct-view').forEach(function(btn){
    btn.addEventListener('click',function(e){e.stopPropagation();var cid=btn.getAttribute('data-cid');var panel=document.getElementById('notifPanel');if(panel)panel.classList.remove('show');switchTab('clients');setTimeout(function(){showClientDetail(cid)},250);});
  });
}
/* 辅助：绑定通知列表项点击 */
function bindNotifItemClicks(box){
  box.querySelectorAll('.notif-item:not(.collab-invite):not(.reminder-item)').forEach(function(el){
    el.addEventListener('click',function(){
      var nid=el.getAttribute('data-id');
      if(!el.classList.contains('read')){markNotifRead([nid]);el.classList.add('read');var dot=el.querySelector('.notif-dot');if(dot)dot.remove();}
      var cid=el.getAttribute('data-notif-client');var pid=el.getAttribute('data-notif-prop');var txid=el.getAttribute('data-notif-tx');
      var panel=document.getElementById('notifPanel');if(panel)panel.classList.remove('show');
      if(cid){switchTab('clients');setTimeout(function(){showClientDetail(cid)},250);}
      else if(pid){switchTab('properties');setTimeout(function(){showPropertyDetail(pid)},250);}
      else if(txid){switchTab('dashboard');}
    });
  });
}
/* 辅助：绑定智能提醒项点击（跳转到对应客户，不标记已读） */
function bindReminderItemClicks(box){
  box.querySelectorAll('.reminder-item').forEach(function(el){
    el.addEventListener('click',function(){
      var cid=el.getAttribute('data-dash-client');
      var panel=document.getElementById('notifPanel');if(panel)panel.classList.remove('show');
      if(cid){switchTab('clients');setTimeout(function(){showClientDetail(cid)},250);}
    });
  });
}

function markNotifRead(ids){
  fetch('/api/notifications/read',{method:'POST',headers:getAuthHeader(),body:JSON.stringify({ids:ids})}).then(function(){fetchNotifUnread();}).catch(function(){});
}
function markAllNotifRead(){
  fetch('/api/notifications/read',{method:'POST',headers:getAuthHeader(),body:JSON.stringify({all:true})}).then(function(){
    _notifUnread=0;updateNotifBadge();renderNotifList();
  }).catch(function(){});
}
function toggleNotifMute(type, muted){
  fetch('/api/notifications/mute',{method:'POST',headers:getAuthHeader(),body:JSON.stringify({scope:type?'type:'+type:'global',muted:muted})}).then(function(){toast('免打扰设置已更新','success');}).catch(function(){});
}

/* ========== Property: Filter & Sort ========== */
function getFilteredProperties(){
  /* 性能关键：第一时间排除 MD(2万+条) 和 community，后续 filter 不再被它们拖慢 */
  var list=(S.properties||[]).filter(function(p){return p.type!=='md'&&p.type!=='community'});
  var f=S.propFilters;var q=S.search.trim().toLowerCase();
  // 先按顶部 tab 过滤
  if(!f.type){
    if(S.subtab==='community'){
      list=list.filter(function(p){return p.type==='secondhand'||p.type==='rental'});
    }else{
      list=list.filter(function(p){return p.type===S.subtab});
    }
  }
  // 录入人筛选（仅admin）
  if(isAdmin()&&S.filterCreatedBy){
    if(S.filterCreatedBy==='__unassigned'){
      list=list.filter(function(p){return !p.createdBy});
    }else{
      list=list.filter(function(p){return p.createdBy===S.filterCreatedBy});
    }
  }
  if(q){list=list.filter(function(p){var h=[p.title,p.community,p.developer,p.description,p.address,p.ownerName,p.ownerPhone,p.building,p.unit,p.room,(p.tags||[]).join(' ')].join(' ').toLowerCase();return h.indexOf(q)>=0})}
  if(f.area)list=list.filter(function(p){return p.district===f.area});
  if(f.block)list=list.filter(function(p){return p.block===f.block});
  if(f.community){var cf=f.community.toLowerCase();list=list.filter(function(p){return(p.community||'').toLowerCase().indexOf(cf)>=0||(p.developer||'').toLowerCase().indexOf(cf)>=0||(p.title||'').toLowerCase().indexOf(cf)>=0})}
  if(f.building){var bf=f.building.toLowerCase();list=list.filter(function(p){return(p.building||'').toLowerCase().indexOf(bf)>=0})}
  if(f.unit){var uf=f.unit.toLowerCase();list=list.filter(function(p){return(p.unit||'').toLowerCase().indexOf(uf)>=0})}
  if(f.room){var rf=f.room.toLowerCase();list=list.filter(function(p){return(p.room||'').toLowerCase().indexOf(rf)>=0})}
  if(f.areaSeg){var seg=f.areaSeg.split('-');var lo=parseFloat(seg[0]);var hi=parseFloat(seg[1]);list=list.filter(function(p){
    var a=parseFloat(p.area)||0;
    if(!a&&p.availableLayouts){
      var nums=(p.availableLayouts.match(/\d+/g)||[]).map(function(n){return parseFloat(n)});
      if(nums.length>0)a=Math.max.apply(null,nums);
    }
    if(!a)return false;
    return a>=lo&&a<hi;
  })}
  if(f.totalPrice){var seg0=f.totalPrice.split('-');var lo0=parseFloat(seg0[0]);var hi0=parseFloat(seg0[1]);list=list.filter(function(p){
    var pr=parseFloat(p.totalPrice)||parseFloat(p.rentPrice)||0;
    return pr>=lo0&&pr<hi0;
  })}
  if(f.unitPrice){var seg2=f.unitPrice.split('-');var lo2=parseFloat(seg2[0]);var hi2=parseFloat(seg2[1]);list=list.filter(function(p){
    var ap=parseFloat(p.averagePrice)||(p.area>0?Math.round(p.totalPrice*10000/p.area):0);
    return ap>=lo2&&ap<hi2;
  })}
  if(f.decoration)list=list.filter(function(p){return p.decoration===f.decoration});
  if(f.tag)list=list.filter(function(p){return(p.tags||[]).indexOf(f.tag)>=0});
  if(f.metro)list=list.filter(function(p){return(p.metro||'').indexOf(f.metro)>=0});
  if(f.special==='hasKey')list=list.filter(function(p){return p.hasKey===true});
  if(f.special==='hasOwner')list=list.filter(function(p){return p.ownerPhone&&p.ownerPhone.length>0});
  if(f.special==='hasMedia')list=list.filter(function(p){return S.media&&S.media.some(function(m){return m.propertyId===p.id})});
  if(f.special==='pinned')list=list.filter(function(p){return(S.pinnedPropIds||[]).indexOf(p.id)>=0});
  if(f.creator)list=list.filter(function(p){return p.createdBy===f.creator});
  if(f.special==='invalid')list=list.filter(function(p){return !!p.invalid||(p.invalidPending&&p.invalidPending.status==='pending')});
  /* 二手房源/租赁默认隐藏「下架」房源；选「已下架」特色才单独看得到 */
  if(f.special==='delisted'){
    list=list.filter(function(p){return p.status==='下架'});
  }else if(!f.special){
    list=list.filter(function(p){return p.status!=='下架'});
  }
  var sk=S.propSort;
  list.sort(function(a,b){
    var ia=a.invalid?1:0,ib=b.invalid?1:0;if(ia!==ib)return ia-ib;  /* 无效房源沉底 */
    if(sk==='totalPrice')return(a.totalPrice||999999)-(b.totalPrice||999999);
    if(sk==='totalPriceDesc')return(b.totalPrice||0)-(a.totalPrice||0);
    if(sk==='unitPrice')return(a.unitPrice||0)-(b.unitPrice||0);
    if(sk==='area')return(a.area||0)-(b.area||0);
    if(sk==='createdAt')return(b.createdAt||0)-(a.createdAt||0);
    return(b.updatedAt||0)-(a.updatedAt||0);
  });
  return list;
}

/* ========== Property: List ========== */
/* ========== 房源MD（业主名单） ========== */
function renderMDList(){
  try{
    var grid=document.getElementById('propertyGrid');
    var table=document.getElementById('propertyTable');
    if(table)table.style.display='none';
    if(grid){grid.style.display='block';grid.style.gridTemplateColumns='';grid.style.gap='';grid.style.alignItems='';}
    /* MD页面不需要通用的「房源筛选」栏（区域一），隐藏掉 */
    var pfb=document.getElementById('propFilterBar');
    if(pfb)pfb.style.display='none';
    /* 无权限：锁定页 + 管理员授权入口 */
    if(!canViewMD()){
      var lock='<div class="empty" style="grid-column:1/-1">'
        +'<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
        +'<h3>房源MD · 业主名单（受限）</h3>'
        +'<p>该模块仅管理员及被授权成员可查看，非授权成员在云端即被隔离，打不开也看不到。</p>'
        +(isAdmin()?'<p style="color:var(--text-secondary)">你是管理员，可在下方为成员开通查看权限。</p>':'')
        +'</div>';
      if(isAdmin())lock+='<div style="grid-column:1/-1;margin-top:6px">'+renderMDGrantUI()+'</div>';
      grid.innerHTML=lock;bindMDGrantUI();return;
    }
    /* 小区列表从服务端一次性取（缓存到 S._mdComms），避免把 2 万条名单拉进内存只为拿小区名 */
    if(S._mdComms) _renderMDToolbar();
    else fetch(API_BASE+'/api/md/communities',{headers:getAuthHeader()})
      .then(function(r){ if(!r.ok)throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(d){ S._mdComms=(d&&d.communities)||[]; _renderMDToolbar(); })
      .catch(function(e){ console.error('[md communities]',e); S._mdComms=[]; _renderMDToolbar(); });
  }catch(err){console.error('[renderMDList]',err)}
}
function _renderMDToolbar(){
  try{
    var grid=document.getElementById('propertyGrid');if(!grid)return;
    var f=S.mdFilters||(S.mdFilters={community:'',room:'',onlyListed:false});
    var comms=(S._mdComms||[]).slice();
    grid.innerHTML='<div class="md-toolbar" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;position:relative">'
      /* 小区搜索：自定义下拉列表（点击弹出，8行可滚动，支持输入筛选+点击选择） */
      +'<div style="position:relative" id="mdCommWrap">'
      +'<input id="mdCommFilter" placeholder="搜索/选择小区（共 '+comms.length+'）" value="'+esc(f.community||'')+'" style="height:40px;border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:0 10px;font-size:.875rem;min-width:200px">'
      +'<div id="mdCommDropdown" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;background:#fff;border:1px solid var(--gray-200);border-radius:var(--radius-sm);box-shadow:0 4px 12px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;margin-top:4px"></div>'
      +'</div>'
      +'<input id="mdRoomFilter" placeholder="筛选房号，如 101 / 3幢" value="'+esc(f.room||'')+'" style="height:40px;border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:0 10px;font-size:.875rem;min-width:170px">'
      +'<label style="font-size:.8125rem;display:flex;align-items:center;gap:4px;color:var(--text-secondary)"><input type="checkbox" id="mdOnlyListed"'+(f.onlyListed?' checked':'')+'>仅看已上架</label>'
      +'</div><div id="mdResults"></div>'
      +(isAdmin()?'<div style="margin-top:14px">'+renderMDGrantUI()+'</div>':'');
    /* 填充小区下拉列表 */
    window._mdAllComms=comms; /* 供 bindMDToolbar 使用 */
    renderMDResults();
    bindMDToolbar();
    bindMDGrantUI();
  }catch(err){console.error('[_renderMDToolbar]',err)}
}
function renderMDResults(){
  try{
    var box=document.getElementById('mdResults');if(!box)return;
    if(!canViewMD())return;
    var f=S.mdFilters||{community:'',room:'',onlyListed:false};
    box.innerHTML='<div style="padding:30px 20px;text-align:center;color:var(--text-muted);font-size:.875rem">⏳ 正在读取业主名单…</div>';
    fetchMDSubset(f,function(err,res){
      if(err){ box.innerHTML='<div class="empty"><h3>读取失败</h3><p>'+esc((err&&err.message)||err)+'</p></div>'; return; }
      _renderMDTable((res&&res.items)||[]);
    });
  }catch(err){console.error('[renderMDResults]',err)}
}
/* 渲染「当前筛选」拉回的业主名单子集（已服务端过滤，最多 400 条） */
function _renderMDTable(items){
  try{
    var box=document.getElementById('mdResults');if(!box)return;
    var f=S.mdFilters||{};
    var total=(typeof S._mdTotal!=='undefined')?S._mdTotal:items.length;
    var listed=(typeof S._mdListed!=='undefined')?S._mdListed:0;
    var head='<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 2px 8px;font-size:.8125rem;color:var(--text-secondary)">'
      +'<span>共 <b style="color:var(--text-primary)">'+total+'</b> 条名单，已上架 <b style="color:var(--text-primary)">'+listed+'</b> 套'
      +(f.community||f.room||f.onlyListed?('，当前显示 <b style="color:var(--text-primary)">'+items.length+'</b> 条'):'')
      +'</span></div>';
    if(items.length===0){
      box.innerHTML=head+'<div class="empty"><h3>没有匹配的名单</h3><p>'+(total===0?'点右上角「录入名单」粘贴业主表格即可批量导入':'请调整上方筛选条件')+'</p></div>';
      return;
    }
    var CAP=400,shown=items.slice(0,CAP);
    var rows=shown.map(function(p){
      var loc=[p.building?p.building+'幢':'',(p.unit&&p.unit!=='1单元')?p.unit.replace(/单元$/,'')+'单元':'',p.room?p.room+'室':''].filter(Boolean).join(' ');
      var st=p.status||'未上架';
      var isListed=st==='在售'||st==='在租';
      return '<tr data-mdid="'+p.id+'">'
        +'<td>'+esc(p.community||'')+'</td>'
        +'<td>'+esc(loc||p.room||'')+'</td>'
        +'<td>'+esc(p.ownerName||'')+'</td>'
        +'<td class="ct-phone">'+(p.ownerPhone?p.ownerPhone.split(/\s*\/\s*/).filter(Boolean).map(function(ph){return'<a href="tel:'+esc(ph)+'" style="color:var(--primary)">'+esc(ph)+'</a>'}).join('<br>'):'')+'</td>'
        +'<td>'+(p.area?p.area+'㎡':'')+'</td>'
        +'<td><select class="md-status-sel" data-mdid="'+p.id+'" style="height:34px;border:1px solid var(--gray-200);border-radius:6px;padding:0 6px;font-size:.8125rem;background:#fff">'
          +'<option value="未上架"'+('未上架'===st?' selected':'')+'>未上架</option>'
          +'<option value="在售"'+('在售'===st?' selected':'')+'>在售→二手房</option>'
          +'<option value="在租"'+('在租'===st?' selected':'')+'>在租→租赁</option>'
          +'</select>'+(isListed?' <span style="color:var(--success);font-size:.75rem">已上架</span>':'')+'</td>'
        +'<td><button class="md-del" data-mdid="'+p.id+'" style="border:1px solid var(--gray-200);background:#fff;border-radius:6px;padding:4px 8px;font-size:.75rem;color:var(--danger);cursor:pointer">删除</button></td>'
        +'</tr>';
    }).join('');
    var table='<div style="overflow:auto;border:1px solid var(--gray-200);border-radius:var(--radius-md);background:#fff;max-height:calc(100vh - 280px)">'
      +'<table class="client-table md-table" style="font-size:.8125rem"><thead><tr>'
      +'<th>小区</th><th>楼幢/单元/房号</th><th>业主</th><th>电话</th><th>面积</th><th>上架状态</th><th>操作</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    var more=(total>shown.length)?'<div style="padding:8px;color:var(--text-muted);font-size:.75rem">为性能仅显示前 '+shown.length+' 条，请用上方筛选缩小范围（剩余 '+(total-shown.length)+' 条）。</div>':'';
    box.innerHTML=head+table+more;
    bindMDResultsUI();
  }catch(err){console.error('[_renderMDTable]',err)}
}
function bindMDToolbar(){
  var cf=document.getElementById('mdCommFilter');
  var dd=document.getElementById('mdCommDropdown');
  if(cf&&dd){
    var comms=window._mdAllComms||[];
    /* 渲染下拉列表 */
    function renderDropdown(filter){
      var kw=(filter||'').toLowerCase();
      var filtered=kw?comms.filter(function(c){return c.toLowerCase().indexOf(kw)>=0}):comms;
      if(filtered.length===0){
        dd.innerHTML='<div style="padding:10px 14px;color:var(--text-muted);font-size:.8125rem">无匹配小区</div>';
      }else{
        dd.innerHTML=filtered.map(function(c){
          return '<div class="md-comm-item" data-val="'+esc(c)+'" style="padding:8px 12px;font-size:.875rem;cursor:pointer;border-bottom:1px solid var(--gray-100)'+(c===(cf.value||'')?';background:#eff6ff;color:var(--primary);font-weight:600':'')+'">'+esc(c)+'</div>';
        }).join('');
        /* 绑定点击选择 */
        dd.querySelectorAll('.md-comm-item').forEach(function(item){
          item.addEventListener('click',function(e){
            e.stopPropagation();
            var val=this.getAttribute('data-val');
            cf.value=val;
            S.mdFilters=S.mdFilters||{};S.mdFilters.community=val;
            dd.style.display='none';
            renderMDResults();
          });
        });
      }
    }
    /* 点击/聚焦 → 显示下拉 */
    cf.addEventListener('focus',function(){renderDropdown(cf.value);dd.style.display='block';});
    cf.addEventListener('click',function(){if(dd.style.display==='none'){renderDropdown(cf.value);dd.style.display='block';}});
    /* 输入时实时筛选 */
    cf.addEventListener('input',function(){
      var val=this.value.trim();
      S.mdFilters=S.mdFilters||{};S.mdFilters.community=val;
      renderDropdown(val);
      dd.style.display='block';
      renderMDResults();
    });
    /* 点击外部关闭 */
    document.addEventListener('mousedown',function(e){
      if(e.target.closest('#mdCommWrap'))return;
      dd.style.display='none';
    });
    /* 初始渲染（如果有值则不自动展开） */
    if(comms.length>0)renderDropdown(cf.value);
  }
  var rf=document.getElementById('mdRoomFilter');
  if(rf)rf.oninput=function(){S.mdFilters=S.mdFilters||{};S.mdFilters.room=rf.value;renderMDResults();};
  var ol=document.getElementById('mdOnlyListed');
  if(ol)ol.onchange=function(){S.mdFilters=S.mdFilters||{};S.mdFilters.onlyListed=ol.checked;renderMDResults();};
  /* MD 内容异步加载完成后，再播一次入场动画，让工具栏+列表带过渡出现 */
  playViewEnter();
}
function bindMDResultsUI(){
  document.querySelectorAll('.md-status-sel').forEach(function(sel){
    sel.onchange=function(){var id=sel.getAttribute('data-mdid');applyMDStatus(id,sel.value);};
  });
  document.querySelectorAll('.md-del').forEach(function(btn){
    btn.onclick=function(){
      var id=btn.getAttribute('data-mdid');
      var md=(S._mdDisplay||[]).filter(function(x){return x.id===id})[0] || findProp(id);
      if(md&&!canDeleteProp(md)){toast('仅管理员或录入人可删除','error');return;}
      if(!confirm('确定删除该名单记录？其已上架的房源也会一并下架。'))return;
      if(md){
        ['sell','rent'].forEach(function(m){var lid='md_'+id+'_'+m;if(findProp(lid)){S.properties=S.properties.filter(function(p){return p.id!==lid});S.pendingDeletes=S.pendingDeletes||{clients:[],properties:[],transactions:[]};if(S.pendingDeletes.properties.indexOf(lid)<0)S.pendingDeletes.properties.push(lid);}});
      }
      S._mdDisplay=(S._mdDisplay||[]).filter(function(x){return x.id!==id});
      mergeMDSubset(S._mdDisplay); /* 从 S.properties 移除该名单，saveP→sync 落库 */
      S.pendingDeletes=S.pendingDeletes||{clients:[],properties:[],transactions:[]};
      if(S.pendingDeletes.properties.indexOf(id)<0)S.pendingDeletes.properties.push(id);
      saveP();toast('已删除名单记录','success');renderMDList();
    };
  });
}
/* 名单上架状态变更：未上架/在售/在租 三者互斥，对应的二手房/租赁房源随之生成或下架 */
function applyMDStatus(id,newVal){
  var md=(S._mdDisplay||[]).filter(function(x){return x.id===id})[0] || findProp(id);
  if(!md||md.type!=='md')return;
  ['sell','rent'].forEach(function(m){
    var lid='md_'+id+'_'+m;
    if(findProp(lid)){
      S.properties=S.properties.filter(function(p){return p.id!==lid});
      S.pendingDeletes=S.pendingDeletes||{clients:[],properties:[],transactions:[]};
      if(S.pendingDeletes.properties.indexOf(lid)<0)S.pendingDeletes.properties.push(lid);
    }
  });
  if(newVal==='在售')makeMDListing(md,'sell');
  else if(newVal==='在租')makeMDListing(md,'rent');
  md.status=newVal;md.updatedAt=now();
  mergeMDSubset(S._mdDisplay); /* 确保改动后的名单已在 S.properties，saveP→sync 才能落库 */
  saveP();
  toast(newVal==='未上架'?'已下架':('已上架到'+(newVal==='在售'?'二手房':'租赁')+'列表'),'success');
  renderMDList();
}
function makeMDListing(md,mode){
  var propType=mode==='sell'?'secondhand':'rental';
  var lid='md_'+md.id+'_'+mode;
  var exist=findProp(lid);
  if(!exist){
    S.properties.push({id:lid,type:propType,
      community:md.community||'',district:md.district||'',block:md.block||'',
      building:md.building||'',unit:md.unit||'',room:md.room||'',
      area:md.area||0,layout:md.layout||'',
      ownerName:md.ownerName||'',ownerPhone:md.ownerPhone||'',ownerReserve:md.ownerReserve||'',
      address:md.address||'',description:md.description||'',
      status:mode==='sell'?'在售':'在租',
      tags:[],createdBy:S.currentUser?S.currentUser.id:'',createdByName:S.currentUser?S.currentUser.name:'',
      mdSourceId:md.id,createdAt:now(),updatedAt:now(),linkedClientIds:[],title:(md.community||'')+' '+(md.room||'')});
  }else{
    exist.community=md.community||exist.community;exist.building=md.building||exist.building;
    exist.unit=md.unit||exist.unit;exist.room=md.room||exist.room;exist.area=md.area||exist.area;
    exist.ownerName=md.ownerName||exist.ownerName;exist.ownerPhone=md.ownerPhone||exist.ownerPhone;
    exist.status=mode==='sell'?'在售':'在租';exist.updatedAt=now();
  }
}
/* 房源MD 授权管理（仅管理员可见可操作） */
function renderMDGrantUI(){
  if(!isAdmin())return'';
  var me=S.currentUser?S.currentUser.id:null;
  var users=(S.allUsers||[]).filter(function(u){return u.id!==me});
  if(!users.length)return'<div style="border:1px solid var(--gray-200);border-radius:var(--radius);padding:12px;background:var(--card);font-size:.8125rem;color:var(--text-secondary)">暂无其他成员</div>';
  var rows=users.map(function(u){
    var on=S.mdViewers&&S.mdViewers.indexOf(u.id)>=0;
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--gray-100)">'
      +'<span style="font-size:.875rem">'+esc(u.name||u.username||u.id)+(u.role==='admin'?'（管理员）':'')+'</span>'
      +'<button class="md-grant-btn" data-uid="'+esc(u.id)+'" style="border:1px solid '+(on?'var(--success)':'var(--gray-200)')+';background:'+(on?'rgba(34,197,94,.1)':'#fff')+';color:'+(on?'var(--success)':'var(--text-primary)')+';border-radius:6px;padding:5px 10px;font-size:.75rem;cursor:pointer">'+(on?'取消授权':'授权查看')+'</button>'
      +'</div>';
  }).join('');
  return '<div style="border:1px solid var(--gray-200);border-radius:var(--radius);padding:12px;background:var(--card)">'
    +'<div style="font-weight:600;margin-bottom:6px">房源MD 查看授权</div>'
    +'<div style="font-size:.75rem;color:var(--text-muted);margin-bottom:4px">被授权成员可在「房源MD」页查看全部业主名单；未授权成员在云端即被隔离，看不到也打不开。</div>'
    +rows+'</div>';
}
function bindMDGrantUI(){
  document.querySelectorAll('.md-grant-btn').forEach(function(btn){
    btn.onclick=function(){
      var uid=btn.getAttribute('data-uid');
      if(S.mdViewers&&S.mdViewers.indexOf(uid)>=0)revokeMDView(uid);else grantMDView(uid);
      renderMDList();
    };
  });
}


function renderPropertyList(){
  try{
  updateFilterBadge('propFilterToggle',S.propFilters);
  /* 房源MD（业主名单）：独立渲染，不参与二手房/租赁的卡片/表格布局 */
  if(S.subtab==='md'){renderMDList();return;}
  /* 非MD标签页：恢复显示通用筛选栏（区域一） */
  var pfb=document.getElementById('propFilterBar');
  if(pfb)pfb.style.display='';
  var grid=document.getElementById('propertyGrid');
  var table=document.getElementById('propertyTable');
  /* 重置propertyGrid为普通列表布局（防止从小区详情页返回残留两栏样式） */
  if(grid){grid.style.gridTemplateColumns='';grid.style.gap='';grid.style.alignItems=''}
  if(S.propViewMode==='table'){
    grid.style.display='none';
    table.style.display='';
    renderPropertyTable();
    return;
  }
  grid.style.display='';
  table.style.display='none';
  var list=getFilteredProperties();
  document.getElementById('propResultCount').innerHTML='共 <b>'+list.length+'</b> 套房源 '+(isAdmin()?'<button class="btn btn-sm btn-outline" onclick="exportCurrentCSV(\x27properties\x27)" style="margin-left:12px;font-size:.75rem" title="导出房源列表为CSV">📥 导出CSV</button>':'');
  /* 批量操作栏（卡片+表格共享 #propBatchBar 容器，只渲染一次） */
  var checkedCount=S.checkedPropIds?(S.checkedPropIds.length):0;
  if(S.propBatchMode){
    var batchBarEl=document.getElementById('propBatchBar');
    if(batchBarEl){
      batchBarEl.style.display='';
      batchBarEl.className='prop-batch-bar show';
      batchBarEl.innerHTML=''
        +'<span class="bb-count" id="propCheckedCount">已选 '+checkedCount+' 条房源</span>'
        +'<button class="btn btn-outline btn-sm" id="propSelectAll">全选当前</button>'
        +'<button class="btn btn-outline btn-sm" id="propClearCheck">清空选择</button>'
        +(checkedCount>0
          ?'<button class="btn btn-primary btn-sm" id="propBatchStatus">批量改状态('+checkedCount+')</button>'
            +'<button class="btn btn-success btn-sm" id="propBatchTag">批量打标签('+checkedCount+')</button>'
    +'<button class="btn btn-outline btn-sm" id="propBatchCompare" style="color:var(--info)">📊 房源对比('+checkedCount+')</button>'
            +(isAdmin()?'<button class="btn btn-danger btn-sm" id="propBatchDelete">批量删除('+checkedCount+')</button>':'')
            +'<button class="btn btn-outline btn-sm" id="propExitBatch">退出批量</button>'
          :''
        );
      bindBatchBar();
    }
  }else{
    var bb=document.getElementById('propBatchBar');
    if(bb)bb.style.display='none';
  }
  if(list.length===0){
    grid.innerHTML='<div class="empty" style="grid-column:1/-1"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg><h3>'+(S.properties.length===0?'还没有房源档案':'没有符合条件的房源')+'</h3><p>'+(S.properties.length===0?'点击「新增房源」按钮，开始录入':'试试调整筛选条件')+'</p></div>';
    return;
  }
  grid.innerHTML=list.map(function(p){
    var price;
    if(p.type==='rental'){
      price=p.rentPrice?p.rentPrice+'<span class="unit">元/月</span>':'';
    }else if(p.type==='secondhand'){
      price=p.totalPrice?p.totalPrice+'<span class="unit">万</span>':'';
    }else{
      price=p.averagePriceText?('<span style="font-size:1rem">'+esc(p.averagePriceText)+'</span>'):(p.averagePrice?p.averagePrice+'<span class="unit">元/㎡</span>':'');
    }
    var typeLabel=p.type==='secondhand'?'二手房':(p.type==='rental'?'租赁':'新楼盘');
    var info;
    if(p.type==='rental'){
      info=[p.area?p.area+'㎡':'',p.layout||'',p.depositType||'',p.rentType||''].filter(Boolean);
    }else if(p.type==='secondhand'){
      info=[p.area?p.area+'㎡':'',p.layout||'',p.orientation||''].filter(Boolean);
      // 楼幢单元房间号（带单位+醒目样式，单独渲染避免被esc转义）
      var locHtml='';
      {var _lp=[];if(p.building)_lp.push(p.building+'幢');if(p.unit)_lp.push((p.unit||'').replace(/单元$/,'')+'单元');if(p.room)_lp.push(p.room+'室');var _ls=_lp.join('');if(_ls)locHtml='<span style="color:var(--primary);font-weight:600;font-size:.875rem">'+esc(_ls)+'</span>';}
    }else{
      info=[p.developer||'',p.availableLayouts||''].filter(Boolean);
    }
    var tags=(p.tags||[]).map(function(t){return'<span class="client-tag">'+esc(t)+'</span>'}).join('');
    var propPinned=(S.pinnedPropIds||[]).indexOf(p.id)>=0;
    var titleDisplay=p.type==='secondhand'||p.type==='rental' ? (cleanCommunityName(p.community)||p.title||'未命名') : (p.title||'未命名');
    var pPend=p.invalidPending&&p.invalidPending.status==='pending'&&!p.invalid;
    var isChecked=(S.checkedPropIds||[]).indexOf(p.id)>=0;
    return'<div class="property-card'+(propPinned?' pinned':'')+(p.invalid?' is-invalid':'')+(S.propBatchMode?' prop-batch-mode':'')+(isChecked?' prop-selected':'')+'" data-status="'+esc(p.status)+'" data-id="'+p.id+'">'
      +(S.propBatchMode?'<div class="prop-check-wrap"><input type="checkbox" class="prop-card-check" data-prop-id="'+p.id+'" '+(isChecked?'checked':'')+'></div>':'')
      +(propPinned?'<div style="position:absolute;top:8px;right:8px;z-index:2;font-size:1rem">⭐</div>':'')
      +(p.invalid?'<span class="invalid-corner">无效</span>':(pPend?'<span class="invalid-corner pending">待审</span>':''))
      +'<div class="card-thumb no-img" data-thumb="'+p.id+'"><span class="type-label">'+typeLabel+'</span><span class="media-count" data-media-count="'+p.id+'" style="display:none"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span class="mc-num">0</span></span></div>'
      +'<div class="card-body"><div class="card-title">'+esc(titleDisplay||'未命名')+'</div><div class="card-price">'+price+'</div>'
      +'<div class="card-info">'+locHtml+info.map(function(i){return'<span>'+esc(i)+'</span>'}).join('')+'</div>'
      +(tags?'<div class="prop-tags">'+tags+'</div>':'')
      +'<div class="card-info"><span>'+esc(p.district||'')+(p.block?('·'+esc(p.block)):'')+'</span><span class="status-badge" data-status="'+esc(p.status)+'">'+esc(p.status)+'</span></div>'
      +'<div class="card-actions"><button data-action="pview" data-id="'+p.id+'">详情</button><button data-action="pshare" data-id="'+p.id+'">分享</button><button data-action="ppin" data-id="'+p.id+'" title="'+(propPinned?'取消重点':'标为重点')+'">'+(propPinned?'⭐取消':'⭐重点')+'</button><button data-action="pedit" data-id="'+p.id+'">编辑</button></div>'
      +'</div></div>';
  }).join('');
  grid.querySelectorAll('.property-card').forEach(function(card){
    card.addEventListener('click',function(e){
      if(e.target.closest('button'))return;
      if(e.target.closest('.prop-card-check'))return; /* checkbox 自己处理 */
      if(S.propBatchMode){ /* 批量模式：点击卡片切换选中 */
        var id=card.getAttribute('data-id');
        S.checkedPropIds=S.checkedPropIds||[];
        var idx=S.checkedPropIds.indexOf(id);
        if(idx>=0)S.checkedPropIds.splice(idx,1);else S.checkedPropIds.push(id);
        card.classList.toggle('prop-selected',idx<0);
        var cb=card.querySelector('.prop-card-check');
        if(cb)cb.checked=idx<0;
        updatePropBatchBar();
        return;
      }
      showPropertyDetail(card.getAttribute('data-id'));
    });
  });
  /* 卡片 checkbox 点击 */
  grid.querySelectorAll('.prop-card-check').forEach(function(cb){
    cb.addEventListener('click',function(e){
      e.stopPropagation();
      var id=this.getAttribute('data-prop-id');
      S.checkedPropIds=S.checkedPropIds||[];
      var idx=S.checkedPropIds.indexOf(id);
      if(this.checked){if(idx<0)S.checkedPropIds.push(id);}
      else{if(idx>=0)S.checkedPropIds.splice(idx,1);}
      this.closest('.property-card').classList.toggle('prop-selected',this.checked);
      updatePropBatchBar();
    });
  });
  grid.querySelectorAll('.card-actions button').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();var a=btn.getAttribute('data-action'),id=btn.getAttribute('data-id');
      if(a==='pview')showPropertyDetail(id);
      if(a==='pedit')openPropertyForm(id);
      if(a==='pshare')copyPropertyInfo(id);
      if(a==='ppin'){
        S.pinnedPropIds=S.pinnedPropIds||[];
        var idx=S.pinnedPropIds.indexOf(id);
        if(idx>=0)S.pinnedPropIds.splice(idx,1);
        else S.pinnedPropIds.push(id);
        renderPropertyList();
        toast(idx>=0?'已取消重点房源':'已标为重点房源','success');
      }
    });
  });
  // Async load thumbnails
  list.forEach(function(p){
    MediaDB.list(p.id).then(function(media){
      /* 优先显示用户选定的封面（coverMediaId） */
      var img;
      if(p.coverMediaId){img=media.find(function(m){return m.id===p.coverMediaId})}
      if(!img){img=media.find(function(m){return m.type==='image'})}
      var el=document.querySelector('[data-thumb="'+p.id+'"]');
      if(img&&el){el.style.backgroundImage='url('+img.dataUrl+')';el.classList.remove('no-img')}
      if(media.length>0){
        var mc=document.querySelector('[data-media-count="'+p.id+'"]');
        if(mc){mc.style.display='';mc.querySelector('.mc-num').textContent=media.length}
      }
    });
  });
  }catch(err){console.error('[renderPropertyList]',err)}
}

/* ========== Community (二手小区) ========== */
/* 小区名称归一化（去重关键）：去掉首尾与内部多余空格、全角空格 */
function normalizeCommunityName(n){
  if(!n)return n;
  return (n+'').trim().replace(/[\s　]+/g,' ');
}
/* 小区去重/隔离（#2 修复"小区被房源污染"）
   把"仅被二手房/租赁房源引用、但没有真实概况记录"的小区名，
   自动补全为一条真实的 type==='community' 记录（按归一化名称去重）。
   这样小区列表里不会出现 info:null 的幽灵小区，房源引用也被隔离进真实小区。
   幂等：只在确实缺失时新增；renderCommunityList 开头也会调用，无递归。 */
function ensureCommunities(){
  try{
    if(!S.properties||!S.properties.length)return 0;
    var existing={};
    S.properties.forEach(function(p){
      if(p.type==='community'){
        var nm=normalizeCommunityName(p.title||p.community);
        if(nm)existing[nm]=true;
      }
    });
    var toAdd=[];
    S.properties.forEach(function(p){
      if(p.type!=='secondhand'&&p.type!=='rental')return;
      if(!p.community)return;
      var nm=normalizeCommunityName(p.community);
      if(!nm)return;
      if(p.community!==nm)p.community=nm; /* 同步归一化房源里的引用名，避免"同名不同形"产生重复小区 */
      if(!existing[nm]){
        toAdd.push({id:uuid(),type:'community',title:nm,community:nm,
          district:p.district||'',block:p.block||'',
          createdAt:p.createdAt||now(),updatedAt:now()});
        existing[nm]=true;
      }
    });
    if(toAdd.length){
      S.properties=S.properties.concat(toAdd);
      saveP();
    }
    return toAdd.length;
  }catch(e){console.error('[ensureCommunities]',e);return 0}
}
function renderCommunityList(){
  try{
  ensureCommunities(); /* #2：先补全被房源引用但未建概况的小区，防止幽灵项 */
  /* 如果在详情模式，渲染详情页 */
  if(S.communityDetail){
    renderCommunityDetail();
    return;
  }
  /* 重置propertyGrid为普通列表布局（防止从详情页返回时残留两栏样式） */
  var grid0=document.getElementById('propertyGrid');
  if(grid0){grid0.style.gridTemplateColumns='';grid0.style.gap='';grid0.style.alignItems=''}
  /* 恢复新增按钮文案 */
  var addBtn0=document.getElementById('addPropBtn');
  if(addBtn0){
    addBtn0.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增小区';
  }
  /* 获取所有小区名称（从二手房+租赁房中提取，加上已有的community类型记录） */
  var communityMap={};
  /* 先从 community 类型记录中获取已有概况 */
  S.properties.filter(function(p){return p.type==='community'}).forEach(function(c){
    var name=c.title||c.community||'';
    if(name)communityMap[name]={info:c,forSale:0,forRent:0,sold:0,rented:0,onHold:0,total:0};
  });
  /* 从二手房+租赁房中统计（#2：小区记录已由 ensureCommunities 补全，不再生成 info:null 幽灵项） */
  S.properties.filter(function(p){return p.type==='secondhand'||p.type==='rental'}).forEach(function(p){
    var name=p.community||'';
    if(!name)return;
    if(!communityMap[name])return; /* 理论上不会触发，ensureCommunities 已补全 */
    communityMap[name].total++;
    var st=p.status||'';
    if(st==='在售'||st==='待售')communityMap[name].forSale++;
    else if(st==='在租'||st==='空置待租'||st==='到期可看')communityMap[name].forRent++;
    else if(st==='已售'||st==='售罄')communityMap[name].sold++;
    else if(st==='已租')communityMap[name].rented++;
    else if(st==='暂缓')communityMap[name].onHold++;
  });
  var names=Object.keys(communityMap).sort();
  var grid=document.getElementById('propertyGrid');
  var table=document.getElementById('propertyTable');
  if(grid)grid.style.display='';
  if(table)table.style.display='none';

  /* ========== 应用筛选 ========== */
  var cf=S.communityFilters||(S.communityFilters={district:'',status:'',keyword:'',sort:'updatedAt'});
  var allNames=names.slice();
  /* 提取所有区域+板块供下拉 */
  var districtSet={};
  allNames.forEach(function(n){
    var d=(communityMap[n].info&&communityMap[n].info.district)||communityMap[n].district||'';
    if(d)districtSet[d]=1;
  });
  var districts=Object.keys(districtSet).sort();
  /* 应用区域筛选 */
  var filteredNames=allNames.filter(function(n){
    var d=(communityMap[n].info&&communityMap[n].info.district)||communityMap[n].district||'';
    if(cf.district&&d!==cf.district)return false;
    /* 应用状态筛选（小区内至少有一套该状态房源） */
    if(cf.status){
      var c=communityMap[n];
      if(cf.status==='onSale'&&!c.forSale)return false;
      if(cf.status==='onRent'&&!c.forRent)return false;
      if(cf.status==='onHold'&&!c.onHold)return false;
      if(cf.status==='sold'&&!c.sold)return false;
      if(cf.status==='rented'&&!c.rented)return false;
    }
    /* 应用关键字搜索 */
    if(cf.keyword){
      var k=cf.keyword.toLowerCase();
      var hay=n.toLowerCase();
      if(hay.indexOf(k)<0){
        var info=communityMap[n].info;
        if(!info)return false;
        var addstr=(info.street||'')+(info.neighborhood||'')+(info.address||'');
        if(addstr.toLowerCase().indexOf(k)<0)return false;
      }
    }
    return true;
  });
  /* 排序 */
  filteredNames.sort(function(a,b){
    if(cf.sort==='name')return a.localeCompare(b,'zh-CN');
    if(cf.sort==='props')return (communityMap[b].total||0)-(communityMap[a].total||0);
    /* 默认按最新房源更新时间 */
    var latestB=S.properties.filter(function(p){return(p.type==='secondhand'||p.type==='rental')&&(p.community||'')===b}).reduce(function(m,p){return Math.max(m,p.updatedAt||0)},0);
    var latestA=S.properties.filter(function(p){return(p.type==='secondhand'||p.type==='rental')&&(p.community||'')===a}).reduce(function(m,p){return Math.max(m,p.updatedAt||0)},0);
    return latestB-latestA;
  });
  names=filteredNames;

  /* ========== 渲染筛选栏（带下拉折叠按钮） ========== */
  var filterBar='<div class="filter-bar" style="margin-bottom:12px">'
    +'<button class="filter-toggle" id="cmFilterToggle">'
    +'<span>小区筛选</span>'
    +'<svg class="arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>'
    +'</button>'
    +'<div class="filter-body" id="cmFilterBody">'
    +'<div class="filter-row" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
    +'<div class="filter-group" style="display:flex;align-items:center;gap:4px"><label style="font-size:.8125rem;color:var(--text-muted);white-space:nowrap">区域</label>'
    +'<select id="cmFilterDistrict" style="height:32px;padding:0 8px;border:1px solid var(--border);border-radius:6px;font-size:.875rem;background:#fff"><option value="">全部</option>'
    +districts.map(function(d){return'<option value="'+esc(d)+'"'+(cf.district===d?' selected':'')+'>'+esc(d)+'</option>'}).join('')
    +'</select></div>'
    +'<div class="filter-group" style="display:flex;align-items:center;gap:4px"><label style="font-size:.8125rem;color:var(--text-muted);white-space:nowrap">含房源</label>'
    +'<select id="cmFilterStatus" style="height:32px;padding:0 8px;border:1px solid var(--border);border-radius:6px;font-size:.875rem;background:#fff">'
    +'<option value="">全部</option>'
    +'<option value="onSale"'+(cf.status==='onSale'?' selected':'')+'>含在售</option>'
    +'<option value="onRent"'+(cf.status==='onRent'?' selected':'')+'>含在租</option>'
    +'<option value="onHold"'+(cf.status==='onHold'?' selected':'')+'>含暂缓</option>'
    +'<option value="sold"'+(cf.status==='sold'?' selected':'')+'>含已售</option>'
    +'<option value="rented"'+(cf.status==='rented'?' selected':'')+'>含已租</option>'
    +'</select></div>'
    +'<div class="filter-group" style="display:flex;align-items:center;gap:4px;flex:1;min-width:160px"><label style="font-size:.8125rem;color:var(--text-muted);white-space:nowrap">搜索</label>'
    +'<input id="cmFilterKeyword" type="text" placeholder="小区名/街道/社区" value="'+esc(cf.keyword||'')+'" style="height:32px;padding:0 10px;border:1px solid var(--border);border-radius:6px;font-size:.875rem;width:100%;outline:none">'
    +'</div>'
    +'<div class="filter-group" style="display:flex;align-items:center;gap:4px"><label style="font-size:.8125rem;color:var(--text-muted);white-space:nowrap">排序</label>'
    +'<select id="cmFilterSort" style="height:32px;padding:0 8px;border:1px solid var(--border);border-radius:6px;font-size:.875rem;background:#fff">'
    +'<option value="updatedAt"'+(cf.sort==='updatedAt'?' selected':'')+'>最近更新</option>'
    +'<option value="name"'+(cf.sort==='name'?' selected':'')+'>小区名</option>'
    +'<option value="props"'+(cf.sort==='props'?' selected':'')+'>房源数</option>'
    +'</select></div>'
    +(cf.district||cf.status||cf.keyword?'<button id="cmFilterReset" style="height:32px;padding:0 10px;border:1px solid var(--border);background:#fff;border-radius:6px;font-size:.8125rem;cursor:pointer;color:var(--text-secondary)">重置</button>':'')
    +'</div></div></div>';

  document.getElementById('propResultCount').innerHTML=filterBar
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:0 4px"><div style="font-size:.875rem;color:var(--text-secondary)">共 <b style="color:var(--primary);font-size:1rem">'+names.length+'</b> 个小区'+(names.length!==allNames.length?' <span style="font-size:.8125rem;color:var(--text-muted)">/ 全部 '+allNames.length+' 个</span>':'')+'</div></div>';

  /* 绑定筛选事件 */
  var distEl=document.getElementById('cmFilterDistrict');
  var stEl=document.getElementById('cmFilterStatus');
  var kwEl=document.getElementById('cmFilterKeyword');
  var sortEl=document.getElementById('cmFilterSort');
  var resetEl=document.getElementById('cmFilterReset');
  /* 下拉折叠按钮 */
  var cmToggle=document.getElementById('cmFilterToggle');
  var cmBody=document.getElementById('cmFilterBody');
  if(cmToggle&&cmBody){
    /* 有筛选条件时默认展开，否则收起 */
    var hasFilter=cf.district||cf.status||cf.keyword;
    if(hasFilter){cmToggle.classList.add('open');cmBody.classList.add('open')}
    cmToggle.addEventListener('click',function(){
      cmToggle.classList.toggle('open');
      cmBody.classList.toggle('open');
    });
  }
  if(distEl)distEl.addEventListener('change',function(){S.communityFilters.district=this.value;renderCommunityList()});
  if(stEl)stEl.addEventListener('change',function(){S.communityFilters.status=this.value;renderCommunityList()});
  if(sortEl)sortEl.addEventListener('change',function(){S.communityFilters.sort=this.value;renderCommunityList()});
  if(kwEl){
    var kt;kwEl.addEventListener('input',function(){clearTimeout(kt);var v=this.value;kt=setTimeout(function(){S.communityFilters.keyword=v;renderCommunityList()},250)});
  }
  if(resetEl)resetEl.addEventListener('click',function(){S.communityFilters={district:'',status:'',keyword:'',sort:'updatedAt'};renderCommunityList()});

  if(names.length===0){
    grid.innerHTML='<div class="empty" style="grid-column:1/-1"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg><h3>还没有小区档案</h3><p>在二手房或租赁房中录入房源后，小区会自动出现在这里。也可点击「新增小区」手动添加小区概况。</p></div>';
    return;
  }
  grid.innerHTML=names.map(function(name){
    var c=communityMap[name];
    var info=c.info||{};
    var district=c.info?(c.info.district||''):(c.district||'');
    var block=c.info?(c.info.block||''):(c.block||'');
    var locStr=district+(block?('·'+block):'');
    /* 概况信息 */
    var overviewItems=[];
    if(info.buildingCount)overviewItems.push('楼幢：'+esc(info.buildingCount));
    if(info.householdCount)overviewItems.push('户数：'+esc(info.householdCount));
    if(info.buildingAge)overviewItems.push('房龄：'+esc(info.buildingAge));
    if(info.street)overviewItems.push('街道：'+esc(info.street));
    if(info.neighborhood)overviewItems.push('社区：'+esc(info.neighborhood));
    if(info.propertyManagement)overviewItems.push('物业：'+esc(info.propertyManagement));
    /* 学区 */
    var schoolStr='';
    if(info.kindergarten||info.primarySchool||info.middleSchool){
      var schools=[];
      if(info.kindergarten)schools.push('幼儿园：'+esc(info.kindergarten));
      if(info.primarySchool)schools.push('小学：'+esc(info.primarySchool));
      if(info.middleSchool)schools.push('中学：'+esc(info.middleSchool));
      schoolStr=schools.join(' / ');
    }
    /* 物业费 */
    var feeStr='';
    if(info.propertyFees&&info.propertyFees.length>0){
      feeStr=info.propertyFees.map(function(f){return esc(f.type||'')+':'+esc(f.fee||'')}).join('，');
    }
    var hasOverview=!!c.info;
    return'<div class="community-card" data-community="'+esc(name)+'" style="cursor:pointer;transition:all .2s;position:relative;overflow:hidden" onmouseenter="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 8px 20px rgba(37,99,235,.12)\'" onmouseleave="this.style.transform=\'\';this.style.boxShadow=\'\'">'
      +'<div class="card-body" style="padding:16px">'
      +'<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'
      +'<div style="flex:1;min-width:0"><div class="card-title" style="font-size:1.05rem;font-weight:600;display:flex;align-items:center;gap:6px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'+esc(name)+'</div>'
      +'<div class="card-info"><span>'+esc(locStr||'未分类区域')+'</span></div></div>'
      +'<div style="display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0;margin-left:8px">'
      +(c.forSale?'<span class="status-badge" data-status="在售">在售 '+c.forSale+'</span>':'')
      +(c.forRent?'<span class="status-badge" data-status="在租">在租 '+c.forRent+'</span>':'')
      +(c.onHold?'<span class="status-badge" data-status="暂缓">暂缓 '+c.onHold+'</span>':'')
      +(c.sold?'<span class="status-badge" data-status="已售">已售 '+c.sold+'</span>':'')
      +(c.rented?'<span class="status-badge" data-status="已租">已租 '+c.rented+'</span>':'')
      +'</div></div>'
      +(overviewItems.length?'<div class="card-info" style="margin-bottom:4px">'+overviewItems.map(function(s){return'<span>'+s+'</span>'}).join('')+'</div>':'')
      +(schoolStr?'<div style="font-size:.8125rem;color:var(--text-secondary);margin-bottom:4px">'+schoolStr+'</div>':'')
      +(feeStr?'<div style="font-size:.8125rem;color:var(--text-secondary);margin-bottom:4px">物业费：'+feeStr+'</div>':'')
      +(!hasOverview?'<div style="font-size:.8125rem;color:var(--warning);margin-bottom:4px">未填写小区概况，点击进入可补充</div>':'')
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)">'
      +'<div style="font-size:.8125rem;color:var(--text-muted)">共 <b style="color:var(--primary)">'+c.total+'</b> 套房源</div>'
      +'<div style="font-size:.8125rem;color:var(--primary);font-weight:500;display:flex;align-items:center;gap:2px">点击进入详情 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></div>'
      +'</div>'
      +'</div></div>';
  }).join('');
  /* 绑定卡片点击事件 → 进入详情页 */
  grid.querySelectorAll('.community-card').forEach(function(card){
    card.addEventListener('click',function(e){
      if(e.target.closest('button'))return;
      var name=card.getAttribute('data-community');
      S.communityDetail=name;
      S.communityStatusFilter='all';
      renderCommunityDetail();
    });
  });
  }catch(err){console.error('[renderCommunityList]',err);toast('小区列表加载失败: '+err.message,'error')}
}

/* 小区详情页 */
function renderCommunityDetail(){
  try{
  var name=S.communityDetail;
  if(!name){renderCommunityList();return}
  /* 获取小区概况 */
  var info=S.properties.find(function(p){return p.type==='community'&&(p.title===name||p.community===name)})||{};
  /* 获取该小区所有房源 */
  var props=S.properties.filter(function(p){
    return(p.type==='secondhand'||p.type==='rental')&&(p.community||'')===name;
  });
  /* 统计各状态数量 */
  var stats={all:props.length,onSale:0,onRent:0,onHold:0,sold:0,rented:0};
  props.forEach(function(p){
    var st=p.status||'';
    if(st==='在售'||st==='待售')stats.onSale++;
    else if(st==='在租'||st==='空置待租'||st==='到期可看')stats.onRent++;
    else if(st==='已售'||st==='售罄')stats.sold++;
    else if(st==='已租')stats.rented++;
    else if(st==='暂缓')stats.onHold++;
  });
  /* 按状态筛选 */
  var filtered=props;
  var sf=S.communityStatusFilter;
  if(sf==='onSale')filtered=props.filter(function(p){return['在售','待售'].indexOf(p.status||'')>=0});
  else if(sf==='onRent')filtered=props.filter(function(p){return['在租','空置待租','到期可看'].indexOf(p.status||'')>=0});
  else if(sf==='onHold')filtered=props.filter(function(p){return(p.status||'')==='暂缓'});
  else if(sf==='sold')filtered=props.filter(function(p){return['已售','售罄'].indexOf(p.status||'')>=0});
  else if(sf==='rented')filtered=props.filter(function(p){return(p.status||'')==='已租'});

  var grid=document.getElementById('propertyGrid');
  var table=document.getElementById('propertyTable');
  if(grid)grid.style.display='';
  if(table)table.style.display='none';

  /* 构建详情页HTML */
  /* 更新新增按钮文案 */
  var addBtn=document.getElementById('addPropBtn');
  if(addBtn){
    addBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增房源';
  }
  var district=info.district||'';
  var block=info.block||'';
  var locStr=district+(block?('·'+block):'');
  /* 概况信息 */
  var overviewItems=[];
  if(info.buildingCount)overviewItems.push('楼幢：'+esc(info.buildingCount));
  if(info.householdCount)overviewItems.push('户数：'+esc(info.householdCount));
  if(info.buildingAge)overviewItems.push('房龄：'+esc(info.buildingAge));
  if(info.street)overviewItems.push('街道：'+esc(info.street));
  if(info.neighborhood)overviewItems.push('社区：'+esc(info.neighborhood));
  if(info.propertyManagement)overviewItems.push('物业：'+esc(info.propertyManagement));
  var schoolStr='';
  if(info.kindergarten||info.primarySchool||info.middleSchool){
    var schools=[];
    if(info.kindergarten)schools.push('幼儿园：'+esc(info.kindergarten));
    if(info.primarySchool)schools.push('小学：'+esc(info.primarySchool));
    if(info.middleSchool)schools.push('中学：'+esc(info.middleSchool));
    schoolStr=schools.join(' / ');
  }
  var feeStr='';
  if(info.propertyFees&&info.propertyFees.length>0){
    feeStr=info.propertyFees.map(function(f){return esc(f.type||'')+':'+esc(f.fee||'')}).join('，');
  }
  var metroStr='';
  if(info.metro&&info.metro.length){
    metroStr=info.metro.map(function(m){return [m.line,m.station,m.distance].filter(Boolean).join(' ')}).join(' / ');
  }
  var amenityStr='';
  if(info.amenities&&info.amenities.length){
    amenityStr=info.amenities.map(function(a){return [a.type,a.name,a.distance].filter(Boolean).join(' ')}).join(' / ');
  }
  var hasOverview=!!info.id;

  var headerHtml='<div style="margin-bottom:14px">'
    /* 返回按钮 + 操作按钮（第一行：左返回 右编辑） */
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">'
    +'<button id="cmBackBtn" style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border);background:#fff;padding:7px 14px;border-radius:8px;font-size:.875rem;cursor:pointer;color:var(--text-secondary);font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.04)">'
    +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>返回列表</button>'
    +(hasOverview?'<button id="cmViewBtn" style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border);background:#fff;padding:7px 14px;border-radius:8px;font-size:.875rem;cursor:pointer;color:var(--text-secondary);font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.04)">📋 查看概览</button>':'')
    +'<button id="cmEditBtn" style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--primary);background:var(--primary);padding:7px 14px;border-radius:8px;font-size:.875rem;cursor:pointer;color:#fff;font-weight:500;box-shadow:0 2px 6px rgba(37,99,235,.25)">'+(hasOverview?'✎ 编辑概况':'＋ 添加概况')+'</button>'
    +'<button id="cmShareBtn" style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border);background:#fff;padding:7px 14px;border-radius:8px;font-size:.875rem;cursor:pointer;color:var(--text-secondary);font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.04)">📤 生成客户卡片</button>'
    +'</div>'
    /* 小区名标题（第二行：图标+标题+副标题） */
    +'<div style="background:linear-gradient(135deg,var(--primary) 0%,#6366f1 100%);border-radius:12px;padding:14px 16px;color:#fff;box-shadow:0 4px 14px rgba(37,99,235,.18);position:relative;overflow:hidden">'
    +'<div style="position:absolute;top:-20px;right:-20px;width:100px;height:100px;background:rgba(255,255,255,.08);border-radius:50%"></div>'
    +'<div style="position:absolute;bottom:-30px;right:40px;width:60px;height:60px;background:rgba(255,255,255,.06);border-radius:50%"></div>'
    +'<div style="position:relative;display:flex;align-items:flex-start;gap:10px">'
    +'<span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;background:rgba(255,255,255,.2);border-radius:8px;flex-shrink:0;backdrop-filter:blur(8px)">'
    +'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
    +'</span>'
    +'<div style="flex:1;min-width:0;overflow:hidden">'
    +'<div style="font-size:1.125rem;font-weight:600;line-height:1.3;word-break:break-all;overflow-wrap:break-word">'+esc(name)+'</div>'
    +'<div style="font-size:.8125rem;opacity:.9;margin-top:4px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">'
    +'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'
    +esc(locStr||'未分类区域')+'</div></div></div></div>';

  /* ========== 概况信息分组卡片 ========== */
  if(hasOverview||overviewItems.length||schoolStr||feeStr||metroStr||amenityStr){
    var basicInfo=[];
    if(info.buildingCount)basicInfo.push({label:'楼幢数',value:info.buildingCount,icon:''});
    if(info.householdCount)basicInfo.push({label:'总户数',value:info.householdCount+' 户',icon:''});
    if(info.buildingAge)basicInfo.push({label:'房龄',value:info.buildingAge,icon:''});
    if(info.propertyManagement)basicInfo.push({label:'物业公司',value:info.propertyManagement,icon:''});
    if(info.street)basicInfo.push({label:'所在街道',value:info.street,icon:''});
    if(info.neighborhood)basicInfo.push({label:'所属社区',value:info.neighborhood,icon:''});
    if(info.builtYear)basicInfo.push({label:'建成年份',value:info.builtYear,icon:''});
    if(info.plotRatio)basicInfo.push({label:'容积率',value:info.plotRatio,icon:''});
    if(info.greenRate)basicInfo.push({label:'绿化率',value:info.greenRate,icon:''});
    if(info.buildingType)basicInfo.push({label:'建筑类型',value:info.buildingType,icon:''});
    if(info.developer)basicInfo.push({label:'开发商',value:info.developer,icon:''});
    if(info.parkingSpaces)basicInfo.push({label:'停车位',value:info.parkingSpaces,icon:''});
    if(info.address)basicInfo.push({label:'详细地址',value:info.address,icon:'',map:true,lng:info.lng,lat:info.lat});
    if(info.alias)basicInfo.push({label:'别名/简称',value:info.alias,icon:''});
    if(info.elevatorRatio)basicInfo.push({label:'梯户比',value:info.elevatorRatio,icon:''});
    if(info.floorHeight)basicInfo.push({label:'标准层高',value:info.floorHeight,icon:''});
    if(info.roomRate)basicInfo.push({label:'得房率',value:info.roomRate,icon:''});
    if(info.parkingRatio)basicInfo.push({label:'车位配比',value:info.parkingRatio,icon:''});
    if(info.parkingPrice)basicInfo.push({label:'车位售价',value:info.parkingPrice,icon:''});
    if(info.parkingRent)basicInfo.push({label:'车位月租',value:info.parkingRent,icon:''});

    headerHtml+='<div class="cm-overview-cards" style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px;max-height:45vh;overflow-y:auto;-webkit-overflow-scrolling:touch">';
    /* 基本信息卡片 */
    if(basicInfo.length){
      headerHtml+='<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.04)">'
        +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border-light)">'
        +'<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:var(--primary-light);color:var(--primary);font-size:.8125rem">ℹ</span>'
        +'<span style="font-size:.875rem;font-weight:600;color:var(--text-primary)">基本信息</span></div>'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
        +basicInfo.map(function(it){return'<div><div style="font-size:.8125rem;color:var(--text-muted);margin-bottom:2px">'+esc(it.label)+'</div><div style="font-size:.875rem;font-weight:500;color:var(--text-primary);word-break:break-all;overflow-wrap:break-word">'+(it.map?_mapLink(it.value,it.lng,it.lat):esc(it.value))+'</div></div>'}).join('')
        +'</div></div>';
    }
    /* 教育配套卡片 */
    if(schoolStr){
      var schoolItems=[];
      if(info.kindergarten)schoolItems.push({label:'幼儿园',value:info.kindergarten,icon:''});
      if(info.primarySchool)schoolItems.push({label:'小学',value:info.primarySchool,icon:''});
      if(info.middleSchool)schoolItems.push({label:'中学',value:info.middleSchool,icon:''});
      if(info.schoolFamous)schoolItems.push({label:'是否名校',value:info.schoolFamous,icon:''});
      headerHtml+='<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.04)">'
        +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border-light)">'
        +'<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:#fef3c7;color:#d97706;font-size:.8125rem">🎓</span>'
        +'<span style="font-size:.875rem;font-weight:600;color:var(--text-primary)">教育配套</span></div>'
        +'<div style="display:flex;flex-direction:column;gap:8px">'
        +schoolItems.map(function(it){return'<div><div style="font-size:.8125rem;color:var(--text-muted);margin-bottom:2px">'+esc(it.label)+'</div><div style="font-size:.875rem;font-weight:500;color:var(--text-primary);word-break:break-all;overflow-wrap:break-word">'+esc(it.value)+'</div></div>'}).join('')
        +'</div></div>';
    }
    /* 地铁配套卡片 */
    if(metroStr){
      headerHtml+='<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.04)">'
        +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border-light)">'
        +'<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:#dbeafe;color:#2563eb;font-size:.8125rem">🚇</span>'
        +'<span style="font-size:.875rem;font-weight:600;color:var(--text-primary)">地铁配套</span></div>'
        +'<div style="display:flex;flex-direction:column;gap:8px">'
        +info.metro.map(function(m){return'<div style="display:flex;gap:6px;font-size:.875rem"><span style="color:var(--text-muted);min-width:42px;flex-shrink:0">'+esc(m.line||'')+'</span><span style="color:var(--text-primary);font-weight:500;word-break:break-all">'+esc(m.station||'')+(m.distance?(' · '+esc(m.distance)):'')+'</span></div>'}).join('')
        +'</div></div>';
    }
    /* 周边配套卡片 */
    if(amenityStr){
      headerHtml+='<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.04)">'
        +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border-light)">'
        +'<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:#dcfce7;color:#16a34a;font-size:.8125rem">🏬</span>'
        +'<span style="font-size:.875rem;font-weight:600;color:var(--text-primary)">周边配套</span></div>'
        +'<div style="display:flex;flex-direction:column;gap:8px">'
        +info.amenities.map(function(a){return'<div style="display:flex;gap:6px;font-size:.875rem"><span style="color:var(--text-muted);min-width:48px;flex-shrink:0">'+esc(a.type||'')+'</span><span style="color:var(--text-primary);font-weight:500;word-break:break-all">'+esc(a.name||'')+(a.distance?(' · '+esc(a.distance)):'')+'</span></div>'}).join('')
        +'</div></div>';
    }
    /* 物业费卡片 */
    if(feeStr){
      headerHtml+='<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.04)">'
        +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border-light)">'
        +'<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:#d1fae5;color:#059669;font-size:.8125rem">💰</span>'
        +'<span style="font-size:.875rem;font-weight:600;color:var(--text-primary)">物业费</span></div>'
        +'<div style="font-size:.875rem;color:var(--text-primary);word-break:break-all;overflow-wrap:break-word">'+feeStr+'</div></div>';
    }
    headerHtml+='</div>';
  }else{
    headerHtml+='<div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:10px;padding:14px 16px;margin-bottom:12px;font-size:.875rem;color:#92400e;display:flex;align-items:center;gap:10px">'
      +'<span style="font-size:1.125rem">⚠</span>'
      +'<span>该小区还没有概况信息，点击右上角"添加概况"补充楼幢、户数、物业等基础信息</span></div>';
  }

  /* 状态筛选按钮 — 手机端横向滚动 */
  headerHtml+='<div class="cm-filter-bar" style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.04)">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    +'<span style="font-size:.875rem;color:var(--text-primary);font-weight:600">房源状态</span>'
    +'<span style="font-size:.8125rem;color:var(--text-muted)">共 <b style="color:var(--primary)">'+stats.all+'</b> 套</span>'
    +'</div>'
    +'<div style="display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px" class="cm-filter-scroll">'
    +cmFilterBtn('all','全部',stats.all,sf)
    +cmFilterBtn('onSale','在售',stats.onSale,sf)
    +cmFilterBtn('onRent','在租',stats.onRent,sf)
    +cmFilterBtn('onHold','暂缓',stats.onHold,sf)
    +cmFilterBtn('sold','已售',stats.sold,sf)
    +cmFilterBtn('rented','已租',stats.rented,sf)
    +'</div></div>'
    +'</div>';

  /* 统计数字放到 propResultCount（保持工具栏整齐） */
  document.getElementById('propResultCount').innerHTML='共 <b>'+stats.all+'</b> 套房源 '+(isAdmin()?'<button class="btn btn-sm btn-outline" onclick="exportCurrentCSV(\x27properties\x27)" style="margin-left:12px;font-size:.75rem" title="导出房源列表为CSV">📥 导出CSV</button>':'');

  /* 准备房源卡片列表HTML（手机端按单列显示，电脑端自适应多列） */
  var listCardsHtml;
  if(filtered.length===0){
    listCardsHtml='<div class="empty" style="grid-column:1/-1;margin-top:8px"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><h3>该状态下暂无房源</h3><p>切换其他状态查看，或点击"新增房源"添加</p></div>';
  }else{
    /* 按更新时间排序 */
    filtered.sort(function(a,b){return(b.updatedAt||0)-(a.updatedAt||0)});
    listCardsHtml=filtered.map(function(p){
      var price;
      if(p.type==='rental'){
        price=p.rentPrice?p.rentPrice+'<span class="unit">元/月</span>':'';
      }else if(p.type==='secondhand'){
        price=p.totalPrice?p.totalPrice+'<span class="unit">万</span>':'';
      }else{
        price=p.averagePriceText?('<span style="font-size:1rem">'+esc(p.averagePriceText)+'</span>'):(p.averagePrice?p.averagePrice+'<span class="unit">元/㎡</span>':'');
      }
      var typeLabel=p.type==='secondhand'?'二手房':(p.type==='rental'?'租赁':'新楼盘');
      var info;
      if(p.type==='rental'){
        info=[p.area?p.area+'㎡':'',p.layout||'',p.depositType||'',p.rentType||''].filter(Boolean);
      }else if(p.type==='secondhand'){
        info=[p.area?p.area+'㎡':'',p.layout||'',p.orientation||''].filter(Boolean);
        var locStr2=[p.building,p.unit,p.room].filter(Boolean).join(' ');
        if(locStr2)info.unshift(locStr2);
      }else{
        info=[p.developer||'',p.availableLayouts||''].filter(Boolean);
      }
      var tags=(p.tags||[]).map(function(t){return'<span class="client-tag">'+esc(t)+'</span>'}).join('');
      var propPinned=(S.pinnedPropIds||[]).indexOf(p.id)>=0;
      var titleDisplay=[p.building,p.unit,p.room].filter(Boolean).join(' ')||p.title||'未命名';
      return'<div class="property-card'+(propPinned?' pinned':'')+'" data-status="'+esc(p.status)+'" data-id="'+p.id+'">'
        +(propPinned?'<div style="position:absolute;top:8px;right:8px;z-index:2;font-size:1rem">⭐</div>':'')
        +'<div class="card-thumb no-img" data-thumb="'+p.id+'"><span class="type-label">'+typeLabel+'</span><span class="media-count" data-media-count="'+p.id+'" style="display:none"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span class="mc-num">0</span></span></div>'
        +'<div class="card-body"><div class="card-title">'+esc(titleDisplay)+'</div><div class="card-price">'+price+'</div>'
        +'<div class="card-info">'+info.map(function(i){return'<span>'+esc(i)+'</span>'}).join('')+'</div>'
        +(tags?'<div class="prop-tags">'+tags+'</div>':'')
        +'<div class="card-info"><span>'+esc(p.district||'')+(p.block?('·'+esc(p.block)):'')+'</span><span class="status-badge" data-status="'+esc(p.status)+'">'+esc(p.status)+'</span></div>'
        +'<div class="card-actions"><button data-action="pview" data-id="'+p.id+'">详情</button><button data-action="pshare" data-id="'+p.id+'">分享</button><button data-action="ppin" data-id="'+p.id+'" title="'+(propPinned?'取消重点':'标为重点')+'">'+(propPinned?'⭐取消':'⭐重点')+'</button><button data-action="pedit" data-id="'+p.id+'">编辑</button></div>'
        +'</div></div>';
    }).join('');
  }

  /* ========== 电脑端两栏布局 / 手机端单列堆叠 ========== */
  var isMobile=window.innerWidth<=1023;
  if(!isMobile){
    /* 电脑端：左侧概况(360px) + 右侧房源列表(自适应) */
    grid.style.gridTemplateColumns='360px 1fr';
    grid.style.gap='20px';
    grid.style.alignItems='start';
    grid.innerHTML='<div class="cm-detail-left" style="position:sticky;top:12px;max-height:calc(100vh - 24px);overflow-y:auto;padding-right:4px">'
      +headerHtml
      +'</div>'
      +'<div class="cm-detail-right" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;align-content:start">'
      +listCardsHtml
      +'</div>';
  }else{
    /* 手机端：单列堆叠（headerHtml + 房源列表各自占整行） */
    grid.style.gridTemplateColumns='';
    grid.style.gap='';
    grid.style.alignItems='';
    grid.innerHTML='<div style="grid-column:1/-1">'+headerHtml+'</div>'
      +'<div style="grid-column:1/-1;display:flex;flex-direction:column;gap:12px">'+listCardsHtml+'</div>';
  }

  /* ========== 事件绑定（只在最后一次innerHTML赋值后） ========== */
  /* 返回按钮 */
  var backBtn=document.getElementById('cmBackBtn');
  if(backBtn){
    backBtn.onclick=function(){
      S.communityDetail=null;S.communityStatusFilter='all';
      /* 重置grid模板列（避免影响普通列表渲染） */
      grid.style.gridTemplateColumns='';grid.style.gap='';grid.style.alignItems='';
      renderCommunityList();
    };
  }
  /* 查看概览按钮 */
  var viewBtn2=document.getElementById('cmViewBtn');
  if(viewBtn2){
    viewBtn2.onclick=function(){
      try{openCommunityOverviewModal(S.communityDetail||name)}catch(err){console.error('[cmViewBtn]',err);toast('打开概览失败','error')}
    };
  }
  /* 编辑概况按钮（用 S.communityDetail 直接传值，避免闭包变量失效） */
  var editBtn2=document.getElementById('cmEditBtn');
  if(editBtn2){
    editBtn2.onclick=function(){
      try{
        var n=S.communityDetail||name;
        console.log('[cmEditBtn] openCommunityForm name=',n);
        openCommunityForm(n);
      }catch(err){
        console.error('[cmEditBtn]',err);
        toast('打开编辑失败: '+(err&&err.message||err),'error');
      }
    };
  }
  /* 生成客户卡片按钮 */
  var shareBtn2=document.getElementById('cmShareBtn');
  if(shareBtn2){
    shareBtn2.onclick=function(){
      try{openCommunityShareCard(name)}catch(err){console.error('[cmShareBtn]',err);toast('打开发送卡片失败','error')}
    };
  }
  /* 状态筛选按钮 */
  grid.querySelectorAll('[data-cmfilter]').forEach(function(btn){
    btn.onclick=function(){
      S.communityStatusFilter=btn.getAttribute('data-cmfilter');
      renderCommunityDetail();
    };
  });
  /* 房源卡片点击 */
  grid.querySelectorAll('.property-card').forEach(function(card){
    card.onclick=function(e){if(e.target.closest('button'))return;showPropertyDetail(card.getAttribute('data-id'))};
  });
  /* 房源卡片操作按钮 */
  grid.querySelectorAll('[data-action]').forEach(function(btn){
    btn.onclick=function(e){
      e.stopPropagation();var a=btn.getAttribute('data-action'),id=btn.getAttribute('data-id');
      if(a==='pview')showPropertyDetail(id);
      if(a==='pedit')openPropertyForm(id);
      if(a==='pshare')copyPropertyInfo(id);
      if(a==='ppin'){
        S.pinnedPropIds=S.pinnedPropIds||[];
        var idx=S.pinnedPropIds.indexOf(id);
        if(idx>=0)S.pinnedPropIds.splice(idx,1);
        else S.pinnedPropIds.push(id);
        renderCommunityDetail();
        toast(idx>=0?'已取消重点房源':'已标为重点房源','success');
      }
    };
  });

  /* 异步加载缩略图 */
  filtered.forEach(function(p){
    MediaDB.list(p.id).then(function(media){
      var img;
      if(p.coverMediaId){img=media.find(function(m){return m.id===p.coverMediaId})}
      if(!img){img=media.find(function(m){return m.type==='image'})}
      var el=grid.querySelector('[data-thumb="'+p.id+'"]');
      if(img&&el){el.style.backgroundImage='url('+img.dataUrl+')';el.classList.remove('no-img')}
      /* 更新媒体计数 */
      var mcEl=grid.querySelector('[data-media-count="'+p.id+'"]');
      if(mcEl&&media.length>0){
        mcEl.style.display='';
        var numEl=mcEl.querySelector('.mc-num');
        if(numEl)numEl.textContent=media.length;
      }
    }).catch(function(){});
  });
  }catch(err){console.error('[renderCommunityDetail]',err);toast('小区详情加载失败: '+err.message,'error')}
}

/* 生成小区"发给客户卡片"（学区/地铁/周边配套，适合微信发送） */
function openCommunityShareCard(name){
  try{
  var c=S.properties.find(function(p){return p.type==='community'&&(p.title===name||p.community===name)});
  if(!c){toast('请先完善该小区概况','error');return;}
  var lines=[];
  lines.push('【'+c.title+'】配套速览');
  if(c.district||c.block)lines.push('📍 '+(c.district||'')+(c.block?(' · '+c.block):''));
  if(c.kindergarten||c.primarySchool||c.middleSchool){
    lines.push('🎓 学区：');
    if(c.kindergarten)lines.push('  幼儿园：'+c.kindergarten);
    if(c.primarySchool)lines.push('  小学：'+c.primarySchool);
    if(c.middleSchool)lines.push('  中学：'+c.middleSchool);
  }
  if(c.metro&&c.metro.length){
    lines.push('🚇 地铁：');
    c.metro.forEach(function(m){lines.push('  '+(m.line||'')+' '+(m.station||'')+(m.distance?(' '+m.distance):''))});
  }
  if(c.amenities&&c.amenities.length){
    lines.push('🏬 周边配套：');
    c.amenities.forEach(function(a){lines.push('  '+(a.type||'')+' '+(a.name||'')+(a.distance?(' '+a.distance):''))});
  }
  if(c.propertyFees&&c.propertyFees.length){
    lines.push('💰 物业费：'+c.propertyFees.map(function(f){return (f.type||'')+':'+(f.fee||'')}).join('，'));
  }
  lines.push('');
  lines.push('—— '+(S.currentUser?S.currentUser.name:'小闻哥')+(S.currentUser&&S.currentUser.phone?' '+S.currentUser.phone:''));
  var text=lines.join('\n');
  var modal=document.getElementById('communityShareModal');
  if(modal)modal.remove();
  var html='<div class="modal-overlay show" id="communityShareModal"><div class="modal" style="max-width:480px">'
    +'<div class="modal-header"><h3>发给客户卡片</h3><button class="modal-close" onclick="document.getElementById(\'communityShareModal\').remove()">×</button></div>'
    +'<div class="modal-body" style="max-height:70vh;overflow-y:auto;padding:16px">'
    +'<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:14px;font-size:.875rem;line-height:1.7;white-space:pre-wrap;word-break:break-all;font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif">'+esc(text)+'</div>'
    +'</div>'
    +'<div class="modal-footer"><button class="btn btn-outline" onclick="document.getElementById(\'communityShareModal\').remove()">关闭</button><button class="btn btn-primary" id="cmCopyCardBtn">复制文字</button></div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('cmCopyCardBtn').addEventListener('click',function(){
    if(navigator.clipboard){navigator.clipboard.writeText(text).then(function(){toast('已复制，可直接粘贴到微信','success')}).catch(function(){fallbackCopy(text)})}
    else fallbackCopy(text);
  });
  }catch(err){console.error('[openCommunityShareCard]',err);toast('生成卡片失败: '+(err&&err.message||err),'error')}
}

/* 小区详情页状态筛选按钮 */
function cmFilterBtn(key,label,count,current){
  var active=(current===key);
  var style=active
    ?'background:var(--primary);color:#fff;border:1px solid var(--primary)'
    :'background:var(--bg-secondary);color:var(--text-secondary);border:1px solid var(--border)';
  return'<button data-cmfilter="'+key+'" style="'+style+';padding:5px 12px;border-radius:6px;font-size:.875rem;cursor:pointer;font-weight:'+(active?'600':'400')+'">'+label+' '+count+'</button>';
}

/* v6.35 小区概况：将智能识别结果填入表单字段 */
function fillCommunityFormFromSmart(c){
  function setVal(id,val){var el=document.getElementById(id);if(el&&val)el.value=val}
  function setSel(id,val){var el=document.getElementById(id);if(el&&val){for(var i=0;i<el.options.length;i++){if(el.options[i].value===val||el.options[i].text===val){el.selectedIndex=i;break}}}}
  setVal('cmName',c.title||c.community||'');
  if(c.district)setSel('cmDistrict',c.district);
  setVal('cmBlock',c.block||'');
  setVal('cmBuildingCount',c.buildingCount||'');
  setVal('cmHouseholdCount',c.householdCount||'');
  setVal('cmBuildingAge',c.buildingAge||'');
  setVal('cmStreet',c.street||'');
  setVal('cmNeighborhood',c.neighborhood||'');
  setVal('cmBuiltYear',c.builtYear||(c.buildingAge?c.buildingAge.replace(/年/,''):'')||'');
  setVal('cmPlotRatio',c.plotRatio||'');
  setVal('cmGreenRate',c.greenRate||'');
  setVal('cmDeveloper',c.developer||'');
  setVal('cmParkingSpaces',c.parkingSpaces||'');
  setVal('cmAddress',c.address||'');
  setVal('cmLng',c.lng||'');
  setVal('cmLat',c.lat||'');
  setVal('cmKindergarten',c.kindergarten||'');
  setVal('cmPrimarySchool',c.primarySchool||'');
  setVal('cmMiddleSchool',c.middleSchool||'');
  setVal('cmSchoolFamous',c.schoolFamous||'');
  setVal('cmPropertyManagement',c.propertyManagement||'');
  setVal('cmAlias',c.alias||'');
  setVal('cmElevatorRatio',c.elevatorRatio||'');
  setVal('cmFloorHeight',c.floorHeight||'');
  setVal('cmRoomRate',c.roomRate||'');
  setVal('cmParkingRatio',c.parkingRatio||'');
  setVal('cmParkingPrice',c.parkingPrice||'');
  setVal('cmParkingRent',c.parkingRent||'');
  setVal('cmNotes',c.notes||'');
}
window.fillCommunityFormFromSmart=fillCommunityFormFromSmart;

/* v6.35 小区概况表单文件上传处理 */
function handleCmFormSmartFileUpload(file){
  var hintEl=document.getElementById('cmFormSmartFileHint');
  var ta=document.getElementById('cmFormSmartArea');
  if(!file||!ta)return;
  var name=file.name.toLowerCase();
  var ext=name.split('.').pop();
  if(ext==='xlsx'||ext==='xls'){
    hintEl.textContent='正在解析Excel...';hintEl.style.color='var(--warning)';
    loadSheetJS().then(function(){
      var reader=new FileReader();
      reader.onload=function(e){
        try{
          var data=new Uint8Array(e.target.result);
          var wb=XLSX.read(data,{type:'array'});
          var sheets=wb.SheetNames;
          var allText='';
          for(var s=0;s<sheets.length;s++){
            var ws=wb.Sheets[sheets[s]];
            var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,blankrows:false});
            if(s>0)allText+='\n';
            allText+='# sheet: '+sheets[s]+'\n';
            var lines=[];
            for(var r=0;r<rows.length;r++){
              var row=rows[r]||[];
              var cells=[];
              for(var ci=0;ci<row.length;ci++){
                var v=row[ci];v=(v==null?'':String(v));v=v.replace(/[\r\n\t]/g,'\u0001');cells.push(v);
              }
              lines.push(cells.join('\t'));
            }
            allText+=lines.join('\n')+'\n';
          }
          ta.value=(ta.value?ta.value+'\n':'')+allText;
          hintEl.textContent='Excel解析完成('+sheets.length+'个Sheet)，点击「识别并填入」';hintEl.style.color='var(--success)';
        }catch(err){hintEl.textContent='Excel解析失败:'+err.message;hintEl.style.color='var(--danger)'}
      };
      reader.readAsArrayBuffer(file);
    }).catch(function(){hintEl.textContent='加载Excel库失败';hintEl.style.color='var(--danger)'});
  }else if(ext==='csv'||ext==='txt'){
    var reader=new FileReader();
    reader.onload=function(e){ta.value=(ta.value?ta.value+'\n':'')+e.target.result;hintEl.textContent='文件已读取，点击「识别并填入」';hintEl.style.color='var(--success)'};
    reader.readAsText(file,'utf-8');
  }else if(ext==='png'||ext==='jpg'||ext==='jpeg'){
    handleCmFormSmartImageUpload(file);
  }else{hintEl.textContent='不支持的文件类型';hintEl.style.color='var(--danger)'}
}

function handleCmFormSmartImageUpload(file){
  var hintEl=document.getElementById('cmFormSmartFileHint');
  hintEl.textContent='正在处理图片...';hintEl.style.color='var(--warning)';
  compressImage(file,1200,0.7,function(dataUrl){
    hintEl.textContent='图片已就绪，请在上方输入框补充文字信息后点识别（或直接粘贴文字）';hintEl.style.color='var(--text-secondary)';
  });
}
window.handleCmFormSmartFileUpload=handleCmFormSmartFileUpload;
window.handleCmFormSmartImageUpload=handleCmFormSmartImageUpload;

/* 打开小区概况编辑表单 */
function openCommunityForm(name,onSaved){
  try{
  var _onSaved=onSaved;
  var existing=S.properties.find(function(p){return p.type==='community'&&(p.title===name||p.community===name)});
  var c=existing||{type:'community',title:name,community:name};
  var html='<div class="modal-overlay show" id="communityFormModal">'
    +'<div class="modal" style="max-width:560px">'
    +'<div class="modal-header"><h3>'+(existing?'编辑小区概况':'添加小区概况')+'</h3><button class="modal-close" onclick="document.getElementById(\'communityFormModal\').remove()">×</button></div>'
    +'<div class="modal-body" style="max-height:70vh;overflow-y:auto;padding:16px">'
    /* v6.35 小区概况表单内嵌智能识别 */
    +'<div id="cmFormSmartSection" style="margin-bottom:14px;background:var(--primary-light);border-radius:10px;padding:12px;border:1px dashed var(--primary)">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    +'<span style="font-size:.875rem;font-weight:600;color:var(--primary)">🧠 智能录入识别</span>'
    +'<button type="button" id="cmFormSmartToggleBtn" style="background:none;border:none;color:var(--primary);cursor:pointer;font-size:.8125rem;font-weight:500">展开 ▾</button>'
    +'</div>'
    +'<div id="cmFormSmartBody" style="display:none">'
    +'<div style="background:var(--bg-secondary);border-radius:6px;padding:8px;margin-bottom:8px;font-size:.8125rem;color:var(--text-secondary);line-height:1.5">'
    +'粘贴小区概况信息，支持：表格粘贴（Excel）、键值对、自由文本。识别后自动填入下方字段。</div>'
    +'<textarea id="cmFormSmartArea" rows="4" style="width:100%;font-size:.875rem;padding:8px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box resize:vertical" placeholder="粘贴小区概况信息…"></textarea>'
    +'<div style="margin-top:8px;display:flex;align-items:center;flex-wrap:wrap;gap:6px">'
    +'<label style="display:inline-flex;align-items:center;gap:4px;border:1px dashed var(--primary);background:#fff;color:var(--primary);padding:5px 10px;border-radius:6px;font-size:.8125rem;cursor:pointer;font-weight:500">'
    +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
    +'上传文件/照片'
    +'<input type="file" id="cmFormSmartFileInput" accept=".xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg" style="display:none" multiple>'
    +'</label>'
    +'<span id="cmFormSmartFileHint" style="font-size:.75rem;color:var(--text-muted)">支持Excel/表格/文本/截图</span>'
    +'</div>'
    +'<div id="cmFormSmartPreview" style="margin-top:8px"></div>'
    +'<div style="margin-top:8px;display:flex;gap:8px">'
    +'<button type="button" id="cmFormSmartParseBtn" class="btn btn-primary btn-sm">识别并填入</button>'
    +'<button type="button" id="cmFormSmartClearBtn" class="btn btn-outline btn-sm">清空</button>'
    +'</div>'
    +'</div></div>'
    +'<input type="hidden" id="cmId" value="'+esc(c.id||'')+'">'
    +'<input type="hidden" id="cmOrigName" value="'+esc(name||'')+'">'
    +'<div class="form-grid">'
    +'<div class="form-field"><label>小区名称 <span class="req">*</span></label><input type="text" id="cmName" value="'+esc(c.title||c.community||name||'')+'" placeholder="如：理想家园"></div>'
    +'<div class="form-field"><label>别名/简称</label><input type="text" id="cmAlias" value="'+esc(c.alias||'')+'" placeholder="如：公园里"></div>'
    +'<div class="form-field"><label>区域</label><select id="cmDistrict"><option value="">请选择</option>'
    +['临平','余杭','萧山','拱墅','西湖','上城','滨江','钱塘','富阳','临安'].map(function(d){return'<option value="'+d+'"'+(c.district===d?' selected':'')+'>'+d+'</option>'}).join('')
    +'</select></div>'
    +'<div class="form-field"><label>板块/商圈</label><input type="text" id="cmBlock" value="'+esc(c.block||'')+'" placeholder="如：临平新城"></div>'
    +'<div class="form-field"><label>共计楼幢</label><input type="text" id="cmBuildingCount" value="'+esc(c.buildingCount||'')+'" placeholder="如：12幢"></div>'
    +'<div class="form-field"><label>共计户数</label><input type="text" id="cmHouseholdCount" value="'+esc(c.householdCount||'')+'" placeholder="如：1200户"></div>'
    +'<div class="form-field"><label>房龄</label><input type="text" id="cmBuildingAge" value="'+esc(c.buildingAge||'')+'" placeholder="如：2018年"></div>'
    +'<div class="form-field"><label>归属街道</label><input type="text" id="cmStreet" value="'+esc(c.street||'')+'" placeholder="如：南苑街道"></div>'
    +'<div class="form-field"><label>归属社区</label><input type="text" id="cmNeighborhood" value="'+esc(c.neighborhood||'')+'" placeholder="如：时代社区"></div>'
    +'<div class="form-field"><label>建成年份</label><input type="text" id="cmBuiltYear" value="'+esc(c.builtYear||'')+'" placeholder="如：2018"></div>'
    +'<div class="form-field"><label>容积率</label><input type="text" id="cmPlotRatio" value="'+esc(c.plotRatio||'')+'" placeholder="如：2.2"></div>'
    +'<div class="form-field"><label>绿化率</label><input type="text" id="cmGreenRate" value="'+esc(c.greenRate||'')+'" placeholder="如：35%"></div>'
    +'<div class="form-field"><label>建筑类型</label><input type="text" id="cmBuildingType" value="'+esc(c.buildingType||'')+'" placeholder="如：高层/小高层/洋房/排屋"></div>'
    +'<div class="form-field"><label>开发商</label><input type="text" id="cmDeveloper" value="'+esc(c.developer||'')+'" placeholder="如：绿城集团"></div>'
    +'<div class="form-field"><label>停车位</label><input type="text" id="cmParkingSpaces" value="'+esc(c.parkingSpaces||'')+'" placeholder="如：1200个"></div>'
    +'<div style="grid-column:1/-1;margin-top:8px;border-top:1px dashed var(--border);padding-top:10px"><label style="font-size:.875rem;font-weight:600;display:block;margin-bottom:6px">🏗 建筑参数</label>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
    +'<div class="form-field" style="margin:0"><label>梯户比</label><input type="text" id="cmElevatorRatio" value="'+esc(c.elevatorRatio||'')+'" placeholder="如：2梯4户"></div>'
    +'<div class="form-field" style="margin:0"><label>标准层高</label><input type="text" id="cmFloorHeight" value="'+esc(c.floorHeight||'')+'" placeholder="如：2.9米"></div>'
    +'<div class="form-field" style="margin:0"><label>得房率区间</label><input type="text" id="cmRoomRate" value="'+esc(c.roomRate||'')+'" placeholder="如：78%-82%"></div>'
    +'<div class="form-field" style="margin:0"><label>车位配比</label><input type="text" id="cmParkingRatio" value="'+esc(c.parkingRatio||'')+'" placeholder="如：1:1.2"></div>'
    +'<div class="form-field" style="margin:0"><label>车位售价</label><input type="text" id="cmParkingPrice" value="'+esc(c.parkingPrice||'')+'" placeholder="如：18万/个"></div>'
    +'<div class="form-field" style="margin:0"><label>车位月租</label><input type="text" id="cmParkingRent" value="'+esc(c.parkingRent||'')+'" placeholder="如：400元/月"></div>'
    +'</div></div>'
    +'<div class="form-field"><label>详细地址</label><input type="text" id="cmAddress" value="'+esc(c.address||'')+'" placeholder="如：临平区南苑街道XX路XX号"></div>'
    +'<div class="form-field"><label>经度(高德)</label><input type="text" id="cmLng" value="'+esc(c.lng||'')+'" placeholder="如：120.298"></div>'
    +'<div class="form-field"><label>纬度(高德)</label><input type="text" id="cmLat" value="'+esc(c.lat||'')+'" placeholder="如：30.419"></div>'
    +'<div class="form-field"><label>对口幼儿园</label><input type="text" id="cmKindergarten" value="'+esc(c.kindergarten||'')+'" placeholder="如：临平第一幼儿园"></div>'
    +'<div class="form-field"><label>对口小学</label><input type="text" id="cmPrimarySchool" value="'+esc(c.primarySchool||'')+'" placeholder="如：临平第一小学"></div>'
    +'<div class="form-field"><label>对口中学</label><input type="text" id="cmMiddleSchool" value="'+esc(c.middleSchool||'')+'" placeholder="如：临平第五中学"></div>'
    +'<div class="form-field"><label>是否名校</label><input type="text" id="cmSchoolFamous" value="'+esc(c.schoolFamous||'')+'" placeholder="如：是/否"></div>'
    +'<div style="grid-column:1/-1;margin-top:4px"><label style="font-size:.875rem;font-weight:600;display:block;margin-bottom:6px">🚇 地铁配套（可添加多条线路）</label>'
    +'<div id="cmMetroList" style="margin-bottom:8px"></div>'
    +'<button type="button" class="btn-mini" id="cmAddMetro" style="border:1px solid var(--border);background:var(--bg-secondary);padding:4px 10px;font-size:.8125rem;border-radius:6px;cursor:pointer">+ 添加地铁线</button></div>'
    +'<div style="grid-column:1/-1;margin-top:8px"><label style="font-size:.875rem;font-weight:600;display:block;margin-bottom:6px">🏬 周边配套（商场 / 医院 / 公园等，含距离）</label>'
    +'<div id="cmAmenityList" style="margin-bottom:8px"></div>'
    +'<button type="button" class="btn-mini" id="cmAddAmenity" style="border:1px solid var(--border);background:var(--bg-secondary);padding:4px 10px;font-size:.8125rem;border-radius:6px;cursor:pointer">+ 添加配套</button></div>'
    +'<div class="form-field"><label>物业名称</label><input type="text" id="cmPropertyManagement" value="'+esc(c.propertyManagement||'')+'" placeholder="如：绿城物业"></div>'
    +'</div>'
    /* 物业费标准（多种业态） */
    +'<div style="margin-top:12px"><label style="font-size:.875rem;font-weight:600;display:block;margin-bottom:6px">物业费标准（可添加多种业态）</label>'
    +'<div id="cmFeeList" style="margin-bottom:8px"></div>'
    +'<button type="button" class="btn-mini" id="cmAddFee" style="border:1px solid var(--border);background:var(--bg-secondary);padding:4px 10px;font-size:.8125rem;border-radius:6px;cursor:pointer">+ 添加物业费</button>'
    +'</div>'
    +'<div class="form-field" style="margin-top:12px"><label>备注</label><textarea id="cmNotes" rows="2" placeholder="其他需要记录的信息">'+esc(c.notes||'')+'</textarea></div>'
    +'</div>'
    +'<div class="modal-footer">'
    +'<button class="btn-secondary" onclick="document.getElementById(\'communityFormModal\').remove()">取消</button>'
    +'<button class="btn-primary" id="cmSaveBtn">保存</button>'
    +'</div></div></div>';
  /* 移除已有的模态框 */
  var old=document.getElementById('communityFormModal');
  if(old)old.remove();
  document.body.insertAdjacentHTML('beforeend',html);
  /* 物业费列表 */
  var fees=(c.propertyFees||[]);
  /* 地铁配套列表 */
  var metros=(c.metro||[]);
  function renderMetroList(){
    var container=document.getElementById('cmMetroList');
    container.innerHTML=metros.map(function(m,i){
      return'<div style="display:flex;gap:6px;margin-bottom:4px;align-items:center">'
        +'<input type="text" class="cm-metro-line" value="'+esc(m.line||'')+'" placeholder="线路（如9号线）" style="flex:1;font-size:.8125rem;padding:4px 8px;border:1px solid var(--border);border-radius:4px">'
        +'<input type="text" class="cm-metro-station" value="'+esc(m.station||'')+'" placeholder="站名（如临平站）" style="flex:1.2;font-size:.8125rem;padding:4px 8px;border:1px solid var(--border);border-radius:4px">'
        +'<input type="text" class="cm-metro-dist" value="'+esc(m.distance||'')+'" placeholder="距离（如800米）" style="flex:1;font-size:.8125rem;padding:4px 8px;border:1px solid var(--border);border-radius:4px">'
        +'<button type="button" class="cm-metro-del" data-idx="'+i+'" style="color:#dc2626;border:none;background:none;cursor:pointer;font-size:1rem">×</button>'
        +'</div>';
    }).join('');
    container.querySelectorAll('.cm-metro-del').forEach(function(btn){
      btn.addEventListener('click',function(){metros.splice(parseInt(btn.getAttribute('data-idx')),1);renderMetroList()});
    });
    container.querySelectorAll('.cm-metro-line').forEach(function(inp,i){inp.addEventListener('input',function(){metros[i]=metros[i]||{};metros[i].line=this.value})});
    container.querySelectorAll('.cm-metro-station').forEach(function(inp,i){inp.addEventListener('input',function(){metros[i]=metros[i]||{};metros[i].station=this.value})});
    container.querySelectorAll('.cm-metro-dist').forEach(function(inp,i){inp.addEventListener('input',function(){metros[i]=metros[i]||{};metros[i].distance=this.value})});
  }
  renderMetroList();
  document.getElementById('cmAddMetro').addEventListener('click',function(){metros.push({line:'',station:'',distance:''});renderMetroList()});
  /* 周边配套列表 */
  var amenities=(c.amenities||[]);
  function renderAmenityList(){
    var container=document.getElementById('cmAmenityList');
    container.innerHTML=amenities.map(function(a,i){
      return'<div style="display:flex;gap:6px;margin-bottom:4px;align-items:center">'
        +'<input type="text" class="cm-am-type" value="'+esc(a.type||'')+'" placeholder="类型（如商场）" style="flex:.8;font-size:.8125rem;padding:4px 8px;border:1px solid var(--border);border-radius:4px">'
        +'<input type="text" class="cm-am-name" value="'+esc(a.name||'')+'" placeholder="名称（如临平银泰城）" style="flex:1.4;font-size:.8125rem;padding:4px 8px;border:1px solid var(--border);border-radius:4px">'
        +'<input type="text" class="cm-am-dist" value="'+esc(a.distance||'')+'" placeholder="距离（如1.2公里）" style="flex:1;font-size:.8125rem;padding:4px 8px;border:1px solid var(--border);border-radius:4px">'
        +'<button type="button" class="cm-am-del" data-idx="'+i+'" style="color:#dc2626;border:none;background:none;cursor:pointer;font-size:1rem">×</button>'
        +'</div>';
    }).join('');
    container.querySelectorAll('.cm-am-del').forEach(function(btn){
      btn.addEventListener('click',function(){amenities.splice(parseInt(btn.getAttribute('data-idx')),1);renderAmenityList()});
    });
    container.querySelectorAll('.cm-am-type').forEach(function(inp,i){inp.addEventListener('input',function(){amenities[i]=amenities[i]||{};amenities[i].type=this.value})});
    container.querySelectorAll('.cm-am-name').forEach(function(inp,i){inp.addEventListener('input',function(){amenities[i]=amenities[i]||{};amenities[i].name=this.value})});
    container.querySelectorAll('.cm-am-dist').forEach(function(inp,i){inp.addEventListener('input',function(){amenities[i]=amenities[i]||{};amenities[i].distance=this.value})});
  }
  renderAmenityList();
  document.getElementById('cmAddAmenity').addEventListener('click',function(){amenities.push({type:'',name:'',distance:''});renderAmenityList()});
  function renderFeeList(){
    var container=document.getElementById('cmFeeList');
    container.innerHTML=fees.map(function(f,i){
      return'<div style="display:flex;gap:6px;margin-bottom:4px;align-items:center">'
        +'<input type="text" class="cm-fee-type" value="'+esc(f.type||'')+'" placeholder="业态（如高层）" style="flex:1;font-size:.8125rem;padding:4px 8px;border:1px solid var(--border);border-radius:4px">'
        +'<input type="text" class="cm-fee-amount" value="'+esc(f.fee||'')+'" placeholder="费用（如3.5元/㎡/月）" style="flex:1.5;font-size:.8125rem;padding:4px 8px;border:1px solid var(--border);border-radius:4px">'
        +'<button type="button" class="cm-fee-del" data-idx="'+i+'" style="color:#dc2626;border:none;background:none;cursor:pointer;font-size:1rem">×</button>'
        +'</div>';
    }).join('');
    container.querySelectorAll('.cm-fee-del').forEach(function(btn){
      btn.addEventListener('click',function(){fees.splice(parseInt(btn.getAttribute('data-idx')),1);renderFeeList()});
    });
    container.querySelectorAll('.cm-fee-type').forEach(function(inp,i){inp.addEventListener('input',function(){fees[i]=fees[i]||{};fees[i].type=this.value})});
    container.querySelectorAll('.cm-fee-amount').forEach(function(inp,i){inp.addEventListener('input',function(){fees[i]=fees[i]||{};fees[i].fee=this.value})});
  }
  renderFeeList();
  document.getElementById('cmAddFee').addEventListener('click',function(){fees.push({type:'',fee:''});renderFeeList()});
  /* v6.35 小区概况表单内嵌智能识别事件绑定 */
  (function(){
    var toggleBtn=document.getElementById('cmFormSmartToggleBtn');
    var body=document.getElementById('cmFormSmartBody');
    if(toggleBtn&&body){
      toggleBtn.addEventListener('click',function(){
        var visible=body.style.display!=='none';
        body.style.display=visible?'none':'block';
        toggleBtn.textContent=visible?'展开 ▾':'收起 ▴';
      });
    }
    var parseBtn=document.getElementById('cmFormSmartParseBtn');
    if(parseBtn){
      parseBtn.addEventListener('click',function(){
        var text=document.getElementById('cmFormSmartArea').value.trim();
        if(!text){toast('请先粘贴或上传小区信息','error');return}
        var communities=parseCommunitySmartInput(text);
        if(communities.length===0){
          document.getElementById('cmFormSmartPreview').innerHTML='<p style="color:var(--warning);font-size:.8125rem">未识别到有效小区数据，请检查格式</p>';
          return;
        }
        fillCommunityFormFromSmart(communities[0]);
        var _c=communities[0];
        if(_c.metro&&_c.metro.length){metros.length=0;_c.metro.forEach(function(m){metros.push(m)});renderMetroList();}
        if(_c.amenities&&_c.amenities.length){amenities.length=0;_c.amenities.forEach(function(a){amenities.push(a)});renderAmenityList();}
        if(_c.propertyFees&&_c.propertyFees.length){fees.length=0;_c.propertyFees.forEach(function(f){fees.push(f)});renderFeeList();}
        document.getElementById('cmFormSmartPreview').innerHTML='<p style="color:var(--success);font-size:.8125rem">✅ 已识别并填入「'+(communities[0].title||communities[0].community||'未命名')+'」</p>';
        toast('已自动填入字段，请核对后保存','success');
      });
    }
    var clearBtn=document.getElementById('cmFormSmartClearBtn');
    if(clearBtn){
      clearBtn.addEventListener('click',function(){
        document.getElementById('cmFormSmartArea').value='';
        document.getElementById('cmFormSmartPreview').innerHTML='';
        document.getElementById('cmFormSmartFileHint').textContent='支持Excel/表格/文本/截图';
        document.getElementById('cmFormSmartFileHint').style.color='var(--text-muted)';
      });
    }
    var fileInput=document.getElementById('cmFormSmartFileInput');
    if(fileInput){
      fileInput.addEventListener('change',function(e){
        var files=Array.from(e.target.files||[]);
        files.forEach(function(f){handleCmFormSmartFileUpload(f)});
        e.target.value='';
      });
    }
    /* 粘贴图片 */
    var ta2=document.getElementById('cmFormSmartArea');
    if(ta2){
      ta2.addEventListener('paste',function(e){
        var items=e.clipboardData.items;
        for(var i=0;i<items.length;i++){
          if(items[i].type.indexOf('image/')===0){
            handleCmFormSmartImageUpload(items[i].getAsFile());
          }
        }
      });
    }
  })();
  /* ===== 小区概况 → 房源字段同步 ===== */

/* 从小区概况文本中提取装修规则
   返回 null / {type:'simple',decoration:'精装'} / {type:'mapped',rules:[{pattern:/.../,decoration:'精装'},...]}
   扫描范围：notes(板块简评)、builtYear、buildingType 等含"交付"关键词的字段 */
function extractCommunityDecoration(cm){
  var text=[cm.notes,cm.builtYear,cm.buildingAge,cm.buildingType].filter(Boolean).join(' ');
  /* 按建筑类型映射：如"高层精装交付，叠墅毛坯交付"、"小高层精装/叠墅毛坯" */
  var mapped=[];
  /* 匹配 "(高层/小高层/洋房/叠墅/排屋/多层)+ (精装/毛坯/简装)" */
  var mapRe=/([高层小高层洋房叠墅排屋多层]+)[\s,，、]*((?:精装修?)|(?:毛坯)|(?:简装))/g;
  var mi;
  while((mi=mapRe.exec(text))!==null){
    mapped.push({pattern:mi[1],decoration:mi[2]});
  }
  if(mapped.length>0)return{type:'mapped',rules:mapped};
  /* 统一装修标准 */
  if(/精装修?/.test(text))return{type:'simple',decoration:'精装'};
  if(/毛坯/.test(text))return{type:'simple',decoration:'毛坯'};
  if(/简装/.test(text))return{type:'simple',decoration:'简装'};
  return null;
}

/* 从建成年代/交付时间文本中提取4位年份（取第一个匹配的） */
function extractCommunityYear(cm){
  var text=[cm.builtYear,cm.buildingAge,cm.notes].filter(Boolean).join(' ');
  var m=text.match(/(\d{4})/);
  return m?m[1]:null;
}

/* 将小区的装修/建成年代同步到该小区所有房源（仅填充空值）
   装修匹配：映射模式下，取规则关键词的核心识别字（去掉"层/墅/房/屋"等通用后缀），
   只要房源信息包含任一核心字即匹配。如规则"叠墅"→核心字"叠"→可匹配"中叠/上叠/下叠/叠墅" */
function syncCommunityToProps(cmName,decoRule,commYear){
  var synced=0;
  /* 通用后缀字，匹配时忽略 */
  var SUFFIX_CHARS='层墅房屋';
  S.properties.forEach(function(prop){
    if(prop.type==='community'||prop.community!==cmName)return;
    /* 装修同步 */
    if(decoRule&&!prop.decoration){
      if(decoRule.type==='simple'){
        prop.decoration=decoRule.decoration;synced++;
      }else if(decoRule.type==='mapped'){
        var propInfo=[prop.layout,prop.floor,prop.building,prop.area,prop.title].filter(Boolean).join(' ');
        for(var i=0;i<decoRule.rules.length;i++){
          var rule=decoRule.rules[i];
          /* 提取核心识别字（去掉通用后缀） */
          var seeds=[];
          for(var c=0;c<rule.pattern.length;c++){
            var ch=rule.pattern[c];
            if(SUFFIX_CHARS.indexOf(ch)<0)seeds.push(ch);
          }
          if(seeds.length===0)seeds=[rule.pattern[0]]; /* fallback: 取首字 */
          /* 任一核心字在房源信息中出现即匹配 */
          var matched=false;
          for(var s=0;s<seeds.length;s++){
            if(propInfo.indexOf(seeds[s])>=0){matched=true;break}
          }
          if(matched){prop.decoration=rule.decoration;synced++;break}
        }
      }
    }
    /* 建成年代同步 */
    if(commYear&&!prop.buildingAge){
      prop.buildingAge=commYear;synced++;
    }
  });
  return synced;
}

/* 保存按钮 */
  document.getElementById('cmSaveBtn').addEventListener('click',function(){
    var newName=document.getElementById('cmName').value.trim();
    if(!newName){toast('请输入小区名称','error');return}
    var id=document.getElementById('cmId').value;
    var origName=document.getElementById('cmOrigName').value;
    var p=id?findProp(id):{};
    p.type='community';
    p.title=newName;
    p.community=newName;
    p.district=document.getElementById('cmDistrict').value;
    p.block=document.getElementById('cmBlock').value.trim();
    p.buildingCount=document.getElementById('cmBuildingCount').value.trim();
    p.householdCount=document.getElementById('cmHouseholdCount').value.trim();
    p.buildingAge=document.getElementById('cmBuildingAge').value.trim();
    p.street=document.getElementById('cmStreet').value.trim();
    p.neighborhood=document.getElementById('cmNeighborhood').value.trim();
    p.builtYear=document.getElementById('cmBuiltYear').value.trim();
    p.plotRatio=document.getElementById('cmPlotRatio').value.trim();
    p.greenRate=document.getElementById('cmGreenRate').value.trim();
    p.buildingType=document.getElementById('cmBuildingType').value;
    p.developer=document.getElementById('cmDeveloper').value.trim();
    p.parkingSpaces=document.getElementById('cmParkingSpaces').value.trim();
    p.address=document.getElementById('cmAddress').value.trim();
    p.lng=document.getElementById('cmLng').value.trim();
    p.lat=document.getElementById('cmLat').value.trim();
    p.kindergarten=document.getElementById('cmKindergarten').value.trim();
    p.primarySchool=document.getElementById('cmPrimarySchool').value.trim();
    p.middleSchool=document.getElementById('cmMiddleSchool').value.trim();
    p.schoolFamous=document.getElementById('cmSchoolFamous').value.trim();
    p.propertyManagement=document.getElementById('cmPropertyManagement').value.trim();
    p.alias=document.getElementById('cmAlias').value.trim();
    p.elevatorRatio=document.getElementById('cmElevatorRatio').value.trim();
    p.floorHeight=document.getElementById('cmFloorHeight').value.trim();
    p.roomRate=document.getElementById('cmRoomRate').value.trim();
    p.parkingRatio=document.getElementById('cmParkingRatio').value.trim();
    p.parkingPrice=document.getElementById('cmParkingPrice').value.trim();
    p.parkingRent=document.getElementById('cmParkingRent').value.trim();
    p.metro=metros.filter(function(m){return m.line||m.station||m.distance});
    p.amenities=amenities.filter(function(a){return a.type||a.name||a.distance});
    p.propertyFees=fees.filter(function(f){return f.type||f.fee});
    p.notes=document.getElementById('cmNotes').value.trim();
    if(!id){
      p.id=uuid();p.createdAt=now();
      S.properties.push(p);
    }else{
      p.updatedAt=now();
    }
    /* 如果改了名字，更新关联房源的community字段 */
    if(origName&&origName!==newName){
      S.properties.forEach(function(prop){
        if(prop.type!=='community'&&prop.community===origName){
          prop.community=newName;
          /* 重新生成标题 */
          if(prop.type==='secondhand'||prop.type==='rental'){
            var locStr=[prop.building,prop.unit,prop.room].filter(Boolean).join(' ');
            prop.title=newName+(locStr?(' '+locStr):'');
          }
        }
      });
    }
    /* 同步小区概况的装修/建成年代到该小区所有房源（仅填充空值） */
    var _decoRule=extractCommunityDecoration(p);
    var _commYear=extractCommunityYear(p);
    if(_decoRule||_commYear){
      var _sc=syncCommunityToProps(newName,_decoRule,_commYear);
      if(_sc>0)console.log('[cmSave] synced decoration/buildingAge to '+_sc+' properties');
    }
    saveP();
    document.getElementById('communityFormModal').remove();
    /* 若当前正在房源详情里编辑，则刷新详情（楼盘概况被该小区所有房源共享）；否则刷新房源列表 */
    if(S.curPropId&&document.getElementById('propDetailModal')&&document.getElementById('propDetailModal').classList.contains('show')){
      showPropertyDetail(S.curPropId);
    }else{
      renderPropertyList();
    }
    /* 编辑弹窗指定的回调（如：概览查看弹窗编辑后自动刷新） */
    if(_onSaved){try{_onSaved()}catch(e){console.error('[openCommunityForm onSaved]',e)}}
    toast('楼盘概况已保存','success');
  });
  }catch(err){
    console.error('[openCommunityForm]',err);
    toast('打开小区概况编辑失败: '+(err&&err.message||err),'error');
  }
}

/* 小区智能识别录入 */
function openCommunitySmartInput(){
  var html='<div class="modal-overlay show" id="cmSmartModal">'
    +'<div class="modal" style="max-width:600px">'
    +'<div class="modal-header"><h3>小区概况智能录入</h3><button class="modal-close" onclick="document.getElementById(\'cmSmartModal\').remove()">×</button></div>'
    +'<div class="modal-body" style="max-height:70vh;overflow-y:auto;padding:16px">'
    +'<div class="sig-hint" style="background:var(--primary-light);border-radius:8px;padding:10px;margin-bottom:12px;font-size:.875rem;color:var(--text-secondary)">'
    +'粘贴小区概况信息，支持以下格式：<br>'
    +'1. 表格粘贴（Excel直接粘贴）<br>'
    +'2. 键值对（小区名：XX 楼幢：12幢 房龄：2018年 ...）<br>'
    +'3. 自由文本（系统尝试自动识别关键字段）</div>'
    +'<textarea id="cmSmartArea" rows="10" style="width:100%;font-size:.875rem;padding:8px;border:1px solid var(--border);border-radius:6px" placeholder="粘贴小区概况信息…"></textarea>'
    +'<div class="smart-file-upload" style="margin-top:10px">'
    +'<label class="sfu-btn" style="display:inline-flex;align-items:center;gap:4px;border:1px dashed var(--primary);background:var(--primary-light);color:var(--primary);padding:6px 12px;border-radius:6px;font-size:.875rem;cursor:pointer;font-weight:500;pointer-events:auto">'
    +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
    +'上传文件识别'
    +'<input type="file" id="cmSmartFileInput" style="display:none" multiple onchange="window.handleCommunitySmartFileChange(event)">'
    +'</label>'
    +'<span class="sfu-hint" id="cmSmartFileHint" style="margin-left:8px;font-size:.8125rem;color:var(--text-muted)">支持 Excel/CSV 表格、文本文件、截图照片（可一次多选，逐张排队识别）</span>'
    +'</div>'
    +'<div id="cmSmartPreview" style="margin-top:12px"></div>'
    +'</div>'
    +'<div class="modal-footer">'
    +'<button class="btn-secondary" onclick="document.getElementById(\'cmSmartModal\').remove()">取消</button>'
    +'<button class="btn-primary" id="cmSmartParseBtn" onclick="parseCommunitySmart()">识别</button>'
    +'<button class="btn-primary" id="cmSmartImportBtn" style="display:none" onclick="importCommunitySmart()">全部录入</button>'
    +'</div></div></div>';
  var old=document.getElementById('cmSmartModal');
  if(old)old.remove();
  document.body.insertAdjacentHTML('beforeend',html);
  var parsedCommunities=[];
  /* 小区概况智能识别 — 全局onclick函数（parsedCommunities用闭包变量） */
  window.parsedCommunities=[];
  window.parseCommunitySmart=function(){
    var text=document.getElementById('cmSmartArea').value.trim();
    if(!text){toast('请先粘贴数据','error');return}
    window.parsedCommunities=parseCommunitySmartInput(text);
    if(window.parsedCommunities.length===0){
      document.getElementById('cmSmartPreview').innerHTML='<p style="color:var(--warning)">未识别到有效小区数据，请检查格式</p>';
      return;
    }
    document.getElementById('cmSmartPreview').innerHTML='<p style="color:var(--success)">已识别 '+window.parsedCommunities.length+' 个小区，请检查后点击「全部录入」</p>'
      +window.parsedCommunities.map(function(c,i){
        return'<div style="background:var(--bg-secondary);border-radius:6px;padding:8px;margin-bottom:6px;font-size:.8125rem">'
          +'<b>'+(c.title||c.community||'未命名')+'</b>'
          +(c.district?' | '+c.district:'')+(c.block?' · '+c.block:'')
          +(c.buildingCount?' | 楼幢:'+c.buildingCount:'')
          +(c.buildingAge?' | 房龄:'+c.buildingAge:'')
          +(c.street?' | '+c.street:'')
          +(c.propertyManagement?' | 物业:'+c.propertyManagement:'')
          +'</div>';
      }).join('');
    document.getElementById('cmSmartImportBtn').style.display='';
  };
  window.importCommunitySmart=function(){
    /* v6.35 智能查重：区分新增和更新 */
    var cmImported=0,cmUpdated=0;
    window.parsedCommunities.forEach(function(c){
      var existing=S.properties.find(function(p){return p.type==='community'&&(p.title===c.title||p.community===c.title)});
      if(existing){
        Object.keys(c).forEach(function(k){if(c[k])existing[k]=c[k]});
        existing.updatedAt=now();
        cmUpdated++;
      }else{
        c.id=uuid();c.type='community';c.createdAt=now();
        if(!c.community)c.community=c.title;
        S.properties.push(c);
        cmImported++;
      }
    });
    saveP();
    document.getElementById('cmSmartModal').remove();
    if(S.curPropId&&document.getElementById('propDetailModal')&&document.getElementById('propDetailModal').classList.contains('show')){
      showPropertyDetail(S.curPropId);
    }else{
      renderPropertyList();
    }
    var cmMsg='已录入 '+window.parsedCommunities.length+' 个小区概况';
    if(cmImported>0)cmMsg+='（新增'+cmImported+'个）';
    if(cmUpdated>0)cmMsg+='（更新'+cmUpdated+'个已有）';
    toast(cmMsg,'success');
  };
  /* 文件识别 — 复用 handleSmartFileUpload，但目标 textarea 是 cmSmartArea */
  document.getElementById('cmSmartFileInput').addEventListener('change',function(e){
    var files=Array.from(e.target.files||[]);
    if(!files.length)return;
    files.forEach(function(f){handleCommunitySmartFileUpload(f)});
    e.target.value='';
  });
}

/* 小区智能录入文件处理：解析后回填到 cmSmartArea */
function handleCommunitySmartFileUpload(file){
  var hintEl=document.getElementById('cmSmartFileHint');
  var ta=document.getElementById('cmSmartArea');
  if(!file||!ta)return;
  var name=file.name.toLowerCase();
  var ext=name.split('.').pop();
  if(ext==='xlsx'||ext==='xls'){
    hintEl.textContent='正在解析Excel文件...';hintEl.style.color='var(--warning)';
    loadSheetJS().then(function(){
      var reader=new FileReader();
      reader.onload=function(e){
        try{
          var data=new Uint8Array(e.target.result);
          var wb=XLSX.read(data,{type:'array'});
          var sheets=wb.SheetNames;
          var allText='';
          for(var s=0;s<sheets.length;s++){
            var ws=wb.Sheets[sheets[s]];
            var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,blankrows:false});
            if(s>0)allText+='\n';
            allText+='# sheet: '+sheets[s]+'\n';
            var lines=[];
            for(var r=0;r<rows.length;r++){
              var row=rows[r]||[];
              var cells=[];
              for(var ci=0;ci<row.length;ci++){
                var v=row[ci];
                v=(v==null?'':String(v));
                v=v.replace(/[\r\n\t]/g,'\u0001');
                cells.push(v);
              }
              lines.push(cells.join('\t'));
            }
            allText+=lines.join('\n')+'\n';
          }
          ta.value=(ta.value?ta.value+'\n':'')+allText;
          hintEl.textContent='Excel解析完成，共'+sheets.length+'个工作表，请点击「识别」';hintEl.style.color='var(--success)';
        }catch(err){
          hintEl.textContent='Excel解析失败：'+err.message;hintEl.style.color='var(--danger)';
        }
      };
      reader.readAsArrayBuffer(file);
    }).catch(function(){
      hintEl.textContent='Excel解析库加载失败，请重试或直接粘贴';hintEl.style.color='var(--danger)';
    });
  }else if(ext==='csv'||ext==='txt'){
    hintEl.textContent='正在读取文件...';hintEl.style.color='var(--warning)';
    var reader=new FileReader();
    reader.onload=function(e){
      var text=e.target.result;
      ta.value=(ta.value?ta.value+'\n':'')+text;
      hintEl.textContent='文件读取完成，请点击「识别」';hintEl.style.color='var(--success)';
    };
    reader.readAsText(file);
  }else if(ext==='png'||ext==='jpg'||ext==='jpeg'){
    hintEl.textContent='首次加载OCR引擎约需10-30秒，请稍候...';hintEl.style.color='var(--warning)';
    loadTesseract().then(function(worker){
      hintEl.textContent='OCR引擎就绪，正在识别图片文字...';hintEl.style.color='var(--warning)';
      worker.recognize(file).then(function(result){
        var text=(result&&result.data&&result.data.text)||'';
        text=text.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
        if(text){
          ta.value=(ta.value?ta.value+'\n':'')+text;
          hintEl.textContent='✅ 图片识别完成（共'+text.length+'字），请点击「识别」';hintEl.style.color='var(--success)';
        }else{
          hintEl.textContent='⚠️ 图片识别完成但未提取到文字，可手动输入或重新拍照';hintEl.style.color='var(--warning)';
        }
      }).catch(function(err){
        hintEl.textContent='图片识别失败：'+(err.message||err)+'。可手动输入或重试';hintEl.style.color='var(--danger)';
      });
    }).catch(function(err){
      hintEl.textContent='OCR引擎加载失败：'+(err.message||err)+'，请手动输入或重试';hintEl.style.color='var(--danger)';
    });
  }else{
    hintEl.textContent='不支持的文件格式，请上传Excel/CSV/TXT/PNG/JPG';hintEl.style.color='var(--danger)';
  }
}
/* v6.35 小区概况文件change兜底 */
window.handleCommunitySmartFileChange=function(e){
  var files=Array.from(e.target.files||[]);
  files.forEach(function(f){handleCommunitySmartFileUpload(f)});
  e.target.value='';
};

/* ===== 小区概况智能识别辅助函数（v6.35+ 对齐「小区概览填表模板」） ===== */
function _commHasId(c){
  return !!(c.title||c.alias||c.buildingCount||c.householdCount||c.developer||c.buildingAge||c.builtYear||c.plotRatio||c.greenRate||c.buildingType||(c.metro&&c.metro.length)||(c.amenities&&c.amenities.length));
}
function extractDist(val){
  var m=val.match(/(步行\s*约?\s*\d+\s*分钟|约?\s*\d+\s*分钟|约?\s*\d+\s*米|约?\s*\d+(\.\d+)?\s*公里)/);
  return m?m[0].replace(/\s/g,''):null;
}
function parseMetro(val){
  if(!val)return null;
  var line=null,station=null,distance=null;
  var lm=val.match(/(\d+\s*号线)/); if(lm)line=lm[1].replace(/\s/g,'');
  var sm=val.match(/([^\s,，、]+站)/); if(sm)station=sm[1];
  distance=extractDist(val);
  if(line||station||distance)return{line:line,station:station,distance:distance};
  return null;
}
function parseAmenity(type,val){
  if(!val||/^无/.test(val))return null;
  var distance=extractDist(val);
  var name=val.replace(distance||'','');
  name=name.replace(/^(最近|邻近|周边)?\s*(商场|超市|菜市场|医院|卫生院|公园|体育馆|运动场|不利因素|高架|变电站|垃圾站|工厂|学校)[：:]?\s*/,'');
  name=name.replace(/[／/].*$/,'').trim();
  if(!name)return null;
  return{type:type,name:name,distance:distance};
}
function _mapCommunityField(c,key,val){
  if(/小区|名称|全名|楼盘/.test(key)&&!/区域|板块|商圈/.test(key)){ if(!c.title){c.title=val;c.community=val} }
  else if(/别名|简称/.test(key)){ c.alias=val }
  else if(/区域|行政区/.test(key)&&!/板块/.test(key)){ c.district=val }
  else if(/板块|商圈/.test(key)){ c.block=val }
  else if(/栋数|楼幢|总栋/.test(key)){ c.buildingCount=val }
  else if(/车位配比|车位比/.test(key)){ c.parkingRatio=val }
  else if(/车位售价|车位卖|车位销售/.test(key)){ c.parkingPrice=val }
  else if(/车位月租|月租/.test(key)){ c.parkingRent=val }
  else if(/户数|总户/.test(key)){ c.householdCount=val }
  else if(/停车位|车位/.test(key)&&!/配比|售价|月租|比/.test(key)){ c.parkingSpaces=val }
  else if(/建筑年代|建成年|交付年|年代/.test(key)){ c.builtYear=c.builtYear||val; if(!c.buildingAge)c.buildingAge=val }
  else if(/房龄/.test(key)){ c.buildingAge=c.buildingAge||val; if(!c.builtYear)c.builtYear=val }
  else if(/建筑类型|产品类型/.test(key)){ c.buildingType=val }
  else if(/开发商/.test(key)){ c.developer=val }
  else if(/容积率/.test(key)){ c.plotRatio=val }
  else if(/绿化率/.test(key)){ c.greenRate=val }
  else if(/梯户比|梯户/.test(key)){ c.elevatorRatio=val }
  else if(/层高|标准层高/.test(key)){ c.floorHeight=val }
  else if(/得房率/.test(key)){ c.roomRate=val }
  else if(/街道/.test(key)){ c.street=val }
  else if(/社区/.test(key)&&!/小区/.test(key)){ c.neighborhood=val }
  else if(/详细地址|地址/.test(key)){ c.address=val }
  else if(/经度/.test(key)){ c.lng=val }
  else if(/纬度/.test(key)){ c.lat=val }
  else if(/幼儿园/.test(key)){ c.kindergarten=val }
  else if(/小学/.test(key)){ c.primarySchool=val }
  else if(/中学|初中/.test(key)){ c.middleSchool=val }
  else if(/名校/.test(key)){ c.schoolFamous=val }
  else if(/学区/.test(key)){
    var ps=val.match(/小学[：:]?\s*([^\n/·]+)/); if(ps)c.primarySchool=(ps[1]||'').trim()||c.primarySchool;
    var ms=val.match(/初中[：:]?\s*([^\n/·]+)/)||val.match(/中学[：:]?\s*([^\n/·]+)/); if(ms)c.middleSchool=(ms[1]||'').trim()||c.middleSchool;
    var fm=val.match(/名校[：:]?\s*([^\n/·]+)/); if(fm)c.schoolFamous=(fm[1]||'').trim()||c.schoolFamous;
  }
  else if(/物业/.test(key)){
    if(/费/.test(key)){
      var ft=null; var fm2=key.match(/物业费[（(]([^）)]+)[）)]/); if(fm2&&!/元|月|㎡|平方|m²/i.test(fm2[1]))ft=fm2[1];
      c.propertyFees=c.propertyFees||[]; c.propertyFees.push({type:ft||'',fee:val});
    } else { c.propertyManagement=val }
  }
  else if(/地铁/.test(key)){ var m=parseMetro(val); if(m){c.metro=c.metro||[];c.metro.push(m)} }
  else if(/商业|商场|超市|菜市场|购物/.test(key)){ var a=parseAmenity('商业',val); if(a){c.amenities=c.amenities||[];c.amenities.push(a)} }
  else if(/医疗|医院|卫生/.test(key)){ var a=parseAmenity('医疗',val); if(a){c.amenities=c.amenities||[];c.amenities.push(a)} }
  else if(/休闲|公园|体育馆|运动/.test(key)){ var a=parseAmenity('休闲',val); if(a){c.amenities=c.amenities||[];c.amenities.push(a)} }
  else if(/不利因素|高架|变电站|垃圾站|工厂/.test(key)){ var a=parseAmenity('不利因素',val); if(a){c.amenities=c.amenities||[];c.amenities.push(a)} }
  else if(/简评|板块简评|小结|综述|点评|总结/.test(key)){ c.notes=val }
  else if(/备注|其他|说明/.test(key)){ c.notes=(c.notes?c.notes+'\n':'')+val }
}
/* 解析小区智能录入 */
function parseCommunitySmartInput(text){
  var results=[];
  /* 尝试检测表格格式（制表符或多个空格分隔） */
  var lines=text.split('\n').filter(function(l){return l.trim()});
  /* 检测是否有表头 */
  var headerMap={'小区':null,'名称':null,'楼幢':null,'户数':null,'房龄':null,'街道':null,'社区':null,'幼儿园':null,'小学':null,'中学':null,'物业':null,'物业费':null,'区域':null,'板块':null,'商圈':null};
  /* 尝试键值对解析（整行取值，支持模板中带空格的值） */
  var cur={metro:[],amenities:[],propertyFees:[]};
  var hasKV=false;
  var section='';
  lines.forEach(function(raw){
    var hm=raw.match(/^[一二三四五六七八九十]+[、.]\s*(.+)$/);
    if(hm){ section=hm[1]; return; }
    var line=raw.replace(/^[-•·▪]\s*/,'').replace(/^[\d]+[.、)]\s*/,'').replace(/^[（(][^）)]*[）)]\s*/,'').trim();
    if(!line)return;
    if(/简评|综述|小结|点评|总结|板块/.test(section)){
      cur.notes=(cur.notes?cur.notes+'\n':'')+line; hasKV=true; return;
    }
    var fi=line.indexOf('：');
    var ci=fi>=0?fi:line.indexOf(':');
    if(ci<0)return;
    var key=line.slice(0,ci).trim();
    var val=line.slice(ci+1).trim();
    if(!val)return;
    hasKV=true;
    _mapCommunityField(cur,key,val);
  });
  if(hasKV&&_commHasId(cur))return[cur];
  /* 尝试表格解析（Tab或逗号分隔） */
  if(lines.length>=2){
    var sep=lines[0].indexOf('\t')>=0?'\t':',';
    var headers=lines[0].split(sep).map(function(h){return h.trim()});
    var hasHeader=headers.some(function(h){return h.indexOf('小区')>=0||h.indexOf('名称')>=0||h.indexOf('物业')>=0});
    if(hasHeader){
      for(var i=1;i<lines.length;i++){
        var cols=lines[i].split(sep);
        var obj={metro:[],amenities:[],propertyFees:[]};
        var used=false;
        headers.forEach(function(h,idx){
          var val=cols[idx]?cols[idx].trim():'';
          if(!val)return;
          used=true;
          _mapCommunityField(obj,h,val);
        });
        if(used&&(obj.title||obj.buildingCount||obj.developer))results.push(obj);
      }
      if(results.length>0)return results;
    }
  }
  /* 自由文本：按行识别，每行一个小区 */
  lines.forEach(function(line){
    var obj={};
    /* 尝试提取小区名 */
    var nameMatch=line.match(/([^\s,，、|]+)(小区|花园|公寓|苑|府|城|湾|里|邸|台)/);
    if(nameMatch){
      obj.title=nameMatch[0];obj.community=obj.title;
    }
    /* 提取区域 */
    var districtMatch=line.match(/(临平|余杭|萧山|拱墅|西湖|上城|滨江|钱塘|富阳|临安)/);
    if(districtMatch)obj.district=districtMatch[1];
    /* 提取房龄 */
    var ageMatch=line.match(/(\d{4})\s*年/);
    if(ageMatch)obj.buildingAge=ageMatch[1]+'年';
    /* 提取楼幢 */
    var bldMatch=line.match(/(\d+)\s*[幢栋]/);
    if(bldMatch)obj.buildingCount=bldMatch[1]+'幢';
    /* 提取户数 */
    var hhMatch=line.match(/(\d+)\s*户/);
    if(hhMatch)obj.householdCount=hhMatch[1]+'户';
    if(obj.title)results.push(obj);
  });
  return results;
}

function renderPropertyTable(){
  try{
  var list=getFilteredProperties();
  var table=document.getElementById('propertyTable');
  document.getElementById('propResultCount').innerHTML='共 <b>'+list.length+'</b> 套房源 '+(isAdmin()?'<button class="btn btn-sm btn-outline" onclick="exportCurrentCSV(\x27properties\x27)" style="margin-left:12px;font-size:.75rem" title="导出房源列表为CSV">📥 导出CSV</button>':'');

  if(list.length===0){
    var isEmptyAll=S.properties.length===0;
    table.innerHTML='<div class="empty" style="padding:40px"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg><h3>'+(isEmptyAll?'还没有房源档案':'没有符合条件的房源')+'</h3><p>'+(isEmptyAll?'点击「新增房源」按钮开始录入':'试试调整筛选条件')+'</p></div>';
    return;
  }

  /* 批量操作工具栏（使用共享 #propBatchBar 容器，与卡片视图统一） */
  var checkedCount=S.checkedPropIds?(S.checkedPropIds.length):0;
  if(S.propBatchMode){
    var batchBarEl=document.getElementById('propBatchBar');
    if(batchBarEl){
      batchBarEl.style.display='';
      batchBarEl.className='prop-batch-bar show';
      batchBarEl.innerHTML=''
        +'<span class="bb-count" id="propCheckedCount">已选 '+checkedCount+' 条房源</span>'
        +'<button class="btn btn-outline btn-sm" id="propSelectAll">全选当前</button>'
        +'<button class="btn btn-outline btn-sm" id="propClearCheck">清空选择</button>'
        +(checkedCount>0
          ?'<button class="btn btn-primary btn-sm" id="propBatchStatus">批量改状态('+checkedCount+')</button>'
            +'<button class="btn btn-success btn-sm" id="propBatchTag">批量打标签('+checkedCount+')</button>'
    +'<button class="btn btn-outline btn-sm" id="propBatchCompare" style="color:var(--info)">📊 房源对比('+checkedCount+')</button>'
            +(isAdmin()?'<button class="btn btn-danger btn-sm" id="propBatchDelete">批量删除('+checkedCount+')</button>':'')
            +'<button class="btn btn-outline btn-sm" id="propExitBatch">退出批量</button>'
          :''
        );
    }
  }else{
    var bb=document.getElementById('propBatchBar');
    if(bb)bb.style.display='none';
  }

  var toolbarHtml='';

  var isSh=(S.subtab==='secondhand');
  var isRt=(S.subtab==='rental');
  var isShOrRt=isSh||isRt;

  var html=toolbarHtml;
  if(isShOrRt){
    /* 二手房/租赁房表格 */
    html+='<div class="client-table-wrap"><table class="client-table"><thead><tr>'
      +(S.propBatchMode?'<th style="width:32px"><input type="checkbox" id="propCheckAllHead" '+(checkedCount>0&&checkedCount===list.length?'checked':'')+'></th>':'')
      +'<th>行政区</th>'
      +'<th>小区</th>'
      +'<th>楼幢</th>'
      +'<th>单元</th>'
      +'<th>房间号</th>'
      +'<th>面积(㎡)</th>'
      +'<th>户型</th>'
      +(isRt?'<th>月租(元)</th><th>押付</th><th>租赁方式</th>':'<th>总价(万)</th><th>单价(元/㎡)</th>')
      +'<th>装修</th>'
      +'<th>朝向</th>'
      +'<th>建成年代</th>'
      +'<th>状态</th>'
      +'<th>业主</th>'
      +'<th>电话</th>'
      +'<th>操作</th>'
      +'</tr></thead><tbody>';
    for(var i=0;i<list.length;i++){
      var p=list[i];
      var propPinned=(S.pinnedPropIds||[]).indexOf(p.id)>=0;
      var isChecked=(S.checkedPropIds||[]).indexOf(p.id)>=0;
      var rowCls=[];
      if(propPinned)rowCls.push('is-pinned');
      if(p.status==='下架')rowCls.push('invalid');
      if(p.status==='已售'||p.status==='售罄'||p.status==='已租')rowCls.push('is-completed');
      var locTitle=(p.community||'')+(p.building?(' '+p.building):'')+(p.unit?(' '+p.unit):'')+(p.room?(' '+p.room):'');
      html+='<tr data-id="'+p.id+'"'+(rowCls.length?' class="'+rowCls.join(' ')+'"':'')+'>'
        +(S.propBatchMode?'<td><input type="checkbox" class="prop-check" data-prop-check-id="'+p.id+'" '+(isChecked?'checked':'')+'></td>':'')
        +'<td>'+(p.district?'<span class="ct-area">'+esc(p.district)+'</span>':'<span style="color:var(--gray-400)">—</span>')+'</td>'
        +'<td><span class="ct-name" title="'+esc(locTitle)+'">'+esc(cleanCommunityName(p.community)||'—')+'</span></td>'
        +'<td>'+esc(p.building||'—')+'</td>'
        +'<td>'+esc((p.unit||'').replace(/单元$/,'')||((p.type==='secondhand'||p.type==='rental')?'1':'—'))+'</td>'
        +'<td>'+esc(p.room||'—')+'</td>'
        +'<td>'+(p.area?esc(p.area):'—')+'</td>'
        +'<td>'+esc(p.layout||'—')+'</td>';
      if(isRt){
        html+='<td><span class="ct-budget" style="color:var(--primary)">'+(p.rentPrice?esc(p.rentPrice):'—')+'</span></td>'
          +'<td>'+esc(p.depositType||'—')+'</td>'
          +'<td>'+esc(p.rentType||'—')+'</td>';
      }else{
        html+='<td><span class="ct-budget" style="color:var(--primary)">'+(p.totalPrice?esc(p.totalPrice):'—')+'</span></td>'
          +'<td>'+(p.unitPrice?esc(p.unitPrice):'—')+'</td>';
      }
      html+='<td>'+esc(p.decoration||'—')+'</td>'
        +'<td>'+esc(p.orientation||'—')+'</td>'
        +'<td>'+esc(p.buildingAge||'—')+'</td>'
        +'<td><span class="status-badge" data-status="'+esc(p.status)+'">'+esc(p.status)+'</span></td>'
        +'<td>'+esc(p.ownerName||'—')+'</td>'
        +'<td>'+(p.ownerPhone?(function(){
            if(isPhoneUnlocked(p)){
              var phs=p.ownerPhone.split(/\s*\/\s*/).filter(Boolean);
              return phs.map(function(ph){return'<a href="tel:'+esc(ph)+'">'+esc(ph)+'</a>'}).join('<br>');
            }
            var rem=phoneViewRemaining();
            if(rem<=0)return'<span class="sensitive-masked" title="今日额度已用完">***</span>';
            return'<button type="button" class="phone-unlock-btn tbl" onclick="unlockOwnerPhone(\''+esc(p.id)+'\')">👁 查看('+rem+')</button>';
          })():'—')+'</td>'
        +'<td><button class="ct-action-btn" data-prop-view-id="'+p.id+'">详情</button><button class="ct-action-btn" data-prop-edit-id="'+p.id+'">编辑</button></td>'
        +'</tr>';
    }
    html+='</tbody></table></div>';
  }else{
    /* 新楼盘表格（保持原逻辑） */
    html+='<div class="client-table-wrap"><table class="client-table"><thead><tr>'
    +(S.propBatchMode?'<th style="width:32px"><input type="checkbox" id="propCheckAllHeadNewdev" '+(checkedCount>0&&checkedCount===list.length?'checked':'')+'></th>':'')
    +'<th>行政区</th>'
    +'<th>项目名称</th>'
    +'<th>商圈</th>'
    +'<th>物业类型</th>'
    +'<th>开发商</th>'
    +'<th>在售面积（㎡）</th>'
    +'<th>均价（元）</th>'
    +'<th>在售楼幢</th>'
    +'<th>加推楼幢</th>'
    +'<th>加推价格</th>'
    +'<th>起步总价</th>'
    +'<th>基本卖点</th>'
    +'<th>优惠政策+车位</th>'
    +'<th>地铁线路</th>'
    +'<th>预计交付时间</th>'
    +'<th>佣金情况</th>'
    +'<th>带看规则+保护期</th>'
    +'<th>剩余房源</th>'
    +'<th>操作</th>'
    +'</tr></thead><tbody>';

  for(var i=0;i<list.length;i++){
    var p=list[i];
    var isSold=p.status==='已售'||p.status==='售罄';
    var isOff=p.status==='下架';

    /* 字段展示 */
    var districtStr=p.district?'<span class="ct-area">'+esc(p.district)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var titleCell='<span class="ct-name" title="'+esc(p.title||'')+'">'+esc(p.title||'')+'</span>';
    var businessDistrictStr=p.businessDistrict?'<span style="font-size:.8125rem;color:var(--text-secondary)">'+esc(p.businessDistrict)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var propertyTypeStr=p.propertyType?'<span style="font-size:.8125rem">'+esc(p.propertyType)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var developerStr=p.developer?'<span style="font-size:.8125rem">'+esc(p.developer)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var layoutsStr=p.availableLayouts?'<span style="font-size:.8125rem">'+esc(p.availableLayouts)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var avgPriceStr=p.averagePriceText?('<span style="font-size:.8125rem" title="'+esc(p.averagePriceText)+'">'+esc(p.averagePriceText)+'</span>'):(p.averagePrice?(p.averagePrice+'<span style="font-size:.75rem">元/㎡</span>'):'<span style="color:var(--gray-400)">—</span>');
    var onSaleBldStr=p.onSaleBuildings?'<span style="font-size:.8125rem" title="'+esc(p.onSaleBuildings)+'">'+esc(truncateText(p.onSaleBuildings,18))+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var addBldStr=p.additionalBuildings?'<span style="font-size:.8125rem;color:var(--warning,#d97706)" title="'+esc(p.additionalBuildings)+'">'+esc(truncateText(p.additionalBuildings,18))+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var addPriceStr=p.additionalPrice?'<span style="font-size:.8125rem;color:var(--warning,#d97706)">'+esc(p.additionalPrice)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var totalPriceStr=p.totalPrice?('<span title="'+esc(p.totalPriceText||'')+'">'+p.totalPrice+'<span style="font-size:.75rem">万起</span></span>'):'<span style="color:var(--gray-400)">—</span>';
    var highlightsStr=p.highlights?'<span style="font-size:.8125rem;color:var(--text-secondary)" title="'+esc(p.highlights)+'">'+esc(truncateText(p.highlights,28))+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var preferentialStr=p.preferential?'<span style="font-size:.8125rem;color:var(--text-secondary)" title="'+esc(p.preferential)+'">'+esc(truncateText(p.preferential,28))+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var metroStr=p.metro?'<span style="font-size:.8125rem" title="'+esc(p.metro)+'">'+esc(p.metro)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var deliveryStr=p.deliveryDate?esc(p.deliveryDate):'<span style="color:var(--gray-400)">—</span>';
    var commissionStr=p.commission?'<span style="font-size:.8125rem;color:var(--success)" title="'+esc(p.commission)+'">'+esc(p.commission)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var viewingRuleStr='';
    if(p.viewingRule||p.protectionPeriod){
      var combined=trimEmpty(p.viewingRule)+(p.viewingRule&&p.protectionPeriod?'\n':'')+trimEmpty(p.protectionPeriod);
      viewingRuleStr='<span style="font-size:.8125rem;color:var(--text-secondary)" title="'+esc(combined)+'">'+esc(truncateText(combined,28))+'</span>';
    }else{
      viewingRuleStr='<span style="color:var(--gray-400)">—</span>';
    }
    var remainingStr=p.remaining?'<span style="font-size:.8125rem">'+esc(p.remaining)+'</span>':'<span style="color:var(--gray-400)">—</span>';

    var propPinned=(S.pinnedPropIds||[]).indexOf(p.id)>=0;
    var propRowCls=[];
    if(propPinned)propRowCls.push('is-pinned');
    if(isOff)propRowCls.push('invalid');
    if(isSold)propRowCls.push('is-completed');
    var isChecked=(S.checkedPropIds||[]).indexOf(p.id)>=0;

    html+='<tr data-id="'+p.id+'"'+(propRowCls.length?' class="'+propRowCls.join(' ')+'"':'')+'>'
      +(S.propBatchMode?'<td><input type="checkbox" class="prop-check" data-prop-check-id="'+p.id+'" '+(isChecked?'checked':'')+'></td>':'')
      +'<td>'+districtStr+'</td>'
      +'<td>'+titleCell+'</td>'
      +'<td>'+businessDistrictStr+'</td>'
      +'<td>'+propertyTypeStr+'</td>'
      +'<td>'+developerStr+'</td>'
      +'<td>'+layoutsStr+'</td>'
      +'<td><span class="ct-budget" style="color:'+(isSold?'var(--text-muted)':'var(--primary)')+'">'+avgPriceStr+'</span></td>'
      +'<td>'+onSaleBldStr+'</td>'
      +'<td>'+addBldStr+'</td>'
      +'<td>'+addPriceStr+'</td>'
      +'<td><span class="ct-budget" style="color:'+(isSold?'var(--text-muted)':'var(--primary)')+'">'+totalPriceStr+'</span></td>'
      +'<td>'+highlightsStr+'</td>'
      +'<td>'+preferentialStr+'</td>'
      +'<td>'+metroStr+'</td>'
      +'<td>'+deliveryStr+'</td>'
      +'<td>'+commissionStr+'</td>'
      +'<td>'+viewingRuleStr+'</td>'
      +'<td>'+remainingStr+'</td>'
      +'<td>'
      +'<button class="ct-action-btn" data-prop-view-id="'+p.id+'" title="详情">详情</button>'
      +'<button class="ct-action-btn" data-prop-edit-id="'+p.id+'" title="编辑">编辑</button>'
      +'</td>'
      +'</tr>';
  }
  html+='</tbody></table></div>';
  } /* end else (newdev table) */
  table.innerHTML=html;

  /* sticky header: 让表格容器有固定高度，thead sticky 生效（与客户管理一致） */
  (function(){
    var wrap=table.querySelector('.client-table-wrap');
    if(!wrap)wrap=table.parentElement;
    if(!wrap)return;
    var vh=window.innerHeight||document.documentElement.clientHeight||600;
    var rect=wrap.getBoundingClientRect();
    var offsetTop=rect.top+window.scrollY;
    var avail=Math.max(300,vh-offsetTop-20/*底部留白*/);
    wrap.style.maxHeight=avail+'px';
  })();

  /* view detail */
  table.querySelectorAll('[data-prop-view-id]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      showPropertyDetail(btn.getAttribute('data-prop-view-id'));
    });
  });

  /* edit */
  table.querySelectorAll('[data-prop-edit-id]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      openPropertyForm(btn.getAttribute('data-prop-edit-id'));
    });
  });

  /* row click -> 批量模式切换勾选，否则看详情 */
  table.querySelectorAll('tbody tr').forEach(function(row){
    row.addEventListener('click',function(e){
      if(e.target.closest('button')||e.target.closest('select')||e.target.closest('a'))return;
      if(S.propBatchMode){
        if(e.target.closest('.prop-check'))return; /* checkbox 自己处理 */
        var id=row.getAttribute('data-id');
        S.checkedPropIds=S.checkedPropIds||[];
        var idx=S.checkedPropIds.indexOf(id);
        if(idx>=0)S.checkedPropIds.splice(idx,1);else S.checkedPropIds.push(id);
        var cb=row.querySelector('.prop-check');
        if(cb)cb.checked=idx<0;
        row.classList.toggle('is-selected',idx<0);
        updatePropBatchBar(list.length);
        return;
      }
      if(e.target.closest('input'))return;
      showPropertyDetail(row.getAttribute('data-id'));
    });
  });

  /* 行checkbox勾选 */
  table.querySelectorAll('.prop-check').forEach(function(cb){
    cb.addEventListener('change',function(e){
      e.stopPropagation();
      var id=this.getAttribute('data-prop-check-id');
      S.checkedPropIds=S.checkedPropIds||[];
      var idx=S.checkedPropIds.indexOf(id);
      if(this.checked&&idx<0)S.checkedPropIds.push(id);
      else if(!this.checked&&idx>=0)S.checkedPropIds.splice(idx,1);
      updatePropBatchBar(list.length);
      /* 更新表格行选中态 */
      this.closest('tr').classList.toggle('is-selected',this.checked);
    });
  });

  /* 全选 */
  var checkAll=document.getElementById('propCheckAll');
  if(checkAll){
    checkAll.addEventListener('change',function(){
      S.checkedPropIds=S.checkedPropIds||[];
      if(checkAll.checked){
        list.forEach(function(p){if(S.checkedPropIds.indexOf(p.id)<0)S.checkedPropIds.push(p.id)});
      }else{
        S.checkedPropIds=[];
      }
      renderPropertyTable();
    });
  }
  /* 表头全选（同步） */
  var checkAllHead=document.getElementById('propCheckAllHead');
  if(checkAllHead){
    checkAllHead.addEventListener('change',function(){
      if(checkAll)checkAll.checked=this.checked;
      S.checkedPropIds=S.checkedPropIds||[];
      if(this.checked){
        list.forEach(function(p){if(S.checkedPropIds.indexOf(p.id)<0)S.checkedPropIds.push(p.id)});
      }else{
        S.checkedPropIds=[];
      }
      renderPropertyTable();
    });
  }
  bindBatchBar();
  }catch(err){console.error('[renderPropertyTable]',err)}
}

/* 统一更新房源批量操作栏（卡片+表格共享 #propBatchBar，勾选/取消后立即刷新按钮） */
function updatePropBatchBar(total){
  var cnt=(S.checkedPropIds||[]).length;
  if(!S.propBatchMode)return;
  var batchBarEl=document.getElementById('propBatchBar');
  if(!batchBarEl)return;
  batchBarEl.innerHTML=''
    +'<span class="bb-count" id="propCheckedCount">已选 '+cnt+' 条房源</span>'
    +'<button class="btn btn-outline btn-sm" id="propSelectAll">全选当前</button>'
    +'<button class="btn btn-outline btn-sm" id="propClearCheck">清空选择</button>'
    +(cnt>0
      ?'<button class="btn btn-primary btn-sm" id="propBatchStatus">批量改状态('+cnt+')</button>'
        +'<button class="btn btn-success btn-sm" id="propBatchTag">批量打标签('+cnt+')</button>'
    +'<button class="btn btn-outline btn-sm" id="propBatchCompare" style="color:var(--info)">📊 房源对比('+cnt+')</button>'
        +(isAdmin()?'<button class="btn btn-danger btn-sm" id="propBatchDelete">批量删除('+cnt+')</button>':'')
        +'<button class="btn btn-outline btn-sm" id="propExitBatch">退出批量</button>'
      :''
    );
  bindBatchBar();
}
window.updatePropBatchBar=updatePropBatchBar;

function bindBatchBar(){
  /* 全选当前 */
  var selAll=document.getElementById('propSelectAll');
  if(selAll&&!selAll._bound){
    selAll._bound=true;
    selAll.addEventListener('click',function(){
      var list=(S.properties||[]).filter(function(p){return p.type!=='md'&&p.type!=='community'});
      S.checkedPropIds=list.map(function(p){return p.id});
      if(S.propViewMode==='table')renderPropertyTable();
      else renderPropertyList();
    });
  }
  /* 清空选择 */
  var clearBtn=document.getElementById('propClearCheck');
  if(clearBtn&&!clearBtn._bound){
    clearBtn._bound=true;
    clearBtn.addEventListener('click',function(){
      S.checkedPropIds=[];
      if(S.propViewMode==='table')renderPropertyTable();
      else renderPropertyList();
    });
  }
  /* 批量修改状态 */
  var statusBtn=document.getElementById('propBatchStatus');
  if(statusBtn&&!statusBtn._bound){
    statusBtn._bound=true;
    statusBtn.addEventListener('click',function(){
      var ids=S.checkedPropIds||[];
      if(ids.length===0)return;
      /* 弹出状态选择 */
      var opts=['在售','下架','已售','暂缓','已租'].map(function(s){
        return '<button class="btn btn-outline btn-sm" data-batch-st="'+s+'" style="margin:4px 6px;padding:8px 16px">'+esc(s)+'</button>';
      }).join('');
      confirmDialog('批量修改状态','将选中的 <b>'+ids.length+'</b> 套房源状态改为：'
        +'<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:4px">'+opts+'</div>',
        null, '确认修改');
      setTimeout(function(){
        document.querySelectorAll('[data-batch-st]').forEach(function(btn){
          btn.addEventListener('click',function(){
            var st=this.getAttribute('data-batch-st');
            ids.forEach(function(id){
              var p=S.properties.find(function(x){return x.id===id});
              if(p){p.status=st;p.updatedAt=Date.now();}
            });
            S.checkedPropIds=[];
            saveP();syncNow();
            if(S.propViewMode==='table')renderPropertyTable();
            else renderPropertyList();
            toast('已将 '+ids.length+' 套房源状态改为「'+st+'」','success');
            closeConfirmDialog();
          });
        });
      },50);
    });
  }
  /* 批量打标签 */
  var tagBtn=document.getElementById('propBatchTag');
  if(tagBtn&&!tagBtn._bound){
    tagBtn._bound=true;
    tagBtn.addEventListener('click',function(){
      var ids=S.checkedPropIds||[];
      if(ids.length===0)return;
      var inputId='propBatchTagInput_'+Date.now();
      confirmDialog('批量打标签','为选中的 <b>'+ids.length+'</b> 套房源添加标签（多个标签用逗号分隔）：'
        +'<input id="'+inputId+'" type="text" placeholder="如：有钥匙,满五唯一,随时看" style="width:100%;margin-top:8px;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:.875rem">',
        null, '添加标签');
      setTimeout(function(){
        var input=document.getElementById(inputId);
        if(input)input.focus();
        var okBtn=document.querySelector('.confirm-dialog .btn-primary');
        if(okBtn){
          var newOk=okBtn.cloneNode(true);
          okBtn.parentNode.replaceChild(newOk,okBtn);
          newOk.addEventListener('click',function(){
            var val=(document.getElementById(inputId)||{}).value||'';
            if(!val.trim()){toast('请输入标签','error');return;}
            var tags=val.split(/[,，]/).map(function(t){return t.trim()}).filter(Boolean);
            ids.forEach(function(id){
              var p=S.properties.find(function(x){return x.id===id});
              if(p){p.tags=p.tags||[];tags.forEach(function(t){if(p.tags.indexOf(t)<0)p.tags.push(t)});p.updatedAt=Date.now();}
            });
            S.checkedPropIds=[];
            saveP();syncNow();
            if(S.propViewMode==='table')renderPropertyTable();
            else renderPropertyList();
            toast('已为 '+ids.length+' 套房源添加标签：'+tags.join('、'),'success');
            closeConfirmDialog();
          });
        }
      },50);
    });
  }
  /* 批量删除 */
  var delBtn=document.getElementById('propBatchDelete');
  if(delBtn&&!delBtn._bound){
    delBtn._bound=true;
    delBtn.addEventListener('click',function(){
      if(!isAdmin()){toast('删除房源权限仅限管理员','error');return;}
      var ids=S.checkedPropIds||[];
      if(ids.length===0)return;
      confirmDialog('⚠️ 批量删除确认','确定要删除选中的 '+ids.length+' 个楼盘吗？此操作不可恢复！',function(){
        ids.forEach(function(id){markDeleted('properties',id)});
        S.properties=S.properties.filter(function(p){return ids.indexOf(p.id)<0});
        S.checkedPropIds=[];
        saveP();
        syncNow();
        if(S.propViewMode==='table')renderPropertyTable();
        else renderPropertyList();
        toast('已删除 '+ids.length+' 个楼盘','success');
      });
    });
  }
  /* 退出批量 */
  var exitBtn=document.getElementById('propExitBatch');
  if(exitBtn&&!exitBtn._bound){
    exitBtn._bound=true;
    exitBtn.addEventListener('click',function(){
      S.propBatchMode=false;S.checkedPropIds=[];
      if(S.propViewMode==='table')renderPropertyTable();
      else renderPropertyList();
      var btn=document.getElementById('propBatchModeBtn');
      if(btn){btn.classList.remove('btn-primary');btn.classList.add('btn-outline');}
    });
  }
}

/* v6.35 新增楼盘：将智能识别结果填入表单字段 */
function fillNewdevFormFromSmart(p){
  function setVal(id,val){var el=document.getElementById(id);if(el&&val)el.value=val}
  function setSel(id,val){var el=document.getElementById(id);if(el&&val){for(var i=0;i<el.options.length;i++){if(el.options[i].value===val||el.options[i].text===val){el.selectedIndex=i;break}}}}
  setVal('pfTitle',p.title||p.community||'');
  setVal('pfDeveloper',p.developer||'');
  setVal('pfBusinessDistrict',p.businessDistrict||'');
  setVal('pfProjectTag',p.projectTag||'');
  setVal('pfAddress',p.address||'');
  setVal('pfAvgPrice',p.averagePrice||(p.unitPrice?p.unitPrice+'':'')||(p.avgPrice?p.avgPrice+'':''));
  setVal('pfTotalUnits',p.totalUnits||'');
  setVal('pfGreenRate',p.greenRate||'');
  setVal('pfPlotRatio',p.plotRatio||'');
  setVal('pfRemaining',p.remaining||'');
  setVal('pfMetro',p.metro||'');
  setVal('pfContactName',p.contactName||p.salesOffice||'');
  setVal('pfContactPhone',p.contactPhone||'');
  setVal('pfCommission',p.commission||'');
  setVal('pfProtectionPeriod',p.protectionPeriod||'');
  setVal('pfHighlights',p.highlights||p.description||'');
  setVal('pfPreferential',p.preferential||'');
  setVal('pfViewingRule',p.viewingRule||'');
  setVal('pfOpeningDate',p.openingDate||'');
  setVal('pfDeliveryDate',p.deliveryDate||'');
  setVal('pfAvailLayouts',p.availableLayouts||p.availLayouts||'');
  setVal('pfOnSaleBuildings',p.onSaleBuildings||'');
  setVal('pfAdditionalBuildings',p.additionalBuildings||'');
  setVal('pfAdditionalPrice',p.additionalPrice||'');
  setVal('pfAvgPriceText',p.averagePriceText||'');
  setVal('pfTotalPriceText',p.totalPriceText||'');
  setVal('pfSaleStatus',p.saleStatus||'');
  /* 区域 */
  if(p.district)setVal('pfDistrict',p.district);
  /* 板块 */
  if(p.block){setVal('pfBlock',p.block);updateFormBlockOptions(p.district||document.getElementById('pfDistrict').value,p.block)}
  /* 物业类型 */
  if(p.propertyType){setSel('pfPropType2',p.propertyType);setVal('pfPropertyFee',p.propertyType)}
  /* 装修 */
  if(p.decoration)setSel('pfDecoration',p.decoration);
}
window.fillNewdevFormFromSmart=fillNewdevFormFromSmart;

/* v6.35 新增楼盘智能识别 — 全局onclick函数 */
function toggleNewdevSmart(){
  var body=document.getElementById('newdevSmartBody');
  var btn=document.getElementById('newdevSmartToggleBtn');
  if(!body||!btn)return;
  var visible=body.style.display!=='none';
  body.style.display=visible?'none':'block';
  btn.textContent=visible?'展开 ▾':'收起 ▴';
}
function parseNewdevSmart(){
  var text=document.getElementById('newdevSmartArea').value.trim();
  if(!text){toast('请先粘贴或上传楼盘信息','error');return}
  var prevSubtab=S.subtab;
  S.subtab='newdev';
  var props=parseSmartProp(text);
  S.subtab=prevSubtab;
  if(props.length===0){
    document.getElementById('newdevSmartPreview').innerHTML='<p style="color:var(--warning);font-size:.8125rem">未识别到有效楼盘数据，请检查格式</p>';
    return;
  }
  /* v6.35 查重：检查是否已存在同名新楼盘 */
  var p=props[0];
  var dupTitle=(p.title||'').replace(/\s+/g,'').toLowerCase();
  var existingDup=null;
  if(dupTitle){
    for(var ei=0;ei<S.properties.length;ei++){
      var ep=S.properties[ei];
      if(ep.type==='newdev'){
        var et=((ep.title||'')).replace(/\s+/g,'').toLowerCase();
        if(et&&et===dupTitle){existingDup=ep;break}
      }
    }
  }
  fillNewdevFormFromSmart(p);
  if(existingDup){
    document.getElementById('newdevSmartPreview').innerHTML='<p style="color:var(--warning);font-size:.8125rem">⚠️ 已识别并填入「'+(p.title||'未命名')+'」，但系统中<b>已存在同名楼盘</b>（ID:'+existingDup.id+'），保存后将更新该楼盘信息</p>';
    toast('注意：已存在同名楼盘「'+existingDup.title+'」，保存后会更新','warning');
  }else{
    document.getElementById('newdevSmartPreview').innerHTML='<p style="color:var(--success);font-size:.8125rem">✅ 已识别并填入「'+(p.title||p.community||'未命名')+'」（新楼盘）</p>';
    toast('已自动填入字段，请核对后保存','success');
  }
}
function clearNewdevSmart(){
  document.getElementById('newdevSmartArea').value='';
  document.getElementById('newdevSmartPreview').innerHTML='';
  var hintEl=document.getElementById('newdevSmartFileHint');
  if(hintEl){hintEl.textContent='支持Excel/表格/文本/截图';hintEl.style.color='var(--text-muted)'}
}
window.toggleNewdevSmart=toggleNewdevSmart;
window.parseNewdevSmart=parseNewdevSmart;
window.clearNewdevSmart=clearNewdevSmart;

/* v6.35 新增楼盘文件上传处理（复用handleSmartFileUpload逻辑，目标textarea为newdevSmartArea） */
function handleNewdevSmartFileUpload(file){
  var hintEl=document.getElementById('newdevSmartFileHint');
  var ta=document.getElementById('newdevSmartArea');
  if(!file||!ta)return;
  var name=file.name.toLowerCase();
  var ext=name.split('.').pop();
  if(ext==='xlsx'||ext==='xls'){
    hintEl.textContent='正在解析Excel...';hintEl.style.color='var(--warning)';
    loadSheetJS().then(function(){
      var reader=new FileReader();
      reader.onload=function(e){
        try{
          var data=new Uint8Array(e.target.result);
          var wb=XLSX.read(data,{type:'array'});
          var sheets=wb.SheetNames;
          var allText='';
          for(var s=0;s<sheets.length;s++){
            var ws=wb.Sheets[sheets[s]];
            var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,blankrows:false});
            if(s>0)allText+='\n';
            allText+='# sheet: '+sheets[s]+'\n';
            var lines=[];
            for(var r=0;r<rows.length;r++){
              var row=rows[r]||[];
              var cells=[];
              for(var ci=0;ci<row.length;ci++){
                var v=row[ci];v=(v==null?"":String(v));v=v.replace(/[\r\n\t]/g,"\u0001");cells.push(v);
              }
              lines.push(cells.join('\t'));
            }
            allText+=lines.join('\n')+'\n';
          }
          ta.value=(ta.value?ta.value+'\n':'')+allText;
          hintEl.textContent='Excel解析完成('+sheets.length+'个Sheet)，点击「识别并填入」';hintEl.style.color='var(--success)';
        }catch(err){hintEl.textContent='Excel解析失败:'+err.message;hintEl.style.color='var(--danger)'}
      };
      reader.readAsArrayBuffer(file);
    }).catch(function(){hintEl.textContent='加载Excel库失败';hintEl.style.color='var(--danger)'});
  }else if(ext==='csv'||ext==='txt'){
    var reader=new FileReader();
    reader.onload=function(e){ta.value=(ta.value?ta.value+'\n':'')+e.target.result;hintEl.textContent='文件已读取，点击「识别并填入」';hintEl.style.color='var(--success)'};
    reader.readAsText(file,'utf-8');
  }else if(ext==='png'||ext==='jpg'||ext==='jpeg'){
    handleNewdevSmartImageUpload(file);
  }else{hintEl.textContent='不支持的文件类型';hintEl.style.color='var(--danger)'}
}

function handleNewdevSmartImageUpload(file){
  var hintEl=document.getElementById('newdevSmartFileHint');
  hintEl.textContent='正在OCR识别图片...';hintEl.style.color='var(--warning)';
  compressImage(file,1200,0.7,function(dataUrl){
    /* 用内置OCR或提示用户 */
    var img=new Image();
    img.onload=function(){
      var canvas=document.createElement('canvas');
      var ctx=canvas.getContext('2d');
      canvas.width=img.width;canvas.height=img.height;
      ctx.drawImage(img,0,0);
      try{
        if(typeof Tesseract!=='undefined'){
          Tesseract.recognize(canvas,'chi_sim+eng',{logger:function(m){}}).then(function(result){
            var text=result.data.text;
            var ta=document.getElementById('newdevSmartArea');
            ta.value=(ta.value?ta.value+'\n':'')+'# img: '+file.name+'\n'+text;
            hintEl.textContent='图片OCR完成，点击「识别并填入」';hintEl.style.color='var(--success)';
          }).catch(function(){hintEl.textContent='OCR识别失败，请手动输入文字内容';hintEl.style.color='var(--warning)'});
        }else{
          hintEl.textContent='已添加图片，请在上方输入框补充文字信息后点识别（或直接粘贴文字）';hintEl.style.color='var(--text-secondary)';
        }
      }catch(err){hintEl.textContent='图片已就绪，请补充文字';hintEl.style.color='var(--text-secondary)'}
    };
    img.src=dataUrl;
  });
}
window.handleNewdevSmartFileUpload=handleNewdevSmartFileUpload;
window.handleNewdevSmartImageUpload=handleNewdevSmartImageUpload;
/* v6.35 新增楼盘文件change兜底 */
window.handleNewdevSmartFileChange=function(e){
  var files=Array.from(e.target.files||[]);
  files.forEach(function(f){handleNewdevSmartFileUpload(f)});
  e.target.value='';
};

/* ========== Property: Form ========== */
function openPropertyForm(id){
  try{
  S.editPropId=id||null;S.editPropTags=[];
  var p=id?findProp(id):{};
  var type=id?p.type:(S.subtab==='community'?'secondhand':S.subtab);
  if(type==='community')type='secondhand';
  document.getElementById('propFormTitle').textContent=id?(type==='newdev'?'编辑楼盘':(type==='rental'?'编辑出租房':'编辑房源')):(S.subtab==='newdev'?'新增楼盘':(S.subtab==='rental'?'新增出租房':((S.subtab==='community'&&S.communityDetail)?'新增房源':'新增二手房')));
  document.getElementById('pfId').value=id||'';
  document.getElementById('pfType').value=type;
  updatePropFormFields(type);
  /* 更新板块下拉 */
  updateFormBlockOptions(p.district||'临平',p.block);
  document.getElementById('pfTitle').value=p.title||'';
  document.getElementById('pfCommunity').value=p.community||'';
  document.getElementById('pfDeveloper').value=p.developer||'';
  _ensureDistrictOption(p.district);   /* 海宁/德清等外溢城市：下拉里没有就补一个，避免保存时被改回临平 */
  document.getElementById('pfDistrict').value=p.district||'临平';
  document.getElementById('pfAddress').value=p.address||'';
  document.getElementById('pfTotalPrice').value=p.totalPrice||'';
  document.getElementById('pfRentPrice').value=p.rentPrice||'';
  document.getElementById('pfDepositType').value=p.depositType||'';
  document.getElementById('pfRentType').value=p.rentType||'';
  document.getElementById('pfLeaseTerm').value=p.leaseTerm||'';
  document.getElementById('pfRentStatus').value=p.rentStatus||'空置待租';
  document.getElementById('pfMinLease').value=p.minLease||'';
  document.getElementById('pfMoveInDate').value=p.moveInDate||'';
  /* 楼栋位置：解析 "5幢"/"2单元" → 数字 5/2 填入输入框 */
  var bldNum=(p.building||'').match(/^\d+/);document.getElementById('pfBuilding').value=bldNum?bldNum[0]:'';
  var unitNum=(p.unit||'').match(/^\d+/);document.getElementById('pfUnit').value=unitNum?unitNum[0]:'';
  document.getElementById('pfRoom').value=(p.room||'').match(/^\d+/)?(p.room||'').match(/^\d+/)[0]:(p.room||'');
  document.getElementById('pfArea').value=p.area||'';
  document.getElementById('pfUnitPrice').value=p.unitPrice||'';
  /* 户型：解析 "3室2厅1卫" → 数字填入三个 input，同步到隐藏 pfLayout */
  var layoutStr=p.layout||'';
  var lrM=layoutStr.match(/(\d+)\s*室/);var lhM=layoutStr.match(/(\d+)\s*厅/);var lbM=layoutStr.match(/(\d+)\s*卫/);
  document.getElementById('pfLayoutRoom').value=lrM?lrM[1]:'';
  document.getElementById('pfLayoutHall').value=lhM?lhM[1]:'';
  document.getElementById('pfLayoutBath').value=lbM?lbM[1]:'';
  document.getElementById('pfLayout').value=layoutStr;
  document.getElementById('pfFloor').value=p.floor||'';
  document.getElementById('pfTotalFloors').value=p.totalFloors||'';
  document.getElementById('pfOrientation').value=p.orientation||'';
  document.getElementById('pfDecoration').value=p.decoration||'';
  document.getElementById('pfBuildingAge').value=p.buildingAge||'';
  document.getElementById('pfPropertyRights').value=p.propertyRights||'';
  document.getElementById('pfHasKey').value=p.hasKey?'1':'0';
  document.getElementById('pfViewingMethod').value=p.viewingMethod||'';
  document.getElementById('pfSchool').value=p.school||'';
  document.getElementById('pfMetro').value=p.metro||'';
  document.getElementById('pfOwnerName').value=p.ownerName||'';
  document.getElementById('pfOwnerPhone').value=p.ownerPhone||'';
  document.getElementById('pfAvgPrice').value=p.averagePrice||'';
  document.getElementById('pfPropType2').value=p.propertyType||'住宅';
  document.getElementById('pfOpeningDate').value=p.openingDate||'';
  document.getElementById('pfDeliveryDate').value=p.deliveryDate||'';
  document.getElementById('pfAvailLayouts').value=p.availableLayouts||'';
  document.getElementById('pfOnSaleBuildings').value=p.onSaleBuildings||'';
  document.getElementById('pfAdditionalBuildings').value=p.additionalBuildings||'';
  document.getElementById('pfAdditionalPrice').value=p.additionalPrice||'';
  document.getElementById('pfAvgPriceText').value=p.averagePriceText||'';
  document.getElementById('pfTotalPriceText').value=p.totalPriceText||'';
  document.getElementById('pfSaleStatus').value=p.saleStatus||'';
  document.getElementById('pfTotalUnits').value=p.totalUnits||'';
  document.getElementById('pfGreenRate').value=p.greenRate||'';
  document.getElementById('pfPlotRatio').value=p.plotRatio||'';
  document.getElementById('pfContactName').value=p.contactName||p.salesOffice||'';
  document.getElementById('pfContactPhone').value=p.contactPhone||'';
  document.getElementById('pfCommission').value=p.commission||'';
  document.getElementById('pfRemaining').value=p.remaining||'';
  document.getElementById('pfProtectionPeriod').value=p.protectionPeriod||'';
  document.getElementById('pfHighlights').value=p.highlights||'';
  document.getElementById('pfPreferential').value=p.preferential||'';
  document.getElementById('pfViewingRule').value=p.viewingRule||'';
  document.getElementById('pfBusinessDistrict').value=p.businessDistrict||'';
  document.getElementById('pfProjectTag').value=p.projectTag||'';
  document.getElementById('pfPropertyFee').value=p.propertyType||p.propertyFee||'';
  document.getElementById('pfStatus').value=p.status||(type==='secondhand'?'在售':(type==='rental'?'空置待租':'待售'));
  document.getElementById('pfDesc').value=p.description||'';
  /* 封面选择器 */
  var coverField=document.getElementById('pfCoverField');
  var coverGrid=document.getElementById('pfCoverGrid');
  var coverInput=document.getElementById('pfCoverMediaId');
  if(id){
    coverField.style.display='';
    coverInput.value=p.coverMediaId||'';
    MediaDB.list(id).then(function(mediaList){
      var imgs=mediaList.filter(function(m){return m.type==='image'});
      if(imgs.length===0){
        coverGrid.innerHTML='<div class="cp-empty">该房源还没有上传图片<br>保存后到详情页上传图片，再来选封面</div>';
        return;
      }
      coverGrid.innerHTML=imgs.map(function(m){
        var active=m.id===(p.coverMediaId||'');
        return'<div class="cp-item'+(active?' active':'')+'" data-mid="'+m.id+'"><img src="'+m.dataUrl+'"><span class="cp-check">'+(active?'✓':'')+'</span></div>';
      }).join('');
      coverGrid.querySelectorAll('.cp-item').forEach(function(el){
        el.addEventListener('click',function(){
          var mid=el.getAttribute('data-mid');
          coverInput.value=mid;
          coverGrid.querySelectorAll('.cp-item').forEach(function(b){b.classList.remove('active');b.querySelector('.cp-check').textContent=''});
          el.classList.add('active');
          el.querySelector('.cp-check').textContent='✓';
        });
      });
    });
  }else{
    coverField.style.display='none';
    coverInput.value='';
  }
  S.editPropTags=(p.tags||[]).slice();
  S.editAreaSegs=(p.showroomAreas||[]).slice();
  renderPropTagChips();
  renderAreaSegments();
  document.getElementById('propFormModal').classList.add('show');
  var pfMb=document.querySelector('#propFormModal .modal-body');if(pfMb)pfMb.scrollTop=0;
  /* 智能表单填充：编辑已有房源时，填充后立即显示参考值 */
  try{smartFillHints()}catch(e){}
  }catch(err){console.error('[openPropertyForm]',err);toast('打开表单失败: '+err.message,'error')}
}
/* 更新表单中的板块下拉选项 */
function updateFormBlockOptions(district,selectedBlock){
  var blockSelect=document.getElementById('pfBlock');
  if(!blockSelect)return;
  var blocks=district&&AREA_BLOCKS[district]?AREA_BLOCKS[district]:[];
  blockSelect.innerHTML='<option value="">请选择</option>'+blocks.map(function(b){return'<option value="'+esc(b)+'"'+(b===selectedBlock?' selected':'')+'>'+esc(b)+'</option>'}).join('');
}
function updatePropFormFields(type){
  document.querySelectorAll('[data-show]').forEach(function(el){
    var show=el.getAttribute('data-show')||'';
    var types=show.split(',').map(function(s){return s.trim()});
    el.style.display=types.indexOf(type)>=0?'':'none';
  });
}
function calcUnitPrice(){
  var total=parseFloat(document.getElementById('pfTotalPrice').value)||0;
  var area=parseFloat(document.getElementById('pfArea').value)||0;
  document.getElementById('pfUnitPrice').value=(total>0&&area>0)?Math.round(total*10000/area):'';
}
/* 智能表单填充：根据同小区已有房源计算参考值 */
function smartFillHints(){
  var hint=document.getElementById('pfSmartHint');
  if(!hint)return;
  var community=(document.getElementById('pfCommunity').value||'').trim();
  var type=document.getElementById('pfType').value;
  if(!community||(type!=='secondhand'&&type!=='rental')){
    hint.style.display='none';
    return;
  }
  // 查找同小区同类型房源
  var sameComm=(S.properties||[]).filter(function(p){
    return p.community===community && p.type===type && !p.invalid;
  });
  if(sameComm.length<2){hint.style.display='none';return;}
  // 计算参考值
  function median(arr){
    var s=arr.slice().sort(function(a,b){return a-b});
    var mid=Math.floor(s.length/2);
    return s.length%2?s[mid]:Math.round((s[mid-1]+s[mid])/2);
  }
  function mode(arr){
    var freq={},best='',max=0;
    arr.forEach(function(v){freq[v]=(freq[v]||0)+1;if(freq[v]>max){max=freq[v];best=v}});
    return best;
  }
  var prices=[],areas=[],unitPrices=[],orientations=[],decorations=[];
  sameComm.forEach(function(p){
    if(type==='secondhand'&&p.totalPrice>0)prices.push(p.totalPrice);
    if(type==='rental'&&p.rentPrice>0)prices.push(p.rentPrice);
    if(p.area)areas.push(parseFloat(p.area));
    if(p.unitPrice&&p.unitPrice>0)unitPrices.push(p.unitPrice);
    if(p.orientation)orientations.push(p.orientation);
    if(p.decoration)decorations.push(p.decoration);
  });
  var parts=['<span class="sh-title">📊 同小区参考（共'+sameComm.length+'套）</span>'];
  var priceLabel=type==='rental'?'月租':'总价';
  var priceUnit=type==='rental'?'元/月':'万';
  if(prices.length)parts.push('<span class="sh-item">'+priceLabel+' <span class="sh-val">'+(prices.length>=3?median(prices)+'-'+Math.round(prices.reduce(function(s,v){return s+v},0)/prices.length):median(prices))+'</span> '+priceUnit+'</span>');
  if(areas.length)parts.push('<span class="sh-item">面积 <span class="sh-val">'+median(areas)+'</span> ㎡</span>');
  if(unitPrices.length)parts.push('<span class="sh-item">单价 <span class="sh-val">'+median(unitPrices)+'</span> 元/㎡</span>');
  if(orientations.length)parts.push('<span class="sh-item">朝向 <span class="sh-val">'+mode(orientations)+'</span></span>');
  if(decorations.length)parts.push('<span class="sh-item">装修 <span class="sh-val">'+mode(decorations)+'</span></span>');
  hint.innerHTML=parts.join('');
  hint.style.display='';
}
function renderPropTagChips(){
  var container=document.getElementById('pfTagContainer');
  var chips=S.editPropTags.map(function(t,i){return'<span class="tag-chip">'+esc(t)+'<span class="remove" data-idx="'+i+'">×</span></span>'}).join('');
  container.innerHTML=chips+'<input type="text" id="pfTagInput" placeholder="输入后回车添加">';
  var input=document.getElementById('pfTagInput');
  input.addEventListener('keydown',function(e){
    if(e.key==='Enter'||e.key===','){e.preventDefault();var v=this.value.trim();if(v&&S.editPropTags.indexOf(v)<0){S.editPropTags.push(v);renderPropTagChips()}else{this.value=''}}
  });
  container.querySelectorAll('.tag-chip .remove').forEach(function(el){
    el.addEventListener('click',function(){S.editPropTags.splice(parseInt(el.getAttribute('data-idx')),1);renderPropTagChips()});
  });
}
function renderAreaSegments(){
  var container=document.getElementById('pfAreaSegments');
  if(!container)return;
  container.innerHTML=S.editAreaSegs.map(function(a,i){
    return'<span class="area-segment-chip">'+esc(a)+'<span class="remove" data-idx="'+i+'">×</span></span>';
  }).join('');
  container.querySelectorAll('.area-segment-chip .remove').forEach(function(el){
    el.addEventListener('click',function(){S.editAreaSegs.splice(parseInt(el.getAttribute('data-idx')),1);renderAreaSegments()});
  });
}
function saveProperty(){
  var type=document.getElementById('pfType').value;
  var title='';
  var community=document.getElementById('pfCommunity').value.trim();
  if(type==='newdev'){
    title=document.getElementById('pfTitle').value.trim();
    if(!title){toast('请输入楼盘名称','error');return}
  }else{
    /* 二手房/租赁房：以小区名+楼幢单元房间号自动生成标题 */
    if(!community){toast('请输入小区名称','error');return}
    var locStr=[document.getElementById('pfBuilding').value.trim(),document.getElementById('pfUnit').value.trim(),document.getElementById('pfRoom').value.trim()].filter(Boolean).join(' ');
    title=community+(locStr?(' '+locStr):'');
    if(type==='secondhand'&&!document.getElementById('pfTotalPrice').value){toast('请输入总价','error');return}
    if(type==='rental'&&!document.getElementById('pfRentPrice').value){toast('请输入月租金','error');return}
  }
  if(type==='newdev'&&!document.getElementById('pfAvgPrice').value){toast('请输入均价','error');return}
  var id=document.getElementById('pfId').value;var isEdit=!!id;var p=isEdit?findProp(id):{};
  p.type=type;p.title=title;
  p.community=community;
  p.developer=document.getElementById('pfDeveloper').value.trim();
  p.district=document.getElementById('pfDistrict').value;
  p.block=document.getElementById('pfBlock').value||'';
  p.address=document.getElementById('pfAddress').value.trim();
  p.totalPrice=parseFloat(document.getElementById('pfTotalPrice').value)||0;
  p.rentPrice=parseInt(document.getElementById('pfRentPrice').value)||0;
  p.depositType=document.getElementById('pfDepositType').value;
  p.rentType=document.getElementById('pfRentType').value;
  p.leaseTerm=document.getElementById('pfLeaseTerm').value.trim();
  p.rentStatus=document.getElementById('pfRentStatus').value;
  p.minLease=document.getElementById('pfMinLease').value.trim();
  p.moveInDate=document.getElementById('pfMoveInDate').value.trim();
  var bldV=document.getElementById('pfBuilding').value.trim();
  p.building=bldV||'';
  var unitV=document.getElementById('pfUnit').value.trim();
  p.unit=unitV||'';
  var roomV=document.getElementById('pfRoom').value.trim();
  p.room=roomV||'';
  /* 户型：把三个数字拼合成 "3室2厅1卫" 存到 p.layout */
  var lrV=document.getElementById('pfLayoutRoom').value.trim();
  var lhV=document.getElementById('pfLayoutHall').value.trim();
  var lbV=document.getElementById('pfLayoutBath').value.trim();
  p.layout=(lrV?lrV+'室':'')+(lhV?lhV+'厅':'')+(lbV?lbV+'卫':'');
  p.area=parseFloat(document.getElementById('pfArea').value)||0;
  p.unitPrice=p.area>0?Math.round(p.totalPrice*10000/p.area):0;
  p.layout=document.getElementById('pfLayout').value.trim();
  p.floor=document.getElementById('pfFloor').value.trim();
  p.totalFloors=document.getElementById('pfTotalFloors').value.trim();
  p.orientation=document.getElementById('pfOrientation').value;
  p.decoration=document.getElementById('pfDecoration').value;
  p.buildingAge=document.getElementById('pfBuildingAge').value.trim();
  p.propertyRights=document.getElementById('pfPropertyRights').value;
  p.hasKey=document.getElementById('pfHasKey').value==='1';
  p.viewingMethod=document.getElementById('pfViewingMethod').value.trim();
  p.school=document.getElementById('pfSchool').value.trim();
  p.metro=document.getElementById('pfMetro').value.trim();
  p.ownerName=document.getElementById('pfOwnerName').value.trim();
  p.ownerPhone=document.getElementById('pfOwnerPhone').value.trim();
  p.ownerReserve=document.getElementById('pfOwnerReserve').value.trim();
  p.averagePrice=parseInt(document.getElementById('pfAvgPrice').value)||0;
  p.propertyType=document.getElementById('pfPropType2').value;
  p.openingDate=document.getElementById('pfOpeningDate').value.trim();
  p.deliveryDate=document.getElementById('pfDeliveryDate').value.trim();
  p.availableLayouts=document.getElementById('pfAvailLayouts').value.trim();
  p.onSaleBuildings=document.getElementById('pfOnSaleBuildings').value.trim();
  p.additionalBuildings=document.getElementById('pfAdditionalBuildings').value.trim();
  p.additionalPrice=document.getElementById('pfAdditionalPrice').value.trim();
  p.averagePriceText=document.getElementById('pfAvgPriceText').value.trim();
  p.totalPriceText=document.getElementById('pfTotalPriceText').value.trim();
  p.saleStatus=document.getElementById('pfSaleStatus').value.trim();
  p.totalUnits=document.getElementById('pfTotalUnits').value.trim();
  p.greenRate=document.getElementById('pfGreenRate').value.trim();
  p.plotRatio=document.getElementById('pfPlotRatio').value.trim();
  p.contactName=document.getElementById('pfContactName').value.trim();
  p.contactPhone=document.getElementById('pfContactPhone').value.trim();
  p.commission=document.getElementById('pfCommission').value.trim();
  p.remaining=document.getElementById('pfRemaining').value.trim();
  p.protectionPeriod=document.getElementById('pfProtectionPeriod').value.trim();
  p.highlights=document.getElementById('pfHighlights').value.trim();
  p.preferential=document.getElementById('pfPreferential').value.trim();
  p.viewingRule=document.getElementById('pfViewingRule').value.trim();
  p.businessDistrict=document.getElementById('pfBusinessDistrict').value.trim();
  p.projectTag=document.getElementById('pfProjectTag').value.trim();
  p.propertyType=document.getElementById('pfPropertyFee').value.trim();
  p.propertyFee='';
  /* Status timeline tracking: detect change and append to statusLog */
  var _oldStatus=(isEdit&&p.status)?p.status:'';
  p.status=document.getElementById('pfStatus').value;
  if(isEdit&&_oldStatus&&_oldStatus!==p.status){
    if(!p.statusLog)p.statusLog=[];
    p.statusLog.push({from:_oldStatus,to:p.status,time:now(),by:S.currentUser?S.currentUser.name:'',byId:S.currentUser?S.currentUser.id:''});
  }
  p.description=document.getElementById('pfDesc').value.trim();
  p.coverMediaId=document.getElementById('pfCoverMediaId').value||null;
  p.tags=S.editPropTags.slice();p.showroomAreas=S.editAreaSegs.slice();p.updatedAt=now();
  if(!isEdit){
    /* v6.35 智能查重：新增前检查是否已存在 */
    var _dupP=null;
    if(type==='newdev'){
      /* 新楼盘按标题查重 */
      var _nt=(title||'').replace(/\s+/g,'').toLowerCase();
      if(_nt)for(var _di=0;_di<S.properties.length;_di++){var _dp=S.properties[_di];if(_dp.type==='newdev'&&((_dp.title||'').replace(/\s+/g,'').toLowerCase())===_nt){_dupP=_dp;break}}
    }else if(type==='secondhand'||type==='rental'){
      /* 二手房/租赁按地址指纹查重 */
      var _ak=[community,p.building,p.unit,p.room].join('|');
      if(_ak.replace(/\|/g,'').length>2)for(var _di=0;_di<S.properties.length;_di++){var _dp=S.properties[_di];var _ek=[_dp.community||'',_dp.building||'',_dp.unit||'',_dp.room||''].join('|');if(_ek===_ak&&_dp.type===type){_dupP=_dp;break}}
    }
    if(_dupP){
      /* 已存在 → 更新而非新增 */
      var _updKeys=['title','community','developer','district','block','address','totalPrice','rentPrice','depositType',
        'rentType','leaseTerm','rentStatus','minLease','moveInDate','building','unit','room','layout','area',
        'unitPrice','floor','totalFloors','orientation','decoration','buildingAge','propertyRights','hasKey',
        'viewingMethod','school','metro','ownerName','ownerPhone','ownerReserve','averagePrice','propertyType',
        'openingDate','deliveryDate','availableLayouts','totalUnits','greenRate','plotRatio','contactName',
        'contactPhone','commission','remaining','protectionPeriod','highlights','preferential','viewingRule',
        'businessDistrict','projectTag','propertyFee','status','description','coverMediaId'];
      for(var _uk=0;_uk<_updKeys.length;_uk++){var _k=_updKeys[_uk];if(p[_k]!==undefined&&p[_k]!==''&&p[_k]!==null)_dupP[_k]=p[_k]}
      _dupP.tags=S.editPropTags.slice();_dupP.showroomAreas=S.editAreaSegs.slice();_dupP.updatedAt=now();
      p=_dupP;isEdit=true;
    }else{
      p.id=uuid();p.createdAt=now();p.linkedClientIds=[];p.createdBy=S.currentUser?S.currentUser.id:'';p.createdByName=S.currentUser?S.currentUser.name:'';S.properties.push(p)
    }
  }
  saveP();closeModal('propFormModal');
  if(S.subtab==='community'){if(S.communityDetail){renderCommunityDetail()}else{renderCommunityList()}}else{renderPropertyList()}
  toast(isEdit?'房源已更新':'房源已添加','success');
  logAction(isEdit?'edit':'create','property',p.id,p.title||p.community);
}

/* ========== Property: Detail ========== */
/* ========== 小区概览「单图查看」弹窗 ========== */
/* 把小区概况排版成一张干净的单页信息卡（供 openCommunityOverviewModal 使用） */
function buildCommunityOverviewSheet(name){
  try{
    var cm=S.properties.find(function(p){return p.type==='community'&&(p.title===name||p.community===name)});
    if(!cm){
      return '<div class="cov-empty">尚未录入该楼盘的概况信息<br>'
        +'<button class="btn btn-primary" id="cmOvAddBtn" style="margin-top:14px">＋ 添加概况</button></div>';
    }
    var info=cm;
    /* 基本信息 */
    var basicInfo=[];
    if(info.district||info.block)basicInfo.push({label:'区域/板块',value:(info.district||'')+(info.block?(' · '+info.block):'')});
    if(info.buildingCount)basicInfo.push({label:'楼幢数',value:info.buildingCount});
    if(info.householdCount)basicInfo.push({label:'总户数',value:info.householdCount+' 户'});
    if(info.buildingAge)basicInfo.push({label:'房龄',value:info.buildingAge});
    if(info.builtYear)basicInfo.push({label:'建成年份',value:info.builtYear});
    if(info.developer)basicInfo.push({label:'开发商',value:info.developer});
    if(info.buildingType)basicInfo.push({label:'建筑类型',value:info.buildingType});
    if(info.plotRatio)basicInfo.push({label:'容积率',value:info.plotRatio});
    if(info.greenRate)basicInfo.push({label:'绿化率',value:info.greenRate});
    if(info.propertyManagement)basicInfo.push({label:'物业公司',value:info.propertyManagement});
    if(info.street)basicInfo.push({label:'所在街道',value:info.street});
    if(info.neighborhood)basicInfo.push({label:'所属社区',value:info.neighborhood});
    if(info.alias)basicInfo.push({label:'别名/简称',value:info.alias});
    if(info.elevatorRatio)basicInfo.push({label:'梯户比',value:info.elevatorRatio});
    if(info.floorHeight)basicInfo.push({label:'标准层高',value:info.floorHeight});
    if(info.roomRate)basicInfo.push({label:'得房率',value:info.roomRate});
    if(info.parkingRatio)basicInfo.push({label:'车位配比',value:info.parkingRatio});
    if(info.parkingPrice)basicInfo.push({label:'车位售价',value:info.parkingPrice});
    if(info.parkingRent)basicInfo.push({label:'车位月租',value:info.parkingRent});
    if(info.parkingSpaces)basicInfo.push({label:'停车位',value:info.parkingSpaces});
    if(info.address)basicInfo.push({label:'详细地址',value:info.address,map:true,lng:info.lng,lat:info.lat});
    /* 配套类型配色 */
    function amenityColor(t){
      var k=(t||'');
      if(k.indexOf('商业')>=0||k.indexOf('商场')>=0||k.indexOf('超市')>=0||k.indexOf('菜场')>=0)return{bg:'#fef3c7',fg:'#b45309'};
      if(k.indexOf('医疗')>=0||k.indexOf('医院')>=0)return{bg:'#fee2e2',fg:'#b91c1c'};
      if(k.indexOf('休闲')>=0||k.indexOf('公园')>=0||k.indexOf('体育馆')>=0)return{bg:'#dcfce7',fg:'#15803d'};
      if(k.indexOf('不利')>=0||k.indexOf('高架')>=0||k.indexOf('变电')>=0||k.indexOf('垃圾')>=0||k.indexOf('工厂')>=0)return{bg:'#e5e7eb',fg:'#6b7280'};
      return{bg:'#dbeafe',fg:'#2563eb'};
    }
    var banner='<div class="cov-banner">'
      +'<div class="cov-banner-title">'+esc(info.title||info.community||name)+'</div>'
      +(info.alias?'<div class="cov-banner-alias">别名：'+esc(info.alias)+'</div>':'')
      +'<div class="cov-banner-chips">'
      +(info.district?'<span class="cov-chip">'+esc(info.district)+'</span>':'')
      +(info.block?'<span class="cov-chip">'+esc(info.block)+'</span>':'')
      +(info.buildingType?'<span class="cov-chip">'+esc(info.buildingType)+'</span>':'')
      +'</div></div>';
    var cards='';
    /* 基本信息 */
    if(basicInfo.length){
      cards+='<div class="cov-card"><div class="cov-card-head"><span class="cov-ico" style="background:var(--primary-light);color:var(--primary)">ℹ</span>基本信息</div>'
        +'<div class="cov-grid">'+basicInfo.map(function(it){return'<div class="cov-item"><div class="cov-item-label">'+esc(it.label)+'</div><div class="cov-item-value">'+(it.map?_mapLink(it.value,it.lng,it.lat):esc(it.value))+'</div></div>'}).join('')+'</div></div>';
    }
    /* 教育配套 */
    var schoolItems=[];
    if(info.kindergarten)schoolItems.push({label:'幼儿园',value:info.kindergarten});
    if(info.primarySchool)schoolItems.push({label:'小学',value:info.primarySchool});
    if(info.middleSchool)schoolItems.push({label:'中学',value:info.middleSchool});
    if(info.schoolFamous)schoolItems.push({label:'是否名校',value:info.schoolFamous});
    if(schoolItems.length){
      cards+='<div class="cov-card"><div class="cov-card-head"><span class="cov-ico" style="background:#fef3c7;color:#d97706">🎓</span>教育配套</div>'
        +'<div class="cov-list">'+schoolItems.map(function(it){return'<div class="cov-row"><span class="cov-row-label">'+esc(it.label)+'</span><span class="cov-row-value">'+esc(it.value)+'</span></div>'}).join('')+'</div></div>';
    }
    /* 地铁配套 */
    if(info.metro&&info.metro.length){
      cards+='<div class="cov-card"><div class="cov-card-head"><span class="cov-ico" style="background:#dbeafe;color:#2563eb">🚇</span>地铁配套</div>'
        +'<div class="cov-list">'+info.metro.map(function(m){return'<div class="cov-row"><span class="cov-badge" style="background:#dbeafe;color:#2563eb">'+esc(m.line||'')+'</span><span class="cov-row-value">'+esc(m.station||'')+(m.distance?(' · '+esc(m.distance)):'')+'</span></div>'}).join('')+'</div></div>';
    }
    /* 周边配套 */
    if(info.amenities&&info.amenities.length){
      cards+='<div class="cov-card"><div class="cov-card-head"><span class="cov-ico" style="background:#dcfce7;color:#16a34a">🏬</span>周边配套</div>'
        +'<div class="cov-amenities">'+info.amenities.map(function(a){
            var c=amenityColor(a.type);
            return'<div class="cov-amenity"><span class="cov-amenity-type" style="background:'+c.bg+';color:'+c.fg+'">'+esc(a.type||'配套')+'</span><span class="cov-row-value">'+esc(a.name||'')+(a.distance?(' '+esc(a.distance)):'')+'</span></div>';
          }).join('')+'</div></div>';
    }
    /* 物业费 */
    if(info.propertyFees&&info.propertyFees.length){
      var feeRows=info.propertyFees.map(function(f){return'<div class="cov-row"><span class="cov-row-label">'+esc(f.type||'业态')+'</span><span class="cov-row-value">'+esc(f.fee||'')+'</span></div>'}).join('');
      cards+='<div class="cov-card"><div class="cov-card-head"><span class="cov-ico" style="background:#d1fae5;color:#059669">💰</span>物业费</div><div class="cov-list">'+feeRows+'</div></div>';
    }
    /* 板块简评 */
    if(info.notes){
      cards+='<div class="cov-card"><div class="cov-card-head"><span class="cov-ico" style="background:#ede9fe;color:#7c3aed">📝</span>板块简评</div>'
        +'<div style="font-size:.875rem;color:var(--text-secondary);line-height:1.65;padding:2px;white-space:pre-wrap;word-break:break-all;overflow-wrap:break-word">'+esc(info.notes)+'</div></div>';
    }
    return banner+'<div class="cov-body">'+cards+'</div>';
  }catch(e){console.error('[buildCommunityOverviewSheet]',e);return '<div class="cov-empty">概览加载失败</div>'}
}
window.buildCommunityOverviewSheet=buildCommunityOverviewSheet;

/* 打开「小区概览」单图查看弹窗 */
function openCommunityOverviewModal(name){
  try{
    var modal=document.getElementById('communityOverviewModal');
    var body=document.getElementById('communityOverviewBody');
    if(!modal||!body)return;
    body.innerHTML=buildCommunityOverviewSheet(name);
    modal.classList.add('show');
    var editBtn=document.getElementById('cmOvEditBtn');
    if(editBtn)editBtn.onclick=function(){
      try{closeModal('communityOverviewModal');openCommunityForm(name,function(){openCommunityOverviewModal(name)})}catch(e){console.error('[cmOvEditBtn]',e);toast('打开编辑失败','error')}
    };
    var shareBtn=document.getElementById('cmOvShareBtn');
    if(shareBtn)shareBtn.onclick=function(){try{openCommunityShareCard(name)}catch(e){console.error('[cmOvShareBtn]',e);toast('打开发送卡片失败','error')}};
    var addBtn=document.getElementById('cmOvAddBtn');
    if(addBtn)addBtn.onclick=function(){try{closeModal('communityOverviewModal');openCommunityForm(name)}catch(e){console.error('[cmOvAddBtn]',e);toast('打不开','error')}};
  }catch(e){console.error('[openCommunityOverviewModal]',e);toast('打开概览失败','error')}
}
window.openCommunityOverviewModal=openCommunityOverviewModal;

/* ========== 楼盘基础信息概况（内嵌于二手/租赁房源详情） ========== */
function buildCommunityOverviewSection(name){
  try{
    if(!name)return '';
    var cm=S.properties.find(function(p){return p.type==='community'&&(p.title===name||p.community===name)});
    if(!cm){
      return '<div class="detail-section"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px">'
        +'<h3 style="margin:0">🏘️ '+esc(name)+' · 楼盘概况</h3></div>'
        +'<div class="timeline-empty" style="margin:8px 0 12px">尚未录入该楼盘的基础概况信息</div>'
        +'<button class="btn btn-outline" id="propCmAddBtn" style="border:1px solid var(--primary);color:var(--primary)">＋ 添加楼盘概况</button></div>';
    }
    /* 快速摘要：取几个关键字段做一行预览 */
    var quick=[];
    if(cm.buildingType)quick.push(cm.buildingType);
    if(cm.plotRatio)quick.push('容积率'+cm.plotRatio);
    if(cm.greenRate)quick.push('绿化率'+cm.greenRate);
    if(cm.propertyManagement)quick.push(cm.propertyManagement);
    if(cm.metro&&cm.metro.length)quick.push(cm.metro[0].line+' '+cm.metro[0].station);
    return '<div class="detail-section">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">'
      +'<h3 style="margin:0">🏘️ '+esc(name)+' · 楼盘概况</h3>'
      +'</div>'
      +(quick.length?'<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'+quick.map(function(q){return'<span style="background:var(--bg-secondary);border:1px solid var(--border);padding:3px 10px;border-radius:20px;font-size:.75rem;color:var(--text-secondary)">'+esc(q)+'</span>'}).join('')+'</div>':'')
      +'<button class="btn btn-primary" id="propCmViewBtn" style="width:100%">📋 查看完整概览</button>'
      +'</div>';
  }catch(e){console.error('[buildCommunityOverviewSection]',e);return ''}
}
/* ========== Property: Status Timeline ========== */
function buildStatusTimeline(log){
  if(!log||!log.length)return'';
  /* Show latest first */
  var items=log.slice().reverse();
  return '<div class="detail-section"><h3>📋 状态时间线</h3>'
    +'<div class="status-timeline">'
    +items.map(function(e){
      var cls=e.to==='已售'||e.to==='已租'?'stl-sold':(e.to==='暂缓'||e.to==='停售'?'stl-paused':'stl-normal');
      return '<div class="stl-item '+cls+'">'
        +'<div class="stl-dot"></div>'
        +'<div class="stl-body">'
        +'<div class="stl-change"><span class="stl-from">'+esc(e.from)+'</span><span class="stl-arrow">→</span><span class="stl-to">'+esc(e.to)+'</span></div>'
        +'<div class="stl-meta">'+fmtDateTime(e.time)+' · '+esc(e.by||'系统')+'</div>'
        +'</div></div>';
    }).join('')
    +'</div></div>';
}
/* ===== 同小区真实成交价对比 ===== */
function parseUnitPriceNum(str){
  if(str===undefined||str===null)return 0;
  if(typeof str==='number')return str;
  var m=String(str).match(/([0-9]+(?:\.[0-9]+)?)/);
  return m?parseFloat(m[1]):0;
}
function allCommunityNames(){
  var set={};
  (S.properties||[]).forEach(function(p){
    if(p.community)set[cleanCommunityName(p.community)]=true;
    if(p.type==='community'&&p.title)set[cleanCommunityName(p.title)]=true;
  });
  return Object.keys(set);
}
function txCommunity(t){
  if(!t||!t.propertyTitle)return'';
  var names=allCommunityNames();
  for(var i=0;i<names.length;i++){if(t.propertyTitle.indexOf(names[i])>=0)return names[i];}
  return'';
}
function renderCommunityDealCompare(p){
  var comm=cleanCommunityName(p.community);
  if(!comm||p.type!=='secondhand')return'';
  var matched=S.transactions.filter(function(t){
    if(t.dealType==='newdev')return false;
    return txCommunity(t)===comm;
  });
  if(!matched.length)return'';
  var ups=[];
  matched.forEach(function(t){
    var u=parseUnitPriceNum(t.unitPrice);
    if(u)ups.push({t:t,u:u,price:t.transactionPrice||0});
  });
  if(!ups.length)return'';
  var avg=Math.round(ups.reduce(function(a,b){return a+b.u},0)/ups.length);
  var maxU=Math.max.apply(null,ups.map(function(x){return x.u}));
  var minU=Math.min.apply(null,ups.map(function(x){return x.u}));
  var curU=parseUnitPriceNum(p.unitPrice);
  var deltaTxt='',deltaCls='';
  if(curU){
    var diff=Math.round((curU-avg)/avg*100);
    deltaTxt=(diff>=0?'+':'')+diff+'%';
    deltaCls=diff>0?'up':(diff<0?'down':'');
  }
  var list=ups.slice().sort(function(a,b){return (b.t.transactionDate||0)-(a.t.transactionDate||0)}).slice(0,5);
  var html='<div class="detail-section"><h3>📊 同小区真实成交价对比</h3>'
    +'<div class="deal-compare-grid">'
    +'<div class="dc-stat"><div class="dc-num">'+avg+'</div><div class="dc-label">小区成交均价(元/㎡)</div></div>'
    +'<div class="dc-stat"><div class="dc-num">'+matched.length+'</div><div class="dc-label">成交套数</div></div>'
    +(curU?'<div class="dc-stat"><div class="dc-num'+(deltaCls?(' '+deltaCls):'')+'">'+deltaTxt+'</div><div class="dc-label">本房挂牌单价相对均价</div></div>':'')
    +'</div>'
    +'<div class="dc-range">单价区间：'+minU+' ~ '+maxU+' 元/㎡</div>'
    +'<div class="dc-list">'
    +list.map(function(x){
      return'<div class="dc-item"><span class="dc-date">'+fmtDate(x.t.transactionDate)+'</span><span class="dc-price">'+(x.price?x.price+'万':'—')+'</span><span class="dc-up">'+(x.u?x.u+'元/㎡':'—')+'</span></div>';
    }).join('')
    +'</div></div>';
  return html;
}
function showPropertyDetail(id){
  var p=findProp(id);if(!p)return;S.curPropId=id;
  var price;var infoItems;var typeLabel;var addressBar="";
  /* 查找关联小区概况，用于"相关信息"字段回填 */
  var cm=null;
  if(p.community){cm=S.properties.find(function(x){return x.type==='community'&&(x.title===p.community||x.community===p.community)})||null}
  function cmVal(field){return(cm&&cm[field])?cm[field]:''}
  function cmMetro(){if(!cm||!cm.metro||!cm.metro.length)return '';var m=cm.metro[0];return[m.line,m.station,m.distance].filter(Boolean).join(' ')}
  function cmSchool(){if(!cm)return '';var s=[];if(cm.primarySchool)s.push(cm.primarySchool);if(cm.middleSchool)s.push(cm.middleSchool);return s.join(' / ')||''}
  if(p.type==='rental'){
    price=p.rentPrice?p.rentPrice+'元/月':'';typeLabel='租赁房';
        var addrParts=[];if(p.building)addrParts.push(esc(p.building)+'幢');addrParts.push(esc(p.unit||'1单元'));if(p.room)addrParts.push(esc(p.room)+'室');
    addressBar='<div class="prop-address-row"><span class="prop-address">'+(addrParts.join(' ')||'—')+'</span><span class="prop-area">'+(p.area?esc(p.area)+'㎡':'—')+'</span></div>';
    infoItems=[
      di('户型',p.layout||'—'),di('楼层',p.floor?(p.floor+(p.totalFloors?'/'+p.totalFloors+'层':'')):'—'),
      di('朝向',p.orientation||'—'),di('装修',p.decoration||'—'),di('押付方式',p.depositType||'—'),
      di('租赁方式',p.rentType||'—'),di('租期',p.leaseTerm||'—'),di('出租状态',p.rentStatus||'—'),
      di('钥匙',p.hasKey?'有':'无'),di('看房',p.viewingMethod||'—'),
      di('学区',p.school||cmSchool()||'—'),di('地铁',p.metro||cmMetro()||'—'),di('业主',p.ownerName||'—'),diPhoneLimited('业主电话',p.ownerPhone,p),di('业主底价',p.ownerReserve||'—')
    ];
  }else if(p.type==='secondhand'){
    price=p.totalPrice?p.totalPrice+'万':'';typeLabel='二手房';
        var addrParts=[];if(p.building)addrParts.push(esc(p.building)+'幢');addrParts.push(esc(p.unit||'1单元'));if(p.room)addrParts.push(esc(p.room)+'室');
    addressBar='<div class="prop-address-row"><span class="prop-address">'+(addrParts.join(' ')||'—')+'</span><span class="prop-area">'+(p.area?esc(p.area)+'㎡':'—')+'</span></div>';
    infoItems=[
      di('户型',p.layout||'—'),di('楼层',p.floor?(p.floor+(p.totalFloors?'/'+p.totalFloors+'层':'')):'—'),
      di('朝向',p.orientation||'—'),di('装修',p.decoration||'—'),di('单价',p.unitPrice?p.unitPrice+'元/㎡':'—'),di('房龄',p.buildingAge||cmVal('buildingAge')||cmVal('builtYear')||'—'),
      di('产权',p.propertyRights||'—'),di('钥匙',p.hasKey?'有':'无'),di('看房',p.viewingMethod||'—'),
      di('学区',p.school||cmSchool()||'—'),di('地铁',p.metro||cmMetro()||'—'),di('业主',p.ownerName||'—'),diPhoneLimited('业主电话',p.ownerPhone,p),di('业主底价',p.ownerReserve||'—')
    ];
  }else{
    price=(p.averagePriceText||(p.averagePrice?p.averagePrice+'元/\u33a1':''));typeLabel='新楼盘';
    infoItems=[
      di('开发商',p.developer||'\u2014'),di('均价',p.averagePriceText||(p.averagePrice?p.averagePrice+'元/\u33a1':'\u2014')),di('起步总价',p.totalPriceText||(p.totalPrice?p.totalPrice+'万起':'\u2014')),di('物业类型',p.propertyType||'\u2014'),
      di('在售面积',p.availableLayouts||'\u2014'),di('在售楼幢',p.onSaleBuildings||'\u2014'),di('加推楼幢',p.additionalBuildings||'\u2014'),di('加推价格',p.additionalPrice||'\u2014'),
      di('认购状态',p.saleStatus||'\u2014'),di('装修',p.decoration||'\u2014'),di('剩余房源',p.remaining||'\u2014'),
      di('开盘时间',p.openingDate||'\u2014'),di('交付时间',p.deliveryDate||'\u2014'),di('总户数',p.totalUnits||'\u2014'),di('绿化率',p.greenRate||'\u2014'),di('容积率',p.plotRatio||'\u2014'),
      di('地铁',p.metro||'\u2014'),di('对接人',p.contactName||'\u2014'),di('联系电话',p.contactPhone||'\u2014'),diMask('佣金',p.commission||'\u2014'),
      di('保护期',p.protectionPeriod||'\u2014')
    ];
  }
  var tagsHtml=(p.tags||[]).map(function(t){return'<span class="client-tag">'+esc(t)+'</span>'}).join('');
  var communitySection=((p.type==='secondhand'||p.type==='rental')&&p.community)?buildCommunityOverviewSection(cleanCommunityName(p.community)):'';
  var dealCompare=(p.type==='secondhand')?renderCommunityDealCompare(p):'';
  document.getElementById('propDetailBody').innerHTML=
    '<div class="media-section"><div class="media-upload-area" id="mediaUpload"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" stroke-width="1.5" style="margin:0 auto;display:block"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><p>点击或拖拽上传图片/视频</p><div class="hint">支持 JPG/PNG/MP4 等，图片自动压缩</div><button type="button" class="btn btn-primary btn-sm media-camera-btn" id="mediaCameraBtn">📷 拍照上传</button></div><div class="media-gallery" id="mediaGallery"></div></div>'
    +'<div class="detail-header"><div class="detail-avatar" style="background:var(--success-light);color:var(--success)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div><div class="detail-info"><h2>'+esc(cleanCommunityName(p.community)||p.title||'未命名')+'</h2><div class="sub">'+esc(p.district)+(p.block?(' · '+esc(p.block)):'')+(p.address?' · '+esc(p.address):'')+' <a href="https://uri.amap.com/marker?name='+encodeURIComponent([p.community,p.district,p.block,p.address].filter(Boolean).join(' '))+'" target="_blank" class="map-link" title="在地图中打开" style="text-decoration:none">🗺️</a></div><div class="detail-badges"><span class="status-badge" data-status="'+esc(p.status)+'">'+esc(p.status)+'</span><span class="status-badge" data-status="已联系">'+typeLabel+'</span></div></div></div>'
    +'<div class="detail-section"><div class="card-price" style="font-size:1.5rem;margin-bottom:12px">'+price+'</div>'+addressBar+'<div class="detail-grid">'+infoItems.join('')+'</div></div>'
    +communitySection
    +dealCompare
    +(tagsHtml?'<div class="detail-section"><h3>标签</h3><div class="client-tags">'+tagsHtml+'</div></div>':'')
    +(p.highlights?'<div class="detail-section"><h3>📌 基本卖点</h3><div class="timeline-content">'+esc(p.highlights)+'</div></div>':'')
    +(p.preferential?'<div class="detail-section"><h3>🎁 优惠政策</h3><div class="timeline-content">'+esc(p.preferential)+'</div></div>':'')
    +(p.viewingRule?'<div class="detail-section"><h3>🚪 带看规则</h3><div class="timeline-content">'+esc(p.viewingRule)+'</div></div>':'')
    +(p.description?'<div class="detail-section"><h3>描述</h3><div class="timeline-content">'+esc(p.description)+'</div></div>':'')
    +buildStatusTimeline(p.statusLog)
    +(p.type==='newdev'&&p.showroomAreas&&p.showroomAreas.length?buildShowroomHtml(p):'')
  document.getElementById('propDetailModal').classList.add('show');
  /* 权限：编辑=管理员或录入人；删除=仅管理员；无效=录入人申请/管理员直接 */
  var epb=document.getElementById('editPropBtn');if(epb)epb.style.display=canEditProp(p)?'':'none';
  var dpb=document.getElementById('deletePropBtn');if(dpb)dpb.style.display=canDeleteProp(p)?'':'none';
  var rpib=document.getElementById('requestPropInvalidBtn');
  if(rpib){
    var pend=p.invalidPending&&p.invalidPending.status==='pending';
    if(p.invalid){rpib.style.display=isAdmin()?'':'none';rpib.textContent='恢复有效';rpib.dataset.act='restore'}
    else if(pend&&!isAdmin()){rpib.style.display='';rpib.textContent='无效审核中';rpib.disabled=true;rpib.dataset.act=''}
    else if(canRequestPropInvalid(p)&&!pend){rpib.style.display='';rpib.disabled=false;rpib.textContent=isAdmin()?'标记无效':'申请无效';rpib.dataset.act='req'}
    else {rpib.style.display='none'}
  }
  var apib=document.getElementById('approvePropInvalidBtn'),rjib=document.getElementById('rejectPropInvalidBtn');
  var showReview=isAdmin()&&p.invalidPending&&p.invalidPending.status==='pending'&&!p.invalid;
  if(apib)apib.style.display=showReview?'':'none';
  if(rjib)rjib.style.display=showReview?'':'none';
  /* 新楼盘详情页显示"录入楼盘信息"按钮 */
  var smartDetailBtn=document.getElementById('smartPropDetailBtn');
  if(smartDetailBtn){
    smartDetailBtn.style.display=(p.type==='newdev')?'':'none';
  }
  /* 风险尽调按钮：三类房源均可 */
  var riskBtn=document.getElementById('riskCheckBtn');
  if(riskBtn){
    riskBtn.style.display='';
    riskBtn.onclick=function(){closeModal('propDetailModal');setTimeout(function(){showRiskChecklist(id)},200)};
  }
  // Media handlers
  var uploadArea=document.getElementById('mediaUpload');
  var fileInput=document.createElement('input');fileInput.type='file';fileInput.multiple=true;fileInput.accept='image/*,video/*';fileInput.style.display='none';
  var cameraInput=document.createElement('input');cameraInput.type='file';cameraInput.accept='image/*,video/*';cameraInput.setAttribute('capture','environment');cameraInput.style.display='none';
  uploadArea.appendChild(fileInput);uploadArea.appendChild(cameraInput);
  uploadArea.addEventListener('click',function(){fileInput.click()});
  var cameraBtn=document.getElementById('mediaCameraBtn');if(cameraBtn)cameraBtn.addEventListener('click',function(e){e.stopPropagation();cameraInput.click()});
  uploadArea.addEventListener('dragover',function(e){e.preventDefault();uploadArea.style.borderColor='var(--primary)';uploadArea.style.background='var(--primary-light)'});
  uploadArea.addEventListener('dragleave',function(){uploadArea.style.borderColor='';uploadArea.style.background=''});
  uploadArea.addEventListener('drop',function(e){e.preventDefault();uploadArea.style.borderColor='';uploadArea.style.background='';if(e.dataTransfer.files.length)handleMediaUpload(id,e.dataTransfer.files)});
  fileInput.addEventListener('change',function(){if(this.files.length)handleMediaUpload(id,this.files);this.value=''});
  cameraInput.addEventListener('change',function(){if(this.files.length)handleMediaUpload(id,this.files);this.value=''});
  renderMediaGallery(id);
  document.querySelectorAll('[data-client-id]').forEach(function(el){
    el.addEventListener('click',function(){closeModal('propDetailModal');setTimeout(function(){showClientDetail(el.getAttribute('data-client-id'))},200)});
  });
  /* 楼盘概况卡按钮：查看完整概览 / 编辑 / 生成客户卡片 / 添加 */
  var cmView=document.getElementById('propCmViewBtn');
  if(cmView)cmView.addEventListener('click',function(){try{openCommunityOverviewModal(p.community)}catch(e){console.error('[propCmViewBtn]',e);toast('打开概览失败','error')}});
  var cmEdit=document.getElementById('propCmEditBtn');
  if(cmEdit)cmEdit.addEventListener('click',function(){try{openCommunityForm(p.community)}catch(e){console.error('[propCmEditBtn]',e);toast('打开编辑失败','error')}});
  var cmShare=document.getElementById('propCmShareBtn');
  if(cmShare)cmShare.addEventListener('click',function(){try{openCommunityShareCard(p.community)}catch(e){console.error('[propCmShareBtn]',e);toast('打开发送卡片失败','error')}});
  var cmAdd=document.getElementById('propCmAddBtn');
  if(cmAdd)cmAdd.addEventListener('click',function(){try{openCommunityForm(p.community)}catch(e){console.error('[propCmAddBtn]',e);toast('打开盘概况失败','error')}});
  // Showroom handlers (新楼盘样板房)
  if(p.type==='newdev'&&p.showroomAreas&&p.showroomAreas.length){
    setupShowroomHandlers(id,p.showroomAreas);
  }
}
/* ===== 交易风险尽调清单 ===== */
var RISK_CHECKLISTS={
  secondhand:[
    {cat:'产权与法律',items:[
      {id:'cp_cert',t:'不动产权证真实有效，无抵押/查封/异议登记'},
      {id:'cp_owner',t:'所有共有人同意出售并已签字（婚内房产需配偶同意）'},
      {id:'cp_hukou',t:'卖方户口已迁出，或已在合同中约定迁出时间'},
      {id:'cp_lease',t:'无带租约（买卖不破租赁），或租客已放弃优先购买权'}
    ]},
    {cat:'房屋与费用',items:[
      {id:'bf_quality',t:'实地查看无漏水/裂缝/沉降/凶宅等隐患'},
      {id:'bf_area',t:'产证面积与实际测量一致'},
      {id:'bf_fee',t:'物业费/水电/燃气/暖气无欠缴'},
      {id:'bf_school',t:'学区名额未被占用（可正常入学）'}
    ]},
    {cat:'交易安全',items:[
      {id:'tx_qual',t:'买方购房资格、贷款额度已确认（限购限贷）'},
      {id:'tx_agent',t:'中介公司及经纪人资质可查（核验营业执照）'},
      {id:'tx_fund',t:'资金监管/定金托管方案明确，不直接打给个人'},
      {id:'tx_contract',t:'合同条款（定金/违约/过户时间/交房）已审阅'}
    ]}
  ],
  rental:[
    {cat:'出租资格',items:[
      {id:'rl_right',t:'出租方有权出租（产权人本人或持授权委托）'},
      {id:'rl_record',t:'租赁合同可办理租赁备案'},
      {id:'rl_id',t:'业主身份及联系方式已核实'}
    ]},
    {cat:'费用与设施',items:[
      {id:'rf_deposit',t:'押金金额及退还条件明确（押几付几）'},
      {id:'rf_fee',t:'物业/水电/燃气/宽带/暖气承担方明确'},
      {id:'rf_furniture',t:'家具家电清单已确认，现状拍照留存'}
    ]},
    {cat:'违约条款',items:[
      {id:'rc_early',t:'提前退租/转租条款明确'},
      {id:'rc_breach',t:'违约赔偿标准已约定'}
    ]}
  ],
  newdev:[
    {cat:'开发资质',items:[
      {id:'nd_five',t:'五证齐全（土地证/用地规划/工程规划/施工许可/预售许可）'},
      {id:'nd_dev',t:'开发商资质及信用状况良好（无烂尾/破产风险）'},
      {id:'nd_fund',t:'预售资金纳入监管账户'}
    ]},
    {cat:'合同与交付',items:[
      {id:'nd_standard',t:'交付标准明确（精装/毛坯及品牌清单）'},
      {id:'nd_area',t:'约定面积与实测差异处理条款（误差±3%）'},
      {id:'nd_deliver',t:'合同交付时间明确，逾期违约责任约定'},
      {id:'nd_record',t:'网签合同可备案查询'}
    ]},
    {cat:'风险提示',items:[
      {id:'nh_school',t:'宣传学区是否已落地（非口头承诺，查教育局文件）'},
      {id:'nh_factor',t:'周边不利因素（高架/变电站/垃圾站/墓地）已告知'}
    ]}
  ]
};
function showRiskChecklist(propId){
  var p=findProp(propId);if(!p)return;
  var list=RISK_CHECKLISTS[p.type]||RISK_CHECKLISTS.secondhand;
  if(!p.riskChecks)p.riskChecks={};
  S._curRiskPropId=propId;
  var total=0,checked=0;
  var html='<div class="risk-intro">以下为「'+esc(cleanCommunityName(p.community)||p.title||'该房源')+'」交易前建议核查的风险点，勾选已完成项，可复制清单发给客户作为交易提醒。</div>';
  list.forEach(function(group){
    html+='<div class="risk-group"><div class="risk-group-title">'+esc(group.cat)+'</div>';
    group.items.forEach(function(it){
      total++;
      var on=p.riskChecks[it.id];if(on)checked++;
      html+='<label class="risk-item'+(on?' checked':'')+'"><input type="checkbox" data-rid="'+it.id+'"'+(on?' checked':'')+'> <span>'+esc(it.t)+'</span></label>';
    });
    html+='</div>';
  });
  var pct=total?Math.round(checked/total*100):0;
  html='<div class="risk-progress"><div class="risk-progress-bar" style="width:'+pct+'%"></div></div><div class="risk-progress-text">已完成 '+checked+'/'+total+' 项 ('+pct+'%)</div>'+html;
  document.getElementById('riskCheckBody').innerHTML=html;
  document.getElementById('riskCheckModal').classList.add('show');
  document.querySelectorAll('#riskCheckBody .risk-item input').forEach(function(cb){
    cb.addEventListener('change',function(){
      var p2=findProp(S._curRiskPropId);if(!p2)return;
      if(!p2.riskChecks)p2.riskChecks={};
      if(this.checked)p2.riskChecks[this.getAttribute('data-rid')]=true;
      else delete p2.riskChecks[this.getAttribute('data-rid')];
      var item=this.closest('.risk-item');if(item)item.classList.toggle('checked',this.checked);
      /* 更新进度 */
      var all=document.querySelectorAll('#riskCheckBody .risk-item input');
      var c=0;all.forEach(function(x){if(x.checked)c++});
      var pct=all.length?Math.round(c/all.length*100):0;
      var bar=document.querySelector('#riskCheckBody .risk-progress-bar');if(bar)bar.style.width=pct+'%';
      var pt=document.querySelector('#riskCheckBody .risk-progress-text');if(pt)pt.textContent='已完成 '+c+'/'+all.length+' 项 ('+pct+'%)';
      saveP();
    });
  });
}
function buildRiskCheckText(){
  var p=findProp(S._curRiskPropId);if(!p)return'';
  var list=RISK_CHECKLISTS[p.type]||RISK_CHECKLISTS.secondhand;
  if(!p.riskChecks)p.riskChecks={};
  var lines=['【'+cleanCommunityName(p.community)||p.title||'房源'+' 交易风险尽调清单】','',''];
  list.forEach(function(group){
    lines.push('▌ '+group.cat);
    group.items.forEach(function(it){
      lines.push((p.riskChecks[it.id]?'✓':'○')+' '+it.t);
    });
    lines.push('');
  });
  lines.push('— 以上为购房交易前建议核查事项，最终以实际情况及合同为准 —');
  return lines.join('\n');
}
function handleMediaUpload(propId,files){
  var promises=[];
  var totalFiles=Array.from(files).length;
  var doneCount=0;
  toast('正在上传…（共'+totalFiles+'个文件）','');
  Array.from(files).forEach(function(file){
    if(file.type.startsWith('image/')){
      if(file.size>500*1024*1024){toast(file.name+' 超过500MB，跳过','error');return}
      promises.push(new Promise(function(resolve){
        compressImage(file,1200,0.7,function(dataUrl){
          MediaDB.save({id:uuid(),propertyId:propId,type:'image',name:file.name,dataUrl:dataUrl}).then(function(){doneCount++;toast('已上传 '+doneCount+'/'+totalFiles,'');resolve()});
        });
      }));
    }else if(file.type.startsWith('video/')){
      if(file.size>600*1024*1024){toast(file.name+' 超过600MB，跳过','error');return}
      /* 视频：使用 raw binary 上传，避免 base64 内存爆炸 */
      if(SYNC_ENABLED&&S.currentUser){
        var vid=uuid();
        promises.push(new Promise(function(resolve){
          var xhr=new XMLHttpRequest();
          var uploadUrl=API_BASE+'/api/media/upload-raw?id='+vid+'&propertyId='+encodeURIComponent(propId)+'&type=video&name='+encodeURIComponent(file.name);
          xhr.upload.addEventListener('progress',function(e){
            if(e.lengthComputable){
              var pct=Math.round((e.loaded/e.total)*100);
              toast('视频上传中…'+pct+'%（'+file.name+'）','');
            }
          });
          xhr.addEventListener('load',function(){
            try{
              var resp=JSON.parse(xhr.responseText);
              if(resp.ok){
                /* 只保存元数据到 IndexedDB，不存 base64 */
                MediaDB.save({id:vid,propertyId:propId,type:'video',name:file.name,serverUrl:resp.url,isRawFile:true}).then(function(){doneCount++;toast('已上传 '+doneCount+'/'+totalFiles,'');resolve()});
              }else{
                toast('视频上传失败：'+(resp.error||'未知错误'),'error');resolve();
              }
            }catch(err){toast('视频上传解析失败','error');resolve()}
          });
          xhr.addEventListener('error',function(){
            toast('视频上传失败，请检查网络后重试','error');resolve();
          });
          xhr.addEventListener('timeout',function(){
            toast('视频上传超时（文件可能过大）','error');resolve();
          });
          xhr.timeout=300000; /* 5分钟超时 */
          xhr.open('POST',uploadUrl);
          var auth=getAuthHeader();
          if(auth.Authorization)xhr.setRequestHeader('Authorization',auth.Authorization);
          xhr.send(file); /* 直接发送原始文件 */
        }));
      }else{
        /* 离线模式：仍然用 base64 存 IndexedDB（仅小视频适用） */
        if(file.size>100*1024*1024){toast(file.name+' 超过100MB，离线模式不支持大视频','error');return}
        promises.push(new Promise(function(resolve){
          fileToDataUrl(file,function(dataUrl){
            MediaDB.save({id:uuid(),propertyId:propId,type:'video',name:file.name,dataUrl:dataUrl}).then(function(){doneCount++;toast('已上传 '+doneCount+'/'+totalFiles,'');resolve()});
          });
        }));
      }
    }
  });
  Promise.all(promises).then(function(){renderMediaGallery(propId);renderPropertyList();toast('上传完成（'+doneCount+'个文件）','success')});
}
function renderMediaGallery(propId){
  MediaDB.list(propId).then(function(mediaList){
    S.mediaList=mediaList;
    var gallery=document.getElementById('mediaGallery');
    if(!gallery)return;
    /* 加载当前房源数据，用于标记封面 */
    var prop=findProp(propId);
    var coverId=prop&&prop.coverMediaId?prop.coverMediaId:'';
    if(mediaList.length===0){
      gallery.innerHTML='<p style="text-align:center;padding:16px;color:var(--gray-400);font-size:.875rem">暂无图片/视频，点击上方区域上传</p>';
      return;
    }
    gallery.innerHTML=mediaList.map(function(m,i){
      var isCover=m.id===coverId;
      var coverBadge=isCover?'<span class="media-cover-badge">★封面</span>':'';
      var catBadge=(m.category&&m.category!=='showroom'&&m.category!=='相册')?'<span class="media-cat-badge">'+esc(m.category)+'</span>':'';
      var coverBtn=m.type==='image'?'<button class="media-set-cover" data-mid="'+m.id+'" title="'+(isCover?'已是封面':'设为封面')+'">'+(isCover?'★':'☆')+'</button>':'';
      if(m.type==='image'){
        var imgSrc=m.serverUrl?(API_BASE+m.serverUrl):m.dataUrl;
        return'<div class="media-item'+(isCover?' is-cover':'')+'" data-idx="'+i+'"><img src="'+imgSrc+'" loading="lazy"><span class="media-type">图片</span>'+catBadge+coverBadge+coverBtn+'<button class="media-delete" data-mid="'+m.id+'">×</button></div>';
      }else{
        var vidSrc=m.serverUrl?(API_BASE+m.serverUrl):m.dataUrl;
        return'<div class="media-item" data-idx="'+i+'"><video src="'+vidSrc+'" preload="metadata"></video><span class="media-type">视频</span>'+coverBtn+'<button class="media-delete" data-mid="'+m.id+'">×</button></div>';
      }
    }).join('');
    gallery.querySelectorAll('.media-item').forEach(function(el){
      el.addEventListener('click',function(e){
        if(e.target.classList.contains('media-delete')){e.stopPropagation();deleteMedia(e.target.getAttribute('data-mid'),propId);return}
        if(e.target.classList.contains('media-set-cover')){e.stopPropagation();setPropCover(propId,e.target.getAttribute('data-mid'));return}
        openLightbox(mediaList,parseInt(el.getAttribute('data-idx')));
      });
    });
  });
}

function setPropCover(propId,mediaId){
  var p=findProp(propId);if(!p)return;
  p.coverMediaId=mediaId;p.updatedAt=now();
  saveP();
  renderMediaGallery(propId);
  renderPropertyList();
  toast(mediaId===p.coverMediaId?'已设为封面':'封面已更新','success');
}
function deleteMedia(mid,propId){confirmDialog('删除媒体','确定要删除这个文件吗？',function(){MediaDB.remove(mid).then(function(){renderMediaGallery(propId);renderPropertyList();toast('已删除','success')})})}

/* ========== Showroom (样板房视频) ========== */
function areaId(area){return area.replace(/[^a-zA-Z0-9]/g,'')}
function buildShowroomHtml(p){
  return'<div class="detail-section"><h3>🏠 样板房视频/图片</h3>'
    +'<p style="font-size:.8125rem;color:var(--text-muted);margin-bottom:10px">按面积段分类管理样板房视频，体验样板房（带软装）与交付样板房分开管理</p>'
    +p.showroomAreas.map(function(area){
      var aid=areaId(area);
      return'<div class="showroom-section">'
        +'<div class="showroom-header" data-sr-area="'+esc(area)+'">'
        +'<h4>📐 '+esc(area)+'</h4>'
        +'<svg class="arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>'
        +'</div>'
        +'<div class="showroom-body">'
        +'<div class="showroom-subsections">'
        +'<div class="showroom-subsection"><div class="showroom-sub-header experience">🎨 软装体验样板房</div><div class="showroom-sub-body" id="srExp_'+aid+'"></div></div>'
        +'<div class="showroom-subsection"><div class="showroom-sub-header delivery">📦 交付样板房</div><div class="showroom-sub-body" id="srDel_'+aid+'"></div></div>'
        +'</div></div></div>';
    }).join('')
    +'</div>';
}
function setupShowroomHandlers(propId,areas){
  // Expand/collapse
  document.querySelectorAll('.showroom-header').forEach(function(h){
    h.addEventListener('click',function(){
      this.classList.toggle('open');
      this.nextElementSibling.classList.toggle('open');
    });
  });
  // Upload handlers for each area+type
  areas.forEach(function(area){
    var aid=areaId(area);
    ['Exp','Del'].forEach(function(prefix){
      var type=prefix==='Exp'?'experience':'delivery';
      var bodyId='sr'+prefix+'_'+aid;
      var body=document.getElementById(bodyId);
      if(!body)return;
      // Create upload area
      var upload=document.createElement('div');
      upload.className='showroom-upload';
      upload.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" stroke-width="1.5" style="margin:0 auto;display:block"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><p>上传视频/图片</p><button type="button" class="btn btn-primary btn-sm showroom-camera-btn">📷 拍照</button>';
      var fileInput=document.createElement('input');
      fileInput.type='file';fileInput.multiple=true;fileInput.accept='image/*,video/*';fileInput.style.display='none';
      var cameraInput=document.createElement('input');
      cameraInput.type='file';cameraInput.accept='image/*,video/*';cameraInput.setAttribute('capture','environment');cameraInput.style.display='none';
      upload.appendChild(fileInput);upload.appendChild(cameraInput);
      upload.addEventListener('click',function(e){if(e.target&&e.target.classList&&e.target.classList.contains('showroom-camera-btn')){e.stopPropagation();cameraInput.click();return;}fileInput.click()});
      upload.addEventListener('dragover',function(e){e.preventDefault();upload.style.borderColor='var(--primary)';upload.style.background='var(--primary-light)'});
      upload.addEventListener('dragleave',function(){upload.style.borderColor='';upload.style.background=''});
      upload.addEventListener('drop',function(e){e.preventDefault();upload.style.borderColor='';upload.style.background='';if(e.dataTransfer.files.length)handleShowroomUpload(propId,area,type,e.dataTransfer.files)});
      fileInput.addEventListener('change',function(){if(this.files.length)handleShowroomUpload(propId,area,type,this.files);this.value=''});
      cameraInput.addEventListener('change',function(){if(this.files.length)handleShowroomUpload(propId,area,type,this.files);this.value=''});
      body.appendChild(upload);
      var galleryContainer=document.createElement('div');
      galleryContainer.className='showroom-gallery';
      galleryContainer.id='srGallery_'+prefix+'_'+aid;
      body.appendChild(galleryContainer);
      renderShowroomGallery(propId,area,type,prefix,aid);
    });
  });
}
function handleShowroomUpload(propId,area,type,files){
  var promises=[];
  var totalFiles=Array.from(files).length;
  var doneCount=0;
  toast('正在上传…（共'+totalFiles+'个文件）','');
  Array.from(files).forEach(function(file){
    if(file.type.startsWith('image/')){
      if(file.size>500*1024*1024){toast(file.name+' 超过500MB，跳过','error');return}
      promises.push(new Promise(function(resolve){
        compressImage(file,1200,0.7,function(dataUrl){
          MediaDB.save({id:uuid(),propertyId:propId,type:'image',name:file.name,dataUrl:dataUrl,category:'showroom',showroomArea:area,showroomType:type}).then(function(){doneCount++;resolve()});
        });
      }));
    }else if(file.type.startsWith('video/')){
      if(file.size>600*1024*1024){toast(file.name+' 超过600MB，跳过','error');return}
      if(SYNC_ENABLED&&S.currentUser){
        var vid=uuid();
        promises.push(new Promise(function(resolve){
          var xhr=new XMLHttpRequest();
          var uploadUrl=API_BASE+'/api/media/upload-raw?id='+vid+'&propertyId='+encodeURIComponent(propId)+'&type=video&name='+encodeURIComponent(file.name)+'&category=showroom&showroomArea='+encodeURIComponent(area)+'&showroomType='+encodeURIComponent(type);
          xhr.upload.addEventListener('progress',function(e){
            if(e.lengthComputable){
              var pct=Math.round((e.loaded/e.total)*100);
              toast('视频上传中…'+pct+'%','');
            }
          });
          xhr.addEventListener('load',function(){
            try{
              var resp=JSON.parse(xhr.responseText);
              if(resp.ok){
                MediaDB.save({id:vid,propertyId:propId,type:'video',name:file.name,serverUrl:resp.url,isRawFile:true,category:'showroom',showroomArea:area,showroomType:type}).then(function(){doneCount++;resolve()});
              }else{toast('视频上传失败','error');resolve()}
            }catch(err){toast('视频上传解析失败','error');resolve()}
          });
          xhr.addEventListener('error',function(){toast('视频上传失败，请重试','error');resolve()});
          xhr.addEventListener('timeout',function(){toast('视频上传超时','error');resolve()});
          xhr.timeout=300000;
          xhr.open('POST',uploadUrl);
          var auth=getAuthHeader();
          if(auth.Authorization)xhr.setRequestHeader('Authorization',auth.Authorization);
          xhr.send(file);
        }));
      }else{
        if(file.size>100*1024*1024){toast(file.name+' 超过100MB，离线模式不支持大视频','error');return}
        promises.push(new Promise(function(resolve){
          fileToDataUrl(file,function(dataUrl){
            MediaDB.save({id:uuid(),propertyId:propId,type:'video',name:file.name,dataUrl:dataUrl,category:'showroom',showroomArea:area,showroomType:type}).then(function(){doneCount++;resolve()});
          });
        }));
      }
    }
  });
  Promise.all(promises).then(function(){
    var prefix=type==='experience'?'Exp':'Del';
    renderShowroomGallery(propId,area,type,prefix,areaId(area));
    toast('上传完成（'+doneCount+'个文件）','success');
  });
}
function renderShowroomGallery(propId,area,type,prefix,aid){
  MediaDB.list(propId).then(function(allMedia){
    var mediaList=allMedia.filter(function(m){
      return m.category==='showroom'&&m.showroomArea===area&&m.showroomType===type;
    });
    var gallery=document.getElementById('srGallery_'+prefix+'_'+aid);
    if(!gallery)return;
    if(mediaList.length===0){
      gallery.innerHTML='<div class="showroom-empty">暂无文件</div>';
      return;
    }
    gallery.innerHTML=mediaList.map(function(m,i){
      if(m.type==='image'){
        var imgSrc=m.serverUrl?(API_BASE+m.serverUrl):m.dataUrl;
        return'<div class="media-item" data-sr-idx="'+i+'"><img src="'+imgSrc+'" loading="lazy"><button class="media-delete" data-sr-mid="'+m.id+'">×</button></div>';
      }else{
        var vidSrc=m.serverUrl?(API_BASE+m.serverUrl):m.dataUrl;
        return'<div class="media-item" data-sr-idx="'+i+'"><video src="'+vidSrc+'" preload="metadata"></video><span class="media-type">视频</span><button class="media-delete" data-sr-mid="'+m.id+'">×</button></div>';
      }
    }).join('');
    // Store media list for lightbox
    gallery._srMediaList=mediaList;
    gallery.querySelectorAll('.media-item').forEach(function(el){
      el.addEventListener('click',function(e){
        if(e.target.classList.contains('media-delete')){
          e.stopPropagation();
          var mid=e.target.getAttribute('data-sr-mid');
          confirmDialog('删除文件','确定要删除这个文件吗？',function(){
            MediaDB.remove(mid).then(function(){renderShowroomGallery(propId,area,type,prefix,aid);toast('已删除','success')});
          });
        }else{
          openLightbox(mediaList,parseInt(el.getAttribute('data-sr-idx')));
        }
      });
    });
  });
}

function openLightbox(mediaList,idx){
  S.mediaList=mediaList;S.mediaIdx=idx;
  renderLightbox();
  document.getElementById('lightbox').classList.add('show');
}
function renderLightbox(){
  var m=S.mediaList[S.mediaIdx];
  if(!m)return;
  var el=document.getElementById('lbContent');
  var src=m.serverUrl?(API_BASE+m.serverUrl):m.dataUrl;
  if(m.type==='image'){
    el.innerHTML='<img src="'+src+'">'
    +'<div class="lb-download-bar"><button class="lb-download-btn" id="lbDownloadImg">下载图片（带水印）</button></div>';
    var dlBtn=document.getElementById('lbDownloadImg');
    if(dlBtn)dlBtn.addEventListener('click',function(){downloadImageWithWatermark(m)});
  }
  else{
    el.innerHTML='<video src="'+src+'" controls autoplay></video>'
    +'<div class="lb-download-bar"><button class="lb-download-btn" id="lbDownloadVideo">下载视频（带水印）</button></div>';
    var dlVBtn=document.getElementById('lbDownloadVideo');
    if(dlVBtn)dlVBtn.addEventListener('click',function(){downloadVideoWithWatermark(m)});
  }
}

/* ========== 带水印的下载 ========== */
function getWatermarkText(){
  var name=S.currentUser?S.currentUser.name:'小闻哥';
  var phone=S.currentUser?S.currentUser.phone:'';
  // 如果是管理员，使用管理员信息；否则使用系统默认
  if(isAdmin()){
    return name+' · 杭州'+(phone?' '+phone:'');
  }
  return name+(phone?' '+phone:'');
}

function downloadImageWithWatermark(m){
  toast('正在生成水印图片…','');
  var img=new Image();
  img.onload=function(){
    var cv=document.createElement('canvas');
    cv.width=img.width;cv.height=img.height;
    var ctx=cv.getContext('2d');
    ctx.drawImage(img,0,0);
    // 水印文字
    var wmText=getWatermarkText();
    var fontSize=Math.max(16,Math.round(img.width/25));
    ctx.font='bold '+fontSize+'px sans-serif';
    ctx.textAlign='right';
    ctx.textBaseline='bottom';
    var padding=Math.round(fontSize*0.6);
    var x=img.width-padding;
    var y=img.height-padding;
    // 阴影
    ctx.shadowColor='rgba(0,0,0,0.7)';
    ctx.shadowBlur=4;
    ctx.shadowOffsetX=1;ctx.shadowOffsetY=1;
    ctx.fillStyle='rgba(255,255,255,0.9)';
    ctx.fillText(wmText,x,y);
    cv.toBlob(function(blob){
      downloadBlob(blob,(m.name||'image').replace(/\.[^.]+$/,'')+'_watermarked.jpg');
      toast('图片已下载','success');
    },'image/jpeg',0.9);
  };
  img.src=m.serverUrl?(API_BASE+m.serverUrl):m.dataUrl;
  img.crossOrigin='anonymous';
}

function downloadVideoWithWatermark(m){
  var videoSrc=m.serverUrl?(API_BASE+m.serverUrl):m.dataUrl;
  if(typeof MediaRecorder==='undefined'||!HTMLCanvasElement.prototype.captureStream){
    // 不支持Canvas录制，直接下载原始文件
    toast('浏览器不支持水印录制，下载原视频…','');
    if(m.serverUrl){
      /* 从服务器下载原始文件 */
      var a=document.createElement('a');
      a.href=API_BASE+'/api/media/download/'+m.id+'?token='+(S.authToken||'');
      a.download=(m.name||'video').replace(/\.[^.]+$/,'')+'.mp4';
      document.body.appendChild(a);a.click();a.remove();
    }else{
      downloadDataUrl(m.dataUrl,(m.name||'video').replace(/\.[^.]+$/,'')+'.mp4');
    }
    return;
  }
  toast('正在生成带水印视频，请勿关闭页面…','');
  var video=document.createElement('video');
  video.src=videoSrc;
  video.muted=true;
  video.playsInline=true;
  video.crossOrigin='anonymous';
  video.addEventListener('loadedmetadata',function(){
    var w=video.videoWidth||640;
    var h=video.videoHeight||480;
    var cv=document.createElement('canvas');
    cv.width=w;cv.height=h;
    var ctx=cv.getContext('2d');
    var wmText=getWatermarkText();
    var fontSize=Math.max(16,Math.round(w/30));
    ctx.font='bold '+fontSize+'px sans-serif';
    // 测量文字宽度
    var wmWidth=ctx.measureText(wmText).width;
    var padding=Math.round(fontSize*0.5);

    var stream=cv.captureStream(30);
    var mimeType='video/webm;codecs=vp9';
    if(!MediaRecorder.isTypeSupported(mimeType))mimeType='video/webm;codecs=vp8';
    if(!MediaRecorder.isTypeSupported(mimeType))mimeType='video/webm';
    var recorder=new MediaRecorder(stream,{mimeType:mimeType,videoBitsPerSecond:3000000});
    var chunks=[];
    recorder.ondataavailable=function(e){if(e.data.size>0)chunks.push(e.data)};
    recorder.onstop=function(){
      var blob=new Blob(chunks,{type:'video/webm'});
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');
      a.href=url;
      a.download=(m.name||'video').replace(/\.[^.]+$/,'')+'_watermarked.webm';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('视频已下载（带水印）','success');
    };
    recorder.start();
    video.play();
    var rafId;
    function drawFrame(){
      ctx.drawImage(video,0,0,w,h);
      // 水印
      ctx.shadowColor='rgba(0,0,0,0.7)';
      ctx.shadowBlur=4;
      ctx.shadowOffsetX=1;ctx.shadowOffsetY=1;
      ctx.fillStyle='rgba(255,255,255,0.85)';
      ctx.font='bold '+fontSize+'px sans-serif';
      ctx.textAlign='right';
      ctx.textBaseline='bottom';
      ctx.fillText(wmText,w-padding,h-padding);
      // 半透明底色
      ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
      if(video.ended||video.paused){
        cancelAnimationFrame(rafId);
        recorder.stop();
        return;
      }
      rafId=requestAnimationFrame(drawFrame);
    }
    drawFrame();
    // 安全停止
    setTimeout(function(){
      if(recorder.state==='recording'){
        video.pause();
        cancelAnimationFrame(rafId);
        recorder.stop();
      }
    },(video.duration||60)*1000+5000);
  });
  video.addEventListener('error',function(){
    toast('视频加载失败，下载原文件','');
    downloadDataUrl(m.dataUrl,(m.name||'video').replace(/\.[^.]+$/,'')+'.mp4');
  });
}

function downloadDataUrl(dataUrl,filename){
  var a=document.createElement('a');
  a.href=dataUrl;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ========== Share ========== */
function copyPropertyInfo(id){
  var p=findProp(id);if(!p)return;
  var text='';
  var sig='—— '+(S.currentUser?S.currentUser.name:'')+(S.currentUser&&S.currentUser.phone?' '+S.currentUser.phone:'');
  if(p.type==='rental'){
    text='\u3010'+p.title+'\u3011\n'+
      (p.community?'\u5c0f\u533a\uff1a'+p.community+'\n':'')+
      (p.building?'\u697c\u5e62\uff1a'+p.building+'\u3002':'')+(p.unit?p.unit+'\u3002':'')+(p.room?p.room+'\n':'\n')+
      (p.area?'\u9762\u79ef\uff1a'+p.area+'\u33a1\n':'')+
      (p.layout?'\u6237\u578b\uff1a'+p.layout+'\n':'')+
      (p.floor?'\u697c\u5c42\uff1a'+p.floor+(p.totalFloors?'/'+p.totalFloors+'\u5c42':'')+'\n':'')+
      (p.orientation?'\u671d\u5411\uff1a'+p.orientation+'\n':'')+
      (p.decoration?'\u88c5\u4fee\uff1a'+p.decoration+'\n':'')+
      (p.rentPrice?'\u6708\u79df\uff1a'+p.rentPrice+'\u5143/\u6708\n':'')+
      (p.depositType?'\u62bc\u4ed8\uff1a'+p.depositType+'\n':'')+
      (p.rentType?'\u79df\u8d41\u65b9\u5f0f\uff1a'+p.rentType+'\n':'')+
      (p.leaseTerm?'\u79df\u671f\uff1a'+p.leaseTerm+'\n':'')+
      (p.rentStatus?'\u72b6\u6001\uff1a'+p.rentStatus+'\n':'')+
      (p.moveInDate?'\u5165\u4f4f\u65f6\u95f4\uff1a'+p.moveInDate+'\n':'')+
      '\u4f4d\u7f6e\uff1a'+(p.district||'')+(p.block?'\u00b7'+p.block:'')+(p.address?' '+p.address:'')+'\n'+
      (p.metro?'\u5730\u94c1\uff1a'+p.metro+'\n':'')+
      (p.description?'\n'+p.description:'')+
      '\n\n'+sig;
  }else if(p.type==='secondhand'){
    text='\u3010'+p.title+'\u3011\n'+
      (p.community?'\u5c0f\u533a\uff1a'+p.community+'\n':'')+
      (p.building?'\u697c\u5e62\uff1a'+p.building+'\u3002':'')+(p.unit?p.unit+'\u3002':'')+(p.room?p.room+'\n':'\n')+
      (p.area?'\u9762\u79ef\uff1a'+p.area+'\u33a1\n':'')+
      (p.layout?'\u6237\u578b\uff1a'+p.layout+'\n':'')+
      (p.floor?'\u697c\u5c42\uff1a'+p.floor+(p.totalFloors?'/'+p.totalFloors+'\u5c42':'')+'\n':'')+
      (p.orientation?'\u671d\u5411\uff1a'+p.orientation+'\n':'')+
      (p.decoration?'\u88c5\u4fee\uff1a'+p.decoration+'\n':'')+
      (p.totalPrice?'\u603b\u4ef7\uff1a'+p.totalPrice+'\u4e07\n':'')+
      (p.unitPrice?'\u5355\u4ef7\uff1a'+p.unitPrice+'\u5143/\u33a1\n':'')+
      '\u4f4d\u7f6e\uff1a'+(p.district||'')+(p.block?'\u00b7'+p.block:'')+(p.address?' '+p.address:'')+'\n'+
      (p.school?'\u5b66\u533a\uff1a'+p.school+'\n':'')+
      (p.metro?'\u5730\u94c1\uff1a'+p.metro+'\n':'')+
      (p.description?'\n'+p.description:'')+
      '\n\n'+sig;
  }else{
    text='\u3010'+p.title+'\u3011\n'+
      (p.developer?'\u5f00\u53d1\u5546\uff1a'+p.developer+'\n':'')+
      '\u533a\u57df\uff1a'+(p.district||'')+(p.block?'\u00b7'+p.block:'')+'\n'+
      (p.averagePrice?'\u5747\u4ef7\uff1a'+p.averagePrice+'\u5143/\u33a1\n':'')+
      (p.openingDate?'\u5f00\u76d8\uff1a'+p.openingDate+'\n':'')+
      (p.deliveryDate?'\u4ea4\u623f\uff1a'+p.deliveryDate+'\n':'')+
      (p.availableLayouts?'\u5728\u552e\u6237\u578b\uff1a'+p.availableLayouts+'\n':'')+
      '\u4f4d\u7f6e\uff1a'+(p.district||'')+(p.address?' '+p.address:'')+'\n'+
      (p.description?'\n'+p.description:'')+
      '\n\n'+sig;
  }
  if(navigator.clipboard){
    navigator.clipboard.writeText(text).then(function(){toast('已复制到剪贴板，可粘贴到微信发送','success')}).catch(function(){fallbackCopy(text)});
  }else{fallbackCopy(text)}
}
function fallbackCopy(text){
  var ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');toast('已复制到剪贴板','success')}catch(e){toast('复制失败，请手动复制','error')}
  document.body.removeChild(ta);
}
function showShareView(id){
  var p=findProp(id);if(!p)return;
  MediaDB.list(id).then(function(media){
    var firstImg=media.find(function(m){return m.type==='image'});
    var price=p.type==='secondhand'?(p.totalPrice?p.totalPrice+'万':''):(p.averagePriceText||(p.averagePrice?p.averagePrice+'元/㎡':''));
    var rows=p.type==='secondhand'?[
      ['小区',p.community],['面积',p.area?p.area+'㎡':''],['户型',p.layout],['楼层',p.floor+(p.totalFloors?'/'+p.totalFloors:'')+'层'],
      ['朝向',p.orientation],['装修',p.decoration],['总价',price],['单价',p.unitPrice?p.unitPrice+'元/㎡':''],
      ['学区',p.school],['地铁',p.metro]
    ]:[
      ['开发商',p.developer],['均价',price],['起步总价',p.totalPriceText||(p.totalPrice?p.totalPrice+'万起':'')],
      ['在售面积',p.availableLayouts],['在售楼幢',p.onSaleBuildings],['加推楼幢',p.additionalBuildings],['加推价格',p.additionalPrice],
      ['交付时间',p.deliveryDate],['物业类型',p.propertyType],['地铁',p.metro],['开盘',p.openingDate],
      ['绿化率',p.greenRate],['容积率',p.plotRatio]
    ].filter(function(r){return r[1]});
    var rowsHtml=rows.map(function(r){return'<div class="share-info-row"><span class="lbl">'+esc(r[0])+'</span><span class="val">'+esc(r[1])+'</span></div>'}).join('');
    document.getElementById('shareModalBody').innerHTML=
      '<div class="share-view"><div class="share-header"><h2>'+esc(p.title)+'</h2><p>'+esc(p.district)+(p.address?' · '+esc(p.address):'')+'</p></div>'
      +'<div class="share-body">'+(firstImg?'<img class="share-img" src="'+firstImg.dataUrl+'">':'')
      +rowsHtml
      +(p.description?'<div class="share-desc">'+esc(p.description)+'</div>':'')
      +'</div><div class="share-footer">掌房 · '+(S.currentUser?S.currentUser.name:'小闻哥')+(S.currentUser&&S.currentUser.phone?' '+S.currentUser.phone:'')+'</div></div>';
    document.getElementById('shareModal').classList.add('show');
  });
}

/* ========== Matching ========== */
function getMatchedClients(propId){
  var p=findProp(propId);if(!p)return[];
  return S.clients.filter(function(c){
    if(c.status==='已成交'||c.status==='暂缓')return false;
    var areaMatch=!p.district||!(c.targetAreas&&c.targetAreas.length)||c.targetAreas.indexOf(p.district)>=0;
    var price=p.totalPrice||((p.averagePrice||0)*0.001);
    var budgetMatch=(!c.budgetMin||price>=c.budgetMin*0.8)&&(!c.budgetMax||price<=c.budgetMax*1.2);
    return areaMatch&&budgetMatch;
  }).sort(function(a,b){var o={'A':0,'B':1,'C':2};return(o[a.grade]||3)-(o[b.grade]||3)});
}
function getMatchedProperties(clientId){
  var c=findClient(clientId);if(!c)return[];
  return S.properties.filter(function(p){
    if(p.status==='已售'||p.status==='下架'||p.status==='售罄')return false;
    var areaMatch=!p.district||!(c.targetAreas&&c.targetAreas.length)||c.targetAreas.indexOf(p.district)>=0;
    var price=p.totalPrice||((p.averagePrice||0)*0.001);
    var budgetMatch=(!c.budgetMin||price>=c.budgetMin*0.8)&&(!c.budgetMax||price<=c.budgetMax*1.2);
    return areaMatch&&budgetMatch;
  });
}

/* ========== Transactions ========== */
function findTx(id){return S.transactions.find(function(t){return t.id===id})}
function getFilteredTx(){
  var list=S.transactions.slice();var f=S.txFilters;var q=S.search.trim().toLowerCase();
  /* 非管理员只能看自己录入的成交（createdBy 即归属人） */
  if(!isAdmin()&&S.currentUser){list=list.filter(function(t){return t.createdBy===S.currentUser.id});}
  if(q){list=list.filter(function(t){var h=[t.clientName,t.propertyTitle,t.notes].join(' ').toLowerCase();return h.indexOf(q)>=0})}
  if(f.type)list=list.filter(function(t){return t.dealType===f.type});
  if(f.dateFrom)list=list.filter(function(t){return t.transactionDate>=new Date(f.dateFrom).getTime()});
  if(f.dateTo)list=list.filter(function(t){return t.transactionDate<=new Date(f.dateTo).getTime()+86400000});
  if(f.client)list=list.filter(function(t){return(t.clientName||'').indexOf(f.client)>=0});
  if(f.min)list=list.filter(function(t){return(t.transactionPrice||0)>=f.min});
  if(f.max)list=list.filter(function(t){return(t.transactionPrice||0)<=f.max});
  var sk=S.txSort;
  list.sort(function(a,b){
    if(sk==='createdAt')return(b.createdAt||0)-(a.createdAt||0);
    if(sk==='transactionPriceAsc')return(a.transactionPrice||0)-(b.transactionPrice||0);
    if(sk==='transactionPriceDesc')return(b.transactionPrice||0)-(a.transactionPrice||0);
    return(b.transactionDate||0)-(a.transactionDate||0);
  });
  return list;
}
function renderTxStats(){
  var total=S.transactions.length,totalVol=0,totalComm=0,monthCount=0;
  var now=new Date(),thisMonth=now.getFullYear()*100+now.getMonth();
  S.transactions.forEach(function(t){
    totalVol+=t.transactionPrice||0;
    totalComm+=t.commission||0;
    var td=new Date(t.transactionDate||0);
    if(td.getFullYear()*100+td.getMonth()===thisMonth)monthCount++;
  });
  document.getElementById('txStatsBar').innerHTML=
    statCard('','总成交',total,'')+
    statCard('success','本月成交',monthCount,'')+
    statCard('danger','成交总额',totalVol.toFixed(0)+'万','')+
    statCard('warning','佣金收入',totalComm.toFixed(0)+'元','');
}
function renderTxList(){
  renderTxStats();
  updateFilterBadge('txFilterToggle',S.txFilters);
  var list=getFilteredTx();
  var grid=document.getElementById('txGrid');
  document.getElementById('txResultCount').innerHTML='共 <b>'+list.length+'</b> 条成交记录'+(isAdmin()?' <button class="btn btn-sm btn-outline" onclick="exportCurrentCSV(\x27transactions\x27)" style="margin-left:12px;font-size:.75rem" title="导出成交记录为CSV">📥 导出CSV</button>':'');
  if(list.length===0){
    grid.innerHTML='<div class="empty" style="grid-column:1/-1"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg><h3>'+(S.transactions.length===0?'还没有成交记录':'没有符合条件的记录')+'</h3><p>'+(S.transactions.length===0?'点击「录入成交」按钮，记录第一笔成交':'试试调整筛选条件')+'</p></div>';
    return;
  }
  var typeNames={newdev:'新房',secondhand:'二手房',other:'其他'};
  grid.innerHTML=list.map(function(t){
    return'<div class="tx-card" data-dealtype="'+esc(t.dealType)+'" data-id="'+t.id+'">'
      +'<div class="tx-card-top"><div><div class="tx-client">'+esc(t.clientName)+' <span class="deal-type-badge" data-type="'+esc(t.dealType)+'">'+esc(typeNames[t.dealType]||'其他')+'</span></div>'
      +'<div class="tx-prop">'+esc(t.propertyTitle||'—')+'</div></div>'
      +'<div class="tx-price">'+(t.transactionPrice?t.transactionPrice+'<span style="font-size:.8125rem;color:var(--text-muted);font-weight:400">万</span>':'')+'</div></div>'
      +'<div class="tx-meta"><span>📅 '+fmtDate(t.transactionDate)+'</span>'+(t.commission?'<span>💰 佣金 <b style="color:var(--warning)">'+t.commission+'元</b></span>':'')+(t.commissionRate?'<span>佣金率 '+t.commissionRate+'%</span>':'')+'<span>录入 '+fmtDate(t.createdAt)+'</span></div>'
      +'</div>';
  }).join('');
  grid.querySelectorAll('.tx-card').forEach(function(card){
    card.addEventListener('click',function(){showTxDetail(card.getAttribute('data-id'))});
  });
}
function openTxForm(id){
  try{
  S.editTxId=id||null;
  document.getElementById('txFormTitle').textContent=id?'编辑成交记录':'录入成交记录';
  document.getElementById('txfId').value=id||'';
  // Populate client dropdown
  var clientSel=document.getElementById('txfClient');
  clientSel.innerHTML='<option value="">请选择客户</option>'+S.clients.map(function(c){return'<option value="'+c.id+'">'+esc(c.name)+'</option>'}).join('');
  // Populate property dropdown
  var propSel=document.getElementById('txfProperty');
  propSel.innerHTML='<option value="">选择已有房源</option>'+S.properties.map(function(p){return'<option value="'+p.id+'">'+esc(p.title)+' ('+esc(p.district)+')</option>'}).join('');
  var t=id?findTx(id):{};
  document.getElementById('txfClient').value=t.clientId||'';
  document.getElementById('txfClientName').value=t.clientName&&!t.clientId?t.clientName:'';
  document.getElementById('txfProperty').value=t.propertyId||'';
  document.getElementById('txfPropName').value=t.propertyTitle&&!t.propertyId?t.propertyTitle:'';
  document.getElementById('txfDealType').value=t.dealType||'secondhand';
  var td=t.transactionDate?new Date(t.transactionDate):new Date();
  document.getElementById('txfDate').value=td.getFullYear()+'-'+pad(td.getMonth()+1)+'-'+pad(td.getDate());
  document.getElementById('txfPrice').value=t.transactionPrice||'';
  document.getElementById('txfUnitPrice').value=t.unitPrice||'';
  document.getElementById('txfCommission').value=t.commission||'';
  document.getElementById('txfCommissionRate').value=t.commissionRate||'';
  document.getElementById('txfNotes').value=t.notes||'';
  var _sd=t.signDate?new Date(t.signDate):null;document.getElementById('txfSignDate').value=_sd?(_sd.getFullYear()+'-'+pad(_sd.getMonth()+1)+'-'+pad(_sd.getDate())):'';
  var _td=t.transferDate?new Date(t.transferDate):null;document.getElementById('txfTransferDate').value=_td?(_td.getFullYear()+'-'+pad(_td.getMonth()+1)+'-'+pad(_td.getDate())):'';
  var _dd=t.deliveryDate?new Date(t.deliveryDate):null;document.getElementById('txfDeliveryDate').value=_dd?(_dd.getFullYear()+'-'+pad(_dd.getMonth()+1)+'-'+pad(_dd.getDate())):'';
  // Auto-fill from property selection
  propSel.onchange=function(){
    var pid=this.value;
    if(pid){var p=findProp(pid);if(p){
      document.getElementById('txfPropName').value=p.title;
      document.getElementById('txfDealType').value=p.type==='newdev'?'newdev':'secondhand';
      if(p.totalPrice)document.getElementById('txfPrice').value=p.totalPrice;
      if(p.unitPrice)document.getElementById('txfUnitPrice').value=p.unitPrice;
    }}
  };
  clientSel.onchange=function(){
    var cid=this.value;
    if(cid){var c=findClient(cid);if(c)document.getElementById('txfClientName').value=c.name}
  };
  document.getElementById('txFormModal').classList.add('show');
  var tfMb=document.querySelector('#txFormModal .modal-body');if(tfMb)tfMb.scrollTop=0;
  }catch(err){
    console.error('[openTxForm]',err);
    toast('打开成交表单失败: '+(err&&err.message||err),'error');
  }
}
function saveTx(){
  var clientId=document.getElementById('txfClient').value;
  var clientName='';
  if(clientId){var c=findClient(clientId);clientName=c?c.name:''}
  if(!clientName){clientName=document.getElementById('txfClientName').value.trim()}
  if(!clientName){toast('请选择或输入客户','error');return}
  var propertyId=document.getElementById('txfProperty').value;
  var propertyTitle=document.getElementById('txfPropName').value.trim();
  if(!propertyId&&!propertyTitle){
    if(propertyId){var p=findProp(propertyId);if(p)propertyTitle=p.title}
  }
  if(!propertyTitle){toast('请选择或输入房源','error');return}
  var dateStr=document.getElementById('txfDate').value;
  if(!dateStr){toast('请选择成交日期','error');return}
  var price=parseFloat(document.getElementById('txfPrice').value)||0;
  if(price<=0){toast('请输入成交总价','error');return}
  var id=document.getElementById('txfId').value;var isEdit=!!id;var t=isEdit?findTx(id):{};
  t.clientId=clientId;t.clientName=clientName;
  t.propertyId=propertyId;t.propertyTitle=propertyTitle;
  t.dealType=document.getElementById('txfDealType').value;
  t.transactionDate=new Date(dateStr).getTime();
  t.transactionPrice=price;
  t.unitPrice=document.getElementById('txfUnitPrice').value.trim();
  t.commission=parseFloat(document.getElementById('txfCommission').value)||0;
  t.commissionRate=parseFloat(document.getElementById('txfCommissionRate').value)||0;
  t.notes=document.getElementById('txfNotes').value.trim();
  var _sds=document.getElementById('txfSignDate').value;
  t.signDate=_sds?new Date(_sds).getTime():0;
  var _tds=document.getElementById('txfTransferDate').value;
  t.transferDate=_tds?new Date(_tds).getTime():0;
  var _dds=document.getElementById('txfDeliveryDate').value;
  t.deliveryDate=_dds?new Date(_dds).getTime():0;
  t.updatedAt=now();
  if(!isEdit){t.id=uuid();t.createdAt=now();t.createdBy=S.currentUser?S.currentUser.id:'';t.createdByName=S.currentUser?S.currentUser.name:'';S.transactions.push(t)}
  else if(!t.createdBy&&S.currentUser){t.createdBy=S.currentUser.id;t.createdByName=S.currentUser.name}
  // Update client status to 已成交
  if(clientId){var c=findClient(clientId);if(c&&c.status!=='已成交'){c.status='已成交';c.updatedAt=now();saveC()}}
  // Update property status
  if(propertyId){var p=findProp(propertyId);if(p){p.status='已售';p.updatedAt=now();saveP()}}
  saveT();closeModal('txFormModal');renderTxList();toast(isEdit?'成交记录已更新':'成交记录已添加','success');
  logAction(isEdit?'edit':'create','transaction',t.id,t.clientName+' · '+propertyTitle);
}
function showTxDetail(id){
  var t=findTx(id);if(!t)return;S.curTxId=id;
  var typeNames={newdev:'新房',secondhand:'二手房',other:'其他'};
  document.getElementById('txDetailBody').innerHTML=
    '<div class="detail-header"><div class="detail-avatar" style="background:var(--success-light);color:var(--success)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div><div class="detail-info"><h2>'+esc(t.clientName)+'</h2><div class="sub">'+esc(t.propertyTitle)+'</div><div class="detail-badges"><span class="deal-type-badge" data-type="'+esc(t.dealType)+'">'+esc(typeNames[t.dealType]||'其他')+'</span></div></div></div>'
    +'<div class="detail-section"><div class="card-price" style="font-size:1.5rem;margin-bottom:12px">'+(t.transactionPrice||0)+'万</div><div class="detail-grid">'
    +di('成交单价',t.unitPrice?t.unitPrice+'元/㎡':'—')+di('成交日期',fmtDate(t.transactionDate))
    +di('佣金收入',t.commission?t.commission+'元':'—')+di('佣金比例',t.commissionRate?t.commissionRate+'%':'—')
    +di('录入时间',fmtDate(t.createdAt))
    +'</div></div>'
    +(t.notes?'<div class="detail-section"><h3>备注</h3><div class="timeline-content" style="background:var(--warning-light)">'+esc(t.notes)+'</div></div>':'')
    +(t.clientId?'<div class="detail-section"><h3>关联客户</h3><div class="viewing-item" style="cursor:pointer" data-tx-client="'+t.clientId+'"><div class="vi-top"><span class="vi-prop">查看客户详情</span></div></div></div>':'')
    +(t.propertyId?'<div class="detail-section"><h3>关联房源</h3><div class="viewing-item" style="cursor:pointer" data-tx-prop="'+t.propertyId+'"><div class="vi-top"><span class="vi-prop">查看房源详情</span></div></div></div>':'')
    +renderTxProcessTimeline(t);
  document.getElementById('txDetailModal').classList.add('show');
  setupTxProcessTimeline(id);
  var clientLink=document.querySelector('[data-tx-client]');
  if(clientLink)clientLink.addEventListener('click',function(){closeModal('txDetailModal');setTimeout(function(){showClientDetail(clientLink.getAttribute('data-tx-client'))},200)});
  var propLink=document.querySelector('[data-tx-prop]');
  if(propLink)propLink.addEventListener('click',function(){closeModal('txDetailModal');setTimeout(function(){showPropertyDetail(propLink.getAttribute('data-tx-prop'))},200)});
}
/* ===== 交易流程时间表 ===== */
var TX_PROCESS_STEPS={
  secondhand:[
    {id:'sign',t:'签订居间合同'},{id:'online',t:'网签备案'},{id:'loan',t:'按揭审批'},
    {id:'tax',t:'缴税（契税/个税）'},{id:'transfer',t:'过户登记'},{id:'lend',t:'银行放款'},
    {id:'deliver',t:'交房验收'},{id:'handover',t:'物业交割'}
  ],
  newdev:[
    {id:'subscribe',t:'认购签约'},{id:'contract',t:'网签买卖合同'},{id:'loan',t:'按揭办理'},
    {id:'lend',t:'银行放款'},{id:'deliver',t:'交付交房'},{id:'deed',t:'办理产权证'}
  ],
  other:[
    {id:'sign',t:'签约'},{id:'deliver',t:'交付'},{id:'handover',t:'交割'}
  ]
};
function renderTxProcessTimeline(t){
  var steps=TX_PROCESS_STEPS[t.dealType]||TX_PROCESS_STEPS.other;
  if(!t.processSteps)t.processSteps={};
  var done=0;steps.forEach(function(s){if(t.processSteps[s.id])done++});
  var pct=steps.length?Math.round(done/steps.length*100):0;
  var html='<div class="detail-section"><h3>交易流程时间表</h3>'
    +'<div class="tx-progress"><div class="tx-progress-bar" style="width:'+pct+'%"></div></div>'
    +'<div class="tx-progress-text">已完成 '+done+'/'+steps.length+' 步 ('+pct+'%)</div>'
    +'<div class="tx-timeline">';
  steps.forEach(function(s,idx){
    var rec=t.processSteps[s.id];
    var isDone=!!rec;
    html+='<div class="tx-step'+(isDone?' done':'')+'" data-step="'+s.id+'">'
      +'<div class="tx-node">'+(isDone?'✓':'')+'</div>'
      +'<div class="tx-step-body"><div class="tx-step-name">'+esc(s.t)+'</div>'
      +(isDone?'<div class="tx-step-date">'+fmtDateTime(rec)+'</div>':'<div class="tx-step-hint">点击标记完成</div>')
      +'</div></div>';
    if(idx<steps.length-1)html+='<div class="tx-line'+(isDone?' done':'')+'"></div>';
  });
  html+='</div></div>';
  return html;
}
function setupTxProcessTimeline(id){
  var t=findTx(id);if(!t)return;
  if(!t.processSteps)t.processSteps={};
  document.querySelectorAll('#txDetailBody .tx-step').forEach(function(el){
    el.addEventListener('click',function(){
      var t2=findTx(S.curTxId);if(!t2)return;
      var sid=el.getAttribute('data-step');
      if(t2.processSteps[sid]){delete t2.processSteps[sid];}
      else{t2.processSteps[sid]=now();}
      saveT();
      /* 重渲染该区块 */
      var body=document.getElementById('txDetailBody');
      var sec=body.querySelector('.tx-timeline');
      if(sec){
        var oldSec=sec.closest('.detail-section');
        var tmp=document.createElement('div');tmp.innerHTML=renderTxProcessTimeline(t2);
        var newSec=tmp.querySelector('.detail-section');
        if(oldSec&&oldSec.parentNode)oldSec.parentNode.replaceChild(newSec,oldSec);
        setupTxProcessTimeline(S.curTxId);
      }
    });
  });
}
/* ===== 交易进度透明共享 ===== */
function buildTxProgressText(t){
  var steps=TX_PROCESS_STEPS[t.dealType]||TX_PROCESS_STEPS.other;
  if(!t.processSteps)t.processSteps={};
  var done=steps.filter(function(s){return t.processSteps[s.id];});
  var pct=steps.length?Math.round(done.length/steps.length*100):0;
  var next=steps.find(function(s){return !t.processSteps[s.id];});
  var L=[];
  L.push('【'+t.clientName+' 的交易进度通报】');
  if(t.propertyTitle)L.push('房源：'+t.propertyTitle);
  if(t.transactionPrice)L.push('成交价：'+t.transactionPrice+'万');
  L.push('当前进度：'+done.length+'/'+steps.length+' 步（'+pct+'%）');
  L.push('');
  if(done.length){
    L.push('✅ 已完成：');
    done.forEach(function(s){L.push('  · '+s.t+'（'+fmtDate(t.processSteps[s.id])+'）');});
    L.push('');
  }
  var pending=steps.filter(function(s){return !t.processSteps[s.id];});
  if(pending.length){
    L.push('⏳ 待推进：');
    pending.forEach(function(s){L.push('  · '+s.t);});
    L.push('');
  }
  if(next)L.push('👉 下一步：'+next.t);
  L.push('');
  L.push('—— 掌房 · '+(S.currentUser?S.currentUser.name:'小闻哥')+(S.currentUser&&S.currentUser.phone?' '+S.currentUser.phone:''));
  return L.join('\n');
}
function showTxProgressShare(id){
  var t=findTx(id);if(!t)return;S._curTxShareId=id;
  var steps=TX_PROCESS_STEPS[t.dealType]||TX_PROCESS_STEPS.other;
  if(!t.processSteps)t.processSteps={};
  var done=steps.filter(function(s){return t.processSteps[s.id];});
  var pending=steps.filter(function(s){return !t.processSteps[s.id];});
  var pct=steps.length?Math.round(done.length/steps.length*100):0;
  var next=pending[0];
  var html='<div class="tx-share-card">'
    +'<div class="txsc-head"><div class="txsc-title">'+esc(t.clientName)+' 的交易进度</div>'
    +(t.propertyTitle?'<div class="txsc-sub">'+esc(t.propertyTitle)+'</div>':'')
    +(t.transactionPrice?'<div class="txsc-price">成交价 '+esc(t.transactionPrice)+'万</div>':'')
    +'</div>'
    +'<div class="tx-progress"><div class="tx-progress-bar" style="width:'+pct+'%"></div></div>'
    +'<div class="tx-progress-text">已完成 '+done.length+'/'+steps.length+' 步（'+pct+'%）</div>';
  if(done.length){
    html+='<div class="txsc-group"><div class="txsc-gt done">✅ 已完成</div>';
    done.forEach(function(s){html+='<div class="txsc-item"><span class="txsc-dot done">✓</span><span class="txsc-name">'+esc(s.t)+'</span><span class="txsc-date">'+fmtDate(t.processSteps[s.id])+'</span></div>';});
    html+='</div>';
  }
  if(pending.length){
    html+='<div class="txsc-group"><div class="txsc-gt">⏳ 待推进</div>';
    pending.forEach(function(s){html+='<div class="txsc-item"><span class="txsc-dot"></span><span class="txsc-name">'+esc(s.t)+'</span></div>';});
    html+='</div>';
  }
  if(next)html+='<div class="txsc-next">👉 下一步：'+esc(next.t)+'</div>';
  html+='<div class="txsc-foot">掌房 · '+(S.currentUser?esc(S.currentUser.name):'小闻哥')+(S.currentUser&&S.currentUser.phone?' '+esc(S.currentUser.phone):'')+'</div>';
  html+='</div>';
  document.getElementById('txProgressShareBody').innerHTML=html;
  document.getElementById('txProgressShareModal').classList.add('show');
}
/* ===== 成交后满意度 + 转介绍邀请 ===== */
function buildReferralText(t){
  var agent=(S.currentUser?S.currentUser.name:'小闻哥');
  var phone=(S.currentUser&&S.currentUser.phone)?S.currentUser.phone:'';
  var L=[];
  L.push('【'+agent+'的房产服务】');
  L.push('');
  L.push('感谢您选择我为您服务'+((t&&t.propertyTitle)?'的'+t.propertyTitle+'交易':'的房产交易')+'！🎉');
  L.push('');
  L.push('如果您对这次服务还算满意，欢迎把身边有买房、卖房、租房需求的朋友推荐给我 🙏');
  L.push('老客户推荐，优先匹配、全程跟进、佣金透明。');
  if(phone)L.push('');
  if(phone)L.push('📞 '+agent+' '+phone);
  L.push('');
  L.push('—— 掌房 · '+agent+(phone?' '+phone:''));
  return L.join('\n');
}
function showTxReferral(id){
  var t=findTx(id);if(!t)return;S._curTxReferralId=id;
  var cur=t.satisfaction||0;
  var stars='';
  for(var i=1;i<=5;i++){
    stars+='<span class="ref-star'+(i<=cur?' on':'')+'" data-star="'+i+'">'+(i<=cur?'★':'☆')+'</span>';
  }
  var html='<div class="ref-card">'
    +'<div class="ref-sec"><div class="ref-label">交易满意度</div>'
    +'<div class="ref-stars" id="refStars">'+stars+'</div>'
    +(cur?'<div class="ref-hint">已记录 '+cur+' 星'+(t.satisfactionNote?'：'+esc(t.satisfactionNote):'')+'</div>':'<div class="ref-hint">点击星星评分（仅内部记录）</div>')
    +'</div>'
    +'<div class="ref-sec"><div class="ref-label">转介绍邀请话术</div>'
    +'<div class="ref-invite">'+esc(buildReferralText(t)).replace(/\n/g,'<br>')+'</div>'
    +'</div></div>';
  document.getElementById('txReferralBody').innerHTML=html;
  document.getElementById('txReferralModal').classList.add('show');
  var starEls=document.querySelectorAll('#refStars .ref-star');
  starEls.forEach(function(el){
    el.addEventListener('click',function(){
      var t2=findTx(S._curTxReferralId);if(!t2)return;
      var v=parseInt(el.getAttribute('data-star'));
      t2.satisfaction=v;t2.updatedAt=now();saveT();
      starEls.forEach(function(e){var iv=parseInt(e.getAttribute('data-star'));var on=iv<=v;e.classList.toggle('on',on);e.textContent=on?'★':'☆';});
      var hint=document.querySelector('#txReferralBody .ref-hint');
      if(hint)hint.textContent='已记录 '+v+' 星';
      toast('已记录客户满意度 '+v+' 星','success');
    });
  });
}

/* ========== Dashboard ========== */
function renderDashboard(){
  if(typeof getReminders==='function'){S.allReminders=getReminders();}
  var totalC=S.clients.length;
  /* 排除MD（业主名单）——MD动辄2万条，混入统计会拖慢手机端 + 数字失真 */
  var propOnly=(S.properties||[]).filter(function(p){return p.type!=='md';});
  var totalP=propOnly.length,gA=0,closed=0,onSale=0;
  var sources={},statuses={待联系:0,已联系:0,看房中:0,谈判中:0,已成交:0,暂缓:0};
  var grades={A:0,B:0,C:0};
  S.clients.forEach(function(c){
    if(c.grade==='A')gA++;if(c.status==='已成交')closed++;
    sources[c.source]=(sources[c.source]||0)+1;
    if(statuses[c.status]!==undefined)statuses[c.status]++;
    if(grades[c.grade]!==undefined)grades[c.grade]++;
  });
  propOnly.forEach(function(p){if(p.status==='在售'||p.status==='待售')onSale++});
  var curUid=S.currentUser?S.currentUser.id:null;
  /* 看板成交统计：管理员看全部；非管理员只看自己录入的成交（createdBy 即归属人） */
  var visibleTx=isAdmin()?S.transactions:S.transactions.filter(function(t){return t.createdBy===curUid});
  var totalT=S.transactions.length,totalVol=0,totalComm=0;
  visibleTx.forEach(function(t){totalVol+=t.transactionPrice||0;totalComm+=t.commission||0});
  /* 渠道ROI：按客户来源统计成交数/成交额/佣金 */
  var srcDeals={},srcRevenue={},srcComm={};
  visibleTx.forEach(function(t){
    var client=null;
    if(t.clientId)client=findClient(t.clientId);
    if(!client&&t.clientName)client=S.clients.find(function(c){return c.name===t.clientName});
    var src=client?(client.source||'未知'):'未知';
    srcDeals[src]=(srcDeals[src]||0)+1;
    srcRevenue[src]=(srcRevenue[src]||0)+(t.transactionPrice||0);
    srcComm[src]=(srcComm[src]||0)+(t.commission||0);
  });
  var txByType={newdev:0,secondhand:0,other:0};
  visibleTx.forEach(function(t){if(txByType[t.dealType]!==undefined)txByType[t.dealType]++});
  var funnelMax=Math.max(statuses['待联系'],statuses['已联系'],statuses['看房中'],statuses['谈判中'],statuses['已成交'],1);
  var funnelColors={'待联系':'#94a3b8','已联系':'#3b82f6','看房中':'#f59e0b','谈判中':'#7c3aed','已成交':'#16a34a'};
  var funnelHtml=Object.keys(funnelColors).map(function(s){
    var w=Math.max(35,Math.round(statuses[s]/funnelMax*100));
    return'<div class="funnel-step" style="width:'+w+'%;background:'+funnelColors[s]+'"><span>'+s+'</span><span class="f-num">'+statuses[s]+'</span></div>';
  }).join('');
  var srcArr=Object.keys(sources).map(function(k){return{k:k,v:sources[k]}}).sort(function(a,b){return b.v-a.v});
  var srcMax=Math.max.apply(null,srcArr.map(function(x){return x.v}).concat([1]));
  var srcColors=['#2563eb','#7c3aed','#0d9488','#f59e0b','#16a34a','#dc2626','#64748b'];
  var srcHtml=srcArr.map(function(x,i){
    var pct=Math.round(x.v/srcMax*100);
    var deals=srcDeals[x.k]||0;
    var revenue=srcRevenue[x.k]||0;
    var comm=srcComm[x.k]||0;
    var convRate=x.v>0?Math.round(deals/x.v*100):0;
    var roiHtml=deals>0
      ?'<span class="roi-deals">'+deals+'单</span><span class="roi-conv">转化'+convRate+'%</span><span class="roi-rev">'+revenue+'万</span><span class="roi-comm">'+comm+'元</span>'
      :'<span class="roi-none">暂无成交</span>';
    return'<div class="bar-row bar-row-roi"><div class="bar-row-main"><span class="bar-label">'+esc(x.k)+'</span><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:'+(srcColors[i%srcColors.length])+'">'+x.v+'</div></div></div><div class="bar-roi">'+roiHtml+'</div></div>';
  }).join('');
  var gradeMax=Math.max(grades.A,grades.B,grades.C,1);
  var gradeHtml=['A','B','C'].map(function(g){
    var pct=Math.round(grades[g]/gradeMax*100);
    var c=g==='A'?'#dc2626':g==='B'?'#f59e0b':'#2563eb';
    return'<div class="bar-row"><span class="bar-label">'+g+'级</span><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:'+c+'">'+grades[g]+'</div></div></div>';
  }).join('');
  // Recent activity
  var activities=[];
  // 跟进和带看不再显示在最新活动（用户另有用途）
  // S.clients.forEach(function(c){...followUps...viewings...});
  if(isAdmin()){S.transactions.forEach(function(t){activities.push({time:t.createdAt||t.transactionDate,text:'[成交] '+t.clientName+' · '+t.propertyTitle+' · '+(t.transactionPrice||0)+'万'})});}
  activities.sort(function(a,b){return b.time-a.time});
  var actHtml=activities.slice(0,10).map(function(a){return'<div class="activity-item"><span class="a-time">'+fmtDate(a.time)+'</span><span class="a-text">'+esc(a.text)+'</span></div>'}).join('')||'<div class="timeline-empty">暂无活动</div>';
  // Smart reminders (生日 / 关键节点 / 置换周期 / 跟进到期)
  var remIcon={birthday:'🎂',node:'📅',replace:'🔄',followup:'⏰'};
  var allRemHtml=(S.allReminders&&S.allReminders.length)?S.allReminders.map(function(r){
    var nav=r.clientId?'data-dash-client="'+r.clientId+'"':(r.txId?'data-dash-tx="'+r.txId+'"':'');
    return'<div class="activity-item" style="cursor:pointer" '+nav+'><span class="a-time" style="color:var(--danger)">'+remIcon[r.type]+' '+esc(r.title)+'</span><span class="a-text">'+esc(r.sub)+'</span></div>';
  }).join(''):'<div class="timeline-empty">暂无提醒（生日/关键节点/置换周期）</div>';
  // Today tasks (clients needing follow-up)
  var todayTasks=S.clients.filter(function(c){return needFollowup(c)}).sort(function(a,b){
    var la=lastFollowup(a)||a.updatedAt||0;var lb=lastFollowup(b)||b.updatedAt||0;return la-lb;
  });
  var todayHtml=todayTasks.slice(0,8).map(function(c){
    var lf=lastFollowup(c);var days=lf?daysSince(lf):999;
    return'<div class="today-task-item" data-dash-client="'+c.id+'"><span class="tt-name">'+esc(c.name)+'</span><span class="tt-info">'+esc(c.grade)+'级 · '+(lf?relDate(lf):'未跟进')+'</span><span class="tt-badge">需跟进</span></div>';
  }).join('')||'<div class="timeline-empty">暂无需要跟进的客户</div>';
  document.getElementById('dashboardContent').innerHTML=
    '<div class="dash-card"><h3>📊 数据概览</h3><div class="dash-stats"><div class="dash-stat"><div class="num" style="color:var(--primary)">'+totalC+'</div><div class="lbl">总客户</div></div><div class="dash-stat"><div class="num" style="color:var(--danger)">'+gA+'</div><div class="lbl">A级客户</div></div><div class="dash-stat"><div class="num" style="color:var(--success)">'+closed+'</div><div class="lbl">已成交</div></div><div class="dash-stat"><div class="num" style="color:var(--teal)">'+totalP+'</div><div class="lbl">总房源</div></div><div class="dash-stat"><div class="num" style="color:var(--purple)">'+(isAdmin()?totalT:'🔒')+'</div><div class="lbl">成交记录</div></div></div></div>'
    +'<div class="dash-card" id="dashTxStatCard"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3>💰 成交统计</h3><div style="display:flex;gap:6px">'+(isAdmin()?'<button class="btn btn-sm btn-outline" onclick="exportCurrentCSV(\x27transactions\x27)" style="font-size:.75rem" title="导出成交记录为CSV">📥 导出</button>':'')+'<button class="btn btn-sm btn-primary" id="dashAddTxBtn">'+(isAdmin()?'录入成交':'录入我的成交')+'</button></div></div><div class="dash-stats"><div class="dash-stat"><div class="num" style="color:var(--danger)">'+totalVol.toFixed(0)+'</div><div class="lbl">成交总额(万)</div></div><div class="dash-stat"><div class="num" style="color:var(--warning)">'+totalComm.toFixed(0)+'</div><div class="lbl">佣金收入(元)</div></div><div class="dash-stat"><div class="num" style="color:var(--purple)">'+txByType.newdev+'</div><div class="lbl">新房成交</div></div><div class="dash-stat"><div class="num" style="color:var(--primary)">'+txByType.secondhand+'</div><div class="lbl">二手成交</div></div></div>'
    +(function(){
      var typeNames={newdev:'新房',secondhand:'二手房',other:'其他'};
      var txList=visibleTx.slice().sort(function(a,b){return(b.transactionDate||0)-(a.transactionDate||0)});
      if(txList.length===0)return'<div class="timeline-empty" style="margin-top:10px">'+(isAdmin()?'暂无成交记录':'暂无我的成交记录，点右上角「录入我的成交」添加')+'</div>';
      return'<div class="dash-tx-list" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px">'
        +txList.map(function(t){
          return'<div class="tx-card" data-dash-tx-id="'+t.id+'" style="cursor:pointer;padding:10px;border:1px solid var(--gray-200);border-radius:8px;background:#fff;transition:.15s"'
            +' onmouseover="this.style.borderColor=\'var(--primary)\'" onmouseout="this.style.borderColor=\'var(--gray-200)\'">'
            +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'
            +'<div><div style="font-weight:600;font-size:.9rem;color:var(--text-primary)">'+esc(t.clientName)+' <span class="deal-type-badge" data-type="'+esc(t.dealType)+'">'+esc(typeNames[t.dealType]||'其他')+'</span></div>'
            +'<div style="font-size:.8125rem;color:var(--text-secondary);margin-top:2px">'+esc(t.propertyTitle||'—')+'</div></div>'
            +'<div style="text-align:right;white-space:nowrap"><div style="font-size:1.05rem;font-weight:700;color:var(--danger)">'+(t.transactionPrice?t.transactionPrice+'<span style="font-size:.75rem;color:var(--text-muted);font-weight:400">万</span>':'')+'</div>'
            +'<div style="font-size:.75rem;color:var(--text-tertiary);margin-top:2px">📅 '+fmtDate(t.transactionDate)+'</div></div></div>'
            +(t.commission?'<div style="font-size:.78rem;color:var(--warning);margin-top:4px">💰 佣金 '+t.commission+'元</div>':'')
            +'</div>';
        }).join('')+'</div>';
    })()+'</div>'
    +'<div class="dash-card"><h3>📋 今日待办（需跟进客户）</h3>'+todayHtml+'</div>'
    +'<div class="dash-card"><h3>🔥 客户成交漏斗</h3><div class="funnel">'+funnelHtml+'</div></div>'
    +'<div class="dash-card"><h3>📥 客户来源 &amp; 渠道ROI</h3><div class="bar-chart bar-chart-roi">'+srcHtml+'</div><div class="roi-legend"><span class="roi-leg-item"><span class="roi-leg-dot" style="background:#16a34a"></span>成交单数</span><span class="roi-leg-item">转化率 = 成交/线索</span><span class="roi-leg-item">成交额(万)</span><span class="roi-leg-item">佣金(元)</span></div></div>'
    +'<div class="dash-card"><h3>⭐ 客户等级分布</h3><div class="bar-chart">'+gradeHtml+'</div></div>'
    +'<div class="dash-card"><h3>📊 房源类型分布</h3>'+(function(){
      var types={secondhand:0,rental:0,newdev:0,md:0};
      (S.properties||[]).forEach(function(p){if(types[p.type]!==undefined)types[p.type]++});
      var data=[{label:'二手房',value:types.secondhand},{label:'租赁',value:types.rental},{label:'新楼盘',value:types.newdev},{label:'业主名单',value:types.md}].filter(function(d){return d.value>0});
      if(data.length===0)return'<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:.8125rem">暂无房源数据</div>';
      return _pieChart(data,['#2563eb','#16a34a','#7c3aed','#d97706']);
    })()+'</div>'
    +'<div class="dash-card"><h3>📍 房源区域分布</h3>'+(function(){
      var dist={};AREAS.forEach(function(a){dist[a]=0});
      (S.properties||[]).forEach(function(p){if(p.district&&dist[p.district]!==undefined)dist[p.district]++});
      var arr=AREAS.map(function(a){return{label:a,value:dist[a]}}).filter(function(d){return d.value>0}).sort(function(a,b){return b.value-a.value});
      if(arr.length===0)return'<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:.8125rem">暂无区域数据</div>';
      var maxv=Math.max.apply(null,arr.map(function(x){return x.value}));
      var cls=['#2563eb','#7c3aed','#0d9488','#f59e0b','#16a34a','#dc2626','#64748b','#0891b2','#d97706','#4f46e5'];
      return'<div class="bar-chart">'+arr.map(function(x,i){
        var pct=Math.round(x.value/maxv*100);
        return'<div class="bar-row"><span class="bar-label" style="font-size:.75rem">'+esc(x.label)+'</span><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:'+(cls[i%cls.length])+'">'+x.value+' 套</div></div></div>';
      }).join('')+'</div>';
    })()+'</div>'
    +'<div class="dash-card"><h3>📈 成交月度趋势</h3>'+(function(){
      if(!S.transactions||S.transactions.length===0)return'<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:.8125rem">暂无成交记录</div>';
      var months={};var now=new Date();
      for(var i=5;i>=0;i--){var d=new Date(now.getFullYear(),now.getMonth()-i,1);var k=d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0');months[k]=0}
      var amt={};Object.keys(months).forEach(function(k){amt[k]=0});
      S.transactions.forEach(function(t){
        var d=new Date(t.transactionDate||t.createdAt||0);
        var k=d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0');
        if(months[k]!==undefined){months[k]++;amt[k]+=(t.transactionPrice||0)}
      });
      var arr=Object.keys(months).map(function(k){return{label:k.slice(5)+'月',count:months[k],amount:amt[k]}});
      var maxv=Math.max.apply(null,arr.map(function(x){return x.count}).concat([1]));
      return'<div style="margin-bottom:8px;font-size:.75rem;color:var(--text-muted)">最近6个月成交笔数</div>'+
        '<div class="bar-chart">'+arr.map(function(x,i){
          var pct=Math.round(x.count/maxv*100);
          var bar=Math.max(2,pct);
          return'<div class="bar-row"><span class="bar-label" style="font-size:.75rem">'+esc(x.label)+'</span><div class="bar-track"><div class="bar-fill" style="width:'+bar+'%;background:#2563eb">'+(x.count>0?x.count+' 单':'0')+'</div></div><span style="font-size:.7rem;color:var(--text-muted);width:60px;text-align:right">'+(x.amount>0?'¥'+x.amount+'万':'')+'</span></div>';
        }).join('')+'</div>';
    })()+'</div>'
    +'<div class="dash-card"><h3>🏠 房源统计</h3><div class="detail-grid">'+di('在售/待售',onSale)+di('二手房',S.properties.filter(function(p){return p.type==='secondhand'}).length)+di('新楼盘',S.properties.filter(function(p){return p.type==='newdev'}).length)+di('总房源',totalP)+'</div></div>'
    +'<div class="dash-card"><h3>🔔 智能提醒（生日/关键节点/置换周期）</h3>'+allRemHtml+'</div>'
    +'<div class="dash-card" id="dashMemoCard"><h3>📝 我的备忘</h3>'+(function(){
  var list=(S.memos||[]).sort(function(a,b){return(b.createdAt||0)-(a.createdAt||0)});
  if(list.length===0)return'<div class="memo-empty">暂无备忘录，点击右下角 ➕ 快速记录</div>';
  return list.map(function(m){
    return'<div class="memo-card"><button class="memo-card-del" onclick="deleteMemo(\''+m.id+'\')" title="删除">&times;</button><div class="memo-card-text">'+esc(m.text)+'</div><div class="memo-card-time">'+fmtDate(m.createdAt)+'</div></div>';
  }).join('');
})()+'</div>'
    +'<div class="dash-card"><h3>📝 最近活动</h3>'+actHtml+'</div>';
  /* 非管理员在看板成交统计中仅看到自己录入的成交（visibleTx 已按 createdBy 过滤），不再整体锁定 */
  // Click handlers for dashboard items
  document.querySelectorAll('[data-dash-client]').forEach(function(el){
    el.addEventListener('click',function(){
      var cid=el.getAttribute('data-dash-client');
      switchTab('clients');
      setTimeout(function(){showClientDetail(cid)},200);
    });
  });
  document.querySelectorAll('[data-dash-tx]').forEach(function(el){
    el.addEventListener('click',function(){showTxDetail(el.getAttribute('data-dash-tx'));});
  });
  document.querySelectorAll('[data-dash-tx-id]').forEach(function(el){
    el.addEventListener('click',function(){showTxDetail(el.getAttribute('data-dash-tx-id'));});
  });
  /* 看板成交统计：录入/编辑入口（管理员可录全部；成员录自己的） */
  var _atb=document.getElementById('dashAddTxBtn');
  if(_atb)_atb.addEventListener('click',function(){try{openTxForm()}catch(e){console.error('[dashAddTxBtn]',e);toast('打开成交录入失败','error')}});
}

/* ========== Reminders ========== */
function computeAllReminders(){
  var list=[];
  var today=new Date();today.setHours(0,0,0,0);
  function dUntil(ts){var d=new Date(ts);d.setHours(0,0,0,0);return Math.round((d-today)/86400000);}
  /* 生日（7天内） */
  S.clients.forEach(function(c){
    if(!c.birthday)return;
    var b=new Date(c.birthday);if(isNaN(b.getTime()))return;
    var y=today.getFullYear();
    var nx=new Date(y,b.getMonth(),b.getDate());
    if(nx<today)nx=new Date(y+1,b.getMonth(),b.getDate());
    var dl=Math.round((nx-today)/86400000);
    if(dl<=7)list.push({type:'birthday',clientId:c.id,clientName:c.name,daysLeft:dl,date:nx.getTime(),title:dl===0?'今天生日🎂':'还有'+dl+'天生日',sub:c.name+' · '+(c.grade||'')+'级'});
  });
  /* 交易关键节点（14天内） */
  if(isAdmin()){S.transactions.forEach(function(t){
    [['signDate','面签'],['transferDate','过户'],['deliveryDate','交房']].forEach(function(pr){
      var ts=t[pr[0]];if(!ts)return;
      var dl=dUntil(ts);
      if(dl>=0&&dl<=14)list.push({type:'node',txId:t.id,clientName:t.clientName,daysLeft:dl,date:ts,title:pr[1]+(dl===0?'（今天）':dl+'天后'),sub:(t.clientName||'')+' · '+(t.propertyTitle||'')});
    });
  });}
  /* 置换周期（已成交满3年） */
  S.clients.forEach(function(c){
    if(c.status!=='已成交')return;
    var txs=S.transactions.filter(function(t){return (t.clientId&&t.clientId===c.id)||(t.clientName&&t.clientName===c.name)});
    if(!txs.length)return;
    var latest=txs.map(function(t){return t.transactionDate||t.createdAt||0}).sort(function(a,b){return b-a})[0];
    if(!latest)return;
    var yrs=(today.getTime()-latest)/31536000000;
    if(yrs>=3)list.push({type:'replace',clientId:c.id,clientName:c.name,daysLeft:9999,yearsAgo:Math.floor(yrs),date:latest,title:'成交满'+Math.floor(yrs)+'年',sub:c.name+' · 可能进入置换/改善周期'});
  });
  /* 跟进到期 */
  S.clients.forEach(function(c){(c.followUps||[]).forEach(function(f){
    if(f.reminderDate){var rd=new Date(f.reminderDate);rd.setHours(0,0,0,0);if(rd<=today)list.push({type:'followup',clientId:c.id,clientName:c.name,daysLeft:0,date:rd.getTime(),title:'跟进提醒',sub:c.name+' · '+(f.content||'').slice(0,24)});}
  })});
  list.sort(function(a,b){return (a.daysLeft||9999)-(b.daysLeft||9999);});
  return list;
}
/* 智能提醒缓存：避免每次渲染看板/刷新标徽都重算一遍（客户/成交多时尤为耗时，是卡顿根因之一）。
   数据变更（saveC/P/T、云端同步）时置脏，下次读取才重算；铃铛标徽和看板共用同一份缓存。 */
var _remCache=null,_remDirty=true;
function getReminders(){
  if(!_remDirty && _remCache)return _remCache;
  _remCache=computeAllReminders();
  _remDirty=false;
  return _remCache;
}
function markRemindersDirty(){_remDirty=true;S.allReminders=null;}
function reminderEmoji(t){return ({birthday:'🎂',node:'📅',replace:'🔄',followup:'⏰'})[t]||'🔔';}
function checkReminders(){
  var list=getReminders();
  S.allReminders=list;
  S.dueReminders=list.filter(function(r){return r.type==='followup'});
  var count=list.length;
  ['reminderBadge','reminderBadgeMobile'].forEach(function(id){
    var el=document.getElementById(id);if(!el)return;
    if(count>0){el.textContent=count;el.style.cssText='display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;background:var(--danger);color:#fff;font-size:.6875rem;font-weight:700;border-radius:8px'}
    else el.style.display='none';
  });
  if(count>0&&'Notification' in window&&Notification.permission==='granted'){
    try{new Notification('掌房提醒',{body:'有 '+count+' 条提醒（生日/关键节点/置换周期）'})}catch(e){}
  }
}

/* ========== Export / Import ========== */
function exportJSON(){
  if(!isAdmin()){toast('仅管理员可执行此操作','error');return}
  var data=JSON.stringify({clients:S.clients,properties:S.properties,transactions:S.transactions,version:3},null,2);
  var blob=new Blob([data],{type:'application/json'});
  downloadBlob(blob,'掌房备份_'+fmtDate(now()).replace(/-/g,'')+'.json');
  toast('备份文件已导出','success');
}
function exportCSV(){
  if(!isAdmin()){toast('仅管理员可执行此操作','error');return}
  var headers=['姓名','电话','微信','性别','来源','等级','购房目的','物业类型','户型','预算下限','预算上限','目标区域','标签','状态','备注','录入时间','最后更新'];
  var rows=S.clients.map(function(c){
    return[c.name,(c.phones||[]).map(function(p){return p.number}).join('/'),c.wechat||'',c.gender||'',c.source||'',c.grade||'',c.purpose||'',c.propertyType||'',c.unitType||'',c.budgetMin||'',c.budgetMax||'',(c.targetAreas||[]).join('/'),(c.customTags||[]).join('/'),c.status||'',c.notes||'',c.createdAt?fmtDate(c.createdAt):'',c.updatedAt?fmtDate(c.updatedAt):''].map(function(v){v=String(v||'').replace(/"/g,'""');return'"'+v+'"'}).join(',');
  });
  var csv='\uFEFF'+headers.map(function(h){return'"'+h+'"'}).join(',')+'\n'+rows.join('\n');
  downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),'客户列表_'+fmtDate(now()).replace(/-/g,'')+'.csv');
  toast('Excel文件已导出','success');
}
function downloadBlob(blob,name){var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
function importJSON(file){
  if(!isAdmin()){toast('仅管理员可执行此操作','error');return}
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=JSON.parse(e.target.result);
      var clients=data.clients||data;var props=data.properties||[];var txs=data.transactions||[];
      if(!Array.isArray(clients))throw new Error('格式错误');
      confirmDialog('导入数据','将导入 '+clients.length+' 客户 + '+(props.length||0)+' 房源 + '+(txs.length||0)+' 成交记录。确认=合并，取消=不导入',function(){
        var existingIds=S.clients.map(function(c){return c.id});
        var added=0;
        clients.map(migrateClient).forEach(function(c){if(existingIds.indexOf(c.id)<0){S.clients.push(c);added++}});
        var existingPids=S.properties.map(function(p){return p.id});var addedP=0;
        props.forEach(function(p){if(existingPids.indexOf(p.id)<0){S.properties.push(p);addedP++}});
        var existingTids=S.transactions.map(function(t){return t.id});var addedT=0;
        txs.forEach(function(t){if(existingTids.indexOf(t.id)<0){S.transactions.push(t);addedT++}});
        saveC();saveP();saveT();renderClientList();renderPropertyList();renderTxList();
        toast('已合并导入 '+added+' 客户 + '+addedP+' 房源 + '+addedT+' 成交','success');
      });
    }catch(err){toast('文件格式错误，导入失败','error')}
  };
  reader.readAsText(file);
}
function clearAll(){
  if(!isAdmin()){toast('仅管理员可执行此操作','error');return}
  var total=S.clients.length+S.properties.length+S.transactions.length;
  if(total===0){toast('当前没有数据');return}
  confirmDialog('清空全部数据','将删除全部 '+total+' 条记录（客户+房源+成交+媒体），不可恢复！',function(){
    S.properties.forEach(function(p){MediaDB.removeAll(p.id)});
    S.clients=[];S.properties=[];S.transactions=[];S.memos=[];saveC();saveP();saveT();
    if(SYNC_ENABLED&&S.currentUser){
      fetch(API_BASE+'/api/sync',{method:'POST',headers:getAuthHeader(),body:JSON.stringify({clients:[],properties:[],transactions:[],deleted:{clients:S.clients.map(function(c){return c.id}),properties:S.properties.map(function(p){return p.id}),transactions:S.transactions.map(function(t){return t.id})}})}).catch(function(){});
    }
    renderClientList();renderPropertyList();renderTxList();closeModal('settingsModal');toast('全部数据已清空','success');
  });
}

/* ========== 操作日志展示 ========== */
function renderLogs(){
  var el=document.getElementById('logListBody');if(!el)return;
  var logs=S.logs||[];
  if(!logs.length){
    el.innerHTML='<p class="log-empty">暂无操作日志</p>';
    return;
  }
  var html='<table class="log-table"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>类型</th><th>对象</th></tr></thead><tbody>';
  logs.slice(0,100).forEach(function(l){
    var actLabel=actionLabel(l.action);
    var typeLabel=entityTypeLabel(l.entityType);
    var timeStr=fmtDateTime(l.timestamp);
    var actClass='log-action-'+l.action;
    html+='<tr><td class="log-time">'+esc(timeStr)+'</td><td>'+esc(l.userName)+'</td>'
      +'<td><span class="log-action '+actClass+'">'+esc(actLabel)+'</span></td>'
      +'<td class="log-entity">'+esc(typeLabel)+'</td><td>'+esc(l.entityName)+'</td></tr>';
  });
  html+='</tbody></table>';
  el.innerHTML=html;
}
function openLogsModal(){
  if(!isAdmin()){toast('仅管理员可查看操作日志','error');return}
  document.getElementById('logsModal').classList.add('show');
  renderLogs();
}

/* ========== 智能搜索路由 ========== */
function smartSearchRoute(q){
  q=(q||'').trim();
  if(!q){closeSearchSuggest();S.search='';if(S.tab==='clients')renderClientList();if(S.tab==='properties')renderPropertyList();if(S.tab==='transactions')renderTxList();return}
  var ql=q.toLowerCase();
  /* 在客户/房源/成交里都搜一遍 */
  var clientHits=S.clients.filter(function(c){
    var hay=((c.name||'')+' '+(c.phones||[]).join(' ')+' '+(c.tags||[]).join(' ')).toLowerCase();
    return hay.indexOf(ql)>=0;
  });
  var propHits=S.properties.filter(function(p){
    var hay=((p.title||'')+' '+(p.community||'')+' '+(p.developer||'')+' '+(p.building||'')+' '+(p.unit||'')+' '+(p.room||'')+' '+(p.ownerName||'')+' '+(p.ownerPhone||'')).toLowerCase();
    return hay.indexOf(ql)>=0;
  });
  var txHits=S.transactions.filter(function(t){
    var hay=((t.clientName||'')+' '+(t.propertyTitle||'')).toLowerCase();
    return hay.indexOf(ql)>=0;
  });
  var total=clientHits.length+propHits.length+txHits.length;
  if(total===0){
    closeSearchSuggest();
    /* 没命中时还是把搜索词填到S.search，方便用户清除 */
    S.search=q;
    if(S.tab==='clients')renderClientList();
    else if(S.tab==='properties')renderPropertyList();
    else if(S.tab==='transactions')renderTxList();
    toast('未找到匹配"'+q+'"的内容','info');
    return;
  }
  /* 单一类型有命中：自动跳转 */
  var nonEmpty=[clientHits.length,propHits.length,txHits.length].filter(function(n){return n>0}).length;
  if(nonEmpty===1){
    if(clientHits.length>0){S.tab='clients';S.search=q;switchTab('clients');closeSearchSuggest();toast('已跳到客户管理，共'+clientHits.length+'位匹配客户','success');return}
    if(propHits.length>0){
      /* 房源命中：智能判断subtab（小区名→community, 房号→secondhand, 楼盘名→newdev） */
      S.tab='properties';
      var communityHit=propHits.find(function(p){return(p.community||'').toLowerCase().indexOf(ql)>=0&&p.type!=='community'});
      var newdevHit=propHits.find(function(p){return p.type==='newdev'||(p.developer||'').toLowerCase().indexOf(ql)>=0});
      var roomHit=propHits.find(function(p){return(p.building||'').toLowerCase().indexOf(ql)>=0||(p.room||'').toLowerCase().indexOf(ql)>=0});
      if(newdevHit){S.subtab='newdev';S.propFilters={};S.search=q}
      else if(roomHit&&roomHit.type==='rental'){S.subtab='rental';S.propFilters={};S.search=q}
      else if(roomHit){S.subtab='secondhand';S.propFilters={};S.search=q}
      else if(communityHit){S.subtab='secondhand';S.propFilters={community:communityHit.community};S.search=''}
      else{S.subtab='secondhand';S.propFilters={};S.search=q}
      switchTab('properties');switchSubtab(S.subtab);
      closeSearchSuggest();
      toast('已跳到'+({secondhand:'二手房',rental:'租赁房',newdev:'新楼盘'}[S.subtab]||'房源')+'，共'+propHits.length+'套匹配','success');
      return;
    }
    if(txHits.length>0){S.tab='transactions';S.search=q;switchTab('transactions');closeSearchSuggest();toast('已跳到成交记录，共'+txHits.length+'条匹配','success');return}
  }
  /* 多类型都有命中：显示建议浮层 */
  showSearchSuggest(q,clientHits,propHits,txHits);
}

function showSearchSuggest(q,clientHits,propHits,txHits){
  closeSearchSuggest();
  var el=document.createElement('div');
  el.id='searchSuggestPanel';
  el.style.cssText='position:fixed;top:64px;left:24px;width:420px;max-height:60vh;background:#fff;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.18);z-index:2000;overflow:hidden;animation:fadeIn .15s ease';
  var html='<div style="padding:10px 14px;border-bottom:1px solid var(--border);background:var(--bg-secondary);font-size:.875rem;color:var(--text-secondary);display:flex;justify-content:space-between;align-items:center"><span>共 <b style="color:var(--primary)">'+(clientHits.length+propHits.length+txHits.length)+'</b> 条匹配 "<b>'+esc(q)+'</b>"</span><span style="cursor:pointer;color:var(--text-muted)" onclick="closeSearchSuggest()">✕</span></div>';
  html+='<div style="max-height:50vh;overflow-y:auto">';
  if(clientHits.length){
    html+='<div style="padding:6px 14px;background:var(--bg-secondary);font-size:.8125rem;color:var(--text-muted);font-weight:600">👤 客户 ('+clientHits.length+')</div>';
    clientHits.slice(0,5).forEach(function(c){
      html+='<div class="sg-item" data-type="client" data-id="'+c.id+'" style="padding:10px 14px;border-bottom:1px solid var(--border-light);cursor:pointer;display:flex;justify-content:space-between;align-items:center">'
        +'<div style="flex:1;min-width:0"><div style="font-size:.875rem;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(c.name||'未命名')+'</div>'
        +'<div style="font-size:.8125rem;color:var(--text-muted);margin-top:2px">'+(c.phones&&c.phones[0]?'📞 '+esc(c.phones[0]):'')+' · '+esc(c.grade||'')+' · '+esc(c.status||'')+'</div></div>'
        +'<span style="font-size:.8125rem;color:var(--primary)">查看 →</span></div>';
    });
  }
  if(propHits.length){
    html+='<div style="padding:6px 14px;background:var(--bg-secondary);font-size:.8125rem;color:var(--text-muted);font-weight:600">🏠 房源 ('+propHits.length+')</div>';
    propHits.slice(0,8).forEach(function(p){
      var typeLabel={secondhand:'二手',rental:'租赁',newdev:'新盘',community:'小区'}[p.type]||'';
      var title=p.title||p.community||p.developer||'未命名';
      html+='<div class="sg-item" data-type="prop" data-id="'+p.id+'" style="padding:10px 14px;border-bottom:1px solid var(--border-light);cursor:pointer;display:flex;justify-content:space-between;align-items:center">'
        +'<div style="flex:1;min-width:0"><div style="font-size:.875rem;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(title)+'</div>'
        +'<div style="font-size:.8125rem;color:var(--text-muted);margin-top:2px"><span style="display:inline-block;padding:1px 5px;background:var(--primary-light);color:var(--primary);border-radius:3px;font-size:.8125rem;margin-right:4px">'+typeLabel+'</span>'+esc(p.community||p.developer||'')+(p.building?(' · '+esc(p.building)):'')+(p.room?(' '+esc(p.room)):'')+'</div></div>'
        +'<span style="font-size:.8125rem;color:var(--primary)">查看 →</span></div>';
    });
  }
  if(txHits.length){
    html+='<div style="padding:6px 14px;background:var(--bg-secondary);font-size:.8125rem;color:var(--text-muted);font-weight:600">💰 成交 ('+txHits.length+')</div>';
    txHits.slice(0,5).forEach(function(t){
      html+='<div class="sg-item" data-type="tx" data-id="'+t.id+'" style="padding:10px 14px;border-bottom:1px solid var(--border-light);cursor:pointer;display:flex;justify-content:space-between;align-items:center">'
        +'<div style="flex:1;min-width:0"><div style="font-size:.875rem;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(t.clientName||'')+' · '+esc(t.propertyTitle||'')+'</div>'
        +'<div style="font-size:.8125rem;color:var(--text-muted);margin-top:2px">'+esc(t.transactionDate||'')+' · '+esc(t.transactionType||'')+' · '+esc(t.totalPrice||'')+'</div></div>'
        +'<span style="font-size:.8125rem;color:var(--primary)">查看 →</span></div>';
    });
  }
  html+='</div>';
  el.innerHTML=html;
  document.body.appendChild(el);
  /* 点击外部关闭 */
  setTimeout(function(){
    document.addEventListener('click',function _close(e){
      if(!el.contains(e.target)&&e.target.id!=='searchInput'&&e.target.id!=='searchInputMobile'){
        closeSearchSuggest();
        document.removeEventListener('click',_close);
      }
    });
  },50);
  /* 绑定建议项点击 */
  el.querySelectorAll('.sg-item').forEach(function(item){
    item.addEventListener('click',function(){
      var type=item.getAttribute('data-type');
      var id=item.getAttribute('data-id');
      closeSearchSuggest();
      if(type==='client'){S.tab='clients';S.search='';switchTab('clients');setTimeout(function(){showClientDetail(id)},100)}
      else if(type==='prop'){S.tab='properties';S.search='';switchTab('properties');setTimeout(function(){showPropertyDetail(id)},100)}
      else if(type==='tx'){S.tab='transactions';S.search='';switchTab('transactions');setTimeout(function(){showTxDetail(id)},100)}
    });
    item.addEventListener('mouseenter',function(){item.style.background='var(--bg-secondary)'});
    item.addEventListener('mouseleave',function(){item.style.background=''});
  });
}

function closeSearchSuggest(){
  var el=document.getElementById('searchSuggestPanel');
  if(el)el.remove();
}
/* 搜索建议面板 ✕ 用内联 onclick 调用，必须挂到 window（脚本整体在 IIFE 内，函数默认非全局），否则抛 ReferenceError 走"错误操作"路径 */
window.closeSearchSuggest=closeSearchSuggest;

function renderMobileSearchResults(q){
  var ql=(q||'').trim().toLowerCase();
  var c=document.getElementById('mobileSearchResults');
  if(!c)return;
  c.style.display='block';
  if(!ql){c.innerHTML='';return}
  var hits=[];
  S.clients.forEach(function(cl){
    var hay=((cl.name||'')+' '+(cl.phones||[]).join(' ')).toLowerCase();
    if(hay.indexOf(ql)>=0)hits.push({type:'client',icon:'',label:cl.name||'未命名',sub:(cl.phones&&cl.phones[0])||'',id:cl.id});
  });
  S.properties.forEach(function(p){
    var hay=((p.title||'')+' '+(p.community||'')+' '+(p.developer||'')+' '+(p.building||'')+' '+(p.room||'')).toLowerCase();
    if(hay.indexOf(ql)>=0)hits.push({type:'prop',icon:'',label:p.title||p.community||p.developer||'未命名',sub:({secondhand:'二手',rental:'租赁',newdev:'新盘'}[p.type]||'')+' · '+(p.community||p.developer||''),id:p.id});
  });
  if(hits.length===0){c.innerHTML='<div style="padding:40px 20px;text-align:center;color:var(--text-muted);font-size:.875rem">无匹配内容</div>';return}
  c.innerHTML=hits.slice(0,30).map(function(h){
    return'<div class="msr-item" data-type="'+h.type+'" data-id="'+h.id+'" style="padding:12px 16px;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:10px;cursor:pointer">'
      +'<span style="font-size:1.25rem">'+h.icon+'</span>'
      +'<div style="flex:1;min-width:0"><div style="font-size:.875rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(h.label)+'</div>'
      +'<div style="font-size:.8125rem;color:var(--text-muted)">'+esc(h.sub)+'</div></div>'
      +'<span style="color:var(--text-muted)">›</span></div>';
  }).join('');
  c.querySelectorAll('.msr-item').forEach(function(it){
    it.addEventListener('click',function(){
      var t=it.getAttribute('data-type');var id=it.getAttribute('data-id');
      document.getElementById('mobileSearchOverlay').style.display='none';
      document.getElementById('searchInputMobile').value='';
      var _msr1=document.getElementById('mobileSearchResults');if(_msr1){_msr1.style.display='none';_msr1.innerHTML='';}
      if(t==='client'){switchTab('clients');setTimeout(function(){showClientDetail(id)},100)}
      else if(t==='prop'){switchTab('properties');setTimeout(function(){showPropertyDetail(id)},100)}
    });
  });
}

/* ========== Event Handlers ========== */
function setupHandlers(){
  /* 安全绑定函数 — 元素不存在时跳过而非崩溃 */
  function sb(id,evt,fn){var el=document.getElementById(id);if(el)el.addEventListener(evt,fn);else console.warn('[setupHandlers] 元素不存在:',id)}
  try{
  sb('notifBtn','click',openNotifPanel);
  sb('notifBtnMobile','click',openNotifPanel);
  sb('notifMarkAll','click',markAllNotifRead);
  sb('notifMuteGlobal','change',function(e){toggleNotifMute('',e.target.checked)});
  sb('notifMuteClient','change',function(e){toggleNotifMute('client',e.target.checked)});
  sb('notifMuteProperty','change',function(e){toggleNotifMute('property',e.target.checked)});
  sb('notifMuteTransaction','change',function(e){toggleNotifMute('transaction',e.target.checked)});
  sb('notifMutePrice','change',function(e){toggleNotifMute('price',e.target.checked)});
  // Tabs - sidebar nav items
  document.querySelectorAll('.sidebar-nav-item').forEach(function(t){t.addEventListener('click',function(){
    var tab=t.getAttribute('data-tab');
    if(tab==='settings'){document.getElementById('settingsModal').classList.add('show')}
    else{switchTab(tab)}
  })});
  // Tabs - bottom nav items
  document.querySelectorAll('.bottom-nav-item').forEach(function(t){t.addEventListener('click',function(){
    var tab=t.getAttribute('data-tab');
    if(tab==='settings'){document.getElementById('settingsModal').classList.add('show')}
    else{switchTab(tab)}
  })});
  document.querySelectorAll('.subtab').forEach(function(t){t.addEventListener('click',function(){switchSubtab(t.getAttribute('data-subtab'))})});
  // Search - desktop (智能路由：自动识别客户名/电话/楼盘名/小区名/房号，跳转到对应tab)
  var st;document.getElementById('searchInput').addEventListener('input',function(){clearTimeout(st);var v=this.value;st=setTimeout(function(){smartSearchRoute(v)},250)});
  // Search - mobile
  var stm;var searchInputMobile=document.getElementById('searchInputMobile');
  if(searchInputMobile)searchInputMobile.addEventListener('input',function(){clearTimeout(stm);var v=this.value;stm=setTimeout(function(){smartSearchRoute(v);if(document.getElementById('mobileSearchOverlay').style.display==='flex')renderMobileSearchResults(v)},250)});
  // Mobile search toggle
  var mobileSearchBtn=document.getElementById('mobileSearchBtn');
  if(mobileSearchBtn)mobileSearchBtn.addEventListener('click',function(){document.getElementById('mobileSearchOverlay').style.display='flex';var _msr3=document.getElementById('mobileSearchResults');if(_msr3)_msr3.style.display='none';document.getElementById('searchInputMobile').focus()});
  var closeMobileSearch=document.getElementById('closeMobileSearch');
  if(closeMobileSearch)closeMobileSearch.addEventListener('click',function(){document.getElementById('mobileSearchOverlay').style.display='none';document.getElementById('searchInputMobile').value='';var _msr2=document.getElementById('mobileSearchResults');if(_msr2){_msr2.style.display='none';_msr2.innerHTML='';}S.search='';if(S.tab==='clients')renderClientList();if(S.tab==='properties')renderPropertyList();if(S.tab==='transactions')renderTxList()});
  // Filter toggle
  var fo=false;document.getElementById('filterToggle').addEventListener('click',function(){fo=!fo;this.classList.toggle('open',fo);document.getElementById('filterBody').classList.toggle('open',fo)});
  var pfo=false;document.getElementById('propFilterToggle').addEventListener('click',function(){pfo=!pfo;this.classList.toggle('open',pfo);document.getElementById('propFilterBody').classList.toggle('open',pfo)});
  // Client filters
  function bf(id,key){document.getElementById(id).addEventListener('change',function(){S.filters[key]=this.value;renderClientList()})}
  bf('fGrade','grade');bf('fStatus','status');bf('fPurpose','purpose');bf('fSource','source');bf('fArea','area');bf('fNeedFollow','needFollow');
  bf('fAreaSeg','areaSeg');bf('fSpecial','special');bf('fLayout','layout');
  document.getElementById('fBudgetMin').addEventListener('input',function(){S.filters.budgetMin=parseInt(this.value)||0;renderClientList()});
  document.getElementById('fBudgetMax').addEventListener('input',function(){S.filters.budgetMax=parseInt(this.value)||0;renderClientList()});
  document.getElementById('fTag').addEventListener('input',function(){S.filters.tag=this.value.trim();renderClientList()});
  document.getElementById('fQuickSearch').addEventListener('input',function(){S.filters.quick=this.value.trim();renderClientList()});
  document.getElementById('fCreator').addEventListener('change',function(){S.filters.creator=this.value;renderClientList()});
  document.getElementById('filterReset').addEventListener('click',function(){
    S.filters={};
    ['fGrade','fStatus','fPurpose','fSource','fArea','fNeedFollow','fBudgetMin','fBudgetMax','fTag','fAreaSeg','fSpecial','fLayout','fQuickSearch','fCreator'].forEach(function(id){
      var el=document.getElementById(id);if(el)el.value='';
    });
    renderClientList();
  });
  document.getElementById('sortSelect').addEventListener('change',function(){S.sort=this.value;renderClientList()});
  /* 批量选择 */
  document.getElementById('batchModeBtn').addEventListener('click',function(){toggleBatchMode()});
  document.getElementById('bbExit').addEventListener('click',function(){toggleBatchMode(false)});
  document.getElementById('bbClear').addEventListener('click',function(){S.batchSel=[];refreshBatchSelection()});
  document.getElementById('bbSelectAll').addEventListener('click',function(){
    S.batchSel=getFilteredClients().filter(function(c){return !c.invalid}).map(function(c){return c.id});
    refreshBatchSelection();
  });
  document.getElementById('bbCollab').addEventListener('click',openBatchCollab);
  document.getElementById('bbInvalid').addEventListener('click',doBatchInvalid);
  document.getElementById('bbStatus').addEventListener('click',doBatchStatus);
  document.getElementById('bbGrade').addEventListener('click',doBatchGrade);
  document.getElementById('bbExport').addEventListener('click',doBatchExport);
  var _bbDel=document.getElementById('bbDelete');if(_bbDel)_bbDel.addEventListener('click',doBatchDelete);
  document.getElementById('bcConfirm').addEventListener('click',doBatchCollab);
  // Property filters
  function bpf(id,key){document.getElementById(id).addEventListener('change',function(){S.propFilters[key]=this.value;renderPropertyList()})}
  bpf('pfFilterArea','area');
  /* 区域联动：更新板块下拉 */
  var pfFilterAreaEl=document.getElementById('pfFilterArea');
  if(pfFilterAreaEl)pfFilterAreaEl.addEventListener('change',function(){updateBlockOptions(S.subtab)});
  bpf('pfFilterAreaSeg','areaSeg');
  bpf('pfFilterUnitPrice','unitPrice');
  bpf('pfFilterTotalPrice','totalPrice');
  bpf('pfFilterDecoration','decoration');
  bpf('pfFilterSpecial','special');
  /* 板块/商圈筛选 */
  sb('pfFilterBlock','change',function(){S.propFilters.block=this.value;renderPropertyList()});
  /* 楼幢单元房间号筛选 */
  sb('pfFilterBuilding','input',function(){S.propFilters.building=this.value.trim();renderPropertyList()});
  sb('pfFilterUnit','input',function(){S.propFilters.unit=this.value.trim();renderPropertyList()});
  sb('pfFilterRoom','input',function(){S.propFilters.room=this.value.trim();renderPropertyList()});
  document.getElementById('pfFilterTag').addEventListener('input',function(){S.propFilters.tag=this.value.trim();renderPropertyList()});
  document.getElementById('pfFilterCommunity').addEventListener('input',function(){S.propFilters.community=this.value.trim();renderPropertyList()});
  document.getElementById('pfFilterMetro').addEventListener('input',function(){S.propFilters.metro=this.value.trim();renderPropertyList()});
  /* 表单中区域联动板块 */
  var pfDistrictEl=document.getElementById('pfDistrict');
  if(pfDistrictEl)pfDistrictEl.addEventListener('change',function(){updateFormBlockOptions(this.value,'')});
  document.getElementById('propFilterReset').addEventListener('click',function(){
    S.propFilters={};
    ['pfFilterArea','pfFilterAreaSeg','pfFilterUnitPrice','pfFilterTotalPrice','pfFilterDecoration','pfFilterTag','pfFilterSpecial','pfFilterCommunity','pfFilterMetro','pfFilterBlock','pfFilterBuilding','pfFilterUnit','pfFilterRoom'].forEach(function(id){
      var el=document.getElementById(id);if(el)el.value='';
    });
    updateBlockOptions(S.subtab);
    renderPropertyList();
  });
  document.getElementById('propSortSelect').addEventListener('change',function(){S.propSort=this.value;renderPropertyList()});
  // Add buttons
  document.getElementById('addClientBtn').addEventListener('click',function(){openClientForm()});
  document.getElementById('smartInputBtn').addEventListener('click',openSmartInput);
  /* view toggle */
  document.querySelectorAll('#viewToggle .vt-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      var view=btn.getAttribute('data-view');
      S.clientView=view;
      document.querySelectorAll('#viewToggle .vt-btn').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-view')===view)});
      renderClientList();
    });
  });
  document.getElementById('smartParseBtn').addEventListener('click',function(){
    var text=document.getElementById('smartInputArea').value.trim();
    if(!text){toast('请先粘贴客户数据','error');return}
    S.smartClients=parseSmartInput(text);
    if(S.smartClients.length===0){
      document.getElementById('smartParseHint').textContent='未识别到有效客户数据，请检查格式';
      document.getElementById('smartParseHint').style.color='var(--warning)';
      document.getElementById('smartPreviewWrap').style.display='none';
      document.getElementById('smartImportBtn').style.display='none';
      document.getElementById('smartReparseBtn').style.display='none';
      return;
    }
    /* v6.31 意图提示 */
    var _itc=detectSmartIntent(text);
    var _icHtml='';
    if(_itc){
      _icHtml='<div style="margin-top:6px;font-size:.75rem;color:var(--text-secondary);font-weight:400">🧠 内容意图：<b>'+intentLabel(_itc)+'</b>（把握度'+_itc.confidence+(_itc.hits.length?('，依据：'+esc(_itc.hits.join('/'))):'')+'）</div>';
      if(_itc.kind==='prop'&&_itc.scores.prop>_itc.scores.client+3){
        _icHtml+='<div style="margin-top:4px;color:var(--danger);font-weight:600;font-size:.8125rem">⚠️ 这段内容更像<b>房源信息</b>，建议改用「智能录入房源」</div>';
      }
    }
    document.getElementById('smartParseHint').innerHTML='已识别 <b>'+S.smartClients.length+'</b> 位客户，请检查后点击「全部录入」'+_icHtml;
    document.getElementById('smartParseHint').style.color='var(--success)';
    /* 关键修复：「全部录入」按钮移出预览区，直接挂在解析按钮行，永远可见 */
    document.getElementById('smartImportBtn').style.display='';
    document.getElementById('smartReparseBtn').style.display='';
    renderSmartPreview(S.smartClients);
  });
  document.getElementById('smartClearBtn').addEventListener('click',function(){
    document.getElementById('smartInputArea').value='';
    document.getElementById('smartPreviewWrap').style.display='none';
    document.getElementById('smartImportBtn').style.display='none';
    document.getElementById('smartReparseBtn').style.display='none';
    document.getElementById('smartParseHint').textContent='';
    S.smartClients=[];
  });
  document.getElementById('smartReparseBtn').addEventListener('click',function(){
    document.getElementById('smartParseBtn').click();
  });
  document.getElementById('smartImportBtn').addEventListener('click',batchImportClients);
  /* client file upload */
  document.getElementById('smartFileInput').addEventListener('change',function(e){
    Array.from(e.target.files).forEach(function(f){handleSmartFileUpload(f,'smartFileHint')});
    e.target.value='';
  });
  document.getElementById('addPropBtn').addEventListener('click',function(){
    if(S.subtab==='community'&&S.communityDetail){
      /* 在小区详情页，新增房源时预填小区名 */
      openPropertyForm();
      var cmInput=document.getElementById('pfCommunity');
      if(cmInput)cmInput.value=S.communityDetail;
    }else if(S.subtab==='community'){
      openCommunityForm('');
    }else if(S.subtab==='md'){
      openSmartPropInput('batch');   /* 房源MD：名单靠智能识别批量录入 */
    }else{
      openPropertyForm();
    }
  });
  document.getElementById('smartPropInputBtn').addEventListener('click',function(){
    if(S.subtab==='community'&&!S.communityDetail){openCommunitySmartInput()}else{openSmartPropInput()}
  });
  /* 房源批量模式按钮 */
  var pmb=document.getElementById('propBatchModeBtn');
  if(pmb)pmb.addEventListener('click',function(){togglePropBatchMode()});
  /* smart prop paste: capture images from clipboard */
  document.getElementById('smartPropArea').addEventListener('paste',function(e){
    var items=e.clipboardData.items;
    var hasImg=false;
    for(var i=0;i<items.length;i++){
      if(items[i].type.indexOf('image/')===0){
        hasImg=true;
        var file=items[i].getAsFile();
        compressImage(file,1200,0.7,function(dataUrl){
          addSmartImage(dataUrl,file.name||'screenshot.png','相册');
        });
      }
    }
    /* 如果没有图片文件，检查HTML中的img标签（公众号粘贴） */
    if(!hasImg){
      var html=e.clipboardData.getData('text/html');
      if(html){extractImagesFromHtml(html)}
    }
  });
  /* property view toggle */
  document.querySelectorAll('#propViewToggle .vt-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      var view=btn.getAttribute('data-prop-view');
      S.propViewMode=view;
      document.querySelectorAll('#propViewToggle .vt-btn').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-prop-view')===view)});
      renderPropertyList();
    });
  });
  /* property smart input */
  document.getElementById('smartPropParseBtn').addEventListener('click',function(){
    var text=document.getElementById('smartPropArea').value.trim();
    if(!text){toast('请先粘贴房源数据','error');return}
    S.smartProps=parseSmartProp(text);
    if(S.smartProps.length===0){
      document.getElementById('smartPropParseHint').textContent='未识别到有效房源数据，请检查格式';
      document.getElementById('smartPropParseHint').style.color='var(--warning)';
      document.getElementById('smartPropPreviewWrap').style.display='none';
      document.getElementById('smartPropImportBtn').style.display='none';
      document.getElementById('smartPropReparseBtn').style.display='none';
      return;
    }
    var _it=detectSmartIntent(text);
    /* 解析后统计字段特征，仅用作"上传内容是否和当前 tab 匹配"的提示，不会切换 type */
    var typeStats=window.autoDetectPropType(S.smartProps);
    var tabLabel=S.subtab==='newdev'?'新楼盘':(S.subtab==='secondhand'?'二手房':(S.subtab==='md'?'房源MD':''));
    var typeHint='（已锁定为'+tabLabel+'）';
    var warnHint='';
    if(typeStats.typeMismatch){
      warnHint='⚠️ 检测到 '+typeStats.mismatch+' 条数据含有'+(S.subtab==='newdev'?'二手':'新楼盘')+'特征字段，请确认是否上传到正确 tab（数据仍按'+tabLabel+'录入）';
    }
    /* v6.31 意图提示：贴错窗口时明确告警 */
    var intentHtml='';
    if(_it){
      intentHtml='<div style="margin-top:6px;font-size:.75rem;color:var(--text-secondary)">🧠 内容意图：<b>'+intentLabel(_it)+'</b>（把握度'+_it.confidence+(_it.hits.length?('，依据：'+esc(_it.hits.join('/'))):'')+'）</div>';
      if(_it.kind==='client'&&_it.scores.client>_it.scores.prop+3){
        intentHtml+='<div style="margin-top:4px;color:var(--danger);font-weight:600;font-size:.8125rem">⚠️ 这段内容更像<b>客户名单</b>，建议改用「智能录入客户」，否则会被当成房源存错地方</div>';
      }else if(_it.kind==='prop'&&_it.type==='rental'&&S.subtab!=='rental'){
        intentHtml+='<div style="margin-top:4px;color:var(--warning);font-weight:600;font-size:.8125rem">⚠️ 出现租金/押付等<b>租赁</b>特征，当前不在租赁 tab，请确认</div>';
      }
    }
    document.getElementById('smartPropParseHint').innerHTML='已识别 <b>'+S.smartProps.length+'</b> 套房源 '+typeHint+'，请检查后点击「全部录入」'+intentHtml+(warnHint?'<div style="margin-top:6px;color:var(--warning);font-weight:600">'+warnHint+'</div>':'');
    document.getElementById('smartPropParseHint').style.color='var(--success)';
    /* 关键修复：「全部录入」按钮移出预览区，直接挂在解析按钮行，永远可见 */
    document.getElementById('smartPropImportBtn').style.display='';
    document.getElementById('smartPropReparseBtn').style.display='';
    renderSmartPropPreview(S.smartProps);
  });
  document.getElementById('smartPropClearBtn').addEventListener('click',function(){
    document.getElementById('smartPropArea').value='';
    document.getElementById('smartPropPreviewWrap').style.display='none';
    document.getElementById('smartPropImportBtn').style.display='none';
    document.getElementById('smartPropReparseBtn').style.display='none';
    document.getElementById('smartPropParseHint').textContent='';
    document.getElementById('smartPropFileHint').textContent='支持 Excel/CSV 表格、文本文件、截图照片（可一次多选，逐张排队识别）';
    S.smartProps=[];
    S.smartImages=[];renderSmartImageGallery();
  });
  document.getElementById('smartPropReparseBtn').addEventListener('click',function(){
    document.getElementById('smartPropParseBtn').click();
  });
  document.getElementById('smartPropImportBtn').addEventListener('click',batchImportProps);
  document.getElementById('smartPropFileInput').addEventListener('change',function(e){
    var files=Array.from(e.target.files);
    files.forEach(function(f){handleSmartFileUpload(f,'smartPropFileHint')});
    e.target.value='';
  });
  /* FAB Speed Dial */
(function(){
  var dial=document.getElementById('fabDial');
  var fab=document.getElementById('fab');
  var menu=document.getElementById('fabMenu');
  if(!fab||!dial)return;
  fab.addEventListener('click',function(e){
    e.stopPropagation();
    dial.classList.toggle('open');
  });
  /* 新增按钮 */
  var addBtn=document.getElementById('fabAddBtn');
  if(addBtn)addBtn.addEventListener('click',function(e){
    e.stopPropagation();dial.classList.remove('open');
    if(S.tab==='clients')openClientForm();
    else if(S.tab==='properties')openPropertyForm();
    else if(S.tab==='transactions')openTxForm();
    else openClientForm();
  });
  /* 备忘按钮 */
  var memoBtn=document.getElementById('fabMemoBtn');
  if(memoBtn)memoBtn.addEventListener('click',function(e){
    e.stopPropagation();dial.classList.remove('open');openMemoModal();
  });
  /* 点击外部关闭 */
  document.addEventListener('click',function(e){
    if(!dial.contains(e.target))dial.classList.remove('open');
  });
})();
/* 房源对比：批量按钮委托（列表/表格/MD 多视图通用） */
document.addEventListener('click',function(e){
  var btn=e.target.closest('#propBatchCompare');
  if(!btn)return;
  var ids=(S.checkedPropIds||[]).filter(Boolean);
  if(ids.length<2){toast('请先勾选至少 2 套房源进行对比','error');return;}
  if(ids.length>4){toast('最多对比 4 套房源','error');return;}
  _renderPropCompare(ids);
  var m=document.getElementById('propCompareModal');if(m)m.classList.add('show');
});
window.toggleFabDial=function(){
  var d=document.getElementById('fabDial');
  if(d)d.classList.toggle('open');
};
window.fabAddAction=function(){
  var d=document.getElementById('fabDial');if(d)d.classList.remove('open');
  if(typeof S!=='undefined'&&S.tab){
    if(S.tab==='clients')openClientForm();
    else if(S.tab==='properties')openPropertyForm();
    else if(S.tab==='transactions')openTxForm();
    else if(typeof openClientForm==='function')openClientForm();
  }
};
/* ========== 忘记密码 ========== */
window.showForgotPwModal=function(){
  var m=document.getElementById('forgotPwModal');
  if(m){document.getElementById('fpUsername').value='';document.getElementById('fpPhone').value='';document.getElementById('fpNewPassword').value='';var e=document.getElementById('fpError');if(e)e.textContent='';m.classList.add('show')}
};
window.submitForgotPw=function(){
  var un=(document.getElementById('fpUsername')||{}).value.trim();
  var ph=(document.getElementById('fpPhone')||{}).value.trim();
  var npw=(document.getElementById('fpNewPassword')||{}).value;
  var errEl=document.getElementById('fpError');
  if(errEl)errEl.textContent='';
  if(!un){if(errEl)errEl.textContent='请输入用户名';return}
  if(!ph){if(errEl)errEl.textContent='请输入手机号';return}
  if(!npw||npw.length<4){if(errEl)errEl.textContent='新密码至少4位';return}
  var btn=document.getElementById('fpSubmitBtn');if(btn){btn.disabled=true;btn.textContent='提交中…'}
  fetch(API_BASE+'/api/auth/forgot-password',{method:'POST',headers:getAuthHeader(),body:JSON.stringify({username:un,phone:ph,newPassword:npw})})
  .then(function(r){return r.json()})
  .then(function(d){
    if(btn){btn.disabled=false;btn.textContent='确认重置'}
    if(d&&d.ok){toast('密码已重置，请用新密码登录','success');closeModal('forgotPwModal')}
    else{if(errEl)errEl.textContent=(d&&d.error)||'重置失败，请检查用户名和手机号'}
  })
  .catch(function(){if(btn){btn.disabled=false;btn.textContent='确认重置'}if(errEl)errEl.textContent='网络错误，请重试'});
};

/* ========== 修改账号 ========== */
window.showChangeUsernameModal=function(){
  var m=document.getElementById('changeUsernameModal');
  if(m){document.getElementById('cuPassword').value='';document.getElementById('cuNewUsername').value='';var e=document.getElementById('cuError');if(e)e.textContent='';m.classList.add('show')}
};
window.submitChangeUsername=function(){
  var pw=(document.getElementById('cuPassword')||{}).value;
  var newUn=(document.getElementById('cuNewUsername')||{}).value.trim();
  var errEl=document.getElementById('cuError');
  if(errEl)errEl.textContent='';
  if(!pw){if(errEl)errEl.textContent='请输入当前密码';return}
  if(!newUn){if(errEl)errEl.textContent='请输入新用户名';return}
  if(newUn.length<2){if(errEl)errEl.textContent='用户名至少2位';return}
  var btn=document.getElementById('cuSubmitBtn');if(btn){btn.disabled=true;btn.textContent='提交中…'}
  fetch(API_BASE+'/api/auth/change-username',{method:'PUT',headers:getAuthHeader(),body:JSON.stringify({password:pw,newUsername:newUn})})
  .then(function(r){return r.json()})
  .then(function(d){
    if(btn){btn.disabled=false;btn.textContent='确认修改'}
    if(d&&d.ok){
      toast('账号已修改','success');
      try{var u=JSON.parse(localStorage.getItem(SK_USER)||'{}');if(u){u.username=newUn;localStorage.setItem(SK_USER,JSON.stringify(u))}}catch(e){}
      closeModal('changeUsernameModal');
      refreshCurrentUserDisplay();
    }else{if(errEl)errEl.textContent=(d&&d.error)||'修改失败'}
  })
  .catch(function(){if(btn){btn.disabled=false;btn.textContent='确认修改'}if(errEl)errEl.textContent='网络错误'});
};
function refreshCurrentUserDisplay(){
  try{var u=JSON.parse(localStorage.getItem(SK_USER)||'{}');
  var el=document.querySelector('.current-user-name');if(el&&u.name)el.textContent=u.name;
  var el2=document.querySelector('.current-user-role');if(el2&&u.role)el2.textContent=u.role==='admin'?'管理员':u.role==='manager'?'店长':u.role==='broker'?'经纪人':'实习'}catch(e){}
}

window.fabMemoAction=function(){
  var d=document.getElementById('fabDial');if(d)d.classList.remove('open');
  if(typeof openMemoModal==='function')openMemoModal();
};
  // Save
  document.getElementById('saveClientBtn').addEventListener('click',saveClient);
  document.getElementById('savePropBtn').addEventListener('click',saveProperty);
  // v6.35 新增楼盘表单内嵌智能识别 — 全局函数（内联onclick调用）
  /* 文件上传和粘贴事件仍需addEventListener */
  (function(){
    var fileInput=document.getElementById('newdevSmartFileInput');
    if(fileInput){
      fileInput.addEventListener('change',function(e){
        var files=Array.from(e.target.files||[]);
        files.forEach(function(file){handleNewdevSmartFileUpload(file)});
        e.target.value='';
      });
    }
    var ta=document.getElementById('newdevSmartArea');
    if(ta){
      ta.addEventListener('paste',function(e){
        var items=e.clipboardData.items;
        for(var i=0;i<items.length;i++){
          if(items[i].type.indexOf('image/')===0){
            var file=items[i].getAsFile();
            handleNewdevSmartImageUpload(file);
          }
        }
      });
    }
  })();

  // Property form: type change & unit price calc
  document.getElementById('pfTotalPrice').addEventListener('input',calcUnitPrice);
  document.getElementById('pfArea').addEventListener('input',calcUnitPrice);
  /* 智能表单填充：小区名输入后自动计算同小区参考价 */
  document.getElementById('pfCommunity').addEventListener('blur',smartFillHints);
  document.getElementById('pfType').addEventListener('change',function(){setTimeout(smartFillHints,100)});
  // Area segment add (new楼盘样板房)
  document.getElementById('pfAddAreaSeg').addEventListener('click',function(){
    var v=document.getElementById('pfAreaSegInput').value.trim();
    if(v&&S.editAreaSegs.indexOf(v)<0){S.editAreaSegs.push(v);renderAreaSegments();document.getElementById('pfAreaSegInput').value=''}
  });
  document.getElementById('pfAreaSegInput').addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();var v=this.value.trim();if(v&&S.editAreaSegs.indexOf(v)<0){S.editAreaSegs.push(v);renderAreaSegments();this.value=''}}
  });
  // Add phone
  document.getElementById('cfAddPhone').addEventListener('click',function(){syncPhonesToState();S.editPhones.push({label:'手机',number:''});renderPhoneList()});
  // Client detail: edit & delete
  document.getElementById('editClientBtn').addEventListener('click',function(){var c=findClient(S.curClientId);if(!canEditClient(c)){toast('无修改权限，仅管理员或录入人可修改','error');return}closeModal('clientDetailModal');setTimeout(function(){openClientForm(S.curClientId)},200)});
  document.getElementById('deleteClientBtn').addEventListener('click',function(){
    var c=findClient(S.curClientId);if(!c)return;
    if(!canDeleteClient(c)){toast('删除权限仅限管理员','error');return}
    confirmDialog('删除客户','确定要删除「'+c.name+'」吗？此操作不可恢复。',function(){logAction('delete','client',c.id,c.name);S.clients=S.clients.filter(function(x){return x.id!==S.curClientId});markDeleted('clients',S.curClientId);saveC();closeModal('clientDetailModal');renderClientList();toast('客户已删除','success')});
  });
  document.getElementById('markClientInvalidBtn').addEventListener('click',function(){var c=findClient(S.curClientId);if(!c)return;markClientInvalid(c.id)});
  document.getElementById('restoreClientInvalidBtn').addEventListener('click',function(){var c=findClient(S.curClientId);if(!c)return;restoreClientInvalid(c.id)});
  // Property detail: edit & delete & share
  document.getElementById('editPropBtn').addEventListener('click',function(){var p=findProp(S.curPropId);if(!canEditProp(p)){toast('无修改权限，仅管理员或录入人可修改','error');return}closeModal('propDetailModal');setTimeout(function(){openPropertyForm(S.curPropId)},200)});
  document.getElementById('smartPropDetailBtn').addEventListener('click',function(){
    if(!canEditProp(findProp(S.curPropId))){toast('无修改权限，仅管理员或录入人可修改','error');return}
    closeModal('propDetailModal');
    setTimeout(function(){openSmartPropInput('single',S.curPropId)},200);
  });
  document.getElementById('deletePropBtn').addEventListener('click',function(){
    var p=findProp(S.curPropId);if(!p)return;
    if(!canDeleteProp(p)){toast('删除权限仅限管理员','error');return}
    confirmDialog('删除房源','确定要删除「'+p.title+'」吗？相关图片视频也会删除。',function(){logAction('delete','property',p.id,p.title||p.community);MediaDB.removeAll(S.curPropId);S.properties=S.properties.filter(function(x){return x.id!==S.curPropId});markDeleted('properties',S.curPropId);saveP();closeModal('propDetailModal');renderPropertyList();toast('房源已删除','success')});
  });
  document.getElementById('requestPropInvalidBtn').addEventListener('click',function(){var p=findProp(S.curPropId);if(!p)return;if(this.dataset.act==='restore'){restorePropInvalid(p.id)}else if(this.dataset.act==='req'){requestPropInvalid(p.id)}});
  document.getElementById('approvePropInvalidBtn').addEventListener('click',function(){var p=findProp(S.curPropId);if(!p)return;approvePropInvalid(p.id)});
  document.getElementById('rejectPropInvalidBtn').addEventListener('click',function(){var p=findProp(S.curPropId);if(!p)return;rejectPropInvalid(p.id)});
  document.getElementById('sharePropBtn').addEventListener('click',function(){copyPropertyInfo(S.curPropId)});
  document.getElementById('shareCardBtn').addEventListener('click',function(){showShareView(S.curPropId)});
  document.getElementById('copyShareBtn').addEventListener('click',function(){copyPropertyInfo(S.curPropId)});
  // 风险尽调清单弹窗
  document.getElementById('riskCheckResetBtn').addEventListener('click',function(){
    var p=findProp(S._curRiskPropId);if(!p)return;
    p.riskChecks={};saveP();showRiskChecklist(S._curRiskPropId);
    toast('已重置清单','success');
  });
  document.getElementById('riskCheckCopyBtn').addEventListener('click',function(){
    var txt=buildRiskCheckText();
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(function(){toast('清单已复制到剪贴板','success')},function(){fallbackCopy(txt)})}
    else fallbackCopy(txt);
  });
  // 购房方案书
  document.getElementById('genPlanBtn').addEventListener('click',function(){
    if(!S.curClientId){toast('请先打开客户详情','error');return;}
    closeModal('clientDetailModal');setTimeout(function(){generatePurchasePlan(S.curClientId)},200);
  });
  document.getElementById('planCopyBtn').addEventListener('click',function(){
    var txt=S._curPlanText||'';
    if(!txt){toast('方案书为空','error');return;}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(function(){toast('方案书已复制到剪贴板','success')},function(){fallbackCopy(txt)})}
    else fallbackCopy(txt);
  });
  // 选房报告
  document.getElementById('genSelReportBtn').addEventListener('click',function(){showSelectionReport(S.curClientId)});
  document.getElementById('selReportCopyBtn').addEventListener('click',function(){
    var r=S._curSelReport; if(!r){toast('报告为空','error');return;}
    var c=r.c, top=r.top;
    var L=[];
    L.push('【'+c.name+' 选房报告】');
    L.push('生成时间：'+fmtDateTime(now()));
    L.push('');
    L.push('选房需求：');
    if(c.purpose)L.push('· 购房目的：'+c.purpose);
    L.push('· 预算：'+(fmtBudget(c.budgetMin,c.budgetMax)||'—'));
    L.push('· 目标区域：'+((c.targetAreas&&c.targetAreas.length)?c.targetAreas.join('、'):'不限'));
    if(c.unitType&&c.unitType!=='不限')L.push('· 户型：'+c.unitType);
    if(c.mustHaves&&c.mustHaves.length)L.push('· 必须满足：'+c.mustHaves.join('、'));
    L.push('');
    L.push('推荐房源（按匹配度排序）：');
    if(top.length){
      top.forEach(function(m,i){
        var p=m.p;
        L.push((i+1)+'. '+_propTitle(p)+'  '+_propPriceText(p)+'  ['+m.reasons.join('，')+']');
      });
    }else{
      L.push('（暂无可匹配房源）');
    }
    var txt=L.join('\n');
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(function(){toast('选房报告已复制','success')},function(){fallbackCopy(txt)})}
    else fallbackCopy(txt);
  });
  // 交易进度透明共享
  document.getElementById('shareTxProgressBtn').addEventListener('click',function(){
    if(!S.curTxId){toast('请先打开成交详情','error');return;}
    closeModal('txDetailModal');setTimeout(function(){showTxProgressShare(S.curTxId)},200);
  });
  document.getElementById('copyTxProgressBtn').addEventListener('click',function(){
    var t=findTx(S._curTxShareId);if(!t){toast('数据缺失','error');return;}
    var txt=buildTxProgressText(t);
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(function(){toast('进度已复制，可粘贴到微信发给客户','success')},function(){fallbackCopy(txt)})}
    else fallbackCopy(txt);
  });
  // 成交后满意度 + 转介绍
  document.getElementById('txReferralBtn').addEventListener('click',function(){
    if(!S.curTxId){toast('请先打开成交详情','error');return;}
    closeModal('txDetailModal');setTimeout(function(){showTxReferral(S.curTxId)},200);
  });
  document.getElementById('copyReferralBtn').addEventListener('click',function(){
    var t=findTx(S._curTxReferralId);if(!t){toast('数据缺失','error');return;}
    if(!t.referralInvited){t.referralInvited=now();saveT();}
    var txt=buildReferralText(t);
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(function(){toast('转介绍话术已复制','success')},function(){fallbackCopy(txt)})}
    else fallbackCopy(txt);
  });
  // Settings
  var _sb=document.getElementById('settingsBtn');if(_sb)_sb.addEventListener('click',function(){document.getElementById('settingsModal').classList.add('show')});
  var sbm=document.getElementById('settingsBtnMobile');
  if(sbm)sbm.addEventListener('click',function(){document.getElementById('settingsModal').classList.add('show')});
  document.getElementById('exportJSON').addEventListener('click',exportJSON);
  document.getElementById('exportCSV').addEventListener('click',exportCSV);
  document.getElementById('clearAll').addEventListener('click',clearAll);
  var lhb=document.getElementById('logHistoryBtn');if(lhb)lhb.addEventListener('click',openLogsModal);
  document.getElementById('importJSON').addEventListener('click',function(){document.getElementById('importFile').click()});
  document.getElementById('importFile').addEventListener('change',function(e){if(e.target.files[0])importJSON(e.target.files[0]);e.target.value=''});
  // Close modals
  document.querySelectorAll('[data-close]').forEach(function(el){el.addEventListener('click',function(){closeModal(el.getAttribute('data-close'))})});
  document.querySelectorAll('.modal-overlay').forEach(function(ov){ov.addEventListener('click',function(e){if(e.target===ov)ov.classList.remove('show')})});
  // Lightbox
  document.getElementById('lbClose').addEventListener('click',function(){document.getElementById('lightbox').classList.remove('show')});
  document.getElementById('lbPrev').addEventListener('click',function(){S.mediaIdx=(S.mediaIdx-1+S.mediaList.length)%S.mediaList.length;renderLightbox()});
  document.getElementById('lbNext').addEventListener('click',function(){S.mediaIdx=(S.mediaIdx+1)%S.mediaList.length;renderLightbox()});
  document.getElementById('lightbox').addEventListener('click',function(e){if(e.target===this)this.classList.remove('show')});
  // Keyboard
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){document.querySelectorAll('.modal-overlay.show').forEach(function(m){m.classList.remove('show')});document.getElementById('lightbox').classList.remove('show');document.getElementById('confirmOverlay').classList.remove('show')}
    if(e.key==='ArrowLeft'&&document.getElementById('lightbox').classList.contains('show'))document.getElementById('lbPrev').click();
    if(e.key==='ArrowRight'&&document.getElementById('lightbox').classList.contains('show'))document.getElementById('lbNext').click();
  });
  // Transaction handlers
  var txfo=false;document.getElementById('txFilterToggle').addEventListener('click',function(){txfo=!txfo;this.classList.toggle('open',txfo);document.getElementById('txFilterBody').classList.toggle('open',txfo)});
  function btxf(id,key,type){var el=document.getElementById(id);el.addEventListener(type||'change',function(){
    if(key==='dateFrom'||key==='dateTo'){S.txFilters[key]=this.value?new Date(this.value).getTime():0}
    else if(key==='min'||key==='max'){S.txFilters[key]=parseFloat(this.value)||0}
    else{S.txFilters[key]=this.value.trim()}
    renderTxList()})}
  btxf('txfType','type');btxf('txfDateFrom','dateFrom');btxf('txfDateTo','dateTo');btxf('txFilterClient','client','input');btxf('txfMin','min','input');btxf('txfMax','max','input');
  document.getElementById('txFilterReset').addEventListener('click',function(){S.txFilters={};['txfType','txfDateFrom','txfDateTo','txFilterClient','txfMin','txfMax'].forEach(function(id){document.getElementById(id).value=''});renderTxList()});
  document.getElementById('txSortSelect').addEventListener('change',function(){S.txSort=this.value;renderTxList()});
  document.getElementById('addTxBtn').addEventListener('click',function(){openTxForm()});
  document.getElementById('saveTxBtn').addEventListener('click',saveTx);
  document.getElementById('editTxBtn').addEventListener('click',function(){closeModal('txDetailModal');setTimeout(function(){openTxForm(S.curTxId)},200)});
  document.getElementById('deleteTxBtn').addEventListener('click',function(){
    var t=findTx(S.curTxId);if(!t)return;
    confirmDialog('删除成交记录','确定要删除「'+t.clientName+'」的成交记录吗？此操作不可恢复。',function(){
      logAction('delete','transaction',t.id,t.clientName+' · '+t.propertyTitle);
      S.transactions=S.transactions.filter(function(x){return x.id!==S.curTxId});markDeleted('transactions',S.curTxId);saveT();
      closeModal('txDetailModal');renderTxList();toast('成交记录已删除','success');
    });
  });
  // Login/Auth
  document.getElementById('lockUnlockBtn').addEventListener('click',tryAuth);
  document.getElementById('lockPassword').addEventListener('keydown',function(e){if(e.key==='Enter')tryAuth()});
  var lockUsernameEl=document.getElementById('lockUsername');
  if(lockUsernameEl)lockUsernameEl.addEventListener('keydown',function(e){if(e.key==='Enter')document.getElementById('lockPassword').focus()});
  // User management
  var userMgmtBtn=document.getElementById('userMgmtBtn');
  if(userMgmtBtn)userMgmtBtn.addEventListener('click',function(){
    if(!isAdmin()){toast('仅管理员可管理用户','error');return}
    renderUserList();
    document.getElementById('userMgmtModal').classList.add('show');
  });
  var addMemberBtn=document.getElementById('addMemberBtn');
  if(addMemberBtn)addMemberBtn.addEventListener('click',function(){
    var un=document.getElementById('newMemberUsername').value.trim();
    var pw=document.getElementById('newMemberPassword').value;
    var nm=document.getElementById('newMemberName').value.trim();
    var ph=document.getElementById('newMemberPhone').value.trim();
    if(!un||!pw){toast('请输入用户名和密码','error');return}
    if(pw.length<4){toast('密码至少4位','error');return}
    addUser(un,pw,nm||un,ph).then(function(d){
      if(d.ok){
        toast('成员已添加','success');
        document.getElementById('newMemberUsername').value='';
        document.getElementById('newMemberPassword').value='';
        document.getElementById('newMemberName').value='';
        document.getElementById('newMemberPhone').value='';
        renderUserList();
      }else{toast(d.error||'添加失败','error')}
    });
  });
  // Logout
  var logoutBtn=document.getElementById('logoutBtn');
  if(logoutBtn)logoutBtn.addEventListener('click',function(){
    confirmDialog('退出登录','确定要退出登录吗？','确定',function(){
      doLogout();
    });
  });
  // Creator filter (admin only)
  var creatorFilterEl=document.getElementById('creatorFilterSelect');
  if(creatorFilterEl)creatorFilterEl.addEventListener('change',function(){
    S.filterCreatedBy=this.value;
    renderClientList();
  });
  document.getElementById('lockPassword').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();if(document.getElementById('lockPwConfirmGroup').style.display!=='none'){document.getElementById('lockPasswordConfirm').focus()}else{tryAuth()}}});
  document.getElementById('lockPasswordConfirm').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();tryAuth()}});
  // Settings: password & user management
  var cpwBtn=document.getElementById('changePasswordBtn');
  if(cpwBtn)cpwBtn.addEventListener('click',function(){closeModal('settingsModal');document.getElementById('pwOld').value='';document.getElementById('pwNew').value='';document.getElementById('pwNewConfirm').value='';document.getElementById('pwChangeModal').classList.add('show')});
  var cuBtn=document.getElementById('changeUsernameBtn');
  if(cuBtn)cuBtn.addEventListener('click',function(){closeModal('settingsModal');showChangeUsernameModal()});
  /* userManageBtn handler 已在上方 userMgmtBtn 处注册，此处不再重复 */
  var savePwBtnEl=document.getElementById('savePwBtn');
  if(savePwBtnEl)savePwBtnEl.addEventListener('click',function(){
    var old=document.getElementById('pwOld').value;
    var npw=document.getElementById('pwNew').value;
    var cf=document.getElementById('pwNewConfirm').value;
    if(!old){toast('请输入当前密码','error');return}
    if(npw.length<4){toast('新密码至少4位','error');return}
    if(npw!==cf){toast('两次新密码不一致','error');return}
    savePwBtnEl.disabled=true;savePwBtnEl.textContent='修改中…';
    fetch(API_BASE+'/api/auth/change-password',{method:'PUT',headers:getAuthHeader(),body:JSON.stringify({oldPassword:old,newPassword:npw})})
    .then(function(r){return r.json()})
    .then(function(d){
      savePwBtnEl.disabled=false;savePwBtnEl.textContent='确认修改';
      if(d&&d.ok){closeModal('pwChangeModal');toast('密码已修改','success')}
      else{toast((d&&d.error)||'修改失败，请检查当前密码','error')}
    })
    .catch(function(){savePwBtnEl.disabled=false;savePwBtnEl.textContent='确认修改';toast('网络错误','error')});
  });
  /* Forgot password & change username bindings */
  var fpSubmitBtn=document.getElementById('fpSubmitBtn');
  if(fpSubmitBtn)fpSubmitBtn.addEventListener('click',submitForgotPw);
  var cuSubmitBtn=document.getElementById('cuSubmitBtn');
  if(cuSubmitBtn)cuSubmitBtn.addEventListener('click',submitChangeUsername);
  // Notification permission
  if('Notification' in window&&Notification.permission==='default'){setTimeout(function(){Notification.requestPermission()},3000)}
  }catch(err){console.error('[setupHandlers] 部分handler注册失败:',err)}
}

/* ========== Sample Data ========== */
function getSampleClients(){
  var t=Date.now();
  return[
    {id:uuid(),name:'王先生',phones:[{label:'手机',number:'13800138001'},{label:'家属',number:'13800138002'}],wechat:'wang_1380',gender:'男',source:'转介绍',grade:'A',purpose:'改善',propertyType:'住宅',unitType:'3室',budgetMin:300,budgetMax:500,targetAreas:['临平','余杭'],requirements:'需要车位,南北通透,孩子上学考虑学区',status:'看房中',notes:'老客户转介绍,决策快,注重性价比',customTags:['VIP','决策快'],followUps:[{id:uuid(),content:'电话沟通,预算300-500万,意向临平新城三房,周末看房',date:t-86400000*15},{id:uuid(),content:'带看临平新城2套,客户满意其中一套但觉得价格偏高',date:t-86400000*2,reminderDate:null}],viewings:[{id:uuid(),propertyId:'sample_p1',propertyTitle:'临平新城·精装三房',date:t-86400000*2,feedback:'客户满意但觉得价格偏高'}],referrals:[],createdAt:t-86400000*15,updatedAt:t-86400000*2},
    {id:uuid(),name:'李女士',phones:[{label:'手机',number:'13900139002'}],wechat:'',gender:'女',source:'线上咨询',grade:'B',purpose:'刚需',propertyType:'住宅',unitType:'2室',budgetMin:150,budgetMax:250,targetAreas:['临平'],requirements:'地铁沿线,电梯房',status:'已联系',notes:'首次置业,预算有限',customTags:['首套'],followUps:[{id:uuid(),content:'加了微信,发了几个临平老城房源,客户表示周末来看看',date:t-86400000*5,reminderDate:fmtDate(t+86400000*2)}],viewings:[],referrals:[],createdAt:t-86400000*7,updatedAt:t-86400000*5},
    {id:uuid(),name:'张总',phones:[{label:'手机',number:'13700137003'}],wechat:'zhang_invest',gender:'男',source:'老客户回访',grade:'A',purpose:'投资',propertyType:'公寓',unitType:'不限',budgetMin:200,budgetMax:400,targetAreas:['余杭','萧山'],requirements:'关注租金回报率,近地铁口',status:'谈判中',notes:'资深投资客,已成交过2套',customTags:['投资客','老客户'],followUps:[{id:uuid(),content:'推荐未来科技城公寓,客户认可,正在算回报率',date:t-86400000*10},{id:uuid(),content:'客户确认意向,正在谈价格,预计本周出结果',date:t-86400000*1,reminderDate:null}],viewings:[],referrals:[{id:uuid(),toClientId:null,toName:'赵女士',note:'同事'}],createdAt:t-86400000*30,updatedAt:t-86400000*1},
    {id:uuid(),name:'赵女士',phones:[{label:'手机',number:'13600136004'}],wechat:'',gender:'女',source:'贝壳平台',grade:'C',purpose:'学区',propertyType:'住宅',unitType:'3室',budgetMin:400,budgetMax:600,targetAreas:['西湖','拱墅'],requirements:'学区房,孩子2026年上学',status:'待联系',notes:'贝壳线上咨询来的',customTags:['学区'],followUps:[],viewings:[],referrals:[],createdAt:t-86400000*3,updatedAt:t-86400000*3},
    {id:uuid(),name:'陈先生',phones:[{label:'手机',number:'13500135005'}],wechat:'chen1350',gender:'男',source:'抖音/视频号',grade:'B',purpose:'改善',propertyType:'排屋',unitType:'4室+',budgetMin:600,budgetMax:1000,targetAreas:['临平','余杭','富阳'],requirements:'有院子,环境好,配套成熟',status:'已成交',notes:'看了我抖音视频联系来的,最终在临平山北买了排屋',customTags:['抖音来源','已成交'],followUps:[{id:uuid(),content:'初次联系,通过抖音了解到我,对临平排屋感兴趣',date:t-86400000*60},{id:uuid(),content:'带看3套排屋,客户对临平山北那套很满意',date:t-86400000*35},{id:uuid(),content:'成交！客户签了合同',date:t-86400000*20}],viewings:[],referrals:[],createdAt:t-86400000*60,updatedAt:t-86400000*20}
  ];
}
function getSampleProperties(){
  var t=Date.now();
  return[
    {id:'sample_p1',type:'secondhand',title:'临平新城·精装三房 诚心出售',community:'临平新城桂语兰庭',district:'临平',address:'临平街道星河南路',totalPrice:380,area:89,unitPrice:42696,layout:'3室2厅1卫',floor:'5',totalFloors:'18',orientation:'南北通透',decoration:'精装',buildingAge:'2018年',propertyRights:'商品房',hasKey:true,viewingMethod:'随时看房',school:'临平一小',metro:'地铁1号线临平站800米',description:'南北通透精装三房,采光好,拎包入住。业主诚心出售,价格可谈。',tags:['精装','南北通透','学区房','有钥匙'],status:'在售',linkedClientIds:[],createdAt:t-86400000*10,updatedAt:t-86400000*2},
    {id:uuid(),type:'secondhand',title:'余杭未来科技城·投资公寓',community:'未来科技城核心区',district:'余杭',address:'余杭街道文一西路',totalPrice:180,area:45,unitPrice:40000,layout:'1室1厅1卫',floor:'12',totalFloors:'25',orientation:'朝南',decoration:'精装',buildingAge:'2020年',propertyRights:'商品房',hasKey:false,viewingMethod:'提前预约',school:'',metro:'地铁5号线500米',description:'近地铁口,适合投资,租金回报率高。周边配套成熟,阿里巴巴西溪园区3公里。',tags:['投资','近地铁','精装'],status:'在售',linkedClientIds:[],createdAt:t-86400000*5,updatedAt:t-86400000*1},
    {id:uuid(),type:'newdev',title:'临平山北·翡翠湾（新盘）',developer:'万科',district:'临平',address:'临平山北麓,超山风景区旁',averagePrice:28000,propertyType:'住宅',openingDate:'2026-09',deliveryDate:'2028-12',availableLayouts:'89-140㎡',totalUnits:'800',greenRate:'35%',plotRatio:'2.0',salesOffice:'0571-88888888',description:'万科打造,临平山北稀缺新盘。背山面水,环境优美。主力户型89-140㎡,适合刚需改善。',tags:['品牌开发商','山景','新盘'],showroomAreas:['89㎡','110㎡','140㎡'],status:'待售',linkedClientIds:[],createdAt:t-86400000*8,updatedAt:t-86400000*3},
    {id:uuid(),type:'secondhand',title:'萧山·学区房三室 急售',community:'萧山北干名座',district:'萧山',address:'萧山区北干街道',totalPrice:420,area:105,unitPrice:40000,layout:'3室2厅2卫',floor:'8',totalFloors:'16',orientation:'东南',decoration:'简装',buildingAge:'2015年',propertyRights:'商品房',hasKey:true,viewingMethod:'随时看房',school:'萧山中学(重点)',metro:'地铁2号线1公里',description:'重点学区房,萧山中学学区。业主置换急售,价格可谈。简装可按自己喜好装修。',tags:['学区房','急售','有钥匙'],status:'在售',linkedClientIds:[],createdAt:t-86400000*12,updatedAt:t-86400000*4}
  ];
}
function getSampleTransactions(){
  var t=Date.now();
  return[
    {id:uuid(),clientId:null,clientName:'陈先生',propertyId:null,propertyTitle:'临平山北·排屋',dealType:'secondhand',transactionPrice:720,unitPrice:'24000',transactionDate:t-86400000*20,commission:18000,commissionRate:2.5,notes:'看抖音视频来的客户，成交临平山北排屋，客户非常满意',createdAt:t-86400000*20,updatedAt:t-86400000*20},
    {id:uuid(),clientId:null,clientName:'周女士',propertyId:null,propertyTitle:'余杭未来科技城·公寓',dealType:'newdev',transactionPrice:160,unitPrice:'35000',transactionDate:t-86400000*5,commission:8000,commissionRate:0.5,notes:'投资客，购入公寓一套，佣金由开发商支付',createdAt:t-86400000*5,updatedAt:t-86400000*5}
  ];
}

/* ========== Init ========== */
function initAfterLogin(){
  // 0) 独立登录路径可能未设置 currentUser，从本地恢复（确保角色/权限正确）
  if(!S.currentUser){try{var _su=localStorage.getItem(SK_USER);if(_su)S.currentUser=JSON.parse(_su);}catch(e){}}
  // 1) 立即用本地缓存渲染主界面（绝不等待网络/媒体库，避免白屏）
  loadC();loadP();loadT();loadMemos();loadMemos();
  try{ updateRoleUI(); }catch(e){ console.error('[updateRoleUI]',e); }
  try{ switchTab('dashboard'); }
  catch(e){ console.error('[switchTab]',e); showFatal('主界面渲染失败: '+((e&&e.message)||e)); }
  // 2) 后台静默从云端同步（失败/超时都不影响已渲染的界面）
  loadFromServer().then(function(serverData){
    if(serverData&&serverData.clients&&(serverData.clients.length>0||(serverData.properties&&serverData.properties.length>0))){
      S.clients=serverData.clients.map(migrateClient);
      S.properties=serverData.properties||[];
      S.transactions=serverData.transactions||[];
      saveC();saveP();saveT();
      if(serverData.allUsers)S.allUsers=serverData.allUsers;
      S.mdViewers=serverData.mdViewers||S.mdViewers;
      console.log('[初始化] 已从云端加载:',S.clients.length,'客户,',S.properties.length,'房源');
      // 用最新数据刷新当前视图
      try{ switchTab('dashboard'); }catch(e){}
    }else if(serverData&&serverData.clients&&serverData.clients.length===0&&serverData.properties&&serverData.properties.length===0){
      if(S.clients.length>0||S.properties.length>0||S.transactions.length>0){
        if(serverData.allUsers)S.allUsers=serverData.allUsers;
      S.mdViewers=serverData.mdViewers||S.mdViewers;
        setTimeout(function(){syncToServer();toast('已从本地恢复数据到云端','success')},1000);
      }
    }else{
      console.log('[初始化] 云端不可用，使用本地缓存');
    }
    if(serverData&&serverData.allUsers)S.allUsers=serverData.allUsers;
    updateNotifBadge();  }).catch(function(err){ console.error('[initAfterLogin] 云端同步失败，已使用本地数据',err); });
  // 3) 事件绑定（不阻塞渲染）
  try{ setupHandlers(); }catch(e){ console.error('[setupHandlers]',e); }
  try{
    checkReminders();
    setInterval(checkReminders,300000);
    updateNotifBadge();
    fetchNotifUnread();
    setInterval(fetchNotifUnread,30000);
    if(!S._pullStarted){S._pullStarted=true;setInterval(checkRev,5000);setInterval(periodicPull,120000);document.addEventListener("visibilitychange",function(){if(!document.hidden)checkRev()});}
  }catch(e){ console.error('[initAfterLogin] 后续初始化异常(已忽略)',e); }
  // 4) 媒体库后台初始化（不再阻塞主界面）
  MediaDB.init().catch(function(e){ console.error('[MediaDB]',e); });
}

function init(){
  if(window.__skipAutoInit)return; // 已由独立登录(__doLogin)初始化，避免重复渲染/闪退
  try{ populateSourceSelects(); }catch(e){ console.error('[init] populateSourceSelects',e); }
  var token=localStorage.getItem(SK_AUTH);
  if(!token){
    // 没有token：立即显示登录页（绝不等待媒体库，避免白屏）
    showLoginScreen();
    try{ setupHandlers(); }catch(e){ console.error('[setupHandlers]',e); }
    MediaDB.init().catch(function(e){ console.error('[MediaDB]',e); });
    return;
  }
  // 有token：先解析并立即用本地缓存渲染，网络/媒体库全部后台处理
  var parsed=null;
  try{
    var decoded=atob(token);
    var parts=decoded.split('|');
    parsed={userId:parts[1],exp:Number(parts[2])};
  }catch(e){ parsed=null; }
  loadC();loadP();loadT();loadMemos();loadMemos();
  var savedUser=localStorage.getItem(SK_USER);
  if(savedUser){try{S.currentUser=JSON.parse(savedUser)}catch(e){S.currentUser=null}}
  try{ updateRoleUI(); }catch(e){ console.error('[updateRoleUI]',e); }
  try{ switchTab('dashboard'); }
  catch(e){ console.error('[switchTab]',e); showFatal('主界面渲染失败: '+((e&&e.message)||e)); }
  try{ setupHandlers(); }catch(e){ console.error('[setupHandlers]',e); }
  try{
    checkReminders();
    setInterval(checkReminders,300000);
    updateNotifBadge();
    fetchNotifUnread();
    setInterval(fetchNotifUnread,30000);
    if(!S._pullStarted){S._pullStarted=true;setInterval(checkRev,5000);setInterval(periodicPull,120000);document.addEventListener("visibilitychange",function(){if(!document.hidden)checkRev()});}
  }catch(e){ console.error('[init] 后续初始化异常(已忽略)',e); }
  MediaDB.init().catch(function(e){ console.error('[MediaDB]',e); });
  // 后台验证token并从云端同步
  loadFromServer().then(function(serverData){
    if(serverData&&serverData.clients){
      S.clients=serverData.clients.map(migrateClient);
      S.properties=serverData.properties||[];
      S.transactions=serverData.transactions||[];
      saveC();saveP();saveT();
      if(serverData.allUsers){S.allUsers=serverData.allUsers;
      S.mdViewers=serverData.mdViewers||S.mdViewers;
        var um=(serverData.allUsers||[]).find(function(u){return u.id===(parsed&&parsed.userId)});
        if(um)S.currentUser=um;
      }
      try{ switchTab('dashboard'); }catch(e){}
    }else if(serverData===null){
      // 云端暂不可用/超时：已用本地缓存渲染主界面，切勿误踢回登录页
      // （旧版把 15MB 全量同步超时当成「未登录」，导致一打开就被弹回登录，必须避免）
      console.warn('[init] 云端同步暂不可用（超时或网络错误），已使用本地缓存');
    }
  }).catch(function(err){ console.error('[init] 云端同步失败，已用本地数据',err); });
}

/* --- 表格sticky高度：窗口缩放时重新计算 --- */
(function(){
  var _rTimer=null;
  function _recalcTableMaxH(id){
    var t=document.getElementById(id);
    if(!t||t.offsetParent===null)return; // 表格可见时才重算
    var wrap=t.querySelector('.client-table-wrap')||t.parentElement;
    if(!wrap)return;
    var vh=window.innerHeight||document.documentElement.clientHeight||600;
    var rect=wrap.getBoundingClientRect();
    var avail=Math.max(300,vh-rect.top-20);
    wrap.style.maxHeight=avail+'px';
  }
  window.addEventListener('resize',function(){
    clearTimeout(_rTimer);
    _rTimer=setTimeout(function(){
      _recalcTableMaxH('clientTable');
      _recalcTableMaxH('propertyTable');
    },150);
  });
})();

/* --- 角色UI更新 --- */
function updateRoleUI(){
  if(!S.currentUser)return;
  var isAdminRole=isAdmin();
  // 隐藏/显示成交记录tab
  document.querySelectorAll('[data-tab="transactions"]').forEach(function(el){
    el.style.display=isAdminRole?'':'none';
  });
  // 隐藏/显示录入人筛选（仅admin可见）
  var creatorFilter=document.getElementById('creatorFilter');
  if(creatorFilter)creatorFilter.style.display=isAdminRole?'':'none';
  // 填充录入人下拉
  if(isAdminRole){
    var sel=document.getElementById('creatorFilterSelect');
    if(sel){
      var currentVal=sel.value;
      var html='<option value="">全部</option><option value="__unassigned">未分配</option>';
      (S.allUsers||[]).forEach(function(u){
        html+='<option value="'+esc(u.id)+'">'+esc(u.name)+'</option>';
      });
      sel.innerHTML=html;
      sel.value=currentVal;
    }
  }
  // 更新用户名显示
  var userNameEls=document.querySelectorAll('.current-user-name');
  userNameEls.forEach(function(el){el.textContent=S.currentUser.name});
  var roleEls=document.querySelectorAll('.current-user-role');
  roleEls.forEach(function(el){el.textContent=isAdminRole?'管理员':'成员'});
  // 隐藏/显示用户管理入口（仅admin可见）
  var userMgmtEntry=document.getElementById('userMgmtBtn');
  if(userMgmtEntry)userMgmtEntry.style.display=isAdminRole?'':'none';
  // 设置弹窗标题：成员只有账号相关功能
  var smt=document.getElementById('settingsModalTitle');
  if(smt)smt.textContent=isAdminRole?'数据管理':'设置';
  // 隐藏/显示成交相关项
  document.querySelectorAll('.admin-only').forEach(function(el){
    el.style.display=isAdminRole?'':'none';
  });
  // 更新底部导航
  if(!isAdminRole){
    var txNavItems=document.querySelectorAll('.bottom-nav-item[data-tab="transactions"]');
    txNavItems.forEach(function(el){el.style.display='none'});
    var txSidebar=document.querySelectorAll('.sidebar-nav-item[data-tab="transactions"]');
    txSidebar.forEach(function(el){el.style.display='none'});
  }
}

function showFatal(msg){
  var b=document.getElementById('fatalBanner');
  if(!b){b=document.createElement('div');b.id='fatalBanner';b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;padding:10px 14px;font-size:.85rem;line-height:1.4';document.body.appendChild(b);}
  b.textContent='【系统错误】'+msg+'（请截图联系小巴）';
}
window.addEventListener('error',function(e){
  var m=(e.message||'未知错误')+(e.filename?(' @ '+e.filename+':'+e.lineno):'');
  try{fetch('/api/clientlog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({msg:m})})}catch(_){}
  showFatal(m);
});
window.addEventListener('unhandledrejection',function(e){
  try{fetch('/api/clientlog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({msg:'unhandledrejection: '+((e.reason&&e.reason.message)||e.reason||'')})})}catch(_){}
});
init();

/* v6.36 房号拆分 + 规整表格快速通道（定义在 IIFE 末尾，闭包捕获 isPropHeaderRow/mapPropHeaders/assignPropField/S） */
window.splitRoomField=function splitRoomField(val) {
  if (!val) return { building: '', unit: '', room: '' };
  var x = String(val).trim().replace(/[^0-9一-龥单元幢栋号楼座层室号\-\/－—]/g, '');
  if (!x) return { building: '', unit: '', room: '' };
  var m;
  m = x.match(/^(\d+)\s*[-\/－—]\s*(\d*)\s*单元\s*[-\/－—]\s*(\d+)$/);
  if (m) return { building: m[1], unit: (m[2] || '1') + '单元', room: m[3] };
  m = x.match(/^(\d+)\s*[-\/－—]\s*(\d+)\s*[-\/－—]\s*(\d+)$/);
  if (m) return { building: m[1], unit: m[2] + '单元', room: m[3] };
  m = x.match(/^(\d+)\s*[-\/－—]\s*(\d{2,5})$/);
  if (m) return { building: m[1], unit: '1单元', room: m[2] };
  m = x.match(/^(\d+)\s*[幢栋号楼座]\s*(\d+)$/);
  if (m) return { building: m[1], unit: '1单元', room: m[2] };
  return { building: '', unit: '', room: x.replace(/[^0-9a-zA-Z一-龥]/g, '') };
};
window.looksLikeRoomField=function looksLikeRoomField(s) {
  if (!s) return false;
  return /^\d+\s*[-\/－—]\s*\d{2,5}$/.test(s) || /^\d+\s*[-\/－—]\s*\d*\s*单元\s*[-\/－—]\s*\d+$/.test(s);
};

})();
