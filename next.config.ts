import type { NextConfig } from "next";

// Le code de ce dépôt est public : la sécurité ne repose donc jamais sur le
// secret du code, uniquement sur les contrôles côté serveur (voir
// src/lib/session.ts) et sur les variables d'environnement Vercel.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Pas d'iframe : l'admin ne doit jamais être embarquée ailleurs.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
