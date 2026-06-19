# RiceMesh Firmware — Dokumentasi Teknis

**Proyek:** ProTel 2026 — RiceMesh Jaringan Sensor Nirkabel  
**Terakhir diperbarui:** 2026-06-15

---

## Gambaran Umum

RiceMesh adalah sistem monitoring jarak dan kondisi lingkungan berbasis banyak node secara nirkabel. Cara kerjanya cukup sederhana: tiga node pengirim STM32 masing-masing baca sensor ultrasonik HC-SR04, lalu kirim hasilnya lewat radio nRF24L01+. Node keempat (penerima) tampung data dari ketiga node tadi, gabungkan dengan pembacaan suhu dan tekanan dari sensor BMP280, terus kirim hasilnya dalam format JSON via UART ke ESP8266. Si ESP8266 inilah yang tugasnya forward ke broker MQTT sekaligus nyediain halaman status HTTP buat monitoring lokal.

---

## Arsitektur Sistem

```
┌─────────────────────┐          ┌──────────────────────────────────────┐
│  Node-1             │          │  Penerima (RiceMesh-v4-f030-rx)      │
│  STM32F030C8T6      │──RF──►   │  STM32F030C8T6                       │
│  HC-SR04 + nRF24    │          │  nRF24 (3 pipe) + BMP280 (I2C)       │
└─────────────────────┘          │                                      │
                                 │  Gabungkan data jarak 3 node         │
┌─────────────────────┐          │  + suhu/tekanan tiap 1 detik         │
│  Node-2             │──RF──►   │                                      │
│  STM32F103C8T6      │          │  Kirim JSON via UART 115200          │
│  HC-SR04 + nRF24    │          └────────────────┬─────────────────────┘
└─────────────────────┘                           │ UART TX
                                                  ▼
┌─────────────────────┐          ┌──────────────────────────────────────┐
│  Node-3             │──RF──►   │  Gateway MQTT (ricemesh-data-show)   │
│  STM32F103C8T6      │          │  ESP8266 NodeMCU (PlatformIO)        │
│  HC-SR04 + nRF24    │          │  • Publish JSON ke broker MQTT       │
└─────────────────────┘          │  • Monitor HTTP di port 80           │
                                 └──────────────────────────────────────┘
```

---

## Struktur Folder

```
Firmware/
├── RiceMesh-Transmitter/
│   ├── RiceMesh-Node-1/        # STM32F030C8T6, nRF24 pipe 1
│   ├── RiceMesh-Node-2/        # STM32F103C8T6, nRF24 pipe 2
│   └── RiceMesh-Node-3/        # STM32F103C8T6, nRF24 pipe 3
├── RiceMesh-Receiver/
│   └── RiceMesh-v4-f030-rx/    # STM32F030C8T6, 3-pipe RX + BMP280
└── MQTT-Transmitter/
    └── ricemesh-data-show/     # ESP8266 NodeMCU, PlatformIO/Arduino
```

---

## Komponen 1 — Node Pengirim (Transmitter)

### Perangkat Keras

| Node   | MCU           | Bentuk    | Sensor  | Radio     |
|--------|---------------|-----------|---------|-----------|
| Node-1 | STM32F030C8T6 | LQFP48    | HC-SR04 | nRF24L01+ |
| Node-2 | STM32F103C8T6 | Blue Pill | HC-SR04 | nRF24L01+ |
| Node-3 | STM32F103C8T6 | Blue Pill | HC-SR04 | nRF24L01+ |

### Peta Pin (ketiga node pakai layout yang sama)

| Pin    | Fungsi                                                       |
|--------|--------------------------------------------------------------|
| PA3    | nRF24 CSN (chip-select SPI, output)                         |
| PA4    | nRF24 CE  (chip-enable, output)                             |
| PA5    | SPI1 SCK                                                     |
| PA6    | SPI1 MISO                                                    |
| PA7    | SPI1 MOSI                                                    |
| PA8    | TIM1 CH1 input-capture — ECHO HC-SR04                       |
| PA9/10 | USART1 TX/RX (38400 atau 115200, belum dipakai di aplikasi) |
| PA0    | Input EXTI0 falling-edge (handler belum diisi)              |
| PB1    | TRIG HC-SR04 (output, makro `TRIG_Pin`)                     |
| PB5    | LED indikator kirim berhasil                                |

