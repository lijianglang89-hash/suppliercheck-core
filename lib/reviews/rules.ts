/**
 * 确定性审核规则。
 *
 * 每条规则都是一个纯函数：`(上下文) => 发现[]`。没有网络、没有模型、没有随机数，
 * 同样的输入必然产出同样的发现 —— 这正是「审核结论可复现」的全部含义。
 *
 * ## 三条写规则时必须遵守的纪律
 *
 * 1. **不制造假阳性。** 无法唯一确定时**不下结论**，而不是给一个「大概」的结论。
 *    典型例子：文档里有多个金额时不做大小写比对（见 AMOUNT_MISMATCH），
 *    因为无法知道哪一个小写金额对应哪一个大写金额 —— 猜错就是诬告。
 *
 * 2. **错误代价不对称。** 漏掉一个问题 vs 冤枉一份合格资料，后者的代价更高：
 *    它会训练用户忽略告警。所以能确定的报高等级，不确定的报低等级或干脆不报。
 *
 * 3. **详情里必须写清判定依据。** 每条 finding 的 detail 都要说明「查了什么、
 *    查了哪些资料、用的是什么关键词」。用户看不懂为什么被报，就等于没有这条规则。
 */
import type { TemplateConfig } from "@/lib/templates/types";

import {
  clampExcerpt,
  excerptAround,
  findChineseAmounts,
  findCompanyNames,
  findDates,
  findExpiryWindows,
  findLongTermMarkers,
  findPlaceholders,
  findSmallAmounts,
  findUsccCandidates,
  countMatches,
  daysBetween,
  isoToUtcDate,
  normalizeForMatch,
  utcToday,
} from "./extract";
import type {
  DraftFinding,
  FindingCategory,
  ReviewDocumentInput,
  RuleId,
  Severity,
} from "./types";

export interface RuleContext {
  /** 本次纳入审核的文档（含正文）。 */
  documents: ReviewDocumentInput[];
  config: TemplateConfig;
  /** 关联的供应商名称；未关联时为 null，相关规则自动跳过。 */
  supplierName: string | null;
  /** 申报主体的统一社会信用代码；未登记时为 null。 */
  supplierUscc: string | null;
  /** 判定「今天」的基准。显式传入而不是读系统时钟，规则才可测。 */
  now: Date;
}

export interface ReviewRuleDefinition {
  id: RuleId;
  label: string;
  category: FindingCategory;
  defaultSeverity: Severity;
  /** 一句话说明这条规则查什么。会展示在模板页与报告页 —— 用户有权知道被查了什么。 */
  description: string;
  evaluate(context: RuleContext): DraftFinding[];
}

/** 低于这个字符数视为「没有可用正文」。PDF 扫描件、纯图片附件都会落到这里。 */
export const MIN_READABLE_CHARS = 30;

/** 单条规则在单份资料上的产出上限。防止一份畸形文档把报告淹没。 */
export const MAX_FINDINGS_PER_DOCUMENT = 10;

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function readableDocuments(documents: ReviewDocumentInput[]): ReviewDocumentInput[] {
  return documents.filter(
    (document) => document.status === "READY" && document.charCount >= MIN_READABLE_CHARS,
  );
}

/** 可读资料的数量说明，用于让「缺少资料」这类结论如实交代搜索范围。 */
function searchScopeNote(documents: ReviewDocumentInput[]): string {
  const readable = readableDocuments(documents).length;
  const unreadable = documents.length - readable;
  if (unreadable === 0) {
    return `在本次审核的 ${documents.length} 份资料中检索`;
  }
  return `在 ${readable} 份可读资料中检索（另有 ${unreadable} 份未能提取正文，未参与匹配）`;
}

function documentLabelOf(document: ReviewDocumentInput): string {
  return document.originalFilename || document.label;
}

/**
 * 第三方机构名称识别。
 *
 * 用途只有一个：把认证机构、检测机构、银行这类**必然出现的外部主体**
 * 从「主体一致性」比对里排除。排除名单是白名单式的窄模式，
 * 宁可漏排（多报一条）也不误排（少报一条真问题）。
 */
const THIRD_PARTY_PATTERN =
  /(认证|检测|检验|测试|计量|事务所|会计师事务所|律师事务所|评估|保险|银行|研究院|标准化|质量监督)/;

/* ------------------------------------------------------------------ */
/* 规则：资料完整性                                                    */
/* ------------------------------------------------------------------ */

