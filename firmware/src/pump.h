#pragma once
#include <Arduino.h>
#include "folium_core.h"

namespace Pump {
struct Snapshot { int raw[2]; bool water; bool enabled; bool busy; bool switchOff; };
struct Result { uint32_t durationMs; Folium::Stop reason; };
bool begin();
void heartbeat();
void serverSeen();
void serverLost();
Snapshot snapshot();
// Submission is only allowed AFTER durable command acceptance in the online firmware.
bool submit(int channel, uint32_t durationMs, int dry, int wet, bool requireCalibration=true);
bool takeResult(Result& result);
}
