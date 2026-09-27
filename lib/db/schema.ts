/**
 * 供应商智审 · 数据模型（V0.1）
 *
 * 三条硬约束贯穿本文件：
 * 1. 多租户隔离：所有业务表都必须带 workspace_id，授权一律在服务端校验。
 * 2. 供应商中立：只使用标准 PostgreSQL 类型，不使用任何托管平台的专有特性，
 *    以便未来平滑迁移到阿里云 RDS / Supabase / 自建 PostgreSQL。
 * 3. 不做过度设计：只建 V0.1 真正需要、且已在需求中列明的字段。
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
// `sql` 只用于「部分唯一索引」的 where 条件（见 suppliers 表）：
// 「同名供应商只允许存在一个**未删除**的」用普通唯一索引表达不了。
import { sql } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/* 枚举                                                                */
/* ------------------------------------------------------------------ */

/** 文档生命周期状态。 */
export const documentStatusEnum = pgEnum("document_status", [
  "UPLOADED",
  "PROCESSING",
  "READY",
  "FAILED",
  "DELETED",
]);

/** 异步处理任务的执行状态。 */
export const jobStatusEnum = pgEnum("job_status", ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]);

/** 问卷（供应商安全问卷 / 资料清单）状态。 */
export const questionnaireStatusEnum = pgEnum("questionnaire_status", [
  "UPLOADED",
  "PROCESSING",
  "READY",
  "FAILED",
]);

/** 问题分类。V0.1 只建模，不做 AI 分类。 */
export const questionCategoryEnum = pgEnum("question_category", [
  "Security",
  "Privacy",
  "Infrastructure",
  "Data Protection",
  "Access Control",
  "Incident Response",
  "Business Continuity",
  "AI / ML",
  "Compliance",
  "Subprocessors",
  "Data Retention",
  "Other",
]);

/** 问题自身的处理状态。 */
export const questionStatusEnum = pgEnum("question_status", [
  "NEW",
  "READY",
  "FAILED",
  "ARCHIVED",
]);

/** 回答的审核状态。 */
export const answerStatusEnum = pgEnum("answer_status", [
  "DRAFT",
  "NEEDS_REVIEW",
  "ACCEPTED",
  "EDITED",
  "REJECTED",
  "INSUFFICIENT_EVIDENCE",
]);

/** 审核报告状态。 */
export const reportStatusEnum = pgEnum("report_status", [
  "DRAFT",
  "GENERATING",
  "READY",
  "FAILED",
]);

/** 导出任务状态。 */
export const exportStatusEnum = pgEnum("export_status", [
  "PENDING",
  "RUNNING",
  "READY",
  "FAILED",
]);

/** 工作区成员角色。 */
export const workspaceRoleEnum = pgEnum("workspace_role", [
  "OWNER",
  "ADMIN",
  "MEMBER",
  "VIEWER",
]);

/** 用户状态。 */
export const userStatusEnum = pgEnum("user_status", ["ACTIVE", "SUSPENDED"]);

/** 供应商主体的生命周期状态。归档而不是删除，历史审核报告才不会失去主体信息。 */
export const supplierStatusEnum = pgEnum("supplier_status", ["ACTIVE", "ARCHIVED"]);

/**
 * 供应商的**主体类型**。
 *
 * 存在的理由是一条事实：不是所有供应商都有 18 位统一社会信用代码。
 *   - ENTERPRISE   企业法人（含个体工商户）—— 有 USCC
 *   - INSTITUTION  事业单位 / 社会团体 —— **也有** USCC（GB 32100 覆盖，同样是 18 位）
 *   - INDIVIDUAL   自然人（个体工匠、自由职业者等）—— 只有身份证号，没有 USCC
 *   - OVERSEAS     境外主体 —— 没有中国的 USCC
 *
 * ⚠️ 不做推断、不设默认值。
 * 曾经考虑过"从公司名后缀猜是不是事业单位"（看到「中心 / 研究院 / 协会」就跳过 USCC 检查），
 * 那条路是错的：后缀猜不准，而且猜错的结果是把一份**缺证照的合格资料**或
 * **一份真的有问题的资料**按错的口径处理 —— 冤枉和漏判都会发生。
 *
 * 正确做法就是让用户在登记供应商时明确选一次，没选就是**未知**，
 * 规则按"未知"处理（降级为提示），而不是按"企业"处理。
 */
