import type { MetadataRoute } from "next";

import { CHECKLIST_TEMPLATES } from "@/lib/content/checklist-templates";
import { PUBLIC_ROUTES, getSiteUrl } from "@/lib/site";

/**
 * sitemap.xml
 *
 * 只收录真正公开、可被索引的页面。登录后的应用页（/dashboard 等）
 * 不在其中 —— 它们需要会话，对爬虫没有价值。
 *
 * 内容页**从内容数据枚举**，不在 PUBLIC_ROUTES 里再抄一遍路径：
 * 抄一遍就等于给了「页面已上线但 sitemap 没收录」一个藏身之处，
 * 而这个故障是静默的 —— 没人会每天去核对 sitemap。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastModified = new Date();

  const staticEntries = PUBLIC_ROUTES.map((route) => ({
    url: new URL(route.path, siteUrl).toString(),
    lastModified,
    changeFrequency: "weekly" as const,
    priority: route.priority,
  }));

  const contentEntries = CHECKLIST_TEMPLATES.map((template) => ({
    url: new URL(`/templates/${template.slug}`, siteUrl).toString(),
    // 内容页用自己的更新日期：拿构建时间去冒充"最近更新"是骗爬虫，也会被识破。
    lastModified: new Date(template.updatedAt),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  return [...staticEntries, ...contentEntries];
}
