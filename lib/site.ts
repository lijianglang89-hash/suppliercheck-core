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
  /**
   * 对外展示的版本号。
   *
   * 页面上任何「Vx.y」都从这个字段读，不写死字符串 ——
   * 曾经页脚、首页、注册页各自写了一份 "V0.3"，而镜像早就打到 0.4.x，
   * 于是界面在向用户报一个我们自己的发布线里根本不存在的版本。
   * 发版时与镜像 tag 一起改（deploy/scripts/build-and-ship.sh 的 IMAGE_TAG）。
   */
  version: "0.4.15",
  /** 面向搜索引擎的完整描述。 */
  description:
    "供应商资料智能审核系统（SupplierCheck）是面向企业采购、供应链与中小企业的供应商资料审核工具：上传供应商资料包，自动识别文件、提取关键信息，逐条核对资料完整性、证照有效期、统一社会信用代码与主体信息一致性，并生成可逐条追溯的审核报告。",
  /** 主要使用场景，用于落地页与结构化描述。 */
  audience: ["企业采购", "供应链管理", "中小企业", "合规与风控"] as const,
  /** 语言标记。 */
  locale: "zh-CN",
  /**
   * 运营主体 —— 「你是谁」这个问题的唯一答案来源。
   *
   * ⚠️ 两个硬约束：
   * 1. **`entity` 必须与 ICP 备案主体一致。** 页脚写的运营方和备案主体不是同一个，
   *    本身就是「网页内容与备案信息不符」，正是国内云厂商巡检会挑的那一条。
   * 2. **`icpRecord` 为空就不渲染备案链接。** 绝不填一个编出来的号 ——
   *    假的备案号比没有备案号严重得多：它是可核验的假信息，一查即穿帮。
   */
  operator: {
    /** 运营主体。个人备案就写个人，公司备案就写公司全称，不要混。 */
    entity: "个人开发者独立运营",
    /** 对外展示的所在地（写到市级即可）。 */
    location: "广东 · 佛山",
    /** 联络邮箱。 */
    email: "jiangjunji2@gmail.com",
    /**
     * ICP 备案号（个人主体，2026-09-28 由 James 提供）。
     * 与 `entity` 一致：备案是个人 → 页脚就写个人，不混写公司名。
     */
    icpRecord: "粤ICP备2026132389号-1",
  },
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
 * ⚠️ 收录的是**内容页**，不是薄页面。只有表单的 `/login` `/register` 依然不进 ——
 * 塞薄页面进 sitemap 换取"页面数量"是自欺欺人
 * （docs/DESIGN.md §0 硬规则 2：页面上的东西必须来自真实功能）。
 */
export const PUBLIC_ROUTES: ReadonlyArray<{ path: string; priority: number }> = [
  { path: "/", priority: 1 },
  // 内容页（/templates/[slug]）不在这里列 —— 由 app/sitemap.ts 从
  // lib/content/checklist-templates.ts 枚举，避免两处维护路径。
  { path: "/templates", priority: 0.7 },
  // 免登录示例报告：转化链路里最靠前的一环，权重给到接近首屏。
  { path: "/sample-report", priority: 0.9 },
];

/**
 * 需要出现在 robots.txt Disallow 中的应用区域。
 * 这些路径全部要登录，爬虫抓到只会拿到重定向。
 *
 * ⚠️ **命名空间是稀缺资源，别把通用词让给登录区**。
 * 模板管理页原本挂在 `/templates`，但 `/templates/...`
 * 正是「供应商准入资料清单模板」这类公开内容页最自然的 URL ——
 * 而 robots.txt 已经 Disallow 了整个前缀，将来任何同名公开页都会被屏蔽，
 * 且症状（「页面上线了却搜不到」）排查成本极高。
 * 因此登录区改名为 `/review-templates`，把 `/templates` 整个前缀腾出来。
 *
 * 改名时刻意**没有**给旧地址加 301 重定向：
 * 一旦写了 `/templates → /review-templates`，将来真要上公开页 `/templates`
 * 时重定向会先把它吃掉，等于自己给自己埋雷。登录区没有外链与收录，
 * 丢掉旧书签的代价远小于埋这颗雷。
 */
export const PRIVATE_ROUTE_PREFIXES: readonly string[] = [
  "/api/",
  "/dashboard",
  "/documents",
  "/suppliers",
  "/reviews",
  "/reports",
  "/review-templates",
  "/settings",
];
