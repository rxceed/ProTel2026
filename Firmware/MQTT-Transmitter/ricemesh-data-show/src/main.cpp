#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ================= WIFI CONFIG =================
const char* WIFI_SSID = "RXHSPT";
const char* WIFI_PASS = "yayayasayasetuju";

// ================= MQTT CONFIG =================
const char* MQTT_BROKER    = "10.58.34.24";
const uint16_t MQTT_PORT   = 1883;
const char* MQTT_USER      = "";
const char* MQTT_PASS      = "";
const char* MQTT_CLIENT_ID = "esp8266-gateway";

const char* TOPIC_ALL  = "topic_awd1_67";
const char* TOPIC_BASE = "topic_awd1_67/sensors";

// ================= UART CONFIG =================
// Samakan dengan baudrate UART STM32
const uint32_t UART_BAUD = 115200;

// ================= OBJECTS =================
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
ESP8266WebServer server(80);

// ================= STATE =================
String rxLine = "";
String latestRaw = "";
String latestJson = "{}";

bool latestJsonValid = false;

unsigned long lastRxMillis = 0;
unsigned long lastMqttPublishMillis = 0;
unsigned long publishCount = 0;
unsigned long invalidCount = 0;

// ================= FUNCTION DECLARATION =================
void debugPrintBootInfo();
void connectWiFi();
void reconnectMQTT();
void readSTM32Serial();
void processIncomingLine(String line);
bool isLikelyJson(const String& s);
void publishPayload(const String& payload);
void publishParsedTopics(const String& payload);
void setupHttpServer();
void handleRoot();
void handleJson();
void handleStatus();

// ================= SETUP =================
void setup() {
  Serial.begin(UART_BAUD);
  Serial.setDebugOutput(false);
  delay(1000);

  debugPrintBootInfo();

  Serial.println("[INIT] Connecting to WiFi...");
  connectWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WIFI] Connected");
    Serial.print("[WIFI] IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[WIFI] Failed to connect within timeout");
  }

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setBufferSize(512);

  Serial.println("[INIT] MQTT configured");

  setupHttpServer();

  Serial.println("[HTTP] Web server started on port 80");
  Serial.println("[INIT] Setup complete");
  Serial.println("[INIT] Waiting for STM32 JSON via RX...");
  Serial.println();
}

// ================= LOOP =================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (!mqtt.connected()) {
    reconnectMQTT();
  }

  mqtt.loop();
  server.handleClient();
  readSTM32Serial();
}

// ================= DEBUG BOOT INFO =================
void debugPrintBootInfo() {
  Serial.println();
  Serial.println("====================================");
  Serial.println(" ESP8266 STM32 MQTT Gateway Booting ");
  Serial.println("====================================");

  Serial.print("[BOOT] UART Baud       : ");
  Serial.println(UART_BAUD);

  Serial.print("[BOOT] WiFi SSID       : ");
  Serial.println(WIFI_SSID);

  Serial.print("[BOOT] MQTT Broker     : ");
  Serial.print(MQTT_BROKER);
  Serial.print(":");
  Serial.println(MQTT_PORT);

  Serial.print("[BOOT] MQTT Client ID  : ");
  Serial.println(MQTT_CLIENT_ID);

  Serial.print("[BOOT] Topic All       : ");
  Serial.println(TOPIC_ALL);

  Serial.print("[BOOT] Topic Base      : ");
  Serial.println(TOPIC_BASE);

  Serial.println("====================================");
}

// ================= WIFI =================
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long startAttempt = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    Serial.print(".");
    delay(500);
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WIFI] Connection OK");
  } else {
    Serial.println("[WIFI] Connection FAILED");
  }
}

// ================= MQTT =================
void reconnectMQTT() {
  static unsigned long lastAttempt = 0;

  if (millis() - lastAttempt < 3000) {
    return;
  }

  lastAttempt = millis();

  Serial.println("[MQTT] Connecting...");

  bool connected;

  if (strlen(MQTT_USER) > 0) {
    connected = mqtt.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS);
  } else {
    connected = mqtt.connect(MQTT_CLIENT_ID);
  }

  if (connected) {
    Serial.println("[MQTT] Connected");
    mqtt.publish("topic_awd1_67/status", "esp8266-gateway-online", true);
  } else {
    Serial.print("[MQTT] Failed, rc=");
    Serial.println(mqtt.state());
  }
}

// ================= UART RX FROM STM32 =================
void readSTM32Serial() {
  while (Serial.available()) {
    char c = (char)Serial.read();

    if (c == '\n') {
      rxLine.trim();

      if (rxLine.length() > 0) {
        processIncomingLine(rxLine);
      }

      rxLine = "";
    } 
    else if (c != '\r') {
      rxLine += c;

      // Safety kalau STM32 tidak mengirim newline
      if (rxLine.length() > 500) {
        rxLine = "";
        invalidCount++;
        Serial.println("[UART] RX buffer overflow, line cleared");
      }
    }
  }
}