export const supplierSubjectTypeEnum = pgEnum("supplier_subject_type", [
  "ENTERPRISE",
  "INSTITUTION",
  "INDIVIDUAL",
  "OVERSEAS",
]);

/** 审核任务的执行状态。与文档解析状态机同构，但语义独立：这里跑的是规则引擎。 */
export const reviewRunStatusEnum = pgEnum("review_run_status", [
  "QUEUED",
  "RUNNING",
  "READY",
  "FAILED",
]);

/**
 * 审核发现的严重级别。
 *
 * 用数据库枚举而不是自由文本：级别会直接驱动界面排序与「是否存在阻断项」的判定，
 * 一旦允许写进任意字符串，任何一次拼写错误都会让一条 CRITICAL 静默降级为不可见。
 */
export const reviewSeverityEnum = pgEnum("review_severity", [
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

/**
 * 审核发现的来源。
 *
 * RULE = 确定性规则引擎产出（可复现、可解释、有证据定位）；
 * AI   = 模型复核产出（结论性建议，不构成事实判定）。
 * 两者在界面上必须可区分 —— 混在一起展示等于把模型措辞当成审核结论。
 */
export const reviewFindingSourceEnum = pgEnum("review_finding_source", ["RULE", "AI"]);

/* ------------------------------------------------------------------ */
/* 身份与租户                                                          */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    status: userStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("workspaces_slug_unique").on(table.slug)],
);

/**
 * 用户与工作区的成员关系。这是多租户授权的唯一事实来源：
 * 任何 workspace_id 都必须回到本表验证成员资格。
 */
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("MEMBER"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_members_workspace_user_unique").on(table.workspaceId, table.userId),
    index("workspace_members_user_idx").on(table.userId),
  ],
);

/* ------------------------------------------------------------------ */
/* 供应商主体                                                          */
/* ------------------------------------------------------------------ */

