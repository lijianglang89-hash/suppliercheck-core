/**
 * 图片解析器：目前**明确不做**本地 OCR。
 *
 * Agent 02 指令原文允许这个处理方式：「若某库内存消耗大或者没有轻量本地方案，
 * 可以允许抽象接口存在，但需要返回『暂不支持本地 OCR，待接入外部 API』」。
 *
 * 为什么不在本阶段塞一个 tesseract.js：
 *   - 它会下载 10 MB 级语言模型（生产机磁盘只剩 22 GB，且需要外网）；
 *   - 识别一张 A4 扫描件要几十秒到几分钟，会长时间占住串行解析队列；
 *   - 峰值内存不可控，与「可用内存约 1.5 GB」的前提冲突。
 *
 * 因此这里**只保留接口与诚实的说明**：图片会被完整保存、可以下载、可以预览，
 * 只是暂时不产出文本。绝不返回空文本假装「解析成功」。
 *
 * 后续接入外部 OCR API 时，只需在这里换实现，上层无需改动。
 */

import { emptyOutcome, type DocumentParser, type ParseOutcome, type ParseSource } from "./types";

export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg"] as const;

export const LOCAL_OCR_UNSUPPORTED_NOTE =
  "暂不支持本地 OCR，待接入外部 API。图片已完整保存，可下载与预览。";

export const imageParser: DocumentParser = {
  id: "image-ocr-pending",
  supportedMimeTypes: IMAGE_MIME_TYPES,

  supports(mimeType: string): boolean {
    return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
  },

  async parse(source: ParseSource): Promise<ParseOutcome> {
    return emptyOutcome({
      parserId: this.id,
      notes: [LOCAL_OCR_UNSUPPORTED_NOTE],
      meta: {
        extraction: "unsupported",
        reason: "local_ocr_unavailable",
        mimeType: source.mimeType,
        size: source.size,
      },
    });
  },
};
