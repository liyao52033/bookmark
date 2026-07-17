# 管理员登录与书签编辑（方案 A）

**日期：** 2026-07-18  
**状态：** 已批准  
**范围：** 静态展示站增加管理员编辑模式；改动仅内存草稿，显式一次提交到 GitHub。

## 背景

当前项目是纯静态站：

- `index.html` / `index.js`：展示 `bookmarks.json`
- Chrome 插件：通过 GitHub Contents API 写 `bookmarks.json`（每次添加立即 1 个 commit）

需求：在网页上管理员登录后，对书签做增/删/改/同分类拖动排序；**实际改的是 GitHub 上的文件**；编辑过程中不产生 commit，点提交时**一次性**写入。

## 目标

1. **两步登录**：先校验管理密码，通过后再填写 GitHub 仓库 + Token
2. 用 GitHub Token 取得写权限（与插件同一 API 模型）
3. 编辑模式支持：增、删、改、分类内拖动排序
4. **本地草稿 + 显式提交**：任意次操作只改内存，一次 PUT 一个 commit
5. 未登录访客体验与现网一致

## 非目标（第一版不做）

- 分类删除、重命名、分类间拖动/排序
- 后端/服务端密码鉴权
- 修改 Chrome 插件行为
- GitHub OAuth / Cloudflare Workers 代理

## 架构

```
访客模式                     编辑模式
   │                            │
   ▼                            ▼
fetch('bookmarks.json')    GitHub Contents API GET
   │                            │
   └────────► bookmarksData ◄───┘
                    │
         增删改/拖动（仅内存 + 重渲染，标记 dirty）
                    │
                    ▼ 用户点击「提交到 GitHub」
         GET 最新 sha → PUT 整份 JSON（1 commit）
                    │
                    ▼
              dirty = false，更新本地 sha
```

### 组件职责

| 单元 | 职责 |
|------|------|
| 登录弹窗 | 收集 `repo` / `token` / `jsonPath`，校验可读，写入 `localStorage` |
| 编辑会话 | 维护 `isAdmin`、`dirty`、配置与 `fileSha` |
| 草稿数据层 | 对 `bookmarksData` 的增删改/排序；不直接碰 GitHub |
| GitHub 适配层 | GET 内容+sha、PUT 提交；utf8 base64 编解码 |
| UI 渲染 | 访客/编辑两套控件；顶栏、卡片操作、表单、拖拽 |

## 登录与会话

### 入口

- 页眉或角落「管理」按钮 → 打开登录弹窗（两步）

### 两步流程

```
点「管理」
   │
   ▼
步骤 1：输入管理密码
   │  SHA-256(输入) === ADMIN_PASSWORD_HASH ?
   │  否 → 错误提示，停在步骤 1
   ▼ 是
步骤 2：输入 GitHub 仓库 / Token / JSON 路径
   │  GET Contents API 校验
   │  否 → 错误提示，停在步骤 2
   ▼ 是
进入编辑模式
```

说明：静态站无后端，密码哈希写在前端，只能挡住不会看源码的访客；真正的写权限仍依赖 GitHub Token。

### 步骤 1：管理密码

| 项 | 说明 |
|----|------|
| 存储 | 源码常量 `ADMIN_PASSWORD_HASH`（密码的 SHA-256 十六进制小写） |
| 初始密码 | 临时 `admin123`（上线前务必更换） |
| 初始哈希 | `240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9`；换密码：`echo -n '新密码' \| sha256sum` 后替换常量 |
| 校验 | `crypto.subtle.digest('SHA-256', ...)` 对输入做哈希后比对 |
| 明文 | **不**写入仓库；改密码 = 重新算哈希替换常量 |
| 会话 | 密码通过后仅在当前页内存标记 `passwordOk = true`；刷新后需重输密码；关闭弹窗清除 `passwordOk` |

### 步骤 2：GitHub 表单字段

| 字段 | 说明 | 默认 |
|------|------|------|
| GitHub 仓库 | `owner/repo` | 可预填 `liyao52033/bookmark` |
| Personal Access Token | 需 `repo` 或 contents 写权限 | 空 |
| JSON 路径 | 仓库内文件路径 | `bookmarks.json` |

仅当步骤 1 已通过才展示步骤 2；关闭弹窗后下次需从步骤 1 重来（除非仍在同页且 `passwordOk` 仍为 true——实现上：关闭弹窗清除 `passwordOk`，更安全）。

### GitHub 校验流程（步骤 2）

1. `GET /repos/{owner}/{repo}/contents/{path}`，Header：`Authorization: token {token}`
2. 200：解析 JSON，设为 `bookmarksData`，保存 `fileSha` 与 `serverSnapshot`，进入编辑模式
3. 非 200：展示错误，不进入编辑模式

### 持久化

- `localStorage` 键：`bookmarkAdmin.repo`、`bookmarkAdmin.token`、`bookmarkAdmin.jsonPath`（**不**存密码、**不**存 `passwordOk`）
- 打开步骤 2 时**仅预填** GitHub 表单，**不**自动进入编辑模式
- **Token 与密码明文绝不写入仓库、不出现在 commit 内容中**

