import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Select from 'react-select';
import * as XLSX from 'xlsx';
import api from '../../api';
import { SHOP_NAME } from '../../config/shop';
import { tr } from '../../i18n/language';

// ---------------------------------------------------------------------------
// Advanced Sales Report
//  - No date filter  -> today's sales (`sales` table)
//  - Any date filter -> sales history (`sales_histories` table)
// Line total matches the printed customer bill:
//   weight x price + bags x bag price + Kuliya
// ---------------------------------------------------------------------------

const EMPTY_FILTERS = {
    start_date: '',
    end_date: '',
    customer_code: '',
    item_code: '',
    supplier_code: '',
    bill_no: '',
    transaction_type: '',
    bill_status: '',
};

const RECORDS_PAGE_SIZE = 100;
const CUSTOMERS_PAGE_SIZE = 20;

const num = (v) => Number(v) || 0;
const money = (v) => num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg = (v) => num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Local YYYY-MM-DD (not UTC, so "today" is right in Sri Lanka time)
const ymd = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const quickRanges = () => {
    const today = new Date();
    const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const firstLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    return [
        { key: 'live', label: tr("Today's live sales", 'අද සජීවී විකුණුම්'), start: '', end: '' },
        { key: 'yesterday', label: tr('Yesterday', 'ඊයේ'), start: ymd(addDays(today, -1)), end: ymd(addDays(today, -1)) },
        { key: '7d', label: tr('Last 7 days', 'පසුගිය දින 7'), start: ymd(addDays(today, -6)), end: ymd(today) },
        { key: '30d', label: tr('Last 30 days', 'පසුගිය දින 30'), start: ymd(addDays(today, -29)), end: ymd(today) },
        { key: 'month', label: tr('This month', 'මෙම මාසය'), start: ymd(firstThisMonth), end: ymd(today) },
        { key: 'lastmonth', label: tr('Last month', 'පසුගිය මාසය'), start: ymd(firstLastMonth), end: ymd(lastLastMonth) },
    ];
};

// Normalise one API row and work out its amounts
const prepareRow = (r) => {
    const weight = num(r.weight);
    const price = num(r.price_per_kg);
    const packs = num(r.packs);
    const bagPrice = num(r.CustomerPackCost);
    const value = weight * price;
    const bagCost = packs * bagPrice;
    const kuliya = num(r.Kuliya);
    return {
        ...r,
        customer: String(r.customer_code || '').trim().toUpperCase() || tr('(no customer)', '(පාරිභෝගිකයෙක් නැත)'),
        bill: String(r.bill_no || '').trim() || tr('(no bill)', '(බිල්පතක් නැත)'),
        weight, price, packs, bagPrice, value, bagCost, kuliya,
        lineTotal: value + bagCost + kuliya,
    };
};

const summarise = (rows) => {
    const customers = new Set();
    const bills = new Set();
    const items = new Set();
    const s = { items_value: 0, bag_cost: 0, kuliya: 0, total_weight: 0, total_packs: 0 };
    rows.forEach((r) => {
        customers.add(r.customer);
        bills.add(`${r.customer}|${r.Date}|${r.bill}`);
        items.add(r.item_code);
        s.items_value += r.value;
        s.bag_cost += r.bagCost;
        s.kuliya += r.kuliya;
        s.total_weight += r.weight;
        s.total_packs += r.packs;
    });
    return {
        ...s,
        grand_total: s.items_value + s.bag_cost + s.kuliya,
        record_count: rows.length,
        customer_count: customers.size,
        bill_count: bills.size,
        item_count: items.size,
    };
};

const apiError = (err) => {
    const data = err?.response?.data;
    if (data?.errors) return Object.values(data.errors).flat().join(' ');
    return data?.message || data?.error || err?.message || tr('Something went wrong.', 'දෝෂයක් සිදු විය.');
};

const selectStyles = {
    menuPortal: (base) => ({ ...base, zIndex: 2000 }),
    control: (base) => ({ ...base, minHeight: 38 }),
};

// ---------------------------------------------------------------------------

