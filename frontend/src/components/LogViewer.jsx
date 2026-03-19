import React, { useEffect, useRef } from "react";

export default function LogViewer({ logs }) {
    const bottomRef = useRef(null);

    // Auto-scroll to the bottom whenever the logs array changes
    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [logs]);

    return (
        <div className="log-viewer-container">
            {logs.length === 0 ? (
                <div className="log-entry">
                    <span className="log-text" style={{ color: "#6c7086" }}>
                        System idle. Waiting for engine output...
                    </span>
                </div>
            ) : (
                logs.map((log, index) => {
                    // Map our event types to the SCSS classes
                    let typeClass = "log-info";
                    if (log.type === "error" || log.type === "task_error")
                        typeClass = "log-error";
                    if (log.type === "success" || log.type === "chat_complete")
                        typeClass = "log-success";

                    return (
                        <div key={index} className={`log-entry ${typeClass}`}>
                            <span className="log-time">[{log.time}]</span>
                            <span className="log-text">{log.text}</span>
                        </div>
                    );
                })
            )}
            {/* The invisible anchor that we scroll to */}
            <div ref={bottomRef} />
        </div>
    );
}
