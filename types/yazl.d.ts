/**
 * `yazl` 的最小类型声明。
 *
 * 为什么手写而不是装 @types/yazl：yazl 只在**测试**里用来构造 zip 夹具，
 * 用到的 API 面积很小。为它引入一个额外依赖（以及后续的版本漂移风险）
 * 不划算；这里按实际用法精确声明，多一个方法都不给。
 *
 * 若将来生产代码也需要写 zip，应改为引入官方类型包并扩大此声明。
 */
declare module "yazl" {
  import type { Readable } from "node:stream";

  export interface AddOptions {
    /** 是否压缩（默认 true / deflate）。false 表示 store。 */
    compress?: boolean;
    mtime?: Date;
    mode?: number;
  }

  export class ZipFile {
    /** zip 字节流。必须监听 data/end/error 才会开始产出。 */
    readonly outputStream: Readable;

    /** 把一个内存缓冲区作为条目写入。 */
    addBuffer(buffer: Buffer, metadataPath: string, options?: AddOptions): void;

    /** 按 yazl 的约定结束写入并产出 central directory。 */
    end(options?: { forceZip64Format?: boolean }): void;
  }
}
