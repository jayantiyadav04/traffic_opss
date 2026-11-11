import { useEffect, useId, useRef } from 'react';

export default function Dialog({ title, onClose, children, busy = false }) {
    const titleId = useId();
    const dialogRef = useRef(null);
    const closeRef = useRef(onClose);
    const busyRef = useRef(busy);

    useEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);

    useEffect(() => {
        const previous = document.activeElement;
        const dialog = dialogRef.current;
        const getFocusable = () => Array.from(dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]'))
            .filter(element => !element.matches(':disabled') && !element.hidden);
        (getFocusable()[0] || dialog).focus();
        const handleKey = event => {
            if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current(); }
            if (event.key === 'Tab') {
                const elements = getFocusable();
                const first = elements[0];
                const last = elements[elements.length - 1];
                if (!first) { event.preventDefault(); dialog.focus(); }
                else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
                    event.preventDefault(); last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault(); first.focus();
                }
            }
        };
        dialog.addEventListener('keydown', handleKey);
        const priorOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            dialog.removeEventListener('keydown', handleKey);
            document.body.style.overflow = priorOverflow;
            previous?.focus();
        };
    }, []);

    return <div className="dialog-backdrop">
        <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="dialog-card">
            <div className="dialog-heading"><h2 id={titleId}>{title}</h2>
                <button className="btn btn-ghost" aria-label="Close dialog" onClick={onClose} disabled={busy}>Close</button>
            </div>
            {children}
        </section>
    </div>;
}
