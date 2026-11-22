#!/usr/bin/env bash
# 1 Hz monitor for per-core CPU frequency, EPP, and amd_pstate during idle and load.
# Usage:
#   ./scripts/sysmon.sh --phase idle --duration 5 --out /tmp/sysmon.jsonl
#   ./scripts/sysmon.sh --phase bench_gpu --out /tmp/sysmon.jsonl

set -u

OUT_FILE=""
INTERVAL=1
DURATION=0
PHASE="default"
QUIET=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --out)
      OUT_FILE="$2"
      shift 2
      ;;
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    --duration)
      DURATION="$2"
      shift 2
      ;;
    --phase)
      PHASE="$2"
      shift 2
      ;;
    --quiet)
      QUIET=1
      shift
      ;;
    -h|--help)
      echo "Uso: $0 [--out PATH] [--interval SEC] [--duration SEC] [--phase LABEL] [--quiet]"
      exit 0
      ;;
    *)
      echo "Argumento desconocido: $1" >&2
      exit 2
      ;;
  esac
done

RUNNING=1
trap 'RUNNING=0' INT TERM

read_or_na() {
  local path="$1"
  local val=""
  if [ -r "$path" ]; then
    IFS= read -r val < "$path" || val=""
  fi
  if [ -n "$val" ]; then
    printf '%s' "$val"
  else
    printf 'N/A'
  fi
}

# Discover k10temp sensor dynamically (hwmon indices can change across boots)
K10TEMP_INPUT=""
for hw in /sys/class/hwmon/hwmon*; do
  if [ -r "$hw/name" ]; then
    IFS= read -r hw_name < "$hw/name" || hw_name=""
    if [ "$hw_name" = "k10temp" ] && [ -r "$hw/temp1_input" ]; then
      K10TEMP_INPUT="$hw/temp1_input"
      break
    fi
  fi
done

CPU_DIRS=()
for idx in $(seq 0 127); do
  if [ -d "/sys/devices/system/cpu/cpu${idx}/cpufreq" ]; then
    CPU_DIRS+=("/sys/devices/system/cpu/cpu${idx}/cpufreq")
  else
    break
  fi
done

if [ -n "$OUT_FILE" ]; then
  mkdir -p "$(dirname "$OUT_FILE")"
  : > "$OUT_FILE"
fi

START_EPOCH=$(date +%s)
COUNT=0

