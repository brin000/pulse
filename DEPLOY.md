# Pulse 部署指南（Vercel Hobby 免费计划）

本指南面向第一次使用 Vercel 的用户，覆盖从注册第三方账号到部署后验证的完整流程。

## 1. 前置账号准备

### 1.1 Reddit script app（生产环境必需）

匿名访问 Reddit API 在数据中心 IP（包括 Vercel）上会被封锁，所以线上部署必须配置 OAuth 凭据，否则 Reddit 数据会一直降级为 mock 数据。

1. 登录 Reddit，打开 <https://www.reddit.com/prefs/apps>。
2. 点击 **create app**（或 create another app）。
3. 类型选择 **script**。
4. redirect uri 随便填一个即可（本项目用的是 client_credentials 流程，不会真正跳转），例如 `http://localhost:8080`。
5. 创建后：
   - **client_id**：在应用名称下方的一串字符（"personal use script" 字样旁边）。
   - **secret**：表单中标注 secret 的字段。

### 1.2 Turso 数据库（生产环境强烈建议）

运行历史（/history）、订阅主题、cron 去重都存在 libsql 数据库里。本地开发零配置（默认写入 `file:.data/pulse.db`），但 Vercel 的函数文件系统是临时的，必须用远程 Turso 数据库才能持久化。

1. 注册 <https://turso.tech>（免费档足够）。
2. 创建一个数据库（控制台或 `turso db create pulse`）。
3. 获取两样东西：
   - 数据库 URL，形如 `libsql://<db-name>-<org>.turso.io`；
   - 一个 auth token（控制台 "Generate Token" 或 `turso db tokens create pulse`）。

> **格式约定（与代码一致）**：`lib/db/index.ts` 把 URL 和 token 分开读取——`DATABASE_URL` 只填 `libsql://...` 地址，token 填到**独立的环境变量 `DATABASE_AUTH_TOKEN`**。不要把 token 拼进 URL 的查询参数里。

### 1.3 Anthropic API key

在 <https://console.anthropic.com> 创建 API key。不配置也能部署：应用会以 Mock 模式运行（完整的 agent 流程 + 固定的演示数据），适合先验证部署是否正常。

### 1.4 可选：Resend 邮件通知

cron 监控产出新内容时可以发邮件提醒。需要同时配置 `RESEND_API_KEY`（在 <https://resend.com> 注册获取）和 `NOTIFY_EMAIL`（收件地址）；缺任意一个则邮件功能静默关闭（cron 日志记一行后跳过），不影响其他功能。默认发件人是 Resend 的共享地址 `onboarding@resend.dev`，验证过自有域名后可用 `NOTIFY_FROM` 覆盖。

## 2. 环境变量清单

以下清单与代码中实际读取的 `process.env.*` 一一对照（`lib/config.ts`、`lib/db/index.ts`、`lib/notify.ts`、`lib/platforms/reddit/auth.ts`、`app/api/cron/monitor/route.ts`）。

| 变量名 | 必需性 | 用途 | 缺失时的行为 |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | 可选（线上建议） | Claude LLM 调用，仅服务端使用 | 自动进入 Mock LLM 模式（确定性决策 + 演示数据），不报错 |
| `PULSE_MOCK` | 可选 | 设为 `1` 时即使有 API key 也强制 Mock LLM 模式 | 默认关闭（按是否有 API key 决定模式） |
| `PULSE_MOCK_REDDIT` | 可选 | 设为 `1` 强制使用 mock Reddit 数据 | 默认调用真实 Reddit API（失败时自动降级 mock） |
| `PULSE_MOCK_HN` | 可选 | 设为 `1` 强制使用 mock Hacker News 数据 | 默认调用 Algolia HN API（失败时自动降级 mock，无需凭据） |
| `REDDIT_CLIENT_ID` | 生产必需 | Reddit OAuth script app 的 client id | 退回匿名接口；在 Vercel 上匿名接口被封，最终降级为 mock 数据 |
| `REDDIT_CLIENT_SECRET` | 生产必需 | Reddit OAuth script app 的 secret | 同上（两者必须同时配置才走 OAuth） |
| `PULSE_LIVE_TOKEN` | 可选（公开部署建议） | 真实 LLM 消费的访问闸门：设置后只有以 `/?live=<token>` 打开页面的访客跑 live 模式 | 不设置 = live 模式对所有人开放（本地开发的合理默认） |
| `DATABASE_URL` | 生产必需 | libsql 数据库地址，生产填 Turso 的 `libsql://...` | 默认 `file:.data/pulse.db`；在 Vercel 上文件库不持久，历史会丢失。DB 出错时所有持久化静默降级，不影响运行 |
| `DATABASE_AUTH_TOKEN` | 配 Turso 时必需 | Turso 数据库 auth token（与 URL 分开） | 对 `file:` 本地库无意义；对 Turso 缺失则连接失败 → 持久化静默降级 |
| `CRON_SECRET` | cron 必需 | 保护 `/api/cron/monitor`，请求必须带 `Authorization: Bearer <CRON_SECRET>` | **fail-closed**：未设置时该端点恒返回 401，定时监控完全不工作 |
| `RESEND_API_KEY` | 可选 | Resend 邮件 API key | 与 `NOTIFY_EMAIL` 任一缺失 → 邮件静默跳过（日志一行） |
| `NOTIFY_EMAIL` | 可选 | 通知邮件的收件地址 | 同上 |
| `NOTIFY_FROM` | 可选 | 覆盖通知邮件发件人（需在 Resend 验证域名） | 默认 `Pulse <onboarding@resend.dev>`。注意：此变量在 `.env.example` 中只出现在注释里，没有独立条目 |

