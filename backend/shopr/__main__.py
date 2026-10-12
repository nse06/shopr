"""`uv run shopr` / `python -m shopr`: start the server and print the addresses to use."""

from __future__ import annotations

import argparse
import json
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
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


# The Windows launcher closes quietly on this exit code (shopr was already running).
ALREADY_RUNNING = 3


def port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if sys.platform != "win32":
            # Match the server's own socket options, so a just-closed port counts as free.
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
        except OSError:
            return False
    return True


def shopr_running(port: int) -> bool:
    """Is the program on this port a shopr server?"""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status", timeout=3) as r:
            return "embedder" in json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        # A shopr server with SHOPR_TOKEN set answers 401 with its own message.
        return e.code == 401 and b"access token" in e.read()
    except (OSError, ValueError):
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the shopr server.")
    parser.add_argument("--host", default="0.0.0.0", help="0.0.0.0 lets your phone connect over Wi-Fi")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--open", action="store_true", help="open shopr in your browser once it's running")
    args = parser.parse_args()

    port = args.port
    if not port_free(args.host, port):
        if shopr_running(port):
            print()
            print("  shopr is already running in another window, so this one isn't needed.")
            if args.open:
                print("  Opening it in your browser.")
                webbrowser.open(f"http://localhost:{port}")
            print()
            sys.exit(ALREADY_RUNNING)
        busy = port
        port = next((p for p in range(busy + 1, busy + 20) if port_free(args.host, p)), 0)
        if not port:
            sys.exit(f"Ports {busy}-{busy + 19} are all in use by other programs; close some and try again.")
        print(f"\n  Another program is using port {busy}, so shopr is using port {port} instead.")

    local = f"http://localhost:{port}"
    ip = lan_ip()
    print()
    print("  shopr is starting. Keep this window open while you use it.")
    print(f"  On this computer, open:    {local}")
    if ip and args.host == "0.0.0.0":
        print(f"  In the phone app (Setup):  http://{ip}:{port}   (phone must be on the same Wi-Fi)")
    if sys.platform == "win32":
        print("  If Windows asks whether Python may use the network, click Allow.")
    print()
    if args.open:
        threading.Thread(target=_open_when_ready, args=(local, port), daemon=True).start()
    uvicorn.run("shopr.app:create_app", factory=True, host=args.host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