while [ "$RUNNING" -eq 1 ]; do
  NOW_ISO=$(date -Iseconds)
  NOW_EPOCH=$(date +%s)
  ELAPSED=$((NOW_EPOCH - START_EPOCH))

  AMD_PSTATE=$(read_or_na "/sys/devices/system/cpu/amd_pstate/status")
  DRIVER=$(read_or_na "/sys/devices/system/cpu/cpu0/cpufreq/scaling_driver")
  GOVERNOR=$(read_or_na "/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor")
  ACAD_ONLINE=$(read_or_na "/sys/class/power_supply/ACAD/online")

  CPUINFO_MAX_KHZ=$(read_or_na "/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq")
  [ "$CPUINFO_MAX_KHZ" = "N/A" ] && CPUINFO_MAX_KHZ="null"
  CPUINFO_MIN_KHZ=$(read_or_na "/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_min_freq")
  [ "$CPUINFO_MIN_KHZ" = "N/A" ] && CPUINFO_MIN_KHZ="null"
  SCALING_MAX_KHZ=$(read_or_na "/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq")
  [ "$SCALING_MAX_KHZ" = "N/A" ] && SCALING_MAX_KHZ="null"
  BASE_FREQ_KHZ=$(read_or_na "/sys/devices/system/cpu/cpu0/cpufreq/base_frequency")
  [ "$BASE_FREQ_KHZ" = "N/A" ] && BASE_FREQ_KHZ="null"
  AMD_PSTATE_MAX_KHZ=$(read_or_na "/sys/devices/system/cpu/cpu0/cpufreq/amd_pstate_max_freq")
  [ "$AMD_PSTATE_MAX_KHZ" = "N/A" ] && AMD_PSTATE_MAX_KHZ="null"
  BOOST_STATE=$(read_or_na "/sys/devices/system/cpu/cpufreq/boost")
  [ "$BOOST_STATE" = "N/A" ] && BOOST_STATE="null"

  BAT_DIR=""
  for bdir in /sys/class/power_supply/BAT*; do
    if [ -d "$bdir" ]; then
      BAT_DIR="$bdir"
      break
    fi
  done
  BAT_STATUS="N/A"
  BAT_CAPACITY="null"
  BAT_POWER_UW="null"
  if [ -n "$BAT_DIR" ]; then
    BAT_STATUS=$(read_or_na "$BAT_DIR/status")
    BAT_CAPACITY=$(read_or_na "$BAT_DIR/capacity")
    [ "$BAT_CAPACITY" = "N/A" ] && BAT_CAPACITY="null"
    BAT_POWER_UW=$(read_or_na "$BAT_DIR/power_now")
    [ "$BAT_POWER_UW" = "N/A" ] && BAT_POWER_UW="null"
  fi

  TEMP_C="null"
  if [ -n "$K10TEMP_INPUT" ]; then
    TEMP_MC=$(read_or_na "$K10TEMP_INPUT")
    if [ "$TEMP_MC" != "N/A" ]; then
      TEMP_C=$((TEMP_MC / 1000))
    fi
  fi

  FREQS_JSON=""
  EPPS_JSON=""
  MIN_KHZ=999999999
  MAX_KHZ=0
  SUM_KHZ=0
  N_CPUS=0

  for cdir in "${CPU_DIRS[@]}"; do
    fkhz=$(read_or_na "$cdir/scaling_cur_freq")
    epp=$(read_or_na "$cdir/energy_performance_preference")
    if [ "$fkhz" = "N/A" ]; then
      fkhz=0
    fi
    if [ "$N_CPUS" -gt 0 ]; then
      FREQS_JSON="${FREQS_JSON},"
      EPPS_JSON="${EPPS_JSON},"
    fi
    FREQS_JSON="${FREQS_JSON}${fkhz}"
    EPPS_JSON="${EPPS_JSON}\"${epp}\""
    if [ "$fkhz" -lt "$MIN_KHZ" ]; then MIN_KHZ="$fkhz"; fi
    if [ "$fkhz" -gt "$MAX_KHZ" ]; then MAX_KHZ="$fkhz"; fi
    SUM_KHZ=$((SUM_KHZ + fkhz))
    N_CPUS=$((N_CPUS + 1))
  done

  MEAN_MHZ=0
  MIN_MHZ=0
  MAX_MHZ=0
  if [ "$N_CPUS" -gt 0 ]; then
    MEAN_MHZ=$(((SUM_KHZ / N_CPUS) / 1000))
    MIN_MHZ=$((MIN_KHZ / 1000))
    MAX_MHZ=$((MAX_KHZ / 1000))
  fi

  LINE="{\"ts\":\"${NOW_ISO}\",\"elapsed_s\":${ELAPSED},\"phase\":\"${PHASE}\",\"amd_pstate\":\"${AMD_PSTATE}\",\"driver\":\"${DRIVER}\",\"governor\":\"${GOVERNOR}\",\"acad_online\":\"${ACAD_ONLINE}\",\"battery_status\":\"${BAT_STATUS}\",\"battery_capacity_pct\":${BAT_CAPACITY},\"battery_power_uw\":${BAT_POWER_UW},\"cpuinfo_max_freq_khz\":${CPUINFO_MAX_KHZ},\"cpuinfo_min_freq_khz\":${CPUINFO_MIN_KHZ},\"base_freq_khz\":${BASE_FREQ_KHZ},\"scaling_max_freq_khz\":${SCALING_MAX_KHZ},\"amd_pstate_max_freq_khz\":${AMD_PSTATE_MAX_KHZ},\"boost\":${BOOST_STATE},\"k10temp_c\":${TEMP_C},\"min_mhz\":${MIN_MHZ},\"mean_mhz\":${MEAN_MHZ},\"max_mhz\":${MAX_MHZ},\"freqs_khz\":[${FREQS_JSON}],\"epp\":[${EPPS_JSON}]}"

  if [ -n "$OUT_FILE" ]; then
    printf '%s\n' "$LINE" >> "$OUT_FILE"
  fi
  if [ "$QUIET" -eq 0 ] || [ -z "$OUT_FILE" ]; then
    printf '%s\n' "$LINE"
  fi

  COUNT=$((COUNT + 1))
  if [ "$DURATION" -gt 0 ] && [ "$COUNT" -ge "$DURATION" ]; then
    break
  fi
  sleep "$INTERVAL"
done
