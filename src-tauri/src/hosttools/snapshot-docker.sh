# Optional local Docker probe, independently bounded by the SSH exec runner.
# Only allowlisted fields: no inspect, logs, env, labels or command arguments.
LC_ALL=C
export LC_ALL
section() { printf '\n@@DSSH:%s\n' "$1"; }
section DOCKER_STATUS
if ! command -v docker >/dev/null 2>&1; then
  printf 'not_installed\n'
  exit 0
fi
printf 'checking\n'
# Do not silently report a different machine selected by a Docker context.
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
endpoint=unix:///var/run/docker.sock
if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -S "$XDG_RUNTIME_DIR/docker.sock" ]; then
  endpoint="unix://$XDG_RUNTIME_DIR/docker.sock"
elif [ -n "${HOME:-}" ] && [ -S "$HOME/.docker/run/docker.sock" ]; then
  endpoint="unix://$HOME/.docker/run/docker.sock"
fi
docker_local() { docker --host "$endpoint" "$@"; }
if info=$(docker_local info --format '{"version":{{json .ServerVersion}},"total":{{.Containers}},"running":{{.ContainersRunning}},"paused":{{.ContainersPaused}},"stopped":{{.ContainersStopped}},"images":{{.Images}},"driver":{{json .Driver}}}' 2>/dev/null); then
  section DOCKER_STATUS
  printf 'running\n'
  section DOCKER_INFO
  printf '%s\n' "$info"
  section DOCKER_CONTAINERS
  if ! docker_local ps -a --format '{"id":{{json .ID}},"name":{{json .Names}},"image":{{json .Image}},"state":{{json .State}},"status":{{json .Status}},"ports":{{json .Ports}}}' 2>/dev/null; then
    section DOCKER_WARNING
    printf '容器列表不可用。\n'
  fi
  section DOCKER_STATS
  if ! docker_local stats --no-stream --format '{"id":{{json .ID}},"cpu":{{json .CPUPerc}},"memory":{{json .MemUsage}},"memoryPercent":{{json .MemPerc}},"network":{{json .NetIO}},"block":{{json .BlockIO}},"pids":{{json .PIDs}}}' 2>/dev/null; then
    section DOCKER_WARNING
    printf '容器资源统计不可用。\n'
  fi
else
  section DOCKER_STATUS
  printf 'unavailable\n'
fi
section DOCKER_END
