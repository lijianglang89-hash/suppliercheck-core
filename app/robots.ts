import type { MetadataRoute } from "next";

import { PRIVATE_ROUTE_PREFIXES, getSiteUrl } from "@/lib/site";

/**
 * robots.txt
 *
 * 放行全部公开营销页面，禁止抓取 API 与需要登录的应用区域。
 * 后者即使被抓到也只会看到重定向，明确 disallow 可以节省爬虫预算。
 *
 * 两条例外，**不要顺手改掉**：
 *
 * 1. **`/login` `/register` 不在这里 Disallow。**
 *    它们的去索引是靠页面上的 `<meta name="robots" content="noindex">` 完成的。
 *    如果在 robots.txt 里屏蔽，搜索引擎抓不到页面就读不到 noindex 标记，
 *    结果可能因为外部链接被收录成一条没有摘要的空结果 —— 比收录还糟。
 *
 * 2. **`OAI-SearchBot` / `GPTBot` 等 AI 爬虫没有被单独屏蔽。**
 *    OpenAI 官方说明：OAI-SearchBot 是 ChatGPT 搜索的爬虫，
 *    屏蔽它的网站不会出现在 ChatGPT Search 的答案里。
 *    本项目的目标是被 AI 搜索正确理解，主动屏蔽等于自我淘汰。
 */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...PRIVATE_ROUTE_PREFIXES],
      },
    ],
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
    host: siteUrl,
  };
}
