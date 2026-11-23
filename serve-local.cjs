const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { handleRooms } = require("./online-rooms.cjs");

const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN) : null;
if (publicOrigin && (publicOrigin.protocol !== "https:" || publicOrigin.href !== publicOrigin.origin + "/")) {
  throw new Error("PUBLIC_ORIGIN must be an HTTPS origin, such as https://cards.example.com");
}
const host = publicOrigin ? "0.0.0.0" : "127.0.0.1";
const port = Number(process.env.PORT || 8765);
const allowedOrigins = publicOrigin
  ? [publicOrigin.origin]
  : ["http://127.0.0.1:" + port, "http://localhost:" + port];
const files = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/tabletop.js", ["tabletop.js", "text/javascript"]],
  ["/online-play.js", ["online-play.js", "text/javascript"]],
]);

const server = http.createServer((request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  response.setHeader("Cache-Control", "no-store");

  // Serve only known files from recognized loopback hostnames. Never resolve a URL as a file path.
  if (!publicOrigin && !["127.0.0.1:" + port, "localhost:" + port].includes(request.headers.host)) {
    response.writeHead(403).end();
    return;
  }
  const target = request.url ?? "";
  if (target.startsWith("/api/")) {
    handleRooms(request, response, new URL("http://sandbox.invalid" + target), allowedOrigins);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const entry = files.get(request.url.split("?")[0]);
  if (!entry) {
    response.writeHead(404).end();
    return;
  }
  const [filename, type] = entry;
  fs.readFile(path.join(__dirname, filename), (error, data) => {
    if (error) {
      response.writeHead(500).end();
      return;
    }
    response.writeHead(200, { "Content-Type": type + "; charset=utf-8", "Content-Length": data.length });
    response.end(request.method === "HEAD" ? undefined : data);
  });
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;

server.listen(port, host, () => process.stdout.write("Sandbox ready at " + (publicOrigin?.origin ?? allowedOrigins[0]) + "\n"));
