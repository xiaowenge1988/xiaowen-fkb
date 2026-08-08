/**
 * 掌房 v6.0 - 后端服务
 * 多用户系统 + 数据隔离 + 媒体管理
 * 零依赖 Node.js HTTP 服务器
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const POLICY_FILE = path.join(DATA_DIR, 'policy.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/* ========== COS 异地备份配置（第二层保护） ========== */
const COS_SECRET_ID = process.env.COS_SECRET_ID || '';
const COS_SECRET_KEY = process.env.COS_SECRET_KEY || '';
const COS_BUCKET = process.env.COS_BUCKET || '';
const COS_REGION = process.env.COS_REGION || '';
const COS_ENABLED = !!(COS_SECRET_ID && COS_SECRET_KEY && COS_BUCKET && COS_REGION);

/* ========== 购房政策数据（杭州，结构化 + 信源/日期） ========== */
function loadPolicy() {
  if (fs.existsSync(POLICY_FILE)) {
    try { return JSON.parse(fs.readFileSync(POLICY_FILE, 'utf-8')); }
    catch (e) { console.error('Policy parse error:', e.message); }
  }
  return { updatedAt: '', source: '未配置', subsidies: [] };
}
function savePolicy(data) {
  data.updatedAt = new Date().toISOString().slice(0, 10);
  var tmp = POLICY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, POLICY_FILE);
  return data;
}

/* ========== 初始化目录 ========== */
[DATA_DIR, MEDIA_DIR, BACKUP_DIR].forEach(function(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

/* ========== 数据库 ========== */
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
    catch (e) { console.error('DB parse error:', e.message); }
  }
  return { users: [], clients: [], properties: [], transactions: [], memos: {}, mediaMeta: {} };
}

/* 数据版本号缓存：任意写操作 +1，供客户端轻量轮询 /api/rev 判断是否需要全量拉取 */
var _revCache = null;
function currentRev() {
  if (_revCache) return _revCache;
  var d = loadDb();
  _revCache = { rev: d._rev || 0, at: d._revAt || 0 };
  return _revCache;
}

function saveDb(data) {
  var current = loadDb();
  var merged = Object.assign({}, current, data);
  merged._rev = (current._rev || 0) + 1;
  merged._revAt = Date.now();
  var tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
  fs.renameSync(tmp, DB_FILE);
  _revCache = { rev: merged._rev, at: merged._revAt };
}

/* ========== 写锁（串行化同步等写操作，避免并发覆盖） ========== */
var _dbLock = Promise.resolve();
function withDbLock(fn) {
  var release;
  var p = new Promise(function(res) { release = res; });
  var prev = _dbLock;
  _dbLock = prev.then(function() { return p; });
  return prev.then(function() {
    return Promise.resolve().then(fn).then(function(r) { release(); return r; },
      function(e) { release(); throw e; });
  });
}

function uniqArr(a){ var seen={}, out=[]; (a||[]).forEach(function(x){ if(x!=null && !seen[x]){seen[x]=1; out.push(x);} }); return out; }
/* ========== 记录级 upsert（按ID合并 + updatedAt 冲突检测 + 显式删除） ========== */
function upsertCollection(serverItems, incomingItems, user, kind, deleted, tracker) {
  serverItems = serverItems || [];
  incomingItems = incomingItems || [];
  var byId = {};
  incomingItems.forEach(function(it) {
    if (!it) return;
    if (!it.updatedAt) it.updatedAt = Date.now();
    byId[it.id] = it;
  });
  var delKey = (kind === 'client') ? 'clients' : (kind === 'property') ? 'properties' : 'transactions';
  var del = (deleted && deleted[delKey]) || [];
  var shared = (kind === 'property'); // 房源为共享，成员可改任意；客户/成交为私有
  function canEdit(it) {
    var collabOk = it && it.collabs && it.collabs.some(function(x) { return x.userId === user.id && x.status === 'accepted'; });
    return shared || collabOk || user.role === 'admin' || !it.createdBy || it.createdBy === user.id;
  }
  var out = [];
  serverItems.forEach(function(si) {
    if (del.indexOf(si.id) >= 0) {
      // 删除：admin 可删任意；成员仅能删自己创建的
      if (user.role === 'admin' || si.createdBy === user.id) { if (tracker && tracker[delKey]) tracker[delKey].push(si.id); return; }
      out.push(si); return;
    }
    var inc = byId[si.id];
    if (inc) {
      // 仅当入参「允许编辑且较新」时才用入参；否则保留服务端（避免他人私有记录被覆盖或丢失）
      if (canEdit(inc) && inc.updatedAt >= (si.updatedAt || 0)) return;
      out.push(si); return;
    }
    out.push(si); // 不在入参中 -> 保留
  });
  incomingItems.forEach(function(it) {
    if (!it || !it.id) return;
    if (del.indexOf(it.id) >= 0) return;
    var existing = null;
    for (var i = 0; i < serverItems.length; i++) { if (serverItems[i].id === it.id) { existing = serverItems[i]; break; } }
    if (existing && existing.updatedAt && it.updatedAt < existing.updatedAt) return; // 陈旧，跳过
    if (!canEdit(it)) return; // 私有记录：成员不能改他人
    // 防护：若上传的敏感字段是 '***' 占位符（历史上曾因服务端脱敏被同步回写），且服务端已有真实值，则保留真实值，避免再次污染
    var merged = Object.assign({}, it);
    SENSITIVE_KEYS.forEach(function(k) {
      if (merged[k] === '***' && existing && existing[k] && existing[k] !== '***') merged[k] = existing[k];
    });
    out.push(Object.assign({}, merged, {
      updatedAt: it.updatedAt,
      createdBy: it.createdBy || user.id,
      createdByName: it.createdByName || user.name
    }));
  });
  return out;
}

var db = loadDb();

/* ========== 敏感字段与权限 ========== */
// 敏感字段：业主隐私 + 内部商务信息，对非敏感角色脱敏
// ⚠️ 注意：脱敏只应在【前端展示】层做（diPhoneLimited/diMask），不能由服务端在 GET 响应里把值替换成 '***'。
// 原因：房源是共享的，非敏感角色拉到 '***' 后会随本地保存再同步回服务器，把数据库里的真实号码永久覆盖成 '***'（已发生的数据污染事故）。
// 因此服务端对所有角色返回完整属性，脱敏完全交给前端按角色处理。
var SENSITIVE_KEYS = ['ownerPhone', 'ownerName', 'ownerReserve', 'commission'];
function canSeeSensitive(role) { return role === 'admin' || role === 'manager'; }
function sanitizeProps(props, role) {
  // 不再做任何字段替换，直接返回完整属性（脱敏移至前端）
  return props || [];
}

/* ========== MIME ========== */
var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.map': 'application/json'
};

/* ========== 工具函数 ========== */
function sendJson(res, code, data) {
  var raw = JSON.stringify(data);
  var reqHeaders = (res.req && res.req.headers) || {};
  var acceptsGzip = (reqHeaders['accept-encoding'] || '').indexOf('gzip') >= 0;
  /* 同步提速(#171)：客户端 Accept-Encoding 含 gzip 且响应体>1KB 时压缩，
     19k 房源的 /api/sync 从数 MB 降到数百 KB，慢网/微信首屏直降数倍；
     浏览器与 fetch 会自动解压，前端无感。小响应(<1KB)跳过以免无谓 CPU。 */
  if (acceptsGzip && raw.length > 1024) {
    zlib.gzip(raw, function(gzErr, gzData) {
      if (gzErr) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(raw); return; }
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Content-Length': gzData.length });
      res.end(gzData);
    });
  } else {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(raw);
  }
}

