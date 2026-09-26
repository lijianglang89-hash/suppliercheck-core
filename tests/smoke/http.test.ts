/**
 * HTTP 冒烟测试。
 *
 * 需要有一个真实运行的服务实例：设置 SMOKE_BASE_URL 后才会执行。
 *
 * 建议指向 `next start` 的生产实例而不是 `next dev` ——
 * 静态预渲染、重定向缓存、响应头这几类问题只在生产模式下才会暴露。
 *
 *   SMOKE_BASE_URL=http://127.0.0.1:3010 npx vitest run tests/smoke
 */
import { describe, expect, it } from "vitest";

const BASE_URL = process.env.SMOKE_BASE_URL?.replace(/\/+$/, "");

const describeSmoke = BASE_URL ? describe : describe.skip;

describeSmoke(`HTTP 冒烟（${BASE_URL}）`, () => {
  it("公开首页返回 200，并包含产品名与价值主张", async () => {
    const response = await fetch(`${BASE_URL}/`);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain("供应商智审");
    expect(html).toContain("AI 自动审核供应商资料");
    // 服务端渲染：正文必须出现在 HTML 里，而不是靠客户端 JS 注入
    expect(html).toContain("常见问题");
  });

  it("首页 HTML 里带 canonical 与 Open Graph", async () => {
    const html = await (await fetch(`${BASE_URL}/`)).text();
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:image"');
  });

  it("登录页与注册页可访问", async () => {
    expect((await fetch(`${BASE_URL}/login`)).status).toBe(200);
    expect((await fetch(`${BASE_URL}/register`)).status).toBe(200);
  });

  it("未登录访问 /dashboard 被重定向到登录页", async () => {
    const response = await fetch(`${BASE_URL}/dashboard`, { redirect: "manual" });
    expect([302, 307, 308]).toContain(response.status);

    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/login");
  });

  it("未知路径返回 404", async () => {
    const response = await fetch(`${BASE_URL}/this-page-does-not-exist`);
    expect(response.status).toBe(404);
  });

  it("健康检查返回 ok，并且不泄露敏感信息", async () => {
    const response = await fetch(`${BASE_URL}/api/health`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.database).toBe("ok");

    const raw = JSON.stringify(body);
    for (const secret of ["postgresql://", "password", "SESSION_SECRET", "AI_API_KEY", "/srv/", "/Users/"]) {
      expect(raw, `健康检查响应不应包含 ${secret}`).not.toContain(secret);
    }
  });

  it("sitemap.xml 与 robots.txt 可被抓取", async () => {
    const sitemap = await fetch(`${BASE_URL}/sitemap.xml`);
    expect(sitemap.status).toBe(200);
    expect(await sitemap.text()).toContain("<urlset");

    const robots = await fetch(`${BASE_URL}/robots.txt`);
    expect(robots.status).toBe(200);
    const robotsText = await robots.text();
    expect(robotsText).toContain("Sitemap:");
    expect(robotsText).toContain("Disallow: /api/");
  });

  it("OG 图接口返回 PNG", async () => {
    const response = await fetch(`${BASE_URL}/og`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
  });

  it("安全响应头已下发", async () => {
    const response = await fetch(`${BASE_URL}/`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
});
