#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <esp_timer.h>
#include <esp_system.h>
#include <cJSON.h>
#include "pump.h"
#include "sensors.h"
#include "folium_core.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

namespace {
constexpr char firmware[]="folium-esp32-0.3.0";
constexpr size_t maxReplyBytes=8192;
uint64_t nowMs() { return esp_timer_get_time()/1000; }
struct Json {
  cJSON* p=nullptr;
  Json()=default;
  explicit Json(cJSON* value):p(value){}
  ~Json(){cJSON_Delete(p);}
  Json(const Json&)=delete;
  Json& operator=(const Json&)=delete;
};
const cJSON* field(const cJSON* o,const char* name) { return cJSON_GetObjectItemCaseSensitive(o,name); }
const char* str(const cJSON* o,const char* name) { const auto* v=field(o,name);return cJSON_IsString(v)?v->valuestring:""; }
bool integer(const cJSON* o,const char* name,int low,int high,int& result) {
  const auto* v=field(o,name);
  if(!cJSON_IsNumber(v) || !isfinite(v->valuedouble) || floor(v->valuedouble)!=v->valuedouble || v->valuedouble<low || v->valuedouble>high) return false;
  result=static_cast<int>(v->valuedouble);return true;
}
bool realNumber(const cJSON* o,const char* name,double low,double high,double& result) {
  const auto* v=field(o,name);
  if(!cJSON_IsNumber(v) || !isfinite(v->valuedouble) || v->valuedouble<low || v->valuedouble>high) return false;
  result=v->valuedouble;return true;
}
bool copyText(char* dest,size_t size,const char* value) {
  if(!value || !*value || strlen(value)>=size) return false;
  strcpy(dest,value);return true;
}
class ReplySink : public Stream {
public:
  String text;
  size_t write(uint8_t b) override { return write(&b,1); }
  size_t write(const uint8_t* b,size_t n) override {
    if(text.length()+n>maxReplyBytes) return 0;
    return text.concat(reinterpret_cast<const char*>(b),n)?n:0;
  }
  int available() override {return 0;}
  int read() override {return -1;}
  int peek() override {return -1;}
  void flush() override {}
};
int api(const char* method,const String& path,const String& body,Json& response) {
  if(WiFi.status()!=WL_CONNECTED) { Pump::serverLost(); return -1; }
  WiFiClient client;HTTPClient http;ReplySink sink;
  const String url=String("http://")+FOLIUM_SERVER_IP+":"+String(FOLIUM_SERVER_PORT)+path;
  http.setConnectTimeout(1000);http.setTimeout(1000);http.setReuse(false);
  if(!http.begin(client,url)) { Pump::serverLost();return -1; }
  http.addHeader("Authorization",String("Bearer ")+FOLIUM_DEVICE_TOKEN);
  http.addHeader("Content-Type","application/json");
  int status=strcmp(method,"GET")==0?http.GET():http.POST(body);
  if(status>0 && http.getSize()<=static_cast<int>(maxReplyBytes)) {
    if(http.writeToStream(&sink)<0) status=-2;
  } else status=-2;
  http.end();
  if(status>0) response.p=cJSON_Parse(sink.text.c_str());
  if(status!=200 || !cJSON_IsObject(response.p)) { Pump::serverLost();Serial.printf("API %s: %d\n",path.c_str(),status); }
  return status;
}
String encode(cJSON* value) {
  char* p=cJSON_PrintUnformatted(value);if(!p)return "";
  String s(p);cJSON_free(p);return s;
}
struct Channel {
  int revision=0,dry=-1,wet=-1,cooldown=0;
  bool armed=false;
  double flow=0,dose=0;
  char plant[40]={},sensor[40]={};
};
Channel channels[2];
uint64_t configAt=0,timeAt=0;
int64_t serverTime=-1;
bool haveConfig=false,fatal=false,recovery=false,configured=false;
Preferences prefs;
Folium::Journal journal;
char bootId[40];
uint32_t sequence=0;
uint64_t lastEnd[2]={0,0};
int activeChannel=-1;

bool persist() {
  journal.seal();
  Folium::Journal check;
  if(prefs.putBytes("journal",&journal,sizeof(journal))!=sizeof(journal) ||
     prefs.getBytes("journal",&check,sizeof(check))!=sizeof(check) || !check.valid() || memcmp(&check,&journal,sizeof(check))) {
    fatal=true;Pump::serverLost();Serial.println("NVS failure: outputs inhibited; inspect before reset.");return false;
  }
  return true;
}
bool fetchConfig() {
  const auto start=nowMs();Json doc;
  if(api("GET","/api/device/config","",doc)!=200 || !doc.p) { haveConfig=false;return false; }
  int protocol=0,runtime=0;Channel next[2];bool present[2]={false,false};
  const auto* list=field(doc.p,"channels");
  bool ok=integer(doc.p,"protocol",1,1,protocol) && integer(doc.p,"maxRuntimeMs",1,30000,runtime) && runtime==30000 &&
    !strcmp(str(doc.p,"deviceId"),FOLIUM_DEVICE_ID) && cJSON_IsArray(list) && cJSON_GetArraySize(list)==2;
  const auto* features=field(doc.p,"capabilities");bool durationFeature=false,resolutionFeature=false;
  for(int i=0;cJSON_IsArray(features) && i<cJSON_GetArraySize(features);++i) {
    const auto* f=cJSON_GetArrayItem(features,i);if(!cJSON_IsString(f))continue;
    durationFeature |= !strcmp(f->valuestring,"measured-duration-v1");
    resolutionFeature |= !strcmp(f->valuestring,"command-resolution-v1");
  }
  ok=ok && durationFeature && resolutionFeature;
  for(int i=0;ok && i<2;++i) {
    const auto* row=cJSON_GetArrayItem(list,i);int id=0;
    ok=integer(row,"id",1,2,id);if(!ok || present[id-1]) {ok=false;break;}
    present[id-1]=true;auto& c=next[id-1];
    ok=integer(row,"revision",1,2147483647,c.revision) && copyText(c.plant,sizeof(c.plant),str(row,"plant_id")) &&
      copyText(c.sensor,sizeof(c.sensor),str(row,"sensor_id")) && cJSON_IsBool(field(row,"armed")) &&
      integer(row,"cooldown_s",60,86400,c.cooldown) && realNumber(row,"max_dose_ml",1,100,c.dose);
    c.armed=cJSON_IsTrue(field(row,"armed"));
    const auto* cal=field(row,"calibration");
    if(cJSON_IsObject(cal)) ok=ok && integer(cal,"dry_adc",0,4095,c.dry) && integer(cal,"wet_adc",0,4095,c.wet) && abs(c.dry-c.wet)>=100 &&
      !strcmp(str(cal,"plant_id"),c.plant) && !strcmp(str(cal,"sensor_id"),c.sensor);
    else ok=ok && cJSON_IsNull(cal);
    if(!cJSON_IsNull(field(row,"pump_ml_s"))) ok=ok && realNumber(row,"pump_ml_s",.1,100,c.flow);
  }
  const auto epoch=Folium::isoMs(str(doc.p,"serverTime"));
  ok=ok && epoch>0 && nowMs()-start<2500;
  if(!ok) {haveConfig=false;Pump::serverLost();Serial.println("Invalid/slow config; inhibited.");return false;}
  bool runningValid=true;
  if(activeChannel>=0) {
    const auto& a=channels[activeChannel];const auto& b=next[activeChannel];
    runningValid=b.armed && a.revision==b.revision && !strcmp(a.plant,b.plant) && !strcmp(a.sensor,b.sensor);
  }
  memcpy(channels,next,sizeof(channels));haveConfig=true;configAt=nowMs();
  // Anchor at request START: estimate errs toward rejecting an expiring command.
  serverTime=epoch;timeAt=start;
  if(runningValid && !fatal) Pump::serverSeen();else Pump::serverLost();
  return true;
}
void metric(cJSON* o,const char* name,float value) { if(isfinite(value)) cJSON_AddNumberToObject(o,name,value);else cJSON_AddNullToObject(o,name); }
void telemetry() {
  if(!haveConfig || nowMs()-configAt>5000) return;
  const auto env=Sensors::sample();const auto s=Pump::snapshot();
  Json doc(cJSON_CreateObject());
  cJSON_AddStringToObject(doc.p,"bootId",bootId);cJSON_AddNumberToObject(doc.p,"sequence",sequence++);
  cJSON_AddBoolToObject(doc.p,"reservoirOk",s.water);cJSON_AddStringToObject(doc.p,"firmware",firmware);
  metric(doc.p,"temperature",env.temperature);metric(doc.p,"humidity",env.humidity);metric(doc.p,"lux",env.lux);
  auto* readings=cJSON_AddArrayToObject(doc.p,"readings");
  for(int i=0;i<2;++i) {
    auto* row=cJSON_CreateObject();cJSON_AddItemToArray(readings,row);
    cJSON_AddNumberToObject(row,"channelId",i+1);cJSON_AddNumberToObject(row,"bindingRevision",channels[i].revision);
    cJSON_AddStringToObject(row,"sensorId",channels[i].sensor);
    const bool valid=Folium::plausibleRaw(s.raw[i]);
    cJSON_AddStringToObject(row,"quality",valid?"ok":(s.raw[i]<=Folium::adcMin?"disconnected":"error"));
    if(valid)cJSON_AddNumberToObject(row,"raw",s.raw[i]);else cJSON_AddNullToObject(row,"raw");
  }
  Json reply;const int code=api("POST","/api/device/telemetry",encode(doc.p),reply);
  if(code!=200) haveConfig=false;
  Serial.printf("ADC %d / %d | water %d | RUN %d | telemetry %d\n",s.raw[0],s.raw[1],s.water,s.enabled,code);
  // Lost packets are dropped. A new sample always gets a new sequence; no fake fresh retry.
  if(sequence>=2147483640u) ESP.restart();
}
void result(bool completed,uint32_t actual,const char* note) {
  journal.phase=Folium::Phase::result;journal.completed=completed;journal.actualMs=actual;
  snprintf(journal.note,sizeof(journal.note),"%s",note);persist();
}
void claim() {
  if(!FOLIUM_PUMPS_ENABLED || fatal || recovery || !haveConfig || nowMs()-configAt>4000 ||
     journal.phase==Folium::Phase::accepted || journal.phase==Folium::Phase::result) return;
  const auto local=Pump::snapshot();
  if(!local.enabled || !local.water || local.busy) return;
  Json doc;if(api("POST","/api/device/commands/claim","{}",doc)!=200 || !doc.p)return;
  const auto* command=field(doc.p,"command");if(cJSON_IsNull(command))return;
  const char* id=str(command,"id");
  if(!cJSON_IsObject(command) || !Folium::uuid(id)) {fatal=true;Pump::serverLost();return;}
  if(journal.seen(id)) {fatal=true;Pump::serverLost();Serial.println("Replay blocked; no output.");return;}
  if(!journal.accept(id) || !persist())return; // Atomic, verified durable write BEFORE output.
  int channel=0,revision=0,duration=0;double volume=0;
  const int64_t expires=Folium::isoMs(str(command,"expires_at"));
  const int64_t clock=serverTime+static_cast<int64_t>(nowMs()-timeAt);
  bool ok=integer(command,"channel_id",1,2,channel) && integer(command,"binding_revision",1,2147483647,revision) &&
    integer(command,"duration_ms",1,30000,duration) && realNumber(command,"requested_ml",1,100,volume) &&
    !strcmp(str(command,"device_id"),FOLIUM_DEVICE_ID) && expires>clock+250 && expires-clock<=30000;
  if(ok) {
    const auto& c=channels[channel-1];
    const auto live=Pump::snapshot();
    ok=c.armed && c.revision==revision && !strcmp(str(command,"plant_id"),c.plant) && !strcmp(str(command,"sensor_id"),c.sensor) &&
      volume<=c.dose && c.flow>0 && fabs(ceil(volume/c.flow*1000)-duration)<=1 &&
      Folium::calibratedRaw(live.raw[channel-1],c.dry,c.wet) &&
      (lastEnd[channel-1]==0 || nowMs()-lastEnd[channel-1]>=static_cast<uint64_t>(c.cooldown)*1000);
    if(ok && Pump::submit(channel-1,duration,c.dry,c.wet)) {activeChannel=channel-1;Serial.printf("Accepted channel %d for %d ms\n",channel,duration);return;}
  }
  result(false,0,"local_validation_rejected");
}
void reconcileOrSendResult() {
  if(fatal) return;
  if(journal.phase==Folium::Phase::result) {
    Json body(cJSON_CreateObject()),reply;
    cJSON_AddStringToObject(body.p,"status",journal.completed?"completed":"failed");
    cJSON_AddNumberToObject(body.p,"actualDurationMs",journal.actualMs);cJSON_AddStringToObject(body.p,"note",journal.note);
    const auto code=api("POST",String("/api/device/commands/")+journal.command+"/result",encode(body.p),reply);
    if(code==200 && !strcmp(str(reply.p,"id"),journal.command)) {journal.phase=Folium::Phase::reported;persist();return;}
  }
  if(!recovery && journal.phase!=Folium::Phase::result)return;
  Json doc;
  if(api("GET",String("/api/device/commands/")+journal.command,"",doc)!=200)return;
  // Only explicit operator reconciliation clears an interrupted/unknown pulse.
  const auto* r=field(doc.p,"resolution");
  if(!strcmp(str(doc.p,"id"),journal.command) && !strcmp(str(doc.p,"status"),"failed") &&
     cJSON_IsTrue(field(r,"reconciled")) && Pump::snapshot().switchOff) {
    journal.phase=Folium::Phase::reported;
    if(persist()) {recovery=false;Serial.println("Operator reconciliation confirmed; turn RUN off then on before rearming.");}
  }
}
bool credentialsValid() {
  IPAddress ip;
  if(!strlen(FOLIUM_WIFI_SSID) || !ip.fromString(FOLIUM_SERVER_IP) || strlen(FOLIUM_DEVICE_TOKEN)!=64) return false;
  if(!(ip[0]==10 || (ip[0]==172 && ip[1]>=16 && ip[1]<=31) || (ip[0]==192 && ip[1]==168))) return false;
  for(const char c:String(FOLIUM_DEVICE_TOKEN)) if(!((c>='0' && c<='9') || (c>='a' && c<='f')))return false;
  return FOLIUM_SERVER_PORT>0 && FOLIUM_SERVER_PORT<65536 && strlen(FOLIUM_DEVICE_ID)>0;
}
}
void setup() {
  Serial.begin(115200);
  if(!Pump::begin()) {Serial.println("Pump guard initialization failed.");for(;;)delay(1000);}
  Sensors::begin();
  Serial.printf("%s | pumps %s\n",firmware,FOLIUM_PUMPS_ENABLED?"ENABLED (physical RUN required)":"DISABLED");
  if(!prefs.begin("folium",false))fatal=true;
  else if(prefs.isKey("journal")) {
    if(prefs.getBytesLength("journal")!=sizeof(journal) || prefs.getBytes("journal",&journal,sizeof(journal))!=sizeof(journal) || !journal.valid())fatal=true;
  } else persist();
  if(!fatal) {if(journal.boots==UINT32_MAX)fatal=true;else {++journal.boots;persist();}}
  snprintf(bootId,sizeof(bootId),"%08lx-%08lx%08lx%08lx",(unsigned long)journal.boots,(unsigned long)esp_random(),(unsigned long)esp_random(),(unsigned long)esp_random());
  recovery=journal.phase==Folium::Phase::accepted;
  if(recovery) Serial.println("Interrupted command: no resume. Check hardware, reconcile in website, leave RUN OFF.");
  if(fatal)Serial.println("Invalid NVS: locked. Do not erase until command history is reconciled.");
  configured=credentialsValid();
  if(configured) {WiFi.persistent(false);WiFi.mode(WIFI_STA);WiFi.setSleep(false);WiFi.setAutoReconnect(true);WiFi.begin(FOLIUM_WIFI_SSID,FOLIUM_WIFI_PASSWORD);}
  else Serial.println("No valid private credentials: local readings only. Copy secrets.example.h to secrets.h.");
}
void loop() {
  Pump::heartbeat();
  static uint64_t nextConfig=0,nextTelemetry=0,nextClaim=0,nextResult=0,nextWifi=10000,nextLog=0;
  Pump::Result r;
  if(Pump::takeResult(r)) {
    if(activeChannel>=0)lastEnd[activeChannel]=nowMs();
    activeChannel=-1;
    result(r.reason==Folium::Stop::elapsed,r.durationMs,Folium::reason(r.reason));
    Serial.printf("Pump OFF: %s, %lu ms\n",Folium::reason(r.reason),(unsigned long)r.durationMs);
  }
  if(!configured || fatal || WiFi.status()!=WL_CONNECTED) {
    Pump::serverLost();
    if(nowMs()>=nextLog) {auto s=Pump::snapshot();Serial.printf("Offline/locked ADC %d / %d water=%d switchOff=%d\n",s.raw[0],s.raw[1],s.water,s.switchOff);nextLog=nowMs()+3000;}
    if(configured && !fatal && nowMs()>=nextWifi) {WiFi.reconnect();nextWifi=nowMs()+10000;}
    delay(20);return;
  }
  // At most one network transaction per loop keeps the application heartbeat bounded.
  if(nowMs()>=nextConfig) {fetchConfig();nextConfig=nowMs()+1000;}
  else if(nowMs()>=nextTelemetry) {telemetry();nextTelemetry=nowMs()+15000;}
  else if((recovery || journal.phase==Folium::Phase::result) && nowMs()>=nextResult) {reconcileOrSendResult();nextResult=nowMs()+3000;}
  else if(nowMs()>=nextClaim) {claim();nextClaim=nowMs()+2000;}
  delay(10);
}
