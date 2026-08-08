# 掌房(xiaowen-fkb) 部署 & 跨电脑操作手册

> 最后更新：2026-08-07（v20260807f，密钥免密部署上线）
> **云端可调用的安全版总览（换电脑流程 + 铁律，描述式）**：https://docs.qq.com/aio/DZUdxbUdGTWNRZHBS
> 本文是完整命令版（含绝对路径/凭据，仅存本地项目与服务器，不上云文档以免触发云平台安全策略）。

## 一、系统事实
- 本地项目目录：`/Users/mac/WorkBuddy/2026-07-17-12-38-14/`
- 同源文件：
  - `index.html` 结构 + CSS
  - `app_v21.js` JS 主源（唯一源）
  - `app.js` = app_v21.js 副本（两者必须一致）
  - `server.js` 零依赖 Node 后端
- 服务器（腾讯云 CVM）：
  - IP：`115.159.83.153`
  - 账号：`ubuntu`
  - 密码：`Xwg123456!`
  - 站点目录：`/home/ubuntu/xiaowen-fkb/`
  - 服务：`xiaowen-fkb`（systemd，root 运行，**监听 80 端口**——curl 必须打 `:80`，打 `:3000` 必全空）
- 部署方式（已升级为**密钥免密**）：
  - 私钥：项目内 `.deploy/fkb_deploy`（已 `ssh-copy-id` 到服务器 `authorized_keys`）
  - sudoers：`/etc/sudoers.d/fkb-deploy`（ubuntu 免密 `restart/start/stop/status xiaowen-fkb`）
  - 主用脚本：`./deploy.sh`（密钥免密，无密码提示）
  - 备用脚本：`./deploy.exp`（expect 密码版，密钥丢失时用）

## 二、标准升级流程（改完代码后）
1. 改 `app_v21.js`（唯一 JS 源）
2. `node --check app_v21.js`
3. `cp app_v21.js app.js`
4. 改 `index.html` 里 `<script src="app_v21.js?v=YYYYMMDDx">` 版本号（**必须每次递增**，破浏览器缓存；手机端尤其）
5. `node --check app.js && node --check server.js`
6. `./deploy.sh`（无密码提示，scp 核心文件 + PWA 文件 + icons + 免密重启）
7. 验收：
   - `curl -s --noproxy '*' -o /dev/null -w "%{http_code}" http://115.159.83.153/api/health` 应 `200`
   - `curl -s --noproxy '*' http://115.159.83.153/app_v21.js | wc -c` 应 **= 本地字节数**（零丢失，**不看版本号**）
   - 沙箱代理会按路径缓存忽略 `?v=`，验收务必 `curl --noproxy '*'` 直连 CVM

## 三、三条铁律（任何改动都不得违反）
1. **静态资源务必 gzip + 长缓存**：server.js 已对 js/css 启用 gzip + `max-age=86400`，靠 `?v=` 版本号破缓存；index.html 保持 `no-store`（发版即时生效）。
2. **登录/首屏装饰禁用内联 SVG(data-uri) 与 blur 滤镜**：微信 webview 重绘坑，会导致闪屏/卡顿；装饰只用纯 CSS。
3. **登录显示绝不依赖网络请求**：`showLoginScreen()` 必须同步立即显示。

> 附（UI 动画护栏）：只动 `opacity` + `translateY`（GPU 合成层），禁 `blur`/无限动画/内联 SVG/布局重排；时长 <300ms；尊重系统"减少动态效果"。

## 四、换电脑操作流程（重点）
**目标**：在任意新电脑上登录 WorkBuddy 后，仍能看到本任务并继续升级系统。

### 前提
- WorkBuddy 的对话/任务存于**服务端**，换设备登录同一账号即可看到历史任务并继续追问。
- 系统本身跑在腾讯云，与电脑无关，照常可访问、可登录。

### 步骤
1. **新电脑装 WorkBuddy + 登录同一账号** → 在历史任务里找到"掌房"任务，可继续对话。
2. **取得项目文件**（二选一）：
   - 推荐：把本机项目目录**整体复制**到新电脑（含 `.deploy/` 私钥）；
   - 或：从服务器把最新代码拉回
     `scp -i .deploy/fkb_deploy -o StrictHostKeyChecking=no ubuntu@115.159.83.153:/home/ubuntu/xiaowen-fkb/{index.html,app_v21.js,app.js,server.js,manifest.json,sw.js} ./`（需先有私钥）。
