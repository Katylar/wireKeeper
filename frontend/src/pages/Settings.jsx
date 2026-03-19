import React, { useState, useEffect } from "react";
import "../styles/settings.scss";

export default function Settings() {
    const [formData, setFormData] = useState({
        api_id: "",
        api_hash: "",
        session_name: "wirekeeper_session",
        download_path: "downloads",
        alt_download_path: "",
        max_concurrent_heavy: "3",
        max_concurrent_light: "2",
    });
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        // Load current settings when the page mounts
        fetch("http://localhost:39486/api/settings")
            .then((res) => res.json())
            .then((data) => {
                setFormData((prev) => ({ ...prev, ...data }));
            });
    }, []);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            const res = await fetch("http://localhost:39486/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });
            const data = await res.json();
            setMessage({ type: "success", text: data.status });
        } catch (err) {
            setMessage({ type: "error", text: "Failed to save settings." });
        }
        setIsSaving(false);
    };

    return (
        <div className="settings-container">
            <h2>Engine Configuration</h2>

            {message && (
                <div
                    style={{
                        padding: "1rem",
                        marginBottom: "1rem",
                        background:
                            message.type === "success" ? "#a6e3a1" : "#f38ba8",
                        color: "#11111b",
                        borderRadius: "4px",
                    }}>
                    {message.text}
                </div>
            )}

            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label>Telegram API ID</label>
                    <input
                        type="text"
                        name="api_id"
                        value={formData.api_id || ""}
                        onChange={handleChange}
                        required
                    />
                </div>
                <div className="form-group">
                    <label>Telegram API Hash</label>
                    <input
                        type="text"
                        name="api_hash"
                        value={formData.api_hash || ""}
                        onChange={handleChange}
                        required
                    />
                </div>

                <div className="form-group">
                    <label>Primary Download Path</label>
                    <input
                        type="text"
                        name="download_path"
                        value={formData.download_path || ""}
                        onChange={handleChange}
                        required
                    />
                    <span className="help-text">
                        Absolute paths recommended (e.g., D:\Media\Telegram).
                    </span>
                </div>

                <div className="form-group">
                    <label>
                        Alternate Archive Path (Read-Only Deduplication)
                    </label>
                    <input
                        type="text"
                        name="alt_download_path"
                        value={formData.alt_download_path || ""}
                        onChange={handleChange}
                    />
                    <span className="help-text">
                        Optional. Engine will skip downloads if files exist
                        here.
                    </span>
                </div>

                <div style={{ display: "flex", gap: "1rem" }}>
                    <div className="form-group" style={{ flex: 1 }}>
                        <label>Max Heavy Workers (Video/Zip)</label>
                        <input
                            type="number"
                            name="max_concurrent_heavy"
                            value={formData.max_concurrent_heavy || ""}
                            onChange={handleChange}
                            min="1"
                            max="10"
                        />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                        <label>Max Light Workers (Images/Misc)</label>
                        <input
                            type="number"
                            name="max_concurrent_light"
                            value={formData.max_concurrent_light || ""}
                            onChange={handleChange}
                            min="1"
                            max="10"
                        />
                    </div>
                </div>

                <button type="submit" className="save-btn" disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save Configuration"}
                </button>
            </form>
        </div>
    );
}
