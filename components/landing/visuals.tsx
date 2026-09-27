/**
 * 首页用的视觉素材。
 *
 * 全部现做，不引图标库、不用图库照片 —— 见 docs/DESIGN.md §4。
 * 理由：这个产品最好的视觉就是它自己的界面（文件 → 审核 → 结果），
 * 而且这条链能复用到首页、产品页、社媒与宣传视频。
 *
 * ⚠️ 这些组件渲染的都是**示例数据**。任何用到它们的区块都必须在显眼处标注
 * 「示例数据」，否则就是把造出来的东西当真证据。
 *
 * 容器纪律：所有"产品界面片段"一律装进 .card / .card-soft，
 * 让它们浮在区块底色之上 —— 扁平贴底的截图看着像插图，不像软件。
 */

import { Icon, type IconName } from "@/components/ui/icons";

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
 * 5 类检查的总览 —— 「一份资料包进去，五个维度分别有事没事」。
 *
 * ⚠️ 刻意**不用**放射状的连线图：那种图在大屏上好看，落到 390px 就会挤成一团，
 * 而且连接线是纯装饰，没有任何信息量。这里用「汇总条 + 横向五段」，
 * 每一段自带真实规则条数与自己的状态 —— 状态色不统一才有意义
 * （docs/DESIGN.md §2：五个维度同时全绿的产品截图反而说明图是画出来的）。
 *
 * `count` 由调用方从 REVIEW_RULES 现算传入，不在这里写死。
 */
export function CheckFanout({
  groups,
}: {
  groups: readonly {
    label: string;
    count: number;
    status: Status;
    headline: string;
    icon: IconName;
    tone: string;
  }[];
}) {
  return (
    <div className="card p-4">
      <div className="card-soft flex items-center justify-between gap-3 px-3 py-2">
        <span className="text-sm font-medium text-ink-800">供应商资料包</span>
        <span className="text-[11px] text-ink-500">一次导入 · 并发核对</span>
      </div>

      <div className="my-2 flex justify-center text-ink-300" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
      </div>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {groups.map((group) => (
          <li key={group.label} className="card-soft px-2.5 py-2">
            <div className="flex items-center justify-between gap-1">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${group.tone}`}
                aria-hidden="true"
              >
                <Icon name={group.icon} className="h-3.5 w-3.5" />
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-500">{group.count} 条</span>
            </div>
            <p className="mt-1.5 truncate text-xs font-medium text-ink-800">{group.label}</p>
            <p className="mt-0.5 truncate text-[11px] leading-4 text-ink-500">{group.headline}</p>
            <div className="mt-1.5">
              <StatusPill status={group.status} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 「规则到底怎么跑的」示意 —— 一条规则从命中到变成一条发现。
 *
 * 用真实规则名会让页面像在演示假结果（那是示例数据，容易误导），
 * 所以这里只呈现**结构**：命中 → 定级 → 附摘录 → 进报告。
 * 讲机制而不是讲结果，就不需要「示例数据」的免责前提。
 */
export function RulePipeline({ tone = "light" }: { tone?: "light" | "dark" }) {
  const steps = [
    { title: "命中", detail: "资料正文满足规则条件" },
    { title: "定级", detail: "严重 / 高 / 中 / 低 / 提示" },
    { title: "取证据", detail: "所在文件 + 原文摘录" },
    { title: "进报告", detail: "按严重级别排序呈现" },
  ];

  const dark = tone === "dark";

  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, index) => (
        <li
          key={step.title}
          className={
            dark
              ? "rounded-md border border-white/10 bg-white/5 px-3 py-2.5"
              : "card px-3 py-2.5"
          }
        >
          <div className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold tabular-nums ${
                dark ? "bg-white/15 text-white" : "bg-brand-600 text-white"
              }`}
            >
              {index + 1}
            </span>
            <span className={`text-xs font-medium ${dark ? "text-white" : "text-ink-800"}`}>
              {step.title}
            </span>
          </div>
          <p className={`mt-1.5 text-[11px] leading-4 ${dark ? "text-white/60" : "text-ink-500"}`}>
            {step.detail}
          </p>
        </li>
      ))}
    </ol>
  );
}

