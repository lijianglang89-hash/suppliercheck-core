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

import { SAMPLE_REPORT } from "@/lib/content/sample-report";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/reviews/labels";
import { REVIEW_RULES } from "@/lib/reviews/rules";
import { isBlocking, type FindingCategory } from "@/lib/reviews/types";
import {
  BoundaryPanel,
  CheckFanout,
  FailurePanel,
  RuleEvidenceFinding,
  StateStrip,
  StorageDiagram,
} from "@/components/landing/visuals";
import { Icon, type IconName } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";

/**
 * 每个检查维度的图标与底框。
 *
 * 用 `Record<FindingCategory, ...>` 而不是在渲染处现填：新增一个维度时
 * **编译期**就会在缺项处报错，而不是等页面上出现一个空白方块。
 *
 * ⚠️ 底框一律用品牌蓝/中性灰，**绝不占用语义色**（docs/BRAND.md §3）。
 * 曾经给「证照有效期」配绿底、「主体与身份」配琥珀底，看着更热闹，
 * 代价是页面上一半的绿和琥珀都跟审核状态无关 —— 用户看到绿色时的
 * 第一反应本来应该是"通过"，用多了这个反应就没了。
 * 维度的区分交给图标形状，好坏交给状态 pill。
 */
const CATEGORY_ICONS: Record<
  FindingCategory,
  { icon: IconName; tone: string; darkTone: string }
> = {
  COMPLETENESS: {
    icon: "clipboard",
    tone: "bg-brand-50 text-brand-700",
    darkTone: "bg-white/10 text-white",
  },
  READABILITY: {
    icon: "file",
    tone: "bg-ink-100 text-ink-600",
    darkTone: "bg-white/5 text-white/70",
  },
  ENTITY: {
    icon: "building",
    tone: "bg-brand-50 text-brand-700",
    darkTone: "bg-white/10 text-white",
  },
  VALIDITY: {
    icon: "clock",
    tone: "bg-ink-100 text-ink-600",
    darkTone: "bg-white/5 text-white/70",
  },
  CONSISTENCY: {
    icon: "check-circle",
    tone: "bg-brand-50 text-brand-700",
    darkTone: "bg-white/10 text-white",
  },
  AI: { icon: "settings", tone: "bg-ink-100 text-ink-600", darkTone: "bg-white/5 text-white/70" },
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
      value: "4",
      label: "种资料状态",
      note: "上传 / 解析中 / 可查看 / 失败，全程可见",
      icon: "file-check" as IconName,
    },
  ] as const;
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
 * 每条样例都带自己的状态色，而不是整块统一 —— 「缺少检测报告」比「证书临期」更急，
 * 混成一个颜色会让状态色失去含义（见 docs/DESIGN.md §2）。
 *
 * ⚠️ 这里的 status 只决定**圆点颜色**，不渲染成文字标签，
 * 因此不存在「通过」被写成结论的风险；文字标签那条路在 StatusPill 上，
 * 由 tests/unit/brand-assets.test.ts 守着。
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
  samples: readonly { text: string; status: "fail" | "warn" }[];
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

/**
 * 五类检查区 —— Z 字第二拍：左图（CheckFanout + 弥散光）/ 右文（5 个真实维度）。
 *
 * 与报告区（左文右 UI）交错，阅读线形成 Z 字流转，化解长页疲劳。
 * 维度内容全部来自 CAPABILITIES（真实分类，不是编的「财务合规/法律履约」）。
 */
