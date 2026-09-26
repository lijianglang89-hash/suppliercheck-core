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
  title: {
    default: `${siteConfig.name} · ${siteConfig.tagline}`,
    template: `%s · ${siteConfig.name}`,
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
    "AI 文档审核",
  ],
  authors: [{ name: siteConfig.name }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: siteConfig.name,
    url: "/",
    title: `${siteConfig.name} · ${siteConfig.tagline}`,
    description: siteConfig.description,
    images: [
      {
        url: "/og",
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
    images: ["/og"],
  },
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
