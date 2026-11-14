import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { bootstrapSessionToken } from "./lib/apiClient.js";
import "./styles.css";

bootstrapSessionToken();

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
