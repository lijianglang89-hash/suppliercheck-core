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

/**
 * 需要出现在 sitemap 中的公开页面。仅在导航结构变化时同步维护。
 *
 * 这里**刻意不含 `/login` 与 `/register`**：
 * 两个页面内容很薄（只有一个表单），拿它们去争搜索排名没有意义，
 * 放进 sitemap 反而向搜索引擎声明「这是值得收录的内容」。
 * 正确做法是 robots.txt 允许抓取、页面用 `<meta name="robots" content="noindex">` 声明不索引 ——
 * 注意不能用 robots.txt 的 Disallow 代替 noindex：被 Disallow 的页面搜索引擎看不到 noindex 标记，
 * 反而可能因为外链被收录成「无摘要的空结果」。
 *
 * ⚠️ 唯一的条目意味着本站目前确实只有一个可被索引的页面。
 * 这是真实状态，不要用塞薄页面进 sitemap 的方式掩盖它
 * （docs/DESIGN.md §0 硬规则 2：页面上的东西必须来自真实功能）。
 */
export const PUBLIC_ROUTES: ReadonlyArray<{ path: string; priority: number }> = [
  { path: "/", priority: 1 },
];

/**
 * 需要出现在 robots.txt Disallow 中的应用区域。
 * 这些路径全部要登录，爬虫抓到只会拿到重定向。
 *
 * ⚠️ **路由命名空间冲突（已知约束，未解决）**：
 * 未来若要建公开的内容页（如 `/templates/供应商准入资料清单`、`/guides/...`），
 * 会与这里已 Disallow 的登录区同名路径（`/templates` 是模板管理页）冲突 ——
 * 届时要么给公开内容换前缀（如 `/checklist/`、`/knowledge/`），
 * 要么把登录区整体迁到 `/app/` 前缀下。**在改名之前不要新增同名公开页面**，
 * 否则新页面会被 robots.txt 屏蔽，而排查成本很高。
 */
export const PRIVATE_ROUTE_PREFIXES: readonly string[] = [
  "/api/",
  "/dashboard",
  "/documents",
  "/suppliers",
  "/reviews",
  "/reports",
  "/templates",
  "/settings",
];
