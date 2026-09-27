import { siteConfig } from "@/lib/site";

/**
 * 品牌标识。
 *
 * 图形 = 一份文件 + 右下角「判定徽章」。
 *
 * 为什么不是盾牌：盾牌讲的是"安全"，而这个产品讲的是"逐条核对后给出可追溯的判定"。
 * 盾牌在 B2B 里已经被用滥到失去识别度了；文件 + 勾的组合同时命中
 * 资料（文件）与结论（判定）两件事，缩到 16px 也还能看出是个带勾的文件。
 *
 * 描边风格与 `components/ui/icons.tsx` 同源（2px、圆角端点），
 * 所以 logo 和界面图标放在一起不会像两套东西。
 */
export function LogoMark({
  className = "h-8 w-8",
  inverse = false,
}: {
  className?: string;
  /** 深底反白：徽章底变白、勾变蓝，避免在深底色上出现"白圆白勾"。 */
  inverse?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label={`${siteConfig.name} 标识`}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7.5 5h8l4 4v18h-12z" />
        <path d="M15.5 5v4h4" />
        <path d="M11 14h6" />
        <path d="M11 18h6" />
      </g>
      <circle cx="23" cy="23" r="7" fill={inverse ? "#ffffff" : "currentColor"} />
      <path
        d="M20.2 23.1l2.1 2.1 3.6-3.6"
        fill="none"
        stroke={inverse ? "#2f6097" : "#ffffff"}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 横版字标：图形 + 中文简称 + 拉丁名。
 *
 * 拉丁名不参与主视觉（`text-ink-400`）：对外传播一律用中文，
 * 拉丁名只用于技术场景（域名、代码、英文材料）—— 主次不能颠倒。
 */
export function LogoLockup({
  className = "",
  inverse = false,
  withLatin = true,
}: {
  className?: string;
  inverse?: boolean;
  withLatin?: boolean;
}) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-9 w-9 shrink-0" inverse={inverse} />
      <span className="flex flex-col leading-none">
        <span
          className={`text-[15px] font-semibold tracking-tight ${
            inverse ? "text-white" : "text-ink-900"
          }`}
        >
          {siteConfig.shortName}
        </span>
        {withLatin ? (
          <span className={`mt-1 text-[10px] tracking-wide ${inverse ? "text-brand-200" : "text-ink-400"}`}>
            {siteConfig.latinName}
          </span>
        ) : null}
      </span>
    </span>
  );
}
