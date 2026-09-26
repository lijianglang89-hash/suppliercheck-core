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

## 2. 版本边界（V0.1 / V0.2 做了什么、没做什么）

这一节是刻意写清楚的 —— 避免把「地基已就绪」误读成「产品能用」。

### 已完成（V0.1 · 地基）

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

### 已完成（V0.2 · 供应商资料包文件处理引擎）

- **拖拽式多文件上传**：串行上传、XHR 进度、客户端先挡一道（服务端仍独立校验）
- **流式落盘**：multipart 全程管道直通，**任何阶段都不把文件读进内存 buffer**
- **私有存储**：UUID 重命名落盘（原始文件名只存库）、存储路径从不出现在任何响应里
- **安全下载与预览**：`/api/files/[documentId]`（会话授权）、`/api/files/signed/[token]`（签名 + 会话双授权）
- **解析引擎抽象**：`DocumentParser` 接口 + PDF / DOCX / XLSX / ZIP / 图片五种实现
- **异步处理状态机**：`UPLOADED → PROCESSING → READY`，失败转 `FAILED` 并记录原因
- 压缩包自动展开为独立子文档，途中经过**七道闸门**（条目数 / 单条大小 / 总量 / 压缩比 / 嵌套 / 加密 / 类型）
- 提取文本持久化到 `document_texts`（含截断标记、页码、解析器标识、提示语）

### 明确未实现（属后续阶段）

**真正的 AI 审核** · 图片 OCR（接口已抽象，当前如实返回「暂不支持本地 OCR」而非编造内容）·
向量库 / Embedding / RAG · AI Agent · 供应商信息抽取 · 证照识别 · 有效期判断 ·
一致性检查 · 审核报告生成 · 支付与订阅（支付宝 / 微信支付 / Paddle）·
SEO/GEO 内容批量生成 · 爬虫 · 外部企业数据库 · 本地大模型 / Ollama

> 一个刻意的设计选择：**Mock 的 AI 结果不会被伪装成真实分析**。
> 工作台上明确标注「开发模拟状态」，Mock Provider 在无法诚实产出结构化结果时**直接抛错**，
> 而不是编一份看起来很像样的结论。同一条纪律也适用于解析：**解析不出来就写 FAILED 并说明原因，
> 绝不用空文本冒充「解析成功」。**

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
| 存储 | StorageProvider 抽象 + 本地私有卷 | 流式落盘 + 签名 URL，未来可切换阿里云 OSS |
| 上传 | busboy（流式 multipart） | 不落内存 buffer，边收边写 |
| 文档解析 | DocumentParser 抽象 + unpdf / yauzl / saxes | 见下文「内存红线」；图片 OCR 仅留接口 |
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
│   ├── documents/              # ★ 资料库：列表 + 上传器 + 详情（受保护）
│   ├── api/health/route.ts     # 健康检查
│   ├── api/documents/          # ★ 上传 / 列表 / 详情 / 重新解析
│   ├── api/files/              # ★ 受授权下载 + 签名下载（两条独立路径）
│   ├── og/route.tsx            # 动态 OG 图
│   ├── sitemap.ts robots.ts    # SEO
│   ├── actions/auth.ts         # 认证 Server Actions
│   ├── not-found.tsx           # 404
│   └── layout.tsx globals.css  # 全站 Metadata 与设计令牌
├── components/                 # UI 组件（site-header / auth-form / dashboard-shell / documents/*）
├── lib/
│   ├── ai/                     # ★ AIProvider 抽象 + Mock 实现
│   ├── storage/                # ★ StorageProvider 抽象 + 本地实现 + 签名
│   ├── documents/              # ★ 资料包引擎：限额 / 解析器 / 压缩包闸门 / 状态机 / 队列
│   ├── auth/                   # 会话、密码、授权守卫、重定向校验
│   ├── config/                 # 环境变量 schema 与服务端入口
│   ├── db/                     # Drizzle schema 与连接
│   └── errors.ts logger.ts files.ts site.ts navigation.ts
├── db/
│   ├── migrations/             # 生成的 SQL 迁移（入库，可重放）
│   └── seed.ts                 # 可选种子（默认不建任何数据）
├── tests/
│   ├── unit/ integration/ smoke/
│   ├── helpers/fixtures.ts document-fixtures.ts
│   └── stubs/server-only.ts
├── deploy/
│   ├── nginx/suppliercheck.conf.template   # 正式 443 配置模板（由 enable-https.sh 渲染）
│   ├── nginx/suppliercheck.http-only.conf  # ★ 阶段一：仅 80 + 放行 ACME
│   ├── scripts/ensure-storage.sh           # ★ 存储目录与权限（幂等，部署前跑）
│   └── scripts/enable-https.sh             # ★ 签发证书 + 切 443（带前置换闸与自动回滚）
├── scripts/verify-v02.ts       # ★ V0.2 端到端验收（对已部署实例跑，不参与镜像构建）
├── storage/uploads/            # 私有存储（运行时生成，已 gitignore）
├── types/yazl.d.ts             # 手写的最小类型声明（仅测试用）
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
| `STORAGE_PATH` | 否 | 私有存储目录，默认 `./storage/uploads`（**绝不能位于 `public/` 下**；`NODE_ENV=production` 时**必须是绝对路径**，见下方说明） |
| `MAX_UPLOAD_BYTES` | 否 | 单文件大小上限，默认 20 MB；引擎另有 50 MB 硬上限，配置写大也突破不了 |
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

