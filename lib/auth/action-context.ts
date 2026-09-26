import "server-only";

import { ensureWorkspaceForUser } from "@/lib/auth/workspaces";
import { requireUser, requireWorkspaceAccess, type WorkspaceContext } from "@/lib/auth/guards";
import type { WorkspaceRole } from "@/lib/db/schema";
import { ERROR_CODES, toAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Server Action / 页面共用的授权入口。
 *
 * 为什么要在 requireWorkspaceAccess 之外再包一层：
 * 每个动作都需要同样的三步 ——「要登录 → 找当前工作区 → 校验成员资格」。
 * 散在十几个 action 里写的后果不是"重复"，而是**迟早有一个漏掉其中一步**，
 * 而漏掉的那个就是越权入口。授权路径只允许有一条。
 *
 * 默认要求 MEMBER（可读可写）。只读场景显式传 "VIEWER" ——
 * 默认值选宽的那个是刻意的：宁可让人多写一个参数，也不要因为忘了传而放松权限。
 */
export async function requireActionWorkspace(
  minimumRole: WorkspaceRole = "MEMBER",
): Promise<WorkspaceContext> {
  const user = await requireUser();
  const active = await ensureWorkspaceForUser(user.id);
  return requireWorkspaceAccess(active.id, { minimumRole });
}

/** 只读页面用。语义上等于「已登录且属于该工作区」。 */
export async function requireReadableWorkspace(): Promise<WorkspaceContext> {
  return requireActionWorkspace("VIEWER");
}

/**
 * 执行一个**删除类**动作，只容忍「目标已不存在」这一种失败。
 *
 * 为什么不一概 try/catch 吞掉：那会把认证失效、权限不足、数据库不可用
 * 一起变成"界面没反应"，是最难排查的一类故障。
 * 而「目标已不存在」是真实存在的一种并发场景 —— 同一个人在另一个标签页里
 * 刚把这条记录删掉，这边再点一次删除按钮。此时**正确行为就是什么都不做**，
 * 随后的列表刷新会自然反映出真实状态，报一个错误页反而是错的。
 *
 * ⚠️ 只允许用在删除上，且参数名就叫 deleteWork 就是为了让人在别处用不下去。
 * 理由：把它用在「更新」上（比如给资料指定供应商），目标被并发删掉时
 * 用户点了保存、界面加载完毕、什么都没发生 —— 静默失败比报错可怕得多，
 * 那是工单的来源。更新类动作要么成功要么报错，中间状态不存在。
 */
export async function runIdempotentDelete(
  deleteWork: () => Promise<void>,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await deleteWork();
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code !== ERROR_CODES.NOT_FOUND) {
      throw error;
    }
    logger.warn("操作目标已不存在，按幂等处理", { ...context, code: appError.code });
  }
}
