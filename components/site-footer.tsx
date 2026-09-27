import Link from "next/link";

import { LogoLockup } from "@/components/brand/logo";
import { Icon } from "@/components/ui/icons";
import { siteConfig } from "@/lib/site";

/**
 * 全站公共页脚。
 *
 * 除了常规导航，页脚承担三件对 B2B 信任有实际作用的事：
 *
 * 1. **主体透明**：运营方、所在地、联系邮箱。客户下单前一定会问「你是谁」，
 *    查不到主体就是红旗。数据全部来自 `siteConfig.operator`，不在组件里写第二份。
 * 2. **数据处理承诺**：只写代码里真实存在的机制。
 *    - 「不用于模型训练」成立的原因是：当前只注册了 Mock Provider，没有任何真实模型调用；
 *    - 「可删除」必须说清楚是**软删除**（服务端保留 deletedAt 标记以便追溯）——
 *      写成「彻底删除」是假的，数据库里就是软删除（见 lib/documents/repository.ts）。
 * 3. **备案号留空则不渲染**：宁可没有，也不放一个编出来的号。
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const { operator } = siteConfig;

  const commitments = [
    {
      icon: "check-circle",
      text: "资料不用于任何 AI 模型训练",
      note: "当前未接入真实模型调用（只注册了开发模拟 Provider）",
    },
    {
      icon: "folder",
      text: "按工作区隔离的私有存储",
      note: "文件存于服务端私有目录，无公开链接，非工作区成员不可访问",
    },
    {
      icon: "archive",
      text: "资料可删除",
      note: "删除后不再出现在列表中；服务端保留删除标记以便追溯",
    },
  ] as const;

  return (
    <footer className="border-t border-ink-200 bg-white print:hidden">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          {/*
            页脚同时给出品牌标与法定全称：标在上面，全称作正式产品名紧随其后。
            白底 → 用默认（非 inverse）变体；深底区块必须传 inverse，
            否则会出现「白圆白勾」（docs/BRAND.md §2）。
          */}
          <LogoLockup />
          <p className="mt-2 text-xs text-ink-500">{siteConfig.name}</p>
          <p className="mt-2 max-w-md text-sm leading-6 text-ink-500">
            面向企业采购与供应链团队的供应商资料审核工具。系统负责把可疑点找出来并给出证据，
            判定权始终在人手里。
          </p>
        </div>

        <nav aria-label="运营主体与联系" className="flex flex-col gap-2 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
            运营主体与联系
          </h2>
          <dl className="space-y-1.5 text-xs leading-5 text-ink-600">
            <div>
              <dt className="inline text-ink-500">运营方：</dt>
              <dd className="inline">{operator.entity}</dd>
            </div>
            <div>
              <dt className="inline text-ink-500">所在地：</dt>
              <dd className="inline">{operator.location}</dd>
            </div>
            <div>
              <dt className="inline text-ink-500">联络邮箱：</dt>
              <dd className="inline">
                <a
                  href={`mailto:${operator.email}`}
                  className="text-brand-700 hover:underline"
                >
                  {operator.email}
                </a>
              </dd>
            </div>
          </dl>
        </nav>

        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
            数据与隐私
          </h2>
          <ul className="space-y-2">
            {commitments.map((item) => (
              <li key={item.text} className="flex gap-2">
                <Icon
                  name={item.icon}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-700"
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-xs leading-5 text-ink-600">{item.text}</span>
                  <span className="block text-[11px] leading-4 text-ink-400">{item.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-ink-100">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-4 text-xs text-ink-400 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex flex-wrap items-center gap-2">
            <span>© {year} {siteConfig.name}（{siteConfig.latinName}）</span>
            <Link href="/templates" className="text-ink-500 hover:text-brand-700">
              资料核验清单
            </Link>
            <Link href="/sample-report" className="text-ink-500 hover:text-brand-700">
              示例报告
            </Link>
          </p>

          <p className="flex flex-wrap items-center gap-3">
            <span>版本 V{siteConfig.version}</span>
            {/* 备案号为空时不渲染链接：编一个号比不放更糟（可核验的假信息） */}
            {operator.icpRecord ? (
              <a
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-brand-700"
              >
                {operator.icpRecord}
              </a>
            ) : null}
          </p>
        </div>
      </div>
    </footer>
  );
}
