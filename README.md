# 供应商智审 · SupplierCheck

面向企业采购人员、供应链人员及中小企业的 **AI 供应商资料审核工具**。

> 用户上传一个供应商资料包，系统自动识别文件、提取关键信息、检查资料完整性、证照有效期、
> 主体信息一致性、产品/资质信息一致性，并生成供应商资料审核报告。

**当前版本：V0.1（项目地基）** —— 交付的是可运行的产品骨架、数据模型、安全基础与部署链路，
核心 AI 审核能力尚未实现，按下文「版本边界」一节为准。

---

## 1. 这是什么

企业内部在引入供应商前，通常需要审核对方提交的一整套资料：营业执照、资质证书、开户信息、
产品检测报告、体系认证……这些资料以 PDF、Word、Excel、图片散落在一个压缩包里，
审核人员要逐份打开、逐项比对，既慢又容易漏。

供应商智审要解决的就是这件事：**把「翻资料」这一步自动化**，让审核人员直接看到结论与问题清单。

产品能力规划（对应落地页展示的六项）：

| 能力 | 说明 |
| --- | --- |
| 文件识别 | 自动识别资料包中的文件类型（PDF / Word / Excel / 图片 / 压缩包） |
| 关键信息提取 | 提取企业名称、统一社会信用代码、证照编号、有效期等字段 |
| 资料完整性检查 | 对照审核模板逐项检查资料是否齐全 |
| 证照有效期核验 | 检查营业执照、资质证书是否在有效期内 |
| 主体信息一致性核对 | 比对不同文件中的企业名称、统一社会信用代码是否自洽 |
| 审核报告输出 | 把问题汇总成结构化审核报告 |

---

## 2. 版本边界（V0.1 做了什么、没做什么）

这一节是刻意写清楚的 —— 避免把「地基已就绪」误读成「产品能用」。

### 已完成

- 项目初始化、技术架构、目录结构
- PostgreSQL 数据模型（12 张表）与可重放的 SQL 迁移
- Drizzle ORM + 类型安全查询
- Zod 环境变量校验与全链路输入校验
- 邮箱 + 密码认证（scrypt 哈希）、HttpOnly 签名 Cookie 会话
- 工作区（Workspace）多租户模型与服务端授权闸门
- **AI Provider 抽象层** + 开发用 Mock 实现（不伪装成真实 AI）
- **Storage Provider 抽象层** + 本地私有存储实现（含签名 URL）
- 文件安全：MIME 白名单、魔数校验、大小限制、文件名清洗、路径穿越防护、UUID 命名
- 结构化日志与脱敏、统一错误模型、健康检查接口
- 中文企业风格 UI：落地页 / 登录 / 注册 / 工作台
- SEO / GEO 技术基础：metadata 架构、canonical、Open Graph、sitemap.xml、robots.txt、404、语义化 HTML
- Docker 化（Dockerfile + docker-compose.yml）与阿里云 ECS 部署
- 单元 / 集成 / 冒烟三层测试

### 明确未实现（属后续阶段，不在 V0.1 范围内）

真正 AI 审核 · PDF/DOCX/XLSX 解析 · OCR · 向量库 / Embedding / RAG · AI Agent ·
供应商信息抽取 · 证照识别 · 有效期判断 · 一致性检查 · 审核报告生成 ·
支付与订阅（支付宝 / 微信支付 / Paddle）· SEO/GEO 内容批量生成 · 爬虫 · 外部企业数据库 ·
本地大模型 / Ollama

> 一个刻意的设计选择：**Mock 的 AI 结果不会被伪装成真实分析**。
> 工作台上明确标注「开发模拟状态」，Mock Provider 在无法诚实产出结构化结果时**直接抛错**，
> 而不是编一份看起来很像样的结论。

---

