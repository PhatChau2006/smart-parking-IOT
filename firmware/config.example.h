#pragma once
// Copy to config.h. Node-RED and ESP32 must use the SAME HiveMQ cluster.
const char* WIFI_SSID = "YOUR_WIFI_2G4";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* MQTT_HOST = "YOUR_CLUSTER.s1.eu.hivemq.cloud";
#define MQTT_PORT 8883
#define MQTT_USE_TLS 1
// Paste the trusted root CA supplied for your cluster. Do not use setInsecure().
const char* MQTT_CA_CERT = R"CERT(
PASTE_TRUSTED_ROOT_CA_PEM_HERE
)CERT";
const char* MQTT_USER = "parking";
const char* MQTT_PASSWORD = "CHANGE_ME";
