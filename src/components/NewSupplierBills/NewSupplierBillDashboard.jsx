import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import api from '../../api';
import { tr } from '../../i18n/language';
import { SHOP_NAME, SHOP_STALL_NO } from '../../config/shop';
import { printHtml } from '../../utils/printHtml';
import { billDate } from '../../utils/billDate';

// New Supplier Bills dashboard.
// Bills entered here are stored in the new tables new_supplier_bills /
// new_supplier_bill_items. Nothing in the existing sales/supplier flow is touched.
// Shortcuts (same idea as Sales Entry): F5 = hold the bill (save, not printed),
// F4 = save and print. Layout copies Sales Entry: Printed list on the left,
// entry screen in the middle, Unprinted (held) list on the right.

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
// Bag cost printed on the supplier bill: Rs. 40 per bag (same as Kuliya on the billing screen)
const BAG_COST_PER_PACK = 40;
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
    payment_type: 'credit', // Credit / Cash buttons: every new bill starts as Credit
});

const paymentLabel = (t) => (t === 'cash' ? tr('Cash', 'මුදල්') : tr('Credit', 'ණය'));
const PAYMENT_BADGE = { credit: 'bg-info text-dark', cash: 'bg-success' };

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
    // Pack by pack: type weight (+ price) and press Enter = one pack added to that item's line
    const [packMode, setPackMode] = useState(() => {
        try { return localStorage.getItem('nsbPackMode') === '1'; } catch { return false; }
    });
    const [previewHtml, setPreviewHtml] = useState(null);
    const [editIndex, setEditIndex] = useState(null); // index of the line being edited
    const [editingBill, setEditingBill] = useState(null); // { id, bill_no } when editing a saved bill
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const [message, setMessage] = useState('');

    // ---------- list ----------
    const [filters, setFilters] = useState({ start_date: today(), end_date: today(), supplier: null, status: '', print_status: '', payment_type: '', search: '' });
    const [bills, setBills] = useState([]);
    const [summary, setSummary] = useState(null);
    const [truncated, setTruncated] = useState(false);
    const [loadingList, setLoadingList] = useState(false);
    const [listError, setListError] = useState('');
    const [heldBills, setHeldBills] = useState([]);
    const [printedBills, setPrintedBills] = useState([]); // today's printed bills (left sidebar)
    const [sideSearch, setSideSearch] = useState({ printed: '', held: '' });
    const [showReport, setShowReport] = useState(false);
    const reportOpenRef = useRef(false);
    reportOpenRef.current = showReport;

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
            if (f.payment_type) params.payment_type = f.payment_type;
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

    // Sidebars: unprinted = held bills of every date (so nothing waiting is missed),
    // printed = bills printed today (by print time, not bill date), so a held bill from
    // an earlier day moves across as soon as it is printed.
    const loadSidebars = useCallback(async () => {
        try {
            const now = new Date();
            const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            const [held, printed] = await Promise.all([
                api.get('/new-supplier-bills', { params: { print_status: 'held' } }),
                api.get('/new-supplier-bills', { params: {
                    print_status: 'printed',
                    printed_from: dayStart.toISOString(),
                    printed_to: dayEnd.toISOString(),
                    printed_on: today(),
                } }),
            ]);
            setHeldBills(held.data?.bills || []);
            setPrintedBills(printed.data?.bills || []);
        } catch { /* errors show in the report */ }
    }, []);

    const refreshLists = () => { loadSidebars(); if (showReport) loadBills(filters); };

    useEffect(() => { loadSidebars(); }, [loadSidebars]);

    // ---------- totals (server recomputes the same values on save) ----------
    // ---------- commission (same rules as Sales Entry; the server recalculates on save) ----------
    const [commissionRates, setCommissionRates] = useState({}); // "ITEM|SUPPLIER|price" -> per kg
    const commissionFetching = useRef(new Set());
    const supplierCode = form.supplier?.value || '';
    const rateKey = (itemCode, price) => `${String(itemCode || '').toUpperCase()}|${supplierCode.toUpperCase()}|${num(price)}`;
    const rateFor = (itemCode, price) => commissionRates[rateKey(itemCode, price)] ?? 0;
    // Pack lines: each pack keeps its own price, so value and commission add up pack by pack
    const isPackLine = (l) => Array.isArray(l.pack_weights) && l.pack_weights.length > 0;
    const pricesOf = (l) => (Array.isArray(l.pack_prices) && l.pack_prices.length === l.pack_weights.length
        ? l.pack_prices.map(num) : l.pack_weights.map(() => num(l.price_per_kg)));
    const lineValue = (l) => (isPackLine(l)
        ? round2(l.pack_weights.reduce((s, w, j) => s + num(w) * pricesOf(l)[j], 0))
        : round2(num(l.weight) * num(l.price_per_kg)));
    const lineCommission = (l) => (isPackLine(l)
        ? round2(l.pack_weights.reduce((s, w, j) => s + num(w) * rateFor(l.item?.value, pricesOf(l)[j]), 0))
        : round2(num(l.weight) * rateFor(l.item?.value, l.price_per_kg)));
    const commissionPerKg = (l) => (num(l.weight) > 0 ? lineCommission(l) / num(l.weight) : 0);
    const mixedPrices = (l) => isPackLine(l) && new Set(pricesOf(l)).size > 1;
    // Price shown for a line: its price, or the average per kg when its packs have different prices
    const linePrice = (l) => (mixedPrices(l) && num(l.weight) > 0 ? round2(lineValue(l) / num(l.weight)) : num(l.price_per_kg));
    const packText = (l) => (mixedPrices(l)
        ? l.pack_weights.map((w, j) => `${kg(w)}kg ${money(pricesOf(l)[j])}`).join(' + ')
        : `${l.pack_weights.map((w) => kg(w)).join(' + ')} kg`);

    useEffect(() => {
        const wanted = [];
        [...lines, line].forEach((l) => {
            if (!l.item?.value) return;
            if (isPackLine(l)) pricesOf(l).forEach((p) => wanted.push({ code: l.item.value, price: p }));
            if (l.price_per_kg !== '') wanted.push({ code: l.item.value, price: num(l.price_per_kg) });
        });
        wanted.filter((w) => w.price > 0).forEach(({ code, price }) => {
            const key = rateKey(code, price);
            if (key in commissionRates || commissionFetching.current.has(key)) return;
            commissionFetching.current.add(key);
            api.get('/new-supplier-bills/commission', { params: { item_code: code, supplier_code: supplierCode, price_per_kg: price } })
                .then((res) => setCommissionRates((prev) => ({ ...prev, [key]: num(res.data?.commission_per_kg) })))
                .catch(() => { /* shown as 0 until saved; the server always calculates it */ })
                .finally(() => commissionFetching.current.delete(key));
        });
    }, [lines, line.item, line.price_per_kg, supplierCode]); // eslint-disable-line react-hooks/exhaustive-deps

    const totals = useMemo(() => {
        const gross = round2(lines.reduce((s, l) => s + lineValue(l), 0));
        const commission = round2(lines.reduce((s, l) => s + lineCommission(l), 0));
        const weight = lines.reduce((s, l) => s + num(l.weight), 0);
        const packs = lines.reduce((s, l) => s + num(l.packs), 0);
        const net = round2(gross - commission - num(form.deductions));
        const balance = round2(net - num(form.paid_amount));
        return { gross, commission, weight, packs, net, balance };
    }, [lines, form.deductions, form.paid_amount, commissionRates, supplierCode]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // ----- pack by pack -----
    const togglePackMode = () => {
        setPackMode((on) => {
            const next = !on;
            try { localStorage.setItem('nsbPackMode', next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
        setLine((l) => ({ ...l, weight: '', packs: '' }));
        setEditIndex(null);
        setTimeout(() => weightRef.current?.focus(), 0);
    };

    const togglePackRef = useRef(null);
    togglePackRef.current = togglePackMode;

    // Pack by pack: one line per item AND price. Every Enter adds one pack (Packs 1, 2, 3 ...) to
    // the line with the same item and price; a different price starts a new line (new record).
    const sameLine = (l, item, price) => Array.isArray(l.pack_weights) && !!item && l.item?.value === item?.value
        && num(l.price_per_kg) === num(price) && !mixedPrices(l);

    const withPacks = (l, weights, prices) => ({
        ...l,
        pack_weights: weights,
        pack_prices: prices,
        packs: String(weights.length),
        weight: String(Math.round(weights.reduce((a, b) => a + b, 0) * 1000) / 1000),
    });

    // Lines after adding one pack (weight) to this item's pack line (created if new)
    const linesWithPack = (current, item, price, weight) => {
        const w = Math.round(num(weight) * 1000) / 1000;
        const p = num(price);
        const idx = current.findIndex((l) => sameLine(l, item, price));
        if (idx === -1) return [...current, withPacks({ item, price_per_kg: String(price) }, [w], [p])];
        return current.map((l, i) => (i === idx
            ? withPacks({ ...l, price_per_kg: String(price) }, [...l.pack_weights, w], [...pricesOf(l), p])
            : l));
    };

    const addPack = () => {
        setFormError('');
        if (!line.item) { setFormError(tr('Select an item.', 'භාණ්ඩයක් තෝරන්න.')); itemRef.current?.focus(); return; }
        if (num(line.weight) <= 0) { setFormError(tr('Enter the weight of this pack.', 'මෙම මල්ලේ බර ඇතුළත් කරන්න.')); weightRef.current?.focus(); return; }
        if (line.price_per_kg === '' || num(line.price_per_kg) < 0) { setFormError(tr('Enter the price per kg.', 'කිලෝවක මිල ඇතුළත් කරන්න.')); priceRef.current?.focus(); return; }
        setLines((prev) => linesWithPack(prev, line.item, line.price_per_kg, line.weight));
        setLine((l) => ({ ...l, weight: '' })); // keep item + price for the next pack
        setEditIndex(null);
        setTimeout(() => weightRef.current?.focus(), 0);
    };

    const removePack = (lineIdx, packIdx) => {
        setLines((prev) => prev.flatMap((l, i) => {
            if (i !== lineIdx) return [l];
            const weights = l.pack_weights.filter((_, j) => j !== packIdx);
            if (weights.length === 0) return [];
            return [withPacks(l, weights, pricesOf(l).filter((_, j) => j !== packIdx))];
        }));
    };

    // Pack line of the item + price being entered (its pack weights are listed under the inputs)
    const activePackIndex = packMode ? lines.findIndex((l) => sameLine(l, line.item, line.price_per_kg)) : -1;
    const activePackLine = activePackIndex >= 0 ? lines[activePackIndex] : null;

    // Weight -> Enter -> price (in pack mode the last price stays filled and selected, so one
    // more Enter keeps it, or type a new price). Enter on the price counts the pack.
    const onWeightEnter = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (packMode && !line.item) {
            // A pack is counted for an item: ask for it right away instead of after the price
            setFormError(tr('Pick the item first, then type the pack weight.', 'පළමුව භාණ්ඩය තෝරා, පසුව මල්ලේ බර ටයිප් කරන්න.'));
            itemRef.current?.focus();
            return;
        }
        setFormError('');
        priceRef.current?.focus();
        priceRef.current?.select();
    };
    const onPriceEnter = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (packMode) addPack();
        else packsRef.current?.focus();
    };

    const editLine = (i) => {
        const l = lines[i];
        if (Array.isArray(l.pack_weights)) {
            // Pack line: pick its item + price so the next weights are added to it
            setLine({ item: l.item, price_per_kg: l.price_per_kg, weight: '', packs: '' });
            if (!packMode) {
                setPackMode(true);
                try { localStorage.setItem('nsbPackMode', '1'); } catch { /* ignore */ }
            }
            setEditIndex(null);
        } else {
            setLine(l);
            setEditIndex(i);
        }
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
        let allLines = lines;
        let pendingPartial;
        if (packMode) {
            // Item + price stay filled between packs; only a typed weight counts as a pending pack
            pendingPartial = line.weight !== '' && !pendingComplete;
            if (pendingComplete) allLines = linesWithPack(lines, line.item, line.price_per_kg, line.weight);
        } else {
            pendingPartial = !pendingComplete && (line.item || line.weight !== '' || line.price_per_kg !== '');
            if (pendingComplete) {
                allLines = editIndex === null ? [...lines, line] : lines.map((l, i) => (i === editIndex ? line : l));
            }
        }

        if (!form.supplier) { setFormError(tr('Select a supplier.', 'සැපයුම්කරුවෙකු තෝරන්න.')); return; }
        if (!form.bill_date) { setFormError(tr('Select the bill date.', 'බිල්පත් දිනය තෝරන්න.')); return; }
        if (pendingPartial) { setFormError(tr('Finish or clear the item line first.', 'පළමුව භාණ්ඩ පේළිය සම්පූර්ණ කරන්න හෝ හිස් කරන්න.')); return; }
        if (allLines.length === 0) { setFormError(tr('Add at least one item.', 'අවම වශයෙන් එක් භාණ්ඩයක් එක් කරන්න.')); return; }
        const gross = round2(allLines.reduce((sum, l) => sum + lineValue(l), 0));
        const commissionTotal = round2(allLines.reduce((sum, l) => sum + lineCommission(l), 0));
        if (gross - commissionTotal - num(form.deductions) < 0) { setFormError(tr('Deductions cannot be more than the bill amount.', 'අඩු කිරීම් බිල්පත් මුදලට වඩා වැඩි විය නොහැක.')); return; }


        const payload = {
            bill_date: form.bill_date,
            supplier_code: form.supplier.value,
            supplier_name: form.supplier.name || null,
            reference_no: form.reference_no.trim() || null,
            payment_type: form.payment_type === 'cash' ? 'cash' : 'credit',
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
                pack_weights: isPackLine(l) ? l.pack_weights : null,
                pack_prices: isPackLine(l) ? pricesOf(l) : null,
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
            if (printAfter) printBill(saved);
            resetForm();
            refreshLists();
            setTimeout(() => supplierRef.current?.focus(), 0);
        } catch (err) {
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
            // F9: Pack by pack on / off
            if (e.key === 'F9' && !reportOpenRef.current) {
                e.preventDefault();
                togglePackRef.current?.();
                return;
            }
            if (e.key === 'F2' && !reportOpenRef.current) {
                e.preventDefault();
                previewRef.current?.();
                return;
            }
            if (e.key === 'F5' || e.key === 'F4') {
                e.preventDefault();
                if (reportOpenRef.current) return; // not while the report popup is open
                setPreviewHtml(null);
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
                payment_type: full.payment_type === 'cash' ? 'cash' : 'credit',
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
                ...(Array.isArray(it.pack_weights) && it.pack_weights.length ? {
                    pack_weights: it.pack_weights.map(Number),
                    pack_prices: Array.isArray(it.pack_prices) && it.pack_prices.length === it.pack_weights.length
                        ? it.pack_prices.map(Number) : it.pack_weights.map(() => num(it.price_per_kg)),
                } : {}),
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
        try {
            // Printing a held bill from the list also marks it as printed.
            const full = bill.is_printed
                ? await fetchBill(bill.id)
                : (await api.post(`/new-supplier-bills/${bill.id}/mark-printed`)).data;
            printBill(full);
            if (!bill.is_printed) refreshLists();
        } catch {
            setListError(tr('Could not open the bill.', 'බිල්පත විවෘත කළ නොහැක.'));
        }
    };

    // Prints straight away through a hidden frame (same as Sales Entry), no preview window.
    function printBill(bill) {
        printHtml(buildBillHtml(bill));
    }

    // Bill HTML (used for printing and for the on-screen preview)
    function buildBillHtml(bill) {
        // The commission is not shown on the bill: each line's price and amount are printed
        // after the commission is taken off, so the totals still add up to the net amount.
        const rows = (bill.items || []).map((it, i) => {
            const commission = num(it.commission_amount);
            const netAmount = num(it.amount) - commission;
            // Price column = price per kg minus the commission per kg (saved with each line)
            const commissionPerKg = it.commission_per_kg != null && it.commission_per_kg !== ''
                ? num(it.commission_per_kg)
                : (num(it.weight) > 0 ? commission / num(it.weight) : 0);
            const netPrice = num(it.price_per_kg) - commissionPerKg;
            return `
            <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(it.item_code)} ${escapeHtml(it.item_name || '')}</td>
                <td class="r">${num(it.packs) ? kg(it.packs) : ''}</td>
                <td class="r">${kg(it.weight)}</td>
                <td class="r">${money(netPrice)}</td>
                <td class="r">${money(netAmount)}</td>
            </tr>`;
        }).join('');

        // Second paper (pack sheet, printed after the bill): only the weights typed for the packs,
        // one column per item name; the same item at another price stays in the same column.
        // Bag cost on the bill: bags x Rs. 40 (same rule as Kuliya on the billing screen)
        const billPacks = (bill.items || []).reduce((a, it) => a + num(it.packs), 0);
        // Printed balance: net amount + bag cost - paid (the bag cost is added to what the supplier gets)
        const bagCost = round2(billPacks * BAG_COST_PER_PACK);
        const printBalance = round2(num(bill.net_amount) + bagCost - num(bill.paid_amount));
        const packItems = (bill.items || []).filter((it) => Array.isArray(it.pack_weights) && it.pack_weights.length > 0);
        const packColumns = [];
        packItems.forEach((it) => {
            const name = String(it.item_name || it.item_code || '').trim();
            let col = packColumns.find((c) => c.name.toUpperCase() === name.toUpperCase());
            if (!col) { col = { name, weights: [] }; packColumns.push(col); }
            col.weights.push(...it.pack_weights.map(Number));
        });
        // Page 2 only (page 1 is the bill alone). Each item starts a new column; when an item has
        // more packs than fit down the page, its weights carry on in the next column on the SAME
        // page, so the sheet fills sideways instead of running onto a third page.
        const ROWS_PER_COLUMN = 22; // weights that fit down a quarter-A4 page under the header
        const packChunks = [];
        packColumns.forEach((c) => {
            for (let i = 0; i < c.weights.length; i += ROWS_PER_COLUMN) {
                const last = i + ROWS_PER_COLUMN >= c.weights.length;
                packChunks.push({
                    name: c.name, cont: i > 0, start: i, weights: c.weights.slice(i, i + ROWS_PER_COLUMN),
                    total: last ? c.weights.reduce((x, w) => x + w, 0) : null, count: c.weights.length,
                });
            }
        });
        const packColsHtml = packChunks.map((ch) => `
                <table class="packcol">
                    <thead><tr><th title="${escapeHtml(ch.name)}">${escapeHtml(ch.name)}${ch.cont ? ' ›' : ''}</th></tr></thead>
                    <tbody>${ch.weights.map((w) => `<tr><td class="r">${kg(w)}</td></tr>`).join('')}
                    ${ch.total != null ? `<tr class="b tot-row"><td class="r">${kg(ch.total)}<br><span style="font-weight:normal">${ch.count} ${escapeHtml(tr('packs', 'මලු'))}</span></td></tr>` : ''}</tbody>
                </table>`).join('');
        const packsPage = packItems.length ? `
            <div class="page2 sheet" id="packsheet">
                <div class="pack-head">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:3mm">
                        <b style="font-size:12px">${escapeHtml(SHOP_NAME)}</b>
                        <span>${escapeHtml(tr('Pack sheet', 'මලු පත්‍රය'))}</span>
                    </div>
                    <div class="meta" style="margin:3px 0 4px">
                        <div><span class="code">${escapeHtml(bill.supplier_code)}</span></div>
                        <div class="r">${escapeHtml(tr('Bill No', 'බිල් අංකය'))}: <b>${escapeHtml(bill.bill_no)}</b><br>${escapeHtml(billDate(bill.bill_date))}</div>
                    </div>
                </div>
                <div class="packcols">${packColsHtml}</div>
            </div>` : '';

        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(bill.bill_no)}</title>
            <style>
                /* Printed on quarter-A4 paper (105mm x 148mm): the page itself is that size, so the
                   printer does not crop an A4 page down to the small sheet */
                @page{size:105mm 148mm;margin:0}
                html,body{width:105mm}
                *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
                body{font-family:Arial,sans-serif;font-size:11px;margin:0;color:#000}
                .sheet{width:105mm;padding:5mm 5mm 4mm 5mm}
                h2{margin:0;text-align:center;font-size:15px} .sub{text-align:center;margin-bottom:6px;font-size:11px}
                .meta{display:flex;justify-content:space-between;gap:4mm;margin-bottom:6px;line-height:1.5}
                table{width:100%;border-collapse:collapse;table-layout:fixed} th,td{border:1px solid #444;padding:2px 3px;word-wrap:break-word} td.r{white-space:nowrap}
                th{background:#eee;font-size:10px} .r{text-align:right} .tot td{border:none;padding:1px 4px}
                .tot{width:65%;margin-left:auto;margin-top:6px;table-layout:auto} .b{font-weight:bold}
                .page2{page-break-before:always;break-before:page}
                .code{font-size:16px;font-weight:bold;border:2px solid #000;padding:0 5px}
                @media screen{html,body{width:auto}body{background:#f3f4f6}.sheet{background:#fff;margin:10px;min-height:148mm;box-shadow:0 0 6px rgba(0,0,0,.25)}.page2{margin-top:20px}}
                .packcols{display:flex;flex-wrap:wrap;gap:1.5mm;align-items:flex-start}
                .packcol{width:auto;min-width:14mm;table-layout:auto;font-size:10px}
                .packcol th{font-size:9px;padding:1px 3px;max-width:22mm;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
                .packcol td{padding:0 3px;height:4.2mm;line-height:4.2mm}
                .packcol .tot-row td{height:auto;line-height:1.2;padding:1px 3px}
                .packtbl{font-size:11px;table-layout:auto} .packtbl th,.packtbl td{padding:2px 5px}
                .packtbl tr{page-break-inside:avoid;break-inside:avoid}
            </style></head><body>
            <div class="sheet" id="billsheet">
            <h2>${escapeHtml(SHOP_NAME)} (${escapeHtml(SHOP_STALL_NO)})</h2>
            <div class="sub">${escapeHtml(tr('Supplier Bill', 'සැපයුම්කරු බිල්පත'))}</div>
            <div class="meta">
                <div><b>${escapeHtml(tr('Supplier', 'සැපයුම්කරු'))}:</b> <span class="code">${escapeHtml(bill.supplier_code)}</span> ${escapeHtml(bill.supplier_name || '')}
                ${bill.reference_no ? `<br><b>${escapeHtml(tr('Ref No', 'යොමු අංකය'))}:</b> ${escapeHtml(bill.reference_no)}` : ''}</div>
                <div class="r"><b>${escapeHtml(tr('Bill No', 'බිල් අංකය'))}:</b> ${escapeHtml(bill.bill_no)}<br>
                <b>${escapeHtml(tr('Date', 'දිනය'))}:</b> ${escapeHtml(billDate(bill.bill_date))}<br>
                <span style="font-size:11px">${escapeHtml(paymentLabel(bill.payment_type))}</span></div>
            </div>
            <table><colgroup><col style="width:6%"><col style="width:26%"><col style="width:10%"><col style="width:16%"><col style="width:16%"><col style="width:26%"></colgroup><thead><tr>
                <th>#</th><th>${escapeHtml(tr('Item', 'භාණ්ඩය'))}</th><th class="r">${escapeHtml(tr('Packs', 'මලු'))}</th>
                <th class="r">${escapeHtml(tr('Weight (kg)', 'බර (kg)'))}</th><th class="r">${escapeHtml(tr('Price/kg', 'මිල/kg'))}</th>
                <th class="r">${escapeHtml(tr('Amount', 'මුදල'))}</th>
            </tr></thead><tbody>${rows}</tbody></table>
            <table class="tot">
                <tr><td>${escapeHtml(tr('Total weight', 'මුළු බර'))}</td><td class="r">${kg(bill.total_weight)} kg</td></tr>
                <tr><td>${escapeHtml(tr('Gross amount', 'දළ මුදල'))}</td><td class="r">${money(num(bill.gross_amount) - num(bill.commission_amount))}</td></tr>
                ${num(bill.deductions) ? `<tr><td>${escapeHtml(tr('Deductions', 'අඩු කිරීම්'))}${bill.deduction_note ? ` (${escapeHtml(bill.deduction_note)})` : ''}</td><td class="r">-${money(bill.deductions)}</td></tr>` : ''}
                <tr class="b"><td>${escapeHtml(tr('Net amount', 'ශුද්ධ මුදල'))}</td><td class="r">${money(bill.net_amount)}</td></tr>
                <tr><td>${escapeHtml(tr('Bag Cost', 'මලු වියදම'))} (${kg(billPacks)} × ${BAG_COST_PER_PACK})</td><td class="r">+${money(bagCost)}</td></tr>
                ${num(bill.paid_amount) ? `<tr><td>${escapeHtml(tr('Paid', 'ගෙවූ'))}</td><td class="r">-${money(bill.paid_amount)}</td></tr>` : ''}
                <tr class="b"><td>${escapeHtml(tr('Balance', 'ශේෂය'))}</td><td class="r">${money(printBalance)}</td></tr>
            </table>
            ${bill.notes ? `<p><b>${escapeHtml(tr('Notes', 'සටහන්'))}:</b> ${escapeHtml(bill.notes)}</p>` : ''}
            </div>
            ${packsPage}
            </body></html>`;
        return html;
    }

    // Preview (F2): the bill as it will print, built from what is on screen now
    const openPreview = () => {
        const pendingComplete = line.item && num(line.weight) > 0 && line.price_per_kg !== '';
        let shown = lines;
        if (pendingComplete) shown = packMode ? linesWithPack(lines, line.item, line.price_per_kg, line.weight) : [...lines, line];
        if (shown.length === 0) { setFormError(tr('Add at least one item.', 'අවම වශයෙන් එක් භාණ්ඩයක් එක් කරන්න.')); return; }
        const items = shown.map((l) => ({
            item_code: l.item?.value, item_name: l.item?.name, packs: num(l.packs), weight: num(l.weight),
            price_per_kg: linePrice(l), amount: lineValue(l), pack_weights: l.pack_weights || null,
            pack_prices: isPackLine(l) ? pricesOf(l) : null,
            commission_amount: lineCommission(l),
        }));
        const gross = round2(items.reduce((a, it) => a + it.amount, 0));
        const commission = round2(items.reduce((a, it) => a + it.commission_amount, 0));
        const net = round2(gross - commission - num(form.deductions));
        setPreviewHtml(buildBillHtml({
            bill_no: editingBill?.bill_no || tr('(new)', '(නව)'),
            bill_date: form.bill_date,
            supplier_code: form.supplier?.value || '', supplier_name: form.supplier?.name || '',
            reference_no: form.reference_no, notes: form.notes, deduction_note: form.deduction_note,
            payment_type: form.payment_type,
            items, total_weight: items.reduce((a, it) => a + it.weight, 0), gross_amount: gross, commission_amount: commission,
            deductions: num(form.deductions), net_amount: net, paid_amount: num(form.paid_amount), balance_amount: round2(net - num(form.paid_amount)),
        }));
    };
    const previewRef = useRef(null);
    previewRef.current = openPreview;

    const openReport = () => { setShowReport(true); loadBills(filters); };

    const applyFilters = (e) => { e?.preventDefault(); loadBills(filters); };
    const clearFilters = () => {
        const f = { start_date: today(), end_date: today(), supplier: null, status: '', print_status: '', payment_type: '', search: '' };
        setFilters(f);
        loadBills(f);
    };

    const todayTotal = useMemo(
        () => [...printedBills, ...heldBills].filter((b) => b.bill_date === today()).reduce((sum, b) => sum + num(b.net_amount), 0),
        [printedBills, heldBills]
    );

    const filterSide = (list, q) => {
        const query = q.trim().toUpperCase();
        if (!query) return list;
        return list.filter((b) => b.supplier_code.toUpperCase().startsWith(query) || String(b.bill_no || '').toUpperCase().includes(query));
    };

    // ---------- render ----------
    const darkInput = {
        backgroundColor: '#0d0d4d', border: '1px solid #4a5568', color: 'white', height: 36,
        fontSize: '1rem', padding: '0 0.75rem', borderRadius: '0.5rem', width: '100%', boxSizing: 'border-box', fontWeight: 'bold',
    };
    const label = { fontSize: 12, color: '#cbd5e1', marginBottom: 2, display: 'block' };
    const whiteSelect = {
        control: (b) => ({ ...b, minHeight: 36, backgroundColor: 'white', borderColor: '#4a5568', borderRadius: '0.5rem' }),
        singleValue: (b) => ({ ...b, color: 'black', fontWeight: 'bold', fontSize: 13 }),
        input: (b) => ({ ...b, color: 'black', fontWeight: 'bold' }),
        option: (b, st) => ({ ...b, color: 'black', fontWeight: 'bold', fontSize: 13, backgroundColor: st.isFocused ? '#e5e7eb' : 'white' }),
        menuPortal: (b) => ({ ...b, zIndex: 1060 }),
    };
    const cell = { border: '1px solid #4b5563', padding: '6px 8px' };
    const headCell = { ...cell, backgroundColor: '#f5fafb', color: '#000', fontWeight: 'bold', whiteSpace: 'nowrap' };

    const renderSidebar = (type) => {
        const isPrinted = type === 'printed';
        const list = filterSide(isPrinted ? printedBills : heldBills, sideSearch[type]);
        return (
            <div className="nsb-sidebar" style={{ backgroundColor: '#1ec139ff', borderRadius: '0.75rem', maxHeight: '80.5vh', overflowY: 'auto', border: '1px solid #000', boxShadow: '0 10px 15px rgba(0,0,0,.2)' }}>
                <div style={{ backgroundColor: '#006400', padding: 4, borderTopLeftRadius: '0.75rem', borderTopRightRadius: '0.75rem', position: 'sticky', top: 0, zIndex: 1 }}>
                    <h2 style={{ fontSize: 14, fontWeight: 'bold', color: 'white', textAlign: 'center', margin: '2px 0 4px' }}>
                        {isPrinted ? tr('Printed', 'මුද්‍රණය කළ') : tr('Unprinted', 'මුද්‍රණය නොකළ')}
                        <span style={{ marginLeft: 6, background: '#000', borderRadius: 8, padding: '0 6px', fontSize: 11 }}>{list.length}</span>
                    </h2>
                    <input
                        type="search"
                        // Not a login field: stop the browser / password managers filling saved
                        // usernames or passwords here (read-only until focused, when browsers autofill)
                        name={`nsb-sidebar-search-${type}`}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-bwignore="true"
                        data-form-type="other"
                        readOnly
                        onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
                        onBlur={(e) => e.currentTarget.setAttribute('readonly', '')}
                        value={sideSearch[type]}
                        onChange={(e) => setSideSearch({ ...sideSearch, [type]: e.target.value.toUpperCase() })}
                        placeholder={isPrinted ? tr('Search bill no / code...', 'සෙවීම බිල්පත් අංකය/කේතය...') : tr('Search supplier code...', 'සැපයුම්කරු කේතය සොයන්න...')}
                        style={{ width: 169, display: 'block', margin: '0 auto 2px', borderRadius: '0.75rem', border: '1px solid #ccc', padding: '1px 12px', textTransform: 'uppercase', fontSize: 13 }}
                    />
                </div>
                <div style={{ padding: '4px' }}>
                    {list.length === 0 ? (
                        <p style={{ color: '#374151', textAlign: 'center', fontSize: 12, padding: 8, margin: 0 }}>{tr('No records.', 'වාර්තා නොමැත.')}</p>
                    ) : list.map((b) => {
                        const selected = editingBill?.id === b.id;
                        const text = isPrinted ? `${b.supplier_code}-${b.bill_no}` : `${b.supplier_code} (${b.bill_no})`;
                        return (
                            <button
                                key={b.id}
                                type="button"
                                onClick={() => startEdit(b)}
                                title={`${text} · ${b.bill_date} · Rs. ${money(b.net_amount)}`}
                                style={{
                                    display: 'block', width: '100%', textAlign: 'left', marginBottom: 8, padding: '4px 6px',
                                    borderRadius: '0.75rem', border: `1px solid ${selected ? '#2563eb' : '#e5e7eb'}`,
                                    backgroundColor: selected ? '#93C5FD' : '#f9fafb', color: selected ? '#000' : '#374151',
                                    fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}
                            >
                                {text}
                                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 'bold', color: b.payment_type === 'cash' ? '#15803d' : '#b45309' }}>
                                    {b.payment_type === 'cash' ? tr('Cash', 'මුදල්') : tr('Credit', 'ණය')}
                                </span>
                                {!isPrinted && b.bill_date !== today() && <span style={{ display: 'block', fontSize: 10, color: '#b91c1c' }}>{b.bill_date}</span>}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="new-supplier-bills" style={{ maxWidth: 1400, margin: '0 auto' }}>
            <style>{`
                .new-supplier-bills .nsb-grid { display:grid; grid-template-columns:200px 1fr 200px; gap:16px; padding:10px; }
                @media (max-width: 991px) {
                    .new-supplier-bills .nsb-grid { grid-template-columns:1fr; }
                    .new-supplier-bills .nsb-center { order:-1; }
                }
                .new-supplier-bills .nsb-center input::placeholder { color:#94a3b8; font-weight:normal; }
                .new-supplier-bills .nsb-report .table thead th {
                    --bs-table-color:#ffffff; --bs-table-bg:#1b5e20;
                    background-color:#1b5e20 !important; color:#ffffff !important; white-space:nowrap;
                }
                .new-supplier-bills .stat { background:#fff; border-radius:8px; padding:10px 12px; border-left:4px solid #2e7d32; }
                .new-supplier-bills .stat .v { font-size:1.15rem; font-weight:700; }
                .new-supplier-bills .stat .l { font-size:.8rem; color:#555; }
            `}</style>

            <div className="nsb-grid">
                {/* ===== LEFT: printed ===== */}
                {renderSidebar('printed')}

                {/* ===== CENTER: entry screen ===== */}
                <div className="nsb-center" style={{ backgroundColor: '#111439ff', padding: 20, borderRadius: '0.75rem', color: 'white', minHeight: '80.5vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
                    {/* header */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                        <div style={{ color: 'red', fontWeight: 'bold', fontSize: '1.35rem', whiteSpace: 'nowrap' }}>
                            {tr('Bill No:', 'බිල් අං:')} {editingBill ? editingBill.bill_no : tr('New', 'නව')}
                        </div>
                        <div style={{ color: 'red', fontWeight: 'bold', fontSize: '1.15rem', whiteSpace: 'nowrap' }}>
                            {tr("Today's Bills:", 'අද බිල්පත්:')} Rs. {money(todayTotal)}
                        </div>
                        {/* Credit / Cash: chosen for this bill (Credit by default) */}
                        <div style={{ display: 'flex', gap: 6 }}>
                            {[
                                { key: 'credit', color: '#dc2626' },
                                { key: 'cash', color: '#16a34a' },
                            ].map(({ key, color }) => {
                                const active = form.payment_type === key;
                                return (
                                    <button key={key} type="button" tabIndex={-1}
                                        onClick={() => setForm((f) => ({ ...f, payment_type: key }))}
                                        style={{
                                            padding: '4px 14px', borderRadius: 6, fontWeight: 'bold', fontSize: '0.95rem', cursor: 'pointer',
                                            border: `2px solid ${color}`, backgroundColor: active ? color : 'transparent', color: active ? 'white' : color,
                                        }}>
                                        {active ? '✓ ' : ''}{paymentLabel(key)}
                                    </button>
                                );
                            })}
                        </div>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                            <button type="button" className="btn btn-sm btn-outline-light fw-bold" onClick={openReport}>
                                📊 {tr('Bills Report', 'බිල්පත් වාර්තාව')}
                            </button>
                            <button type="button" className="btn btn-sm btn-success fw-bold" onClick={() => { resetForm(); setMessage(''); setTimeout(() => supplierRef.current?.focus(), 0); }}>
                                + {tr('New Bill', 'නව බිල්පත')}
                            </button>
                        </div>
                    </div>

                    {message && <div style={{ background: '#14532d', border: '1px solid #22c55e', borderRadius: '0.5rem', padding: '6px 10px', marginBottom: 8 }}>{message}</div>}
                    {formError && <div style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', padding: '6px 10px', marginBottom: 8, fontWeight: 600 }}>{formError}</div>}

                    {/* bill header fields */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', columnGap: 8, rowGap: 8, alignItems: 'end' }}>
                        <div style={{ gridColumn: 'span 3' }}>
                            <label style={label}>{tr('Bill date', 'බිල්පත් දිනය')}</label>
                            <input type="date" style={darkInput} value={form.bill_date} onChange={(e) => setForm({ ...form, bill_date: e.target.value })} />
                        </div>
                        <div style={{ gridColumn: 'span 5' }}>
                            <label style={label}>{tr('Supplier', 'සැපයුම්කරු')}</label>
                            {/* Pick an existing supplier, or type a new code and press Enter */}
                            <CreatableSelect
                                ref={supplierRef}
                                autoFocus
                                options={supplierOptions}
                                value={form.supplier}
                                onChange={(opt) => { setForm({ ...form, supplier: opt }); if (opt) setTimeout(() => itemRef.current?.focus(), 0); }}
                                onCreateOption={(input) => {
                                    const code = input.trim().toUpperCase();
                                    if (!code) return;
                                    const existing = supplierOptions.find(o => o.value.toUpperCase() === code);
                                    setForm({ ...form, supplier: existing || { value: code, label: code, name: null, isNew: true } });
                                    setTimeout(() => itemRef.current?.focus(), 0);
                                }}
                                isValidNewOption={(input) => {
                                    const code = input.trim().toUpperCase();
                                    return code.length > 0 && code.length <= 50 && !supplierOptions.some(o => o.value.toUpperCase() === code);
                                }}
                                formatCreateLabel={(input) => `${tr('New supplier code', 'නව සැපයුම්කරු කේතය')}: ${input.trim().toUpperCase()}`}
                                placeholder={tr('Type or pick a supplier code...', 'සැපයුම්කරු කේතය ටයිප් කරන්න හෝ තෝරන්න...')}
                                styles={whiteSelect}
                                menuPortalTarget={document.body}
                                isClearable
                            />
                        </div>
                        <div style={{ gridColumn: 'span 4' }}>
                            <label style={label}>{tr('Supplier ref / bill no', 'සැපයුම්කරු යොමු / බිල් අංකය')}</label>
                            <input type="text" style={darkInput} maxLength={100} value={form.reference_no}
                                onChange={(e) => setForm({ ...form, reference_no: e.target.value })} placeholder={tr('Optional', 'අත්‍යවශ්‍ය නැත')} />
                        </div>

                        {/* item line */}
                        <div style={{ gridColumn: 'span 4' }}>
                            <label style={label}>{tr('Item', 'භාණ්ඩය')}</label>
                            <Select
                                ref={itemRef}
                                options={itemOptions}
                                value={line.item}
                                onChange={(opt) => { setLine({ ...line, item: opt }); if (opt) setTimeout(() => weightRef.current?.focus(), 0); }}
                                placeholder={tr('Item', 'භාණ්ඩය')}
                                styles={whiteSelect}
                                menuPortalTarget={document.body}
                            />
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                            <label style={label}>{packMode ? tr('Pack weight', 'මල්ලේ බර') : tr('Weight', 'බර')}</label>
                            <input ref={weightRef} type="number" min="0" step="any" style={{ ...darkInput, textAlign: 'center' }} value={line.weight}
                                onChange={(e) => setLine({ ...line, weight: e.target.value })} onKeyDown={onWeightEnter} />
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                            <label style={label}>{tr('Price', 'මිල')}</label>
                            <input ref={priceRef} type="number" min="0" step="any" style={{ ...darkInput, textAlign: 'center' }} value={line.price_per_kg}
                                onChange={(e) => setLine({ ...line, price_per_kg: e.target.value })} onKeyDown={onPriceEnter} />
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                            <label style={label}>{tr('Packs', 'මලු')}</label>
                            {packMode ? (
                                <div title={tr('Counted automatically: one per Enter', 'ස්වයංක්‍රීයව ගණන් කෙරේ: Enter එකකට එකක්')}
                                    style={{ ...darkInput, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f2937', color: '#facc15' }}>
                                    {activePackLine ? activePackLine.pack_weights.length : 0}
                                </div>
                            ) : (
                                <input ref={packsRef} type="number" min="0" step="any" style={{ ...darkInput, textAlign: 'center' }} value={line.packs}
                                    onChange={(e) => setLine({ ...line, packs: e.target.value })} onKeyDown={(e) => onLineKeyDown(e, null)} />
                            )}
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                            <label style={label}>{tr('Value', 'අගය')}</label>
                            <div style={{ ...darkInput, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f2937' }}>
                                {money(packMode && activePackLine
                                    ? lineValue(activePackLine) + num(line.weight) * num(line.price_per_kg !== '' ? line.price_per_kg : activePackLine.price_per_kg)
                                    : lineAmount)}
                            </div>
                        </div>
                    </div>

                    {/* pack weights of the item being entered */}
                    {packMode && (
                        <div style={{ marginTop: 8, padding: '8px 10px', border: '1px solid #facc15', borderRadius: '0.5rem', background: '#1c1917' }}>
                            {formError && (
                                <div style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: '0.4rem', padding: '4px 8px', marginBottom: 6, fontWeight: 700 }}>
                                    ⚠ {formError}
                                </div>
                            )}
                            {activePackLine ? (
                                <>
                                    <div style={{ fontSize: 13, color: '#facc15', marginBottom: 6, fontWeight: 'bold' }}>
                                        {activePackLine.item?.name || activePackLine.item?.value} —
                                        {' '}{activePackLine.pack_weights.length} {tr('packs', 'මලු')} · {kg(activePackLine.weight)} kg · {money(lineValue(activePackLine))}
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {activePackLine.pack_weights.map((w, j) => (
                                            <span key={j} style={{ background: '#374151', borderRadius: 6, padding: '3px 8px', fontSize: 13 }}>
                                                #{j + 1}: <b>{kg(w)} kg</b> {money(pricesOf(activePackLine)[j])}
                                                <button type="button" title={tr('Remove this pack', 'මෙම මල්ල ඉවත් කරන්න')} onClick={() => removePack(activePackIndex, j)}
                                                    style={{ marginLeft: 6, background: 'transparent', border: 'none', color: '#f87171', fontWeight: 'bold', cursor: 'pointer' }}>×</button>
                                            </span>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <div style={{ fontSize: 13, color: '#cbd5e1' }}>
                                    {tr('Pack by pack: 1) pick the Item  2) type the pack weight, Enter  3) type the price, Enter = Packs 1. Then the next weight, Enter, Enter = Packs 2 …',
                                        'මල්ලෙන් මල්ල: 1) භාණ්ඩය තෝරන්න 2) මල්ලේ බර ටයිප් කර Enter 3) මිල ටයිප් කර Enter = මලු 1. ඊළඟ බර, Enter, Enter = මලු 2 …')}
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
                        <small style={{ color: '#94a3b8' }}>
                            {tr('Enter = next / add · F2 = preview · F5 = hold · F4 = print · F9 = pack by pack', 'Enter = ඊළඟ / එක් කරන්න · F2 = පෙරදසුන · F5 = රඳවන්න · F4 = මුද්‍රණය · F9 = මල්ලෙන් මල්ල')}
                        </small>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className={`btn btn-sm fw-bold ${packMode ? 'btn-warning' : 'btn-outline-warning'}`} onClick={togglePackMode}
                                title={tr('Each Enter adds one pack with its weight', 'සෑම Enter එකක්ම බර සමඟ මල්ලක් එක් කරයි')}>
                                {packMode ? '✓ ' : ''}{tr('Pack by pack', 'මල්ලෙන් මල්ල')}
                            </button>
                            {editIndex !== null && (
                                <button type="button" className="btn btn-sm btn-outline-light" onClick={() => { setLine(emptyLine); setEditIndex(null); }}>{tr('Cancel', 'අවලංගු')}</button>
                            )}
                            <button type="button" className="btn btn-sm btn-primary fw-bold" onClick={packMode ? addPack : addOrUpdateLine}>
                                {packMode ? tr('Add pack', 'මල්ල එක් කරන්න') : editIndex !== null ? tr('Update line', 'පේළිය යාවත්කාලීන') : tr('Add item', 'භාණ්ඩය එක් කරන්න')}
                            </button>
                        </div>
                    </div>

                    {/* lines table (Sales Entry style) */}
                    <div style={{ flexGrow: 1, overflowY: 'auto', marginTop: 4 }}>
                        {lines.length > 0 ? (
                            <table style={{ width: '100%', backgroundColor: '#000', color: 'white', borderCollapse: 'collapse', fontSize: 14, textAlign: 'center' }}>
                                <thead>
                                    <tr>
                                        {['#', tr('Code', 'කේතය'), tr('Item', 'අයිතමය'), tr('Bags', 'මලු'), tr('Weight(kg)', 'බර(kg)'), tr('Price', 'මිල'), tr('Value', 'අගය'), tr('Actions', 'Actions')].map((h) => (
                                            <th key={h} style={headCell}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {lines.map((l, i) => (
                                        <tr key={i} onClick={() => editLine(i)} style={{ cursor: 'pointer', backgroundColor: editIndex === i ? '#1e40af' : 'transparent' }}>
                                            <td style={cell}>{i + 1}</td>
                                            <td style={cell}>{l.item?.value}</td>
                                            <td style={cell}>
                                                {l.item?.name}
                                                {Array.isArray(l.pack_weights) && (
                                                    <div style={{ fontSize: 11, color: '#facc15' }}>{packText(l)}</div>
                                                )}
                                            </td>
                                            <td style={cell}>{num(l.packs) ? kg(l.packs) : ''}</td>
                                            <td style={cell}>{kg(l.weight)}</td>
                                            {/* Price and value after the commission is taken off (no separate commission column) */}
                                            <td style={cell} title={`${mixedPrices(l) ? tr('Average price per kg', 'කිලෝවක සාමාන්‍ය මිල') + ' · ' : ''}${money(linePrice(l))} - ${money(commissionPerKg(l))} ${tr('commission', 'කොමිස්')}`}>
                                                {money(linePrice(l) - commissionPerKg(l))}{mixedPrices(l) ? '*' : ''}
                                            </td>
                                            <td style={cell} title={`${money(lineValue(l))} - ${money(lineCommission(l))} ${tr('commission', 'කොමිස්')}`}>{money(lineValue(l) - lineCommission(l))}</td>
                                            <td style={cell}>
                                                <button type="button" onClick={(e) => { e.stopPropagation(); removeLine(i); }}
                                                    style={{ background: 'white', border: 'none', borderRadius: '50%', padding: '2px 6px', fontWeight: 'bold' }}>🗑️</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : null}

                        {/* pack details: the weight, price and value of every pack entered */}
                        {lines.some(isPackLine) && (
                            <div style={{ marginTop: 10 }}>
                                <div style={{ color: '#facc15', fontWeight: 'bold', marginBottom: 4 }}>{tr('Pack details', 'මලු විස්තර')}</div>
                                <table style={{ width: '100%', backgroundColor: '#000', color: 'white', borderCollapse: 'collapse', fontSize: 14, textAlign: 'center' }}>
                                    <thead>
                                        <tr>
                                            {[tr('Item', 'අයිතමය'), tr('Pack', 'මල්ල'), tr('Weight(kg)', 'බර(kg)'), tr('Price', 'මිල'), tr('Value', 'අගය')].map((h) => (
                                                <th key={h} style={headCell}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {lines.map((l, i) => (isPackLine(l) ? (
                                            <React.Fragment key={i}>
                                                {l.pack_weights.map((w, j) => (
                                                    <tr key={j}>
                                                        <td style={cell}>{j === 0 ? `${l.item?.value || ''} ${l.item?.name || ''}` : ''}</td>
                                                        <td style={cell}>#{j + 1}</td>
                                                        <td style={cell}>{kg(w)}</td>
                                                        <td style={cell}>{money(pricesOf(l)[j])}</td>
                                                        <td style={cell}>{money(num(w) * pricesOf(l)[j])}</td>
                                                    </tr>
                                                ))}
                                                <tr style={{ color: '#facc15', fontWeight: 'bold' }}>
                                                    <td style={cell}>{tr('Total', 'එකතුව')}</td>
                                                    <td style={cell}>{l.pack_weights.length}</td>
                                                    <td style={cell}>{kg(l.weight)}</td>
                                                    <td style={cell}></td>
                                                    <td style={cell}>{money(lineValue(l))}</td>
                                                </tr>
                                            </React.Fragment>
                                        ) : null))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {lines.length === 0 && (
                            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '30px 0', border: '1px dashed #4b5563', borderRadius: '0.75rem' }}>
                                {tr('No items added yet. Pick a supplier, then add items.', 'තවම භාණ්ඩ එක් කර නැත. සැපයුම්කරු තෝරා භාණ්ඩ එක් කරන්න.')}
                            </div>
                        )}
                    </div>

                    {/* totals bar */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 10, padding: 8, borderRadius: '0.75rem', border: '2px solid #3b82f6', backgroundColor: '#111827', fontWeight: 'bold' }}>
                        {[
                            [tr('Weight:', 'බර:'), `${kg(totals.weight)} kg`, 'white'],
                            [tr('Total:', 'එකතුව:'), money(totals.gross), 'white'],
                            [tr('Commission:', 'කොමිස්:'), `-${money(totals.commission)}`, '#f87171'],
                            [tr('Deductions:', 'අඩු කිරීම්:'), `-${money(form.deductions)}`, '#f87171'],
                            [tr('Net:', 'ශුද්ධ:'), money(totals.net), '#facc15'],
                            [tr('Balance:', 'ශේෂය:'), money(totals.balance), totals.balance > 0 ? '#f87171' : '#4ade80'],
                        ].map(([l, v, c], i, arr) => (
                            <div key={l} style={{ flex: '1 1 120px', textAlign: 'center', padding: '0 8px', borderRight: i < arr.length - 1 ? '1px solid #374151' : 'none' }}>
                                <span style={{ color: '#9ca3af', fontSize: 10, textTransform: 'uppercase', marginRight: 6 }}>{l}</span>
                                <span style={{ color: c, fontSize: 14 }}>{v}</span>
                            </div>
                        ))}
                    </div>

                    {/* payment fields */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', columnGap: 8, rowGap: 8, marginTop: 10, alignItems: 'end' }}>
                        <div style={{ gridColumn: 'span 2' }}>
                            <label style={label}>{tr('Deductions', 'අඩු කිරීම්')}</label>
                            <input type="number" min="0" step="any" style={darkInput} value={form.deductions} onChange={(e) => setForm({ ...form, deductions: e.target.value })} />
                        </div>
                        <div style={{ gridColumn: 'span 3' }}>
                            <label style={label}>{tr('Deduction reason', 'අඩු කිරීමට හේතුව')}</label>
                            <input type="text" style={darkInput} maxLength={255} value={form.deduction_note}
                                onChange={(e) => setForm({ ...form, deduction_note: e.target.value })} placeholder={tr('e.g. transport', 'උදා: ප්‍රවාහන')} />
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                            <label style={label}>{tr('Paid now', 'දැන් ගෙවූ')}</label>
                            <input type="number" min="0" step="any" style={darkInput} value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
                        </div>
                        <div style={{ gridColumn: 'span 5' }}>
                            <label style={label}>{tr('Notes', 'සටහන්')}</label>
                            <input type="text" style={darkInput} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                        </div>
                    </div>

                    {/* actions */}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
                        {editingBill && (
                            <button type="button" className="btn btn-sm btn-outline-danger fw-bold" onClick={() => deleteBill(editingBill)} disabled={saving}>
                                🗑️ {tr('Delete Bill', 'බිල්පත මකන්න')}
                            </button>
                        )}
                        <button type="button" className="btn btn-sm btn-outline-light" onClick={resetForm} disabled={saving}>{tr('Clear', 'හිස් කරන්න')}</button>
                        <button type="button" className="btn btn-sm btn-outline-info fw-bold" onClick={openPreview} disabled={saving}>👁 {tr('Preview (F2)', 'පෙරදසුන (F2)')}</button>
                        <button type="button" className="btn btn-warning fw-bold" onClick={() => saveBill(false)} disabled={saving}>
                            {saving ? tr('Saving...', 'සුරකිමින්...') : tr('Hold (F5)', 'රඳවන්න (F5)')}
                        </button>
                        <button type="button" className="btn btn-success fw-bold" onClick={() => saveBill(true)} disabled={saving}>
                            🖨️ {tr('Print (F4)', 'මුද්‍රණය (F4)')}
                        </button>
                    </div>
                </div>

                {/* ===== RIGHT: unprinted (held) ===== */}
                {renderSidebar('held')}
            </div>

            {/* ===== Bill preview (F2) ===== */}
            {previewHtml && (
                <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} role="dialog" aria-modal="true"
                    onKeyDown={(e) => { if (e.key === 'Escape') setPreviewHtml(null); }}>
                    <div className="modal-dialog modal-lg modal-dialog-scrollable">
                        <div className="modal-content">
                            <div className="modal-header" style={{ background: '#1b5e20', color: '#fff' }}>
                                <h5 className="modal-title">{tr('Bill preview', 'බිල්පත් පෙරදසුන')}</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setPreviewHtml(null)} aria-label="Close" />
                            </div>
                            <div className="modal-body p-0" style={{ background: '#e5e7eb' }}>
                                <iframe title="bill-preview" srcDoc={previewHtml} style={{ width: '100%', height: '70vh', border: 'none', background: '#fff' }} />
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-outline-secondary" onClick={() => setPreviewHtml(null)}>{tr('Close', 'වසන්න')}</button>
                                <button type="button" className="btn btn-warning fw-bold" onClick={() => { setPreviewHtml(null); saveBill(false); }}>{tr('Hold (F5)', 'රඳවන්න (F5)')}</button>
                                <button type="button" className="btn btn-success fw-bold" onClick={() => { setPreviewHtml(null); saveBill(true); }}>🖨️ {tr('Print (F4)', 'මුද්‍රණය (F4)')}</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== Bills report popup ===== */}
            {showReport && (
                <div className="modal show d-block nsb-report" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} role="dialog" aria-modal="true">
                    <div className="modal-dialog modal-xl modal-dialog-scrollable">
                        <div className="modal-content">
                            <div className="modal-header" style={{ background: '#1b5e20', color: '#fff' }}>
                                <h5 className="modal-title">{tr('Supplier Bills Report', 'සැපයුම්කරු බිල්පත් වාර්තාව')}</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowReport(false)} aria-label="Close" />
                            </div>
                            <div className="modal-body">
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
                                    <div className="col-6 col-md-2">
                                        <label className="form-label small mb-1">{tr('Credit / Cash', 'ණය / මුදල්')}</label>
                                        <select className="form-select form-select-sm" value={filters.payment_type}
                                            onChange={(e) => setFilters({ ...filters, payment_type: e.target.value })}>
                                            <option value="">{tr('All', 'සියල්ල')}</option>
                                            <option value="credit">{paymentLabel('credit')}</option>
                                            <option value="cash">{paymentLabel('cash')}</option>
                                        </select>
                                    </div>
                                    <div className="col-6 col-md-4">
                                        <label className="form-label small mb-1">{tr('Search', 'සොයන්න')}</label>
                                        <input type="text" className="form-control form-control-sm" value={filters.search}
                                            placeholder={tr('Bill no / ref', 'බිල් අංකය / යොමු')}
                                            onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
                                    </div>
                                    <div className="col-12 col-md-6 d-flex gap-2 justify-content-end">
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
                                        {/* Credit and cash bills shown separately (click to show only those) */}
                                        {['credit', 'cash'].map((t) => {
                                            const d = summary.by_payment?.[t] || { bill_count: 0, net_amount: 0, balance_amount: 0 };
                                            const color = t === 'cash' ? '#15803d' : '#b45309';
                                            return (
                                                <div key={t} className="col-12 col-md-6">
                                                    <div className="stat" role="button" style={{ borderLeftColor: color, outline: filters.payment_type === t ? `2px solid ${color}` : 'none' }}
                                                        onClick={() => { const f = { ...filters, payment_type: filters.payment_type === t ? '' : t }; setFilters(f); loadBills(f); }}>
                                                        <div className="l" style={{ color }}>{t === 'cash' ? tr('Cash bills', 'මුදල් බිල්පත්') : tr('Credit bills', 'ණය බිල්පත්')} · {d.bill_count}</div>
                                                        <div className="v" style={{ color }}>{money(d.net_amount)}
                                                            <span className="small text-muted ms-2" style={{ fontSize: 12 }}>{tr('Balance', 'ශේෂය')}: {money(d.balance_amount)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {truncated && (
                                    <div className="alert alert-warning py-2 small">{tr('Showing the latest 2000 bills only. Narrow the filters to see the rest.', 'නවතම බිල්පත් 2000 පමණක් පෙන්වයි. ඉතිරිය බැලීමට පෙරහන් අඩු කරන්න.')}</div>
                                )}

                                <div className="table-responsive">
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
                                                <tr key={b.id}>
                                                    <td className="fw-semibold">{b.bill_no}{b.reference_no && <div className="small text-muted">{b.reference_no}</div>}</td>
                                                    <td className="text-nowrap">{b.bill_date}</td>
                                                    <td>{b.supplier_code}<div className="small text-muted">{b.supplier_name}</div></td>
                                                    <td className="text-end">{b.items_count}</td>
                                                    <td className="text-end">{kg(b.total_weight)}</td>
                                                    <td className="text-end">{money(b.net_amount)}</td>
                                                    <td className="text-end">{money(b.paid_amount)}</td>
                                                    <td className="text-end fw-semibold">{money(b.balance_amount)}</td>
                                                    <td className="text-nowrap">
                                                        <span className={`badge ${PAYMENT_BADGE[b.payment_type] || PAYMENT_BADGE.credit}`}>{paymentLabel(b.payment_type)}</span>{' '}
                                                        <span className={`badge ${STATUS_BADGE[b.status] || 'bg-secondary'}`}>{statusLabel(b.status)}</span>{' '}
                                                        {b.is_printed
                                                            ? <span className="badge bg-secondary">{tr('Printed', 'මුද්‍රිත')}</span>
                                                            : <span className="badge bg-warning text-dark">{tr('Held', 'රඳවා ඇති')}</span>}
                                                    </td>
                                                    <td className="text-nowrap">
                                                        <button type="button" className="btn btn-link btn-sm p-0 me-2" title={tr('Print', 'මුද්‍රණය')} onClick={() => printSaved(b)}>
                                                            <i className="material-icons" style={{ fontSize: 18 }}>print</i>
                                                        </button>
                                                        <button type="button" className="btn btn-link btn-sm p-0 me-2" title={tr('Open', 'විවෘත කරන්න')} onClick={() => { setShowReport(false); startEdit(b); }}>
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
            )}
        </div>
    );
}
