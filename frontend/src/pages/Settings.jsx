import React, { useState, useEffect } from "react";
import Modal from "../components/Modal";
import { useEngine } from "../context/WebSocketProvider";
import "../styles/settings.scss";

export default function Settings() {
    const engineState = useEngine();
    const [formData, setFormData] = useState({
        download_path: "downloads",
        alt_download_path: "",
        max_concurrent_heavy: "3",
        max_concurrent_light: "2",
        max_retries: "3",
        speed_threshold_kb: "100",
        ignored_extensions: "",
    });

    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState(null);

    // --- Auth State Management ---
    const [authModalOpen, setAuthModalOpen] = useState(false);
    const [authStep, setAuthStep] = useState(1);
    const [authData, setAuthData] = useState({ api_id: "", api_hash: "", phone: "", code: "", password: "", profile_id: "" });
    const [authLoading, setAuthLoading] = useState(false);
    const [authError, setAuthError] = useState(null);

    // Refetch settings if the active profile or total number of accounts changes
    useEffect(() => {
        fetch("http://localhost:39486/api/settings")
            .then((res) => res.json())
            .then((data) => {
                setFormData((prev) => ({ ...prev, ...data }));
            });
    }, [engineState.systemStatus?.active_profile, engineState.systemStatus?.accounts?.length]);

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

    // --- Multi-Account Interaction Functions ---
    const handleAuthStep1 = async () => {
        setAuthLoading(true);
        setAuthError(null);
        try {
            const res = await fetch("http://localhost:39486/api/accounts/auth/step1", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ api_id: authData.api_id, api_hash: authData.api_hash, phone: authData.phone }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Failed to send code.");
            setAuthData((prev) => ({ ...prev, profile_id: data.profile_id }));
            setAuthStep(2);
        } catch (err) {
            setAuthError(err.message);
        }
        setAuthLoading(false);
    };

    const handleAuthStep2 = async () => {
        setAuthLoading(true);
        setAuthError(null);
        try {
            const res = await fetch("http://localhost:39486/api/accounts/auth/step2", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(authData),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Verification failed.");

            if (data.status === "password_required") {
                setAuthStep(3);
            } else {
                setAuthModalOpen(false);
                setAuthStep(1);
                engineState.refreshSystemStatus();
            }
        } catch (err) {
            setAuthError(err.message);
        }
        setAuthLoading(false);
    };

    const handleDeleteAccount = async (id) => {
        if (!window.confirm("Are you sure you want to delete this account? This will log out the session completely.")) return;
        try {
            await fetch(`http://localhost:39486/api/accounts/${id}`, { method: "DELETE" });
            window.location.reload();
        } catch (e) {
            alert("Failed to delete account from backend.");
        }
    };

    return (
        <div className="settings-container">
            <h2>Engine Configuration</h2>

            {message && (
                <div
                    style={{
                        padding: "1rem",
                        marginBottom: "1rem",
                        background: message.type === "success" ? "#a6e3a1" : "#f38ba8",
                        color: "#11111b",
                        borderRadius: "4px",
                    }}>
                    {message.text}
                </div>
            )}

            {/* --- Interactive Dynamic Account Management Card --- */}
            <div style={{ background: "#11111b", padding: "1.5rem", borderRadius: "6px", marginBottom: "2rem", border: "1px solid #45475a" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <h3 style={{ margin: 0, color: "#cdd6f4" }}>Connected Accounts</h3>
                    <button
                        className="save-btn"
                        style={{ width: "auto", padding: "0.5rem 1rem", margin: 0 }}
                        onClick={() => {
                            setAuthStep(1);
                            setAuthData({ api_id: "", api_hash: "", phone: "", code: "", password: "", profile_id: "" });
                            setAuthError(null);
                            setAuthModalOpen(true);
                        }}>
                        + Add Account
                    </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {engineState.systemStatus?.accounts?.map((acc) => (
                        <div key={acc.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#1e1e2e", padding: "1rem", borderRadius: "4px" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                                <span style={{ fontWeight: "bold", color: "#89b4fa", fontSize: "1.1rem" }}>
                                    {acc.name} {engineState.systemStatus?.active_profile === acc.id && <span style={{ color: "#a6e3a1", fontSize: "0.75em", marginLeft: "0.5rem" }}>(Active)</span>}
                                </span>
                                {/* --- NEW: API ID and Hash display --- */}
                                <span style={{ color: "#6c7086", fontSize: "0.8rem", fontFamily: "monospace" }}>
                                    API ID: {formData[`profile_${acc.id}_api_id`] || "Loading..."} | HASH: {formData[`profile_${acc.id}_api_hash`] || "Loading..."}
                                </span>
                            </div>

                            {engineState.systemStatus?.accounts?.length > 1 && (
                                <button className="btn-kill-danger" style={{ padding: "0.3rem 0.8rem", fontSize: "0.85rem", background: "#f38ba8", color: "#11111b", border: "none", borderRadius: "4px", fontWeight: "bold", cursor: "pointer" }} onClick={() => handleDeleteAccount(acc.id)}>
                                    DELETE
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* --- Auth Modal Render --- */}
            <Modal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} title="Authenticate New Telegram Account">
                {authError && <div style={{ background: "#f38ba8", color: "#11111b", padding: "0.75rem", borderRadius: "4px", marginBottom: "1rem", fontWeight: "bold" }}>{authError}</div>}

                {authStep === 1 && (
                    <div>
                        <p style={{ color: "#a6adc8", marginBottom: "1rem", marginTop: 0 }}>Provide your API credentials and phone number. A login code will be sent to your Telegram app.</p>
                        <div className="form-group">
                            <label>Telegram API ID</label>
                            <input type="text" value={authData.api_id} onChange={(e) => setAuthData({ ...authData, api_id: e.target.value })} />
                        </div>
                        <div className="form-group">
                            <label>Telegram API Hash</label>
                            <input type="text" value={authData.api_hash} onChange={(e) => setAuthData({ ...authData, api_hash: e.target.value })} />
                        </div>
                        <div className="form-group">
                            <label>Phone Number (e.g. +1234567890)</label>
                            <input type="text" value={authData.phone} onChange={(e) => setAuthData({ ...authData, phone: e.target.value })} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.5rem" }}>
                            <button className="save-btn" style={{ width: "auto" }} onClick={handleAuthStep1} disabled={authLoading}>
                                {authLoading ? "Sending Code..." : "Send Login Code"}
                            </button>
                        </div>
                    </div>
                )}

                {authStep === 2 && (
                    <div>
                        <p style={{ color: "#a6adc8", marginBottom: "1rem", marginTop: 0 }}>Enter the verification code sent to your Telegram app.</p>
                        <div className="form-group">
                            <label>Verification Code</label>
                            <input type="text" value={authData.code} onChange={(e) => setAuthData({ ...authData, code: e.target.value })} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.5rem" }}>
                            <button className="save-btn" style={{ width: "auto" }} onClick={handleAuthStep2} disabled={authLoading}>
                                {authLoading ? "Verifying..." : "Verify Code"}
                            </button>
                        </div>
                    </div>
                )}

                {authStep === 3 && (
                    <div>
                        <p style={{ color: "#a6adc8", marginBottom: "1rem", marginTop: 0 }}>This account has Two-Step Verification enabled. Enter your password.</p>
                        <div className="form-group">
                            <label>2FA Password</label>
                            <input type="password" value={authData.password} onChange={(e) => setAuthData({ ...authData, password: e.target.value })} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.5rem" }}>
                            <button className="save-btn" style={{ width: "auto" }} onClick={handleAuthStep2} disabled={authLoading}>
                                {authLoading ? "Logging in..." : "Complete Login"}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label>Primary Download Path</label>
                    <input type="text" name="download_path" value={formData.download_path || ""} onChange={handleChange} required />
                    <span className="help-text">Absolute paths recommended (e.g., D:\Media\Telegram).</span>
                </div>

                <div className="form-group">
                    <label>Alternate Archive Path (Read-Only Deduplication)</label>
                    <input type="text" name="alt_download_path" value={formData.alt_download_path || ""} onChange={handleChange} />
                    <span className="help-text">Optional. Engine will skip downloads if files exist here.</span>
                </div>

                <div className="form-group">
                    <label>Ignored File Extensions</label>
                    <input type="text" name="ignored_extensions" value={formData.ignored_extensions || ""} onChange={handleChange} required />
                    <span className="help-text">Comma-separated (e.g., .tmp,.log). WireKeeper will ignore files with these extensions.</span>
                </div>

                <div style={{ display: "flex", gap: "1rem" }}>
                    <div className="form-group" style={{ flex: 1 }}>
                        <label>Max Heavy Workers (Video/Zip)</label>
                        <input type="number" name="max_concurrent_heavy" value={formData.max_concurrent_heavy || ""} onChange={handleChange} min="1" max="10" />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                        <label>Max Light Workers (Images/Misc)</label>
                        <input type="number" name="max_concurrent_light" value={formData.max_concurrent_light || ""} onChange={handleChange} min="1" max="10" />
                    </div>
                </div>
                <div style={{ display: "flex", gap: "1rem" }}>
                    <div className="form-group" style={{ flex: 1 }}>
                        <label>Max Retries</label>
                        <input type="number" name="max_retries" value={formData.max_retries || ""} onChange={handleChange} min="1" max="10" />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                        <label>Gain Threshold for AutoSpawned Download Workers</label>
                        <input type="number" name="speed_threshold_kb" value={formData.speed_threshold_kb || ""} onChange={handleChange} min="1" max="10" />
                    </div>
                </div>

                <button type="submit" className="save-btn" disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save Configuration"}
                </button>
            </form>

            <div
                style={{
                    color: engineState.isConnected ? "#a6e3a1" : "#f38ba8",
                }}>
                UI ↔ Engine: {engineState.isConnected ? "● Connected" : "○ Offline"}
            </div>
        </div>
    );
}
