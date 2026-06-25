# 数据库重建指南

当需要清空所有数据并重新建立表结构时，按以下步骤操作。

## 方式一：通过 Wrangler 命令行

```bash
# 1. 进入项目目录
cd hello-avlcode-worker

# 2. 远程执行重建 SQL（会清空所有数据，请谨慎操作）
npx wrangler d1 execute stats-db --remote --command="DROP TABLE IF EXISTS visits; DROP TABLE IF EXISTS geo_cache; DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS users; DROP TABLE IF EXISTS sites;"

# 3. 重新应用所有迁移
npx wrangler d1 migrations apply stats-db --remote
```

## 方式二：通过 Cloudflare Dashboard 网页操作

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)。
2. 进入 **Workers & Pages** → **D1 SQL 数据库**。
3. 选择数据库 `stats-db`。
4. 点击 **Console** 或 **查询** 标签页。
5. 依次执行以下 SQL：

```sql
DROP TABLE IF EXISTS visits;
DROP TABLE IF EXISTS geo_cache;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS sites;
```

6. 返回迁移管理页面，重新应用所有迁移文件；或在 Console 中手动执行 `migrations/0001_init.sql`、`migrations/0002_users.sql`、`migrations/0003_sites.sql` 的内容。

## 注意事项

- 重建数据库会丢失所有访问记录、用户和站点配置，请提前备份重要数据。
- 重建后默认管理员账号为 `antiy`，密码为 `antiy?100avlcode`（见迁移文件）。
- 生产环境操作前请确认已备份。
