import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Select from 'react-select';
import api from '../../api';
import { tr } from '../../i18n/language';
import { SHOP_NAME } from '../../config/shop';

// New Supplier Bills dashboard.
// Bills entered here are stored in the new tables new_supplier_bills /
// new_supplier_bill_items. Nothing in the existing sales/supplier flow is touched.
// Shortcuts (same idea as Sales Entry): F5 = hold the bill (save, not printed),
// F4 = save and print. Held bills wait in the "Held bills" panel until printed.

const today = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};
const money = (v) => num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg = (v) => num(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const round2 = (v) => Math.round(num(v) * 100) / 100;

const emptyLine = { item: null, packs: '', weight: '', price_per_kg: '' };

const emptyForm = () => ({
    bill_date: today(),
    supplier: null,
    reference_no: '',
    deductions: '',
    deduction_note: '',
    paid_amount: '',
    notes: '',
});

const STATUS_BADGE = { unpaid: 'bg-danger', partial: 'bg-warning text-dark', paid: 'bg-success' };
const statusLabel = (s) => ({
    unpaid: tr('Unpaid', 'නොගෙවූ'),
    partial: tr('Partly paid', 'අර්ධ ගෙවූ'),
    paid: tr('Paid', 'ගෙවූ'),
}[s] || s);

const selectStyles = {
    control: (base) => ({ ...base, minHeight: 34 }),
    menuPortal: (base) => ({ ...base, zIndex: 1060 }),
};

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default function NewSupplierBillDashboard() {
    // ---------- master data ----------
    const [suppliers, setSuppliers] = useState([]);
    const [items, setItems] = useState([]);

    // ---------- entry form ----------
    const [form, setForm] = useState(emptyForm);
    const [lines, setLines] = useState([]);
    const [line, setLine] = useState(emptyLine);
    const [editIndex, setEditIndex] = useState(null); // index of the line being edited
    const [editingBill, setEditingBill] = useState(null); // { id, bill_no } when editing a saved bill
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const [message, setMessage] = useState('');

    // ---------- list ----------
    const [filters, setFilters] = useState({ start_date: today(), end_date: today(), supplier: null, status: '', print_status: '', search: '' });
    const [bills, setBills] = useState([]);
    const [summary, setSummary] = useState(null);
    const [truncated, setTruncated] = useState(false);
    const [loadingList, setLoadingList] = useState(false);
    const [listError, setListError] = useState('');
    const [heldBills, setHeldBills] = useState([]);

    const itemRef = useRef(null);
    const packsRef = useRef(null);
    const weightRef = useRef(null);
    const priceRef = useRef(null);
    const supplierRef = useRef(null);
    const savingRef = useRef(false);
    const saveRef = useRef(null);

    const supplierOptions = useMemo(
        () => suppliers.map((s) => ({ value: s.code, label: `${s.code} - ${s.name ?? ''}`, name: s.name })),
        [suppliers]
    );
    const itemOptions = useMemo(
        () => items.map((i) => ({ value: i.no, label: `${i.no} - ${i.type ?? ''}`, name: i.type })),
        [items]
    );

    useEffect(() => {
        api.get('/new-supplier-bills/options')
            .then((res) => {
                setSuppliers(res.data?.suppliers || []);
                setItems(res.data?.items || []);
            })
            .catch(() => setFormError(tr('Could not load suppliers and items.', 'සැපයුම්කරුවන් සහ භාණ්ඩ ලබා ගත නොහැක.')));
    }, []);

    const loadBills = useCallback(async (f) => {
        setLoadingList(true);
        setListError('');
        try {
            const params = {};
            if (f.start_date) params.start_date = f.start_date;
            if (f.end_date) params.end_date = f.end_date;
            if (f.supplier) params.supplier_code = f.supplier.value;
            if (f.status) params.status = f.status;
            if (f.print_status) params.print_status = f.print_status;
            if (f.search.trim()) params.search = f.search.trim();
            const res = await api.get('/new-supplier-bills', { params });
            setBills(res.data?.bills || []);
            setSummary(res.data?.summary || null);
            setTruncated(!!res.data?.truncated);
        } catch (err) {
            const errors = err.response?.data?.errors;
            setListError(errors ? Object.values(errors).flat().join(' ') : tr('Could not load bills.', 'බිල්පත් ලබා ගත නොහැක.'));
        } finally {
            setLoadingList(false);
        }
    }, []);

    // Held bills of every date, so nothing waiting to be printed is missed.
    const loadHeld = useCallback(async () => {
        try {
            const res = await api.get('/new-supplier-bills', { params: { print_status: 'held' } });
            setHeldBills(res.data?.bills || []);
        } catch { /* the main list shows load errors */ }
    }, []);

    const refreshLists = () => { loadBills(filters); loadHeld(); };

    useEffect(() => { loadBills(filters); loadHeld(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ---------- totals (server recomputes the same values on save) ----------
    const totals = useMemo(() => {
        const gross = round2(lines.reduce((s, l) => s + round2(num(l.weight) * num(l.price_per_kg)), 0));
        const weight = lines.reduce((s, l) => s + num(l.weight), 0);
        const packs = lines.reduce((s, l) => s + num(l.packs), 0);
        const net = round2(gross - num(form.deductions));
        const balance = round2(net - num(form.paid_amount));
        return { gross, weight, packs, net, balance };
    }, [lines, form.deductions, form.paid_amount]);

    const lineAmount = round2(num(line.weight) * num(line.price_per_kg));

    // ---------- line entry ----------
    const addOrUpdateLine = () => {
        setFormError('');
        if (!line.item) { setFormError(tr('Select an item.', 'භාණ්ඩයක් තෝරන්න.')); itemRef.current?.focus(); return; }
        if (num(line.weight) <= 0) { setFormError(tr('Enter a weight greater than 0.', '0 ට වැඩි බරක් ඇතුළත් කරන්න.')); weightRef.current?.focus(); return; }
        if (line.price_per_kg === '' || num(line.price_per_kg) < 0) { setFormError(tr('Enter the price per kg.', 'කිලෝවක මිල ඇතුළත් කරන්න.')); priceRef.current?.focus(); return; }

        const entry = { ...line };
        setLines((prev) => (editIndex === null ? [...prev, entry] : prev.map((l, i) => (i === editIndex ? entry : l))));
        setLine(emptyLine);
        setEditIndex(null);
        setTimeout(() => itemRef.current?.focus(), 0);
    };

    const onLineKeyDown = (e, next) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (next) next.current?.focus();
        else addOrUpdateLine();
    };

    const editLine = (i) => {
        setLine(lines[i]);
        setEditIndex(i);
        setTimeout(() => weightRef.current?.focus(), 0);
    };

    const removeLine = (i) => {
        setLines((prev) => prev.filter((_, idx) => idx !== i));
        if (editIndex === i) { setLine(emptyLine); setEditIndex(null); }
    };

    const resetForm = () => {
        setForm(emptyForm());
        setLines([]);
        setLine(emptyLine);
        setEditIndex(null);
        setEditingBill(null);
        setFormError('');
    };

    // ---------- save ----------
    // printAfter=false -> F5 Hold, printAfter=true -> F4 Print
    const saveBill = async (printAfter = false) => {
        if (savingRef.current) return;
        setFormError('');
        setMessage('');

        // A fully typed line that was not added yet is included, so F4/F5 never drops it.
        const pendingComplete = line.item && num(line.weight) > 0 && line.price_per_kg !== '';
        const pendingPartial = !pendingComplete && (line.item || line.weight !== '' || line.price_per_kg !== '');
        let allLines = lines;
        if (pendingComplete) {
            allLines = editIndex === null ? [...lines, line] : lines.map((l, i) => (i === editIndex ? line : l));
        }

        if (!form.supplier) { setFormError(tr('Select a supplier.', 'සැපයුම්කරුවෙකු තෝරන්න.')); return; }
        if (!form.bill_date) { setFormError(tr('Select the bill date.', 'බිල්පත් දිනය තෝරන්න.')); return; }
        if (pendingPartial) { setFormError(tr('Finish or clear the item line first.', 'පළමුව භාණ්ඩ පේළිය සම්පූර්ණ කරන්න හෝ හිස් කරන්න.')); return; }
        if (allLines.length === 0) { setFormError(tr('Add at least one item.', 'අවම වශයෙන් එක් භාණ්ඩයක් එක් කරන්න.')); return; }
        const gross = round2(allLines.reduce((sum, l) => sum + round2(num(l.weight) * num(l.price_per_kg)), 0));
        if (gross - num(form.deductions) < 0) { setFormError(tr('Deductions cannot be more than the bill amount.', 'අඩු කිරීම් බිල්පත් මුදලට වඩා වැඩි විය නොහැක.')); return; }

        // Open the print window now, while the key press still counts as a user action,
        // otherwise the browser blocks it as a pop-up once the save request returns.
        let printWin = null;
        if (printAfter) {
            printWin = window.open('', '_blank', 'width=800,height=900');
            if (printWin) printWin.document.write(`<p style="font-family:Arial">${escapeHtml(tr('Preparing bill...', 'බිල්පත සූදානම් කරමින්...'))}</p>`);
        }

        const payload = {
            bill_date: form.bill_date,
            supplier_code: form.supplier.value,
            supplier_name: form.supplier.name || null,
            reference_no: form.reference_no.trim() || null,
            deductions: num(form.deductions),
            deduction_note: form.deduction_note.trim() || null,
            paid_amount: num(form.paid_amount),
            notes: form.notes.trim() || null,
            print: printAfter,
            items: allLines.map((l) => ({
                item_code: l.item.value,
                item_name: l.item.name || null,
                packs: num(l.packs),
                weight: num(l.weight),
                price_per_kg: num(l.price_per_kg),
            })),
        };

        savingRef.current = true;
        setSaving(true);
        try {
            const res = editingBill
                ? await api.put(`/new-supplier-bills/${editingBill.id}`, payload)
                : await api.post('/new-supplier-bills', payload);
            const saved = res.data;
            setMessage(printAfter
                ? tr(`Bill ${saved.bill_no} saved and sent to print.`, `බිල්පත ${saved.bill_no} සුරැක මුද්‍රණයට යැව්වා.`)
                : saved.is_printed
                ? tr(`Bill ${saved.bill_no} updated.`, `බිල්පත ${saved.bill_no} යාවත්කාලීන කළා.`)
                : tr(`Bill ${saved.bill_no} held. Open it from Held bills and press F4 to print.`, `බිල්පත ${saved.bill_no} රඳවා ඇත. රඳවා ඇති බිල්පත් වලින් විවෘත කර F4 ඔබා මුද්‍රණය කරන්න.`));
            if (printAfter) printBill(saved, printWin);
            resetForm();
            refreshLists();
            setTimeout(() => supplierRef.current?.focus(), 0);
        } catch (err) {
            if (printWin) printWin.close();
            const errors = err.response?.data?.errors;
            setFormError(errors
                ? Object.values(errors).flat().join(' ')
                : err.response?.data?.message || tr('Could not save the bill.', 'බිල්පත සුරැකිය නොහැක.'));
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    saveRef.current = saveBill;

    // F5 = hold, F4 = print (also stops F5 from reloading the page and losing the bill)
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'F5' || e.key === 'F4') {
                e.preventDefault();
                saveRef.current?.(e.key === 'F4');
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // ---------- list actions ----------
    const fetchBill = async (id) => (await api.get(`/new-supplier-bills/${id}`)).data;

    const startEdit = async (bill) => {
        try {
            const full = await fetchBill(bill.id);
            const supplier = supplierOptions.find((o) => o.value.toUpperCase() === full.supplier_code.toUpperCase())
                || { value: full.supplier_code, label: `${full.supplier_code} - ${full.supplier_name ?? ''}`, name: full.supplier_name };
            setForm({
                bill_date: full.bill_date,
                supplier,
                reference_no: full.reference_no || '',
                deductions: num(full.deductions) ? String(full.deductions) : '',
                deduction_note: full.deduction_note || '',
                paid_amount: num(full.paid_amount) ? String(full.paid_amount) : '',
                notes: full.notes || '',
            });
            setLines((full.items || []).map((it) => ({
                item: itemOptions.find((o) => o.value.toUpperCase() === it.item_code.toUpperCase())
                    || { value: it.item_code, label: `${it.item_code} - ${it.item_name ?? ''}`, name: it.item_name },
                packs: num(it.packs) ? String(it.packs) : '',
                weight: String(it.weight),
                price_per_kg: String(it.price_per_kg),
            })));
            setLine(emptyLine);
            setEditIndex(null);
            setEditingBill({ id: full.id, bill_no: full.bill_no });
            setFormError('');
            setMessage('');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch {
            setListError(tr('Could not open the bill.', 'බිල්පත විවෘත කළ නොහැක.'));
        }
    };

    const deleteBill = async (bill) => {
        if (!window.confirm(tr(`Delete bill ${bill.bill_no}? This cannot be undone.`, `බිල්පත ${bill.bill_no} මකන්නද? මෙය ආපසු හැරවිය නොහැක.`))) return;
        try {
            await api.delete(`/new-supplier-bills/${bill.id}`);
            if (editingBill?.id === bill.id) resetForm();
            refreshLists();
        } catch {
            setListError(tr('Could not delete the bill.', 'බිල්පත මැකිය නොහැක.'));
        }
    };

    const printSaved = async (bill) => {
        const win = window.open('', '_blank', 'width=800,height=900');
        try {
            // Printing a held bill from the list also marks it as printed.
            const full = bill.is_printed
                ? await fetchBill(bill.id)
                : (await api.post(`/new-supplier-bills/${bill.id}/mark-printed`)).data;
            printBill(full, win);
            if (!bill.is_printed) refreshLists();
        } catch {
            if (win) win.close();
            setListError(tr('Could not open the bill.', 'බිල්පත විවෘත කළ නොහැක.'));
        }
    };

    function printBill(bill, existingWin = null) {
        const rows = (bill.items || []).map((it, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(it.item_code)} ${escapeHtml(it.item_name || '')}</td>
                <td class="r">${num(it.packs) ? kg(it.packs) : ''}</td>
                <td class="r">${kg(it.weight)}</td>
                <td class="r">${money(it.price_per_kg)}</td>
                <td class="r">${money(it.amount)}</td>
            </tr>`).join('');
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(bill.bill_no)}</title>
            <style>
                body{font-family:Arial,sans-serif;font-size:13px;margin:20px;color:#000}
                h2{margin:0;text-align:center} .sub{text-align:center;margin-bottom:12px}
                .meta{display:flex;justify-content:space-between;margin-bottom:10px}
                table{width:100%;border-collapse:collapse} th,td{border:1px solid #444;padding:4px 6px}
                th{background:#eee} .r{text-align:right} .tot td{border:none;padding:2px 6px}
                .tot{width:auto;margin-left:auto;margin-top:10px} .b{font-weight:bold}
            </style></head><body>
            <h2>${escapeHtml(SHOP_NAME)}</h2>
            <div class="sub">${escapeHtml(tr('Supplier Bill', 'සැපයුම්කරු බිල්පත'))}</div>
            <div class="meta">
                <div><b>${escapeHtml(tr('Supplier', 'සැපයුම්කරු'))}:</b> ${escapeHtml(bill.supplier_code)} ${escapeHtml(bill.supplier_name || '')}
                ${bill.reference_no ? `<br><b>${escapeHtml(tr('Ref No', 'යොමු අංකය'))}:</b> ${escapeHtml(bill.reference_no)}` : ''}</div>
                <div class="r"><b>${escapeHtml(tr('Bill No', 'බිල් අංකය'))}:</b> ${escapeHtml(bill.bill_no)}<br>
                <b>${escapeHtml(tr('Date', 'දිනය'))}:</b> ${escapeHtml(bill.bill_date)}</div>
            </div>
            <table><thead><tr>
                <th>#</th><th>${escapeHtml(tr('Item', 'භාණ්ඩය'))}</th><th class="r">${escapeHtml(tr('Packs', 'මලු'))}</th>
                <th class="r">${escapeHtml(tr('Weight (kg)', 'බර (kg)'))}</th><th class="r">${escapeHtml(tr('Price/kg', 'මිල/kg'))}</th>
                <th class="r">${escapeHtml(tr('Amount', 'මුදල'))}</th>
            </tr></thead><tbody>${rows}</tbody></table>
            <table class="tot">
                <tr><td>${escapeHtml(tr('Total weight', 'මුළු බර'))}</td><td class="r">${kg(bill.total_weight)} kg</td></tr>
                <tr><td>${escapeHtml(tr('Gross amount', 'දළ මුදල'))}</td><td class="r">${money(bill.gross_amount)}</td></tr>
                ${num(bill.deductions) ? `<tr><td>${escapeHtml(tr('Deductions', 'අඩු කිරීම්'))}${bill.deduction_note ? ` (${escapeHtml(bill.deduction_note)})` : ''}</td><td class="r">-${money(bill.deductions)}</td></tr>` : ''}
                <tr class="b"><td>${escapeHtml(tr('Net amount', 'ශුද්ධ මුදල'))}</td><td class="r">${money(bill.net_amount)}</td></tr>
                <tr><td>${escapeHtml(tr('Paid', 'ගෙවූ'))}</td><td class="r">${money(bill.paid_amount)}</td></tr>
                <tr class="b"><td>${escapeHtml(tr('Balance', 'ශේෂය'))}</td><td class="r">${money(bill.balance_amount)}</td></tr>
            </table>
            ${bill.notes ? `<p><b>${escapeHtml(tr('Notes', 'සටහන්'))}:</b> ${escapeHtml(bill.notes)}</p>` : ''}
            <script>window.onload=function(){window.print();}</script>
            </body></html>`;
        const w = existingWin || window.open('', '_blank', 'width=800,height=900');
        if (!w) { setListError(tr('Allow pop-ups to print the bill.', 'බිල්පත මුද්‍රණය කිරීමට pop-ups ඉඩ දෙන්න.')); return; }
        w.document.open();
        w.document.write(html);
        w.document.close();
    }

    const applyFilters = (e) => { e?.preventDefault(); loadBills(filters); };
    const clearFilters = () => {
        const f = { start_date: today(), end_date: today(), supplier: null, status: '', print_status: '', search: '' };
        setFilters(f);
        loadBills(f);
    };

    // ---------- render ----------
    return (
        <div className="container-fluid py-3 new-supplier-bills" style={{ background: '#f4f6f9', minHeight: '100vh' }}>
            <style>{`
                .new-supplier-bills .card-header { background:#1b5e20; color:#fff; font-weight:600; }
                .new-supplier-bills .table thead th,
                .new-supplier-bills .table thead th * {
                    --bs-table-color:#ffffff; --bs-table-bg:#1b5e20;
                    background-color:#1b5e20 !important; color:#ffffff !important; white-space:nowrap;
                }
                .new-supplier-bills .stat { background:#fff; border-radius:8px; padding:10px 12px; border-left:4px solid #2e7d32; }
                .new-supplier-bills .stat .v { font-size:1.15rem; font-weight:700; }
                .new-supplier-bills .stat .l { font-size:.8rem; color:#555; }
            `}</style>

            <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
                <h4 className="mb-0 fw-bold" style={{ color: '#1b5e20' }}>
                    <i className="material-icons align-middle me-2">receipt_long</i>
                    {tr('New Supplier Bills', 'නව සැපයුම්කරු බිල්පත්')}
                </h4>
                <button type="button" className="btn btn-success btn-sm" onClick={resetForm}>
                    <i className="material-icons align-middle me-1" style={{ fontSize: 18 }}>add</i>{tr('New Bill', 'නව බිල්පත')}
                </button>
            </div>

            <div className="row g-3">
                {/* ================= ENTRY FORM ================= */}
                <div className="col-12 col-xl-5">
                    <div className="card shadow-sm">
                        <div className="card-header d-flex justify-content-between align-items-center">
                            <span>{editingBill
                                ? tr(`Editing bill ${editingBill.bill_no}`, `බිල්පත ${editingBill.bill_no} සංස්කරණය`)
                                : tr('Enter a new bill', 'නව බිල්පතක් ඇතුළත් කරන්න')}</span>
                            {editingBill && (
                                <button type="button" className="btn btn-light btn-sm py-0" onClick={resetForm}>{tr('Cancel edit', 'සංස්කරණය අවලංගු')}</button>
                            )}
                        </div>
                        <div className="card-body">
                            {message && <div className="alert alert-success py-2">{message}</div>}
                            {formError && <div className="alert alert-danger py-2">{formError}</div>}

                            <div className="row g-2 mb-2">
                                <div className="col-sm-4">
                                    <label className="form-label small mb-1">{tr('Bill date', 'බිල්පත් දිනය')}</label>
                                    <input type="date" className="form-control form-control-sm" value={form.bill_date}
                                        onChange={(e) => setForm({ ...form, bill_date: e.target.value })} />
                                </div>
                                <div className="col-sm-8">
                                    <label className="form-label small mb-1">{tr('Supplier', 'සැපයුම්කරු')}</label>
                                    <Select
                                        ref={supplierRef}
                                        autoFocus
                                        options={supplierOptions}
                                        value={form.supplier}
                                        onChange={(opt) => { setForm({ ...form, supplier: opt }); setTimeout(() => itemRef.current?.focus(), 0); }}
                                        placeholder={tr('Search supplier code or name...', 'සැපයුම්කරු කේතය හෝ නම සොයන්න...')}
                                        styles={selectStyles}
                                        menuPortalTarget={document.body}
                                        isClearable
                                    />
                                </div>
                                <div className="col-12">
                                    <label className="form-label small mb-1">{tr('Supplier ref / bill no (optional)', 'සැපයුම්කරු යොමු / බිල් අංකය (අත්‍යවශ්‍ය නැත)')}</label>
                                    <input type="text" className="form-control form-control-sm" maxLength={100} value={form.reference_no}
                                        onChange={(e) => setForm({ ...form, reference_no: e.target.value })} />
                                </div>
                            </div>

                            {/* Line entry */}
                            <div className="border rounded p-2 mb-2" style={{ background: editIndex !== null ? '#fff8e1' : '#f1f8e9' }}>
                                <div className="row g-2 align-items-end">
                                    <div className="col-12 col-md-5">
                                        <label className="form-label small mb-1">{tr('Item', 'භාණ්ඩය')}</label>
                                        <Select
                                            ref={itemRef}
                                            options={itemOptions}
                                            value={line.item}
                                            onChange={(opt) => { setLine({ ...line, item: opt }); if (opt) setTimeout(() => packsRef.current?.focus(), 0); }}
                                            placeholder={tr('Item...', 'භාණ්ඩය...')}
                                            styles={selectStyles}
                                            menuPortalTarget={document.body}
                                        />
                                    </div>
                                    <div className="col-4 col-md-2">
                                        <label className="form-label small mb-1">{tr('Packs', 'මලු')}</label>
                                        <input ref={packsRef} type="number" min="0" step="any" className="form-control form-control-sm" value={line.packs}
                                            onChange={(e) => setLine({ ...line, packs: e.target.value })} onKeyDown={(e) => onLineKeyDown(e, weightRef)} />
                                    </div>
                                    <div className="col-4 col-md-2">
                                        <label className="form-label small mb-1">{tr('Weight', 'බර')}</label>
                                        <input ref={weightRef} type="number" min="0" step="any" className="form-control form-control-sm" value={line.weight}
                                            onChange={(e) => setLine({ ...line, weight: e.target.value })} onKeyDown={(e) => onLineKeyDown(e, priceRef)} />
                                    </div>
                                    <div className="col-4 col-md-3">
                                        <label className="form-label small mb-1">{tr('Price/kg', 'මිල/kg')}</label>
                                        <input ref={priceRef} type="number" min="0" step="any" className="form-control form-control-sm" value={line.price_per_kg}
                                            onChange={(e) => setLine({ ...line, price_per_kg: e.target.value })} onKeyDown={(e) => onLineKeyDown(e, null)} />
                                    </div>
                                </div>
                                <div className="d-flex justify-content-between align-items-center mt-2">
                                    <small className="text-muted">
                                        {tr('Amount', 'මුදල')}: <b>{money(lineAmount)}</b> · {tr('Enter = next / add · F5 = hold · F4 = print', 'Enter = ඊළඟ / එක් කරන්න · F5 = රඳවන්න · F4 = මුද්‍රණය')}
                                    </small>
                                    <div>
                                        {editIndex !== null && (
                                            <button type="button" className="btn btn-outline-secondary btn-sm me-1" onClick={() => { setLine(emptyLine); setEditIndex(null); }}>
                                                {tr('Cancel', 'අවලංගු')}
                                            </button>
                                        )}
                                        <button type="button" className="btn btn-success btn-sm" onClick={addOrUpdateLine}>
                                            {editIndex !== null ? tr('Update line', 'පේළිය යාවත්කාලීන') : tr('Add item', 'භාණ්ඩය එක් කරන්න')}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Lines table */}
                            <div className="table-responsive mb-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
                                <table className="table table-sm table-bordered table-hover align-middle mb-0">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>{tr('Item', 'භාණ්ඩය')}</th>
                                            <th className="text-end">{tr('Packs', 'මලු')}</th>
                                            <th className="text-end">{tr('Weight', 'බර')}</th>
                                            <th className="text-end">{tr('Price/kg', 'මිල/kg')}</th>
                                            <th className="text-end">{tr('Amount', 'මුදල')}</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {lines.length === 0 && (
                                            <tr><td colSpan={7} className="text-center text-muted py-3">{tr('No items added yet', 'තවම භාණ්ඩ එක් කර නැත')}</td></tr>
                                        )}
                                        {lines.map((l, i) => (
                                            <tr key={i} className={editIndex === i ? 'table-warning' : ''}>
                                                <td>{i + 1}</td>
                                                <td>{l.item?.label}</td>
                                                <td className="text-end">{num(l.packs) ? kg(l.packs) : ''}</td>
                                                <td className="text-end">{kg(l.weight)}</td>
                                                <td className="text-end">{money(l.price_per_kg)}</td>
                                                <td className="text-end">{money(num(l.weight) * num(l.price_per_kg))}</td>
                                                <td className="text-nowrap">
                                                    <button type="button" className="btn btn-link btn-sm p-0 me-2" title={tr('Edit', 'සංස්කරණය')} onClick={() => editLine(i)}>
                                                        <i className="material-icons" style={{ fontSize: 18 }}>edit</i>
                                                    </button>
                                                    <button type="button" className="btn btn-link btn-sm p-0 text-danger" title={tr('Remove', 'ඉවත් කරන්න')} onClick={() => removeLine(i)}>
                                                        <i className="material-icons" style={{ fontSize: 18 }}>delete</i>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Totals & payment */}
                            <div className="row g-2">
                                <div className="col-sm-6">
                                    <label className="form-label small mb-1">{tr('Deductions', 'අඩු කිරීම්')}</label>
                                    <input type="number" min="0" step="any" className="form-control form-control-sm" value={form.deductions}
                                        onChange={(e) => setForm({ ...form, deductions: e.target.value })} />
                                </div>
                                <div className="col-sm-6">
                                    <label className="form-label small mb-1">{tr('Deduction reason', 'අඩු කිරීමට හේතුව')}</label>
                                    <input type="text" className="form-control form-control-sm" maxLength={255} value={form.deduction_note}
                                        onChange={(e) => setForm({ ...form, deduction_note: e.target.value })}
                                        placeholder={tr('e.g. transport, advance', 'උදා: ප්‍රවාහන, අත්තිකාරම්')} />
                                </div>
                                <div className="col-sm-6">
                                    <label className="form-label small mb-1">{tr('Paid now', 'දැන් ගෙවූ')}</label>
                                    <input type="number" min="0" step="any" className="form-control form-control-sm" value={form.paid_amount}
                                        onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
                                </div>
                                <div className="col-sm-6">
                                    <label className="form-label small mb-1">{tr('Notes', 'සටහන්')}</label>
                                    <input type="text" className="form-control form-control-sm" maxLength={2000} value={form.notes}
                                        onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                                </div>
                            </div>

                            <table className="table table-sm mt-3 mb-2">
                                <tbody>
                                    <tr><td>{tr('Total weight', 'මුළු බර')}</td><td className="text-end">{kg(totals.weight)} kg{totals.packs ? ` · ${kg(totals.packs)} ${tr('packs', 'මලු')}` : ''}</td></tr>
                                    <tr><td>{tr('Gross amount', 'දළ මුදල')}</td><td className="text-end">{money(totals.gross)}</td></tr>
                                    <tr><td>{tr('Deductions', 'අඩු කිරීම්')}</td><td className="text-end text-danger">-{money(form.deductions)}</td></tr>
                                    <tr className="fw-bold"><td>{tr('Net amount', 'ශුද්ධ මුදල')}</td><td className="text-end">{money(totals.net)}</td></tr>
                                    <tr className="fw-bold"><td>{tr('Balance to pay', 'ගෙවිය යුතු ශේෂය')}</td><td className={`text-end ${totals.balance > 0 ? 'text-danger' : 'text-success'}`}>{money(totals.balance)}</td></tr>
                                </tbody>
                            </table>

                            <div className="d-flex gap-2 justify-content-end">
                                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={resetForm} disabled={saving}>{tr('Clear', 'හිස් කරන්න')}</button>
                                <button type="button" className="btn btn-warning btn-sm fw-bold" onClick={() => saveBill(false)} disabled={saving}>
                                    {saving ? tr('Saving...', 'සුරකිමින්...') : tr('Hold (F5)', 'රඳවන්න (F5)')}
                                </button>
                                <button type="button" className="btn btn-success btn-sm fw-bold" onClick={() => saveBill(true)} disabled={saving}>
                                    🖨️ {tr('Print (F4)', 'මුද්‍රණය (F4)')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ================= BILLS LIST ================= */}
                <div className="col-12 col-xl-7">
                    <div className="card shadow-sm mb-3" style={{ borderColor: '#f9a825' }}>
                        <div className="card-header d-flex justify-content-between align-items-center" style={{ background: '#f9a825', color: '#000' }}>
                            <span>{tr('Held bills (waiting to print)', 'රඳවා ඇති බිල්පත් (මුද්‍රණයට ඇති)')}</span>
                            <span className="badge bg-dark">{heldBills.length}</span>
                        </div>
                        <div className="card-body py-2">
                            {heldBills.length === 0 ? (
                                <div className="text-muted small">{tr('No held bills. Press F5 while entering a bill to hold it.', 'රඳවා ඇති බිල්පත් නැත. බිල්පතක් ඇතුළත් කරන විට F5 ඔබා එය රඳවන්න.')}</div>
                            ) : (
                                <div className="d-flex flex-wrap gap-2">
                                    {heldBills.map((b) => (
                                        <button key={b.id} type="button"
                                            className={`btn btn-sm ${editingBill?.id === b.id ? 'btn-dark' : 'btn-outline-dark'}`}
                                            title={tr('Open this bill, then press F4 to print', 'මෙම බිල්පත විවෘත කර F4 ඔබා මුද්‍රණය කරන්න')}
                                            onClick={() => startEdit(b)}>
                                            <b>{b.supplier_code}</b> · {b.bill_no} · {b.bill_date} · {money(b.net_amount)}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="card shadow-sm">
                        <div className="card-header">{tr('Saved bills', 'සුරැකි බිල්පත්')}</div>
                        <div className="card-body">
                            <form className="row g-2 align-items-end mb-3" onSubmit={applyFilters}>
                                <div className="col-6 col-md-2">
                                    <label className="form-label small mb-1">{tr('From', 'සිට')}</label>
                                    <input type="date" className="form-control form-control-sm" value={filters.start_date}
                                        onChange={(e) => setFilters({ ...filters, start_date: e.target.value })} />
                                </div>
                                <div className="col-6 col-md-2">
                                    <label className="form-label small mb-1">{tr('To', 'දක්වා')}</label>
                                    <input type="date" className="form-control form-control-sm" value={filters.end_date}
                                        onChange={(e) => setFilters({ ...filters, end_date: e.target.value })} />
                                </div>
                                <div className="col-12 col-md-4">
                                    <label className="form-label small mb-1">{tr('Supplier', 'සැපයුම්කරු')}</label>
                                    <Select options={supplierOptions} value={filters.supplier} isClearable
                                        onChange={(opt) => setFilters({ ...filters, supplier: opt })}
                                        placeholder={tr('All', 'සියල්ල')} styles={selectStyles} menuPortalTarget={document.body} />
                                </div>
                                <div className="col-6 col-md-2">
                                    <label className="form-label small mb-1">{tr('Status', 'තත්ත්වය')}</label>
                                    <select className="form-select form-select-sm" value={filters.status}
                                        onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                                        <option value="">{tr('All', 'සියල්ල')}</option>
                                        <option value="unpaid">{statusLabel('unpaid')}</option>
                                        <option value="partial">{statusLabel('partial')}</option>
                                        <option value="paid">{statusLabel('paid')}</option>
                                    </select>
                                </div>
                                <div className="col-6 col-md-2">
                                    <label className="form-label small mb-1">{tr('Printed?', 'මුද්‍රිතද?')}</label>
                                    <select className="form-select form-select-sm" value={filters.print_status}
                                        onChange={(e) => setFilters({ ...filters, print_status: e.target.value })}>
                                        <option value="">{tr('All', 'සියල්ල')}</option>
                                        <option value="held">{tr('Held', 'රඳවා ඇති')}</option>
                                        <option value="printed">{tr('Printed', 'මුද්‍රිත')}</option>
                                    </select>
                                </div>
                                <div className="col-6 col-md-4">
                                    <label className="form-label small mb-1">{tr('Search', 'සොයන්න')}</label>
                                    <input type="text" className="form-control form-control-sm" value={filters.search}
                                        placeholder={tr('Bill no / ref', 'බිල් අංකය / යොමු')}
                                        onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
                                </div>
                                <div className="col-12 d-flex gap-2 justify-content-end">
                                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => {
                                        const f = { ...filters, start_date: '', end_date: '' };
                                        setFilters(f); loadBills(f);
                                    }}>{tr('All dates', 'සියලු දින')}</button>
                                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={clearFilters}>{tr('Reset', 'යළි සකසන්න')}</button>
                                    <button type="submit" className="btn btn-success btn-sm" disabled={loadingList}>
                                        {loadingList ? tr('Loading...', 'පූරණය වෙමින්...') : tr('Search', 'සොයන්න')}
                                    </button>
                                </div>
                            </form>

                            {listError && <div className="alert alert-danger py-2">{listError}</div>}

                            {summary && (
                                <div className="row g-2 mb-3">
                                    <div className="col-6 col-md-3"><div className="stat"><div className="l">{tr('Bills', 'බිල්පත්')}</div><div className="v">{summary.bill_count}</div></div></div>
                                    <div className="col-6 col-md-3"><div className="stat"><div className="l">{tr('Total weight', 'මුළු බර')}</div><div className="v">{kg(summary.total_weight)} kg</div></div></div>
                                    <div className="col-6 col-md-3"><div className="stat"><div className="l">{tr('Net amount', 'ශුද්ධ මුදල')}</div><div className="v">{money(summary.net_amount)}</div></div></div>
                                    <div className="col-6 col-md-3"><div className="stat" style={{ borderLeftColor: '#c62828' }}><div className="l">{tr('Balance due', 'ගෙවිය යුතු ශේෂය')}</div><div className="v text-danger">{money(summary.balance_amount)}</div></div></div>
                                </div>
                            )}

                            {truncated && (
                                <div className="alert alert-warning py-2 small">{tr('Showing the latest 2000 bills only. Narrow the filters to see the rest.', 'නවතම බිල්පත් 2000 පමණක් පෙන්වයි. ඉතිරිය බැලීමට පෙරහන් අඩු කරන්න.')}</div>
                            )}

                            <div className="table-responsive" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                                <table className="table table-sm table-bordered table-hover align-middle mb-0">
                                    <thead>
                                        <tr>
                                            <th>{tr('Bill No', 'බිල් අංකය')}</th>
                                            <th>{tr('Date', 'දිනය')}</th>
                                            <th>{tr('Supplier', 'සැපයුම්කරු')}</th>
                                            <th className="text-end">{tr('Items', 'භාණ්ඩ')}</th>
                                            <th className="text-end">{tr('Weight', 'බර')}</th>
                                            <th className="text-end">{tr('Net', 'ශුද්ධ')}</th>
                                            <th className="text-end">{tr('Paid', 'ගෙවූ')}</th>
                                            <th className="text-end">{tr('Balance', 'ශේෂය')}</th>
                                            <th>{tr('Status', 'තත්ත්වය')}</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {!loadingList && bills.length === 0 && (
                                            <tr><td colSpan={10} className="text-center text-muted py-3">{tr('No bills found', 'බිල්පත් හමු නොවීය')}</td></tr>
                                        )}
                                        {bills.map((b) => (
                                            <tr key={b.id} className={editingBill?.id === b.id ? 'table-warning' : ''}>
                                                <td className="fw-semibold">{b.bill_no}{b.reference_no && <div className="small text-muted">{b.reference_no}</div>}</td>
                                                <td className="text-nowrap">{b.bill_date}</td>
                                                <td>{b.supplier_code}<div className="small text-muted">{b.supplier_name}</div></td>
                                                <td className="text-end">{b.items_count}</td>
                                                <td className="text-end">{kg(b.total_weight)}</td>
                                                <td className="text-end">{money(b.net_amount)}</td>
                                                <td className="text-end">{money(b.paid_amount)}</td>
                                                <td className="text-end fw-semibold">{money(b.balance_amount)}</td>
                                                <td className="text-nowrap">
                                                    <span className={`badge ${STATUS_BADGE[b.status] || 'bg-secondary'}`}>{statusLabel(b.status)}</span>{' '}
                                                    {b.is_printed
                                                        ? <span className="badge bg-secondary">{tr('Printed', 'මුද්‍රිත')}</span>
                                                        : <span className="badge bg-warning text-dark">{tr('Held', 'රඳවා ඇති')}</span>}
                                                </td>
                                                <td className="text-nowrap">
                                                    <button type="button" className="btn btn-link btn-sm p-0 me-2" title={tr('Print', 'මුද්‍රණය')} onClick={() => printSaved(b)}>
                                                        <i className="material-icons" style={{ fontSize: 18 }}>print</i>
                                                    </button>
                                                    <button type="button" className="btn btn-link btn-sm p-0 me-2" title={tr('Edit', 'සංස්කරණය')} onClick={() => startEdit(b)}>
                                                        <i className="material-icons" style={{ fontSize: 18 }}>edit</i>
                                                    </button>
                                                    <button type="button" className="btn btn-link btn-sm p-0 text-danger" title={tr('Delete', 'මකන්න')} onClick={() => deleteBill(b)}>
                                                        <i className="material-icons" style={{ fontSize: 18 }}>delete</i>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
