"""`uv run shopr` / `python -m shopr`: start the server and print the addresses to use."""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import time
import webbrowser

import uvicorn


def lan_ip() -> str | None:
    """The address other devices on your Wi-Fi can reach this computer at."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packets are sent for UDP connect
            return s.getsockname()[0]
    except OSError:
        return None


def _open_when_ready(url: str, port: int, timeout: float = 60) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                webbrowser.open(url)
                return
        except OSError:
            time.sleep(0.5)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the shopr server.")
    parser.add_argument("--host", default="0.0.0.0", help="0.0.0.0 lets your phone connect over Wi-Fi")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--open", action="store_true", help="open shopr in your browser once it's running")
    args = parser.parse_args()

    local = f"http://localhost:{args.port}"
    ip = lan_ip()
    print()
    print("  shopr is starting. Keep this window open while you use it.")
    print(f"  On this computer, open:    {local}")
    if ip and args.host == "0.0.0.0":
        print(f"  In the phone app (Setup):  http://{ip}:{args.port}   (phone must be on the same Wi-Fi)")
    if sys.platform == "win32":
        print("  If Windows asks whether Python may use the network, click Allow.")
    print()
    if args.open:
        threading.Thread(target=_open_when_ready, args=(local, args.port), daemon=True).start()
    uvicorn.run("shopr.app:create_app", factory=True, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
