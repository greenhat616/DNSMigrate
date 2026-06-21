# dnspod-to-esa

将 **DNSPod**（腾讯云）的 DNS 解析记录批量导入到 **阿里云 ESA**（边缘安全加速）。

- 解析 `.env` 读取双方凭证与目标站点
- 自动按域名解析 ESA `siteId`（`.env` 显式配置可覆盖）
- 幂等导入：先对比 ESA 现有记录，已存在（同名同类型）则跳过
- 内置 `--dry-run` 模式：只读、打印导入计划，不写入 ESA

## 技术栈

| 用途 | 包 |
|------|-----|
| DNSPod SDK | `tencentcloud-sdk-nodejs-dnspod` (v20210323) |
| ESA SDK | `@alicloud/esa20240910` |
| 阿里云通用客户端 | `@alicloud/openapi-client` / `@alicloud/tea-util` |
| 配置 | `dotenv` |
| 语言/运行 | TypeScript + tsx + tsc (CommonJS) |

## 快速开始

```bash
pnpm install
cp .env.example .env   # 填入凭证
pnpm dry-run           # 预演，不写入
pnpm import            # 正式导入
```

## 配置（.env）

完整说明见 `.env.example`，关键项：

| 变量 | 必填 | 说明 |
|------|------|------|
| `DNSPOD_SECRET_ID` / `DNSPOD_SECRET_KEY` | 是 | 腾讯云 API 密钥 |
| `DNSPOD_DOMAIN` | 是 | 待导出的源域名，如 `example.com` |
| `ALIBABA_CLOUD_ACCESS_KEY_ID` / `..._SECRET` | 是 | 阿里云 RAM 密钥 |
| `ESA_REGION_ID` | 否 | 默认 `cn-hangzhou` |
| `ESA_ENDPOINT` | 否 | 默认 `esa.<region>.aliyuncs.com` |
| `ESA_SITE_ID` | 否 | 显式指定站点；留空则按 `ESA_SITE_NAME` 自动解析 |
| `ESA_SITE_NAME` | 否 | 解析 siteId 用的站点名，默认等于 `DNSPOD_DOMAIN` |
| `ESA_PROXIED` | 否 | A/AAAA/CNAME 是否走 ESA 边缘代理，默认 `false` |

## 命令

```bash
pnpm dev [--dry-run]   # tsx 直接运行源码
pnpm dry-run           # 预演（= dev --dry-run）
pnpm import            # 正式导入（= dev）
pnpm build             # tsc 编译到 dist/
pnpm start             # 运行编译产物
pnpm typecheck         # 仅类型检查
node dist/index.js -h  # 帮助
```

## 记录类型映射

| DNSPod 类型 | ESA 处理 |
|-------------|----------|
| `A` / `AAAA` | 合并为 ESA 的 `A/AAAA` 类型 |
| `CNAME` | `CNAME`，`sourceType=Domain`，去除尾点 |
| `MX` | `MX`，携带 `priority`，去除尾点 |
| `TXT` | `TXT` |
| `NS`（非根） | `NS`，去除尾点 |
| `SOA` / 根 `NS` | 跳过（由服务商/ESA 管理） |
| 已禁用记录 | 跳过 |
| 其他类型（SRV/CAA/…） | 跳过并告警（脚手架暂不支持） |

> 代理记录（`ESA_PROXIED=true`）仅对 A/AAAA、CNAME 生效，且 ESA 会将其 TTL 接管为系统值。

## 退出码

- `0`：全部成功（或 dry-run 完成）
- `1`：存在创建失败的记录，或配置/网络错误

## 目录结构

```
src/
├── index.ts     # CLI 入口：参数解析、--dry-run、编排与统计
├── config.ts    # .env 解析与校验
├── dnspod.ts    # DNSPod 客户端：分页拉取记录
├── esa.ts       # ESA 客户端：解析 siteId、列举、创建记录
├── mapping.ts   # DNSPod → ESA 记录映射与跳过规则
└── logger.ts    # 轻量分级日志
```