/**
 * 供应商主体。
 *
 * 为什么需要一张独立的表，而不是直接在 documents 上写个「公司名」文本：
 * 审核的核心问题之一是「这一堆资料是不是同一个主体出的」。只有把主体变成有 id 的实体，
 * 跨文档比对才有共同的锚点；否则每次比对都在做字符串相似度猜测。
 *
 * 这里刻意**不**存「审核状态」之类的派生字段 —— 那是由审核任务算出来的，
 * 存在两处必然漂移。要看结论就去看最近一次审核任务。
 */
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * 主体类型。**允许为 null，且 null 有明确含义：用户没填，系统不知道。**
     *
     * 不要给它 default("ENTERPRISE") —— 那等于替用户声明"这是一家企业"，
     * 而规则的严厉程度正取决于这个声明。未知就是未知，规则会因此降级成提示。
     */
    subjectType: supplierSubjectTypeEnum("subject_type"),
    /** 统一社会信用代码（18 位）。允许为空 —— 资料还没到手时不该逼用户编一个。 */
    unifiedSocialCreditCode: text("unified_social_credit_code"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    /** 所在地，自由文本（工商注册地址常常很长，不适合结构化到省市字段）。 */
    region: text("region"),
    note: text("note"),
    status: supplierStatusEnum("status").notNull().default("ACTIVE"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("suppliers_workspace_idx").on(table.workspaceId),
    // 同一工作区内不允许重名（软删除的行不占用名额，否则删掉就再也建不回来）。
    uniqueIndex("suppliers_workspace_name_unique")
      .on(table.workspaceId, table.name)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/* ------------------------------------------------------------------ */
/* 文档与处理任务                                                      */
/* ------------------------------------------------------------------ */

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    originalFilename: text("original_filename").notNull(),
    /** 清洗后的安全文件名，仅用于展示与审计，不参与存储路径拼接。 */
    safeFilename: text("safe_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    extension: text("extension").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    /** SHA-256 十六进制摘要，用于去重与完整性校验。 */
    checksum: text("checksum").notNull(),
    /** 私有存储中的相对路径，绝不产生公开 URL。 */
    storagePath: text("storage_path").notNull(),
    /**
     * 来源压缩包。上传 .zip 时，包内每个可处理文件会被展开成一份独立子文档，
     * 指向同一个父文档 —— 子文档必须是独立行，否则无法各自审计、各自失败。
     */
    parentDocumentId: uuid("parent_document_id").references((): AnyPgColumn => documents.id, {
      onDelete: "cascade",
    }),
    /**
     * 归属供应商。可空 —— 资料先上传、后归属是常见流程，
     * 强制非空只会逼用户在还没想清楚时随便挂一个主体。
     */
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    status: documentStatusEnum("status").notNull().default("UPLOADED"),
    processingStatus: jobStatusEnum("processing_status").notNull().default("PENDING"),
    pageCount: integer("page_count"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("documents_workspace_idx").on(table.workspaceId),
    index("documents_workspace_status_idx").on(table.workspaceId, table.status),
    index("documents_checksum_idx").on(table.checksum),
    index("documents_parent_idx").on(table.parentDocumentId),
    index("documents_supplier_idx").on(table.supplierId),
    // 存储键由 workspaceId + documentId 生成，天然全局唯一；
    // 加上唯一约束后，下载路径反查文档时不可能出现歧义。
    uniqueIndex("documents_storage_path_unique").on(table.storagePath),
  ],
);

/** 文档处理任务表。V0.1 只建模，不跑真正的解析。 */
export const documentProcessingJobs = pgTable(
  "document_processing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** 任务类型，例如 UPLOAD / CHECKSUM / EXTRACT_TEXT（后续阶段启用）。 */
    jobType: text("job_type").notNull(),
    status: jobStatusEnum("status").notNull().default("PENDING"),
    attempt: integer("attempt").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("document_processing_jobs_workspace_idx").on(table.workspaceId),
    index("document_processing_jobs_document_idx").on(table.documentId),
    index("document_processing_jobs_status_idx").on(table.status),
  ],
);

/**
 * 文档纯文本提取结果。
 *
 * 单独成表而不是塞进 documents 的理由：
 * - 列表页只需要元数据，不该为了显示一个文件名把几十万字的正文一起读出来；
 * - 提取结果是「可再生的派生物」，重建它不影响文件本身，语义上与 documents 不同层；
 * - 后续接入全文检索时，只需要给这张表加索引，不用动 documents 的热路径。
 */
export const documentTexts = pgTable(
  "document_texts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** 实际执行提取的解析器标识，便于回溯「这份文本是谁产出的」。 */
    parserId: text("parser_id").notNull(),
    /** 归一化后的纯文本。 */
    text: text("text").notNull(),
    charCount: integer("char_count").notNull().default(0),
    /** 是否被截断。落库为 true 时，界面必须如实提示，不得当作完整内容。 */
    truncated: boolean("truncated").notNull().default(false),
    pageCount: integer("page_count"),
    /** 工作表名等格式特有的结构信息，结构随格式变化。 */
    structure: jsonb("structure").notNull().default({}),
    /** 面向使用者的说明（如「未提取到文本层」「暂不支持本地 OCR」）。 */
    notes: jsonb("notes").notNull().default([]),
    extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 一份文档只有一份提取结果；重新解析时覆盖而不是追加。
    uniqueIndex("document_texts_document_unique").on(table.documentId),
    index("document_texts_workspace_idx").on(table.workspaceId),
  ],
);

/* ------------------------------------------------------------------ */
/* 审核模板 / 审核任务 / 审核发现                                      */
/* ------------------------------------------------------------------ */

/**
 * 审核模板（工作区自定义）。
 *
 * 内置模板是**代码常量**（lib/templates/builtin.ts），不入库 ——
 * 它们随产品演进，入库只会让「升级产品」变成「跑数据迁移」。
 * 本表只存用户自己造的模板，因此 owner 一定是某个工作区。
 */
