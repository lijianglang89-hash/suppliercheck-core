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

import { SAMPLE_REPORT, type SampleFinding } from "@/lib/content/sample-report";
import { SEVERITY_BADGE_CLASS, SEVERITY_LABELS } from "@/lib/reviews/labels";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { isBlocking, SEVERITY_RANK, type Severity } from "@/lib/reviews/types";
import { Icon, type IconName } from "@/components/ui/icons";

/**
 * 维度级状态。**注意措辞**：这里描述的是"这一维度本次有没有查出需要看的点"，
 * 不是"资料是否合格"—— 所以一律用**动作提示 + 无发现**，
 * 不写「通过 / 待确认 / 问题」这类逐项结论（docs/DESIGN.md §0 硬规则 1：
 * 系统只输出发现，从不输出「通过」）。
 *
 * 枚举名也不叫 `pass`：叫 `clear` 是"本次没命中规则"这个事实，
 * 而不是"判定为通过"。名字会诱导后来者把文案写回「通过」。
 *
 * 配色同理：`clear` 刻意**不用 success 绿** —— 绿徽章在这一屏会被读成"通过"，
 * 改用中性灰，让它看起来只是"没有东西要处理"。
 */
type CheckStatus = "clear" | "review" | "action";

/** 导出给单测：这一层文案是被硬规则约束的，必须能被守卫盯住。 */
export const STATUS_STYLE: Record<CheckStatus, { label: string; className: string }> = {
  clear: { label: "无发现", className: "bg-ink-100 text-ink-600" },
  review: { label: "需确认", className: "bg-warning-600/10 text-warning-600" },
  action: { label: "需处理", className: "bg-danger-600/10 text-danger-600" },
};

