#!/usr/bin/env python3
"""Serve this folder on loopback only. No runtime packages or network needed."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser
import subprocess
import sys


class LocalFiles(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description='江山弈本地启动器')
    parser.add_argument('--no-open', action='store_true', help='只启动本机服务')
    parser.add_argument('--port', type=int, default=8765, help='默认 8765，保持存档地址稳定；0 为临时随机端口')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(LocalFiles, directory=str(root)))
    except OSError as error:
        print(f'无法启动本机端口 {args.port}：{error}。可关闭旧启动器，或使用 --port 指定端口；更换端口会使用另一份浏览器存档。', file=sys.stderr)
        raise SystemExit(1) from error
    address = f'http://127.0.0.1:{server.server_address[1]}/'
    print(f'江山弈已就绪：{address}', flush=True)
    if args.port == 0:
        print('当前为临时随机地址：关闭前请导出存档，重新启动后地址可能不同。', flush=True)
    print('保留此窗口即可持续游玩。按 Control-C 关闭本机服务。', flush=True)
    if not args.no_open:
        if sys.platform == 'darwin':
            opened = subprocess.run(['open', '-a', 'Google Chrome', address], capture_output=True)
            if opened.returncode:
                webbrowser.open(address)
        else:
            webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n江山弈已关闭。')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
