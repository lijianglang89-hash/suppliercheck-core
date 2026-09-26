/**
 * 文档解析队列出口。
 *
 * 实现已搬到 `lib/jobs/serial-queue.ts` —— 因为**审核引擎与文档解析共用同一条
 * 串行队列**（理由见那边的文件头注释）。这里保留 re-export 而不是改所有 import，
 * 是为了让 `documents/service.ts` 的改动面为零：队列的语义没变，
 * 只是它不再专属于文档解析。
 */
export { drainQueue, getQueueDepth, runExclusive, withTimeout } from "@/lib/jobs/serial-queue";
