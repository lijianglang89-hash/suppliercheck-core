import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/site";

/**
 * robots.txt
 *
 * 放行全部公开营销页面，禁止抓取 API 与需要登录的应用区域。
 * 后者即使被抓到也只会看到重定向，明确 disallow 可以节省爬虫预算。
 */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard", "/suppliers", "/reviews", "/reports", "/templates", "/settings"],
      },
    ],
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
    host: siteUrl,
  };
}
