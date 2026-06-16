# 🔌 Dokumentasi Teknis Tambahan: Firmware IoT & Hardware

## 1. Spesifikasi Perangkat Keras (Hardware)
Perangkat lapangan yang dipasang di sawah menggunakan mikrokontroler murah namun andal dengan dukungan WiFi dan Deep Sleep.
- **Microcontroller:** ESP32 (WROOM-32)
- **Sensor Jarak Air:** HC-SR04 (Ultrasonic) atau JSN-SR04T (Waterproof)
- **Sensor Suhu/Kelembaban:** DHT22 atau BME280
- **Daya:** Panel Surya Mini (5V) + Baterai Li-Ion 18650

## 2. Format *Payload* MQTT (Sangat Penting!)
Firmware C++ (Arduino IDE) pada ESP32 bertugas membaca sensor dan mengirimkannya ke `Mosquitto MQTT Broker`.
*Backend* Node.js (`mqtt.service.ts`) **hanya** menerima format JSON spesifik berikut ke topik `sensor/data`.

**Contoh Payload Valid:**
```json
{
  "device": [
    {
      "id": "7876a477-83eb-4dfb-9db6-3fb9ed7f3e8b", 
      "d": 1200 
    }
  ],
  "temperature": 29.6,
  "humidity": 78,
  "pressure": 1005
}
```
*Catatan Variabel:*
- `id`: UUID atau Kode Unik Node Sensor yang terdaftar di tabel `mst.devices`.
- `d`: Jarak kosong dari bibir sensor ke permukaan air dalam satuan **Milimeter (mm)**. (Bukan sentimeter!). 
- *Backend* akan menghitung elevasi air asli menggunakan rumus: `(sensor_max_distance_mm - d) / 10`.

## 3. Siklus Daya (*Power Management*)
ESP32 tidak terhubung ke WiFi secara konstan 24 jam. Ini akan menguras habis daya panel surya.
1. Bangun dari *Deep Sleep*.
2. Baca sensor (Ambil rata-rata 5 kali sampel ultrasonik agar tidak ada pembacaan *noise*).
3. Hubungkan ke WiFi dan MQTT Broker.
4. Terbitkan (*Publish*) data.
5. Kembali ke *Deep Sleep* selama 5-10 menit.
