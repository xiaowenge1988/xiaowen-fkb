/* ===== 客户房源管理系统 - 核心逻辑 ===== */
(function(){
'use strict';

/* ========== Config ========== */
var AREAS=['临平','余杭','萧山','拱墅','西湖','上城','滨江','钱塘','富阳','临安'];
var SK_C='xwg_fkb_clients_v6', SK_P='xwg_fkb_props_v6', SK_T='xwg_fkb_tx_v6', SK_AUTH='xwg_fkb_auth_v6', SK_USER='xwg_fkb_user_v6';

/* ========== State ========== */
var S={
  clients:[], properties:[], transactions:[], search:'', filters:{}, propFilters:{}, txFilters:{},
  sort:'updatedAt', propSort:'updatedAt', txSort:'transactionDate', tab:'clients', subtab:'secondhand',
  curClientId:null, curPropId:null, curTxId:null, editClientId:null, editPropId:null, editTxId:null,
  editTags:[], editPhones:[], editAreas:[], editPropTags:[], editAreaSegs:[],
  mediaList:[], mediaIdx:0, dueReminders:[], currentUser:null, allUsers:[], filterCreatedBy:'', smartClients:[], clientView:'card', pinnedIds:[], propViewMode:'card', smartProps:[], pinnedPropIds:[]
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
      if(SYNC_ENABLED&&S.currentUser){
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
  S.subtab=sub;
  document.querySelectorAll('.subtab').forEach(function(el){el.classList.remove('active')});
  document.querySelector('[data-subtab="'+sub+'"]').classList.add('active');
  renderPropertyList();
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
  if(f.tag)list=list.filter(function(c){return(c.customTags||[]).indexOf(f.tag)>=0});
  if(f.needFollow){var d=parseInt(f.needFollow);list=list.filter(function(c){
    if(c.status==='已成交'||c.status==='暂缓')return false;
    var l=lastFollowup(c)||c.updatedAt||c.createdAt;return daysSince(l)>=d;
  })}
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

function openSmartPropInput(){
  document.getElementById('smartPropArea').value='';
  document.getElementById('smartPropPreviewWrap').style.display='none';
  document.getElementById('smartPropParseHint').textContent='';
  document.getElementById('smartPropInputModal').classList.add('show');
  setTimeout(function(){document.getElementById('smartPropArea').focus()},100);
}

function parseSmartProp(text){
  var lines=text.trim().split(/\n/);
  var results=[];
  var headers=null;

  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();
    if(!line)continue;

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
    if(i===0&&isPropHeaderRow(fields)){
      headers=mapPropHeaders(fields);
      continue;
    }

    var prop={title:'',community:'',developer:'',district:'',address:'',totalPrice:0,area:0,layout:'',floor:'',totalFloors:'',orientation:'',decoration:'',buildingAge:'',propertyRights:'',hasKey:false,viewingMethod:'',school:'',metro:'',ownerName:'',ownerPhone:'',type:S.subtab||'secondhand',status:'在售',tags:[],description:'',averagePrice:0};

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

    /* fallback: extract phone from raw line if not found */
    if(!prop.ownerPhone){
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
      results.push(prop);
    }
  }

  return results;
}

function isPropHeaderRow(fields){
  var kw=['小区','名称','标题','房源','面积','户型','总价','价格','均价','楼层','朝向','装修','区域','地址','业主','电话','手机','状态','备注','描述','建成','产权','钥匙','学区','地铁','标签','开发商'];
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
    if(f.indexOf('小区')>=0||f.indexOf('名称')>=0||f.indexOf('标题')>=0||f.indexOf('房源名')>=0)m.push('title');
    else if(f.indexOf('面积')>=0)m.push('area');
    else if(f.indexOf('户型')>=0||f.indexOf('房型')>=0)m.push('layout');
    else if(f.indexOf('总价')>=0||f.indexOf('价格')>=0&&f.indexOf('均价')<0)m.push('totalPrice');
    else if(f.indexOf('均价')>=0)m.push('averagePrice');
    else if(f.indexOf('楼层')>=0)m.push('floor');
    else if(f.indexOf('总楼层')>=0)m.push('totalFloors');
    else if(f.indexOf('朝向')>=0)m.push('orientation');
    else if(f.indexOf('装修')>=0)m.push('decoration');
    else if(f.indexOf('区域')>=0||f.indexOf('地段')>=0)m.push('district');
    else if(f.indexOf('地址')>=0)m.push('address');
    else if(f.indexOf('业主')>=0&&f.indexOf('电话')<0&&f.indexOf('手机')<0)m.push('ownerName');
    else if((f.indexOf('业主')>=0||f.indexOf('联系')>=0)&&(f.indexOf('电话')>=0||f.indexOf('手机')>=0))m.push('ownerPhone');
    else if(f.indexOf('电话')>=0||f.indexOf('手机')>=0)m.push('ownerPhone');
    else if(f.indexOf('建成')>=0||f.indexOf('年代')>=0)m.push('buildingAge');
    else if(f.indexOf('产权')>=0)m.push('propertyRights');
    else if(f.indexOf('钥匙')>=0)m.push('hasKey');
    else if(f.indexOf('看房')>=0)m.push('viewingMethod');
    else if(f.indexOf('学区')>=0)m.push('school');
    else if(f.indexOf('地铁')>=0)m.push('metro');
    else if(f.indexOf('开发商')>=0)m.push('developer');
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
  if(key.indexOf('状态')>=0)return'status';
  if(key.indexOf('备注')>=0||key.indexOf('描述')>=0||key.indexOf('说明')>=0)return'description';
  return'';
}

function assignPropField(prop,key,val){
  val=(val||'').trim();
  if(!val)return;
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
      var tp=parseFloat(val.replace(/[^0-9.]/g,''));
      if(tp>0)prop.totalPrice=tp;
      break;
    case'averagePrice':
      var ap=parseInt(val.replace(/[^0-9]/g,''));
      if(ap>0)prop.averagePrice=ap;
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
      prop.description=val;
      break;
  }
}

function autoDetectPropFields(prop,fields,rawLine){
  for(var i=0;i<fields.length;i++){
    var f=fields[i].trim();
    if(!f)continue;

    /* phone number */
    if(f.match(/1[3-9]\d{9}/)){
      if(!prop.ownerPhone)prop.ownerPhone=f.match(/1[3-9]\d{9}/)[0];
      continue;
    }

    /* area: XX㎡ */
    if(f.match(/^\d+(\.\d+)?\s*㎡?$/)||f.match(/^\d+(\.\d+)?\s*平方?$/)){
      var ar=parseFloat(f.replace(/[^0-9.]/g,''));
      if(ar>0&&ar<10000){prop.area=ar;if(!prop.title&&prop.community)prop.title=prop.community+ar+'㎡';continue}
    }

    /* total price: XX万 or XXw */
    if(f.match(/^\d+(\.\d+)?\s*万?$/)||f.match(/^\d{2,4}w?$/i)){
      var tp=parseFloat(f.replace(/[^0-9.]/g,''));
      if(tp>0&&tp<100000){prop.totalPrice=tp;continue}
    }

    /* average price: XX元/㎡ or XXXXX */
    if(f.indexOf('元')>=0&&f.indexOf('㎡')>=0){
      var ap=parseInt(f.replace(/[^0-9]/g,''));
      if(ap>0)prop.averagePrice=ap;
      continue;
    }

    /* floor: X/Y层 */
    if(f.match(/^\d+\s*[\/／]\s*\d+/)||f.match(/^\d+层?$/)){
      var fm=f.match(/(\d+)\s*[\/／]?\s*(\d+)?/);
      if(fm){prop.floor=fm[1];if(fm[2])prop.totalFloors=fm[2]}
      continue;
    }

    /* orientation */
    var orFound=false;
    for(var d=0;d<ORIENTATIONS.length;d++){
      if(f.indexOf(ORIENTATIONS[d])>=0){prop.orientation=ORIENTATIONS[d];orFound=true;break}
    }
    if(orFound)continue;

    /* decoration */
    var decoFound=false;
    for(var d=0;d<DECORATIONS.length;d++){
      if(f.indexOf(DECORATIONS[d])>=0){prop.decoration=DECORATIONS[d];decoFound=true;break}
    }
    if(decoFound)continue;

    /* district */
    var ar2=matchArea(f);
    if(ar2){prop.district=ar2;if(!prop.title&&!prop.community)prop.community=f;continue}

    /* layout: contains 室/厅 */
    if(f.indexOf('室')>=0||f.indexOf('厅')>=0||f.indexOf('居')>=0){
      prop.layout=f;continue;
    }

    /* building age */
    if(f.match(/\d{4}\s*年?建?/)||f.indexOf('年代')>=0||f.indexOf('建成')>=0){
      prop.buildingAge=f;continue;
    }

    /* has key */
    if(f.indexOf('钥匙')>=0||f.indexOf('有钥匙')>=0){
      prop.hasKey=true;continue;
    }

    /* status */
    var stFound=false;
    for(var d=0;d<PROP_STATUSES.length;d++){
      if(f.indexOf(PROP_STATUSES[d])>=0){prop.status=PROP_STATUSES[d];stFound=true;break}
    }
    if(stFound)continue;

    /* community/title: 2+ chars, likely Chinese */
    if(!prop.community&&f.length>=2&&f.match(/^[\u4e00-\u9fa5]/)){
      prop.community=f.replace(/[：:，,]/g,'');
      if(!prop.title)prop.title=f.replace(/[：:，,]/g,'');
      continue;
    }

    /* fallback to description */
    if(f.length>1){
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

  count.textContent='共识别 '+props.length+' 条';
  wrap.style.display='block';

  var html='<table><thead><tr>'+
    '<th style="width:30px">#</th>'+
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

    html+='<tr data-idx="'+i+'">'+
      '<td style="text-align:center;color:var(--text-muted)">'+(i+1)+'</td>'+
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
  rows.forEach(function(row){
    var title=row.querySelector('[data-field="title"]').value.trim();
    var areaStr=row.querySelector('[data-field="area"]').value.trim();
    var layout=row.querySelector('[data-field="layout"]').value.trim();
    var priceStr=row.querySelector('[data-field="totalPrice"]').value.trim();
    var floor=row.querySelector('[data-field="floor"]').value.trim();
    var phone=row.querySelector('[data-field="ownerPhone"]').value.trim();
    var district=row.querySelector('[data-field="district"]').value;

    if(!title&&!phone)return;

    var fm=floor.match(/(\d+)\s*[\/／]?\s*(\d+)?/);
    var floorNum=fm?fm[1]:'';
    var totalFloors=fm&&fm[2]?fm[2]:'';

    props.push({
      title:title||'未命名房源',
      community:title||'',
      type:S.subtab||'secondhand',
      area:parseFloat(areaStr)||0,
      layout:layout,
      totalPrice:parseFloat(priceStr)||0,
      floor:floorNum,
      totalFloors:totalFloors,
      ownerPhone:phone.match(/1[3-9]\d{9}/)?phone.match(/1[3-9]\d{9}/)[0]:phone,
      district:district||'临平',
      status:'在售',
      tags:[],
      description:''
    });
  });
  return props;
}

function batchImportProps(){
  var props=collectSmartProps();
  if(props.length===0){toast('没有可录入的房源','error');return}

  var imported=0,skipped=0;
  for(var i=0;i<props.length;i++){
    var p=props[i];
    if(!p.title){skipped++;continue}

    /* dedup: check if same title+phone already exists */
    var dup=false;
    for(var j=0;j<S.properties.length;j++){
      var ex=S.properties[j];
      if(ex.title===p.title&&p.ownerPhone&&ex.ownerPhone===p.ownerPhone){dup=true;break}
    }
    if(dup){skipped++;continue}

    if(p.area>0)p.unitPrice=p.totalPrice>0?Math.round(p.totalPrice*10000/p.area):0;
    p.id=uuid();p.createdAt=now();p.updatedAt=now();
    p.linkedClientIds=[];
    p.createdBy=S.currentUser?S.currentUser.id:'';
    p.createdByName=S.currentUser?S.currentUser.name:'';
    S.properties.push(p);
    imported++;
  }

  saveP();renderPropertyList();closeModal('smartPropInputModal');
  toast('成功录入 '+imported+' 套房源'+(skipped>0?'，跳过 '+skipped+' 条（信息不全或重复）':''),'success');
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
            var csv=XLSX.utils.sheet_to_csv(ws,{FS:'\t',RS:'\n'});
            allText+=csv+'\n';
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
    hintEl.textContent='正在识别图片文字...';hintEl.style.color='var(--warning)';
    loadTesseract().then(function(worker){
      var reader=new FileReader();
      reader.onload=function(e){
        worker.recognize(e.target.result,'chi_sim+eng').then(function(result){
          var text=result.data.text;
          var ta=document.getElementById(textareaId);
          ta.value=(ta.value?ta.value+'\n':'')+text;
          hintEl.textContent='图片识别完成，请点击「识别数据」';hintEl.style.color='var(--success)';
        }).catch(function(err){
          hintEl.textContent='图片识别失败：'+err.message;hintEl.style.color='var(--danger)';
        });
      };
      reader.readAsDataURL(file);
    }).catch(function(){
      hintEl.textContent='OCR引擎加载失败，请重试或直接粘贴';hintEl.style.color='var(--danger)';
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

function loadTesseract(){
  return new Promise(function(resolve,reject){
    if(window.TesseractWorker){resolve(new TesseractWorker());return}
    var script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload=function(){
      try{
        var worker=new TesseractWorker();
        resolve(worker);
      }catch(err){reject(err)}
    };
    script.onerror=function(){reject(new Error('load failed'))};
    document.head.appendChild(script);
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
  var list=S.properties.filter(function(p){return p.type===S.subtab});
  var f=S.propFilters;var q=S.search.trim().toLowerCase();
  if(q){list=list.filter(function(p){var h=[p.title,p.community,p.developer,p.description,p.address,(p.tags||[]).join(' ')].join(' ').toLowerCase();return h.indexOf(q)>=0})}
  if(f.area)list=list.filter(function(p){return p.district===f.area});
  if(f.status)list=list.filter(function(p){return p.status===f.status});
  if(f.min)list=list.filter(function(p){var pr=p.totalPrice||((p.averagePrice||0)*0.001);return pr>=f.min});
  if(f.max)list=list.filter(function(p){var pr=p.totalPrice||((p.averagePrice||0)*0.001);return pr<=f.max});
  if(f.layout)list=list.filter(function(p){return(p.layout||'').indexOf(f.layout)>=0||(p.availableLayouts||'').indexOf(f.layout)>=0});
  if(f.tag)list=list.filter(function(p){return(p.tags||[]).indexOf(f.tag)>=0});
  var sk=S.propSort;
  list.sort(function(a,b){
    if(sk==='totalPrice')return(a.totalPrice||999999)-(b.totalPrice||999999);
    if(sk==='totalPriceDesc')return(b.totalPrice||0)-(a.totalPrice||0);
    if(sk==='createdAt')return(b.createdAt||0)-(a.createdAt||0);
    return(b.updatedAt||0)-(a.updatedAt||0);
  });
  return list;
}

/* ========== Property: List ========== */
function renderPropertyList(){
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
    var price=p.type==='secondhand'?(p.totalPrice?p.totalPrice+'<span class="unit">万</span>':'面议'):(p.averagePrice?p.averagePrice+'<span class="unit">元/㎡</span>':'面议');
    var info=p.type==='secondhand'?[p.area?p.area+'㎡':'',p.layout||'',p.orientation||''].filter(Boolean):[p.developer||'',p.availableLayouts||''].filter(Boolean);
    var tags=(p.tags||[]).map(function(t){return'<span class="client-tag">'+esc(t)+'</span>'}).join('');
    var propPinned=(S.pinnedPropIds||[]).indexOf(p.id)>=0;
    return'<div class="property-card'+(propPinned?' pinned':'')+'" data-status="'+esc(p.status)+'" data-id="'+p.id+'">'
      +(propPinned?'<div style="position:absolute;top:8px;right:8px;z-index:2;font-size:1rem">⭐</div>':'')
      +'<div class="card-thumb no-img" data-thumb="'+p.id+'"><span class="type-label">'+(p.type==='secondhand'?'二手房':'新楼盘')+'</span><span class="media-count" data-media-count="'+p.id+'" style="display:none"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span class="mc-num">0</span></span></div>'
      +'<div class="card-body"><div class="card-title">'+esc(p.title)+'</div><div class="card-price">'+price+'</div>'
      +'<div class="card-info">'+info.map(function(i){return'<span>'+esc(i)+'</span>'}).join('')+'</div>'
      +(tags?'<div class="prop-tags">'+tags+'</div>':'')
      +'<div class="card-info"><span>'+esc(p.district||'')+'</span><span class="status-badge" data-status="'+esc(p.status)+'">'+esc(p.status)+'</span></div>'
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
      var img=media.find(function(m){return m.type==='image'});
      var el=document.querySelector('[data-thumb="'+p.id+'"]');
      if(img&&el){el.style.backgroundImage='url('+img.dataUrl+')';el.classList.remove('no-img')}
      if(media.length>0){
        var mc=document.querySelector('[data-media-count="'+p.id+'"]');
        if(mc){mc.style.display='';mc.querySelector('.mc-num').textContent=media.length}
      }
    });
  });
}

function renderPropertyTable(){
  var list=getFilteredProperties();
  var table=document.getElementById('propertyTable');
  document.getElementById('propResultCount').innerHTML='共 <b>'+list.length+'</b> 套房源';

  if(list.length===0){
    var isEmptyAll=S.properties.length===0;
    table.innerHTML='<div class="empty" style="padding:40px"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg><h3>'+(isEmptyAll?'还没有房源档案':'没有符合条件的房源')+'</h3><p>'+(isEmptyAll?'点击「新增房源」按钮开始录入':'试试调整筛选条件')+'</p></div>';
    return;
  }

  var html='<div class="client-table-wrap"><table class="client-table"><thead><tr>'
    +'<th style="width:28px"></th>'
    +'<th>类型</th>'
    +'<th>标题/小区</th>'
    +'<th>面积</th>'
    +'<th>户型</th>'
    +'<th>楼层</th>'
    +'<th>朝向/装修</th>'
    +'<th>价格</th>'
    +'<th>区域</th>'
    +'<th>状态</th>'
    +'<th style="min-width:160px">业主/联系</th>'
    +'<th>标签</th>'
    +'<th>录入时间</th>'
    +'<th>操作</th>'
    +'</tr></thead><tbody>';

  for(var i=0;i<list.length;i++){
    var p=list[i];
    var price=p.type==='secondhand'?(p.totalPrice?p.totalPrice+'万':'面议'):(p.averagePrice?p.averagePrice+'元/㎡':'面议');
    var isSold=p.status==='已售'||p.status==='售罄';
    var isOff=p.status==='下架';
    var tagsHtml=(p.tags||[]).slice(0,3).map(function(t){return'<span class="client-tag" style="font-size:.5625rem">'+esc(t)+'</span>'}).join('');
    var layoutStr=p.layout||p.availableLayouts||'';
    var floorStr=p.floor?(p.floor+(p.totalFloors?'/'+p.totalFloors+'层':'')):'—';
    var decoOrient=[p.orientation||'',p.decoration||''].filter(Boolean).join(' ');
    var areaStr=p.area?p.area+'㎡':'—';

    var propPinned=(S.pinnedPropIds||[]).indexOf(p.id)>=0;
    var propRowCls=[];
    if(propPinned)propRowCls.push('is-pinned');
    if(isOff)propRowCls.push('invalid');
    if(isSold)propRowCls.push('is-completed');
    html+='<tr data-id="'+p.id+'"'+(propRowCls.length?' class="'+propRowCls.join(' ')+'"':'')+'>'
      +'<td>'+(propPinned?'<span title="重点房源" style="color:var(--warning)">⭐</span>':'<span style="color:var(--gray-300)">☆</span>')+'</td>'
      +'<td><span style="font-size:.625rem;padding:1px 4px;border-radius:3px;background:'+(p.type==='secondhand'?'#fef3c7':'#dbeafe')+';color:'+(p.type==='secondhand'?'#92400e':'#1e40af')+'">'+(p.type==='secondhand'?'二手':'新房')+'</span></td>'
      +'<td><span class="ct-name" title="'+esc(p.title||'')+'">'+esc(p.title||'')+'</span>'
      +(p.community?'<div style="font-size:.625rem;color:var(--text-muted)">'+esc(p.community)+'</div>':'')
      +'</td>'
      +'<td><span style="font-size:.75rem;font-weight:500">'+areaStr+'</span></td>'
      +'<td><span style="font-size:.75rem">'+esc(layoutStr||'—')+'</span></td>'
      +'<td><span style="font-size:.75rem;color:var(--text-secondary)">'+esc(floorStr)+'</span></td>'
      +'<td><span style="font-size:.6875rem;color:var(--text-muted)">'+esc(decoOrient||'—')+'</span></td>'
      +'<td><span class="ct-budget" style="color:'+(isSold?'var(--text-muted)':'var(--primary)')+';text-decoration:'+(isSold?'line-through':'none')+'">'+price+'</span></td>'
      +'<td><span class="ct-area">'+esc(p.district||'—')+'</span></td>'
      +'<td><select class="ct-status-select" data-prop-status-id="'+p.id+'">'
      +'<option value="在售"'+(p.status==='在售'?' selected':'')+'>在售</option>'
      +'<option value="待售"'+(p.status==='待售'?' selected':'')+'>待售</option>'
      +'<option value="已售"'+(p.status==='已售'?' selected':'')+'>已售</option>'
      +'<option value="售罄"'+(p.status==='售罄'?' selected':'')+'>售罄</option>'
      +'<option value="下架"'+(p.status==='下架'?' selected':'')+'>下架</option>'
      +'</select></td>'
      +'<td>'+(p.ownerName?'<div style="font-size:.75rem;font-weight:500">'+esc(p.ownerName)+'</div>':'')
      +(p.ownerPhone?'<a class="ct-phone" href="tel:'+esc(p.ownerPhone)+'">'+esc(p.ownerPhone)+'</a>':'')
      +(p.hasKey?'<span style="display:inline-block;padding:1px 4px;background:#fef3c7;color:#92400e;font-size:.5625rem;border-radius:3px;margin-left:2px">🔑有钥匙</span>':'')
      +'</td>'
      +'<td>'+(tagsHtml||'<span style="color:var(--gray-400)">—</span>')+'</td>'
      +'<td><span class="ct-time">'+esc(fmtDate(p.createdAt))+'</span></td>'
      +'<td>'
      +'<button class="ct-action-btn" data-prop-pin-id="'+p.id+'" title="'+(propPinned?'取消重点':'标为重点')+'">'+(propPinned?'⭐':'☆')+'</button>'
      +'<button class="ct-action-btn" data-prop-view-id="'+p.id+'" title="详情">详情</button>'
      +'<button class="ct-action-btn" data-prop-edit-id="'+p.id+'" title="编辑">编辑</button>'
      +'</td>'
      +'</tr>';
  }
  html+='</tbody></table></div>';
  table.innerHTML=html;

  /* status change */
  table.querySelectorAll('[data-prop-status-id]').forEach(function(sel){
    sel.addEventListener('change',function(e){
      e.stopPropagation();
      var id=sel.getAttribute('data-prop-status-id');
      var newStatus=sel.value;
      var p=findProp(id);
      if(!p)return;
      p.status=newStatus;p.updatedAt=now();
      saveP();
      renderPropertyTable();
      toast('已更新为：'+newStatus,'success');
    });
    sel.addEventListener('click',function(e){e.stopPropagation()});
  });

  /* pin/unpin */
  table.querySelectorAll('[data-prop-pin-id]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      var id=btn.getAttribute('data-prop-pin-id');
      S.pinnedPropIds=S.pinnedPropIds||[];
      var idx=S.pinnedPropIds.indexOf(id);
      if(idx>=0)S.pinnedPropIds.splice(idx,1);
      else S.pinnedPropIds.push(id);
      renderPropertyTable();
      renderPropertyList();
      toast(idx>=0?'已取消重点房源':'已标为重点房源','success');
    });
  });

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
      if(e.target.closest('button')||e.target.closest('select')||e.target.closest('a'))return;
      showPropertyDetail(row.getAttribute('data-id'));
    });
  });
}

