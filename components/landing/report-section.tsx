/**
 * 审核结果展示区 —— 首页第二个核心视觉资产。
 *
 * ⚠️ 全部内容是**示例**。用中性名（示例科技 / 远方工程），不用任何真实企业名，
 * 也不写真实客户名 —— 一旦把造出来的案例放进页面，它就变成了假证据。
 */

import { FileStack, FlowArrow, ResultPanel } from "@/components/landing/visuals";

const DEMO_FILES = [
  { name: "营业执照", ext: "pdf" },
  { name: "ISO9001 证书", ext: "pdf" },
  { name: "检测报告", ext: "pdf" },
  { name: "报价单", ext: "xlsx" },
  { name: "开户资料", ext: "pdf" },
] as const;

const DEMO_ROWS = [
  { label: "营业执照", status: "pass", note: "在有效期内，代码校验通过" },
  { label: "ISO9001 证书", status: "warn", note: "42 天后到期" },
  { label: "开户资料", status: "warn", note: "主体名称与营业执照不一致" },
  { label: "检测报告", status: "fail", note: "资料包中未找到" },
] as const;

export function ReportSection() {
  return (
    <section aria-labelledby="report-heading" className="border-b border-ink-200 bg-brand-tint">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 id="report-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
              一份资料包，快速找出关键问题
            </h2>
            <p className="mt-4 text-sm leading-6 text-ink-600">
              每条发现都带严重级别、所在文件和原文摘录 ——
              审核员不用回头翻文件，就能判断这条是不是真问题。
            </p>
            <p className="mt-6 text-xs leading-5 text-ink-500">
              判定权始终在人手里：系统负责把可疑点找出来并给出证据，不替企业判定供应商是否合格。
            </p>
          </div>

          <div className="rounded-lg border border-ink-200 bg-white p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold text-ink-900">示例科技有限公司</p>
              <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-500">
                示例数据
              </span>
            </div>

            <div className="mt-4">
              <FileStack files={DEMO_FILES} />
            </div>

            <FlowArrow />
            <p className="mb-2 text-center text-[11px] text-ink-400">15 条规则逐条核对</p>

            <ResultPanel summary={{ pass: 14, warn: 3, fail: 1 }} rows={DEMO_ROWS} />

            <p className="mt-3 text-[11px] leading-5 text-ink-400">
              以上为界面示意，公司名与发现条数均为示例，不代表任何真实审核结果。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
