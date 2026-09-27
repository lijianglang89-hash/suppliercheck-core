/**
 * 审核结果展示区 —— 首页第二个核心视觉资产（Z 字第一拍：左文 40% / 右 UI 60%）。
 *
 * ⚠️ 全部内容是**示例**。用中性名（示例科技 / 远方工程），不用任何真实企业名，
 * 也不写真实客户名 —— 一旦把造出来的案例放进页面，它就变成了假证据。
 *
 * 「灵魂」的来源：右侧 UI 卡片下方垫了一层品牌色弥散光（bg-brand-500/15 + blur-3xl），
 * 加投影用深色区同色系（rgba(23,44,70,…)）—— 光影让卡片悬浮，不是让颜色乱飞。
 * 刻意不用 backdrop-blur：白底上没有可模糊的东西，写了也看不出来。
 */

import { FileStack, FloatCard, FlowArrow, ResultPanel } from "@/components/landing/visuals";
import { Icon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";
import { REVIEW_RULES } from "@/lib/reviews/rules";

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

/** 三条卖点全部来自已实现的能力，不写「一键导出」「团队协作」这类没有的功能。 */
const SELL_POINTS = [
  "每条发现按严重级别排序，阻断项单独提示",
  "附所在文件与原文摘录，可回原文逐条核对",
  "同一份资料跑两次结果一致，可复算",
] as const;

export function ReportSection() {
  return (
    <section aria-labelledby="report-heading" className="border-b border-ink-200 bg-band-alt">
      <div className="mx-auto w-full max-w-6xl px-6 py-24 lg:py-28">
        <div className="grid items-center gap-14 lg:grid-cols-5 lg:gap-10">
          {/* 左 40%：文案 */}
          <Reveal className="lg:col-span-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
              <Icon name="file-check" className="h-3.5 w-3.5" />
              审核报告 · 问题清单 + 原文摘录
            </span>

            <h2
              id="report-heading"
              className="mt-5 text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.2] tracking-tight text-ink-900"
            >
              一份资料包，
              <br className="hidden sm:block" />
              快速找出<span className="text-brand-700">关键问题</span>
            </h2>

            <p className="mt-4 text-sm leading-7 text-ink-600">
              审核员不用回头翻文件，就能判断这条是不是真问题 ——
              每条发现都带严重级别、所在文件和原文摘录。
            </p>

            <ul className="mt-6 space-y-3">
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

            <p className="mt-6 border-l-2 border-brand-300 pl-3 text-xs leading-6 text-ink-500">
              判定权始终在人手里：系统负责把可疑点找出来并给出证据，
              不替企业判定供应商是否合格。
            </p>
          </Reveal>

          {/* 右 60%：UI 面板（弥散光 + 品牌色投影） */}
          <Reveal className="relative lg:col-span-3" delayMs={120}>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-6 rounded-3xl bg-brand-500/15 blur-3xl"
            />
            <div className="card relative p-5 shadow-[0_16px_40px_rgba(23,44,70,0.10)]">
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
              <p className="mb-2 text-center text-[11px] text-ink-400">
                {REVIEW_RULES.length} 条规则逐条核对
              </p>

              <ResultPanel summary={{ pass: 14, warn: 3, fail: 1 }} rows={DEMO_ROWS} />

              <p className="mt-3 text-[11px] leading-5 text-ink-400">
                以上为界面示意，公司名与发现条数均为示例，不代表任何真实审核结果。
              </p>
            </div>

            {/* 破形小浮层：向右下溢出的状态标签，与首屏同语言（Alert Card 三层结构） */}
            <FloatCard
              tone="danger"
              icon="alert-triangle"
              title="阻断项 1 条"
              subject="建议先让供应商补正资料"
              className="mt-3 lg:absolute lg:-bottom-8 lg:-right-6 lg:mt-0"
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
