# RiceMesh Firmware — Dokumentasi Teknis

**Proyek:** ProTel 2026 — RiceMesh Jaringan Sensor Nirkabel  
**Terakhir diperbarui:** 2026-06-27

---

## Gambaran Umum

RiceMesh adalah sistem monitoring jarak dan kondisi lingkungan berbasis banyak node secara nirkabel. Cara kerjanya: tiga node pengirim STM32 masing-masing membaca sensor ultrasonik HC-SR04, lalu mengirim hasilnya lewat radio nRF24L01+. Node keempat (penerima) menampung data dari ketiga node tadi, menggabungkannya dengan pembacaan suhu dan tekanan dari sensor BMP280, lalu mengirim hasilnya dalam format JSON via UART ke ESP8266. ESP8266 inilah yang bertugas mem-forward ke broker MQTT sekaligus menyediakan halaman status HTTP untuk monitoring lokal.

Demi hemat daya, **tiap node pengirim hidup hanya sebentar lalu tidur 5 menit** (STOP mode dengan RTC alarm), sedangkan **penerima berjalan terus-menerus** (selalu mendengarkan radio dan menerbitkan JSON tiap 1 detik).

---

## Arsitektur Sistem

```
┌─────────────────────┐          ┌──────────────────────────────────────┐
│  Node1              │          │  Penerima (RiceMesh-v4-f030-rx)      │
│  STM32F103C8T6      │──RF──►   │  STM32F030C8T6                       │
│  HC-SR04 + nRF24    │          │  nRF24 (3 pipe) + BMP280 (I2C)       │
└─────────────────────┘          │                                      │
                                 │  Gabungkan data jarak 3 node         │
┌─────────────────────┐          │  + suhu/tekanan tiap 1 detik         │
│  Node2              │──RF──►   │                                      │
│  STM32F103C8T6      │          │  Kirim JSON via UART 115200          │
│  HC-SR04 + nRF24    │          └────────────────┬─────────────────────┘
└─────────────────────┘                           │ UART TX (PA9)
                                                  ▼
┌─────────────────────┐          ┌──────────────────────────────────────┐
│  Node3              │──RF──►   │  Gateway MQTT (ricemesh-data-show)   │
│  STM32F103C8T6      │          │  ESP8266 NodeMCU (PlatformIO)        │
│  HC-SR04 + nRF24    │          │  • Publish JSON ke broker MQTT       │
└─────────────────────┘          │  • Monitor HTTP di port 80           │
                                 └──────────────────────────────────────┘
```

> **Catatan penting:** Ketiga node pengirim memakai MCU yang **sama** (STM32F103C8T6 / Blue Pill) dan menjalankan **firmware identik**. Perbedaannya hanya tiga: nomor `PIPE`, alamat TX, dan label node di payload (`N1`/`N2`/`N3`). Hanya **penerima** yang memakai STM32F030C8T6.

---

## Struktur Folder

```
Firmware/
├── RiceMesh-Transmitter/
│   ├── RiceMesh-Node1/         # STM32F103C8T6, nRF24 pipe 1, label "N1"
│   ├── RiceMesh-Node2/         # STM32F103C8T6, nRF24 pipe 2, label "N2"
│   └── RiceMesh-Node3/         # STM32F103C8T6, nRF24 pipe 3, label "N3"
├── RiceMesh-Receiver/
│   └── RiceMesh-v4-f030-rx/    # STM32F030C8T6, 3-pipe RX + BMP280
└── MQTT-Transmitter/
    └── ricemesh-data-show/     # ESP8266 NodeMCU, PlatformIO/Arduino
```

---

## Komponen 1 — Node Pengirim (Transmitter)

### Perangkat Keras

| Node  | MCU           | Bentuk    | Sensor  | Radio     |
|-------|---------------|-----------|---------|-----------|
| Node1 | STM32F103C8T6 | Blue Pill | HC-SR04 | nRF24L01+ |
| Node2 | STM32F103C8T6 | Blue Pill | HC-SR04 | nRF24L01+ |
| Node3 | STM32F103C8T6 | Blue Pill | HC-SR04 | nRF24L01+ |

