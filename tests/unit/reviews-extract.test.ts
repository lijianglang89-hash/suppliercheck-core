/**
 * 确定性抽取器的单元测试。
 *
 * 测的重点是**两件容易写错、且写错代价很高**的事：
 *   1. 统一社会信用代码的校验位算法（算错 → 把合法代码判成非法，或反之）；
 *   2. 归一化必须保持长度不变（否则「原文摘录」会整体错位，证据变成假证据）。
 *
 * 日期与金额的用例刻意用真实资料里的写法（全角标点、千分位、「至」连接），
 * 因为它们才是生产环境里真正出现的东西。
 */

import { describe, expect, it } from "vitest";

import {
  EXTRA_FULLWIDTH_MAP,
  clampExcerpt,
  countMatches,
  daysBetween,
  excerptAround,
  findChineseAmounts,
  findCompanyNames,
  findDates,
  findExpiryWindows,
  findPlaceholders,
  findSmallAmounts,
  findUsccCandidates,
  isoToUtcDate,
  normalizeForMatch,
  parseChineseAmount,
  utcToday,
  validateUscc,
} from "@/lib/reviews/extract";

describe("normalizeForMatch", () => {
  it("折半角后长度严格不变（否则摘录会错位）", () => {
    const samples = [
      "有效期至２０２７年６月３０日",
      "金额：￥１７５，０００．００",
      "公司名称：示例（佛山）有限公司",
      "全角空格\u3000与波浪线～",
      "",
    ];
    for (const sample of samples) {
      expect(normalizeForMatch(sample)).toHaveLength(sample.length);
    }
  });

  it("把全角数字与标点折成半角", () => {
    expect(normalizeForMatch("２０２７－０６－３０")).toBe("2027-06-30");
    expect(normalizeForMatch("（Ａ）")).toBe("(A)");
  });

  it("下标仍然指向原文的同一位置", () => {
    const text = "有效期至２０２７年６月３０日";
    const normalized = normalizeForMatch(text);
    const index = normalized.indexOf("2027");
    expect(text.slice(index, index + 4)).toBe("２０２７");
  });
});

describe("validateUscc（GB 32100-2015 校验位）", () => {
  it("已知合法代码通过校验", () => {
    // 华为技术有限公司的统一社会信用代码（公开信息），校验位应为 6。
    expect(validateUscc("914403001922038216").valid).toBe(true);
  });

  it("校验位写错时给出可读原因", () => {
    const result = validateUscc("914403001922038217");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("校验位应为");
    expect(result.reason).toContain("6");
  });

  it("长度不对直接拒绝", () => {
    expect(validateUscc("91440300192203821").valid).toBe(false);
    expect(validateUscc("9144030019220382160").valid).toBe(false);
  });

  it("含 I / O / S / V / Z 等被排除字符时拒绝", () => {
    const result = validateUscc("91440300192203821I");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("非法字符");
  });

  it("小写输入按大写处理", () => {
    expect(validateUscc("914403001922038216".toLowerCase()).valid).toBe(true);
  });
});

describe("findUsccCandidates", () => {
  it("抓出 18 位代码并带上校验结论", () => {
    const text = "统一社会信用代码：914403001922038216";
    const hits = findUsccCandidates(text);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.value).toBe("914403001922038216");
    expect(hits[0]!.validation.valid).toBe(true);
  });

  it("不会被更长的字母数字串截断成假代码", () => {
    // 前面多一位数字 → 这个 18 位子串不该被当成代码。
    expect(findUsccCandidates("X1914403001922038216")).toHaveLength(0);
  });

  it("全角书写的代码同样能抓到", () => {
    expect(findUsccCandidates("９１４４０３００１９２２０３８２１６")).toHaveLength(1);
  });
});