export const reviewTemplates = pgTable(
  "review_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** 复制自哪个内置模板（仅用于展示来源，不构成外键依赖）。 */
    basedOnKey: text("based_on_key"),
    /** 模板配置：必备资料清单、证照到期预警天数、启用的规则集合。 */
    config: jsonb("config").notNull().default({}),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("review_templates_workspace_idx").on(table.workspaceId),
    uniqueIndex("review_templates_workspace_name_unique")
      .on(table.workspaceId, table.name)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * 一次审核运行。
 *
 * 三条刻意的设计：
 *
 * 1. **模板快照**。`templateSnapshot` 把运行时用到的模板配置整份存下来。
 *    模板是可编辑的，如果审核结果只留着 templateId，用户改一次模板就会让
 *    **历史报告的含义随之后移** —— 那是审计场景里最不可接受的一类错误。
 *
 * 2. **引擎身份随结果落库**。`engineProvider` / `engineModel` / `engineMock`
 *    记录这次结论是谁产的。mock 产出的结果永远带 engineMock = true，
 *    界面据此必须显式标注 —— 不允许事后无法分辨。
 *
 * 3. **AI 复核是可选的第二遍**，`aiEnabled` 与 `aiNotes` 如实记录它到底跑没跑。
 *    没跑就写没跑，不用「暂无 AI 建议」这类含糊措辞。
 */
export const reviewRuns = pgTable(
  "review_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    /** 展示用的模板名快照（模板可能已被改名或删除）。 */
    templateName: text("template_name").notNull(),
    /** 模板标识：`builtin:<key>` 或自定义模板的 uuid。 */
    templateKey: text("template_key").notNull(),
    templateSnapshot: jsonb("template_snapshot").notNull().default({}),
    status: reviewRunStatusEnum("status").notNull().default("QUEUED"),
    /** 本次审核覆盖的文档 id 列表（快照；文档后续被删除也不影响这次记录的可解释性）。 */
    documentIds: jsonb("document_ids").notNull().default([]),
    /** 统计口径的运行摘要，结构见 lib/reviews/types.ts 的 ReviewSummary。 */
    summary: jsonb("summary").notNull().default({}),
    engineProvider: text("engine_provider").notNull(),
    engineModel: text("engine_model").notNull(),
    engineMock: boolean("engine_mock").notNull().default(true),
    aiEnabled: boolean("ai_enabled").notNull().default(false),
    aiNotes: jsonb("ai_notes").notNull().default([]),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("review_runs_workspace_idx").on(table.workspaceId),
    index("review_runs_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

/**
 * 审核发现（一条问题）。
 *
 * `severity` 与 `source` 用枚举（见文件上方说明），`ruleId` / `category` 用文本 ——
 * 规则集会持续增长，把规则标识做成数据库枚举意味着「加一条规则 = 一次迁移」。
 *
 * `documentId` 用 set null：文档被删掉时，这条发现不该消失，
 * 因为「报告里曾经指出过这个问题」是审计事实。`documentLabel` 保留当时的文件名。
 */
export const reviewFindings = pgTable(
  "review_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    reviewRunId: uuid("review_run_id")
      .notNull()
      .references(() => reviewRuns.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    category: text("category").notNull(),
    severity: reviewSeverityEnum("severity").notNull(),
    source: reviewFindingSourceEnum("source").notNull().default("RULE"),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    recommendation: text("recommendation"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    /** 发现被记录时的文档名，文档删除后仍可追溯。 */
    documentLabel: text("document_label"),
    /** 支撑该发现的原文摘录（定长截断，不存整份文件）。 */
    evidence: text("evidence"),
    /** 定位信息：页码、表格坐标、匹配到的正则等。结构随规则变化。 */
    locator: jsonb("locator").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("review_findings_run_idx").on(table.reviewRunId),
    index("review_findings_workspace_idx").on(table.workspaceId),
    index("review_findings_document_idx").on(table.documentId),
  ],
);

/* ------------------------------------------------------------------ */
/* 问卷 / 问题 / 证据 / 回答                                           */
/* ------------------------------------------------------------------ */

export const questionnaires = pgTable(
  "questionnaires",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    status: questionnaireStatusEnum("status").notNull().default("UPLOADED"),
    questionCount: integer("question_count").notNull().default(0),
    answeredCount: integer("answered_count").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("questionnaires_workspace_idx").on(table.workspaceId)],
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    questionnaireId: uuid("questionnaire_id")
      .notNull()
      .references(() => questionnaires.id, { onDelete: "cascade" }),
    originalText: text("original_text").notNull(),
    /** 归一化文本（去空白、统一标点），为后续去重与匹配做准备。 */
    normalizedText: text("normalized_text"),
    category: questionCategoryEnum("category").notNull().default("Other"),
    /** 来源定位：当问题来自表格型资料时记录坐标。 */
    sourceSheet: text("source_sheet"),
    sourceRow: integer("source_row"),
    sourceColumn: text("source_column"),
    sourceReference: text("source_reference"),
    status: questionStatusEnum("status").notNull().default("NEW"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("questions_workspace_idx").on(table.workspaceId),
    index("questions_questionnaire_idx").on(table.questionnaireId),
  ],
);

/** 证据：指向某份文档中支撑某条回答的片段。 */
export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "set null" }),
    /** 证据类型，例如 TEXT_SPAN / TABLE_CELL / IMAGE_REGION。 */
    kind: text("kind").notNull().default("TEXT_SPAN"),
    /** 定位信息（页码、坐标、单元格等），结构随 kind 变化。 */
    locator: jsonb("locator").notNull().default({}),
    /** 摘录片段。此处只存必要的短片段，不存整份文件。 */
    excerpt: text("excerpt"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("evidence_workspace_idx").on(table.workspaceId),
    index("evidence_document_idx").on(table.documentId),
    index("evidence_question_idx").on(table.questionId),
  ],
);

