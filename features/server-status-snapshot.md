# 服务器状态快照

入口：已连接 SSH 终端顶部的仪表按钮「服务器状态快照」。分屏以当前聚焦窗格为目标，主窗口和独立窗口均可用；本地终端、连接中、重连中禁用。报告在终端页内默认以图形化查看层展示：资源进度条、负载对比、异常摘要和详细表格。支持切换文本视图、复制、刷新、纵向滚动、关闭按钮与 Escape；图表中的磁盘无需横向滚动。工具栏提供自动刷新：关闭（默认）、每5秒、每10秒、每15秒；当前报告打开期间按所选周期触发，采集中跳过本次触发，不排队、不重叠。手动刷新与自动刷新共用请求保护，更新时保留视图、挂载/容器展开状态。关闭按钮、Escape 或组件卸载会停止定时器；普通 SSH 已发出的只读采集允许完成；JumpServer 当前终端采集会请求取消，关闭后不再发起新的周期请求。刷新频率仅在当前组件内保留，不写入本机存储。

采集期间显示进度并防止重复点击；刷新失败明确报错并保留上次成功的快照和时间，普通 SSH 开启自动刷新时会在后续周期重试；JumpServer 交互采集失败则停止自动刷新。刷新固定绑定打开报告时的会话和已选资产；资产变化时保留旧报告并停止刷新，需要关闭后重新打开。

## 1. 采集方案

Rust 从 session ID 取得**建立该终端时的原始连接配置**，通过 `SshConnectionPool` 申请独立 exec channel。编辑已保存 profile 不会让仍存活的终端快照采集到另一台服务器。沿用 TOFU、代理与 channel 限额，不创建另一条直连认证路径。检测到 JumpServer 的会话走下述当前终端采集路径。

### JumpServer：先选资产，再采集

1. 正常登录 JumpServer，在终端中手动选择资产、账号并完成认证，进入目标主机的空闲 shell 提示符。
2. 点击仪表按钮。客户端在同一个 PTY 中执行固定只读采集，不申请网关 exec channel；报告标题与来源显示当前资产。
3. 可手动或每5/10/15秒刷新。返回菜单、切换资产或断线会改变目标身份，旧报告不能继续采集另一个目标。

识别常见 Welcome / JumpServer / KoKo、`Opt>` / `Opt :` 菜单、KoKo 的 `ssh://账号@资产` OSC 标题及直连资产用户名；要求常见 `user@host ... $/#/%` 空闲提示符。菜单、认证、全屏程序、已有待提交输入时拒绝采集。定制菜单/提示符不能保证识别，应先用实际脱敏会话验收；未识别的会话仍按普通 SSH 连接处理，因此必须检查报告来源，不能把网关报告当成资产报告。

采集前使用短固定命令握手，确认目标 shell 已执行临时读取器后才发送正文。正文在内存中压缩/编码、分块逐块确认，并校验总长度；兼容 GNU/BSD base64 和 gzip，缺失时降级 POSIX 八进制编码。随机事务标记隔离回显和数据，采集内容不进入客户端终端显示、输出历史或 AI 上下文。服务器审计/历史仍可能记录只读读取器调用。无远端临时文件、凭据复制或自动选服。

目标已有 Python3 标准库时，系统/磁盘/Docker 三个子进程并发，分别限时限量并按固定顺序合并；无需安装 Python。没有 Python 时顺序执行同样探针，已有 `timeout` 时限制单项；客户端整次交互事务最长45秒，脚本传送最长20秒，输出最多768 KiB。没有远端 timeout 时不能保证阻塞命令及时退出，内核不可中断 I/O 同样无法强制终止。

采集期间暂时占用该终端输入，避免菜单输入/业务命令与数据混入。提供「取消采集」，关闭报告也请求取消；仅对已确认启动的本次读取器/采集发送 Ctrl+C，握手未确认时不会盲目中断前台程序。超时后等待原提示符恢复再允许下次采集。不会在交互采集失败后回退到网关 exec。

### 普通 SSH：共享连接池并发采集

