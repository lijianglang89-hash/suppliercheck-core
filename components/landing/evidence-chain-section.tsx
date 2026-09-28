import Link from "next/link";

import { SeverityBadge } from "@/components/landing/visuals";
import { SAMPLE_REPORT } from "@/lib/content/sample-report";
import { RULE_BY_ID } from "@/lib/reviews/rules";
import type { RuleId } from "@/lib/reviews/types";
import { Reveal } from "@/components/ui/reveal";

/**
 * 证据链区块（首页 `#evidence`）—— V2.0 的三处视觉高潮之一。
 *
 * 这一区要回答的是整个产品最难解释、也最值钱的一件事：
 * **「系统凭什么这么说」。**
 *
 * 做法是把一条真实发现拆成三段摊开：规则 → 证据 → 发现，中间不加修饰。
 * 数据全部来自 `SAMPLE_REPORT`（同一份数据也渲染在 /sample-report，
 * 并由 tests/unit/sample-report.test.ts 钉死在真实规则定义上）。
 *
 * ⭐ 刻意保留的第二种形态：**没有摘录的发现**。缺失类发现（必备资料缺失）
 * 本来就没有原文可摘 —— 硬凑一段"相关片段"会让摘录从证据退化成装饰。
 * 同理保留「有摘录但判不了」（相对期限 30 个自然日）——
 * 有内容却不推算是这套系统的定性特征，值得单独展示。
 */
function pickFinding(ruleId: RuleId) {
  const finding = SAMPLE_REPORT.findings.find((item) => item.ruleId === ruleId);
  if (!finding) {
    throw new Error(`示例报告里缺少 ${ruleId} 的示例发现 —— 证据链区块依赖它`);
  }
  return finding;
}

const PRIMARY = pickFinding("CERTIFICATE_EXPIRED");

/** 证据的三种真实形态。顺序按「最常见 → 最容易被误读」排。 */
const EVIDENCE_FORMS: ReadonlyArray<{
  ruleId: RuleId;
  heading: string;
  note: string;
}> = [
  {
    ruleId: "CERTIFICATE_EXPIRED",
    heading: "有原文摘录",
    note: "最常见：从正文里截出判据所在的短片段，可回原文核对。",
  },
  {
    ruleId: "REQUIRED_DOCUMENT_MISSING",
    heading: "没有摘录",
    note: "缺失类发现本来就没有原文可摘。留空，不凑一段相关文字充数。",
  },
  {
    ruleId: "CERTIFICATE_EXPIRY_UNKNOWN",
    heading: "有摘录，但结论是「判不了」",
    note: "写的是相对期限（30 个自然日）而非截止日期。如实报不判定，不做推算。",
  },
];

