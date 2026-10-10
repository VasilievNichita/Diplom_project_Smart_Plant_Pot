#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <math.h>

namespace Folium {
constexpr uint32_t maxRuntimeMs = 30000;
constexpr uint32_t resultToleranceMs = 50;
constexpr uint32_t minCooldownMs = 60000;
constexpr uint32_t serverLeaseMs = 6000;
constexpr uint32_t applicationLeaseMs = 4000;
constexpr int adcMin = 64, adcMax = 4000;

inline bool plausibleRaw(int raw) { return raw > adcMin && raw < adcMax; }
inline bool calibratedRaw(int raw, int dry, int wet) {
  return plausibleRaw(raw) && dry >= 0 && dry <= 4095 && wet >= 0 && wet <= 4095 &&
    abs(dry - wet) >= 100 && raw >= (dry < wet ? dry : wet) && raw <= (dry > wet ? dry : wet);
}
inline uint8_t sensorCrc(const uint8_t* data, size_t size) {
  uint8_t crc = 0xff;
  for (size_t i=0; i<size; ++i) {
    crc ^= data[i];
    for (int b=0; b<8; ++b) crc = crc & 0x80 ? (crc << 1) ^ 0x31 : crc << 1;
  }
  return crc;
}

// A broken wire drops immediately; restoring a contact requires continuous closure.
class StableContact {
  uint64_t since_ = 0;
  bool closed_ = false;
public:
  bool update(bool closed, uint64_t now, uint32_t settleMs) {
    if (!closed) { closed_ = false; return false; }
    if (!closed_) { since_ = now; closed_ = true; }
    return now - since_ >= settleMs;
  }
};

enum class Stop : uint8_t { none, elapsed, disabled, water, probe, network, application, timing };
inline const char* reason(Stop s) {
  switch (s) {
    case Stop::elapsed: return "local_timer";
    case Stop::disabled: return "local_switch_or_build_disabled";
    case Stop::water: return "reservoir_open";
    case Stop::probe: return "probe_invalid_or_out_of_calibration";
    case Stop::network: return "server_lease_or_wifi_lost";
    case Stop::application: return "application_stalled";
    case Stop::timing: return "timer_overrun";
    default: return "none";
  }
}
struct Inputs {
  bool enabled, water, probe, network, application;
  Inputs(bool e=false,bool w=false,bool p=false,bool n=false,bool a=false)
    : enabled(e),water(w),probe(p),network(n),application(a) {}
};
inline Stop unsafe(const Inputs& i) {
  if (!i.enabled) return Stop::disabled;
  if (!i.water) return Stop::water;
  if (!i.probe) return Stop::probe;
  if (!i.network) return Stop::network;
  if (!i.application) return Stop::application;
  return Stop::none;
}
class Pulse {
  uint64_t started_ = 0;
  uint32_t duration_ = 0;
  int channel_ = -1;
public:
  bool start(int channel, uint32_t duration, uint64_t now, const Inputs& in) {
    if (channel_ != -1 || channel < 0 || channel > 1 || duration == 0 || duration > maxRuntimeMs || unsafe(in) != Stop::none) return false;
    channel_ = channel; duration_ = duration; started_ = now; return true;
  }
  Stop tick(uint64_t now, const Inputs& in) {
    if (channel_ == -1) return Stop::none;
    Stop why = unsafe(in);
    if (why == Stop::none && now-started_ >= duration_) why = now-started_ > duration_+resultToleranceMs ? Stop::timing : Stop::elapsed;
    if (why != Stop::none) channel_ = -1;
    return why;
  }
  bool running() const { return channel_ != -1; }
  int channel() const { return channel_; }
  uint64_t elapsed(uint64_t now) const { return now-started_; }
};

inline bool uuid(const char* s) {
  if (!s || strlen(s) != 36) return false;
  for (size_t i=0;i<36;++i) {
    if (i==8 || i==13 || i==18 || i==23) { if (s[i]!='-') return false; }
    else if (!((s[i]>='0' && s[i]<='9') || (s[i]>='a' && s[i]<='f'))) return false;
  }
  return true;
}

// Strict server UTC ISO format; no dependency on NTP, local timezone or RTC battery.
inline int64_t isoMs(const char* s) {
  if(!s || strlen(s)!=24 || s[4]!='-' || s[7]!='-' || s[10]!='T' || s[13]!=':' || s[16]!=':' || s[19]!='.' || s[23]!='Z') return -1;
  auto n=[s](int pos,int len) { int v=0;while(len--) { char c=s[pos++];if(c<'0'||c>'9') return -1;v=v*10+c-'0'; }return v; };
  const int y=n(0,4),m=n(5,2),d=n(8,2),h=n(11,2),mi=n(14,2),sec=n(17,2),ms=n(20,3);
  const int monthDays[]={31,28,31,30,31,30,31,31,30,31,30,31};
  if(y<2020 || y>2099 || m<1 || m>12 || d<1 || d>monthDays[m-1]+(m==2 && y%4==0) || h<0 || h>23 || mi<0 || mi>59 || sec<0 || sec>59 || ms<0) return -1;
  int days=0;for(int year=1970;year<y;++year) days+=365+(year%4==0);
  for(int month=1;month<m;++month) days+=monthDays[month-1]+(month==2 && y%4==0);
  days+=d-1;
  return ((static_cast<int64_t>(days)*24+h)*3600+mi*60+sec)*1000+ms;
}

// The complete record is one atomic NVS blob. No flash writes during a pulse.
enum class Phase : uint8_t { idle, accepted, result, reported };
struct Journal {
  uint32_t magic = 0x464f4c31;
  uint32_t checksum = 0;
  uint32_t boots = 0;
  char recent[16][37] = {};
  uint8_t next = 0;
  Phase phase = Phase::idle;
  uint8_t completed = 0;
  char command[37] = {};
  uint32_t actualMs = 0;
  char note[100] = {};
  uint32_t hash() const {
    // Exclude the checksum field and struct padding; stable across host/ESP builds.
    uint32_t h = 2166136261u;
    auto bytes = [&h](const void* p, size_t n) { const auto* b = static_cast<const uint8_t*>(p); while(n--) h=(h^*b++)*16777619u; };
    bytes(&magic,sizeof(magic)); bytes(&boots,sizeof(boots)); bytes(recent,sizeof(recent)); bytes(&next,1); bytes(&phase,1);
    bytes(&completed,1); bytes(command,sizeof(command)); bytes(&actualMs,sizeof(actualMs)); bytes(note,sizeof(note));
    return h;
  }
  void seal() { checksum = hash(); }
  bool valid() const {
    if (magic != 0x464f4c31 || next>=16 || static_cast<uint8_t>(phase)>3 || completed>1 || checksum!=hash() || command[36] || note[99]) return false;
    for (const auto& id : recent) if (id[36] || (id[0] && !uuid(id))) return false;
    return phase == Phase::idle || uuid(command);
  }
  bool seen(const char* id) const { for (const auto& old : recent) if (!strcmp(old,id)) return true; return false; }
  bool accept(const char* id) {
    if (!uuid(id) || seen(id) || phase==Phase::accepted || phase==Phase::result) return false;
    strcpy(command,id); strcpy(recent[next],id); next=(next+1)%16;
    phase=Phase::accepted; completed=0; actualMs=0; memset(note,0,sizeof(note)); seal(); return true;
  }
};
}
