// 复制本文件为 env.js 后填写实际值（env.js 已加入 .gitignore，勿提交密钥/内网地址）
// 纯静态页没有 process.env，用 window.__ENV__ 模拟「环境变量」
// 部署时也可用构建脚本把系统环境变量写入 env.js，或在 HTML 中加：
//   <meta name="env:LOGIN_URL" content="https://example.com/login">

window.__ENV__ = {
  // 必填：账号登录接口地址。未配置时登录会直接报错
  LOGIN_URL: 'https://ssl.xiaoying.org.cn/login',

  // 可选：请求体里邮箱/密码字段名。不填则默认 email / password
  // LOGIN_EMAIL_FIELD: 'email',
  // LOGIN_PASSWORD_FIELD: 'password'
};