### Peta Pin (ketiga node identik)

| Pin    | Fungsi                                                       |
|--------|--------------------------------------------------------------|
| PA3    | nRF24 CSN (chip-select SPI, output, makro `CSN_Pin`)         |
| PA4    | nRF24 CE  (chip-enable, output, makro `CE_Pin`)             |
| PA5    | SPI1 SCK                                                     |
| PA6    | SPI1 MISO                                                    |
| PA7    | SPI1 MOSI                                                    |
| PA8    | TIM1 CH1 input-capture — ECHO HC-SR04 (makro `ECHO_Pin`)    |
| PA9/10 | USART1 TX/RX 115200 8N1 — payload juga di-echo ke sini      |
| PA0    | Input EXTI0 falling-edge (di-enable, tanpa handler logika)   |
| PB1    | TRIG HC-SR04 (output, makro `TRIG_Pin`)                     |
| PB5    | LED indikator kirim berhasil (raw `GPIO_PIN_5`)             |
| PC13   | LED indikator sleep (active-low; nyala saat STOP mode)      |

### Konfigurasi Clock

- **HSI 8 MHz → PLL ×4 (input HSI/2) → SYSCLK = 16 MHz**, `FLASH_LATENCY_0`.
- Pembagi bus: AHB ÷1, **APB1 ÷2** (PCLK1 = 8 MHz), APB2 ÷1 (PCLK2 = 16 MHz).
- RTC bersumber dari **LSI** (dipakai untuk alarm wakeup dari STOP mode).
- TIM1 berada di APB2 → clock timer 16 MHz.

### TIM1 — Timer Bersama 1 MHz

TIM1 dipakai bersama oleh tiga subsistem sehingga **tidak boleh jalan bersamaan**:

1. Pengukuran echo HC-SR04 (interupsi input-capture pada CH1 / PA8)
2. Fungsi `delay()` busy-wait di `main.c`
3. Fungsi `delay_us()` di dalam driver nRF24

**Target frekuensi:** 1 µs per tick (1 MHz). Rumus: `Prescaler = (clock_timer / 1.000.000) - 1`. Dengan clock timer 16 MHz, nilai yang benar adalah **`Prescaler = 15`** — dan itulah yang sudah di-set pada ketiga node pengirim (`MX_TIM1_Init`). Pengukuran jarak di sisi pengirim karena itu sudah dalam satuan yang benar.

### Alur Loop Aplikasi (Pengirim)

Tiap node bangun, melakukan 3 pengukuran, lalu tidur 5 menit:

```
while (1):
  untuk i = 0..2:
    HCSR04_Read()                   → pulsa TRIG 10 µs, aktifkan interupsi TIM1 CC1
    HAL_Delay(200)                  → tunggu capture echo selesai
    snprintf("N<x> d:%u\r\n", cm)   → susun payload (Distance dalam cm)
    HAL_UART_Transmit(...)          → echo payload ke USART1 (debug)
    nrf24_transmit(...)             → kirim via radio
    kalau sukses: kedipkan LED PB5 selama 100 ms
    kalau i < 2: HAL_Delay(1000)    → jeda antar ukuran (di-skip pada ukuran terakhir)

  ce_low()                          → radio idle
  RTC_SetAlarm_FromNow(5 menit)     → pasang alarm RTC
  Enter_Stop_Mode()                 → LED PC13 nyala, masuk STOP mode (WFI)
  /* === bangun di sini saat alarm RTC === */
  Peripheral_Reinit() + NRF24_Reinit()  → konfigurasi ulang semua peripheral
```

Durasi siklus: ~2,5 detik aktif (3 ukuran) lalu **STOP mode 5 menit** (konstanta `SLEEP_MINUTES`). Saat tidur, regulator low-power aktif dan SysTick di-suspend; setelah bangun, `SystemClock_Config()` dipanggil ulang sebelum peripheral di-init kembali.

