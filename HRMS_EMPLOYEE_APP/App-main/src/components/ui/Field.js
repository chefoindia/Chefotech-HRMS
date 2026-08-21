// src/components/ui/Field.js
//
// Compatibility shim. The background layer is now Aurora (gradient + drifting
// blobs + theme awareness); screens written against the earlier flat `Field`
// keep working through this alias while they are migrated one at a time.
//
// Prefer importing Aurora directly in new code.

export { default } from "./Aurora";
