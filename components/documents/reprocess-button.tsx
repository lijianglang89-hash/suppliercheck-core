"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 重新解析按钮。
 *
 * 只在「解析失败」或「长时间停在解析中」时出现 —— 已经可查看的文档不需要这个按钮，
 * 给所有行都放一个只会让界面变吵。
 */
export interface ReprocessButtonProps {
  documentId: string;
}

export function ReprocessButton({ documentId }: ReprocessButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  async function trigger() {
    setPending(true);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/process`, {
        method: "POST",
        headers: { "Cache-Control": "no-store" },
      });
      const payload = (await response.json()) as {
        queued?: boolean;
        reason?: string;
        error?: { message?: string };
      };

      if (!response.ok) {
        setMessage(payload.error?.message ?? "触发失败");
      } else if (payload.queued === false) {
        setMessage(payload.reason === "already_processing" ? "正在解析中" : "无需重新解析");
      } else {
        setMessage("已重新排队");
      }
    } catch {
      setMessage("网络错误");
    } finally {
      setPending(false);
      router.refresh();
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void trigger()}
        disabled={pending}
        className="rounded border border-ink-300 bg-white px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
      >
        {pending ? "提交中…" : "重新解析"}
      </button>
      {message && <span className="text-xs text-ink-500">{message}</span>}
    </span>
  );
}
