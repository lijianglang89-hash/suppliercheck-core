/**
 * 业务场景（首页 `#scenarios` 的内容源）。
 *
 * 为什么要有这一区：V2.0 之前的首页一直在回答「这个系统能做什么」，
 * 却没回答「**我**什么时候会用到它」。访客是采购、供应链、合规岗，
 * 他们认场景、不认功能清单。
 *
 * ⭐ 三条硬纪律：
 *
 * 1. **场景必须落在真实规则上。** 每个场景的 `ruleIds` 都是 `RuleId` 联合类型的值，
 *    写错一个字编译不过；`tests/unit/content-scenarios.test.ts` 再兜一层，
 *    确认它们真的在 `REVIEW_RULES` 里。不能出现"系统会帮你评估供应商风险"
 *    这种既不指向规则、也无法复算的表述。
 * 2. **不写"我们服务了 N 家企业"。** 没有可核验的客户清单，就不写客户数量 ——
 *    这类数字无法自证，写出来只是把信任建立在一句不可查的话上。
 * 3. **不承诺"AI 判断"。** 模型复核尚未启用；场景里只描述确定性规则确实会做的事。
 */
import type { IconName } from "@/components/ui/icons";
import type { RuleId } from "@/lib/reviews/types";

export interface BusinessScenario {
  id: string;
  /** 场景名，用做这一格的小标题。 */
  title: string;
  /** 谁在做 —— 让对应岗位的访客第一眼认领。 */
  role: string;
  /** 什么时候做 —— 触发条件。 */
  trigger: string;
  /** 系统实际做什么。每一条都必须能对应到下面某个 ruleId。 */
  steps: readonly string[];
  /** 拿到什么 —— 交付物。 */
  outcome: string;
  /** 该场景真正依赖的规则。全部来自 lib/reviews/rules.ts。 */
  ruleIds: readonly RuleId[];
  icon: IconName;
}

export const BUSINESS_SCENARIOS: readonly BusinessScenario[] = [
  {
    id: "onboarding",
    title: "新供应商准入",
    role: "采购 / 供应链",
    trigger: "供应商首次合作前，一次性发来一整套资料",
    steps: [
      "自动展开 ZIP 资料包，逐个识别文件类型并提取正文",
      "按模板的必备 / 选备清单逐项比对，报出缺了哪一项",
      "识别「XXX / 待补充」这类占位内容 —— 空白模板常因标题含关键词而被误判为已提供",
    ],
    outcome: "一份「缺什么」的清单，可以直接发给供应商补件，不用自己逐份翻。",
    ruleIds: ["REQUIRED_DOCUMENT_MISSING", "OPTIONAL_DOCUMENT_MISSING", "PLACEHOLDER_CONTENT"],
    icon: "inbox",
  },
  {
    id: "renewal",
    title: "年度复审与到期换证",
    role: "合规 / 风控",
    trigger: "存量供应商年度复审，或某张证照临近到期",
    steps: [
      "解析正文里的「有效期至 X 年 X 月 X 日」，按判定基准日算出差额",
      "分三档报出：已过期 / 距到期不足预警天数 / 无法判定",
      "写的是相对期限（如「30 个自然日」）时如实报「判不了」，不做推算",
    ],
    outcome: "一眼看出哪家供应商的哪张证书要先处理，以及还剩多少天。",
    ruleIds: ["CERTIFICATE_EXPIRED", "CERTIFICATE_EXPIRING_SOON", "CERTIFICATE_EXPIRY_UNKNOWN"],
    icon: "clock",
  },
  {
    id: "identity",
    title: "主体一致性核对",
    role: "采购 / 财务",
    trigger: "一次收到营业执照、开户资料、合同等多份文件",
    steps: [
      "从各份资料正文里抽取统一社会信用代码与企业名称",
      "按 GB 32100-2015 校验第 18 位校验码，格式不合法直接报出",
      "跨文件比对主体名称；出现两个及以上名称时提示人工确认归属",
    ],
    outcome: "把「同一批资料是不是同一个主体」这件事先摆出来，避免签约后才发现。",
    ruleIds: [
      "USCC_MISSING",
      "USCC_INVALID",
      "USCC_MULTIPLE",
      "COMPANY_NAME_CONFLICT",
      "SUPPLIER_NAME_NOT_FOUND",
    ],
    icon: "building",
  },
  {
    id: "scan",
    title: "只拿到扫描件或照片",
    role: "采购",
    trigger: "供应商没有电子版，只给了拍照件 / 扫描件",
    steps: [
      "解析完成后先看正文长度，判断这份资料到底有没有可用的文字",
      "没有文字层就如实报「无可提取正文」，不用相似图片或推测内容顶替",
      "正文触及提取上限时报出「覆盖度不足」，说明超出的部分没有参与核对",
    ],
    outcome: "明确知道哪几份资料这次没审到、为什么 —— 而不是拿到一份看起来完整、其实漏审的报告。",
    ruleIds: ["DOCUMENT_NOT_READY", "DOCUMENT_UNREADABLE", "DOCUMENT_TEXT_TRUNCATED"],
    icon: "image",
  },
];

/**
 * 全部场景引用到的规则，去重后按 RULE_IDS 顺序排列 —— 用于区块底部的「图例」，
 * 让访客知道上列场景没有穷尽规则库，清单在 `/#rules`。
 */
export const SCENARIO_COVERED_RULES: readonly RuleId[] = [
  ...new Set(BUSINESS_SCENARIOS.flatMap((scenario) => scenario.ruleIds)),
];
