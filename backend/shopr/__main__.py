"""`uv run shopr` / `python -m shopr`: start the server and print the addresses to use."""

from __future__ import annotations

import argparse
import socket

import uvicorn


def lan_ip() -> str | None:
    """The address other devices on your Wi-Fi can reach this computer at."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packets are sent for UDP connect
            return s.getsockname()[0]
    except OSError:
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the shopr server.")
    parser.add_argument("--host", default="0.0.0.0", help="0.0.0.0 lets your phone connect over Wi-Fi")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    print(f"\n  shopr: open http://localhost:{args.port} in your browser")
    ip = lan_ip()
    if ip and args.host == "0.0.0.0":
        print(f"  shopr: in the phone app, set the server to http://{ip}:{args.port} (same Wi-Fi)\n")
    uvicorn.run("shopr.app:create_app", factory=True, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