### Konfigurasi Clock

- **Node-1 (F030):** HSI 8 MHz → PLL ×4 (input HSI/2) → SYSCLK = **16 MHz**, `FLASH_LATENCY_0`
- **Node-2/3 (F103):** HSI 8 MHz → PLL ×4 → SYSCLK = **16 MHz**, semua bus ÷1

### TIM1 — Timer Bersama 1 MHz

TIM1 dipakai bareng oleh tiga subsistem, jadi **tidak boleh jalan bersamaan**:

1. Pengukuran echo HC-SR04 (interupsi input-capture)
2. Fungsi `delay()` busy-wait di `main.c`
3. Fungsi `delay_us()` di dalam driver nRF24

**Target frekuensi:** 1 µs per tick (1 MHz). Rumusnya: `Prescaler = (SYSCLK / 1.000.000) - 1`.

> **Heads up — bug prescaler aktif:** Kode yang di-generate CubeMX/Makefile saat ini set `Prescaler = 47`, yang cocoknya buat clock 48 MHz. Karena SYSCLK kita cuma 16 MHz, tick aktualnya jadi ~333 kHz alias 3 µs per tick. Efeknya, semua pembacaan jarak dan timing CE radio **meleset sekitar 3×**. Solusinya: ubah ke `Prescaler = 15`, atau naikkan PLL ke 48 MHz (`PLLMUL12`, `FLASH_LATENCY_1`).

### Alur Loop Aplikasi (Pengirim)

```
loop tiap ~1,5 detik:
  HCSR04_Read()          → pulsa TRIG 10 µs, aktifkan interupsi TIM1 CC1
  HAL_Delay(60)          → tunggu capture echo kelar
  snprintf("N<x> d:%u")  → masukkan selisih tick ke buffer 32 byte
  nrf24_transmit()       → kirim via radio
  kalau berhasil: kedipkan LED PB5 selama 100 ms
  HAL_Delay(1000)
```

**Format payload:** `"N1 d:<nilai>"`, `"N2 d:<nilai>"`, `"N3 d:<nilai>"` — `<nilai>` adalah `Difference` mentah dalam satuan tick timer, belum dikonversi ke cm. Konversinya dilakukan di sisi penerima.

> **Catatan:** Variabel lokal `Distance = Difference * 0.034 / 2` memang dihitung, tapi bertipe `uint8_t` — jadi akan overflow diam-diam kalau jarak lebih dari 255 cm. Yang dikirim ke radio adalah `Difference` mentah (uint32_t), jadi data yang diterima tetap aman.

### Konfigurasi Radio nRF24 (Pengirim)

| Parameter       | Nilai                  |
|-----------------|------------------------|
| Channel         | 90                     |
| Data rate       | 1 Mbps                 |
| Daya TX         | 0 dBm                  |
| Ukuran payload  | 32 byte (fixed)        |
| Auto-ACK        | Aktif (semua pipe)     |
| Auto-retransmit | Delay 4, batas 10 kali |
| CRC             | Nonaktif               |
| Lebar alamat    | 5 byte                 |

Alamat pipe TX tiap node:

| Node   | Alamat (hex)     |
|--------|------------------|
| Node-1 | `AA 44 33 22 11` |
| Node-2 | `BB 44 33 22 11` |
| Node-3 | `CC 44 33 22 11` |

### Build & Flash (Pengirim)

Pastikan `arm-none-eabi-gcc` sudah ada di `PATH` dan `openocd` dengan ST-Link sudah terpasang.

```bash
# Kompilasi
make

# Kompilasi + flash sekaligus via ST-Link
./build_flash.sh

# Flash manual kalau mau
openocd -f bluepill.cfg -c "program build/RiceMesh-v2.elf verify reset exit"
# Node-1 pakai: build/RiceMesh-v4-f030.elf

# Bersihin hasil build
make clean
```

Hasil build ada di: `build/RiceMesh-v*.{elf,hex,bin}`