function readBody(req, maxBytes) {
  return new Promise(function(resolve, reject) {
    var size = 0, chunks = [];
    var limit = maxBytes || 800 * 1024 * 1024; // 800MB
    req.on('data', function(chunk) {
      size += chunk.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', function() { resolve(Buffer.concat(chunks).toString('utf-8')); });
    req.on('error', reject);
  });
}

function hashPw(pw) {
  // v2: sha256 加盐，不可逆
  return 'v2:' + crypto.createHash('sha256').update('xwg_salt_fkb_v6' + pw).digest('hex');
}

function verifyPw(stored, pw) {
  if (!stored || !pw) return false;
  if (stored.indexOf('v2:') === 0) {
    var h = crypto.createHash('sha256').update('xwg_salt_fkb_v6' + pw).digest('hex');
    return stored === 'v2:' + h;
  }
  // 兼容旧版 base64 可逆编码
  return stored === Buffer.from(pw + 'xwg_salt_fkb_v6').toString('base64');
}

var TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天

function genToken(userId) {
  return Buffer.from('v2|' + userId + '|' + (Date.now() + TOKEN_TTL)).toString('base64');
}

function parseAuth(req) {
  var auth = req.headers['authorization'] || '';
  if (auth.indexOf('Bearer ') !== 0) return null;
  var token = auth.slice(7);
  try {
    var decoded = Buffer.from(token, 'base64').toString('utf-8');
    var userId;
    if (decoded.indexOf('v2|') === 0) {
      var parts = decoded.split('|');
      userId = parts[1];
      var exp = Number(parts[2]);
      if (!exp || exp < Date.now()) return null; // 已过期
    } else {
      // 兼容旧格式 userId:timestamp（无过期），保证已有会话不强制重登
      userId = decoded.split(':')[0];
    }
    var user = (db.users || []).find(function(u) { return u.id === userId && u.active; });
    return user || null;
  } catch (e) { return null; }
}

function requireAuth(req, res) {
  var user = parseAuth(req);
  if (!user) { sendJson(res, 401, { error: '未授权' }); return null; }
  return user;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ========== 静态文件 ========== */
/* 文本资源 gzip 压缩 + 长缓存：
   - index.html 不缓存（保证部署新版本即时生效）
   - app_v21.js/app.js/css 带 ?v= 版本号，可安全长缓存 1 天（改版本号即换 URL 破缓存）
   - gzip 让 626KB 的 JS 传输降到约 160KB，慢网/微信内置浏览器首屏直降数倍 */
function sendText(res, data, contentType, req, cacheText) {
  var cacheHeaders = cacheText
    ? { 'Cache-Control': 'public, max-age=86400' }
    : { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' };
  var acceptsGzip = !!(req && req.headers && (req.headers['accept-encoding'] || '').indexOf('gzip') >= 0);
  if (acceptsGzip && /text\/html|javascript|css/.test(contentType)) {
    zlib.gzip(data, function(gzErr, gzData) {
      if (gzErr) {
        res.writeHead(200, Object.assign({ 'Content-Type': contentType, 'Content-Length': data.length }, cacheHeaders));
        res.end(data); return;
      }
      res.writeHead(200, Object.assign({
        'Content-Type': contentType,
        'Content-Encoding': 'gzip',
        'Content-Length': gzData.length,
        'Vary': 'Accept-Encoding'
      }, cacheHeaders));
      res.end(gzData);
    });
  } else {
    res.writeHead(200, Object.assign({ 'Content-Type': contentType, 'Content-Length': data.length }, cacheHeaders));
    res.end(data);
  }
}

function serveStatic(req, res, pathname) {
  var filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(ROOT, decodeURIComponent(filePath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.stat(filePath, function(err, stat) {
    if (err || !stat.isFile()) {
      var indexPath = path.join(ROOT, 'index.html');
      fs.readFile(indexPath, function(e2, data) {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        sendText(res, data, 'text/html; charset=utf-8', req, false);
      });
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    var contentType = MIME[ext] || 'application/octet-stream';
    var isText = (ext === '.html' || ext === '.js' || ext === '.css');
    var isNoStore = (ext === '.html' || pathname === '/sw.js');
    var isCacheable = (isText && !isNoStore) || ext === '.png' || ext === '.ico';
    fs.readFile(filePath, function(e3, data) {
      if (e3) { res.writeHead(404); res.end('Not found'); return; }
      sendText(res, data, contentType, req, isCacheable);
    });
  });
}

/* ========== API 路由 ========== */
async function handleApi(req, res, pathname, method) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  db = loadDb();

  /* --- 健康检查 --- */
  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, {
      ok: true, service: '掌房', version: '6.0',
      users: (db.users || []).length,
      clients: (db.clients || []).length,
      properties: (db.properties || []).length,
      transactions: (db.transactions || []).length,
      media: Object.keys(db.mediaMeta || {}).length,
      needSetup: !(db.users || []).some(function(u) { return u.role === 'admin'; })
    });
    return;
  }

  /* --- 初始化检查 --- */
  if (pathname === '/api/auth/status' && method === 'GET') {
    var hasAdmin = (db.users || []).some(function(u) { return u.role === 'admin'; });
    sendJson(res, 200, { needSetup: !hasAdmin, users: (db.users || []).length });
    return;
  }

  /* --- 首次设置（创建管理员）--- */
  if (pathname === '/api/auth/setup' && method === 'POST') {
    var hasAdmin = (db.users || []).some(function(u) { return u.role === 'admin'; });
    if (hasAdmin) { sendJson(res, 400, { error: '系统已初始化' }); return; }
    try {
      var setupData = JSON.parse(await readBody(req));
      if (!setupData.username || !setupData.password || setupData.password.length < 4) {
        sendJson(res, 400, { error: '用户名和密码不能为空，密码至少4位' }); return;
      }
      var adminUser = {
        id: 'admin', username: setupData.username, password: hashPw(setupData.password),
        name: setupData.name || '管理员', phone: setupData.phone || '',
        role: 'admin', active: true, createdAt: Date.now()
      };
      db.users = [adminUser];
      saveDb({ users: db.users });
      var token = genToken(adminUser.id);
      sendJson(res, 200, { ok: true, token: token, user: { id: adminUser.id, username: adminUser.username, name: adminUser.name, phone: adminUser.phone, role: 'admin' } });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 前端崩溃日志 --- */
  if (pathname === '/api/clientlog' && method === 'POST') {
    try {
      var logBody = JSON.parse(await readBody(req));
      console.log('[CLIENT ERROR] ' + (logBody.msg || '') + ' || ' + String(logBody.stack || '').slice(0, 400));
    } catch (e) {}
    sendJson(res, 200, { ok: true });
    return;
  }
  /* --- 登录 --- */
  if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      var loginData = JSON.parse(await readBody(req));
      console.log('[LOGIN DEBUG] username=' + JSON.stringify(loginData.username) + ' len=' + (loginData.username ? Buffer.byteLength(loginData.username) : 0));
      var user = (db.users || []).find(function(u) { return u.username === loginData.username && u.active; });
      if (!user || !verifyPw(user.password, loginData.password)) {
        console.log('[LOGIN DEBUG] FAILED username=' + JSON.stringify(loginData.username));
        sendJson(res, 401, { error: '用户名或密码错误' }); return;
      }
      // 旧密码格式就地升级为新哈希
      if (user.password.indexOf('v2:') !== 0) {
        user.password = hashPw(loginData.password);
        saveDb({ users: db.users });
      }
      var token = genToken(user.id);
      sendJson(res, 200, {
        ok: true, token: token,
        user: { id: user.id, username: user.username, name: user.name, phone: user.phone, role: user.role }
      });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 自助修改密码 --- */
  if (pathname === '/api/auth/change-password' && method === 'PUT') {
    var cpUser = requireAuth(req, res); if (!cpUser) return;
    try {
      var cpData = JSON.parse(await readBody(req));
      if (!cpData.oldPassword || !cpData.newPassword || cpData.newPassword.length < 4) {
        sendJson(res, 400, { error: '参数不合法，新密码至少4位' }); return;
      }
      var targetU = (db.users || []).find(function(u) { return u.id === cpUser.id; });
      if (!targetU || !verifyPw(targetU.password, cpData.oldPassword)) {
        sendJson(res, 401, { error: '当前密码不正确' }); return;
      }
      targetU.password = hashPw(cpData.newPassword);
      saveDb({ users: db.users });
      sendJson(res, 200, { ok: true });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 自助修改用户名 --- */
  if (pathname === '/api/auth/change-username' && method === 'PUT') {
    var cuUser = requireAuth(req, res); if (!cuUser) return;
    try {
      var cuData = JSON.parse(await readBody(req));
      if (!cuData.password || !cuData.newUsername || cuData.newUsername.length < 2) {
        sendJson(res, 400, { error: '参数不合法' }); return;
      }
      var cuTarget = (db.users || []).find(function(u) { return u.id === cuUser.id; });
      if (!cuTarget || !verifyPw(cuTarget.password, cuData.password)) {
        sendJson(res, 401, { error: '密码不正确' }); return;
      }
      if ((db.users || []).some(function(u) { return u.username === cuData.newUsername && u.id !== cuUser.id; })) {
        sendJson(res, 400, { error: '该用户名已被使用' }); return;
      }
      cuTarget.username = cuData.newUsername;
      saveDb({ users: db.users });
      sendJson(res, 200, { ok: true, username: cuData.newUsername });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 忘记密码（通过用户名+手机号验证）--- */
  if (pathname === '/api/auth/forgot-password' && method === 'POST') {
    try {
      var fpData = JSON.parse(await readBody(req));
      if (!fpData.username || !fpData.phone || !fpData.newPassword || fpData.newPassword.length < 4) {
        sendJson(res, 400, { error: '参数不合法' }); return;
      }
      var fpUser = (db.users || []).find(function(u) {
        return u.username === fpData.username && u.phone === fpData.phone && u.active;
      });
      if (!fpUser) { sendJson(res, 404, { error: '未找到匹配的账号，请检查用户名和手机号' }); return; }
      fpUser.password = hashPw(fpData.newPassword);
      saveDb({ users: db.users });
      console.log('[FORGOT-PW] User ' + fpData.username + ' password reset via forgot-password flow');
      sendJson(res, 200, { ok: true });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 用户管理（仅管理员）--- */
  if (pathname === '/api/users' && method === 'GET') {
    var admin = requireAuth(req, res); if (!admin) return;
    if (admin.role !== 'admin') { sendJson(res, 403, { error: '无权限' }); return; }
    var userList = (db.users || []).map(function(u) {
      var clientCount = (db.clients || []).filter(function(c) { return c.createdBy === u.id; }).length;
      return { id: u.id, username: u.username, name: u.name, phone: u.phone, role: u.role, active: u.active, createdAt: u.createdAt, clientCount: clientCount, createdPassword: u.createdPassword || null };
    });
    sendJson(res, 200, userList);
    return;
  }

  if (pathname === '/api/users' && method === 'POST') {
    var admin2 = requireAuth(req, res); if (!admin2) return;
    if (admin2.role !== 'admin') { sendJson(res, 403, { error: '无权限' }); return; }
    try {
      var newUserData = JSON.parse(await readBody(req));
      if (!newUserData.username || !newUserData.password) {
        sendJson(res, 400, { error: '用户名和密码不能为空' }); return;
      }
      if ((db.users || []).some(function(u) { return u.username === newUserData.username; })) {
        sendJson(res, 400, { error: '用户名已存在' }); return;
      }
      var allowedRoles = ['manager', 'broker', 'trainee'];
      var newRole = (newUserData.role && allowedRoles.indexOf(newUserData.role) >= 0) ? newUserData.role : 'broker';
      var newMember = {
        id: genId(), username: newUserData.username, password: hashPw(newUserData.password),
        name: newUserData.name || newUserData.username, phone: newUserData.phone || '',
        role: newRole, active: true, createdAt: Date.now()
      };
      db.users = db.users || [];
      db.users.push(newMember);
      saveDb({ users: db.users });
      sendJson(res, 200, { ok: true, user: { id: newMember.id, username: newMember.username, name: newMember.name, phone: newMember.phone, role: newRole } });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 删除用户 --- */
  if (pathname.indexOf('/api/users/') === 0 && method === 'DELETE') {
    var admin3 = requireAuth(req, res); if (!admin3) return;
    if (admin3.role !== 'admin') { sendJson(res, 403, { error: '无权限' }); return; }
    var userId = decodeURIComponent(pathname.replace('/api/users/', ''));
    if (userId === 'admin') { sendJson(res, 400, { error: '不能删除管理员' }); return; }
    db.users = (db.users || []).filter(function(u) { return u.id !== userId; });
    // 不删除该用户的客户数据，但标记为已离职
    saveDb({ users: db.users });
    sendJson(res, 200, { ok: true });
    return;
  }

  /* --- 切换用户状态 --- */
  if (pathname.indexOf('/api/users/') === 0 && method === 'PUT') {
    var admin4 = requireAuth(req, res); if (!admin4) return;
    if (admin4.role !== 'admin') { sendJson(res, 403, { error: '无权限' }); return; }
    try {
      var userId2 = decodeURIComponent(pathname.replace('/api/users/', ''));
      var updateData = JSON.parse(await readBody(req));
      db.users = (db.users || []).map(function(u) {
        if (u.id === userId2) {
          if (updateData.username) u.username = updateData.username;
          if (updateData.active !== undefined) u.active = updateData.active;
          if (updateData.password) { u.password = hashPw(updateData.password); u.createdPassword = updateData.password; }
          if (updateData.name) u.name = updateData.name;
          if (updateData.phone !== undefined) u.phone = updateData.phone;
        }
        return u;
      });
      saveDb({ users: db.users });
      sendJson(res, 200, { ok: true });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 管理员重置成员密码 --- */
  if (pathname.indexOf('/api/users/') === 0 && pathname.indexOf('/reset-password') !== -1 && method === 'PUT') {
    var ra = requireAuth(req, res); if (!ra) return;
    if (ra.role !== 'admin') { sendJson(res, 403, { error: '无权限' }); return; }
    try {
      var rpUserId = decodeURIComponent(pathname.replace('/api/users/', '').replace('/reset-password', ''));
      if (rpUserId === 'admin') { sendJson(res, 400, { error: '不能重置管理员密码' }); return; }
      var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
      var newRawPw = '';
      for (var ri = 0; ri < 6; ri++) newRawPw += chars.charAt(Math.floor(Math.random() * chars.length));
      var foundRp = false;
      db.users = (db.users || []).map(function(u) {
        if (u.id === rpUserId) { u.password = hashPw(newRawPw); u.createdPassword = newRawPw; foundRp = true; }
        return u;
      });
      if (!foundRp) { sendJson(res, 404, { error: '用户不存在' }); return; }
      saveDb({ users: db.users });
      sendJson(res, 200, { ok: true, newPassword: newRawPw });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 轻量版本探测"：客户端高频轮询，只有 rev 变化才做全量 /api/sync 拉取 --- */
  if (pathname === '/api/rev' && method === 'GET') {
    var revUser = requireAuth(req, res); if (!revUser) return;
    var rv = currentRev();
    sendJson(res, 200, { rev: rv.rev, at: rv.at });
    return;
  }

  /* --- 数据同步 GET（按用户角色过滤）--- */
  if (pathname === '/api/sync' && method === 'GET') {
    var user = requireAuth(req, res); if (!user) return;
    if (user.role === 'admin') {
      sendJson(res, 200, {
        clients: db.clients || [], properties: (db.properties || []).filter(function(p) { return p.type !== 'md'; }),
        transactions: db.transactions || [],
        deleted: db.deleted || { clients: [], properties: [], transactions: [] },
        memos: (db.memos && user ? (db.memos[user.username] || []) : []),
        allUsers: (db.users || []).map(function(u) { return { id: u.id, name: u.name, username: u.username, role: u.role, active: u.active }; }),
        mdViewers: db.mdViewers || [],
        logs: (db.logs || []).slice(0, 100), /* 最近 100 条操作日志 */
        rev: currentRev().rev
      });
    } else {
      // 非管理员：店长/管理员看全部；经纪/实习只看自己的客户与成交；房源全可见但敏感字段脱敏
      var seeAll = canSeeSensitive(user.role);
      var myClients = seeAll ? (db.clients || []) : (db.clients || []).filter(function(c) {
        if (c.createdBy === user.id) return true;
        var cs = (c.collabs || []);
        return cs.some(function(x) { return x.userId === user.id; }); // 自己录入的 + 我是合作人(含待接收)的客户
      });
      var myTx = seeAll ? (db.transactions || []) : (db.transactions || []).filter(function(t) { return t.createdBy === user.id; });
      /* 房源MD（业主名单）：已从「全量同步」中剥离（见下方 /api/md 按需拉取），这里只下发非 MD 内容；
         非授权成员拿不到 MD（/api/md 会按 mdViewers 拦截），实现「点不开也看不了」。 */
      var _mdProps = (db.properties || []).filter(function(p) { return p.type !== 'md'; });
      sendJson(res, 200, {
        clients: myClients,
        properties: sanitizeProps(_mdProps, user.role),
        transactions: myTx,
        deleted: db.deleted || { clients: [], properties: [], transactions: [] },
        memos: (db.memos && user ? (db.memos[user.username] || []) : []),
        allUsers: [],
        mdViewers: db.mdViewers || [],
        rev: currentRev().rev
      });
    }
    return;
  }

  /* --- 数据同步 POST（按记录ID upsert + updatedAt 冲突检测 + 显式删除 + 通知生成）--- */
  if (pathname === '/api/sync' && method === 'POST') {
    var user2 = requireAuth(req, res); if (!user2) return;
    try {
      var data = JSON.parse(await readBody(req, 800 * 1024 * 1024));
      var notifs = [];
      await withDbLock(async function() {
        var cur = loadDb();
        // 快照当前状态，用于生成“新增/改价”通知
        var curClientIds = {}, curPropIds = {}, curTxIds = {}, curPropPrices = {};
        (cur.clients || []).forEach(function(c) { curClientIds[c.id] = true; });
        (cur.properties || []).forEach(function(p) { curPropIds[p.id] = true; curPropPrices[p.id] = p.totalPrice; });
        (cur.transactions || []).forEach(function(t) { curTxIds[t.id] = true; });

        var tracker = { clients: [], properties: [], transactions: [] };
        var clients = upsertCollection(cur.clients || [], data.clients, user2, 'client', data.deleted, tracker);
        var properties = upsertCollection(cur.properties || [], data.properties, user2, 'property', data.deleted, tracker);
        var transactions = upsertCollection(cur.transactions || [], data.transactions, user2, 'transaction', data.deleted, tracker);
        var prevDel = cur.deleted || { clients: [], properties: [], transactions: [] };
        var mergedDeleted = {
          clients: uniqArr(prevDel.clients.concat(tracker.clients)),
          properties: uniqArr(prevDel.properties.concat(tracker.properties)),
          transactions: uniqArr(prevDel.transactions.concat(tracker.transactions))
        };
        if(data.memos && user && Array.isArray(data.memos)){
          cur.memos=cur.memos||{};
          cur.memos[user.username]=data.memos;
        }
        /* 合并操作日志 */
        if(data.logs && Array.isArray(data.logs) && data.logs.length){
          cur.logs = cur.logs || [];
          var _existingIds = {};
          cur.logs.forEach(function(l){ _existingIds[l.id] = true; });
          var _newLogs = data.logs.filter(function(l){ return l && l.id && !_existingIds[l.id]; });
          if(_newLogs.length){
            cur.logs = _newLogs.concat(cur.logs);
            if(cur.logs.length > 2000) cur.logs = cur.logs.slice(0, 2000); /* 上限 2000 条 */
          }
        }
        var _saveObj = { clients: clients, properties: properties, transactions: transactions, deleted: mergedDeleted, logs: cur.logs };
        if (user2.role === 'admin' && data.mdViewers) _saveObj.mdViewers = data.mdViewers;  /* 房源MD授权白名单：仅管理员可修改，防止非管理员自提权 */
        if (cur.memos) _saveObj.memos = cur.memos; /* 持久化备忘录 */
        saveDb(_saveObj);

        // 非管理员触发的变更 -> 给管理员生成通知（尊重静音设置）
        if (user2.role !== 'admin') {
          var mutes = (loadDb().notificationMutes) || { global: false, users: {}, types: {} };
          function isMuted(type) {
            if (mutes.global) return true;
            if (mutes.users && mutes.users[user2.id]) return true;
            if (mutes.types && mutes.types[type]) return true;
            return false;
          }
          function pushNotif(type, text) {
            if (isMuted(type)) return;
            notifs.push({ id: genId(), type: type, text: text, fromUserId: user2.id, fromUserName: user2.name, createdAt: Date.now(), read: false });
          }
          var addedClients = (data.clients || []).filter(function(c) { return c && c.id && !curClientIds[c.id]; });
          var addedProps = (data.properties || []).filter(function(p) { return p && p.id && !curPropIds[p.id]; });
          var addedTx = (data.transactions || []).filter(function(t) { return t && t.id && !curTxIds[t.id]; });
          var priceChanges = [];
          (data.properties || []).forEach(function(p) {
            if (p && p.id && curPropPrices[p.id] !== undefined && p.totalPrice && p.totalPrice !== curPropPrices[p.id]) {
              priceChanges.push({ p: p, old: curPropPrices[p.id], now: p.totalPrice });
            }
          });
          if (addedClients.length) pushNotif('client', '【新客户】' + user2.name + ' 新增了 ' + addedClients.length + ' 个客户');
          if (addedProps.length) pushNotif('property', '【新房源】' + user2.name + ' 新增了 ' + addedProps.length + ' 套房源');
          if (addedTx.length) pushNotif('transaction', '【新成交】' + user2.name + ' 新增了 ' + addedTx.length + ' 笔成交');
          priceChanges.forEach(function(pc) {
            pushNotif('price', '【改价】' + user2.name + ' 将「' + (pc.p.title || pc.p.community || '房源') + '」价格 ' + pc.old + ' → ' + pc.now);
          });
          if (notifs.length) {
            var dbn = loadDb();
            dbn.notifications = dbn.notifications || [];
            dbn.notifications = dbn.notifications.concat(notifs);
            saveDb({ notifications: dbn.notifications });
          }
        }
      });
      sendJson(res, 200, { ok: true });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 通知：拉取（仅管理员）--- */
  if (pathname === '/api/notifications' && method === 'GET') {
    var nu = requireAuth(req, res); if (!nu) return;
    var nots = (db.notifications || []).slice().sort(function(a, b) { return b.createdAt - a.createdAt; });
    var unread = nots.filter(function(n) { return !n.read; }).length;
    sendJson(res, 200, { notifications: nots, unread: unread });
    return;
  }

  /* --- 通知：标记已读 --- */
  if (pathname === '/api/notifications/read' && method === 'POST') {
    var nu2 = requireAuth(req, res); if (!nu2) return;
    if (nu2.role !== 'admin') { sendJson(res, 403, { error: '无权限' }); return; }
    try {
      var rd = JSON.parse(await readBody(req));
      var dbn = loadDb();
      dbn.notifications = dbn.notifications || [];
      if (rd.all) { dbn.notifications.forEach(function(n) { n.read = true; }); }
      else if (rd.ids && rd.ids.length) {
        var idset = {}; rd.ids.forEach(function(i) { idset[i] = true; });
        dbn.notifications.forEach(function(n) { if (idset[n.id]) n.read = true; });
      }
      saveDb({ notifications: dbn.notifications });
      sendJson(res, 200, { ok: true });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 通知：静音设置 --- */
  if (pathname === '/api/notifications/mute' && method === 'POST') {
    var nu3 = requireAuth(req, res); if (!nu3) return;
    if (nu3.role !== 'admin') { sendJson(res, 403, { error: '无权限' }); return; }
    try {
      var md = JSON.parse(await readBody(req));
      var dbm = loadDb();
      dbm.notificationMutes = dbm.notificationMutes || { global: false, users: {}, types: {} };
      if (md.scope === 'global') dbm.notificationMutes.global = !!md.muted;
      else if (md.scope && md.scope.indexOf('user:') === 0) dbm.notificationMutes.users[md.scope.slice(5)] = !!md.muted;
      else if (md.scope && md.scope.indexOf('type:') === 0) dbm.notificationMutes.types[md.scope.slice(5)] = !!md.muted;
      saveDb({ notificationMutes: dbm.notificationMutes });
      sendJson(res, 200, { ok: true });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 应用设置（高德Key等，全员共享；登录可读，管理员可写） --- */
  if (pathname === "/api/settings" && method === "GET") {
    var setUser = requireAuth(req, res); if (!setUser) return;
    var _st = (loadDb().appSettings) || {};
    if (setUser.role === "admin") { sendJson(res, 200, Object.assign({ amapConfigured: !!_st.amapWebKey }, _st)); }
    else { sendJson(res, 200, { amapConfigured: !!_st.amapWebKey }); }
    return;
  }
  if (pathname === "/api/settings" && method === "POST") {
    var setAdmin = requireAuth(req, res); if (!setAdmin) return;
    if (setAdmin.role !== "admin") { sendJson(res, 403, { error: "仅管理员可修改应用设置" }); return; }
    try {
      var sBody = JSON.parse(await readBody(req, 256 * 1024));
      await withDbLock(function () {
        var d = loadDb();
        var merged = Object.assign({}, d.appSettings || {}, sBody || {});
        saveDb({ appSettings: merged });
        return merged;
      });
      sendJson(res, 200, { ok: true, settings: (loadDb().appSettings) || {} });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 购房政策（公开读取，管理员可更新） --- */
  if (pathname === '/api/policy' && method === 'GET') {
    try { sendJson(res, 200, loadPolicy()); }
    catch (e) { sendJson(res, 500, { error: e.message }); }
    return;
  }
  if (pathname === '/api/policy' && method === 'POST') {
    var pu = requireAuth(req, res); if (!pu) return;
    if (pu.role !== 'admin') { sendJson(res, 403, { error: '仅管理员可更新政策数据' }); return; }
    try {
      var pd = JSON.parse(await readBody(req, 2 * 1024 * 1024));
      var saved = savePolicy(pd);
      sendJson(res, 200, { ok: true, policy: saved });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 媒体上传 --- */
  if (pathname === '/api/media' && method === 'POST') {
    var user3 = requireAuth(req, res); if (!user3) return;
    try {
      var record = JSON.parse(await readBody(req, 800 * 1024 * 1024));
      if (!record.id) { sendJson(res, 400, { error: 'Missing media id' }); return; }
      var mediaFile = path.join(MEDIA_DIR, record.id + '.json');
      fs.writeFileSync(mediaFile, JSON.stringify(record));
      if (!db.mediaMeta) db.mediaMeta = {};
      db.mediaMeta[record.id] = {
        id: record.id, propertyId: record.propertyId, type: record.type,
        name: record.name || '', category: record.category || '',
        showroomArea: record.showroomArea || '', showroomType: record.showroomType || '',
        uploadedBy: user3.id
      };
      saveDb({ mediaMeta: db.mediaMeta });
      sendJson(res, 200, { ok: true, id: record.id });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 媒体列表 --- */
  if (pathname.indexOf('/api/media/list/') === 0 && method === 'GET') {
    var user4 = requireAuth(req, res); if (!user4) return;
    var propId = decodeURIComponent(pathname.replace('/api/media/list/', ''));
    var mediaMeta = db.mediaMeta || {};
    var ids = Object.keys(mediaMeta).filter(function(id) { return mediaMeta[id].propertyId === propId; });
    var records = [];
    ids.forEach(function(id) {
      var meta = mediaMeta[id];
      if (meta && meta.isRawFile) {
        /* raw 文件：只返回元数据 + URL，不加载文件内容 */
        records.push({
          id: meta.id, propertyId: meta.propertyId, type: meta.type,
          name: meta.name || '', category: meta.category || '',
          showroomArea: meta.showroomArea || '', showroomType: meta.showroomType || '',
          serverUrl: '/api/media/file/' + meta.id, isRawFile: true
        });
      } else {
        /* 旧格式：JSON 文件中包含 base64 dataUrl */
        var mf = path.join(MEDIA_DIR, id + '.json');
        if (fs.existsSync(mf)) {
          try { records.push(JSON.parse(fs.readFileSync(mf, 'utf-8'))); }
          catch (e) {}
        }
      }
    });
    sendJson(res, 200, records);
    return;
  }

  /* --- 媒体下载（返回原始文件）--- */
  if (pathname.indexOf('/api/media/download/') === 0 && method === 'GET') {
    var user5 = requireAuth(req, res); if (!user5) return;
    var mediaId = decodeURIComponent(pathname.replace('/api/media/download/', ''));
    var mf2 = path.join(MEDIA_DIR, mediaId + '.json');
    if (!fs.existsSync(mf2)) { sendJson(res, 404, { error: 'Not found' }); return; }
    try {
      var rec = JSON.parse(fs.readFileSync(mf2, 'utf-8'));
      var dataUrl = rec.dataUrl || '';
      var base64Data = dataUrl.split(',')[1] || '';
      var buffer = Buffer.from(base64Data, 'base64');
      var ext = rec.type === 'video' ? '.mp4' : '.jpg';
      var fileName = (rec.name || 'download').replace(/\.[^.]+$/, '') + '_watermarked' + ext;
      res.writeHead(200, {
        'Content-Type': rec.type === 'video' ? 'video/mp4' : 'image/jpeg',
        'Content-Disposition': 'attachment; filename="' + encodeURIComponent(fileName) + '"',
        'Content-Length': buffer.length
      });
      res.end(buffer);
    } catch (e) { sendJson(res, 500, { error: e.message }); }
    return;
  }

  /* --- 媒体原始文件上传（视频专用，raw binary） --- */
  if (pathname === '/api/media/upload-raw' && method === 'POST') {
    var userRaw = requireAuth(req, res); if (!userRaw) return;
    try {
      var urlObj = new URL('http://localhost' + req.url);
      var q = urlObj.searchParams;
      var rawMediaId = q.get('id') || genId();
      var rawPropId = q.get('propertyId') || '';
      var rawType = q.get('type') || 'video';
      var rawName = q.get('name') || 'upload.mp4';
      var rawCategory = q.get('category') || '';
      var rawShowroomArea = q.get('showroomArea') || '';
      var rawShowroomType = q.get('showroomType') || '';
      var rawExt = rawType === 'video' ? '.mp4' : '.jpg';
      var rawFilePath = path.join(MEDIA_DIR, rawMediaId + rawExt);
      /* 流式写入文件，避免内存堆积 */
      var writeStream = fs.createWriteStream(rawFilePath);
      var rawSize = 0;
      var sizeLimit = 600 * 1024 * 1024; /* 600MB limit for raw uploads */
      req.on('data', function(chunk) {
        rawSize += chunk.length;
        if (rawSize > sizeLimit) {
          writeStream.destroy();
          fs.unlinkSync(rawFilePath);
          sendJson(res, 413, { error: '文件超过600MB限制' });
          return;
        }
        writeStream.write(chunk);
      });
      req.on('end', function() {
        writeStream.end();
        writeStream.on('finish', function() {
          if (!db.mediaMeta) db.mediaMeta = {};
          db.mediaMeta[rawMediaId] = {
            id: rawMediaId, propertyId: rawPropId, type: rawType,
            name: rawName, category: rawCategory,
            showroomArea: rawShowroomArea, showroomType: rawShowroomType,
            isRawFile: true,
            uploadedBy: userRaw.id
          };
          saveDb({ mediaMeta: db.mediaMeta });
          sendJson(res, 200, { ok: true, id: rawMediaId, url: '/api/media/file/' + rawMediaId });
        });
      });
      req.on('error', function(e) {
        writeStream.destroy();
        if (fs.existsSync(rawFilePath)) fs.unlinkSync(rawFilePath);
        sendJson(res, 500, { error: '上传失败: ' + e.message });
      });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 媒体原始文件获取（流式返回，不加载到内存） --- */
  if (pathname.indexOf('/api/media/file/') === 0 && method === 'GET') {
    var userFile = requireAuth(req, res); if (!userFile) return;
    var fileMediaId = decodeURIComponent(pathname.replace('/api/media/file/', ''));
    var fileMeta = (db.mediaMeta || {})[fileMediaId];
    if (!fileMeta) { sendJson(res, 404, { error: 'Not found' }); return; }
    var fileExt = fileMeta.type === 'video' ? '.mp4' : '.jpg';
    var rawFp = path.join(MEDIA_DIR, fileMediaId + fileExt);
    if (!fs.existsSync(rawFp)) { sendJson(res, 404, { error: 'File not found' }); return; }
    var stat = fs.statSync(rawFp);
    var ct = fileMeta.type === 'video' ? 'video/mp4' : 'image/jpeg';
    res.writeHead(200, {
      'Content-Type': ct,
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(rawFp).pipe(res);
    return;
  }

  /* --- 媒体删除 --- */
  if (pathname.indexOf('/api/media/') === 0 && method === 'DELETE') {
    var user6 = requireAuth(req, res); if (!user6) return;
    var mediaId2 = decodeURIComponent(pathname.replace('/api/media/', ''));
    /* 删除 JSON 格式的旧文件 */
    var fp = path.join(MEDIA_DIR, mediaId2 + '.json');
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    /* 删除 raw 格式的文件（视频/图片） */
    var meta2 = (db.mediaMeta || {})[mediaId2];
    if (meta2 && meta2.isRawFile) {
      var rawExt2 = meta2.type === 'video' ? '.mp4' : '.jpg';
      var rawFp2 = path.join(MEDIA_DIR, mediaId2 + rawExt2);
      if (fs.existsSync(rawFp2)) fs.unlinkSync(rawFp2);
    }
    if (db.mediaMeta && db.mediaMeta[mediaId2]) {
      delete db.mediaMeta[mediaId2];
      saveDb({ mediaMeta: db.mediaMeta });
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  /* --- 媒体批量删除 --- */
  if (pathname.indexOf('/api/media/removeAll/') === 0 && method === 'DELETE') {
    var user7 = requireAuth(req, res); if (!user7) return;
    var propId2 = decodeURIComponent(pathname.replace('/api/media/removeAll/', ''));
    var mm = db.mediaMeta || {};
    Object.keys(mm).forEach(function(id) {
      if (mm[id].propertyId === propId2) {
        var f = path.join(MEDIA_DIR, id + '.json');
        if (fs.existsSync(f)) fs.unlinkSync(f);
        /* 删除 raw 格式文件 */
        if (mm[id].isRawFile) {
          var rawExt3 = mm[id].type === 'video' ? '.mp4' : '.jpg';
          var rawFp3 = path.join(MEDIA_DIR, id + rawExt3);
          if (fs.existsSync(rawFp3)) fs.unlinkSync(rawFp3);
        }
        delete mm[id];
      }
    });
    saveDb({ mediaMeta: mm });
    sendJson(res, 200, { ok: true });
    return;
  }

  /* --- 图片代理：抓取外部图片（公众号/网页），返回base64 --- */
  if (pathname === '/api/proxy/image' && method === 'GET') {
    var parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    var imgUrl = parsedUrl.searchParams.get('url');
    if (!imgUrl) { sendJson(res, 400, { ok: false, error: '缺少 url 参数' }); return; }
    if (!/^https?:\/\//i.test(imgUrl)) { sendJson(res, 400, { ok: false, error: '无效的URL' }); return; }
    var lib = imgUrl.startsWith('https') ? https : http;
    var options = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': imgUrl } };
    var proxyReq = lib.get(imgUrl, options, function(proxyRes) {
      if (proxyRes.statusCode !== 200) { sendJson(res, 502, { ok: false, error: '图片获取失败 HTTP ' + proxyRes.statusCode }); return; }
      var contentType = proxyRes.headers['content-type'] || 'image/jpeg';
      if (contentType.indexOf('image') < 0) { sendJson(res, 400, { ok: false, error: '非图片类型: ' + contentType }); return; }
      var chunks = [];
      proxyRes.on('data', function(chunk) { chunks.push(chunk); });
      proxyRes.on('end', function() {
        var buffer = Buffer.concat(chunks);
        if (buffer.length < 100) { sendJson(res, 400, { ok: false, error: '图片太小，可能是图标' }); return; }
        var b64 = buffer.toString('base64');
        var dataUrl = 'data:' + contentType + ';base64,' + b64;
        sendJson(res, 200, { ok: true, dataUrl: dataUrl, size: buffer.length });
      });
    });
    proxyReq.on('error', function(err) { sendJson(res, 500, { ok: false, error: err.message }); });
    proxyReq.setTimeout(10000, function() { proxyReq.destroy(); sendJson(res, 504, { ok: false, error: '获取超时' }); });
    return;
  }

  /* --- 房源MD（业主名单）：按需拉取，避免 2 万多条全量进入每次同步导致超时/踢登录 --- */
  if (pathname === '/api/md' && method === 'GET') {
    var mdu = requireAuth(req, res); if (!mdu) return;
    var _canMD = mdu.role === 'admin' || ((db.mdViewers || []).indexOf(mdu.id) >= 0);
    if (!_canMD) { sendJson(res, 403, { error: '无权限查看房源MD' }); return; }
    try {
      var _mu = new URL('http://localhost' + req.url);
      var _com = (_mu.searchParams.get('community') || '').trim();
      var _kw = (_mu.searchParams.get('keyword') || '').trim();
      var _pg = parseInt(_mu.searchParams.get('page') || '1', 10) || 1;
      var _ps = parseInt(_mu.searchParams.get('pageSize') || '2000', 10) || 2000;
      if (_ps > 5000) _ps = 5000;
      var _ol = (_mu.searchParams.get('onlyListed') || '') === '1';
      var _all = (db.properties || []).filter(function(p) { return p.type === 'md'; });
      if (_com) _all = _all.filter(function(p) { return (p.community || '') === _com; });
      if (_kw) {
        var _k = _kw.toLowerCase();
        _all = _all.filter(function(p) {
          return [p.community, p.ownerName, p.ownerPhone, p.ownerReserve, p.room, p.building, p.unit, p.address, p.description]
            .some(function(v) { return (v || '').toString().toLowerCase().indexOf(_k) >= 0; });
        });
      }
      if (_ol) _all = _all.filter(function(p) { var st = p.status || '未上架'; return st === '在售' || st === '在租'; });
      var _listed = _all.filter(function(p) { var st = p.status || '未上架'; return st === '在售' || st === '在租'; }).length;
      var _total = _all.length;
      var _start = (_pg - 1) * _ps;
      var _items = _all.slice(_start, _start + _ps);
      sendJson(res, 200, { items: _items, total: _total, listed: _listed, page: _pg, pageSize: _ps });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
    return;
  }
  if (pathname === '/api/md/communities' && method === 'GET') {
    var mcu2 = requireAuth(req, res); if (!mcu2) return;
    var _canMD2 = mcu2.role === 'admin' || ((db.mdViewers || []).indexOf(mcu2.id) >= 0);
    if (!_canMD2) { sendJson(res, 403, { error: '无权限' }); return; }
    var _cs = {};
    (db.properties || []).forEach(function(p) { if (p.type === 'md' && p.community) _cs[p.community] = 1; });
    sendJson(res, 200, { communities: Object.keys(_cs).sort() });
    return;
  }

  /* --- 备份触发（仅管理员）--- */
  if (pathname === '/api/backup/trigger' && method === 'POST') {
    var bu = requireAuth(req, res); if (!bu) return;
    if (bu.role !== 'admin') { sendJson(res, 403, { error: '仅管理员可触发备份' }); return; }
    try {
      console.log('[BACKUP] 管理员 ' + bu.name + ' 手动触发备份...');
      var r = await runBackup();
      if (r.results && r.results.length) {
        r.results.forEach(function(x) {
          console.log('[BACKUP] ✓ ' + x.type + ': ' + x.name + ' (' + (x.gzSize / 1024).toFixed(1) + ' KB)');
        });
      }
      if (r.cosResults && r.cosResults.length) {
        r.cosResults.forEach(function(c) {
          if (c.ok) console.log('[BACKUP][COS] ✓ 已上传: ' + c.key + ' (' + (c.size / 1024).toFixed(1) + ' KB)');
          else console.log('[BACKUP][COS] ✗ 上传失败: ' + c.key + ' - ' + (c.error || ('HTTP ' + c.status)));
        });
      }
      sendJson(res, 200, { ok: true, ts: r.ts, results: r.results, cosResults: r.cosResults });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
    return;
  }

  /* --- 备份列表（仅管理员）--- */
  if (pathname === '/api/backup/list' && method === 'GET') {
    var blu = requireAuth(req, res); if (!blu) return;
    if (blu.role !== 'admin') { sendJson(res, 403, { error: '仅管理员' }); return; }
    try {
      var bfiles = fs.readdirSync(BACKUP_DIR).filter(function(f) { return /\.(json\.gz|tar\.gz)$/.test(f); });
      var blist = bfiles.map(function(f) {
        var st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, mtime: st.mtime.toISOString() };
      }).sort(function(a, b) { return b.mtime.localeCompare(a.mtime); });
      sendJson(res, 200, { backups: blist });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
    return;
  }

  // 404
  sendJson(res, 404, { error: 'Not found' });
}

/* ========== 自动备份 ========== */
/* 保留策略：每天保留最近7天 + 每周保留最近4周 */
var BACKUP_MAX_DAILY = 7;
var BACKUP_MAX_WEEKLY = 4;

function _nowISO() {
  var d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0') + 'T' +
    String(d.getHours()).padStart(2, '0') + '-' +
    String(d.getMinutes()).padStart(2, '0') + '-' +
    String(d.getSeconds()).padStart(2, '0');
}

function _backupFile(srcPath, destName) {
  if (!fs.existsSync(srcPath)) return null;
  var raw = fs.readFileSync(srcPath);
  var gz = zlib.gzipSync(raw);
  var destPath = path.join(BACKUP_DIR, destName);
  fs.writeFileSync(destPath, gz);
  return { name: destName, rawSize: raw.length, gzSize: gz.length };
}

function _backupDir(srcDir, destName) {
  if (!fs.existsSync(srcDir)) return null;
  // Use child_process to tar+gz the directory
  var cp = require('child_process');
  var destPath = path.join(BACKUP_DIR, destName);
  try {
    cp.execSync('tar -czf "' + destPath + '" -C "' + path.dirname(srcDir) + '" "' + path.basename(srcDir) + '"', { timeout: 120000 });
  } catch (e) {
    console.error('[BACKUP] tar failed:', e.message);
    return null;
  }
  var stat = fs.statSync(destPath);
  return { name: destName, rawSize: _dirSize(srcDir), gzSize: stat.size };
}

function _dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  var total = 0;
  try {
    var files = fs.readdirSync(dir);
    files.forEach(function(f) {
      var fp = path.join(dir, f);
      var st = fs.statSync(fp);
      if (st.isFile()) total += st.size;
      else if (st.isDirectory()) total += _dirSize(fp);
    });
  } catch (e) {}
  return total;
}

/* ========== COS 异地备份（腾讯云对象存储） ========== */
/* 使用 COS 原生 HMAC-SHA1 签名，零外部依赖 */
function _cosSign(method, cosPath, expireSeconds) {
  var now = Math.floor(Date.now() / 1000);
  var signTime = now + ';' + (now + (expireSeconds || 600));
  var keyTime = signTime;
  var httpString = method.toLowerCase() + '\n' + cosPath + '\n\n\n';
  var sha1HttpString = crypto.createHash('sha1').update(httpString).digest('hex');
  var stringToSign = 'sha1\n' + signTime + '\n' + sha1HttpString + '\n';
  var signKey = crypto.createHmac('sha1', COS_SECRET_KEY).update(keyTime).digest('hex');
  var signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  return 'q-sign-algorithm=sha1&q-ak=' + COS_SECRET_ID +
    '&q-sign-time=' + signTime + '&q-key-time=' + keyTime +
    '&q-header-list=&q-url-param-list=&q-signature=' + signature;
}

function _uploadToCos(localPath, cosKey) {
  return new Promise(function(resolve) {
    if (!COS_ENABLED) { resolve({ skipped: true, reason: 'COS not configured' }); return; }
    if (!fs.existsSync(localPath)) { resolve({ skipped: true, reason: 'file not found' }); return; }
    try {
      var fileContent = fs.readFileSync(localPath);
      var cosPath = '/' + cosKey;
      var auth = _cosSign('put', cosPath, 600);
      var req = https.request({
        hostname: COS_BUCKET + '.cos.' + COS_REGION + '.myqcloud.com',
        port: 443,
        path: cosPath,
        method: 'PUT',
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/octet-stream',
          'Content-Length': fileContent.length
        },
        timeout: 120000
      }, function(res) {
        var body = '';
        res.on('data', function(chunk) { body += chunk; });
        res.on('end', function() {
          if (res.statusCode === 200) {
            resolve({ ok: true, key: cosKey, size: fileContent.length });
          } else {
            resolve({ ok: false, key: cosKey, status: res.statusCode, body: body.slice(0, 200) });
          }
        });
      });
      req.on('error', function(e) { resolve({ ok: false, error: e.message }); });
      req.end(fileContent);
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

function _uploadToCosSync(localPath, cosKey) {
  // 同步包装（用于 runBackup 内部，跑在定时器里不需要阻塞请求循环）
  return new Promise(function(resolve) {
    _uploadToCos(localPath, cosKey).then(resolve).catch(function(e) { resolve({ ok: false, error: e.message }); });
  });
}

async function runBackup() {
  var ts = _nowISO();
  var results = [];
  var cosResults = [];

  // 1. 备份数据库
  var dbResult = _backupFile(DB_FILE, 'db-' + ts + '.json.gz');
  if (dbResult) results.push({ type: 'db', name: dbResult.name, rawSize: dbResult.rawSize, gzSize: dbResult.gzSize });

  // 2. 备份媒体文件
  var mediaResult = _backupDir(MEDIA_DIR, 'media-' + ts + '.tar.gz');
  if (mediaResult) results.push({ type: 'media', name: mediaResult.name, rawSize: mediaResult.rawSize, gzSize: mediaResult.gzSize });

  // 3. 清理过期备份
  _cleanOldBackups();

  // 4. 上传到 COS（异步，每个文件独立上传）
  if (COS_ENABLED && results.length) {
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var cosKey = 'backups/' + r.name;
      var cosR = await _uploadToCos(path.join(BACKUP_DIR, r.name), cosKey);
      cosResults.push(cosR);
    }
  }

  return { ts: ts, results: results, cosResults: cosResults.length ? cosResults : (COS_ENABLED ? null : undefined) };
}

function _cleanOldBackups() {
  try {
    var files = fs.readdirSync(BACKUP_DIR);
    // 按时间戳排序（从文件名提取）
    var parsed = [];
    files.forEach(function(f) {
      var m = f.match(/^(db|media)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.(json\.gz|tar\.gz)$/);
      if (m) parsed.push({ file: f, ts: new Date(m[2].replace('T', ' ').replace(/-/g, ':').replace(/^(\d{4}):/, '$1-')).getTime() });
    });
    parsed.sort(function(a, b) { return b.ts - a.ts; });

    // 保留策略：按日期分组，每日期保留最新一份；超过7天的保留每周最后一份
    var dayMap = {};
    parsed.forEach(function(p) {
      var d = new Date(p.ts);
      var dayKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (!dayMap[dayKey]) dayMap[dayKey] = p.ts;
    });
    var days = Object.keys(dayMap).sort();
    var keep = {};
    // 最近7天全部保留
    var last7 = days.slice(-BACKUP_MAX_DAILY);
    last7.forEach(function(d) { keep[d] = true; });
    // 之外每周保留一份
    var older = days.slice(0, -BACKUP_MAX_DAILY);
    var weekKept = 0;
    for (var i = older.length - 1; i >= 0 && weekKept < BACKUP_MAX_WEEKLY; i--) {
      if (!keep[older[i]]) { keep[older[i]] = true; weekKept++; }
    }

    // 删除不在保留范围内的
    var deleted = 0;
    parsed.forEach(function(p) {
      var d = new Date(p.ts);
      var dayKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (!keep[dayKey]) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, p.file)); deleted++; }
        catch (e) {}
      }
    });
    if (deleted > 0) console.log('[BACKUP] 清理 ' + deleted + ' 个过期备份');
  } catch (e) {
    console.error('[BACKUP] 清理失败:', e.message);
  }
}

function _scheduleNextBackup() {
  var now = new Date();
  // 目标：下一个凌晨 3:00
  var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  var ms = target.getTime() - now.getTime();
  console.log('[BACKUP] 下次自动备份: ' + target.toLocaleString() + ' (距现在 ' + Math.round(ms / 3600000) + ' 小时)');
  setTimeout(async function() {
    console.log('[BACKUP] 每日自动备份开始...');
    var r = await runBackup();
    if (r.results && r.results.length) {
      r.results.forEach(function(x) {
        console.log('[BACKUP] ✓ ' + x.type + ': ' + x.name + ' (' + (x.gzSize / 1024).toFixed(1) + ' KB)');
      });
    } else {
      console.log('[BACKUP] ⚠ 无文件备份（数据目录可能为空）');
    }
    if (r.cosResults && r.cosResults.length) {
      r.cosResults.forEach(function(c) {
        if (c.ok) console.log('[BACKUP][COS] ✓ 已上传: ' + c.key + ' (' + (c.size / 1024).toFixed(1) + ' KB)');
        else console.log('[BACKUP][COS] ✗ 上传失败: ' + c.key + ' - ' + (c.error || ('HTTP ' + c.status)));
      });
    }
    // 调度下一次（24小时后）
    _scheduleNextBackup();
  }, ms);
}

/* ========== 服务器 ========== */
var server = http.createServer(function(req, res) {
  var url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  var pathname = url.pathname;
  var method = req.method;
  if (pathname.indexOf('/api/') === 0) {
    handleApi(req, res, pathname, method).catch(function(e) {
      console.error('API error:', e);
      sendJson(res, 500, { error: 'Internal server error' });
    });
    return;
  }
  serveStatic(req, res, pathname);
});

if (require.main === module) {
  server.listen(PORT, function() {
    console.log('');
    console.log('  ╔═══════════════════════════════════════╗');
    console.log('  ║   掌房 v6.0 多用户版已启动！           ║');
    console.log('  ╚═══════════════════════════════════════╝');
    console.log('');
    console.log('  电脑访问:  http://localhost:' + PORT);
    console.log('  手机访问:  http://你的IP地址:' + PORT);
    console.log('');
    console.log('  数据存储:  ' + DB_FILE);
    console.log('  媒体目录:  ' + MEDIA_DIR);
    console.log('  备份目录:  ' + BACKUP_DIR);
    console.log('  COS 异地:  ' + (COS_ENABLED ? (COS_BUCKET + '@' + COS_REGION) : '未配置'));
    console.log('');
    console.log('  按 Ctrl+C 停止服务');
    console.log('');
    // 启动每日自动备份（凌晨 3:00）
    _scheduleNextBackup();
  });
}

if (typeof module !== 'undefined') {
module.exports = {
  upsertCollection: upsertCollection, loadDb: loadDb, saveDb: saveDb,
  verifyPw: verifyPw, hashPw: hashPw, parseAuth: parseAuth, genToken: genToken, withDbLock: withDbLock,
  sanitizeProps: sanitizeProps, canSeeSensitive: canSeeSensitive, SENSITIVE_KEYS: SENSITIVE_KEYS,
  loadPolicy: loadPolicy, savePolicy: savePolicy
};
}
