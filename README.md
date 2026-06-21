# dns-migrate

在任意 DNS 服务商之间**批量复制解析记录**。通过一个 provider 无关的中间记录模型 **MIR**（Middle Intermediate Record），把每个服务商抽象成可读可写的 `provider`，从而用 `--from <源> --to <目标>` 在它们之间任意搬运。

已内置三个 provider：

| id | 服务商 | 说明 |
|----|--------|------|
| `dnspod` | DNSPod（腾讯云） | 读 / 写 |
| `esa` | 阿里云 ESA（边缘安全加速） | 读 / 写，A/AAAA 合并，支持代理 |
| `cloudflare` | Cloudflare | 读 / 写，支持代理（橙云） |

特性：

- 配置 `.env` 后，`--from esa --to cloudflare` 即可迁移，任意两 provider 组合（N×N）经 MIR 解耦
- **按需校验**：只校验被 `--from/--to` 引用的 provider 凭证，未用到的留空也能运行
- 幂等导入：先快照目标已有记录，**同名同类型同值**才跳过（MX/SRV 再比 `priority`），故 MX/TXT/多 A 等同名多值记录不会漏迁；值经归一化（去尾点、主机名/IP 大小写、TXT 去包裹引号）跨 provider 对齐
- `--dry-run`：只读、打印计划，不写入目标

## 架构

```
源 provider.listRecords() ──► MIR[] ──► planner（按目标能力过滤）──► 目标 provider.createRecord(MIR)
```

- **MIR**：`{ host, type, value, ttl, priority?, proxied?, disabled? }`，`host` 用 `@` 表 apex
- **职责拆分**：能力过滤（disabled / SOA / 根 NS / 目标不支持的类型）归 `planner`（通用）；类型映射、proxied、TTL 归各 provider（私有）。proxied 与 TTL 由**目标** provider 依自身 env 决定，与源无关

## 快速开始

```bash
pnpm install
cp .env.example .env                              # 填入用到的 provider 凭证
pnpm dev --from esa --to cloudflare --dry-run     # 预演
pnpm dev --from esa --to cloudflare               # 正式迁移
```

## 命令

```bash
pnpm dev --from <p> --to <p> [--dry-run]   # tsx 直接运行源码
pnpm build                                 # tsc 编译到 dist/
pnpm start --from <p> --to <p>             # 运行编译产物
pnpm typecheck                             # 仅类型检查
pnpm dev --help                            # 帮助
```

`<p>` 取值：`dnspod` | `esa` | `cloudflare`。`--from` 与 `--to` 必填且不能相同。

## 配置（.env）

完整说明见 `.env.example`，关键项：

| 变量 | 适用 | 说明 |
|------|------|------|
| `DOMAIN` | 全部 | 操作的 DNS 域名/zone（兼容旧 `DNSPOD_DOMAIN`） |
| `DNSPOD_SECRET_ID` / `DNSPOD_SECRET_KEY` | dnspod | 腾讯云 API 密钥 |
| `ALIBABA_CLOUD_ACCESS_KEY_ID` / `..._SECRET` | esa | 阿里云 RAM 密钥 |
| `ESA_REGION_ID` / `ESA_ENDPOINT` | esa | 默认 `cn-hangzhou` / `esa.<region>.aliyuncs.com` |
| `ESA_SITE_ID` / `ESA_SITE_NAME` | esa | 显式站点；留空则按 `DOMAIN` 自动解析 |
| `ESA_PROXIED` | esa（作目标） | 代理 A/AAAA/CNAME，默认 `false` |
| `CLOUDFLARE_API_TOKEN` | cloudflare | 作用域 Token（Zone : DNS : Edit） |
| `CLOUDFLARE_ZONE_ID` | cloudflare | 可选，留空按 `DOMAIN` 解析 |
| `CLOUDFLARE_PROXIED` | cloudflare（作目标） | 橙云代理，默认 `false` |

## 记录类型与处理

- 支持类型：`A` `AAAA` `CNAME` `TXT` `MX` `NS` `CAA` `SRV`
- ESA 将 A/AAAA 合并为 `A/AAAA`；本工具读 ESA 时按 value 是否含 `:` 还原为 A 或 AAAA
- `CNAME` / `MX` / `NS` 写入前去除尾点；`MX` 携带 `priority`
- 跳过：`SOA`、根 `NS`（由服务商管理）、源端已禁用记录、目标不支持的类型
- 代理记录仅对 A/AAAA/CNAME 生效，且目标会把 TTL 接管为自动值（`1`）

## 退出码

- `0`：全部成功（或 dry-run 完成）
- `1`：存在创建失败的记录，或配置/网络错误

## 目录结构

```
src/
├── index.ts            # CLI 入口：--from/--to/--dry-run 解析、编排与统计
├── config.ts           # 共享 env 助手 + DOMAIN 解析
├── mir.ts              # MIR 中间记录模型 + 名称归一化 + recordKey
├── planner.ts          # provider 无关的记录过滤
├── logger.ts           # 轻量分级日志
└── providers/
    ├── types.ts        # Provider 接口 + 能力声明 + 上下文
    ├── registry.ts     # id → factory 映射
    ├── dnspod.ts       # DNSPod provider（读/写）
    ├── esa.ts          # ESA provider（读/写）
    └── cloudflare.ts   # Cloudflare provider（读/写）
```

## 扩展新 provider

1. 在 `src/providers/` 新增 `xxx.ts`，实现 `Provider` 接口（`listRecords`→MIR、`createRecord`←MIR、`capabilities`）
2. 在 `registry.ts` 的 `PROVIDER_IDS` 与 `FACTORIES` 注册
3. 在 `.env.example` 补充其凭证变量

无需改动 `index.ts` 或其它 provider。
