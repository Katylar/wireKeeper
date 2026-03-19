import React, { useEffect, useState } from "react";
import { useTelegramEngine } from "./hooks/useTelegramEngine";
import ChatList from "./components/ChatList";
import "./styles/main.scss";

export default function App() {
    const { isConnected, systemStatus, logs, activeTasks } =
        useTelegramEngine();
    const [chats, setChats] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch initial chat list on load
    const fetchChats = async () => {
        try {
            const res = await fetch("http://localhost:39486/api/chats");
            const data = await res.json();
            setChats(data);
        } catch (err) {
            console.error("Failed to fetch chats", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchChats();
    }, []);

    // Trigger a download API call
    const handleStartDownload = async (chatId) => {
        try {
            await fetch(`http://localhost:39486/api/download/${chatId}`, {
                method: "POST",
            });
            // The WebSocket hook will automatically catch the 'scan_start' and 'task_start'
            // events and update the activeTasks state, which flows down to ChatList.
        } catch (err) {
            console.error("Failed to start download", err);
        }
    };

    const handleGlobalSync = async () => {
        await fetch("http://localhost:39486/api/sync", { method: "POST" });
    };

    if (!systemStatus.setup_complete) {
        return <div>Setup Required: Please add API keys to the database.</div>;
    }

    return (
        <div className="app-layout">
            <header>
                <h1>WireKeeper Dashboard</h1>
                <div>
                    Status:{" "}
                    <span
                        style={{ color: isConnected ? "#a6e3a1" : "#f38ba8" }}>
                        {isConnected ? "Connected" : "Disconnected"}
                    </span>
                </div>
                <button onClick={handleGlobalSync}>Run Global Sync</button>
            </header>

            <main>
                {isLoading ? (
                    <p>Loading database...</p>
                ) : (
                    <ChatList
                        chats={chats}
                        activeTasks={activeTasks}
                        onDownload={handleStartDownload}
                    />
                )}
            </main>
        </div>
    );
}
