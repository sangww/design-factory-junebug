#include "Adafruit_TinyUSB.h"
#include <bluefruit.h>

// Transistor haptic motor on D3 (same wiring as xiao_haptic.ino).
const int HAPTIC_PIN = D3;

// Nordic UART Service (BLEUart) — matches public/nrf-ble.js Web Bluetooth client.
// Advertised as HapticXiao-XXXX where XXXX = last 4 hex digits of the BLE address.
char deviceName[20] = "HapticXiao-????";
BLEUart bleuart;

void pulseHaptic(uint8_t duty, int duration) {
  analogWrite(HAPTIC_PIN, duty);
  delay(duration);
  analogWrite(HAPTIC_PIN, 0);
}

void triggerFromCommand(uint8_t cmd) {
  // Same semantics as the USB prototype: '1' = strong, '2' = soft.
  if (cmd == '1') {
    pulseHaptic(255, 800);
  } else if (cmd == '2') {
    pulseHaptic(255, 120);
  }
}

void buildDeviceName() {
  uint8_t mac[6] = {0};
  Bluefruit.getAddr(mac);
  snprintf(deviceName, sizeof(deviceName), "HapticXiao-%02X%02X", mac[4], mac[5]);
}

void startAdvertising() {
  // Match Adafruit bleuart peripheral layout — name in scan response, NUS in adv packet.
  Bluefruit.Advertising.clearData();
  Bluefruit.ScanResponse.clearData();

  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(bleuart);
  Bluefruit.ScanResponse.addName();

  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(32, 244);
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);
}

void setup() {
  Serial.begin(115200);
  pinMode(HAPTIC_PIN, OUTPUT);
  analogWrite(HAPTIC_PIN, 0);

  Bluefruit.begin();
  Bluefruit.setTxPower(4);
  buildDeviceName();
  Bluefruit.setName(deviceName);

  bleuart.begin();
  startAdvertising();

  uint8_t mac[6] = {0};
  Bluefruit.getAddr(mac);
  Serial.print("BLE ready as ");
  Serial.println(deviceName);
  Serial.printf("MAC %02X:%02X:%02X:%02X:%02X:%02X\n",
    mac[5], mac[4], mac[3], mac[2], mac[1], mac[0]);
  Serial.println("Advertising NUS 6e400001-... (use nRF Connect or /nrf page)");
}

void loop() {
  while (bleuart.available()) {
    triggerFromCommand((uint8_t)bleuart.read());
  }
}