export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    draftAnswer: text("draft_answer"),
    finalAnswer: text("final_answer"),
    /** 0 ~ 1 的置信度。V0.1 不产生真实值，字段为后续阶段预留。 */
    confidence: real("confidence"),
    status: answerStatusEnum("status").notNull().default("DRAFT"),
    evidenceCount: integer("evidence_count").notNull().default(0),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("answers_workspace_idx").on(table.workspaceId),
    index("answers_question_idx").on(table.questionId),
  ],
);

/** 人工审核记录：谁、在什么时候、对哪条回答做了什么决定。 */
export const answerReviews = pgTable(
  "answer_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** 审核结论，取值与 answer_status 保持一致，便于回放状态迁移。 */
    decision: answerStatusEnum("decision").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("answer_reviews_workspace_idx").on(table.workspaceId),
    index("answer_reviews_answer_idx").on(table.answerId),
  ],
);

/* ------------------------------------------------------------------ */
/* 报告与导出                                                          */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ 以下两张表（audit_reports / exports）与上方「问卷 / 问题 / 证据 / 回答」一组，
 * 属于 V0.1 规划中的**安全问卷应答**产品线，当前版本**没有任何代码引用它们**。
 *
 * 保留而不是删除的原因：它们是 V0.1 已验收交付的一部分，且未来的问卷应答功能
 * 会直接落在这套模型上；提前删除只会让那个功能上线时再补一次迁移。
 * 与之对照，本轮实现的「供应商资料审核」用的是 review_runs / review_findings ——
 * 判断一份资料包"缺什么、什么过期了、主体对不对"和"回答一份安全问卷"是两件事。
 */
export const auditReports = pgTable(
  "audit_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    questionnaireId: uuid("questionnaire_id").references(() => questionnaires.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    status: reportStatusEnum("status").notNull().default("DRAFT"),
    /** 汇总数据（完整性统计、一致性问题列表等），结构后续阶段确定。 */
    summary: jsonb("summary").notNull().default({}),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_reports_workspace_idx").on(table.workspaceId)],
);

export const exports = pgTable(
  "exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    auditReportId: uuid("audit_report_id").references(() => auditReports.id, {
      onDelete: "cascade",
    }),
    /** 导出格式，例如 PDF / DOCX / XLSX。 */
    format: text("format").notNull(),
    status: exportStatusEnum("status").notNull().default("PENDING"),
    /** 导出产物同样落在私有存储中。 */
    storagePath: text("storage_path"),
    size: bigint("size", { mode: "number" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [index("exports_workspace_idx").on(table.workspaceId)],
);

/* ------------------------------------------------------------------ */
/* 类型导出                                                            */
/* ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentTextRow = typeof documentTexts.$inferSelect;
export type NewDocumentText = typeof documentTexts.$inferInsert;
export type DocumentProcessingJob = typeof documentProcessingJobs.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type ReviewTemplateRow = typeof reviewTemplates.$inferSelect;
export type ReviewRun = typeof reviewRuns.$inferSelect;
export type NewReviewRun = typeof reviewRuns.$inferInsert;
export type ReviewFinding = typeof reviewFindings.$inferSelect;
export type NewReviewFinding = typeof reviewFindings.$inferInsert;
export type Questionnaire = typeof questionnaires.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Evidence = typeof evidence.$inferSelect;
export type Answer = typeof answers.$inferSelect;
export type AnswerReview = typeof answerReviews.$inferSelect;
export type AuditReport = typeof auditReports.$inferSelect;
export type ExportRow = typeof exports.$inferSelect;
export type WorkspaceRole = (typeof workspaceRoleEnum.enumValues)[number];
