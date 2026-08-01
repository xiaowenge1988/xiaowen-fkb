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
var SK_C='xwg_fkb_clients_v6', SK_P='xwg_fkb_props_v6', SK_T='xwg_fkb_tx_v6', SK_AUTH='xwg_fkb_auth_v6', SK_USER='xwg_fkb_user_v6';

/* ========== State ========== */
var S={
  clients:[], properties:[], transactions:[], search:'', filters:{}, propFilters:{}, txFilters:{},
  sort:'updatedAt', propSort:'updatedAt', txSort:'transactionDate', tab:'clients', subtab:'secondhand',
  curClientId:null, curPropId:null, curTxId:null, editClientId:null, editPropId:null, editTxId:null,
  editTags:[], editPhones:[], editAreas:[], editPropTags:[], editAreaSegs:[],
  mediaList:[], mediaIdx:0, dueReminders:[], currentUser:null, allUsers:[], filterCreatedBy:'', smartClients:[], clientView:'card', pinnedIds:[], propViewMode:'card', smartProps:[], pinnedPropIds:[], smartImages:[]
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
function saveC(){localStorage.setItem(SK_C,JSON.stringify(S.clients));syncToServer()}
function loadP(){try{var r=localStorage.getItem(SK_P);if(r)S.properties=JSON.parse(r)}catch(e){S.properties=[]}}
function saveP(){localStorage.setItem(SK_P,JSON.stringify(S.properties));syncToServer()}
function loadT(){try{var r=localStorage.getItem(SK_T);if(r)S.transactions=JSON.parse(r)}catch(e){S.transactions=[]}}
function saveT(){localStorage.setItem(SK_T,JSON.stringify(S.transactions));syncToServer()}

/* --- 云端同步 --- */
function syncToServer(){
  if(!SYNC_ENABLED||!S.currentUser)return;
  clearTimeout(syncTimer);
  syncTimer=setTimeout(function(){
    var data={clients:S.clients,properties:S.properties,transactions:S.transactions};
    fetch(API_BASE+'/api/sync',{
      method:'POST',
      headers:getAuthHeader(),
      body:JSON.stringify(data)
    }).then(function(r){return r.json()}).then(function(d){
      if(d&&d.ok){console.log('[同步] 数据已同步到云端')}
      else if(d&&d.error){console.warn('[同步] 错误:',d.error);if(d.error==='未授权')doLogout()}
    }).catch(function(e){console.warn('[同步] 同步失败（离线模式可用）:',e.message)});
  },1500);
}

function loadFromServer(){
  var token=localStorage.getItem(SK_AUTH);
  if(!token)return Promise.resolve(null);
  return fetch(API_BASE+'/api/sync',{headers:getAuthHeader()}).then(function(r){
    if(!r.ok){if(r.status===401){doLogout();throw new Error('未授权')}throw new Error('HTTP '+r.status)}
    return r.json();
  }).then(function(d){
    if(d&&d.clients){
      if(d.allUsers)S.allUsers=d.allUsers;
      return d;
    }
    return null;
  }).catch(function(e){
    console.warn('[同步] 无法连接服务器:',e.message);
    return null;
  });
}

/* ========== Auth ========== */
function isLoggedIn(){return!!S.currentUser}
function isAdmin(){return S.currentUser&&S.currentUser.role==='admin'}

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
  S.currentUser=null;S.clients=[];S.properties=[];S.transactions=[];S.allUsers=[];
  showLoginScreen();
}

function showLoginScreen(){
  checkAuthStatus().then(function(needSetup){
    var ov=document.getElementById('lockOverlay');
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
    ov.style.display='flex';
    setTimeout(function(){if(lu)lu.focus();else document.getElementById('lockPassword').focus()},100);
  });
}

function hideLoginScreen(){document.getElementById('lockOverlay').style.display='none'}

function tryAuth(){
  var username=(document.getElementById('lockUsername')||{}).value||'admin';
  var pw=document.getElementById('lockPassword').value;
  var errEl=document.getElementById('lockError');
  if(!pw){errEl.textContent='请输入密码';return}
  if(!username){errEl.textContent='请输入用户名';return}

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
      listEl.innerHTML='<p style="text-align:center;padding:20px;color:var(--gray-400);font-size:.8125rem">暂无其他成员，在下方添加</p>';
      return;
    }
    listEl.innerHTML=users.filter(function(u){return u.role!=='admin'}).map(function(u){
      return'<div class="settings-item" style="cursor:default">'
        +'<div class="icon '+(u.active?'green':'gray')+'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>'
        +'<div class="text"><div class="title">'+esc(u.name)+' <span class="user-role-badge">'+(u.active?'活跃':'已停用')+'</span> <span style="font-size:.6875rem;color:var(--gray-400)">'+u.clientCount+'个客户</span></div>'
        +'<div class="desc">'+esc(u.username)+(u.phone?' · '+esc(u.phone):'')+'</div></div>'
        +'<div style="display:flex;gap:6px;flex-shrink:0">'
        +'<button class="btn btn-outline" style="padding:4px 10px;font-size:.75rem" onclick="toggleMemberStatus(\''+u.id+'\','+(u.active?'false':'true')+')">'+(u.active?'停用':'启用')+'</button>'
        +'<button class="btn btn-outline" style="padding:4px 10px;font-size:.75rem;color:var(--danger)" onclick="removeMember(\''+u.id+'\')">删除</button>'
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
function closeModal(id){document.getElementById(id).classList.remove('show')}

var toastTimer;
function toast(msg,type){var el=document.getElementById('toast');el.textContent=msg;el.className='toast show'+(type?' '+type:'');clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.className='toast'},2500)}

function confirmDialog(title,msg,cb){
  document.getElementById('confirmTitle').textContent=title;
  document.getElementById('confirmMsg').textContent=msg;
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
function switchTab(tab){
  S.tab=tab;
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
  if(fab)fab.style.display=(tab==='dashboard'||tab==='settings')?'none':'flex';
  if(tab==='clients')renderClientList();
  if(tab==='properties')renderPropertyList();
  if(tab==='transactions')renderTxList();
  if(tab==='dashboard')renderDashboard();
}
function switchSubtab(sub){
  try{
  S.subtab=sub;
  document.querySelectorAll('.subtab').forEach(function(el){el.classList.remove('active')});
  document.querySelector('[data-subtab="'+sub+'"]').classList.add('active');
  /* 新楼盘tab下，新增按钮文案改为"新增楼盘" */
  var addBtn=document.getElementById('addPropBtn');
  if(addBtn){
    if(sub==='newdev'){
      addBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增楼盘';
    }else if(sub==='rental'){
      addBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增出租房';
    }else if(sub==='community'){
      addBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增小区';
    }else{
      addBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增房源';
    }
  }
  /* 根据subtab显示/隐藏筛选项 */
  updateFilterVisibility(sub);
  /* 更新板块下拉选项 */
  updateBlockOptions(sub);
  /* 小区tab隐藏视图切换和筛选栏 */
  var propViewToggle=document.getElementById('propViewToggle');
  if(propViewToggle)propViewToggle.style.display=(sub==='community')?'none':'';
  var propFilterToggle=document.getElementById('propFilterToggle');
  if(propFilterToggle)propFilterToggle.style.display=(sub==='community')?'none':'';
  if(sub==='community'){
    renderCommunityList();
  }else{
    renderPropertyList();
  }
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
    statCard('success','已成交',closed,'已成交')+
    statCard('purple','B级客户',gB,'B');
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
  var sk=S.sort;
  list.sort(function(a,b){
    if(sk==='name')return(a.name||'').localeCompare(b.name||'');
    if(sk==='grade'){var o={'A':0,'B':1,'C':2};return(o[a.grade]||3)-(o[b.grade]||3)}
    if(sk==='lastFollowup'){return(lastFollowup(b)||0)-(lastFollowup(a)||0)}
    if(sk==='createdAt')return(b.createdAt||0)-(a.createdAt||0);
    return(b.updatedAt||0)-(a.updatedAt||0);
  });
  return list;
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
  document.getElementById('resultCount').innerHTML='共 <b>'+list.length+'</b> 位客户';
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
    return'<div class="client-card" data-grade="'+esc(c.grade)+'" data-id="'+c.id+'">'
      +(nf?'<div class="need-followup" title="需要跟进"></div>':'')
      +'<div class="client-card-top"><div><div class="client-name">'+esc(c.name)+' <span class="grade-badge" data-grade="'+esc(c.grade)+'">'+esc(c.grade)+'级</span></div>'
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
      +'<textarea id="qf-text-'+c.id+'" placeholder="输入本次跟进内容…" rows="2"></textarea>'
      +'<div class="quick-followup-bar">'
      +'<select id="qf-status-'+c.id+'"><option value="">不改状态</option><option>待联系</option><option>已联系</option><option>看房中</option><option>谈判中</option><option>已成交</option><option>暂缓</option></select>'
      +'<button class="btn btn-primary btn-sm" data-action="save-quick-followup" data-id="'+c.id+'">提交</button>'
      +'</div></div>'
      +'</div>';
  }).join('');
  // Card click
  grid.querySelectorAll('.client-card').forEach(function(card){
    card.addEventListener('click',function(e){if(e.target.closest('button')||e.target.closest('a')||e.target.closest('textarea')||e.target.closest('select'))return;showClientDetail(card.getAttribute('data-id'))});
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
        cl.followUps.push({id:uuid(),content:text,date:now(),reminderDate:null});
        if(newStatus&&newStatus!==cl.status){cl.status=newStatus}
        cl.updatedAt=now();saveC();renderClientList();toast('跟进已记录','success');
      }
    });
  });
}

function renderClientTable(){
  var list=getFilteredClients();
  var table=document.getElementById('clientTable');
  document.getElementById('resultCount').innerHTML='共 <b>'+list.length+'</b> 位客户';

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
    +'<th style="width:32px"></th>'
    +'<th>等级</th>'
    +'<th>客户</th>'
    +'<th>电话</th>'
    +'<th>来源</th>'
    +'<th>区域</th>'
    +'<th>预算</th>'
    +'<th>状态</th>'
    +'<th style="min-width:200px">需求 / 备注</th>'
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
    html+='<tr data-id="'+c.id+'" class="'+rowCls.join(' ')+'">'
      +'<td>'+(pinned?'<span title="重点关注" style="color:var(--warning)">⭐</span>':'<span style="color:var(--gray-300)">☆</span>')+'</td>'
      +'<td><span class="ct-grade-'+esc(c.grade)+'" title="'+esc(c.grade)+'级">'+esc(c.grade||'?')+'</span></td>'
      +'<td><span class="ct-name" title="'+esc(c.name||'')+'">'+esc(c.name||'未命名')+'</span>'
      +(c.customTags&&c.customTags.length?' <span style="font-size:.625rem;color:var(--danger)">🏷</span>':'')
      +(completed?' <span style="display:inline-block;padding:1px 4px;background:#dcfce7;color:#166534;font-size:.625rem;border-radius:3px;font-weight:600">已购</span>':'')
      +(inactive?' <span style="display:inline-block;padding:1px 4px;background:var(--gray-200);color:var(--text-muted);font-size:.625rem;border-radius:3px;font-weight:600">暂缓</span>':'')
      +(nf?' <span style="display:inline-block;padding:1px 4px;background:var(--danger-light);color:var(--danger);font-size:.625rem;border-radius:3px;font-weight:600">需跟进</span>':'')
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
      +'<td><span class="ct-requirements" title="'+esc(c.notes||c.requirements||'')+'">'+(c.notes||c.requirements?esc(c.notes||c.requirements):'<span style="color:var(--gray-400)">—</span>')+'</span></td>'
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
        if(!c.followUps)c.followUps=[];
        c.followUps.push({id:uuid(),content:'状态变更为「已成交」',date:now(),reminderDate:null});
      }else if(newStatus!==oldStatus){
        if(!c.followUps)c.followUps=[];
        c.followUps.push({id:uuid(),content:'状态变更为「'+newStatus+'」',date:now(),reminderDate:null});
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

  /* row click -> detail */
  table.querySelectorAll('tbody tr').forEach(function(row){
    row.addEventListener('click',function(e){
      if(e.target.closest('button')||e.target.closest('select')||e.target.closest('a'))return;
      showClientDetail(row.getAttribute('data-id'));
    });
  });
}

function quickFollowupPrompt(id){
  var c=findClient(id);if(!c)return;
  var content=prompt('记录本次跟进内容（'+c.name+'）：\n当前状态：'+c.status);
  if(!content||!content.trim())return;
  if(!c.followUps)c.followUps=[];
  c.followUps.push({id:uuid(),content:content.trim(),date:now(),reminderDate:null});
  c.updatedAt=now();
  saveC();renderClientStats();
  if(S.clientView==='table')renderClientTable();
  else renderClientList();
  toast('跟进已记录','success');
}