function missingDocumentFindings(
  context: RuleContext,
  mode: "required" | "optional",
): DraftFinding[] {
  const wantRequired = mode === "required";
  const specs = context.config.requiredDocuments.filter((spec) => spec.required === wantRequired);
  if (specs.length === 0) return [];

  const scope = searchScopeNote(context.documents);

  return specs.flatMap<DraftFinding>((spec) => {
    const found = context.documents.some((document) => {
      const text = normalizeForMatch(document.text);
      return spec.keywords.some((keyword) => text.includes(normalizeForMatch(keyword)));
    });
    if (found) return [];

    return [
      {
        ruleId: wantRequired ? "REQUIRED_DOCUMENT_MISSING" : "OPTIONAL_DOCUMENT_MISSING",
        category: "COMPLETENESS",
        severity: wantRequired ? "HIGH" : "INFO",
        title: `缺少${wantRequired ? "必备" : "非必备"}资料：${spec.label}`,
        detail: `${scope}，均未出现「${spec.label}」相关内容。检索关键词：${spec.keywords.join(" / ")}。`,
        recommendation: wantRequired
          ? `请向供应商索取「${spec.label}」；若该资料确实不适用于本次审核，请在审核模板中把它改为非必备或删除。`
          : `建议补充「${spec.label}」以提高资料完整度；该项为非必备，不构成阻断。`,
        locator: {
          templateItemKey: spec.key,
          keywords: spec.keywords,
          required: spec.required,
        },
      },
    ];
  });
}

const requiredDocumentMissing: ReviewRuleDefinition = {
  id: "REQUIRED_DOCUMENT_MISSING",
  label: "必备资料缺失",
  category: "COMPLETENESS",
  defaultSeverity: "HIGH",
  description: "按模板的必备资料清单逐项检查，正文中完全找不到该项关键词即判定为缺失。",
  evaluate: (context) => missingDocumentFindings(context, "required"),
};

const optionalDocumentMissing: ReviewRuleDefinition = {
  id: "OPTIONAL_DOCUMENT_MISSING",
  label: "非必备资料缺失",
  category: "COMPLETENESS",
  defaultSeverity: "INFO",
  description: "检查模板中标记为「非必备」的资料，缺失时仅作提示，不构成阻断。",
  evaluate: (context) => missingDocumentFindings(context, "optional"),
};

const placeholderContent: ReviewRuleDefinition = {
  id: "PLACEHOLDER_CONTENT",
  label: "存在未填写的占位内容",
  category: "COMPLETENESS",
  defaultSeverity: "MEDIUM",
  description:
    "识别下划线空位、XXX、待补充等未填写标记。空白模板常因标题含关键词而被误判为「已提供」，这条规则用来兜住它。",
  evaluate: (context) =>
    context.documents.flatMap<DraftFinding>((document) => {
      const hits = findPlaceholders(document.text);
      if (hits.length === 0) return [];

      const byLabel = new Map<string, { count: number; first: number }>();
      for (const hit of hits) {
        const entry = byLabel.get(hit.label);
        if (entry) {
          entry.count += 1;
        } else {
          byLabel.set(hit.label, { count: 1, first: hit.index });
        }
      }

      const summary = [...byLabel.entries()]
        .map(([label, { count }]) => `${label} × ${count}`)
        .join("、");
      const samples = hits
        .slice(0, 3)
        .map((hit) => `「${hit.raw}」`)
        .join("、");

      return [
        {
          ruleId: "PLACEHOLDER_CONTENT" as const,
          category: "COMPLETENESS" as const,
          severity: "MEDIUM" as const,
          title: `资料中存在未填写内容：${document.label}`,
          detail: `检测到 ${hits.length} 处占位内容（${summary}）。示例：${samples}。占位内容通常意味着这是一份空白模板或未填完的草稿。`,
          recommendation: "请供应商提供填写完整的版本，再重新提交审核。",
          documentId: document.id,
          documentLabel: documentLabelOf(document),
          evidence: clampExcerpt(excerptAround(document.text, hits[0]!.index)),
          locator: { placeholderTypes: [...byLabel.keys()], total: hits.length },
        },
      ];
    }),
};

/* ------------------------------------------------------------------ */
/* 规则：正文可用性                                                    */
/* ------------------------------------------------------------------ */

