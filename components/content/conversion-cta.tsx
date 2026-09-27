import Link from "next/link";

import { Icon } from "@/components/ui/icons";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { siteConfig } from "@/lib/site";

/**
 * 内容页底部的转化卡。
 *
 * 文案纪律（比"有冲击力"更重要）：
 * - **不写耗时数字。**「30 秒出报告」这种话没有实测支撑，写上去就是一个可证伪的承诺 ——
 *   客户自己跑一次发现要 3 分钟，整页的可信度一起塌。只说"上传资料包后自动核对"，
 *   这是已实现的能力。
 * - **不写"一键导出""团队协作"这类不存在的功能。** 转化靠的是"你已经看懂了清单，
 *   而系统就是按这份清单在查" —— 咬合感比形容词有用。
 * - **边界必须一起说。** 系统给证据、不下合格判定，这句话在转化区也要出现：
 *   只在正文里声明边界、在钩子处含糊过去，等于用边界换转化。
 */
export function ConversionCta() {
  return (
    <section
      aria-labelledby="cta-heading"
      className="mt-14 rounded-2xl bg-brand-900 px-6 py-10 text-white lg:px-10 print:hidden"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-brand-100">
            <Icon name="file-check" className="h-3.5 w-3.5" />
            同一套规则，交给系统逐条跑
          </span>

          <h2
            id="cta-heading"
            className="mt-4 text-[clamp(1.35rem,2.4vw,1.9rem)] font-bold leading-snug tracking-tight"
          >
            还在逐条手动核对？
            <br className="hidden sm:block" />
            上传资料包，按 {REVIEW_RULES.length} 条规则自动核对并生成报告
          </h2>

          <p className="mt-3 text-sm leading-7 text-white/70">
            上面这份清单里的每一项，都会对应到报告里的一条发现：标注规则、所在文件与原文摘录，
            可回原文逐条核对。同一份资料跑两次结果一致。
            <span className="mt-1 block text-white/50">
              判定权始终在人手里 —— {siteConfig.shortName}只负责把可疑点找出来并给出证据，
              不替企业判定供应商是否合格。
            </span>
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col">
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-brand-900 transition hover:bg-brand-50"
          >
            免费体验
            <Icon name="arrow-right" className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md border border-white/25 px-5 py-3 text-sm font-medium text-white transition hover:border-white/50 hover:bg-white/5"
          >
            已有账号，去登录
          </Link>
        </div>
      </div>
    </section>
  );
}
