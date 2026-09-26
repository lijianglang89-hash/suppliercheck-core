/**
 * 压缩包解析器：把 .zip 的**内容清单**作为文本产出。
 *
 * 注意分工 —— 这里只负责「把包的内容说清楚」，不负责解包。真正的解包发生在上传阶段
 * （见 lib/documents/service.ts），会把每个可接受条目展开成一份独立的子文档，
 * 各自走完整的解析与状态机。这样做的原因：
 *   1. 子文档需要有自己的 workspace/owner/审计记录，不能挂在一个不存在的行上；
 *   2. 解包失败时子文档可以单独标 FAILED，不会把整包拖成失败。
 *
 * 若把清单文本也算作「解析成功」，那是因为它确实如实描述了包内有什么，
 * 而不是在假装读懂了包里的文件。
 */

import { formatBytes } from "@/lib/files";

import { planZipExtraction } from "../archive";
import { TextCollector, normalizeExtractedText } from "../text";
import { emptyOutcome, type DocumentParser, type ParseOutcome, type ParseSource } from "./types";

export const ZIP_MIME = "application/zip";

export const archiveParser: DocumentParser = {
  id: "zip",
  supportedMimeTypes: [ZIP_MIME],

  supports(mimeType: string): boolean {
    return mimeType === ZIP_MIME;
  },

  async parse(source: ParseSource): Promise<ParseOutcome> {
    if (!source.localPath) {
      return emptyOutcome({
        parserId: this.id,
        notes: ["当前存储后端不支持按路径读取压缩包，已跳过内容清单；文件本身已完整保存。"],
        meta: { extraction: "skipped", reason: "no_local_path" },
      });
    }

    const plan = await planZipExtraction(source.localPath);

    if (plan.entryCount === 0) {
      return emptyOutcome({
        parserId: this.id,
        notes: ["该压缩包内没有文件。"],
        meta: { extraction: "empty_archive" },
      });
    }

    const collector = new TextCollector();
    collector.append(`压缩包内共 ${plan.entryCount} 个条目，其中 ${plan.accepted.length} 个已展开为独立文档。\n\n`);
    collector.append("## 已展开的文件\n");
    for (const entry of plan.accepted) {
      collector.append(`- ${entry.safeFilename}（${entry.mimeType}，${formatBytes(entry.uncompressedSize)}）\n`);
    }

    if (plan.rejected.length > 0) {
      collector.append("\n## 未处理的条目\n");
      for (const item of plan.rejected.slice(0, 30)) {
        collector.append(`- ${item.entryName}：${item.reason}\n`);
      }
      if (plan.rejected.length > 30) {
        collector.append(`- …… 另有 ${plan.rejected.length - 30} 条未列出\n`);
      }
    }

    const notes: string[] = [];
    if (plan.accepted.length === 0) {
      notes.push("压缩包内没有可处理的文件，详见下方清单。");
    }
    if (plan.truncated) {
      notes.push("压缩包条目数或总体积超出上限，仅处理了前面的条目。");
    }

    const text = normalizeExtractedText(collector.toString());

    return {
      parserId: this.id,
      text,
      charCount: text.length,
      truncated: plan.truncated,
      notes,
      meta: {
        extraction: "ok",
        entryCount: plan.entryCount,
        acceptedCount: plan.accepted.length,
        rejectedCount: plan.rejected.length,
        acceptedBytes: plan.acceptedBytes,
      },
    };
  },
};
