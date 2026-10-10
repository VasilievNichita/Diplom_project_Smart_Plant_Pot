#include "folium_core.h"
#include <cassert>
#include <iostream>
#include <string>

int main() {
  using namespace Folium;
  int scenarios=0;
  const Inputs safe{true,true,true,true,true};
  {
    Pulse p;assert(!p.running());assert(p.tick(5000,safe)==Stop::none);
    assert(!p.start(-1,100,0,safe));assert(!p.start(2,100,0,safe));
    assert(!p.start(0,0,0,safe));assert(!p.start(0,30001,0,safe));
    assert(p.start(0,30000,0,safe));assert(!p.start(1,100,1,safe));
    assert(p.tick(29999,safe)==Stop::none);assert(p.tick(30000,safe)==Stop::elapsed);assert(!p.running());++scenarios;
  }
  {
    const Stop reasons[]={Stop::disabled,Stop::water,Stop::probe,Stop::network,Stop::application};
    for(int k=0;k<5;++k) {
      Inputs bad=safe;
      switch(k){case 0:bad.enabled=false;break;case 1:bad.water=false;break;case 2:bad.probe=false;break;case 3:bad.network=false;break;case 4:bad.application=false;break;}
      Pulse p;assert(!p.start(0,1000,0,bad));assert(p.start(0,1000,0,safe));
      assert(p.tick(20,bad)==reasons[k]);assert(!p.running());assert(p.tick(50,safe)==Stop::none);++scenarios;
    }
  }
  {
    Pulse p;const uint64_t start=0xffffffffULL-20;assert(p.start(1,1000,start,safe));
    assert(p.tick(start+999,safe)==Stop::none);assert(p.tick(start+1000,safe)==Stop::elapsed);++scenarios;
  }
  {
    Pulse p;assert(p.start(1,1000,0,safe));assert(p.tick(1051,safe)==Stop::timing);assert(p.elapsed(1051)==1051);++scenarios;
  }
  {
    StableContact s;assert(!s.update(true,0,500));assert(!s.update(true,499,500));assert(s.update(true,500,500));
    assert(!s.update(false,501,500));assert(!s.update(true,502,500));assert(!s.update(true,1001,500));assert(s.update(true,1002,500));++scenarios;
  }
  {
    assert(!plausibleRaw(0));assert(!plausibleRaw(4095));assert(calibratedRaw(2000,3000,1000));
    assert(calibratedRaw(2000,1000,3000));assert(!calibratedRaw(3500,3000,1000));assert(!calibratedRaw(2000,2000,2050));
    assert(!calibratedRaw(2000,-1,-1));assert(!calibratedRaw(0,0,1000));++scenarios;
  }
  {
    const uint8_t bytes[]={0xbe,0xef};assert(sensorCrc(bytes,2)==0x92);++scenarios;
  }
  {
    assert(isoMs("2026-10-10T10:00:00.000Z")==1791626400000LL);
    assert(isoMs("2024-02-29T00:00:00.000Z")>0);assert(isoMs("2025-02-29T00:00:00.000Z")==-1);
    assert(isoMs("2026-13-10T10:00:00.000Z")==-1);assert(isoMs("2026-10-10T24:00:00.000Z")==-1);
    assert(isoMs("2026-10-10T10:00:00.000+02:00")==-1);assert(isoMs("")==-1);++scenarios;
  }
  {
    Journal j;j.seal();assert(j.valid());const char* id="12345678-1234-1234-1234-123456789abc";
    assert(!j.accept("bad"));assert(j.accept(id));assert(j.valid());assert(j.phase==Phase::accepted);assert(!j.accept(id));
    Journal reboot=j;assert(reboot.valid());assert(reboot.phase==Phase::accepted);assert(reboot.seen(id));
    j.phase=Phase::result;j.actualMs=1010;strcpy(j.note,"local_timer");j.seal();assert(j.valid());assert(!j.accept(id));
    j.phase=Phase::reported;j.seal();assert(!j.accept(id));++scenarios;
    j.actualMs++;assert(!j.valid());++scenarios;
  }
  {
    Journal j;j.seal();
    for(int n=0;n<20;++n) {
      char id[37];snprintf(id,sizeof(id),"12345678-1234-1234-1234-%012x",n);
      assert(j.accept(id));assert(j.valid());j.phase=Phase::reported;j.seal();
    }
    assert(j.seen("12345678-1234-1234-1234-000000000013"));
    assert(j.seen("12345678-1234-1234-1234-000000000004"));assert(!j.seen("12345678-1234-1234-1234-000000000000"));++scenarios;
  }
  std::cout << scenarios << " firmware core scenarios passed (host simulation, no hardware).\n";
}
