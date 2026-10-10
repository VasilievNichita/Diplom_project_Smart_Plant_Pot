#pragma once
#include <stdint.h>

// Classic dual-core ESP32-WROOM only. Numbers are GPIO labels, not header positions.
namespace Board {
constexpr uint8_t soil[2] = {34, 35};  // ADC1: available while Wi-Fi is running
constexpr uint8_t pump[2] = {26, 27};  // Active HIGH, external gate pull-downs
constexpr uint8_t sda = 21, scl = 22;
constexpr uint8_t reservoir = 33;     // Closed to GND only when water is available
constexpr uint8_t enable = 32;        // S1 second pole, closed to GND in RUN
constexpr uint8_t sht31Address = 0x44;
constexpr uint8_t bh1750Address = 0x23;
}
