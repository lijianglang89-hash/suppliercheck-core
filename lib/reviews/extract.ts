/**
 * 确定性抽取器。
 *
 * 这是整个审核引擎的地基，也是它「不制造假 AI」的地方：
 * 下面每一个函数都是纯函数 + 正则 + 标准算法，输入相同必然输出相同，
 * 出了误判可以逐字复现。没有网络、没有模型、没有随机性。
 *
 * ## 一条必须守住的纪律：1:1 归一化
 *
 * 中文资料里「2027-05-31」和「２０２７－０５－３１」是同一个日期，
 * 「：」和「:」是同一个冒号。匹配前必须把全角折成半角，
 * 但**归一化后字符下标必须与原串一一对应** —— 否则截出来的「原文摘录」
 * 会错位，证据就变成了假证据。
 *
 * 全角 ASCII（U+FF01–U+FF5E）减去 0xFEE0 恰好落到 U+0021–U+007E，
 * 且长度不变，因此可以安全地逐字符映射。个别不在这个区间的字符
 * （全角空格、￥）单独处理，同样保持一对一。
 */

/* ------------------------------------------------------------------ */
/* 归一化                                                              */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ 导出只为了让测试能钉住「每条映射都是 1:1」这个不变式（见
 * tests/unit/reviews-extract.test.ts）。**业务代码不要引用它** ——
 * 全角折半角一律走 normalizeForMatch，绕过它就会丢掉长度不变式。
 */
export const EXTRA_FULLWIDTH_MAP: Record<string, string> = {
  "\u3000": " ", // 全角空格
  "\uFFE5": "¥", // 全角人民币符号 → 半角
  "\uFF5E": "~", // 全角波浪线
  "\u2212": "-", // 数学减号
};

/**
 * 折半角。**必须保持长度不变**（1 个字符换 1 个字符）。
 * 新增规则时务必遵守这一条，否则摘录位置会整体漂移。
 */
export function normalizeForMatch(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
      continue;
    }
    out += EXTRA_FULLWIDTH_MAP[char] ?? char;
  }
  return out;
}

/**
 * 截取索引附近的原文摘录。
 *
 * 记住这里读的是**原始文本**（不是归一化副本）：摘录给人看，
 * 保持资料的原始排版比「统一成半角」重要。
 */
export function excerptAround(text: string, index: number, span = 90): string {
  const start = Math.max(0, index - span);
  const end = Math.min(text.length, index + span);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/** 摘录的硬上限。证据是给人看的线索，不是全文备份。 */
export const MAX_EXCERPT_CHARS = 260;

export function clampExcerpt(text: string): string {
  return text.length <= MAX_EXCERPT_CHARS ? text : `${text.slice(0, MAX_EXCERPT_CHARS)}…`;
}

/* ------------------------------------------------------------------ */
/* 统一社会信用代码（GB 32100-2015）                                   */
/* ------------------------------------------------------------------ */

/**
 * 代码字符集：0-9 与 24 个大写字母中的 21 个（剔除 I O S V Z）。
 * 共 10 + 21 = 31 个字符，这正是校验算法里取模 31 的原因。
 */
const USCC_ALPHABET = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28] as const;

export interface UsccValidation {
  valid: boolean;
  reason?: string;
}

/**
 * 校验 18 位统一社会信用代码的校验位。
 *
 * 这是本引擎里**唯一一条可以给出「确定错误」结论的检查**：
 * 校验位不对，这个代码一定不是合法登记码（要么抄错、要么造假）。
 * 反过来不成立 —— 校验位通过只说明格式合法，不代表主体真实存在。
 * 界面文案必须守住这个差别，不能写成「该企业真实存在」。
 */
export function validateUscc(rawValue: string): UsccValidation {
  const code = rawValue.trim().toUpperCase();
  if (code.length !== 18) {
    return { valid: false, reason: `长度应为 18 位，实际 ${code.length} 位` };
  }
  const illegal = [...code].find((char) => !USCC_ALPHABET.includes(char));
  if (illegal) {
    return { valid: false, reason: `含非法字符「${illegal}」（该字符不在 GB 32100 字符集内）` };
  }

  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    sum += USCC_ALPHABET.indexOf(code[i] as string) * (USCC_WEIGHTS[i] as number);
  }
  const remainder = 31 - (sum % 31);
  const expected = USCC_ALPHABET[remainder === 31 ? 0 : remainder];

  if (expected !== code[17]) {
    return { valid: false, reason: `校验位应为「${expected}」，实际为「${code[17]}」` };
  }
  return { valid: true };
}