Mode debug selalu aktif (`DEBUG=1`, `-Og -g -gdwarf-2`). Belum ada target release.

**CPUTAPID di `bluepill.cfg`:**
- Node-1 (F030): `0x0bb11477`
- Node-2/3 (F103 klon): `0x2ba01477` — jangan diubah kalau tidak pakai STM32 original

### Batas Kode Generasi CubeMX

File `*.ioc` yang ngatur konfigurasi peripheral. Kalau CubeMX dijalankan ulang, dia akan **overwrite** semua isi `Core/`, `Drivers/STM32Fxxx_HAL_Driver/`, `Drivers/CMSIS/`, `Makefile`, `*.ld`, dan `startup_*.s`. Makanya semua kode yang ditulis manual harus selalu berada di antara marker `/* USER CODE BEGIN x */` dan `/* USER CODE END x */`.

Folder `Drivers/nRF24/` tidak ikut dikelola CubeMX, jadi bebas diedit — tapi file `.c`-nya tetap harus didaftarkan di `C_SOURCES` dalam Makefile supaya ikut dikompilasi.

> **Peringatan — drift .ioc aktif (Node-1 & Penerima):** File `.ioc` sudah diupdate untuk assign PA8 ke `TIM1_CH1` input-capture, tapi CubeMX belum pernah dijalankan ulang. Akibatnya, `MX_GPIO_Init` nge-refer ke makro `ECHO_Pin`/`ECHO_GPIO_Port` yang tidak terdefinisi di mana pun — build pasti gagal. Cara fix: regenerate dari CubeMX, atau tambahkan definisi makro yang hilang plus panggil `HAL_TIM_IC_ConfigChannel` secara manual.

---

## Komponen 2 — Penerima (RiceMesh-v4-f030-rx)

### Perangkat Keras

| Item   | Detail                         |
|--------|--------------------------------|
| MCU    | STM32F030C8T6 (LQFP48)        |
| Radio  | nRF24L01+ via SPI1             |
| Sensor | BMP280 via I2C1 (alamat 0x76) |
| UART   | USART1 115200 8N1 → ESP8266   |

### Peta Pin

| Pin    | Fungsi                                              |
|--------|-----------------------------------------------------|
| PA3    | nRF24 CSN                                           |
| PA4    | nRF24 CE                                            |
| PA5-7  | SPI1 SCK/MISO/MOSI                                  |
| PA8    | TIM1 CH1 input-capture (echo HC-SR04, kalau dipakai) |
| PA9/10 | USART1 TX/RX → ESP8266                              |
| PB1    | TRIG HC-SR04                                        |
| PB5    | LED indikator data diterima                         |
| PB6/7  | I2C1 SCL/SDA → BMP280                              |

### Alur Loop Aplikasi (Penerima)

Penerima jalan dalam super-loop non-blocking dengan dua tugas yang independen:

**Tugas 1 — Terima data radio (jalan tiap iterasi, tanpa delay):**
```c
nrf24_listen();
if (nrf24_data_available()) {
    nrf24_receive(data_R, 32);
    sscanf(data_R, "N%u d:%u", &node_id, &dist);
    nodes[node_id-1].distance = dist;
    nodes[node_id-1].valid = 1;
    kedipkan LED PB5 selama 20 ms;
}
```

**Tugas 2 — Kirim JSON tiap 1 detik (pakai `HAL_GetTick()`, tidak blocking):**
```c
BMP280_Read_Raw(&temp_raw, &press_raw);
// kompensasi → real_temp (°C ×100), real_press (Pa ×256)
// susun string JSON
HAL_UART_Transmit(&huart1, json, len, HAL_MAX_DELAY);
```

### Format Output JSON

Dikirim sekali per detik via USART1 pada 115200 baud, diakhiri `\n`:

```json
{"device":[
  {"d":1234,"temperature":"29.63","pressure":"1006.53"},
  {"d":null,"temperature":"29.63","pressure":"1006.53"},
  {"d":987, "temperature":"29.63","pressure":"1006.53"}
]}
```

