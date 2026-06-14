#ifndef BMP280_H
#define BMP280_H

#include "stm32f030x8.h"
#include "main.h"

// I2C address of the BMP280 sensor
#define BMP280_I2C_ADDRESS 0x76 << 1 

// Resgister List
#define BMP280_REG_ID 0xD0
#define BMP280_REG_RESET 0xE0
#define BMP280_REG_STATUS 0xF3
#define BMP280_REG_CTRL_MEAS 0xF4
#define BMP280_REG_CONFIG 0xF5
#define BMP280_REG_PRES 0xF7
#define BMP280_REG_TEMP 0xFA
#define BMP280_REG_CALIB 0x88

// Parameter Readout
typedef struct {
    uint16_t dig_T1;
    int16_t dig_T2;
    int16_t dig_T3;
    uint16_t dig_P1;
    int16_t dig_P2;
    int16_t dig_P3;
    int16_t dig_P4;
    int16_t dig_P5;
    int16_t dig_P6;
    int16_t dig_P7;
    int16_t dig_P8;
    int16_t dig_P9;
} BMP280_CalibData;

void BMP280_Init(I2C_HandleTypeDef *hi2c);
void BMP280_Read_Raw(int32_t *rawTemp, int32_t *rawPress);
int32_t BMP280_Compensate_T(int32_t adc_t);
uint32_t BMP280_Compensate_P(int32_t adc_p);

#endif