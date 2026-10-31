# Read-only disk probe, isolated from CPU/system and Docker SSH channels.
LC_ALL=C
export LC_ALL
section() { printf '\n@@DSSH:%s\n' "$1"; }
# GNU df can return nonzero while still returning useful rows (e.g. one
# inaccessible mount). Keep those rows; invoke the portable form only if the
# typed form produced no usable table. No remote temporary files are needed.
section DISK_TYPED
disks=$(df -a -P -k -T 2>/dev/null)
case "$disks" in
  Filesystem*'
'*) printf '%s\n' "$disks" ;;
  *)
    section DISK
    df -a -P -k 2>/dev/null || df -P -k 2>/dev/null
    section MOUNTS
    mount 2>/dev/null
    ;;
esac
section DISK_END