## 3. 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 前端 | Next.js 16（App Router）+ TypeScript + Tailwind CSS v4 | 服务端渲染，营销内容不依赖客户端 JS |
| 后端 | Next.js Server Components / Route Handlers / Server Actions | 不额外起一个 Node API 服务 |
| 数据库 | PostgreSQL 16 | 只使用标准协议，不绑定任何托管供应商 |
| ORM | **Drizzle ORM**（+ drizzle-kit） | 见下方选型理由 |
| 校验 | Zod | 环境变量、表单、API、文件元数据统一走 Zod |
| 认证 | 自实现 scrypt + HMAC 签名 Cookie | 无第三方依赖，逻辑可被单测覆盖 |
| 存储 | StorageProvider 抽象 + 本地私有卷 | 未来可切换阿里云 OSS |
| AI | AIProvider 抽象 + Mock | 未来可切换百炼 / OpenAI / DeepSeek / Kimi |
| 包管理 | **npm** | 全项目只用一种，混用会导致锁文件漂移 |
| 测试 | Vitest | unit / integration / smoke 三层 |
| 部署 | Docker Compose（app + postgres） | 宿主 Nginx 反代 |

### 为什么选 Drizzle 而不是 Prisma

| 维度 | Drizzle | Prisma |
| --- | --- | --- |
| 运行时开销 | 纯 TypeScript，编译后就是 SQL | 附带查询引擎二进制，内存与镜像体积更大 |
| 类型安全 | 从 schema 推导，无需额外代码生成 | 需要 `generate` 步骤，CI 多一环 |
| 迁移 | drizzle-kit 生成**纯 SQL 文件**，可直接审阅、手工调整 | 迁移 DSL，较难直接读/改 SQL |
| 部署环境 | 4 GB 内存的 ECS 上与既有容器共存，省下的每 MB 都有意义 | 同样可用，但更重 |
| 可迁移性 | 生成的 SQL 就是标准 PostgreSQL，换库无痛 | 依赖 Prisma 抽象层 |

决策依据：产品要长期在资源受限的服务器上跑，且数据层必须能被未来的 AI Agent 读懂改懂 ——
**生成的 SQL 是可以直接读的文件**，这比多一层运行时引擎更值。

---

## 4. 目录结构

```
suppliercheck/
├── app/                        # Next.js App Router
│   ├── page.tsx                # 落地页
│   ├── login/ register/        # 认证页
│   ├── dashboard/              # 工作台（受保护）
│   ├── api/health/route.ts     # 健康检查
│   ├── og/route.tsx            # 动态 OG 图
│   ├── sitemap.ts robots.ts    # SEO
│   ├── actions/auth.ts         # 认证 Server Actions
│   ├── not-found.tsx           # 404
│   └── layout.tsx globals.css  # 全站 Metadata 与设计令牌
├── components/                 # UI 组件（site-header / auth-form / dashboard-shell）
├── lib/
│   ├── ai/                     # ★ AIProvider 抽象 + Mock 实现
│   ├── storage/                # ★ StorageProvider 抽象 + 本地实现 + 签名
│   ├── auth/                   # 会话、密码、授权守卫、重定向校验
│   ├── config/                 # 环境变量 schema 与服务端入口
│   ├── db/                     # Drizzle schema 与连接
│   └── errors.ts logger.ts files.ts site.ts navigation.ts
├── db/
│   ├── migrations/             # 生成的 SQL 迁移（入库，可重放）
│   └── seed.ts                 # 可选种子（默认不建任何数据）
├── tests/
│   ├── unit/ integration/ smoke/
│   ├── helpers/fixtures.ts
│   └── stubs/server-only.ts
├── deploy/nginx/               # 反向代理模板（不自动启用）
├── proxy.ts                    # 应用区乐观校验（Next 16 的 middleware 替代）
├── drizzle.config.ts
├── Dockerfile docker-compose.yml .dockerignore
├── vitest.config.mts
├── .env.example
└── README.md
```

**目录约定**：`app/` `lib/` `db/` 直接在仓库根，不使用 `src/`。

---

## 5. 环境要求

| 项 | 版本 |
| --- | --- |
| Node.js | ≥ 20.9（Next.js 16 要求；本项目在 22.22 上开发与验证） |
| npm | ≥ 10 |
| PostgreSQL | 16（Docker 或原生均可） |
| Docker | 可选，用于跑数据库与生产镜像 |

---

## 6. 安装与环境变量

```bash
npm install
cp .env.example .env.local
```

