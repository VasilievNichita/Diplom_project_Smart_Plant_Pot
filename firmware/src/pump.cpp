#include "pump.h"
#include "board.h"
#include <WiFi.h>
#include <esp_timer.h>
#include <esp_task_wdt.h>
#include <atomic>

namespace Pump {
static SemaphoreHandle_t lock;
static std::atomic<uint32_t> appAt{0}, serverAt{0};
static std::atomic<bool> serverOk{false};
static Snapshot state{{0,0},false,false,false,true};
static bool pending=false, ready=false;
static int requestedChannel=0, dryAdc=0, wetAdc=0;
static uint32_t requestedMs=0;
static bool calibrated=true;
static Result outcome{};
static uint64_t nowMs() { return esp_timer_get_time()/1000; }
static void off() { digitalWrite(Board::pump[0],LOW); digitalWrite(Board::pump[1],LOW); }
static int sample(int pin) {
  int a[7];
  for (int& v:a) v=analogRead(pin);
  for(int i=1;i<7;++i) for(int j=i;j>0 && a[j]<a[j-1];--j) { int t=a[j];a[j]=a[j-1];a[j-1]=t; }
  return a[3];
}
static void task(void*) {
  if (esp_task_wdt_add(nullptr)!=ESP_OK) { off(); vTaskDelete(nullptr); return; }
  Folium::Pulse pulse;
  Folium::StableContact water, enable;
  bool sawOff=false;
  uint64_t sampledAt=0, lastStop=0;
  bool stoppedOnce=false;
  int raw[2]={0,0};
  for (;;) {
    const uint64_t now=nowMs();
    const bool switchOff=digitalRead(Board::enable)!=LOW;
    if (switchOff) sawOff=true;
    const bool enabled=enable.update(!switchOff && sawOff,now,1000) && FOLIUM_PUMPS_ENABLED;
    const bool waterOk=water.update(digitalRead(Board::reservoir)==LOW,now,500);
    if(now-sampledAt>=100) { for(int i=0;i<2;++i) raw[i]=sample(Board::soil[i]); sampledAt=now; }
    xSemaphoreTake(lock,portMAX_DELAY);
    const bool probeOk = !calibrated || Folium::calibratedRaw(raw[requestedChannel],dryAdc,wetAdc);
#ifdef FOLIUM_BENCH
    const bool networkOk = true;
#else
    const bool networkOk = WiFi.status()==WL_CONNECTED && serverOk && uint32_t(millis()-serverAt.load())<Folium::serverLeaseMs;
#endif
    Folium::Inputs in{enabled,waterOk,probeOk,networkOk,uint32_t(millis()-appAt.load())<Folium::applicationLeaseMs};
    if(pending) {
      pending=false;
#ifdef FOLIUM_BENCH
      const uint32_t pauseMs=2000;
#else
      const uint32_t pauseMs=Folium::minCooldownMs;
#endif
      if((!stoppedOnce || now-lastStop>=pauseMs) && pulse.start(requestedChannel,requestedMs,nowMs(),in)) {
        off(); digitalWrite(Board::pump[requestedChannel],HIGH);
      } else {
        outcome={0,Folium::unsafe(in)==Folium::Stop::none ? Folium::Stop::disabled : Folium::unsafe(in)};
        ready=true;
      }
    }
    if(pulse.running()) {
      const auto why=pulse.tick(nowMs(),in);
      if(why!=Folium::Stop::none) {
        off();
        outcome={static_cast<uint32_t>(pulse.elapsed(nowMs())),why};
        if(outcome.durationMs>requestedMs+Folium::resultToleranceMs) outcome.reason=Folium::Stop::timing;
        ready=true; lastStop=nowMs(); stoppedOnce=true;
        if(outcome.reason!=Folium::Stop::elapsed) sawOff=false;
      }
    }
    state={{raw[0],raw[1]},waterOk,enabled,pulse.running() || pending || ready,switchOff};
    xSemaphoreGive(lock);
    esp_task_wdt_reset();
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}
bool begin() {
  for(int i=0;i<2;++i) { digitalWrite(Board::pump[i],LOW); pinMode(Board::pump[i],OUTPUT); }
  pinMode(Board::enable,INPUT_PULLUP); pinMode(Board::reservoir,INPUT_PULLUP);
  analogReadResolution(12);
  for(int i=0;i<2;++i) { pinMode(Board::soil[i],INPUT); analogSetPinAttenuation(Board::soil[i],ADC_11db); }
  lock=xSemaphoreCreateMutex(); if(!lock) return false;
  if(esp_task_wdt_init(3,true)!=ESP_OK) return false;
  heartbeat();
  return xTaskCreatePinnedToCore(task,"pump-guard",4096,nullptr,3,nullptr,1)==pdPASS;
}
void heartbeat() { appAt=millis(); }
void serverSeen() { serverAt=millis(); serverOk=true; }
void serverLost() { serverOk=false; }
Snapshot snapshot() { xSemaphoreTake(lock,portMAX_DELAY);auto s=state;xSemaphoreGive(lock);return s; }
bool submit(int channel,uint32_t ms,int dry,int wet,bool requireCalibration) {
  xSemaphoreTake(lock,portMAX_DELAY);
  bool ok=channel>=0 && channel<2 && ms>0 && ms<=Folium::maxRuntimeMs && !state.busy && !pending && !ready;
  if(ok) { requestedChannel=channel;requestedMs=ms;dryAdc=dry;wetAdc=wet;calibrated=requireCalibration;pending=true;state.busy=true; }
  xSemaphoreGive(lock);return ok;
}
bool takeResult(Result& r) {
  xSemaphoreTake(lock,portMAX_DELAY);bool ok=ready;
  if(ok) { r=outcome;ready=false;state.busy=false; }
  xSemaphoreGive(lock);return ok;
}
}
