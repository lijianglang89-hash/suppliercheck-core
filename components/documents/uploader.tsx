"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 资料包上传器（拖拽 + 点选）。
 *
 * 几个刻意的取舍：
 * - **串行上传**：一次只发一个请求。并发 5 个 20 MB 文件除了把带宽和内存峰值
 *   抬高，对用户体验没有任何改善（前一个还没传完，后一个也快不了）。
 * - **客户端先挡一道**：类型和大小在本地就判掉，用户不用等传完才知道格式不对。
 *   但这只是体验优化，服务端仍会独立校验 —— 客户端校验永远不构成信任依据。
 * - **进度用 XHR**：fetch 拿不到上传百分比，而 20 MB 文件没有进度条体验很差。
 */

const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg", ".zip"] as const;
const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(",");

type ItemState = "queued" | "uploading" | "done" | "error";

interface QueueItem {
  key: string;
  file: File;
  state: ItemState;
  progress: number;
  message?: string;
  createdCount?: number;
}

export interface UploaderProps {
  workspaceId: string;
  /** 服务端生效的大小上限（字节）。 */
  maxBytes: number;
}

export function DocumentUploader({ workspaceId, maxBytes }: UploaderProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const maxLabel = `${Math.round(maxBytes / (1024 * 1024))} MB`;

  /**
   * 局部更新队列里的一项。
   *
   * 用 useCallback 声明在 startUpload **之前**：函数声明虽然会被提升、运行时没问题，
   * 但「在被声明前引用」会让 React Compiler 的静态分析失效（lint 直接报错）。
   */
  const updateItem = useCallback((key: string, patch: Partial<QueueItem>) => {
    setItems((previous) =>
      previous.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }, []);

  const startUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const accepted: QueueItem[] = [];
      const rejected: QueueItem[] = [];

      for (const file of files) {
        const lower = file.name.toLowerCase();
        const extensionOk = ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
        if (!extensionOk) {
          rejected.push({
            key: `${file.name}-${file.size}-ext`,
            file,
            state: "error",
            progress: 0,
            message: `不支持的类型，仅支持 ${ACCEPTED_EXTENSIONS.join(" ")}`,
          });
          continue;
        }
        if (file.size > maxBytes) {
          rejected.push({
            key: `${file.name}-${file.size}-size`,
            file,
            state: "error",
            progress: 0,
            message: `超出 ${maxLabel} 上限`,
          });
          continue;
        }
        accepted.push({
          key: `${file.name}-${file.size}-${file.lastModified}`,
          file,
          state: "queued",
          progress: 0,
        });
      }

      if (rejected.length > 0) setItems((previous) => [...rejected, ...previous]);
      if (accepted.length === 0) return;

      setItems((previous) => [...accepted, ...previous]);
      setBusy(true);

      for (const item of accepted) {
        updateItem(item.key, { state: "uploading", progress: 0 });
        try {
          const result = await uploadOne(item.file, workspaceId, (ratio) =>
            updateItem(item.key, { progress: ratio }),
          );
          updateItem(item.key, {
            state: "done",
            progress: 1,
            createdCount: 1 + (result.children?.length ?? 0),
          });
        } catch (error) {
          updateItem(item.key, {
            state: "error",
            message: error instanceof Error ? error.message : "上传失败",
          });
        }
      }

      setBusy(false);
      // 让列表页重新取数，新文档立刻出现（状态会随后续轮询由「已上传」变为「可查看」）。
      router.refresh();
    },
    [maxBytes, maxLabel, router, updateItem, workspaceId],
  );

  return (
    <section aria-labelledby="upload-heading" className="card">
      <div className="border-b border-ink-100 px-5 py-3">
        <h2 id="upload-heading" className="text-sm font-semibold text-ink-900">
          上传供应商资料
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">
          支持 {ACCEPTED_EXTENSIONS.join(" / ")}，单个文件不超过 {maxLabel}。压缩包会自动展开为独立资料。
        </p>
      </div>

      <div className="p-5">
        <div
          role="button"
          tabIndex={0}
          aria-label="选择或拖拽文件上传"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void startUpload(Array.from(event.dataTransfer.files));
          }}
          className={
            dragging
              ? "flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-brand-500 bg-brand-50 px-6 py-10 text-center"
              : "flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-ink-300 bg-ink-50 px-6 py-10 text-center hover:border-ink-400"
          }
        >
          <p className="text-sm font-medium text-ink-800">
            {busy ? "正在上传……" : "把文件拖到这里，或点击选择"}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            一次一个文件依次上传，避免并发占用带宽
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={ACCEPT_ATTRIBUTE}
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void startUpload(files);
          }}
        />

        {items.length > 0 && (
          <ul className="mt-4 space-y-2">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex items-center justify-between gap-3 rounded-md border border-ink-100 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-ink-800" title={item.file.name}>
                  {item.file.name}
                </span>
                <span className="shrink-0 text-xs text-ink-500">
                  {item.state === "queued" && "排队中"}
                  {item.state === "uploading" && `上传中 ${Math.round(item.progress * 100)}%`}
                  {item.state === "done" &&
                    (item.createdCount && item.createdCount > 1
                      ? `已上传（展开 ${item.createdCount} 份资料）`
                      : "已上传")}
                  {item.state === "error" && (
                    <span className="text-danger-600">{item.message ?? "失败"}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface UploadResponse {
  document?: { id: string };
  children?: Array<{ id: string }>;
  error?: { code: string; message: string };
}

function uploadOne(
  file: File,
  workspaceId: string,
  onProgress: (ratio: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/documents/upload?workspaceId=${encodeURIComponent(workspaceId)}`);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    });

    xhr.addEventListener("load", () => {
      let payload: UploadResponse = {};
      try {
        payload = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        reject(new Error("服务端响应无法解析"));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
        return;
      }
      reject(new Error(payload.error?.message ?? `上传失败（${xhr.status}）`));
    });

    xhr.addEventListener("error", () => reject(new Error("网络错误，上传未完成")));
    xhr.addEventListener("abort", () => reject(new Error("上传已取消")));

    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}