**Format payload:** `"N1 d:<cm>\r\n"`, `"N2 d:<cm>\r\n"`, `"N3 d:<cm>\r\n"`. `<cm>` adalah variabel `Distance` (`uint16_t`) yang sudah dikonversi dari tick echo ke sentimeter di sisi pengirim (`Distance = Difference * 0.034 / 2`). Penerima cukup meneruskan nilai cm ini apa adanya.

> **Catatan:** `Distance` bertipe `uint16_t`, jadi aman hingga jarak besar (HC-SR04 maksimum ~400 cm). Tidak ada lagi risiko overflow `uint8_t` seperti pada versi lama. Tetapi tidak ada **timeout echo**: bila echo tak pernah datang, `HAL_TIM_IC_CaptureCallback` tidak terpanggil dan `Is_First_Captured` bisa tersangkut di 1 sampai pembacaan berikutnya.

### Konfigurasi Radio nRF24 (Pengirim)

| Parameter       | Nilai                  |
|-----------------|------------------------|
| Channel         | 90                     |
| Data rate       | 1 Mbps                 |
| Daya TX         | 0 dBm                  |
| Ukuran payload  | 32 byte (fixed)        |
| Auto-ACK        | Aktif (semua pipe)     |
| Auto-retransmit | Delay 4, batas 10 kali |
| CRC             | Nonaktif (`no_crc`)    |
| Lebar alamat    | 5 byte                 |

Alamat pipe TX tiap node:

| Node  | Pipe | Alamat (hex)     |
|-------|------|------------------|
| Node1 | 1    | `AA 44 33 22 11` |
| Node2 | 2    | `BB 44 33 22 11` |
| Node3 | 3    | `CC 44 33 22 11` |

### Build & Flash (Pengirim)

Pastikan `arm-none-eabi-gcc` sudah ada di `PATH` (atau `make GCC_PATH=/path/to/bin`) dan `openocd` dengan ST-Link sudah terpasang.

```bash
# Kompilasi → build/RiceMesh-v2.{elf,hex,bin}
make

# Kompilasi + flash sekaligus via ST-Link
./build_flash.sh

# Flash manual
openocd -f bluepill.cfg -c "program build/RiceMesh-v2.elf verify reset exit"

# Bersihkan hasil build
make clean
```

Hasil build: `build/RiceMesh-v2.{elf,hex,bin}` (target Makefile = `RiceMesh-v2`, sama untuk ketiga node).

Mode debug selalu aktif (`DEBUG=1`, `-Og -g -gdwarf-2`). Belum ada target release.

**CPUTAPID di `bluepill.cfg`:** `0x1ba01477` (IDCODE chip klon F103). Jangan diubah kecuali memakai STM32 original.

### Batas Kode Generasi CubeMX

File `*.ioc` (`RiceMesh-v2.ioc`) yang mengatur konfigurasi peripheral. Kalau CubeMX dijalankan ulang, ia akan **menimpa** semua isi `Core/`, `Drivers/STM32F1xx_HAL_Driver/`, `Drivers/CMSIS/`, `Makefile`, `*.ld`, dan `startup_*.s`. Karena itu semua kode tulisan tangan harus berada di antara marker `/* USER CODE BEGIN x */` dan `/* USER CODE END x */`.

Folder `Drivers/nRF24/` tidak dikelola CubeMX, jadi bebas diedit — tetapi file `.c`-nya harus terdaftar di `C_SOURCES` dalam Makefile agar ikut dikompilasi. Makro `ECHO_Pin`/`ECHO_GPIO_Port` didefinisikan manual di blok USER CODE pada `Core/Inc/main.h`, jadi node pengirim **sudah bisa di-build** (tidak ada lagi masalah makro tak terdefinisi).

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
| PA3    | nRF24 CSN (makro `CSN_Pin`)                         |
| PA4    | nRF24 CE  (makro `CE_Pin`)                          |
| PA5-7  | SPI1 SCK/MISO/MOSI                                  |
| PA9/10 | USART1 TX/RX → ESP8266                              |
| PA0    | Input EXTI0 falling-edge (tanpa handler logika)     |
| PB1    | TRIG HC-SR04 (`TRIG_Pin`, tidak dipakai di loop)    |
| PB5    | LED indikator data diterima (raw `GPIO_PIN_5`)      |
| PB6/7  | I2C1 SCL/SDA → BMP280                              |

