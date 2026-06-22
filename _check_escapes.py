#!/usr/bin/env python3
"""检查 const JS 中的模板字符串转义"""
import re

with open('hello-avlcode-worker/src/index.js', 'r') as f:
    lines = f.readlines()

# 找到 const JS 的范围
js_start = None
js_end = None
for i, line in enumerate(lines):
    if 'const JS = `' in line:
        js_start = i
    if js_start is not None and i > js_start and '`;' in line:
        js_end = i
        break

print(f"const JS 从第 {js_start+1} 行到第 {js_end+1} 行")

# 检查 const JS 内部的反引号和 ${ 转义
for i in range(js_start, js_end + 1):
    line = lines[i]
    for m in re.finditer(r'`', line):
        pos = m.start()
        prev = line[pos-1] if pos > 0 else 'BOS'
        if prev != '\\':
            # 未转义的反引号
            print(f"  第{i+1}行偏移{pos}: 未转义反引号, 前一个字符={repr(prev)}")
    for m in re.finditer(r'\$', line):
        pos = m.start()
        if pos + 1 < len(line) and line[pos+1] == '{':
            prev = line[pos-1] if pos > 0 else 'BOS'
            if prev != '\\':
                print(f"  第{i+1}行偏移{pos}: 未转义 ${{, 前一个字符={repr(prev)}")