describe("findDates", () => {
  it("识别中文年月日与短横线写法", () => {
    const hits = findDates("有效期至 2027 年 6 月 30 日；签发于 2023-01-01");
    expect(hits.map((hit) => hit.iso)).toEqual(["2027-06-30", "2023-01-01"]);
  });

  it("拒绝不存在的日期（2 月 30 日）", () => {
    const hits = findDates("2027年2月30日");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.iso).toBeNull();
  });

  it("闰年 2 月 29 日有效、平年无效", () => {
    expect(findDates("2028年2月29日")[0]!.iso).toBe("2028-02-29");
    expect(findDates("2027年2月29日")[0]!.iso).toBeNull();
  });

  it("只写年月时按该月 1 日处理并标记精度", () => {
    const hits = findDates("发证日期 2024 年 5 月");
    expect(hits[0]!.precision).toBe("month");
    expect(hits[0]!.iso).toBe("2024-05-01");
  });

  it("不会被「QT-2026-0927-A」这类编号骗成日期", () => {
    expect(findDates("报价单号：QT-2026-0927-A")).toHaveLength(0);
  });
});

describe("findExpiryWindows", () => {
  it("「有效期至 X」取 X 为截止日", () => {
    const windows = findExpiryWindows("ISO 9001 证书，有效期至 2027 年 6 月 30 日");
    expect(windows).toHaveLength(1);
    expect(windows[0]!.endIso).toBe("2027-06-30");
  });

  it("区间写法取后一个日期", () => {
    const windows = findExpiryWindows("有效期：2023-01-01 至 2026-01-01");
    expect(windows[0]!.endIso).toBe("2026-01-01");
    expect(windows[0]!.startIso).toBe("2023-01-01");
  });

  it("只有一个日期时直接采用", () => {
    expect(findExpiryWindows("有效期：2027-05-31")[0]!.endIso).toBe("2027-05-31");
  });

  it("「有效期 30 个自然日」解析不出日期 → 不臆造", () => {
    expect(findExpiryWindows("报价有效期：自报价日起 30 个自然日")).toHaveLength(0);
  });

  it("「有效期 X 发证日期 Y」不会被后面那个日期带偏", () => {
    const windows = findExpiryWindows("有效期 2027-06-30 发证日期 2023-01-01");
    expect(windows[0]!.endIso).toBe("2027-06-30");
  });

  it("记录触发解析的「有效期」下标，供未解析统计使用", () => {
    const text = "有效期至 2027-06-30";
    const windows = findExpiryWindows(text);
    expect(windows[0]!.markerIndex).toBe(text.indexOf("有效期"));
  });
});

describe("parseChineseAmount", () => {
  it("解析常见的万/仟/佰结构", () => {
    expect(parseChineseAmount("壹拾柒万伍仟元整")).toBe(175_000);
    expect(parseChineseAmount("叁仟元整")).toBe(3_000);
    expect(parseChineseAmount("贰佰万元整")).toBe(2_000_000);
    expect(parseChineseAmount("壹亿贰仟万元整")).toBe(120_000_000);
  });

  it("处理角分", () => {
    expect(parseChineseAmount("壹佰贰拾叁元肆角伍分")).toBeCloseTo(123.45, 2);
  });

  it("兼容「圆」与「拾」单独出现", () => {
    expect(parseChineseAmount("拾万圆整")).toBe(100_000);
  });

  it("缺数字的残片返回 null 而不是 0", () => {
    // 「万元整」是单位残片，解析成 0 会造出完全虚构的「大小写不一致」。
    expect(parseChineseAmount("万元整")).toBeNull();
    expect(parseChineseAmount("元整")).toBeNull();
  });

  it("没有「元」字时返回 null", () => {
    expect(parseChineseAmount("壹拾柒万伍仟")).toBeNull();
  });
});

describe("金额抽取", () => {
  it("抓到带货币符号的小写金额", () => {
    const hits = findSmallAmounts("合计金额：人民币 壹拾柒万伍仟元整（¥175,000.00）");
    expect(hits.map((hit) => hit.value)).toEqual([175_000]);
  });

  it("「500 万元」换算成 5000000", () => {
    expect(findSmallAmounts("注册资本：人民币 500 万元整").map((h) => h.value)).toEqual([
      5_000_000,
    ]);
  });

  it("没有货币符号也带单位的数字不会被当成金额", () => {
    expect(findSmallAmounts("员工 126 人，厂房 4,200 平方米")).toHaveLength(0);
  });

  it("中文大写金额必须含数字汉字", () => {
    // 「500 万元整」里的「万元整」是残片，不能被当成大写金额。
    const hits = findChineseAmounts("注册资本：人民币 500 万元整");
    expect(hits).toHaveLength(0);
  });

  it("抓到「壹拾柒万伍仟元整」并解析为 175000", () => {
    const hits = findChineseAmounts("合计金额：人民币 壹拾柒万伍仟元整");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.value).toBe(175_000);
  });
});

