#pragma once
#include <stdint.h>
#include <math.h>
namespace Folium {
struct HeaterPolicy {
 bool on=false, fault=false, sawOff=false;
 bool tick(bool requested,bool leaseValid,bool run,bool fresh,float temperature,float target,bool dry){
  if(!run)sawOff=true;
  if(!requested){on=false;return on;}
  if(!leaseValid||!run||!sawOff||!fresh||!isfinite(temperature)||!isfinite(target)||temperature>=28||!dry||target<18||target>26)fault=true;
  if(fault){on=false;return on;}
  if(temperature>=target)on=false;
  else if(temperature<=target-0.5f)on=true;
  return on;
 }
 void acknowledgeOff(){on=false;fault=false;}
};
}
