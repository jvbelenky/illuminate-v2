// Ambient module augmentation for Threlte's interactivity convention.
//
// When a click handler is registered on a Threlte object, the app sets a
// `cursor` style hint directly on the underlying Three.js object (e.g.
// `oncreate={(ref) => { ref.cursor = 'pointer'; }}`). This property is not
// part of Three.js's own `Object3D` typings, so declare it here. Because
// `Mesh` and `InstancedMesh` both extend `Object3D`, augmenting the base
// type covers every interactive mesh.
import type {} from 'three';

declare module 'three' {
	interface Object3D {
		/** Cursor style applied to interactive objects (Threlte interactivity convention). */
		cursor?: string;
	}
}
