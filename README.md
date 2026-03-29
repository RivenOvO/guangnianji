# 公司管理系统 MVP

一个可直接跑起来的默认版本（后续可以慢慢改）：

- 登录 + 角色权限（admin/manager/employee）
- 通讯录（员工档案）
- 公告发布
- 审批（请假/报销）
- 操作日志（audit，admin可见）

## 运行

```bash
npm install
npm run dev
```

打开： http://localhost:3000

## 默认账号

- admin@company.local / admin123
- manager@company.local / manager123
- employee@company.local / employee123

## 说明

- 数据库：`data.sqlite`（SQLite，单机 MVP）
- 后续可升级：更完整的字段、可配置审批链、导出Excel、SSO（飞书/企微）、PostgreSQL、多实例部署等

## 环境变量

- `PORT`：端口（默认 3000）
- `JWT_SECRET`：JWT 密钥（生产环境必须修改）
