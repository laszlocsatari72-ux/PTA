"""P_T_A webalkalmazás – kiszolgálás a saját gépről a helyi hálózatra (kipróbáláshoz).

Indítás ebben a mappában:   python szerver.py
Utána a telefon böngészőjében (ugyanazon a WiFi-n) nyisd meg a kiírt címet.
Leállítás: Ctrl+C.  Python 3.8 vagy újabb, külön csomag nem kell.
"""
import http.server
import os
import socket
import socketserver

PORT = 8000


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({'.webmanifest': 'application/manifest+json', '.js': 'application/javascript'})

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('', PORT), Handler) as httpd:
        print('P_T_A fut.')
        print('  ezen a gépen:      http://localhost:{}'.format(PORT))
        print('  telefonon (WiFi):  http://{}:{}'.format(lan_ip(), PORT))
        print('Leállítás: Ctrl+C')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
