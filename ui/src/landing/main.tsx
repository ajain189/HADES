import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../index.css";
import "./landing.css";
import { LandingPage } from "./LandingPage";

/* Entry for the front-facing demonstration site (vite `--mode landing` → dist-landing/). It
 * shares the design tokens + bundled fonts (index.css) but is otherwise fully decoupled from the
 * operational console and the demo replay. */

const root = document.getElementById("landing-root");
if (!root) throw new Error("#landing-root not found");

createRoot(root).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);