/**
 * 资料存取链路图。
 *
 * 只画**已实现**的环节 —— 多画一个（比如「加密传输」之外的合规认证）
 * 就变成没有证据的声明了（docs/DESIGN.md §0 硬规则 2）。
 */
export function StorageDiagram() {
  const nodes = [
    { title: "浏览器", detail: "携带会话 Cookie" },
    { title: "服务端鉴权", detail: "回库确认工作区归属" },
    { title: "私有存储", detail: "无公开 URL，不对外暴露" },
    { title: "签名临时地址", detail: "取原文件时签发，过期失效" },
  ];

  return (
    <div className="card p-5">
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {nodes.map((node, index) => (
          <li key={node.title} className="relative">
            <div className="card-soft px-3 py-2.5">
              <p className="text-xs font-medium text-ink-800">{node.title}</p>
              <p className="mt-1 text-[11px] leading-4 text-ink-500">{node.detail}</p>
            </div>
            <p className="mt-1 pl-1 text-[10px] tabular-nums text-ink-400">{`环节 ${index + 1} / ${nodes.length}`}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 border-t border-ink-100 pt-3 text-[11px] leading-5 text-ink-500">
        浏览器端传入的工作区编号只作为请求参数，真正的授权判断在服务端完成。
      </p>
    </div>
  );
}

/**
 * 首屏主界面局部：一段**密实的发现清单**。
 *
 * 为什么不像以前那样放"完整界面"：整页截图缩到 600px 宽后字小到看不清，
 * 只剩一个灰方块 —— 那是"文档感"的元凶。这里只取信息密度最高的一段：
 * 规则名 + 严重级别 + 所在文件 + 原文摘录，四列齐全，放大后每一列都读得清。
 *
 * 规则名来自真实规则集（调用方从 REVIEW_RULES 传入），摘录是示例 ——
 * 整块仍需标注「示例数据」。
 */
export function ReportFragment({
  rows,
}: {
  rows: readonly { rule: string; status: Status; file: string; excerpt: string }[];
}) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-2.5">
        <span className="text-xs font-medium text-ink-800">审核报告 · 发现清单</span>
        <span className="text-[11px] text-ink-400">按严重级别排序</span>
      </div>

      <ul className="divide-y divide-ink-100">
        {rows.map((row) => (
          <li key={row.rule} className="flex items-start gap-3 px-4 py-2.5">
            <span
              className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                row.status === "fail"
                  ? "bg-danger-600"
                  : row.status === "warn"
                    ? "bg-warning-600"
                    : "bg-success-600"
              }`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="text-xs font-medium text-ink-800">{row.rule}</span>
                <span className="text-[11px] text-ink-400">{row.file}</span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] leading-5 text-ink-500">
                {row.excerpt}
              </p>
            </div>
            <StatusPill status={row.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 破形浮层：从主界面上"弹"出来的小卡片。
 *
 * 4px 白边 + 2xl 阴影是刻意的 —— 白边让它和底下的界面彻底分离，
 * 重阴影提供 Z 轴高度。小屏下不做绝对定位（会溢出破版），改为堆叠在主卡下方。
 */
export function FloatCard({
  tone,
  icon,
  title,
  detail,
  className = "",
}: {
  tone: "danger" | "success";
  icon: IconName;
  title: string;
  detail: string;
  className?: string;
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-100 text-danger-600"
      : "border-emerald-100 text-success-600";

  return (
    <div
      className={`card w-56 border-4 border-white shadow-2xl ${toneClass} ${className}`}
    >
      <div className="flex items-start gap-2 p-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
            tone === "danger" ? "bg-red-50 text-danger-600" : "bg-emerald-50 text-success-600"
          }`}
          aria-hidden="true"
        >
          <Icon name={icon} className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink-900">{title}</p>
          <p className="mt-0.5 text-[11px] leading-4 text-ink-500">{detail}</p>
        </div>
      </div>
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
    <div className="card overflow-hidden">
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
