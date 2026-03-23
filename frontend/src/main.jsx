import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WebSocketProvider } from "./context/WebSocketProvider";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <WebSocketProvider>
            <App />
        </WebSocketProvider>
    </StrictMode>,
);