固定 POSIX `sh` 脚本，`LC_ALL=C`，每节由 `@@DSSH:SECTION` 分隔。无 sudo、安装、远端临时文件、配置改写、进程参数或环境变量转储。局部命令失败继续执行，缺失字段降级。

三个独立任务通过同一个 `SshConnectionPool` **并发执行**，每个任务独占自己的 exec 输出和通道租约：

| 并发任务 | 内容 | 执行读取预算 / stdout+stderr 上限 |
| --- | --- | --- |
| 系统 | CPU 两次计数、系统、内存、进程、登录、网络 | 15 秒 / 256 KiB |
| 磁盘 | 全部挂载与必要的类型回退 | 15 秒 / 256 KiB |
| Docker（可选） | 本机服务概况、容器清单、一次资源统计 | 5 秒 / 128 KiB |

- 每次快照最多同时新增3个 exec channel，不额外建立认证连接；现有通道所有权和数量限制仍生效。各任务结束后按固定顺序合并完整数据块，避免并发 stdout 交错造成错区/JSON 损坏。合计采集预算为640 KiB，另加少量固定分隔/告警文字。
- 低 `MaxSessions` 或本地连接池通道限额拒绝并发任务时，若至少一项已执行成功，会在首轮通道释放后将被拒绝的任务逐个串行补采一次。仅重试通道准入失败，不重试认证、主机密钥、exec 策略拒绝和已经超时/截断的命令；无无界队列/重试。
- 常规耗时从各组相加降为接近最慢一组（仍有开通道等网络开销）；系统与磁盘均可独立超时，Docker 失败不丢弃系统数据，磁盘阻塞也不阻断系统或 Docker 采集。通道准入/传输恢复和串行补采意味着15秒不是整次请求的严格总时限。
- CPU 第一份计数提前读取，启动一个不写文件、无输出的1秒后台计时，再采集其他系统项，等待计时完成后读取第二份计数。通常接近1秒；其他系统命令较慢时采样窗口延长，因此界面标“采样间隔≥1秒”。
- `ps` 成功时只执行一次，由有界 AWK 排名同时保留 CPU/MEM 各5行；`free` 只在 `/proc/meminfo` 读取失败时使用。GNU `df` 已有可用表格时不再额外执行无类型版本或 `mount`，即使它因另一个挂载不可读而返回非零也保留结果。

| 信息 | 主来源 | 降级 / 缺失处理 |
| --- | --- | --- |
| 主机 / 发行版 | `hostname`、读取 `/etc/os-release` 的 PRETTY_NAME | `uname -n/-s`；macOS 尝试 `sw_vers -productVersion`；release 文件只解析不 source |
| 内核 / 架构 | `uname -sr` / `uname -m` | 字段不可用 |
| uptime | `/proc/uptime` 秒数 | 解析 `uptime` 的 up 子串；失败不可用 |
| CPU 型号 / 逻辑核 | `/proc/cpuinfo`、`getconf _NPROCESSORS_ONLN` | 型号尝试 `sysctl machdep.cpu.brand_string`；核数尝试 `nproc` / `sysctl hw.ncpu` |
| CPU 使用率 | `/proc/stat` 首行，间隔至少1秒读取两次，与其他系统项重叠 | 无 `/proc`、计数倒退、零差值或格式错误时不可用 |
| 1/5/15m 负载 | `/proc/loadavg` | `sysctl vm.loadavg`，再解析 `uptime` |
| 内存 / Swap | `/proc/meminfo` | 老内核估算 available；`free -k` 现代格式兜底；无法取得的指标不可用 |
| 全部挂载 | GNU `df -a -P -k -T` | BSD `df -a -P -k` / `df -P -k`，从 `mount` 提取 BSD 文件系统类型；未知类型保留该行 |
| CPU / 内存 Top 5 | `ps -axo pid=,pcpu=,pmem=,comm=` | `ps -eo ...`；单次 ps 输出以有界 AWK 同时选取 CPU / MEM 各5行，客户端按 PID 去重再取前五；无支持时不可用 |
| 登录会话 | `who` | 无会话或 who 不可用；不误称“无人登录” |
| IP | `ip -o address show up` | `ifconfig`，再 `hostname -I`；保留 IPv4/IPv6 与网卡名 |
| 网络概况 | `ss -H -lntu` 后计数 | 无命令、无结果时不可用；这是 TCP/UDP 监听套接字数，不是去重端口数 |

