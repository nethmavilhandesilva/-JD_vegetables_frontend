import React, { useEffect, useRef, useState } from 'react';
import api from '../../api';
import { tr } from '../../i18n/language';

const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};
const money = (v) => num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Edit one supplier bill record: supplier weight and supplier price per kg.
 * Works for today's sales (source "today"/"sales") and sales history (source "history").
 * The server recalculates SupplierTotal, profit and commission.
 */
export default function SupplierLineEditModal({ record, onClose, onSaved }) {
    const [weight, setWeight] = useState('');
    const [price, setPrice] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const weightRef = useRef(null);

    useEffect(() => {
        if (!record) return;
        setWeight(String(record.SupplierWeight ?? record.weight ?? ''));
        setPrice(String(record.SupplierPricePerKg ?? ''));
        setError('');
        setTimeout(() => { weightRef.current?.focus(); weightRef.current?.select(); }, 0);
    }, [record]);

    useEffect(() => {
        if (!record) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [record, onClose]);

    if (!record) return null;

    const save = async (e) => {
        e?.preventDefault();
        if (saving) return;
        const w = Number(weight);
        const p = Number(price);
        if (weight === '' || !Number.isFinite(w) || w < 0) { setError(tr('Enter a valid supplier weight.', 'නිවැරදි සැපයුම්කරු බර ඇතුළත් කරන්න.')); return; }
        if (price === '' || !Number.isFinite(p) || p < 0) { setError(tr('Enter a valid supplier price per kg.', 'නිවැරදි සැපයුම්කරු කිලෝ මිල ඇතුළත් කරන්න.')); return; }
        setSaving(true);
        setError('');
        try {
            await api.put('/accounts/supplier-lines', {
                updates: [{ id: record.id, source: record.source || 'today', SupplierWeight: w, SupplierPricePerKg: p }],
            });
            onSaved?.();
            onClose();
        } catch (err) {
            setError(err?.response?.data?.message || err?.response?.data?.error || tr('Could not save.', 'සුරැකීමට නොහැකි විය.'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <form onClick={(e) => e.stopPropagation()} onSubmit={save}
                style={{ background: 'white', borderRadius: 10, padding: 20, width: '100%', maxWidth: 420, boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
                <h5 style={{ marginTop: 0, color: '#1b5e20', fontWeight: 'bold' }}>{tr('Edit supplier bill record', 'සැපයුම්කරු බිල් වාර්තාව සංස්කරණය')}</h5>
                <div className="small text-muted mb-3">
                    {record.supplier_bill_no ? <>{tr('Bill No', 'බිල් අංකය')}: <b>{record.supplier_bill_no}</b> · </> : null}
                    {record.Date ? <>{String(record.Date).slice(0, 10)} · </> : null}
                    {record.item_name} · {tr('Customer', 'පාරිභෝගික')}: {record.customer_code}
                </div>
                <label className="form-label fw-bold mb-1">{tr('Supplier weight (kg)', 'සැපයුම්කරු බර (kg)')}</label>
                <input ref={weightRef} type="number" step="any" min="0" className="form-control mb-3" value={weight} onChange={(e) => setWeight(e.target.value)} />
                <label className="form-label fw-bold mb-1">{tr('Supplier price per kg', 'සැපයුම්කරු කිලෝ මිල')}</label>
                <input type="number" step="any" min="0" className="form-control mb-2" value={price} onChange={(e) => setPrice(e.target.value)} />
                <div className="mb-3">{tr('New total', 'නව එකතුව')}: <b>Rs. {money(num(weight) * num(price))}</b></div>
                {error && <div className="alert alert-danger py-2">{error}</div>}
                <div className="d-flex gap-2">
                    <button type="button" className="btn btn-secondary flex-fill" onClick={onClose} disabled={saving}>{tr('Cancel', 'අවලංගු')}</button>
                    <button type="submit" className="btn btn-success flex-fill fw-bold" disabled={saving}>{saving ? tr('Saving...', 'සුරකිමින්...') : tr('Save', 'සුරකින්න')}</button>
                </div>
            </form>
        </div>
    );
}
