import type { MetadataRoute } from "next";

import { PUBLIC_ROUTES, getSiteUrl } from "@/lib/site";

/**
 * sitemap.xml
 *
 * 只收录真正公开、可被索引的页面。登录后的应用页（/dashboard 等）
 * 不在其中 —— 它们需要会话，对爬虫没有价值。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: new URL(route.path, siteUrl).toString(),
    lastModified,
    changeFrequency: "weekly",
    priority: route.priority,
  }));
}