const documentNotReady: ReviewRuleDefinition = {
  id: "DOCUMENT_NOT_READY",
  label: "资料尚未完成解析",
  category: "READABILITY",
  defaultSeverity: "HIGH",
  description: "被选中参与审核、但解析状态不是「可查看」的资料。它们完全没有参与核对。",
  evaluate: (context) =>
    context.documents
      .filter((document) => document.status !== "READY")
      .map<DraftFinding>((document) => ({
        ruleId: "DOCUMENT_NOT_READY",
        category: "READABILITY",
        severity: "HIGH",
        title: `资料未参与审核：${document.label}`,
        detail: `该资料的解析状态为「${document.status}」，正文尚未产出，本次审核完全没有覆盖它。`,
        recommendation: "请在资料库中重新触发解析，解析成功后再重新运行本次审核。",
        documentId: document.id,
        documentLabel: documentLabelOf(document),
        locator: { status: document.status },
      })),
};

const documentUnreadable: ReviewRuleDefinition = {
  id: "DOCUMENT_UNREADABLE",
  label: "资料无可提取正文",
  category: "READABILITY",
  defaultSeverity: "HIGH",
  description:
    "解析已完成，但正文长度不足。常见于扫描件（无文本层）与纯图片附件 —— 系统不伪造内容，因此如实报出「审不了」。",
  evaluate: (context) =>
    context.documents
      .filter(
        (document) =>
          document.status === "READY" &&
          (document.parserId === null || document.charCount < MIN_READABLE_CHARS),
      )
      .map<DraftFinding>((document) => {
        const note = document.notes[0];
        return {
          ruleId: "DOCUMENT_UNREADABLE",
          category: "READABILITY",
          severity: "HIGH",
          title: `资料无法参与审核：${document.label}`,
          detail:
            `该资料未提取到可用正文（提取到 ${document.charCount} 个字符）。` +
            (note ? `系统说明：${note}` : "常见原因是扫描件没有文本层，或该文件实为图片。"),
          recommendation:
            "请要求供应商提供可复制文字的电子版（原始 PDF / Word / Excel），或等待系统接入 OCR 后重新解析。",
          documentId: document.id,
          documentLabel: documentLabelOf(document),
          locator: { parserId: document.parserId, charCount: document.charCount },
        };
      }),
};

const documentTextTruncated: ReviewRuleDefinition = {
  id: "DOCUMENT_TEXT_TRUNCATED",
  label: "资料正文被截断",
  category: "READABILITY",
  defaultSeverity: "INFO",
  description: "正文长度触及提取上限，超出部分未参与审核。提示覆盖度不足，但不是资料本身的问题。",
  evaluate: (context) =>
    context.documents
      .filter((document) => document.truncated && document.status === "READY")
      .map<DraftFinding>((document) => ({
        ruleId: "DOCUMENT_TEXT_TRUNCATED",
        category: "READABILITY",
        severity: "INFO",
        title: `资料正文超出提取上限：${document.label}`,
        detail: `共提取 ${document.charCount} 个字符后触发长度上限，超出部分的原文未参与本次审核。`,
        recommendation: "若结论涉及文件后半部分的内容，请打开原文件人工确认。",
        documentId: document.id,
        documentLabel: documentLabelOf(document),
        locator: { charCount: document.charCount },
      })),
};

/* ------------------------------------------------------------------ */
/* 规则：主体与身份                                                    */
/* ------------------------------------------------------------------ */

function collectUsccHits(documents: ReviewDocumentInput[]) {
  return documents.flatMap((document) =>
    findUsccCandidates(document.text).map((hit) => ({ document, hit })),
  );
}

const usccMissing: ReviewRuleDefinition = {
  id: "USCC_MISSING",
  label: "未找到统一社会信用代码",
  category: "ENTITY",
  defaultSeverity: "MEDIUM",
  description: "全部资料正文中都没有出现 18 位统一社会信用代码，无法据此核对主体身份。",
  evaluate: (context) => {
    const hits = collectUsccHits(readableDocuments(context.documents));
    if (hits.length > 0) return [];
    if (readableDocuments(context.documents).length === 0) return [];

    return [
      {
        ruleId: "USCC_MISSING",
        category: "ENTITY",
        severity: "MEDIUM",
        title: "未找到统一社会信用代码",
        /*
         * ⚠️ 措辞刻意**不假设申报主体一定是企业**。
         *
         * 供应商可以是企业法人、个体工商户、事业单位，也可以是**自然人**。
         * 自然人没有统一社会信用代码（只有身份证号），境外主体也没有 18 位 USCC。
         * 若文案写成"缺少营业执照"，对这两类主体就是稳定的假阳性。
         */
        detail:
          `${searchScopeNote(context.documents)}，未出现形如 18 位统一社会信用代码的字符串。` +
          "若申报主体为企业法人或个体工商户，缺少它就无法自动核对主体身份；" +
          "若申报主体为自然人或境外主体，本条不适用。",
        recommendation:
          "若申报主体为企业或个体工商户，请补充营业执照或统一社会信用代码；若为自然人或境外主体，可忽略本条。",
      },
    ];
  },
};

