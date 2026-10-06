/**
 * XIAO nRF52840 haptic modules via Web Bluetooth (Chrome/Edge, HTTPS or localhost).
 * Firmware: arduino/xiao_haptic_ble — Nordic UART RX characteristic, bytes '1' / '2'.
 */
(function (global) {
  const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  const NAME_PREFIX = "HapticXiao";
  const STORAGE_KEY = "haptic-nrf-assignments";

  const STRONG = 0x31; // '1'
  const SOFT = 0x32; // '2'

  /** @type {Map<string, { device: BluetoothDevice, server: BluetoothRemoteGATTServer, rx: BluetoothRemoteGATTCharacteristic, assignment: string }>} */
  const connected = new Map();

  function isSupported() {
    return !!(navigator.bluetooth && typeof navigator.bluetooth.requestDevice === "function");
  }

  function loadAssignments() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_e) {
      return {};
    }
  }

  function saveAssignments(map) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (_e) {
      // ignore quota errors
    }
  }

  function persistAssignment(deviceId, assignment) {
    const all = loadAssignments();
    if (assignment) all[deviceId] = assignment;
    else delete all[deviceId];
    saveAssignments(all);
  }

  function storedAssignment(deviceId) {
    return loadAssignments()[deviceId] || "";
  }

  /** Human label from advertised name, e.g. HapticXiao-A3F2 → A3F2. */
  function nameSuffix(name) {
    const m = String(name || "").match(/^HapticXiao-([0-9A-Fa-f]{4})$/);
    return m ? m[1].toUpperCase() : "";
  }

  function displayLabel(name) {
    const suffix = nameSuffix(name);
    return suffix ? `HapticXiao-${suffix}` : (name || NAME_PREFIX);
  }

  function channelSide(channel) {
    const ch = String(channel).toLowerCase();
    if (ch === "lt" || ch === "lb") return "L";
    if (ch === "rt" || ch === "rb") return "R";
    return null;
  }

  function channelIntensity(channel) {
    const ch = String(channel).toLowerCase();
    if (ch === "lt" || ch === "rt") return STRONG;
    if (ch === "lb" || ch === "rb") return SOFT;
    return STRONG;
  }

  async function connectGatt(device) {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(NUS_SERVICE);
    const rx = await service.getCharacteristic(NUS_RX);
    return { server, rx };
  }

  async function addDevice(device) {
    const id = device.id;
    if (connected.has(id)) return connected.get(id);

    const { server, rx } = await connectGatt(device);
    const entry = {
      device,
      server,
      rx,
      assignment: storedAssignment(id)
    };
    connected.set(id, entry);

    device.addEventListener("gattserverdisconnected", () => {
      connected.delete(id);
      if (typeof global.onNrfBleChange === "function") global.onNrfBleChange();
    });

    if (typeof global.onNrfBleChange === "function") global.onNrfBleChange();
    return entry;
  }

  async function requestDevice() {
    if (!isSupported()) {
      throw new Error("Web Bluetooth not available (use Chrome or Edge on HTTPS or localhost)");
    }
    // Prefer service UUID — more reliable than namePrefix when name is in scan response only.
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [NUS_SERVICE] },
        { namePrefix: NAME_PREFIX }
      ],
      optionalServices: [NUS_SERVICE]
    });
    return addDevice(device);
  }

  async function reconnectGranted() {
    if (!isSupported()) return [];
    const granted = await navigator.bluetooth.getDevices();
    const out = [];
    for (const device of granted) {
      if (device.name && !device.name.startsWith(NAME_PREFIX)) continue;
      try {
        out.push(await addDevice(device));
      } catch (_e) {
        // device may be off or out of range
      }
    }
    return out;
  }

  async function writePulse(rx, byte) {
    const payload = new Uint8Array([byte]);
    try {
      await rx.writeValueWithoutResponse(payload);
    } catch (_e) {
      await rx.writeValue(payload);
    }
  }

  async function pulseDevice(entry, intensityByte) {
    if (!entry || !entry.rx) return false;
    try {
      await writePulse(entry.rx, intensityByte);
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function pulseChannel(channel) {
    const side = channelSide(channel);
    if (!side) return { sent: 0, side: null };
    const intensity = channelIntensity(channel);
    let sent = 0;
    for (const entry of connected.values()) {
      if (entry.assignment !== side) continue;
      if (await pulseDevice(entry, intensity)) sent += 1;
    }
    return { sent, side, intensity: intensity === STRONG ? "strong" : "soft" };
  }

  async function testDevice(deviceId, intensity) {
    const entry = connected.get(deviceId);
    if (!entry) return false;
    const byte = intensity === "soft" ? SOFT : STRONG;
    return pulseDevice(entry, byte);
  }

  function setAssignment(deviceId, assignment) {
    const entry = connected.get(deviceId);
    const value = assignment === "L" || assignment === "R" ? assignment : "";
    if (entry) entry.assignment = value;
    persistAssignment(deviceId, value);
    if (typeof global.onNrfBleChange === "function") global.onNrfBleChange();
  }

  function listDevices() {
    return [...connected.values()].map((entry) => {
      const name = entry.device.name || NAME_PREFIX;
      return {
        id: entry.device.id,
        name,
        label: displayLabel(name),
        suffix: nameSuffix(name),
        assignment: entry.assignment || "",
        connected: !!(entry.device.gatt && entry.device.gatt.connected)
      };
    });
  }

  function disconnectDevice(deviceId) {
    const entry = connected.get(deviceId);
    if (!entry) return;
    if (entry.device.gatt && entry.device.gatt.connected) {
      entry.device.gatt.disconnect();
    }
    connected.delete(deviceId);
    if (typeof global.onNrfBleChange === "function") global.onNrfBleChange();
  }

  global.NrfBle = {
    NUS_SERVICE,
    NAME_PREFIX,
    isSupported,
    requestDevice,
    reconnectGranted,
    pulseChannel,
    testDevice,
    setAssignment,
    listDevices,
    disconnectDevice,
    channelSide,
    channelIntensityLabel(channel) {
      return channelIntensity(channel) === STRONG ? "strong" : "soft";
    },
    displayLabel,
    nameSuffix
  };
})(window);
