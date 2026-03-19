import { useState, useEffect, useRef } from "react";

const WS_URL = "ws://localhost:39486/ws";
const API_BASE = "http://localhost:39486/api";

export function useTelegramEngine() {
    const [isConnected, setIsConnected] = useState(false);
    const [logs, setLogs] = useState([]);
    const [activeTasks, setActiveTasks] = useState({}); // Track progress by file_id
    const [systemStatus, setSystemStatus] = useState({ setup_complete: false });
    const wsRef = useRef(null);

    // Initial Boot Check
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
                // Remove task from active list when done or failed
                setActiveTasks((prev) => {
                    const newState = { ...prev };
                    delete newState[data.file_id];
                    return newState;
                });
                break;

            case "chat_complete":
                setLogs((prev) => [
                    ...prev.slice(-49),
                    {
                        time: new Date().toLocaleTimeString(),
                        text: `Finished chat ${data.chat_id}`,
                        type: "success",
                    },
                ]);
                break;

            default:
                // Handle scan_start, scan_progress, scan_complete, batch_complete
                break;
        }
    };

    // WebSocket Connection Management
    useEffect(() => {
        const connect = () => {
            wsRef.current = new WebSocket(WS_URL);

            wsRef.current.onopen = () => setIsConnected(true);

            wsRef.current.onclose = () => {
                setIsConnected(false);
                // Auto-reconnect after 3 seconds
                setTimeout(connect, 3000);
            };

            wsRef.current.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleEngineEvent(data);
            };
        };

        connect();

        return () => {
            if (wsRef.current) wsRef.current.close();
        };
    }, []);

    return { isConnected, systemStatus, logs, activeTasks };
}