磁盘使用独立并发任务，避免 NFS / FUSE 挂载阻塞影响系统、CPU、内存与 Docker 的采集。输出受限或超时会提示部分挂载可能缺失；不把不完整结果宣称为完整列表。

## 2. 解析与整理逻辑

- 各分区独立解析；缺失/格式错误显示“不可用”，不作为 0 或正常状态。清除控制字符，使用 React 文本渲染，远端文本不作为 HTML 或 ANSI 终端指令执行。
- CPU：读取 user/nice/system/idle/iowait/irq/softirq/steal 的差值，求和为 `Δtotal`。guest/guest_nice 已包含在 user/nice 中，不重复相加。`us=(Δuser+Δnice)/Δtotal`，`sy=Δsystem/Δtotal`，`wa=Δiowait/Δtotal`，`idle=Δidle/Δtotal`；整体使用率 `100-idle` **包含 I/O wait**，其余项还包括 irq/softirq/steal，所以 us+sy+wa+idle 不必等于 100%。计数倒退/无变化返回不可用。
- 内存：优先 `MemAvailable`；`已用=MemTotal−MemAvailable`。老内核用 `MemFree+Buffers+Cached+SReclaimable−Shmem` 估算并限制在总量以内，显式标“估算”。buff/cache 使用 `Buffers+Cached+SReclaimable−Shmem`，最小为 0。这是统一展示口径，与不同版本 free 的 used 列可能不同。
- Swap：`SwapTotal−SwapFree`；总量为 0 表示未配置，不告警。available 和其他必需字段缺失时不计算相关比例。
- 磁盘使用率直接采用 df 的 Capacity/Use%：保留文件系统保留块、配额等语义，不用 used/total 重算。每个挂载单独保留，含 tmpfs、proc、bind 等；不按 `/dev/` 过滤、不按设备名合并。挂载点取该行尾部，保留空格，并解码常见的 `\040` / `\011`。
- 告警：磁盘 `≥80%` 警告、`≥90%` 严重标记；任一 1/5/15m 负载 `>逻辑核数` 提示；available `<10%`、Swap `≥50%` 提示。阈值缺数据时不触发。
- `ps` CPU 百分比是该工具的统计口径（通常是生命周期平均值），不伪装成一秒系统 CPU 采样；多线程进程可超过 100%，内存百分比按 ps 输出。只收集 comm，不采集可能含密码的完整命令行。

## 3. 渲染方案与验收排版

默认图表视图的验收标准：

- 顶部显示主机、系统、架构与采样时间；异常摘要列出需要关注的数量，严重磁盘以红色文字强调。
- 四列紧凑指标带显示 CPU / 内存 / Swap 百分比及 1 分钟负载 / 核数；容量与口径作为辅助信息。未知值显示不可用且不画进度条，未配置 Swap 显示未启用。
- 负载用三条横向条形图比较 1 / 5 / 15 分钟数值，显示逻辑核数参考线；显示 CPU us / sy / wa / idle 分项。图表为单次采样，不表示历史趋势。
- 磁盘默认仅显示有正容量的存储挂载（本地分区、网络盘等），隐藏 tmpfs/proc/sysfs、snap squashfs、Docker overlay、引擎内部目录与容器的 /etc/hosts 等重复绑定。未知类型有正容量时保守保留；overlay 根挂载 `/` 也保留，适配容器内 SSH。点击「显示全部（N）」展开全部，再点「仅显示存储挂载」收起。零容量/未知容量只在全部列表展示。
- 每行显示类型、容量、已用、可用、使用率进度条与文字状态：≥80% 黄色警告、≥90% 红色紧张状态。顶部告警摘要仅统计默认的存储挂载，避免只读镜像100%和重复overlay淹没真实存储告警；展开后其他行仍可见原始使用率与标记。磁盘表格采用固定比例列宽、长挂载点/类型自动换行、可收缩的使用率条；≤760px 时每条挂载按带字段标签的紧凑行组展示，所有字段保留，默认/展开状态均无需横向滚动。
- CPU / 内存 Top 5 分别显示进程名、PID 与百分比；登录与网卡/IP 分别使用表格。紧凑分区与分隔线，不使用营销卡片或装饰性图形。
- 宽窗口四列指标、两列详情；≤800px 时指标切为两列、详情单列。仅正文区域纵向滚动，工具栏持续可见。深浅主题均使用语义颜色，不依赖颜色单独传达异常。

