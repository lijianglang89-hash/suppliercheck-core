import Link from "next/link";

import { Icon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";
import { CHECKLIST_TEMPLATES } from "@/lib/content/checklist-templates";
import { REVIEW_RULES } from "@/lib/reviews/rules";

/**
 * 首页的内容页导流区。
 *
 * 存在理由不是"凑一个板块"：内容页如果只能从页眉页脚进去，它对爬虫和访客
 * 都是一个孤岛 —— 首页是站内权重最高的页面，从首页给一条显式链接，
 * 新页面的发现与收录周期会明显缩短，访客的下一步也有了去处。
 *
 * 刻意做成**紧凑的入口**而不是又一块大图文：这里的目标是"把人送走"，
 * 不是再讲一遍价值主张。每张卡只给标题、一句摘要和两条可量化的元信息。
 *
 * 清单卡的数量与内容全部来自数据模块，加一篇内容这里自动多一张卡 ——
 * 不在这里维护第二个列表（维护两份列表的结果一定是有一份过期）。
 */
export function ContentHubSection() {
  if (CHECKLIST_TEMPLATES.length === 0) return null;

  return (
    <section aria-labelledby="content-hub-heading" className="border-t border-ink-200 bg-band">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
                <Icon name="clipboard" className="h-3.5 w-3.5" />
                可直接照着执行的核验清单
              </span>
              <h2
                id="content-hub-heading"
                className="mt-4 text-[clamp(1.5rem,2.6vw,2.1rem)] font-bold leading-[1.25] tracking-tight text-ink-900"
              >
                不想先注册？先把清单拿走自己核
              </h2>
              <p className="mt-3 text-sm leading-7 text-ink-600">
                每份清单都写明要收哪些资料、每项验到什么程度、验出问题怎么定性，
                并标注它对应 {REVIEW_RULES.length} 条核对规则里的哪几条 —— 不用注册也能照着做。
              </p>
            </div>

            <Link
              href="/templates"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
            >
              查看全部清单
              <Icon name="arrow-right" className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </Reveal>

        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {CHECKLIST_TEMPLATES.map((template) => (
            <li key={template.slug}>
              <Link
                href={`/templates/${template.slug}`}
                className="card flex h-full flex-col p-6 transition hover:border-brand-300 hover:shadow-[0_8px_24px_rgba(23,44,70,0.08)]"
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-50 text-brand-700"
                  aria-hidden="true"
                >
                  <Icon name="file-check" className="h-4 w-4" />
                </span>

                <h3 className="mt-4 text-base font-semibold leading-6 text-ink-900">
                  {template.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-ink-600">{template.summary}</p>

                <p className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-xs text-ink-400">
                  <span>{template.items.length} 项资料</span>
                  <span>·</span>
                  <span>含常见雷区</span>
                  <span>·</span>
                  <span>可下载 CSV</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
