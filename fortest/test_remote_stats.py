#!/usr/bin/env python3
"""
手动模拟数据发送到远程统计服务器，验证远端 Worker + D1 是否正常。
用法: python3 test_remote_stats.py
"""

import urllib.request
import urllib.parse
import json
import time
import sys

STATS_SERVER = 'https://site.avlcodesite.xyz'

def test_view_event():
    """测试 1: 发送页面浏览事件 (GET /track/view)"""
    print('=' * 60)
    print('测试 1: 页面浏览事件 GET /track/view')
    print('=' * 60)
    try:
        params = urllib.parse.urlencode({
            'page_url': '/test_manual',
            'page_title': 'ManualTest-' + time.strftime('%H%M%S'),
            't': str(int(time.time()))
        })
        url = f'{STATS_SERVER}/track/view?{params}'
        req = urllib.request.Request(url, method='GET')
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode('utf-8', errors='replace')
            print(f'  ✅ 状态码: {resp.status}')
            print(f'  响应: {body[:300]}')
            return True
    except Exception as e:
        print(f'  ❌ 失败: {e}')
        return False


def test_track_event_file_create():
    """测试 2: 发送文件创建事件 (POST /track)"""
    print()
    print('=' * 60)
    print('测试 2: 文件创建事件 POST /track')
    print('=' * 60)
    try:
        payload = json.dumps({
            'event_type': 'file_create',
            'file_path': f'/tmp/edr_agent/manual_test_{int(time.time())}.txt',
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'hostname': 'manual-test-host'
        }).encode('utf-8')
        req = urllib.request.Request(
            f'{STATS_SERVER}/track',
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode('utf-8', errors='replace')
            print(f'  ✅ 状态码: {resp.status}')
            print(f'  响应: {body[:300]}')
            return True
    except Exception as e:
        print(f'  ❌ 失败: {e}')
        return False


def test_track_event_download():
    """测试 3: 发送下载事件 (POST /track)"""
    print()
    print('=' * 60)
    print('测试 3: 下载事件 POST /track')
    print('=' * 60)
    try:
        payload = json.dumps({
            'page_url': '/',
            'page_title': '测试站点',
            'is_download': 1,
            'download_item': '软件A'
        }).encode('utf-8')
        req = urllib.request.Request(
            f'{STATS_SERVER}/track',
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode('utf-8', errors='replace')
            print(f'  ✅ 状态码: {resp.status}')
            print(f'  响应: {body[:300]}')
            return True
    except Exception as e:
        print(f'  ❌ 失败: {e}')
        return False


def test_admin_summary():
    """测试 4: 查询管理后台摘要 (GET /admin/api/summary)"""
    print()
    print('=' * 60)
    print('测试 4: 管理后台摘要 GET /admin/api/summary')
    print('=' * 60)
    try:
        url = f'{STATS_SERVER}/admin/api/summary'
        req = urllib.request.Request(url, method='GET')
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode('utf-8', errors='replace')
            print(f'  ✅ 状态码: {resp.status}')
            print(f'  响应: {body[:500]}')
            return True
    except Exception as e:
        print(f'  ❌ 失败: {e}')
        return False


def main():
    print(f'目标服务器: {STATS_SERVER}')
    print(f'开始时间: {time.strftime("%Y-%m-%d %H:%M:%S")}')
    print()

    results = []
    results.append(('页面浏览事件', test_view_event()))
    results.append(('文件创建事件', test_track_event_file_create()))
    results.append(('下载事件', test_track_event_download()))
    results.append(('管理后台摘要', test_admin_summary()))

    print()
    print('=' * 60)
    print('汇总')
    print('=' * 60)
    for name, ok in results:
        status = '✅ 通过' if ok else '❌ 失败'
        print(f'  {status}  {name}')

    all_ok = all(r[1] for r in results)
    if all_ok:
        print()
        print('🎉 所有测试通过！远端 Worker + D1 工作正常。')
        print(f'   请访问 {STATS_SERVER}/admin 查看统计数据。')
        sys.exit(0)
    else:
        print()
        print('⚠️  部分测试失败，请检查 Worker 日志或网络连通性。')
        sys.exit(1)


if __name__ == '__main__':
    main()