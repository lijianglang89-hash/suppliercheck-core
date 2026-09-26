/**
 * 提取文本与上传检查层的纯逻辑测试。
 *
 * 这两块是全引擎「诚实性」的落点，所以测的重点不是功能，而是**边界行为**：
 * 触顶之后是截断还是静默丢弃？超限的文件会不会留下半成品？
 */

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { describe, expect, it } from "vitest";

import { DOCUMENT_STATUS_LABELS } from "@/lib/documents/labels";
import { InspectionTransform } from "@/lib/documents/inspect-stream";
import { DEFAULT_MAX_UPLOAD_BYTES } from "@/lib/documents/limits";
import { TextCollector, normalizeExtractedText } from "@/lib/documents/text";
import { AppError } from "@/lib/errors";

/**
 * 抽干一个异步可迭代对象，但**不保留**任何数据 —— 只用来驱动管道前进。
 * 存在的意义是让测试里的 "for await (const _ of source) {}" 不再产生
 * unused-vars 告警（那种写法虽然能跑，但会让 lint 一直红着，久了就没人看 lint 了）。
 */
async function drain(source: AsyncIterable<unknown>): Promise<void> {
  for await (const chunk of source) {
    void chunk;
  }
}

describe("TextCollector", () => {
  it("在上限内完整累积", () => {
    const collector = new TextCollector(10);
    collector.append("abc");
    collector.append("de");

    expect(collector.toString()).toBe("abcde");
    expect(collector.charCount).toBe(5);
    expect(collector.truncated).toBe(false);
    expect(collector.isEmpty).toBe(false);
  });

  it("触顶后置 truncated 并停止增长（而不是继续占内存）", () => {
    const collector = new TextCollector(5);
    collector.append("abc");
    collector.append("defghij");
    collector.append("再多的内容也不该被保留");

    expect(collector.toString()).toBe("abcde");
    expect(collector.charCount).toBe(5);
    expect(collector.truncated).toBe(true);
  });

  it("单次传入超大字符串也不会先把内存涨上去", () => {
    const collector = new TextCollector(4);
    collector.append("x".repeat(1_000_000));

    expect(collector.charCount).toBe(4);
    expect(collector.truncated).toBe(true);
  });

  it("拒绝非法上限", () => {
    expect(() => new TextCollector(0)).toThrow();
    expect(() => new TextCollector(Number.NaN)).toThrow();
  });
});

describe("normalizeExtractedText", () => {
  it("统一换行、去掉控制字符与行尾空白", () => {
    expect(normalizeExtractedText("a\r\nb\rc\u0000d  \n")).toBe("a\nb\ncd");
  });

  it("连续空行压成最多一个空行", () => {
    expect(normalizeExtractedText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("保留制表符（表格对齐依赖它）", () => {
    expect(normalizeExtractedText("项目\t结论")).toBe("项目\t结论");
  });

  it("不改写文字内容本身", () => {
    // 全角、繁体、标点都应原样保留 —— 归一化不是翻译
    const original = "（一）供應商：ＡＢＣ，有限公司。";
    expect(normalizeExtractedText(original)).toBe(original);
  });
});

describe("InspectionTransform", () => {
  it("统计字节数、计算 SHA-256，并截取文件头", async () => {
    const transform = new InspectionTransform({ maxBytes: 1024 });
    const payload = Buffer.from("%PDF-1.4 hello world", "utf8");
    const chunks: Buffer[] = [];

    await pipeline(Readable.from([payload]), transform, async function* (source) {
      for await (const chunk of source) chunks.push(chunk as Buffer);
    });

    expect(Buffer.concat(chunks).byteLength).toBe(payload.byteLength);
    expect(transform.size).toBe(payload.byteLength);
    expect(transform.getHeader().subarray(0, 4)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));

    const { createHash } = await import("node:crypto");
    expect(transform.getChecksum()).toBe(createHash("sha256").update(payload).digest("hex"));
  });

  it("超出上限时中断管道并抛 FILE_TOO_LARGE", async () => {
    const transform = new InspectionTransform({ maxBytes: 8 });

    await expect(
      pipeline(Readable.from([Buffer.alloc(64, 1)]), transform, async function* (source) {
        await drain(source);
      }),
    ).rejects.toThrow();

    expect(transform.exceeded).toBe(true);
  });

  it("getChecksum 可以重复调用（缓存在内部）", async () => {
    const transform = new InspectionTransform({ maxBytes: 64 });
    await pipeline(Readable.from([Buffer.from("abc", "utf8")]), transform, async function* (source) {
      await drain(source);
    });

    expect(transform.getChecksum()).toBe(transform.getChecksum());
  });

  it("拒绝非法上限", () => {
    expect(() => new InspectionTransform({ maxBytes: 0 })).toThrow(AppError);
  });
});

describe("导出与常量自洽性", () => {
  it("默认上传上限是 20 MB（Agent 02 指令要求）", () => {
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
  });

  it("状态文案映射覆盖全部状态", () => {
    expect(Object.keys(DOCUMENT_STATUS_LABELS).sort()).toEqual(
      ["DELETED", "FAILED", "PROCESSING", "READY", "UPLOADED"].sort(),
    );
  });
});