- `d` adalah selisih tick timer mentah dari node pengirim. Kalau node belum pernah kirim data, nilainya `null`.
- `temperature` satuannya °C; `pressure` satuannya hPa.
- Kalau BMP280 gagal dibaca, kedua field jadi `null` (JSON tetap valid, data jarak tidak hilang).

### Konfigurasi Radio nRF24 (Penerima)

Sama persis dengan pengirim (channel 90, 1 Mbps, 0 dBm), tapi dikonfigurasi dalam mode listen. Tiga pipe RX dibuka:

| Pipe | Alamat           | Node |
|------|------------------|------|
| 1    | `AA 44 33 22 11` | N1   |
| 2    | `BB 44 33 22 11` | N2   |
| 3    | `CC 44 33 22 11` | N3   |

### Driver BMP280

Filenya ada di `Drivers/BMP280/bmp280.{c,h}`. Komunikasi lewat `hi2c1` ke alamat I2C `0x76`. Fungsi yang tersedia:

- `BMP280_Init(hi2c)` — baca koefisien kalibrasi dari OTP sensor
- `BMP280_Read_Raw(&rawTemp, &rawPress)` — baca register ADC secara burst
- `BMP280_Compensate_T(adc_t)` → `int32_t`, satuan 0,01 °C
- `BMP280_Compensate_P(adc_p)` → `uint32_t`, satuan Pa/256

### Build & Flash (Penerima)

```bash
make
./build_flash.sh
# atau manual:
openocd -f bluepill.cfg -c "program build/RiceMesh-v4-f030.elf verify reset exit"
```

Toolchain yang dibutuhkan sama dengan node pengirim. CPUTAPID di `bluepill.cfg`: `0x0bb11477`.

---

## Komponen 3 — Gateway MQTT (ricemesh-data-show)

### Perangkat Keras

| Item      | Detail                               |
|-----------|--------------------------------------|
| Platform  | ESP8266 NodeMCU                      |
| Framework | Arduino (PlatformIO)                 |
| UART RX   | Dari penerima STM32 pada 115200 baud |
| Jaringan  | WiFi mode STA                        |

### Gambaran Firmware

**Target PlatformIO:** `[env:nodemcu]`, board `nodemcu`, platform `espressif8266`.

**Library yang dipakai:**
- `knolleary/PubSubClient ^2.8` — klien MQTT
- `bblanchon/ArduinoJson ^7.0.4` — parsing JSON

### Alur Data

```
STM32 UART TX → ESP8266 Serial RX
    │
    ▼ readSTM32Serial() — baca sampai karakter '\n'
    │
    ▼ processIncomingLine()
        ├── isLikelyJson() — cek cepat: diawali '{', diakhiri '}'
        ├── deserializeJson() — parse pakai ArduinoJson
        └── kalau valid:
              publishPayload()       → MQTT topic_awd1_67
              publishParsedTopics()  → sub-topik per sensor
```

### Topik MQTT

| Topik                                      | Isi                                 |
|--------------------------------------------|-------------------------------------|
| `topic_awd1_67`                            | Payload JSON lengkap (string mentah) |
| `topic_awd1_67/sensors/N1/d`               | Jarak dari Node 1                   |
| `topic_awd1_67/sensors/N2/d`               | Jarak dari Node 2                   |
| `topic_awd1_67/sensors/N3/d`               | Jarak dari Node 3                   |
| `topic_awd1_67/sensors/bmp280/temperature` | Suhu (°C)                           |
| `topic_awd1_67/sensors/bmp280/pressure`    | Tekanan (hPa)                       |
| `topic_awd1_67/status`                     | `esp8266-gateway-online` (retained) |

Broker default: `10.58.34.24:1883` tanpa autentikasi. Ganti `MQTT_BROKER` di `src/main.cpp` kalau alamatnya beda.

### Endpoint HTTP

Jalan di port 80, auto-refresh tiap 2 detik:

| Endpoint  | Keterangan                                                    |
|-----------|---------------------------------------------------------------|
| `/`       | Dashboard HTML — status WiFi/MQTT, JSON terakhir, statistik  |
| `/json`   | Payload JSON terbaru dalam format `application/json`          |
| `/status` | JSON info kesehatan gateway (wifi, ip, mqtt, jumlah publish)  |

### Build & Flash (ESP8266)

