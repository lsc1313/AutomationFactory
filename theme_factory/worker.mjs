const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
export default {
 async fetch(request) {
  const url = new URL(request.url);
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
   return new Response(JSON.stringify({ app: "Theme Factory", version: "0.1.0", status: "foundation", productionReady: false }), { status: 200, headers });
  }
  return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
 }
};
