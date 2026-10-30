#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = "test-token"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/health":
            self._json(404, {"error": {"code": "not_found", "message": "missing"}})
            return
        if self.headers.get("authorization") != f"Bearer {TOKEN}":
            self._json(401, {"error": {"code": "unauthorized", "message": "Missing or invalid bearer token"}})
            return
        self._json(200, {"status": "ok"})

    def do_POST(self) -> None:
        if self.headers.get("authorization") != f"Bearer {TOKEN}":
            self._json(401, {"error": {"code": "unauthorized", "message": "Missing or invalid bearer token"}})
            return
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length).decode())
        if payload.get("method") == "list_payers":
            self._json(200, {"result": {"items": [], "nextCursor": None}})
            return
        self._json(404, {"error": {"code": "not_found", "message": f"Unknown engine method {payload.get('method')}"}})

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def _json(self, status: int, body: object) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def serve() -> None:
    incoming = json.loads(sys.stdin.readline())
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    ready = {
        "port": port,
        "token": TOKEN,
        "config": {
            "databaseUrl": incoming["databaseUrl"],
            "storage": {"kind": "local", "dataDir": "./data/policies"},
            "models": {"strong": "", "cheap": ""},
            "firecrawlApiKey": None,
            "firecrawlApiUrl": None,
        },
    }
    sys.stdout.write(json.dumps(ready) + "\n")
    sys.stdout.flush()
    sys.stdin.read()
    server.shutdown()


def migrate() -> None:
    if "--db" not in sys.argv and not any(arg.startswith("--db=") for arg in sys.argv):
        print("Usage: anumat-engine migrate --db <url>", file=sys.stderr)
        raise SystemExit(1)
    print("Applied 20260929061425_init")


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "migrate":
        migrate()
        return
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        serve()
        return
    print("Usage: anumat-engine migrate --db <url>", file=sys.stderr)
    raise SystemExit(1)


if __name__ == "__main__":
    main()