export function StatusPill({ status }: { status: CheckStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${style.className}`}
    >
      {style.label}
    </span>
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
    status: CheckStatus;
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
/* ------------------------------------------------------------------ */
/* 真实产品界面：审核工作台                                            */
/* ------------------------------------------------------------------ */

/**
 * 严重级别徽章 —— 直接用报告页那套配色与中文标签，不另起一套。
 *
 * 页面上的「严重 / 高 / 中 / 低 / 提示」必须和真实报告里的一模一样，
 * 否则客户照示例去跑真实资料，措辞对不上就是欺骗。
 */
export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_BADGE_CLASS[severity]}`}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

/**
 * 工作台顶部的真实数字条。
 *
 * ⭐ 这里**刻意没有「通过 N 项」**。
 * 本系统只在规则命中时产生发现，不产出「某份资料已通过」的正面结论 ——
 * 编一个「8 项通过」出来，等于替系统宣布它从不宣布的事情。
 * 所以四个数字全部是**真实可算**的量：资料数、纳入核对数、正文字符数、已执行规则数。
 */
export function WorkspaceMetrics({
  documentCount,
  readableDocumentCount,
  totalCharacters,
  ruleCount,
  findingCount,
  blockingCount,
}: {
  documentCount: number;
  readableDocumentCount: number;
  totalCharacters: number;
  ruleCount: number;
  findingCount: number;
  blockingCount: number;
}) {
  const cells = [
    { value: documentCount, label: "份资料" },
    { value: readableDocumentCount, label: "份纳入核对" },
    { value: totalCharacters.toLocaleString("zh-CN"), label: "字符正文" },
    { value: ruleCount, label: "条规则已执行" },
  ];

  return (
    <div className="border-b border-ink-100 bg-ink-50/60">
      <dl className="grid grid-cols-2 divide-x divide-ink-100 sm:grid-cols-4">
        {cells.map((cell) => (
          <div key={cell.label} className="px-3 py-2">
            <dt className="text-[10px] leading-4 text-ink-400">{cell.label}</dt>
            <dd className="text-sm font-semibold tabular-nums text-ink-900">{cell.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-100 px-3 py-1.5">
        <span className="text-[11px] text-ink-500">
          发现 <span className="font-semibold tabular-nums text-ink-900">{findingCount}</span> 条
        </span>
        <span aria-hidden="true" className="text-ink-300">
          ·
        </span>
        <span className="text-[11px] text-ink-500">
          阻断 <span className="font-semibold tabular-nums text-danger-600">{blockingCount}</span>{" "}
          条（严重 + 高）
        </span>
      </div>
    </div>
  );
}

/**
 * 一条发现：规则 → 严重级别 → 所在资料 → 原文摘录。
 *
 * 四列齐全是这个产品的全部说服力所在 ——
 * 只写「存在风险」谁都会写，附上在哪份资料的哪句话里才算证据。
 */
function FindingItem({
  finding,
  dense = false,
}: {
  finding: SampleFinding;
  dense?: boolean;
}) {
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5">
      <SeverityBadge severity={finding.severity} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium leading-5 text-ink-900">{finding.title}</p>
        {!dense && (
          <p className="mt-0.5 text-[11px] leading-5 text-ink-500">{finding.detail}</p>
        )}
        {finding.evidence ? (
          <p className="mt-1 truncate rounded bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] leading-4 text-ink-600">
            {finding.evidence}
          </p>
        ) : (
          <p className="mt-1 text-[10px] leading-4 text-ink-400">
            {finding.documentLabel ? "该资料无文字层，无摘录可附" : "缺失类发现：资料包中没有对应文件"}
          </p>
        )}
      </div>
      <span className="shrink-0 text-[10px] leading-4 text-ink-400">
        {finding.documentLabel || "—"}
      </span>
    </li>
  );
}

/**
 * 首屏用的审核工作台（纵向密实版）。
 *
 * ⭐ 数据源是 `SAMPLE_REPORT` —— 与 `/sample-report` 页面**同一份**，
 * 且被 `tests/unit/sample-report.test.ts` 钉死在真实规则上
 * （ruleId 必须存在、类别与严重级别必须等于规则的真实定义）。
 * 也就是说：首屏展示的不是"画出来的界面"，而是这个引擎真会输出的东西。
 *
 * 排序用 `SEVERITY_RANK`，与引擎 `sortFindings` 的第一级一致 ——
 * 客户在首屏看到的顺序，就是他自己在报告里看到的顺序。
 */
export function ReviewWorkspacePreview({ limit = 5 }: { limit?: number }) {
  const findings = [...SAMPLE_REPORT.findings]
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, limit);

  const blockingCount = SAMPLE_REPORT.findings.filter((finding) =>
    isBlocking(finding.severity),
  ).length;

  return (
    <div className="overflow-hidden rounded-lg border border-ink-200 bg-white shadow-[0_16px_40px_rgba(23,44,70,0.10)]">
      {/* 顶部条：主体、模板、状态、判定基准日 —— 真实报告页有同样四样 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-brand-600/10 text-brand-700">
            <Icon name="building" className="h-4 w-4" />
          </span>
          <span className="truncate text-sm font-semibold text-ink-900">
            {SAMPLE_REPORT.supplierName}
          </span>
          {/*
            「审核完成」说的是**流程跑完了**，不是"这份资料通过了" ——
            所以底色用品牌蓝而非 success 绿（绿徽章紧跟公司名，会被读成合格标记）。
          */}
          <span className="shrink-0 rounded bg-brand-600/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
            审核完成
          </span>
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-ink-400">
          {SAMPLE_REPORT.templateName} · 基准日 {SAMPLE_REPORT.baseDate}
        </span>
      </div>

      <WorkspaceMetrics
        documentCount={SAMPLE_REPORT.documentCount}
        readableDocumentCount={SAMPLE_REPORT.readableDocumentCount}
        totalCharacters={SAMPLE_REPORT.totalCharacters}
        ruleCount={REVIEW_RULES.length}
        findingCount={SAMPLE_REPORT.findings.length}
        blockingCount={blockingCount}
      />

      <ul className="divide-y divide-ink-100">
        {findings.map((finding) => (
          <FindingItem key={finding.id} finding={finding} dense />
        ))}
      </ul>

      <div className="flex items-center justify-between gap-2 border-t border-ink-100 bg-ink-50/60 px-3 py-2">
        <span className="text-[10px] leading-4 text-ink-400">
          示例数据 · 与「查看示例报告」看到的是同一份
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-ink-400">
          {findings.length} / {SAMPLE_REPORT.findings.length} 条
        </span>
      </div>
    </div>
  );
}

/** 资料解析状态：真实状态机的四个值，一个不多一个不少。 */
const DOC_STATES = ["UPLOADED", "PROCESSING", "READY", "FAILED"] as const;
type DocState = (typeof DOC_STATES)[number];

const DOC_STATE_STYLE: Record<DocState, string> = {
  UPLOADED: "bg-ink-100 text-ink-500",
  PROCESSING: "bg-brand-50 text-brand-700",
  READY: "bg-success-600/10 text-success-600",
  FAILED: "bg-danger-600/10 text-danger-600",
};

function DocStatePill({ state }: { state: DocState }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${DOC_STATE_STYLE[state]}`}
    >
      {state}
    </span>
  );
}

/**
 * 资料清单 + 解析状态（工作台左栏）。
 *
 * 状态值用的是**真实枚举**（UPLOADED / PROCESSING / READY / FAILED），
 * 不写「已解析 / 已完成」这类自己造的词 —— 客户在界面上看到的就是这四个英文值。
 */
export function DocumentPane({
  files,
}: {
  files: readonly { name: string; ext: string; state: DocState }[];
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-ink-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
        <span className="text-xs font-semibold text-ink-900">供应商资料</span>
        <span className="text-[10px] tabular-nums text-ink-400">{files.length} 份</span>
      </div>
      <ul className="flex-1 divide-y divide-ink-100">
        {files.map((file) => (
          <li key={file.name} className="flex items-center gap-2 px-3 py-2">
            <span className="inline-flex h-5 w-7 shrink-0 items-center justify-center rounded bg-brand-600/10 text-[9px] font-semibold uppercase text-brand-700">
              {file.ext}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-ink-700">{file.name}</span>
            <DocStatePill state={file.state} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 审核结果（工作台右栏）—— 按严重级别排序，与真实报告页一致。
 *
 * 分组标题用的是真实中文级别名（严重 / 高 / 中 / 低 / 提示），
 * 不是「CRITICAL / HIGH」生硬堆砌 —— 但级别徽章保留英文枚举的对应关系，
 * 因为客户在自己那份报告里看到的就是这套词。
 */
export function FindingsPane({ findings }: { findings: readonly SampleFinding[] }) {
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );

  return (
    <div className="flex h-full flex-col rounded-lg border border-ink-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
        <span className="text-xs font-semibold text-ink-900">审核结果</span>
        <span className="text-[10px] text-ink-400">按严重级别排序</span>
      </div>
      <ul className="flex-1 divide-y divide-ink-100">
        {sorted.map((finding) => (
          <FindingItem key={finding.id} finding={finding} />
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 状态机与失败态                                                      */
/* ------------------------------------------------------------------ */

/**
 * 四个真实状态横排 —— 让「出错以后怎么办」在页面上有一个答案。
 *
 * 为什么要把 FAILED 摆出来：只展示成功路径的落地页，
 * 等于默认告诉客户「这系统不会失败」，而任何一个真实系统都会失败。
 * 敢把失败态放在首页，是"这是个真东西"的最强信号之一。
 */
export function StateStrip({ active = "READY" }: { active?: DocState }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DOC_STATES.map((state, index) => {
          const isActive = state === active;
          return (
            <div
              key={state}
              className={`rounded-md border px-2 py-1.5 ${
                isActive ? "border-brand-300 bg-brand-50" : "border-ink-200 bg-ink-50/60"
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="font-mono text-[10px] font-semibold text-ink-700">{state}</span>
                {index < DOC_STATES.length - 1 && (
                  <span aria-hidden="true" className="hidden text-[10px] text-ink-300 sm:block">
                    →
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 失败态卡片。
 *
 * 场景取自真实测试：`tests/integration/archive-expansion.test.ts` 里
 * 一个含 .exe 的压缩包会被拒绝 —— 「压缩包包含不允许的文件类型」是系统真会说的话，
 * 不是为了让页面好看编出来的错误示例。
 */
export function FailurePanel() {
  return (
    <div className="rounded-lg border border-danger-600/25 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-danger-600/15 bg-danger-600/5 px-3 py-2">
        <span className="flex items-center gap-2">
          <span className="text-danger-600" aria-hidden="true">
            <Icon name="alert-triangle" className="h-4 w-4" />
          </span>
          <span className="font-mono text-[11px] font-semibold text-danger-600">FAILED</span>
          <span className="text-xs font-medium text-ink-900">供应商资料包解析失败</span>
        </span>
        <span className="text-[10px] tabular-nums text-ink-400">作业已记录原因</span>
      </div>

      <dl className="divide-y divide-ink-100">
        <div className="flex gap-3 px-3 py-2">
          <dt className="shrink-0 text-[11px] text-ink-400">原因</dt>
          <dd className="text-xs leading-5 text-ink-700">压缩包包含不允许的文件类型</dd>
        </div>
        <div className="flex gap-3 px-3 py-2">
          <dt className="shrink-0 text-[11px] text-ink-400">系统行为</dt>
          <dd className="text-xs leading-5 text-ink-700">
            父文档被标记为 FAILED 并记录原因，已展开出的资料保留可用
          </dd>
        </div>
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 边界与可追溯性                                                      */
/* ------------------------------------------------------------------ */

/**
 * 「能确定什么 / 不能确定什么」对照板。
 *
 * 这一块是本页**可信度**的核心：绝大多数工具只说前半句，
 * 而采购/风控岗位真正要判断的是后半句 —— 系统在哪些地方会保持沉默。
 *
 * 右栏的示例是真实规则 `CERTIFICATE_EXPIRY_UNKNOWN` 的真实行为：
 * 正文里写「报价有效期：30 个自然日」但没有可解析的截止日时，
 * 系统报 LOW「有效期无法判定」，**不做推算**。
 */
export function BoundaryPanel() {
  const canDetermine = [
    "已识别出的统一社会信用代码及其校验位",
    "已解析到的证书有效期截止日",
    "资料包中实际存在的文件",
    "规则命中与否（同一份资料两次结果一致）",
  ];
  const cannotDetermine = [
    {
      quote: "报价有效期：30 个自然日",
      reason: "只有相对期限，没有起始日与截止日",
      ruleId: "CERTIFICATE_EXPIRY_UNKNOWN",
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/*
        标题必须带主语。「可以确定」单看会被读成"这份资料可以确定（没问题）"，
        而它真正说的主语是**系统**：这一类信息系统能给出确定答案。
        配色也一并收窄：绿色对勾只用于"确实能给出答案"，不用来暗示资料合格。
      */}
      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-brand-600/10 text-brand-700">
            <Icon name="check" className="h-3.5 w-3.5" />
          </span>
          <h3 className="text-sm font-semibold text-ink-900">系统能确定的</h3>
        </div>
        <ul className="mt-3 space-y-2">
          {canDetermine.map((item) => (
            <li key={item} className="flex gap-2 text-xs leading-6 text-ink-700">
              <span aria-hidden="true" className="text-brand-600">
                ✓
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-warning-600/25 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-warning-600/10 text-warning-600">
            <Icon name="alert-triangle" className="h-3.5 w-3.5" />
          </span>
          <h3 className="text-sm font-semibold text-ink-900">无法判定（不会猜）</h3>
        </div>
        <ul className="mt-3 space-y-3">
          {cannotDetermine.map((item) => (
            <li key={item.ruleId}>
              <p className="rounded bg-ink-50 px-2 py-1 font-mono text-[11px] leading-5 text-ink-700">
                {item.quote}
              </p>
              <p className="mt-1.5 text-xs leading-6 text-ink-600">{item.reason}</p>
              <p className="mt-1 flex items-center gap-1.5">
                <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-600">
                  {item.ruleId}
                </span>
                <span className="text-[10px] text-ink-400">报「有效期无法判定」，不推算日期</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * RULE → EVIDENCE → FINDING 三节点。
 *
 * 「可追溯」如果只写成一句形容词，客户无从验证；
 * 把链条的三个实体摆出来，他就能在自己那份报告里逐项对上。
 */
export function RuleEvidenceFinding({ dark = false }: { dark?: boolean }) {
  const nodes = [
    { tag: "RULE", title: "规则", detail: "15 条规则，启用哪几条由模板决定" },
    { tag: "EVIDENCE", title: "证据", detail: "所在资料 + 原文摘录，缺失类发现没有摘录" },
    { tag: "FINDING", title: "发现", detail: "严重级别 + 判据 + 建议，按级别排序" },
  ];

  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {nodes.map((node, index) => (
        <li
          key={node.tag}
          className={`relative rounded-lg border px-3 py-2.5 ${
            dark ? "border-white/10 bg-white/5" : "border-ink-200 bg-white"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                dark ? "bg-white/15 text-white" : "bg-brand-600/10 text-brand-700"
              }`}
            >
              {node.tag}
            </span>
            <span className={`text-xs font-semibold ${dark ? "text-white" : "text-ink-900"}`}>
              {node.title}
            </span>
            {index < nodes.length - 1 && (
              <span
                aria-hidden="true"
                className={`ml-auto hidden text-[11px] sm:block ${dark ? "text-white/40" : "text-ink-300"}`}
              >
                →
              </span>
            )}
          </div>
          <p className={`mt-1.5 text-[11px] leading-5 ${dark ? "text-white/60" : "text-ink-500"}`}>
            {node.detail}
          </p>
        </li>
      ))}
    </ol>
  );
}
