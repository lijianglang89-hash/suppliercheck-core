/**
 * 示例审核报告（/sample-report）的内容源。
 *
 * 为什么要有这一页：B2B 客户在上传自己的机密资料之前，最大的顾虑不是价格，
 * 而是「买家秀与卖家秀」—— 你说能查 15 条，我怎么知道查出来是什么样。
 * 这一页把**报告的样子**直接摊开：规则、严重级别、原文摘录、建议，一条不少。
 *
 * ⭐ 三条硬纪律（比"好看"重要）：
 *
 * 1. **只引用真实存在的规则。** ruleId 的类型就是 `RuleId`，写错一个字编译不过；
 *    标题与详情也照真实引擎的措辞写（例如过期那条会带上判定基准日与天数），
 *    不另造一套"看起来更专业"的说法 —— 客户照着示例去跑真实资料，措辞对不上就是欺骗。
 * 2. **判定基准日写死。** 有效期结论依赖基准日；用 `new Date()` 会让示例结论随时间漂移
 *    （今天"未过期"的证书，明年就变成"已过期 300 天"）。写死并注明，结论才可复算。
 * 3. **示例主体用中性名。** 「示例科技有限公司」—— 示例就是示例，不指向任何真实企业。
 *
 * 页面 DOM 与 `/reports/[reviewId]` 的真实报告保持同构（元信息 → 结论概览 → 按类别分组 → 声明），
 * 这样客户看到的示例和他自己跑出来的报告是同一个东西。
 */
import type { FindingCategory, RuleId, Severity } from "@/lib/reviews/types";

export interface SampleFinding {
  id: string;
  ruleId: RuleId;
  category: FindingCategory;
  severity: Severity;
  /** 与真实 Finding.title 对应。 */
  title: string;
  /** 与真实 Finding.detail 对应：写清判据与依据，不写"存在风险"这种空话。 */
  detail: string;
  /** 所在资料；缺失类发现没有来源文件，为空。 */
  documentLabel: string;
  /** 原文摘录。真实报告里是解析器从正文里截出来的片段。 */
  evidence: string;
  recommendation: string;
}

