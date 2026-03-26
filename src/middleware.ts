import { NextRequest, NextResponse } from "next/server";
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from "./lib/og-translations";

const localeSet = new Set<string>(SUPPORTED_LOCALES);

function detectLocale(req: NextRequest): string {
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
    return NextResponse.next();
  }

  // Root "/" — rewrite internally to /[detected-locale] (URL stays as /)
  const locale = detectLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
