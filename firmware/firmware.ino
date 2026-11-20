#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>
#include <DHT.h>
#include "config.h"

#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif
#ifndef MQTT_USE_TLS
#define MQTT_USE_TLS 0
#endif
#if MQTT_USE_TLS
WiFiClientSecure network;
#else
WiFiClient network;
#endif
PubSubClient mqtt(network);
Servo barrier;
const int dhtPin = 26;
const int buzzerPin = 23;
DHT dht(dhtPin, DHT11);
unsigned long lastTemperature = 0;
float temperatureC = NAN;
bool thermalAlarm = false;
const int triggerPins[3] = {13, 14, 25};
const int echoPins[3] = {32, 33, 34};
const int servoPin = 27;
const int openAngle = 90;
const int closedAngle = 0;
// Calibrate against the physical model. Invalid measurements remain unknown.
const float occupiedDistance = 12.0;
const float emptyDistance = 16.0;
int slots[3] = {-1, -1, -1};
int candidate[3] = {-2, -2, -2};
int stableCount[3] = {0, 0, 0};
unsigned long lastSample = 0;
unsigned long lastConnect = 0;
unsigned long lastWifi = 0;
char bootId[20];
unsigned long sequence = 0;

void receive(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, "parking/barrier/set") != 0) return;
  String command;
  for (unsigned int i = 0; i < length; i++) command += (char)payload[i];
  if (command != "open" && command != "close") return;
  barrier.write(command == "open" ? openAngle : closedAngle);
  mqtt.publish("parking/barrier/state", command.c_str(), true);
}

void setup() {
  Serial.begin(115200);
  snprintf(bootId, sizeof(bootId), "%08lx", (unsigned long)esp_random());
  for (int i = 0; i < 3; i++) {
    pinMode(triggerPins[i], OUTPUT);
    digitalWrite(triggerPins[i], LOW);
    pinMode(echoPins[i], INPUT);
  }
  barrier.setPeriodHertz(50);
  barrier.attach(servoPin, 500, 2400);
  barrier.write(closedAngle);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com"); // TLS certificate validity after Wi-Fi connects.
  pinMode(buzzerPin, OUTPUT);
  digitalWrite(buzzerPin, LOW);
  dht.begin();
#if MQTT_USE_TLS
  network.setCACert(MQTT_CA_CERT);
  network.setHandshakeTimeout(3);
#endif
  mqtt.setSocketTimeout(3);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(receive);
}

void loop() {
  unsigned long now = millis();
  // NC01 runs even when Wi-Fi, MQTT, Node-RED or Cloud is down.
  if (now - lastTemperature >= 2000) {
    lastTemperature = now;
    temperatureC = dht.readTemperature();
    const bool valid = !isnan(temperatureC) && temperatureC >= 0 && temperatureC <= 50;
    if (valid) {
      if (temperatureC >= 50) thermalAlarm = true;
      else if (temperatureC <= 45) thermalAlarm = false;
    } else thermalAlarm = false;
    digitalWrite(buzzerPin, thermalAlarm ? HIGH : LOW);
    if (mqtt.connected()) {
      char thermalMessage[180];
      if (valid) snprintf(thermalMessage, sizeof(thermalMessage),
        "{\"temperatureC\":%.1f,\"sensorValid\":true,\"alarm\":%s,\"buzzer\":%s}",
        temperatureC, thermalAlarm ? "true" : "false", thermalAlarm ? "true" : "false");
      else snprintf(thermalMessage, sizeof(thermalMessage), "{\"sensorValid\":false}");
      mqtt.publish("parking/temperature", thermalMessage, false);
    }
  }
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifi > 15000) {
      lastWifi = now;
      WiFi.reconnect();
    }
    return;
  }
  if (!mqtt.connected() && now - lastConnect > 5000) {
    lastConnect = now;
    String clientId = "parking-" + WiFi.macAddress();
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASSWORD,
                     "parking/availability", 1, true, "offline")) {
      mqtt.publish("parking/availability", "online", true);
      mqtt.subscribe("parking/barrier/set", 1);
    }
  }
  mqtt.loop();
  if (now - lastSample < 1000) return;
  lastSample = now;
  for (int i = 0; i < 3; i++) {
    digitalWrite(triggerPins[i], HIGH);
    delayMicroseconds(10);
    digitalWrite(triggerPins[i], LOW);
    unsigned long duration = pulseIn(echoPins[i], HIGH, 25000);
    float distance = duration * 0.0343 / 2;
    int reading = slots[i];
    if (!duration || distance < 2 || distance > 400) reading = -1;
    else if (distance <= occupiedDistance) reading = 1;
    else if (distance >= emptyDistance) reading = 0;
    if (reading == candidate[i]) stableCount[i]++;
    else { candidate[i] = reading; stableCount[i] = 1; }
    if (stableCount[i] >= 3) slots[i] = reading;
    delay(60); // Separate acoustic pulses to reduce sensor cross-talk.
  }
  char message[200];
  snprintf(message, sizeof(message),
    "{\"boot\":\"%s\",\"seq\":%lu,\"slots\":[%d,%d,%d]}",
    bootId, sequence++, slots[0], slots[1], slots[2]);
  mqtt.publish("parking/status", message, false);
}