### 测什么（V0.2 新增部分）

资料包引擎的测试重点不是「功能能不能跑通」，而是**边界行为**：

| 文件 | 覆盖 |
| --- | --- |
| `unit/documents-core.test.ts` | 文本累积的截断语义、控制字符清洗、超限时中断管道、校验和 |
| `unit/documents-parsers.test.ts` | PDF / DOCX / XLSX 的真实提取结果（含富文本、日期、空单元格、公式结果） |
| `unit/documents-archive.test.ts` | 压缩包七道闸门、路径穿越、压缩炸弹、元数据撒谎、回调失败时的中止语义 |
| `unit/config-schema.test.ts` | 环境变量默认值与硬上限一致（默认值只允许有一个事实来源） |
| `integration/document-metadata.test.ts` | 文档落库与**跨工作区隔离**（另一个工作区查不到） |

### 冒烟测试要打生产实例

```bash
npm run build
npm run start &
SMOKE_BASE_URL=http://127.0.0.1:3010 npx vitest run tests/smoke
```

**别用 `next dev` 代替 `next start` 跑冒烟**：`force-dynamic` 的路由、重定向缓存、
安全响应头这几类行为在 dev 与生产下并不一致，dev 下通过不代表生产没问题。

### 端到端验收（V0.2）

六层单元测试能证明「零件是对的」，证明不了「装在一起能转」。这份脚本走完整链路：

```bash
npm run build
STORAGE_PATH="$(pwd)/storage/uploads" PORT=3010 node .next/standalone/server.js &
npm run verify:v02          # 全通过退出码 0，可直接接进 CI
```

它自己建两个用户 + 两个工作区，跑完自动级联清理（`--keep` 可保留）。
覆盖：真实 HTTP 上传 → 流式落盘 → 磁盘字节比对 → 异步状态机 → 文本提取 →
压缩包展开 → 跨工作区越权（详情/下载/重解析/列举/上传）→ 受授权下载。

> 注意上面显式传了绝对 `STORAGE_PATH`：`next start` / standalone 会切换工作目录，
> 相对路径会把文件写进 `.next/standalone/` 里面。生产环境下相对路径会被直接拒绝（见 §11）。

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

阿里云 ECS 上 Docker Hub 与 Alpine CDN 通常都不可达或极慢。三处来源都可以覆盖：

```bash
# docker-compose.yml 里 postgres 默认已指向镜像加速器
POSTGRES_IMAGE=postgres:16-alpine docker compose up -d postgres

# 构建应用镜像时指定基础镜像与 apk 包源
docker build \
  --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine \
  --build-arg APK_MIRROR=https://mirrors.aliyun.com \
  -t suppliercheck-app:0.2.0 .
```

用 compose 构建时这三个值直接从 `.env` 读（见 `.env.example` 的「构建期镜像与包源」段），不用写 `--build-arg`。

