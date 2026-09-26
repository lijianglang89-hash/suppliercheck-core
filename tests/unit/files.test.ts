import { describe, expect, it } from "vitest";

import {
  ALLOWED_MIME_TYPE_LIST,
  buildStorageKey,
  extractExtension,
  isUuid,
  resolveExtensionForMime,
  sanitizeFilename,
  sha256Hex,
  signatureMatchesMime,
  sniffFileSignature,
  validateUpload,
} from "@/lib/files";

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const ZIP_HEADER = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("sanitizeFilename", () => {
  it("剥离目录成分，只保留文件名", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Windows\\system32\\evil.pdf")).toBe("evil.pdf");
    expect(sanitizeFilename("/var/www/a.pdf")).toBe("a.pdf");
  });

  it("替换非法字符", () => {
    expect(sanitizeFilename('bad<>:"|?*name.pdf')).toBe("bad_______name.pdf");
  });

  it("移除控制字符", () => {
    expect(sanitizeFilename("a\u0000b\u001fc.pdf")).toBe("a_b_c.pdf");
  });

  it("折叠 .. 序列并以点开头的名字被清理", () => {
    expect(sanitizeFilename("...hidden.pdf")).toBe("hidden.pdf");
  });

  it("保留 Windows 设备名但加前缀避免冲突", () => {
    expect(sanitizeFilename("CON.pdf")).toBe("_CON.pdf");
    expect(sanitizeFilename("lpt1")).toBe("_lpt1");
  });

  it("超长文件名被截断到上限", () => {
    const long = `${"a".repeat(500)}.pdf`;
    const result = sanitizeFilename(long);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith(".pdf")).toBe(true);
  });

  it("空文件名抛错", () => {
    expect(() => sanitizeFilename("")).toThrow();
    expect(() => sanitizeFilename("   ")).toThrow();
    expect(() => sanitizeFilename("...")).toThrow();
  });
});

describe("resolveExtensionForMime", () => {
  it("按白名单反查扩展名，忽略用户提供的扩展名", () => {
    expect(resolveExtensionForMime("application/pdf")).toBe(".pdf");
    expect(resolveExtensionForMime("image/jpeg")).toBe(".jpg");
    expect(resolveExtensionForMime("application/pdf; charset=binary")).toBe(".pdf");
  });

  it("不在白名单内一律拒绝", () => {
    expect(() => resolveExtensionForMime("application/x-msdownload")).toThrow();
    expect(() => resolveExtensionForMime("")).toThrow();
  });

  it("白名单覆盖需求列出的格式", () => {
    expect(ALLOWED_MIME_TYPE_LIST).toContain("application/pdf");
    expect(ALLOWED_MIME_TYPE_LIST).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(ALLOWED_MIME_TYPE_LIST).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(ALLOWED_MIME_TYPE_LIST).toContain("image/png");
    expect(ALLOWED_MIME_TYPE_LIST).toContain("image/jpeg");
    expect(ALLOWED_MIME_TYPE_LIST).toContain("application/zip");
  });
});

describe("sniffFileSignature", () => {
  it("识别 PDF / PNG / JPEG / ZIP", () => {
    expect(sniffFileSignature(PDF_HEADER)).toBe("pdf");
    expect(sniffFileSignature(PNG_HEADER)).toBe("png");
    expect(sniffFileSignature(JPEG_HEADER)).toBe("jpeg");
    expect(sniffFileSignature(ZIP_HEADER)).toBe("zip");
  });

  it("无法识别的内容返回 unknown", () => {
    expect(sniffFileSignature(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe("unknown");
    expect(sniffFileSignature(new Uint8Array([]))).toBe("unknown");
  });
});

describe("signatureMatchesMime", () => {
  it("把 docx / xlsx 正确识别为 zip 容器", () => {
    expect(
      signatureMatchesMime(
        "zip",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(
      signatureMatchesMime(
        "zip",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(true);
  });

  it("拒绝伪装：声明 PDF 实际是 ZIP", () => {
    expect(signatureMatchesMime("zip", "application/pdf")).toBe(false);
    expect(signatureMatchesMime("unknown", "application/pdf")).toBe(false);
  });
});

describe("buildStorageKey 与路径安全", () => {
  it("生成 workspaces/<uuid>/documents/<uuid><ext> 结构", () => {
    const key = buildStorageKey({
      workspaceId: UUID,
      documentId: "11111111-2222-4333-8444-555555555555",
      mimeType: "application/pdf",
    });
    expect(key).toBe(`workspaces/${UUID}/documents/11111111-2222-4333-8444-555555555555.pdf`);
  });

  it("拒绝非 UUID 的 workspaceId / documentId", () => {
    expect(() =>
      buildStorageKey({ workspaceId: "../../etc", documentId: UUID, mimeType: "application/pdf" }),
    ).toThrow();
    expect(() =>
      buildStorageKey({ workspaceId: UUID, documentId: "x/y", mimeType: "application/pdf" }),
    ).toThrow();
  });

  it("isUuid 判定正确", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("validateUpload", () => {
  const base = {
    filename: "营业执照.pdf",
    mimeType: "application/pdf",
    size: 1024,
    header: PDF_HEADER,
    maxBytes: 10 * 1024 * 1024,
  };

  it("合法上传通过并返回规范化元数据", () => {
    const result = validateUpload(base);
    expect(result.mimeType).toBe("application/pdf");
    expect(result.extension).toBe(".pdf");
    expect(result.safeFilename).toBe("营业执照.pdf");
    expect(result.size).toBe(1024);
  });

  it("超过大小上限被拒绝", () => {
    expect(() => validateUpload({ ...base, size: 20 * 1024 * 1024 })).toThrow(/超出上限/);
  });

  it("大小为 0 被拒绝", () => {
    expect(() => validateUpload({ ...base, size: 0 })).toThrow();
  });

  it("类型不在白名单被拒绝", () => {
    expect(() => validateUpload({ ...base, mimeType: "application/x-sh" })).toThrow();
  });

  it("魔数与声明类型不符时被拒绝（挂马保护）", () => {
    expect(() => validateUpload({ ...base, header: ZIP_HEADER })).toThrow(/不一致/);
  });
});

describe("extractExtension 与 sha256Hex", () => {
  it("取小写扩展名", () => {
    expect(extractExtension("A.PDF")).toBe(".pdf");
    expect(extractExtension("noext")).toBe("");
  });

  it("摘要稳定且为 64 位十六进制", () => {
    const digest = sha256Hex(new Uint8Array([1, 2, 3]));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(new Uint8Array([1, 2, 3]))).toBe(digest);
    expect(sha256Hex(new Uint8Array([1, 2, 4]))).not.toBe(digest);
  });
});
