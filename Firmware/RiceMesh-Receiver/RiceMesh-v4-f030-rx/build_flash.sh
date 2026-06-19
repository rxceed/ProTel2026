#!/bin/bash

set -e

ELF_FILE="build/RiceMesh-v4-f030.elf"
OPENOCD_CFG="bluepill.cfg"

echo "Memulai proses build..."

if make; then
    echo -e "\n[SUKSES] Build berhasil."
else
    echo -e "\n[GAGAL] Build error. Proses flashing dibatalkan."
    exit 1
fi

if [ ! -f "$ELF_FILE" ]; then
    echo -e "\n[GAGAL] File ELF tidak ditemukan: $ELF_FILE"
    echo "Cek dengan: ls build/*.elf"
    exit 1
fi

echo -e "\nMemulai proses flashing ke STM32F103C8T6 Blue Pill..."

openocd -f "$OPENOCD_CFG" \
    -c "program $ELF_FILE verify reset exit" 

echo -e "\n[SELESAI] Build dan flashing berhasil."