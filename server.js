/**
 * 小闻房客宝 v6.0 - 后端服务
 * 多用户系统 + 数据隔离 + 媒体管理
 * 零依赖 Node.js HTTP 服务器
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MEDIA_DIR = path.join(DATA_DIR, 'media');

/* ========== 初始化目录 ========== */
[DATA_DIR, MEDIA_DIR].forEach(function(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

/* ========== 数据库 ========== */
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
    catch (e) { console.error('DB parse error:', e.message); }
  }
  return { users: [], clients: [], properties: [], transactions: [], mediaMeta: {} };
}

function saveDb(data) {
  var current = loadDb();
  var merged = Object.assign({}, current, data);
  fs.writeFileSync(DB_FILE, JSON.stringify(merged, null, 2));
}

var db = loadDb();

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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
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
  return Buffer.from(pw + 'xwg_salt_fkb_v6').toString('base64');
}

function genToken(userId) {
  return Buffer.from(userId + ':' + Date.now()).toString('base64');
}

function parseAuth(req) {
  var auth = req.headers['authorization'] || '';
  if (auth.indexOf('Bearer ') !== 0) return null;
  var token = auth.slice(7);
  try {
    var decoded = Buffer.from(token, 'base64').toString('utf-8');
    var parts = decoded.split(':');
    var userId = parts[0];
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
function serveStatic(req, res, pathname) {
  var filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(ROOT, decodeURIComponent(filePath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.stat(filePath, function(err, stat) {
    if (err || !stat.isFile()) {
      var indexPath = path.join(ROOT, 'index.html');
      fs.readFile(indexPath, function(e2, data) {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(data);
      });
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    var contentType = MIME[ext] || 'application/octet-stream';
    var cacheHeaders = {};
    if (ext === '.html' || ext === '.js' || ext === '.css') cacheHeaders['Cache-Control'] = 'no-cache';
    else cacheHeaders['Cache-Control'] = 'public, max-age=86400';
    res.writeHead(200, Object.assign({ 'Content-Type': contentType }, cacheHeaders));
    fs.createReadStream(filePath).pipe(res);
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
      ok: true, service: '小闻房客宝', version: '6.0',
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

  /* --- 登录 --- */
  if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      var loginData = JSON.parse(await readBody(req));
      var user = (db.users || []).find(function(u) { return u.username === loginData.username && u.active; });
      if (!user || user.password !== hashPw(loginData.password)) {
        sendJson(res, 401, { error: '用户名或密码错误' }); return;
      }
      var token = genToken(user.id);
      sendJson(res, 200, {
        ok: true, token: token,
        user: { id: user.id, username: user.username, name: user.name, phone: user.phone, role: user.role }
      });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  /* --- 用户管理（仅管理员）--- */
  if (pathname === '/api/users' && method === 'GET') {
    var admin = requireAuth(req, res); if (!admin) return;
    if (admin.role !== 'admin') { sendJson(res, 403, { error: '无权限' }); return; }
    var userList = (db.users || []).map(function(u) {
      var clientCount = (db.clients || []).filter(function(c) { return c.createdBy === u.id; }).length;
      return { id: u.id, username: u.username, name: u.name, phone: u.phone, role: u.role, active: u.active, createdAt: u.createdAt, clientCount: clientCount };
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
      var newMember = {
        id: genId(), username: newUserData.username, password: hashPw(newUserData.password),
        name: newUserData.name || newUserData.username, phone: newUserData.phone || '',
        role: 'member', active: true, createdAt: Date.now()
      };
      db.users = db.users || [];
      db.users.push(newMember);
      saveDb({ users: db.users });
      sendJson(res, 200, { ok: true, user: { id: newMember.id, username: newMember.username, name: newMember.name, phone: newMember.phone, role: 'member' } });
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
          if (updateData.password) u.password = hashPw(updateData.password);
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

  /* --- 数据同步 GET（按用户角色过滤）--- */
  if (pathname === '/api/sync' && method === 'GET') {
    var user = requireAuth(req, res); if (!user) return;
    if (user.role === 'admin') {
      sendJson(res, 200, {
        clients: db.clients || [], properties: db.properties || [],
        transactions: db.transactions || [],
        allUsers: (db.users || []).map(function(u) { return { id: u.id, name: u.name, username: u.username, role: u.role, active: u.active }; })
      });
    } else {
      // 成员：只看自己的客户 + 所有房源 + 自己的成交
      var myClients = (db.clients || []).filter(function(c) { return c.createdBy === user.id; });
      var myTx = (db.transactions || []).filter(function(t) { return t.createdBy === user.id; });
      sendJson(res, 200, {
        clients: myClients, properties: db.properties || [], transactions: myTx,
        allUsers: []
      });
    }
    return;
  }

  /* --- 数据同步 POST（按用户角色保存）--- */
  if (pathname === '/api/sync' && method === 'POST') {
    var user2 = requireAuth(req, res); if (!user2) return;
    try {
      var data = JSON.parse(await readBody(req, 800 * 1024 * 1024));
      if (user2.role === 'admin') {
        // 管理员：替换所有数据
        saveDb({
          clients: data.clients || [], properties: data.properties || [],
          transactions: data.transactions || []
        });
      } else {
        // 成员：只替换自己的客户和成交，保留其他人的
        var otherClients = (db.clients || []).filter(function(c) { return c.createdBy !== user2.id; });
        var myNewClients = (data.clients || []).map(function(c) {
          return Object.assign({}, c, { createdBy: user2.id, createdByName: user2.name });
        });
        var otherTx = (db.transactions || []).filter(function(t) { return t.createdBy !== user2.id; });
        var myNewTx = (data.transactions || []).map(function(t) {
          return Object.assign({}, t, { createdBy: user2.id, createdByName: user2.name });
        });
        // 房源：共享，按ID合并（保留其他人新增的房源）
        var propIds = {};
        var newProps = (data.properties || []).map(function(p) {
          propIds[p.id] = true;
          if (!p.createdBy) { p.createdBy = user2.id; p.createdByName = user2.name; }
          return p;
        });
        var keptProps = (db.properties || []).filter(function(p) { return !propIds[p.id]; });
        saveDb({
          clients: otherClients.concat(myNewClients),
          properties: keptProps.concat(newProps),
          transactions: otherTx.concat(myNewTx)
        });
      }
      sendJson(res, 200, { ok: true });
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
      var mf = path.join(MEDIA_DIR, id + '.json');
      if (fs.existsSync(mf)) {
        try { records.push(JSON.parse(fs.readFileSync(mf, 'utf-8'))); }
        catch (e) {}
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

  /* --- 媒体删除 --- */
  if (pathname.indexOf('/api/media/') === 0 && method === 'DELETE') {
    var user6 = requireAuth(req, res); if (!user6) return;
    var mediaId2 = decodeURIComponent(pathname.replace('/api/media/', ''));
    var fp = path.join(MEDIA_DIR, mediaId2 + '.json');
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
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
        delete mm[id];
      }
    });
    saveDb({ mediaMeta: mm });
    sendJson(res, 200, { ok: true });
    return;
  }

  // 404
  sendJson(res, 404, { error: 'Not found' });
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

server.listen(PORT, function() {
  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║   小闻房客宝 v6.0 多用户版已启动！     ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');
  console.log('  电脑访问:  http://localhost:' + PORT);
  console.log('  手机访问:  http://你的IP地址:' + PORT);
  console.log('');
  console.log('  数据存储:  ' + DB_FILE);
  console.log('  媒体目录:  ' + MEDIA_DIR);
  console.log('');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
});
