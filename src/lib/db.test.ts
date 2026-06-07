import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock PrismaPg adapter — must be a real constructor (used with `new`)
vi.mock("@prisma/adapter-pg", () => {
  return {
    PrismaPg: class PrismaPg {
      constructor(_opts: any) {}
    },
  };
});

// Mock PrismaClient — must be a real constructor (used with `new`)
vi.mock("@/generated/prisma/client", () => {
  return {
    PrismaClient: class PrismaClient {
      _isMock = true;
      constructor(_opts?: any) {}
    },
  };
});

describe("db module", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    // Clear the globalThis cache so each test starts fresh
    delete (globalThis as any).prisma;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete (globalThis as any).prisma;
  });

  it("exports a prisma client instance", async () => {
    const { prisma } = await import("./db");
    expect(prisma).toBeDefined();
  });

  it("creates a PrismaClient instance", async () => {
    const { prisma } = await import("./db");
    const { PrismaClient } = await import("@/generated/prisma/client");
    expect(prisma).toBeInstanceOf(PrismaClient);
  });

  it("caches prisma on globalThis in non-production", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    const { prisma } = await import("./db");
    expect((globalThis as any).prisma).toBe(prisma);
  });

  it("reuses existing globalThis.prisma if present", async () => {
    const sentinel = { _sentinel: true };
    (globalThis as any).prisma = sentinel;
    const { prisma } = await import("./db");
    expect(prisma).toBe(sentinel);
  });

  it("throws a descriptive error when DATABASE_URL is not set", async () => {
    delete process.env.DATABASE_URL;
    await expect(import("./db")).rejects.toThrow(
      "DATABASE_URL environment variable is not set",
    );
  });
});
