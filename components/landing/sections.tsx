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

import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/reviews/labels";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { ALLOWED_MIME_TYPES } from "@/lib/files";
import type { FindingCategory } from "@/lib/reviews/types";
import {
  CheckFanout,
  RulePipeline,
  StatusPill,
  StorageDiagram,
} from "@/components/landing/visuals";
import { Icon, type IconName } from "@/components/ui/icons";

/**
 * 每个检查维度的图标与语义色底框。
 *
 * 用 `Record<FindingCategory, ...>` 而不是在渲染处现填：新增一个维度时
 * **编译期**就会在缺项处报错，而不是等页面上出现一个空白方块。
 * 颜色只用于区分维度，不表达"好坏"（好坏由状态 pill 表达，见 docs/DESIGN.md §2）。
 */
const CATEGORY_ICONS: Record<FindingCategory, { icon: IconName; tone: string }> = {
  COMPLETENESS: { icon: "clipboard", tone: "bg-brand-50 text-brand-700" },
  READABILITY: { icon: "file", tone: "bg-sky-50 text-sky-700" },
  ENTITY: { icon: "building", tone: "bg-amber-50 text-warning-600" },
  VALIDITY: { icon: "clock", tone: "bg-emerald-50 text-success-600" },
  CONSISTENCY: { icon: "check-circle", tone: "bg-violet-50 text-violet-700" },
  AI: { icon: "settings", tone: "bg-ink-100 text-ink-600" },
};

/**
 * 这三个数字**运行时从 `REVIEW_RULES` 算出来**，不是写死的常量。
 * 以前写的是字面量 "15" / "5"，一旦有人加一条规则，首页就会开始说一个过去的数字 ——
 * 而没有任何测试会发现。
 */
function buildMetrics() {
  const activeCategories = new Set(
    REVIEW_RULES.map((rule) => rule.category).filter((category) => category !== "AI"),
  );
  return [
    {
      value: String(REVIEW_RULES.length),
      label: "条审核规则",
      note: "完整性、有效期、主体、一致性",
      icon: "clipboard" as IconName,
    },
    {
      value: String(activeCategories.size),
      label: "类检查维度",
      note: "每条发现都归入其中一类",
      icon: "template" as IconName,
    },
    {
      value: "1",
      label: "份审核报告",
      note: "问题清单 + 原文摘录",
      icon: "file-check" as IconName,
    },
  ] as const;
}

/**
 * 支持格式 / 已实现机制横带。
 *
 * 这里**绝不放客户 Logo**：没有标杆客户就是没有，编一排假 Logo 是假证据
 * （docs/DESIGN.md §0 硬规则 2）。改成放产品自己确有能力的东西 ——
 * 格式白名单从 `ALLOWED_MIME_TYPES` 现算，改白名单当天这里跟着变；
 * 三条机制都是 SecuritySection 里展开说明的、系统内已实现的行为。
 *
 * 视觉上它是一条灰度过渡带：把首屏的白色和内容区的色带分开。
 */
