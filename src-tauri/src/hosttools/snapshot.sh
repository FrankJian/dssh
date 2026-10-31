# Read-only POSIX sh probe. No sudo, temporary files, shell startup sourcing,
# process arguments or environment dumps. Failures stay local to each section.
LC_ALL=C
export LC_ALL
section() { printf '\n@@DSSH:%s\n' "$1"; }
section CPU_A
# guest/guest_nice are included in user/nice: the parser excludes them.
head -n 1 /proc/stat 2>/dev/null
# Let the one-second sample window overlap the other system probes. Only this
# shell owns the timer; it writes no data/files and opens no SSH channels.
sleep 1 >/dev/null 2>&1 &
snapshot_cpu_timer=$!
section HOST
hostname 2>/dev/null || uname -n 2>/dev/null
section OS
if [ -r /etc/os-release ]; then
  # Read as data, never source a remote release file as shell code.
  sed -n 's/^PRETTY_NAME=//p' /etc/os-release 2>/dev/null
else
  uname -s 2>/dev/null
  sw_vers -productVersion 2>/dev/null
fi
section KERNEL
uname -sr 2>/dev/null
section ARCH
uname -m 2>/dev/null
section UPTIME
cat /proc/uptime 2>/dev/null
section UP_TEXT
uptime 2>/dev/null
section CORES
getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null
section MODEL
awk -F ': ' '/^(model name|Hardware)[[:space:]]*:/ {print $2; exit}' /proc/cpuinfo 2>/dev/null || sysctl -n machdep.cpu.brand_string 2>/dev/null
section LOAD
cat /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null
section MEM
if ! cat /proc/meminfo 2>/dev/null; then
  section FREE
  free -k 2>/dev/null
fi
section PROCESSES
# One process snapshot, bounded-memory Top 5 rankings for both metrics.
(ps -axo pid=,pcpu=,pmem=,comm= 2>/dev/null || ps -eo pid=,pcpu=,pmem=,comm= 2>/dev/null) | awk '
function keep(kind, value, i, j) {
  for (i = 1; i <= 5; i++) {
    if (rows[kind,i] == "" || value > scores[kind,i]) {
      for (j = 5; j > i; j--) {
        scores[kind,j] = scores[kind,j-1]
        rows[kind,j] = rows[kind,j-1]
      }
      scores[kind,i] = value
      rows[kind,i] = $0
      break
    }
  }
}
$1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+([.][0-9]+)?$/ && $3 ~ /^[0-9]+([.][0-9]+)?$/ {
  keep("cpu", $2 + 0)
  keep("mem", $3 + 0)
}
END {
  for (i = 1; i <= 5; i++) if (rows["cpu",i] != "") print rows["cpu",i]
  for (i = 1; i <= 5; i++) if (rows["mem",i] != "") print rows["mem",i]
}'
section USERS
who 2>/dev/null
section IP
ip -o address show up 2>/dev/null || ifconfig 2>/dev/null || hostname -I 2>/dev/null
section SOCKETS
# Count only; no process ownership or command lines collected.
if sockets=$(ss -H -lntu 2>/dev/null); then
  printf '%s\n' "$sockets" | awk 'BEGIN {n=0} /^(tcp|udp)/ {n++} END {print n}'
fi
wait "$snapshot_cpu_timer" 2>/dev/null
section CPU_B
head -n 1 /proc/stat 2>/dev/null
section SYSTEM_END
