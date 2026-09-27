/**
 * 警示卡片（Alert Card）。
 *
 * 存在的理由：负面状态（阻断项 / 问题）在干净的 SaaS 界面里极易变成视觉噪音 ——
 * 高饱和纯红底色像一块没经过设计的补丁，反而让人怀疑整页的完成度。
 * 解法不是把红色去掉（业务压迫感是真实的，该有），而是**降噪**：
 *
 *   1. 底色改极淡（bg-red-50/60）而不是实心红块；
 *   2. 攻击性集中到左侧 3px 重边框上 —— 一条线足够表达「这里有问题」；
 *   3. 信息分三层：状态（主标题，最深）/ 定性（mini badge）/ 对象（次要文本）。
 *
 * 三层缺一不可：平铺成一行「证照已过期 ISO9001 证书 · 阻断项」时，
 * 读者要自己拆句子才知道哪个是问题、哪个是文件、哪个是级别。
 *
 * ⚠️ 配色纪律（实测）：
 * 次要文本原本按直觉写 `text-red-700/70`，但 70% 透明度叠在红底白卡上
 * 实测对比度只有 ~3.7，达不到 WCAG AA 的 4.5。层次改用**色深 + 字号**表达
 * （red-900 → red-700，14px → 12px），不靠降透明度 —— 变淡不等于可以更淡到看不清。
 */
import { Icon, type IconName } from "@/components/ui/icons";

export type AlertTone = "danger" | "success";

const TONE_STYLE: Record<
  AlertTone,
  {
    wrap: string;
    icon: string;
    title: string;
    badge: string;
    subject: string;
  }
> = {
  danger: {
    wrap: "border-red-100 border-l-3 border-l-red-500 bg-red-50/60",
    icon: "text-red-500",
    title: "text-red-900",
    badge: "bg-red-100 text-red-700",
    subject: "text-red-700",
  },
  success: {
    wrap: "border-emerald-100 border-l-3 border-l-emerald-500 bg-emerald-50/60",
    icon: "text-emerald-600",
    title: "text-emerald-900",
    badge: "bg-emerald-100 text-emerald-700",
    subject: "text-emerald-700",
  },
};

export function AlertCard({
  tone,
  icon,
  title,
  badge,
  subject,
  className = "",
}: {
  tone: AlertTone;
  icon: IconName;
  /** 状态 —— 主标题，视觉权重最高。 */
  title: string;
  /** 定性 —— 级别 / 结论标签，缩小成 mini badge。 */
  badge?: string;
  /** 对象 / 补充 —— 涉及哪份资料、下一步该做什么，权重最低。 */
  subject?: string;
  className?: string;
}) {
  const style = TONE_STYLE[tone];

  return (
    <div
      className={`flex items-start gap-2.5 rounded-md border p-3 shadow-sm ${style.wrap} ${className}`}
    >
      <Icon name={icon} className={`mt-0.5 h-4 w-4 shrink-0 ${style.icon}`} aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-sm font-semibold leading-5 ${style.title}`}>{title}</span>
          {badge ? (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wider ${style.badge}`}
            >
              {badge}
            </span>
          ) : null}
        </div>
        {subject ? <span className={`text-xs leading-5 ${style.subject}`}>{subject}</span> : null}
      </div>
    </div>
  );
}
