#include <Arduino.h>
#include "pump.h"

// Explicit offline calibration build. It does not send artificial measurements to the server.
void setup() {
  Serial.begin(115200);
  if(!Pump::begin())for(;;)delay(1000);
  Serial.println("PUMP TEST: outlets into measuring vessel, water in reservoir. OFF -> RUN switch required.");
  Serial.println("Type: pulse 1 1000  OR  pulse 2 1000. Range 100..5000 ms; 2 s pause. No automatic repeat.");
}
void loop() {
  Pump::heartbeat();
  static char line[40];static size_t used=0;static bool overflow=false;
  while(Serial.available()) {
    const char c=Serial.read();
    if(c=='\r')continue;
    if(c=='\n') {
      line[used]=0;int channel=0,ms=0;char extra=0;
      if(!overflow && sscanf(line,"pulse %d %d %c",&channel,&ms,&extra)==2 && channel>=1 && channel<=2 && ms>=100 && ms<=5000 &&
         Pump::submit(channel-1,ms,0,0,false)) Serial.println("Pulse submitted; wait for actual OFF result.");
      else Serial.println("Rejected: command, busy state or limits. Pumps stay off unless a prior pulse is running.");
      used=0;overflow=false;
    } else if(used<sizeof(line)-1) line[used++]=c;else overflow=true;
  }
  Pump::Result r;
  if(Pump::takeResult(r))Serial.printf("OFF %lu ms, %s. Measure ml separately; flow = ml / (ms/1000).\n",(unsigned long)r.durationMs,Folium::reason(r.reason));
  delay(10);
}
