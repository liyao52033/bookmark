# 管理员编辑模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网页两步登录（远程账号 + GitHub Token）后，可对书签增删改与同分类拖动排序，改动仅内存草稿，显式一次提交到 GitHub。

**Architecture:** 在现有 `index.html` / `index.js` 上扩展编辑模式；草稿改 `bookmarksData`；仅「提交到 GitHub」调用 Contents API PUT 一次。

**Tech Stack:** 原生 HTML/CSS/JS，GitHub Contents API，`https://ssl.xiaoying.org.cn/login`，HTML5 DnD。

## Global Constraints

- 增删改/拖动不得单独 PUT；仅「提交到 GitHub」写仓库，一次一个 commit
- 登录密码/Token 明文不进仓库；密码不进 localStorage
- 不修改 `plugin/*`
- 第一版不做分类删除/重命名/跨分类拖动
- 搜索非空时禁用拖拽
- 渲染用户内容避免 XSS（优先 textContent / 转义）

---

### Task 1: UI 壳子 — 管理入口、两步弹窗、编辑顶栏

**Files:**
- Modify: `index.html`
- Modify: `index.js`（仅挂载空处理与显示切换）

- [ ] **Step 1:** 在 `index.html` 增加样式：`.admin-bar`、`.modal-overlay`、`.modal`、`.bookmark-card` 编辑按钮、`.drag-handle`、表单按钮组
- [ ] **Step 2:** 增加 DOM：
  - 管理按钮 `#admin-btn`
  - 弹窗 `#login-modal`：步骤1 邮箱密码；步骤2 repo/token/jsonPath
  - 编辑顶栏 `#admin-bar`（默认隐藏）：提交 / 丢弃 / 退出 + dirty 提示
  - 书签表单弹窗 `#bookmark-modal`：title/url/description/category
- [ ] **Step 3:** `index.js` 绑定打开/关闭弹窗、步骤切换骨架
- [ ] **Step 4:** 浏览器打开页面，确认访客 UI 未破坏，点管理出步骤1

### Task 2: 远程登录 + GitHub 登录

**Files:**
- Modify: `index.js`

- [ ] **Step 1:** 实现 `loginRemote(email, password)` → POST `https://ssl.xiaoying.org.cn/login`，body `JSON.stringify({email,password})`，headers `Content-Type: text/plain;charset=UTF-8`，`credentials:'include'`，`mode:'cors'`
- [ ] **Step 2:** 成功条件：`response.ok` 且 JSON 含 `user` 或 `session` → 显示步骤2；失败展示 `error` 或通用文案
- [ ] **Step 3:** 实现 `loginGitHub(repo, token, jsonPath)`：GET contents，解码 base64 UTF-8，设 `bookmarksData`、`fileSha`、`serverSnapshot`，`isAdmin=true`，存 localStorage 的 repo/token/jsonPath（及可选 email）
- [ ] **Step 4:** 进入编辑模式：显示 admin-bar，重渲染带编辑控件

### Task 3: 草稿 CRUD + 渲染编辑控件

**Files:**
- Modify: `index.js`
- Modify: `index.html`（如需）

- [ ] **Step 1:** 状态：`isAdmin`、`dirty`、`passwordOk`、`fileSha`、`serverSnapshot`、`adminConfig`
- [ ] **Step 2:** `markDirty()` / `setDirtyUI()`；`beforeunload` 在 dirty 时提示
- [ ] **Step 3:** 安全渲染卡片：title/description/url 用转义或 DOM API
- [ ] **Step 4:** 编辑模式下卡片：编辑、删除、拖动手柄；全局/分类添加按钮
- [ ] **Step 5:** `addBookmark` / `updateBookmark` / `deleteBookmark` 只改内存 + `markDirty` + 重渲染；空分类删 key
- [ ] **Step 6:** 丢弃：深拷贝 `serverSnapshot` → `bookmarksData`；退出：确认 dirty 后 `isAdmin=false`，重新 load 本地 json 或快照

### Task 4: 同分类拖动排序

**Files:**
- Modify: `index.js`

- [ ] **Step 1:** 分类 grid 内卡片 `draggable=true`（仅 `isAdmin && !searchActive`）
- [ ] **Step 2:** dragstart/dragover/drop/dragend 重排 DOM
- [ ] **Step 3:** drop 后按 DOM 顺序用 `data-id` 重写该分类数组，`markDirty()`
- [ ] **Step 4:** 搜索非空时不设 draggable

### Task 5: 一次性提交 GitHub

**Files:**
- Modify: `index.js`

- [ ] **Step 1:** `commitToGitHub()`：若 !dirty 提示；否则 GET 最新 sha → PUT 整份 JSON，message `sync: 更新书签`，utf8 base64
- [ ] **Step 2:** 成功：更新 fileSha、serverSnapshot、dirty=false
- [ ] **Step 3:** 失败：401/403/409 明确文案
- [ ] **Step 4:** 手动验证：多次编辑后 GitHub 仅 1 个新 commit

### Task 6: 收尾

- [ ] **Step 1:** 提交设计/计划与代码（密码不进仓库）
- [ ] **Step 2:** 对照 spec 成功标准自测清单
