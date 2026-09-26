/**
 * 应用导航结构。
 *
 * 这里同时承担两个职责：
 * 1. 驱动侧边栏渲染；
 * 2. 明确标注哪些页面 V0.1 已经存在、哪些尚未开放 —— 避免 UI 出现死链，
 *    也避免用户以为某个功能已经可用。
 */
export interface NavItem {
  label: string;
  href: string;
  available: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "概览",
    items: [{ label: "工作台", href: "/dashboard", available: true }],
  },
  {
    label: "资料审核",
    items: [
      { label: "供应商", href: "/suppliers", available: false },
      { label: "资料审核", href: "/reviews", available: false },
      { label: "审核报告", href: "/reports", available: false },
    ],
  },
  {
    label: "配置",
    items: [
      { label: "审核模板", href: "/templates", available: false },
      { label: "设置", href: "/settings", available: false },
    ],
  },
] as const;

/** 需求中规划的全部路由，供文档与测试对齐使用。 */
export const PLANNED_ROUTES = [
  "/",
  "/login",
  "/register",
  "/dashboard",
  "/suppliers",
  "/reviews",
  "/reports",
  "/templates",
  "/settings",
] as const;
