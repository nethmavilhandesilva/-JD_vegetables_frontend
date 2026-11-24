import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import { tr } from '../../i18n/language';
import { printHtml } from '../../utils/printHtml';
import { SHOP_NAME } from '../../config/shop';

const money = (v) => Math.abs(parseFloat(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const loanTypeLabel = (type) => ({
    old: tr("Trader's old loan", 'වෙළෙන්දාගේ පැරණි ණය'),
    today: tr("Trader's loan taken today", 'වෙළෙන්දා අද ගත් ණය'),
    farmer_old: tr("Farmer's old loan", 'ගොවියාගේ පැරණි ණය'),
    farmer_today: tr("Farmer's loan taken today", 'ගොවියා අද ගත් ණය'),
    ingoing: tr('Other income', 'වෙනත් ආදායම්'),
    outgoing: tr('Expenses', 'වියදම්'),
    returns: tr('Returns', 'ආපසු'),
    grn_damage: tr('GRN damage', 'GRN හානි'),
}[type] || type || '—');

const TYPES = ['old', 'today', 'farmer_old', 'farmer_today', 'ingoing', 'outgoing', 'returns'];

/** Full loan report from income_expenses: date range, customer / farmer code and type filters. */
export default function LoanDetailedReport({ isOpen, onClose, codeOptions = [] }) {
    const [startDate, setStartDate] = useState(today());
    const [endDate, setEndDate] = useState(today());
    const [code, setCode] = useState('');
    const [loanType, setLoanType] = useState('');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await api.get('/customers-loans/detailed-report', {
                params: {
                    ...(startDate ? { start_date: startDate } : {}),
                    ...(endDate ? { end_date: endDate } : {}),
                    ...(code.trim() ? { code: code.trim() } : {}),
                    ...(loanType ? { loan_type: loanType } : {}),
                },
            });
            setData(res.data);
        } catch (err) {
            setError(err?.response?.data?.message || tr('Could not load the report.', 'වාර්තාව ලබා ගත නොහැක.'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (isOpen) load(); }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    const rows = useMemo(() => data?.rows || [], [data]);
    const grandTotal = useMemo(() => rows.reduce((s, r) => s + Math.abs(parseFloat(r.amount) || 0), 0), [rows]);

    if (!isOpen) return null;

    const print = () => {
        const range = data?.start_date ? `${data.start_date} – ${data.end_date}` : tr('All dates', 'සියලු දින');
        const body = rows.map((r, i) => `<tr>
            <td>${i + 1}</td><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.time || '')}</td><td>${escapeHtml(r.code || '')}</td>
            <td>${escapeHtml(loanTypeLabel(r.loan_type))}</td><td>${escapeHtml(r.description || '')}</td><td>${escapeHtml(r.bill_no || '')}</td>
            <td>${escapeHtml(r.settling_way || '')}${r.cheque_no ? ` #${escapeHtml(r.cheque_no)}` : ''}</td><td class="r">${money(r.amount)}</td></tr>`).join('');
        const summary = (data?.by_type || []).map((t) => `<tr><td>${escapeHtml(loanTypeLabel(t.loan_type))}</td><td class="r">${t.count}</td><td class="r">${money(t.total)}</td></tr>`).join('');
        printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(tr('Loan Report', 'ණය වාර්තාව'))}</title>
            <style>body{font-family:Arial,sans-serif;font-size:12px;margin:15px}h2,h4{margin:4px 0;text-align:center}
            table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #555;padding:3px 5px}th{background:#eee}.r{text-align:right}
            .sum{width:auto;margin-left:auto}</style></head><body>
            <h2>${escapeHtml(SHOP_NAME)}</h2><h4>${escapeHtml(tr('Detailed Loan Report', 'සවිස්තර ණය වාර්තාව'))} · ${escapeHtml(range)}
            ${code.trim() ? ` · ${escapeHtml(code.trim().toUpperCase())}` : ''}${loanType ? ` · ${escapeHtml(loanTypeLabel(loanType))}` : ''}</h4>
            <table><thead><tr><th>#</th><th>${tr('Date', 'දිනය')}</th><th>${tr('Time', 'වේලාව')}</th><th>${tr('Code', 'කේතය')}</th><th>${tr('Type', 'වර්ගය')}</th>
            <th>${tr('Description', 'විස්තරය')}</th><th>${tr('Bill No', 'බිල් අං')}</th><th>${tr('Payment', 'ගෙවීම')}</th><th class="r">${tr('Amount', 'මුදල')}</th></tr></thead>
            <tbody>${body}</tbody></table>
            <table class="sum"><thead><tr><th>${tr('Type', 'වර්ගය')}</th><th>${tr('Records', 'වාර්තා')}</th><th>${tr('Total', 'එකතුව')}</th></tr></thead>
            <tbody>${summary}<tr><th>${tr('Grand total', 'මුළු එකතුව')}</th><th class="r">${rows.length}</th><th class="r">${money(grandTotal)}</th></tr></tbody></table>
            </body></html>`);
    };

    return (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1060 }} role="dialog" aria-modal="true">
            <div className="modal-dialog modal-xl modal-dialog-scrollable">
                <div className="modal-content text-dark">
                    <div className="modal-header" style={{ background: '#1e4d14', color: 'white' }}>
                        <h5 className="modal-title">{tr('Detailed Loan Report', 'සවිස්තර ණය වාර්තාව')}</h5>
                        <button type="button" className="btn-close btn-close-white" onClick={onClose} />
                    </div>
                    <div className="modal-body" style={{ background: '#f4f6f9' }}>
                        <form className="row g-2 align-items-end mb-3" onSubmit={(e) => { e.preventDefault(); load(); }}>
                            <div className="col-6 col-md-2">
                                <label className="form-label fw-bold mb-1">{tr('Start date', 'ආරම්භ දිනය')}</label>
                                <input type="date" className="form-control" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                            </div>
                            <div className="col-6 col-md-2">
                                <label className="form-label fw-bold mb-1">{tr('End date', 'අවසන් දිනය')}</label>
                                <input type="date" className="form-control" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                            </div>
                            <div className="col-6 col-md-3">
                                <label className="form-label fw-bold mb-1">{tr('Customer / farmer code', 'පාරිභෝගික / ගොවි කේතය')}</label>
                                <input className="form-control text-uppercase" list="loanReportCodes" value={code} onChange={(e) => setCode(e.target.value)} placeholder={tr('All', 'සියල්ල')} />
                                <datalist id="loanReportCodes">
                                    {codeOptions.map((c) => <option key={c} value={c} />)}
                                </datalist>
                            </div>
                            <div className="col-6 col-md-3">
                                <label className="form-label fw-bold mb-1">{tr('Type', 'වර්ගය')}</label>
                                <select className="form-select" value={loanType} onChange={(e) => setLoanType(e.target.value)}>
                                    <option value="">{tr('All types', 'සියලු වර්ග')}</option>
                                    {TYPES.map((t) => <option key={t} value={t}>{loanTypeLabel(t)}</option>)}
                                </select>
                            </div>
                            <div className="col-12 col-md-2 d-flex gap-2">
                                <button type="submit" className="btn btn-success flex-fill" disabled={loading}>{loading ? '...' : tr('Search', 'සොයන්න')}</button>
                                <button type="button" className="btn btn-outline-dark" onClick={print} disabled={!rows.length}>🖨️</button>
                            </div>
                            <div className="col-12">
                                <button type="button" className="btn btn-link btn-sm p-0" onClick={() => { setStartDate(''); setEndDate(''); }}>{tr('Clear dates (all dates)', 'දින ඉවත් කරන්න (සියලු දින)')}</button>
                            </div>
                        </form>

                        {error && <div className="alert alert-danger py-2">{error}</div>}

                        {data && (
                            <div className="d-flex flex-wrap gap-2 mb-3">
                                {(data.by_type || []).map((t) => (
                                    <div key={t.loan_type} className="bg-white rounded px-3 py-2 border">
                                        <div className="small text-muted">{loanTypeLabel(t.loan_type)} ({t.count})</div>
                                        <div className="fw-bold">Rs. {money(t.total)}</div>
                                    </div>
                                ))}
                                <div className="bg-white rounded px-3 py-2 border border-success ms-auto">
                                    <div className="small text-muted">{tr('Grand total', 'මුළු එකතුව')} ({rows.length})</div>
                                    <div className="fw-bold text-success fs-5">Rs. {money(grandTotal)}</div>
                                </div>
                            </div>
                        )}

                        <div className="table-responsive">
                            <table className="table table-sm table-bordered table-striped bg-white align-middle mb-0">
                                <thead className="table-success">
                                    <tr>
                                        <th>#</th><th>{tr('Date', 'දිනය')}</th><th>{tr('Time', 'වේලාව')}</th><th>{tr('Code', 'කේතය')}</th>
                                        <th>{tr('Type', 'වර්ගය')}</th><th>{tr('Description', 'විස්තරය')}</th><th>{tr('Bill No', 'බිල් අං')}</th>
                                        <th>{tr('Payment', 'ගෙවීම')}</th><th className="text-end">{tr('Amount', 'මුදල')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <tr><td colSpan={9} className="text-center text-muted py-3">{tr('Loading...', 'පූරණය වෙමින්...')}</td></tr>}
                                    {!loading && rows.length === 0 && <tr><td colSpan={9} className="text-center text-muted py-3">{tr('No records for these filters.', 'මෙම පෙරහන් සඳහා වාර්තා නැත.')}</td></tr>}
                                    {!loading && rows.map((r, i) => (
                                        <tr key={r.id}>
                                            <td>{i + 1}</td>
                                            <td className="text-nowrap">{r.date}</td>
                                            <td>{r.time}</td>
                                            <td className="fw-bold">{r.code}</td>
                                            <td>{loanTypeLabel(r.loan_type)}</td>
                                            <td>{r.description}</td>
                                            <td>{r.bill_no}</td>
                                            <td>{r.settling_way}{r.cheque_no ? ` #${r.cheque_no}` : ''}{r.bank ? ` (${r.bank})` : ''}</td>
                                            <td className="text-end fw-semibold">{money(r.amount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
