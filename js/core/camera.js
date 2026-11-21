"use strict";

/* =====================================================================
   Camera state (Roblox-style orbit around the head)
   yaw = 0 looks toward -Z.  pitch > 0 looks down.
   ===================================================================== */
const cam = { yaw: 0, pitch: 0.2, zoom: CFG.CAM_ZOOM_START, zoomTarget: CFG.CAM_ZOOM_START, shift: 0 };
