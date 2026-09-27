import type { Metadata, Viewport } from "next";

import { getSiteUrl, siteConfig } from "@/lib/site";

import "./globals.css";

const siteUrl = getSiteUrl();

/**
 * 全站 Metadata 基线。
 *
 * 每个页面只需覆盖自己那部分（title / description / canonical），
 * 其余（OG 站点名、locale、robots、metadataBase）继承自这里 —— 这是
 * 需求「二十一、SEO 基础」中 metadata architecture 的落点。
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  /*
   * SEO 标题用「品牌名｜全称」的双层结构（docs/DESIGN.md §1）：
   * 简称在前便于记忆，全称在后保证搜索词覆盖。
   */
  title: {
    default: `${siteConfig.shortName}｜${siteConfig.name}`,
    template: `%s · ${siteConfig.shortName}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [
    "供应商智审",
    "SupplierCheck",
    "供应商资料审核",
    "供应商资质审核",
    "采购合规",
    "供应链风控",
    "营业执照核验",
    "证书有效期检查",
    "统一社会信用代码核验",
    // 曾经这里写的是「AI 文档审核」。已删除：审核结论由 15 条确定性规则产出，
    // 不是模型判断。SEO 关键词是对外宣称，把规则写成 AI 就是虚假宣传 ——
    // 与首页「不把规则包装成 AI」是同一条纪律，不能只在看得见的地方守。
  ],
  authors: [{ name: siteConfig.name }],
  alternates: { canonical: "/" },
  /*
   * 分享图用**静态 PNG**，不用 next/og 动态生成。
   * 实测（fontTools 读 cmap）：next/og 的默认字体 Geist-Regular 只有 973 个字形，
   * 一个 CJK 字形都没有 —— 动态图上的中文必然是豆腐块。
   * 修它要往镜像里塞中文字体（体积 + 授权两头负担），而分享图文案是固定的，
   * 静态出图更可控：scripts/brand/make-brand-assets.mjs 出图，产物提交进 public/。
   * 改文案请改 scripts/brand/og.html 后重跑脚本，不要手改 PNG。
   */
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: siteConfig.name,
    url: "/",
    title: `${siteConfig.name} · ${siteConfig.tagline}`,
    description: siteConfig.description,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: `${siteConfig.name} —— ${siteConfig.tagline}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} · ${siteConfig.tagline}`,
    description: siteConfig.description,
    images: ["/og-image.png"],
  },
  /*
   * Favicon 三件套：
   * - /icon.svg 由 app/icon.svg 文件约定自动产出（矢量，现代浏览器首选）；
   * - /favicon.ico（32×32）留给旧浏览器与 RSS 抓取工具；
   * - /apple-touch-icon.png（180×180，不透明底）给 iOS 桌面书签。
   * 这里不再重复声明 svg —— 否则 head 里会出现两条 icon 链接。
   */
  icons: {
    /*
     * svg 必须显式列出：一旦在 metadata 里声明 icons，
     * app/icon.svg 的文件约定就不再自动产出 link（实测 head 里只剩 ico），
     * 现代浏览器会退回用 32×32 的 ico —— 高分屏标签页上就是糊的。
     */
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          跳到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
