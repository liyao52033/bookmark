// 本地纯静态预览用（无 EdgeOne dev 时）。复制为 env.js 后填写。
// EdgeOne Pages 部署时请用平台环境变量 + /api/runtime-config，不必依赖本文件：
//   1. 仓库根目录 .env.example 已声明 LOGIN_URL 等键（供 CLI 识别）
//   2. 控制台填写，或：edgeone makers env set LOGIN_URL "https://your-login-api"
//   3. 可选：edgeone makers env set LOGIN_EMAIL_FIELD email
//            edgeone makers env set LOGIN_PASSWORD_FIELD password
//   4. 前端通过 GET /api/runtime-config 读取 context.env

window.__ENV__ = {
  LOGIN_URL: 'https://ssl.xiaoying.org.cn/login',
  // LOGIN_EMAIL_FIELD: 'email',
  // LOGIN_PASSWORD_FIELD: 'password'
};
