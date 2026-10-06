/**
 * Joy-Con per-side rumble via WebHID (browser).
 * macOS combined Joy-Con (L/R): report 0x10 = [counter, L×4, R×4].
 * Gamepad API cannot split L/R on that device; WebHID can.
 */
(function (global) {
  const VENDOR = 0x057e;
  const PID_LEFT = 0x2006;
  const PID_RIGHT = 0x2007;
  const PID_COMBINED = 0x200e;

  const NEUTRAL = new Uint8Array([0x00, 0x01, 0x40, 0x40]);
  const RUMBLE_MS = 140;

  const devices = { left: null, right: null, combined: null };
  let packetCounter = 0;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /** 4-byte HD rumble block (joy-con-webhid encoding). */
  function encodeRumbleBlock(lowFrequency, highFrequency, amplitude) {
    let hf = clamp(highFrequency, 81.75177, 1252.572266);
    let lf = clamp(lowFrequency, 40.875885, 626.286133);
    hf = (Math.round(32 * Math.log2(hf * 0.1)) - 96) * 4;
    lf = Math.round(32 * Math.log2(lf * 0.1)) - 64;
    const amp = clamp(amplitude, 0, 1);

    let p;
    if (amp === 0) {
      p = 0;
    } else if (amp < 0.117) {
      p = (Math.log2(amp * 1e3) * 32 - 96) / (5 - amp ** 2) - 1;
    } else if (amp < 0.23) {
      p = Math.log2(amp * 1e3) * 32 - 96 - 92;
    } else {
      p = (Math.log2(amp * 1e3) * 32 - 96) * 2 - 246;
    }

    let q = Math.round(p) * 0.5;
    const odd = q % 2;
    if (odd > 0) q -= 1;
    q = q >> 1;
    q += 64;
    if (odd > 0) q |= 0x8000;

    return new Uint8Array([
      hf & 0xff,
      (p + ((hf >> 8) & 0xff)) & 0xff,
      (lf + ((q >> 8) & 0xff)) & 0xff,
      q & 0xff
    ]);
  }

  function encodeBumper() {
    return encodeRumbleBlock(160, 320, 0.55);
  }

  function encodeTrigger() {
    return encodeRumbleBlock(320, 600, 1);
  }

  function nextPacket() {
    packetCounter = (packetCounter + 1) & 0x0f;
    return packetCounter;
  }

  async function enableVibration(device) {
    const data = new Uint8Array([
      0x00, 0x00, 0x01, 0x40, 0x40,
      0x00, 0x01, 0x40, 0x40,
      0x48, 0x01
    ]);
    await device.sendReport(0x01, data);
  }

  async function sendRumbleReport(device, leftBlock, rightBlock) {
    const data = new Uint8Array(9);
    data[0] = nextPacket();
    data.set(leftBlock, 1);
    data.set(rightBlock, 5);
    await device.sendReport(0x10, data);
  }

  async function sendNeutral(device) {
    await sendRumbleReport(device, NEUTRAL, NEUTRAL);
  }

  function hasRumbleOutput(device) {
    for (const col of device.collections || []) {
      for (const rep of col.outputReports || []) {
        if (rep.reportId === 0x10 || rep.reportId === 0x01) return true;
      }
    }
    return false;
  }

  function assignDevice(device) {
    if (device.productId === PID_COMBINED) devices.combined = device;
    else if (device.productId === PID_LEFT) devices.left = device;
    else if (device.productId === PID_RIGHT) devices.right = device;
  }

  async function openDevice(device) {
    if (!hasRumbleOutput(device)) return false;
    if (!device.opened) await device.open();
    await enableVibration(device);
    assignDevice(device);
    return true;
  }

  function isReady() {
    if (devices.combined) return true;
    return !!(devices.left && devices.right);
  }

  function getStatus() {
    if (devices.combined) {
      return { ready: true, label: "combined L+R", partial: false };
    }
    const hasL = !!devices.left;
    const hasR = !!devices.right;
    if (hasL && hasR) {
      return { ready: true, label: "L + R", partial: false };
    }
    if (hasL) {
      return { ready: false, label: "L only — grant R too", partial: true };
    }
    if (hasR) {
      return { ready: false, label: "R only — grant L too", partial: true };
    }
    return { ready: false, label: "off", partial: false };
  }

  function isJoyConHid(device) {
    return (
      device.vendorId === VENDOR &&
      [PID_LEFT, PID_RIGHT, PID_COMBINED].includes(device.productId)
    );
  }

  /** Prefer combined, then L, then R when multiple HID nodes exist. */
  function sortJoyCons(list) {
    const rank = (d) => {
      if (d.productId === PID_COMBINED) return 0;
      if (d.productId === PID_LEFT) return 1;
      if (d.productId === PID_RIGHT) return 2;
      return 3;
    };
    return list.slice().sort((a, b) => rank(a) - rank(b));
  }

  async function openAllGranted() {
    if (!navigator.hid) {
      throw new Error("WebHID not available (Chrome/Edge, HTTPS or localhost)");
    }

    devices.left = null;
    devices.right = null;
    devices.combined = null;

    const granted = await navigator.hid.getDevices();
    const joycons = sortJoyCons(granted.filter(isJoyConHid));

    for (const device of joycons) {
      try {
        await openDevice(device);
      } catch (_) {
        /* busy, wrong interface, or unplugged */
      }
    }
    return getStatus();
  }

  async function enableAll() {
    let status = await openAllGranted();
    if (status.ready) return status;

    const picked = await navigator.hid.requestDevice({
      filters: [
        { vendorId: VENDOR, productId: PID_COMBINED },
        { vendorId: VENDOR, productId: PID_LEFT },
        { vendorId: VENDOR, productId: PID_RIGHT }
      ],
      multiple: true
    });

    for (const device of picked) {
      try {
        await openDevice(device);
      } catch (_) {
        /* busy or wrong interface */
      }
    }

    return openAllGranted();
  }

  async function requestAccess() {
    return enableAll();
  }

  async function reconnectGranted() {
    if (!navigator.hid) return getStatus();
    try {
      return await openAllGranted();
    } catch (_) {
      return getStatus();
    }
  }

  function pickDevice(isLeft) {
    if (devices.combined) return devices.combined;
    return isLeft ? devices.left : devices.right;
  }

  async function playChannel(channel) {
    const ch = String(channel).toLowerCase();
    const isLeft = ch.startsWith("l");
    const isBumper = ch.endsWith("b");
    const active = isBumper ? encodeBumper() : encodeTrigger();

    if (devices.combined) {
      const left = isLeft ? active : NEUTRAL;
      const right = isLeft ? NEUTRAL : active;
      await sendRumbleReport(devices.combined, left, right);
      const route = isLeft ? "webhid-L" : "webhid-R";
      setTimeout(() => {
        if (devices.combined && devices.combined.opened) {
          sendNeutral(devices.combined).catch(() => {});
        }
      }, RUMBLE_MS);
      return route;
    }

    const dev = pickDevice(isLeft);
    if (!dev) return null;

    if (isLeft) {
      await sendRumbleReport(dev, active, NEUTRAL);
    } else {
      await sendRumbleReport(dev, NEUTRAL, active);
    }
    const route = isLeft ? "webhid-left" : "webhid-right";
    setTimeout(() => {
      if (dev.opened) sendNeutral(dev).catch(() => {});
    }, RUMBLE_MS);
    return route;
  }

  function describeRoute(channel) {
    const ch = String(channel).toLowerCase();
    const side = ch.startsWith("l") ? "left" : "right";
    const btn = ch.endsWith("b") ? "bumper" : "trigger";
    return `WebHID ${side} (${btn})`;
  }

  global.JoyConRumble = {
    enableAll,
    requestAccess,
    reconnectGranted,
    openAllGranted,
    isReady,
    getStatus,
    playChannel,
    describeRoute
  };
})(typeof window !== "undefined" ? window : globalThis);
