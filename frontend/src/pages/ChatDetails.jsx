import React, { useEffect, useState } from "react";
import { useParams, useOutletContext, Link } from "react-router-dom";

export default function ChatDetails() {
    const { id } = useParams(); // Grabs the ID from the URL
    const { activeTasks, activeScans } = useOutletContext();
    const [chat, setChat] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // For now, we fetch all chats and filter.
        // We can optimize this later with a dedicated backend route if needed.
        fetch("http://localhost:39486/api/chats")
            .then((res) => res.json())
            .then((data) => {
                const foundChat = data.find((c) => c.chat_id.toString() === id);
                setChat(foundChat);
                setIsLoading(false);
            })
            .catch((err) => console.error(err));
    }, [id]);

    if (isLoading) return <p>Loading chat details...</p>;
    if (!chat) return <p>Chat not found in database.</p>;

    // Check if this specific chat is currently downloading
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
                <h3 style={{ color: "#cdd6f4" }}>Archived Files</h3>
                <p style={{ color: "#a6adc8" }}>
                    {/* We will populate this list from the database in the next step! */}
                    File history grid will go here...
                </p>
            </div>
        </div>
    );
}
