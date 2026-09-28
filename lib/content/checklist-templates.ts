/**
 * 公开内容页「资料核验清单」的内容源。
 *
 * ⚠️ 为什么是**类型化的 TS 数据模块**，不是 MDX、也不是裸 JSON：
 *
 * 1. **单一数据源。** 页面 DOM、JSON-LD、sitemap、CSV 下载、面包屑全部从这一份数据出。
 *    用 MDX 就等于把「文章正文」和「结构化数据」拆成两处，改了一处另一处必然漂移 ——
 *    而结构化数据说谎比不说更糟（Google 直接按它渲染搜索结果）。
 * 2. **编译期强制字段完整。** 接口里每一项都必须给 why / check / pitfalls，
 *    漏一个就编译失败 —— 这堵住了「内容农场式空壳页」：
 *    没有查验要点和雷区的清单条目，等于什么都没说。
 * 3. **零新依赖。** MDX 要装 @next/mdx + remark 一串包，而本镜像刻意保持
 *    「运行阶段完全离线、构建期依赖越少越好」（见 Dockerfile）。
 * 4. **内容是结构化清单，不是散文。** 资料项 / 查验要点 / 雷区 / 关联规则
 *    这种四段结构，markdown 表达不了，强行写会退化成一堆 bullet。
 *
 * 代价：长段落写作不如 MDX 舒服。补偿方式：段落用 string[]，一条 1–3 句，
 * 不引入富文本解析 —— 页面上的每一个字都应该是可直接渲染的纯文本。
 *
 * ⭐ 事实纪律：清单项与 `lib/templates/builtin.ts` 的「供应商准入审核」模板一一对应，
 * 关联规则一律写真实 ruleId（渲染时从 REVIEW_RULES 取标签与严重级别），
 * 页面上的规则名、严重级别永远和产品里的同一份定义一致，不在这里复制文案。
 */
import type { RuleId } from "@/lib/reviews/types";

export interface ChecklistItem {
  /** 与内置模板 requiredDocuments.key 对应。 */
  key: string;
  name: string;
  /** 必备 / 选备。与内置模板的 required 字段一致，不在这里另立标准。 */
  required: boolean;
  /** 为什么要收这份资料。不写「很重要」这种废话，写它在审核里挡住什么风险。 */
  why: string;
  /** 查验要点：逐条可执行的动作。 */
  check: string[];
  /** 雷区：实际审核中最容易漏掉或被糊弄过去的地方。 */
  pitfalls: string[];
  /** 关联审核规则。渲染时从 REVIEW_RULES 取真实标签。 */
  ruleIds: RuleId[];
}

export interface ChecklistTemplate {
  slug: string;
  /** 页面 <h1> 与 <title> 共用；同时进 JSON-LD 的 headline（Google 要求 ≤110 字符）。 */
  title: string;
  /** 摘要，同时用作 meta description。 */
  summary: string;
  /** 面向谁。写在页面上，不藏在关键词里。 */
  audience: string;
  /** 内容更新日期（真实日期，不用时间戳冒充频繁更新）。 */
  updatedAt: string;
  /** 开篇：直接切业务，不写「什么是供应商管理」。 */
  intro: string[];
  items: ChecklistItem[];
  /** 收尾：定性原则。这一节是产品边界的对外表达，不能省。 */
  closing: string[];
  /** 关联的内置审核模板 key（必须真实存在于 BUILTIN_TEMPLATES）。 */
  builtinTemplateKey: string;
}