// ================= PROCESS INCOMING UART LINE =================
void processIncomingLine(String line) {
  latestRaw = line;
  lastRxMillis = millis();

  Serial.print("[UART RX] ");
  Serial.println(line);

  // Kalau STM32 mengirim prefix [JSON]
  if (line.startsWith("[JSON]")) {
    line = line.substring(6);
    line.trim();
  }

  if (!isLikelyJson(line)) {
    latestJsonValid = false;
    invalidCount++;

    Serial.println("[JSON] Invalid format, not published");
    return;
  }

  StaticJsonDocument<768> doc;
  DeserializationError error = deserializeJson(doc, line);

  if (error) {
    latestJsonValid = false;
    invalidCount++;

    Serial.print("[JSON] Parse failed: ");
    Serial.println(error.c_str());
    return;
  }

  latestJson = line;
  latestJsonValid = true;

  Serial.println("[JSON] Valid payload received");

  publishPayload(latestJson);
  publishParsedTopics(latestJson);
}

// ================= JSON BASIC CHECK =================
bool isLikelyJson(const String& s) {
  return s.startsWith("{") && s.endsWith("}");
}

// ================= MQTT PUBLISH MAIN PAYLOAD =================
void publishPayload(const String& payload) {
  if (!mqtt.connected()) {
    Serial.println("[MQTT] Not connected, payload not published");
    return;
  }

  bool ok = mqtt.publish(TOPIC_ALL, payload.c_str(), false);

  if (ok) {
    publishCount++;
    lastMqttPublishMillis = millis();

    Serial.print("[MQTT] Published to ");
    Serial.print(TOPIC_ALL);
    Serial.print(" | Count: ");
    Serial.println(publishCount);
  } else {
    Serial.println("[MQTT] Publish FAILED");
  }
}

// ================= MQTT PUBLISH PER SENSOR TOPIC =================
void publishParsedTopics(const String& payload) {
  if (!mqtt.connected()) {
    return;
  }

  StaticJsonDocument<768> doc;
  DeserializationError error = deserializeJson(doc, payload);

  if (error) {
    return;
  }

  char topic[96];
  char value[32];

  // Format:
  // {"device":[{"id":"N1","d":120},{"id":"N2","d":98},{"id":"N3","d":155}],"temperature":29.63,"pressure":1007.12}
  if (doc["device"].is<JsonArray>()) {
    JsonArray arr = doc["device"].as<JsonArray>();

    for (JsonObject dev : arr) {
      const char* id = dev["id"] | "";
      int d = dev["d"] | 0;

      if (strlen(id) > 0) {
        snprintf(topic, sizeof(topic), "%s/%s/d", TOPIC_BASE, id);
        snprintf(value, sizeof(value), "%d", d);

        mqtt.publish(topic, value, false);

        Serial.print("[MQTT] ");
        Serial.print(topic);
        Serial.print(" = ");
        Serial.println(value);
      }
    }

    if (!doc["temperature"].isNull()) {
      float t = doc["temperature"];
      snprintf(topic, sizeof(topic), "%s/bmp280/temperature", TOPIC_BASE);
      snprintf(value, sizeof(value), "%.2f", t);

      mqtt.publish(topic, value, false);

      Serial.print("[MQTT] ");
      Serial.print(topic);
      Serial.print(" = ");
      Serial.println(value);
    }

    if (!doc["pressure"].isNull()) {
      float p = doc["pressure"];
      snprintf(topic, sizeof(topic), "%s/bmp280/pressure", TOPIC_BASE);
      snprintf(value, sizeof(value), "%.2f", p);

      mqtt.publish(topic, value, false);

      Serial.print("[MQTT] ");
      Serial.print(topic);
      Serial.print(" = ");
      Serial.println(value);
    }
  }

  // Format alternatif:
  // {"N1":120,"N2":98,"N3":155,"temperature":29.63,"pressure":1007.12}
  else {
    const char* nodes[] = {"N1", "N2", "N3"};

    for (int i = 0; i < 3; i++) {
      if (!doc[nodes[i]].isNull()) {
        int d = doc[nodes[i]];

        snprintf(topic, sizeof(topic), "%s/%s/d", TOPIC_BASE, nodes[i]);
        snprintf(value, sizeof(value), "%d", d);

        mqtt.publish(topic, value, false);

        Serial.print("[MQTT] ");
        Serial.print(topic);
        Serial.print(" = ");
        Serial.println(value);
      }
    }

    if (!doc["temperature"].isNull()) {
      float t = doc["temperature"];

      snprintf(topic, sizeof(topic), "%s/bmp280/temperature", TOPIC_BASE);
      snprintf(value, sizeof(value), "%.2f", t);

      mqtt.publish(topic, value, false);

      Serial.print("[MQTT] ");
      Serial.print(topic);
      Serial.print(" = ");
      Serial.println(value);
    }

    if (!doc["pressure"].isNull()) {
      float p = doc["pressure"];

      snprintf(topic, sizeof(topic), "%s/bmp280/pressure", TOPIC_BASE);
      snprintf(value, sizeof(value), "%.2f", p);

      mqtt.publish(topic, value, false);

      Serial.print("[MQTT] ");
      Serial.print(topic);
      Serial.print(" = ");
      Serial.println(value);
    }
  }
}