> ⚠️ **`APK_MIRROR` 实测差距很大**：从阿里云 ECS 取同一个 `APKINDEX.tar.gz`，
> `dl-cdn.alpinelinux.org` 需 12 s+（基本卡在超时边缘），`mirrors.aliyun.com` 0.09 s。
> 不换源时 `apk add libc6-compat` 会卡住数分钟且**没有任何输出**，看起来像构建死锁。
>
> ⚠️ **`APK_MIRROR` 这个 ARG 必须在 `FROM` 之后重新声明一次。** `FROM` 之前声明的 ARG
> 只对 `FROM` 行可见，在 `RUN` 里会展开成**空字符串** —— 症状是 `sed` 把包源改成了
> `/alpine/v3.24/main`（协议和主机名都没了），apk 报
> `opening /alpine/v3.24/main/x86_64/APKINDEX.tar.gz: No such file or directory`。
> 看着像网络问题，其实是 ARG 作用域问题。

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
文件：/srv/suppliercheck/storage/uploads（私有卷，不对外暴露 URL）
```

### 存储目录准备

挂载卷在容器内是 `/storage/uploads`（属主 `1001:1001`）。宿主目录**必须先建好并给对属主**，
否则容器里的进程没有写权限 —— 部署脚本在 `start` 之前跑一次即可（幂等，可重复执行）：

```bash
sudo bash deploy/scripts/ensure-storage.sh
# 自定义根目录：
sudo SUPPLIERCHECK_ROOT=/srv/suppliercheck bash deploy/scripts/ensure-storage.sh
```

> ⚠️ **生产环境的 `STORAGE_PATH` 必须是绝对路径**，配成相对路径会在启动时被直接拒绝。
> 原因是一个实测踩到的坑：`output: "standalone"` 的 `server.js` 会把进程工作目录切换到
> `.next/standalone`，于是 `./storage/uploads` 会解析到**镜像内部** ——
> 文件看着上传成功了，容器一重建全没，而且全程没有任何报错。
> 这个错必须在启动时就拦下来。`NODE_ENV=development` 时仍可用相对路径。

### 反向代理配置

分两个阶段，**先 HTTP 后 HTTPS**。原因是：证书还没签发时就把 80 跳到 443，
等于把唯一可用的入口也关掉。

服务器上的前提（部署前请自行确认）：宿主 Nginx 已在 80 / 443 上服务既有站点，
`conf.d/` 下已有其他项目的配置，其中一个是 80 端口的 `default_server`。
本项目新增独立 `server` 块，`server_name` 唯一且**不设 `default_server`**，
不改动、不覆盖任何既有配置文件。

**阶段一 · 仅 HTTP（DNS 生效前就可以做）**

```bash
sudo install -m 0644 deploy/nginx/suppliercheck.http-only.conf /etc/nginx/conf.d/suppliercheck.conf
sudo nginx -t && sudo systemctl reload nginx
```

此时 `supplier.ultron.xin` 已经能通过 HTTP 访问，Let's Encrypt 的 HTTP-01
校验路径也已放行。DNS 一生效就是一个可用站点，没有「配了一半打不开」的中间态。

**阶段二 · 签发证书并切到 HTTPS**

```bash
# 演练：走完整 ACME 流程，但不签发、不落盘、不改 nginx（certbot --dry-run）
sudo bash deploy/scripts/enable-https.sh --email you@example.com --rehearse
# 演练通过后正式签发并切到 443
sudo bash deploy/scripts/enable-https.sh --email you@example.com --prod
```

演练刻意用 `--dry-run` 而不是「真的签一张 staging 证书」：后者会把不受信任的证书写到磁盘，
而脚本紧接着就会切到 443，中间必然出现一个「浏览器报警告」的窗口。`--dry-run` 没有这个副作用。

脚本做的事：校验 DNS → 校验阶段一配置在位 → **实测 HTTP-01 路径可达（不消耗 ACME 配额）**
→ certbot 签发（带 `--deploy-hook` 续期后自动 reload）→ 用模板渲染 443 配置替换阶段一
→ `nginx -t` 失败自动回滚 → reload → 端到端验证。

> ⚠️ 必须先加 DNS：`supplier.ultron.xin  A  39.108.235.240`。
> 没有解析记录时脚本会在第 1 步直接退出，不会做任何变更。

> ⚠️ 证书与 443 **必须一起上线**：只加 443 块而 `ssl_certificate` 指向不存在的文件，
> `nginx -t` 会失败，reload 就做不了；反过来只签证书不加 443 块，证书也不会被用到。

> ⚠️ **`http2 on;` 需要 nginx ≥ 1.25.1。** 旧版（实测 1.22.1）遇到它会直接
> `[emerg] unknown directive "http2"` 拒绝加载整个配置 —— 不是警告，是硬失败，
> 而且**会导致 reload 失败**。兼容写法是旧的 `listen 443 ssl http2;` ——
> 它在新版上只产生 deprecation warning，所以兼容面更广，模板里用的是这一种。

> ⚠️ **Let's Encrypt 的二次校验偶发超时是已知现象**，报错形如
> `During secondary validation: ... Timeout during connect (likely firewall problem)`。
> LE 会从全球多个节点分别校验，主校验通过而某个二级节点超时就会失败。
> **看到这个报错先别急着改防火墙** —— 先用 `https://check-host.net/check-http?host=<URL>`
> 从 20 个全球节点实测一次 HTTP 可达性（免费、免注册、有 JSON API）。
> 如果全球都通，直接重试即可；失败配额是每账号每域名每小时 5 次，重试一两次完全安全。

---

## 12. 安全注意事项

### 多租户

- 所有业务表都带 `workspace_id`，数据按工作区隔离。
- **浏览器提交的 `workspace_id` 永远不作为授权依据**。所有入口都必须经过
  `requireWorkspaceAccess()`，把 `(当前用户, 目标工作区)` 拿回数据库核对成员关系。
- 授权失败时**不区分**「工作区不存在」与「无权访问」，避免被用来探测他人工作区是否存在。
- 授权判定逻辑集中在 `lib/auth/workspace-access.ts`（纯数据库、可单测），
  上层 `lib/auth/guards.ts` 只负责取当前用户 —— 判定标准只有一份。