以下保留为文本导出验收示例：

下面示例由实际 TypeScript 格式化函数生成。文本导出保留全部挂载供诊断；默认图表仅展示有正容量的实际存储挂载，虚拟/内部挂载可展开。进程只取 Top 5，网络地址按表格展示。大量挂载、容器或登录会话允许滚动。

使用等宽字体，表格数字右对齐、文本左对齐，中文按双宽字符补空格；G/M 分别为 GiB/MiB，百分比保留合理精度。采用 `⚠` 与明确阈值，不依赖颜色，因此复制文本后仍可辨认告警。不向正在运行的 vim / tmux 或 shell 提示行写入客户端生成的文字。

```text
服务器状态快照 · 2026-10-31 14:08:32
单位 G/M = GiB/MiB；不可用/— 表示无数据。只读采集。
── 系统 ────────────────────────────────────────────
主机 db-prod-01   系统 Ubuntu 24.04.3 LTS
内核 Linux 6.8.0-87-generic   架构 x86_64   运行 42天 0时 16分
── CPU / 负载 ──────────────────────────────────────
型号 AMD EPYC 7B13   逻辑核 8
采样≥1s   使用 74.5%  us 53.9%  sy 13.1%  wa 7.5%  idle 25.5%
负载 1/5/15m  9.42 / 7.15 / 5.38  · 8核  ⚠ 负载超过逻辑核数
── 内存 / Swap ─────────────────────────────────────
内存 总量 32.0G  已用 29.5G  available 2.5G  ⚠ 可用不足10%
     buff/cache 3.0G   Swap 5.0G / 8.0G  ⚠ Swap≥50%
── 进程 Top5（ps 为进程生命周期平均值；CPU可超过100%） ─
CPU postgres(1428) 178.2% · java(2081) 42.8% · nginx(1302) 12.3% · prometheus(3150) 8.5% · redis-server(2300) 2.0%
MEM postgres(1428) 38.4% · java(2081) 12.7% · redis-server(2300) 8.2% · prometheus(3150) 4.6% · nginx(1302) 1.1%
── 登录会话 ────────────────────────────────────────
alice  pts/0  10.10.1.23
ops  pts/1  10.10.1.31
── 网络 ────────────────────────────────────────────
eth0 10.10.2.15/24 · eth0 fe80::ab12/64
TCP/UDP 监听套接字 12
── 磁盘（全部 4 个可读取挂载；含虚拟文件系统） ─────
挂载点   类型     总量    已用   可用  使用率  提示
/        ext4   100.0G   24.0G  70.5G     26%
/data    xfs    500.0G  460.0G  40.0G     92%  ⚠ ≥90%
/backup  ext4   200.0G  160.0G  30.0G     85%  ⚠ ≥80%
/run     tmpfs   16.0G   32.0M  16.0G      1%
注：已用=总量−available；负载含I/O等待，超过核数不等同CPU过载。缺失字段不可用。
```

## 4. 实现代码

已集成到项目；客户端直接使用 SSH 栈已在用的轻量 flate2 做内存压缩，无新增运行时：