export const CHECKLIST_TEMPLATES: readonly ChecklistTemplate[] = [
  {
    slug: "supplier-onboarding-checklist",
    title: "供应商准入资料核验清单：9 项资料 · 15 条核对规则",
    summary:
      "新供应商准入要收哪些资料、每项怎么验、哪些地方最容易漏：营业执照与统一社会信用代码、开户信息、纳税人资格、法人身份、体系认证有效期、检测报告与报价单金额一致性，附每条问题对应的核对规则与定性建议。",
    audience: "企业采购 · 供应链管理 · 合规与风控",
    updatedAt: "2026-09-27",
    intro: [
      "这份清单解决三件事：向供应商要求哪些资料、每份资料验到什么程度、验出问题怎么定性。",
      "它不是模板下载站里那种「资料目录」，每一条都对应一条可执行的核对动作 —— 也是企智审在审核时实际执行的规则。",
    ],
    builtinTemplateKey: "supplier-onboarding",
    items: [
      {
        key: "business-license",
        name: "营业执照",
        required: true,
        why: "确认签约主体真实存在、经营范围覆盖采购品类，且主体仍在存续期内。",
        check: [
          "统一社会信用代码 18 位，按 GB 32100 校验位算一遍（错一位就是假证或录入错误）",
          "执照上的企业名称与合同抬头、发票抬头完全一致",
          "营业期限未过期；若为长期，确认是否已被吊销或列入经营异常",
          "经营范围覆盖本次采购品类",
        ],
        pitfalls: [
          "只提供照片或模糊复印件，正文识别不全 → 代码与有效期读不出来，只能判「无法判定」",
          "名称已变更但仍用旧执照，与合同抬头对不上",
          "资料包里混入了分公司或关联公司的执照，出现多个信用代码",
        ],
        ruleIds: [
          "USCC_MISSING",
          "USCC_INVALID",
          "USCC_MULTIPLE",
          "COMPANY_NAME_CONFLICT",
          "CERTIFICATE_EXPIRED",
        ],
      },
      {
        key: "bank-account",
        name: "开户许可证 / 基本存款账户信息",
        required: true,
        why: "付款账户必须与签约主体同名，这是资金安全的底线。",
        check: [
          "账户名称与营业执照上的企业名称逐字一致",
          "银行账号完整（位数与开户行的规则相符）",
          "开户行名称清晰可辨，能定位到具体支行",
        ],
        pitfalls: [
          "账户名是关联公司甚至个人 —— 最常见的付款风险，执照对不上却能拖到付款环节才暴露",
          "变更开户行后未更新资料，打款时才发现退汇",
        ],
        ruleIds: ["REQUIRED_DOCUMENT_MISSING", "COMPANY_NAME_CONFLICT", "PLACEHOLDER_CONTENT"],
      },
      {
        key: "taxpayer-status",
        name: "纳税人资格证明",
        required: true,
        why: "决定对方能开什么票、税率多少，直接影响成本测算。",
        check: [
          "一般纳税人资格有效（若为小规模，明确能否代开专票）",
          "三证合一后，纳税人识别号应与统一社会信用代码一致",
        ],
        pitfalls: [
          "提供的是旧税号的资格证明，与执照上的信用代码对不上",
          "只有网页截图、无公章，无法作为留存凭证",
        ],
        ruleIds: ["REQUIRED_DOCUMENT_MISSING", "USCC_INVALID"],
      },
      {
        key: "legal-person-id",
        name: "法定代表人身份证明",
        required: true,
        why: "确认签约人与授权链，避免「谁都能代表这家公司」。",
        check: [
          "法人姓名与营业执照、授权委托书三处一致",
          "身份证件在有效期内",
          "若非法人本人签约，同时要授权委托书",
        ],
        pitfalls: [
          "法人已工商变更，但资料包里还是上任法人的证件",
          "授权书上的被授权人与实际对接人不一致",
        ],
        ruleIds: ["COMPANY_NAME_CONFLICT", "SUPPLIER_NAME_NOT_FOUND"],
      },
      {
        key: "iso-9001",
        name: "ISO 9001 质量管理体系认证",
        required: true,
        why: "体系认证是多数企业的准入门槛，但它的价值取决于「是否还在有效期内、范围是否覆盖」。",
        check: [
          "证书有效期的起止日期完整，未过期",
          "认证范围覆盖本次采购的产品或服务",
          "发证机构可查（认证机构名称在证书上明确）",
        ],
        pitfalls: [
          "证书已过期仍在提供 —— 准入审核里最高频的阻断项",
          "认证范围只覆盖甲产品，实际采购的是乙产品",
          "只有英文证书且未标注有效期格式，导致有效期判不出来，只能定性为「无法判定」",
        ],
        ruleIds: ["CERTIFICATE_EXPIRED", "CERTIFICATE_EXPIRING_SOON", "CERTIFICATE_EXPIRY_UNKNOWN"],
      },
      {
        key: "iso-14001",
        name: "ISO 14001 环境管理体系认证",
        required: false,
        why: "非必备项，通常是特定行业或客户的附加要求；缺失只作提示，不构成阻断。",
        check: ["有效期与认证范围，核对方式同 ISO 9001"],
        pitfalls: ["把其他体系证书当成环境体系证书提交，名称对不上"],
        ruleIds: ["OPTIONAL_DOCUMENT_MISSING", "CERTIFICATE_EXPIRED"],
      },
      {
        key: "product-certification",
        name: "产品认证 / 检测报告",
        required: true,
        why: "证明货本身达标，而不是公司达标。",
        check: [
          "报告出具日期与有效期（部分行业默认有效期，需按行业惯例判断）",
          "检测样品的型号规格与本次采购型号一致",
          "出具机构具备相应资质，报告有结论页（不只是送样照片）",
        ],
        pitfalls: [
          "检测报告是同系列其他型号，型号对不上等于没提供",
          "只给了封面或送样照片，没有结论页",
          "报告已过行业默认有效期，但供应商仍在沿用",
        ],
        ruleIds: ["REQUIRED_DOCUMENT_MISSING", "CERTIFICATE_EXPIRED", "PLACEHOLDER_CONTENT"],
      },
      {
        key: "quotation",
        name: "报价单",
        required: true,
        why: "金额一致性是比价的前提，报价单出错会让整个比价失去意义。",
        check: [
          "单价 × 数量 = 分项金额，分项合计 = 总价",
          "大小写金额一致（中文大写与阿拉伯数字）",
          "标注含税 / 不含税、币种、报价有效期",
        ],
        pitfalls: [
          "大小写金额不一致 —— 结算时扯皮的源头",
          "模板里的 XXX、待填写等占位符没清掉，等于报了个无效价",
          "只给截图，无法逐项核算金额",
        ],
        ruleIds: ["AMOUNT_MISMATCH", "PLACEHOLDER_CONTENT", "REQUIRED_DOCUMENT_MISSING"],
      },
      {
        key: "commercial-terms",
        name: "商务条款（付款 / 交期 / 质保）",
        required: false,
        why: "非必备，但没有它，后续履约争议没有书面依据。",
        check: ["付款方式与账期", "交货期与交付方式", "质保期与违约责任"],
        pitfalls: ["条款只在邮件里口头确认，资料包里没有书面版本"],
        ruleIds: ["OPTIONAL_DOCUMENT_MISSING", "PLACEHOLDER_CONTENT"],
      },
    ],
    closing: [
      "定性建议：证照已过期、必备资料缺失这类问题属于阻断项，未补正前不建议通过；临近到期、名称不一致属于待确认项，需要人工核实后再定性。",
      "这份清单只负责把可疑点找出来并给出证据，是否准入由审核人决定 —— 系统不替企业判定供应商是否合格。",
    ],
  },
  {
    slug: "qualification-validity-checklist",
    title: "资质有效期专项核验清单：证照过期与年审遗漏怎么查",
    summary:
      "只解决一件事：供应商的证照此刻是否仍然有效。营业执照营业期限、管理体系认证的有效期与监督审核、产品认证与检测报告的年度更新，以及「已过期 / 临近到期 / 判不出来」三种情况分别怎么定性。",
    audience: "需要管理年审与续期的采购 · 供应链 · 合规团队",
    updatedAt: "2026-09-27",
    intro: [
      "准入审核里出问题最多的不是「没有证」，而是「证还在资料包里、但已经过期了」——证件交上来三年没人再看一眼。",
      "这一篇只讲有效期：哪几类证照最常踩雷、每种看什么字段、以及查不出来的时候该定性为什么。",
    ],
    builtinTemplateKey: "qualification-validity",
    items: [
      {
        key: "business-license",
        name: "营业执照营业期限",
        required: true,
        why: "营业期限是主体资格最硬的时间边界：到期未续，签约主体本身可能已不在存续状态。",
        check: [
          "看「营业期限」栏的截止日期，而不是成立日期",
          "写「长期 / 永久 / ***」属于**明确没有到期日**，不算漏项，但仍需确认主体存续",
          "分公司、子公司各看各的执照，不能用母公司执照替代签约主体",
        ],
        pitfalls: [
          "只拍了执照正本的上半部分，营业期限那一栏没进资料包 → 有效期直接判不出来",
          "换发后旧执照仍留在资料包里，两个日期对不上",
          "集团统一提供母公司执照，实际签约的却是子公司",
        ],
        ruleIds: [
          "REQUIRED_DOCUMENT_MISSING",
          "CERTIFICATE_EXPIRED",
          "CERTIFICATE_EXPIRING_SOON",
          "CERTIFICATE_EXPIRY_UNKNOWN",
        ],
      },
      {
        key: "management-system-cert",
        name: "管理体系认证证书（ISO 9001 / 14001 / 45001）",
        required: true,
        why: "体系认证的价值取决于它此刻是否仍然有效，以及是否按期完成监督审核 —— 拿到证书不等于一直持有。",
        check: [
          "以证书上印刷的「有效期至」为准，不要按行业惯例推断年限（不同机构、不同体系的实际安排并不一致）",
          "认证范围是否覆盖本次采购的产品或服务",
          "是否按期完成监督审核 / 再认证：证书标注或单独的监督审核通知都要看",
        ],
        pitfalls: [
          "证书已过期仍在提供 —— 准入审核里最高频的阻断项，默认按「严重」报出",
          "只拍了带 Logo 的封面页，没拍到带有效期的那一页",
          "认证范围只覆盖甲产品，实际采购的是乙产品：有效期没问题是「有效性」仍不足",
          "英文证书没有可解析的日期格式，系统只能报「有效期无法判定」，不能替你猜",
        ],
        ruleIds: [
          "CERTIFICATE_EXPIRED",
          "CERTIFICATE_EXPIRING_SOON",
          "CERTIFICATE_EXPIRY_UNKNOWN",
          "DOCUMENT_TEXT_TRUNCATED",
        ],
      },
      {
        key: "product-certification",
        name: "产品认证 / 检测报告（含境外合规证书）",
        required: false,
        why: "产品资质的更新节奏各不相同（年度注册、到期续证、按行业惯例复检），最容易在年审节点被漏掉。",
        check: [
          "证书或报告上印刷的到期日；没有到期日的，按所在行业的复检惯例判断",
          "境外合规资质（如 FDA 注册、CE 证书）按发证机构或注册系统的更新要求，核对年度状态",
          "型号 / 规格与本次采购一致 —— 这是有效期之外的第二道关",
        ],
        pitfalls: [
          "拿「曾经注册过」的截图当现行有效凭证：年度更新没做，状态已经失效",
          "只有封面与送样页，没有结论页和日期页",
          "报告型号与采购型号不一致，有效期再长也不算数",
        ],
        ruleIds: [
          "OPTIONAL_DOCUMENT_MISSING",
          "CERTIFICATE_EXPIRED",
          "CERTIFICATE_EXPIRING_SOON",
          "DOCUMENT_UNREADABLE",
        ],
      },
    ],
    closing: [
      "定性建议：有效期已过 → 阻断项（严重），未续期前不作为准入依据；临近到期 → 高，按「资质有效期专项审核」模板默认的 120 天预警阈值提前要求续期；有效期判不出来 → 只作提示，必须人工看原件，不做推算。",
      "能力边界要一并说清：系统只在**文件正文**里找「有效期」并做日期比对，不连接任何官方数据库，也不核验发证机构真伪。FDA 注册、CE 证书这类境外资质的当前注册状态，仍需人工到官方系统核对 —— 系统能提醒你「这份证的有效期读不出来」，但不能替你确认它是不是真证。",
      "判定权始终在人手里：系统给出证据与定性建议，是否准入由审核人决定。",
    ],
  },
];

export function findChecklistTemplate(slug: string): ChecklistTemplate | undefined {
  return CHECKLIST_TEMPLATES.find((template) => template.slug === slug);
}
