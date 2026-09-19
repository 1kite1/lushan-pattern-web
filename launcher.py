# -*- coding: utf-8 -*-
"""Lushan Pattern Recognition - Web Launcher

Self-contained launcher: frees port, starts HTTP server, opens browser,
catches and reports errors. Designed to work in any directory context
including WinRAR temp folders with $ in path.
"""
import sys, os, time, threading, traceback

# Ensure UTF-8 output only when stdout is a real interactive console.
# Reconfiguring a redirected pipe (e.g. when launched from a .bat via
# cmd) corrupts the stream and silently breaks the HTTP server.
if sys.platform == "win32" and sys.stdout.isatty():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

PORT = 8000
DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(DIR)


def banner(msg):
    print("=" * 44)
    print(msg)
    print("=" * 44)


def info(msg):
    print(f"  {msg}")


def free_port(port):
    """Kill any process listening on the port (Windows only)."""
    if sys.platform != "win32":
        return
    try:
        import subprocess
        out = subprocess.run(
            ["netstat", "-aon"],
            capture_output=True, text=True, timeout=5
        ).stdout
        for line in out.splitlines():
            if f":{port} " in line and "LISTENING" in line:
                parts = line.split()
                pid = parts[-1]
                try:
                    subprocess.run(
                        ["taskkill", "/F", "/PID", pid],
                        capture_output=True, timeout=5
                    )
                    print(f"  [cleanup] killed PID {pid} on port {port}")
                except Exception:
                    pass
        time.sleep(0.8)
    except Exception as e:
        print(f"  [warn] port cleanup failed: {e}")


def open_browser_delayed():
    def _open():
        try:
            import webbrowser
            webbrowser.open(f"http://127.0.0.1:{PORT}/")
        except Exception as e:
            print(f"  [warn] could not open browser: {e}")
    threading.Timer(1.2, _open).start()


def main():
    banner("  Lushan Pattern Recognition - Web Launcher")
    info(f"Port: {PORT}")
    info(f"Dir:  {DIR}")
    info(f"URL:  http://127.0.0.1:{PORT}/")
    print()
    info("Cleaning port if busy...")
    free_port(PORT)

    # Start http server
    import http.server
    import functools

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # silence per-request log

    # Pass directory explicitly (3.11 requires this; chdir alone is not picked up)
    Handler = functools.partial(QuietHandler, directory=DIR)

    try:
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as e:
        print(f"\n  [ERROR] Cannot bind to port {PORT}: {e}")
        print(f"  Another instance is probably still running.")
        print(f"  Run stop_server.bat first, then try again.")
        input("\n  Press Enter to close...")
        sys.exit(1)

    open_browser_delayed()
    info("Server running. Browser will open in 1 second.")
    info("Close this window to stop the server.")
    print()
    print("  --- request log ---")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        print("\n  Server stopped.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n  [FATAL] {e}")
        traceback.print_exc()
        input("\n  Press Enter to close...")
        sys.exit(1)