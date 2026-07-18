# 咪豆猫书签管理器

集中展示与管理网络书签的静态站点，支持访客浏览、管理员登录后草稿编辑，并一键提交到 GitHub。可部署到 **EdgeOne Pages**。

演示视频：

- [YouTube](https://www.youtube.com/watch?v=EkAeZuujfMU)
- [哔哩哔哩](https://www.bilibili.com/video/BV1kQRbYAECA/?share_source=copy_web&vd_source=23dec63201a606a868ef1de824367d80)

---

## 功能概览

| 角色 | 能做什么 |
|------|----------|
| **访客** | 浏览分类与书签、搜索、点「访问」打开链接。**不能**排序、增删改、登录相关写操作 |
| **管理员** | 两步登录后进入编辑模式：增删改书签、分类内排序、**分类排序**、新建分类；改动仅内存草稿，点「提交到 GitHub」一次写入 |

---

## 访客使用

1. 打开站点首页。
2. 顶部搜索框可按标题 / 描述 / URL / 分类名过滤。
3. 底部导航切换分类；卡片上点「访问」打开链接。
4. 访客看不到「管理」编辑能力以外的写操作入口（无分类排序按钮、无 FAB 添加等）。

---

## 管理员使用

### 1. 登录（两步）

1. 点页面左上角 **管理**。
2. **步骤 1**：邮箱 + 密码 → 调用远程登录接口（由环境变量 `LOGIN_URL` 配置）。
3. **步骤 2**：填写 GitHub 仓库（`owner/repo`）、Token、JSON 路径（默认 `bookmarks.json`）→ 从 GitHub 拉取书签并进入编辑模式。

Token 需对仓库有 **Contents 读写** 权限。仓库 / Token / 路径会记在浏览器 `localStorage`，密码不会。

### 2. 编辑书签

进入编辑模式后：

- 右下角 **+**：添加书签  
  - **已有分类**：下拉选择  
  - **新建分类**：在下方输入框填写名称（填写后优先使用新建名）
- 分类标题旁：**排序**（该分类内书签顺序）、**+**（在该分类下添加）
- 卡片：**编辑** / **删除**

### 3. 分类排序

仅管理员可见，入口在 **底部导航右侧「分类排序」**（不在顶栏）。

1. 打开弹窗，拖动行或修改右侧序号交换位置。  
2. **完成**：保留顺序并刷新页面分区 / 底栏。  
3. **取消**：恢复打开弹窗前的顺序。  
4. 顺序写在 `bookmarks.json` 的对象 key 顺序里，需再点 **提交到 GitHub** 才落盘。

### 4. 提交 / 丢弃 / 退出

顶栏：

| 按钮 | 作用 |
|------|------|
| 提交到 GitHub | 将当前草稿整份 PUT 为 1 个 commit（`sync: 更新书签`） |
| 丢弃更改 | 恢复为登录时从 GitHub 拉到的快照 |
| 退出 | 退出编辑模式；有未提交更改会确认 |

未提交时刷新 / 关闭标签页会触发浏览器离开提示。

---

## 本地运行

### 方式 A：纯静态（仅看页面）

```bash
# 任选静态服务器，例如
npx --yes serve .
# 或
python -m http.server 8080
```

浏览器打开对应地址。若需本地测登录接口，复制环境配置：

```bash
cp env.example.js env.js
# 编辑 env.js，至少填写 LOGIN_URL
```

`env.js` 已在 `.gitignore` 中，请勿提交敏感地址。

### 方式 B：EdgeOne Makers 本地开发

```bash
npm install -g edgeone@latest
export PAGES_SOURCE=skills

edgeone login --site china   # 或 --site global
edgeone makers env pull      # 拉取远程环境变量到本地 .env
edgeone makers dev --name <你的项目名> --skip-env-sync
```

预览请使用 **HTTP** 地址（如 `http://127.0.0.1:8088/`），不要用 `file://` 打开 `index.html`。

---

## 部署到 EdgeOne Pages

### 1. 声明环境变量

仓库根目录 `.env.example` 已声明：

```env
LOGIN_URL=
LOGIN_EMAIL_FIELD=
LOGIN_PASSWORD_FIELD=
```

CLI 会据此识别并注入平台环境变量。

### 2. 在平台配置变量

控制台填写，或：

```bash
export PAGES_SOURCE=skills
edgeone makers env set LOGIN_URL "https://你的登录接口"
# 可选：请求体字段名，不填则前端默认 email / password
edgeone makers env set LOGIN_EMAIL_FIELD "email"
edgeone makers env set LOGIN_PASSWORD_FIELD "password"
```

| 变量 | 是否必填 | 说明 |
|------|----------|------|
| `LOGIN_URL` | **必填** | 管理员步骤 1 的登录 API 地址；未配置时登录会报错 |
| `LOGIN_EMAIL_FIELD` | 可选 | 请求体邮箱字段名，默认 `email` |
| `LOGIN_PASSWORD_FIELD` | 可选 | 请求体密码字段名，默认 `password` |

### 3. 前端如何读到变量

静态 HTML **不能**直接读 `process.env`。本项目通过 Edge Function：

- 路径：`edge-functions/api/runtime-config.js` → `GET /api/runtime-config`
- 从 `context.env` 读取 `LOGIN_*`，返回 JSON
- 页面加载 / 登录前调用，写入 `window.__ENV__`

本地无 Edge 运行时、接口 404 时，会回退到 `env.js` 或 `<meta name="env:LOGIN_URL" content="...">`。

### 4. 部署

```bash
export PAGES_SOURCE=skills
edgeone makers deploy -n <项目名> --json
```

按 CLI 输出的完整 URL（含查询参数）访问。

---

## Chrome 插件（可选）

`plugin/` 为浏览器扩展：将当前页添加到书签并同步到 GitHub（与网页「提交」共用 Contents API 思路）。

1. 打开 `chrome://extensions`，开启开发者模式。  
2. 「加载已解压的扩展程序」→ 选择本仓库 `plugin` 目录。  
3. 在插件中配置仓库与 Token 后使用。

网页编辑模式与插件可并存；注意避免两边同时改同一文件导致 SHA 冲突，冲突时重新登录再提交。

---

## 数据格式

`bookmarks.json` 结构为「分类名 → 书签数组」：

```json
{
  "AI": [
    {
      "id": "唯一 id",
      "title": "标题",
      "url": "https://...",
      "description": "可选描述",
      "addedAt": "ISO 时间"
    }
  ]
}
```

分类在页面与底部导航上的顺序 = JSON 对象 **key 插入顺序**。不要额外加 `order` 字段；用管理员「分类排序」调整即可。

---

## 目录结构

```
.
├── index.html              # 页面与样式
├── index.js                # 展示、登录、草稿编辑、排序
├── bookmarks.json          # 书签数据（访客直读；管理员以 GitHub 为准）
├── .env.example            # EdgeOne 环境变量声明（需提交）
├── env.example.js          # 本地静态 env 模板（可提交）
├── env.js                  # 本地 env 实例（gitignore，勿提交）
├── edge-functions/
│   └── api/
│       └── runtime-config.js   # 暴露 LOGIN_* 给前端
├── plugin/                 # Chrome 扩展
├── docs/                   # 设计与计划（部分可能被 gitignore）
└── README.md
```

---

## 常见问题

**登录提示未配置 LOGIN_URL**  
在 EdgeOne 设置 `LOGIN_URL` 并重新部署 / 确认 `/api/runtime-config` 能返回该字段；本地则配置 `env.js` 或 `edgeone makers env pull`。

**提交失败 401 / 403**  
检查 GitHub Token 是否有效、是否有对应仓库 Contents 写权限。

**提交失败提示远程已变更**  
他人或插件已改过文件。退出管理后重新登录再编辑提交。

**分类排序按钮看不到**  
需先完成管理员登录；按钮在底部导航右侧，访客模式不显示。

**添加书签时新建分类**  
下拉选「已有分类」，或在「新建分类」输入框填写；两者都填时以新建为准。保存后底栏会出现新分类，记得提交 GitHub。

---

## 许可与贡献

按你的仓库实际协议使用。Issue / PR 欢迎。