const usccInvalid: ReviewRuleDefinition = {
  id: "USCC_INVALID",
  label: "统一社会信用代码校验位错误",
  category: "ENTITY",
  defaultSeverity: "HIGH",
  description:
    "按 GB 32100-2015 校验第 18 位校验码。校验不通过说明该代码一定不合法（抄错或伪造）；校验通过只说明格式合法，不代表主体真实存在。",
  evaluate: (context) =>
    collectUsccHits(readableDocuments(context.documents))
      .filter(({ hit }) => !hit.validation.valid)
      .slice(0, MAX_FINDINGS_PER_DOCUMENT)
      .map<DraftFinding>(({ document, hit }) => ({
        ruleId: "USCC_INVALID",
        category: "ENTITY",
        severity: "HIGH",
        title: `统一社会信用代码校验不通过：${hit.value}`,
        detail:
          `按 GB 32100-2015 计算校验位：${hit.validation.reason}。` +
          "校验位不通过的代码不可能是合法登记码 —— 通常是转录错误，也可能是编造。",
        recommendation: "请以营业执照原件或国家企业信用信息公示系统的查询结果为准，修正后再提交。",
        documentId: document.id,
        documentLabel: documentLabelOf(document),
        evidence: clampExcerpt(excerptAround(document.text, hit.index)),
        locator: { value: hit.value, reason: hit.validation.reason },
      })),
};

const usccMultiple: ReviewRuleDefinition = {
  id: "USCC_MULTIPLE",
  label: "出现多个不同主体代码",
  category: "ENTITY",
  defaultSeverity: "LOW",
  description:
    "资料包内出现两个及以上不同的统一社会信用代码时提示人工确认归属；始终把判断权交还给审核员，不代为下结论。",
  evaluate: (context) => {
    const hits = collectUsccHits(readableDocuments(context.documents));
    const byValue = new Map<string, string[]>();
    for (const { document, hit } of hits) {
      const list = byValue.get(hit.value) ?? [];
      if (!list.includes(document.label)) list.push(document.label);
      byValue.set(hit.value, list);
    }
    if (byValue.size < 2) return [];

    /*
     * ⚠️ 这里**曾经**有一道「申报主体的代码在其中就不报」的降噪闸门，已被撤销。
     *
     * 撤销理由（第三轮审查指出，我认同）：挂靠 / 资质借用场景中，资料的真正主体是 B 公司，
     * 而申报主体 A 只在文件底部盖了个章或写了行「代办方：A公司」。
     * 此时「A 的代码确实出现在文中」，闸门成立 → 不报 →
     * **核心资质其实属于 B 这个致命风险被完全掩盖。**
     *
     * 我上一轮的错误不是"降噪"这个动作，而是**替审核员下了结论**
     * （"有 A 就说明资料是 A 的"）。系统没有能力判断资质归属，就不该假装能判断。
     * 正确的降噪方式是把噪音写进文案，而不是把整个发现删掉。
     *
     * 保留上一轮的另一个正确结论：级别是 LOW 不是 MEDIUM。
     * 多主体在合规资料里是常态（检测报告必然带第三方代码），
     * 报成 MEDIUM 会让它挤进"重点关注"，反而挤掉真问题。
     */
    const declared = context.supplierUscc?.trim().toUpperCase() ?? "";
    const declaredPresent = declared.length > 0 && byValue.has(declared);

    const listing = [...byValue.entries()]
      .map(([value, labels]) => `${value}（见 ${labels.join("、")}）`)
      .join("；");

    return [
      {
        ruleId: "USCC_MULTIPLE",
        category: "ENTITY",
        severity: "LOW",
        title: `资料包内出现 ${byValue.size} 个不同的统一社会信用代码，需人工核实主体关系`,
        detail:
          `涉及：${listing}。` +
          (declaredPresent
            ? `其中包含申报主体登记的代码「${declared}」。`
            : declared.length > 0
              ? `其中**不含**申报主体登记的代码「${declared}」。`
              : "本次未关联供应商。") +
          " 出现多个主体本身不说明资料有问题：检测机构、验资机构、母子公司协同、" +
          "代开或**资质挂靠**都会产生同样的现象。系统无法判断资质归属，请人工核实。",
        recommendation:
          "请核实各主体与申报主体的关系：属于检测/验资等第三方、母子公司协同，还是资质挂靠。" +
          (declaredPresent ? "特别注意：资质挂靠时申报主体的代码也会出现，需核对签章页与资质页的主体是否一致。" : ""),
        locator: { codes: [...byValue.keys()], declaredUscc: declared || null, declaredPresent },
      },
    ];
  },
};