> 在 Vercel 上设置 `CRON_SECRET` 后，Vercel Cron 触发时会自动带上 `Authorization: Bearer <CRON_SECRET>` 头，无需额外配置。

## 3. Vercel 部署步骤

1. 打开 <https://vercel.com>，用 GitHub 账号登录。
2. **Add New → Project**，import 本仓库（`brin000/pulse`）。Vercel 会自动识别 Next.js，构建配置保持默认。
3. 在 import 页面的 **Environment Variables** 区域，按上表填入环境变量。最小生产配置建议：
   `ANTHROPIC_API_KEY`、`REDDIT_CLIENT_ID`、`REDDIT_CLIENT_SECRET`、`DATABASE_URL`、`DATABASE_AUTH_TOKEN`、`CRON_SECRET`、`PULSE_LIVE_TOKEN`。
4. 点击 **Deploy**，等待构建完成。
5. 部署成功后，进入项目的 **Settings → Cron Jobs**（或 Deployment 详情页的 Cron Jobs 标签），确认出现 `/api/cron/monitor`，schedule 为 `0 9 * * *`（每日 09:00 UTC = 北京时间 17:00）。

## 4. 部署后验证清单

按顺序逐项验证（把 `https://<your-app>.vercel.app` 换成你的域名）：

1. **首页可打开**：访问 `https://<your-app>.vercel.app`，cockpit 界面正常渲染。
2. **跑一次 mock run**：在首页直接输入一个主题运行。若设置了 `PULSE_LIVE_TOKEN`，普通访问就是 mock 模式；流程应完整走完并产出演示性的推荐与草稿。
3. **带 live token 跑 live run**：访问 `https://<your-app>.vercel.app/?live=<你的 PULSE_LIVE_TOKEN>` 再运行一次，确认消耗真实 LLM、返回真实 Reddit/HN 数据（界面会标注 live 数据源）。
4. **手动触发 cron**（PowerShell / bash 通用的 curl 模板）：

   ```bash
   curl -H "Authorization: Bearer <你的 CRON_SECRET>" https://<your-app>.vercel.app/api/cron/monitor
   ```

   - 正确的 secret → 返回 JSON（含 `dailyBudget`、`topics` 摘要；没有订阅主题时 `topics` 为空数组，属正常）。
   - 不带 header 或 secret 错误 → 返回 `401 {"error":"Unauthorized"}`。
5. **检查 /history 持久化**：访问 `https://<your-app>.vercel.app/history`，前面跑过的 run 应出现在列表中且可打开回放。如果列表是空的，大概率是 `DATABASE_URL`/`DATABASE_AUTH_TOKEN` 没配对（持久化失败是静默降级，不会报错）。

## 5. Hobby 计划注意事项

- **Cron 频率限制**：Hobby 计划的 cron job **每天最多触发一次**，且实际触发时间在指定小时内不精确（可能在该小时内的任意时刻）。本仓库 `vercel.json` 的 schedule 为 `0 9 * * *`（每日一次），已兼容 Hobby，可直接部署。
- **想要更高频率**：
  - 升级 **Pro 计划**后可把 `vercel.json` 的 schedule 改回高频（如 `0 * * * *` 每小时）；
  - 或保持 Hobby，用 **cron-job.org** 等外部定时器按需高频调用，配置方式：定时 GET `https://<your-app>.vercel.app/api/cron/monitor`，并添加请求头 `Authorization: Bearer <你的 CRON_SECRET>`。代码内置双重成本护栏（每 UTC 日最多 20 次 cron run、单次最多处理 5 个主题），外部高频触发不会造成 LLM 预算失控。
- **函数时长限制**：`app/api/agent/route.ts` 与 `app/api/cron/monitor/route.ts` 都声明了 `maxDuration = 300`（秒）。Hobby 计划在启用 **Fluid Compute**（新项目默认开启）时支持最长 300 秒；若项目关闭了 Fluid Compute，Hobby 的上限只有 60 秒，长 run 会被平台截断——请在 Vercel 项目 Settings → Functions 中确认 Fluid Compute 处于开启状态。