> HC-SR04 tidak dipakai di penerima (kode pembacaannya dikomentari). Fungsi `HCSR04_Read`/IC callback masih ada di source tetapi tidak dipanggil dari loop. TIM1 di penerima hanya menjadi sumber `delay_us()` untuk driver nRF24.

### Konfigurasi Clock

- **HSI 8 MHz → /2 → PLL ×4 → SYSCLK = 16 MHz**, `FLASH_LATENCY_0`, semua bus ÷1.
- USART1 clock = PCLK1, I2C1 clock = HSI.

> **TIM1 prescaler = 47 (belum dibetulkan di penerima).** Untuk tick 1 µs nilai ini cocoknya buat clock 48 MHz, padahal SYSCLK penerima 16 MHz → tick aktual ~333 kHz (≈3 µs). Karena penerima hanya memakai TIM1 untuk `delay_us()` (timing CE radio) dan **tidak** mengukur jarak, efeknya hanya pulsa CE jadi ~3× lebih lama — pada praktiknya radio tetap berfungsi. Kalau kelak penerima dipakai mengukur HC-SR04, prescaler harus diturunkan ke 15.

### Alur Loop Aplikasi (Penerima)

Penerima berjalan dalam super-loop non-blocking dengan dua tugas independen:

**Tugas 1 — Terima data radio (tiap iterasi, tanpa delay):**
```c
nrf24_listen();
if (nrf24_data_available()) {
    nrf24_receive(data_R, 32);
    sscanf(data_R, "N%u d:%u", &node_id, &dist);   // "N1 d:123"
    nodes[node_id-1].distance = dist;               // nilai cm dari pengirim
    nodes[node_id-1].valid = 1;
    kedipkan LED PB5 selama 20 ms;
}
```

**Tugas 2 — Kirim JSON tiap 1 detik (pakai `HAL_GetTick()`, non-blocking):**
```c
BMP280_Read_Raw(&temp_raw, &press_raw);
// kompensasi → real_temp (°C ×100), real_press (Pa ×100)
// susun string JSON, lalu:
HAL_UART_Transmit(&huart1, json, len, HAL_MAX_DELAY);
```

### Format Output JSON

Dikirim sekali per detik via USART1 pada 115200 baud, diakhiri `\n`. Field `temperature` dan `pressure` di-emit sebagai **angka JSON tanpa tanda kutip**, dan **diulang sama persis di setiap elemen** `device` (semua node memakai pembacaan BMP280 yang sama):

```json
{"device":[
  {"d":123,"temperature":29.63,"pressure":1006.53},
  {"d":null,"temperature":29.63,"pressure":1006.53},
  {"d":98, "temperature":29.63,"pressure":1006.53}
]}
```

- `d` adalah jarak dalam **cm** dari node pengirim (sudah dikonversi di pengirim). Kalau node belum pernah kirim data, nilainya `null`.
- `temperature` satuan °C; `pressure` satuan hPa (Pa/100). Keduanya angka, bukan string.
- Tidak ada field `id` per elemen, dan suhu/tekanan **tidak** diletakkan di level atas — keduanya tersarang di tiap objek `device`.
- Kalau BMP280 gagal dibaca (raw 0), `temperature` dan `pressure` jadi `null` (JSON tetap valid, data jarak tidak hilang).

### Konfigurasi Radio nRF24 (Penerima)

Sama dengan pengirim (channel 90, 1 Mbps, 0 dBm, `no_crc`, payload 32 byte), tapi dalam mode listen. Tiga pipe RX dibuka:

