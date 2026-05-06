import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to mock next/server since middleware uses NextRequest/NextResponse
vi.mock("next/server", () => {
  class MockHeaders extends Map<string, string> {
    constructor(init?: Record<string, string> | [string, string][]) {
      super();
      if (init && !Array.isArray(init)) {
        for (const [k, v] of Object.entries(init)) {
          this.set(k.toLowerCase(), v);
        }
      }
    }
    // next/server Headers uses .get() which Map already provides
  }

  class MockNextRequest {
    nextUrl: { pathname: string; clone: () => MockNextRequest["nextUrl"] };
    headers: MockHeaders;
    cookies: { get: (name: string) => { value: string } | undefined };

    constructor(
      url: string,
      options?: {
        headers?: Record<string, string>;
        cookies?: Record<string, string>;
      },
    ) {
      const parsed = new URL(url, "http://localhost");
      const self = this;
      this.nextUrl = {
        pathname: parsed.pathname,
        clone() {
          return { ...self.nextUrl, pathname: self.nextUrl.pathname };
        },
      };
      this.headers = new MockHeaders(options?.headers);
      const cookieStore = options?.cookies ?? {};
      this.cookies = {
        get: (name: string) =>
          name in cookieStore ? { value: cookieStore[name] } : undefined,
      };
    }
  }

  const responses: Array<{ type: string; args: unknown[] }> = [];

  class MockNextResponse {
    static _responses = responses;

    cookies = {
      set: vi.fn(),
    };

    static next(opts?: { request?: { headers?: MockHeaders } }) {
      const res = new MockNextResponse();
      responses.push({ type: "next", args: [opts] });
      return res;
    }

    static rewrite(url: unknown, opts?: unknown) {
      const res = new MockNextResponse();
      responses.push({ type: "rewrite", args: [url, opts] });
      return res;
    }

    static redirect(url: unknown, status?: number) {
      const res = new MockNextResponse();
      responses.push({ type: "redirect", args: [url, status] });
      return res;
    }

    static json(data: unknown, init?: unknown) {
      return { data, init };
    }
  }

  return {
    NextRequest: MockNextRequest,
    NextResponse: MockNextResponse,
  };
});

// Import after mock
import { NextRequest, NextResponse } from "next/server";
import { middleware, config } from "./middleware";

function makeRequest(
  pathname: string,
  opts?: { headers?: Record<string, string>; cookies?: Record<string, string> },
) {
  return new (NextRequest as any)(`http://localhost${pathname}`, opts);
}

describe("middleware", () => {
  beforeEach(() => {
    (NextResponse as any)._responses.length = 0;
  });

  it("skips API routes", () => {
    const req = makeRequest("/api/stations");
    const res = middleware(req);
    // Should call NextResponse.next() without locale rewrite
    expect(res).toBeDefined();
  });

  it("skips Next.js internals", () => {
    const req = makeRequest("/_next/static/chunk.js");
    const res = middleware(req);
    expect(res).toBeDefined();
  });

  it("skips paths with file extensions", () => {
    const req = makeRequest("/icon.svg");
    const res = middleware(req);
    expect(res).toBeDefined();
  });

  it("passes through when locale is already in path", () => {
    const req = makeRequest("/en");
    const res = middleware(req);
    expect(res).toBeDefined();
    // Should set cookie for the detected locale
    expect(res.cookies.set).toHaveBeenCalledWith(
      "pumperly-locale",
      "en",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("detects locale from cookie", () => {
    const req = makeRequest("/", { cookies: { "pumperly-locale": "fr" } });
    const res = middleware(req);
    expect(res).toBeDefined();
    expect(res.cookies.set).toHaveBeenCalledWith(
      "pumperly-locale",
      "fr",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("detects locale from accept-language header", () => {
    const req = makeRequest("/", {
      headers: { "accept-language": "de-DE,de;q=0.9,en;q=0.8" },
    });
    const res = middleware(req);
    expect(res).toBeDefined();
    expect(res.cookies.set).toHaveBeenCalledWith(
      "pumperly-locale",
      "de",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("falls back to es when no locale detected", () => {
    const req = makeRequest("/", {
      headers: { "accept-language": "zh-CN" },
    });
    const res = middleware(req);
    expect(res).toBeDefined();
    expect(res.cookies.set).toHaveBeenCalledWith(
      "pumperly-locale",
      "es",
      expect.objectContaining({ path: "/" }),
    );
  });
});

describe("middleware root redirect", () => {
  beforeEach(() => {
    (NextResponse as any)._responses.length = 0;
  });

  it("redirects root path to detected locale", () => {
    const req = makeRequest("/");
    middleware(req);

    const responses = (NextResponse as any)._responses as Array<{
      type: string;
      args: unknown[];
    }>;
    const redirectCall = responses.find((r) => r.type === "redirect");
    expect(redirectCall).toBeDefined();
    expect(redirectCall!.args[1]).toBe(302);
  });

  it("redirects non-root paths without locale", () => {
    const req = makeRequest("/some/page");
    middleware(req);

    const responses = (NextResponse as any)._responses as Array<{
      type: string;
      args: unknown[];
    }>;
    const redirectCall = responses.find((r) => r.type === "redirect");
    expect(redirectCall).toBeDefined();

    const url = redirectCall!.args[0] as { pathname: string };
    expect(url.pathname).toBe("/es/some/page");
  });

  it("redirects to detected locale from accept-language", () => {
    const req = makeRequest("/", {
      headers: { "accept-language": "fr-FR,fr;q=0.9" },
    });
    middleware(req);

    const responses = (NextResponse as any)._responses as Array<{
      type: string;
      args: unknown[];
    }>;
    const redirectCall = responses.find((r) => r.type === "redirect");
    expect(redirectCall).toBeDefined();

    const url = redirectCall!.args[0] as { pathname: string };
    expect(url.pathname).toBe("/fr/");
  });
});

describe("middleware locale in path", () => {
  beforeEach(() => {
    (NextResponse as any)._responses.length = 0;
  });

  it("sets x-pumperly-locale header when locale is in path", () => {
    const req = makeRequest("/de/map");
    middleware(req);

    const responses = (NextResponse as any)._responses as Array<{
      type: string;
      args: unknown[];
    }>;
    const nextCall = responses.find((r) => r.type === "next");
    expect(nextCall).toBeDefined();

    const opts = nextCall!.args[0] as {
      request?: { headers?: Map<string, string> };
    };
    expect(opts?.request?.headers).toBeDefined();
    expect(opts!.request!.headers!.get("x-pumperly-locale")).toBe("de");
  });
});

describe("middleware config", () => {
  it("has matcher pattern", () => {
    expect(config.matcher).toBeDefined();
    expect(config.matcher).toHaveLength(1);
  });
});
