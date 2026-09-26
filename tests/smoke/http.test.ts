/**
 * HTTP 冒烟测试。
 *
 * 需要有一个真实运行的服务实例：设置 SMOKE_BASE_URL 后才会执行。
 *
 * 生产模式（standalone 产物）的正确起法：
 *
 *   npm run build
 *   PORT=3010 node .next/standalone/server.js &
 *   SMOKE_BASE_URL=http://127.0.0.1:3010 npx vitest run tests/smoke
 *
 * ⚠️ 不要用 `npm run start`（即 `next start`）：Next 16 在 `output: "standalone"`
 * 下会明确警告 "next start does not work with output: standalone"。
 * 也不要指望 `next dev`：`force-dynamic` 路由、重定向缓存、安全响应头这几类行为
 * 在 dev 与生产下不一致，dev 下通过不代表生产没问题。
 *
 * 关于条件启用：这里用**顶层 if/else** 而不是 `const d = cond ? describe : describe.skip`。
 * 后者在 Vitest 5 下会在收集阶段抛 "Cannot read properties of undefined (reading 'config')"
 * —— 也就是说那种写法会让整个文件炸掉，而不是优雅跳过。别再改回去。
 */
import { describe, expect, it } from "vitest";

const BASE_URL = process.env.SMOKE_BASE_URL?.replace(/\/+$/, "");

/** 一个语法合法但几乎不可能存在的 UUID（用于未授权行为的探测）。 */
const ABSENT_UUID = "00000000-0000-4000-8000-000000000000";

if (!BASE_URL) {
  describe("HTTP 冒烟（未启用）", () => {
    it.skip("未设置 SMOKE_BASE_URL，跳过全部冒烟用例", () => {});
  });
} else {
  describe(`HTTP 冒烟（${BASE_URL}）`, () => {
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

    it("未登录访问 /documents 被重定向到登录页（V0.2 新路由同样受保护）", async () => {
      const response = await fetch(`${BASE_URL}/documents`, { redirect: "manual" });
      expect([302, 307, 308]).toContain(response.status);
      expect(response.headers.get("location") ?? "").toContain("/login");
    });

    it("未知路径返回 404", async () => {
      const response = await fetch(`${BASE_URL}/this-page-does-not-exist`);
      expect(response.status).toBe(404);
    });

    it("★ 未登录调用资料包接口一律 401，不因资源是否存在而不同", async () => {
      // 零信任的核心断言：拿一个**根本不存在**的 id 去打，答案也必须是 401，
      // 而不是 404 —— 否则「404 还是 401」本身就泄漏了该 id 是否存在。
      const targets = [
        `${BASE_URL}/api/documents`,
        `${BASE_URL}/api/documents/${ABSENT_UUID}`,
        `${BASE_URL}/api/files/${ABSENT_UUID}`,
        `${BASE_URL}/api/files/signed/${ABSENT_UUID}`,
      ];

      for (const target of targets) {
        const response = await fetch(target, { redirect: "manual" });
        expect(response.status, `${target} 未登录时应为 401`).toBe(401);
      }

      const upload = await fetch(
        `${BASE_URL}/api/documents/upload?workspaceId=${ABSENT_UUID}`,
        { method: "POST", body: new FormData(), redirect: "manual" },
      );
      expect(upload.status).toBe(401);
    });

    it("健康检查返回 ok，并且不泄露敏感信息", async () => {
      const response = await fetch(`${BASE_URL}/api/health`);
      expect(response.status).toBe(200);

      const body = (await response.json()) as Record<string, unknown>;
      expect(body.status).toBe("ok");
      expect(body.database).toBe("ok");

      const raw = JSON.stringify(body);
      for (const secret of [
        "postgresql://",
        "password",
        "SESSION_SECRET",
        "AI_API_KEY",
        "/srv/",
        "/Users/",
      ]) {
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
}
