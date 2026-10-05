"""Refuse request bodies above a fixed size before any handler reads them.

Pure ASGI middleware: a declared Content-Length over the cap is answered with
413 immediately; a chunked body is counted as it streams and cut off at the cap.
The cap is sized for the largest legitimate request, the PDF report with twelve
4 MB captures as base64 (~67 MB), with headroom.
"""
import json

MAX_BODY_BYTES = 80 * 1024 * 1024


def _too_large_response(send):
    body = json.dumps({"detail": "Request body too large"}).encode()

    async def respond():
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
    return respond


class BodySizeLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = MAX_BODY_BYTES
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    if int(value) > limit:
                        await _too_large_response(send)()
                        return
                except ValueError:
                    pass
                break

        received = 0
        tripped = False

        async def limited_receive():
            nonlocal received, tripped
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    tripped = True
                    # Starve the handler: deliver an empty, final chunk so parsing fails fast
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        await self.app(scope, limited_receive, send)
