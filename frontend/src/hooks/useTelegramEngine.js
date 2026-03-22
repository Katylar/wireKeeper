import { useState, useEffect, useRef } from "react";

const WS_URL = "ws://localhost:39486/ws";
const API_BASE = "http://localhost:39486/api";

export function useTelegramEngine() {
    const [isConnected, setIsConnected] = useState(false);
    const [logs, setLogs] = useState([]);
    const [activeTasks, setActiveTasks] = useState({});
    const [activeScans, setActiveScans] = useState({});
    const [systemStatus, setSystemStatus] = useState(null);
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
                    ...prev.slice(-9999),
                    {
                        time: new Date().toLocaleTimeString(),
                        text: data.message,
                        type: data.event,
                    },
                ]);
                break;

            case "scan_start":
                setActiveScans((prev) => ({
                    ...prev,
                    [data.chat_id]: { scanned: 0 },
                }));
                break;
            case "scan_progress":
                break;
            case "scan_complete":
            case "chat_complete":
                setActiveScans((prev) => {
                    const next = { ...prev };
                    delete next[data.chat_id];
                    return next;
                });
                break;

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

        return () => {
            isMounted = false;
            clearTimeout(reconnectTimeout);
            if (ws) {
                ws.onclose = null;
                ws.close();
            }
        };
    }, []);

    return { isConnected, systemStatus, logs, activeTasks, activeScans };
}
