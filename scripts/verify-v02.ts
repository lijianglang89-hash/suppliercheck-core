/**
 * V0.2 端到端验收脚本。
 *
 * 六层单元/集成测试能证明「每个零件是对的」，但证明不了「装在一起真的能转」。
 * 这个脚本走的就是完整链路：
 *
 *   真实 HTTP 上传 → multipart 流式落盘 → 数据库登记 → 异步解析状态机
 *   → 提取文本落库 → 受授权下载 → 跨工作区越权被拒
 *
 * 用法（服务必须已经起来，且数据库可达）：
 *
 *   npm run build
 *   PORT=3010 node .next/standalone/server.js &
 *   npm run verify:v02
 *
 * 脚本是自清理的：自己建工作区、自己删工作区（级联清表 + 删存储目录），
 * 不在库里留测试残留。可用 `--keep` 保留数据以便手动查看。
 *
 * 退出码：全部通过 = 0；有任何一条不通过 = 1（可直接接进 CI）。
 */
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";
import postgres from "postgres";

import { hashPassword } from "../lib/auth/password";
import { createSessionToken } from "../lib/auth/session-token";
import {
  buildMinimalDocx,
  buildMinimalPdf,
  buildMinimalXlsx,
  buildZip,
  SAMPLE_DOCX_BODY,
  SAMPLE_XLSX_SHARED_STRINGS,
  SAMPLE_XLSX_SHEET,
} from "../tests/helpers/document-fixtures";

config({ path: ".env.local", quiet: true });

/** 取必需的环境变量；缺失时直接结束进程（而不是带着 undefined 跑下去）。 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`缺少 ${name}（需要 .env.local）。`);
    process.exit(2);
  }
  return value;
}

const BASE_URL = (process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3010").replace(/\/+$/, "");
const DATABASE_URL = requireEnv("DATABASE_URL");
const SESSION_SECRET = requireEnv("SESSION_SECRET");
const STORAGE_PATH = process.env.STORAGE_PATH ?? "./storage/uploads";
const KEEP = process.argv.includes("--keep");

/**
 * PDF 里埋的独特标记，用来证明「提取到的文字确实来自这个文件」。
 *
 * 刻意用纯 ASCII：合成 PDF 夹具放不了中文（原因见
 * tests/helpers/document-fixtures.ts 的 buildMinimalPdf 说明）。
 * 真实中文 PDF 的提取能力由 tests/manual/real-pdf-probe.test.ts 单独验证。
 *
 * 文案里不再带品牌名：品牌已改中文（企智审），而这里必须是 ASCII；
 * 写一个「缩写版品牌」只会让后来的人以为它是正式名称。
 */
const PDF_MARKER = "E2E probe V0.2 document text";

