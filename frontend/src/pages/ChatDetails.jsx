import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useEngine } from "../context/WebSocketProvider";
import FileList from "../components/FileList";

export default function ChatDetails() {
    const { id } = useParams();
    const { activeTasks, activeScans } = useEngine();

    const [chat, setChat] = useState(null);
    const [categorizedFiles, setCategorizedFiles] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchChatData = async () => {
            setIsLoading(true);
            try {
                const [chatRes, filesRes] = await Promise.all([
                    fetch("http://localhost:39486/api/chats"),
                    fetch(`http://localhost:39486/api/chat/${id}/files`),
                ]);

                const chatsData = await chatRes.json();
                const filesData = await filesRes.json();

                const foundChat = chatsData.find(
                    (c) => c.chat_id.toString() === id,
                );

                setChat(foundChat);
                setCategorizedFiles(filesData);
            } catch (err) {
                console.error("Failed to fetch chat data:", err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchChatData();
    }, [id]);

    if (isLoading) return <p>Loading chat details...</p>;
    if (!chat) return <p>Chat not found in database.</p>;

    const tasks = Object.values(activeTasks).filter(
        (t) => t.chat_id.toString() === id,
    );
    const isScanning = Boolean(activeScans && activeScans[id]);
    const isBusy = tasks.length > 0 || isScanning;

    return (
        <div>
            <Link
                to="/"
                style={{
                    color: "#89b4fa",
                    textDecoration: "none",
                    marginBottom: "1rem",
                    display: "inline-block",
                }}>
                ← Back to Dashboard
            </Link>

            <div
                style={{
                    background: "#1e1e2e",
                    padding: "2rem",
                    borderRadius: "8px",
                    boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
                }}>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                    }}>
                    <div>
                        <h2
                            style={{
                                color: "#cdd6f4",
                                margin: "0 0 0.5rem 0",
                            }}>
                            {chat.name}
                        </h2>
                        <p style={{ color: "#a6adc8", margin: 0 }}>
                            {chat.type} • ID: {chat.chat_id}
                        </p>
                    </div>
                    <span
                        style={{
                            background: chat.is_batch ? "#a6e3a1" : "#45475a",
                            color: "#11111b",
                            padding: "0.25rem 0.75rem",
                            borderRadius: "4px",
                            fontWeight: "bold",
                            fontSize: "0.85rem",
                        }}>
                        {chat.is_batch ? "Batch Enabled" : "Batch Excluded"}
                    </span>
                </div>

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "2rem",
                        marginTop: "2rem",
                        padding: "1.5rem",
                        background: "#11111b",
                        borderRadius: "6px",
                    }}>
                    <div>
                        <div
                            style={{
                                color: "#6c7086",
                                fontSize: "0.85rem",
                                textTransform: "uppercase",
                                fontWeight: "bold",
                            }}>
                            Total Messages
                        </div>
                        <div
                            style={{
                                color: "#cdd6f4",
                                fontSize: "1.5rem",
                                fontWeight: "bold",
                            }}>
                            {chat.total_messages.toLocaleString()}
                        </div>
                    </div>
                    <div>
                        <div
                            style={{
                                color: "#6c7086",
                                fontSize: "0.85rem",
                                textTransform: "uppercase",
                                fontWeight: "bold",
                            }}>
                            Files Archived
                        </div>
                        <div
                            style={{
                                color: "#cdd6f4",
                                fontSize: "1.5rem",
                                fontWeight: "bold",
                            }}>
                            {chat.total_downloaded.toLocaleString()}
                        </div>
                    </div>
                </div>

                {isBusy && (
                    <div
                        style={{
                            marginTop: "2rem",
                            padding: "1rem",
                            border: "1px solid #a6e3a1",
                            borderRadius: "4px",
                            color: "#a6e3a1",
                        }}>
                        <strong>Engine Active:</strong>{" "}
                        {isScanning && tasks.length === 0
                            ? "Scanning database & Telegram..."
                            : `${tasks.length} active threads downloading files.`}
                    </div>
                )}
            </div>

            <div style={{ marginTop: "2rem" }}>
                <h3 style={{ color: "#cdd6f4", marginBottom: "0.5rem" }}>
                    Archived Media Vault
                </h3>
                <p
                    style={{
                        color: "#a6adc8",
                        fontSize: "0.9rem",
                        marginTop: "0",
                    }}>
                    Displaying all successfully downloaded files categorized by
                    type.
                </p>

                <FileList categorizedFiles={categorizedFiles} />
            </div>
        </div>
    );
}
