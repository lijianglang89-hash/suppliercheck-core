/**
 * 全局串行作业队列。
 *
 * 为什么不并发 —— 这不是保守，是算过的：
 * 生产机可用内存约 1.5 GB（2 vCPU / 4 GiB，且同时跑着宿主项目）。重活有两类：
 * 文档解析（pdf.js 需要完整字节缓冲、XLSX 是行解析）与审核引擎（一次性读入多份
 * 文档正文做规则匹配），两类都有明显的内存峰值。就算每个任务只占 60 MB，
 * 并发 5 个也会把机器推入 swap —— 而 swap 一旦被打满，宿主上的 nginx / 容器会一起
 * 被拖慢，那是「破坏现有服务」，代价远高于「慢一点」。
 *
 * 因此：**文档解析与审核共用同一条串行队列**。分开两条队列看着更"解耦"，
 * 实际等于把峰值内存翻倍 —— 那就失去了限流的全部意义。
 *
 * 吞吐量靠「一个请求只跑一次」而不是并发来保证。
 */

let tail: Promise<unknown> = Promise.resolve();

/** 当前排队中的任务数（含正在执行的）。 */
let pending = 0;

/** 把任务排进串行队列，返回该任务自己的 Promise。 */
export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  pending += 1;

  const result = tail.then(task, task);
  // 队列尾永远保持 resolved：单个任务失败不能卡死后面的任务。
  tail = result.then(
    () => undefined,
    () => undefined,
  );

  return result.finally(() => {
    pending -= 1;
  });
}

/** 供诊断/日志使用。 */
export function getQueueDepth(): number {
  return pending;
}

/** 仅供测试：等待队列排空。 */
export async function drainQueue(): Promise<void> {
  await tail;
}

/** 给 Promise 加超时。超时抛出的错误由调用方决定如何归类。 */
export function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return work;

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    // 不要因为一个定时器就让进程无法退出。
    timer.unref?.();
  });

  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