```bash
# Pastikan PlatformIO CLI sudah terinstal
cd MQTT-Transmitter/ricemesh-data-show
pio run                    # kompilasi
pio run --target upload    # flash ke board
pio device monitor         # buka serial monitor di 115200
```

Kredensial WiFi dan alamat broker dikodekan langsung di `src/main.cpp` — pastikan diupdate sebelum flash:

```cpp
const char* WIFI_SSID   = "RXHSPT";
const char* WIFI_PASS   = "yayayasayasetuju";
const char* MQTT_BROKER = "10.58.34.24";
```

---

## Masalah yang Diketahui & Keterbatasan

| # | Lokasi | Masalah |
|---|--------|---------|
| 1 | Semua node | **Prescaler TIM1 salah:** `Prescaler=47` cocoknya buat 48 MHz, padahal SYSCLK cuma 16 MHz → tick jadi 3 µs, bukan 1 µs. Semua pembacaan jarak dan timing CE radio meleset ~3×. Fix: set `Prescaler=15`. |
| 2 | Node-1 / Penerima | **Drift .ioc:** PA8 sudah diganti di `.ioc` tapi CubeMX belum di-regenerate. Makro `ECHO_Pin` tidak terdefinisi → build gagal. Tambah makro manual atau regenerate dari CubeMX. |
| 3 | Node-1 | **Tidak ada timeout echo HC-SR04:** kalau echo tidak pernah datang, `HAL_TIM_IC_CaptureCallback` tidak pernah dipanggil dan `Is_First_Captured` stuck di 1, bikin pengukuran berikutnya tidak jalan. |
| 4 | Semua pengirim | **`Distance` bertipe `uint8_t`:** overflow diam-diam di atas 255 cm, padahal HC-SR04 bisa sampai ~400 cm. Ganti ke `uint16_t` atau kirim langsung nilai `Difference` mentah. |
| 5 | Semua STM32 | **`Error_Handler` cuma spin forever** tanpa output diagnostik sama sekali. USART1 sudah diinisialisasi, tapi `printf` belum diarahkan ke sana. |
| 6 | Gateway ESP8266 | **Kredensial dikodekan langsung** di source. Kalau mau deploy ke produksi, pindahkan ke config header terpisah atau NVS. |

---

## Persyaratan Toolchain

| Alat                | Kegunaan                        | Versi minimum |
|---------------------|---------------------------------|---------------|
| `arm-none-eabi-gcc` | Kompilasi firmware STM32        | 10.x          |
| `arm-none-eabi-*`   | Binutils (objcopy, size, dll.)  | Sesuai GCC    |
| `openocd`           | Flash via ST-Link               | 0.11+         |
| Dongle ST-Link V2   | Programmer SWD                  | —             |
| STM32CubeMX 6.16.1  | Regenerasi kode dari .ioc       | 6.16.1        |
| PlatformIO CLI      | Build & flash ESP8266           | 6.x           |

---

## Checklist Mulai Cepat

1. **Build semua node pengirim:**
   ```bash
   cd RiceMesh-Transmitter/RiceMesh-Node-1 && make
   cd ../RiceMesh-Node-2 && make
   cd ../RiceMesh-Node-3 && make
   ```
2. **Perbaiki prescaler TIM1** di fungsi `MX_TIM1_Init` masing-masing node — ubah `Prescaler = 47` jadi `Prescaler = 15`.
3. **Build dan flash penerima:**
   ```bash
   cd RiceMesh-Receiver/RiceMesh-v4-f030-rx && make && ./build_flash.sh
   ```
4. **Sambungkan UART TX penerima (PA9) ke RX ESP8266** pada 115200 baud. Jangan lupa ground-nya ikut disambung.
5. **Update konfigurasi WiFi/MQTT** di `MQTT-Transmitter/ricemesh-data-show/src/main.cpp`.
6. **Flash ESP8266:**
   ```bash
   cd MQTT-Transmitter/ricemesh-data-show && pio run --target upload
   ```
7. **Cek hasilnya** — buka `http://<ip-esp8266>/` di browser, pastikan payload JSON muncul dan counter publish MQTT terus naik.
