/**
 * 审核工作台展示区 —— 首页第二个核心视觉资产。
 *
 * ⭐ 这一版从「一张小面板 + 一个浮动标签」升级成**完整双栏工作台**：
 *   左栏 = 供应商资料（文件 + 类型 + 解析状态）
 *   右栏 = 审核结果（按严重级别排序的发现明细）
 *
 * 为什么必须双栏铺满：B2B 客户判断"这是不是真东西"，靠的是**信息密度** ——
 * 一份只显示 4 行摘要的面板，和一张 PPT 里的示意图没有区别；
 * 把资料清单、解析状态、8 条发现、原文摘录同时摆出来，才读得出这是个软件。
 *
 * ⭐ 数据源 = `SAMPLE_REPORT`，与 `/sample-report` 页面**同一份**，
 * 且被 `tests/unit/sample-report.test.ts` 钉死在真实规则与真实数量关系上。
 * 公司名是中性名（示例科技），不指向任何真实企业。
 */
import Link from "next/link";

import { DocumentPane, FindingsPane, WorkspaceMetrics } from "@/components/landing/visuals";
import { Icon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";
import { SAMPLE_REPORT } from "@/lib/content/sample-report";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { isBlocking } from "@/lib/reviews/types";

/** 三条卖点全部来自已实现的能力，不写「一键导出」「团队协作」这类没有的功能。 */
const SELL_POINTS = [
  "每条发现按严重级别排序，阻断项（严重 + 高）单独计数",
  "附所在资料与原文摘录，可回原文逐条核对",
  "同一份资料跑两次结果一致，可复算",
] as const;

export function ReportSection() {
  const blockingCount = SAMPLE_REPORT.findings.filter((finding) => isBlocking(finding.severity))
    .length;

  return (
    <section aria-labelledby="report-heading" className="border-b border-ink-200 bg-band-alt">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            <Icon name="file-check" className="h-3.5 w-3.5" />
            审核工作台 · 资料与结果并排
          </span>

          <h2
            id="report-heading"
            className="mt-5 text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.2] tracking-tight text-ink-900"
          >
            一份资料包，
            <br className="hidden sm:block" />
            产出<span className="text-brand-700">逐条可追溯</span>的问题清单
          </h2>

          <p className="mt-4 max-w-3xl text-sm leading-7 text-ink-600">
            审核员不用回头翻文件，就能判断这条是不是真问题 ——
            每条发现都带严重级别、所在资料和原文摘录。
          </p>
        </Reveal>

        {/*
          工作台整块横铺（不再塞进 60% 栏里缩着看）：
          上方是真实数字条，下方左资料 / 右结果。
          小屏自动退回上下堆叠，资料清单在上、结果在下（阅读顺序即流程顺序）。
        */}
        <Reveal className="mt-10" delayMs={120}>
          <div className="overflow-hidden rounded-lg border border-ink-200 bg-white shadow-[0_16px_40px_rgba(23,44,70,0.10)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-brand-600/10 text-brand-700">
                  <Icon name="building" className="h-4 w-4" />
                </span>
                <span className="truncate text-sm font-semibold text-ink-900">
                  {SAMPLE_REPORT.supplierName}
                </span>
                {/* 「审核完成」= 流程跑完了，不是"资料合格"，所以不用 success 绿。 */}
                <span className="shrink-0 rounded bg-brand-600/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
                  审核完成
                </span>
              </div>
              <span className="shrink-0 text-[10px] tabular-nums text-ink-400">
                {SAMPLE_REPORT.templateName} · 判定基准日 {SAMPLE_REPORT.baseDate}
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

            {/*
              min-w-0 是必需的，不是装饰：
              grid item 默认 min-width:auto —— 窄屏单列时，轨道会被内容的
              min-content 宽度顶开（实测 390 视口下撑到 382px，而可用宽度只有 308px），
              父级的 overflow-hidden 再把多出来的部分直接裁掉，
              表现为"没有横向滚动条，但右侧内容缺一块"。
              加了 min-w-0 之后轨道才允许被压到 0，交给内部的 truncate 去省略。
            */}
            <div className="grid gap-4 p-4 lg:grid-cols-5">
              <div className="min-w-0 lg:col-span-2">
                <DocumentPane files={SAMPLE_REPORT.documents} />
              </div>
              <div className="min-w-0 lg:col-span-3">
                <FindingsPane findings={SAMPLE_REPORT.findings} />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 bg-ink-50/60 px-4 py-2.5">
              <span className="text-[11px] leading-5 text-ink-500">
                示例数据 · 与 <span className="text-ink-700">/sample-report</span>{" "}
                页面看到的是同一份，公司名与内容均为虚构
              </span>
              <Link
                href="/sample-report"
                className="shrink-0 text-[11px] font-medium text-brand-700 hover:text-brand-800"
              >
                查看完整示例报告 →
              </Link>
            </div>
          </div>
        </Reveal>

        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <Reveal>
            <ul className="space-y-3">
              {SELL_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm leading-6 text-ink-700">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"
                    aria-hidden="true"
                  >
                    <Icon name="check" className="h-3 w-3" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delayMs={120}>
            {/*
              覆盖度说明是真实报告的一部分 —— 它回答的是"这次结论是在多少资料上得出的"。
              把它露出来，等于主动告诉客户：有一份扫描件没能参与核对。
              这种自曝其短，正是让其余结论可信的原因。
            */}
            <div className="rounded-lg border border-ink-200 bg-white p-4">
              <p className="text-xs font-semibold text-ink-900">覆盖度说明（真实报告里也有）</p>
              <ul className="mt-2 space-y-1.5">
                {SAMPLE_REPORT.coverageNotes.map((note) => (
                  <li key={note} className="text-[11px] leading-5 text-ink-600">
                    · {note}
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-4 border-l-2 border-brand-300 pl-3 text-xs leading-6 text-ink-500">
              判定权始终在人手里：系统负责把可疑点找出来并给出证据，
              不替企业判定供应商是否合格。
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