/* ========== Property: Form ========== */
function openPropertyForm(id){
  S.editPropId=id||null;S.editPropTags=[];
  document.getElementById('propFormTitle').textContent=id?'编辑房源':'新增'+(S.subtab==='secondhand'?'二手房':'新楼盘');
  document.getElementById('pfId').value=id||'';
  var p=id?findProp(id):{};
  var type=id?p.type:S.subtab;
  document.getElementById('pfType').value=type;
  updatePropFormFields(type);
  document.getElementById('pfTitle').value=p.title||'';
  document.getElementById('pfCommunity').value=p.community||'';
  document.getElementById('pfDeveloper').value=p.developer||'';
  document.getElementById('pfDistrict').value=p.district||'临平';
  document.getElementById('pfAddress').value=p.address||'';
  document.getElementById('pfTotalPrice').value=p.totalPrice||'';
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
  document.getElementById('pfSalesOffice').value=p.salesOffice||'';
  document.getElementById('pfStatus').value=p.status||(type==='secondhand'?'在售':'待售');
  document.getElementById('pfDesc').value=p.description||'';
  S.editPropTags=(p.tags||[]).slice();
  S.editAreaSegs=(p.showroomAreas||[]).slice();
  renderPropTagChips();
  renderAreaSegments();
  document.getElementById('propFormModal').classList.add('show');
  var pfMb=document.querySelector('#propFormModal .modal-body');if(pfMb)pfMb.scrollTop=0;
}
function updatePropFormFields(type){
  document.querySelectorAll('[data-show]').forEach(function(el){
    el.style.display=el.getAttribute('data-show')===type?'':'none';
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
  var title=document.getElementById('pfTitle').value.trim();
  if(!title){toast('请输入房源名称','error');return}
  var type=document.getElementById('pfType').value;
  if(type==='secondhand'&&!document.getElementById('pfCommunity').value.trim()){toast('请输入小区名称','error');return}
  if(type==='secondhand'&&!document.getElementById('pfTotalPrice').value){toast('请输入总价','error');return}
  if(type==='newdev'&&!document.getElementById('pfAvgPrice').value){toast('请输入均价','error');return}
  var id=document.getElementById('pfId').value;var isEdit=!!id;var p=isEdit?findProp(id):{};
  p.type=type;p.title=title;
  p.community=document.getElementById('pfCommunity').value.trim();
  p.developer=document.getElementById('pfDeveloper').value.trim();
  p.district=document.getElementById('pfDistrict').value;
  p.address=document.getElementById('pfAddress').value.trim();
  p.totalPrice=parseFloat(document.getElementById('pfTotalPrice').value)||0;
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
  p.salesOffice=document.getElementById('pfSalesOffice').value.trim();
  p.status=document.getElementById('pfStatus').value;
  p.description=document.getElementById('pfDesc').value.trim();
  p.tags=S.editPropTags.slice();p.showroomAreas=S.editAreaSegs.slice();p.updatedAt=now();
  if(!isEdit){p.id=uuid();p.createdAt=now();p.linkedClientIds=[];S.properties.push(p)}
  saveP();closeModal('propFormModal');renderPropertyList();toast(isEdit?'房源已更新':'房源已添加','success');
}

/* ========== Property: Detail ========== */
function showPropertyDetail(id){
  var p=findProp(id);if(!p)return;S.curPropId=id;
  var price=p.type==='secondhand'?(p.totalPrice?p.totalPrice+'万':'面议'):(p.averagePrice?p.averagePrice+'元/㎡':'面议');
  var infoItems=p.type==='secondhand'?[
    di('小区',p.community),di('面积',p.area?p.area+'㎡':'—'),di('户型',p.layout),di('楼层',p.floor+(p.totalFloors?'/'+p.totalFloors+'层':'')),
    di('朝向',p.orientation),di('装修',p.decoration),di('单价',p.unitPrice?p.unitPrice+'元/㎡':'—'),di('建成年代',p.buildingAge),
    di('产权',p.propertyRights),di('钥匙',p.hasKey?'有':'无'),di('看房',p.viewingMethod),di('学区',p.school),di('地铁',p.metro),di('业主',p.ownerName),di('业主电话',p.ownerPhone)
  ]:[
    di('开发商',p.developer),di('均价',p.averagePrice?p.averagePrice+'元/㎡':'—'),di('物业类型',p.propertyType),di('开盘时间',p.openingDate),
    di('交房时间',p.deliveryDate),di('在售户型',p.availableLayouts),di('总户数',p.totalUnits),di('绿化率',p.greenRate),di('容积率',p.plotRatio),di('售楼处',p.salesOffice)
  ];
  var tagsHtml=(p.tags||[]).map(function(t){return'<span class="client-tag">'+esc(t)+'</span>'}).join('');
  var matchedClients=getMatchedClients(id);
  var matchedHtml=matchedClients.map(function(c){
    return'<div class="viewing-item" style="cursor:pointer" data-client-id="'+c.id+'"><div class="vi-top"><span class="vi-prop">'+esc(c.name)+'</span><span class="vi-date">'+esc(c.grade)+'级</span></div><div class="vi-feedback">预算'+fmtBudget(c.budgetMin,c.budgetMax)+' · '+(c.targetAreas||[]).join('、')+'</div></div>';
  }).join('')||'<div class="timeline-empty">暂无匹配客户</div>';
  document.getElementById('propDetailBody').innerHTML=
    '<div class="media-section"><div class="media-upload-area" id="mediaUpload"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" stroke-width="1.5" style="margin:0 auto;display:block"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><p>点击或拖拽上传图片/视频</p><div class="hint">支持 JPG/PNG/MP4 等，图片自动压缩</div></div><div class="media-gallery" id="mediaGallery"></div></div>'
    +'<div class="detail-header"><div class="detail-avatar" style="background:var(--success-light);color:var(--success)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div><div class="detail-info"><h2>'+esc(p.title)+'</h2><div class="sub">'+esc(p.district)+(p.address?' · '+esc(p.address):'')+'</div><div class="detail-badges"><span class="status-badge" data-status="'+esc(p.status)+'">'+esc(p.status)+'</span><span class="status-badge" data-status="已联系">'+(p.type==='secondhand'?'二手房':'新楼盘')+'</span></div></div></div>'
    +'<div class="detail-section"><div class="card-price" style="font-size:1.5rem;margin-bottom:12px">'+price+'</div><div class="detail-grid">'+infoItems.join('')+'</div></div>'
    +(tagsHtml?'<div class="detail-section"><h3>标签</h3><div class="client-tags">'+tagsHtml+'</div></div>':'')
    +(p.description?'<div class="detail-section"><h3>描述</h3><div class="timeline-content">'+esc(p.description)+'</div></div>':'')
    +(p.type==='newdev'&&p.showroomAreas&&p.showroomAreas.length?buildShowroomHtml(p):'')
    +'<div class="detail-section"><h3>匹配客户推荐</h3><div>'+matchedHtml+'</div></div>';
  document.getElementById('propDetailModal').classList.add('show');
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
  toast('正在上传…','');
  Array.from(files).forEach(function(file){
    if(file.type.startsWith('image/')){
      if(file.size>500*1024*1024){toast(file.name+' 超过500MB，跳过','error');return}
      promises.push(new Promise(function(resolve){
        compressImage(file,1200,0.7,function(dataUrl){
          MediaDB.save({id:uuid(),propertyId:propId,type:'image',name:file.name,dataUrl:dataUrl}).then(resolve);
        });
      }));
    }else if(file.type.startsWith('video/')){
      if(file.size>500*1024*1024){toast(file.name+' 超过500MB，跳过','error');return}
      promises.push(new Promise(function(resolve){
        fileToDataUrl(file,function(dataUrl){
          MediaDB.save({id:uuid(),propertyId:propId,type:'video',name:file.name,dataUrl:dataUrl}).then(resolve);
        });
      }));
    }
  });
  Promise.all(promises).then(function(){renderMediaGallery(propId);renderPropertyList();toast('上传完成','success')});
}
function renderMediaGallery(propId){
  MediaDB.list(propId).then(function(mediaList){
    S.mediaList=mediaList;
    var gallery=document.getElementById('mediaGallery');
    if(!gallery)return;
    if(mediaList.length===0){gallery.innerHTML='<p style="text-align:center;padding:16px;color:var(--gray-400);font-size:.8125rem">暂无图片/视频，点击上方区域上传</p>';return}
    gallery.innerHTML=mediaList.map(function(m,i){
      if(m.type==='image'){
        return'<div class="media-item" data-idx="'+i+'"><img src="'+m.dataUrl+'" loading="lazy"><span class="media-type">图片</span><button class="media-delete" data-mid="'+m.id+'">×</button></div>';
      }else{
        return'<div class="media-item" data-idx="'+i+'"><video src="'+m.dataUrl+'"></video><span class="media-type">视频</span><button class="media-delete" data-mid="'+m.id+'">×</button></div>';
      }
    }).join('');
    gallery.querySelectorAll('.media-item').forEach(function(el){
      el.addEventListener('click',function(e){
        if(e.target.classList.contains('media-delete')){e.stopPropagation();deleteMedia(e.target.getAttribute('data-mid'),propId)}
        else{openLightbox(mediaList,parseInt(el.getAttribute('data-idx')))}
      });
    });
  });
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
  toast('正在上传…','');
  Array.from(files).forEach(function(file){
    if(file.type.startsWith('image/')){
      if(file.size>500*1024*1024){toast(file.name+' 超过500MB，跳过','error');return}
      promises.push(new Promise(function(resolve){
        compressImage(file,1200,0.7,function(dataUrl){
          MediaDB.save({id:uuid(),propertyId:propId,type:'image',name:file.name,dataUrl:dataUrl,category:'showroom',showroomArea:area,showroomType:type}).then(resolve);
        });
      }));
    }else if(file.type.startsWith('video/')){
      if(file.size>500*1024*1024){toast(file.name+' 超过500MB，跳过','error');return}
      promises.push(new Promise(function(resolve){
        fileToDataUrl(file,function(dataUrl){
          MediaDB.save({id:uuid(),propertyId:propId,type:'video',name:file.name,dataUrl:dataUrl,category:'showroom',showroomArea:area,showroomType:type}).then(resolve);
        });
      }));
    }
  });
  Promise.all(promises).then(function(){
    var prefix=type==='experience'?'Exp':'Del';
    renderShowroomGallery(propId,area,type,prefix,areaId(area));
    toast('上传完成','success');
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
        return'<div class="media-item" data-sr-idx="'+i+'"><img src="'+m.dataUrl+'" loading="lazy"><button class="media-delete" data-sr-mid="'+m.id+'">×</button></div>';
      }else{
        return'<div class="media-item" data-sr-idx="'+i+'"><video src="'+m.dataUrl+'"></video><span class="media-type">视频</span><button class="media-delete" data-sr-mid="'+m.id+'">×</button></div>';
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
  if(m.type==='image'){
    el.innerHTML='<img src="'+m.dataUrl+'">'
    +'<div class="lb-download-bar"><button class="lb-download-btn" id="lbDownloadImg">下载图片（带水印）</button></div>';
    var dlBtn=document.getElementById('lbDownloadImg');
    if(dlBtn)dlBtn.addEventListener('click',function(){downloadImageWithWatermark(m)});
  }
  else{
    el.innerHTML='<video src="'+m.dataUrl+'" controls autoplay></video>'
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
  img.src=m.dataUrl;
}

function downloadVideoWithWatermark(m){
  if(typeof MediaRecorder==='undefined'||!HTMLCanvasElement.prototype.captureStream){
    // 不支持Canvas录制，直接下载原始文件
    toast('浏览器不支持水印录制，下载原视频…','');
    downloadDataUrl(m.dataUrl,(m.name||'video').replace(/\.[^.]+$/,'')+'.mp4');
    return;
  }
  toast('正在生成带水印视频，请勿关闭页面…','');
  var video=document.createElement('video');
  video.src=m.dataUrl;
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
  if(p.type==='secondhand'){
    text='【'+p.title+'】\n'+
      (p.community?'小区：'+p.community+'\n':'')+
      (p.area?'面积：'+p.area+'㎡\n':'')+
      (p.layout?'户型：'+p.layout+'\n':'')+
      (p.floor?'楼层：'+p.floor+(p.totalFloors?'/'+p.totalFloors+'层':'')+'\n':'')+
      (p.orientation?'朝向：'+p.orientation+'\n':'')+
      (p.decoration?'装修：'+p.decoration+'\n':'')+
      (p.totalPrice?'总价：'+p.totalPrice+'万\n':'')+
      (p.unitPrice?'单价：'+p.unitPrice+'元/㎡\n':'')+
      '位置：'+(p.district||'')+(p.address?' '+p.address:'')+'\n'+
      (p.school?'学区：'+p.school+'\n':'')+
      (p.metro?'地铁：'+p.metro+'\n':'')+
      (p.description?'\n'+p.description:'')+
      '\n\n—— '+(S.currentUser?S.currentUser.name:'小闻哥')+(S.currentUser&&S.currentUser.phone?'·'+S.currentUser.phone:'·杭州房产');
  }else{
    text='【'+p.title+'】\n'+
      (p.developer?'开发商：'+p.developer+'\n':'')+
      '区域：'+(p.district||'')+'\n'+
      (p.averagePrice?'均价：'+p.averagePrice+'元/㎡\n':'')+
      (p.openingDate?'开盘：'+p.openingDate+'\n':'')+
      (p.deliveryDate?'交房：'+p.deliveryDate+'\n':'')+
      (p.availableLayouts?'在售户型：'+p.availableLayouts+'\n':'')+
      '位置：'+(p.district||'')+(p.address?' '+p.address:'')+'\n'+
      (p.description?'\n'+p.description:'')+
      '\n\n—— '+(S.currentUser?S.currentUser.name:'小闻哥')+(S.currentUser&&S.currentUser.phone?'·'+S.currentUser.phone:'·杭州房产');
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
  document.getElementById('fBudgetMin').addEventListener('input',function(){S.filters.budgetMin=parseInt(this.value)||0;renderClientList()});
  document.getElementById('fBudgetMax').addEventListener('input',function(){S.filters.budgetMax=parseInt(this.value)||0;renderClientList()});
  document.getElementById('fTag').addEventListener('input',function(){S.filters.tag=this.value.trim();renderClientList()});
  document.getElementById('filterReset').addEventListener('click',function(){S.filters={};['fGrade','fStatus','fPurpose','fSource','fArea','fNeedFollow','fBudgetMin','fBudgetMax','fTag'].forEach(function(id){document.getElementById(id).value=''});renderClientList()});
  document.getElementById('sortSelect').addEventListener('change',function(){S.sort=this.value;renderClientList()});
  // Property filters
  function bpf(id,key){document.getElementById(id).addEventListener('change',function(){S.propFilters[key]=this.value;renderPropertyList()})}
  bpf('pfArea','area');bpf('pfStatus','status');
  document.getElementById('pfMin').addEventListener('input',function(){S.propFilters.min=parseInt(this.value)||0;renderPropertyList()});
  document.getElementById('pfMax').addEventListener('input',function(){S.propFilters.max=parseInt(this.value)||0;renderPropertyList()});
  document.getElementById('pfLayout').addEventListener('input',function(){S.propFilters.layout=this.value.trim();renderPropertyList()});
  document.getElementById('pfTag').addEventListener('input',function(){S.propFilters.tag=this.value.trim();renderPropertyList()});
  document.getElementById('propFilterReset').addEventListener('click',function(){S.propFilters={};['pfArea','pfStatus','pfMin','pfMax','pfLayout','pfTag'].forEach(function(id){document.getElementById(id).value=''});renderPropertyList()});
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
      return;
    }
    document.getElementById('smartParseHint').textContent='已识别 '+S.smartClients.length+' 位客户，请检查后点击「全部录入」';
    document.getElementById('smartParseHint').style.color='var(--success)';
    renderSmartPreview(S.smartClients);
  });
  document.getElementById('smartClearBtn').addEventListener('click',function(){
    document.getElementById('smartInputArea').value='';
    document.getElementById('smartPreviewWrap').style.display='none';
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
  document.getElementById('addPropBtn').addEventListener('click',function(){openPropertyForm()});
  document.getElementById('smartPropInputBtn').addEventListener('click',openSmartPropInput);
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
      return;
    }
    document.getElementById('smartPropParseHint').textContent='已识别 '+S.smartProps.length+' 套房源，请检查后点击「全部录入」';
    document.getElementById('smartPropParseHint').style.color='var(--success)';
    renderSmartPropPreview(S.smartProps);
  });
  document.getElementById('smartPropClearBtn').addEventListener('click',function(){
    document.getElementById('smartPropArea').value='';
    document.getElementById('smartPropPreviewWrap').style.display='none';
    document.getElementById('smartPropParseHint').textContent='';
    document.getElementById('smartPropFileHint').textContent='支持 Excel/CSV 表格、文本文件、含文字截图照片';
    S.smartProps=[];
  });
  document.getElementById('smartPropReparseBtn').addEventListener('click',function(){
    document.getElementById('smartPropParseBtn').click();
  });
  document.getElementById('smartPropImportBtn').addEventListener('click',batchImportProps);
  document.getElementById('smartPropFileInput').addEventListener('change',function(e){
    if(e.target.files[0])handleSmartFileUpload(e.target.files[0],'smartPropFileHint');
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
  document.getElementById('changePasswordBtn').addEventListener('click',function(){closeModal('settingsModal');document.getElementById('pwOld').value='';document.getElementById('pwNew').value='';document.getElementById('pwNewConfirm').value='';document.getElementById('pwChangeModal').classList.add('show')});
  document.getElementById('userManageBtn').addEventListener('click',function(){closeModal('settingsModal');document.getElementById('userMgmtModal').classList.add('show')});
  document.getElementById('savePwBtn').addEventListener('click',function(){
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
