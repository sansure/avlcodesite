#!/usr/bin/env python3
"""Test script for fortest site"""
import urllib.request
import urllib.error
import json
import sys

BASE_URL = "http://localhost:8901"
STATS_SERVER = "https://stats-tracker.sansure-huang.workers.dev"

results = []

def test_url(path, method="GET", data=None, expected_code=None, check_contains=None):
    url = BASE_URL + path
    try:
        if data is not None:
            req = urllib.request.Request(url, data=data.encode('utf-8'), method='POST')
        else:
            req = urllib.request.Request(url, method='GET')
        
        with urllib.request.urlopen(req, timeout=5) as resp:
            code = resp.status
            content = resp.read().decode('utf-8', errors='ignore')
            content_type = resp.headers.get('Content-Type', '')
            redirect = resp.geturl()
    except urllib.error.HTTPError as e:
        code = e.code
        content = e.read().decode('utf-8', errors='ignore') if e.fp else ""
        content_type = ""
        redirect = ""
    except Exception as e:
        code = "ERROR"
        content = str(e)
        content_type = ""
        redirect = ""
    
    status = "PASS" if expected_code is None or code == expected_code else "FAIL"
    results.append({
        'path': path,
        'method': method,
        'code': code,
        'status': status,
        'content_type': content_type,
        'redirect': redirect,
        'check_contains': check_contains,
        'contains': STATS_SERVER in content if check_contains else None
    })
    return code, content

print("=== Testing fortest site ===\n")

# Test pages
test_url("/", expected_code=200, check_contains=True)
test_url("/page1", expected_code=200, check_contains=True)
test_url("/page2", expected_code=200, check_contains=True)
test_url("/static/css/style.css", expected_code=200)
test_url("/static/img/avl-code-logo.png", expected_code=200)
test_url("/static/js/tracker.js", expected_code=200)
code, _ = test_url("/goto-stats", expected_code=302)
test_url("/download/software1", method="POST", expected_code=200)

print("=== Results ===")
for r in results:
    print(f"{r['method']} {r['path']}: HTTP {r['code']} [{r['status']}]")
    if r['content_type']:
        print(f"  Content-Type: {r['content_type']}")
    if r['redirect'] and r['redirect'] != BASE_URL + r['path']:
        print(f"  Redirect: {r['redirect']}")
    if r['check_contains'] is not None:
        found = r['contains']
        print(f"  Contains stats server: {'YES' if found else 'NO'}")

# Summary
passed = sum(1 for r in results if r['status'] == 'PASS')
failed = sum(1 for r in results if r['status'] == 'FAIL')
print(f"\n=== Summary: {passed} passed, {failed} failed ===")
