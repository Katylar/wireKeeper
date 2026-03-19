import { useState, useEffect, useRef } from "react";

const WS_URL = "ws://localhost:39486/ws";
const API_BASE = "http://localhost:39486/api";

export function useTelegramEngine() {
    const [isConnected, setIsConnected] = useState(false);
    const [logs, setLogs] = useState([]);
    const [activeTasks, setActiveTasks] = useState({});
    const [activeScans, setActiveScans] = useState({}); // NEW: Track scanning phase
    const [systemStatus, setSystemStatus] = useState({ setup_complete: false });
    const wsRef = useRef(null);

    useEffect(() => {
        fetch(`${API_BASE}/status`)
            .then((res) => res.json())
            .then((data) => setSystemStatus(data))
            .catch((err) => console.error("Backend offline:", err));
    }, []);

    const handleEngineEvent = (data) => {
        switch (data.event) {
            case "log":
            case "error":
                setLogs((prev) => [
                    ...prev.slice(-49),
                    {
                        time: new Date().toLocaleTimeString(),
                        text: data.message,
                        type: data.event,
                    },
                ]);
                break;

            // --- NEW SCAN EVENTS ---
            case "scan_start":
                setActiveScans((prev) => ({
                    ...prev,
                    [data.chat_id]: { scanned: 0 },
                }));
                break;
            case "scan_progress":
                // Note: The backend doesn't send chat_id with scan_progress currently,
                // so we just rely on scan_start for the UI indicator for now.
                break;
            case "scan_complete":
            case "chat_complete":
                setActiveScans((prev) => {
                    const next = { ...prev };
                    delete next[data.chat_id];
                    return next;
                });
                break;
            // -----------------------

            case "task_start":
                setActiveTasks((prev) => ({
                    ...prev,
                    [data.file_id]: {
                        filename: data.filename,
                        chat_id: data.chat_id,
                        queue_info: data.queue_info,
                        progress: 0,
                        speed: 0,
                    },
                }));
                break;

            case "progress":
                setActiveTasks((prev) => {
                    if (!prev[data.file_id]) return prev;
                    return {
                        ...prev,
                        [data.file_id]: {
                            ...prev[data.file_id],
                            progress: (data.downloaded / data.total) * 100,
                            speed: data.speed,
                            downloaded: data.downloaded,
                            total: data.total,
                        },
                    };
                });
                break;

            case "task_complete":
            case "task_error":
                setActiveTasks((prev) => {
                    const newState = { ...prev };
                    delete newState[data.file_id];
                    return newState;
                });
                break;

            default:
                break;
        }
    };

    // 2. CALLED SECOND: The WebSocket Connection
    useEffect(() => {
        let isMounted = true;
        let reconnectTimeout;
        let ws = null;

        const connect = () => {
            ws = new WebSocket(WS_URL);
            wsRef.current = ws;

            ws.onopen = () => {
                if (isMounted) setIsConnected(true);
            };

            ws.onclose = () => {
                // ONLY attempt to auto-reconnect if the component is actually supposed to be alive
                if (isMounted) {
                    setIsConnected(false);
                    reconnectTimeout = setTimeout(connect, 3000);
                }
            };

            ws.onmessage = (event) => {
                if (isMounted) {
                    const data = JSON.parse(event.data);
                    handleEngineEvent(data);
                }
            };
        };

        connect();

        // The Cleanup Function
        return () => {
            isMounted = false;
            clearTimeout(reconnectTimeout);
            if (ws) {
                // Remove the onclose listener BEFORE closing so it doesn't trigger a ghost reconnect
                ws.onclose = null;
                ws.close();
            }
        };
    }, []);

    // Make sure to export the new activeScans state!
    return { isConnected, systemStatus, logs, activeTasks, activeScans };
}
