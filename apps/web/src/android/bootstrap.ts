import { initAndroidBridge } from "./android-bridge";

// Attach `window.suiteleaf` before any other app module evaluates `window.suiteleaf`.
initAndroidBridge();