- **Docker 可选采集**：[snapshot-docker.sh](../src-tauri/src/hosttools/snapshot-docker.sh)，仅固定只读字段；[dockerSnapshot.ts](../src/hosttools/snapshot/dockerSnapshot.ts) 按容器 ID 合并清单与资源数据；[DockerSnapshotReport.tsx](../src/hosttools/snapshot/DockerSnapshotReport.tsx) 展示。
- **挂载筛选**：[diskVisibility.ts](../src/hosttools/snapshot/diskVisibility.ts)，纯函数筛选默认存储列表，完整原始挂载保留在模型中。
- **POSIX Shell 采集**：[系统/CPU](../src-tauri/src/hosttools/snapshot.sh)、[磁盘](../src-tauri/src/hosttools/snapshot-disks.sh)。脚本不接受用户参数。
- **交互终端执行**：[terminal_snapshot.rs](../src-tauri/src/hosttools/terminal_snapshot.rs) 负责握手、编码传输和取消；[interactive_snapshot.rs](../src-tauri/src/ssh/interactive_snapshot.rs) 负责资产身份、空闲状态与流式帧解析；[snapshot-terminal.py](../src-tauri/src/hosttools/snapshot-terminal.py) 使用目标已有标准库并发运行固定探针。
- **Rust 执行**：[server_status_snapshot](../src-tauri/src/commands/hosttools.rs)，命令已在 lib.rs 注册；[server_snapshot.rs](../src-tauri/src/hosttools/server_snapshot.rs) 负责三路并发、有限补采和结果合并；[SessionManager](../src-tauri/src/ssh/session_manager.rs) 校验会话及绑定原始 profile；[exec runner](../src-tauri/src/ssh/command.rs) 复用通道、限制时间和输出量。
- **TypeScript 数据模型与服务**：[ServerSnapshotOutput](../src/models/serverSnapshot.ts)、[serverStatusSnapshot](../src/services/hostToolsService.ts)，沿用服务层 AppError 规范化。
- **TypeScript 解析/格式化**：[formatSnapshot.ts](../src/hosttools/snapshot/formatSnapshot.ts)，导出纯函数 `parseSnapshot(probe, collectedAt?)` 得到结构化数值/表格/告警，图表与文本导出共享这份解析；另有 `sections(raw)`、`cpuUsage(before, after)`、`size(kib)`、`formatSnapshot(probe, collectedAt?)`，可在 Node.js 中独立使用、测试。
- **React 图表与表格**：[ServerSnapshotReport.tsx](../src/hosttools/snapshot/ServerSnapshotReport.tsx)，消费结构化数据，用轻量 CSS 绘制资源与负载条形图、语义表格展示明细。
- **React 展示**：[ServerSnapshotButton.tsx](../src/hosttools/snapshot/ServerSnapshotButton.tsx)，复用于主窗口 / 独立窗口顶部操作区。

调用方式：

```ts
import { serverStatusSnapshot } from "./src/services/hostToolsService";
import { formatSnapshot, parseSnapshot } from "./src/hosttools/snapshot/formatSnapshot";

const result = await serverStatusSnapshot(focusedSshSessionId);
const text = formatSnapshot(result);
const data = parseSnapshot(result);
// 默认渲染 <ServerSnapshotReport data={data} />；text 用于文本视图和复制。
```

回归测试：

```sh
node --experimental-strip-types --test src/hosttools/snapshot/*.test.mjs
pnpm exec tsc --noEmit
pnpm build
cd src-tauri
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test
```

## 5. 注意事项

