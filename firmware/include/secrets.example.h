#pragma once
// Copy to secrets.h (ignored by Git). Never publish binaries containing these values.
#define FOLIUM_WIFI_SSID ""
#define FOLIUM_WIFI_PASSWORD ""
// Numeric PRIVATE IPv4 address of the PC, not localhost. Example: 192.168.1.50
#define FOLIUM_SERVER_IP "192.168.1.50"
#define FOLIUM_SERVER_PORT 4174
#define FOLIUM_DEVICE_ID "esp32-main"
// From private/esp32-main.json after running the server provisioning script.
#define FOLIUM_DEVICE_TOKEN ""