- **按 id 取资源的路由，一律「先要会话，再碰数据库」**（`requireUser()` 在最前）。
  反过来的写法会让「未登录」的响应因 id 是否存在而不同（404 vs 401），
  那本身就是可以枚举 id 的信号。未登录的答案永远只有一个：401。
- 按 id 下载/预览时，授权用的是**数据库里那行记录自己的 `workspace_id`**，
  不是请求里带的任何参数 —— 攻击者猜到别人的 documentId 也过不了成员校验。

### 文件

- MIME 白名单 + **魔数校验**：声明类型与真实文件头不符会被拒绝（防改扩展名）。
  校验发生在字节累积阶段（边流边算），不是等文件写完再补。
- 文件名清洗只用于展示与审计；存储路径一律 `workspaces/<uuid>/documents/<uuid><ext>`。
- 路径穿越四重防线：容器层（yauzl 拒绝非法条目名）→ `assertSafeStorageKey` 格式校验 →
  `path.resolve` 后前缀复核 → 存储键必须来自 `buildStorageKey()`。
- 上传文件放在私有目录，**不进 `public/`，不产生公开静态 URL**。
- 下载分两条**语义不同**的路径，不混用：
  | 路径 | 授权方式 | 用于 |
  | --- | --- | --- |
  | `/api/files/[documentId]` | 登录会话 + 工作区成员校验 | 界面里的预览与下载 |
  | `/api/files/signed/[token]` | HMAC 签名 + 有效期 **+ 同样要求登录会话** | 短期分享/外部系统取件 |
  签名 URL 仍然要求登录，是清醒的取舍：供应商保密资料不适合「URL 泄露即数据泄露」。
- 请求体上限 20 MB（默认，可配）+ 引擎硬上限 50 MB；nginx 侧对上传路径关闭请求缓冲。

### 资料包处理（V0.2 的内存红线）

生产宿主是 **2 vCPU / 4 GiB、可用内存约 1.5 GB** 的 ECS，且同时跑着别的生产服务。
因此「不把文件读进内存」不是优化项，是硬约束。做法：

| 格式 | 处理方式 | 内存特征 |
| --- | --- | --- |
| 上传 | busboy 流式 multipart → 计量 → 直接落私有盘 | 与文件大小无关 |
| PDF | `unpdf`(**整份读入**) —— 唯一例外 | 上限 20 MB，且队列串行 |
| DOCX | yauzl 按需开条目流 + saxes 流式解析 XML | 与文件大小无关 |
| XLSX | 同上，两遍遍历（先元数据，再逐行） | 受行数/单元格数/共享串字符数上限约束 |
| ZIP | 先只读中央目录**规划**，再按计划逐条串行解压 | 与包大小无关 |

其余配套约束：

- 所有限额集中在 `lib/documents/limits.ts`，**实现里不允许再出现魔法数字**。
- 解析任务**全局串行**（`lib/documents/queue.ts`），峰值内存 = 单份文件，不是 N 份。
- 提取文本硬截断（默认 30 万字符），超出部分标记 `truncated: true` 而不是静默丢弃。
- 压缩包**七道闸门**：条目数 / 单条解压后大小 / 整包解压后总量 / 压缩比 / 嵌套压缩包 /
  加密条目 / 类型白名单。全部在**解压之前**基于中央目录元数据判断。
- 解压时再用 `InspectionTransform` 按**实际字节数**复核一遍 —— 元数据可以撒谎，字节数不会。
- 被拒绝的条目会**如实记进计划**并展示给使用者，不是悄悄跳过。

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
| `npm run verify:v02` | V0.2 端到端验收（需要服务已启动） |
| `npm run db:generate` | 由 schema 生成 SQL 迁移 |
| `npm run db:migrate` | 应用迁移 |
| `npm run db:check` | 校验 schema 与迁移是否一致 |
| `npm run db:seed` | 可选种子数据 |

---

## 14. 下一步

V0.2（供应商资料包文件处理引擎）已完成，本次交付到此为止，**不提前开工下一阶段**。

按依赖关系，后续的候选方向（有待确认优先级）：

1. **接入真实 AI 审核** —— 目前只有 Mock Provider。解析产出的纯文本已落库，
   下一步是把 `document_texts` 接进 `AIProvider`，做抽取与一致性判定。
2. **图片 OCR** —— 接口已抽象（`image` 解析器），但当前如实返回「暂不支持本地 OCR」。
   两条路：接外部 OCR API，或在服务器上评估 PaddleOCR 类方案的资源开销。
   **在选定方案之前，不会用「猜」的文本填充图片类资料。**
3. **审核报告导出** —— `exports` / `audit_reports` 表已建，尚无产出路径。