3. **取得部署私钥**（二选一）：
   - 把旧电脑的 `.deploy/fkb_deploy`（私钥）一起复制过来；
   - 或新电脑生成新密钥并授权：
     `ssh-keygen -t ed25519 -f .deploy/fkb_deploy -N ""`
     `ssh-copy-id -i .deploy/fkb_deploy.pub -o StrictHostKeyChecking=no ubuntu@115.159.83.153`（首次需输入服务器密码 `Xwg123456!`）。
   - ⚠️ 私钥等同服务器权限，**勿提交到公开仓库/群聊**。
4. **验证部署链路**：`./deploy.sh` 应无密码提示，输出 `DEPLOY_DONE` + `active`。
5. **照常升级**：改代码 → 走"标准升级流程"→ `./deploy.sh`。

### 若彻底丢失本地一切（仅剩服务器）
- 代码/数据全在云端：拉回代码（步骤2）→ 生成新密钥并 `ssh-copy-id`（步骤3）→ 重配 sudoers（见下）→ 即可继续。
- **重配 sudoers**（需服务器密码一次性）：
  1. 本地写规则到 `/tmp/fkb-deploy.sudoers`：
     `ubuntu ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart xiaowen-fkb, /usr/bin/systemctl start xiaowen-fkb, /usr/bin/systemctl stop xiaowen-fkb, /usr/bin/systemctl status xiaowen-fkb`
  2. `scp -i .deploy/fkb_deploy /tmp/fkb-deploy.sudoers ubuntu@115.159.83.153:/tmp/`
  3. `ssh -i .deploy/fkb_deploy ubuntu@115.159.83.153 "sudo mkdir -p /etc/sudoers.d && sudo cp /tmp/fkb-deploy.sudoers /etc/sudoers.d/fkb-deploy && sudo chmod 440 /etc/sudoers.d/fkb-deploy && sudo visudo -cf /etc/sudoers.d/fkb-deploy"`
     （`sudo` 这一步需密码，可用 expect 驱动；`visudo -cf` 通过才算成功）

## 五、敏感信息
- 服务器密码：`Xwg123456!`（仅本人，存密码管理器更佳）
- 部署私钥：`.deploy/fkb_deploy`（等同服务器权限，勿外泄）
- 数据备份：服务器 `db.json.bak-*` 自动备份，删除记录走 `deleted` 墓碑，勿手动 `rm`

## 六、加密备份还原（换电脑兜底，最省事）

部署私钥已做 **AES-256（CBC）+ 随机盐 + PBKDF2(20万次)** 加密备份，存进腾讯文档（知识库），口令由本人单独保管。换电脑时无需重生成钥匙，直接还原即可。

### 云文档（任何设备可访问）
- 档案卡部署私钥·加密备份：https://docs.qq.com/aio/DZVNOeVJkcGtnWGZv
- 文档里是 base64 密文；**口令不在文档内**，问答里已给（请存密码管理器/记牢）。还原需「密文 + 口令」二者齐全。

### 还原步骤（新电脑上）
1. 从云文档复制整段 base64 密文，存为 `.deploy/fkb_deploy.enc.b64`（或让助手直接取）。
2. 运行还原脚本（Node 实现，避开 macOS 自带老旧 LibreSSL 不支持 pbkdf2 的坑）：
   `node .deploy/restore_key.js .deploy/fkb_deploy.enc.b64 <你的口令>`
3. 脚本把私钥写回 `.deploy/fkb_deploy`（权限 600），输出 `RESTORED_OK`。
4. `./deploy.sh` 应无密码提示，输出 `DEPLOY_DONE` + `active` → 还原成功，可继续部署。

### 安全说明
- 密文强度足够：无口令解不开。口令丢了备份即失效，故口令务必存好。
- 怀疑口令泄露：在常用电脑让助手重新生成一对钥匙并 `ssh-copy-id` 登记，旧备份自动失效。
- 还原脚本 `.deploy/restore_key.js` 与密文 `.deploy/fkb_deploy.enc.b64` 均随项目走。
