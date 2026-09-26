/**
 * 流式上传的「边写边验」通道。
 *
 * 需求要求「严禁文件直接存入内存 buffer 导致 OOM」。做法是：上传字节流在**流向磁盘的
 * 同一个 Transform 里**顺带完成三件事，而不是先攒成 Buffer 再处理：
 *
 *   1. 取文件头前若干字节 —— 用于魔数嗅探（在写盘前就能判定真假类型）；
 *   2. 增量计算 SHA-256 —— 不需要第二遍读盘；
 *   3. 累计字节数并卡住硬上限 —— 超限立刻中断管道，已写入的部分由调用方清理。
 *
 * 本文件是纯 Node 流逻辑，不依赖任何框架，因此可以被单元测试直接覆盖。
 */

import { createHash, type Hash } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

import { errors } from "@/lib/errors";

/** 魔数嗅探只需要前 16 字节；多取几个字节对内存无影响，但能覆盖更长的签名。 */
export const DEFAULT_HEADER_BYTES = 16;

export interface InspectionTransformOptions {
  /** 硬上限（字节）。超出即让管道报错。 */
  maxBytes: number;
  /** 需要截取的文件头长度。 */
  headerBytes?: number;
}

/**
 * 直通式检查 Transform：不改一个字节，只顺手做记录。
 *
 * 注意 `size` 统计的是**已经流过**的字节。超限时本 Transform 会先于写入端报错，
 * 因此调用方不能假设落盘文件是完整的 —— 必须按错误处理并删除残留文件。
 */
export class InspectionTransform extends Transform {
  readonly maxBytes: number;

  private readonly hash: Hash;
  private readonly header: Buffer;
  private headerLength = 0;
  private checksum: string | undefined;

  /** 已流过的字节数。 */
  size = 0;
  /** 是否触发了上限。 */
  exceeded = false;

  constructor(options: InspectionTransformOptions) {
    super();
    if (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0) {
      throw errors.configuration("InspectionTransform 的 maxBytes 必须是正数。");
    }
    this.maxBytes = options.maxBytes;
    this.hash = createHash("sha256");
    this.header = Buffer.alloc(options.headerBytes ?? DEFAULT_HEADER_BYTES);
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    this.size += buffer.length;
    if (this.size > this.maxBytes) {
      this.exceeded = true;
      callback(errors.fileTooLarge("文件超出大小限制。", { details: { maxBytes: this.maxBytes } }));
      return;
    }

    this.hash.update(buffer);

    const remaining = this.header.length - this.headerLength;
    if (remaining > 0) {
      const take = Math.min(remaining, buffer.length);
      buffer.copy(this.header, this.headerLength, 0, take);
      this.headerLength += take;
    }

    callback(null, buffer);
  }

  /** 已读到的文件头字节（副本，调用方可以安全持有）。 */
  getHeader(): Uint8Array {
    return Uint8Array.from(this.header.subarray(0, this.headerLength));
  }

  hasEnoughHeader(bytes: number): boolean {
    return this.headerLength >= bytes;
  }

  /**
   * 取 SHA-256 摘要。
   *
   * ⚠️ 只在流**正常结束**后调用才有意义；超限中断时摘要对应的是被中断的前缀，
   * 调用方在错误路径上不应该使用它。
   */
  getChecksum(): string {
    this.checksum ??= this.hash.digest("hex");
    return this.checksum;
  }
}

/** 工厂函数，便于测试与调用方表述意图。 */
export function createInspectionTransform(options: InspectionTransformOptions): InspectionTransform {
  return new InspectionTransform(options);
}
