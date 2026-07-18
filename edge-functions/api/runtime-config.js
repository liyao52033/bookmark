/**
 * 把 EdgeOne 项目环境变量暴露给前端（仅公开登录配置，不含密钥）。
 * 控制台 / `edgeone makers env set` 写入的 LOGIN_* 通过 context.env 读取。
 * GET /api/runtime-config
 */
export function onRequestGet(context) {
  const env = context.env || {};
  const loginUrl = (env.LOGIN_URL || '').trim();
  const emailField = (env.LOGIN_EMAIL_FIELD || '').trim();
  const passwordField = (env.LOGIN_PASSWORD_FIELD || '').trim();

  const payload = {
    LOGIN_URL: loginUrl,
  };
  if (emailField) payload.LOGIN_EMAIL_FIELD = emailField;
  if (passwordField) payload.LOGIN_PASSWORD_FIELD = passwordField;

  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