export const SAMPLE_REPORT = {
  /**
   * 判定基准日。有效期比对以这一天为准 —— 写死，并在页面上标注，
   * 否则示例的结论会随访问日期漂移，变成一份不可复算的"演示"。
   */
  baseDate: "2026-09-27",
  /** 示例主体。中性名，不指向任何真实企业。 */
  supplierName: "示例科技有限公司",
  templateName: "供应商准入审核",
  /**
   * 资料包里的实际文件。
   *
   * ⭐ 这份清单是**首页与示例报告共用的唯一来源**：落地页的左栏资料列表直接读它，
   * 不在 landing 组件里另抄一份 —— 抄一份就会漂移，而数字漂移是本项目的头号事故源。
   *
   * `state` 是真实文档状态机的值（UPLOADED / PROCESSING / READY / FAILED）。
   * 注意扫描件是 **READY 而不是 FAILED**：解析本身成功了，只是正文长度为 0
   * —— 系统如实报「无可提取正文」（规则 DOCUMENT_UNREADABLE），不把解析成功说成失败。
   */
  documents: [
    { name: "营业执照.pdf", ext: "pdf", state: "READY" },
    { name: "ISO9001 证书.pdf", ext: "pdf", state: "READY" },
    { name: "ISO14001 证书.pdf", ext: "pdf", state: "READY" },
    { name: "报价单.xlsx", ext: "xlsx", state: "READY" },
    { name: "商务条款.docx", ext: "docx", state: "READY" },
    {
      name: "开户许可证扫描件.pdf",
      ext: "pdf",
      state: "READY",
      note: "无文字层，未参与核对",
    },
  ],
  /** 资料份数 = documents.length。这两个数字必须与清单、与 findings 引用的文件自洽。 */
  documentCount: 6,
  /** 参与核对的份数 = 去掉无正文的扫描件。 */
  readableDocumentCount: 5,
  totalCharacters: 38_420,
  /** 取自该内置模板的真实配置（BUILTIN_TEMPLATES 里 supplier-onboarding 的 expiryWarningDays）。 */
  expiryWarningDays: 90,
  coverageNotes: [
    "检测报告.pdf 未纳入匹配：资料包中未找到该文件（必备资料缺失）。",
    "开户许可证扫描件.pdf：无可提取正文（疑似扫描件，无文本层），未参与核对。",
    "其余 5 份资料正文合计 38,420 字符，全部纳入匹配。",
  ],
  findings: [
    {
      id: "sample-1",
      ruleId: "CERTIFICATE_EXPIRED",
      category: "VALIDITY",
      severity: "CRITICAL",
      title: "证照已过期：ISO9001 证书.pdf",
      detail:
        "解析到的有效期截止日为 2026-08-15，已过期 43 天（判定基准日 2026-09-27）。",
      documentLabel: "ISO9001 证书.pdf",
      evidence: "有效期至：2026 年 08 月 15 日",
      recommendation: "请供应商提供续期后的新证书；过期证书不得作为准入依据。",
    },
    {
      id: "sample-2",
      ruleId: "COMPANY_NAME_CONFLICT",
      category: "ENTITY",
      // 真实默认级别就是「低」：系统只提示存在多个名称，不替审核员判定是不是同一主体。
      // （这条是被单测钉住的 —— 曾经按直觉写成 HIGH，与规则定义不符。）
      severity: "LOW",
      title: "疑似存在多个企业主体",
      detail:
        "从资料正文抽取到 2 个企业名称（示例科技有限公司、示例科技股份有限公司），剔除认证机构与银行等明显第三方后仍不一致。",
      documentLabel: "营业执照.pdf / 开户许可证扫描件.pdf",
      evidence: "执照：示例科技有限公司；开户名称：示例科技股份有限公司",
      recommendation: "请供应商说明是否为同一主体的名称变更，并提供工商变更证明后再定性。",
    },
    {
      id: "sample-3",
      ruleId: "CERTIFICATE_EXPIRING_SOON",
      category: "VALIDITY",
      severity: "HIGH",
      title: "证照即将到期：ISO14001 证书.pdf",
      detail: "有效期截止日为 2026-11-20，距判定基准日仅剩 54 天（预警阈值 90 天）。",
      documentLabel: "ISO14001 证书.pdf",
      evidence: "证书有效期：2023-11-21 至 2026-11-20",
      recommendation: "建议在签约或下订单前要求供应商完成续期，避免履约期内证书失效。",
    },
    {
      id: "sample-4",
      ruleId: "REQUIRED_DOCUMENT_MISSING",
      category: "COMPLETENESS",
      severity: "HIGH",
      title: "必备资料缺失：检测报告",
      detail:
        "按模板的必备资料清单逐项检查，全部资料正文中均未出现该项关键词（检测报告 / 检验报告 / 第三方检测）。",
      documentLabel: "",
      evidence: "",
      recommendation: "请供应商补充该产品对应的第三方检测报告。",
    },
    {
      id: "sample-5",
      ruleId: "AMOUNT_MISMATCH",
      category: "CONSISTENCY",
      severity: "HIGH",
      title: "金额大小写不一致：报价单.xlsx",
      detail: "中文大写金额与同一份资料内的阿拉伯数字金额数值不一致。",
      documentLabel: "报价单.xlsx",
      evidence: "报价总金额：壹拾柒万伍仟元整（¥175,500.00）",
      recommendation: "请供应商确认以哪个金额为准并重新出具报价单。",
    },
    {
      id: "sample-6",
      ruleId: "PLACEHOLDER_CONTENT",
      category: "COMPLETENESS",
      severity: "MEDIUM",
      title: "存在未填写的占位内容：商务条款.docx",
      detail:
        "识别到 3 处未填写标记（XXX / 待补充）。空白模板常因标题含关键词而被误判为「已提供」，这条规则用来兜住它。",
      documentLabel: "商务条款.docx",
      evidence: "质保期：XXX 个月；结算方式：待补充",
      recommendation: "请供应商填写完整后重新提交。",
    },
    {
      id: "sample-7",
      ruleId: "DOCUMENT_UNREADABLE",
      category: "READABILITY",
      severity: "HIGH",
      title: "资料无可提取正文：开户许可证扫描件.pdf",
      detail:
        "解析已完成，但正文长度不足，常见于扫描件（无文本层）与纯图片附件。系统不伪造内容，因此如实报出「审不了」。",
      documentLabel: "开户许可证扫描件.pdf",
      evidence: "",
      recommendation: "请提供带文字层的 PDF 或清晰的原件照片。",
    },
    {
      id: "sample-8",
      ruleId: "CERTIFICATE_EXPIRY_UNKNOWN",
      category: "VALIDITY",
      severity: "LOW",
      title: "有效期无法判定：报价单.xlsx",
      detail:
        "正文中出现了「有效期」但没有跟着一个可解析的日期。如实报出「判不了」，不做推算。",
      documentLabel: "报价单.xlsx",
      evidence: "报价有效期：30 个自然日",
      recommendation: "请供应商写明报价有效期的截止日期（或明确长期有效）。",
    },
  ],
} satisfies {
  baseDate: string;
  supplierName: string;
  templateName: string;
  documents: {
    name: string;
    ext: string;
    state: "UPLOADED" | "PROCESSING" | "READY" | "FAILED";
    note?: string;
  }[];
  documentCount: number;
  readableDocumentCount: number;
  totalCharacters: number;
  expiryWarningDays: number;
  coverageNotes: string[];
  findings: SampleFinding[];
};