编辑 `.env.local`，至少填好这几项：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | 标准 PostgreSQL 连接串 |
| `SESSION_SECRET` | 是 | ≥ 32 字符的随机串，用于会话与存储签名 |
| `APP_URL` | 是 | 站点根地址，用于 canonical / OG / sitemap 的绝对 URL |
| `AI_PROVIDER` | 否 | V0.1 只支持 `mock`，默认即为 `mock` |
| `STORAGE_PROVIDER` | 否 | V0.1 只支持 `local`，默认即为 `local` |
| `STORAGE_PATH` | 否 | 私有存储目录，默认 `./data/uploads` |
| `MAX_UPLOAD_BYTES` | 否 | 单文件大小上限，默认 25 MB |
| `LOG_LEVEL` | 否 | `debug` / `info` / `warn` / `error` |

生成随机密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`.env` / `.env.local` 均已被 `.gitignore` 排除；`.env.example` 是唯一入库的示例文件。

---

## 7. 数据库初始化

### 7.1 起一个 PostgreSQL

用本仓库自带的 compose（只起数据库，不构建应用）：

```bash
# 需要 POSTGRES_PASSWORD；compose 会做必填校验
POSTGRES_PASSWORD=your-password docker compose up -d postgres
```

或者使用任何已有的 PostgreSQL 实例，把连接串填进 `DATABASE_URL`。

### 7.2 建表

```bash
npm run db:generate   # schema 有改动时生成新的 SQL 迁移（产物入库）
npm run db:migrate    # 把迁移应用到 DATABASE_URL 指向的数据库
```

迁移产物位于 `db/migrations/`，是纯 SQL，可以直接阅读与审计。

### 7.3 可选种子数据

```bash
npm run db:seed           # 什么都不创建（默认）
npm run db:seed -- --demo # 创建一个明确标注 [DEMO] 的演示账号
```

---

## 8. 本地启动

```bash
npm run dev
```

打开 http://localhost:3010

> 端口固定为 **3010**。选择它是因为部署服务器上的 3000 已被既有项目占用，
> 本地与线上保持一致可以避免「本地好用、线上端口冲突」这类问题。

### 如果数据库跑在远端

本项目开发时使用服务器上的 PostgreSQL，通过 SSH 隧道连接：

```bash
ssh -N -L 5432:127.0.0.1:5432 admin@<服务器地址>
```

保持这个终端不关闭，然后在另一个终端跑 `npm run dev` / `npm test`。

---

## 9. 测试

```bash
npm test              # 全部测试（smoke 需要额外设置 SMOKE_BASE_URL 才会执行）
npm run test:watch    # 监听模式
npx vitest run tests/unit         # 只跑单元测试（不需要数据库）
npx vitest run tests/integration  # 只跑集成测试（需要 DATABASE_URL 可达）
```

### 冒烟测试要打生产实例

```bash
npm run build
npm run start &
SMOKE_BASE_URL=http://127.0.0.1:3010 npx vitest run tests/smoke
```

**别用 `next dev` 代替 `next start` 跑冒烟**：`force-dynamic` 的路由、重定向缓存、
安全响应头这几类行为在 dev 与生产下并不一致，dev 下通过不代表生产没问题。

### 类型与代码检查

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
```

> Next.js 16 已移除 `next lint`，所以 lint 走独立的 ESLint CLI。

---

## 10. Docker 启动

```bash
# 准备 .env（compose 变量插值用），至少包含 POSTGRES_PASSWORD / SESSION_SECRET / APP_URL
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:3010/api/health
```

服务组成：

| 服务 | 端口绑定 | 说明 |
| --- | --- | --- |
| `app` | `127.0.0.1:3010` | Next.js standalone，仅本机可达 |
| `postgres` | `127.0.0.1:5432` | 数据卷 `./data/postgres` |

两个端口都只绑回环地址 —— 外部流量必须经过宿主 Nginx，应用不直接暴露公网。

### 国内网络注意

Docker Hub 在阿里云 ECS 上通常不可达。两个镜像来源都可以覆盖：

```bash
# docker-compose.yml 里 postgres 默认已指向镜像加速器
POSTGRES_IMAGE=postgres:16-alpine docker compose up -d postgres

