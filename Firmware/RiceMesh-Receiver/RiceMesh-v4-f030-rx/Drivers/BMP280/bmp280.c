#include "bmp280.h"

extern I2C_HandleTypeDef hi2c1;
BMP280_CalibData calibData;
int32_t t_fine;

// Read and Write functions
static void Read_Register(uint8_t reg, uint8_t *data, uint16_t size) {
    HAL_I2C_Mem_Read(&hi2c1, BMP280_I2C_ADDRESS, reg, I2C_MEMADD_SIZE_8BIT, data, size, HAL_MAX_DELAY);
}

static void Write_Register(uint8_t reg, uint8_t data) {
    HAL_I2C_Mem_Write(&hi2c1, BMP280_I2C_ADDRESS, reg, I2C_MEMADD_SIZE_8BIT, &data, 1, HAL_MAX_DELAY);
}

// Initialization function
void BMP280_Init(I2C_HandleTypeDef *hi2c) {
    uint8_t id = 0;
    Read_Register(BMP280_REG_ID, &id, 1);

    if (id != 0x58) {
        // Handle error: sensor not found
        return;
    }

    // Read calibration data
    uint8_t calib[24];
    Read_Register(BMP280_REG_CALIB, calib, 24);

    calibData.dig_T1 = (calib[1] << 8) | calib[0];
    calibData.dig_T2 = (calib[3] << 8) | calib[2];
    calibData.dig_T3 = (calib[5] << 8) | calib[4];
    calibData.dig_P1 = (calib[7] << 8) | calib[6];
    calibData.dig_P2 = (calib[9] << 8) | calib[8];
    calibData.dig_P3 = (calib[11] << 8) | calib[10];
    calibData.dig_P4 = (calib[13] << 8) | calib[12];
    calibData.dig_P5 = (calib[15] << 8) | calib[14];
    calibData.dig_P6 = (calib[17] << 8) | calib[16];
    calibData.dig_P7 = (calib[19] << 8) | calib[18];
    calibData.dig_P8 = (calib[21] << 8) | calib[20];
    calibData.dig_P9 = (calib[23] << 8) | calib[22];

    // Sensor Configuration
    uint8_t ctrl_meas = (1 << 5) | (1 << 2) | 3; // Temp and Pressure oversampling x1, Normal mode
    Write_Register(BMP280_REG_CTRL_MEAS, ctrl_meas);

    uint8_t config = (5 << 5) | (0 << 2) | 0; // Standby time 1000ms, Filter off
    Write_Register(BMP280_REG_CONFIG, config);
}

// Burst read raw temperature and pressure data
void BMP280_Read_Raw(int32_t *rawTemp, int32_t *rawPress) {
    uint8_t data[6];
    Read_Register(BMP280_REG_PRES, data, 6);

    *rawPress = ((int32_t)data[0] << 12) | ((int32_t)data[1] << 4) | (data[2] >> 4);
    *rawTemp = ((int32_t)data[3] << 12) | ((int32_t)data[4] << 4) | (data[5] >> 4);
}

// Compensation functions
int32_t BMP280_Compensate_T(int32_t adc_T) {
    int32_t var1, var2, T;
    
    var1 = ((((adc_T >> 3) - ((int32_t)calibData.dig_T1 << 1))) * ((int32_t)calibData.dig_T2)) >> 11;
    var2 = (((((adc_T >> 4) - ((int32_t)calibData.dig_T1)) * ((adc_T >> 4) - ((int32_t)calibData.dig_T1))) >> 12) * ((int32_t)calibData.dig_T3)) >> 14;
    t_fine = var1 + var2;
    T = (t_fine * 5 + 128) >> 8;
    return T;
}

// Hasil tekanan dalam Pascal (Pa). (Misal: 96386 = 963.86 hPa)[cite: 1]
uint32_t BMP280_Compensate_P(int32_t adc_P) {
    int32_t var1, var2;
    uint32_t p;

    var1 = (((int32_t)t_fine) >> 1) - (int32_t)64000;
    var2 = (((var1 >> 2) * (var1 >> 2)) >> 11) * ((int32_t)calibData.dig_P6);
    var2 = var2 + ((var1 * ((int32_t)calibData.dig_P5)) << 1);
    var2 = (var2 >> 2) + (((int32_t)calibData.dig_P4) << 16);
    var1 = (((calibData.dig_P3 * (((var1 >> 2) * (var1 >> 2)) >> 13)) >> 3) + ((((int32_t)calibData.dig_P2) * var1) >> 1)) >> 18;
    var1 = ((((32768 + var1)) * ((int32_t)calibData.dig_P1)) >> 15);

    if (var1 == 0) {
        return 0; // menghindari pembagian dengan nol[cite: 1]
    }

    p = (((uint32_t)(((int32_t)1048576) - adc_P) - (var2 >> 12))) * 3125;
    if (p < 0x80000000) {
        p = (p << 1) / ((uint32_t)var1);
    } else {
        p = (p / (uint32_t)var1) * 2;
    }

    var1 = (((int32_t)calibData.dig_P9) * ((int32_t)(((p >> 3) * (p >> 3)) >> 13))) >> 12;
    var2 = (((int32_t)(p >> 2)) * ((int32_t)calibData.dig_P8)) >> 13;
    p = (uint32_t)((int32_t)p + ((var1 + var2 + calibData.dig_P7) >> 4));
    
    return p;
}