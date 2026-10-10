#pragma once
namespace Sensors {
struct Environment { float temperature, humidity, lux; };
void begin();
Environment sample();
}
