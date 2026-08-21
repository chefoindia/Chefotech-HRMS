// src/components/ui/Band.js
//
// Compatibility shim. Surfaces are now glass panes (blur + tint + lit edge +
// theme awareness) rather than the earlier opaque bands. Screens written
// against `Band` keep working through this alias while they migrate.
//
// The old `weight` prop mapped to vertical rhythm; here "primary" maps to the
// heavier tint, which is the closest honest equivalent — a primary surface
// should read denser than a supporting one.
//
// Prefer importing Glass directly in new code.

import React from "react";
import Glass from "./Glass";

export default function Band({ children, weight, ...rest }) {
  return (
    <Glass strong={weight === "primary"} {...rest}>
      {children}
    </Glass>
  );
}

Band.Row = Glass.Row;
