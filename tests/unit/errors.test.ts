import { describe, expect, it } from "vitest";

import { AppError, ERROR_CODES, errors, toAppError } from "@/lib/errors";

describe("AppError", () => {
  it("按错误码推导分类与 HTTP 状态码", () => {
    expect(new AppError(ERROR_CODES.UNAUTHENTICATED, "x").status).toBe(401);
    expect(new AppError(ERROR_CODES.FORBIDDEN, "x").status).toBe(403);
    expect(new AppError(ERROR_CODES.NOT_FOUND, "x").status).toBe(404);
    expect(new AppError(ERROR_CODES.CONFLICT, "x").status).toBe(409);
    expect(new AppError(ERROR_CODES.VALIDATION_FAILED, "x").status).toBe(400);
    expect(new AppError(ERROR_CODES.DATABASE_UNAVAILABLE, "x").status).toBe(503);
    expect(new AppError(ERROR_CODES.INTERNAL_ERROR, "x").status).toBe(500);
  });

  it("面向用户的文案不包含内部实现细节", () => {
    const error = new AppError(ERROR_CODES.DATABASE_UNAVAILABLE, "connect ECONNREFUSED 127.0.0.1:5432", {
      details: { dsn: "postgresql://user:pass@host/db" },
    });

    const userMessage = error.toUserMessage();
    expect(userMessage).not.toContain("ECONNREFUSED");
    expect(userMessage).not.toContain("5432");
    expect(userMessage).not.toContain("postgresql://");
    expect(userMessage).toContain("数据库");
  });

  it("响应体只暴露 code / message / requestId", () => {
    const body = new AppError(ERROR_CODES.FORBIDDEN, "内部原因", { requestId: "req-1" }).toResponseBody();

    expect(Object.keys(body.error).sort()).toEqual(["code", "message", "requestId"]);
    expect(body.error.requestId).toBe("req-1");
  });

  it("日志载荷保留可诊断信息", () => {
    const error = new AppError(ERROR_CODES.INTERNAL_ERROR, "boom", {
      details: { operation: "insert-document" },
      requestId: "req-2",
    });
    const payload = error.toLogPayload();

    expect(payload.code).toBe("INTERNAL_ERROR");
    expect(payload.details).toEqual({ operation: "insert-document" });
    expect(payload.requestId).toBe("req-2");
  });
});

describe("toAppError", () => {
  it("AppError 原样返回", () => {
    const original = errors.notFound("找不到");
    expect(toAppError(original)).toBe(original);
  });

  it("普通 Error 被包装为 INTERNAL_ERROR 并保留 cause", () => {
    const cause = new Error("底层失败");
    const wrapped = toAppError(cause);

    expect(wrapped.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(wrapped.cause).toBe(cause);
  });

  it("非 Error 值也能被规整，不会抛第二次", () => {
    expect(toAppError("字符串错误").code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(toAppError(null).code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(toAppError(undefined).code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(toAppError({ weird: true }).code).toBe(ERROR_CODES.INTERNAL_ERROR);
  });
});

describe("errors 便捷构造器", () => {
  it("每个构造器产生对应的错误码", () => {
    expect(errors.validation("x").code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(errors.unauthenticated().code).toBe(ERROR_CODES.UNAUTHENTICATED);
    expect(errors.forbidden("x").code).toBe(ERROR_CODES.FORBIDDEN);
    expect(errors.notFound("x").code).toBe(ERROR_CODES.NOT_FOUND);
    expect(errors.conflict("x").code).toBe(ERROR_CODES.CONFLICT);
    expect(errors.fileTooLarge("x").code).toBe(ERROR_CODES.FILE_TOO_LARGE);
    expect(errors.unsupportedMediaType("x").code).toBe(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE);
    expect(errors.unsafeFileName("x").code).toBe(ERROR_CODES.UNSAFE_FILE_NAME);
    expect(errors.database("x").code).toBe(ERROR_CODES.DATABASE_UNAVAILABLE);
    expect(errors.storage("x").code).toBe(ERROR_CODES.STORAGE_UNAVAILABLE);
    expect(errors.ai("x").code).toBe(ERROR_CODES.AI_PROVIDER_ERROR);
    expect(errors.configuration("x").code).toBe(ERROR_CODES.CONFIGURATION_ERROR);
    expect(errors.internal("x").code).toBe(ERROR_CODES.INTERNAL_ERROR);
  });
});