const companyNameConflict: ReviewRuleDefinition = {
  id: "COMPANY_NAME_CONFLICT",
  label: "疑似存在多个企业主体",
  category: "ENTITY",
  defaultSeverity: "LOW",
  description:
    "从资料正文中抽取企业名称，剔除认证机构、银行等明显第三方后，若仍存在两个及以上名称则提示人工确认；始终把判断权交还给审核员。",
  evaluate: (context) => {
    const readable = readableDocuments(context.documents);
    const seen = new Map<string, { index: number; document: ReviewDocumentInput }>();
    for (const document of readable) {
      for (const hit of findCompanyNames(document.text)) {
        if (THIRD_PARTY_PATTERN.test(hit.value)) continue;
        if (!seen.has(hit.value)) seen.set(hit.value, { index: hit.index, document });
      }
    }

    if (seen.size < 2) return [];

    /*
     * 与 USCC_MULTIPLE 同步撤销「申报主体在其中就不报」这道闸门，理由相同：
     * 挂靠 / 资质借用时申报主体的名字**确实出现在文件里**（通常在签章页或代办方行），
     * 闸门一开，真正的资质主体就被藏起来了。
     *
     * 降噪改在文案里做：明确列出"哪些情况是正常的"，让审核员自己判断，
     * 而不是由系统替他决定"这个不用看"。
     */
    const declaredName = context.supplierName ? normalizeForMatch(context.supplierName) : "";
    const declaredPresent =
      declaredName.length > 0 &&
      [...seen.keys()].some((name) => normalizeForMatch(name) === declaredName);

    const names = [...seen.keys()];
    const listed = names.slice(0, 8).join("、");
    const more = names.length > 8 ? ` 等 ${names.length} 个` : "";
    const first = seen.get(names[0]!);

    return [
      {
        ruleId: "COMPANY_NAME_CONFLICT",
        category: "ENTITY",
        severity: "LOW",
        title: `抽取出 ${names.length} 个企业名称，需核实主体关系`,
        detail:
          `剔除认证、检测、银行等第三方机构名称后，正文中仍出现：${listed}${more}。` +
          (declaredPresent
            ? "其中包含申报主体登记的名称。"
            : declaredName.length > 0
              ? "其中**不含**申报主体登记的名称。"
              : "本次未关联供应商。") +
          " 集团型企业的多个关联主体、报价单上的客户抬头、以及**资质挂靠时的代办方署名**" +
          "都会产生同样的现象。系统无法判断资质归属，请人工核实。",
        recommendation:
          "请核实各名称与申报主体的关系。" +
          (declaredPresent
            ? "特别注意：资质挂靠时申报主体的名称也会出现，需核对签章页与资质页的主体是否一致。"
            : "请确认申报主体名称；若存在无关主体，请将其资料移出本次审核范围。"),
        ...(first
          ? {
              documentId: first.document.id,
              documentLabel: documentLabelOf(first.document),
              evidence: clampExcerpt(excerptAround(first.document.text, first.index)),
            }
          : {}),
        locator: { names, declaredPresent },
      },
    ];
  },
};

