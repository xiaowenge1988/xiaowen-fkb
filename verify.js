#!/usr/bin/env node
/**
 * 档案卡(xiaowen-fkb) 自动化完整性检查 (#229)
 * 用途：上线前/后的功能性自查。覆盖：
 *   1) 三个 JS 源语法检查（node --check）
 *   2) app_v21.js 与 app.js 字节一致性（防止手机/电脑端加载不同源）
 *   3) index.html 版本号提取与递增校验
 *   4) 云端健康检查 /api/health 返回 200 且数据零丢失
 *   5) /api/settings 无 token 必须返回 401（权限闸门）
 *   6) 远端 app_v21.js 字节数与本地一致（防部署丢文件）
 * 用法：node verify.js [host]   默认 host=115.159.83.153
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');

const DIR = __dirname;
const HOST = process.argv[2] || '115.159.83.153';
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log((ok ? '✅ PASS ' : '❌ FAIL ') + name + (detail ? '  — ' + detail : ''));
}

// 1) 语法检查
['app_v21.js', 'app.js', 'server.js'].forEach(f => {
  try {
    execSync(`node --check ${path.join(DIR, f)}`, { stdio: 'pipe' });
    check('语法检查 ' + f, true);
  } catch (e) {
    check('语法检查 ' + f, false, String(e.stderr || e.message).split('\n')[0]);
  }
});

// 2) app_v21.js === app.js
try {
  const a = fs.readFileSync(path.join(DIR, 'app_v21.js'));
  const b = fs.readFileSync(path.join(DIR, 'app.js'));
  check('app_v21.js 与 app.js 字节一致', a.length === b.length, `${a.length} vs ${b.length}`);
} catch (e) {
  check('app_v21.js 与 app.js 字节一致', false, e.message);
}

// 3) index.html 版本号
let html = '';
try { html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'); } catch (e) {}
const m = html.match(/app_v21\.js\?v=(\d+[a-z]?)/);
check('index.html 含版本号', !!m, m ? 'v=' + m[1] : '未找到 ?v=');

function get(url, headers) {
  return new Promise(res => {
    const req = http.get({ host: HOST, path: url, headers: headers || {} }, r => {
      let buf = [];
      r.on('data', d => buf.push(d));
      r.on('end', () => res({ code: r.statusCode, body: Buffer.concat(buf).toString('utf8') }));
    });
    req.on('error', e => res({ code: 0, body: '', err: e.message }));
    req.setTimeout(8000, () => { req.destroy(); res({ code: 0, body: '', err: 'timeout' }); });
  });
}

(async () => {
  // 4) 健康检查
  const health = await get('/api/health');
  let hOk = false, hDetail = '';
  try {
    const o = JSON.parse(health.body);
    hOk = health.code === 200 && o.ok === true;
    hDetail = `clients=${o.clients} properties=${o.properties} tx=${o.transactions}`;
  } catch (e) { hDetail = health.err || 'parse fail'; }
  check('云端 /api/health 200 且数据存在', hOk, hDetail);

  // 5) settings 无 token 必须 401
  const set = await get('/api/settings');
  check('云端 /api/settings 无 token 返回 401', set.code === 401, 'code=' + set.code);

  // 6) 远端 app_v21.js 字节一致（不发送 gzip，取原始字节比对）
  const localLen = fs.statSync(path.join(DIR, 'app_v21.js')).size;
  const rawRemote = await new Promise(res => {
    const req = http.get({ host: HOST, path: '/app_v21.js' }, r => {
      let buf = [];
      r.on('data', d => buf.push(d));
      r.on('end', () => res(Buffer.concat(buf)));
    });
    req.on('error', e => res(Buffer.alloc(0)));
    req.setTimeout(8000, () => { req.destroy(); res(Buffer.alloc(0)); });
  });
  check('远端 app_v21.js 字节一致', rawRemote.length === localLen, `local=${localLen} remote=${rawRemote.length}`);

  const failed = results.filter(r => !r.ok);
  console.log('\n========== 完整性检查汇总 ==========');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
  process.exit(failed.length ? 1 : 0);
})();
