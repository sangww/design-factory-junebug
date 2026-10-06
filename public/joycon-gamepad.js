/**
 * Joy-Con detection for the Gamepad API (Chrome / Edge).
 * Names differ by OS; USB vendor 057e + product id is the reliable signal on Windows.
 */
(function (global) {
  const PID_LEFT = "2006";
  const PID_RIGHT = "2007";
  const PID_COMBINED = "200e";

  function idLower(id) {
    return (id || "").toLowerCase();
  }

  function nintendoProductId(id) {
    const m = idLower(id).match(/product:\s*([0-9a-f]{4})\b/);
    return m ? m[1] : null;
  }

  function isNintendoVendor(id) {
    return /vendor:\s*057e\b/.test(idLower(id));
  }

  function isJoyConName(id) {
    return /joy[- ]?con|nintendo\s+switch/i.test(id || "");
  }

  function isCombinedJoyConPairId(id) {
    if (!id) return false;
    const s = idLower(id);
    if (/l\s*\+\s*r|l\+r/.test(s)) return true;
    if (/l\s*\/\s*r|\(l\s*\/\s*r\)/.test(s)) return true;
    if (nintendoProductId(id) === PID_COMBINED) return true;
    if (/joy[- ]?con.*(l\s*\+\s*r|l\s*\/\s*r|\(l\+r\)|pair|combined)/i.test(id)) return true;
    return false;
  }

  function isLeftJoyConId(id) {
    if (!id || isCombinedJoyConPairId(id)) return false;
    const s = idLower(id);
    if (/\(l\)|\(left\)/.test(s)) return true;
    if (/joy[- ]?con.*\bleft\b/.test(s)) return true;
    if (nintendoProductId(id) === PID_LEFT) return true;
    return false;
  }

  function isRightJoyConId(id) {
    if (!id || isCombinedJoyConPairId(id)) return false;
    const s = idLower(id);
    if (/\(r\)|\(right\)/.test(s)) return true;
    if (/joy[- ]?con.*\bright\b/.test(s)) return true;
    if (nintendoProductId(id) === PID_RIGHT) return true;
    return false;
  }

  function getConnectedGamepads() {
    return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
  }

  function classifyGamepads(pads) {
    const list = pads || getConnectedGamepads();
    let combinedPad = list.find((p) => isCombinedJoyConPairId(p.id));
    let leftPad = list.find((p) => isLeftJoyConId(p.id));
    let rightPad = list.find((p) => isRightJoyConId(p.id));

    if (!combinedPad && list.length === 2) {
      const byPid = {};
      for (const p of list) {
        const pid = nintendoProductId(p.id);
        if (pid) byPid[pid] = p;
      }
      if (byPid[PID_LEFT] && byPid[PID_RIGHT]) {
        leftPad = byPid[PID_LEFT];
        rightPad = byPid[PID_RIGHT];
      }
    }

    if (!combinedPad && !leftPad && !rightPad && list.length === 1) {
      const only = list[0];
      const pid = nintendoProductId(only.id);
      if (pid === PID_COMBINED || (isNintendoVendor(only.id) && isJoyConName(only.id))) {
        combinedPad = only;
      }
    }

    if (combinedPad) {
      leftPad = combinedPad;
      rightPad = combinedPad;
    }

    return { combinedPad, leftPad, rightPad, pads: list };
  }

  function pickGamepadForChannel(channel, pads) {
    const list = pads || getConnectedGamepads();
    const { combinedPad, leftPad, rightPad } = classifyGamepads(list);
    if (combinedPad) return combinedPad;
    const ch = String(channel).toLowerCase();
    if (ch === "lb" || ch === "lt") {
      return leftPad || list[0] || null;
    }
    return rightPad || list[0] || null;
  }

  function formatGamepadDebugLine(pad, index) {
    const kind = isCombinedJoyConPairId(pad.id)
      ? "combined"
      : isLeftJoyConId(pad.id)
        ? "left"
        : isRightJoyConId(pad.id)
          ? "right"
          : "unrecognized";
    const pid = nintendoProductId(pad.id);
    const idShort = (pad.id || "(no id)").slice(0, 80);
    const suffix = (pad.id || "").length > 80 ? "…" : "";
    const pidNote = pid ? ` · pid ${pid}` : "";
    return `${index}: [${kind}] ${idShort}${suffix}${pidNote}`;
  }

  function formatGamepadDebug(pads) {
    const list = pads || getConnectedGamepads();
    if (!list.length) {
      return "No gamepads seen by the browser yet (getGamepads is empty).";
    }
    return list.map((p, i) => formatGamepadDebugLine(p, i)).join("\n");
  }

  global.JoyConGamepad = {
    PID_LEFT,
    PID_RIGHT,
    PID_COMBINED,
    nintendoProductId,
    isCombinedJoyConPairId,
    isLeftJoyConId,
    isRightJoyConId,
    getConnectedGamepads,
    classifyGamepads,
    pickGamepadForChannel,
    formatGamepadDebug
  };
})(typeof window !== "undefined" ? window : globalThis);
