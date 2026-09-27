import Link from "next/link";

export interface Crumb {
  label: string;
  /** 最后一级不给 href。 */
  href?: string;
}

/**
 * 面包屑。
 *
 * 存在理由不是「好看」：扁平站点里爬虫只能靠链接关系理解层级，
 * 面包屑同时给了人和爬虫一条稳定的回上层路径（配合 BreadcrumbList 结构化数据）。
 *
 * 用 <ol> + <nav aria-label>：层级是有序的，不是一组平铺链接。
 */
export function SiteBreadcrumb({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="面包屑" className="text-xs text-ink-500">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={item.label} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-brand-700 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-ink-700">
                  {item.label}
                </span>
              )}
              {isLast ? null : (
                <span aria-hidden="true" className="text-ink-300">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
