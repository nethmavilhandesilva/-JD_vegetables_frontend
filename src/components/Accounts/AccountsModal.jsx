import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import { tr } from '../../i18n/language';
import SupplierLineEditModal from '../Suppliers/SupplierLineEditModal';

// Accounts (bottom navigation bar)
//  - Customers: customer codes + full names from the sales table -> full bill details
//  - Suppliers: supplier codes from the sales table -> each supplier bill no and its total
//  - Workers:   simple data entry (workers table)

const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};
const money = (v) => num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg = (v) => num(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
// Same as the customer bill: weight x price + bags x bag price + kuliya
const customerLineTotal = (r) => num(r.weight) * num(r.price_per_kg) + num(r.packs) * num(r.CustomerPackCost) + num(r.Kuliya);
const apiError = (err, fallback) => {
    const errors = err?.response?.data?.errors;
    if (errors) return Object.values(errors).flat().join(' ');
    return err?.response?.data?.message || fallback;
};

const emptyWorker = { name: '', phone: '', nic: '', address: '', job_role: '', daily_wage: '', joined_date: '', is_active: true, notes: '' };

const styles = `
    .accounts-modal .table thead th, .accounts-modal .table thead th * {
        --bs-table-color:#ffffff; --bs-table-bg:#1b5e20;
        background-color:#1b5e20 !important; color:#ffffff !important; white-space:nowrap;
    }
    .accounts-modal .pick-card { border:2px solid #1b5e20; border-radius:12px; padding:28px 16px; text-align:center;
        background:#fff; cursor:pointer; transition:transform .1s, box-shadow .1s; width:100%; }
    .accounts-modal .pick-card:hover { transform:translateY(-2px); box-shadow:0 6px 16px rgba(0,0,0,.15); }
    .accounts-modal .pick-card .material-icons { font-size:48px; color:#1b5e20; }
    .accounts-modal .clickable { cursor:pointer; }
    .accounts-modal .clickable:hover td { background:#e8f5e9 !important; }
    .accounts-modal .bill-card { border:1px solid #c8e6c9; border-radius:10px; margin-bottom:14px; overflow:hidden; background:#fff; }
    .accounts-modal .bill-card .bill-head { background:#e8f5e9; padding:8px 12px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; font-weight:600; }
`;

export default function AccountsModal({ isOpen, onClose }) {
    // view: home | customers | customer | suppliers | supplier | workers
    const [view, setView] = useState('home');
    const [selectedCode, setSelectedCode] = useState(null);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [customers, setCustomers] = useState([]);
    const [customerDetail, setCustomerDetail] = useState(null);
    const [suppliers, setSuppliers] = useState([]);
    const [supplierDetail, setSupplierDetail] = useState(null);
    const [openBills, setOpenBills] = useState({});
    // Customers: Credit (still owing) / Received (every bill fully received) lists, and settling bills
    const [customerTab, setCustomerTab] = useState('credit');
    const [settleForm, setSettleForm] = useState(null); // { key, billNo, date, total, balance, amount, useCredit, received_date, note, askPartial }
    const [receiptForm, setReceiptForm] = useState(null); // received amount without a bill: { amount, received_date, note }
    const [settleMsg, setSettleMsg] = useState({ type: '', text: '' });
    const [savingSettle, setSavingSettle] = useState(false);
    const [editingLine, setEditingLine] = useState(null); // supplier bill record being edited
    const [editingSiblings, setEditingSiblings] = useState([]); // same item records of that bill

    const [workers, setWorkers] = useState([]);
    const [workerForm, setWorkerForm] = useState(emptyWorker);
    const [editingWorkerId, setEditingWorkerId] = useState(null);
    const [workerMsg, setWorkerMsg] = useState({ type: '', text: '' });
    const [savingWorker, setSavingWorker] = useState(false);

    const load = useCallback(async (fn) => {
        setLoading(true);
        setError('');
        try { await fn(); } catch (err) { setError(apiError(err, tr('Could not load data.', 'දත්ත ලබා ගත නොහැක.'))); } finally { setLoading(false); }
    }, []);

    useEffect(() => {
        if (!isOpen) { setView('home'); setSearch(''); setError(''); }
    }, [isOpen]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && isOpen) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    const go = (next, code = null) => {
        setView(next);
        setSelectedCode(code);
        setSearch('');
        setError('');
        setOpenBills({});
        if (next === 'customers') load(async () => setCustomers((await api.get('/accounts/customers')).data.customers || []));
        if (next === 'suppliers') load(async () => setSuppliers((await api.get('/accounts/suppliers')).data.suppliers || []));
        if (next === 'customer') { setCustomerDetail(null); load(async () => setCustomerDetail((await api.get(`/accounts/customers/${encodeURIComponent(code)}`)).data)); }
        if (next === 'supplier') { setSupplierDetail(null); load(async () => setSupplierDetail((await api.get(`/accounts/suppliers/${encodeURIComponent(code)}`)).data)); }
        if (next === 'workers') load(async () => setWorkers((await api.get('/accounts/workers')).data.workers || []));
    };

    const back = () => {
        if (view === 'customer') go('customers');
        else if (view === 'supplier') go('suppliers');
        else setView('home');
    };

    // ---------- customers ----------
    const filteredCustomers = useMemo(() => {
        const q = search.trim().toUpperCase();
        // A customer is in Credit while any bill is open and in Received for the settled bills (can be both)
        const inTab = customers.filter(c => (customerTab === 'received' ? !!c.received : !!c.credit));
        return q ? inTab.filter(c => c.customer_code.includes(q) || (c.full_name || '').toUpperCase().includes(q)) : inTab;
    }, [customers, search, customerTab]);
    const creditCount = useMemo(() => customers.filter(c => c.credit).length, [customers]);
    const receivedCount = useMemo(() => customers.filter(c => c.received).length, [customers]);

    const customerBills = useMemo(() => {
        if (!customerDetail) return [];
        const groups = new Map();
        // Records come from today's sales and the sales history; a bill number can repeat on
        // different days, so a bill is date + bill no. Today's unprinted lines are one group.
        (customerDetail.records || []).forEach(r => {
            const key = r.bill_no ? `${r.Date || ''}|${r.bill_no}` : '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(r);
        });
        return Array.from(groups.entries())
            .map(([key, lines]) => ({
                key: key || 'unprinted',
                billNo: lines[0].bill_no ? String(lines[0].bill_no) : null,
                date: lines[0].Date || null,
                printed: !!key && lines.some(l => l.bill_printed === 'Y'),
                credit: lines.some(l => l.credit_transaction === 'Y'),
                lines,
                weight: lines.reduce((s, l) => s + num(l.weight), 0),
                packs: lines.reduce((s, l) => s + num(l.packs), 0),
                kuliya: lines.reduce((s, l) => s + num(l.Kuliya), 0),
                total: lines.reduce((s, l) => s + customerLineTotal(l), 0),
                // Settlements are saved against bill date + bill no
                settleKey: lines[0].bill_no ? `${String(lines[0].Date || '').slice(0, 10)}|${lines[0].bill_no}` : null,
            }))
            .map(b => {
                const settlements = b.settleKey ? (customerDetail.settlements || []).filter(x => x.bill_key === b.settleKey) : [];
                const received = settlements.reduce((s, x) => s + num(x.amount), 0);
                // Settled: received covers the total, or closed with a smaller amount ("fully settle")
                const closed = settlements.some(x => x.closes_bill);
                const fullyReceived = !!b.settleKey && b.total > 0 && (closed || received >= b.total - 0.009);
                return { ...b, settlements, received, closed, short: closed ? Math.max(0, b.total - received) : 0, balance: fullyReceived ? 0 : b.total - received, fullyReceived };
            })
            // Unprinted first, then newest day first, then bill number
            .sort((a, b) => (b.billNo === null) - (a.billNo === null)
                || String(b.date || '').localeCompare(String(a.date || ''))
                || (parseInt(a.billNo) || 0) - (parseInt(b.billNo) || 0));
    }, [customerDetail]);

    const reloadCustomer = () => load(async () => setCustomerDetail((await api.get(`/accounts/customers/${encodeURIComponent(selectedCode)}`)).data));
    const availableCredit = num(customerDetail?.available_credit);
    // Bills shown on the customer page: open ones (Credit) or settled ones (Received)
    const shownCustomerBills = useMemo(
        () => customerBills.filter(b => (customerTab === 'received' ? b.fullyReceived : !b.fullyReceived)),
        [customerBills, customerTab]
    );

    const openSettle = (b) => {
        setSettleMsg({ type: '', text: '' });
        const balance = Math.round(b.balance * 100) / 100;
        const credit = Math.min(availableCredit, balance);
        setSettleForm({
            key: b.settleKey, billNo: b.billNo, date: String(b.date || '').slice(0, 10), total: b.total, balance,
            // The customer's received amount is used first; the rest is typed as received now
            useCredit: credit > 0, amount: String(Math.round((balance - credit) * 100) / 100),
            received_date: new Date().toISOString().slice(0, 10), note: '', askPartial: false,
        });
    };
    const settleCreditUsed = settleForm?.useCredit ? Math.min(availableCredit, settleForm.balance) : 0;

    // Full amount = bill settled. Less than the balance = ask: fully settle with it, or partial payment.
    const saveSettlement = async (e, mode = null) => {
        e?.preventDefault();
        if (!settleForm || savingSettle) return;
        const amount = settleForm.amount === '' ? 0 : Number(settleForm.amount);
        if (!Number.isFinite(amount) || amount < 0) { setSettleMsg({ type: 'error', text: tr('Enter the amount received.', 'ලැබුණු මුදල ඇතුළත් කරන්න.') }); return; }
        const paying = amount + settleCreditUsed;
        if (paying <= 0) { setSettleMsg({ type: 'error', text: tr('Enter the amount received.', 'ලැබුණු මුදල ඇතුළත් කරන්න.') }); return; }
        const isFull = paying >= settleForm.balance - 0.009;
        if (!isFull && !mode) { setSettleForm(f => ({ ...f, askPartial: true })); return; }
        setSavingSettle(true);
        try {
            await api.post(`/accounts/customers/${encodeURIComponent(selectedCode)}/settlements`, {
                bill_key: settleForm.key, bill_no: settleForm.billNo, bill_date: settleForm.date || null,
                amount, credit_used: settleCreditUsed, received_date: settleForm.received_date,
                note: settleForm.note.trim() || null,
                closes_bill: isFull || mode === 'full',
            });
            setSettleForm(null);
            setSettleMsg({
                type: 'ok',
                text: isFull || mode === 'full'
                    ? tr('Bill settled: moved to Received.', 'බිල්පත පියවා ඇත: ලැබුණු ලැයිස්තුවට ගෙන යන ලදී.')
                    : tr('Part payment saved.', 'කොටස් ගෙවීම සුරකින ලදී.'),
            });
            reloadCustomer();
        } catch (err) {
            setSettleMsg({ type: 'error', text: apiError(err, tr('Could not save the payment.', 'ගෙවීම සුරැකීමට නොහැකි විය.')) });
        } finally {
            setSavingSettle(false);
        }
    };

    // Received amount without a bill: kept for the customer and used when bills are settled
    const saveReceipt = async (e) => {
        e.preventDefault();
        if (!receiptForm || savingSettle) return;
        const amount = Number(receiptForm.amount);
        if (!Number.isFinite(amount) || amount <= 0) { setSettleMsg({ type: 'error', text: tr('Enter the amount received.', 'ලැබුණු මුදල ඇතුළත් කරන්න.') }); return; }
        setSavingSettle(true);
        try {
            await api.post(`/accounts/customers/${encodeURIComponent(selectedCode)}/settlements`, {
                bill_key: null, amount, received_date: receiptForm.received_date, note: receiptForm.note.trim() || null,
            });
            setReceiptForm(null);
            setSettleMsg({ type: 'ok', text: tr('Received amount saved. It is used first when you settle a bill.', 'ලැබුණු මුදල සුරකින ලදී. බිල්පතක් පියවන විට එය මුලින්ම භාවිත වේ.') });
            reloadCustomer();
        } catch (err) {
            setSettleMsg({ type: 'error', text: apiError(err, tr('Could not save the amount.', 'මුදල සුරැකීමට නොහැකි විය.')) });
        } finally {
            setSavingSettle(false);
        }
    };

    const deleteSettlement = async (x) => {
        if (!window.confirm(tr(`Remove the payment of Rs. ${money(x.amount)}?`, `රු. ${money(x.amount)} ගෙවීම ඉවත් කරන්නද?`))) return;
        try {
            await api.delete(`/accounts/customer-settlements/${x.id}`);
            reloadCustomer();
        } catch (err) {
            setSettleMsg({ type: 'error', text: apiError(err, tr('Could not remove the payment.', 'ගෙවීම ඉවත් කළ නොහැක.')) });
        }
    };

    // ---------- suppliers ----------
    const filteredSuppliers = useMemo(() => {
        const q = search.trim().toUpperCase();
        return q ? suppliers.filter(s => s.supplier_code.includes(q) || (s.full_name || '').toUpperCase().includes(q)) : suppliers;
    }, [suppliers, search]);

    // ---------- workers ----------
    const saveWorker = async (e) => {
        e.preventDefault();
        if (!workerForm.name.trim()) { setWorkerMsg({ type: 'error', text: tr('Enter the worker name.', 'සේවකයාගේ නම ඇතුළත් කරන්න.') }); return; }
        setSavingWorker(true);
        setWorkerMsg({ type: '', text: '' });
        const payload = {
            ...workerForm,
            name: workerForm.name.trim(),
            daily_wage: workerForm.daily_wage === '' ? 0 : num(workerForm.daily_wage),
            joined_date: workerForm.joined_date || null,
        };
        try {
            if (editingWorkerId) {
                const res = await api.put(`/accounts/workers/${editingWorkerId}`, payload);
                setWorkers(prev => prev.map(w => (w.id === editingWorkerId ? res.data : w)));
                setWorkerMsg({ type: 'success', text: tr('Worker updated.', 'සේවකයා යාවත්කාලීන විය.') });
            } else {
                const res = await api.post('/accounts/workers', payload);
                setWorkers(prev => [...prev, res.data]);
                setWorkerMsg({ type: 'success', text: tr('Worker added.', 'සේවකයා එක් කළා.') });
            }
            setWorkerForm(emptyWorker);
            setEditingWorkerId(null);
        } catch (err) {
            setWorkerMsg({ type: 'error', text: apiError(err, tr('Could not save the worker.', 'සේවකයා සුරැකිය නොහැක.')) });
        } finally {
            setSavingWorker(false);
        }
    };

    const editWorker = (w) => {
        setEditingWorkerId(w.id);
        setWorkerForm({
            name: w.name || '', phone: w.phone || '', nic: w.nic || '', address: w.address || '', job_role: w.job_role || '',
            daily_wage: num(w.daily_wage) ? String(w.daily_wage) : '', joined_date: w.joined_date || '', is_active: !!w.is_active, notes: w.notes || '',
        });
        setWorkerMsg({ type: '', text: '' });
    };

    const deleteWorker = async (w) => {
        if (!window.confirm(tr(`Delete worker ${w.name}?`, `සේවක ${w.name} මකන්නද?`))) return;
        try {
            await api.delete(`/accounts/workers/${w.id}`);
            setWorkers(prev => prev.filter(x => x.id !== w.id));
            if (editingWorkerId === w.id) { setEditingWorkerId(null); setWorkerForm(emptyWorker); }
        } catch (err) {
            setWorkerMsg({ type: 'error', text: apiError(err, tr('Could not delete the worker.', 'සේවකයා මැකිය නොහැක.')) });
        }
    };

    if (!isOpen) return null;

    const titles = {
        home: tr('Accounts', 'ගිණුම්'),
        customers: tr('Customers', 'පාරිභෝගිකයින්'),
        customer: `${tr('Customer', 'පාරිභෝගික')}: ${selectedCode}`,
        suppliers: tr('Suppliers', 'සැපයුම්කරුවන්'),
        supplier: `${tr('Supplier', 'සැපයුම්කරු')}: ${selectedCode}`,
        workers: tr('Workers', 'සේවකයින්'),
    };

    const searchBox = (placeholder) => (
        <input type="text" className="form-control mb-3" placeholder={placeholder} value={search}
            onChange={(e) => setSearch(e.target.value)} autoFocus
            onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                // Keep Enter inside the modal so page/browser handlers behind it don't react
                e.preventDefault();
                e.stopPropagation();
                if (!search.trim()) return;
                if (view === 'customers' && filteredCustomers.length > 0) go('customer', filteredCustomers[0].customer_code);
                if (view === 'suppliers' && filteredSuppliers.length > 0) go('supplier', filteredSuppliers[0].supplier_code);
            }} />
    );

    return (
        <div className="modal show d-block accounts-modal" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1055 }} role="dialog" aria-modal="true">
            <style>{styles}</style>
            <SupplierLineEditModal record={editingLine} sameItemRecords={editingSiblings} onClose={() => setEditingLine(null)}
                onSaved={() => load(async () => setSupplierDetail((await api.get(`/accounts/suppliers/${encodeURIComponent(selectedCode)}`)).data))} />
            <div className="modal-dialog modal-xl modal-dialog-scrollable">
                <div className="modal-content" style={{ background: '#f4f6f9' }}>
                    <div className="modal-header" style={{ background: '#1b5e20', color: '#fff' }}>
                        {view !== 'home' && (
                            <button type="button" className="btn btn-sm btn-light me-2" onClick={back}>← {tr('Back', 'ආපසු')}</button>
                        )}
                        <h5 className="modal-title mb-0">{titles[view]}</h5>
                        <button type="button" className="btn-close btn-close-white ms-auto" onClick={onClose} aria-label="Close" />
                    </div>

                    <div className="modal-body">
                        {error && <div className="alert alert-danger py-2">{error}</div>}
                        {loading && <div className="text-center text-muted py-3">{tr('Loading...', 'පූරණය වෙමින්...')}</div>}

                        {/* ---------- HOME: three options ---------- */}
                        {view === 'home' && (
                            <div className="row g-3 py-3">
                                {[
                                    ['customers', 'groups', tr('Customers', 'පාරිභෝගිකයින්'), tr('Bill details of every customer', 'සෑම පාරිභෝගිකයෙකුගේම බිල්පත් විස්තර')],
                                    ['suppliers', 'local_shipping', tr('Suppliers', 'සැපයුම්කරුවන්'), tr('Bill numbers and totals', 'බිල් අංක සහ එකතු')],
                                    ['workers', 'badge', tr('Workers', 'සේවකයින්'), tr('Add and manage workers', 'සේවකයින් එක් කිරීම සහ කළමනාකරණය')],
                                ].map(([key, icon, label, sub]) => (
                                    <div className="col-12 col-md-4" key={key}>
                                        <button type="button" className="pick-card" onClick={() => go(key)}>
                                            <i className="material-icons">{icon}</i>
                                            <div className="fs-4 fw-bold mt-2" style={{ color: '#1b5e20' }}>{label}</div>
                                            <div className="text-muted small">{sub}</div>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* ---------- CUSTOMERS list ---------- */}
                        {view === 'customers' && !loading && (
                            <>
                                <div className="btn-group mb-2" role="group">
                                    <button type="button" className={`btn btn-sm fw-bold ${customerTab === 'credit' ? 'btn-danger' : 'btn-outline-danger'}`} onClick={() => setCustomerTab('credit')}>
                                        {tr('Credit', 'ණය')} ({creditCount})
                                    </button>
                                    <button type="button" className={`btn btn-sm fw-bold ${customerTab === 'received' ? 'btn-success' : 'btn-outline-success'}`} onClick={() => setCustomerTab('received')}>
                                        {tr('Received', 'ලැබුණු')} ({receivedCount})
                                    </button>
                                </div>
                                {searchBox(tr('Search customer code or name...', 'පාරිභෝගික කේතය හෝ නම සොයන්න...'))}
                                <div className="table-responsive">
                                    <table className="table table-sm table-bordered table-hover align-middle bg-white mb-0">
                                        <thead><tr>
                                            <th>{tr('Customer Code', 'පාරිභෝගික කේතය')}</th>
                                            <th className="text-end">{customerTab === 'received' ? tr('Settled bills', 'පියවූ බිල්පත්') : tr('Open bills', 'ණය බිල්පත්')}</th>
                                            <th className="text-end">{tr('Total (Rs.)', 'එකතුව (රු.)')}</th>
                                            {customerTab === 'credit' && <th className="text-end">{tr('Balance', 'ශේෂය')}</th>}
                                            <th>{customerTab === 'received' ? tr('Last received', 'අවසන් ලැබීම') : tr('Last sale', 'අවසන් විකිණීම')}</th>
                                        </tr></thead>
                                        <tbody>
                                            {filteredCustomers.length === 0 && <tr><td colSpan={5} className="text-center text-muted py-3">{customerTab === 'received' ? tr('No settled bills yet.', 'තවම පියවූ බිල්පත් නැත.') : tr('No customers with credit.', 'ණය ඇති පාරිභෝගිකයින් නැත.')}</td></tr>}
                                            {filteredCustomers.map(c => {
                                                const part = customerTab === 'received' ? c.received : c.credit;
                                                const alsoOther = customerTab === 'received' ? !!c.credit : !!c.received;
                                                return (
                                                    <tr key={c.customer_code} className="clickable" onClick={() => go('customer', c.customer_code)}>
                                                        <td className="fw-bold text-primary">
                                                            {c.customer_code}
                                                            {alsoOther && (
                                                                <span className={`badge ms-2 ${customerTab === 'received' ? 'bg-danger' : 'bg-success'}`} style={{ fontSize: '0.65rem' }}>
                                                                    {customerTab === 'received' ? tr('also has credit', 'ණයද ඇත') : tr('some bills settled', 'බිල්පත් කිහිපයක් පියවා ඇත')}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="text-end">{part.bills}{customerTab === 'credit' && c.unprinted_records > 0 && <span className="badge bg-warning text-dark ms-1">{tr('+ unprinted', '+ මුද්‍රණය නොකළ')}</span>}</td>
                                                        <td className="text-end">{money(part.total)}</td>
                                                        {customerTab === 'credit' && <td className={`text-end fw-bold ${num(part.balance) > 0.009 ? 'text-danger' : 'text-success'}`}>{money(part.balance)}</td>}
                                                        <td>{customerTab === 'received'
                                                            ? (part.last_received || part.last_date || '—')
                                                            : (c.in_today ? <span className="badge bg-success">{tr('Today', 'අද')}</span> : (part.last_date || '—'))}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}

                        {/* ---------- CUSTOMER bills (open or settled) ---------- */}
                        {view === 'customer' && customerDetail && !loading && (
                            <>
                                <div className="bg-white rounded p-3 mb-3 d-flex flex-wrap align-items-center gap-4">
                                    <div><div className="small text-muted">{tr('Customer Code', 'පාරිභෝගික කේතය')}</div><div className="fw-bold fs-5">{selectedCode}</div></div>
                                    <div className="btn-group" role="group">
                                        <button type="button" className={`btn btn-sm fw-bold ${customerTab === 'credit' ? 'btn-danger' : 'btn-outline-danger'}`} onClick={() => setCustomerTab('credit')}>
                                            {tr('Credit bills', 'ණය බිල්පත්')} ({customerBills.filter(b => !b.fullyReceived).length})
                                        </button>
                                        <button type="button" className={`btn btn-sm fw-bold ${customerTab === 'received' ? 'btn-success' : 'btn-outline-success'}`} onClick={() => setCustomerTab('received')}>
                                            {tr('Settled bills', 'පියවූ බිල්පත්')} ({customerBills.filter(b => b.fullyReceived).length})
                                        </button>
                                    </div>
                                    <div className="ms-auto text-end"><div className="small text-muted">{tr('Open balance', 'ණය ශේෂය')}</div><div className="fw-bold fs-5 text-danger">Rs. {money(customerBills.reduce((s, b) => s + b.balance, 0))}</div></div>
                                    <div className="text-end">
                                        <div className="small text-muted">{tr('Received amount (not used yet)', 'ලැබුණු මුදල (තවම භාවිත නොකළ)')}</div>
                                        <div className="fw-bold fs-5 text-success">Rs. {money(availableCredit)}</div>
                                    </div>
                                    <div className="text-end"><div className="small text-muted">{tr('Still owed', 'තවම ගෙවිය යුතු')}</div><div className="fw-bold fs-4 text-danger">Rs. {money(Math.max(0, customerBills.reduce((s, b) => s + b.balance, 0) - availableCredit))}</div></div>
                                    <button type="button" className="btn btn-sm btn-outline-success fw-bold"
                                        onClick={() => { setSettleMsg({ type: '', text: '' }); setReceiptForm({ amount: '', received_date: new Date().toISOString().slice(0, 10), note: '' }); }}>
                                        + {tr('Enter received amount', 'ලැබුණු මුදල ඇතුළත් කරන්න')}
                                    </button>
                                </div>

                                {receiptForm && (
                                    <form className="d-flex flex-wrap align-items-end gap-2 p-2 mb-3 rounded" style={{ background: '#e8f5e9' }} onSubmit={saveReceipt}>
                                        <div>
                                            <label className="small fw-bold d-block">{tr('Received date', 'ලැබුණු දිනය')}</label>
                                            <input type="date" className="form-control form-control-sm" required value={receiptForm.received_date} onChange={e => setReceiptForm(f => ({ ...f, received_date: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label className="small fw-bold d-block">{tr('Amount received', 'ලැබුණු මුදල')}</label>
                                            <input type="number" step="any" min="0" className="form-control form-control-sm" required autoFocus value={receiptForm.amount} onChange={e => setReceiptForm(f => ({ ...f, amount: e.target.value }))} />
                                        </div>
                                        <div style={{ flex: '1 1 160px' }}>
                                            <label className="small fw-bold d-block">{tr('Note', 'සටහන')}</label>
                                            <input className="form-control form-control-sm" value={receiptForm.note} onChange={e => setReceiptForm(f => ({ ...f, note: e.target.value }))} placeholder={tr('Optional (cash / cheque no)', 'විකල්ප (මුදල් / චෙක් අංකය)')} />
                                        </div>
                                        <button type="submit" className="btn btn-sm btn-success fw-bold" disabled={savingSettle}>{savingSettle ? '...' : tr('Save', 'සුරකින්න')}</button>
                                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setReceiptForm(null)}>{tr('Cancel', 'අවලංගු')}</button>
                                        <div className="w-100 small text-muted">{tr('This amount is kept for the customer and deducted first when you settle a bill.', 'මෙම මුදල පාරිභෝගිකයා සඳහා තබා බිල්පතක් පියවන විට මුලින්ම අඩු කෙරේ.')}</div>
                                    </form>
                                )}

                                {settleMsg.text && <div className={`alert alert-${settleMsg.type === 'error' ? 'danger' : 'success'} py-2`}>{settleMsg.text}</div>}

                                {/* received amounts entered without a bill */}
                                {(customerDetail.settlements || []).some(x => !x.bill_key) && (
                                    <div className="small mb-2">
                                        <b>{tr('Received amounts', 'ලැබුණු මුදල්')}:</b>{' '}
                                        {(customerDetail.settlements || []).filter(x => !x.bill_key).map(x => (
                                            <span key={x.id} className="badge bg-light text-dark border me-1">
                                                {String(x.received_date).slice(0, 10)} · Rs. {money(x.amount)}{x.note ? ` · ${x.note}` : ''}
                                                <button type="button" className="btn btn-link btn-sm text-danger p-0 ms-1" style={{ fontSize: '0.75rem' }} onClick={() => deleteSettlement(x)}>✕</button>
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="table-responsive">
                                    <table className="table table-sm table-bordered align-middle bg-white mb-0">
                                        <thead><tr>
                                            <th>{tr('Date', 'දිනය')}</th>
                                            <th>{tr('Bill No', 'බිල් අංකය')}</th>
                                            <th className="text-end">{tr('Total (Rs.)', 'එකතුව (රු.)')}</th>
                                            <th className="text-end">{tr('Received', 'ලැබුණු')}</th>
                                            <th className="text-end">{tr('Balance', 'ශේෂය')}</th>
                                            <th>{tr('Status', 'තත්ත්වය')}</th>
                                            <th></th>
                                        </tr></thead>
                                        <tbody>
                                            {shownCustomerBills.length === 0 && <tr><td colSpan={7} className="text-center text-muted py-3">{customerTab === 'received' ? tr('No settled bills.', 'පියවූ බිල්පත් නැත.') : tr('No open bills.', 'ණය බිල්පත් නැත.')}</td></tr>}
                                            {shownCustomerBills.map(b => (
                                                <React.Fragment key={b.key}>
                                                    <tr style={b.fullyReceived ? { background: '#f0fdf4' } : undefined}>
                                                        <td className="text-nowrap">{b.date ? String(b.date).slice(0, 10) : '—'}</td>
                                                        <td>{b.billNo || <span className="text-muted">{tr('Not printed yet', 'තවම මුද්‍රණය කර නැත')}</span>}</td>
                                                        <td className="text-end fw-semibold">{money(b.total)}</td>
                                                        <td className="text-end text-success">{b.received ? money(b.received) : '—'}</td>
                                                        <td className={`text-end fw-bold ${b.balance > 0.009 ? 'text-danger' : 'text-success'}`}>{money(b.balance)}</td>
                                                        <td>
                                                            {b.fullyReceived
                                                                ? <span className="badge bg-success">{tr('Settled', 'පියවා ඇත')}{b.short > 0.009 ? ` (${tr('short', 'අඩු')} ${money(b.short)})` : ''}</span>
                                                                : b.received > 0
                                                                    ? <span className="badge bg-warning text-dark">{tr('Part paid', 'කොටසක් ගෙවූ')}</span>
                                                                    : <span className="badge bg-danger">{tr('Credit', 'ණය')}</span>}
                                                        </td>
                                                        <td className="text-end">
                                                            {b.settleKey && !b.fullyReceived && (
                                                                <button type="button" className="btn btn-sm btn-success py-0" onClick={() => openSettle(b)}>
                                                                    {tr('Settle', 'පියවන්න')}
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {settleForm?.key === b.settleKey && b.settleKey && (
                                                        <tr style={{ background: '#e8f5e9' }}>
                                                            <td colSpan={7}>
                                                                <form className="d-flex flex-wrap align-items-end gap-2" onSubmit={(e) => saveSettlement(e)}>
                                                                    <div className="w-100 small">
                                                                        {tr('Bill balance', 'බිල් ශේෂය')}: <b>Rs. {money(settleForm.balance)}</b>
                                                                        {availableCredit > 0 && (
                                                                            <label className="ms-3" style={{ cursor: 'pointer' }}>
                                                                                <input type="checkbox" className="form-check-input me-1" checked={settleForm.useCredit}
                                                                                    onChange={e => {
                                                                                        const use = e.target.checked;
                                                                                        const credit = use ? Math.min(availableCredit, settleForm.balance) : 0;
                                                                                        setSettleForm(f => ({ ...f, useCredit: use, askPartial: false, amount: String(Math.round((f.balance - credit) * 100) / 100) }));
                                                                                    }} />
                                                                                {tr('Deduct the received amount', 'ලැබුණු මුදල අඩු කරන්න')}: <b className="text-success">Rs. {money(Math.min(availableCredit, settleForm.balance))}</b>
                                                                            </label>
                                                                        )}
                                                                    </div>
                                                                    <div>
                                                                        <label className="small fw-bold d-block">{tr('Received date', 'ලැබුණු දිනය')}</label>
                                                                        <input type="date" className="form-control form-control-sm" required value={settleForm.received_date} onChange={e => setSettleForm(f => ({ ...f, received_date: e.target.value }))} />
                                                                    </div>
                                                                    <div>
                                                                        <label className="small fw-bold d-block">{settleCreditUsed > 0 ? tr('Amount received now', 'දැන් ලැබුණු මුදල') : tr('Amount received', 'ලැබුණු මුදල')}</label>
                                                                        <input type="number" step="any" min="0" className="form-control form-control-sm" autoFocus value={settleForm.amount} onChange={e => setSettleForm(f => ({ ...f, amount: e.target.value, askPartial: false }))} />
                                                                    </div>
                                                                    <div style={{ flex: '1 1 160px' }}>
                                                                        <label className="small fw-bold d-block">{tr('Note', 'සටහන')}</label>
                                                                        <input className="form-control form-control-sm" value={settleForm.note} onChange={e => setSettleForm(f => ({ ...f, note: e.target.value }))} placeholder={tr('Optional (cash / cheque no)', 'විකල්ප (මුදල් / චෙක් අංකය)')} />
                                                                    </div>
                                                                    {!settleForm.askPartial && <button type="submit" className="btn btn-sm btn-success fw-bold" disabled={savingSettle}>{savingSettle ? '...' : tr('Save', 'සුරකින්න')}</button>}
                                                                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setSettleForm(null)}>{tr('Cancel', 'අවලංගු')}</button>
                                                                    {settleForm.askPartial && (
                                                                        <div className="w-100 p-2 rounded border border-warning" style={{ background: '#fffbeb' }}>
                                                                            <div className="fw-bold mb-2">
                                                                                {tr(`Rs. ${money((Number(settleForm.amount) || 0) + settleCreditUsed)} is less than the bill balance Rs. ${money(settleForm.balance)}. Do you want to fully settle this bill with this amount, or settle it partially?`,
                                                                                    `රු. ${money((Number(settleForm.amount) || 0) + settleCreditUsed)} බිල් ශේෂය රු. ${money(settleForm.balance)} ට වඩා අඩුයි. මෙම මුදලින් බිල්පත සම්පූර්ණයෙන් පියවන්නද, නැතහොත් කොටසක් පියවන්නද?`)}
                                                                            </div>
                                                                            <div className="d-flex flex-wrap gap-2">
                                                                                <button type="button" className="btn btn-sm btn-success fw-bold" disabled={savingSettle} onClick={(e) => saveSettlement(e, 'full')}>
                                                                                    ✓ {tr('Fully settle (move to Received)', 'සම්පූර්ණයෙන් පියවන්න (ලැබුණු වෙත)')}
                                                                                </button>
                                                                                <button type="button" className="btn btn-sm btn-warning fw-bold" disabled={savingSettle} onClick={(e) => saveSettlement(e, 'partial')}>
                                                                                    {tr('Partial payment (keep as credit)', 'කොටස් ගෙවීම (ණය ලෙස තබන්න)')}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </form>
                                                            </td>
                                                        </tr>
                                                    )}
                                                    {b.settlements.map(x => (
                                                        <tr key={`set-${x.id}`} className="small" style={{ background: '#f9fbe7' }}>
                                                            <td colSpan={3} className="ps-4 text-muted">
                                                                ↳ {tr('Received on', 'ලැබුණු දිනය')} {String(x.received_date).slice(0, 10)}
                                                                {x.from_credit ? ` · ${tr('from received amount', 'ලැබුණු මුදලෙන්')}` : ''}
                                                                {x.note && !x.from_credit ? ` · ${x.note}` : ''}
                                                                {x.closes_bill ? ` · ${tr('bill closed', 'බිල්පත වසා ඇත')}` : ''}
                                                            </td>
                                                            <td className="text-end text-success">{money(x.amount)}</td>
                                                            <td colSpan={2}></td>
                                                            <td className="text-end">
                                                                <button type="button" className="btn btn-sm btn-link text-danger p-0" title={tr('Remove this payment', 'මෙම ගෙවීම ඉවත් කරන්න')} onClick={() => deleteSettlement(x)}>✕</button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </React.Fragment>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}

                        {/* ---------- SUPPLIERS list ---------- */}
                        {view === 'suppliers' && !loading && (
                            <>
                                {searchBox(tr('Search supplier code or name...', 'සැපයුම්කරු කේතය හෝ නම සොයන්න...'))}
                                <div className="table-responsive">
                                    <table className="table table-sm table-bordered table-hover align-middle bg-white mb-0">
                                        <thead><tr>
                                            <th>{tr('Supplier Code', 'සැපයුම්කරු කේතය')}</th>
                                            <th>{tr('Name', 'නම')}</th>
                                            <th className="text-end">{tr('Bills', 'බිල්පත්')}</th>
                                            <th className="text-end">{tr('Records', 'වාර්තා')}</th>
                                            <th className="text-end">{tr('Total (Rs.)', 'එකතුව (රු.)')}</th>
                                            <th className="text-end">{tr('Advance', 'අත්තිකාරම්')}</th>
                                            <th className="text-end">{tr('Hire', 'කුලී')}</th>
                                            <th className="text-end">{tr('Net (Rs.)', 'ශුද්ධ (රු.)')}</th>
                                            <th>{tr('Last sale', 'අවසන් විකිණීම')}</th>
                                        </tr></thead>
                                        <tbody>
                                            {filteredSuppliers.length === 0 && <tr><td colSpan={9} className="text-center text-muted py-3">{tr('No suppliers in sales or sales history.', 'විකුණුම් හෝ විකුණුම් ඉතිහාසයේ සැපයුම්කරුවන් නැත.')}</td></tr>}
                                            {filteredSuppliers.map(s => (
                                                <tr key={s.supplier_code} className="clickable" onClick={() => go('supplier', s.supplier_code)}>
                                                    <td className="fw-bold text-primary">{s.supplier_code}</td>
                                                    <td>{s.full_name || <span className="text-muted">—</span>}</td>
                                                    <td className="text-end">{s.bills}</td>
                                                    <td className="text-end">{s.records}</td>
                                                    <td className="text-end">{money(s.total)}</td>
                                                    <td className="text-end text-danger">{num(s.advance) ? `-${money(s.advance)}` : '—'}</td>
                                                    <td className="text-end text-danger">{num(s.hire) ? `-${money(s.hire)}` : '—'}</td>
                                                    <td className="text-end fw-bold">{money(s.net ?? s.total)}</td>
                                                    <td>{s.in_today ? <span className="badge bg-success">{tr('Today', 'අද')}</span> : (s.last_date || '—')}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}

                        {/* ---------- SUPPLIER bills ---------- */}
                        {view === 'supplier' && supplierDetail && !loading && (
                            <>
                                <div className="bg-white rounded p-3 mb-3 d-flex flex-wrap gap-4">
                                    <div><div className="small text-muted">{tr('Supplier Code', 'සැපයුම්කරු කේතය')}</div><div className="fw-bold fs-5">{selectedCode}</div></div>
                                    <div><div className="small text-muted">{tr('Name', 'නම')}</div><div className="fw-bold fs-5">{supplierDetail.supplier?.name || '—'}</div></div>
                                    <div className="ms-auto text-end"><div className="small text-muted">{tr('Total', 'එකතුව')}</div><div className="fw-bold fs-5">Rs. {money((supplierDetail.bills || []).reduce((s, b) => s + num(b.total), 0))}</div></div>
                                    <div className="text-end"><div className="small text-muted">{tr('Advance + Hire', 'අත්තිකාරම් + කුලී')}</div><div className="fw-bold fs-5 text-danger">-{money((supplierDetail.bills || []).reduce((s, b) => s + num(b.advance) + num(b.hire), 0))}</div></div>
                                    <div className="text-end"><div className="small text-muted">{tr('Net Total', 'ශුද්ධ එකතුව')}</div><div className="fw-bold fs-4 text-success">Rs. {money((supplierDetail.bills || []).reduce((s, b) => s + num(b.net ?? b.total), 0))}</div></div>
                                </div>
                                <div className="table-responsive">
                                    <table className="table table-sm table-bordered align-middle bg-white mb-0">
                                        <thead><tr>
                                            <th>{tr('Bill No', 'බිල් අංකය')}</th>
                                            <th>{tr('Status', 'තත්ත්වය')}</th>
                                            <th className="text-end">{tr('Records', 'වාර්තා')}</th>
                                            <th className="text-end">{tr('Bags', 'මලු')}</th>
                                            <th className="text-end">{tr('Weight (kg)', 'බර (kg)')}</th>
                                            <th className="text-end">{tr('Bill Total (Rs.)', 'බිල් එකතුව (රු.)')}</th>
                                            <th className="text-end">{tr('Advance', 'අත්තිකාරම්')}</th>
                                            <th className="text-end">{tr('Hire', 'කුලී')}</th>
                                            <th className="text-end">{tr('Net (Rs.)', 'ශුද්ධ (රු.)')}</th>
                                        </tr></thead>
                                        <tbody>
                                            {(supplierDetail.bills || []).length === 0 && <tr><td colSpan={9} className="text-center text-muted py-3">{tr('No records.', 'වාර්තා නොමැත.')}</td></tr>}
                                            {(supplierDetail.bills || []).map(b => {
                                                const key = b.bill_no || 'unprinted';
                                                const isOpenRow = !!openBills[key];
                                                return (
                                                    <React.Fragment key={key}>
                                                        <tr className="clickable" onClick={() => setOpenBills(prev => ({ ...prev, [key]: !prev[key] }))} title={tr('Click to see the lines', 'පේළි බැලීමට ක්ලික් කරන්න')}>
                                                            <td className="fw-bold">{isOpenRow ? '▾' : '▸'} {b.bill_no || tr('Not printed yet', 'තවම මුද්‍රණය කර නැත')}</td>
                                                            <td><span className={`badge ${b.printed ? 'bg-success' : 'bg-warning text-dark'}`}>{b.printed ? tr('Printed', 'මුද්‍රිත') : tr('Unprinted', 'මුද්‍රණය නොකළ')}</span></td>
                                                            <td className="text-end">{b.records}</td>
                                                            <td className="text-end">{b.packs}</td>
                                                            <td className="text-end">{kg(b.weight)}</td>
                                                            <td className="text-end">{money(b.total)}</td>
                                                            <td className="text-end text-danger">{num(b.advance) ? `-${money(b.advance)}` : '—'}</td>
                                                            <td className="text-end text-danger">{num(b.hire) ? `-${money(b.hire)}` : '—'}</td>
                                                            <td className="text-end fw-bold">{money(b.net ?? b.total)}</td>
                                                        </tr>
                                                        {isOpenRow && (
                                                            <tr><td colSpan={9} className="p-0">
                                                                <table className="table table-sm mb-0" style={{ background: '#f9fbe7' }}>
                                                                    <tbody>
                                                                        {b.lines.map(l => (
                                                                            <tr key={`${l.source || ''}-${l.id}`}>
                                                                                <td className="ps-4">{l.item_name}</td>
                                                                                <td>{tr('Customer', 'පාරිභෝගික')}: {l.customer_code}</td>
                                                                                <td className="text-end">{kg(l.SupplierWeight ?? l.weight)} kg</td>
                                                                                <td className="text-end">× {money(l.SupplierPricePerKg)}</td>
                                                                                <td className="text-end">{num(l.packs)} {tr('bags', 'මලු')}</td>
                                                                                <td className="text-end fw-semibold">{money(l.SupplierTotal)}</td>
                                                                                <td className="text-end" style={{ width: 50 }}>
                                                                                    <button type="button" className="btn btn-sm btn-outline-primary py-0" title={tr('Edit supplier weight / price', 'සැපයුම්කරු බර / මිල සංස්කරණය')}
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            const itemKey = (r) => String(r.item_code || r.item_name || '').toUpperCase();
                                                                                            setEditingSiblings(b.lines.filter((r) => itemKey(r) === itemKey(l)));
                                                                                            setEditingLine(l);
                                                                                        }}>✏️</button>
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </td></tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}

                        {/* ---------- WORKERS ---------- */}
                        {view === 'workers' && (
                            <div className="row g-3">
                                <div className="col-12 col-lg-5">
                                    <form className="bg-white rounded p-3" onSubmit={saveWorker}>
                                        <h6 className="fw-bold mb-3" style={{ color: '#1b5e20' }}>
                                            {editingWorkerId ? tr('Edit worker', 'සේවකයා සංස්කරණය') : tr('Add a worker', 'සේවකයෙකු එක් කරන්න')}
                                        </h6>
                                        {workerMsg.text && <div className={`alert py-2 ${workerMsg.type === 'success' ? 'alert-success' : 'alert-danger'}`}>{workerMsg.text}</div>}
                                        <div className="row g-2">
                                            <div className="col-12"><label className="form-label small mb-1">{tr('Name', 'නම')} *</label>
                                                <input className="form-control form-control-sm" maxLength={255} value={workerForm.name} onChange={e => setWorkerForm({ ...workerForm, name: e.target.value })} autoFocus /></div>
                                            <div className="col-6"><label className="form-label small mb-1">{tr('Phone', 'දුරකථන')}</label>
                                                <input className="form-control form-control-sm" maxLength={20} value={workerForm.phone} onChange={e => setWorkerForm({ ...workerForm, phone: e.target.value })} /></div>
                                            <div className="col-6"><label className="form-label small mb-1">{tr('NIC', 'හැඳුනුම්පත')}</label>
                                                <input className="form-control form-control-sm" maxLength={20} value={workerForm.nic} onChange={e => setWorkerForm({ ...workerForm, nic: e.target.value })} /></div>
                                            <div className="col-6"><label className="form-label small mb-1">{tr('Job / Role', 'රැකියාව')}</label>
                                                <input className="form-control form-control-sm" maxLength={100} value={workerForm.job_role} onChange={e => setWorkerForm({ ...workerForm, job_role: e.target.value })} placeholder={tr('e.g. Loader', 'උදා: පැටවීම්')} /></div>
                                            <div className="col-6"><label className="form-label small mb-1">{tr('Daily wage (Rs.)', 'දෛනික වැටුප (රු.)')}</label>
                                                <input type="number" min="0" step="any" className="form-control form-control-sm" value={workerForm.daily_wage} onChange={e => setWorkerForm({ ...workerForm, daily_wage: e.target.value })} /></div>
                                            <div className="col-6"><label className="form-label small mb-1">{tr('Joined date', 'බැඳුණු දිනය')}</label>
                                                <input type="date" className="form-control form-control-sm" value={workerForm.joined_date} onChange={e => setWorkerForm({ ...workerForm, joined_date: e.target.value })} /></div>
                                            <div className="col-6 d-flex align-items-end">
                                                <div className="form-check mb-1">
                                                    <input id="workerActive" type="checkbox" className="form-check-input" checked={workerForm.is_active} onChange={e => setWorkerForm({ ...workerForm, is_active: e.target.checked })} />
                                                    <label htmlFor="workerActive" className="form-check-label small">{tr('Active', 'සක්‍රිය')}</label>
                                                </div>
                                            </div>
                                            <div className="col-12"><label className="form-label small mb-1">{tr('Address', 'ලිපිනය')}</label>
                                                <input className="form-control form-control-sm" maxLength={500} value={workerForm.address} onChange={e => setWorkerForm({ ...workerForm, address: e.target.value })} /></div>
                                            <div className="col-12"><label className="form-label small mb-1">{tr('Notes', 'සටහන්')}</label>
                                                <textarea className="form-control form-control-sm" rows={2} maxLength={2000} value={workerForm.notes} onChange={e => setWorkerForm({ ...workerForm, notes: e.target.value })} /></div>
                                        </div>
                                        <div className="d-flex gap-2 justify-content-end mt-3">
                                            {editingWorkerId && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setEditingWorkerId(null); setWorkerForm(emptyWorker); setWorkerMsg({ type: '', text: '' }); }}>{tr('Cancel', 'අවලංගු')}</button>}
                                            <button type="submit" className="btn btn-sm btn-success fw-bold" disabled={savingWorker}>
                                                {savingWorker ? tr('Saving...', 'සුරකිමින්...') : editingWorkerId ? tr('Update Worker', 'සේවකයා යාවත්කාලීන') : tr('Add Worker', 'සේවකයා එක් කරන්න')}
                                            </button>
                                        </div>
                                    </form>
                                </div>
                                <div className="col-12 col-lg-7">
                                    <div className="table-responsive">
                                        <table className="table table-sm table-bordered align-middle bg-white mb-0">
                                            <thead><tr>
                                                <th>{tr('Name', 'නම')}</th><th>{tr('Phone', 'දුරකථන')}</th><th>{tr('Role', 'රැකියාව')}</th>
                                                <th className="text-end">{tr('Daily wage', 'දෛනික වැටුප')}</th><th>{tr('Status', 'තත්ත්වය')}</th><th></th>
                                            </tr></thead>
                                            <tbody>
                                                {!loading && workers.length === 0 && <tr><td colSpan={6} className="text-center text-muted py-3">{tr('No workers yet. Add one on the left.', 'තවම සේවකයින් නැත. වම් පසින් එක් කරන්න.')}</td></tr>}
                                                {workers.map(w => (
                                                    <tr key={w.id} className={editingWorkerId === w.id ? 'table-warning' : ''}>
                                                        <td className="fw-semibold">{w.name}{w.nic && <div className="small text-muted">{w.nic}</div>}</td>
                                                        <td>{w.phone || '—'}</td>
                                                        <td>{w.job_role || '—'}</td>
                                                        <td className="text-end">{money(w.daily_wage)}</td>
                                                        <td><span className={`badge ${w.is_active ? 'bg-success' : 'bg-secondary'}`}>{w.is_active ? tr('Active', 'සක්‍රිය') : tr('Inactive', 'අක්‍රිය')}</span></td>
                                                        <td className="text-nowrap">
                                                            <button type="button" className="btn btn-link btn-sm p-0 me-2" onClick={() => editWorker(w)} title={tr('Edit', 'සංස්කරණය')}><i className="material-icons" style={{ fontSize: 18 }}>edit</i></button>
                                                            <button type="button" className="btn btn-link btn-sm p-0 text-danger" onClick={() => deleteWorker(w)} title={tr('Delete', 'මකන්න')}><i className="material-icons" style={{ fontSize: 18 }}>delete</i></button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
