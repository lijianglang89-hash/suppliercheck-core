import { ImageResponse } from "next/og";

import { siteConfig } from "@/lib/site";

/**
 * 动态 OG 图。
 *
 * 刻意用 route handler（/og）而不是 opengraph-image.tsx 文件约定：
 * 前者的 URL 是稳定的，可以直接写死进 metadata.openGraph.images，
 * 不会因为文件约定产生 hash 查询串而与手写 metadata 冲突。
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#ffffff",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 26,
              letterSpacing: 6,
              color: "#2f6097",
              fontWeight: 600,
            }}
          >
            {siteConfig.latinName.toUpperCase()}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 68,
              fontWeight: 700,
              color: "#161a21",
              lineHeight: 1.25,
              maxWidth: 940,
            }}
          >
            {siteConfig.name}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 24,
              fontSize: 32,
              color: "#4d5563",
              lineHeight: 1.5,
              maxWidth: 900,
            }}
          >
            {siteConfig.tagline}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "2px solid #e2e5e9",
            paddingTop: 28,
            fontSize: 24,
            color: "#6b7482",
          }}
        >
          <div style={{ display: "flex" }}>面向企业采购与供应链团队的供应商资料审核工具</div>
          <div style={{ display: "flex", color: "#9aa2ad" }}>V0.3 · 15 条审核规则已上线</div>
        </div>
      </div>
    ),
    size,
  );
}