const sql = postgres(DATABASE_URL, { max: 2 });
const runId = randomUUID().slice(0, 8);

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const checks: Check[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function section(title: string): void {
  console.log(`\n▌${title}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* 夹具                                                                */
/* ------------------------------------------------------------------ */

async function makeFixtures() {
  const pdf = buildMinimalPdf(`${PDF_MARKER} ${runId}`);
  const xlsx = await buildMinimalXlsx({
    sharedStringsXml: SAMPLE_XLSX_SHARED_STRINGS,
    sheetXml: SAMPLE_XLSX_SHEET,
  });
  const docx = await buildMinimalDocx({ bodyXml: SAMPLE_DOCX_BODY });
  // 包里放一个合法 PDF（应被展开）和一个 .exe（应被拒绝并如实记录）
  const zip = await buildZip([
    ["nested/inside.pdf", buildMinimalPdf("zip 内文件")],
    ["payload.exe", Buffer.from("MZ binary", "latin1")],
  ]);
  return { pdf, xlsx, docx, zip };
}

/* ------------------------------------------------------------------ */
/* HTTP 辅助                                                           */
/* ------------------------------------------------------------------ */

interface Json {
  [key: string]: unknown;
}

async function upload(
  cookie: string | undefined,
  workspaceId: string,
  filename: string,
  contentType: string,
  bytes: Buffer,
): Promise<{ status: number; body: Json }> {
  const form = new FormData();
  /**
   * `new Uint8Array(bytes)` 会复制一次（测试夹具都是 KB 级，可忽略）。
   * 复制的理由不是内存，是类型：Buffer 的底层是 ArrayBufferLike，
   * 而 DOM 的 BlobPart 要求 ArrayBufferView<ArrayBuffer>，直接传会类型报错。
   */
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

  const response = await fetch(`${BASE_URL}/api/documents/upload?workspaceId=${workspaceId}`, {
    method: "POST",
    ...(cookie ? { headers: { cookie } } : {}),
    body: form,
  });

  const text = await response.text();
  let body: Json = {};
  try {
    body = JSON.parse(text) as Json;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

async function getJson(url: string, cookie?: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(url, {
    ...(cookie ? { headers: { cookie } } : {}),
    redirect: "manual",
  });
  const text = await response.text();
  let body: Json = {};
  try {
    body = JSON.parse(text) as Json;
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

/** 轮询直到文档进入终态（READY / FAILED），返回最终详情响应。 */
async function waitForTerminal(cookie: string, documentId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const { body } = await getJson(`${BASE_URL}/api/documents/${documentId}`, cookie);
    const document = body.document as Json | undefined;
    const status = typeof document?.status === "string" ? document.status : "";
    last = status;
    if (status === "READY" || status === "FAILED") return body;
    await sleep(300);
  }
  throw new Error(`文档 ${documentId} 在 ${timeoutMs}ms 内未进入终态（最后一次状态：${last}）`);
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  section("前置检查");
  const health = await getJson(`${BASE_URL}/api/health`);
  check("服务可达且数据库连通", health.status === 200 && health.body.database === "ok", BASE_URL);

  const passwordHash = await hashPassword(`e2e-${runId}-password`);

  // 建两个用户 + 两个工作区：A 用来跑正常流程，B 用来验越权。
  const [userA] = await sql<{ id: string }[]>`
    insert into users (email, password_hash, display_name)
    values (${`e2e-a-${runId}@example.test`}, ${passwordHash}, ${`[E2E] 甲 ${runId}`})
    returning id
  `;
  const [userB] = await sql<{ id: string }[]>`
    insert into users (email, password_hash, display_name)
    values (${`e2e-b-${runId}@example.test`}, ${passwordHash}, ${`[E2E] 乙 ${runId}`})
    returning id
  `;
  if (!userA || !userB) throw new Error("创建测试用户失败");

  const [wsA] = await sql<{ id: string }[]>`
    insert into workspaces (name, slug, owner_user_id)
    values (${`[E2E] 甲方工作区 ${runId}`}, ${`e2e-a-${runId}`}, ${userA.id})
    returning id
  `;
  const [wsB] = await sql<{ id: string }[]>`
    insert into workspaces (name, slug, owner_user_id)
    values (${`[E2E] 乙方工作区 ${runId}`}, ${`e2e-b-${runId}`}, ${userB.id})
    returning id
  `;
  if (!wsA || !wsB) throw new Error("创建测试工作区失败");

  await sql`
    insert into workspace_members (workspace_id, user_id, role)
    values (${wsA.id}, ${userA.id}, 'OWNER'), (${wsB.id}, ${userB.id}, 'OWNER')
  `;

  const cookieA = `sc_session=${createSessionToken({ userId: userA.id, secret: SESSION_SECRET })}`;
  const cookieB = `sc_session=${createSessionToken({ userId: userB.id, secret: SESSION_SECRET })}`;

  try {
    const { pdf, xlsx, docx, zip } = await makeFixtures();

    /* ---------------- 1. 上传与流式落盘 ---------------- */
    section("1. 上传与流式落盘");
    const pdfUpload = await upload(cookieA, wsA.id, "供应商资质证明.pdf", "application/pdf", pdf);
    check(
      "PDF 上传返回 201",
      pdfUpload.status === 201,
      `status=${pdfUpload.status} ${JSON.stringify(pdfUpload.body).slice(0, 120)}`,
    );

    const pdfDoc = (pdfUpload.body.document ?? {}) as Json;
    const pdfId = String(pdfDoc.id ?? "");
    check("上传即登记为 UPLOADED 或 PROCESSING", ["UPLOADED", "PROCESSING"].includes(String(pdfDoc.status)));

    const [pdfRow] = await sql<
      { storage_path: string; size: string; checksum: string; original_filename: string; safe_filename: string }[]
    >`select storage_path, size, checksum, original_filename, safe_filename from documents where id = ${pdfId}`;
    if (!pdfRow) throw new Error("数据库里查不到刚上传的文档");

    check(
      "存储路径不含原始文件名（UUID 命名）",
      !pdfRow.storage_path.includes("供应商资质") && pdfRow.storage_path.includes(pdfId),
      pdfRow.storage_path,
    );
    check("落库字节数与上传一致", Number(pdfRow.size) === pdf.byteLength, `${pdfRow.size} vs ${pdf.byteLength}`);
    check("原始文件名只存在于数据库", pdfRow.original_filename === "供应商资质证明.pdf");

    const diskPath = path.resolve(STORAGE_PATH, pdfRow.storage_path);
    const onDisk = await readFile(diskPath);
    check("磁盘文件真实存在且字节一致", onDisk.byteLength === pdf.byteLength, diskPath);
    check("磁盘内容与上传内容逐字节相同", onDisk.equals(pdf));

    /* ---------------- 2. 异步状态机 ---------------- */
    section("2. 异步解析状态机与文本提取");
    const pdfDetail = await waitForTerminal(cookieA, pdfId);
    const pdfFinal = (pdfDetail.document ?? {}) as Json;
    check("PDF 最终状态为 READY", pdfFinal.status === "READY", `status=${String(pdfFinal.status)}`);

    const text = pdfDetail.extraction as Json | null;
    check("提取结果不为空（不是伪造的成功）", Boolean(text) && Number(text?.charCount) > 0, `charCount=${String(text?.charCount)}`);
    check(
      "提取到的文字确实来自该文件（含埋入的标记）",
      typeof text?.preview === "string" && text.preview.includes(PDF_MARKER),
    );

    const [job] = await sql<{ status: string; error_message: string | null }[]>`
      select status, error_message from document_processing_jobs
      where document_id = ${pdfId} order by created_at desc limit 1
    `;
    check("处理任务记为 SUCCEEDED", job?.status === "SUCCEEDED", `status=${String(job?.status)}`);

    /* ---------------- 3. 多格式 ---------------- */
    section("3. 其他格式");
    const xlsxUpload = await upload(
      cookieA,
      wsA.id,
      "供应商自评表.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xlsx,
    );
    const xlsxId = String(((xlsxUpload.body.document ?? {}) as Json).id ?? "");
    const xlsxDetail = await waitForTerminal(cookieA, xlsxId);
    const xlsxText = (xlsxDetail.extraction ?? null) as Json | null;
    check(
      "XLSX 提取出共享字符串与内联文本",
      typeof xlsxText?.preview === "string" &&
        xlsxText.preview.includes("控制编号") &&
        xlsxText.preview.includes("内联文本"),
    );

    const docxUpload = await upload(
      cookieA,
      wsA.id,
      "资质证书.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      docx,
    );
    const docxId = String(((docxUpload.body.document ?? {}) as Json).id ?? "");
    const docxDetail = await waitForTerminal(cookieA, docxId);
    const docxText = (docxDetail.extraction ?? null) as Json | null;
    check(
      "DOCX 提取出正文与有效期",
      typeof docxText?.preview === "string" &&
        docxText.preview.includes("示例科技") &&
        docxText.preview.includes("2027-12-31"),
    );

    /* ---------------- 4. 压缩包展开 ---------------- */
    section("4. 压缩包展开与条目闸门");
    const zipUpload = await upload(cookieA, wsA.id, "资料包.zip", "application/zip", zip);
    const zipDoc = (zipUpload.body.document ?? {}) as Json;
    const zipId = String(zipDoc.id ?? "");
    const children = (zipUpload.body.children ?? []) as Json[];
    check("压缩包上传成功", zipUpload.status === 201, `status=${zipUpload.status}`);
    check("包内合法条目被展开为独立子文档", children.length === 1, `children=${children.length}`);

    const childDetail = await waitForTerminal(cookieA, String(children[0]?.id ?? ""));
    check("子文档独立完成解析（READY）", (childDetail.document as Json)?.status === "READY");

    const zipDetail = await waitForTerminal(cookieA, zipId);
    const zipText = (zipDetail.extraction ?? null) as Json | null;
    check(
      "压缩包内容清单如实列出已展开与未处理条目",
      typeof zipText?.preview === "string" &&
        zipText.preview.includes("已展开的文件") &&
        zipText.preview.includes("未处理的条目"),
    );
    check("被拒绝的条目带有中文原因", typeof zipText?.preview === "string" && zipText.preview.includes(".exe"));

    const [childRow] = await sql<{ parent_document_id: string | null }[]>`
      select parent_document_id from documents where id = ${String(children[0]?.id ?? "")}
    `;
    check("子文档正确指向父文档", childRow?.parent_document_id === zipId);

    /* ---------------- 5. 多租户零信任 ---------------- */
    section("5. 多租户零信任");
    const anon = await getJson(`${BASE_URL}/api/documents/${pdfId}`);
    check("未登录访问文档详情 → 401", anon.status === 401, `status=${anon.status}`);

    const anonFile = await fetch(`${BASE_URL}/api/files/${pdfId}`, { redirect: "manual" });
    check("未登录下载 → 401", anonFile.status === 401, `status=${anonFile.status}`);

    const crossDetail = await getJson(`${BASE_URL}/api/documents/${pdfId}`, cookieB);
    check("乙用户读甲工作区的文档 → 403", crossDetail.status === 403, `status=${crossDetail.status}`);

    const crossDownload = await fetch(`${BASE_URL}/api/files/${pdfId}`, {
      headers: { cookie: cookieB },
      redirect: "manual",
    });
    check("乙用户下载甲工作区的文件 → 403", crossDownload.status === 403, `status=${crossDownload.status}`);

    const crossProcess = await fetch(`${BASE_URL}/api/documents/${pdfId}/process`, {
      method: "POST",
      headers: { cookie: cookieB },
      redirect: "manual",
    });
    check("乙用户触发重新解析 → 403", crossProcess.status === 403, `status=${crossProcess.status}`);

    const crossList = await getJson(`${BASE_URL}/api/documents?workspaceId=${wsA.id}`, cookieB);
    check("乙用户列举甲工作区的资料 → 403", crossList.status === 403, `status=${crossList.status}`);

    const crossUpload = await upload(cookieB, wsA.id, "越权上传.pdf", "application/pdf", pdf);
    check("乙用户往甲工作区上传 → 403", crossUpload.status === 403, `status=${crossUpload.status}`);

    const unknownId = randomUUID();
    const unknownDetail = await getJson(`${BASE_URL}/api/documents/${unknownId}`, cookieA);
    check("已登录但 id 不存在 → 404（不泄漏他人数据）", unknownDetail.status === 404, `status=${unknownDetail.status}`);

    /* ---------------- 6. 受授权下载 ---------------- */
    section("6. 受授权下载与存储路径保密");
    const download = await fetch(`${BASE_URL}/api/files/${pdfId}`, {
      headers: { cookie: cookieA },
      redirect: "manual",
    });
    const downloaded = Buffer.from(await download.arrayBuffer());
    check("本人下载 → 200", download.status === 200, `status=${download.status}`);
    check("下载字节与上传逐字节相同", downloaded.equals(pdf), `${downloaded.byteLength} bytes`);
    check(
      "响应头带正确的中文文件名",
      (download.headers.get("content-disposition") ?? "").includes("filename*=UTF-8''"),
      download.headers.get("content-disposition") ?? "",
    );

    const list = await getJson(`${BASE_URL}/api/documents?workspaceId=${wsA.id}`, cookieA);
    const listed = JSON.stringify(list.body);
    // 上传的是 4 个文件，其中 zip 展开出 1 个子文档 → 共 5 条记录
    check("列表返回 5 条记录（4 次上传 + 1 个 zip 子文档）", list.body.count === 5, `count=${String(list.body.count)}`);
    check(
      "列表响应里不出现存储路径（只暴露 documentId）",
      !listed.includes("workspaces/") && !listed.includes("storagePath") && !listed.includes("storage_path"),
    );

    const signedProbe = await getJson(`${BASE_URL}/api/files/signed/${Buffer.from(pdfRow.storage_path).toString("base64url")}?expires=1&signature=x`, cookieA);
    check("签名非法/过期的下载 → 403", signedProbe.status === 403, `status=${signedProbe.status}`);
  } finally {
    /* ---------------- 清理 ---------------- */
    section("清理");
    if (KEEP) {
      console.log(`  --keep 已指定：保留 workspaceA=${wsA.id} workspaceB=${wsB.id}`);
    } else {
      // 级联删除：workspace_members / documents / document_texts / document_processing_jobs
      await sql`delete from workspaces where id in (${wsA.id}, ${wsB.id})`;
      await sql`delete from users where id in (${userA.id}, ${userB.id})`;
      for (const workspaceId of [wsA.id, wsB.id]) {
        await rm(path.resolve(STORAGE_PATH, "workspaces", workspaceId), {
          recursive: true,
          force: true,
        });
      }
      const [{ count }] = await sql<{ count: string }[]>`
        select count(*)::text as count from documents where workspace_id in (${wsA.id}, ${wsB.id})
      `;
      check("测试数据已清理（文档记录归零）", count === "0", `剩余 ${count} 条`);
    }
    await sql.end();
  }

  /* ---------------- 汇总 ---------------- */
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${"═".repeat(58)}`);
  console.log(`  通过 ${checks.length - failed.length} / ${checks.length}`);
  if (failed.length > 0) {
    console.log("  未通过：");
    for (const item of failed) console.log(`    ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  console.log(`${"═".repeat(58)}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (error: unknown) => {
  console.error("\n端到端验收异常中止：", error instanceof Error ? error.message : error);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
