/*
 * GitHub自动部署脚本
 * 用法: node deploy_github.js
 * 需要输入: GitHub用户名 + Personal Access Token
 * 自动创建仓库并上传所有文件
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

var GITHUB_USER = '';
var GITHUB_TOKEN = '';
var REPO_NAME = 'xiaowen-fkb';

// 需要上传的文件列表
var FILES_TO_UPLOAD = [
  'package.json',
  'server.js',
  'app.js',
  'index.html',
  'Dockerfile',
  '.dockerignore',
  '.gitignore',
  'DEPLOY.md',
  'start.sh',
  'assets/logo.jpg',
  'assets/logo-128.jpg',
  'assets/logo-64.jpg',
  'data/db.json',
  'data/media/.gitkeep'
];

function githubRequest(method, url, data) {
  return new Promise(function(resolve, reject) {
    var body = data ? JSON.stringify(data) : null;
    var options = {
      hostname: 'api.github.com',
      path: url,
      method: method,
      headers: {
        'Authorization': 'token ' + GITHUB_TOKEN,
        'User-Agent': 'xiaowen-fkb-deploy',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);
    var req = https.request(options, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(text) }); }
        catch(e) { resolve({ status: res.statusCode, data: text }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function uploadFile(filePath, retry) {
  return new Promise(function(resolve, reject) {
    var fullPath = path.join(__dirname, filePath);
    if (!fs.existsSync(fullPath)) { console.log('  跳过(不存在):', filePath); resolve(); return; }
    var content = fs.readFileSync(fullPath);
    var base64 = content.toString('base64');
    console.log('  上传:', filePath, '(' + Math.round(content.length / 1024) + 'KB)');
    githubRequest('PUT', '/repos/' + GITHUB_USER + '/' + REPO_NAME + '/contents/' + filePath, {
      message: 'Upload ' + filePath,
      content: base64
    }).then(function(res) {
      if (res.status === 201 || res.status === 200) {
        console.log('  ✓ 成功');
        resolve();
      } else if (res.status === 422 && retry !== true) {
        // File already exists, try to get SHA and update
        console.log('  文件已存在，尝试更新...');
        githubRequest('GET', '/repos/' + GITHUB_USER + '/' + REPO_NAME + '/contents/' + filePath)
          .then(function(getRes) {
            if (getRes.status === 200 && getRes.data.sha) {
              return githubRequest('PUT', '/repos/' + GITHUB_USER + '/' + REPO_NAME + '/contents/' + filePath, {
                message: 'Update ' + filePath,
                content: base64,
                sha: getRes.data.sha
              });
            }
            throw new Error('Cannot get SHA');
          })
          .then(function(updateRes) {
            if (updateRes.status === 200) { console.log('  ✓ 更新成功'); resolve(); }
            else { console.log('  ✗ 更新失败:', updateRes.status, JSON.stringify(updateRes.data).substring(0, 200)); resolve(); }
          })
          .catch(function(e) { console.log('  ✗ 更新失败:', e.message); resolve(); });
      } else {
        console.log('  ✗ 失败:', res.status, JSON.stringify(res.data).substring(0, 200));
        resolve();
      }
    }).catch(reject);
  });
}

async function main() {
  // 从命令行参数获取
  GITHUB_USER = process.argv[2] || '';
  GITHUB_TOKEN = process.argv[3] || '';
  REPO_NAME = process.argv[4] || 'xiaowen-fkb';

  if (!GITHUB_USER || !GITHUB_TOKEN) {
    // 从stdin读取
    var readline = require('readline');
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(function(resolve) {
      rl.question('GitHub用户名: ', function(answer) { GITHUB_USER = answer.trim(); resolve(); });
    });
    await new Promise(function(resolve) {
      rl.question('Personal Access Token: ', function(answer) { GITHUB_TOKEN = answer.trim(); resolve(); });
    });
    rl.close();
  }

  if (!GITHUB_USER || !GITHUB_TOKEN) {
    console.log('错误: 需要提供GitHub用户名和Token');
    process.exit(1);
  }

  console.log('\n=== 第1步: 创建GitHub仓库 ===');
  var createRes = await githubRequest('POST', '/user/repos', {
    name: REPO_NAME,
    description: '小闻房客宝 - 客户房源成交管理系统 v6.0',
    private: false,
    auto_init: true
  });
  if (createRes.status === 201) {
    console.log('✓ 仓库创建成功: https://github.com/' + GITHUB_USER + '/' + REPO_NAME);
  } else if (createRes.status === 422) {
    console.log('仓库已存在，将更新文件...');
  } else {
    console.log('✗ 创建仓库失败:', createRes.status, JSON.stringify(createRes.data).substring(0, 300));
    process.exit(1);
  }

  // 等待仓库初始化
  console.log('等待仓库初始化...');
  await new Promise(function(r) { setTimeout(r, 3000); });

  console.log('\n=== 第2步: 上传文件 ===');
  for (var i = 0; i < FILES_TO_UPLOAD.length; i++) {
    await uploadFile(FILES_TO_UPLOAD[i]);
  }

  console.log('\n=== 完成！ ===');
  console.log('仓库地址: https://github.com/' + GITHUB_USER + '/' + REPO_NAME);
  console.log('\n下一步:');
  console.log('1. 打开 https://app.koyeb.com');
  console.log('2. 用GitHub登录');
  console.log('3. 点击 Create Web Service');
  console.log('4. 选择 ' + REPO_NAME + ' 仓库');
  console.log('5. Builder选择 Dockerfile');
  console.log('6. Port填 3000');
  console.log('7. 点击Deploy');
}

main().catch(function(e) { console.error('错误:', e.message); process.exit(1); });