const SalesReportView = ({ onClose }) => {
    const [draft, setDraft] = useState(EMPTY_FILTERS);
    const [applied, setApplied] = useState(EMPTY_FILTERS);
    const [options, setOptions] = useState({ customers: [], items: [], suppliers: [] });

    const [rows, setRows] = useState([]);
    const [serverSummary, setServerSummary] = useState(null);
    const [meta, setMeta] = useState({ source: 'sales', truncated: false, max_rows: 0 });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [filterError, setFilterError] = useState('');

    const [view, setView] = useState('customer');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState({ key: 'Date', dir: 'desc' });
    const [recordsPage, setRecordsPage] = useState(1);
    const [customersPage, setCustomersPage] = useState(1);
    const [collapsed, setCollapsed] = useState(() => new Set());
    const [generatedAt, setGeneratedAt] = useState(null);

    const requestId = useRef(0);

    // ---- data loading -----------------------------------------------------
    const loadReport = useCallback(async (filters) => {
        const id = ++requestId.current;
        setLoading(true);
        setError('');
        try {
            const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v != null));
            const { data } = await api.get('/sales-report', { params });
            if (id !== requestId.current) return; // a newer request has started
            setRows((data.salesData || []).map(prepareRow));
            setServerSummary(data.summary || null);
            setMeta({ source: data.source || 'sales', truncated: !!data.truncated, max_rows: data.max_rows || 0 });
            setApplied(filters);
            setRecordsPage(1);
            setCustomersPage(1);
            setCollapsed(new Set());
            setGeneratedAt(new Date());
        } catch (err) {
            if (id !== requestId.current) return;
            setError(apiError(err));
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadReport(EMPTY_FILTERS);
        api.get('/sales-report/filter-options')
            .then(({ data }) => setOptions({
                customers: data.customers || [],
                items: data.items || [],
                suppliers: data.suppliers || [],
            }))
            .catch((err) => console.error('Failed to load sales report filter options', err));
    }, [loadReport]);

    const applyFilters = (filters = draft) => {
        if (filters.start_date && filters.end_date && filters.end_date < filters.start_date) {
            setFilterError(tr('"To" date must be on or after the "From" date.', '"දක්වා" දිනය "සිට" දිනයට පසු විය යුතුය.'));
            return;
        }
        setFilterError('');
        setDraft(filters);
        loadReport(filters);
    };

    const setField = (name, value) => setDraft((prev) => ({ ...prev, [name]: value }));
    const draftChanged = JSON.stringify(draft) !== JSON.stringify(applied);

    // ---- select options ---------------------------------------------------
    const customerOptions = useMemo(() => options.customers.map((c) => ({
        value: c.code, label: c.name ? `${c.code} — ${c.name}` : c.code,
    })), [options.customers]);
    const itemOptions = useMemo(() => options.items.map((i) => ({
        value: i.code, label: i.name ? `${i.code} — ${i.name}` : i.code,
    })), [options.items]);
    const supplierOptions = useMemo(() => options.suppliers.map((s) => ({
        value: s.code, label: s.name ? `${s.code} — ${s.name}` : s.code,
    })), [options.suppliers]);
    const findOption = (opts, value) => opts.find((o) => o.value === value) || (value ? { value, label: value } : null);

    // ---- quick search (client side, over the loaded rows) -----------------
    const visibleRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((r) => [r.customer, r.customer_name, r.bill, r.item_code, r.item_name, r.supplier_code, r.Date]
            .some((v) => String(v || '').toLowerCase().includes(q)));
    }, [rows, search]);

    // Server summary covers every matching record; when a quick search narrows the
    // rows, the cards switch to totals of the visible rows.
    const summary = useMemo(() => {
        if (!search.trim() && serverSummary) return serverSummary;
        return summarise(visibleRows);
    }, [search, serverSummary, visibleRows]);

    // ---- grouped / aggregated views ---------------------------------------
    const byCustomer = useMemo(() => {
        const map = new Map();
        visibleRows.forEach((r) => {
            if (!map.has(r.customer)) map.set(r.customer, { customer: r.customer, name: r.customer_name, bills: new Map(), total: 0, weight: 0 });
            const c = map.get(r.customer);
            if (!c.name && r.customer_name) c.name = r.customer_name;
            // A bill belongs to one day, so key by date + bill no (bill numbers may repeat across days)
            const billKey = `${r.Date}|${r.bill}`;
            if (!c.bills.has(billKey)) c.bills.set(billKey, { key: billKey, bill: r.bill, date: r.Date, rows: [], total: 0, credit: r.credit_transaction === 'Y' });
            const b = c.bills.get(billKey);
            b.rows.push(r);
            b.total += r.lineTotal;
            c.total += r.lineTotal;
            c.weight += r.weight;
        });
        return [...map.values()]
            .map((c) => ({ ...c, bills: [...c.bills.values()] }))
            .sort((a, b) => a.customer.localeCompare(b.customer));
    }, [visibleRows]);

    const byItem = useMemo(() => {
        const map = new Map();
        visibleRows.forEach((r) => {
            const key = r.item_code || r.item_name || '-';
            if (!map.has(key)) map.set(key, { code: r.item_code, name: r.item_name, packs: 0, weight: 0, value: 0, bagCost: 0, kuliya: 0, total: 0, customers: new Set() });
            const it = map.get(key);
            it.packs += r.packs; it.weight += r.weight; it.value += r.value;
            it.bagCost += r.bagCost; it.kuliya += r.kuliya; it.total += r.lineTotal;
            it.customers.add(r.customer);
        });
        return [...map.values()].map((it) => ({ ...it, customers: it.customers.size })).sort((a, b) => b.total - a.total);
    }, [visibleRows]);

    const byDate = useMemo(() => {
        const map = new Map();
        visibleRows.forEach((r) => {
            const key = r.Date || '-';
            if (!map.has(key)) map.set(key, { date: key, bills: new Set(), customers: new Set(), packs: 0, weight: 0, total: 0 });
            const d = map.get(key);
            d.bills.add(`${r.customer}|${r.bill}`); d.customers.add(r.customer);
            d.packs += r.packs; d.weight += r.weight; d.total += r.lineTotal;
        });
        return [...map.values()]
            .map((d) => ({ ...d, bills: d.bills.size, customers: d.customers.size }))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }, [visibleRows]);

    const sortedRecords = useMemo(() => {
        const dir = sort.dir === 'asc' ? 1 : -1;
        return [...visibleRows].sort((a, b) => {
            const x = a[sort.key]; const y = b[sort.key];
            if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
            return String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }) * dir;
        });
    }, [visibleRows, sort]);

    const recordsPageCount = Math.max(1, Math.ceil(sortedRecords.length / RECORDS_PAGE_SIZE));
    const customersPageCount = Math.max(1, Math.ceil(byCustomer.length / CUSTOMERS_PAGE_SIZE));
    useEffect(() => { setRecordsPage(1); setCustomersPage(1); }, [search]);

    const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: typeof rows[0]?.[key] === 'number' ? 'desc' : 'asc' }));
    const toggleCustomer = (code) => setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(code)) next.delete(code); else next.add(code);
        return next;
    });

    // ---- labels -----------------------------------------------------------
    const isHistory = meta.source === 'history';
    const periodLabel = isHistory
        ? (applied.start_date && applied.end_date
            ? (applied.start_date === applied.end_date ? applied.start_date : `${applied.start_date} → ${applied.end_date}`)
            : applied.start_date ? `${tr('From', 'සිට')} ${applied.start_date}` : `${tr('Up to', 'දක්වා')} ${applied.end_date}`)
        : tr("Today's live sales", 'අද සජීවී විකුණුම්');

    const chipDefs = [
        ['start_date', tr('From', 'සිට')], ['end_date', tr('To', 'දක්වා')],
        ['customer_code', tr('Customer', 'පාරිභෝගිකයා')], ['item_code', tr('Item', 'අයිතමය')],
        ['supplier_code', tr('Supplier', 'සැපයුම්කරු')], ['bill_no', tr('Bill', 'බිල')],
        ['transaction_type', tr('Payment', 'ගෙවීම')], ['bill_status', tr('Bill status', 'බිල් තත්ත්වය')],
    ];
    const valueLabel = (key, value) => {
        if (key === 'transaction_type') return value === 'credit' ? tr('Credit', 'ණය') : tr('Cash', 'මුදල්');
        if (key === 'bill_status') return value === 'printed' ? tr('Printed', 'මුද්‍රිත') : tr('Not printed', 'මුද්‍රණය නොකළ');
        if (key === 'item_code') return findOption(itemOptions, value)?.label || value;
        return value;
    };
    const activeChips = chipDefs.filter(([k]) => applied[k]);

    // ---- export / print ---------------------------------------------------
    const fileStamp = isHistory ? `${applied.start_date || 'start'}_to_${applied.end_date || 'end'}` : `live_${ymd(new Date())}`;

    const handleExcel = () => {
        const wb = XLSX.utils.book_new();
        const s = summary;
        const summarySheet = [
            [SHOP_NAME], [tr('Sales Report', 'විකුණුම් වාර්තාව')],
            [tr('Period', 'කාලය'), periodLabel],
            [tr('Source', 'දත්ත මූලාශ්‍රය'), isHistory ? 'sales_histories' : 'sales'],
            ...activeChips.map(([k, label]) => [label, valueLabel(k, applied[k])]),
            ...(search.trim() ? [[tr('Quick search', 'ඉක්මන් සෙවීම'), search.trim()]] : []),
            [],
            [tr('Grand Total', 'මුළු එකතුව'), +num(s.grand_total).toFixed(2)],
            [tr('Items value', 'භාණ්ඩ වටිනාකම'), +num(s.items_value).toFixed(2)],
            [tr('Bag cost', 'මලු වියදම'), +num(s.bag_cost).toFixed(2)],
            [tr('Kuliya', 'කුලිය'), +num(s.kuliya).toFixed(2)],
            [tr('Weight (kg)', 'බර (kg)'), +num(s.total_weight).toFixed(3)],
            [tr('Bags', 'මලු'), num(s.total_packs)],
            [tr('Bills', 'බිල්පත්'), num(s.bill_count)],
            [tr('Customers', 'පාරිභෝගිකයින්'), num(s.customer_count)],
            [tr('Records', 'වාර්තා'), num(s.record_count)],
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summarySheet), 'Summary');

        const recordSheet = [[
            'Date', 'Customer', 'Customer Name', 'Bill No', 'Item Code', 'Item', 'Supplier', 'Bags',
            'Weight (kg)', 'Price / kg', 'Items Value', 'Bag Price', 'Bag Cost', 'Kuliya', 'Line Total', 'Payment', 'Printed',
        ]];
        sortedRecords.forEach((r) => recordSheet.push([
            r.Date, r.customer, r.customer_name || '', r.bill, r.item_code, r.item_name, r.supplier_code, r.packs,
            r.weight, r.price, +r.value.toFixed(2), r.bagPrice, +r.bagCost.toFixed(2), r.kuliya, +r.lineTotal.toFixed(2),
            r.credit_transaction === 'Y' ? 'Credit' : 'Cash', r.bill_printed === 'Y' ? 'Yes' : 'No',
        ]));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(recordSheet), 'Records');

        const itemSheet = [['Item Code', 'Item', 'Customers', 'Bags', 'Weight (kg)', 'Avg Price / kg', 'Items Value', 'Bag Cost', 'Kuliya', 'Total', 'Share %']];
        byItem.forEach((it) => itemSheet.push([
            it.code, it.name, it.customers, it.packs, +it.weight.toFixed(3), it.weight ? +(it.value / it.weight).toFixed(2) : 0,
            +it.value.toFixed(2), +it.bagCost.toFixed(2), +it.kuliya.toFixed(2), +it.total.toFixed(2),
            summary.grand_total ? +((it.total / summary.grand_total) * 100).toFixed(2) : 0,
        ]));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(itemSheet), 'By Item');

        const custSheet = [['Customer', 'Customer Name', 'Bills', 'Weight (kg)', 'Total']];
        byCustomer.forEach((c) => custSheet.push([c.customer, c.name || '', c.bills.length, +c.weight.toFixed(3), +c.total.toFixed(2)]));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(custSheet), 'By Customer');

        const dateSheet = [['Date', 'Bills', 'Customers', 'Bags', 'Weight (kg)', 'Total']];
        byDate.forEach((d) => dateSheet.push([d.date, d.bills, d.customers, d.packs, +d.weight.toFixed(3), +d.total.toFixed(2)]));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dateSheet), 'By Date');

        XLSX.writeFile(wb, `Sales_Report_${fileStamp}.xlsx`);
    };

    const handlePrint = () => {
        const s = summary;
        const th = (t, right) => `<th style="text-align:${right ? 'right' : 'left'}">${esc(t)}</th>`;
        const td = (t, right) => `<td style="text-align:${right ? 'right' : 'left'}">${esc(t)}</td>`;
        let body = '';

        if (view === 'item') {
            body = `<table><thead><tr>${th(tr('Item', 'අයිතමය'))}${th(tr('Bags', 'මලු'), 1)}${th(tr('Weight (kg)', 'බර (kg)'), 1)}${th(tr('Avg Price', 'සාමාන්‍ය මිල'), 1)}${th(tr('Total', 'එකතුව'), 1)}${th('%', 1)}</tr></thead><tbody>
                ${byItem.map((it) => `<tr>${td(`${it.code} ${it.name || ''}`)}${td(it.packs, 1)}${td(kg(it.weight), 1)}${td(money(it.weight ? it.value / it.weight : 0), 1)}${td(money(it.total), 1)}${td(s.grand_total ? ((it.total / s.grand_total) * 100).toFixed(1) : '0.0', 1)}</tr>`).join('')}
            </tbody></table>`;
        } else if (view === 'date') {
            body = `<table><thead><tr>${th(tr('Date', 'දිනය'))}${th(tr('Bills', 'බිල්පත්'), 1)}${th(tr('Customers', 'පාරිභෝගිකයින්'), 1)}${th(tr('Weight (kg)', 'බර (kg)'), 1)}${th(tr('Total', 'එකතුව'), 1)}</tr></thead><tbody>
                ${byDate.map((d) => `<tr>${td(d.date)}${td(d.bills, 1)}${td(d.customers, 1)}${td(kg(d.weight), 1)}${td(money(d.total), 1)}</tr>`).join('')}
            </tbody></table>`;
        } else if (view === 'records') {
            body = `<table><thead><tr>${th(tr('Date', 'දිනය'))}${th(tr('Bill', 'බිල'))}${th(tr('Customer', 'පාරිභෝගිකයා'))}${th(tr('Item', 'අයිතමය'))}${th(tr('Bags', 'මලු'), 1)}${th(tr('Weight', 'බර'), 1)}${th(tr('Price', 'මිල'), 1)}${th(tr('Bag Cost', 'මලු වියදම'), 1)}${th(tr('Kuliya', 'කුලිය'), 1)}${th(tr('Total', 'එකතුව'), 1)}</tr></thead><tbody>
                ${sortedRecords.map((r) => `<tr>${td(r.Date)}${td(r.bill)}${td(r.customer)}${td(r.item_name)}${td(r.packs, 1)}${td(kg(r.weight), 1)}${td(money(r.price), 1)}${td(money(r.bagCost), 1)}${td(money(r.kuliya), 1)}${td(money(r.lineTotal), 1)}</tr>`).join('')}
            </tbody></table>`;
        } else {
            body = byCustomer.map((c) => `
                <h3>${esc(c.customer)}${c.name ? ` — ${esc(c.name)}` : ''} <span style="float:right">${money(c.total)}</span></h3>
                ${c.bills.map((b) => `
                    <div class="bill">${tr('Bill', 'බිල')} ${esc(b.bill)} · ${esc(b.date || '')}${b.credit ? ` · ${tr('Credit', 'ණය')}` : ''}</div>
                    <table><thead><tr>${th(tr('Item', 'අයිතමය'))}${th(tr('Bags', 'මලු'), 1)}${th(tr('Weight', 'බර'), 1)}${th(tr('Price', 'මිල'), 1)}${th(tr('Bag Cost', 'මලු වියදම'), 1)}${th(tr('Kuliya', 'කුලිය'), 1)}${th(tr('Total', 'එකතුව'), 1)}</tr></thead><tbody>
                        ${b.rows.map((r) => `<tr>${td(r.item_name)}${td(r.packs, 1)}${td(kg(r.weight), 1)}${td(money(r.price), 1)}${td(money(r.bagCost), 1)}${td(money(r.kuliya), 1)}${td(money(r.lineTotal), 1)}</tr>`).join('')}
                        <tr class="sub"><td colspan="6" style="text-align:right">${tr('Bill total', 'බිල් එකතුව')}</td>${td(money(b.total), 1)}</tr>
                    </tbody></table>`).join('')}`).join('');
        }

        const filtersHtml = activeChips.map(([k, label]) => `<span class="chip">${esc(label)}: ${esc(valueLabel(k, applied[k]))}</span>`).join('')
            + (search.trim() ? `<span class="chip">${tr('Search', 'සෙවීම')}: ${esc(search.trim())}</span>` : '');

        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${tr('Sales Report', 'විකුණුම් වාර්තාව')}</title>
            <style>
                body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:16px}
                h1{margin:0;text-align:center;font-size:20px} h2{margin:2px 0 8px;text-align:center;font-size:15px;color:#2e7d32}
                h3{font-size:13px;margin:16px 0 4px;padding:4px 6px;background:#eef2f7;border-left:4px solid #2e7d32}
                .meta{text-align:center;color:#555;margin-bottom:8px} .chip{display:inline-block;border:1px solid #999;border-radius:10px;padding:1px 8px;margin:2px;font-size:11px}
                .cards{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0} .card{border:1px solid #ccc;border-radius:6px;padding:5px 10px;min-width:110px}
                .card b{display:block;font-size:14px} table{width:100%;border-collapse:collapse;margin-bottom:6px}
                th,td{border-bottom:1px solid #ddd;padding:3px 5px} th{background:#2e7d32;color:#fff}
                .sub td{font-weight:bold;background:#f5f5f5} .bill{font-weight:bold;margin:6px 0 2px}
                .grand{text-align:right;font-size:16px;font-weight:bold;border-top:3px double #333;padding-top:6px;margin-top:12px}
                @page{size:A4;margin:10mm}
            </style></head><body>
            <h1>${esc(SHOP_NAME)}</h1><h2>${tr('Sales Report', 'විකුණුම් වාර්තාව')}</h2>
            <div class="meta">${esc(periodLabel)} · ${tr('Printed', 'මුද්‍රණය කළේ')} ${esc(new Date().toLocaleString())}</div>
            <div style="text-align:center">${filtersHtml}</div>
            <div class="cards">
                <div class="card">${tr('Grand Total', 'මුළු එකතුව')}<b>${money(s.grand_total)}</b></div>
                <div class="card">${tr('Items value', 'භාණ්ඩ වටිනාකම')}<b>${money(s.items_value)}</b></div>
                <div class="card">${tr('Bag cost', 'මලු වියදම')}<b>${money(s.bag_cost)}</b></div>
                <div class="card">${tr('Kuliya', 'කුලිය')}<b>${money(s.kuliya)}</b></div>
                <div class="card">${tr('Weight (kg)', 'බර (kg)')}<b>${kg(s.total_weight)}</b></div>
                <div class="card">${tr('Bills', 'බිල්පත්')}<b>${num(s.bill_count)}</b></div>
                <div class="card">${tr('Customers', 'පාරිභෝගිකයින්')}<b>${num(s.customer_count)}</b></div>
            </div>
            ${body}
            <div class="grand">${tr('Grand Total', 'මුළු එකතුව')}: ${money(s.grand_total)}</div>
            </body></html>`;

        const win = window.open('', '_blank');
        if (!win) {
            alert(tr('Please allow pop-ups for this site to print the report.', 'වාර්තාව මුද්‍රණය කිරීමට pop-ups සඳහා අවසර දෙන්න.'));
            return;
        }
        win.document.write(html);
        win.document.close();
        win.onload = () => { win.focus(); win.print(); };
    };

    // ---- render helpers ---------------------------------------------------
    const SortTh = ({ k, children, right }) => (
        <th role="button" onClick={() => toggleSort(k)} className={right ? 'text-end' : ''} style={{ whiteSpace: 'nowrap', userSelect: 'none' }}>
            {children} {sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : <span className="opacity-25">↕</span>}
        </th>
    );

    const Pager = ({ page, pageCount, onChange, total, pageSize }) => (pageCount > 1 ? (
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-2">
            <small className="text-muted">
                {tr('Showing', 'පෙන්වන්නේ')} {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} {tr('of', '/')} {total}
            </small>
            <div className="btn-group btn-group-sm">
                <button className="btn btn-outline-secondary" disabled={page <= 1} onClick={() => onChange(1)}>«</button>
                <button className="btn btn-outline-secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</button>
                <span className="btn btn-outline-secondary disabled">{page} / {pageCount}</span>
                <button className="btn btn-outline-secondary" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>›</button>
                <button className="btn btn-outline-secondary" disabled={page >= pageCount} onClick={() => onChange(pageCount)}>»</button>
            </div>
        </div>
    ) : null);

    const cards = [
        { label: tr('Grand Total', 'මුළු එකතුව'), value: money(summary.grand_total), accent: '#2e7d32', big: true },
        { label: tr('Items value', 'භාණ්ඩ වටිනාකම'), value: money(summary.items_value), accent: '#1565c0' },
        { label: tr('Bag cost', 'මලු වියදම'), value: money(summary.bag_cost), accent: '#6a1b9a' },
        { label: tr('Kuliya', 'කුලිය'), value: money(summary.kuliya), accent: '#c62828' },
        { label: tr('Weight (kg)', 'බර (kg)'), value: kg(summary.total_weight), accent: '#00838f' },
        { label: tr('Bags', 'මලු'), value: num(summary.total_packs).toLocaleString(), accent: '#5d4037' },
        { label: tr('Bills', 'බිල්පත්'), value: num(summary.bill_count).toLocaleString(), accent: '#ef6c00' },
        { label: tr('Customers', 'පාරිභෝගිකයින්'), value: num(summary.customer_count).toLocaleString(), accent: '#455a64' },
    ];

    const tabs = [
        ['customer', tr('By Customer', 'පාරිභෝගිකයා අනුව')],
        ['records', tr('All Records', 'සියලු වාර්තා')],
        ['item', tr('By Item', 'අයිතමය අනුව')],
        ['date', tr('By Date', 'දිනය අනුව')],
    ];

    const noData = !loading && !error && visibleRows.length === 0;

    // ---- render -----------------------------------------------------------
    return (
        <div className="d-flex flex-column sales-report" style={{ height: '100%' }}>
            {/* Table headers: white text on dark green. A global rule (FinancialReport.css)
                already paints `.table thead th` dark green without setting a text colour. */}
            <style>{`
                .sales-report .table thead th,
                .sales-report .table thead th * {
                    --bs-table-color: #ffffff;
                    --bs-table-bg: #1b5e20;
                    background-color: #1b5e20 !important;
                    color: #ffffff !important;
                    border-color: #2e7d32 !important;
                }
            `}</style>
            {/* Header */}
            <div className="d-flex align-items-center flex-wrap gap-2 px-3 py-2 text-white" style={{ background: 'linear-gradient(135deg,#1b5e20,#2e7d32)', position: 'sticky', top: 0, zIndex: 5 }}>
                <div className="me-auto">
                    <div className="fw-bold" style={{ fontSize: 18 }}>📊 {tr('Sales Report', 'විකුණුම් වාර්තාව')}</div>
                    <small className="opacity-75">
                        {periodLabel} · {isHistory ? tr('Source: sales history', 'මූලාශ්‍රය: විකුණුම් ඉතිහාසය') : tr('Source: today\'s sales', 'මූලාශ්‍රය: අද විකුණුම්')}
                        {generatedAt && ` · ${tr('Updated', 'යාවත්කාලීන')} ${generatedAt.toLocaleTimeString()}`}
                    </small>
                </div>
                <button className="btn btn-light btn-sm fw-bold" onClick={() => loadReport(applied)} disabled={loading}>⟳ {tr('Refresh', 'නැවුම් කරන්න')}</button>
                <button className="btn btn-info btn-sm fw-bold text-white" onClick={handleExcel} disabled={loading || visibleRows.length === 0}>📗 Excel</button>
                <button className="btn btn-warning btn-sm fw-bold" onClick={handlePrint} disabled={loading || visibleRows.length === 0}>🖨️ {tr('Print', 'මුද්‍රණය')}</button>
                <button className="btn btn-danger btn-sm fw-bold" onClick={onClose}>✕ {tr('Close', 'වසන්න')}</button>
            </div>

            <div className="flex-grow-1 overflow-auto p-3">
                {/* Filters */}
                <div className="card shadow-sm mb-3">
                    <div className="card-body pb-2">
                        <div className="d-flex flex-wrap gap-2 mb-3">
                            {quickRanges().map((r) => {
                                const active = applied.start_date === r.start && applied.end_date === r.end;
                                return (
                                    <button key={r.key} type="button" disabled={loading}
                                        className={`btn btn-sm ${active ? 'btn-success' : 'btn-outline-success'}`}
                                        onClick={() => applyFilters({ ...draft, start_date: r.start, end_date: r.end })}>
                                        {r.label}
                                    </button>
                                );
                            })}
                        </div>

                        <form onSubmit={(e) => { e.preventDefault(); applyFilters(); }}>
                            <div className="row g-2">
                                <div className="col-6 col-md-3 col-xl-2">
                                    <label className="form-label small fw-bold mb-1">{tr('From', 'සිට')}</label>
                                    <input type="date" className="form-control" value={draft.start_date} max={draft.end_date || undefined}
                                        onChange={(e) => setField('start_date', e.target.value)} />
                                </div>
                                <div className="col-6 col-md-3 col-xl-2">
                                    <label className="form-label small fw-bold mb-1">{tr('To', 'දක්වා')}</label>
                                    <input type="date" className="form-control" value={draft.end_date} min={draft.start_date || undefined}
                                        onChange={(e) => setField('end_date', e.target.value)} />
                                </div>
                                <div className="col-12 col-md-6 col-xl-3">
                                    <label className="form-label small fw-bold mb-1">{tr('Customer', 'පාරිභෝගිකයා')}</label>
                                    <Select isClearable isSearchable options={customerOptions}
                                        value={findOption(customerOptions, draft.customer_code)}
                                        onChange={(o) => setField('customer_code', o?.value || '')}
                                        placeholder={tr('All customers — type to search', 'සියලු පාරිභෝගිකයින් — සෙවීමට ටයිප් කරන්න')}
                                        menuPortalTarget={document.body} styles={selectStyles} />
                                </div>
                                <div className="col-12 col-md-6 col-xl-3">
                                    <label className="form-label small fw-bold mb-1">{tr('Item', 'අයිතමය')}</label>
                                    <Select isClearable isSearchable options={itemOptions}
                                        value={findOption(itemOptions, draft.item_code)}
                                        onChange={(o) => setField('item_code', o?.value || '')}
                                        placeholder={tr('All items — type to search', 'සියලු අයිතම — සෙවීමට ටයිප් කරන්න')}
                                        menuPortalTarget={document.body} styles={selectStyles} />
                                </div>
                                <div className="col-12 col-md-6 col-xl-2">
                                    <label className="form-label small fw-bold mb-1">{tr('Supplier', 'සැපයුම්කරු')}</label>
                                    <Select isClearable isSearchable options={supplierOptions}
                                        value={findOption(supplierOptions, draft.supplier_code)}
                                        onChange={(o) => setField('supplier_code', o?.value || '')}
                                        placeholder={tr('All suppliers', 'සියලු සැපයුම්කරුවන්')}
                                        menuPortalTarget={document.body} styles={selectStyles} />
                                </div>
                                <div className="col-6 col-md-3 col-xl-2">
                                    <label className="form-label small fw-bold mb-1">{tr('Bill No', 'බිල් අංකය')}</label>
                                    <input type="text" className="form-control" value={draft.bill_no} placeholder={tr('Any', 'ඕනෑම')}
                                        onChange={(e) => setField('bill_no', e.target.value.trim())} />
                                </div>
                                <div className="col-6 col-md-3 col-xl-2">
                                    <label className="form-label small fw-bold mb-1">{tr('Payment', 'ගෙවීම')}</label>
                                    <select className="form-select" value={draft.transaction_type} onChange={(e) => setField('transaction_type', e.target.value)}>
                                        <option value="">{tr('All', 'සියල්ල')}</option>
                                        <option value="cash">{tr('Cash', 'මුදල්')}</option>
                                        <option value="credit">{tr('Credit', 'ණය')}</option>
                                    </select>
                                </div>
                                <div className="col-6 col-md-3 col-xl-2">
                                    <label className="form-label small fw-bold mb-1">{tr('Bill status', 'බිල් තත්ත්වය')}</label>
                                    <select className="form-select" value={draft.bill_status} onChange={(e) => setField('bill_status', e.target.value)}>
                                        <option value="">{tr('All', 'සියල්ල')}</option>
                                        <option value="printed">{tr('Printed', 'මුද්‍රිත')}</option>
                                        <option value="not_printed">{tr('Not printed', 'මුද්‍රණය නොකළ')}</option>
                                    </select>
                                </div>
                                <div className="col-6 col-md-3 col-xl-4 d-flex align-items-end gap-2">
                                    <button type="submit" className={`btn fw-bold flex-grow-1 ${draftChanged ? 'btn-success' : 'btn-outline-success'}`} disabled={loading}>
                                        {loading ? <span className="spinner-border spinner-border-sm me-1" /> : '🔍 '}
                                        {tr('Apply filters', 'පෙරහන් යොදන්න')}{draftChanged && ' •'}
                                    </button>
                                    <button type="button" className="btn btn-outline-secondary" disabled={loading}
                                        onClick={() => { setSearch(''); applyFilters(EMPTY_FILTERS); }}>
                                        {tr('Reset', 'යළි සකසන්න')}
                                    </button>
                                </div>
                            </div>
                        </form>

                        {filterError && <div className="alert alert-warning py-1 px-2 mt-2 mb-0 small">{filterError}</div>}
                        <div className="small text-muted mt-2">
                            ℹ️ {tr(
                                "Choosing any date searches the sales history (records moved there at day end). Leave both dates empty to see today's live sales.",
                                'ඕනෑම දිනයක් තෝරාගත් විට විකුණුම් ඉතිහාසය (දින අවසානයේ ගෙන ගිය වාර්තා) සොයයි. අද සජීවී විකුණුම් බැලීමට දින දෙකම හිස්ව තබන්න.'
                            )}
                        </div>

                        {activeChips.length > 0 && (
                            <div className="d-flex flex-wrap gap-2 mt-2">
                                {activeChips.map(([k, label]) => (
                                    <span key={k} className="badge rounded-pill text-bg-light border d-inline-flex align-items-center gap-1" style={{ fontSize: 12 }}>
                                        {label}: <strong>{valueLabel(k, applied[k])}</strong>
                                        <button type="button" className="btn-close" style={{ fontSize: 8 }} aria-label="Remove filter" disabled={loading}
                                            onClick={() => applyFilters({ ...applied, [k]: '' })} />
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Summary cards */}
                <div className="row g-2 mb-3">
                    {cards.map((c) => (
                        <div key={c.label} className={c.big ? 'col-12 col-md-4 col-xl-3' : 'col-6 col-md-4 col-xl'}>
                            <div className="card shadow-sm h-100" style={{ borderLeft: `4px solid ${c.accent}` }}>
                                <div className="card-body py-2 px-3">
                                    <div className="small text-muted text-uppercase fw-bold" style={{ fontSize: 11 }}>{c.label}</div>
                                    <div className="fw-bold" style={{ fontSize: c.big ? 24 : 17, color: c.accent }}>{c.value}</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {meta.truncated && !search.trim() && (
                    <div className="alert alert-warning py-2 small">
                        ⚠️ {tr(
                            `Only the first ${meta.max_rows.toLocaleString()} of ${num(serverSummary?.record_count).toLocaleString()} records are listed. The totals above include every record. Narrow the filters to list them all.`,
                            `වාර්තා ${num(serverSummary?.record_count).toLocaleString()} න් පළමු ${meta.max_rows.toLocaleString()} පමණක් පෙන්වයි. ඉහත එකතු සියලු වාර්තා ඇතුළත් කරයි. සියල්ල බැලීමට පෙරහන් අඩු කරන්න.`
                        )}
                    </div>
                )}
                {error && (
                    <div className="alert alert-danger d-flex align-items-center justify-content-between py-2">
                        <span>❌ {error}</span>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => loadReport(applied)}>{tr('Try again', 'නැවත උත්සාහ කරන්න')}</button>
                    </div>
                )}

                {/* Views */}
                <div className="card shadow-sm">
                    <div className="card-header bg-white d-flex flex-wrap align-items-center gap-2">
                        <ul className="nav nav-pills me-auto">
                            {tabs.map(([key, label]) => (
                                <li className="nav-item" key={key}>
                                    <button className={`nav-link py-1 ${view === key ? 'active bg-success' : 'text-success'}`} onClick={() => setView(key)}>{label}</button>
                                </li>
                            ))}
                        </ul>
                        <input type="search" className="form-control form-control-sm" style={{ maxWidth: 280 }} value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={tr('🔎 Quick search: customer, item, bill…', '🔎 ඉක්මන් සෙවීම: පාරිභෝගිකයා, අයිතමය, බිල…')} />
                        {view === 'customer' && byCustomer.length > 0 && (
                            <div className="btn-group btn-group-sm">
                                <button className="btn btn-outline-secondary" onClick={() => setCollapsed(new Set())}>{tr('Expand all', 'සියල්ල විවෘත')}</button>
                                <button className="btn btn-outline-secondary" onClick={() => setCollapsed(new Set(byCustomer.map((c) => c.customer)))}>{tr('Collapse all', 'සියල්ල වසන්න')}</button>
                            </div>
                        )}
                    </div>

                    <div className="card-body">
                        {loading && rows.length === 0 && (
                            <div className="text-center py-5 text-muted"><div className="spinner-border text-success mb-2" /><div>{tr('Loading…', 'පූරණය වෙමින්…')}</div></div>
                        )}
                        {noData && (
                            <div className="text-center py-5 text-muted">
                                <div style={{ fontSize: 40 }}>🗂️</div>
                                <div className="fw-bold">{tr('No sales found for these filters.', 'මෙම පෙරහන් සඳහා විකුණුම් හමු නොවීය.')}</div>
                                <div className="small">{tr('Try a wider date range or remove some filters.', 'පුළුල් දින පරාසයක් උත්සාහ කරන්න හෝ පෙරහන් ඉවත් කරන්න.')}</div>
                            </div>
                        )}

                        <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity .15s' }}>
                            {/* By customer */}
                            {view === 'customer' && byCustomer.length > 0 && (
                                <>
                                    {byCustomer.slice((customersPage - 1) * CUSTOMERS_PAGE_SIZE, customersPage * CUSTOMERS_PAGE_SIZE).map((c) => {
                                        const open = !collapsed.has(c.customer);
                                        return (
                                            <div key={c.customer} className="border rounded mb-3 overflow-hidden">
                                                <div role="button" onClick={() => toggleCustomer(c.customer)}
                                                    className="d-flex flex-wrap align-items-center gap-2 px-3 py-2" style={{ background: '#eef5ee' }}>
                                                    <span className="text-muted">{open ? '▾' : '▸'}</span>
                                                    <span className="fw-bold" style={{ fontSize: 16 }}>{c.customer}</span>
                                                    {c.name && <span className="text-muted">{c.name}</span>}
                                                    <span className="badge text-bg-secondary">{c.bills.length} {tr('bill(s)', 'බිල්පත්')}</span>
                                                    <span className="badge text-bg-light border">{kg(c.weight)} kg</span>
                                                    <span className="ms-auto fw-bold text-success" style={{ fontSize: 16 }}>{money(c.total)}</span>
                                                </div>
                                                {open && c.bills.map((b) => (
                                                    <div key={b.key} className="px-3 pt-2">
                                                        <div className="d-flex flex-wrap gap-2 align-items-center small fw-bold mb-1">
                                                            <span>🧾 {tr('Bill', 'බිල')} {b.bill}</span>
                                                            {b.date && <span className="text-muted fw-normal">{b.date}</span>}
                                                            {b.credit && <span className="badge text-bg-warning">{tr('Credit', 'ණය')}</span>}
                                                        </div>
                                                        <div className="table-responsive">
                                                            <table className="table table-sm table-hover align-middle mb-2">
                                                                <thead className="table-light">
                                                                    <tr>
                                                                        <th>{tr('Item', 'අයිතමය')}</th>
                                                                        <th>{tr('Supplier', 'සැපයුම්කරු')}</th>
                                                                        <th className="text-end">{tr('Bags', 'මලු')}</th>
                                                                        <th className="text-end">{tr('Weight (kg)', 'බර (kg)')}</th>
                                                                        <th className="text-end">{tr('Price', 'මිල')}</th>
                                                                        <th className="text-end">{tr('Bag Cost', 'මලු වියදම')}</th>
                                                                        <th className="text-end">{tr('Kuliya', 'කුලිය')}</th>
                                                                        <th className="text-end">{tr('Total', 'එකතුව')}</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {b.rows.map((r) => (
                                                                        <tr key={r.id}>
                                                                            <td>{r.item_name} <small className="text-muted">{r.item_code}</small></td>
                                                                            <td>{r.supplier_code}</td>
                                                                            <td className="text-end">{r.packs}</td>
                                                                            <td className="text-end">{kg(r.weight)}</td>
                                                                            <td className="text-end">{money(r.price)}</td>
                                                                            <td className="text-end">{money(r.bagCost)}</td>
                                                                            <td className="text-end text-danger">{money(r.kuliya)}</td>
                                                                            <td className="text-end fw-bold">{money(r.lineTotal)}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                                <tfoot>
                                                                    <tr className="table-light">
                                                                        <td colSpan={7} className="text-end fw-bold">{tr('Bill total', 'බිල් එකතුව')}</td>
                                                                        <td className="text-end fw-bold text-success">{money(b.total)}</td>
                                                                    </tr>
                                                                </tfoot>
                                                            </table>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })}
                                    <Pager page={customersPage} pageCount={customersPageCount} onChange={setCustomersPage} total={byCustomer.length} pageSize={CUSTOMERS_PAGE_SIZE} />
                                </>
                            )}

                            {/* All records */}
                            {view === 'records' && sortedRecords.length > 0 && (
                                <>
                                    <div className="table-responsive" style={{ maxHeight: '60vh' }}>
                                        <table className="table table-sm table-striped table-hover align-middle mb-0">
                                            <thead className="table-success" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                                                <tr>
                                                    <SortTh k="Date">{tr('Date', 'දිනය')}</SortTh>
                                                    <SortTh k="bill">{tr('Bill', 'බිල')}</SortTh>
                                                    <SortTh k="customer">{tr('Customer', 'පාරිභෝගිකයා')}</SortTh>
                                                    <SortTh k="item_name">{tr('Item', 'අයිතමය')}</SortTh>
                                                    <SortTh k="supplier_code">{tr('Supplier', 'සැපයුම්කරු')}</SortTh>
                                                    <SortTh k="packs" right>{tr('Bags', 'මලු')}</SortTh>
                                                    <SortTh k="weight" right>{tr('Weight', 'බර')}</SortTh>
                                                    <SortTh k="price" right>{tr('Price', 'මිල')}</SortTh>
                                                    <SortTh k="bagCost" right>{tr('Bag Cost', 'මලු වියදම')}</SortTh>
                                                    <SortTh k="kuliya" right>{tr('Kuliya', 'කුලිය')}</SortTh>
                                                    <SortTh k="lineTotal" right>{tr('Total', 'එකතුව')}</SortTh>
                                                    <th>{tr('Payment', 'ගෙවීම')}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sortedRecords.slice((recordsPage - 1) * RECORDS_PAGE_SIZE, recordsPage * RECORDS_PAGE_SIZE).map((r) => (
                                                    <tr key={r.id}>
                                                        <td style={{ whiteSpace: 'nowrap' }}>{r.Date}</td>
                                                        <td>{r.bill}</td>
                                                        <td className="fw-bold">{r.customer}</td>
                                                        <td>{r.item_name} <small className="text-muted">{r.item_code}</small></td>
                                                        <td>{r.supplier_code}</td>
                                                        <td className="text-end">{r.packs}</td>
                                                        <td className="text-end">{kg(r.weight)}</td>
                                                        <td className="text-end">{money(r.price)}</td>
                                                        <td className="text-end">{money(r.bagCost)}</td>
                                                        <td className="text-end text-danger">{money(r.kuliya)}</td>
                                                        <td className="text-end fw-bold">{money(r.lineTotal)}</td>
                                                        <td>{r.credit_transaction === 'Y'
                                                            ? <span className="badge text-bg-warning">{tr('Credit', 'ණය')}</span>
                                                            : <span className="badge text-bg-light border">{tr('Cash', 'මුදල්')}</span>}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot className="table-light fw-bold">
                                                <tr>
                                                    <td colSpan={5} className="text-end">{tr('Total', 'එකතුව')} ({sortedRecords.length})</td>
                                                    <td className="text-end">{num(summary.total_packs)}</td>
                                                    <td className="text-end">{kg(summary.total_weight)}</td>
                                                    <td />
                                                    <td className="text-end">{money(summary.bag_cost)}</td>
                                                    <td className="text-end">{money(summary.kuliya)}</td>
                                                    <td className="text-end text-success">{money(summary.grand_total)}</td>
                                                    <td />
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                    <Pager page={recordsPage} pageCount={recordsPageCount} onChange={setRecordsPage} total={sortedRecords.length} pageSize={RECORDS_PAGE_SIZE} />
                                </>
                            )}

                            {/* By item */}
                            {view === 'item' && byItem.length > 0 && (
                                <div className="table-responsive">
                                    <table className="table table-sm table-hover align-middle">
                                        <thead className="table-success">
                                            <tr>
                                                <th>{tr('Item', 'අයිතමය')}</th>
                                                <th className="text-end">{tr('Customers', 'පාරිභෝගිකයින්')}</th>
                                                <th className="text-end">{tr('Bags', 'මලු')}</th>
                                                <th className="text-end">{tr('Weight (kg)', 'බර (kg)')}</th>
                                                <th className="text-end">{tr('Avg Price / kg', 'සාමාන්‍ය මිල / kg')}</th>
                                                <th className="text-end">{tr('Items value', 'භාණ්ඩ වටිනාකම')}</th>
                                                <th className="text-end">{tr('Bag Cost', 'මලු වියදම')}</th>
                                                <th className="text-end">{tr('Kuliya', 'කුලිය')}</th>
                                                <th className="text-end">{tr('Total', 'එකතුව')}</th>
                                                <th style={{ width: 160 }}>{tr('Share', 'කොටස')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {byItem.map((it) => {
                                                const share = summary.grand_total ? (it.total / summary.grand_total) * 100 : 0;
                                                return (
                                                    <tr key={it.code || it.name}>
                                                        <td><span className="fw-bold">{it.name}</span> <small className="text-muted">{it.code}</small></td>
                                                        <td className="text-end">{it.customers}</td>
                                                        <td className="text-end">{it.packs}</td>
                                                        <td className="text-end">{kg(it.weight)}</td>
                                                        <td className="text-end">{money(it.weight ? it.value / it.weight : 0)}</td>
                                                        <td className="text-end">{money(it.value)}</td>
                                                        <td className="text-end">{money(it.bagCost)}</td>
                                                        <td className="text-end text-danger">{money(it.kuliya)}</td>
                                                        <td className="text-end fw-bold">{money(it.total)}</td>
                                                        <td>
                                                            <div className="d-flex align-items-center gap-2">
                                                                <div className="progress flex-grow-1" style={{ height: 8 }}>
                                                                    <div className="progress-bar bg-success" style={{ width: `${Math.min(100, share)}%` }} />
                                                                </div>
                                                                <small style={{ width: 42 }} className="text-end">{share.toFixed(1)}%</small>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* By date */}
                            {view === 'date' && byDate.length > 0 && (
                                <div className="table-responsive">
                                    <table className="table table-sm table-hover align-middle">
                                        <thead className="table-success">
                                            <tr>
                                                <th>{tr('Date', 'දිනය')}</th>
                                                <th className="text-end">{tr('Bills', 'බිල්පත්')}</th>
                                                <th className="text-end">{tr('Customers', 'පාරිභෝගිකයින්')}</th>
                                                <th className="text-end">{tr('Bags', 'මලු')}</th>
                                                <th className="text-end">{tr('Weight (kg)', 'බර (kg)')}</th>
                                                <th className="text-end">{tr('Total', 'එකතුව')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {byDate.map((d) => (
                                                <tr key={d.date}>
                                                    <td className="fw-bold">{d.date}</td>
                                                    <td className="text-end">{d.bills}</td>
                                                    <td className="text-end">{d.customers}</td>
                                                    <td className="text-end">{d.packs}</td>
                                                    <td className="text-end">{kg(d.weight)}</td>
                                                    <td className="text-end fw-bold">{money(d.total)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SalesReportView;
