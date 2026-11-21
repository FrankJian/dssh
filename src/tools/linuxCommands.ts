export interface LinuxCommand {
  name: string;
  category: string;
  summary: string;
  syntax: string;
  source: { label: string; url: string };
  options: readonly (readonly [flag: string, explanation: string])[];
  examples: readonly (readonly [command: string, explanation: string])[];
  note?: string;
}

const manPage = (project: string, command: string, section: 1 | 8 = 1) => ({
  label: `${project} ${command}(${section}) 手册 · man7`,
  url: `https://man7.org/linux/man-pages/man${section}/${command}.${section}.html`,
});

const coreutils = (name: string) => manPage("GNU Coreutils", name);

// Chinese summaries of upstream manuals. Keep source links alongside each entry.
export const LINUX_COMMANDS: readonly LinuxCommand[] = [
  {
    name: "ls", category: "文件与权限", summary: "列出文件与目录", syntax: "ls [选项] [路径…]", source: coreutils("ls"),
    options: [["-l", "显示权限、属主、大小和时间等详细信息。"], ["-a, --all", "包含以点开头的隐藏项。"], ["-A, --almost-all", "包含隐藏项，但排除 . 和 ..。"], ["-h, --human-readable", "与 -l 或 -s 配合，用 1024 进位单位显示大小。"], ["-t", "按修改时间排序，最新的在前。"], ["-S", "按大小排序，最大的在前。"], ["-R, --recursive", "递归列出子目录。"]],
    examples: [["ls -lah /var/log", "查看日志目录及隐藏项的详细信息。"], ["ls -lt /var/log", "将最近修改的日志排在前面。"]],
  },
  {
    name: "cp", category: "文件与权限", summary: "复制文件与目录", syntax: "cp [选项] 源… 目标", source: coreutils("cp"),
    options: [["-R, --recursive", "递归复制目录。"], ["-a, --archive", "归档复制，递归并尽可能保留属性与符号链接。"], ["-i, --interactive", "覆盖已有目标文件前询问。"], ["-v, --verbose", "显示复制的文件。"], ["-T, --no-target-directory", "把目标当作精确路径，不因其为目录而追加源文件名。"]],
    examples: [["cp -i app.conf app.conf.bak", "复制配置文件，覆盖前询问。"], ["cp -a project/ project-backup/", "保留属性复制项目目录。"]],
  },
  {
    name: "mv", category: "文件与权限", summary: "移动或重命名文件", syntax: "mv [选项] 源… 目标", source: coreutils("mv"),
    options: [["-i, --interactive", "覆盖已有目标前询问。"], ["-n, --no-clobber", "遇到已有目标时跳过，不覆盖。"], ["-v, --verbose", "显示移动的文件。"], ["-T, --no-target-directory", "把目标当作精确路径。"]],
    examples: [["mv -i old.conf new.conf", "重命名配置文件，覆盖前询问。"], ["mv -iv report.txt archive/", "将文件移入已存在的归档目录。"]],
  },
  {
    name: "rm", category: "文件与权限", summary: "删除文件与目录", syntax: "rm [选项] 文件…", source: coreutils("rm"),
    options: [["-i", "每次删除前询问。"], ["-I", "递归删除或操作超过三个文件时，开始前询问一次。"], ["-r, -R, --recursive", "递归删除目录及内容。"], ["-f, --force", "忽略不存在的文件，不询问。"], ["--", "结束选项解析，后续内容作为文件名。"]],
    examples: [["rm -i -- old.log", "逐项确认后删除文件。"], ["rm -rI -- ./obsolete-cache", "先确认，再递归删除指定目录。"]],
    note: "rm 直接删除文件，不进入桌面回收站。-f 与 -i 的后一个选项会覆盖前一个的询问设置。",
  },
  {
    name: "mkdir", category: "文件与权限", summary: "创建目录", syntax: "mkdir [选项] 目录…", source: coreutils("mkdir"),
    options: [["-p, --parents", "创建缺失的父目录；已有目录不报错。"], ["-m, --mode=MODE", "设置指定目录的权限，不影响 -p 创建的父目录。"], ["-v, --verbose", "显示新创建的目录。"]],
    examples: [["mkdir -pv project/logs", "创建多层目录并显示操作。"], ["mkdir -m 700 private", "创建仅属主可访问的目录。"]],
  },
  {
    name: "chmod", category: "文件与权限", summary: "修改权限位", syntax: "chmod [选项] 模式 文件…", source: coreutils("chmod"),
    options: [["-R, --recursive", "递归修改目录及内容的权限。"], ["-v, --verbose", "显示每个文件的处理信息。"], ["--reference=FILE", "采用参照文件的权限。"], ["u / g / o / a", "符号模式中的属主、属组、其他用户、所有用户。"], ["+ / - / =", "符号模式中的增加、移除、设定权限。"], ["r / w / x / X", "读、写、执行；X 仅对目录或原本已有执行位的文件增加执行权限。"]],
    examples: [["chmod u+x deploy.sh", "为属主增加执行权限。"], ["chmod 640 app.conf", "属主读写，属组只读，其他用户无权限。"]],
  },
  {
    name: "head", category: "文本与检索", summary: "查看文件开头", syntax: "head [选项] [文件…]", source: coreutils("head"),
    options: [["-n, --lines=N", "输出前 N 行，默认 10 行。"], ["-c, --bytes=N", "输出前 N 字节。"], ["-q, --quiet", "多文件时不显示文件名标题。"], ["-v, --verbose", "始终显示文件名标题。"]],
    examples: [["head -n 30 app.log", "查看前 30 行日志。"], ["head -c 256 data.txt", "查看前 256 字节。"]],
  },
  {
    name: "tail", category: "文本与检索", summary: "查看文件末尾或跟踪追加内容", syntax: "tail [选项] [文件…]", source: coreutils("tail"),
    options: [["-n, --lines=N", "输出最后 N 行，默认 10 行；+N 表示从第 N 行开始。"], ["-f, --follow", "持续跟踪追加内容，默认跟踪文件描述符。"], ["-F", "按文件名跟踪并重试打开，适合日志轮转。"], ["-c, --bytes=N", "输出最后 N 字节。"]],
    examples: [["tail -n 100 app.log", "查看最后 100 行。"], ["tail -F app.log", "持续跟踪日志，文件重新创建后继续读取。"]],
  },
  {
    name: "grep", category: "文本与检索", summary: "按模式查找匹配行", syntax: "grep [选项] 模式 [文件…]",
    source: manPage("GNU Grep", "grep"),
    options: [["-n, --line-number", "显示行号。"], ["-i, --ignore-case", "忽略大小写。"], ["-r, --recursive", "递归搜索目录；不跟随递归遇到的符号链接。"], ["-F, --fixed-strings", "按固定字符串匹配。"], ["-E, --extended-regexp", "使用扩展正则表达式。"], ["-v, --invert-match", "选出未匹配的行。"], ["-C, --context=N", "显示匹配行及前后各 N 行。"]],
    examples: [["grep -nF -- 'connection refused' app.log", "查找文字并显示行号。"], ["grep -rin -- 'error' ./logs", "在目录中忽略大小写搜索。"]],
  },
  {
    name: "find", category: "文本与检索", summary: "按名称、类型与时间查找文件", syntax: "find [起始路径…] [表达式]",
    source: manPage("GNU Findutils", "find"),
    options: [["-name PATTERN", "按文件名匹配通配符，模式应加引号。"], ["-iname PATTERN", "忽略文件名大小写。"], ["-type f / d / l", "筛选普通文件、目录或符号链接。"], ["-maxdepth N", "限制遍历层级，起始路径为第 0 层。"], ["-mtime +N", "修改时间按完整 24 小时向下取整后大于 N。"], ["-print0", "用 NUL 分隔输出路径，便于安全传给 xargs -0。"]],
    examples: [["find ./logs -maxdepth 2 -type f -name '*.log'", "查找两层以内的日志文件。"], ["find ./logs -type f -mtime +7 -print", "列出至少 8 个完整 24 小时未修改的文件。"]],
  },
  {
    name: "df", category: "磁盘与归档", summary: "查看文件系统空间", syntax: "df [选项] [路径…]", source: coreutils("df"),
    options: [["-h, --human-readable", "按 1024 进位显示容量。"], ["-H, --si", "按 1000 进位显示容量。"], ["-T, --print-type", "显示文件系统类型。"], ["-i, --inodes", "显示 inode 使用情况。"], ["-l, --local", "仅列出本地文件系统。"]],
    examples: [["df -hT", "查看容量、剩余空间和文件系统类型。"], ["df -i /var", "查看 /var 所在文件系统的 inode 使用情况。"]],
  },
  {
    name: "du", category: "磁盘与归档", summary: "估算文件与目录占用", syntax: "du [选项] [路径…]", source: coreutils("du"),
    options: [["-h, --human-readable", "按 1024 进位显示占用。"], ["-s, --summarize", "每个参数仅输出汇总。"], ["-d, --max-depth=N", "仅显示深度不超过 N 的目录汇总，起点为 0。"], ["-a, --all", "同时显示文件的占用。"], ["-x, --one-file-system", "遍历时跳过其他文件系统的目录。"]],
    examples: [["du -sh ./project", "查看项目目录总占用。"], ["du -h --max-depth=1 /var/log", "查看日志目录第一层占用。"]],
    note: "默认统计磁盘占用，稀疏文件的占用可能小于文件的逻辑大小。",
  },
  {
    name: "tar", category: "磁盘与归档", summary: "创建、查看和解开归档", syntax: "tar 操作 [选项] [文件…]",
    source: manPage("GNU tar", "tar"),
    options: [["-c, --create", "创建归档。"], ["-x, --extract", "解开归档。"], ["-t, --list", "列出归档成员。"], ["-f, --file=ARCHIVE", "指定归档文件，-f 后需跟文件名。"], ["-z, --gzip", "通过 gzip 压缩或解压。"], ["-C, --directory=DIR", "处理后续参数前切换到指定目录。"], ["-v, --verbose", "显示正在处理的成员。"]],
    examples: [["tar -czf project.tar.gz ./project", "创建 gzip 压缩归档。"], ["tar -tf project.tar.gz", "先查看归档中的成员。"], ["tar -xzf project.tar.gz -C ./restore", "解压到已存在的 restore 目录。"]],
    note: "-c、-x、-t 为互斥操作。解压时可能覆盖目标目录中的同名文件。",
  },
  {
    name: "ps", category: "进程与服务", summary: "查看进程快照", syntax: "ps [选项]",
    source: { label: "procps-ng ps(1) 手册", url: "https://man7.org/linux/man-pages/man1/ps.1.html" },
    options: [["-e", "选取所有进程。"], ["-f", "使用完整格式。"], ["-p PID", "按进程 ID 选取，可用逗号分隔。"], ["-o FORMAT", "自定义输出字段，例如 pid,ppid,comm。"], ["--sort=KEY", "按字段排序，字段前的 - 表示降序。"]],
    examples: [["ps -ef", "查看所有进程的完整信息。"], ["ps -eo pid,comm,%cpu,%mem --sort=-%cpu", "按 CPU 使用率降序查看进程。"]],
    note: "此处采用 Linux procps-ng 语法。ps aux 为 BSD 风格写法，不能直接改成 ps -aux。",
  },
  {
    name: "systemctl", category: "进程与服务", summary: "查看与管理 systemd 单元", syntax: "systemctl [选项] 子命令 [单元…]",
    source: { label: "systemd systemctl", url: "https://www.freedesktop.org/software/systemd/man/latest/systemctl.html" },
    options: [["status UNIT", "查看单元运行状态及近期日志。"], ["start / stop / restart UNIT", "启动、停止、重启单元。"], ["enable / disable UNIT", "配置或取消单元的启用链接，不立即启动或停止。"], ["--now", "与 enable / disable 配合时，同时启动或停止。"], ["daemon-reload", "重新加载单元文件与依赖配置。"], ["--user", "操作当前用户的服务管理器。"], ["--no-pager", "直接输出，不进入分页器。"]],
    examples: [["systemctl status nginx.service --no-pager", "查看 nginx 服务状态。"], ["systemctl list-units --type=service --state=running", "列出正在运行的服务单元。"]],
    note: "适用于使用 systemd 的系统。修改服务状态通常需要相应权限。daemon-reload 本身不会重启服务。",
  },
  {
    name: "journalctl", category: "进程与服务", summary: "检索 systemd 日志", syntax: "journalctl [选项] [字段匹配…]",
    source: { label: "systemd journalctl", url: "https://www.freedesktop.org/software/systemd/man/latest/journalctl.html" },
    options: [["-u, --unit=UNIT", "筛选指定单元的日志。"], ["-b, --boot[=BOOT]", "筛选启动记录；-b 为本次启动，-b -1 为上次。"], ["-n, --lines=N", "仅显示最近 N 条。"], ["-f, --follow", "持续显示新日志。"], ["--since=TIME", "筛选指定时间及之后的记录。"], ["-p, --priority=LEVEL", "筛选指定级别及更严重的记录，例如 err。"], ["--no-pager", "关闭分页输出。"]],
    examples: [["journalctl -u nginx.service -n 100 --no-pager", "查看服务最近 100 条日志。"], ["journalctl -b -p err --since '1 hour ago'", "查看本次启动最近一小时的错误及更严重日志。"]],
  },
  {
    name: "ss", category: "网络与连接", summary: "查看套接字与监听端口", syntax: "ss [选项] [过滤表达式]",
    source: { label: "iproute2 ss(8) 手册", url: "https://man7.org/linux/man-pages/man8/ss.8.html" },
    options: [["-l, --listening", "只显示监听套接字。"], ["-t, --tcp", "显示 TCP 套接字。"], ["-u, --udp", "显示 UDP 套接字。"], ["-n, --numeric", "不将服务端口解析为名称。"], ["-p, --processes", "显示关联进程，部分进程需要额外权限才能查看。"], ["-a, --all", "包含监听及非监听套接字。"]],
    examples: [["ss -lntup", "查看 TCP、UDP 监听端口及关联进程。"], ["ss -tn state established", "查看已建立的 TCP 连接。"]],
  },
  {
    name: "curl", category: "网络与连接", summary: "传输数据与调试 HTTP", syntax: "curl [选项] URL…",
    source: { label: "curl 官方手册", url: "https://curl.se/docs/manpage.html" },
    options: [["-I, --head", "发送 HEAD 请求，仅获取响应头。"], ["-L, --location", "跟随重定向。"], ["-o, --output FILE", "将响应写入指定文件。"], ["-H, --header HEADER", "添加或替换请求头，可重复指定。"], ["-d, --data DATA", "发送请求数据，默认使用 POST。"], ["--connect-timeout SECONDS", "限制连接阶段耗时。"], ["--max-time SECONDS", "限制整个操作耗时。"], ["-f, --fail", "HTTP 400 及以上通常返回错误且不输出响应正文。"]],
    examples: [["curl -I --max-time 10 https://example.org/", "获取响应头并限制总耗时。"], ["curl -fL -o page.html https://example.org/", "跟随重定向并保存响应。"]],
  },
  {
    name: "ssh", category: "网络与连接", summary: "OpenSSH 远程登录与转发", syntax: "ssh [选项] [用户@]主机 [命令]",
    source: { label: "OpenSSH ssh(1) 官方手册", url: "https://man.openbsd.org/ssh.1" },
    options: [["-p PORT", "指定远端 SSH 端口。"], ["-i FILE", "指定身份密钥文件。"], ["-J [USER@]HOST[:PORT]", "通过跳板机连接目标，可用逗号串联多个跳点。"], ["-L [BIND:]PORT:HOST:HOSTPORT", "将本地端口经远端转发到目标地址。"], ["-N", "不执行远端命令，常用于纯端口转发。"], ["-v / -vv / -vvv", "增加调试输出，最多三个 v。"], ["-o OPTION=VALUE", "传入 ssh_config 配置项。"]],
    examples: [["ssh -p 2222 user@server.example", "连接非默认端口。"], ["ssh -N -L 127.0.0.1:8080:127.0.0.1:80 user@server.example", "将远端回环地址的 80 端口映射到本机 8080。"]],
  },
  {
    name: "cat", category: "文本与检索", summary: "拼接文件并显示内容", syntax: "cat [选项] [文件…]", source: coreutils("cat"),
    options: [["-n, --number", "给所有输出行编号。"], ["-b, --number-nonblank", "只给非空行编号，优先于 -n。"], ["-s, --squeeze-blank", "将连续空行压缩成一个空行。"], ["-A, --show-all", "显示制表符、行尾和其他不可见字符。"]],
    examples: [["cat -n app.conf", "显示配置内容和行号。"], ["cat -A data.txt", "检查行尾、制表符和不可见字符。"]],
  },
  {
    name: "touch", category: "文件与权限", summary: "更新时间戳或创建空文件", syntax: "touch [选项] 文件…", source: coreutils("touch"),
    options: [["-a", "只更新访问时间。"], ["-m", "只更新修改时间。"], ["-c, --no-create", "文件不存在时不创建。"], ["-r, --reference=FILE", "采用参照文件的时间。"], ["-d, --date=STRING", "使用指定日期时间。"]],
    examples: [["touch app.log", "创建空日志文件，或更新已有文件的时间。"], ["touch -m -r reference.txt target.txt", "使目标修改时间与参照文件一致。"]],
  },
  {
    name: "ln", category: "文件与权限", summary: "创建硬链接或符号链接", syntax: "ln [选项] 目标 链接名", source: coreutils("ln"),
    options: [["-s, --symbolic", "创建符号链接，默认创建硬链接。"], ["-i, --interactive", "覆盖已有链接路径前询问。"], ["-n, --no-dereference", "目标链接名为指向目录的符号链接时，按链接自身处理。"], ["-T, --no-target-directory", "将链接名作为精确路径。"], ["-v, --verbose", "显示创建的链接。"]],
    examples: [["ln -s /srv/releases/v1 /srv/current", "为发布目录创建符号链接。"], ["ln -sivT /srv/releases/v2 /srv/current", "将链接名作为精确路径，交互确认后更新已有符号链接。"]],
    note: "硬链接通常不能跨文件系统。符号链接中的相对目标是相对于链接所在目录解析的。",
  },
  {
    name: "chown", category: "文件与权限", summary: "修改文件属主与属组", syntax: "chown [选项] 用户[:组] 文件…", source: coreutils("chown"),
    options: [["-R, --recursive", "递归处理目录及内容。"], ["-h, --no-dereference", "修改符号链接自身的属主，而非所指文件。"], ["--reference=FILE", "采用参照文件的属主和属组。"], ["-c, --changes", "仅报告实际发生的修改。"], ["USER:GROUP", "同时指定属主和属组；仅 :GROUP 表示只改属组。"]],
    examples: [["chown app:app ./app.log", "将文件属主和属组设为 app。"], ["chown -h app:app ./current", "修改符号链接自身的归属。"]],
    note: "修改属主通常需要管理员权限。递归操作会影响整个目录树。",
  },
  {
    name: "chgrp", category: "文件与权限", summary: "修改文件属组", syntax: "chgrp [选项] 组 文件…", source: coreutils("chgrp"),
    options: [["-R, --recursive", "递归修改目录及内容。"], ["-h, --no-dereference", "修改符号链接自身。"], ["--reference=FILE", "采用参照文件的属组。"], ["-c, --changes", "只报告实际修改。"]],
    examples: [["chgrp developers ./app.log", "修改日志文件属组。"], ["chgrp --reference=template.conf app.conf", "按模板文件设置属组。"]],
  },
  {
    name: "stat", category: "文件与权限", summary: "查看文件与文件系统元数据", syntax: "stat [选项] 文件…", source: coreutils("stat"),
    options: [["-L, --dereference", "查看符号链接指向的文件。"], ["-f, --file-system", "显示文件所在文件系统的信息。"], ["-c, --format=FORMAT", "按自定义格式输出，每个结果自动换行。"], ["%n / %s / %a / %U", "格式占位符，分别为文件名、字节数、八进制权限、属主名称。"]],
    examples: [["stat app.conf", "查看大小、权限、时间和 inode 信息。"], ["stat -c '%n %s bytes %a %U' app.conf", "自定义输出文件元数据。"]],
    note: "这里使用 GNU stat 的选项和格式语法；macOS/BSD stat 的 -f 含义不同。",
  },
  {
    name: "readlink", category: "文件与权限", summary: "读取符号链接目标", syntax: "readlink [选项] 路径…", source: coreutils("readlink"),
    options: [["-f, --canonicalize", "解析为绝对路径，除最后一级外的路径组件必须存在。"], ["-e, --canonicalize-existing", "解析为绝对路径，所有组件都必须存在。"], ["-m, --canonicalize-missing", "允许路径组件不存在。"], ["-n, --no-newline", "末尾不输出换行。"]],
    examples: [["readlink ./current", "读取链接保存的原始目标。"], ["readlink -f ./current", "解析链接对应的绝对路径。"]],
  },
  {
    name: "realpath", category: "文件与权限", summary: "规范化路径并解析符号链接", syntax: "realpath [选项] 路径…", source: coreutils("realpath"),
    options: [["-e, --canonicalize-existing", "要求所有路径组件存在。"], ["-m, --canonicalize-missing", "允许路径组件不存在。"], ["--relative-to=DIR", "输出相对于 DIR 的路径。"], ["-s, --strip", "仅规范化路径，不解析符号链接。"]],
    examples: [["realpath -e ./app.conf", "获取已存在文件的规范绝对路径。"], ["realpath --relative-to=/srv /srv/app/config", "输出相对于 /srv 的路径。"]],
  },
  {
    name: "sort", category: "文本与检索", summary: "按字段或数值排序文本行", syntax: "sort [选项] [文件…]", source: coreutils("sort"),
    options: [["-n, --numeric-sort", "按数值排序。"], ["-h, --human-numeric-sort", "按带 K、M、G 等单位的数值排序。"], ["-r, --reverse", "反向排序。"], ["-k, --key=START[,END]", "指定排序字段范围，字段从 1 开始。"], ["-t, --field-separator=CHAR", "指定字段分隔字符。"], ["-u, --unique", "仅保留比较键不同的行。"]],
    examples: [["sort -n numbers.txt", "将数值按升序排列。"], ["sort -t ',' -k 2,2n data.csv", "按第二个逗号分隔字段的数值排序。"]],
    note: "文本顺序受 locale 影响。-t ',' 仅按字符分列，不解析带引号和嵌入逗号的完整 CSV 语法。",
  },
  {
    name: "uniq", category: "文本与检索", summary: "筛选相邻重复行", syntax: "uniq [选项] [输入 [输出]]", source: coreutils("uniq"),
    options: [["-c, --count", "显示每组连续相同行的数量。"], ["-d, --repeated", "只输出重复组，每组一次。"], ["-u, --unique", "只输出没有连续重复的行。"], ["-i, --ignore-case", "比较时忽略大小写。"]],
    examples: [["uniq -c sorted.txt", "统计已经相邻排列的相同行。"], ["uniq -d sorted.txt", "列出连续重复的行。"]],
    note: "uniq 只合并相邻重复行；全文件去重通常先用 sort，再将输出传给 uniq。",
  },
  {
    name: "wc", category: "文本与检索", summary: "统计行、词、字符和字节", syntax: "wc [选项] [文件…]", source: coreutils("wc"),
    options: [["-l, --lines", "统计换行符数量。"], ["-w, --words", "统计由空白分隔的词。"], ["-m, --chars", "按当前 locale 统计字符。"], ["-c, --bytes", "统计字节。"], ["-L, --max-line-length", "显示最长行的显示宽度。"]],
    examples: [["wc -l app.log", "统计日志中的换行符数量。"], ["wc -m -c text.txt", "同时查看字符数和字节数。"]],
    note: "末行没有换行符时，wc -l 不会将其计为额外一行。字符数也不等于用户看到的字素数量。",
  },
  {
    name: "cut", category: "文本与检索", summary: "按字符位置或分隔字段取列", syntax: "cut 选择选项 [其他选项] [文件…]", source: coreutils("cut"),
    options: [["-f, --fields=LIST", "选取字段，默认以制表符分隔。"], ["-d, --delimiter=CHAR", "指定字段分隔字符。"], ["-b, --bytes=LIST", "按字节位置选取，从 1 开始。"], ["-c, --characters=LIST", "按字符位置选取，从 1 开始；旧版 GNU cut 可能按字节处理。"], ["-s, --only-delimited", "跳过不含字段分隔符的行。"]],
    examples: [["cut -d ':' -f 1 /etc/passwd", "提取账户名称列。"], ["cut -f 1,3 data.tsv", "提取制表符文件的第一和第三列。"]],
    note: "cut 不解析 CSV 引号。按字节截取可能切断 UTF-8 字符，多字节字符支持请以目标主机版本为准。",
  },
  {
    name: "tr", category: "文本与检索", summary: "转换、删除或压缩字符", syntax: "tr [选项] 字符集1 [字符集2]", source: coreutils("tr"),
    options: [["-d, --delete", "删除字符集1中的字符。"], ["-s, --squeeze-repeats", "压缩最后一个指定字符集中的连续重复字符。"], ["-c, --complement", "使用字符集1的补集。"], ["[:lower:] / [:upper:]", "小写和大写字符类。"]],
    examples: [["tr '[:lower:]' '[:upper:]' < input.txt", "将输入中的小写字母转为大写。"], ["tr -d '\\r' < windows.txt", "删除回车字符并输出到终端。"]],
    note: "tr 从标准输入读取。多字节字符处理受实现和 locale 限制，复杂 Unicode 转换应使用支持 Unicode 的工具。",
  },
  {
    name: "tee", category: "文本与检索", summary: "同时输出到终端与文件", syntax: "tee [选项] [文件…]", source: coreutils("tee"),
    options: [["-a, --append", "追加到文件，默认覆盖。"], ["-i, --ignore-interrupts", "忽略 SIGINT 信号。"], ["--output-error=MODE", "配置输出错误的处理方式，例如 warn。"]],
    examples: [["tee -a session.log", "将键盘输入同时显示并追加到日志，输入结束时按 Ctrl+D。"], ["tee copy-a.txt copy-b.txt < source.txt", "将文件内容同时写入两个目标并显示。"]],
  },
  {
    name: "sed", category: "文本与检索", summary: "按行筛选与替换文本", syntax: "sed [选项] 脚本 [文件…]",
    source: manPage("GNU sed", "sed"),
    options: [["-n, --quiet", "关闭默认逐行输出，配合 p 显示选中行。"], ["-E, --regexp-extended", "使用扩展正则表达式。"], ["-e SCRIPT", "添加一个脚本，可重复指定。"], ["-f SCRIPTFILE", "从文件读取脚本。"], ["-i[SUFFIX]", "原地修改；紧接后缀时保留备份，例如 -i.bak。"], ["s/PATTERN/REPLACEMENT/g", "替换每行中的所有匹配；省略 g 时仅替换每行首个匹配。"]],
    examples: [["sed -n '10,20p' app.log", "输出第 10 至 20 行。"], ["sed 's/old/new/g' input.txt", "显示替换结果，输入文件保持原内容。"]],
    note: "GNU sed 与 BSD sed 的 -i 语法存在差异。直接使用 -i 会修改文件。",
  },
  {
    name: "awk", category: "文本与检索", summary: "按字段处理与汇总文本", syntax: "awk [选项] '模式 { 动作 }' [文件…]",
    source: manPage("GNU Awk", "gawk"),
    options: [["-F FS", "设置输入字段分隔符，可使用正则表达式。"], ["-v NAME=VALUE", "执行程序前设置变量。"], ["-f PROGRAMFILE", "从文件读取程序。"], ["$0 / $1 / $2", "整行、第一字段、第二字段。"], ["NR / NF", "当前输入记录总编号、当前记录的字段数。"], ["BEGIN / END", "读取记录前、全部记录处理后的动作。"]],
    examples: [["awk -F ':' '{print $1}' /etc/passwd", "按冒号分隔并输出账户名称。"], ["awk '{sum += $2} END {print sum}' values.txt", "累加每行第二字段的数值。"]],
  },
  {
    name: "xargs", category: "文本与检索", summary: "将输入转换成命令参数", syntax: "xargs [选项] [命令 [初始参数…]]",
    source: manPage("GNU Findutils", "xargs"),
    options: [["-0, --null", "按 NUL 分隔参数，配合 find -print0。"], ["-a, --arg-file=FILE", "从指定文件读取参数。"], ["-r, --no-run-if-empty", "没有输入参数时不执行命令。"], ["-n, --max-args=N", "每次最多传入 N 个参数。"], ["-P, --max-procs=N", "最多同时运行 N 个进程；0 表示尽可能多。"], ["-I REPLACE", "以输入行替换命令中的占位字符串。"]],
    examples: [["xargs -0 -r -a files.list0 -n 1 printf '%s\\n'", "从 NUL 分隔清单逐项显示路径。"], ["xargs -r -n 1 printf '[%s]\\n' < names.txt", "将以空白分隔的简单名称逐项显示。"]],
    note: "默认会解释空白、引号和反斜杠。处理任意文件名时采用 NUL 分隔输入与 -0。",
  },
  {
    name: "diff", category: "文本与检索", summary: "比较文件或目录差异", syntax: "diff [选项] 文件1 文件2",
    source: manPage("GNU Diffutils", "diff"),
    options: [["-u, --unified", "显示统一差异格式，默认带三行上下文。"], ["-r, --recursive", "递归比较目录。"], ["-q, --brief", "只报告文件是否不同。"], ["-w, --ignore-all-space", "比较行时忽略所有空白差别。"], ["-y, --side-by-side", "以左右并排格式显示。"]],
    examples: [["diff -u old.conf new.conf", "查看配置文件的统一差异。"], ["diff -rq ./release-a ./release-b", "汇总两个目录的差异文件。"]],
    note: "退出码 0 表示相同，1 表示存在差异，2 表示处理出错。",
  },
  {
    name: "gzip", category: "磁盘与归档", summary: "压缩或解压 gzip 文件", syntax: "gzip [选项] [文件…]",
    source: { label: "GNU Gzip gzip(1) 手册 · Debian", url: "https://manpages.debian.org/trixie/gzip/gzip.1.en.html" },
    options: [["-d, --decompress", "解压文件。"], ["-c, --stdout", "输出到标准输出并保留原文件。"], ["-k, --keep", "保留输入文件。"], ["-t, --test", "校验压缩文件完整性。"], ["-1 / -9", "选择更快的压缩或更高的压缩率。"], ["-l, --list", "显示压缩和解压后的大小等信息。"]],
    examples: [["gzip -k app.log", "生成 app.log.gz 并保留原日志。"], ["gzip -dc app.log.gz", "将解压内容输出到终端。"]],
    note: "默认压缩会用 .gz 文件替换输入文件。gzip 压缩数据流；多文件归档通常先使用 tar。",
  },
  {
    name: "sha256sum", category: "文件与权限", summary: "计算和验证文件 SHA-256", syntax: "sha256sum [选项] [文件…]",
    source: coreutils("sha256sum"),
    options: [["-c, --check", "读取校验清单并核对文件。"], ["-b, --binary", "以二进制模式读取。"], ["--quiet", "校验时不报告成功的文件。"], ["--status", "校验时不输出结果，仅通过退出码表示。"], ["--strict", "校验清单有格式错误时返回失败。"]],
    examples: [["sha256sum release.tar.gz", "计算发布文件的 SHA-256。"], ["sha256sum -c SHA256SUMS", "按校验清单核对下载的文件。"]],
  },
  {
    name: "date", category: "系统与环境", summary: "显示与格式化日期时间", syntax: "date [选项] [+格式]", source: coreutils("date"),
    options: [["-u, --utc", "使用 UTC。"], ["-d, --date=STRING", "解析给定日期时间。"], ["-r, --reference=FILE", "显示文件最后修改时间。"], ["-I[FMT], --iso-8601[=FMT]", "输出 ISO 8601 格式，例如 -Iseconds。"], ["%s / %F / %T / %z", "Unix 秒时间戳、年月日、时分秒、时区偏移格式符。"]],
    examples: [["date -u '+%FT%TZ'", "输出 UTC 时间。"], ["date -d '@1700000000' '+%F %T %z'", "将 Unix 秒时间戳转换为本地时间。"]],
  },
  {
    name: "id", category: "系统与环境", summary: "查看用户与组身份", syntax: "id [选项] [用户]", source: coreutils("id"),
    options: [["-u, --user", "仅显示用户 ID。"], ["-g, --group", "仅显示主组 ID。"], ["-G, --groups", "显示全部组 ID。"], ["-n, --name", "与 -u、-g 或 -G 配合显示名称。"], ["-r, --real", "与 ID 选择项配合显示实际身份，而非有效身份。"]],
    examples: [["id -un", "显示当前有效用户名。"], ["id -Gn app", "查看 app 用户所属组的名称。"]],
  },
  {
    name: "whoami", category: "系统与环境", summary: "显示当前有效用户名", syntax: "whoami [选项]", source: coreutils("whoami"),
    options: [["--help", "显示帮助。"], ["--version", "显示 GNU Coreutils 版本。"]],
    examples: [["whoami", "显示当前有效用户名。"], ["whoami --version", "查看该命令的实现版本。"]],
  },
  {
    name: "uname", category: "系统与环境", summary: "查看内核与系统信息", syntax: "uname [选项]", source: coreutils("uname"),
    options: [["-a, --all", "显示所有可用系统信息。"], ["-s, --kernel-name", "显示内核名称。"], ["-r, --kernel-release", "显示内核发行版本。"], ["-m, --machine", "显示机器硬件架构。"], ["-n, --nodename", "显示网络节点名称。"]],
    examples: [["uname -a", "查看内核与架构摘要。"], ["uname -rm", "查看内核版本与机器架构。"]],
  },
  {
    name: "env", category: "系统与环境", summary: "查看环境或以指定环境运行命令", syntax: "env [选项] [变量=值…] [命令 [参数…]]", source: coreutils("env"),
    options: [["-i, --ignore-environment", "从空环境开始。"], ["-u, --unset=NAME", "从运行环境中移除指定变量。"], ["-C, --chdir=DIR", "运行命令前切换目录。"], ["NAME=VALUE", "为本次命令设置环境变量。"]],
    examples: [["env TZ=UTC date", "仅为本次 date 指定 UTC 时区。"], ["env -u HTTP_PROXY printenv PATH", "移除 HTTP_PROXY 后运行命令。"]],
    note: "不带命令时显示环境变量，其中可能包含凭据；复制输出前注意内容。",
  },
  {
    name: "timeout", category: "进程与服务", summary: "限制命令运行时长", syntax: "timeout [选项] 时长 命令 [参数…]", source: coreutils("timeout"),
    options: [["-s, --signal=SIGNAL", "超时时发送指定信号，默认 TERM。"], ["-k, --kill-after=DURATION", "发送初始信号后再等待指定时长，仍运行则发送 KILL。"], ["--preserve-status", "即使超时也采用被管理命令的退出状态。"], ["--foreground", "不创建单独后台进程组，适合需要终端交互的命令。"]],
    examples: [["timeout 10s sleep 30", "最多等待十秒后请求结束 sleep。"], ["timeout -k 2s 10s ./worker.sh", "十秒后发送 TERM，再过两秒仍未退出则发送 KILL。"]],
    note: "默认超时退出码为 124；涉及 KILL 时可能为 137。s、m、h、d 分别表示秒、分钟、小时、天。",
  },
  {
    name: "nohup", category: "进程与服务", summary: "使命令忽略挂断信号", syntax: "nohup 命令 [参数…]", source: coreutils("nohup"),
    options: [["> FILE", "Shell 重定向，将标准输出写入文件。"], ["2>&1", "Shell 重定向，使标准错误跟随标准输出。"], ["&", "Shell 后台执行标记；nohup 自身不会自动放到后台。"]],
    examples: [["nohup ./worker.sh > worker.log 2>&1 &", "后台运行脚本并显式保存输出。"], ["nohup sleep 60 > sleep.log 2>&1 &", "运行一个忽略挂断信号的后台计时任务。"]],
    note: "此处列出的重定向和 & 由 Shell 解释。nohup 不提供开机启动、崩溃重启或服务监管。",
  },
  {
    name: "sleep", category: "进程与服务", summary: "暂停指定时长", syntax: "sleep 时长…", source: coreutils("sleep"),
    options: [["s / m / h / d", "时长后缀为秒、分钟、小时和天，省略后缀按秒。"], ["多个时长参数", "GNU sleep 将这些时长相加。"], ["小数时长", "GNU sleep 支持小数，例如 0.5。"]],
    examples: [["sleep 0.5", "暂停半秒。"], ["sleep 1m 5s", "暂停一分钟零五秒。"]],
  },
  {
    name: "top", category: "进程与服务", summary: "动态查看 CPU、内存与进程", syntax: "top [选项]", source: manPage("procps-ng", "top"),
    options: [["-b", "使用批处理模式，适合保存输出。"], ["-n N", "更新 N 次后退出。"], ["-d SECONDS", "设置刷新间隔。"], ["-p PID[,PID…]", "只显示指定进程。"], ["-H", "显示线程。"], ["P / M / q", "交互按键，按 CPU 排序、按内存排序、退出。"]],
    examples: [["top -b -n 1", "获取一次批处理快照。"], ["top -H -p 1234", "交互查看 PID 1234 的线程。"]],
  },
  {
    name: "free", category: "进程与服务", summary: "查看物理内存与交换空间", syntax: "free [选项]", source: manPage("procps-ng", "free"),
    options: [["-h, --human", "自动选择便于阅读的单位。"], ["-m, --mebi", "以 MiB 显示。"], ["-s, --seconds=N", "每隔 N 秒更新。"], ["-c, --count=N", "更新 N 次后退出，通常配合 -s。"], ["-w, --wide", "分别显示 buffers 和 cache。"]],
    examples: [["free -h", "查看内存与 swap 使用情况。"], ["free -m -s 2 -c 5", "每两秒输出一次，共五次。"]],
    note: "available 是无需交换即可供新应用使用的内存估算；free 只表示完全空闲的内存。",
  },
  {
    name: "vmstat", category: "进程与服务", summary: "采样内存、调度与 I/O 活动", syntax: "vmstat [选项] [间隔秒数 [次数]]", source: manPage("procps-ng", "vmstat", 8),
    options: [["-w, --wide", "使用宽格式。"], ["-t, --timestamp", "每行附带时间。"], ["-y, --no-first", "跳过反映系统启动以来统计的首条报告。"], ["-s, --stats", "显示累计统计表。"], ["-d, --disk", "查看磁盘统计。"], ["-S K / M", "以 1024 或 1048576 字节为内存单位，不影响块 I/O 字段。"]],
    examples: [["vmstat -w 1 5", "每秒采样，共五条报告。"], ["vmstat -y -t 2 5", "跳过首条历史统计，附时间进行采样。"]],
    note: "默认首条报告中的速率是自启动以来的平均值，后续报告反映采样间隔；内存和进程数据为即时值。",
  },
  {
    name: "pgrep", category: "进程与服务", summary: "按名称或属性查找进程", syntax: "pgrep [选项] 模式", source: manPage("procps-ng", "pgrep"),
    options: [["-a, --list-full", "同时显示 PID 和完整命令行。"], ["-f, --full", "对完整命令行匹配，而非仅进程名。"], ["-x, --exact", "要求整个进程名或命令行匹配模式。"], ["-u, --euid=USER", "按有效用户筛选。"], ["-n, --newest", "只选最新启动的匹配进程。"], ["-c, --count", "输出匹配数量。"]],
    examples: [["pgrep -a -x nginx", "列出名称匹配 nginx 的进程和命令行。"], ["pgrep -af 'python.*worker'", "按完整命令行的正则模式查找工作进程。"]],
    note: "默认名称匹配基于 /proc 的进程名，通常最多 15 个字符；长名称可考虑 -f。模式为扩展正则表达式。",
  },
  {
    name: "pkill", category: "进程与服务", summary: "向匹配的进程发送信号", syntax: "pkill [选项] 模式", source: manPage("procps-ng", "pgrep"),
    options: [["-SIGNAL", "指定信号，例如 -TERM；默认 TERM。"], ["-0", "仅检查匹配进程是否存在且有发送信号权限，不实际发送信号。"], ["-x, --exact", "匹配完整进程名。"], ["-f, --full", "对完整命令行匹配。"], ["-u, --euid=USER", "仅选取指定有效用户的进程。"]],
    examples: [["pkill -0 -x worker", "检查是否存在可发送信号的 worker 进程。"], ["pkill -TERM -x worker", "请求名称匹配 worker 的进程正常退出。"]],
    note: "可能影响多个进程。发送终止信号前，可先用相同筛选条件的 pgrep 核对目标。",
  },
  {
    name: "watch", category: "进程与服务", summary: "周期执行命令并显示结果", syntax: "watch [选项] 命令 [参数…]", source: manPage("procps-ng", "watch"),
    options: [["-n, --interval=SECONDS", "设置刷新间隔，默认两秒。"], ["-d, --differences", "高亮输出变化。"], ["-t, --no-title", "隐藏顶部标题。"], ["-e, --errexit", "命令以非零状态退出后暂停更新，按键后退出。"], ["-x, --exec", "直接执行命令，不经 Shell 解释。"]],
    examples: [["watch -n 2 -d free -h", "每两秒查看内存并突出变化。"], ["watch -n 1 'date; uptime'", "用 Shell 每秒显示时间和运行时长。"]],
  },
  {
    name: "lsblk", category: "磁盘与归档", summary: "查看块设备与分区", syntax: "lsblk [选项] [设备…]", source: manPage("util-linux", "lsblk", 8),
    options: [["-f, --fs", "显示文件系统信息。"], ["-o, --output LIST", "指定输出列。"], ["-b, --bytes", "以字节显示大小。"], ["-J, --json", "使用 JSON 格式。"], ["-p, --paths", "显示完整设备路径。"], ["-d, --nodeps", "不显示从属设备。"]],
    examples: [["lsblk -f", "查看设备、文件系统及挂载点。"], ["lsblk -J -o NAME,SIZE,FSTYPE,MOUNTPOINT", "用固定列输出 JSON。"]],
  },
  {
    name: "lscpu", category: "系统与环境", summary: "查看 CPU 架构与拓扑", syntax: "lscpu [选项]", source: manPage("util-linux", "lscpu"),
    options: [["-e[=LIST], --extended[=LIST]", "按表格展示每个 CPU 的信息，可指定列。"], ["-p[=LIST], --parse[=LIST]", "输出便于解析的格式。"], ["-J, --json", "以 JSON 输出。"], ["-a, --all", "与 -e 或 -p 配合时包含在线和离线 CPU。"]],
    examples: [["lscpu -J", "查看 JSON 格式的 CPU 摘要。"], ["lscpu -e=CPU,CORE,SOCKET,ONLINE", "查看逻辑 CPU、核心、插槽及在线状态。"]],
  },
  {
    name: "findmnt", category: "磁盘与归档", summary: "查询挂载点与文件系统", syntax: "findmnt [选项] [设备或挂载点]", source: manPage("util-linux", "findmnt", 8),
    options: [["-T, --target=PATH", "查找指定文件或目录所在的文件系统。"], ["-S, --source=SOURCE", "按设备或挂载源筛选。"], ["-t, --types=LIST", "按文件系统类型筛选。"], ["-o, --output=LIST", "指定输出列。"], ["-J, --json", "以 JSON 输出。"], ["--fstab", "读取 /etc/fstab 配置。"]],
    examples: [["findmnt -T /var/log", "查看日志目录所在的挂载文件系统。"], ["findmnt --fstab -t nfs,nfs4", "查看配置中的 NFS 挂载项。"]],
  },
  {
    name: "dmesg", category: "系统与环境", summary: "读取内核环形缓冲区日志", syntax: "dmesg [选项]", source: manPage("util-linux", "dmesg"),
    options: [["-H, --human", "使用便于阅读的格式和分页器。"], ["-T, --ctime", "显示可读时间戳，休眠恢复后可能不准确。"], ["-w, --follow", "持续等待新消息。"], ["-l, --level=LIST", "按日志级别筛选，例如 err,warn。"], ["--since=TIME", "仅显示给定时间之后的消息。"]],
    examples: [["dmesg --level=err,warn", "查看内核错误和警告。"], ["dmesg -w", "跟踪新的内核日志。"]],
    note: "系统的 dmesg_restrict 配置可能限制普通用户读取。",
  },
  {
    name: "ip", category: "网络与连接", summary: "查看网卡、地址与路由", syntax: "ip [选项] 对象 [操作]", source: manPage("iproute2", "ip", 8),
    options: [["-br, -brief", "紧凑显示地址或链路信息。"], ["-s, -stats", "显示更详细的统计。"], ["-4 / -6", "仅使用 IPv4 或 IPv6 地址族。"], ["-j, -json", "以 JSON 格式输出。"], ["address show", "列出接口地址。"], ["link show", "显示网络接口状态。"], ["route show", "列出路由表。"]],
    examples: [["ip -br address show", "紧凑查看各接口地址。"], ["ip -s link show", "查看接口收发包与错误统计。"], ["ip -4 route show", "查看 IPv4 路由。"]],
  },
  {
    name: "ping", category: "网络与连接", summary: "用 ICMP 探测连通性与时延", syntax: "ping [选项] 目标", source: manPage("iputils", "ping", 8),
    options: [["-c COUNT", "限制请求数量。"], ["-n", "使用数字输出，不反向解析名称。"], ["-i SECONDS", "指定发送间隔。"], ["-W SECONDS", "未收到任何响应时的等待超时；已有响应时行为不同。"], ["-w SECONDS", "设置整个探测的截止时长。"], ["-4 / -6", "使用 IPv4 或 IPv6。"]],
    examples: [["ping -n -c 4 -w 10 127.0.0.1", "用四个请求测试本机，最多十秒。"], ["ping -6 -c 4 ::1", "测试 IPv6 回环地址。"]],
    note: "这里采用 Linux iputils 语法；Windows 与 macOS 的参数含义可能不同。无响应也可能由 ICMP 过滤导致。",
  },
  {
    name: "dig", category: "网络与连接", summary: "查询 DNS 记录", syntax: "dig [@服务器] 域名 [类型] [选项]",
    source: { label: "ISC BIND dig 官方手册", url: "https://bind9.readthedocs.io/en/latest/manpages.html#dig-dns-lookup-utility" },
    options: [["@SERVER", "向指定 DNS 服务器查询。"], ["A / AAAA / MX / TXT / NS", "查询 IPv4、IPv6、邮件、文本、域名服务器记录。"], ["+short", "仅输出简洁结果。"], ["+noall +answer", "仅显示应答段。"], ["+tcp", "使用 TCP 查询。"], ["+time=N", "设置单次查询超时秒数。"], ["+tries=N", "设置 UDP 查询尝试次数。"]],
    examples: [["dig example.org A +short", "简洁查看 IPv4 地址记录。"], ["dig @1.1.1.1 example.org MX +noall +answer", "通过指定服务器查看邮件交换记录。"]],
  },
  {
    name: "scp", category: "网络与连接", summary: "通过 OpenSSH 复制文件", syntax: "scp [选项] 源… 目标",
    source: { label: "OpenSSH scp(1) 官方手册", url: "https://man.openbsd.org/scp.1" },
    options: [["-P PORT", "指定远端 SSH 端口，注意大写 P。"], ["-p", "保留修改时间、访问时间和权限位。"], ["-r", "递归复制目录。"], ["-i FILE", "指定身份密钥。"], ["-J DESTINATION", "通过跳板机连接。"], ["-l LIMIT", "限制带宽，单位为 Kbit/s。"]],
    examples: [["scp -P 2222 ./app.conf user@server.example:/tmp/", "上传文件到指定 SSH 端口。"], ["scp user@server.example:/var/log/app.log ./app.log", "将远端文件下载到本地。"]],
    note: "OpenSSH 9.0 起默认采用 SFTP 协议。-P 是端口，-p 是保留属性；递归时会跟随遇到的符号链接。",
  },
  {
    name: "sftp", category: "网络与连接", summary: "交互式安全文件传输", syntax: "sftp [选项] [用户@]主机",
    source: { label: "OpenSSH sftp(1) 官方手册", url: "https://man.openbsd.org/sftp.1" },
    options: [["-P PORT", "指定远端 SSH 端口。"], ["-i FILE", "指定身份密钥。"], ["-b BATCHFILE", "从文件读取批处理命令，通常需配置非交互认证。"], ["-J DESTINATION", "通过跳板机连接。"], ["get / put", "交互命令，下载或上传文件。"], ["reget / reput", "交互命令，续传下载或上传。"], ["lcd / lpwd", "交互命令，切换或显示本地目录。"]],
    examples: [["sftp -P 2222 user@server.example", "连接指定端口并进入交互界面。"], ["sftp -i ~/.ssh/id_ed25519 user@server.example", "使用指定密钥连接。"]],
    note: "续传假设本地和远端已有内容一致；不一致时可能得到损坏的文件。",
  },
  {
    name: "rsync", category: "网络与连接", summary: "增量同步文件与目录", syntax: "rsync [选项] 源… 目标",
    source: { label: "rsync 官方手册", url: "https://download.samba.org/pub/rsync/rsync.1" },
    options: [["-a, --archive", "归档模式，等价于 -rlptgoD，不含 ACL、扩展属性或硬链接保留。"], ["-v, --verbose", "显示处理信息。"], ["-n, --dry-run", "预览计划，不进行文件修改。"], ["-z, --compress", "传输时压缩数据。"], ["--progress", "显示每个文件的传输进度。"], ["--exclude=PATTERN", "排除匹配项。"], ["--delete", "删除接收端同步范围内多余的文件。"]],
    examples: [["rsync -avn ./project/ user@server.example:/srv/project/", "先预览目录内容同步计划。"], ["rsync -av --progress ./project/ user@server.example:/srv/project/", "同步目录内容并显示进度。"]],
    note: "源目录末尾 / 表示复制目录内容，否则包含目录自身。--delete 会删除接收端多余内容。",
  },

];

export function searchLinuxCommands(query: string, category = "all"): readonly LinuxCommand[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return LINUX_COMMANDS.filter((entry) => {
    if (category !== "all" && entry.category !== category) return false;
    const text = [entry.name, entry.category, entry.summary, entry.syntax, entry.note ?? "",
      ...entry.options.flat(), ...entry.examples.flat()].join(" ").toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
