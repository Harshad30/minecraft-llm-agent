from http.server import HTTPServer, BaseHTTPRequestHandler
import json
from brain import decide

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        print(f"[SERVER] Request to: {self.path}")
        try:
            length = int(self.headers['Content-Length'])
            body = json.loads(self.rfile.read(length))

            if self.path == '/reflect':
                from brain import reflect
                memory_summary = body.get('memory_summary', {})
                recent_actions = body.get('recent_actions', [])
                rules = reflect(memory_summary, recent_actions)
                response = json.dumps(rules).encode()

            elif self.path == '/decide':
                from brain import decide
                observation = body.get('observation', {})
                memory = body.get('memory', {})
                recent_actions = body.get('recent_actions', [])
                action = decide(observation, memory, recent_actions)
                response = json.dumps(action).encode()

            else:
                response = json.dumps({"type": "look_around", "reason": "unknown path"}).encode()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(response)
            self.wfile.flush()

        except Exception as e:
            print(f"[ERROR] {e}")
            fallback = json.dumps([] if self.path == '/reflect' else {"type": "look_around", "reason": "error"}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(fallback))
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(fallback)
            self.wfile.flush()

    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    print('[BRAIN] Server starting on port 5001...')
    server = HTTPServer(('localhost', 5001), Handler)
    print('[BRAIN] Listening for requests...')
    server.serve_forever()