const supplierNameNotFound: ReviewRuleDefinition = {
  id: "SUPPLIER_NAME_NOT_FOUND",
  label: "资料中未出现申报主体名称",
  category: "ENTITY",
  defaultSeverity: "LOW",
  description: "本次审核关联了供应商主体，但全部资料正文中都没有出现该名称。无法确认资料归属。",
  evaluate: (context) => {
    if (!context.supplierName) return [];
    const readable = readableDocuments(context.documents);
    if (readable.length === 0) return [];

    const normalizedTarget = normalizeForMatch(context.supplierName);
    const found = readable.some((document) => {
      const text = normalizeForMatch(document.text);
      if (text.includes(normalizedTarget)) return true;
      // 抽取到的名称里出现同名（含简写差异）也算命中。
      return findCompanyNames(document.text).some(
        (hit) => hit.value.includes(normalizedTarget) || normalizedTarget.includes(hit.value),
      );
    });
    if (found) return [];

    return [
      {
        ruleId: "SUPPLIER_NAME_NOT_FOUND",
        category: "ENTITY",
        severity: "LOW",
        title: `资料中未出现「${context.supplierName}」`,
        detail: `${searchScopeNote(context.documents)}，均未出现申报主体「${context.supplierName}」的名称。无法据此确认这批资料属于该主体。`,
        recommendation: "请确认关联的供应商是否正确，或要求供应商在资料中明确标注申报主体名称。",
        locator: { supplierName: context.supplierName },
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* 规则：证照有效期                                                    */
/* ------------------------------------------------------------------ */

interface ExpiryRecord {
  document: ReviewDocumentInput;
  endIso: string;
  raw: string;
  markerIndex: number;
}

function collectExpiries(documents: ReviewDocumentInput[]): ExpiryRecord[] {
  return readableDocuments(documents).flatMap((document) =>
    findExpiryWindows(document.text).map((window) => ({
      document,
      endIso: window.endIso,
      raw: window.raw,
      markerIndex: window.markerIndex,
    })),
  );
}

function expiryFindings(
  context: RuleContext,
  mode: "expired" | "expiring",
): DraftFinding[] {
  const today = utcToday(context.now);
  const threshold = context.config.expiryWarningDays;
  const findings: DraftFinding[] = [];

  for (const record of collectExpiries(context.documents)) {
    const end = isoToUtcDate(record.endIso);
    if (!end) continue;
    const daysLeft = daysBetween(today, end);

    if (mode === "expired") {
      if (daysLeft >= 0) continue;
      findings.push({
        ruleId: "CERTIFICATE_EXPIRED",
        category: "VALIDITY",
        severity: "CRITICAL",
        title: `证照已过期：${record.document.label}`,
        detail: `解析到的有效期截止日为 ${record.endIso}，已过期 ${Math.abs(daysLeft)} 天（判定基准日 ${today.toISOString().slice(0, 10)}）。`,
        recommendation: "请供应商提供续期后的新证书；过期证书不得作为准入依据。",
        documentId: record.document.id,
        documentLabel: documentLabelOf(record.document),
        evidence: clampExcerpt(excerptAround(record.document.text, record.markerIndex)),
        locator: { endIso: record.endIso, daysLeft, rule: "CERTIFICATE_EXPIRED" },
      });
      continue;
    }

    if (daysLeft < 0 || daysLeft > threshold) continue;
    findings.push({
      ruleId: "CERTIFICATE_EXPIRING_SOON",
      category: "VALIDITY",
      severity: "HIGH",
      title: `证照即将到期：${record.document.label}`,
      detail: `有效期截止日为 ${record.endIso}，距判定基准日 ${today.toISOString().slice(0, 10)} 仅剩 ${daysLeft} 天（预警阈值 ${threshold} 天）。`,
      recommendation: "建议在签约或下订单前要求供应商完成续期，避免履约期内证书失效。",
      documentId: record.document.id,
      documentLabel: documentLabelOf(record.document),
      evidence: clampExcerpt(excerptAround(record.document.text, record.markerIndex)),
      locator: { endIso: record.endIso, daysLeft, threshold },
    });
  }

  return findings;
}

const certificateExpired: ReviewRuleDefinition = {
  id: "CERTIFICATE_EXPIRED",
  label: "证照已过期",
  category: "VALIDITY",
  defaultSeverity: "CRITICAL",
  description: "识别「有效期至 X 年 X 月 X 日」并用**判定基准日**比对，早于基准日即判定过期。",
  evaluate: (context) => expiryFindings(context, "expired"),
};

const certificateExpiringSoon: ReviewRuleDefinition = {
  id: "CERTIFICATE_EXPIRING_SOON",
  label: "证照即将到期",
  category: "VALIDITY",
  defaultSeverity: "HIGH",
  description: "距有效期截止日不足模板设定的预警天数时提示。阈值由模板配置，默认 90 天。",
  evaluate: (context) => expiryFindings(context, "expiring"),
};

const certificateExpiryUnknown: ReviewRuleDefinition = {
  id: "CERTIFICATE_EXPIRY_UNKNOWN",
  label: "有效期无法判定",
  category: "VALIDITY",
  defaultSeverity: "LOW",
  description:
    "正文中出现了「有效期」但没有跟着一个可解析的日期（例如「报价有效期：30 个自然日」）。如实报出「判不了」，不做推算。",
  evaluate: (context) =>
    context.documents.flatMap<DraftFinding>((document) => {
      if (document.status !== "READY" || document.charCount < MIN_READABLE_CHARS) return [];

      const normalized = normalizeForMatch(document.text);
      const markers = [...normalized.matchAll(/有效期(?:限)?/g)].map((m) => m.index ?? 0);
      if (markers.length === 0) return [];

      const parsed = new Set(findExpiryWindows(document.text).map((window) => window.markerIndex));
      /*
       * 「长期 / 永久 / *** 」这些写法**不算无法判定**。
       *
       * 它们是明确的业务语义：这张证照没有到期日。中国营业执照大量如此。
       * 把它们算进 unparsed，等于给每一份合法执照都贴一条黄标 ——
       * 报得多了，真正需要人工确认的相对期限（「30 个自然日」）就一起被淹没了。
       */
      const longTerm = new Set(findLongTermMarkers(document.text));
      const unparsed = markers.filter((index) => !parsed.has(index) && !longTerm.has(index));
      if (unparsed.length === 0) return [];

      const firstIndex = unparsed[0]!;
      const longTermNote =
        longTerm.size > 0
          ? `另有 ${longTerm.size} 处标注为「长期 / 永久」等无到期日写法，属有效状态，不计入本条。`
          : "";
      return [
        {
          ruleId: "CERTIFICATE_EXPIRY_UNKNOWN" as const,
          category: "VALIDITY" as const,
          severity: "LOW" as const,
          title: `有效期无法判定：${document.label}`,
          detail:
            `正文中出现 ${markers.length} 处「有效期」，其中 ${unparsed.length} 处后面没有可直接解析的日期` +
            "（例如只写了「30 个自然日」这类相对期限）。系统不做推算，因此这些项未纳入到期判定。" +
            longTermNote,
          recommendation:
            "若该项属于必须核验的证照有效期，请要求供应商提供写明绝对截止日期的证书，或人工确认。",
          documentId: document.id,
          documentLabel: documentLabelOf(document),
          evidence: clampExcerpt(excerptAround(document.text, firstIndex)),
          locator: {
            markerCount: markers.length,
            unparsedCount: unparsed.length,
            longTermCount: longTerm.size,
          },
        },
      ];
    }),
};

/* ------------------------------------------------------------------ */
/* 规则：数据一致性                                                    */
/* ------------------------------------------------------------------ */

/** 中文大写金额与附近阿拉伯数字金额的最大比对距离（字符）。 */
const AMOUNT_PAIR_WINDOW = 120;

/**
 * 金额大小写一致性。
 *
 * ⚠️ 这条规则最容易写成假阳性发生器，所以做了两处克制：
 *
 * 1. **只在窗口内配对**。「小写 ¥175,000.00 大写 壹拾柒万伍仟元整」是相邻的；
 *    而报价表里一行一个金额、彼此相隔很远，不会被强行拉郎配。
 *
 * 2. **配不上就不报**。若某份资料里出现多组金额且窗口重叠，
 *    无法确定谁对应谁 —— 此时宁可漏报，也不产出一条"金额不一致"的指控。
 *    实际的实现方式是：一个大写金额只取窗口内**距离最近**的那个小写金额。
 */
const amountMismatch: ReviewRuleDefinition = {
  id: "AMOUNT_MISMATCH",
  label: "金额大小写不一致",
  category: "CONSISTENCY",
  defaultSeverity: "HIGH",
  description:
    "把中文大写金额（壹拾柒万伍仟元整）与附近的阿拉伯数字金额（¥175,000.00）做数值比对，不一致即报出。仅在同一份资料内比对。",
  evaluate: (context) =>
    readableDocuments(context.documents).flatMap<DraftFinding>((document) => {
      const chinese = findChineseAmounts(document.text);
      if (chinese.length === 0) return [];

      const small = findSmallAmounts(document.text).filter(
        (hit): hit is typeof hit & { value: number } => hit.value !== null,
      );
      if (small.length === 0) return [];

      const findings: DraftFinding[] = [];
      for (const cn of chinese) {
        if (cn.value === null) continue;
        const near = small.filter((hit) => Math.abs(hit.index - cn.index) <= AMOUNT_PAIR_WINDOW);
        if (near.length === 0) continue;

        const nearest = near.reduce((a, b) =>
          Math.abs(a.index - cn.index) <= Math.abs(b.index - cn.index) ? a : b,
        );
        if (Math.abs(nearest.value - cn.value) <= 0.01) continue;

        findings.push({
          ruleId: "AMOUNT_MISMATCH",
          category: "CONSISTENCY",
          severity: "HIGH",
          title: `金额大小写不一致：${document.label}`,
          detail:
            `大写金额「${cn.raw}」解析为 ${formatAmount(cn.value)}，` +
            `而附近的小写金额「${nearest.raw}」为 ${formatAmount(nearest.value)}，两者相差 ${formatAmount(Math.abs(nearest.value - cn.value))}。`,
          recommendation: "金额不一致的报价不具备可比性，请供应商更正后重新提交。",
          documentId: document.id,
          documentLabel: documentLabelOf(document),
          evidence: clampExcerpt(excerptAround(document.text, cn.index)),
          locator: {
            chineseRaw: cn.raw,
            chineseValue: cn.value,
            numericRaw: nearest.raw,
            numericValue: nearest.value,
          },
        });
        if (findings.length >= MAX_FINDINGS_PER_DOCUMENT) break;
      }
      return findings;
    }),
};

/** 只用于详情文案的数字格式化，不参与任何判定。 */
function formatAmount(value: number): string {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ */
/* 规则清单                                                            */
/* ------------------------------------------------------------------ */

/**
 * 规则注册表。**顺序即执行顺序**，也决定了摘要里 executedRules 的顺序，
 * 因此不要依赖 Map 的遍历顺序 —— 数组是唯一事实来源。
 */
export const REVIEW_RULES: readonly ReviewRuleDefinition[] = [
  requiredDocumentMissing,
  optionalDocumentMissing,
  placeholderContent,
  documentNotReady,
  documentUnreadable,
  documentTextTruncated,
  usccMissing,
  usccInvalid,
  usccMultiple,
  companyNameConflict,
  supplierNameNotFound,
  certificateExpired,
  certificateExpiringSoon,
  certificateExpiryUnknown,
  amountMismatch,
];

export const RULE_BY_ID: ReadonlyMap<RuleId, ReviewRuleDefinition> = new Map(
  REVIEW_RULES.map((rule) => [rule.id, rule]),
);

/**
 * 取本次要执行的规则。
 *
 * 语义刻意定成「黑名单为空 = 全部执行」而不是反过来：
 * 模板里 enabledRules 为空（例如用户手工清空）时，宁可多查也不要静默变成"什么都不查"
 * —— 一次什么都没查的审核如果还显示「已完成」，那是最危险的产物。
 */
export function selectRules(config: TemplateConfig): {
  executed: ReviewRuleDefinition[];
  skipped: ReviewRuleDefinition[];
} {
  if (config.enabledRules.length === 0) {
    return { executed: [...REVIEW_RULES], skipped: [] };
  }
  const enabled = new Set(config.enabledRules);
  const executed: ReviewRuleDefinition[] = [];
  const skipped: ReviewRuleDefinition[] = [];
  for (const rule of REVIEW_RULES) {
    (enabled.has(rule.id) ? executed : skipped).push(rule);
  }
  return { executed, skipped };
}

/** 供 UI 展示「日期是否已过期」这类判断复用，避免各处各写一遍。 */
export function expiryState(
  endIso: string,
  now: Date,
  warningDays: number,
): { state: "expired" | "expiring" | "valid"; daysLeft: number } | null {
  const end = isoToUtcDate(endIso);
  if (!end) return null;
  const daysLeft = daysBetween(utcToday(now), end);
  if (daysLeft < 0) return { state: "expired", daysLeft };
  if (daysLeft <= warningDays) return { state: "expiring", daysLeft };
  return { state: "valid", daysLeft };
}

/** 导出给测试与报告页复用。 */
export { findDates, countMatches };
