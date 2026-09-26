/**
 * 应用导航结构。
 *
 * 存在的两个职责：
 * 1. 驱动侧边栏渲染；
 * 2. 与 `app/` 目录下的真实路由保持一一对应 —— 这里是「哪些页面已实现」的检查清单。
 *
 * ⚠️ 本文件**不再有 `available` 开关**。曾经有一个，用来把未实现的页面渲染成「即将开放」；
 * 代价是界面上长期挂着一排占位符，用户以为功能存在却点不动 ——
 * 一个点不动的入口比没有入口更糟，它会让人怀疑整个产品。
 * 现在导航只列真实可用的页面：加一项的前提是那个路由真的能打开。
 */
export interface NavItem {
  label: string;
  href: string;
  /** 一句话说明这个页面做什么。用于侧边栏 title 与无障碍描述。 */
  hint: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "概览",
    items: [{ label: "工作台", href: "/dashboard", hint: "资料与审核的整体情况" }],
  },
  {
    label: "资料审核",
    items: [
      { label: "资料库", href: "/documents", hint: "上传并查看供应商资料包的解析情况" },
      { label: "供应商", href: "/suppliers", hint: "登记供应商主体与联系方式" },
      { label: "资料审核", href: "/reviews", hint: "用审核模板对资料包发起审核" },
      { label: "审核报告", href: "/reports", hint: "查看已完成的审核结论" },
    ],
  },
  {
    label: "配置",
    items: [
      { label: "审核模板", href: "/templates", hint: "定义必备资料清单与审核规则" },
      { label: "设置", href: "/settings", hint: "工作区、账号与引擎配置" },
    ],
  },
] as const;

/** 需求中规划的全部路由，供文档与测试对齐使用。 */
export const PLANNED_ROUTES = [
  "/",
  "/login",
  "/register",
  "/dashboard",
  "/documents",
  "/suppliers",
  "/reviews",
  "/reports",
  "/templates",
  "/settings",
] as const;