/* ========== Client: Form ========== */
function openClientForm(id){
  S.editClientId=id||null;S.editTags=[];S.editPhones=[];S.editAreas=[];
  document.getElementById('clientFormTitle').textContent=id?'编辑客户':'新增客户';
  document.getElementById('cfId').value=id||'';
  var c=id?findClient(id):{};
  document.getElementById('cfName').value=c.name||'';
  document.getElementById('cfWechat').value=c.wechat||'';
  document.getElementById('cfGender').value=c.gender||'未知';
  document.getElementById('cfSource').value=c.source||'自来客';
  document.getElementById('cfGrade').value=c.grade||'B';
  document.getElementById('cfPurpose').value=c.purpose||'刚需';
  document.getElementById('cfPropertyType').value=c.propertyType||'住宅';
  document.getElementById('cfUnitType').value=c.unitType||'不限';
  document.getElementById('cfBudgetMin').value=c.budgetMin||'';
  document.getElementById('cfBudgetMax').value=c.budgetMax||'';
  document.getElementById('cfRequirements').value=c.requirements||'';
  document.getElementById('cfStatus').value=c.status||'待联系';
  document.getElementById('cfNotes').value=c.notes||'';
  S.editPhones=(c.phones||(c.phone?[{label:'手机',number:c.phone}]:[{label:'手机',number:''}])).map(function(p){return{label:p.label,number:p.number}});
  S.editTags=(c.customTags||[]).slice();
  S.editAreas=(c.targetAreas||[]).slice();
  renderPhoneList();renderTagChips();renderAreaCheckboxes();
  document.getElementById('clientFormModal').classList.add('show');
  var cfMb=document.querySelector('#clientFormModal .modal-body');if(cfMb)cfMb.scrollTop=0;
}
function renderPhoneList(){
  document.getElementById('cfPhoneList').innerHTML=S.editPhones.map(function(p,i){
    return'<div class="phone-row"><select class="phone-label"><option value="手机"'+(p.label==='手机'?' selected':'')+'>手机</option><option value="座机"'+(p.label==='座机'?' selected':'')+'>座机</option><option value="家属"'+(p.label==='家属'?' selected':'')+'>家属</option><option value="其他"'+(p.label==='其他'?' selected':'')+'>其他</option></select><input type="tel" class="phone-num" value="'+esc(p.number)+'" placeholder="电话号码" maxlength="11"><button type="button" class="del-phone" data-idx="'+i+'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  }).join('');
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
function saveClient(){
  var name=document.getElementById('cfName').value.trim();
  if(!name){toast('请输入客户姓名','error');return}
  syncPhonesToState();
  var phones=S.editPhones.filter(function(p){return p.number});
  if(phones.length===0){toast('请至少输入一个电话号码','error');return}
  if(phones[0].number.replace(/[^0-9]/g,'').length<5){toast('请输入有效的电话号码','error');return}
  var id=document.getElementById('cfId').value;var isEdit=!!id;var c=isEdit?findClient(id):{};
  c.name=name;c.phones=phones;c.wechat=document.getElementById('cfWechat').value.trim();
  c.gender=document.getElementById('cfGender').value;c.source=document.getElementById('cfSource').value;
  c.grade=document.getElementById('cfGrade').value;c.purpose=document.getElementById('cfPurpose').value;
  c.propertyType=document.getElementById('cfPropertyType').value;c.unitType=document.getElementById('cfUnitType').value;
  c.budgetMin=parseInt(document.getElementById('cfBudgetMin').value)||0;c.budgetMax=parseInt(document.getElementById('cfBudgetMax').value)||0;
  c.targetAreas=S.editAreas.slice();c.requirements=document.getElementById('cfRequirements').value.trim();
  c.status=document.getElementById('cfStatus').value;c.notes=document.getElementById('cfNotes').value.trim();
  c.customTags=S.editTags.slice();c.updatedAt=now();
  if(!isEdit){c.id=uuid();c.createdAt=now();c.followUps=[];c.viewings=[];c.referrals=[];c.createdBy=S.currentUser?S.currentUser.id:'';c.createdByName=S.currentUser?S.currentUser.name:'';S.clients.push(c)}
  else if(!c.createdBy&&S.currentUser){c.createdBy=S.currentUser.id;c.createdByName=S.currentUser.name}
  saveC();closeModal('clientFormModal');renderClientList();toast(isEdit?'客户信息已更新':'客户已添加','success');
}

/* ========== Client: Smart Input ========== */
var SOURCES=['自来客','转介绍','线上咨询','老客户回访','贝壳平台','抖音/视频号'];
var GRADES=['A','B','C'];
var STATUSES=['待联系','已联系','看房中','谈判中','已成交','暂缓'];

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
  var lines=text.trim().split(/\n/);
  var results=[];
  var headers=null;
  var hasData=false;

  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();
    if(!line)continue;
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

    /* check header row */
    if(i===0&&isHeaderRow(fields)){
      headers=mapHeaders(fields);
      continue;
    }

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

    /* fallback: extract phone from raw line if not found */
    if(client.phones.length===0){
      var pm=line.match(/1[3-9]\d{9}/);
      if(pm)client.phones.push({label:'手机',number:pm[0]});
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

  return results;
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
  if(val.indexOf('线上')>=0||val.indexOf('网络')>=0||val.indexOf('咨询')>=0)return'线上咨询';
  if(val.indexOf('老')>=0&&val.indexOf('客')>=0)return'老客户回访';
  if(val.indexOf('贝壳')>=0||val.indexOf('链家')>=0)return'贝壳平台';
  if(val.indexOf('抖音')>=0||val.indexOf('视频')>=0)return'抖音/视频号';
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

    /* phone number */
    if(f.match(/1[3-9]\d{9}/)){
      var pm=f.match(/1[3-9]\d{9}/);
      if(pm&&!client.phones.some(function(p){return p.number===pm[0]})){
        client.phones.push({label:'手机',number:pm[0]});
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

  var imported=0,skipped=0;
  for(var i=0;i<clients.length;i++){
    var c=clients[i];
    if(!c.name||c.phones.length===0){skipped++;continue}

    /* dedup: check if phone already exists */
    var dup=false;
    for(var j=0;j<S.clients.length;j++){
      var existing=S.clients[j];
      if(existing.phones&&existing.phones.some(function(p){
        return c.phones.some(function(np){return p.number===np.number});
      })){dup=true;break}
    }
    if(dup){skipped++;continue}

    c.id=uuid();c.createdAt=now();c.updatedAt=now();
    c.followUps=[];c.viewings=[];c.referrals=[];
    c.createdBy=S.currentUser?S.currentUser.id:'';
    c.createdByName=S.currentUser?S.currentUser.name:'';
    S.clients.push(c);
    imported++;
  }

  saveC();renderClientList();closeModal('smartInputModal');
  toast('成功录入 '+imported+' 位客户'+(skipped>0?'，跳过 '+skipped+' 条（信息不全或重复）':''),'success');
}

/* ========== Smart Property Input ========== */
var DECORATIONS=['精装','简装','毛坯','豪装'];
var ORIENTATIONS=['南北通透','朝南','朝北','朝东','朝西','东南','西南'];
var PROP_STATUSES=['在售','已售','下架','待售','售罄'];

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
      if(p.averagePrice)lines.push('均价：'+p.averagePrice+'元/㎡');
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

function parseSmartProp(text){
  if(!text||!text.trim())return [];

  /* 1) 先检测是否是结构化表格（第一行是表头 + 后续有多行数据） */
  var rawLines=text.trim().split(/\n/);
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

  /* 3) 走按行循环解析（处理表格、键值对、纯文本） */
  var lines=rawLines;
  var results=[];
  var headers=null;
  var dataRowCount=0;
  var currentIsNewdev=(S&&S.subtab==='newdev')||false;

  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();
    if(!line)continue;

    /* Sheet 边界标记：每个 Sheet 独立解析表头，避免 Sheet1 表头被错用到 Sheet2 数据上 */
    if(line.indexOf('# sheet:')===0){
      headers=null;
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
    var lockedType=(currentTab==='newdev'||currentTab==='secondhand')?currentTab:'secondhand';
    var defaultType=lockedType;

    var prop={title:'',community:'',developer:'',district:'',address:'',totalPrice:0,area:0,layout:'',floor:'',totalFloors:'',orientation:'',decoration:'',buildingAge:'',propertyRights:'',hasKey:false,viewingMethod:'',school:'',metro:'',ownerName:'',ownerPhone:'',contactName:'',contactPhone:'',commission:'',propertyType:'',openingDate:'',deliveryDate:'',availableLayouts:'',totalUnits:'',greenRate:'',plotRatio:'',type:defaultType,status:defaultType==='newdev'?'在售':'在售',tags:[],description:'',averagePrice:0, _rawLine:line};

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

    /* fallback: extract phone from raw line if not found （新楼盘模式不提取业主电话，避免把业主电话误塞进开发商字段） */
    if(!prop.ownerPhone&&prop.type==='secondhand'){
      var pm=line.match(/1[3-9]\d{9}/);
      if(pm)prop.ownerPhone=pm[0];
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

    if(prop.title||prop.ownerPhone||prop.community){
      /* 检查与已有楼盘按 title 去重（忽略大小写、空格） */
      var normalizedTitle=(prop.title||'').replace(/\s+/g,'').toLowerCase();
      if(normalizedTitle){
        for(var ei=0;ei<S.properties.length;ei++){
          var ep=S.properties[ei];
          var en=(ep.title||'').replace(/\s+/g,'').toLowerCase();
          if(en&&en===normalizedTitle){
            prop._duplicate=true;
            prop._duplicateId=ep.id;
            break;
          }
        }
      }
      results.push(prop);
    }
  }

  return results;
}

/* ========== 智能录入字段相关性：解析完成后智能判断 type ========== */
/* 用户反馈"自动识别的内容需要和表头内容相关，不相关的就不要添加进去"。
   解析时已经在 assignPropField 里按 type 做了字段白名单过滤。
   此处再扫描一遍结果集，根据实际识别出的字段特征重新判断每条数据的真实 type，
   避免用户在二手tab上传了新楼盘表格、或反之时，type 被错定。 */
function autoDetectPropType(results){
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
    status:'在售',
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
  var kw=['小区','名称','标题','房源','面积','户型','总价','价格','均价','楼层','朝向','装修','区域','地址','业主','电话','手机','状态','备注','描述','建成','产权','钥匙','学区','地铁','标签','开发商',
    /* 新楼盘表格头 */
    '行政区','项目名称','项目标签','商圈','物业类型','物业费','在售面积','起步总价','基本卖点','优惠政策','地铁线路','预计交付时间','佣金情况','带看规则','剩余房源','保护期','按揭'];
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
    if(f.indexOf('项目名称')>=0||f.indexOf('小区')>=0||f.indexOf('标题')>=0||f.indexOf('房源名')>=0)m.push('title');
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
    else if(f.indexOf('业主')>=0&&f.indexOf('电话')<0&&f.indexOf('手机')<0)m.push('ownerName');
    else if((f.indexOf('业主')>=0||f.indexOf('联系')>=0)&&(f.indexOf('电话')>=0||f.indexOf('手机')>=0))m.push('ownerPhone');
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
  var NEWDEV_KEYS={title:1,district:1,developer:1,propertyType:1,availableLayouts:1,totalPrice:1,averagePrice:1,openingDate:1,deliveryDate:1,totalUnits:1,greenRate:1,plotRatio:1,contactName:1,contactPhone:1,commission:1,propertyFee:1,businessDistrict:1,projectTag:1,viewingRule:1,metro:1,highlights:1,preferential:1,remaining:1,protectionPeriod:1,decoration:1,address:1,community:1,description:1,tags:1,status:1,viewingMethod:1,school:1};
  var SECONDHAND_KEYS={title:1,area:1,layout:1,totalPrice:1,unitPrice:1,averagePrice:1,floor:1,totalFloors:1,orientation:1,decoration:1,district:1,address:1,community:1,ownerName:1,ownerPhone:1,contactName:1,contactPhone:1,commission:1,hasKey:1,viewingMethod:1,school:1,metro:1,buildingAge:1,propertyRights:1,status:1,description:1,tags:1};
  if(prop.type==='newdev'&&!NEWDEV_KEYS[key])return;          /* 新楼盘模式：拒绝二手专属字段 */
  if(prop.type==='secondhand'&&!SECONDHAND_KEYS[key])return;  /* 二手模式：拒绝新楼盘专属字段 */
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
      prop.community=val.replace(/[：:，,]/g,'');
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
      break;
    case'averagePrice':
      /* 均价兼容写法：
         "4.6万/平" -> 46000；"39500元/平" -> 39500；"45166元/㎡" -> 45166；纯数字 32000 -> 32000 */
      var apVal=val;
      if(/万/i.test(apVal)){
        var apM=apVal.match(/(\d+(?:\.\d+)?)/);
        if(apM){var ap=Math.round(parseFloat(apM[1])*10000);if(ap>0)prop.averagePrice=ap;}
      }else{
        var ap2=parseInt(apVal.replace(/[^0-9]/g,''),10);
        if(ap2>0)prop.averagePrice=ap2;
      }
      break;
    case'floor':
      var fm=val.match(/(\d+)\s*[\/／]?\s*(\d+)?/);
      if(fm){prop.floor=fm[1];if(fm[2])prop.totalFloors=fm[2]}
      else prop.floor=val;
      break;
    case'totalFloors':
      prop.totalFloors=val.replace(/[^0-9]/g,'');
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
      var pn=val.match(/1[3-9]\d{9}/);
      if(pn)prop.ownerPhone=pn[0];
      else if(val.replace(/[^0-9]/g,'').length>=5)prop.ownerPhone=val.replace(/[^0-9]/g,'');
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
      prop.buildingAge=val;
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
      for(var i=0;i<PROP_STATUSES.length;i++){
        if(val.indexOf(PROP_STATUSES[i])>=0){prop.status=PROP_STATUSES[i];break}
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
  }
}

function autoDetectPropFields(prop,fields,rawLine){
  /* 字段白名单：根据 prop.type 严格控制哪些字段可以填，与 assignPropField 保持一致 */
  var NEWDEV_KEYS={title:1,district:1,developer:1,propertyType:1,availableLayouts:1,totalPrice:1,averagePrice:1,openingDate:1,deliveryDate:1,totalUnits:1,greenRate:1,plotRatio:1,contactName:1,contactPhone:1,commission:1,propertyFee:1,businessDistrict:1,projectTag:1,viewingRule:1,metro:1,highlights:1,preferential:1,remaining:1,protectionPeriod:1,decoration:1,address:1,community:1,description:1,tags:1,status:1,viewingMethod:1,school:1};
  var SECONDHAND_KEYS={title:1,area:1,layout:1,totalPrice:1,unitPrice:1,averagePrice:1,floor:1,totalFloors:1,orientation:1,decoration:1,district:1,address:1,community:1,ownerName:1,ownerPhone:1,contactName:1,contactPhone:1,commission:1,hasKey:1,viewingMethod:1,school:1,metro:1,buildingAge:1,propertyRights:1,status:1,description:1,tags:1};
  var allowKey=function(k){
    if(prop.type==='newdev')return !!NEWDEV_KEYS[k];
    if(prop.type==='secondhand')return !!SECONDHAND_KEYS[k];
    return true;  /* type 未确定时全部允许，等 autoDetectPropType 之后做最终判断 */
  };

  for(var i=0;i<fields.length;i++){
    var f=fields[i].trim();
    if(!f)continue;

    /* phone number */
    if(f.match(/1[3-9]\d{9}/)){
      if(allowKey('ownerPhone')&&!prop.ownerPhone)prop.ownerPhone=f.match(/1[3-9]\d{9}/)[0];
      continue;
    }

    /* area: XX㎡ */
    if(f.match(/^\d+(\.\d+)?\s*㎡?$/)||f.match(/^\d+(\.\d+)?\s*平方?$/)){
      if(!allowKey('area'))continue;
      var ar=parseFloat(f.replace(/[^0-9.]/g,''));
      if(ar>0&&ar<10000){prop.area=ar;if(!prop.title&&prop.community)prop.title=prop.community+ar+'㎡';continue}
    }

    /* total price: XX万 or XXw */
    if(f.match(/^\d+(\.\d+)?\s*万?$/)||f.match(/^\d{2,4}w?$/i)){
      if(!allowKey('totalPrice'))continue;
      var tp=parseFloat(f.replace(/[^0-9.]/g,''));
      if(tp>0&&tp<100000){prop.totalPrice=tp;continue}
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
    if(f.match(/\d{4}\s*年?建?/)||f.indexOf('年代')>=0||f.indexOf('建成')>=0){
      if(!allowKey('buildingAge'))continue;
      prop.buildingAge=f;continue;
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
  var dupBadge=dupCount>0?'<span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:3px;font-size:.75rem;margin-left:8px">⚠️ '+dupCount+' 条与已存在楼盘重名，默认跳过</span>':'';
  var includeDupHtml=dupCount>0?'<label style="margin-left:12px;font-size:.75rem;cursor:pointer;display:flex;align-items:center;gap:4px"><input type="checkbox" id="smartIncludeDup"> 包含重复项</label>':'';
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

  for(var i=0;i<props.length;i++){
    var p=props[i];
    var hasTitle=!!p.title;
    var status=hasTitle?'<span class="spv-ok">✓</span>':'<span class="spv-warn">缺标题</span>';
    var dupTag=p._duplicate?'<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:.625rem;padding:1px 4px;border-radius:3px;margin-left:4px" title="已存在同名楼盘（ID: '+esc(p._duplicateId||'')+'）">⚠️ 重名</span>':'';
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
      '<td><select data-field="district"><option value="">选择</option>'+AREAS.map(function(a){return'<option'+(p.district===a?' selected':'')+'>'+a+'</option>'}).join('')+'</select></td>'+
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
  rows.forEach(function(row,rowIdx){
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
    if(!includeDup&&row.getAttribute('data-duplicate')==='1')return;

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
    out.ownerPhone=(phone.match(/1[3-9]\d{9}/)?phone.match(/1[3-9]\d{9}/)[0]:phone)||src.ownerPhone||'';
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
    var src=props[0]; /* 单楼盘模式只用第一条 */
    var updated=[];
    /* 只更新有值的字段，不覆盖空字段 */
    var fieldMap=[
      ['title','title'],['community','community'],['developer','developer'],
      ['district','district'],['address','address'],['averagePrice','averagePrice'],
      ['propertyType','propertyType'],['openingDate','openingDate'],['deliveryDate','deliveryDate'],
      ['availableLayouts','availableLayouts'],['totalUnits','totalUnits'],['greenRate','greenRate'],
      ['plotRatio','plotRatio'],['contactName','contactName'],['contactPhone','contactPhone'],
      ['commission','commission'],['school','school'],['metro','metro'],
      ['orientation','orientation'],['decoration','decoration'],['status','status']
    ];
    for(var i=0;i<fieldMap.length;i++){
      var k=fieldMap[i][0];
      if(src[k]!==undefined&&src[k]!==''&&src[k]!==0){
        target[k]=src[k];
        updated.push(k);
      }
    }
    /* description: 追加而不是覆盖 */
    if(src.description&&!target.description){
      target.description=src.description;
      updated.push('description');
    }
    /* tags: 合并去重 */
    if(src.tags&&src.tags.length){
      target.tags=target.tags||[];
      for(var t=0;t<src.tags.length;t++){
        if(target.tags.indexOf(src.tags[t])<0)target.tags.push(src.tags[t]);
      }
    }
    target.updatedAt=now();
    saveP();renderPropertyList();
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
      /* dedup: check if same title+phone already exists */
      var dup=false;
      for(var d=0;d<S.properties.length;d++){
        var e=S.properties[d];
        if(e.title===p.title&&p.ownerPhone&&e.ownerPhone===p.ownerPhone){dup=true;break}
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

  saveP();renderPropertyList();
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
  }else if(ext==='png'||ext==='jpg'||ext==='jpeg'){
    /* 图片：OCR文字识别 + 加入图片画廊（房源模式） */
    if(!isClient){
      compressImage(file,1200,0.7,function(dataUrl){
        addSmartImage(dataUrl,file.name,'相册');
      });
    }
    hintEl.textContent='首次加载OCR引擎约需10-30秒，请稍候...';hintEl.style.color='var(--warning)';
    loadTesseract().then(function(worker){
      hintEl.textContent='OCR引擎就绪，正在识别图片文字...';hintEl.style.color='var(--warning)';
      /* v5 API: 直接传File对象识别，不需要再传语言参数（创建worker时已设置） */
      worker.recognize(file).then(function(result){
        var text=(result&&result.data&&result.data.text)||'';
        text=text.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
        if(text){
          var ta=document.getElementById(textareaId);
          ta.value=(ta.value?ta.value+'\n':'')+text;
          hintEl.textContent='✅ 图片识别完成'+(!isClient?'，图片已加入画廊':'')+'（共'+text.length+'字），请点击「识别数据」';hintEl.style.color='var(--success)';
        }else{
          hintEl.textContent='⚠️ 图片识别完成但未提取到文字'+(!isClient?'，图片已加入画廊':'')+'，可手动输入或重新拍照';hintEl.style.color='var(--warning)';
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
function showClientDetail(id){
  var c=findClient(id);if(!c)return;S.curClientId=id;
  var lf=lastFollowup(c);var fups=(c.followUps||[]).slice().sort(function(a,b){return b.date-a.date});
  var mainPhone=(c.phones&&c.phones[0])?c.phones[0].number:'';
  var phonesHtml=(c.phones||[]).map(function(p){return'<div style="font-size:.75rem;color:var(--text-muted)">'+esc(p.label)+': <a href="tel:'+esc(p.number)+'" style="color:var(--primary)">'+esc(p.number)+'</a></div>'}).join('');
  var tagsHtml=(c.customTags||[]).map(function(t){return'<span class="client-tag custom">'+esc(t)+'</span>'}).join('');
  var tlHtml=fups.length?fups.map(function(f){
    var rd=daysSince(f.date);
    var relCls=rd===0?'rel-today':(rd<=3?'rel-recent':'');
    var reminderTag=f.reminderDate?'<span class="reminder-tag">提醒:'+fmtDate(f.reminderDate)+'</span>':'';
    return'<div class="timeline-item'+(f.reminderDate?' has-reminder':'')+'"><div class="timeline-date"><span class="'+relCls+'">'+relDate(f.date)+'</span> · '+fmtDateTime(f.date)+' '+reminderTag+'</div><div class="timeline-content">'+esc(f.content)+'</div></div>';
  }).join(''):'<div class="timeline-empty">暂无跟进记录</div>';
  var viewingsHtml=(c.viewings||[]).map(function(v){
    return'<div class="viewing-item"><div class="vi-top"><span class="vi-prop">'+esc(v.propertyTitle||'未知房源')+'</span><span class="vi-date">'+fmtDate(v.date)+'</span></div>'+(v.feedback?'<div class="vi-feedback">'+esc(v.feedback)+'</div>':'')+'</div>';
  }).join('')||'<div class="timeline-empty">暂无带看记录</div>';
  var referralsHtml=(c.referrals||[]).map(function(r){
    return'<div class="referral-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><span>'+esc(r.toName)+'</span>'+(r.note?'<span style="color:var(--text-muted);font-size:.75rem">'+esc(r.note)+'</span>':'')+'</div>';
  }).join('')||'<div class="timeline-empty">暂无转介绍关系</div>';
  var areaStr=(c.targetAreas&&c.targetAreas.length)?c.targetAreas.join('、'):'不限';
  var matchedProps=getMatchedProperties(id);
  var matchedHtml=matchedProps.slice(0,5).map(function(p){
    return'<div class="viewing-item" style="cursor:pointer" data-prop-id="'+p.id+'"><div class="vi-top"><span class="vi-prop">'+esc(p.title)+'</span><span class="vi-date">'+esc(p.totalPrice?p.totalPrice+'万':p.averagePrice+'元/㎡')+'</span></div><div class="vi-feedback">'+esc(p.district)+' · '+(p.type==='secondhand'?'二手房':'新楼盘')+'</div></div>';
  }).join('')||'<div class="timeline-empty">暂无匹配房源</div>';
  document.getElementById('clientDetailBody').innerHTML=
    '<div class="detail-header"><div class="detail-avatar">'+esc((c.name||'?').charAt(0))+'</div><div class="detail-info"><h2>'+esc(c.name)+'</div>'
    +'<div class="sub">'+phonesHtml+(c.wechat?'<div style="font-size:.75rem;color:var(--text-muted)">微信: '+esc(c.wechat)+'</div>':'')+'</div>'
    +'<div class="detail-badges"><span class="grade-badge" data-grade="'+esc(c.grade)+'">'+esc(c.grade)+'级</span><span class="status-badge" data-status="'+esc(c.status)+'">'+esc(c.status)+'</span><span class="status-badge" data-status="已联系">'+esc(c.source)+'</span></div></div></div>'
    +(tagsHtml?'<div class="detail-section"><h3>标签</h3><div class="client-tags">'+tagsHtml+'</div></div>':'')
    +'<div class="detail-section"><h3>基本信息</h3><div class="detail-grid">'+di('性别',c.gender)+di('来源',c.source)+di('等级',c.grade+'级')+di('录入时间',fmtDate(c.createdAt))+'</div></div>'
    +'<div class="detail-section"><h3>购房需求</h3><div class="detail-grid">'+di('购房目的',c.purpose)+di('物业类型',c.propertyType)+di('户型',c.unitType)+di('预算',fmtBudget(c.budgetMin,c.budgetMax))+di('目标区域',areaStr)+di('其他需求',c.requirements)+'</div></div>'
    +(c.notes?'<div class="detail-section"><h3>备注</h3><div class="timeline-content" style="background:var(--warning-light)">'+esc(c.notes)+'</div></div>':'')
    +'<div class="detail-section"><h3>跟进记录 <span class="count">('+(fups.length)+'条 · 最近 '+(lf?fmtDate(lf):'未跟进')+')</span></h3>'
    +'<div class="followup-input"><textarea id="followupText" placeholder="输入本次跟进内容…"></textarea>'
    +'<div class="followup-options"><label><input type="checkbox" id="setReminder"> 设置提醒</label><input type="date" id="reminderDate" style="display:none"></div>'
    +'<div class="actions"><button class="btn btn-primary btn-sm" id="addFollowupBtn">添加跟进</button></div></div>'
    +'<div class="timeline">'+tlHtml+'</div></div>'
    +'<div class="detail-section"><h3>带看记录 <span class="count">('+(c.viewings||[]).length+'条)</span></h3>'
    +'<div class="link-select"><select id="viewingPropSelect" style="flex:1;height:32px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);padding:0 8px;font-size:.75rem;background:#fff"><option value="">选择房源</option>'+S.properties.map(function(p){return'<option value="'+p.id+'">'+esc(p.title)+' ('+esc(p.district)+')</option>'}).join('')+'</select><input type="date" id="viewingDate" style="height:32px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);padding:0 6px;font-size:.75rem"></div>'
    +'<textarea id="viewingFeedback" placeholder="客户看房反馈" style="width:100%;margin-top:6px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);padding:8px;font-size:.8125rem;min-height:40px;resize:vertical"></textarea>'
    +'<div class="actions" style="margin-top:6px"><button class="btn btn-primary btn-sm" id="addViewingBtn">添加带看</button></div>'
    +'<div style="margin-top:8px">'+viewingsHtml+'</div></div>'
    +'<div class="detail-section"><h3>客户关系（转介绍）</h3>'
    +'<div class="link-select"><select id="referralSelect" style="flex:1;height:32px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);padding:0 8px;font-size:.75rem;background:#fff"><option value="">选择客户</option>'+S.clients.filter(function(x){return x.id!==id}).map(function(x){return'<option value="'+x.id+'">'+esc(x.name)+'</option>'}).join('')+'</select><input type="text" id="referralNote" placeholder="关系说明" style="flex:1;height:32px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);padding:0 8px;font-size:.75rem"></div>'
    +'<div class="actions" style="margin-top:6px"><button class="btn btn-primary btn-sm" id="addReferralBtn">添加关系</button></div>'
    +'<div style="margin-top:8px">'+referralsHtml+'</div></div>'
    +'<div class="detail-section"><h3>匹配房源推荐</h3><div>'+matchedHtml+'</div></div>';
  document.getElementById('clientDetailModal').classList.add('show');
  // Followup handler
  document.getElementById('setReminder').addEventListener('change',function(){
    var rd=document.getElementById('reminderDate');
    rd.style.display=this.checked?'':'none';
    if(this.checked&&!rd.value)rd.value=tomorrowStr();
  });
  document.getElementById('addFollowupBtn').addEventListener('click',function(){
    var text=document.getElementById('followupText').value.trim();
    if(!text){toast('请输入跟进内容','error');return}
    var reminder=null;
    if(document.getElementById('setReminder').checked){reminder=document.getElementById('reminderDate').value||null}
    if(!c.followUps)c.followUps=[];
    c.followUps.push({id:uuid(),content:text,date:now(),reminderDate:reminder});
    c.updatedAt=now();saveC();renderClientList();showClientDetail(id);toast('跟进记录已添加','success');
  });
  document.getElementById('addViewingBtn').addEventListener('click',function(){
    var pid=document.getElementById('viewingPropSelect').value;
    var date=document.getElementById('viewingDate').value;
    var fb=document.getElementById('viewingFeedback').value.trim();
    if(!pid){toast('请选择房源','error');return}
    if(!date){toast('请选择看房日期','error');return}
    var p=findProp(pid);if(!c.viewings)c.viewings=[];
    c.viewings.push({id:uuid(),propertyId:pid,propertyTitle:p?p.title:'未知房源',date:new Date(date).getTime(),feedback:fb});
    c.updatedAt=now();saveC();renderClientList();showClientDetail(id);toast('带看记录已添加','success');
  });
  document.getElementById('addReferralBtn').addEventListener('click',function(){
    var tid=document.getElementById('referralSelect').value;
    var note=document.getElementById('referralNote').value.trim();
    if(!tid){toast('请选择客户','error');return}
    var tc=findClient(tid);if(!c.referrals)c.referrals=[];
    c.referrals.push({id:uuid(),toClientId:tid,toName:tc?tc.name:'未知',note:note});
    saveC();showClientDetail(id);toast('关系已添加','success');
  });
  document.querySelectorAll('[data-prop-id]').forEach(function(el){
    el.addEventListener('click',function(){closeModal('clientDetailModal');setTimeout(function(){showPropertyDetail(el.getAttribute('data-prop-id'))},200)});
  });
}
function di(label,value){return'<div class="detail-item"><div class="label">'+esc(label)+'</div><div class="value">'+esc(value||'—')+'</div></div>'}

/* ========== Property: Filter & Sort ========== */
function getFilteredProperties(){
  var list=S.properties.slice();
  var f=S.propFilters;var q=S.search.trim().toLowerCase();
  // community 类型不在房源列表显示
  list=list.filter(function(p){return p.type!=='community'});
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
  var sk=S.propSort;
  list.sort(function(a,b){
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
function renderPropertyList(){
  try{
  updateFilterBadge('propFilterToggle',S.propFilters);
  var grid=document.getElementById('propertyGrid');
  var table=document.getElementById('propertyTable');
  if(S.propViewMode==='table'){
    grid.style.display='none';
    table.style.display='';
    renderPropertyTable();
    return;
  }
  grid.style.display='';
  table.style.display='none';
  var list=getFilteredProperties();
  document.getElementById('propResultCount').innerHTML='共 <b>'+list.length+'</b> 套房源';
  if(list.length===0){
    grid.innerHTML='<div class="empty" style="grid-column:1/-1"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg><h3>'+(S.properties.length===0?'还没有房源档案':'没有符合条件的房源')+'</h3><p>'+(S.properties.length===0?'点击「新增房源」按钮，开始录入':'试试调整筛选条件')+'</p></div>';
    return;
  }
  grid.innerHTML=list.map(function(p){
    var price;
    if(p.type==='rental'){
      price=p.rentPrice?p.rentPrice+'<span class="unit">元/月</span>':'面议';
    }else if(p.type==='secondhand'){
      price=p.totalPrice?p.totalPrice+'<span class="unit">万</span>':'面议';
    }else{
      price=p.averagePrice?p.averagePrice+'<span class="unit">元/㎡</span>':'面议';
    }
    var typeLabel=p.type==='secondhand'?'二手房':(p.type==='rental'?'租赁':'新楼盘');
    var info;
    if(p.type==='rental'){
      info=[p.area?p.area+'㎡':'',p.layout||'',p.depositType||'',p.rentType||''].filter(Boolean);
    }else if(p.type==='secondhand'){
      info=[p.area?p.area+'㎡':'',p.layout||'',p.orientation||''].filter(Boolean);
      // 添加楼幢单元房间号
      var locStr=[p.building,p.unit,p.room].filter(Boolean).join(' ');
      if(locStr)info.unshift(locStr);
    }else{
      info=[p.developer||'',p.availableLayouts||''].filter(Boolean);
    }
    var tags=(p.tags||[]).map(function(t){return'<span class="client-tag">'+esc(t)+'</span>'}).join('');
    var propPinned=(S.pinnedPropIds||[]).indexOf(p.id)>=0;
    var titleDisplay=p.type==='secondhand'||p.type==='rental' ? (p.community||'')+(p.building?(' '+p.building):'')+(p.unit?(' '+p.unit):'')+(p.room?(' '+p.room):'') : (p.title||'');
    return'<div class="property-card'+(propPinned?' pinned':'')+'" data-status="'+esc(p.status)+'" data-id="'+p.id+'">'
      +(propPinned?'<div style="position:absolute;top:8px;right:8px;z-index:2;font-size:1rem">⭐</div>':'')
      +'<div class="card-thumb no-img" data-thumb="'+p.id+'"><span class="type-label">'+typeLabel+'</span><span class="media-count" data-media-count="'+p.id+'" style="display:none"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span class="mc-num">0</span></span></div>'
      +'<div class="card-body"><div class="card-title">'+esc(titleDisplay||'未命名')+'</div><div class="card-price">'+price+'</div>'
      +'<div class="card-info">'+info.map(function(i){return'<span>'+esc(i)+'</span>'}).join('')+'</div>'
      +(tags?'<div class="prop-tags">'+tags+'</div>':'')
      +'<div class="card-info"><span>'+esc(p.district||'')+(p.block?('·'+esc(p.block)):'')+'</span><span class="status-badge" data-status="'+esc(p.status)+'">'+esc(p.status)+'</span></div>'
      +'<div class="card-actions"><button data-action="pview" data-id="'+p.id+'">详情</button><button data-action="pshare" data-id="'+p.id+'">分享</button><button data-action="ppin" data-id="'+p.id+'" title="'+(propPinned?'取消重点':'标为重点')+'">'+(propPinned?'⭐取消':'⭐重点')+'</button><button data-action="pedit" data-id="'+p.id+'">编辑</button></div>'
      +'</div></div>';
  }).join('');
  grid.querySelectorAll('.property-card').forEach(function(card){
    card.addEventListener('click',function(e){if(e.target.closest('button'))return;showPropertyDetail(card.getAttribute('data-id'))});
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
function renderCommunityList(){
  try{
  /* 获取所有小区名称（从二手房+租赁房中提取，加上已有的community类型记录） */
  var communityMap={};
  /* 先从 community 类型记录中获取已有概况 */
  S.properties.filter(function(p){return p.type==='community'}).forEach(function(c){
    var name=c.title||c.community||'';
    if(name)communityMap[name]={info:c,forSale:0,forRent:0};
  });
  /* 从二手房+租赁房中统计 */
  S.properties.filter(function(p){return p.type==='secondhand'||p.type==='rental'}).forEach(function(p){
    var name=p.community||'';
    if(!name)return;
    if(!communityMap[name])communityMap[name]={info:null,forSale:0,forRent:0};
    if(p.type==='secondhand')communityMap[name].forSale++;
    if(p.type==='rental')communityMap[name].forRent++;
    /* 如果没有概况记录，从房源中提取区域信息 */
    if(!communityMap[name].info){
      communityMap[name].district=p.district||'';
      communityMap[name].block=p.block||'';
    }
  });
  var names=Object.keys(communityMap).sort();
  var grid=document.getElementById('propertyGrid');
  var table=document.getElementById('propertyTable');
  if(grid)grid.style.display='';
  if(table)table.style.display='none';
  document.getElementById('propResultCount').innerHTML='共 <b>'+names.length+'</b> 个小区';
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
    return'<div class="community-card" data-community="'+esc(name)+'">'
      +'<div class="card-body" style="padding:16px">'
      +'<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'
      +'<div><div class="card-title" style="font-size:1rem;font-weight:600">'+esc(name)+'</div>'
      +'<div class="card-info"><span>'+esc(locStr||'未分类区域')+'</span></div></div>'
      +'<div style="display:flex;gap:6px">'
      +'<span class="status-badge" data-status="在售" style="cursor:pointer" data-cview="secondhand" data-cname="'+esc(name)+'">在售 '+c.forSale+'</span>'
      +'<span class="status-badge" data-status="已租" style="cursor:pointer" data-cview="rental" data-cname="'+esc(name)+'">在租 '+c.forRent+'</span>'
      +'</div></div>'
      +(overviewItems.length?'<div class="card-info" style="margin-bottom:4px">'+overviewItems.map(function(s){return'<span>'+s+'</span>'}).join('')+'</div>':'')
      +(schoolStr?'<div style="font-size:.75rem;color:var(--text-secondary);margin-bottom:4px">🏫 '+schoolStr+'</div>':'')
      +(feeStr?'<div style="font-size:.75rem;color:var(--text-secondary);margin-bottom:4px">💰 物业费：'+feeStr+'</div>':'')
      +(!hasOverview?'<div style="font-size:.75rem;color:var(--warning);margin-bottom:4px">⚠ 未填写小区概况</div>':'')
      +'<div class="card-actions">'
      +'<button data-action="cedit" data-cname="'+esc(name)+'">'+(hasOverview?'编辑概况':'添加概况')+'</button>'
      +'<button data-action="csale" data-cname="'+esc(name)+'">看在售</button>'
      +'<button data-action="crent" data-cname="'+esc(name)+'">看在租</button>'
      +'</div></div></div>';
  }).join('');
  /* 绑定事件 */
  grid.querySelectorAll('.community-card .card-actions button').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      var a=btn.getAttribute('data-action');
      var name=btn.getAttribute('data-cname');
      if(a==='cedit')openCommunityForm(name);
      if(a==='csale'){S.propFilters.community=name;switchSubtab('secondhand');var el=document.getElementById('pfFilterCommunity');if(el)el.value=name;}
      if(a==='crent'){S.propFilters.community=name;switchSubtab('rental');var el2=document.getElementById('pfFilterCommunity');if(el2)el2.value=name;}
    });
  });
  grid.querySelectorAll('[data-cview]').forEach(function(el){
    el.addEventListener('click',function(e){
      e.stopPropagation();
      var name=el.getAttribute('data-cname');
      var view=el.getAttribute('data-cview');
      S.propFilters.community=name;
      switchSubtab(view);
      var inp=document.getElementById('pfFilterCommunity');
      if(inp)inp.value=name;
    });
  });
  }catch(err){console.error('[renderCommunityList]',err);toast('小区列表加载失败: '+err.message,'error')}
}

/* 打开小区概况编辑表单 */
function openCommunityForm(name){
  var existing=S.properties.find(function(p){return p.type==='community'&&(p.title===name||p.community===name)});
  var c=existing||{type:'community',title:name,community:name};
  var html='<div class="modal-overlay show" id="communityFormModal">'
    +'<div class="modal" style="max-width:560px">'
    +'<div class="modal-header"><h3>'+(existing?'编辑小区概况':'添加小区概况')+'</h3><button class="modal-close" onclick="document.getElementById(\'communityFormModal\').remove()">×</button></div>'
    +'<div class="modal-body" style="max-height:70vh;overflow-y:auto;padding:16px">'
    +'<input type="hidden" id="cmId" value="'+esc(c.id||'')+'">'
    +'<input type="hidden" id="cmOrigName" value="'+esc(name||'')+'">'
    +'<div class="form-grid">'
    +'<div class="form-field"><label>小区名称 <span class="req">*</span></label><input type="text" id="cmName" value="'+esc(c.title||c.community||name||'')+'" placeholder="如：理想家园"></div>'
    +'<div class="form-field"><label>区域</label><select id="cmDistrict"><option value="">请选择</option>'
    +['临平','余杭','萧山','拱墅','西湖','上城','滨江','钱塘','富阳','临安'].map(function(d){return'<option value="'+d+'"'+(c.district===d?' selected':'')+'>'+d+'</option>'}).join('')
    +'</select></div>'
    +'<div class="form-field"><label>板块/商圈</label><input type="text" id="cmBlock" value="'+esc(c.block||'')+'" placeholder="如：临平新城"></div>'
    +'<div class="form-field"><label>共计楼幢</label><input type="text" id="cmBuildingCount" value="'+esc(c.buildingCount||'')+'" placeholder="如：12幢"></div>'
    +'<div class="form-field"><label>共计户数</label><input type="text" id="cmHouseholdCount" value="'+esc(c.householdCount||'')+'" placeholder="如：1200户"></div>'
    +'<div class="form-field"><label>房龄</label><input type="text" id="cmBuildingAge" value="'+esc(c.buildingAge||'')+'" placeholder="如：2018年"></div>'
    +'<div class="form-field"><label>归属街道</label><input type="text" id="cmStreet" value="'+esc(c.street||'')+'" placeholder="如：南苑街道"></div>'
    +'<div class="form-field"><label>归属社区</label><input type="text" id="cmNeighborhood" value="'+esc(c.neighborhood||'')+'" placeholder="如：时代社区"></div>'
    +'<div class="form-field"><label>对口幼儿园</label><input type="text" id="cmKindergarten" value="'+esc(c.kindergarten||'')+'" placeholder="如：临平第一幼儿园"></div>'
    +'<div class="form-field"><label>对口小学</label><input type="text" id="cmPrimarySchool" value="'+esc(c.primarySchool||'')+'" placeholder="如：临平第一小学"></div>'
    +'<div class="form-field"><label>对口中学</label><input type="text" id="cmMiddleSchool" value="'+esc(c.middleSchool||'')+'" placeholder="如：临平第五中学"></div>'
    +'<div class="form-field"><label>物业名称</label><input type="text" id="cmPropertyManagement" value="'+esc(c.propertyManagement||'')+'" placeholder="如：绿城物业"></div>'
    +'</div>'
    /* 物业费标准（多种业态） */
    +'<div style="margin-top:12px"><label style="font-size:.8125rem;font-weight:600;display:block;margin-bottom:6px">物业费标准（可添加多种业态）</label>'
    +'<div id="cmFeeList" style="margin-bottom:8px"></div>'
    +'<button type="button" class="btn-mini" id="cmAddFee" style="border:1px solid var(--border);background:var(--bg-secondary);padding:4px 10px;font-size:.75rem;border-radius:6px;cursor:pointer">+ 添加物业费</button>'
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
  function renderFeeList(){
    var container=document.getElementById('cmFeeList');
    container.innerHTML=fees.map(function(f,i){
      return'<div style="display:flex;gap:6px;margin-bottom:4px;align-items:center">'
        +'<input type="text" class="cm-fee-type" value="'+esc(f.type||'')+'" placeholder="业态（如高层）" style="flex:1;font-size:.75rem;padding:4px 8px;border:1px solid var(--border);border-radius:4px">'
        +'<input type="text" class="cm-fee-amount" value="'+esc(f.fee||'')+'" placeholder="费用（如3.5元/㎡/月）" style="flex:1.5;font-size:.75rem;padding:4px 8px;border:1px solid var(--border);border-radius:4px">'
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
    p.kindergarten=document.getElementById('cmKindergarten').value.trim();
    p.primarySchool=document.getElementById('cmPrimarySchool').value.trim();
    p.middleSchool=document.getElementById('cmMiddleSchool').value.trim();
    p.propertyManagement=document.getElementById('cmPropertyManagement').value.trim();
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
    saveP();
    document.getElementById('communityFormModal').remove();
    renderCommunityList();
    toast('小区概况已保存','success');
  });
}

/* 小区智能识别录入 */
function openCommunitySmartInput(){
  var html='<div class="modal-overlay show" id="cmSmartModal">'
    +'<div class="modal" style="max-width:600px">'
    +'<div class="modal-header"><h3>小区概况智能录入</h3><button class="modal-close" onclick="document.getElementById(\'cmSmartModal\').remove()">×</button></div>'
    +'<div class="modal-body" style="max-height:70vh;overflow-y:auto;padding:16px">'
    +'<div class="sig-hint" style="background:var(--primary-light);border-radius:8px;padding:10px;margin-bottom:12px;font-size:.8125rem;color:var(--text-secondary)">'
    +'粘贴小区概况信息，支持以下格式：<br>'
    +'1. 表格粘贴（Excel直接粘贴）<br>'
    +'2. 键值对（小区名：XX 楼幢：12幢 房龄：2018年 ...）<br>'
    +'3. 自由文本（系统尝试自动识别关键字段）</div>'
    +'<textarea id="cmSmartArea" rows="10" style="width:100%;font-size:.8125rem;padding:8px;border:1px solid var(--border);border-radius:6px" placeholder="粘贴小区概况信息…"></textarea>'
    +'<div id="cmSmartPreview" style="margin-top:12px"></div>'
    +'</div>'
    +'<div class="modal-footer">'
    +'<button class="btn-secondary" onclick="document.getElementById(\'cmSmartModal\').remove()">取消</button>'
    +'<button class="btn-primary" id="cmSmartParseBtn">识别</button>'
    +'<button class="btn-primary" id="cmSmartImportBtn" style="display:none">全部录入</button>'
    +'</div></div></div>';
  var old=document.getElementById('cmSmartModal');
  if(old)old.remove();
  document.body.insertAdjacentHTML('beforeend',html);
  var parsedCommunities=[];
  document.getElementById('cmSmartParseBtn').addEventListener('click',function(){
    var text=document.getElementById('cmSmartArea').value.trim();
    if(!text){toast('请先粘贴数据','error');return}
    parsedCommunities=parseCommunitySmartInput(text);
    if(parsedCommunities.length===0){
      document.getElementById('cmSmartPreview').innerHTML='<p style="color:var(--warning)">未识别到有效小区数据，请检查格式</p>';
      return;
    }
    document.getElementById('cmSmartPreview').innerHTML='<p style="color:var(--success)">已识别 '+parsedCommunities.length+' 个小区，请检查后点击「全部录入」</p>'
      +parsedCommunities.map(function(c,i){
        return'<div style="background:var(--bg-secondary);border-radius:6px;padding:8px;margin-bottom:6px;font-size:.75rem">'
          +'<b>'+(c.title||c.community||'未命名')+'</b>'
          +(c.district?' | '+c.district:'')+(c.block?' · '+c.block:'')
          +(c.buildingCount?' | 楼幢:'+c.buildingCount:'')
          +(c.buildingAge?' | 房龄:'+c.buildingAge:'')
          +(c.street?' | '+c.street:'')
          +(c.propertyManagement?' | 物业:'+c.propertyManagement:'')
          +'</div>';
      }).join('');
    document.getElementById('cmSmartImportBtn').style.display='';
  });
  document.getElementById('cmSmartImportBtn').addEventListener('click',function(){
    parsedCommunities.forEach(function(c){
      /* 按名字查找已有记录 */
      var existing=S.properties.find(function(p){return p.type==='community'&&(p.title===c.title||p.community===c.title)});
      if(existing){
        Object.keys(c).forEach(function(k){if(c[k])existing[k]=c[k]});
        existing.updatedAt=now();
      }else{
        c.id=uuid();c.type='community';c.createdAt=now();
        if(!c.community)c.community=c.title;
        S.properties.push(c);
      }
    });
    saveP();
    document.getElementById('cmSmartModal').remove();
    renderCommunityList();
    toast('已录入 '+parsedCommunities.length+' 个小区概况','success');
  });
}

/* 解析小区智能录入 */
function parseCommunitySmartInput(text){
  var results=[];
  /* 尝试检测表格格式（制表符或多个空格分隔） */
  var lines=text.split('\n').filter(function(l){return l.trim()});
  /* 检测是否有表头 */
  var headerMap={'小区':null,'名称':null,'楼幢':null,'户数':null,'房龄':null,'街道':null,'社区':null,'幼儿园':null,'小学':null,'中学':null,'物业':null,'物业费':null,'区域':null,'板块':null,'商圈':null};
  /* 尝试键值对解析 */
  var current={};
  var kvPattern=/([^\s:：]+)[：:]\s*([^\s\n]+)/g;
  var hasKV=false;
  lines.forEach(function(line){
    var matches=line.match(kvPattern);
    if(matches&&matches.length>0){
      hasKV=true;
      matches.forEach(function(m){
        var parts=m.split(/[：:]/);
        if(parts.length>=2){
          var key=parts[0].trim();
          var val=parts.slice(1).join(':').trim();
          if(key.indexOf('小区')>=0||key.indexOf('名称')>=0){current.title=current.title||val;current.community=current.community||val}
          else if(key.indexOf('区域')>=0||key.indexOf('区')>=0)current.district=val;
          else if(key.indexOf('板块')>=0||key.indexOf('商圈')>=0)current.block=val;
          else if(key.indexOf('楼幢')>=0||key.indexOf('栋数')>=0)current.buildingCount=val;
          else if(key.indexOf('户数')>=0)current.householdCount=val;
          else if(key.indexOf('房龄')>=0||key.indexOf('年代')>=0||key.indexOf('建成')>=0)current.buildingAge=val;
          else if(key.indexOf('街道')>=0)current.street=val;
          else if(key.indexOf('社区')>=0&&key.indexOf('小区')<0)current.neighborhood=val;
          else if(key.indexOf('幼儿园')>=0)current.kindergarten=val;
          else if(key.indexOf('小学')>=0)current.primarySchool=val;
          else if(key.indexOf('中学')>=0||key.indexOf('初中')>=0)current.middleSchool=val;
          else if(key.indexOf('物业')>=0&&key.indexOf('费')<0)current.propertyManagement=val;
        }
      });
    }
  });
  if(hasKV&&current.title){
    results.push(current);
    return results;
  }
  /* 尝试表格解析（Tab或逗号分隔） */
  if(lines.length>=2){
    var sep=lines[0].indexOf('\t')>=0?'\t':',';
    var headers=lines[0].split(sep).map(function(h){return h.trim()});
    var hasHeader=headers.some(function(h){return h.indexOf('小区')>=0||h.indexOf('名称')>=0||h.indexOf('物业')>=0});
    if(hasHeader){
      for(var i=1;i<lines.length;i++){
        var cols=lines[i].split(sep);
        var obj={};
        headers.forEach(function(h,idx){
          var val=cols[idx]?cols[idx].trim():'';
          if(!val)return;
          if(h.indexOf('小区')>=0||h.indexOf('名称')>=0){obj.title=val;obj.community=val}
          else if(h.indexOf('区域')>=0||h==='区')obj.district=val;
          else if(h.indexOf('板块')>=0||h.indexOf('商圈')>=0)obj.block=val;
          else if(h.indexOf('楼幢')>=0||h.indexOf('栋数')>=0)obj.buildingCount=val;
          else if(h.indexOf('户数')>=0)obj.householdCount=val;
          else if(h.indexOf('房龄')>=0||h.indexOf('年代')>=0||h.indexOf('建成')>=0)obj.buildingAge=val;
          else if(h.indexOf('街道')>=0)obj.street=val;
          else if(h.indexOf('社区')>=0&&h.indexOf('小区')<0)obj.neighborhood=val;
          else if(h.indexOf('幼儿园')>=0)obj.kindergarten=val;
          else if(h.indexOf('小学')>=0)obj.primarySchool=val;
          else if(h.indexOf('中学')>=0||h.indexOf('初中')>=0)obj.middleSchool=val;
          else if(h.indexOf('物业')>=0&&h.indexOf('费')<0)obj.propertyManagement=val;
          else if(h.indexOf('物业费')>=0){
            obj.propertyFees=obj.propertyFees||[];
            obj.propertyFees.push({type:'默认',fee:val});
          }
        });
        if(obj.title)results.push(obj);
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
  document.getElementById('propResultCount').innerHTML='共 <b>'+list.length+'</b> 套房源';

  if(list.length===0){
    var isEmptyAll=S.properties.length===0;
    table.innerHTML='<div class="empty" style="padding:40px"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg><h3>'+(isEmptyAll?'还没有房源档案':'没有符合条件的房源')+'</h3><p>'+(isEmptyAll?'点击「新增房源」按钮开始录入':'试试调整筛选条件')+'</p></div>';
    return;
  }

  /* 批量操作工具栏 */
  var checkedCount=S.checkedPropIds?(S.checkedPropIds.length):0;
  var toolbarHtml='<div class="prop-batch-bar" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f8fafc;border-bottom:1px solid var(--border);gap:8px">'
    +'<div style="display:flex;align-items:center;gap:8px">'
    +'<label style="font-size:.8125rem;cursor:pointer;display:flex;align-items:center;gap:4px"><input type="checkbox" id="propCheckAll" '+(checkedCount>0&&checkedCount===list.length?'checked':'')+'> 全选</label>'
    +'<span style="font-size:.75rem;color:var(--text-muted)">已选 <b id="propCheckedCount" style="color:var(--primary)">'+checkedCount+'</b> / '+list.length+' 条</span>'
    +(checkedCount>0?'<button class="btn-mini" id="propBatchDelete" style="background:#fee2e2;color:#dc2626;border-color:#fecaca">批量删除 ('+checkedCount+')</button>'
      +'<button class="btn-mini" id="propBatchCancelCheck">取消选择</button>':'')
    +'</div>'
    +'<div style="font-size:.75rem;color:var(--text-muted)">💡 提示：按楼盘名字自动去重，重复楼盘默认排除</div>'
    +'</div>';

  var isSh=(S.subtab==='secondhand');
  var isRt=(S.subtab==='rental');
  var isShOrRt=isSh||isRt;

  var html=toolbarHtml;
  if(isShOrRt){
    /* 二手房/租赁房表格 */
    html+='<div class="client-table-wrap"><table class="client-table"><thead><tr>'
      +'<th style="width:32px"><input type="checkbox" disabled '+(checkedCount>0&&checkedCount===list.length?'checked':'')+'></th>'
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
        +'<td><input type="checkbox" class="prop-check" data-prop-check-id="'+p.id+'" '+(isChecked?'checked':'')+'></td>'
        +'<td>'+(p.district?'<span class="ct-area">'+esc(p.district)+'</span>':'<span style="color:var(--gray-400)">—</span>')+'</td>'
        +'<td><span class="ct-name" title="'+esc(locTitle)+'">'+esc(p.community||'—')+'</span></td>'
        +'<td>'+esc(p.building||'—')+'</td>'
        +'<td>'+esc(p.unit||'—')+'</td>'
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
        +'<td>'+(p.ownerPhone?'<a href="tel:'+esc(p.ownerPhone)+'">'+esc(p.ownerPhone)+'</a>':'—')+'</td>'
        +'<td><button class="ct-action-btn" data-prop-view-id="'+p.id+'">详情</button><button class="ct-action-btn" data-prop-edit-id="'+p.id+'">编辑</button></td>'
        +'</tr>';
    }
    html+='</tbody></table></div>';
  }else{
    /* 新楼盘表格（保持原逻辑） */
    html+='<div class="client-table-wrap"><table class="client-table"><thead><tr>'
    +'<th style="width:32px"><input type="checkbox" disabled '+(checkedCount>0&&checkedCount===list.length?'checked':'')+'></th>'
    +'<th>行政区</th>'
    +'<th>项目名称</th>'
    +'<th>商圈</th>'
    +'<th>物业类型</th>'
    +'<th>开发商</th>'
    +'<th>在售面积（㎡）</th>'
    +'<th>均价（元）</th>'
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
    var businessDistrictStr=p.businessDistrict?'<span style="font-size:.75rem;color:var(--text-secondary)">'+esc(p.businessDistrict)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var propertyTypeStr=p.propertyType?'<span style="font-size:.75rem">'+esc(p.propertyType)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var developerStr=p.developer?'<span style="font-size:.75rem">'+esc(p.developer)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var layoutsStr=p.availableLayouts?'<span style="font-size:.75rem">'+esc(p.availableLayouts)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var avgPriceStr=p.averagePrice?(p.averagePrice+'<span style="font-size:.625rem">元/㎡</span>'):'<span style="color:var(--gray-400)">—</span>';
    var totalPriceStr=p.totalPrice?(p.totalPrice+'<span style="font-size:.625rem">万</span>'):'<span style="color:var(--gray-400)">—</span>';
    var highlightsStr=p.highlights?'<span style="font-size:.6875rem;color:var(--text-secondary)" title="'+esc(p.highlights)+'">'+esc(truncateText(p.highlights,28))+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var preferentialStr=p.preferential?'<span style="font-size:.6875rem;color:var(--text-secondary)" title="'+esc(p.preferential)+'">'+esc(truncateText(p.preferential,28))+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var metroStr=p.metro?'<span style="font-size:.75rem" title="'+esc(p.metro)+'">'+esc(p.metro)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var deliveryStr=p.deliveryDate?esc(p.deliveryDate):'<span style="color:var(--gray-400)">—</span>';
    var commissionStr=p.commission?'<span style="font-size:.75rem;color:var(--success)" title="'+esc(p.commission)+'">'+esc(p.commission)+'</span>':'<span style="color:var(--gray-400)">—</span>';
    var viewingRuleStr='';
    if(p.viewingRule||p.protectionPeriod){
      var combined=trimEmpty(p.viewingRule)+(p.viewingRule&&p.protectionPeriod?'\n':'')+trimEmpty(p.protectionPeriod);
      viewingRuleStr='<span style="font-size:.6875rem;color:var(--text-secondary)" title="'+esc(combined)+'">'+esc(truncateText(combined,28))+'</span>';
    }else{
      viewingRuleStr='<span style="color:var(--gray-400)">—</span>';
    }
    var remainingStr=p.remaining?'<span style="font-size:.75rem">'+esc(p.remaining)+'</span>':'<span style="color:var(--gray-400)">—</span>';

    var propPinned=(S.pinnedPropIds||[]).indexOf(p.id)>=0;
    var propRowCls=[];
    if(propPinned)propRowCls.push('is-pinned');
    if(isOff)propRowCls.push('invalid');
    if(isSold)propRowCls.push('is-completed');
    var isChecked=(S.checkedPropIds||[]).indexOf(p.id)>=0;

    html+='<tr data-id="'+p.id+'"'+(propRowCls.length?' class="'+propRowCls.join(' ')+'"':'')+'>'
      +'<td><input type="checkbox" class="prop-check" data-prop-check-id="'+p.id+'" '+(isChecked?'checked':'')+'></td>'
      +'<td>'+districtStr+'</td>'
      +'<td>'+titleCell+'</td>'
      +'<td>'+businessDistrictStr+'</td>'
      +'<td>'+propertyTypeStr+'</td>'
      +'<td>'+developerStr+'</td>'
      +'<td>'+layoutsStr+'</td>'
      +'<td><span class="ct-budget" style="color:'+(isSold?'var(--text-muted)':'var(--primary)')+'">'+avgPriceStr+'</span></td>'
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

  /* row click -> detail */
  table.querySelectorAll('tbody tr').forEach(function(row){
    row.addEventListener('click',function(e){
      if(e.target.closest('button')||e.target.closest('select')||e.target.closest('a')||e.target.closest('input'))return;
      showPropertyDetail(row.getAttribute('data-id'));
    });
  });

  /* 行checkbox勾选 */
  table.querySelectorAll('.prop-check').forEach(function(cb){
    cb.addEventListener('change',function(e){
      e.stopPropagation();
      var id=cb.getAttribute('data-prop-check-id');
      S.checkedPropIds=S.checkedPropIds||[];
      var idx=S.checkedPropIds.indexOf(id);
      if(cb.checked&&idx<0)S.checkedPropIds.push(id);
      else if(!cb.checked&&idx>=0)S.checkedPropIds.splice(idx,1);
      /* 更新计数 */
      var cntEl=document.getElementById('propCheckedCount');
      if(cntEl)cntEl.textContent=S.checkedPropIds.length;
      /* 工具栏按钮显隐 */
      var delBtn=document.getElementById('propBatchDelete');
      var cancelBtn=document.getElementById('propBatchCancelCheck');
      if(S.checkedPropIds.length>0){
        if(!delBtn){
          var bar=table.querySelector('.prop-batch-bar');
          if(bar){
            var html='<button class="btn-mini" id="propBatchDelete" style="background:#fee2e2;color:#dc2626;border-color:#fecaca">批量删除 ('+S.checkedPropIds.length+')</button>'
              +'<button class="btn-mini" id="propBatchCancelCheck">取消选择</button>';
            bar.querySelector('span').insertAdjacentHTML('afterend',html);
            bindBatchBar();
          }
        }else{
          delBtn.textContent='批量删除 ('+S.checkedPropIds.length+')';
        }
      }else{
        if(delBtn)delBtn.remove();
        if(cancelBtn)cancelBtn.remove();
      }
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
  bindBatchBar();
  }catch(err){console.error('[renderPropertyTable]',err)}
}

function bindBatchBar(){
  var delBtn=document.getElementById('propBatchDelete');
  if(delBtn&&!delBtn._bound){
    delBtn._bound=true;
    delBtn.addEventListener('click',function(){
      var ids=S.checkedPropIds||[];
      if(ids.length===0)return;
      confirmDialog('⚠️ 批量删除确认','确定要删除选中的 '+ids.length+' 个楼盘吗？此操作不可恢复！',function(){
        S.properties=S.properties.filter(function(p){return ids.indexOf(p.id)<0});
        /* 清空已选 */
        S.checkedPropIds=[];
        saveP();
        renderPropertyTable();
        renderPropertyList();
        toast('已删除 '+ids.length+' 个楼盘','success');
      });
    });
  }
  var cancelBtn=document.getElementById('propBatchCancelCheck');
  if(cancelBtn&&!cancelBtn._bound){
    cancelBtn._bound=true;
    cancelBtn.addEventListener('click',function(){
      S.checkedPropIds=[];
      renderPropertyTable();
    });
  }
}

/* ========== Property: Form ========== */
function openPropertyForm(id){
  try{
  S.editPropId=id||null;S.editPropTags=[];
  var p=id?findProp(id):{};
  var type=id?p.type:(S.subtab==='community'?'secondhand':S.subtab);
  if(type==='community')type='secondhand';
  document.getElementById('propFormTitle').textContent=id?(type==='newdev'?'编辑楼盘':(type==='rental'?'编辑出租房':'编辑房源')):(S.subtab==='newdev'?'新增楼盘':(S.subtab==='rental'?'新增出租房':(S.subtab==='community'?'新增小区(房源)':'新增二手房')));
  document.getElementById('pfId').value=id||'';
  document.getElementById('pfType').value=type;
  updatePropFormFields(type);
  /* 更新板块下拉 */
  updateFormBlockOptions(p.district||'临平',p.block);
  document.getElementById('pfTitle').value=p.title||'';
  document.getElementById('pfCommunity').value=p.community||'';
  document.getElementById('pfDeveloper').value=p.developer||'';
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
  document.getElementById('pfBuilding').value=p.building||'';
  document.getElementById('pfUnit').value=p.unit||'';
  document.getElementById('pfRoom').value=p.room||'';
  document.getElementById('pfArea').value=p.area||'';
  document.getElementById('pfUnitPrice').value=p.unitPrice||'';
  document.getElementById('pfLayout').value=p.layout||'';
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
  p.building=document.getElementById('pfBuilding').value.trim();
  p.unit=document.getElementById('pfUnit').value.trim();
  p.room=document.getElementById('pfRoom').value.trim();
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
  p.averagePrice=parseInt(document.getElementById('pfAvgPrice').value)||0;
  p.propertyType=document.getElementById('pfPropType2').value;
  p.openingDate=document.getElementById('pfOpeningDate').value.trim();
  p.deliveryDate=document.getElementById('pfDeliveryDate').value.trim();
  p.availableLayouts=document.getElementById('pfAvailLayouts').value.trim();
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
  p.status=document.getElementById('pfStatus').value;
  p.description=document.getElementById('pfDesc').value.trim();
  p.coverMediaId=document.getElementById('pfCoverMediaId').value||null;
  p.tags=S.editPropTags.slice();p.showroomAreas=S.editAreaSegs.slice();p.updatedAt=now();
  if(!isEdit){p.id=uuid();p.createdAt=now();p.linkedClientIds=[];S.properties.push(p)}
  saveP();closeModal('propFormModal');
  if(S.subtab==='community'){renderCommunityList()}else{renderPropertyList()}
  toast(isEdit?'房源已更新':'房源已添加','success');
}

/* ========== Property: Detail ========== */
function showPropertyDetail(id){
  var p=findProp(id);if(!p)return;S.curPropId=id;
  var price;var infoItems;var typeLabel;
  if(p.type==='rental'){
    price=p.rentPrice?p.rentPrice+'元/月':'面议';typeLabel='租赁房';
    infoItems=[
      di('小区',p.community||'\u2014'),di('楼幢',p.building||'\u2014'),di('单元',p.unit||'\u2014'),di('房间号',p.room||'\u2014'),
      di('面积',p.area?p.area+'\u33a1':'\u2014'),di('户型',p.layout||'\u2014'),di('楼层',p.floor?(p.floor+(p.totalFloors?'/'+p.totalFloors+'层':'')):'\u2014'),
      di('朝向',p.orientation||'\u2014'),di('装修',p.decoration||'\u2014'),di('押付方式',p.depositType||'\u2014'),
      di('租赁方式',p.rentType||'\u2014'),di('租期',p.leaseTerm||'\u2014'),di('出租状态',p.rentStatus||'\u2014'),
      di('最短租期',p.minLease||'\u2014'),di('入住时间',p.moveInDate||'\u2014'),
      di('建成年代',p.buildingAge||'\u2014'),di('钥匙',p.hasKey?'有':'无'),di('看房',p.viewingMethod||'\u2014'),
      di('学区',p.school||'\u2014'),di('地铁',p.metro||'\u2014'),di('业主',p.ownerName||'\u2014'),di('业主电话',p.ownerPhone||'\u2014')
    ];
  }else if(p.type==='secondhand'){
    price=p.totalPrice?p.totalPrice+'万':'面议';typeLabel='二手房';
    infoItems=[
      di('小区',p.community||'\u2014'),di('楼幢',p.building||'\u2014'),di('单元',p.unit||'\u2014'),di('房间号',p.room||'\u2014'),
      di('面积',p.area?p.area+'\u33a1':'\u2014'),di('户型',p.layout||'\u2014'),di('楼层',p.floor?(p.floor+(p.totalFloors?'/'+p.totalFloors+'层':'')):'\u2014'),
      di('朝向',p.orientation||'\u2014'),di('装修',p.decoration||'\u2014'),di('单价',p.unitPrice?p.unitPrice+'元/\u33a1':'\u2014'),di('建成年代',p.buildingAge||'\u2014'),
      di('产权',p.propertyRights||'\u2014'),di('钥匙',p.hasKey?'有':'无'),di('看房',p.viewingMethod||'\u2014'),di('学区',p.school||'\u2014'),di('地铁',p.metro||'\u2014'),di('业主',p.ownerName||'\u2014'),di('业主电话',p.ownerPhone||'\u2014')
    ];
  }else{
    price=p.averagePrice?p.averagePrice+'元/\u33a1':'面议';typeLabel='新楼盘';
    infoItems=[
      di('开发商',p.developer||'\u2014'),di('均价',p.averagePrice?p.averagePrice+'元/\u33a1':'\u2014'),di('起步总价',p.totalPrice?p.totalPrice+'万':'\u2014'),di('物业类型',p.propertyType||'\u2014'),
      di('面积段',p.availableLayouts||'\u2014'),di('装修',p.decoration||'\u2014'),di('剩余房源',p.remaining||'\u2014'),
      di('开盘时间',p.openingDate||'\u2014'),di('交付时间',p.deliveryDate||'\u2014'),di('总户数',p.totalUnits||'\u2014'),di('绿化率',p.greenRate||'\u2014'),di('容积率',p.plotRatio||'\u2014'),
      di('地铁',p.metro||'\u2014'),di('对接人',p.contactName||'\u2014'),di('联系电话',p.contactPhone||'\u2014'),di('佣金',p.commission||'\u2014'),
      di('保护期',p.protectionPeriod||'\u2014')
    ];
  }
  var tagsHtml=(p.tags||[]).map(function(t){return'<span class="client-tag">'+esc(t)+'</span>'}).join('');
  var matchedClients=getMatchedClients(id);
  var matchedHtml=matchedClients.map(function(c){
    return'<div class="viewing-item" style="cursor:pointer" data-client-id="'+c.id+'"><div class="vi-top"><span class="vi-prop">'+esc(c.name)+'</span><span class="vi-date">'+esc(c.grade)+'级</span></div><div class="vi-feedback">预算'+fmtBudget(c.budgetMin,c.budgetMax)+' · '+(c.targetAreas||[]).join('、')+'</div></div>';
  }).join('')||'<div class="timeline-empty">暂无匹配客户</div>';
  document.getElementById('propDetailBody').innerHTML=
    '<div class="media-section"><div class="media-upload-area" id="mediaUpload"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" stroke-width="1.5" style="margin:0 auto;display:block"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><p>点击或拖拽上传图片/视频</p><div class="hint">支持 JPG/PNG/MP4 等，图片自动压缩</div></div><div class="media-gallery" id="mediaGallery"></div></div>'
    +'<div class="detail-header"><div class="detail-avatar" style="background:var(--success-light);color:var(--success)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div><div class="detail-info"><h2>'+esc(p.title)+'</h2><div class="sub">'+esc(p.district)+(p.block?(' · '+esc(p.block)):'')+(p.address?' · '+esc(p.address):'')+'</div><div class="detail-badges"><span class="status-badge" data-status="'+esc(p.status)+'">'+esc(p.status)+'</span><span class="status-badge" data-status="已联系">'+typeLabel+'</span></div></div></div>'
    +'<div class="detail-section"><div class="card-price" style="font-size:1.5rem;margin-bottom:12px">'+price+'</div><div class="detail-grid">'+infoItems.join('')+'</div></div>'
    +(tagsHtml?'<div class="detail-section"><h3>标签</h3><div class="client-tags">'+tagsHtml+'</div></div>':'')
    +(p.highlights?'<div class="detail-section"><h3>📌 基本卖点</h3><div class="timeline-content">'+esc(p.highlights)+'</div></div>':'')
    +(p.preferential?'<div class="detail-section"><h3>🎁 优惠政策</h3><div class="timeline-content">'+esc(p.preferential)+'</div></div>':'')
    +(p.viewingRule?'<div class="detail-section"><h3>🚪 带看规则</h3><div class="timeline-content">'+esc(p.viewingRule)+'</div></div>':'')
    +(p.description?'<div class="detail-section"><h3>描述</h3><div class="timeline-content">'+esc(p.description)+'</div></div>':'')
    +(p.type==='newdev'&&p.showroomAreas&&p.showroomAreas.length?buildShowroomHtml(p):'')
    +'<div class="detail-section"><h3>匹配客户推荐</h3><div>'+matchedHtml+'</div></div>';
  document.getElementById('propDetailModal').classList.add('show');
  /* 新楼盘详情页显示"录入楼盘信息"按钮 */
  var smartDetailBtn=document.getElementById('smartPropDetailBtn');
  if(smartDetailBtn){
    smartDetailBtn.style.display=(p.type==='newdev')?'':'none';
  }
  // Media handlers
  var uploadArea=document.getElementById('mediaUpload');
  var fileInput=document.createElement('input');fileInput.type='file';fileInput.multiple=true;fileInput.accept='image/*,video/*';fileInput.style.display='none';
  uploadArea.appendChild(fileInput);
  uploadArea.addEventListener('click',function(){fileInput.click()});
  uploadArea.addEventListener('dragover',function(e){e.preventDefault();uploadArea.style.borderColor='var(--primary)';uploadArea.style.background='var(--primary-light)'});
  uploadArea.addEventListener('dragleave',function(){uploadArea.style.borderColor='';uploadArea.style.background=''});
  uploadArea.addEventListener('drop',function(e){e.preventDefault();uploadArea.style.borderColor='';uploadArea.style.background='';if(e.dataTransfer.files.length)handleMediaUpload(id,e.dataTransfer.files)});
  fileInput.addEventListener('change',function(){if(this.files.length)handleMediaUpload(id,this.files);this.value=''});
  renderMediaGallery(id);
  document.querySelectorAll('[data-client-id]').forEach(function(el){
    el.addEventListener('click',function(){closeModal('propDetailModal');setTimeout(function(){showClientDetail(el.getAttribute('data-client-id'))},200)});
  });
  // Showroom handlers (新楼盘样板房)
  if(p.type==='newdev'&&p.showroomAreas&&p.showroomAreas.length){
    setupShowroomHandlers(id,p.showroomAreas);
  }
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
      gallery.innerHTML='<p style="text-align:center;padding:16px;color:var(--gray-400);font-size:.8125rem">暂无图片/视频，点击上方区域上传</p>';
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
    +'<p style="font-size:.75rem;color:var(--text-muted);margin-bottom:10px">按面积段分类管理样板房视频，体验样板房（带软装）与交付样板房分开管理</p>'
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
      upload.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" stroke-width="1.5" style="margin:0 auto;display:block"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><p>上传视频/图片</p>';
      var fileInput=document.createElement('input');
      fileInput.type='file';fileInput.multiple=true;fileInput.accept='image/*,video/*';fileInput.style.display='none';
      upload.appendChild(fileInput);
      upload.addEventListener('click',function(){fileInput.click()});
      upload.addEventListener('dragover',function(e){e.preventDefault();upload.style.borderColor='var(--primary)';upload.style.background='var(--primary-light)'});
      upload.addEventListener('dragleave',function(){upload.style.borderColor='';upload.style.background=''});
      upload.addEventListener('drop',function(e){e.preventDefault();upload.style.borderColor='';upload.style.background='';if(e.dataTransfer.files.length)handleShowroomUpload(propId,area,type,e.dataTransfer.files)});
      fileInput.addEventListener('change',function(){if(this.files.length)handleShowroomUpload(propId,area,type,this.files);this.value=''});
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
    var price=p.type==='secondhand'?(p.totalPrice?p.totalPrice+'万':'面议'):(p.averagePrice?p.averagePrice+'元/㎡':'面议');
    var rows=p.type==='secondhand'?[
      ['小区',p.community],['面积',p.area?p.area+'㎡':''],['户型',p.layout],['楼层',p.floor+(p.totalFloors?'/'+p.totalFloors:'')+'层'],
      ['朝向',p.orientation],['装修',p.decoration],['总价',price],['单价',p.unitPrice?p.unitPrice+'元/㎡':''],
      ['学区',p.school],['地铁',p.metro]
    ]:[
      ['开发商',p.developer],['均价',price],['开盘',p.openingDate],['交房',p.deliveryDate],
      ['户型',p.availableLayouts],['绿化率',p.greenRate],['容积率',p.plotRatio]
    ].filter(function(r){return r[1]});
    var rowsHtml=rows.map(function(r){return'<div class="share-info-row"><span class="lbl">'+esc(r[0])+'</span><span class="val">'+esc(r[1])+'</span></div>'}).join('');
    document.getElementById('shareModalBody').innerHTML=
      '<div class="share-view"><div class="share-header"><h2>'+esc(p.title)+'</h2><p>'+esc(p.district)+(p.address?' · '+esc(p.address):'')+'</p></div>'
      +'<div class="share-body">'+(firstImg?'<img class="share-img" src="'+firstImg.dataUrl+'">':'')
      +rowsHtml
      +(p.description?'<div class="share-desc">'+esc(p.description)+'</div>':'')
      +'</div><div class="share-footer">档案卡 · '+(S.currentUser?S.currentUser.name:'小闻哥')+(S.currentUser&&S.currentUser.phone?' '+S.currentUser.phone:'')+'</div></div>';
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
  document.getElementById('txResultCount').innerHTML='共 <b>'+list.length+'</b> 条成交记录';
  if(list.length===0){
    grid.innerHTML='<div class="empty" style="grid-column:1/-1"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg><h3>'+(S.transactions.length===0?'还没有成交记录':'没有符合条件的记录')+'</h3><p>'+(S.transactions.length===0?'点击「录入成交」按钮，记录第一笔成交':'试试调整筛选条件')+'</p></div>';
    return;
  }
  var typeNames={newdev:'新房',secondhand:'二手房',other:'其他'};
  grid.innerHTML=list.map(function(t){
    return'<div class="tx-card" data-dealtype="'+esc(t.dealType)+'" data-id="'+t.id+'">'
      +'<div class="tx-card-top"><div><div class="tx-client">'+esc(t.clientName)+' <span class="deal-type-badge" data-type="'+esc(t.dealType)+'">'+esc(typeNames[t.dealType]||'其他')+'</span></div>'
      +'<div class="tx-prop">'+esc(t.propertyTitle||'—')+'</div></div>'
      +'<div class="tx-price">'+(t.transactionPrice?t.transactionPrice+'<span style="font-size:.6875rem;color:var(--text-muted);font-weight:400">万</span>':'面议')+'</div></div>'
      +'<div class="tx-meta"><span>📅 '+fmtDate(t.transactionDate)+'</span>'+(t.commission?'<span>💰 佣金 <b style="color:var(--warning)">'+t.commission+'元</b></span>':'')+(t.commissionRate?'<span>佣金率 '+t.commissionRate+'%</span>':'')+'<span>录入 '+fmtDate(t.createdAt)+'</span></div>'
      +'</div>';
  }).join('');
  grid.querySelectorAll('.tx-card').forEach(function(card){
    card.addEventListener('click',function(){showTxDetail(card.getAttribute('data-id'))});
  });
}
function openTxForm(id){
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
  t.updatedAt=now();
  if(!isEdit){t.id=uuid();t.createdAt=now();t.createdBy=S.currentUser?S.currentUser.id:'';t.createdByName=S.currentUser?S.currentUser.name:'';S.transactions.push(t)}
  else if(!t.createdBy&&S.currentUser){t.createdBy=S.currentUser.id;t.createdByName=S.currentUser.name}
  // Update client status to 已成交
  if(clientId){var c=findClient(clientId);if(c&&c.status!=='已成交'){c.status='已成交';c.updatedAt=now();saveC()}}
  // Update property status
  if(propertyId){var p=findProp(propertyId);if(p){p.status='已售';p.updatedAt=now();saveP()}}
  saveT();closeModal('txFormModal');renderTxList();toast(isEdit?'成交记录已更新':'成交记录已添加','success');
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
    +(t.propertyId?'<div class="detail-section"><h3>关联房源</h3><div class="viewing-item" style="cursor:pointer" data-tx-prop="'+t.propertyId+'"><div class="vi-top"><span class="vi-prop">查看房源详情</span></div></div></div>':'');
  document.getElementById('txDetailModal').classList.add('show');
  var clientLink=document.querySelector('[data-tx-client]');
  if(clientLink)clientLink.addEventListener('click',function(){closeModal('txDetailModal');setTimeout(function(){showClientDetail(clientLink.getAttribute('data-tx-client'))},200)});
  var propLink=document.querySelector('[data-tx-prop]');
  if(propLink)propLink.addEventListener('click',function(){closeModal('txDetailModal');setTimeout(function(){showPropertyDetail(propLink.getAttribute('data-tx-prop'))},200)});
}

/* ========== Dashboard ========== */
function renderDashboard(){
  var totalC=S.clients.length,totalP=S.properties.length,gA=0,closed=0,onSale=0;
  var sources={},statuses={待联系:0,已联系:0,看房中:0,谈判中:0,已成交:0,暂缓:0};
  var grades={A:0,B:0,C:0};
  S.clients.forEach(function(c){
    if(c.grade==='A')gA++;if(c.status==='已成交')closed++;
    sources[c.source]=(sources[c.source]||0)+1;
    if(statuses[c.status]!==undefined)statuses[c.status]++;
    if(grades[c.grade]!==undefined)grades[c.grade]++;
  });
  S.properties.forEach(function(p){if(p.status==='在售'||p.status==='待售')onSale++});
  var totalT=S.transactions.length,totalVol=0,totalComm=0;
  S.transactions.forEach(function(t){totalVol+=t.transactionPrice||0;totalComm+=t.commission||0});
  var txByType={newdev:0,secondhand:0,other:0};
  S.transactions.forEach(function(t){if(txByType[t.dealType]!==undefined)txByType[t.dealType]++});
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
    return'<div class="bar-row"><span class="bar-label">'+esc(x.k)+'</span><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:'+(srcColors[i%srcColors.length])+'">'+x.v+'</div></div></div>';
  }).join('');
  var gradeMax=Math.max(grades.A,grades.B,grades.C,1);
  var gradeHtml=['A','B','C'].map(function(g){
    var pct=Math.round(grades[g]/gradeMax*100);
    var c=g==='A'?'#dc2626':g==='B'?'#f59e0b':'#2563eb';
    return'<div class="bar-row"><span class="bar-label">'+g+'级</span><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:'+c+'">'+grades[g]+'</div></div></div>';
  }).join('');
  // Recent activity
  var activities=[];
  S.clients.forEach(function(c){(c.followUps||[]).forEach(function(f){activities.push({time:f.date,text:'['+c.name+'] 跟进: '+f.content.slice(0,40)})});
    (c.viewings||[]).forEach(function(v){activities.push({time:v.date,text:'['+c.name+'] 带看: '+v.propertyTitle})})});
  S.transactions.forEach(function(t){activities.push({time:t.createdAt||t.transactionDate,text:'[成交] '+t.clientName+' · '+t.propertyTitle+' · '+(t.transactionPrice||0)+'万'})});
  activities.sort(function(a,b){return b.time-a.time});
  var actHtml=activities.slice(0,10).map(function(a){return'<div class="activity-item"><span class="a-time">'+fmtDate(a.time)+'</span><span class="a-text">'+esc(a.text)+'</span></div>'}).join('')||'<div class="timeline-empty">暂无活动</div>';
  // Reminders (clickable)
  var reminderHtml=S.dueReminders.map(function(r){
    return'<div class="activity-item" style="cursor:pointer" data-dash-client="'+r.client.id+'"><span class="a-time" style="color:var(--danger)">'+fmtDate(r.followup.reminderDate)+'</span><span class="a-text">['+esc(r.client.name)+'] '+esc(r.followup.content.slice(0,30))+'</span></div>';
  }).join('')||'<div class="timeline-empty">暂无待提醒事项</div>';
  // Today tasks (clients needing follow-up)
  var todayTasks=S.clients.filter(function(c){return needFollowup(c)}).sort(function(a,b){
    var la=lastFollowup(a)||a.updatedAt||0;var lb=lastFollowup(b)||b.updatedAt||0;return la-lb;
  });
  var todayHtml=todayTasks.slice(0,8).map(function(c){
    var lf=lastFollowup(c);var days=lf?daysSince(lf):999;
    return'<div class="today-task-item" data-dash-client="'+c.id+'"><span class="tt-name">'+esc(c.name)+'</span><span class="tt-info">'+esc(c.grade)+'级 · '+(lf?relDate(lf):'未跟进')+'</span><span class="tt-badge">需跟进</span></div>';
  }).join('')||'<div class="timeline-empty">暂无需要跟进的客户</div>';
  document.getElementById('dashboardContent').innerHTML=
    '<div class="dash-card"><h3>📊 数据概览</h3><div class="dash-stats"><div class="dash-stat"><div class="num" style="color:var(--primary)">'+totalC+'</div><div class="lbl">总客户</div></div><div class="dash-stat"><div class="num" style="color:var(--danger)">'+gA+'</div><div class="lbl">A级客户</div></div><div class="dash-stat"><div class="num" style="color:var(--success)">'+closed+'</div><div class="lbl">已成交</div></div><div class="dash-stat"><div class="num" style="color:var(--teal)">'+totalP+'</div><div class="lbl">总房源</div></div><div class="dash-stat"><div class="num" style="color:var(--purple)">'+totalT+'</div><div class="lbl">成交记录</div></div></div></div>'
    +'<div class="dash-card"><h3>💰 成交统计</h3><div class="dash-stats"><div class="dash-stat"><div class="num" style="color:var(--danger)">'+totalVol.toFixed(0)+'</div><div class="lbl">成交总额(万)</div></div><div class="dash-stat"><div class="num" style="color:var(--warning)">'+totalComm.toFixed(0)+'</div><div class="lbl">佣金收入(元)</div></div><div class="dash-stat"><div class="num" style="color:var(--purple)">'+txByType.newdev+'</div><div class="lbl">新房成交</div></div><div class="dash-stat"><div class="num" style="color:var(--primary)">'+txByType.secondhand+'</div><div class="lbl">二手成交</div></div></div></div>'
    +'<div class="dash-card"><h3>📋 今日待办（需跟进客户）</h3>'+todayHtml+'</div>'
    +'<div class="dash-card"><h3>🔥 客户成交漏斗</h3><div class="funnel">'+funnelHtml+'</div></div>'
    +'<div class="dash-card"><h3>📥 客户来源分布</h3><div class="bar-chart">'+srcHtml+'</div></div>'
    +'<div class="dash-card"><h3>⭐ 客户等级分布</h3><div class="bar-chart">'+gradeHtml+'</div></div>'
    +'<div class="dash-card"><h3>🏠 房源统计</h3><div class="detail-grid">'+di('在售/待售',onSale)+di('二手房',S.properties.filter(function(p){return p.type==='secondhand'}).length)+di('新楼盘',S.properties.filter(function(p){return p.type==='newdev'}).length)+di('总房源',totalP)+'</div></div>'
    +'<div class="dash-card"><h3>⏰ 待提醒跟进</h3>'+reminderHtml+'</div>'
    +'<div class="dash-card"><h3>📝 最近活动</h3>'+actHtml+'</div>';
  // Click handlers for dashboard items
  document.querySelectorAll('[data-dash-client]').forEach(function(el){
    el.addEventListener('click',function(){
      var cid=el.getAttribute('data-dash-client');
      switchTab('clients');
      setTimeout(function(){showClientDetail(cid)},200);
    });
  });
}

/* ========== Reminders ========== */
function checkReminders(){
  S.dueReminders=[];var today=new Date();today.setHours(0,0,0,0);
  S.clients.forEach(function(c){(c.followUps||[]).forEach(function(f){
    if(f.reminderDate){var rd=new Date(f.reminderDate);rd.setHours(0,0,0,0);if(rd<=today)S.dueReminders.push({client:c,followup:f})}
  })});
  var badge=document.getElementById('reminderBadge');
  var badgeM=document.getElementById('reminderBadgeMobile');
  var show=S.dueReminders.length>0;
  if(badge)badge.style.display=show?'':'none';
  if(badgeM)badgeM.style.display=show?'':'none';
  if(show){
    if('Notification' in window&&Notification.permission==='granted'){
      new Notification('客户跟进提醒',{body:'有 '+S.dueReminders.length+' 条待跟进提醒'});
    }
  }
}

/* ========== Export / Import ========== */
function exportJSON(){
  var data=JSON.stringify({clients:S.clients,properties:S.properties,transactions:S.transactions,version:3},null,2);
  var blob=new Blob([data],{type:'application/json'});
  downloadBlob(blob,'档案卡备份_'+fmtDate(now()).replace(/-/g,'')+'.json');
  toast('备份文件已导出','success');
}
function exportCSV(){
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
  var total=S.clients.length+S.properties.length+S.transactions.length;
  if(total===0){toast('当前没有数据');return}
  confirmDialog('清空全部数据','将删除全部 '+total+' 条记录（客户+房源+成交+媒体），不可恢复！',function(){
    S.properties.forEach(function(p){MediaDB.removeAll(p.id)});
    S.clients=[];S.properties=[];S.transactions=[];saveC();saveP();saveT();
    if(SYNC_ENABLED&&S.currentUser){
      fetch(API_BASE+'/api/sync',{method:'POST',headers:getAuthHeader(),body:JSON.stringify({clients:[],properties:[],transactions:[]})}).catch(function(){});
    }
    renderClientList();renderPropertyList();renderTxList();closeModal('settingsModal');toast('全部数据已清空','success');
  });
}

/* ========== Event Handlers ========== */
function setupHandlers(){
  /* 安全绑定函数 — 元素不存在时跳过而非崩溃 */
  function sb(id,evt,fn){var el=document.getElementById(id);if(el)el.addEventListener(evt,fn);else console.warn('[setupHandlers] 元素不存在:',id)}
  try{
  // Tabs - sidebar nav items
  document.querySelectorAll('.sidebar-nav-item').forEach(function(t){t.addEventListener('click',function(){switchTab(t.getAttribute('data-tab'))})});
  // Tabs - bottom nav items
  document.querySelectorAll('.bottom-nav-item').forEach(function(t){t.addEventListener('click',function(){
    var tab=t.getAttribute('data-tab');
    if(tab==='settings'){document.getElementById('settingsModal').classList.add('show')}
    else{switchTab(tab)}
  })});
  document.querySelectorAll('.subtab').forEach(function(t){t.addEventListener('click',function(){switchSubtab(t.getAttribute('data-subtab'))})});
  // Search - desktop
  var st;document.getElementById('searchInput').addEventListener('input',function(){clearTimeout(st);var v=this.value;st=setTimeout(function(){S.search=v;if(S.tab==='clients')renderClientList();if(S.tab==='properties')renderPropertyList();if(S.tab==='transactions')renderTxList()},200)});
  // Search - mobile
  var stm;var searchInputMobile=document.getElementById('searchInputMobile');
  if(searchInputMobile)searchInputMobile.addEventListener('input',function(){clearTimeout(stm);var v=this.value;stm=setTimeout(function(){S.search=v;if(S.tab==='clients')renderClientList();if(S.tab==='properties')renderPropertyList();if(S.tab==='transactions')renderTxList()},200)});
  // Mobile search toggle
  var mobileSearchBtn=document.getElementById('mobileSearchBtn');
  if(mobileSearchBtn)mobileSearchBtn.addEventListener('click',function(){document.getElementById('mobileSearchOverlay').style.display='flex';document.getElementById('searchInputMobile').focus()});
  var closeMobileSearch=document.getElementById('closeMobileSearch');
  if(closeMobileSearch)closeMobileSearch.addEventListener('click',function(){document.getElementById('mobileSearchOverlay').style.display='none';document.getElementById('searchInputMobile').value='';S.search='';if(S.tab==='clients')renderClientList();if(S.tab==='properties')renderPropertyList();if(S.tab==='transactions')renderTxList()});
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
    document.getElementById('smartParseHint').textContent='已识别 '+S.smartClients.length+' 位客户，请检查后点击「全部录入」';
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
    if(e.target.files[0])handleSmartFileUpload(e.target.files[0],'smartFileHint');
    e.target.value='';
  });
  document.getElementById('addPropBtn').addEventListener('click',function(){
    if(S.subtab==='community'){openCommunityForm('')}else{openPropertyForm()}
  });
  document.getElementById('smartPropInputBtn').addEventListener('click',function(){
    if(S.subtab==='community'){openCommunitySmartInput()}else{openSmartPropInput()}
  });
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
    /* 解析后统计字段特征，仅用作"上传内容是否和当前 tab 匹配"的提示，不会切换 type */
    var typeStats=autoDetectPropType(S.smartProps);
    var tabLabel=S.subtab==='newdev'?'新楼盘':(S.subtab==='secondhand'?'二手房':'');
    var typeHint='（已锁定为'+tabLabel+'）';
    var warnHint='';
    if(typeStats.typeMismatch){
      warnHint='⚠️ 检测到 '+typeStats.mismatch+' 条数据含有'+(S.subtab==='newdev'?'二手':'新楼盘')+'特征字段，请确认是否上传到正确 tab（数据仍按'+tabLabel+'录入）';
    }
    document.getElementById('smartPropParseHint').innerHTML='已识别 <b>'+S.smartProps.length+'</b> 套房源 '+typeHint+'，请检查后点击「全部录入」'+(warnHint?'<div style="margin-top:6px;color:var(--warning);font-weight:600">'+warnHint+'</div>':'');
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
    document.getElementById('smartPropFileHint').textContent='支持 Excel/CSV 表格、文本文件、含文字截图照片';
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
  document.getElementById('fab').addEventListener('click',function(){if(S.tab==='clients')openClientForm();if(S.tab==='properties')openPropertyForm();if(S.tab==='transactions')openTxForm()});
  // Save
  document.getElementById('saveClientBtn').addEventListener('click',saveClient);
  document.getElementById('savePropBtn').addEventListener('click',saveProperty);
  // Property form: type change & unit price calc
  document.getElementById('pfTotalPrice').addEventListener('input',calcUnitPrice);
  document.getElementById('pfArea').addEventListener('input',calcUnitPrice);
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
  document.getElementById('editClientBtn').addEventListener('click',function(){closeModal('clientDetailModal');setTimeout(function(){openClientForm(S.curClientId)},200)});
  document.getElementById('deleteClientBtn').addEventListener('click',function(){
    var c=findClient(S.curClientId);if(!c)return;
    confirmDialog('删除客户','确定要删除「'+c.name+'」吗？此操作不可恢复。',function(){S.clients=S.clients.filter(function(x){return x.id!==S.curClientId});saveC();closeModal('clientDetailModal');renderClientList();toast('客户已删除','success')});
  });
  // Property detail: edit & delete & share
  document.getElementById('editPropBtn').addEventListener('click',function(){closeModal('propDetailModal');setTimeout(function(){openPropertyForm(S.curPropId)},200)});
  document.getElementById('smartPropDetailBtn').addEventListener('click',function(){
    closeModal('propDetailModal');
    setTimeout(function(){openSmartPropInput('single',S.curPropId)},200);
  });
  document.getElementById('deletePropBtn').addEventListener('click',function(){
    var p=findProp(S.curPropId);if(!p)return;
    confirmDialog('删除房源','确定要删除「'+p.title+'」吗？相关图片视频也会删除。',function(){MediaDB.removeAll(S.curPropId);S.properties=S.properties.filter(function(x){return x.id!==S.curPropId});saveP();closeModal('propDetailModal');renderPropertyList();toast('房源已删除','success')});
  });
  document.getElementById('sharePropBtn').addEventListener('click',function(){copyPropertyInfo(S.curPropId)});
  document.getElementById('shareCardBtn').addEventListener('click',function(){showShareView(S.curPropId)});
  document.getElementById('copyShareBtn').addEventListener('click',function(){copyPropertyInfo(S.curPropId)});
  // Settings
  document.getElementById('settingsBtn').addEventListener('click',function(){document.getElementById('settingsModal').classList.add('show')});
  var sbm=document.getElementById('settingsBtnMobile');
  if(sbm)sbm.addEventListener('click',function(){document.getElementById('settingsModal').classList.add('show')});
  document.getElementById('exportJSON').addEventListener('click',exportJSON);
  document.getElementById('exportCSV').addEventListener('click',exportCSV);
  document.getElementById('clearAll').addEventListener('click',clearAll);
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
      S.transactions=S.transactions.filter(function(x){return x.id!==S.curTxId});saveT();
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
  /* userManageBtn handler 已在上方 userMgmtBtn 处注册，此处不再重复 */
  var savePwBtnEl=document.getElementById('savePwBtn');
  if(savePwBtnEl)savePwBtnEl.addEventListener('click',function(){
    var old=document.getElementById('pwOld').value;
    var npw=document.getElementById('pwNew').value;
    var cf=document.getElementById('pwNewConfirm').value;
    if(!checkPw(old)){toast('当前密码错误','error');return}
    if(npw.length<4){toast('新密码至少4位','error');return}
    if(npw!==cf){toast('两次新密码不一致','error');return}
    setPw(npw);closeModal('pwChangeModal');toast('密码已修改','success');
  });
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
  // 登录成功后从服务器加载数据
  loadFromServer().then(function(serverData){
    var serverEmpty=(serverData&&serverData.clients&&serverData.clients.length===0&&serverData.properties&&serverData.properties.length===0);
    if(serverData&&serverData.clients&&(serverData.clients.length>0||serverData.properties&&serverData.properties.length>0)){
      S.clients=serverData.clients.map(migrateClient);
      S.properties=serverData.properties||[];
      S.transactions=serverData.transactions||[];
      localStorage.setItem(SK_C,JSON.stringify(S.clients));
      localStorage.setItem(SK_P,JSON.stringify(S.properties));
      localStorage.setItem(SK_T,JSON.stringify(S.transactions));
      if(serverData.allUsers)S.allUsers=serverData.allUsers;
      console.log('[初始化] 已从云端加载:',S.clients.length,'客户,',S.properties.length,'房源');
    }else if(serverEmpty){
      // 服务器数据为空 — 可能是云平台重启后数据丢失
      // 从本地缓存恢复数据，然后自动上传到服务器
      loadC();loadP();loadT();
      if(S.clients.length>0||S.properties.length>0||S.transactions.length>0){
        console.log('[初始化] 服务器数据为空，从本地恢复并上传:',S.clients.length,'客户,',S.properties.length,'房源');
        if(serverData.allUsers)S.allUsers=serverData.allUsers;
        setTimeout(function(){syncToServer();toast('已从本地恢复数据到云端','success')},1000);
      }else{
        if(serverData.allUsers)S.allUsers=serverData.allUsers;
        console.log('[初始化] 服务器和本地均为空');
      }
    }else{
      // 服务器不可用，从本地加载
      loadC();loadP();loadT();
      console.log('[初始化] 服务器不可用，使用本地缓存');
    }
    MediaDB.init().then(function(){
      setupHandlers();
      checkReminders();
      setInterval(checkReminders,300000);
      updateRoleUI();
      renderClientList();
    });
  });
}

function init(){
  // 检查是否有已保存的登录token
  var token=localStorage.getItem(SK_AUTH);
  if(!token){
    // 没有token，显示登录页
    MediaDB.init().then(function(){
      setupHandlers();
      showLoginScreen();
    });
    return;
  }
  // 有token，尝试验证并加载数据
  loadFromServer().then(function(serverData){
    if(serverData&&serverData.clients){
      // token有效
      var serverEmpty=(serverData.clients.length===0&&(serverData.properties||[]).length===0);
      if(serverEmpty){
        // 服务器数据为空 — 可能是云平台重启后数据丢失，从本地恢复
        loadC();loadP();loadT();
        if(S.clients.length>0||S.properties.length>0||S.transactions.length>0){
          console.log('[初始化] 服务器数据为空，从本地恢复并上传');
          setTimeout(function(){syncToServer()},1500);
        }
      }else{
        S.clients=serverData.clients.map(migrateClient);
        S.properties=serverData.properties||[];
        S.transactions=serverData.transactions||[];
        localStorage.setItem(SK_C,JSON.stringify(S.clients));
        localStorage.setItem(SK_P,JSON.stringify(S.properties));
        localStorage.setItem(SK_T,JSON.stringify(S.transactions));
      }
      if(serverData.allUsers)S.allUsers=serverData.allUsers;
      // 从token解析用户信息
      try{
        var decoded=atob(token);
        var userId=decoded.split(':')[0];
        var userMatch=(serverData.allUsers||[]).find(function(u){return u.id===userId});
        S.currentUser=userMatch||{id:userId,name:'未知',role:userId==='admin'?'admin':'member'};
      }catch(e){
        S.currentUser={id:'admin',name:'管理员',role:'admin'};
      }
      console.log('[初始化] 已登录为:',S.currentUser.name);
      MediaDB.init().then(function(){
        setupHandlers();
        checkReminders();
        setInterval(checkReminders,300000);
        updateRoleUI();
        renderClientList();
      });
    }else{
      // 服务器不可用或token已被doLogout清除
      var stillHasToken=localStorage.getItem(SK_AUTH);
      if(stillHasToken){
        // 服务器不可达但token还在（网络波动），用本地缓存继续使用
        console.log('[初始化] 服务器不可达，使用本地缓存+已保存的登录状态');
        var savedUser=localStorage.getItem(SK_USER);
        if(savedUser){try{S.currentUser=JSON.parse(savedUser)}catch(e){S.currentUser={id:'admin',name:'管理员',role:'admin'}}}
        else{S.currentUser={id:'admin',name:'管理员',role:'admin'}}
        loadC();loadP();loadT();
        MediaDB.init().then(function(){
          setupHandlers();
          checkReminders();
          setInterval(checkReminders,300000);
          updateRoleUI();
          renderClientList();
        });
      }else{
        // token已被doLogout清除（服务器返回了401），需要重新登录
        MediaDB.init().then(function(){
          setupHandlers();
          showLoginScreen();
        });
      }
    }
  });
}

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

init();
})();