# 构建应用镜像时指定基础镜像
docker build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine -t suppliercheck-app:0.1.0 .
```

---

## 11. 部署结构

```
Internet
   |
域名（A 记录 -> 服务器公网 IP）
   |
宿主 Nginx（80 / 443，与既有站点共用，独立 server 块）
   |
127.0.0.1:3010  ->  suppliercheck-app 容器
   |
suppliercheck-postgres 容器（Docker 内部网络，不经过宿主机端口）
   |
文件：./data/uploads（私有卷，不对外暴露 URL）
```

### 反向代理配置

`deploy/nginx/suppliercheck.conf.template` 是一份**模板，不会自动生效**。

服务器上的现状（部署前请自行确认）：宿主 Nginx 已在 80 / 443 上服务既有站点，
`conf.d/` 下已有其他项目的配置，其中一个是 80 端口的 `default_server`。

启用步骤：

```bash
sudo cp deploy/nginx/suppliercheck.conf.template /etc/nginx/conf.d/suppliercheck.conf
sudo sed -i 's/__DOMAIN__/your-domain.example.com/g' /etc/nginx/conf.d/suppliercheck.conf
sudo nginx -t && sudo systemctl reload nginx
```

安全前提：**先确认域名 DNS 已解析到本机**，再申请证书、启用 443。
本模板是独立的 `server` 块，不改动任何既有配置文件。

---

## 12. 安全注意事项

### 多租户

- 所有业务表都带 `workspace_id`，数据按工作区隔离。
- **浏览器提交的 `workspace_id` 永远不作为授权依据**。所有入口都必须经过
  `requireWorkspaceAccess()`，把 `(当前用户, 目标工作区)` 拿回数据库核对成员关系。
- 授权失败时**不区分**「工作区不存在」与「无权访问」，避免被用来探测他人工作区是否存在。
- 授权判定逻辑集中在 `lib/auth/workspace-access.ts`（纯数据库、可单测），
  上层 `lib/auth/guards.ts` 只负责取当前用户 —— 判定标准只有一份。

### 文件

- MIME 白名单 + **魔数校验**：声明类型与真实文件头不符会被拒绝（防改扩展名）。
- 文件名清洗只用于展示与审计；存储路径一律 `workspaces/<uuid>/documents/<uuid><ext>`。
- 路径穿越三重防线：`assertSafeStorageKey` 格式校验 → `path.resolve` 后前缀复核 →
  存储键必须来自 `buildStorageKey()`。
- 上传文件放在私有目录，**不进 `public/`，不产生公开静态 URL**；
  需要下载时通过带签名与有效期的内部地址。

### 密钥与日志

- 真实 secrets 只存在于 `.env.local` / 部署时的容器环境变量，**不入库、不进前端 bundle**。
- 日志统一脱敏：命中 `password` / `secret` / `token` / `api_key` / `authorization` / `cookie`
  等键名整值替换；长字符串截断；二进制只记录长度。**不打印用户文件内容**。
- Server Action 等价于公开 POST 端点，每个 action 内部都重新鉴权，不依赖渲染层。

### 错误处理

统一错误模型（`lib/errors.ts`）：每个错误带 `code` + 分类 + HTTP 状态码。
面向用户只返回安全文案；面向开发者的诊断信息进日志，不进响应体。
**不做 `catch { return null }` 式的吞错。**

---

## 13. 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（3010） |
| `npm run build` | 生产构建（standalone 产物） |
| `npm run start` | 启动生产服务（3010） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint |
| `npm test` | 运行全部测试 |
| `npm run db:generate` | 由 schema 生成 SQL 迁移 |
| `npm run db:migrate` | 应用迁移 |
| `npm run db:check` | 校验 schema 与迁移是否一致 |
| `npm run db:seed` | 可选种子数据 |

---

## 14. 下一步

**Agent 02：供应商资料包文件处理引擎** —— 上传资料包、解析 PDF / Word / Excel / 图片、
登记文档处理任务与状态机。该能力**尚未实现**，本版本不提供任何入口。
