// ─── Core Exports ────────────────────────────────────────────

export {
  LoopDetector,
  RepeatDetector,
  NavigationDetector,
  CoordinateDetector,
  type LoopContext,
  type LoopResult,
  type LoopType,
  type LoopDetectorConfig,
} from "./loop-detector.js";

export {
  RepeatDetector as RepeatDetectorStandalone,
  type RepeatDetectorConfig,
} from "./repeat-detector.js";

export {
  NavigationDetector as NavigationDetectorStandalone,
  type NavigationDetectorConfig,
} from "./navigation-detector.js";

export {
  CoordinateDetector as CoordinateDetectorStandalone,
  type CoordinateDetectorConfig,
} from "./coordinate-detector.js";

export {
  LoopDetectionIntegration,
  type LoopDetectionIntegrationConfig,
  type LoopDetectionEvent,
} from "./integration.js";
