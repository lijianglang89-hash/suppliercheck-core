import { SEVERITY_BAR_CLASS, SEVERITY_LABELS } from "@/lib/reviews/labels";
import { SEVERITIES, type Severity } from "@/lib/reviews/types";

/**
 * 严重度分布条：一条横向堆叠条，按比例显示各严重级别的发现数。
 *
 * 为什么要有它：用户扫一眼报告列表，要回答的问题不是「有几条发现」
 * 而是「问题有多重」—— 「高 3 低 1」要逐个读徽标才能拼出来，
 * 一条红多蓝少的条子一眼就有结论。
 *
 * 数据全部来自 findings 的真实计数，没有任何演示成分；
 * total 为 0 时整条不渲染（「未发现问题」由调用方另行表达）。
 */
export function SeverityBar({
  counts,
  className = "w-28",
}: {
  counts: Partial<Record<Severity, number>>;
  className?: string;
}) {
  const total = SEVERITIES.reduce((sum, severity) => sum + (counts[severity] ?? 0), 0);
  if (total === 0) return null;

  const label = SEVERITIES.filter((severity) => (counts[severity] ?? 0) > 0)
    .map((severity) => `${SEVERITY_LABELS[severity]} ${counts[severity]}`)
    .join("，");

  return (
    <div
      className={`flex h-1.5 overflow-hidden rounded-full bg-ink-100 ${className}`}
      role="img"
      aria-label={`发现严重度分布：${label}`}
      title={label}
    >
      {SEVERITIES.filter((severity) => (counts[severity] ?? 0) > 0).map((severity) => (
        <div
          key={severity}
          className={SEVERITY_BAR_CLASS[severity]}
          style={{ width: `${((counts[severity] ?? 0) / total) * 100}%` }}
        />
      ))}
    </div>
  );
}
