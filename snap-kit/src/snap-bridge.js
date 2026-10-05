/**
 * snap-bridge.js
 * Entry point del bundle de Camera Kit.
 * Expone las funciones necesarias como window.SnapCameraKit
 * para que snap-filter.js pueda usarlas sin módulos ES.
 */
export { bootstrapCameraKit, createMediaStreamSource, Transform2D } from '@snap/camera-kit';