export interface UsccHit {
  value: string;
  index: number;
  validation: UsccValidation;
}

/**
 * 找出全部形似统一社会信用代码的串。
 *
 * 用前后「不是大写字母或数字」做边界，而不是 `\b` ——
 * `\b` 在「数字+大写字母」相邻处不成立，会把长串截断成短串。
 */
export function findUsccCandidates(text: string): UsccHit[] {
  const normalized = normalizeForMatch(text);
  const pattern = /(?<![0-9A-Z])[0-9A-HJ-NPQRTUWXY]{18}(?![0-9A-Z])/g;
  const hits: UsccHit[] = [];

  for (const match of normalized.matchAll(pattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    hits.push({ value, index, validation: validateUscc(value) });
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* 日期                                                                */
/* ------------------------------------------------------------------ */

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export interface DateHit {
  index: number;
  raw: string;
  /** YYYY-MM-DD。月份或日期非法时为 null。 */
  iso: string | null;
  year: number;
  month: number;
  /** 只写到「年月」时为 1（该月第一天）——调用方需自行注意这个精度损失。 */
  day: number;
  precision: "day" | "month";
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  if (month === 2) return day <= (isLeapYear(year) ? 29 : 28);
  return day <= (DAYS_IN_MONTH[month - 1] as number);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * 抓取中英文混排的日期。
 *
 * 刻意**不**处理「二〇二七年五月」这类中文数字年月：
 * 它在真实资料里出现频率低，但一旦解析错就会产出错误的「已过期」结论 ——
 * 报错判的代价远高于漏判，所以宁可漏（漏了会落到「无法判定有效期」那条提示上）。
 */
export function findDates(text: string): DateHit[] {
  const normalized = normalizeForMatch(text);
  const pattern = /(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*日?|(\d{4})\s*年\s*(\d{1,2})\s*月/g;
  const hits: DateHit[] = [];

  for (const match of normalized.matchAll(pattern)) {
    const index = match.index ?? 0;
    const raw = match[0];
    const [yearRaw, monthRaw, dayRaw, yearOnlyRaw, monthOnlyRaw] = match.slice(1);

    if (yearOnlyRaw !== undefined) {
      const year = Number(yearOnlyRaw);
      const month = Number(monthOnlyRaw);
      hits.push({
        index,
        raw,
        year,
        month,
        day: 1,
        iso: isValidYmd(year, month, 1) ? `${pad4(year)}-${pad2(month)}-01` : null,
        precision: "month",
      });
      continue;
    }

    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    hits.push({
      index,
      raw,
      year,
      month,
      day,
      iso: isValidYmd(year, month, day) ? `${pad4(year)}-${pad2(month)}-${pad2(day)}` : null,
      precision: "day",
    });
  }

  return hits;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad4(value: number): string {
  return String(value).padStart(4, "0");
}

/** 把 YYYY-MM-DD 解析成 UTC 零点，避免本地时区把日期挪掉一天。 */
export function isoToUtcDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidYmd(year, month, day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function utcToday(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/* 有效期                                                              */
/* ------------------------------------------------------------------ */

export interface ExpiryWindow {
  /** 「有效期」三个字在原文中的下标。 */
  index: number;
  /** 触发本次解析的「有效期」标记下标。用于统计「有标记但没解析出日期」的数量。 */
  markerIndex: number;
  /** 命中片段（原文）。 */
  raw: string;
  /** 有效期截止日 YYYY-MM-DD。 */
  endIso: string;
  startIso?: string;
}

/** 「有效期」出现处向后看多远。太短会漏掉「有效期：\n2027-05-31」这类换行排版。 */
const EXPIRY_LOOKAHEAD = 120;

/**
 * 「长期有效」的写法 —— **只看明确的自然语言语义**。
 *
 * ⚠️ 这不是边缘情况：中国营业执照、不少资质证书的有效期字段**就是写「长期」**，
 * 还有写成「无固定期限」「不限期」「不设定」「永久」的。
 * 不认识这几种写法，每一份合法执照都会被报成「有效期无法判定」——
 * 那不是漏报，是**把「无法判定」这个诚实的结论变成了噪音**，
 * 报多了以后用户会连同真正的无法判定一起忽略掉。
 *
 * ⚠️⚠️ **曾经把排版占位符 `***`、`——` 也算进来，已剔除。** 理由（实测推演得出的反例）：
 *
 *   法定代表人身份证号：*** 有效期至：2026-10-05
 *
 * 这里的 `***` 是**脱敏打码**，不是期限。若把它当成"长期"，这条真实的
 * `2026-10-05` 就会被"长期项不计入未判定"这条规则静默吞掉 —— 一份明明带着
 * 明确有效期的资料，被判成"无需人工核实"。
 * **占位符的收益（多认出几份写 `***` 的执照）远小于它的代价（掩盖真过期风险）。**
 * 没有把握时宁可报「无法判定」，也不要猜成「长期」。
 *
 * 另外「长期」必须出现在「有效期」标记**之后**（`长期合作有效期` 不算）——
 * 这一条由 findLongTermMarkers 的前瞻窗口保证。
 */
const LONG_TERM_PATTERN = /长期|永久|无固定期限|不限期|不设定|无期限/;
const LONG_TERM_LOOKAHEAD = 16;

/**
 * 找出所有标注为「长期有效」的「有效期」标记下标。
 *
 * 与 findExpiryWindows 分开而不是塞进返回值：这两个概念是**互斥**的
 * —— 有明确到期日 ≠ 长期有效。混在一个结构里，调用方迟早会写出
 * 「既有 endIso 又是长期」这种自相矛盾的分支。
 */
export function findLongTermMarkers(text: string): number[] {
  const normalized = normalizeForMatch(text);
  const markers: number[] = [];

  for (const hit of normalized.matchAll(/有效期(?:限)?/g)) {
    const markerIndex = hit.index ?? 0;
    const nextMarker = normalized.indexOf("有效期", markerIndex + 1);
    const end = Math.min(
      normalized.length,
      markerIndex + LONG_TERM_LOOKAHEAD,
      nextMarker === -1 ? Number.MAX_SAFE_INTEGER : nextMarker,
    );
    const tail = normalized.slice(markerIndex + 3, end);

    // 「长期」必须出现在标记之后 —— 「长期合作有效期」不该被算进来。
    if (LONG_TERM_PATTERN.test(tail)) markers.push(markerIndex);
  }

  return markers;
}

/**
 * 抽取证照有效期。
 *
 * 判定优先级（每一步都对应一种真实排版）：
 *   1. 窗口内出现「至 / 到 / 截止 + 日期」→ 取那个日期（最常见：有效期至 2027-05-31）；
 *   2. 窗口内有「日期 至/-/~ 日期」→ 取后一个（区间型：2023-01-01 至 2026-01-01）；
 *   3. 窗口内只有一个日期 → 取它（隐含型：有效期：2027-05-31）；
 *   4. 什么都没有 → 返回空，由 CERTIFICATE_EXPIRY_UNKNOWN 规则如实提示「无法判定」。
 *
 * 刻意不做第 4 步的猜测（例如按发证日期 + 3 年推算）：猜出来的有效期一旦偏短，
 * 会把一份有效证书判成过期 —— 那是把用户推向错误决策，比"无法判定"糟糕得多。
 */
export function findExpiryWindows(text: string): ExpiryWindow[] {
  const normalized = normalizeForMatch(text);
  const marker = /有效期(?:限)?/g;
  const windows: ExpiryWindow[] = [];

  for (const hit of normalized.matchAll(marker)) {
    const markerIndex = hit.index ?? 0;
    const start = markerIndex;
    /*
     * 窗口右端取三者最小值：定长前瞻、下一个「有效期」标记、文本末尾。
     *
     * 「不越过下一个标记」是实测补上的：一份资料里三张证书各占一行，
     * 每行都有「有效期至 X」。若不截断，第一行的窗口会连第二、三行的日期一起看见，
     * 于是三张证书都按最后那一张的到期日判定 —— 而它们本来是不同的日期。
     */
    const nextMarker = normalized.indexOf("有效期", markerIndex + 1);
    const end = Math.min(
      normalized.length,
      markerIndex + EXPIRY_LOOKAHEAD,
      nextMarker === -1 ? Number.MAX_SAFE_INTEGER : nextMarker,
    );
    const window = normalized.slice(start, end);

    const dates = findDates(window);
    if (dates.length === 0) continue;

    const relative = (offset: number) => start + offset;

    // 1) 「至/到/截止 + 日期」。**取第一个**而不是最后一个：
    //    「有效期至 X」的 X 就是紧随标记之后的那个日期；取最后一个会跑到后面的行去。
    const anchored = /(?:至|到|截止|止于)\s*(\d{4}\s*(?:年|[-/.])\s*\d{1,2}\s*(?:月|[-/.])\s*\d{1,2}\s*日?)/g;
    const anchoredFirst = [...window.matchAll(anchored)][0];
    if (anchoredFirst) {
      const offset = anchoredFirst.index ?? 0;
      const inner = findDates(anchoredFirst[0])[0];
      if (inner?.iso) {
        // 「2023-01-01 至 2026-01-01」这类区间：锚点前面若还有日期，那就是起始日。
        const startCandidate = dates.filter((date) => date.index < offset && date.iso).at(-1);
        windows.push({
          index: relative(offset),
          markerIndex,
          raw: window.slice(0, Math.min(window.length, offset + anchoredFirst[0].length + 4)).trim(),
          endIso: inner.iso,
          ...(startCandidate?.iso ? { startIso: startCandidate.iso } : {}),
        });
        continue;
      }
    }

    // 2) 区间型（2023-01-01 至 2026-01-01）：取后一个日期作为截止日。
    //    连接符只认 至/到/~/—/– 或两侧带空格的短横线 —— 裸 '-' 属于日期自身，
    //    拿它当区间分隔符会把「有效期 2026-01-01 发证日期 2023-01-01」判成到 2023 年到期。
    if (dates.length >= 2 && /(?:至|到|~|—|–|\s-\s)/.test(window.slice(dates[0]!.index, dates.at(-1)!.index))) {
      const last = dates.at(-1)!;
      if (last.iso) {
        windows.push({
          index: relative(dates[0]!.index),
          markerIndex,
          raw: window.slice(dates[0]!.index, last.index + last.raw.length).trim(),
          endIso: last.iso,
          ...(dates[0]!.iso ? { startIso: dates[0]!.iso } : {}),
        });
        continue;
      }
    }

    // 3) 单个日期。
    const first = dates[0]!;
    if (first.iso) {
      windows.push({
        index: relative(first.index),
        markerIndex,
        raw: window.slice(0, Math.min(window.length, first.index + first.raw.length + 2)).trim(),
        endIso: first.iso,
      });
    }
  }

  return windows;
}

/** 统计某个正则在一段文本里出现的次数。 */
export function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

/* ------------------------------------------------------------------ */
/* 主体名称                                                            */
/* ------------------------------------------------------------------ */

/**
 * 企业后缀。
 *
 * 覆盖非「有限公司」形态是必要的：分公司、合伙企业（有限合伙）、合作社、
 * 个体经营部在供应商资料里都很常见，只认「有限公司」会把它们整片漏掉。
 * 「中心」「研究院」「事务所」不在此列 —— 它们基本都是第三方机构，
 * 由规则层的 THIRD_PARTY_PATTERN 负责剔除（写进后缀反而会污染多主体判定）。
 */
const COMPANY_SUFFIX =
  "(?:股份有限公司|有限责任公司|集团有限公司|集团公司|有限公司|合伙企业|有限合伙|合作社|分公司|总公司|子公司|分厂|经营部|门市部|商行|工厂)";

/**
 * 「主体名专用前缀」—— 这些词后面**必然**跟着一个主体名称。
 *
 * ⚠️ 这一组是第三轮审查的产出。上一版只用了"非中文字符"做左边界，
 * 于是「开户名称广东奥创电商有限公司」这类**无分隔符粘连**写法整条漏掉，
 * 而这在银行开户信息、投标函、委托函里是高频排版。
 *
 * 取舍：这里**故意不收** `供应商` / `甲方` / `乙方` / `联系人` 这类**角色词**。
 * 提出方原先建议把它们也吸附进来，但我实测后撤回这一条 ——
 * 「供应商张三某某有限公司」「联系人李四某某商行」里，
 * 角色词后面跟的是**人名**，吸附会把人名一起吸进企业名，
 * 于是编出一个不存在的主体。这违背「宁可漏一个名字，不可编一个名字」。
 *
 * 判断标准只有一句：**这个词后面出现的一定是主体名，还是也可能是人名？**
 * 是主体名的（开户名/公司名称/投标人/中标人…）收；也可能是人名的（供应商/甲方/乙方…）不收。
 *
 * 另外 `户名` 前面加了 `(?<![客户])`：否则「**客户名**称：远方工程建设有限公司」
 * 会被从中间的「户名」切开，抓出「**称**远方工程建设有限公司」这种不存在的名字。
 * 这个坑是写完第一版测出来的，不是推演出来的。
 */
const ENTITY_LABEL_PREFIX =
  "(?:开户名(?:称)?|账户名(?:称)?|(?<![客户])户名|公司名称|企业名称|单位名称|单位全称|供应商名称|申请单位|受检单位|委托单位|受托单位|中标人|投标人|承包人|供货单位|开票名称)";

/**
 * 左边界：**必须有**。
 *
 * 中文没有词边界，不加左边界会稳定地产生"粘连名"。实测：
 * 「甲公司有限公司与甲公司有限公司」会被抓成 `甲公司有限公司` 与
 * **`与甲公司有限公司`** 两条 —— 后者在报告里就是一个不存在的企业名。
 *
 * 左边界 = 行首 / 空白 / 标点 / **主体名专用前缀**（后者用于无分隔符的粘连写法）。
 * 仍然抓不到的：既没有分隔符、也不在专用前缀之后的嵌入写法（如「与某某有限公司签订」）。
 * 这个残余漏报是有意的：漏掉一个名字只是少一条提示，
 * 而编出一个不存在的名字会写进报告 —— 错误代价不对称。
 */
/*
 * ⚠️ `ENTITY_LABEL_PREFIX` 必须排在交替的**第一位**，不能放在最后。
 *
 * 实测（第三轮）：放在末尾时，「开户名称示例精密五金制造有限公司」会被抓成
 * **`开户名称示例精密五金制造有限公司`** —— 因为 `^` 先匹配上了字符串开头，
 * 捕获组便从位置 0 一路吃到「有限公司」，前缀被当成公司名的一部分。
 * 前缀置顶后，同一个输入抓出的是正确的 `示例精密五金制造有限公司`。
 * 正则交替短路：第一个分支成功就不会再试后面的。
 */
const COMPANY_LEFT_BOUNDARY =
  `(?:${ENTITY_LABEL_PREFIX}|^|[\\s\\u3000:：,，。;；、()（）\\[\\]【】"“”'‘’<>《》/\\\\|·\\-—–=+*#])`;

/**
 * 抓取以企业后缀收尾的名称。
 * 外面套一个捕获组而不是用 lookbehind：变量长度的 lookbehind 在各引擎里行为不一致，
 * 而捕获组 + 手动修正下标在任何地方都成立。
 */
const COMPANY_PATTERN = new RegExp(
  `${COMPANY_LEFT_BOUNDARY}([\\u4e00-\\u9fa5A-Za-z0-9()\\u00b7]{2,30}?${COMPANY_SUFFIX})`,
  "g",
);

export interface CompanyNameHit {
  value: string;
  index: number;
}

/**
 * 抓取文档里出现的全部企业名称（去重，保留首次出现位置）。
 *
 * 注意这里**故意不过滤**「认证机构」「检测中心」这类第三方名称 ——
 * 过滤规则一旦写死在抽取层，就再也无法解释「为什么这个名字被忽略」。
 * 过滤属于业务判断，放在规则层（见 rules.ts），并且会把过滤结果写进发现详情。
 */
export function findCompanyNames(text: string): CompanyNameHit[] {
  const normalized = normalizeForMatch(text);
  // key 用归一化值（「（佛山）」与「(佛山)」视为同一家），
  // 返回的 value 用**原文切片**（报告里引用的名字必须能在原文件里逐字找到）。
  const seen = new Map<string, { index: number; value: string }>();

  for (const match of normalized.matchAll(COMPANY_PATTERN)) {
    const matched = match[1];
    if (!matched) continue;
    const start = (match.index ?? 0) + match[0].length - matched.length;
    const value = text.slice(start, start + matched.length).trim();
    if (value.length < 4) continue;
    if (!seen.has(matched)) seen.set(matched, { index: start, value });
  }

  return [...seen.values()].sort((a, b) => a.index - b.index);
}

/* ------------------------------------------------------------------ */
/* 金额                                                                */
/* ------------------------------------------------------------------ */

export interface AmountHit {
  index: number;
  raw: string;
  kind: "small" | "chinese";
  /** 解析出的数值。无法解析时为 null。 */
  value: number | null;
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  壹: 1,
  贰: 2,
  叁: 3,
  肆: 4,
  伍: 5,
  陆: 6,
  柒: 7,
  捌: 8,
  玖: 9,
};

const CN_SMALL_UNITS: Record<string, number> = { 拾: 10, 佰: 100, 仟: 1000 };
const CN_BIG_UNITS: Record<string, number> = { 万: 10_000, 亿: 100_000_000 };

/**
 * 解析中文大写金额（「壹拾柒万伍仟元整」→ 175000）。
 *
 * 实现的是标准的万/亿分段进位：遇到 万 时把当前段结算进总数，
 * 遇到 亿 时把已累计的段整体乘 1e8。角分单独按小数处理。
 *
 * 无法解析时返回 null —— 也**不会返回 0**。0 是一个"看起来正常"的金额，
 * 让它流进比对逻辑会产出一条完全虚构的「大小写不一致」。
 * 「万元整」「元整」这类**单位残片**正好会解析成 0，因此这里把 <= 0 一律当作解析失败。
 * 代价是「零元整」也返回 null —— 一笔 0 元的金额本来也不该参与大小写交叉核对。
 */
export function parseChineseAmount(input: string): number | null {
  const text = input.replace(/[整正\s]/g, "");
  const yuanIndex = text.search(/[元圆]/);
  if (yuanIndex < 0) return null;

  const integerPart = text.slice(0, yuanIndex);
  const fractionPart = text.slice(yuanIndex + 1);

  let total = 0;
  let section = 0;
  let digit = 0;
  let sawAnyChar = false;

  for (const char of integerPart) {
    if (char in CN_DIGITS) {
      digit = CN_DIGITS[char] as number;
      sawAnyChar = true;
      continue;
    }
    if (char in CN_SMALL_UNITS) {
      // 「拾」单独出现（如「拾万元」）按 1 计，这是中文金额的既定写法。
      section += (digit || 1) * (CN_SMALL_UNITS[char] as number);
      digit = 0;
      sawAnyChar = true;
      continue;
    }
    if (char in CN_BIG_UNITS) {
      // 万与亿用同一套结算：先把当前段补齐并乘以单位，再累加进总数并清空段。
      // 「壹亿贰仟万」→ 壹亿 结算 1e8；贰仟万 结算 2e7；合计 1.2e8。
      const unit = CN_BIG_UNITS[char] as number;
      section = (section + digit) * unit;
      total += section;
      section = 0;
      digit = 0;
      sawAnyChar = true;
    }
  }

  if (!sawAnyChar) return null;

  let fraction = 0;
  let fractionDigit = 0;
  for (const char of fractionPart) {
    if (char in CN_DIGITS) {
      fractionDigit = CN_DIGITS[char] as number;
      continue;
    }
    if (char === "角") {
      fraction += fractionDigit * 0.1;
      fractionDigit = 0;
    } else if (char === "分") {
      fraction += fractionDigit * 0.01;
      fractionDigit = 0;
    }
  }

  const value = Math.round((total + section + digit + fraction) * 100) / 100;
  return value > 0 ? value : null;
}

/** 抓取阿拉伯数字金额：需要货币符号或「元/万元」单位，否则任何数字都会被误当成金额。 */
export function findSmallAmounts(text: string): AmountHit[] {
  const normalized = normalizeForMatch(text);
  const hits: AmountHit[] = [];

  const symbolPattern = /(?:¥|RMB|CNY)\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/gi;
  for (const match of normalized.matchAll(symbolPattern)) {
    const rawNumber = match[1] as string;
    const value = Number(rawNumber.replace(/,/g, ""));
    hits.push({
      index: match.index ?? 0,
      raw: match[0],
      kind: "small",
      value: Number.isFinite(value) ? value : null,
    });
  }

  const unitPattern = /((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(万元|元)/g;
  for (const match of normalized.matchAll(unitPattern)) {
    const rawNumber = match[1] as string;
    const unit = match[2] as string;
    const base = Number(rawNumber.replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    hits.push({
      index: match.index ?? 0,
      raw: match[0],
      kind: "small",
      value: unit === "万元" ? base * 10_000 : base,
    });
  }

  return hits.sort((a, b) => a.index - b.index);
}

/** 抓取中文大写金额。 */
export function findChineseAmounts(text: string): AmountHit[] {
  const normalized = normalizeForMatch(text);
  const pattern = /[零壹贰叁肆伍陆柒捌玖拾佰仟万亿元圆角分整正]{3,}/g;
  const hits: AmountHit[] = [];

  for (const match of normalized.matchAll(pattern)) {
    const raw = match[0];
    if (!/[元圆]/.test(raw)) continue;
    // ⚠️ 必须至少含一个数字汉字。否则「万元整」「元整」这类**单位残片**会被当成金额
    // 解析成 0，进而与附近的阿拉伯数字金额比对出一条完全虚构的「大小写不一致」。
    // 实测踩过：示例资料里有「注册资本：人民币 500 万元整」，就是这种形态。
    if (!/[零壹贰叁肆伍陆柒捌玖]/.test(raw)) continue;
    const value = parseChineseAmount(raw);
    if (value === null) continue;
    hits.push({ index: match.index ?? 0, raw, kind: "chinese", value });
  }

  return hits;
}

/* ------------------------------------------------------------------ */
/* 占位内容                                                            */
/* ------------------------------------------------------------------ */

export interface PlaceholderHit {
  index: number;
  raw: string;
  label: string;
}

/**
 * 未填写占位符。
 *
 * 这一条直接对应一个真实的坑：供应商交上来的资料包里夹着**空白模板**，
 * 页面上有表和标题，看起来像资料，实际关键字段全是下划线。
 * 只按「必备资料是否出现」判断的话，空白模板会因为标题里有「报价单」三个字
 * 而被判定为"已提供"。
 *
 * 模式刻意保守：只认下划线/点线/XXX 连续段与明确的待补标记，
 * 不认「无」「暂无」这类正常表述。
 */
const PLACEHOLDER_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /_{4,}/g, label: "下划线空格" },
  { pattern: /[.\u00b7]{6,}/g, label: "点线空格" },
  { pattern: /[XxＸｘ]{4,}/g, label: "XXX 占位" },
  { pattern: /待补充|待填写|待确认后补充|后续补充/g, label: "待补充标记" },
  { pattern: /(?:TODO|TBD|FIXME)/g, label: "待办标记" },
  { pattern: /请填写|请补全|请完整填写/g, label: "填写提示" },
  { pattern: /\(略\)|（略）/g, label: "省略内容" },
  { pattern: /\[(?:待填|空|未填)\]/g, label: "空值标记" },
];

export function findPlaceholders(text: string): PlaceholderHit[] {
  const normalized = normalizeForMatch(text);
  const hits: PlaceholderHit[] = [];

  for (const { pattern, label } of PLACEHOLDER_PATTERNS) {
    for (const match of normalized.matchAll(pattern)) {
      hits.push({ index: match.index ?? 0, raw: match[0], label });
    }
  }

  return hits.sort((a, b) => a.index - b.index);
}
