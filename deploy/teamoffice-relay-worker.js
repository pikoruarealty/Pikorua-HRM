// Cloudflare Worker: relay for the TeamOffice biometric API (2026-10-08).
//
// Why: from the Hostinger VPS, outbound TCP to api.etimeoffice.com (182.156.34.205)
// stopped getting answers (mtr showed 60-100% loss at the first hop outside
// Hostinger's network), while the same API worked from other networks. The
// Cloudflare Tunnel only carries traffic INTO the VPS, so the app's outbound call
// is relayed through Cloudflare's network instead.
//
// No app code change: set in /opt/pikorua-hrm/app.env
//   TEAM_OFFICE_BASE_URL=https://<worker-name>.<account>.workers.dev/<RELAY_SECRET>/api/
// (trailing slash matters). The app keeps sending its normal Basic auth header,
// which this Worker passes through untouched; the Worker stores no credentials.
//
// Not an open relay: the first path segment must equal the RELAY_SECRET Worker
// secret, only GET is allowed, and only /api/* on the one TeamOffice host.

const UPSTREAM = "https://api.etimeoffice.com";

export default {
  async fetch(request, env) {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (!env.RELAY_SECRET) return new Response("Relay not configured", { status: 500 });

    const url = new URL(request.url);
    const [, secret, ...rest] = url.pathname.split("/");
    if (secret !== env.RELAY_SECRET) return new Response("Not found", { status: 404 });
    const path = "/" + rest.join("/");
    if (!path.startsWith("/api/")) return new Response("Not found", { status: 404 });

    const headers = { "content-type": "application/json" };
    const auth = request.headers.get("authorization");
    if (auth) headers.authorization = auth;

    const upstream = await fetch(UPSTREAM + path + url.search, {
      method: "GET",
      headers,
      redirect: "manual",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  },
};
