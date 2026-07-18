import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// This is Next 16's renamed `middleware.ts` (the `middleware` file
// convention is deprecated in favor of `proxy` — see
// node_modules/next/dist/docs/.../file-conventions/proxy.md).
//
// Refreshes the Supabase auth cookie on every request. Required per the
// Supabase SSR guide: Server Components can't write cookies during render
// (see src/lib/supabase/server.ts), so without this, sessions would expire
// without ever being renewed.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not add code between createServerClient and this call — Supabase
  // must see every request to know when to rotate the refresh token.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon$|icon1$|icon2$|apple-icon$|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
