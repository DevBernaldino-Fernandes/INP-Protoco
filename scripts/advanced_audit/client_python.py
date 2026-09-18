#!/usr/bin/env python3
"""
Cliente Python oficial para o Protocolo INP (Intent Network Protocol).
Demonstra comunicacao nativa, envio de intencoes e validacao de resposta.
"""

import sys
import json
import urllib.request
import urllib.error

def main():
    port = sys.argv[1] if len(sys.argv) > 1 else "3005"
    url = f"http://127.0.0.1:{port}/api/intent"

    intent_dsl = '''INTENT "python_ecosystem" {
  CONTEXT { language: "Python 3.14", iterations: 10 }
  REQUIRE { BENCHMARK OPS }
  FLOW { SEQUENCE { BENCHMARK OPS } }
  OUTPUT { FORMAT "json" }
}'''.strip()

    payload = {
        "text": intent_dsl,
        "type": "dsl",
        "securityContext": {
            "userId": "python-worker-01",
            "role": "USER",
            "permissions": ["*"]
        }
    }

    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            'Content-Type': 'application/json',
            'X-Correlation-ID': 'py-client-uuid-2026'
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status_code = resp.getcode()
            response_body = resp.read().decode('utf-8')
            parsed = json.loads(response_body)
            
            result = {
                "language": "Python",
                "http_status": status_code,
                "protocol_success": parsed.get("success", False),
                "intent_status": parsed.get("result", {}).get("status", "UNKNOWN"),
                "result_data": parsed.get("result", {}).get("output", None)
            }
            print(json.dumps(result))
            sys.exit(0)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='ignore')
        print(json.dumps({"language": "Python", "error": f"HTTP {e.code}: {err_body}"}))
        sys.exit(1)
    except Exception as ex:
        print(json.dumps({"language": "Python", "error": str(ex)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
