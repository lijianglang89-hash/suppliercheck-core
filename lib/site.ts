/**
 * 站点级常量。
 *
 * 集中存放产品实体的名称与描述，保证「产品定义一致」——
 * 这是 SEO 与 GEO 的基础要求：同一实体在所有页面上描述唯一且稳定。
 *
 * 事实纪律（需求「二十二、GEO 基础」）：
 * 这里只写产品客观能力，不写客户数量、认证、案例、评价等无法验证的信息。
 */

export const siteConfig = {
  /**
   * 产品全称。**对外一律用全称** —— 简称只用于极窄的版式场景。
   * 全称与简称必须成对定义：只留一个的话，任何一次排版压力都会诱导别人再造第三个名字出来。
   */
  name: "供应商资料智能审核系统",
  /** 简称。仅在空间确实放不下全称时使用，且不用于 SEO 标题与结构化数据。 */
  shortName: "供应商智审",
  /** 内部英文代号。 */
  latinName: "SupplierCheck",
  /** 一句话价值主张，同时用作 metadata description 的基础。 */
  tagline: "上传供应商资料，自动核对资料完整性、证照有效期与主体一致性。",
  /** 面向搜索引擎的完整描述。 */
  description:
    "供应商资料智能审核系统（SupplierCheck）是面向企业采购、供应链与中小企业的供应商资料审核工具：上传供应商资料包，自动识别文件、提取关键信息，逐条核对资料完整性、证照有效期、统一社会信用代码与主体信息一致性，并生成可逐条追溯的审核报告。",
  /** 主要使用场景，用于落地页与结构化描述。 */
  audience: ["企业采购", "供应链管理", "中小企业", "合规与风控"] as const,
  /** 语言标记。 */
  locale: "zh-CN",
} as const;

/**
 * 站点根地址。
 * 优先读 APP_URL；构建期若未设置则回退到本地开发地址，
 * 保证 sitemap / canonical / OG 始终能产出绝对 URL。
 */
export function getSiteUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      // 配置非法时不让构建崩掉，回退并在运行时由 env 校验兜住。
    }
  }
  return "http://localhost:3010";
}

/** 需要出现在 sitemap 中的公开页面。仅在导航结构变化时同步维护。 */
export const PUBLIC_ROUTES: ReadonlyArray<{ path: string; priority: number }> = [
  { path: "/", priority: 1 },
  { path: "/login", priority: 0.5 },
  { path: "/register", priority: 0.6 },
];