describe("findCompanyNames", () => {
  it("抓出企业名称并保留首次出现的下标", () => {
    const text = "公司名称：示例精密五金制造（佛山）有限公司";
    const hits = findCompanyNames(text);
    expect(hits[0]!.value).toBe("示例精密五金制造（佛山）有限公司");
    expect(hits[0]!.index).toBe(text.indexOf("示例"));
  });

  it("同一名称出现多次只保留一次", () => {
    expect(findCompanyNames("甲公司有限公司与甲公司有限公司")).toHaveLength(1);
  });

  it("识别带「股份」「集团」后缀的名称", () => {
    expect(findCompanyNames("中国示例集团股份有限公司").length).toBeGreaterThan(0);
  });

  /**
   * 下面两条是第三轮加的：左边界从"非中文字符"扩展到"主体名专用前缀"，
   * 用来解决银行开户信息、投标函里最常见的**无分隔符粘连**写法。
   * 两条是一对：一条证明该抓的抓到了，一条证明不该编的没编出来。
   */
  describe("无分隔符粘连写法的吸附", () => {
    const prefixes = ["开户名称", "开户名", "公司名称", "企业名称", "单位名称", "投标人", "中标人"];

    for (const prefix of prefixes) {
      it(`「${prefix}示例精密五金制造有限公司」能抓出主体`, () => {
        const hits = findCompanyNames(`${prefix}示例精密五金制造有限公司`);
        expect(hits.map((hit) => hit.value)).toContain("示例精密五金制造有限公司");
      });
    }

    it("角色词后面跟的是人名时**不吸附**——宁可漏，不可编", () => {
      // 「供应商张三…」里的张三是联系人，不是主体的一部分。
      // 若把「供应商」也收进前缀表，这里会编出一个不存在的「张三示例科技有限公司」。
      const hits = findCompanyNames("供应商张三示例科技有限公司");
      expect(hits.map((hit) => hit.value)).not.toContain("张三示例科技有限公司");
    });

    it("「客户名称」不能被从中间的「户名」切开", () => {
      // 这是写完第一版实测出来的坑：裸「户名」会把「客户名称」切成「客」+「户名称」，
      // 于是抓出「称远方工程建设有限公司」这种不存在的名字。
      const hits = findCompanyNames("客户名称：远方工程建设有限公司");
      expect(hits.map((hit) => hit.value)).toContain("远方工程建设有限公司");
      expect(hits.some((hit) => hit.value.startsWith("称"))).toBe(false);
    });
  });
});

describe("findPlaceholders", () => {
  it("识别下划线与 XXX 空位", () => {
    expect(findPlaceholders("联系人：________").length).toBeGreaterThan(0);
    expect(findPlaceholders("地址：XXXX").length).toBeGreaterThan(0);
  });

  it("识别「待补充」与填写提示", () => {
    const hits = findPlaceholders("银行账号：待补充（请填写完整）");
    expect(hits.map((hit) => hit.label)).toContain("待补充标记");
  });

  it("正常内容不误报", () => {
    expect(findPlaceholders("付款方式：合同签订后预付 30%，发货前付 60%。")).toHaveLength(0);
  });
});