export function EvidenceChainSection() {
  const rule = RULE_BY_ID.get(PRIMARY.ruleId);

  return (
    <section
      id="evidence"
      aria-labelledby="evidence-heading"
      className="scroll-mt-16 border-b border-ink-200 bg-band"
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
          证据链
        </p>
        <h2
          id="evidence-heading"
          className="mt-3 text-2xl font-semibold tracking-tight text-ink-900 lg:text-3xl"
        >
          每一条结论，都能顺着证据找回原文
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-600">
          报告里不会出现「存在风险」这种没有出处的话。下面是示例报告里的一条真实发现，
          按它本来的样子拆开：先是哪条规则命中，再是命中的原文，最后才是结论。
        </p>

        <Reveal className="mt-10">
          <div className="card p-6 lg:p-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-sm font-semibold text-ink-900">
                示例发现 · {SAMPLE_REPORT.supplierName}
              </p>
              <p className="text-xs text-ink-500">
                判定基准日 {SAMPLE_REPORT.baseDate} · 模板「{SAMPLE_REPORT.templateName}」
              </p>
            </div>

            <div className="mt-6 grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
              {/* 第一段：规则 */}
              <div className="rounded-lg border border-ink-200 bg-white p-4">
                <p className="font-mono text-[10px] font-semibold tracking-wider text-brand-700">
                  ① RULE
                </p>
                <p className="mt-2 font-mono text-[11px] text-ink-500">{PRIMARY.ruleId}</p>
                <p className="mt-1 text-sm font-semibold text-ink-900">{rule?.label}</p>
                <p className="mt-2 text-xs leading-5 text-ink-600">{rule?.description}</p>
              </div>

              <Arrow />

              {/* 第二段：证据 */}
              <div className="rounded-lg border border-ink-200 bg-white p-4">
                <p className="font-mono text-[10px] font-semibold tracking-wider text-brand-700">
                  ② EVIDENCE
                </p>
                <p className="mt-2 text-xs font-medium text-ink-500">所在资料</p>
                <p className="text-sm font-medium text-ink-900">{PRIMARY.documentLabel}</p>
                <p className="mt-3 text-xs font-medium text-ink-500">原文摘录</p>
                <p className="mt-1 rounded bg-ink-50 px-2 py-1.5 font-mono text-[11px] leading-5 text-ink-800">
                  {PRIMARY.evidence}
                </p>
                <p className="mt-2 text-[11px] leading-5 text-ink-500">
                  摘录由解析器从正文中截取，长度受上限约束，不整段搬运。
                </p>
              </div>

              <Arrow />

              {/* 第三段：发现 */}
              <div className="rounded-lg border border-ink-200 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[10px] font-semibold tracking-wider text-brand-700">
                    ③ FINDING
                  </p>
                  <SeverityBadge severity={PRIMARY.severity} />
                </div>
                <p className="mt-2 text-sm font-semibold text-ink-900">{PRIMARY.title}</p>
                <p className="mt-2 text-xs leading-5 text-ink-600">{PRIMARY.detail}</p>
                <p className="mt-3 border-t border-ink-100 pt-3 text-xs leading-5 text-ink-600">
                  <span className="font-medium text-ink-800">建议：</span>
                  {PRIMARY.recommendation}
                </p>
              </div>
            </div>

            <p className="mt-6 border-t border-ink-100 pt-4 text-xs leading-5 text-ink-500">
              以上为示例数据（主体名、日期、金额均为虚构），不代表任何真实审核结果。
              <Link
                href="/sample-report"
                className="ml-1 font-medium text-brand-700 hover:underline"
              >
                查看完整示例报告 →
              </Link>
            </p>
          </div>
        </Reveal>

        <h3 className="mt-12 text-base font-semibold text-ink-900">
          证据不止一种形态 —— 我们把三种都摆出来
        </h3>
        <ul className="mt-5 grid gap-4 lg:grid-cols-3">
          {EVIDENCE_FORMS.map((form, index) => {
            const finding = SAMPLE_REPORT.findings.find((item) => item.ruleId === form.ruleId);
            if (!finding) return null;
            return (
              <Reveal
                as="li"
                key={form.ruleId}
                delayMs={index * 60}
                className="card flex flex-col p-5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-900">{form.heading}</p>
                  <SeverityBadge severity={finding.severity} />
                </div>
                <p className="mt-2 font-mono text-[10px] text-ink-500">{finding.ruleId}</p>
                <p className="mt-1 text-sm font-medium text-ink-800">{finding.title}</p>
                {finding.evidence ? (
                  <p className="mt-3 rounded bg-ink-50 px-2 py-1.5 font-mono text-[11px] leading-5 text-ink-700">
                    {finding.evidence}
                  </p>
                ) : (
                  <p className="mt-3 rounded border border-dashed border-ink-300 px-2 py-1.5 text-[11px] leading-5 text-ink-500">
                    无原文摘录（该项资料本身缺失）
                  </p>
                )}
                <p className="mt-auto pt-4 text-xs leading-5 text-ink-500">{form.note}</p>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** 段与段之间的连接箭头。窄屏竖排时转向下。 */
function Arrow() {
  return (
    <div className="flex items-center justify-center text-ink-300" aria-hidden="true">
      <span className="rotate-90 text-lg leading-none lg:rotate-0">→</span>
    </div>
  );
}
