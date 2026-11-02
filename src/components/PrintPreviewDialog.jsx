import React, { useEffect, useRef } from 'react';

// The app's own print window: bill preview + Print / Cancel.
// Print (Enter) runs onPrint; Cancel (Esc) runs onCancel and nothing is marked printed.
// While it is open, it takes over the keyboard so page shortcuts (F1, F4, Enter...) don't fire.
const PrintPreviewDialog = ({ html, title, onPrint, onCancel, busy = false, error = '', wide = false }) => {
    const printButtonRef = useRef(null);
    const iframeRef = useRef(null);

    // Keep the latest handlers for the key listeners without re-registering them
    const stateRef = useRef({ onPrint, onCancel, busy });
    stateRef.current = { onPrint, onCancel, busy };

    useEffect(() => {
        const handleKey = (e) => {
            const { onPrint: print, onCancel: cancel, busy: isBusy } = stateRef.current;
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (!isBusy) print();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (!isBusy) cancel();
            } else if (/^F\d+$/.test(e.key)) {
                // Block page shortcuts (F1/F2/F4/F5...) while the print window is open
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        };
        window.addEventListener('keydown', handleKey, true);
        printButtonRef.current?.focus();

        // Clicking into the preview moves keyboard focus into the iframe; listen there too
        const frame = iframeRef.current;
        const attachToFrame = () => frame?.contentWindow?.addEventListener('keydown', handleKey, true);
        frame?.addEventListener('load', attachToFrame);

        return () => {
            window.removeEventListener('keydown', handleKey, true);
            frame?.removeEventListener('load', attachToFrame);
            frame?.contentWindow?.removeEventListener('keydown', handleKey, true);
        };
    }, []);

    const buttonBase = { padding: '12px 26px', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '1rem', cursor: busy ? 'wait' : 'pointer' };

    return (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10050 }}>
            <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', width: '95%', maxWidth: wide ? '700px' : '420px', maxHeight: '94vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)' }}>
                <div style={{ padding: '12px 16px', backgroundColor: '#111439', color: 'white', fontWeight: 'bold', fontSize: '15px' }}>
                    🖨️ {title}
                </div>

                <div style={{ backgroundColor: '#f1f1f1', padding: '12px', flex: 1, minHeight: 0 }}>
                    <iframe
                        ref={iframeRef}
                        title="Bill preview"
                        srcDoc={html}
                        style={{ width: '100%', height: '62vh', border: '1px solid #ddd', borderRadius: '6px', backgroundColor: '#fff' }}
                    />
                </div>

                {error && (
                    <div style={{ padding: '8px 16px', backgroundColor: '#fdecea', color: '#b3261e', fontSize: '13px', fontWeight: 'bold' }}>
                        ⚠️ {error}
                    </div>
                )}

                <div style={{ padding: '14px 16px', borderTop: '1px solid #ddd', display: 'flex', gap: '12px' }}>
                    <button
                        ref={printButtonRef}
                        onClick={onPrint}
                        disabled={busy}
                        style={{ ...buttonBase, flex: 2, backgroundColor: '#28a745', color: 'white', opacity: busy ? 0.7 : 1 }}
                    >
                        {busy ? 'මුද්‍රණය වෙමින්... / Printing...' : '🖨️ මුද්‍රණය / Print (Enter)'}
                    </button>
                    <button
                        onClick={onCancel}
                        disabled={busy}
                        style={{ ...buttonBase, flex: 1, backgroundColor: '#6c757d', color: 'white', opacity: busy ? 0.7 : 1 }}
                    >
                        අවලංගු / Cancel (Esc)
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PrintPreviewDialog;
