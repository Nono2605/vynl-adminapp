import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Deux rôles : rafraîchir le token Supabase à chaque requête (sans ça une
// session expire silencieusement en navigation pure) et renvoyer les visiteurs
// anonymes vers /login. Ce n'est PAS la barrière de sécurité : le rôle admin
// est vérifié dans requireAdmin() (src/lib/session.ts), côté serveur, à chaque
// layout / page / action.
const PUBLIC_PATHS = ["/login"];

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Configuration manquante : on bloque tout (jamais d'accès sans vérification)
  // mais lisiblement. Sans ce test, Vercel affiche un 500 MIDDLEWARE_INVOCATION_FAILED
  // opaque. Le détail va dans les logs, pas dans la réponse publique. Les
  // NEXT_PUBLIC_* sont figées au build : il faut redéployer après les avoir
  // ajoutées ou modifiées sur Vercel.
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      "Admin is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set. " +
        "They are baked in at build time: redeploy after adding them."
    );
    return new NextResponse("Admin is not configured.", { status: 503 });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !PUBLIC_PATHS.includes(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