### 退出

- 「退出」：若 `dirty`，先确认是否丢弃；关闭编辑 UI，恢复访客渲染（重新 `fetch('bookmarks.json')` 或使用登录时快照）；`passwordOk = false`；保留 localStorage 的 GitHub 配置供下次预填
- 「丢弃更改」：用登录成功时保存的 `serverSnapshot` 深拷贝覆盖 `bookmarksData`，`dirty = false`，重新渲染

## 编辑能力（仅书签）

### 新增

- 触发：分类区「+」或全局添加按钮（编辑模式下显示）
- 字段：`title`（必填）、`url`（必填）、`description`（可选）、`category`（选现有或输入新分类名）
- 写入：`{ id, title, url, description, addedAt }`，`id` 生成方式与插件一致（`Date.now().toString(36) + Math.random()...`）
- 效果：只改内存 + 重渲染，`dirty = true`

### 编辑

- 卡片「编辑」→ 弹窗/内联表单改 title、url、description、category
- 若改 category：从原数组移除，加入目标分类（目标不存在则创建）
- 只改内存，`dirty = true`

### 删除

- 卡片「删除」→ 确认后从对应分类数组移除
- 分类变空时：数据层删除该空分类 key；导航与 section 一并消失
- 只改内存，`dirty = true`

### 拖动排序

- **仅同分类内**书签排序
- 实现：HTML5 Drag and Drop，零第三方依赖
- 松手后按新 DOM 顺序重写该分类数组，`dirty = true`
- 不做跨分类拖动
- **搜索激活时禁用拖拽**（避免在过滤结果上改全量顺序）

## 提交到 GitHub（一次 commit）

### 顶栏

- 文案：「编辑中」+ 未提交变更提示（如「有未保存更改」或简单 dirty 标记）
- 按钮：`提交到 GitHub`、`丢弃更改`、`退出`

### 提交流程

1. 若 `!dirty`：提示无需提交
2. `GET` 当前文件，取最新 `sha`（降低冲突）
3. `PUT` body：
   - `message`: `sync: 更新书签`
   - `content`: base64(JSON.stringify(bookmarksData, null, 2))，UTF-8 安全编码（同插件 `utf8_to_b64`）
   - `sha`: 上一步的 sha
4. 成功：更新 `fileSha`，`dirty = false`，提示成功
5. 失败：
   - 409 / sha 不匹配：提示「远程已变更，请丢弃或重新登录后再试」
   - 401/403：提示 Token 无效或权限不足
   - 其他：展示 API message

### 关键约束

- **任何**增/删/改/拖动都**不得**单独调用 PUT
- 仅「提交到 GitHub」触发写操作，一次操作 = 一次 commit

## UI 与访客兼容

| 模式 | 行为 |
|------|------|
| 访客 | 现有搜索、分类导航、卡片访问链接；无编辑控件 |
| 编辑 | 顶栏、卡片编辑/删除/拖动手柄、添加入口；搜索仍可用，但搜索非空时禁用拖拽 |

样式：沿用现有 CSS 变量与卡片风格，编辑控件与现有主色一致。

## 文件改动

| 文件 | 变更 |
|------|------|
| `index.html` | 管理入口、登录弹窗、编辑顶栏、编辑/删除/表单 DOM、拖拽相关 class |
| `index.js` | 会话、草稿 CRUD、排序、GitHub GET/PUT、编辑态渲染 |
| `bookmarks.json` | 运行时被 GitHub 更新，开发阶段可不改结构 |
| `plugin/*` | **不改** |
| 设计文档 | 本文件 |

## 错误处理与边界

- 未登录点管理 → 步骤 1 密码框
- 密码错误 → 明确提示，不进入步骤 2
- 有 dirty 时退出/关闭页：`beforeunload` 提示（浏览器原生）
- 网络失败：按钮恢复可点，错误文案可见
- XSS：渲染 title/description 时用 `textContent` 或转义，避免 `innerHTML` 直接插用户输入（现有代码有 innerHTML 风险，编辑写入路径须避免把未转义用户输入拼进 HTML）
- 安全预期：密码哈希可被逆向暴力破解（弱密码尤甚）；Token 存在本机 localStorage，共用电脑有泄露风险

## 测试要点

1. 错误密码无法进入步骤 2
2. 正确密码 + 错误 Token 无法进入编辑模式
3. 完整登录后，增/删/改/排序后 GitHub 上无新 commit
4. 点提交后仓库 `bookmarks.json` 一次更新，内容与界面一致
5. 丢弃更改后界面回到提交前状态
6. 访客模式 UI 与改前一致
7. 同分类拖动顺序写入 JSON 数组顺序正确
8. 提交冲突（模拟旧 sha）有明确错误提示
9. 刷新页面后需重新输入密码

## 成功标准

- 必须先过密码再填 Token，二者都通过才能进入编辑模式
- 管理员可完成书签 CRUD + 同分类排序
- 多次编辑后仅在显式提交时产生 **一个** GitHub commit
- 未登录用户无法触发写 GitHub
- 插件现有功能不受影响
