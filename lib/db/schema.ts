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
export type Questionnaire = typeof questionnaires.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Evidence = typeof evidence.$inferSelect;
export type Answer = typeof answers.$inferSelect;
export type AnswerReview = typeof answerReviews.$inferSelect;
export type AuditReport = typeof auditReports.$inferSelect;
export type ExportRow = typeof exports.$inferSelect;
export type WorkspaceRole = (typeof workspaceRoleEnum.enumValues)[number];
