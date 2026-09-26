/**
 * 首页各区块。
 *
 * 排版纪律（docs/DESIGN.md §3）：区块底色要在白 / 浅灰 / 浅蓝之间交替，
 * 且不能是"六个一样的卡片排一排"。每个区块要么有数据、要么有 UI、要么有状态。
 *
 * ⚠️ 所有数字都来自真实功能：
 *   - 15 条 = RULE_IDS 的长度
 *   - 5 类 = FINDING_CATEGORIES 去掉未启用的 AI 复核
 * 不写「准确率 99.9%」这类没测过的数字。
 */

import Link from "next/link";

import { StatusPill } from "@/components/landing/visuals";

const METRICS: ReadonlyArray<{ value: string; label: string; note: string }> = [
  { value: "15", label: "条审核规则", note: "完整性、有效期、主体、一致性" },
  { value: "5", label: "类检查维度", note: "每条发现都归入其中一类" },
  { value: "1", label: "份审核报告", note: "问题清单 + 原文摘录" },
];

export function MetricsSection() {
  return (
    <section className="border-b border-ink-200 bg-brand-tint">
      <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:py-14">
        <ul className="grid gap-8 sm:grid-cols-3">
          {METRICS.map((item) => (
            <li key={item.label}>
              <p className="text-3xl font-semibold tabular-nums tracking-tight text-brand-700 lg:text-4xl">
                {item.value}
              </p>
              <p className="mt-1 text-sm font-medium text-ink-800">{item.label}</p>
              <p className="mt-1 text-xs leading-5 text-ink-500">{item.note}</p>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-xs leading-5 text-ink-500">
          数字取自当前已上线的规则与分类，不含任何估算或行业平均值。
        </p>
      </div>
    </section>
  );
}

export function BeforeAfterSection() {
  return (
    <section aria-labelledby="contrast-heading" className="border-b border-ink-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <h2 id="contrast-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
          一份资料包，以前要怎么审
        </h2>
        <div className="mt-10 grid items-stretch gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-ink-400">以前</p>
            <ul className="mt-4 space-y-2.5 text-sm leading-6 text-ink-600">
              <li>逐个打开十几份文件，人眼找有效期</li>
              <li>把证照编号抄进表格，容易抄错一位</li>
              <li>不同文件里的公司名靠记忆比对</li>
              <li>漏掉哪一份，事后才发现</li>
            </ul>
          </div>

          <div className="rounded-lg border border-brand-200 bg-brand-mist p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">现在</p>
            <ul className="mt-4 space-y-2.5 text-sm leading-6 text-ink-700">
              <li>一次上传，自动提取正文</li>
              <li>统一社会信用代码按国标校验位核对</li>
              <li>跨文件比对主体名称与代码是否自洽</li>
              <li>缺失、过期、不一致逐条列出并附原文摘录</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * 每条样例都带自己的状态，而不是整块统一用一个状态 ——
 * 「缺少检测报告」是问题（红），「证书临期」是待确认（橙），
 * 混在一起会让状态色失去含义（见 docs/DESIGN.md §2）。
 */
const CAPABILITIES: ReadonlyArray<{
  title: string;
  detail: string;
  samples: readonly { text: string; status: "pass" | "warn" | "fail" }[];
}> = [
  {
    title: "资料完整性",
    detail: "对照审核模板检查必填项，直接列出缺什么。",
    samples: [
      { text: "缺少检测报告", status: "fail" },
      { text: "缺少开户资料", status: "fail" },
    ],
  },
  {
    title: "证照有效期",
    detail: "检查营业执照与资质证书是否过期或临期；写成「长期」的按长期处理。",
    samples: [
      { text: "ISO 证书 42 天后到期", status: "warn" },
      { text: "营业执照已过期", status: "fail" },
    ],
  },
  {
    title: "主体与身份",
    detail: "按 GB 32100 校验统一社会信用代码，并比对各文件里的主体是否一致。",
    samples: [
      { text: "代码校验位错误", status: "fail" },
      { text: "出现多个主体代码", status: "warn" },
    ],
  },
  {
    title: "数据一致性",
    detail: "比对报价单与合同等文件中的金额是否一致。",
    samples: [{ text: "报价金额与合同不符", status: "warn" }],
  },
  {
    title: "正文可用性",
    detail: "扫不出正文、还是占位模板、是否被截断，都会如实提示而不是跳过。",
    samples: [
      { text: "扫描件无文字层", status: "warn" },
      { text: "仍是 XXX 占位模板", status: "fail" },
    ],
  },
];

export function CapabilitiesSection() {
  return (
    <section aria-labelledby="capabilities-heading" className="border-b border-ink-200 bg-ink-50">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <h2 id="capabilities-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
          五个维度，逐条核对
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-600">
          审核结论全部由规则产出：同一份资料跑两次，结果一致。
        </p>

        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((item) => (
            <li key={item.title} className="rounded-lg border border-ink-200 bg-white p-5">
              <h3 className="text-base font-semibold text-ink-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-600">{item.detail}</p>
              <ul className="mt-4 space-y-1.5 border-t border-ink-100 pt-3">
                {item.samples.map((sample) => (
                  <li key={sample.text} className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-ink-500">{sample.text}</span>
                    <StatusPill status={sample.status} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const WORKFLOW: ReadonlyArray<{ step: string; title: string; detail: string }> = [
  { step: "01", title: "上传资料包", detail: "PDF、Word、Excel、图片与 ZIP，一次上传。" },
  { step: "02", title: "提取正文", detail: "系统解析文件内容，提取可用于核对的文本。" },
  { step: "03", title: "规则校验", detail: "15 条规则逐条跑，命中即生成一条发现。" },
  { step: "04", title: "输出报告", detail: "按严重级别排序，每条附原文摘录。" },
];

export function WorkflowSection() {
  return (
    <section aria-labelledby="workflow-heading" className="border-b border-ink-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <h2 id="workflow-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
          审核流程
        </h2>
        {/* 桌面：横向流程；移动：纵向时间线（靠 lg: 断点切换连线方向） */}
        <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
          {WORKFLOW.map((item, index) => (
            <li key={item.step} className="relative lg:px-5 lg:first:pl-0 lg:last:pr-0">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-4 hidden h-px w-5 bg-ink-300 lg:block"
                />
              ) : null}
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-xs font-semibold tabular-nums text-white">
                {item.step}
              </span>
              <h3 className="mt-3 text-base font-semibold text-ink-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-600">{item.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const SECURITY_ITEMS: ReadonlyArray<{ title: string; detail: string }> = [
  { title: "私有存储", detail: "资料保存在私有目录，不生成可公开访问的链接。" },
  { title: "工作区隔离", detail: "所有数据按工作区隔离，跨工作区读取在服务端被拒绝。" },
  { title: "服务端权限校验", detail: "浏览器传入的工作区编号不作为授权依据，一律回库确认归属。" },
  { title: "签名访问", detail: "查看原始文件需要带签名的临时地址，过期失效。" },
];

export function SecuritySection() {
  return (
    <section aria-labelledby="security-heading" className="border-b border-ink-200 bg-ink-50">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <h2 id="security-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
          资料怎么被保管
        </h2>
        {/* 只陈述已实现的机制。未取得认证就不写认证 —— 见 docs/DESIGN.md §0 硬规则 2 */}
        <ul className="mt-10 grid gap-6 sm:grid-cols-2">
          {SECURITY_ITEMS.map((item) => (
            <li key={item.title} className="border-l-2 border-brand-600 pl-4">
              <h3 className="text-base font-semibold text-ink-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-600">{item.detail}</p>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-xs leading-5 text-ink-500">
          本项目未取得任何第三方安全认证，上列均为系统内已实现的机制，不构成认证声明。
        </p>
      </div>
    </section>
  );
}

export function FinalCtaSection() {
  return (
    <section className="bg-brand-700">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 text-center lg:py-20">
        <h2 className="text-2xl font-semibold tracking-tight text-white lg:text-3xl">
          开始审核你的下一份供应商资料
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-brand-100">
          上传资料包，快速发现缺失、过期与信息不一致问题。当前可免费使用，正式定价尚未公布。
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="rounded-md bg-white px-6 py-3 text-sm font-medium text-brand-700 hover:bg-brand-50"
          >
            免费开始审核
          </Link>
          <a
            href="#workflow"
            className="rounded-md border border-white/40 px-6 py-3 text-sm font-medium text-white hover:bg-white/10"
          >
            查看审核流程
          </a>
        </div>
      </div>
    </section>
  );
}
