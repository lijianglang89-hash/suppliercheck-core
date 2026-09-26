/**
 * 首页用的视觉素材。
 *
 * 全部现做，不引图标库、不用图库照片 —— 见 docs/DESIGN.md §4。
 * 理由：这个产品最好的视觉就是它自己的界面（文件 → 审核 → 结果），
 * 而且这条链能复用到首页、产品页、社媒与宣传视频。
 *
 * ⚠️ 这些组件渲染的都是**示例数据**。任何用到它们的区块都必须在显眼处标注
 * 「示例数据」，否则就是把造出来的东西当真证据。
 */

type Status = "pass" | "warn" | "fail";

const STATUS_STYLE: Record<Status, { label: string; className: string }> = {
  pass: { label: "通过", className: "bg-success-600/10 text-success-600" },
  warn: { label: "待确认", className: "bg-warning-600/10 text-warning-600" },
  fail: { label: "问题", className: "bg-danger-600/10 text-danger-600" },
};

export function StatusPill({ status }: { status: Status }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}

/** 文件类型标签：只用文字，不用 emoji，避免出现风格不统一的彩色图标。 */
function FileIcon({ ext }: { ext: string }) {
  return (
    <span className="inline-flex h-6 w-8 shrink-0 items-center justify-center rounded bg-brand-600/10 text-[10px] font-semibold uppercase text-brand-700">
      {ext}
    </span>
  );
}

export interface DemoFile {
  name: string;
  ext: string;
}

/** 一叠资料文件卡。 */
export function FileStack({ files }: { files: readonly DemoFile[] }) {
  return (
    <ul className="space-y-1.5">
      {files.map((file) => (
        <li
          key={file.name}
          className="flex items-center gap-2 rounded-md border border-ink-200 bg-white px-2.5 py-2"
        >
          <FileIcon ext={file.ext} />
          <span className="truncate text-xs text-ink-700">{file.name}</span>
        </li>
      ))}
    </ul>
  );
}

/** 向下箭头：连接"文件 → 审核 → 结果"三段。 */
export function FlowArrow() {
  return (
    <div className="flex justify-center py-1.5 text-ink-300" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 5v14M6 13l6 6 6-6" />
      </svg>
    </div>
  );
}

/**
 * 审核结果面板 —— 首页的核心视觉资产。
 *
 * 数字（14 / 3 / 1）与条目都是**示例**，用来说明"报告长什么样"，
 * 不代表任何真实审核结果。调用方必须标注「示例数据」。
 */
export function ResultPanel({
  summary,
  rows,
}: {
  summary: { pass: number; warn: number; fail: number };
  rows: readonly { label: string; status: Status; note: string }[];
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white">
      <div className="grid grid-cols-3 divide-x divide-ink-200 border-b border-ink-200">
        <div className="px-3 py-2.5 text-center">
          <p className="text-lg font-semibold tabular-nums text-success-600">{summary.pass}</p>
          <p className="text-[11px] text-ink-500">通过</p>
        </div>
        <div className="px-3 py-2.5 text-center">
          <p className="text-lg font-semibold tabular-nums text-warning-600">{summary.warn}</p>
          <p className="text-[11px] text-ink-500">待确认</p>
        </div>
        <div className="px-3 py-2.5 text-center">
          <p className="text-lg font-semibold tabular-nums text-danger-600">{summary.fail}</p>
          <p className="text-[11px] text-ink-500">问题</p>
        </div>
      </div>

      <ul className="divide-y divide-ink-100">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-ink-800">{row.label}</p>
              <p className="truncate text-[11px] text-ink-500">{row.note}</p>
            </div>
            <StatusPill status={row.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
