import React, { useEffect } from "react";
import "../styles/components/modals.scss";

export default function Modal({
    isOpen,
    onClose,
    title,
    children,
    footerActions,
}) {
    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Escape" && isOpen) onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    // Close when clicking the semi-transparent overlay
    const handleOverlayClick = (e) => {
        if (e.target.classList.contains("modal-overlay")) {
            onClose();
        }
    };

    return (
        <div className="modal-overlay" onClick={handleOverlayClick}>
            <div className="modal-container">
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button
                        className="close-btn"
                        onClick={onClose}
                        title="Close">
                        ✕
                    </button>
                </div>

                <div className="modal-body">{children}</div>

                {footerActions && (
                    <div className="modal-footer">{footerActions}</div>
                )}
            </div>
        </div>
    );
}
