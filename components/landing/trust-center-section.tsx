import Link from "next/link";

import { Icon, type IconName } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";

/**
 * 信任中心（首页 `#trust`）。
 *
 * 这一区只放**可验证**的信号，每一条都带一句「你怎么自己验证」。
 * 这正是它和常见的「信任区」的区别：常见的做法是摆一排客户 logo
 * 与「服务 5000+ 企业」—— 那些数字无法自证，读者也无从核对。
 *
 * ⭐ 底部那段「我们没有的东西」是刻意写的。
 * 不写出来，读者会默认"没提大概是不好意思提"；写出来，
 * 前面那些能验证的条目才显得可信。**主动交底比堆形容词更能建立信任。**
 */
interface TrustItem {
  icon: IconName;
  title: string;
  claim: string;
  verify: string;
  href?: string;
  linkLabel?: string;
}

const TRUST_ITEMS: readonly TrustItem[] = [
  {
    icon: "clipboard",
    title: "结论可复算",
    claim:
      "审核结论由确定性规则产出：没有模型、没有随机数。同一份资料、同一个判定基准日，跑两次结果必然一致。",
    verify: "示例报告里写明了判定基准日，可以照着核对每一条日期结论。",
    href: "/sample-report",
    linkLabel: "看示例报告",
  },
  {
    icon: "file-check",
    title: "结论可追溯",
    claim: "每条发现都带着三样东西：命中的规则编号、所在资料、原文摘录（缺失类除外）。",
    verify: "报告里任意一条都能点回规则说明；规则编号在模板页可逐条查。",
    href: "/templates",
    linkLabel: "查规则清单",
  },
  {
    icon: "shield",
    title: "判定权不交给系统",
    claim:
      "系统只列出「需要你处理的点」，不输出「通过 / 不通过」。涉及资质挂靠、母子公司这类情况，提示人工核实而不定性。",
    verify: "报告里没有总评分、没有通过率，也没有任何一栏写着「结论」。",
  },
  {
    icon: "lock",
    title: "资料不出私有存储",
    claim:
      "资料存放在服务端私有目录，不生成可公开访问的链接；跨工作区读取在服务端被拒绝，浏览器传入的工作区编号不作为授权依据。",
    verify: "查看原始文件走带签名的临时地址，过期即失效 —— 链接无法转给别人长期使用。",
  },
  {
    icon: "file",
    title: "不制造看不懂的结论",
    claim:
      "扫描件没有文字层、正文被截断、期限写成相对天数 —— 这些都如实报「审不了 / 判不了」并说明原因，不用推测内容顶替。",
    verify: "示例报告里同时展示了「有证据」「没证据」「有证据但判不了」三种形态。",
    href: "/#evidence",
    linkLabel: "看证据链",
  },
  {
    icon: "external",
    title: "先看后注册",
    claim: "示例报告与资料核验清单都不需要登录，注册只发生在你决定上传自己的资料时。",
    verify: "两个页面都能直接打开，不用填任何表单。",
    href: "/sample-report",
    linkLabel: "直接看示例",
  },
];

export function TrustCenterSection() {
  return (
    <section
      id="trust"
      aria-labelledby="trust-heading"
      className="scroll-mt-16 border-b border-ink-200 bg-white"
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
          信任中心
        </p>
        <h2
          id="trust-heading"
          className="mt-3 text-2xl font-semibold tracking-tight text-ink-900 lg:text-3xl"
        >
          只写你能自己核对的
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-600">
          下面每一条都附了一句「你怎么验证」。写不出验证方式的，就不该出现在这一区。
        </p>

        <ul className="mt-10 grid gap-5 lg:grid-cols-2">
          {TRUST_ITEMS.map((item, index) => (
            <Reveal as="li" key={item.title} delayMs={index * 50} className="card flex flex-col p-6">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"
                  aria-hidden="true"
                >
                  <Icon name={item.icon} className="h-4 w-4" />
                </span>
                <h3 className="text-base font-semibold text-ink-900">{item.title}</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-ink-600">{item.claim}</p>
              <p className="mt-4 border-t border-ink-100 pt-3 text-xs leading-5 text-ink-500">
                <span className="font-medium text-ink-700">怎么验证：</span>
                {item.verify}
                {item.href ? (
                  <Link href={item.href} className="ml-1 font-medium text-brand-700 hover:underline">
                    {item.linkLabel} →
                  </Link>
                ) : null}
              </p>
            </Reveal>
          ))}
        </ul>

        {/*
          这一段是这一区的重心，不是补充说明。
          把"没有的东西"主动列出来，前面那些能验证的条目才站得住。
        */}
        <div className="mt-8 rounded-lg border border-dashed border-ink-300 bg-band px-6 py-5">
          <p className="text-sm font-semibold text-ink-900">这一区没有的东西</p>
          <p className="mt-2 text-sm leading-6 text-ink-600">
            没有第三方安全认证，没有客户 logo 墙，没有「服务 N 家企业」，
            也没有准确率、平均处理时长这类数字 —— 因为它们目前都无法验证。
            未取得认证就写「未取得」；模型复核还没有接入，页面上就写「尚未启用」。
          </p>
        </div>
      </div>
    </section>
  );
}
