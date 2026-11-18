import React, { useEffect, useRef, useState } from "react";
import { CTRL_LABEL } from "../v2/ui/platform";

export type PebbleState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "working"
  | "asking"   // amber — waiting on your approval/authority
  | "done"     // green flash — job landed
  | "muted";   // mic muted — quiet, no chroma

// "thinking" is intentionally NOT locked — it should follow the cursor like
// idle, since thinking is a transient state where the user has no input
// affordance to interact with. Listening + speaking lock so bubble buttons
// stay clickable.
// Only speaking summons a bubble + grabs clicks. Listening is stationary — clicks pass
// through so you can keep working while you talk.
const LOCKED: ReadonlySet<PebbleState> = new Set(["speaking"]);

// True when the daemon spawned this page with ?native=1
const IS_NATIVE = typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("native") === "1";

export function Pebble() {
  const [state, setState] = useState<PebbleState>("idle");
  const stateRef = useRef<PebbleState>("idle");

  const pebbleRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Expose summon/dismiss globals so the sidecar (via webview Eval) can
  // drive the pebble's state from a global hotkey or other native trigger.
  // Only exposed in native mode — browser dev mode uses the in-page chord.
  useEffect(() => {
    if (!IS_NATIVE) return;
    (window as unknown as Record<string, unknown>).__pebble_summon = () => {
      setState("listening");
    };
    (window as unknown as Record<string, unknown>).__pebble_dismiss = () => {
      setState("idle");
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__pebble_summon;
      delete (window as unknown as Record<string, unknown>).__pebble_dismiss;
    };
  }, []);

  // Toggle whole-window click-through on state changes (Clicky-style):
  //   idle / thinking / working → clicks pass through (everywhere) so the
  //                                user never feels the pebble window
  //   listening / speaking      → window grabs clicks so bubble buttons
  //                                respond. Whole desktop is "frozen" while
  //                                the user has the bubble open.
  // Visibility is handled entirely by WebView2 transparency
  // (WEBVIEW2_DEFAULT_BACKGROUND_COLOR=0, set before process start) +
  // body { background: transparent }. No region masking — only the
  // explicitly painted pebble + bubble pixels render.
  useEffect(() => {
    if (!IS_NATIVE) return;
    type SidecarSetClickThrough = (ct: boolean) => Promise<unknown>;
    const fn = (window as unknown as { __sidecar_set_clickthrough?: SidecarSetClickThrough }).__sidecar_set_clickthrough;
    if (!fn) return;
    const interactive = state === "listening" || state === "speaking";
    fn(!interactive).catch(() => { /* sidecar may be down */ });
  }, [state]);

  useEffect(() => {
    // Summon chord: Ctrl + left click anywhere (Cmd on macOS).
    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      setState((s) => (s === "idle" ? "listening" : "idle"));
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && stateRef.current !== "idle") {
        setState("idle");
      }
    }

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const showBubble = state === "speaking";
  const cls =
    "pebble pebble--" + state + (LOCKED.has(state) ? " pebble--locked" : "");

  return (
    <>
      <div
        ref={pebbleRef}
        className={cls}
        onClick={() => setState((s) => (s === "idle" ? "listening" : "idle"))}
        role="button"
        tabIndex={0}
        aria-label="Ignatius Ultron Core"
      >
        {/* Ultron / APEX-UI Cybernetic Precision HUD */}
        <svg className="pebble-hud-svg" viewBox="0 0 100 100" aria-hidden="true">
          {/* Outer Compass & Tick Ring */}
          <circle cx="50" cy="50" r="47" className="hud-ring hud-ring-outer" />
          <circle cx="50" cy="50" r="44" className="hud-ring hud-ring-track" />
          <circle cx="50" cy="50" r="41" className="hud-ring hud-ring-radar" />

          {/* Compass Ticks (12 precision markers) */}
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => (
            <line
              key={deg}
              x1="50"
              y1="3"
              x2="50"
              y2={deg % 90 === 0 ? "8" : "6"}
              transform={`rotate(${deg} 50 50)`}
              className={`hud-tick ${deg % 90 === 0 ? "hud-tick-cardinal" : ""}`}
            />
          ))}

          {/* Concentric Audio Waveform Rings */}
          <circle cx="50" cy="50" r="36" className="hud-ring hud-wave hud-wave-1" />
          <circle cx="50" cy="50" r="31" className="hud-ring hud-wave hud-wave-2" />

          {/* Orbiting Agent Constellation Nodes (APEX Reasoning Web) */}
          <g className="hud-orbit-web">
            <circle cx="50" cy="18" r="2.2" className="hud-node hud-node-1" />
            <circle cx="78" cy="38" r="1.8" className="hud-node hud-node-2" />
            <circle cx="70" cy="74" r="2.0" className="hud-node hud-node-3" />
            <circle cx="30" cy="74" r="1.8" className="hud-node hud-node-4" />
            <circle cx="22" cy="38" r="2.2" className="hud-node hud-node-5" />
          </g>

          {/* Ultron Core Arc Reactor Center */}
          <circle cx="50" cy="50" r="24" className="hud-core-halo" />
          <circle cx="50" cy="50" r="18" className="hud-core-reactor" />
          <circle cx="50" cy="50" r="7" className="hud-core-pupil" />
        </svg>

        <span className="gd">
          <span className="in" />
          <span className="ring" />
        </span>
      </div>

      {showBubble && (
        <div ref={bubbleRef} className="pebble-thread">
          <div className="thread-header">
            <span className="thread-title">
              <span className="thread-hud-badge">ULTRON</span>
              IGNATIUS CORE
            </span>
            <button
              type="button"
              className="thread-dismiss"
              onClick={() => setState("idle")}
            >
              esc
            </button>
          </div>
          <div className="thread-body">
            <span className="thread-from">Ignatius</span>
            speaking…
          </div>
          <div className="thread-actions">
            <button
              type="button"
              className="thread-btn thread-btn--primary"
              onClick={() => setState("speaking")}
            >
              Speak it
            </button>
            <button
              type="button"
              className="thread-btn"
              onClick={() => setState("thinking")}
            >
              Think
            </button>
            <button
              type="button"
              className="thread-btn"
              onClick={() => setState("idle")}
            >
              Dismiss
            </button>
          </div>
          <div className="thread-hint">
            {/* ⌃ is a Mac keycap marking; a PC keyboard just says Ctrl. The
                binding takes either modifier (see the mousedown handler). */}
            <kbd>{CTRL_LABEL}</kbd>+click anywhere to summon · <kbd>esc</kbd> to dismiss
          </div>
        </div>
      )}
    </>
  );
}
