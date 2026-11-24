"use strict";

/* =====================================================================
   Triancle Studio - "Relay Ascent" showcase game
   A small obby with two puzzles, a moving platform, then the relay pads,
   the door and the trophy. Quiet slate/brass palette, no neon.

     Studio > Home > Open a Template > Relay Ascent
   ===================================================================== */
function studioShowcaseMap() {
  let seqCounter = 0;
  const nextId = prefix => prefix + (++seqCounter).toString(36) + Math.random().toString(36).slice(2, 5);
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const part = (sx, sy, sz, x, y, z, hex, name, material, texture) =>
    [sx, sy, sz, x, y, z, I.slice(), hex, 0, 1, 1, material || "Smooth Plastic", texture || "Smooth", name, 1];

  const parts = [
    part(20, 1, 20, 0, 6, 40, 0x6b6f74, "Start"),
    part(6, 1, 6, 0, 6, 24, 0x6f7378, "Step1", "Plastic", "Studs"),
    part(5, 1, 5, -5, 7, 12, 0x6f7378, "Step2", "Plastic", "Studs"),
    part(5, 1, 5, 5, 8, 0, 0x6f7378, "Step3", "Plastic", "Studs"),
    part(5, 1, 5, 0, 9, -12, 0x6f7378, "Step4", "Plastic", "Studs"),
    part(2, 1, 24, 0, 9, -26, 0x5f646a, "Beam"),
    part(18, 1, 18, 0, 9, -48, 0x6b6f74, "SequenceFloor"),
    part(6, 0.6, 6, -6, 9.3, -44, 0x3f5468, "SeqB"),
    part(6, 0.6, 6, 0, 9.3, -44, 0x6b3f3a, "SeqR"),
    part(6, 0.6, 6, 6, 9.3, -44, 0x3f5a44, "SeqG"),
    part(12, 8, 1, 0, 13.5, -57.5, 0x7a6a52, "Gate"),
    part(10, 1, 10, 0, 10, -66, 0x7a6a52, "Platform"),
    part(20, 1, 20, 0, 10, -84, 0x6b6f74, "FinalFloor"),
    part(6, 0.6, 6, -7, 10.3, -78, 0x6f7378, "ChargeA", "Plastic", "Studs"),
    part(6, 0.6, 6, 0, 10.3, -78, 0x6f7378, "ChargeB", "Plastic", "Studs"),
    part(6, 0.6, 6, 7, 10.3, -78, 0x6f7378, "ChargeC", "Plastic", "Studs"),
    part(10, 8, 1, 0, 14, -93.5, 0x7a6a52, "Door"),
    part(12, 1, 12, 0, 10, -100, 0x5f646a, "Alcove"),
    part(4, 1.2, 4, 0, 10.6, -101, 0x5b5147, "Pedestal"),
    part(3, 3, 3, 0, 13, -101, 0xc9a96a, "Trophy"),
  ];

  /* ---- GUI defaults (kept in step with guiDefaults in editor.js) ---- */
  const BASE = {
    Position: [0, 0, 0, 0], Size: [0, 200, 0, 100], AnchorPoint: [0, 0], Rotation: 0,
    BackgroundColor3: "#a3a2a5", BackgroundTransparency: 0,
    BorderSizePixel: 1, BorderColor3: "#1b2a35",
    Visible: true, ZIndex: 1, ClipsDescendants: false,
  };
  const DEFAULTS = {
    ScreenGui: { Enabled: true, DisplayOrder: 10, IgnoreGuiInset: false, ResetOnSpawn: true, ZIndexBehavior: "Sibling", ClipToDeviceSafeArea: true },
    Frame: BASE,
    TextLabel: Object.assign({}, BASE, {
      Size: [0, 200, 0, 50], Text: "TextLabel", TextColor3: "#000000", TextSize: 14, Font: "SourceSans",
      TextScaled: false, TextWrapped: false, TextXAlignment: "Center", TextYAlignment: "Center",
      RichText: false, LineHeight: 1, TextTransparency: 0, TextStrokeTransparency: 1, TextStrokeColor3: "#000000",
    }),
    TextButton: Object.assign({}, BASE, {
      Size: [0, 200, 0, 50], Text: "Button", TextColor3: "#000000", TextSize: 14, Font: "SourceSans",
      TextScaled: false, TextWrapped: false, TextXAlignment: "Center", TextYAlignment: "Center",
      RichText: false, LineHeight: 1, TextTransparency: 0, TextStrokeTransparency: 1, TextStrokeColor3: "#000000",
    }),
    ImageLabel: Object.assign({}, BASE, { Image: "", ImageColor3: "#ffffff", ImageTransparency: 0, ScaleType: "Stretch", BackgroundTransparency: 1 }),
    Folder: { Enabled: true },
  };

  const node = (cls, name, props, children) => ({
    id: nextId("g"),
    class: cls,
    name,
    props: Object.assign({}, DEFAULTS[cls], props || {}),
    children: children || [],
  });

  const script = (cls, name, blocks) => ({
    id: nextId("s"),
    class: cls,
    name,
    props: {},
    children: [],
    blocks,
  });

  const blk = (type, args, body, elseBody) => {
    const block = { id: nextId("b"), type, args: args || {} };
    if (body) block.body = body;
    if (elseBody) block.elseBody = elseBody;
    return block;
  };

  const resetPads = () => [
    blk("partColor", { part: "ChargeA", color: "#6f7378" }),
    blk("partColor", { part: "ChargeB", color: "#6f7378" }),
    blk("partColor", { part: "ChargeC", color: "#6f7378" }),
    blk("setProp", { target: "Pip1", prop: "BackgroundColor3", value: "#3a3f45" }),
    blk("setProp", { target: "Pip2", prop: "BackgroundColor3", value: "#3a3f45" }),
    blk("setProp", { target: "Pip3", prop: "BackgroundColor3", value: "#3a3f45" }),
    blk("setProp", { target: "Charge", prop: "TextColor3", value: "#d9c9a3" }),
  ];

  const resetSequence = () => [
    blk("setVar", { var: "seq", value: "0" }),
    blk("setTextVar", { target: "SeqCount", var: "seq" }),
    blk("partColor", { part: "SeqB", color: "#3f5468" }),
    blk("partColor", { part: "SeqR", color: "#6b3f3a" }),
    blk("partColor", { part: "SeqG", color: "#3f5a44" }),
    blk("setText", { target: "Status", text: "WRONG ORDER - SEQUENCE RESET" }),
  ];

  const hud = node("ScreenGui", "HUD", { DisplayOrder: 10 }, [
    node("Frame", "Panel", {
      Position: [0, 20, 0, 20], Size: [0, 320, 0, 200],
      BackgroundColor3: "#1e2125", BackgroundTransparency: 0.08, BorderSizePixel: 0, ZIndex: 1,
    }, [
      node("TextLabel", "Title", {
        Position: [0, 16, 0, 12], Size: [1, -32, 0, 24], BackgroundTransparency: 1,
        Text: "RELAY // ASCENT", TextColor3: "#d9c9a3", TextSize: 18, Font: "Code",
        TextXAlignment: "Left", TextYAlignment: "Center",
      }),
      node("TextLabel", "TimeLabel", {
        Position: [0, 16, 0, 42], Size: [0, 180, 0, 16], BackgroundTransparency: 1,
        Text: "TIME", TextColor3: "#8a9099", TextSize: 11, Font: "Code", TextXAlignment: "Left",
      }),
      node("TextLabel", "Timer", {
        Position: [1, -16, 0, 42], Size: [0, 74, 0, 16], AnchorPoint: [1, 0], BackgroundTransparency: 1,
        Text: "120", TextColor3: "#d9c9a3", TextSize: 11, Font: "Code", TextXAlignment: "Right",
      }),
      node("TextLabel", "ChargeLabel", {
        Position: [0, 16, 0, 60], Size: [0, 180, 0, 16], BackgroundTransparency: 1,
        Text: "CHARGE", TextColor3: "#8a9099", TextSize: 11, Font: "Code", TextXAlignment: "Left",
      }),
      node("TextLabel", "Charge", {
        Position: [1, -16, 0, 60], Size: [0, 74, 0, 16], AnchorPoint: [1, 0], BackgroundTransparency: 1,
        Text: "0", TextColor3: "#d9c9a3", TextSize: 11, Font: "Code", TextXAlignment: "Right",
      }),
      node("TextLabel", "SeqLabel", {
        Position: [0, 16, 0, 78], Size: [0, 180, 0, 16], BackgroundTransparency: 1,
        Text: "SEQUENCE  B R G", TextColor3: "#8a9099", TextSize: 11, Font: "Code", TextXAlignment: "Left",
      }),
      node("TextLabel", "SeqCount", {
        Position: [1, -16, 0, 78], Size: [0, 74, 0, 16], AnchorPoint: [1, 0], BackgroundTransparency: 1,
        Text: "0", TextColor3: "#d9c9a3", TextSize: 11, Font: "Code", TextXAlignment: "Right",
      }),
      node("TextLabel", "Status", {
        Position: [0, 16, 0, 100], Size: [1, -32, 0, 18], BackgroundTransparency: 1,
        Text: "CLIMB THE COURSE", TextColor3: "#a8956f", TextSize: 11, Font: "Code", TextXAlignment: "Left",
      }),
      node("Frame", "Pip1", { Position: [0, 16, 0, 124], Size: [0, 84, 0, 6], BackgroundColor3: "#3a3f45", BorderSizePixel: 0, ZIndex: 2 }),
      node("Frame", "Pip2", { Position: [0, 110, 0, 124], Size: [0, 84, 0, 6], BackgroundColor3: "#3a3f45", BorderSizePixel: 0, ZIndex: 2 }),
      node("Frame", "Pip3", { Position: [0, 204, 0, 124], Size: [0, 84, 0, 6], BackgroundColor3: "#3a3f45", BorderSizePixel: 0, ZIndex: 2 }),
      node("TextButton", "HelpBtn", {
        Position: [0, 16, 0, 150], Size: [0, 132, 0, 28], BackgroundColor3: "#2a2e33", BorderSizePixel: 0,
        Text: "HOW TO PLAY", TextColor3: "#d9c9a3", TextSize: 11, Font: "Code", ZIndex: 2,
      }),
      node("TextButton", "ResetBtn", {
        Position: [0, 160, 0, 150], Size: [0, 132, 0, 28], BackgroundColor3: "#2a2e33", BorderSizePixel: 0,
        Text: "RESET RUN", TextColor3: "#d9c9a3", TextSize: 11, Font: "Code", ZIndex: 2,
      }),
    ]),
    node("Frame", "HelpPanel", {
      Position: [0, 20, 0, 232], Size: [0, 320, 0, 132],
      BackgroundColor3: "#1e2125", BackgroundTransparency: 0.05, BorderSizePixel: 0, Visible: false, ZIndex: 3,
    }, [
      node("TextLabel", "HelpText", {
        Position: [0, 14, 0, 12], Size: [1, -28, 0, 108], BackgroundTransparency: 1,
        Text: "Cross the four steps and the narrow beam.\nOn the plate platform, touch the plates in the\norder B R G. Wrong order resets the sequence.\nRide the sliding platform, charge the three\npads, walk through the door and touch the\ntrophy to win. The clock resets the run.",
        TextColor3: "#b9bec6", TextSize: 11, Font: "SourceSans", TextWrapped: true, LineHeight: 1.5,
        TextXAlignment: "Left", TextYAlignment: "Top", ZIndex: 4,
      }),
    ]),
    node("Frame", "WinPanel", {
      Position: [0.5, 0, 0.5, 0], Size: [0, 380, 0, 130], AnchorPoint: [0.5, 0.5],
      BackgroundColor3: "#1e2125", BackgroundTransparency: 0.04, BorderSizePixel: 0, Visible: false, ZIndex: 6,
    }, [
      node("TextLabel", "WinTitle", {
        Position: [0, 0, 0, 18], Size: [1, 0, 0, 30], BackgroundTransparency: 1,
        Text: "RELAY CLAIMED", TextColor3: "#d9c9a3", TextSize: 24, Font: "Code", ZIndex: 7,
      }),
      node("TextLabel", "WinSub", {
        Position: [0, 0, 0, 54], Size: [1, 0, 0, 18], BackgroundTransparency: 1,
        Text: "TIME LEFT", TextColor3: "#8a9099", TextSize: 11, Font: "Code", ZIndex: 7,
      }),
      node("TextLabel", "WinTime", {
        Position: [0, 0, 0, 76], Size: [1, 0, 0, 22], BackgroundTransparency: 1,
        Text: "0", TextColor3: "#b9bec6", TextSize: 18, Font: "Code", ZIndex: 7,
      }),
    ]),
  ]);

  const gui = [hud];

  /* ---- clock ---- */
  gui.push(script("LocalScript", "Clock Start", [
    blk("onStart", {}),
    blk("setVar", { var: "time", value: "120" }),
    blk("setVar", { var: "charge", value: "0" }),
    blk("setVar", { var: "open", value: "0" }),
    blk("setVar", { var: "seq", value: "0" }),
    blk("setVar", { var: "dir", value: "0" }),
    blk("setVar", { var: "won", value: "0" }),
    blk("setVar", { var: "gate", value: "0" }),
    blk("setText", { target: "Timer", text: "120" }),
    blk("setTextVar", { target: "SeqCount", var: "seq" }),
    blk("setTextVar", { target: "Charge", var: "charge" }),
    blk("hide", { target: "WinPanel" }),
    blk("hide", { target: "HelpPanel" }),
    blk("setText", { target: "Status", text: "CLIMB THE COURSE" }),
  ]));

  gui.push(script("LocalScript", "Clock", [
    blk("every", { n: "1" }),
    blk("ifVar", { var: "won", op: "=", value: "0" }, [
      blk("ifVar", { var: "time", op: ">", value: "0" }, [
        blk("changeVar", { var: "time", n: "-1" }),
        blk("setTextVar", { target: "Timer", var: "time" }),
      ]),
      blk("ifVar", { var: "time", op: "=", value: "0" }, [
        blk("setVar", { var: "time", value: "120" }),
        blk("setVar", { var: "charge", value: "0" }),
        blk("setVar", { var: "seq", value: "0" }),
        blk("setText", { target: "Timer", text: "120" }),
        blk("setTextVar", { target: "Charge", var: "charge" }),
        blk("setTextVar", { target: "SeqCount", var: "seq" }),
        blk("teleport", { x: "0", y: "8", z: "40" }),
        blk("ifVar", { var: "gate", op: "=", value: "1" }, [
          blk("movePart", { part: "Gate", x: "0", y: "8", z: "0" }),
          blk("setVar", { var: "gate", value: "0" }),
        ]),
        ...resetPads(),
        ...resetSequence(),
        blk("setText", { target: "Status", text: "TIME UP - BACK TO START" }),
      ]),
    ]),
  ]));

  /* ---- sequence plates (B -> R -> G) ---- */
  gui.push(script("Script", "Plate B", [
    blk("onTouch", { part: "SeqB" }),
    blk("ifVar", { var: "seq", op: "=", value: "0" }, [
      blk("setVar", { var: "seq", value: "1" }),
      blk("partColor", { part: "SeqB", color: "#6f8bb0" }),
      blk("setTextVar", { target: "SeqCount", var: "seq" }),
      blk("setText", { target: "Status", text: "SEQUENCE 1/3" }),
    ], resetSequence()),
  ]));

  gui.push(script("Script", "Plate R", [
    blk("onTouch", { part: "SeqR" }),
    blk("ifVar", { var: "seq", op: "=", value: "1" }, [
      blk("setVar", { var: "seq", value: "2" }),
      blk("partColor", { part: "SeqR", color: "#b06a5f" }),
      blk("setTextVar", { target: "SeqCount", var: "seq" }),
      blk("setText", { target: "Status", text: "SEQUENCE 2/3" }),
    ], resetSequence()),
  ]));

  gui.push(script("Script", "Plate G", [
    blk("onTouch", { part: "SeqG" }),
    blk("ifVar", { var: "seq", op: "=", value: "2" }, [
      blk("setVar", { var: "seq", value: "3" }),
      blk("partColor", { part: "SeqG", color: "#7fa87f" }),
      blk("setTextVar", { target: "SeqCount", var: "seq" }),
      blk("movePart", { part: "Gate", x: "0", y: "-8", z: "0" }),
      blk("setVar", { var: "gate", value: "1" }),
      blk("setText", { target: "Status", text: "GATE OPEN - MIND THE GAP" }),
    ], resetSequence()),
  ]));

  /* ---- sliding platform ---- */
  gui.push(script("Script", "Platform", [
    blk("every", { n: "2.5" }),
    blk("ifVar", { var: "dir", op: "=", value: "0" }, [
      blk("movePart", { part: "Platform", x: "0", y: "0", z: "-12" }),
      blk("setVar", { var: "dir", value: "1" }),
    ], [
      blk("movePart", { part: "Platform", x: "0", y: "0", z: "12" }),
      blk("setVar", { var: "dir", value: "0" }),
    ]),
  ]));

  /* ---- relay pads -> door ---- */
  const chargeScript = (n, padName, pipName) => script("Script", "Charge " + n, [
    blk("onTouch", { part: padName }),
    blk("changeVar", { var: "charge", n: "1" }),
    blk("setTextVar", { target: "Charge", var: "charge" }),
    blk("partColor", { part: padName, color: "#b08d57" }),
    blk("setProp", { target: pipName, prop: "BackgroundColor3", value: "#b08d57" }),
    blk("setText", { target: "Status", text: "PAD " + n + " ONLINE" }),
  ]);
  gui.push(chargeScript(1, "ChargeA", "Pip1"), chargeScript(2, "ChargeB", "Pip2"), chargeScript(3, "ChargeC", "Pip3"));

  gui.push(script("Script", "Door", [
    blk("every", { n: "0.2" }),
    blk("ifVar", { var: "open", op: "=", value: "0" }, [
      blk("ifVar", { var: "charge", op: "=", value: "3" }, [
        blk("movePart", { part: "Door", x: "0", y: "8", z: "0" }),
        blk("setVar", { var: "open", value: "1" }),
        blk("setText", { target: "Status", text: "DOOR OPEN - TAKE THE TROPHY" }),
        blk("setProp", { target: "Charge", prop: "TextColor3", value: "#b08d57" }),
      ]),
    ]),
  ]));

  /* ---- trophy -> win ---- */
  gui.push(script("LocalScript", "Trophy", [
    blk("onTouch", { part: "Trophy" }),
    blk("setVar", { var: "won", value: "1" }),
    blk("partColor", { part: "Trophy", color: "#e0c48a" }),
    blk("setText", { target: "Status", text: "RELAY CLAIMED" }),
    blk("setTextVar", { target: "WinTime", var: "time" }),
    blk("show", { target: "WinPanel" }),
  ]));

  /* ---- buttons ---- */
  gui.push(script("LocalScript", "Help Button", [
    blk("onClick", { target: "HelpBtn" }),
    blk("changeVar", { var: "help", n: "1" }),
    blk("ifVar", { var: "help", op: "=", value: "1" }, [blk("show", { target: "HelpPanel" })]),
    blk("ifVar", { var: "help", op: "=", value: "2" }, [
      blk("setVar", { var: "help", value: "0" }),
      blk("hide", { target: "HelpPanel" }),
    ]),
  ]));

  gui.push(script("LocalScript", "Reset Button", [
    blk("onClick", { target: "ResetBtn" }),
    blk("setVar", { var: "time", value: "120" }),
    blk("setVar", { var: "charge", value: "0" }),
    blk("setVar", { var: "seq", value: "0" }),
    blk("setVar", { var: "won", value: "0" }),
    blk("setText", { target: "Timer", text: "120" }),
    blk("setTextVar", { target: "Charge", var: "charge" }),
    blk("setTextVar", { target: "SeqCount", var: "seq" }),
    blk("setText", { target: "Status", text: "MANUAL RESET" }),
    blk("hide", { target: "WinPanel" }),
    blk("teleport", { x: "0", y: "8", z: "40" }),
    ...resetPads(),
    ...resetSequence(),
  ]));

  return {
    spawn: [0, 8, 40],
    parts,
    gui,
    replicatedStorage: [],
    workspaceScripts: [],
    vars: { time: "120", charge: "0", open: "0", seq: "0", dir: "0", help: "0", won: "0", gate: "0" },
  };
}
