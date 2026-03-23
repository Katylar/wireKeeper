import React from "react";
import { useEngine } from "../context/WebSocketProvider";
import LogViewer from "../components/LogViewer";

export default function Logs() {
    const { logs } = useEngine();

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                height: "calc(100vh - 120px)",
            }}>
            <h2 style={{ color: "#cdd6f4", marginTop: 0 }}>System Logs</h2>
            <p
                style={{
                    color: "#a6adc8",
                    fontSize: "0.9rem",
                    marginBottom: "0",
                }}>
                Live stdout terminal feed. Retaining the last 1,000 events.
            </p>

            <div style={{ flexGrow: 1, overflow: "hidden" }}>
                <LogViewer logs={logs} />
            </div>
        </div>
    );
}
