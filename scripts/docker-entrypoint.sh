#!/bin/sh
# Container entrypoint: sizes libuv's thread pool, then runs the given command.
#
# Password hashing (scrypt) runs on that pool (4 threads by default), so it caps how
# many logins are hashed at once. We size it to the CPUs this container may actually
# use — the cgroup CPU quota (Docker --cpus, Kubernetes limits), not the host's core
# count — with a floor of 4 and a ceiling of 32. Each in-flight hash uses ~32 MiB,
# so this also bounds peak memory. An explicit UV_THREADPOOL_SIZE always wins.
set -eu

cgroup="${CGROUP_ROOT:-/sys/fs/cgroup}"
cpus=$(nproc)

if [ -r "$cgroup/cpu.max" ]; then # cgroup v2
  read -r quota period < "$cgroup/cpu.max"
  if [ "$quota" != "max" ] && [ "$period" -gt 0 ]; then
    cpus=$(((quota + period - 1) / period))
  fi
elif [ -r "$cgroup/cpu/cpu.cfs_quota_us" ]; then # cgroup v1
  quota=$(cat "$cgroup/cpu/cpu.cfs_quota_us")
  period=$(cat "$cgroup/cpu/cpu.cfs_period_us")
  if [ "$quota" -gt 0 ] && [ "$period" -gt 0 ]; then
    cpus=$(((quota + period - 1) / period))
  fi
fi

if [ "$cpus" -lt 4 ]; then cpus=4; fi
if [ "$cpus" -gt 32 ]; then cpus=32; fi
export UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-$cpus}"

exec "$@"
