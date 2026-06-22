#!/usr/bin/env python3
"""修复 const JS 中 loadUsers 函数的未转义反引号"""
with open('hello-avlcode-worker/src/index.js', 'r') as f:
    content = f.read()

# 找到 const JS 的范围
js_start = content.index('const JS = `') + len('const JS = `')
js_end = content.index('`;', js_start)

js_content = content[js_start:js_end]

# 在 const JS 内部，loadUsers 函数中的模板字面量使用了未转义的反引号
# users.map(u=>`<tr>...`).join('')
# 需要改为 users.map(u=>\`<tr>...\`).join('')

# 查找 loadUsers 中的模板字面量开始
idx = js_content.find("users.map(u=>`")
if idx >= 0:
    print(f"找到 loadUsers 模板开始于偏移 {idx}")
    end_idx = js_content.find("`).join('')", idx)
    if end_idx >= 0:
        print(f"找到 loadUsers 模板结束于偏移 {end_idx}")
        
        before = js_content[:idx]
        template_start = js_content[idx:idx+len("users.map(u=>`")]
        template_body = js_content[idx+len("users.map(u=>`"):end_idx]
        template_end = js_content[end_idx:end_idx+len("`).join('')")]
        after = js_content[end_idx+len("`).join('')"):]
        
        print(f"template_start = {repr(template_start)}")
        print(f"template_end = {repr(template_end)}")
        
        # 修复
        fixed_template_start = template_start.replace("u=>`", "u=>\\`")
        fixed_template_end = template_end.replace("`).join('')", "\\`).join('')")
        
        new_js = before + fixed_template_start + template_body + fixed_template_end + after
        
        new_content = content[:js_start] + new_js + content[js_end:]
        
        with open('hello-avlcode-worker/src/index.js', 'w') as f:
            f.write(new_content)
        
        print("修复完成！")
    else:
        print("未找到模板结束")
else:
    print("未找到 loadUsers 模板开始")
    # 试试找 loadUsers 函数
    idx2 = js_content.find("async function loadUsers")
    if idx2 >= 0:
        print(f"找到 loadUsers 函数于偏移 {idx2}")
        print(f"上下文: {repr(js_content[idx2:idx2+300])}")