describe("日期工具", () => {
  it("isoToUtcDate 按 UTC 零点解析，不因时区漂移", () => {
    expect(isoToUtcDate("2026-01-01")?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(isoToUtcDate("2026-13-01")).toBeNull();
  });

  it("utcToday 抹掉时分秒", () => {
    const today = utcToday(new Date("2026-09-27T15:30:00.000Z"));
    expect(today.toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });

  it("daysBetween 对未来 / 过去给出正确的正负号", () => {
    const today = utcToday(new Date("2026-09-27T00:00:00.000Z"));
    expect(daysBetween(today, new Date("2026-12-31T00:00:00.000Z"))).toBe(95);
    expect(daysBetween(today, new Date("2026-01-01T00:00:00.000Z"))).toBe(-269);
  });
});

describe("摘录", () => {
  it("用原文而不是归一化副本（保持资料原貌）", () => {
    const text = "２０２７年，证书有效期至２０２７年６月３０日，请注意";
    const index = text.indexOf("２０２７年６");
    expect(excerptAround(text, index)).toContain("２０２７年６月３０日");
  });

  it("标注被裁掉的方向", () => {
    const text = "A".repeat(500) + "关键内容" + "B".repeat(500);
    const excerpt = excerptAround(text, 505, 20);
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).toContain("关键内容");
  });

  it("clampExcerpt 硬截断并加省略号", () => {
    const clamped = clampExcerpt("x".repeat(400));
    expect(clamped.length).toBeLessThanOrEqual(261);
    expect(clamped.endsWith("…")).toBe(true);
  });
});

describe("countMatches", () => {
  it("统计出现次数", () => {
    expect(countMatches("有效期至a有效期b有效期", /有效期/g)).toBe(3);
    expect(countMatches("没有关键字", /有效期/g)).toBe(0);
  });
});

describe("归一化的长度不变式", () => {
  /**
   * 这条不变式是整个「原文摘录」功能的地基：
   * 发现里的 evidence 下标是在归一化副本上算出来的，再用它去切**原文**。
   * 归一化一旦改变长度，摘录就会指向错误的位置 ——
   * 那不是显示瑕疵，是**一份看起来有据可查、实则张冠李戴的证据**。
   */
  it("代理对（emoji / 生僻汉字）不改变长度", () => {
    // 🏭 是 U+1F3ED（代理对，UTF-16 长度 2）；𠮷 是 U+20BB7（同样长度 2）
    const samples = ["🏭", "𠮷", "a🏭b", "示例𠮷公司", "🏭🏭🏭"];
    for (const text of samples) {
      expect(normalizeForMatch(text).length, `「${text}」长度漂移`).toBe(text.length);
    }
  });

  /**
   * 第三轮审查指出的唯一剩余前提：不变式成立**依赖** EXTRA_FULLWIDTH_MAP 里
   * 没有"单字符 → 多字符"的脏数据。主循环本身是安全的（只做 BMP 全角 ASCII 的
   * 1:1 映射，其余原样拼接），但这张表是手写的，将来谁往里加一条
   * `"…": "..."` 就会把整条不变式打破。所以把它钉成断言，而不是靠人记得。
   */
  it("EXTRA_FULLWIDTH_MAP 里不存在把 1 个字符映射成多个字符的条目", () => {
    for (const [from, to] of Object.entries(EXTRA_FULLWIDTH_MAP)) {
      expect(to.length, `映射 ${JSON.stringify(from)} → ${JSON.stringify(to)} 长度不为 1`).toBe(1);
      expect(from.length).toBe(1);
    }
  });

  it("全角、全角空格、全角人民币符号、零宽字符都不改变长度", () => {
    const samples = [
      "ＡＢＣ１２３",
      "　全角空格　",
      "￥175,000.00",
      "～波浪线～",
      "−数学减号−",
      "零宽​空格", // U+200B 零宽空格：不映射也不剔除，长度必须保持
    ];
    for (const text of samples) {
      expect(normalizeForMatch(text).length, `「${text}」长度漂移`).toBe(text.length);
    }
  });

  it("归一化后按原下标切片，得到的是同一个字符", () => {
    const text = "名称：示例精密五金制造（佛山）有限公司，信用代码：914403001922038216";
    const normalized = normalizeForMatch(text);
    const index = normalized.indexOf("914403001922038216");

    expect(index).toBeGreaterThan(0);
    // 归一化副本上找到的位置，直接在原文上切，必须切出同一个串。
    expect(text.slice(index, index + 18)).toBe("914403001922038216");
  });
});
