/**
 * 内置审核模板。
 *
 * 为什么不入库：内置模板随产品演进（加一条必备资料、调一个预警天数），
 * 入库就意味着每次升级都要跑一次数据迁移，还会和用户已经改过的副本打架。
 * 它们是**代码常量**，用户想改就「另存为自定义模板」。
 *
 * 三个模板覆盖三类真实场景，命名与关键词都按中文资料的实际写法来：
 * 关键词是「文档正文里是否出现」，用户能一眼看懂为什么判定了「已提供」。
 */
import type { TemplateConfig } from "./types";

export interface BuiltinTemplate {
  /** 稳定 key，与 `builtin:` 前缀拼成完整标识。 */
  key: string;
  name: string;
  description: string;
  config: TemplateConfig;
}

/** 全部内置规则 id。模板启用规则时以此为准 —— 规则清单只有一份，见 lib/reviews/rules.ts。 */
export const ALL_RULE_IDS = [
  "REQUIRED_DOCUMENT_MISSING",
  "OPTIONAL_DOCUMENT_MISSING",
  "DOCUMENT_UNREADABLE",
  "DOCUMENT_NOT_READY",
  "DOCUMENT_TEXT_TRUNCATED",
  "USCC_MISSING",
  "USCC_INVALID",
  "USCC_MULTIPLE",
  "COMPANY_NAME_CONFLICT",
  "SUPPLIER_NAME_NOT_FOUND",
  "CERTIFICATE_EXPIRED",
  "CERTIFICATE_EXPIRING_SOON",
  "CERTIFICATE_EXPIRY_UNKNOWN",
  "AMOUNT_MISMATCH",
  "PLACEHOLDER_CONTENT",
] as const;

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  {
    key: "supplier-onboarding",
    name: "供应商准入审核",
    description:
      "面向新供应商准入：核对营业执照、开户信息、纳税人资格、体系认证与报价资料是否齐备，并检查证照有效期与主体一致性。",
    config: {
      expiryWarningDays: 90,
      enabledRules: [...ALL_RULE_IDS],
      requiredDocuments: [
        {
          key: "business-license",
          label: "营业执照",
          keywords: ["营业执照", "统一社会信用代码", "市场主体登记"],
          required: true,
        },
        {
          key: "bank-account",
          label: "开户许可证 / 基本存款账户信息",
          keywords: ["开户许可证", "基本存款账户", "开户银行", "银行账号"],
          required: true,
        },
        {
          key: "taxpayer-status",
          label: "纳税人资格证明",
          keywords: ["一般纳税人", "纳税人资格", "税务登记"],
          required: true,
        },
        {
          key: "legal-person-id",
          label: "法定代表人身份证明",
          keywords: ["法定代表人", "法人身份证", "法人代表"],
          required: true,
        },
        {
          key: "iso-9001",
          label: "ISO 9001 质量管理体系认证",
          keywords: ["ISO 9001", "ISO9001", "质量管理体系"],
          required: true,
        },
        {
          key: "iso-14001",
          label: "ISO 14001 环境管理体系认证",
          keywords: ["ISO 14001", "ISO14001", "环境管理体系"],
          required: false,
        },
        {
          key: "product-certification",
          label: "产品认证 / 检测报告",
          keywords: ["CE 认证", "CE认证", "检验报告", "检测报告", "试验报告", "第三方检测"],
          required: true,
        },
        {
          key: "quotation",
          label: "报价单",
          keywords: ["报价单", "报价明细", "报价总表", "单价", "总价"],
          required: true,
        },
        {
          key: "commercial-terms",
          label: "商务条款（付款 / 交期 / 质保）",
          keywords: ["付款方式", "交货期", "质保期", "商务条款", "结算方式"],
          required: false,
        },
      ],
    },
  },
  {
    key: "qualification-validity",
    name: "资质有效期专项审核",
    description:
      "只做一件事：把所有证照与体系认证的有效期找出来，标出已过期与临近到期的项，并列出无法判定有效期的证书。",
    config: {
      expiryWarningDays: 120,
      enabledRules: [
        "REQUIRED_DOCUMENT_MISSING",
        "DOCUMENT_UNREADABLE",
        "DOCUMENT_NOT_READY",
        "DOCUMENT_TEXT_TRUNCATED",
        "CERTIFICATE_EXPIRED",
        "CERTIFICATE_EXPIRING_SOON",
        "CERTIFICATE_EXPIRY_UNKNOWN",
      ],
      requiredDocuments: [
        {
          key: "business-license",
          label: "营业执照",
          keywords: ["营业执照", "统一社会信用代码"],
          required: true,
        },
        {
          key: "management-system-cert",
          label: "管理体系认证证书",
          keywords: ["ISO 9001", "ISO9001", "ISO 14001", "ISO14001", "ISO 45001", "管理体系认证"],
          required: true,
        },
        {
          key: "product-certification",
          label: "产品认证 / 检测报告",
          keywords: ["CE 认证", "CE认证", "检验报告", "检测报告", "第三方检测"],
          required: false,
        },
      ],
    },
  },
  {
    key: "commercial-quote",
    name: "报价与商务条款核对",
    description:
      "面向比价环节：检查报价单是否提供、金额大小写是否一致、以及是否存在未填写的占位内容，避免拿一份没填完的报价去比价。",
    config: {
      expiryWarningDays: 30,
      enabledRules: [
        "REQUIRED_DOCUMENT_MISSING",
        "DOCUMENT_UNREADABLE",
        "DOCUMENT_NOT_READY",
        "DOCUMENT_TEXT_TRUNCATED",
        "AMOUNT_MISMATCH",
        "PLACEHOLDER_CONTENT",
        "USCC_INVALID",
      ],
      requiredDocuments: [
        {
          key: "quotation",
          label: "报价单",
          keywords: ["报价单", "报价明细", "报价总表", "单价", "总价"],
          required: true,
        },
        {
          key: "commercial-terms",
          label: "商务条款（付款 / 交期 / 质保）",
          keywords: ["付款方式", "交货期", "质保期", "商务条款", "结算方式"],
          required: true,
        },
      ],
    },
  },
];

export function findBuiltinTemplate(key: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find((template) => template.key === key);
}
