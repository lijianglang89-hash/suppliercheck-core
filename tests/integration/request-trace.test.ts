/**
 * 请求链路追踪（#2 链路日志贯穿）的端到端验证。
 *
 * 目标：证明一次 HTTP 请求带来的 requestId 能
 *   ① 在入口层被生成/复用，并写回响应头 X-Request-Id；
 *   ② 穿透「入队即返回」的异步边界，原样抵达后台解析任务（runProcessing）；
 *   ③ 后台任务真实执行完毕时，其日志里带着同一个 requestId（jobId / documentId 俱全）。
 *
 * 测试手法与 review-pipeline.test.ts 同构：真实 Postgres + 真实路由 handler +
 * 真实中文 PDF 夹具（解析能真正跑到 READY，而非假完成）。只 mock 会话读取。
 *
 * 日志捕获：直接监听 process.stdout / stderr 的 JSON 行。背景任务是异步的，
 * 介于串行队列里真正的 pdf.js 解析之后才落日志；测试用「等待文档到达 READY」来
 * 确保背景任务已执行完毕，再回看捕获到的日志。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { sessionStore } = vi.hoisted(() => ({
  sessionStore: { payload: undefined as { userId: string; issuedAt: number; expiresAt: number } | undefined },
}));

vi.mock("@/lib/auth/session", () => ({
  readSession: async () => sessionStore.payload,
}));

import { closeDatabase, getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { createInspectionTransform } from "@/lib/documents/inspect-stream";
import { enqueueDocumentProcessing, storeUploadedFile } from "@/lib/documents/service";
import { newRequestId, resolveRequestId } from "@/lib/api/route-utils";

import { cleanupUsers, createTestUser, createTestWorkspace } from "../helpers/fixtures";

import * as processRoute from "@/app/api/documents/[documentId]/process/route";

const FIXTURE = path.resolve(process.cwd(), "tests/fixtures/supplier-package-zh.pdf");
const createdUserIds: string[] = [];

/* ---------------- 日志捕获 ---------------- */

const captured: Array<Record<string, unknown>> = [];

function collect(chunk: string): void {
  for (const rawLine of chunk.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj && typeof obj === "object" && typeof obj.requestId === "string") {
        captured.push(obj);
      }
    } catch {
      // 非 JSON 行（如 vitest 自身的文本输出）忽略
    }
  }
}

let stdoutSpy: ReturnType<typeof vi.spyOn> | undefined;
let stderrSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeAll(() => {
  // 确保 info 级后台日志被写出（CI 默认 LOG_LEVEL=warn，会吞掉"开始/完成解析"）。
  process.env.LOG_LEVEL = "info";

  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown, ...rest: unknown[]) => {
      collect(typeof chunk === "string" ? chunk : String(chunk));
      return (origOut as (...args: unknown[]) => boolean)(chunk, ...rest);
    });
  stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown, ...rest: unknown[]) => {
      collect(typeof chunk === "string" ? chunk : String(chunk));
      return (origErr as (...args: unknown[]) => boolean)(chunk, ...rest);
    });
});

afterAll(async () => {
  stdoutSpy?.mockRestore();
  stderrSpy?.mockRestore();
  await cleanupUsers(createdUserIds);
  await closeDatabase();
});

/* ---------------- 工具 ---------------- */

async function waitUntil(
  predicate: () => Promise<boolean>,
  { timeoutMs = 30000, intervalMs = 120 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function uploadFixture(workspaceId: string, userId: string) {
  const bytes = await readFile(FIXTURE);
  const inspection = createInspectionTransform({ maxBytes: 25 * 1024 * 1024 });
  const stream = Readable.from([bytes]).pipe(inspection);

  return storeUploadedFile({
    workspaceId,
    userId,
    originalFilename: "供应商准入资料包-示例.pdf",
    safeFilename: "供应商准入资料包-示例.pdf",
    mimeType: "application/pdf",
    stream,
    inspection,
  });
}

function setSession(userId: string): void {
  const now = Math.floor(Date.now() / 1000);
  sessionStore.payload = { userId, issuedAt: now, expiresAt: now + 3600 };
}

/* ---------------- 用例 ---------------- */

describe("请求链路追踪：requestId 从入口贯穿到后台任务", () => {
  it("resolveRequestId 复用上游传入的 id，非法值时回退生成", () => {
    expect(resolveRequestId("abc-123")).toBe("abc-123");
    // 没传 → 现场生成，形如 req_xxx
    expect(resolveRequestId(undefined)).toMatch(/^req_/);
    expect(resolveRequestId(null)).toMatch(/^req_/);
    // 含换行 / 控制符 / 超长 → 视为非法，重新生成（不污染头与日志）
    expect(resolveRequestId("bad\nid")).toMatch(/^req_/);
    expect(resolveRequestId("a".repeat(200))).toMatch(/^req_/);
  });

  it("process 路由注入的 requestId 透传入队，并原样出现在后台解析任务的日志里", async () => {
    const user = await createTestUser("trace");
    createdUserIds.push(user.id);
    const workspace = await createTestWorkspace(user.id, "追踪工作区");

    // 真实中文 PDF 夹具 → 解析能真正跑完（READY），证明后台任务「执行完毕」。
    const doc = await uploadFixture(workspace.id, user.id);
    expect(doc.status).toBe("UPLOADED");

    const TRACE_ID = `trace-test-${newRequestId()}`;
    setSession(user.id);

    // 只看本次请求之后的链路，排除先前已写入的日志噪声。
    captured.length = 0;

    const response = (await processRoute.POST(
      new Request(`http://localhost/api/documents/${doc.id}/process`, {
        method: "POST",
        headers: { "x-request-id": TRACE_ID },
      }),
      { params: Promise.resolve({ documentId: doc.id }) },
    )) as unknown as Response;

    // ① 入口层把 requestId 写回响应头。
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(TRACE_ID);

    // ② 后台任务真实执行完毕：状态机走到 READY。
    const done = await waitUntil(async () => {
      const [row] = await getDb()
        .select({ status: documents.status })
        .from(documents)
        .where(eq(documents.id, doc.id))
        .limit(1);
      return row?.status === "READY";
    });
    expect(done).toBe(true);

    // ③ 同一个 requestId 出现在后台解析任务的日志里（穿透异步边界的尽头）。
    const backgroundLogs = captured.filter(
      (l) => l.requestId === TRACE_ID && typeof l.message === "string",
    );
    const parsingLog = backgroundLogs.find((l) =>
      /开始解析文档|文档解析完成|文档解析失败/.test(String(l.message)),
    );

    expect(parsingLog, "后台解析任务应记录带 requestId 的日志").toBeDefined();
    // 后台任务日志必须同时带着 jobId 与 documentId（runProcessing 的 child 上下文）。
    expect((parsingLog as Record<string, unknown>).jobId).toBeDefined();
    expect((parsingLog as Record<string, unknown>).documentId).toBe(doc.id);
    // 且它来自我们这次请求的入口，而非别处的日志。
    expect((parsingLog as Record<string, unknown>).workspaceId).toBe(workspace.id);
  });
});
