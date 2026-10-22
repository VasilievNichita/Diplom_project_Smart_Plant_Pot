#include "heater_policy.h"
#include <cassert>
#include <cstdio>
int main(){
 Folium::HeaterPolicy h;
 assert(!h.tick(true,true,true,true,20,22,true));assert(h.fault); // boot in RUN
 h.acknowledgeOff();h.tick(false,true,false,true,20,22,true);
 assert(h.tick(true,true,true,true,20,22,true));
 assert(h.tick(true,true,true,true,21.8f,22,true)); // hysteresis
 assert(!h.tick(true,true,true,true,22,22,true));
 assert(!h.tick(true,true,true,true,21.8f,22,true));
 assert(h.tick(true,true,true,true,21,22,true));
 assert(!h.tick(true,false,true,true,21,22,true));assert(h.fault);
 assert(!h.tick(true,true,true,true,21,22,true)); // lease renewal cannot reset fault
 for(int fault=0;fault<7;++fault){
  h.acknowledgeOff();
  assert(!h.tick(true,true,fault!=0,fault!=1,fault==2?NAN:(fault==3?28:20),fault==6?NAN:(fault==4?27:22),fault!=5));
  assert(h.fault);
 }
 puts("Heater policy: startup, hysteresis, lease, sensor, temperature, switch and tray checks passed.");
}
