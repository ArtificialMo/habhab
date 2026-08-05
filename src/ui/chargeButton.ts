/**
 * The charge control (§2.6): a large arcade button that communicates charge level
 * and cooldown at a glance, sized for one-handed play.
 *
 * Built from DOM rather than in-scene UI — it is a fixed screen-space control that
 * never needs to be occluded, lit or shaken with the world, and keeping it out of
 * the render loop means it costs nothing per frame beyond two style writes.
 */
export interface ChargeButton {
  element: HTMLElement;
  /** @param aimScreenDeg heading to point the needle at, or null to hide it. */
  update(charge: number, cooldown: number, aimScreenDeg: number | null): void;
}

export function buildChargeButton(root: HTMLElement): ChargeButton {
  const style = document.createElement("style");
  style.textContent = `
    #chargeBtn {
      position: absolute;
      right: 6%;
      bottom: 7%;
      width: 25vmin;
      height: 25vmin;
      max-width: 168px;
      max-height: 168px;
      border-radius: 50%;
      z-index: 4;
      touch-action: none;
      display: grid;
      place-items: center;
      transition: transform .08s ease-out;
      -webkit-user-select: none;
      user-select: none;
    }
    #chargeBtn .ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: conic-gradient(
        #ffd23f calc(var(--charge) * 360deg),
        rgba(255,255,255,.16) 0
      );
      /* Cooldown drains the same ring in a duller colour, so one control shows
         both states without adding a second thing to read. */
      opacity: 1;
    }
    #chargeBtn.cooling .ring {
      background: conic-gradient(
        rgba(255,255,255,.34) calc(var(--cooldown) * 360deg),
        rgba(255,255,255,.1) 0
      );
    }
    #chargeBtn .core {
      position: absolute;
      inset: 11%;
      border-radius: 50%;
      background: radial-gradient(circle at 34% 28%, #ff7a4d, #d63414 62%, #a51f0c);
      box-shadow:
        inset 0 -6px 12px rgba(0,0,0,.35),
        inset 0 4px 10px rgba(255,255,255,.28),
        0 6px 18px rgba(0,0,0,.35);
      display: grid;
      place-items: center;
      color: #fff5e8;
      font: 800 3.1vmin/1 ui-monospace, Menlo, Consolas, monospace;
      letter-spacing: .06em;
      text-shadow: 0 2px 3px rgba(0,0,0,.45);
    }
    #chargeBtn.cooling .core { filter: saturate(.35) brightness(.72); }
    /* Physical depression on press, and a swell as the charge tops out. */
    #chargeBtn.held { transform: scale(.94); }
    #chargeBtn.full .core { animation: chargeFull .18s infinite alternate; }
    @keyframes chargeFull {
      from { box-shadow: inset 0 -6px 12px rgba(0,0,0,.35), 0 0 0 0 rgba(255,210,63,.0), 0 6px 18px rgba(0,0,0,.35); }
      to   { box-shadow: inset 0 -6px 12px rgba(0,0,0,.35), 0 0 0 8px rgba(255,210,63,.28), 0 6px 18px rgba(0,0,0,.35); }
    }
  `;
  document.head.appendChild(style);

  const el = document.createElement("div");
  el.id = "chargeBtn";
  el.style.setProperty("--charge", "0");
  el.style.setProperty("--cooldown", "0");

  const ring = document.createElement("div");
  ring.className = "ring";
  const core = document.createElement("div");
  core.className = "core";
  core.textContent = "RAM";
  el.append(ring, core);
  root.appendChild(el);

  el.addEventListener("pointerdown", () => el.classList.add("held"));
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
    el.addEventListener(ev, () => el.classList.remove("held"));
  }

  // Direction needle. A mouse user aims by dragging from this button, so the
  // heading has to be legible here as well as out at the car.
  const needle = document.createElement("div");
  needle.style.cssText = `position:absolute;left:50%;top:50%;width:7px;height:44%;
    margin-left:-3.5px;transform-origin:50% 100%;border-radius:4px;opacity:0;
    background:linear-gradient(to top,rgba(255,210,63,0),#ffd23f 50%,#fff6d5);
    pointer-events:none;transition:opacity .1s linear;z-index:3;`;
  el.appendChild(needle);

  return {
    element: el,
    update(charge: number, cooldown: number, aimScreenDeg: number | null) {
      el.style.setProperty("--charge", charge.toFixed(3));
      el.style.setProperty("--cooldown", Math.max(0, cooldown).toFixed(3));
      el.classList.toggle("cooling", cooldown > 0.001);
      el.classList.toggle("full", charge >= 0.995);
      if (aimScreenDeg === null) {
        needle.style.opacity = "0";
      } else {
        needle.style.opacity = "1";
        needle.style.transform = `rotate(${aimScreenDeg}deg)`;
      }
    },
  };
}