| Pipe | Alamat           | Node |
|------|------------------|------|
| 1    | `AA 44 33 22 11` | N1   |
| 2    | `BB 44 33 22 11` | N2   |
| 3    | `CC 44 33 22 11` | N3   |

### Driver BMP280

Filenya di `Drivers/BMP280/bmp280.{c,h}`. Komunikasi lewat `hi2c1` ke alamat I2C `0x76`. Fungsi yang tersedia:

- `BMP280_Init(hi2c)` — baca koefisien kalibrasi dari OTP sensor
- `BMP280_Read_Raw(&rawTemp, &rawPress)` — baca register ADC secara burst
- `BMP280_Compensate_T(adc_t)` → `int32_t`, satuan 0,01 °C
- `BMP280_Compensate_P(adc_p)` → `uint32_t`, satuan Pa/256

### Build & Flash (Penerima)

```bash
make                       # → build/RiceMesh-v4-f030.{elf,hex,bin}
./build_flash.sh
# atau manual:
openocd -f bluepill.cfg -c "program build/RiceMesh-v4-f030.elf verify reset exit"
```

Toolchain sama dengan node pengirim. **CPUTAPID di `bluepill.cfg`: `0x0bb11477`** (IDCODE seri STM32F0). Target Makefile = `RiceMesh-v4-f030`.

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

**Target PlatformIO:** `[env:nodemcu]`, board `nodemcu`, platform `espressif8266`, `monitor_speed = 115200`.

**Library yang dipakai:**
- `knolleary/PubSubClient ^2.8` — klien MQTT
- `bblanchon/ArduinoJson ^7.0.4` — parsing JSON

### Alur Data

```
STM32 UART TX → ESP8266 Serial RX
    │
    ▼ readSTM32Serial() — baca sampai karakter '\n' (buang '\r')
    │
    ▼ processIncomingLine()
        ├── buang prefix "[JSON]" kalau ada
        ├── isLikelyJson() — cek cepat: diawali '{', diakhiri '}'
        ├── deserializeJson() — parse pakai ArduinoJson
        └── kalau valid:
              publishPayload()       → MQTT topic_awd1_67 (string mentah)
              publishParsedTopics()  → sub-topik per sensor (lihat catatan)
```

### Topik MQTT

| Topik                                      | Isi                                  |
|--------------------------------------------|--------------------------------------|
| `topic_awd1_67`                            | Payload JSON lengkap (string mentah) |
| `topic_awd1_67/sensors/N1/d`               | Jarak dari Node 1                    |
| `topic_awd1_67/sensors/N2/d`               | Jarak dari Node 2                    |
| `topic_awd1_67/sensors/N3/d`               | Jarak dari Node 3                    |
| `topic_awd1_67/sensors/bmp280/temperature` | Suhu (°C)                            |
| `topic_awd1_67/sensors/bmp280/pressure`    | Tekanan (hPa)                        |
| `topic_awd1_67/status`                     | `esp8266-gateway-online` (retained)  |

Broker default: `10.58.34.24:1883` tanpa autentikasi (`MQTT_USER`/`MQTT_PASS` kosong). Client ID `esp8266-gateway`. Ganti `MQTT_BROKER` di `src/main.cpp` kalau alamatnya beda.

> **Penting — ketidakcocokan skema (sub-topik tidak terbit).** `publishParsedTopics()` mengharapkan format `{"device":[{"id":"N1","d":...}], "temperature":..., "pressure":...}` — yaitu tiap elemen punya field `id` dan suhu/tekanan di **level atas**. Namun penerima sebenarnya mengirim format **tanpa `id`** dengan suhu/tekanan **tersarang di tiap elemen** (lihat bagian Format Output JSON). Akibatnya, dengan firmware penerima saat ini, sub-topik per sensor (`.../N1/d`, `.../bmp280/temperature`, dst.) **tidak pernah diterbitkan** — hanya topik payload lengkap `topic_awd1_67` yang aktif. Untuk membuat sub-topik berfungsi, samakan dulu skema JSON penerima dengan ekspektasi parser, atau sesuaikan parser ke skema penerima.

