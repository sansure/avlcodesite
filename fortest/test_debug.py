#!/usr/bin/env python3
"""Debug test script for fortest site"""
import urllib.request
import urllib.error
import http.client
import json

BASE_URL = "http://localhost:8901"
STATS_SERVER = "https://site.avlcodesite.xyz"

def test_get(url, follow_redirects=True):
    print(f"\n--- Testing GET {url} ---")
    try:
        if follow_redirects:
            req = urllib.request.Request(url, method='GET')
            with urllib.request.urlopen(req, timeout=5) as resp:
                print(f"Status: {resp.status}")
                print(f"Headers: {dict(resp.headers)}")
                content = resp.read().decode('utf-8', errors='ignore')
                print(f"Content length: {len(content)}")
                print(f"First 500 chars: {content[:500]}")
                return resp.status, content
        else:
            # Use http.client to avoid following redirects
            parsed = urllib.request.urlparse(url)
            conn = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=5)
            conn.request('GET', parsed.path)
            resp = conn.getresponse()
            print(f"Status: {resp.status}")
            print(f"Headers: {dict(resp.headers)}")
            content = resp.read().decode('utf-8', errors='ignore')
            print(f"Content length: {len(content)}")
            if content:
                print(f"First 500 chars: {content[:500]}")
            conn.close()
            return resp.status, content
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code}")
        print(f"Headers: {dict(e.headers)}")
        content = e.read().decode('utf-8', errors='ignore') if e.fp else ""
        print(f"Content: {content[:500]}")
        return e.code, content
    except Exception as e:
        print(f"Exception: {type(e).__name__}: {e}")
        return None, str(e)

def test_post(url, data=None):
    print(f"\n--- Testing POST {url} ---")
    try:
        if data:
            req = urllib.request.Request(url, data=data.encode('utf-8'), method='POST')
        else:
            req = urllib.request.Request(url, data=b'', method='POST')
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"Status: {resp.status}")
            print(f"Headers: {dict(resp.headers)}")
            content = resp.read().decode('utf-8', errors='ignore')
            print(f"Content: {content[:500]}")
            return resp.status, content
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code}")
        print(f"Headers: {dict(e.headers)}")
        content = e.read().decode('utf-8', errors='ignore') if e.fp else ""
        print(f"Content: {content[:500]}")
        return e.code, content
    except Exception as e:
        print(f"Exception: {type(e).__name__}: {e}")
        return None, str(e)

# Test all URLs
test_get("/")
test_get("/page1")
test_get("/page2")
test_get("/static/css/style.css")
test_get("/static/img/avl-code-logo.png")
test_get("/static/js/tracker.js")
test_get("/goto-stats", follow_redirects=False)
test_post("/download/software1")

print("\n=== Checking stats server address ===")
for path in ["/", "/page1", "/page2"]:
    code, content = test_get(path)
    if content:
        found = STATS_SERVER in content
        print(f"{path}: contains stats server = {found}")
    else:
        print(f"{path}: no content")