export function CapabilitiesSection() {
  const checkGroups = buildCheckGroups();
  /**
   * 示意的"本次结果"：五个维度分别有没有查出要看的点。
   * 刻意不统一成一个颜色 —— 五个维度同时全绿反而说明图是画出来的。
   * 取值用 clear/review/action（"有无发现"），不是 pass/fail（"是否合格"）。
   */
  const demoStatus = ["action", "review", "review", "review", "clear"] as const;

  return (
    <section
      id="capabilities"
      aria-labelledby="capabilities-heading"
      className="scroll-mt-16 border-b border-ink-200 bg-white"
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-24 lg:py-28">
        <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-12">
          {/* 左 50%：CheckFanout 视觉（弥散光背板） */}
          <Reveal className="relative order-2 lg:order-1" delayMs={120}>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-5 rounded-3xl bg-brand-500/10 blur-2xl"
            />
            <div className="relative">
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
          </Reveal>

          {/* 右 50%：标题 + 五个真实维度紧凑列表 */}
          <Reveal className="order-1 lg:order-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-ink-50 px-3 py-1 text-xs font-medium text-ink-600">
              <Icon name="template" className="h-3.5 w-3.5" />
              五类检查，一次跑完
            </span>

            <h2
              id="capabilities-heading"
              className="mt-5 text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.2] tracking-tight text-ink-900"
            >
              一份资料包进去，
              <br className="hidden sm:block" />
              <span className="text-brand-700">五个维度</span>各跑各的规则
            </h2>

            <p className="mt-4 text-sm leading-7 text-ink-600">
              最后汇总成一份报告。审核结论全部由规则产出：同一份资料跑两次，结果一致。
            </p>

            <ul className="mt-8 space-y-5">
              {CAPABILITIES.map((item) => (
                <li key={item.title} className="flex gap-3.5">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${CATEGORY_ICONS[item.category].tone}`}
                    aria-hidden="true"
                  >
                    <Icon name={CATEGORY_ICONS[item.category].icon} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h3 className="text-sm font-semibold text-ink-900">{item.title}</h3>
                      <span className="text-xs tabular-nums text-ink-400">
                        {CATEGORY_HEADLINES[item.category]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-ink-600">{item.detail}</p>
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                      {item.samples.map((sample) => (
                        <li key={sample.text} className="flex items-center gap-1.5 text-xs text-ink-500">
                          {/*
                            只有两种色：danger / warning。
                            原来还有个 success 绿的分支，但没有任何一条 sample 会走到它，
                            是死代码 —— 而且绿色圆点会被读成"这一项通过了"。
                          */}
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              sample.status === "fail" ? "bg-danger-600" : "bg-warning-600"
                            }`}
                            aria-hidden="true"
                          />
                          {sample.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>

            <p className="mt-6 text-xs leading-5 text-ink-500">
              上列为各维度的典型情况示意，用于说明这一维度在查什么，不构成审核承诺。
            </p>
          </Reveal>
        </div>
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
/**
 * 深色反转区块：全站唯一的深底 section。
 *
 * 作用是在中段制造一次"唤醒" —— 上半页一路白/浅蓝/浅灰，视觉张力会衰减，
 * 深底块像断点一样把注意力拉回来（PingCAP / 阿里云这类硬核技术站的标准做法）。
 *
 * 三条纪律：
 * 1. 卡片用**半透明白**（bg-white/5 + border-white/10），融进底色而不是死板的黑块；
 *    1px 半透明白边是深色下勾勒物理边缘的关键，不能省。
 * 2. 语义色在这里只做**幽灵徽章**（透明底 + 语义色边框/文字），
 *    依然不拿它当装饰（docs/BRAND.md §3）。
 * 3. 底部不做"深→白渐变"：渐变必然经过一段脏灰，反而显廉价。
 *    用大 padding 让空间当隔离带（py-24 / pb-28）。
 */
export function RulesSection() {
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    rules: REVIEW_RULES.filter((rule) => rule.category === category),
  })).filter((group) => group.rules.length > 0);

  return (
    <section
      id="rules"
      aria-labelledby="rules-heading"
      className="scroll-mt-16 bg-brand-900 py-24 pb-28 lg:py-28 lg:pb-32"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-brand-100">
          <Icon name="clipboard" className="h-3.5 w-3.5" />
          规则引擎 · 确定性输出
        </span>

        <h2
          id="rules-heading"
          className="mt-6 text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.2] tracking-tight text-white sm:whitespace-nowrap"
        >
          不是一句「系统判断」，是 {REVIEW_RULES.length} 条写明的规则
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-white/70">
          每条规则检查什么、什么情况下标记「问题」、什么情况下不下结论，都在下面列着。
          规则清单也是你可以自己关掉的：在审核模板里不勾选的规则不会出现在任何结论里。
        </p>

        {/*
          可追溯性必须落到**实体**上，而不是一句形容词。
          RULE → EVIDENCE → FINDING 三个节点，客户能在自己那份报告里逐项对上：
          报告里每条发现都写着规则 id、所在资料、原文摘录。
          （这一版替换掉了原来的「命中 / 定级 / 取证据 / 进报告」四步链 ——
           那条链讲的是**流程**，而这里要证明的是**可追溯**，数据链更直接。）
        */}
        <div className="mt-10">
          <RuleEvidenceFinding dark />
        </div>

        {/*
          这里刻意**不用 grid**：五个维度的规则条数是 3 / 5 / 3 / 1 / 3，
          grid 两列是"行等高"的 —— 1 条那张会被拉到旁边 3 条的高度，
          底部留出一大片空壳；末行还会空掉半列（实测截图上一眼就能看出来）。
          CSS 多列是"列内堆叠"，卡片各按内容高度排，两列总高自动接近。
          维度之间没有先后依赖，列优先阅读不影响语义。
        */}
        <div className="mt-10 gap-6 lg:columns-2 [&>*:last-child]:mb-0">
          {groups.map((group) => (
            <div
              key={group.category}
              className="mb-6 break-inside-avoid rounded-lg border border-white/10 bg-white/5 p-5 transition-all duration-200 hover:-translate-y-1 hover:border-white/20 hover:bg-white/10"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${CATEGORY_ICONS[group.category].darkTone}`}
                    aria-hidden="true"
                  >
                    <Icon name={CATEGORY_ICONS[group.category].icon} className="h-4 w-4" />
                  </span>
                  <h3 className="text-base font-semibold text-white">{group.label}</h3>
                </span>
                <span className="shrink-0 rounded border border-white/15 px-2 py-0.5 text-xs tabular-nums text-brand-100">
                  {group.rules.length} 条
                </span>
              </div>
              <ul className="mt-3 divide-y divide-white/10">
                {group.rules.map((rule) => (
                  <li key={rule.id} className="py-2">
                    <p className="text-sm font-medium text-white">{rule.label}</p>
                    <p className="mt-0.5 text-xs leading-5 text-white/60">{rule.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-10 border-t border-white/10 pt-6 text-xs leading-6 text-white/50">
          同一份资料跑两次结果一致 —— 规则不依赖模型推测，也没有随机性。
        </p>
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
  snippet: { kind: "files" | "text" | "rules" | "report" | "rerun"; note: string };
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
  {
    step: "05",
    title: "修正后重跑",
    detail: "供应商补齐资料后重新发起审核：结果是整批替换，不会把上一轮的发现留在报告里。",
    icon: "settings",
    snippet: { kind: "rerun", note: "重跑 = 用新结果整批替换旧发现" },
  },
];

/**
 * 流程里的界面片段。
 *
 * ⭐ 这一版的唯一改动方向：**放大 + 加密度**。
 * 上一版这些片段只有 10px 字号、1.5px 高的色条，缩在 60% 栏里等于一张缩略图 ——
 * 用户看不清，就只会觉得"这是个示意图"。
 * 现在全部提到可读字号（≥11px），并把状态值换成真实枚举
 * （READY / FAILED / 严重 / 高），让它读起来像软件而不是插画。
 *
 * 仍然不伪造具体文件名与具体结论 —— 抽象的是**内容**，不是**信息密度**。
 */
function WorkflowSnippet({ snippet }: { snippet: (typeof WORKFLOW)[number]["snippet"] }) {
  if (snippet.kind === "files") {
    return (
      <div className="space-y-1.5">
        {["pdf", "docx", "xlsx", "zip"].map((ext, index) => (
          <div
            key={ext}
            className="flex items-center gap-2.5 rounded border border-ink-200 bg-brand-mist px-2.5 py-1.5"
            style={{ opacity: 1 - index * 0.1 }}
          >
            <span className="inline-flex h-5 w-8 items-center justify-center rounded bg-brand-600/10 text-[10px] font-semibold uppercase text-brand-700">
              {ext}
            </span>
            <span className="h-2 flex-1 rounded-full bg-ink-200" />
            <span className="shrink-0 font-mono text-[10px] text-ink-400">UPLOADED</span>
          </div>
        ))}
      </div>
    );
  }

  if (snippet.kind === "text") {
    return (
      <div className="space-y-2">
        {[88, 64, 96].map((width, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="h-2 rounded-full bg-ink-200" style={{ width: `${width}%` }} />
            <span className="shrink-0 font-mono text-[10px] text-success-600">READY</span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="h-2 w-[42%] rounded-full bg-warning-600/50" />
          <span className="shrink-0 font-mono text-[10px] text-warning-600">FAILED</span>
        </div>
        <p className="pt-1 text-[11px] leading-5 text-ink-500">
          无文字层的扫描件 → 标为无可提取正文，不伪造内容
        </p>
      </div>
    );
  }

  if (snippet.kind === "rules") {
    const rows = [
      { label: "必备资料缺失", level: "高" },
      { label: "证照已过期", level: "严重" },
      { label: "信用代码校验位错误", level: "高" },
    ];
    return (
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-2 rounded border border-ink-200 bg-white px-2.5 py-1.5"
          >
            <span className="truncate text-[11px] text-ink-700">{row.label}</span>
            <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
              {row.level}
            </span>
          </div>
        ))}
        <p className="pt-0.5 text-[11px] leading-5 text-ink-500">
          启用哪几条由模板决定，未启用的规则不出现在任何结论里
        </p>
      </div>
    );
  }

  if (snippet.kind === "rerun") {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 rounded border border-ink-200 bg-ink-50 px-2.5 py-1.5">
          <span className="text-[11px] text-ink-400 line-through">上一轮 · 4 条发现</span>
          <span className="shrink-0 font-mono text-[10px] text-ink-400">已作废</span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded border border-brand-200 bg-brand-50 px-2.5 py-1.5">
          <span className="text-[11px] font-medium text-brand-800">本轮 · 2 条发现</span>
          <span className="shrink-0 font-mono text-[10px] text-brand-700">READY</span>
        </div>
        <p className="pt-0.5 text-[11px] leading-5 text-ink-500">
          整批替换，不是追加 —— 补正后旧发现不会留在报告里
        </p>
      </div>
    );
  }

  return (
    <div className="rounded border border-ink-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 pb-2">
        <span className="text-[11px] font-medium text-ink-800">审核报告</span>
        <span className="text-[10px] text-ink-400">打印 / PDF</span>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
        <div>
          <p className="text-base font-semibold tabular-nums text-danger-600">
            {SAMPLE_REPORT.findings.filter((f) => isBlocking(f.severity)).length}
          </p>
          <p className="text-[10px] text-ink-500">阻断</p>
        </div>
        <div>
          <p className="text-base font-semibold tabular-nums text-ink-900">
            {SAMPLE_REPORT.findings.length}
          </p>
          <p className="text-[10px] text-ink-500">发现</p>
        </div>
        <div>
          <p className="text-base font-semibold tabular-nums text-brand-700">
            {REVIEW_RULES.length}
          </p>
          <p className="text-[10px] text-ink-500">规则已执行</p>
        </div>
      </div>
      <p className="mt-2 border-t border-ink-100 pt-2 text-[11px] leading-5 text-ink-500">
        每条附所在资料与原文摘录，可回原文逐条核对
      </p>
    </div>
  );
}

/**
 * 审核流程 —— Z 字交替的四拍。
 *
 * 为什么从「四列平铺」改成左右交替：平铺的每一格都长得一样，视线一路滑到底
 * 什么也没记住；交替之后每一拍都要换边，眼睛被迫重新定位 —— 这就是节奏。
 *
 * ⚠️ **DOM 顺序始终是「文案在前、界面在后」**，视觉上的左右互换只靠
 * `lg:order-*`：屏幕阅读器与爬虫读到的顺序仍是 01→04，
 * 否则「环节 2 的图出现在环节 1 的文之前」会让人读错流程顺序。
 *
 * 右侧（或偶数拍的左侧）放的是该产品在这一步**真实的界面片段**
 * ——不是示意图，是从 app 里同一套视觉语言搬过来的小组件。
 */
export function WorkflowSection() {
  return (
    <section
      id="workflow"
      aria-labelledby="workflow-heading"
      className="scroll-mt-16 border-b border-ink-200 bg-white"
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
        <Reveal>
          <h2 id="workflow-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
            审核流程
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-600">
            五个环节，中间没有需要人工搬运的步骤：
            上传 → 提取正文 → 规则校验 → 输出报告 → 修正后重跑。
            每一步界面上都能看到它在做什么，以及做不了什么。
          </p>
        </Reveal>

        <ol className="mt-12 space-y-12 lg:space-y-20">
          {WORKFLOW.map((item, index) => {
            // 偶数拍（02 / 04）把界面片段换到左边，视觉重心左右交替。
            const flip = index % 2 === 1;
            return (
              <li key={item.step} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
                <Reveal className={flip ? "lg:order-2" : undefined}>
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-600 text-white"
                      aria-hidden="true"
                    >
                      <Icon name={item.icon} className="h-4 w-4" />
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-ink-400">
                      环节 {item.step} / 0{WORKFLOW.length}
                    </span>
                  </div>

                  <h3 className="mt-4 text-[clamp(1.25rem,2.2vw,1.75rem)] font-semibold leading-snug tracking-tight text-ink-900">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-ink-600">{item.detail}</p>
                </Reveal>

                <Reveal className={flip ? "lg:order-1" : undefined} delayMs={120}>
                  <div className="relative">
                    {/*
                      弥散光从 /12 + blur-3xl 降到 /10 + blur-2xl：
                      环境光还在，但不再把界面"推远"。这一轮的原则是主角 = 软件本身，
                      任何让界面看起来像贴在光晕上的装饰都要让位。
                    */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute -inset-5 rounded-3xl bg-brand-500/10 blur-2xl"
                    />
                    <div className="card relative p-5 shadow-[0_12px_32px_rgba(23,44,70,0.08)]">
                      <div className="card-soft p-3.5">
                        <WorkflowSnippet snippet={item.snippet} />
                      </div>
                      <p className="mt-3 text-[11px] leading-5 text-ink-500">{item.snippet.note}</p>
                    </div>
                  </div>
                </Reveal>
              </li>
            );
          })}
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

/**
 * 「系统做不到什么」—— 与安全机制同等重要，且必须放在同一屏里。
 *
 * 只写安全机制、不写边界，读起来就是一份自我表扬清单；
 * 客户真正想知道的恰恰是那些"没有"的部分（有没有认证、会不会拿去训练、删了还在不在）。
 */
const SECURITY_BOUNDARIES: ReadonlyArray<{ title: string; detail: string; icon: IconName }> = [
  {
    title: "未取得任何第三方安全认证",
    detail: "上列机制均为系统内已实现的行为，不构成认证声明。",
    icon: "shield",
  },
  {
    title: "资料不用于模型训练",
    detail: "当前未接入真实模型调用，AI 复核未启用（开发模拟 Provider）。",
    icon: "lock",
  },
  {
    title: "删除是软删除",
    detail: "删除后不再出现在列表中；服务端保留删除标记以便追溯，不是物理清除。",
    icon: "trash",
  },
];

/**
 * 「诚实边界」区 —— 明确知道什么，也明确知道什么还不能判断。
 *
 * 为什么单独占一屏：绝大多数工具只说前半句，
 * 而采购 / 风控岗位真正要判断的是后半句 —— 系统在哪些地方会保持沉默。
 * 一个愿意说「这个我判不了」的系统，比一个什么都敢给结论的系统可信。
 *
 * 右栏的示例不是编的：`CERTIFICATE_EXPIRY_UNKNOWN` 是 15 条规则里的真实一条，
 * 正文里只有相对期限（「30 个自然日」）时，它报「有效期无法判定」，**不推算日期**。
 */
export function BoundarySection() {
  return (
    <section aria-labelledby="boundary-heading" className="border-b border-ink-200 bg-band-alt">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-20">
        <Reveal>
          <h2 id="boundary-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
            明确知道什么，也明确知道什么还不能判断
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-600">
            系统只对资料里**实际存在且可解析**的信息下判断。
            遇到能读但没有可判定日期的表述，它报「无法判定」，而不是替你算一个日期出来 ——
            推算出来的日期看起来和实测到的一样可信，但它不是实测的。
          </p>
        </Reveal>

        <Reveal className="mt-10" delayMs={120}>
          <BoundaryPanel />
        </Reveal>

        <Reveal className="mt-10">
          {/*
            失败态与状态机放在这一屏的末尾：这一屏讲的是"系统的诚实"，
            而承认自己会失败，是诚实里最有说服力的一条。
          */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium text-ink-500">资料解析状态机（真实状态值）</p>
              <StateStrip active="READY" />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-ink-500">出错时长这样</p>
              <FailurePanel />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function SecuritySection() {
  return (
    <section aria-labelledby="security-heading" className="border-b border-ink-200 bg-band">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
        <Reveal>
          <h2 id="security-heading" className="text-2xl font-semibold tracking-tight text-ink-900">
            资料怎么被保管
          </h2>
          {/* 先给链路图，再给文字条目 —— 图让人一眼看懂边界在哪，条目负责说清每一环 */}
          <div className="mt-10">
            <StorageDiagram />
          </div>
        </Reveal>

        {/*
          Z 字错位：左边一块深色「边界声明」，右边四张浅色「已实现机制」卡片。
          深/浅的空间跳跃让这一屏在整页节奏里重新起一拍 ——
          更重要的是，把"做到了什么"和"没做到什么"并排放，读者一眼能对齐。
        */}
        {/*
          min-w-0：grid item 默认 min-width:auto，窄屏单列时会被内容的 min-content
          顶开轨道宽度，再被祖先的 overflow-hidden 裁掉（见 report-section 同处注释）。
        */}
        <div className="mt-12 grid gap-6 lg:grid-cols-5 lg:gap-8">
          <Reveal className="min-w-0 lg:col-span-2">
            <div className="h-full rounded-2xl bg-brand-900 p-6 text-white lg:p-7">
              <h3 className="text-base font-semibold text-white">先说清楚没做到的</h3>
              <ul className="mt-5 space-y-5">
                {SECURITY_BOUNDARIES.map((item) => (
                  <li key={item.title} className="flex gap-3">
                    <span
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-brand-100"
                      aria-hidden="true"
                    >
                      <Icon name={item.icon} className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <p className="mt-1 text-xs leading-6 text-white/70">{item.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          {/* 只陈述已实现的机制。未取得认证就不写认证 —— 见 docs/DESIGN.md §0 硬规则 2 */}
          <Reveal className="min-w-0 lg:col-span-3" delayMs={120}>
            <ul className="grid h-full gap-4 sm:grid-cols-2">
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
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function FinalCtaSection() {
  return (
    <section className="bg-brand-700">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 text-center lg:py-20">
        <h2 className="text-2xl font-semibold tracking-tight text-white lg:text-3xl">
          开始审核第一份供应商资料
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-brand-100">
          {/*
            CTA 写具体动作，不写「立即联系我们 / 了解更多」这类空号召。
            ⚠️ 这里曾经写「几十秒内就能看到第一份结论」。删掉时间：
            没有实测支撑的耗时是可证伪的承诺，换成一句描述产出物的话，既不夸大也不空。
          */}
          上传 PDF 或 ZIP，看系统怎么完成解析与规则审核 ——
          注册后选一个内置模板、上传资料包、点「开始审核」，就能拿到第一份逐条可追溯的结论。
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
            开始审核
          </Link>
          {/*
            示例报告是转化链路里最靠前的一环：客户不上传资料也能判断"查得准不准"。
            放在主 CTA 旁边而不是塞进导航 —— 犹豫的人需要的是证据，不是更多入口。
            按钮文案直接写产出物（审核结果示例），不写「了解更多」。
          */}
          <Link
            href="/sample-report"
            className="rounded-md border border-white/40 px-6 py-3 text-sm font-medium text-white hover:bg-white/10"
          >
            查看审核结果示例
          </Link>
        </div>
      </div>
    </section>
  );
}