export function TrustStrip() {
  const formats = Object.values(ALLOWED_MIME_TYPES).map((extension) =>
    extension.replace(".", "").toUpperCase(),
  );

  const assurances = [
    { icon: "check-circle" as IconName, text: "GB 32100 统一社会信用代码校验位" },
    { icon: "archive" as IconName, text: "私有存储 · 无公开链接" },
    { icon: "user" as IconName, text: "按工作区隔离" },
  ];

  return (
    <section aria-label="支持的文件格式与已实现机制" className="border-b border-ink-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-7">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-5">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {formats.map((format) => (
              <span
                key={format}
                className="rounded border border-ink-200 bg-ink-50 px-2.5 py-1 text-xs font-medium tabular-nums tracking-wide text-ink-500"
              >
                {format}
              </span>
            ))}
          </div>

          <span aria-hidden="true" className="hidden h-6 w-px bg-ink-200 sm:block" />

          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {assurances.map((item) => (
              <li key={item.text} className="flex items-center gap-1.5 text-xs text-ink-500">
                <Icon name={item.icon} className="h-3.5 w-3.5 text-ink-400" />
                {item.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function MetricsSection() {
  const metrics = buildMetrics();

  return (
    <section className="border-y border-ink-200 bg-band">
      <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:py-14">
        <ul className="grid gap-8 sm:grid-cols-3">
          {metrics.map((item) => (
            <li key={item.label} className="flex items-start gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-brand-700 ring-1 ring-brand-100"
                aria-hidden="true"
              >
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <div>
                <p className="text-3xl font-semibold tabular-nums tracking-tight text-brand-700 lg:text-4xl">
                  {item.value}
                </p>
                <p className="mt-1 text-sm font-medium text-ink-800">{item.label}</p>
                <p className="mt-1 text-xs leading-5 text-ink-500">{item.note}</p>
              </div>
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
          <div className="card p-6">
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-100 text-ink-400"
                aria-hidden="true"
              >
                <Icon name="file" className="h-4 w-4" />
              </span>
              <p className="text-xs font-semibold uppercase tracking-widest text-ink-400">以前</p>
            </div>
            <ul className="mt-4 space-y-2.5 text-sm leading-6 text-ink-600">
              <li>逐个打开十几份文件，人眼找有效期</li>
              <li>把证照编号抄进表格，容易抄错一位</li>
              <li>不同文件里的公司名靠记忆比对</li>
              <li>漏掉哪一份，事后才发现</li>
            </ul>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 text-brand-700"
                aria-hidden="true"
              >
                <Icon name="check-circle" className="h-4 w-4" />
              </span>
              <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">现在</p>
            </div>
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
/**
 * 五个维度的「典型情况」。
 *
 * ⚠️ 这些句子是**示意**，不是承诺：某个维度不一定每次都出问题，
 * 也可能出别的问题。它们的作用是让人看懂这个维度在查什么。
 */
const CAPABILITIES: ReadonlyArray<{
  title: string;
  category: FindingCategory;
  detail: string;
  samples: readonly { text: string; status: "pass" | "warn" | "fail" }[];
}> = [
  {
    title: "资料完整性",
    category: "COMPLETENESS",
    detail: "对照审核模板检查必填项，直接列出缺什么。",
    samples: [
      { text: "缺少必备资料：检测报告", status: "fail" },
      { text: "缺少必备资料：开户资料", status: "fail" },
    ],
  },
  {
    title: "正文可用性",
    category: "READABILITY",
    detail: "扫不出正文、还是占位模板、是否被截断，都会如实提示而不是跳过。",
    samples: [
      { text: "扫描件无文字层，未参与审核", status: "warn" },
      { text: "存在未填写的占位内容", status: "fail" },
    ],
  },
  {
    title: "主体与身份",
    category: "ENTITY",
    detail: "按 GB 32100 校验统一社会信用代码，并比对各文件里的主体是否一致。",
    samples: [
      { text: "统一社会信用代码校验位错误", status: "fail" },
      { text: "出现多个不同主体代码", status: "warn" },
    ],
  },
  {
    title: "证照有效期",
    category: "VALIDITY",
    detail: "检查营业执照与资质证书是否过期或临期；写成「长期」的按长期处理。",
    samples: [
      { text: "证照即将到期（模板阈值内）", status: "warn" },
      { text: "有效期无法判定", status: "warn" },
      { text: "证照已过期", status: "fail" },
    ],
  },
  {
    title: "数据一致性",
    category: "CONSISTENCY",
    detail: "比对报价单与合同等文件中的金额大小写是否自洽。",
    samples: [{ text: "金额大小写不一致", status: "warn" }],
  },
];

/**
 * 「五类检查」的总览图。
 *
 * 每个维度的规则条数**从 REVIEW_RULES 现算**，不是写死的数字 ——
 * 加规则当天这张图就会跟着变，不会开始说一个过去的数字。
 */
function buildCheckGroups() {
  const order = CATEGORY_ORDER.filter((category) => category !== "AI");
  return order.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    count: REVIEW_RULES.filter((rule) => rule.category === category).length,
  }));
}

export function CapabilitiesSection() {
  const checkGroups = buildCheckGroups();
  /** 示意的“本次结论”：五个维度分别有事没事。刻意不统一成一个颜色。 */
  const demoStatus = ["fail", "warn", "warn", "warn", "pass"] as const;

  return (
    <section aria-labelledby="capabilities-heading" className="border-b border-ink-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <h2 id="capabilities-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
          五类检查，一次跑完
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-600">
          一份资料包进去，五个维度各跑各的规则，最后汇总成一份报告。
          审核结论全部由规则产出：同一份资料跑两次，结果一致。
        </p>

        <div className="mt-8">
          <CheckFanout
            groups={checkGroups.map((group, index) => ({
              label: group.label,
              count: group.count,
              status: demoStatus[index],
              headline: CATEGORY_HEADLINES[group.category],
              ...CATEGORY_ICONS[group.category],
            }))}
          />
          <p className="mt-2 text-[11px] leading-5 text-ink-500">
            每个维度的规则条数取自当前已上线的规则集；图中状态为一次示意性审核的结果，不代表任何真实资料。
          </p>
        </div>

        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((item) => (
            <li key={item.title} className="card p-5">
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${CATEGORY_ICONS[item.category].tone}`}
                  aria-hidden="true"
                >
                  <Icon name={CATEGORY_ICONS[item.category].icon} className="h-4 w-4" />
                </span>
                <h3 className="text-base font-semibold text-ink-900">{item.title}</h3>
              </div>
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
        <p className="mt-6 text-xs leading-5 text-ink-500">
          上列为各维度的典型情况示意，用于说明这一维度在查什么，不构成审核承诺。
        </p>
      </div>
    </section>
  );
}

/** 总览图里每个维度的一句话。与 CATEGORY_LABELS 分开，因为这里的字数受卡片宽度限制。 */
const CATEGORY_HEADLINES: Record<string, string> = {
  COMPLETENESS: "必填项齐不齐",
  READABILITY: "正文能不能读",
  ENTITY: "是不是同一家公司",
  VALIDITY: "证照过没过期",
  CONSISTENCY: "金额自不自洽",
};

/**
 * 15 条规则的清单**直接从 `REVIEW_RULES` 读**，不在本页面维护副本。
 *
 * 这是 docs/DESIGN.md §0 硬规则 2 的要求：页面上写的数字必须来自真实功能。
 * 如果这里是手写数组，有人加一条规则而忘了改首页，首页就会开始说谎，
 * 而且没有任何测试能发现 —— 从源数据读，新增规则当天首页就会多一行。
 */
export function RulesSection() {
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    rules: REVIEW_RULES.filter((rule) => rule.category === category),
  })).filter((group) => group.rules.length > 0);

  return (
    <section aria-labelledby="rules-heading" className="border-b border-ink-200 bg-band-alt">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <h2 id="rules-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
          不是一句「系统判断」，是 {REVIEW_RULES.length} 条写明的规则
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-600">
          每条规则检查什么、什么情况下标记「问题」、什么情况下不下结论，都在下面列着。
          规则清单也是你可以自己关掉的：在审核模板里不勾选的规则不会出现在任何结论里。
        </p>

        {/* 先讲机制的确定性：点按钮之前就知道这条规则什么条件下会报警、会不会替人下结论 */}
        <div className="mt-8">
          <RulePipeline />
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {groups.map((group) => (
            <div key={group.category} className="card p-5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${CATEGORY_ICONS[group.category].tone}`}
                    aria-hidden="true"
                  >
                    <Icon name={CATEGORY_ICONS[group.category].icon} className="h-4 w-4" />
                  </span>
                  <h3 className="text-base font-semibold text-ink-900">{group.label}</h3>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-500">
                  {group.rules.length} 条
                </span>
              </div>
              <ul className="mt-3 divide-y divide-ink-200">
                {group.rules.map((rule) => (
                  <li key={rule.id} className="py-2">
                    <p className="text-sm font-medium text-ink-800">{rule.label}</p>
                    <p className="mt-0.5 text-xs leading-5 text-ink-600">{rule.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * 每一步配一个界面片段，而不是只写一行说明文字。
 * 中文 B2B 落地页里「产品自己的界面」比形容词有说服力得多（docs/DESIGN.md §4）。
 * snippet 里的东西不写死文档名，避免出现像是真实客户资料的假证据。
 */
const WORKFLOW: ReadonlyArray<{
  step: string;
  title: string;
  detail: string;
  icon: IconName;
  snippet: { kind: "files" | "text" | "rules" | "report"; note: string };
}> = [
  {
    step: "01",
    title: "上传资料包",
    detail: "PDF、Word、Excel、图片与 ZIP，一次上传；压缩包自动展开成独立条目。",
    icon: "upload",
    snippet: { kind: "files", note: "支持 PDF / DOCX / XLSX / PNG / JPG / ZIP" },
  },
  {
    step: "02",
    title: "提取正文",
    detail: "解析文件内容，提取可用于核对的文本；扫不出正文的如实标注，不伪造内容。",
    icon: "file",
    snippet: { kind: "text", note: "提取状态：可查看 / 待处理 / 失败" },
  },
  {
    step: "03",
    title: "规则校验",
    detail: "按模板启用的规则逐条跑，命中即生成一条带严重级别的发现。",
    icon: "clipboard",
    snippet: { kind: "rules", note: "已启用规则数随模板配置变化" },
  },
  {
    step: "04",
    title: "输出报告",
    detail: "按严重级别排序，每条附所在文件与原文摘录，可直接用浏览器打印导出。",
    icon: "file-check",
    snippet: { kind: "report", note: "报告页支持打印 / 另存为 PDF" },
  },
];

/** 流程里的小界面片段。刻意抽象，不伪造具体文件名和具体结论。 */
function WorkflowSnippet({ snippet }: { snippet: (typeof WORKFLOW)[number]["snippet"] }) {
  if (snippet.kind === "files") {
    return (
      <div className="space-y-1">
        {["pdf", "docx", "xlsx", "zip"].map((ext, index) => (
          <div
            key={ext}
            className="flex items-center gap-2 rounded border border-ink-200 bg-brand-mist px-2 py-1"
            style={{ opacity: 1 - index * 0.12 }}
          >
            <span className="inline-flex h-4 w-6 items-center justify-center rounded bg-brand-600/10 text-[9px] font-semibold uppercase text-brand-700">
              {ext}
            </span>
            <span className="h-1.5 flex-1 rounded-full bg-ink-200" />
          </div>
        ))}
      </div>
    );
  }

  if (snippet.kind === "text") {
    return (
      <div className="space-y-1">
        {[88, 64, 96, 42].map((width, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <span
              className={`h-1.5 rounded-full ${index === 3 ? "bg-warning-600/50" : "bg-ink-200"}`}
              style={{ width: `${width}%` }}
            />
          </div>
        ))}
        <p className="pt-0.5 text-[10px] text-ink-400">一份无文字层 → 标为待确认而非跳过</p>
      </div>
    );
  }

  if (snippet.kind === "rules") {
    return (
      <div className="space-y-1">
        {["必备资料缺失", "证照已过期", "信用代码校验位错误"].map((label, index) => (
          <div
            key={label}
            className="flex items-center justify-between gap-2 rounded border border-ink-200 bg-white px-2 py-1"
          >
            <span className="truncate text-[10px] text-ink-600">{label}</span>
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                index === 0 ? "bg-danger-600" : "bg-warning-600"
              }`}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded border border-ink-200 bg-white p-2">
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 pb-1.5">
        <span className="text-[10px] font-medium text-ink-700">审核报告</span>
        <span className="text-[9px] text-ink-400">打印 / PDF</span>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1 text-center">
        <div>
          <p className="text-xs font-semibold tabular-nums text-danger-600">3</p>
          <p className="text-[9px] text-ink-400">问题</p>
        </div>
        <div>
          <p className="text-xs font-semibold tabular-nums text-warning-600">1</p>
          <p className="text-[9px] text-ink-400">待确认</p>
        </div>
        <div>
          <p className="text-xs font-semibold tabular-nums text-success-600">14</p>
          <p className="text-[9px] text-ink-400">通过</p>
        </div>
      </div>
    </div>
  );
}

export function WorkflowSection() {
  return (
    <section aria-labelledby="workflow-heading" className="border-b border-ink-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <h2 id="workflow-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
          审核流程
        </h2>
        <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
          {WORKFLOW.map((item, index) => (
            <li key={item.step} className="relative lg:px-5 lg:first:pl-0 lg:last:pr-0">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-4 hidden h-px w-5 bg-ink-300 lg:block"
                />
              ) : null}
              <span className="flex items-center gap-2">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white"
                  aria-hidden="true"
                >
                  <Icon name={item.icon} className="h-4 w-4" />
                </span>
                <span className="text-xs font-semibold tabular-nums text-ink-400">{item.step}</span>
              </span>
              <h3 className="mt-3 text-base font-semibold text-ink-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-600">{item.detail}</p>

              <div className="card-soft mt-3 p-2.5">
                <WorkflowSnippet snippet={item.snippet} />
              </div>
              <p className="mt-2 text-[11px] leading-5 text-ink-500">{item.snippet.note}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const SECURITY_ITEMS: ReadonlyArray<{ title: string; detail: string; icon: IconName }> = [
  { title: "私有存储", detail: "资料保存在私有目录，不生成可公开访问的链接。", icon: "archive" },
  {
    title: "工作区隔离",
    detail: "所有数据按工作区隔离，跨工作区读取在服务端被拒绝。",
    icon: "user",
  },
  {
    title: "服务端权限校验",
    detail: "浏览器传入的工作区编号不作为授权依据，一律回库确认归属。",
    icon: "check-circle",
  },
  { title: "签名访问", detail: "查看原始文件需要带签名的临时地址，过期失效。", icon: "clock" },
];

export function SecuritySection() {
  return (
    <section aria-labelledby="security-heading" className="border-b border-ink-200 bg-band">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <h2 id="security-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
          资料怎么被保管
        </h2>
        {/* 先给链路图，再给文字条目 —— 图让人一眼看懂边界在哪，条目负责说清每一环 */}
        <div className="mt-10">
          <StorageDiagram />
        </div>

        {/* 只陈述已实现的机制。未取得认证就不写认证 —— 见 docs/DESIGN.md §0 硬规则 2 */}
        <ul className="mt-8 grid gap-6 sm:grid-cols-2">
          {SECURITY_ITEMS.map((item) => (
            <li key={item.title} className="card flex gap-3 p-4">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"
                aria-hidden="true"
              >
                <Icon name={item.icon} className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-ink-900">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-ink-600">{item.detail}</p>
              </div>
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
          注册后选一个内置模板、上传资料包、点「开始审核」，几十秒内就能看到第一份结论。
        </p>
        {/*
          把"接下来会发生什么"写清楚，代替空泛的号召。
          这四句是真实的产品行为，不是营销话术 —— 写不了具体步骤的 CTA，
          说明产品自己也没想清楚第一步是什么。
        */}
        <ol className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-3">
          {[
            { step: "01", text: "注册并自动建好工作区", icon: "user" as IconName },
            { step: "02", text: "上传一份资料包，或直接导入既有的", icon: "upload" as IconName },
            { step: "03", text: "选模板、发起审核，等待报告", icon: "file-check" as IconName },
          ].map((item) => (
            <li key={item.step} className="rounded-md border border-white/25 px-3 py-2.5">
              <span className="flex items-center gap-1.5">
                <Icon name={item.icon} className="h-3.5 w-3.5 text-brand-200" />
                <span className="text-[11px] font-semibold tabular-nums text-brand-200">
                  {item.step}
                </span>
              </span>
              <p className="mt-1 text-xs leading-5 text-white">{item.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-xs leading-5 text-brand-200">
          当前免费使用，正式定价尚未公布 · 上传的资料不会出现在公开网络上
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
