#!/usr/bin/env python3
r"""
Local HTTPS Server for PWA Security Camera & Motion Capture Testing
Supports local file saving to C:\Abyss\PWA_Captures and C:\Abyss\PWALogs.
"""

import os
import sys
import socket
import ssl
import datetime
import ipaddress
import json
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Ensure UTF-8 support on Windows console
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

PORT = 8443
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
CAPTURES_DIR = r"C:\Abyss\PWA_Captures"
LOGS_DIR = r"C:\Abyss\PWALogs"

os.makedirs(CAPTURES_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)


def get_local_ip():
    """Find the best local LAN IP address for iPhone connection."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 1))
        local_ip = s.getsockname()[0]
    except Exception:
        local_ip = '127.0.0.1'
    finally:
        s.close()
    return local_ip


def generate_self_signed_cert(cert_path, key_path, ip_addr):
    """Generate self-signed SSL certificate with Subject Alternative Name for the IP."""
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    print(f"[*] Generating self-signed SSL certificate for {ip_addr}...")

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, u"PWA Security Motion Capture"),
        x509.NameAttribute(NameOID.COMMON_NAME, ip_addr),
    ])

    san_list = [
        x509.DNSName(u"localhost"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
    ]
    try:
        san_list.append(x509.IPAddress(ipaddress.IPv4Address(ip_addr)))
    except Exception:
        pass

    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName(san_list), critical=False)
        .sign(key, hashes.SHA256())
    )

    with open(key_path, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        ))

    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print(f"[+] Certificate generated: {cert_path}")


class SecurityPWAHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_OPTIONS(self):
        # The app uses same-origin requests; do not enable cross-origin writes.
        self.send_response(403)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {
                "status": "ok",
                "isLocalServer": True,
                "capturesDir": CAPTURES_DIR,
                "logsDir": LOGS_DIR
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
            return

        super().do_GET()

    def do_POST(self):
        origin = self.headers.get('Origin')
        expected_origin = f"https://{self.headers.get('Host', '')}"
        if origin and origin != expected_origin:
            self.send_error(403, 'Cross-origin writes are not allowed')
            return

        if self.path == '/api/save_capture':
            content_length = int(self.headers.get('Content-Length', 0))
            filename = self.headers.get('X-Filename', '')
            if not filename:
                filename = f"Capture_{datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.mp4"

            # Clean filename
            filename = os.path.basename(filename)
            file_path = os.path.join(CAPTURES_DIR, filename)

            post_data = self.rfile.read(content_length)
            with open(file_path, 'wb') as f:
                f.write(post_data)

            print(f"[+] Saved security capture: {file_path} ({len(post_data)} bytes)")
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "path": file_path}).encode('utf-8'))
            return

        elif self.path == '/api/save_log':
            content_length = int(self.headers.get('Content-Length', 0))
            filename = self.headers.get('X-Filename', '')
            if not filename:
                filename = f"Log_{datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.txt"

            filename = os.path.basename(filename)
            file_path = os.path.join(LOGS_DIR, filename)

            post_data = self.rfile.read(content_length)
            with open(file_path, 'wb') as f:
                f.write(post_data)

            print(f"[+] Saved debug log: {file_path}")
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "path": file_path}).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

    def end_headers(self):
        if self.path.endswith('.json') or self.path.endswith('.webmanifest'):
            self.send_header('Content-Type', 'application/manifest+json')
        elif self.path.endswith('sw.js'):
            self.send_header('Service-Worker-Allowed', '/')
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, format, *args):
        sys.stderr.write(f"[{self.log_date_time_string()}] {args[0]} {args[1]}\n")


def main():
    os.chdir(DIRECTORY)
    local_ip = get_local_ip()
    cert_file = os.path.join(DIRECTORY, "cert.pem")
    key_file = os.path.join(DIRECTORY, "key.pem")

    if not os.path.exists(cert_file) or not os.path.exists(key_file):
        generate_self_signed_cert(cert_file, key_file, local_ip)

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=cert_file, keyfile=key_file)

    server = HTTPServer(('0.0.0.0', PORT), SecurityPWAHandler)
    server.socket = context.wrap_socket(server.socket, server_side=True)

    print("\n" + "=" * 65)
    print(">> SECURITY MOCAP PWA HTTPS TEST SERVER RUNNING")
    print("=" * 65)
    print(f"[*] Captures folder: {CAPTURES_DIR}")
    print(f"[*] Logs folder:     {LOGS_DIR}")
    print("\n[TO TEST ON YOUR APPLE iPHONE]:")
    print("  1. Connect your iPhone to the same Wi-Fi network.")
    print("  2. Open Safari on iPhone and navigate to:")
    print(f"\n     ==>  https://{local_ip}:{PORT}/  <==\n")
    print("  3. Bypass self-signed cert: Tap 'Show Details' -> 'visit this website'.")
    print("  4. In Safari, tap Share -> 'Add to Home Screen'.")
    print(f"\n[PC TEST]: Test on PC at: https://localhost:{PORT}/")
    print("=" * 65)
    print("Press Ctrl+C to stop the server.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Server stopped.")


if __name__ == '__main__':
    main()
