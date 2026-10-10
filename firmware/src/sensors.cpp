#include "sensors.h"
#include "board.h"
#include "folium_core.h"
#include <Arduino.h>
#include <Wire.h>
#include <math.h>

namespace Sensors {
static bool writeCommand(uint8_t address,uint16_t command,bool twoBytes) {
  Wire.beginTransmission(address);
  if(twoBytes) Wire.write(command>>8);
  Wire.write(command & 0xff);
  return Wire.endTransmission()==0;
}
void begin() { Wire.begin(Board::sda,Board::scl,100000); Wire.setTimeOut(30); }
Environment sample() {
  Environment e{NAN,NAN,NAN};
  // SHT31 single shot, high repeatability, no clock stretching; validate both CRCs.
  if(writeCommand(Board::sht31Address,0x2400,true)) {
    delay(20);
    if(Wire.requestFrom(Board::sht31Address,static_cast<uint8_t>(6))==6) {
      uint8_t b[6]; for(auto& v:b) v=Wire.read();
      if(Folium::sensorCrc(b,2)==b[2] && Folium::sensorCrc(b+3,2)==b[5]) {
        const float t=-45.0f+175.0f*((b[0]<<8)|b[1])/65535.0f;
        const float h=100.0f*((b[3]<<8)|b[4])/65535.0f;
        if(t>=-20 && t<=60 && h>=0 && h<=100) { e.temperature=t;e.humidity=h; }
      }
    }
  }
  // BH1750 one-shot high-resolution mode, default MTreg=69 (reset at power-up).
  // Program MTreg explicitly so a prior firmware cannot alter the lux scale.
  if(writeCommand(Board::bh1750Address,0x01,false) &&
     writeCommand(Board::bh1750Address,0x42,false) && writeCommand(Board::bh1750Address,0x65,false) &&
     writeCommand(Board::bh1750Address,0x20,false)) {
    delay(180);
    if(Wire.requestFrom(Board::bh1750Address,static_cast<uint8_t>(2))==2) {
      const uint8_t hi=Wire.read(),lo=Wire.read();
      const uint16_t raw=(hi<<8)|lo;
      if(raw!=65535) e.lux=raw/1.2f; // saturation is unavailable, never a false precise lux value
    }
  }
  return e;
}
}