### Endpoint HTTP

Jalan di port 80, halaman dashboard auto-refresh tiap 2 detik:

| Endpoint  | Keterangan                                                   |
|-----------|--------------------------------------------------------------|
| `/`       | Dashboard HTML — status WiFi/MQTT, JSON terakhir, statistik  |
| `/json`   | Payload JSON terbaru dalam format `application/json`         |
| `/status` | JSON info kesehatan gateway (wifi, ip, mqtt, jumlah publish) |

### Build & Flash (ESP8266)

```bash
# Pastikan PlatformIO CLI sudah terinstal
cd MQTT-Transmitter/ricemesh-data-show
pio run                    # kompilasi
pio run --target upload    # flash ke board
pio device monitor         # buka serial monitor di 115200
```

Kredensial WiFi dan alamat broker dikodekan langsung di `src/main.cpp` — perbarui sebelum flash:

```cpp
const char* WIFI_SSID   = "RXHSPT";
const char* WIFI_PASS   = "yayayasayasetuju";
const char* MQTT_BROKER = "10.58.34.24";
```

---

## Masalah yang Diketahui & Keterbatasan

| # | Lokasi | Masalah |
|---|--------|---------|
| 1 | Penerima | **Prescaler TIM1 = 47:** untuk tick 1 µs butuh clock 48 MHz, padahal SYSCLK 16 MHz → tick ~3 µs. Hanya memengaruhi `delay_us()`/timing CE radio (penerima tidak mengukur jarak), tapi sebaiknya diturunkan ke 15. Node pengirim sudah benar (prescaler 15). |
| 2 | Gateway ESP8266 | **Skema JSON tidak cocok dengan parser:** `publishParsedTopics()` cari field `id` + suhu/tekanan level atas, sedangkan penerima kirim format tanpa `id` dengan suhu/tekanan tersarang. Sub-topik per sensor tidak pernah terbit (lihat catatan di Komponen 3). |
| 3 | Semua pengirim | **Tidak ada timeout echo HC-SR04:** kalau echo tak pernah datang, `HAL_TIM_IC_CaptureCallback` tidak dipanggil dan `Is_First_Captured` bisa tersangkut di 1. |
| 4 | Semua STM32 | **`Error_Handler` hanya spin forever** tanpa output diagnostik. USART1 terinisialisasi (dan di pengirim sudah dipakai untuk echo payload), tapi `printf` belum diarahkan ke sana. |
| 5 | Gateway ESP8266 | **Kredensial dikodekan langsung** di source. Untuk deploy, pindahkan ke config header terpisah atau simpan di NVS. |

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

1. **Build & flash ketiga node pengirim** (firmware identik, beda hanya pipe/alamat/label):
   ```bash
   cd RiceMesh-Transmitter/RiceMesh-Node1 && make && ./build_flash.sh
   cd ../RiceMesh-Node2 && make && ./build_flash.sh
   cd ../RiceMesh-Node3 && make && ./build_flash.sh
   ```
2. **Build dan flash penerima:**
   ```bash
   cd RiceMesh-Receiver/RiceMesh-v4-f030-rx && make && ./build_flash.sh
   ```
   (Opsional: turunkan `Prescaler` TIM1 dari 47 ke 15 di `MX_TIM1_Init`.)
3. **Sambungkan UART TX penerima (PA9) ke RX ESP8266** pada 115200 baud. Jangan lupa ground ikut disambung.
4. **Update konfigurasi WiFi/MQTT** di `MQTT-Transmitter/ricemesh-data-show/src/main.cpp`.
5. **Flash ESP8266:**
   ```bash
   cd MQTT-Transmitter/ricemesh-data-show && pio run --target upload
   ```
6. **Cek hasilnya** — buka `http://<ip-esp8266>/` di browser, pastikan payload JSON muncul di kartu "Latest JSON Payload" dan counter publish MQTT (`topic_awd1_67`) terus naik. (Sub-topik per sensor belum aktif — lihat Masalah #2.)
