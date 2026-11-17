import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// shadcn/ui theme + utilities first, then the island's own layer.
import "./shadcn.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
