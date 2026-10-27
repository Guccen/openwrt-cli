# 前端开发

[返回项目首页](../README.md) · [模拟测试](simulation-testing.md) · [开发进度](development-status.md)

## 技术栈与资源预算

- 前端使用 Vite、React、shadcn/ui Mira、Axios、Zustand、wouter、Bun、Oxfmt、Oxlint。通过 `bunx --bun shadcn@latest init -t vite` 初始化，界面组件均来自 shadcn/ui。
- 桌面侧栏可折叠为图标栏，小于 768px 切换为抽屉菜单，选中页面后自动收起。
- 使用系统字体和按需图标，不加载外部字体或 CDN。设备通过静态资源、OpenWrt 接口和按需执行的受限 rpcd 插件提供功能，不运行 Bun、Node.js 或新增常驻服务。
- 资源预算：原始静态资源不超过 768 KiB，按文件计算的 gzip 合计不超过 256 KiB。生产构建不输出源代码映射。

## 开发环境与本地演示

需要 Bun 1.4.0 和 Node.js 22.12 或以上版本。

```sh
bun install --frozen-lockfile
bun run check
bun run dev
```

`check` 执行 Oxlint、Oxfmt、测试、TypeScript、生产构建和体积校验。`dist/` 是静态资源，`build/router-ui/` 是安装包目录，`build/ui-size.json` 记录资源体积。

本地演示使用两个终端，数据标记为“本地演示”，密码为 `preview-only`：

```sh
# 终端一：仅监听本机的演示接口
bun tests/preview-server.ts

# 终端二：前端
OPENWRT_API_URL=http://127.0.0.1:4174 bun run dev
```

PowerShell 设置变量：

```powershell
$env:OPENWRT_API_URL = 'http://127.0.0.1:4174'
bun run dev
```

连接真实设备时，变量应指向该设备已配置受信任证书的 HTTPS 地址。开发代理不进入生产资源，生产页面只访问同一设备上的接口。

## 页面地址与组件

| 地址                  | 页面                 |
| --------------------- | -------------------- |
| `/login/`             | 登录                 |
| `/overview/`          | 系统概览             |
| `/network/`           | 网络状态             |
| `/clients/`           | IPv4/IPv6 客户端租约 |
| `/wireless/`          | AX1800 无线运行状态  |
| `/settings/lan/`      | LAN 设置             |
| `/settings/wan/`      | WAN 上网设置         |
| `/settings/dhcp/`     | DHCP 地址分配        |
| `/settings/dns/`      | DNS 设置             |
| `/settings/wireless/` | AX1800 无线设置      |
| `/settings/backup/`   | 网络设置备份与恢复   |
| `/system/`            | 系统备份恢复及维护   |
| `/settings/leds/`     | 系统状态指示灯配置   |

使用 wouter 的 History 路由，侧栏为真实链接，支持前进、后退和直接访问。管理页按路由延迟加载，共用布局和状态组件，打开页面时再加载对应代码。未登录访问页面时跳到登录页，登录后回到原地址；当前标签页在 sessionStorage 中保存短期 rpcd SID；刷新时先向设备验证，再保留当前页面。密码不写入浏览器存储或 URL，localStorage 不保存会话。过期、退出或修改密码会清理会话；短暂断网保留 SID 并提供重试，不能靠伪造存储绕过设备鉴权。登录返回地址限制为已知页面。N1 不显示无线菜单，旁路由隐藏 WAN、DHCP 菜单；直接访问这些地址也不会开放对应表单。

`App.tsx` 只负责登录判断和路由；`pages/` 保存各页面入口；`components/layout/` 保存主布局、标题和页脚；`components/overview/` 与 `components/network/` 保存状态组件；`components/settings/` 分别保存 LAN、WAN、DHCP、DNS、无线、备份表单及共用的应用确认组件。路径和标题统一在 `lib/routes.ts` 维护。

构建时为每个地址生成一个小的目录首页，全部共用同一份 JS/CSS，入口文件也纳入体积预算。uhttpd 可直接提供这些文件，深层地址刷新不依赖额外服务器或 URL 重写。测试会检查所有入口返回 200、资源使用绝对路径，以及不存在的资源仍返回 404。

## 目录与本地验证

`configs/` 保存公共及设备配置和版本锁定；`files/` 保存默认文件；`frontend/` 为页面和 shadcn 组件；`package/router-ui/` 为安装包；`scripts/` 负责配置生成、编译、打包；`tests/` 保存测试和演示接口。

```sh
bun run check
python3 -m unittest discover -s tests/firmware -v
```

归档、密码、灯效和状态解析的 15 项脚本测试使用真实 `ucode`；未安装时本机跳过，可通过 `UCODE_TEST_COMMAND` 指定解释器命令。QEMU 同时运行原生 ucode 单测及实际 RPC 测试，不能以本地页面测试代替。
