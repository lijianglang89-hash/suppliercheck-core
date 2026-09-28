import Image from "next/image";

import { siteConfig } from "@/lib/site";

/**
 * 品牌标识（2026-09-28 起改用设计稿）。
 *
 * 图形来自 `docs/brand/logo-source-企智审.png`（James 设计），
 * 由 `scripts/brand/make-logo-assets.py` 抠成透明底：
 * 六边形底 + 白色盾牌 + 文档 + 青绿对勾 —— 「资料经核对后判定」这件事，一眼可读。
 *
 * ⚠️ 两点纪律：
 * 1. **不要手改 public/brand 下的 PNG。** 它们是脚本产物，改源图或脚本再重跑，
 *    否则脚本与产物静默失同步（这条在示例 PDF 上付过学费）。
 * 2. **不再有拉丁名。** 产品服务国内客户，对客物料全中文（见 lib/site.ts 说明）。
 */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <Image
      src="/brand/mark-transparent-512.png"
      alt=""
      width={512}
      height={512}
      className={`shrink-0 object-contain ${className}`}
      priority
      aria-hidden="true"
    />
  );
}

/**
 * 横版字标：图形 + 简称；可选在下方补全称。
 *
 * 简称在上、全称在下 —— 简称便于记忆，全称保证「企业供应商智能审核平台」
 * 这个搜索词在页面上真实出现过（SEO 与 GEO 都要求实体名称稳定且可检索）。
 */
export function LogoLockup({
  className = "",
  withFullName = true,
}: {
  className?: string;
  /** 导航或页脚空间紧张时可关掉全称。 */
  withFullName?: boolean;
}) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-9 w-9" />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-ink-900">
          {siteConfig.shortName}
        </span>
        {withFullName ? (
          <span className="mt-1 text-[10px] tracking-wide text-ink-400">{siteConfig.name}</span>
        ) : null}
      </span>
    </span>
  );
}