- Linux 为完整采集路径；BusyBox / 精简容器可能不支持部分 ps / df 选项，字段将降级。`/proc`、PID namespace、网络 namespace 和 cgroup 不一定对应整台物理主机：本版展示当前 SSH 进程可见的系统，不把核数宣称为容器 CPU quota。
- BSD / macOS 没有 Linux `/proc`。当前已支持可取得的系统、核数、负载、磁盘（BSD mount 类型）、进程、登录与地址；CPU 使用率、available / Swap 完整采集**未实现专门适配**，缺失时清楚标不可用。后续应按系统分别增加 `sysctl kern.cp_time` / `vm_stat` / `vm.swapusage` 并测试页面大小、压缩内存和 wired/reclaimable 口径，不能将 macOS 的 free page 当成 Linux MemAvailable。
- df 的使用率可能因保留块、APFS 共享空间、快照、配额、overlay 或用户权限与 used/total 不同；不将多挂载容量相加。网络文件系统卡住时 exec 超时会关闭客户端通道，远端是否立即停止命令取决于 SSH 服务端；不能保证中断内核不可中断 I/O。
- 普通 SSH 仍采集原始连接主机，不自动跟随普通终端中的嵌套 ssh / sudo / 容器 shell。已识别的 JumpServer 则按当前资产走原 PTY；用户自行完成选服和认证。真实 JumpServer/KoKo 版本、定制菜单、特殊提示符与 Windows 原生 WebView 仍需验收，不能把本地模拟 PTY 通过当成真实服务器验收。
- 非交互 exec 的 PATH / 权限可能与交互 shell 不同，不通过 source 用户配置、sudo 或安装工具补齐；缺失数据明确标识。仅系统已有 POSIX 工具与可选平台命令，不上传 Python/Node 运行时；交互路径的 Python 代码只通过命令在内存中执行。
- 报告查看层与原终端分离；JumpServer 采集要求空闲 shell，并在采集期间占用输入。报告仅保存在当前 UI 内存，复制由用户点击触发。字符宽度为常见中文/拉丁等宽字体近似；极端 Unicode、超长挂载点不截断，允许横向滚动。
- 自动检查额外覆盖原生本地 PTY 的完整握手/分块/采集/提示符恢复、菜单/认证/目标切换拦截、取消及输入互斥、目标 Python 三路并发与部分失败保留；普通 SSH 覆盖三路同时启动、低通道限额串行补采、拒绝exec不重试、分组超时/截断数据保留、CPU计时与主机命令重叠、单次ps/df及缺失命令降级；原有覆盖包括 CPU guest/计数重置、内存估算/free、磁盘阈值/空格/虚拟挂载、BSD 格式、进程去重排序及不完整/控制字符输出。真实 SSH、低 MaxSessions、不同发行版和 macOS/Windows 原生 WebView 的视觉 / 键盘验收仍需完成，见 TODO.md。

## Docker 运行信息

- 仅在 SSH 主机的本地 Docker 服务可访问时展示完整 Docker 区域。未安装客户端时不占用界面；客户端存在但服务未启动/不可达/无权限时显示明确状态。Docker 未采集时不声称“未安装”。
- 读取 `docker info` 的版本、运行/暂停/停止/总容器数、镜像数、存储驱动；`docker ps -a` 只取 ID、名称、镜像、状态、运行/健康描述、端口；`docker stats --no-stream` 只取 CPU、内存/限额、内存百分比、网络/磁盘累计 I/O、进程线程数。
- 所有 JSON 模板字段均为白名单，不采集完整命令、环境变量、标签、inspect、日志或凭据。没有 sudo、容器 exec、启动、停止或 Docker 配置修改。
- 固定本地 Unix socket，清除 Docker 远程主机/上下文及 TLS 环境覆盖：优先已有 XDG_RUNTIME_DIR/docker.sock 或 Docker Desktop 的用户 socket，否则 /var/run/docker.sock。不会自动使用当前 Docker context 连接另一台机器；未设置运行目录的特殊 rootless 安装可显示不可用，需用户按自身安装方式配置可访问的本地 socket。
- 图形区域默认显示活动容器（含暂停、重启及异常状态），「显示全部容器」可展开已停止/已创建容器。状态翻译为中文，保留时长和健康描述作辅助。CPU 可超过100%；停止、刚启动及采集竞态中的容器资源显示不可用，不填0。Docker 的 SI/二进制容量都转换成 KiB，再统一展示 G/M；网络和磁盘 I/O 保留 Docker 人类可读的累计量，不能解读成速率。
- Docker 阶段独立的超时、截断、JSON/命令格式错误只影响 Docker 结果。错误记录只展示固定说明，不回显可能包含环境/认证信息的 stderr；已有容器清单在 stats 失败时保留。

命令与字段参照：[Docker ps](https://docs.docker.com/reference/cli/docker/container/ls/)、[Docker stats](https://docs.docker.com/reference/cli/docker/container/stats/)、[Docker info](https://docs.docker.com/reference/cli/docker/system/info/)。