// ================= HTTP SERVER =================
void setupHttpServer() {
  server.on("/", handleRoot);
  server.on("/json", handleJson);
  server.on("/status", handleStatus);

  server.begin();
}

void handleRoot() {
  String html = "";

  html += "<!DOCTYPE html><html><head>";
  html += "<meta charset='UTF-8'>";
  html += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
  html += "<meta http-equiv='refresh' content='2'>";
  html += "<title>ESP8266 Gateway Monitor</title>";

  html += "<style>";
  html += "body{font-family:Arial;background:#111;color:#eee;padding:20px;}";
  html += ".card{background:#1e1e1e;padding:16px;margin-bottom:16px;border-radius:10px;}";
  html += "pre{background:#000;padding:12px;border-radius:8px;overflow:auto;}";
  html += ".ok{color:#57d957;}.bad{color:#ff5c5c;}.warn{color:#ffd35c;}";
  html += "a{color:#80c7ff;}";
  html += "</style>";

  html += "</head><body>";

  html += "<h2>ESP8266 STM32 MQTT Gateway</h2>";

  html += "<div class='card'>";
  html += "<h3>Status</h3>";

  html += "WiFi: ";
  html += (WiFi.status() == WL_CONNECTED) ? "<span class='ok'>Connected</span>" : "<span class='bad'>Disconnected</span>";

  html += "<br>IP: ";
  html += WiFi.localIP().toString();

  html += "<br>MQTT: ";
  html += mqtt.connected() ? "<span class='ok'>Connected</span>" : "<span class='bad'>Disconnected</span>";

  html += "<br>MQTT Broker: ";
  html += MQTT_BROKER;

  html += "<br>Topic All: ";
  html += TOPIC_ALL;

  html += "<br>Publish Count: ";
  html += String(publishCount);

  html += "<br>Invalid Count: ";
  html += String(invalidCount);

  html += "<br>Last RX Ago: ";
  if (lastRxMillis == 0) {
    html += "No data yet";
  } else {
    html += String((millis() - lastRxMillis) / 1000);
    html += " s";
  }

  html += "</div>";

  html += "<div class='card'>";
  html += "<h3>Latest JSON Payload</h3>";
  html += latestJsonValid ? "<span class='ok'>Valid JSON</span>" : "<span class='warn'>No valid JSON / invalid last data</span>";
  html += "<pre>";
  html += latestJson;
  html += "</pre>";
  html += "</div>";

  html += "<div class='card'>";
  html += "<h3>Latest Raw UART Line</h3>";
  html += "<pre>";
  html += latestRaw;
  html += "</pre>";
  html += "</div>";

  html += "<div class='card'>";
  html += "<h3>Endpoints</h3>";
  html += "<a href='/json'>/json</a><br>";
  html += "<a href='/status'>/status</a>";
  html += "</div>";

  html += "</body></html>";

  server.send(200, "text/html", html);
}

void handleJson() {
  server.send(200, "application/json", latestJson);
}

void handleStatus() {
  String json = "{";

  json += "\"wifi\":";
  json += (WiFi.status() == WL_CONNECTED) ? "true" : "false";

  json += ",\"ip\":\"";
  json += WiFi.localIP().toString();
  json += "\"";

  json += ",\"mqtt\":";
  json += mqtt.connected() ? "true" : "false";

  json += ",\"publish_count\":";
  json += String(publishCount);

  json += ",\"invalid_count\":";
  json += String(invalidCount);

  json += ",\"last_rx_ms_ago\":";
  if (lastRxMillis == 0) {
    json += "-1";
  } else {
    json += String(millis() - lastRxMillis);
  }

  json += "}";

  server.send(200, "application/json", json);
}


// #include <ESP8266WiFi.h>

// void setup() {
//   Serial.begin(115200);
//   Serial.println();
//   Serial.println("ESP8266 Booting...");

//   WiFi.mode(WIFI_STA);
//   WiFi.begin("RXHSPT", "yayayasayasetuju");

//   Serial.print("Connecting to WiFi");
//   while (WiFi.status() != WL_CONNECTED) {
//     Serial.print(".");
//     delay(500);
//   }
//   Serial.println();
//   Serial.println("WiFi Connected!");
//   Serial.print("IP Address: ");
//   Serial.println(WiFi.localIP());
// }

// void loop() {
//   // Nothing to do in the main loop for this test
// }