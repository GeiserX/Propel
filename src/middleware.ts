import { NextRequest, NextResponse } from "next/server";
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from "./lib/og-translations";

const localeSet = new Set<string>(SUPPORTED_LOCALES);

function detectLocale(req: NextRequest): string {
  // Explicit user choice (cookie set by setLocale) takes priority
  const cookie = req.cookies.get("pumperly-locale")?.value;
  if (cookie && localeSet.has(cookie)) return cookie;

  const accept = req.headers.get("accept-language") ?? "";
  for (const part of accept.split(",")) {
    const code = part.split(";")[0].trim().split("-")[0].toLowerCase();
    if (localeSet.has(code)) return code;
  }
  return DEFAULT_LOCALE;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip API routes, Next.js internals, and static assets
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/icon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Check if path already starts with a locale
  const segments = pathname.split("/");
  const firstSegment = segments[1];

  if (firstSegment && localeSet.has(firstSegment)) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-pumperly-locale", firstSegment);
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.cookies.set("pumperly-locale", firstSegment, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return res;
  }

  // Root "/" — rewrite internally to /[detected-locale] (URL stays as /)
  const locale = detectLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname}`;
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pumperly-locale", locale);
  const res = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  res.cookies.set("pumperly-locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
