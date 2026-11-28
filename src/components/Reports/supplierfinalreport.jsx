import React, { useState, useEffect, useMemo } from 'react';
import api from '../../api';
import Sidebar from '../Sidebar';
import { tr } from '../../i18n/language';
import { printHtml } from '../../utils/printHtml';
import SupplierLineEditModal from '../Suppliers/SupplierLineEditModal';
import { buildSupplierA4Bill, buildSupplierThermalBill, joinSupplierBills } from '../../utils/supplierBillPrint';

const SupplierReport = () => {

    // Report Data
    const [reportData, setReportData] = useState({ billed: {}, nonBilled: {} });
    const [loading, setLoading] = useState(false);

    // Date Filters
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Record being edited (supplier weight / price)
    const [editingRecord, setEditingRecord] = useState(null);
    const [editingSiblings, setEditingSiblings] = useState([]);

    // Search Filter
    const [searchSupplierBillNo, setSearchSupplierBillNo] = useState('');
    const [searchSupplierCode, setSearchSupplierCode] = useState('');

    // Fetch Report. With a date range the records come from sales_histories only (not today's
    // sales); with no dates they come from today's sales. One date alone = that single day.
    const fetchReport = async (from = startDate, to = endDate) => {
        try {
            setLoading(true);
            const start = from || to;
            const end = to || from;

            const response = await api.get('/supplier-report', {
                params: start ? { start_date: start, end_date: end } : {}
            });

            setReportData(response.data);
        } catch (error) {
            console.error("Error fetching report:", error);
        } finally {
            setLoading(false);
        }
    };

    // Report rows that match the Supplier Code and Supplier Bill No boxes (both optional).
    // Supplier code: rows whose supplier_code starts with what was typed (case ignored).
    const filteredReportData = useMemo(() => {
        const code = searchSupplierCode.trim().toLowerCase();
        const billNo = searchSupplierBillNo.trim().toLowerCase();
        if (!code && !billNo) return reportData;
        const filterGroups = (groups = {}) => {
            const filtered = {};
            Object.keys(groups).forEach(key => {
                const rows = groups[key].filter(sale =>
                    (!code || String(sale.supplier_code || '').toLowerCase().startsWith(code))
                    && (!billNo || String(sale.supplier_bill_no || '').toLowerCase().includes(billNo)));
                if (rows.length > 0) filtered[key] = rows;
            });
            return filtered;
        };
        return { ...reportData, billed: filterGroups(reportData.billed), nonBilled: filterGroups(reportData.nonBilled) };
    }, [reportData, searchSupplierCode, searchSupplierBillNo]);

    // Supplier codes in the loaded report (suggestions for the Supplier Code box)
    const supplierCodes = useMemo(() => {
        const codes = new Set();
        [reportData.billed, reportData.nonBilled].forEach(groups =>
            Object.values(groups || {}).forEach(rows => rows.forEach(r => r.supplier_code && codes.add(String(r.supplier_code).toUpperCase()))));
        return [...codes].sort();
    }, [reportData]);

    // Print: only the bills shown (after the Supplier Code / Bill No / date filters), each in
    // the supplier bill format of the Supplier Bills page (A4 or thermal, as chosen there).
    // Billed records print one bill per supplier bill number; unbilled records are only
    // printed (one bill per supplier, without a number) when no billed records are shown.
    const [printing, setPrinting] = useState(false);
    // Second page with the weight of each pack (same as "Print pack sheet" on the Supplier Bills page)
    const [printPackSheet, setPrintPackSheet] = useState(() => {
        try { return localStorage.getItem('sfr_print_pack_sheet') === '1'; } catch { return false; }
    });
    const togglePackSheet = (checked) => {
        setPrintPackSheet(checked);
        try { localStorage.setItem('sfr_print_pack_sheet', checked ? '1' : '0'); } catch { /* ignore */ }
    };

    // Advance / hire of a bill: printed bills use the amounts saved with that bill number;
    // unbilled records use the supplier's current advance / hire.
    const fetchCharges = async (code, billNo) => {
        try {
            if (billNo) {
                const res = await api.get(`/suppliers/bill/${encodeURIComponent(billNo)}/charges`);
                return { advanceAmount: parseFloat(res.data?.advance_amount) || 0, hireAmount: parseFloat(res.data?.hire_amount) || 0 };
            }
            const res = await api.get(`/suppliers/search-by-code/${encodeURIComponent(code)}`);
            return { advanceAmount: parseFloat(res.data?.advance_amount) || 0, hireAmount: parseFloat(res.data?.hire_amount) || 0 };
        } catch {
            return { advanceAmount: 0, hireAmount: 0 };
        }
    };

    // Hire of each bill block on this page, by group key: printed bills show the hire saved
    // with their bill number, unbilled blocks the supplier's pending hire (taken off the
    // next printed bill). Edited from the block header.
    const groupInfo = (key, rows, type) => ({
        code: rows[0]?.supplier_code || (type === 'billed' ? key.split(' - Bill: ')[0] : key),
        billNo: type === 'billed' ? (rows[0]?.supplier_bill_no || '') : '',
    });
    const [hireByGroup, setHireByGroup] = useState({});
    const [hireEdit, setHireEdit] = useState(null); // { gk, value, saving }
    useEffect(() => {
        let cancelled = false;
        const all = [
            ...Object.entries(reportData.nonBilled || {}).map(([k, rows]) => ['nonBilled', k, rows]),
            ...Object.entries(reportData.billed || {}).map(([k, rows]) => ['billed', k, rows]),
        ];
        Promise.all(all.map(async ([type, key, rows]) => {
            const { code, billNo } = groupInfo(key, rows, type);
            const c = await fetchCharges(code, billNo);
            return [`${type}|${key}`, c.hireAmount];
        })).then((pairs) => { if (!cancelled) setHireByGroup(Object.fromEntries(pairs)); });
        return () => { cancelled = true; };
    }, [reportData]);

    const saveHire = async (type, key, rows) => {
        const amount = parseFloat(hireEdit?.value);
        if (hireEdit?.value === '' || !Number.isFinite(amount) || amount < 0) {
            alert(tr('Enter a valid amount (0 or more).', 'වලංගු මුදලක් ඇතුළත් කරන්න (0 හෝ වැඩි).'));
            return;
        }
        const { code, billNo } = groupInfo(key, rows, type);
        setHireEdit((h) => ({ ...h, saving: true }));
        try {
            if (billNo) {
                await api.put(`/suppliers/bill/${encodeURIComponent(billNo)}/hire`, { hire_amount: amount });
            } else {
                await api.post('/suppliers/hire', { code, hire_amount: amount });
            }
            // Read it back from the server, so the header shows what the bill will print
            const fresh = await fetchCharges(code, billNo);
            setHireByGroup((m) => ({ ...m, [`${type}|${key}`]: fresh.hireAmount }));
            setHireEdit(null);
        } catch (error) {
            alert(`${tr('Could not save the hire amount', 'කුලී මුදල සුරැකීමට නොහැකි විය')}: ${error.response?.data?.message || error.message}`);
            setHireEdit((h) => (h ? { ...h, saving: false } : h));
        }
    };

    const handlePrintBills = async () => {
        let groups = Object.entries(filteredReportData.billed || {}).map(([key, rows]) => ({
            code: rows[0]?.supplier_code || key.split(' - Bill: ')[0],
            billNo: rows[0]?.supplier_bill_no || '',
            rows,
        }));
        if (groups.length === 0) {
            groups = Object.entries(filteredReportData.nonBilled || {}).map(([code, rows]) => ({ code, billNo: '', rows }));
        }
        await printGroups(groups);
    };

    // Prints the given bills ({ code, billNo, rows }) with their advance / hire read fresh from
    // the server. Used by "Print Bills" and by the Print button of each block.
    const printGroups = async (groups) => {
        if (groups.length === 0) {
            alert(tr('No bills to print.', 'මුද්‍රණය කිරීමට බිල්පත් නැත.'));
            return;
        }
        let format = 'a4', billSize = '3inch';
        try {
            format = localStorage.getItem('supplier_print_format_v2') || 'a4';
            billSize = localStorage.getItem('supplier_bill_size') || '3inch';
        } catch { /* storage blocked: defaults */ }

        setPrinting(true);
        try {
            const charges = await Promise.all(groups.map(({ code, billNo }) => fetchCharges(code, billNo)));
            const docs = groups.map(({ code, billNo, rows }, i) => {
                // Older data without `weight` falls back to the supplier weight
                const records = rows.map(r => ({ ...r, weight: r.weight ?? r.SupplierWeight }));
                const options = {
                    selectedSupplier: code, currentBillNo: billNo, printDate: rows[0]?.Date || null,
                    advanceAmount: charges[i].advanceAmount, hireAmount: charges[i].hireAmount, printPackSheet,
                };
                return format === 'thermal'
                    ? buildSupplierThermalBill(records, { ...options, billSize })
                    : buildSupplierA4Bill(records, { ...options, billWidth: '105mm', topMargin: '0mm' });
            });
            await printHtml(joinSupplierBills(docs));
        } finally {
            setPrinting(false);
        }
    };

    const handleSearchChange = (e) => setSearchSupplierBillNo(e.target.value);
    const handleClearSearch = () => setSearchSupplierBillNo('');

    // Reset Function
    const handleReset = async () => {
        setStartDate('');
        setEndDate('');
        setSearchSupplierBillNo('');
        setSearchSupplierCode('');
        setLoading(true);

        try {
            const response = await api.get('/supplier-report');
            setReportData(response.data);
        } finally {
            setLoading(false);
        }
    };

    // Load on page open, and again whenever the date range changes (a range = sales history)
    useEffect(() => {
        if ((startDate && !endDate) || (!startDate && endDate)) return; // wait for both dates
        fetchReport(startDate, endDate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startDate, endDate]);

    // Calculate Grand Total
    const calculateGrandTotal = () => {
        let grandTotal = 0;
        
        // Calculate total for non-billed records
        Object.keys(filteredReportData.nonBilled).forEach(supplierCode => {
            grandTotal += filteredReportData.nonBilled[supplierCode].reduce((sum, item) => 
                sum + parseFloat(item.SupplierTotal || 0), 0
            );
        });
        
        // Calculate total for billed records
        Object.keys(filteredReportData.billed).forEach(supplierCode => {
            grandTotal += filteredReportData.billed[supplierCode].reduce((sum, item) => 
                sum + parseFloat(item.SupplierTotal || 0), 0
            );
        });
        
        return grandTotal;
    };

    // Calculate Grand Profit
    const calculateGrandProfit = () => {
        let grandProfit = 0;
        
        // Calculate profit for non-billed records
        Object.keys(filteredReportData.nonBilled).forEach(supplierCode => {
            grandProfit += filteredReportData.nonBilled[supplierCode].reduce((sum, item) => 
                sum + parseFloat(item.profit || 0), 0
            );
        });
        
        // Calculate profit for billed records
        Object.keys(filteredReportData.billed).forEach(supplierCode => {
            grandProfit += filteredReportData.billed[supplierCode].reduce((sum, item) => 
                sum + parseFloat(item.profit || 0), 0
            );
        });
        
        return grandProfit;
    };

    // Render Table Function
    const renderTableBlock = (groups, type) => {
        const groupKeys = Object.keys(groups);
        if (groupKeys.length === 0) return null;

        return groupKeys.map((key) => (
            <div key={key} className="mb-5 shadow card border-0">
                <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center py-3">
                    <h5 className="mb-0 fw-bold">
                        {tr('Supplier:', 'සැපයුම්කරු:')} {key}
                    </h5>
                    <div className="d-flex align-items-center gap-2">
                        {hireEdit?.gk === `${type}|${key}` ? (
                            <form className="d-flex align-items-center gap-1" onSubmit={(e) => { e.preventDefault(); saveHire(type, key, groups[key]); }}>
                                <span className="fw-bold">{tr('Hire', 'කුලී')}:</span>
                                <input type="number" min="0" step="0.01" autoFocus className="form-control form-control-sm" style={{ width: 110 }}
                                    value={hireEdit.value} onChange={(e) => setHireEdit({ ...hireEdit, value: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === 'Escape') setHireEdit(null); }} />
                                <button type="submit" className="btn btn-sm btn-light fw-bold" disabled={hireEdit.saving}>
                                    {hireEdit.saving ? tr('Saving...', 'සුරකිමින්...') : tr('Save', 'සුරකින්න')}
                                </button>
                                <button type="button" className="btn btn-sm btn-outline-light" onClick={() => setHireEdit(null)}>{tr('Cancel', 'අවලංගු')}</button>
                            </form>
                        ) : (
                            <>
                                <span className="badge bg-white text-dark fs-6">
                                    {tr('Hire', 'කුලී')}: {tr('Rs.', 'රු.')} {(hireByGroup[`${type}|${key}`] || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                                <button type="button" className="btn btn-sm btn-light fw-bold"
                                    title={type === 'billed'
                                        ? tr('Change the hire saved with this bill', 'මෙම බිලේ කුලී මුදල වෙනස් කරන්න')
                                        : tr("Change the supplier's hire (taken off when the bill is printed)", 'සැපයුම්කරුගේ කුලී මුදල වෙනස් කරන්න (බිල මුද්‍රණය කරන විට අඩු කෙරේ)')}
                                    onClick={() => setHireEdit({ gk: `${type}|${key}`, value: String(hireByGroup[`${type}|${key}`] || ''), saving: false })}>
                                    ✏️ {tr('Edit Hire', 'කුලී සංස්කරණය')}
                                </button>
                            </>
                        )}
                        <span className="badge bg-white text-primary">
                            {tr('Records:', 'වාර්තා ගණන:')} {groups[key].length}
                        </span>
                        <button type="button" className="btn btn-sm btn-success fw-bold border-white" disabled={printing}
                            title={tr('Print this bill', 'මෙම බිල මුද්‍රණය කරන්න')}
                            onClick={() => printGroups([{ ...groupInfo(key, groups[key], type), rows: groups[key] }])}>
                            🖨 {tr('Print', 'මුද්‍රණය')}
                        </button>
                    </div>
                </div>

                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-striped table-hover mb-0">
                            <thead style={{ backgroundColor: '#007bff', color: 'white' }}>
                                <tr>
                                    <th>{tr('Date', 'දිනය')}</th>
                                    <th>{tr('Item Code', 'අයිතම කේතය')}</th>
                                    <th>{tr('Item', 'අයිතමය')}</th>
                                    <th>{tr('Customer', 'ගනුදෙනුකරු')}</th>
                                    <th className="text-end">{tr('Weight', 'බර')}</th>
                                    <th className="text-end">{tr('Price', 'මිල')}</th>
                                    <th className="text-end">{tr('Total', 'එකතුව')}</th>
                                    <th className="text-end">{tr('Profit', 'ලාභය')}</th>
                                    <th className="text-center">{tr('Edit', 'සංස්කරණය')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {groups[key].map((sale, idx) => (
                                    <tr key={idx}>
                                        <td>{sale.Date}</td>
                                        <td>{sale.item_code}</td>
                                        <td>{sale.item_name}</td>
                                        <td>{sale.customer_code}</td>
                                        <td className="text-end">{sale.SupplierWeight}</td>
                                        <td className="text-end">{sale.SupplierPricePerKg}</td>
                                        <td className="text-end fw-bold">
                                            {parseFloat(sale.SupplierTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="text-end text-success fw-bold">{sale.profit}</td>
                                        <td className="text-center">
                                            <button type="button" className="btn btn-sm btn-outline-primary" title={tr('Edit supplier weight / price', 'සැපයුම්කරු බර / මිල සංස්කරණය')}
                                                onClick={() => {
                                                    const source = reportData.source_table === 'sales_history' ? 'history' : 'today';
                                                    const sameItem = (r) => String(r.supplier_code || '').toUpperCase() === String(sale.supplier_code || '').toUpperCase()
                                                        && String(r.item_code || r.item_name || '').toUpperCase() === String(sale.item_code || sale.item_name || '').toUpperCase();
                                                    setEditingSiblings(groups[key].filter(sameItem).map((r) => ({ ...r, source })));
                                                    setEditingRecord({ ...sale, source });
                                                }}>✏️</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="table-secondary">
                                <tr>
                                    <td colSpan="6" className="text-end fw-bold">{tr('Grand Total:', 'මුළු එකතුව:')}</td>
                                    <td className="text-end fw-bold text-primary">
                                        {groups[key].reduce((sum, item) => sum + parseFloat(item.SupplierTotal || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </td>
                                    <td className="text-end fw-bold text-success">
                                        {groups[key].reduce((sum, item) => sum + parseFloat(item.profit || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            </div>
        ));
    };

    const grandTotal = calculateGrandTotal();
    const grandProfit = calculateGrandProfit();

    return (
        <div className="sfr-root" style={{ display: 'flex' }}>
            <SupplierLineEditModal record={editingRecord} sameItemRecords={editingSiblings} onClose={() => setEditingRecord(null)} onSaved={() => fetchReport()} />
            {/* Full-screen report: these rules override the page's normal width / padding */}
            <style>{`
                body:has(.sfr-root) { display: block !important; }
                body:has(.sfr-root) #root, body:has(.sfr-root) .layout-main { width: 100% !important; max-width: none !important; }
                .sfr-root { width: 100% !important; max-width: none !important; margin: -1.5rem -12px 0 -12px !important; min-height: 100vh; background: #f5f5f5 !important; }
                .sfr-root .sfr-content { margin-left: 260px !important; width: auto !important; max-width: none !important; flex: 1 1 auto !important; min-width: 0 !important; padding: 16px 20px !important; background: #f5f5f5 !important; box-sizing: border-box; }
                .sfr-root .card { width: 100% !important; max-width: none !important; }
                .sfr-root .table-responsive { overflow-x: auto; }
                .sfr-root table.table { width: 100% !important; font-size: 1rem; }
                .sfr-root table.table th, .sfr-root table.table td { padding: 8px 12px !important; white-space: nowrap; }
                @media (max-width: 991px) { .sfr-root .sfr-content { margin-left: 0 !important; } }
                @media print {
                    .sfr-root { margin: 0 !important; }
                    .sfr-root .sfr-content { margin-left: 0 !important; padding: 0 !important; }
                    .sfr-root > :not(.sfr-content) { display: none !important; }
                }
            `}</style>
            <Sidebar />

            <div className="sfr-content" style={{
                marginLeft: '260px',
                padding: '30px',
                width: '100%',
                backgroundColor: '#f5f5f5',
                minHeight: '100vh'
            }}>

                {/* DATE FILTER PANEL */}
                <div className="card shadow mb-4 p-3">
                    <div className="row g-3 align-items-end">
                        <div className="col-md-3">
                            <label className="fw-bold">{tr('Start Date', 'ආරම්භ දිනය')}</label>
                            <input type="date" className="form-control"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                            />
                        </div>

                        <div className="col-md-3">
                            <label className="fw-bold">{tr('End Date', 'අවසන් දිනය')}</label>
                            <input type="date" className="form-control"
                                value={endDate}
                                onChange={e => setEndDate(e.target.value)}
                            />
                        </div>

                        <div className="col-md-2">
                            <button
                                className="btn btn-primary w-100"
                                onClick={() => fetchReport()}
                                disabled={(!startDate && !endDate) || loading}
                            >
                                {loading ? 'Loading...' : 'Search'}
                            </button>
                        </div>

                        <div className="col-md-2">
                            <button className="btn btn-secondary w-100" onClick={handleReset}>
                                Reset
                            </button>
                        </div>
                    </div>

                    {/* Date Summary */}
                    <div className="mt-2 text-muted">
                        {startDate && endDate
                            ? <>{tr('Sales history from', 'විකුණුම් ඉතිහාසය')} <b>{startDate}</b> {tr('to', 'සිට')} <b>{endDate}</b></>
                            : tr("Today's sales (choose a date range to see sales history)", 'අද විකුණුම් (විකුණුම් ඉතිහාසය සඳහා දින පරාසයක් තෝරන්න)')}
                    </div>
                </div>

                {/* SEARCH BAR - SUPPLIER BILL NUMBER FILTER */}
                <div className="card shadow mb-4 p-3">
                    <div className="row g-3 align-items-center">
                        <div className="col-md-4">
                            <label className="fw-bold">{tr('Supplier Code', 'සැපයුම්කරු කේතය')}</label>
                            <div className="input-group">
                                <input
                                    type="search"
                                    name="sfr-supplier-code-search"
                                    list="sfr-supplier-codes"
                                    autoComplete="off"
                                    data-lpignore="true"
                                    data-1p-ignore="true"
                                    data-bwignore="true"
                                    data-form-type="other"
                                    readOnly
                                    onFocus={(e) => e.target.removeAttribute('readonly')}
                                    className="form-control"
                                    placeholder={tr('Enter supplier code...', 'සැපයුම්කරු කේතය ඇතුලත් කරන්න...')}
                                    value={searchSupplierCode}
                                    onChange={(e) => setSearchSupplierCode(e.target.value.toUpperCase())}
                                />
                                <datalist id="sfr-supplier-codes">
                                    {supplierCodes.map(c => <option key={c} value={c} />)}
                                </datalist>
                                {searchSupplierCode && (
                                    <button className="btn btn-outline-secondary" onClick={() => setSearchSupplierCode('')} type="button">
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="col-md-4">
                            <label className="fw-bold">{tr('Search by Supplier Bill No', 'සැපයුම්කරු බිල් අංකය අනුව සොයන්න')}</label>
                            <div className="input-group">
                                <input 
                                    type="search" 
                                    name="sfr-supplier-bill-search"
                                    autoComplete="off"
                                    data-lpignore="true"
                                    data-1p-ignore="true"
                                    data-bwignore="true"
                                    data-form-type="other"
                                    readOnly
                                    onFocus={(e) => e.target.removeAttribute('readonly')}
                                    className="form-control"
                                    placeholder={tr('Enter supplier bill no...', 'සැපයුම්කරු බිල් අංකය ඇතුලත් කරන්න...')}
                                    value={searchSupplierBillNo}
                                    onChange={handleSearchChange}
                                />
                                {searchSupplierBillNo && (
                                    <button 
                                        className="btn btn-outline-secondary" 
                                        onClick={handleClearSearch}
                                        type="button"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="col-md-4">
                            {(searchSupplierCode || searchSupplierBillNo) && (
                                <div className="alert alert-info mb-0 py-2">
                                    <i className="bi bi-search"></i> {tr('Filter:', 'පෙරහන:')}{' '}
                                    {searchSupplierCode && <strong>{tr('Supplier', 'සැපයුම්කරු')} {searchSupplierCode}</strong>}
                                    {searchSupplierCode && searchSupplierBillNo && ' · '}
                                    {searchSupplierBillNo && <strong>{tr('Bill', 'බිල')} {searchSupplierBillNo}</strong>}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* TITLE */}
                <div className="d-flex justify-content-between align-items-center mb-4">
                    <h2 className="fw-bold">{tr('Report by Supplier', 'සැපයුම්කරු අනුව වාර්තාව')}</h2>
                    <div className="d-flex align-items-center gap-3">
                    <label className="d-flex align-items-center gap-2 fw-bold mb-0" style={{ cursor: 'pointer' }}
                        title={tr('Also print a second page with the weight of each pack', 'එක් එක් මල්ලේ බර සහිත දෙවන පිටුවක්ද මුද්‍රණය කරන්න')}>
                        <input type="checkbox" className="form-check-input m-0" checked={printPackSheet} onChange={(e) => togglePackSheet(e.target.checked)} />
                        {tr('Print pack sheet', 'මලු පත්‍රය මුද්‍රණය')}
                    </label>
                    <button className="btn btn-success" onClick={handlePrintBills} disabled={printing || loading}
                        title={tr('Print the bills shown, in supplier bill format', 'පෙන්වන බිල්පත් සැපයුම්කරු බිල් ආකෘතියෙන් මුද්‍රණය කරන්න')}>
                        {printing ? tr('Printing...', 'මුද්‍රණය වෙමින්...') : `${tr('Print Bills', 'බිල්පත් මුද්‍රණය')} (${Object.keys(filteredReportData.billed || {}).length || Object.keys(filteredReportData.nonBilled || {}).length})`}
                    </button>
                    </div>
                </div>

                {/* LOADING */}
                {loading && (
                    <div className="text-center p-4">
                        <div className="spinner-border text-primary"></div>
                        <div>Loading data...</div>
                    </div>
                )}

                {/* DATA */}
                {!loading && (
                    <>
                        {Object.keys(filteredReportData.nonBilled).length > 0 && (
                            <>
                                <h4 className="fw-bold">{tr('Unbilled Records', 'බිල් නොකළ වාර්තා')}</h4>
                                {renderTableBlock(filteredReportData.nonBilled, 'nonBilled')}
                            </>
                        )}

                        {Object.keys(filteredReportData.billed).length > 0 && (
                            <>
                                <hr />
                                <h4 className="fw-bold">{tr('Billed Records', 'බිල් කළ වාර්තා')}</h4>
                                {renderTableBlock(filteredReportData.billed, 'billed')}
                            </>
                        )}

                        {Object.keys(filteredReportData.billed).length === 0 &&
                         Object.keys(filteredReportData.nonBilled).length === 0 && (
                            <div className="alert alert-info">
                                {(searchSupplierCode || searchSupplierBillNo) ? tr(`No records found for "${[searchSupplierCode, searchSupplierBillNo].filter(Boolean).join(' / ')}"`, `"${[searchSupplierCode, searchSupplierBillNo].filter(Boolean).join(' / ')}" සඳහා වාර්තා හමු නොවිණි`) : tr('No records found', 'වාර්තා හමු නොවිණි')}
                            </div>
                        )}

                        {/* GRAND TOTAL SECTION */}
                        {(Object.keys(filteredReportData.billed).length > 0 || 
                          Object.keys(filteredReportData.nonBilled).length > 0) && (
                            <div className="card shadow mt-4 mb-3 border-0" style={{ backgroundColor: '#f8f9fa' }}>
                                <div className="card-body">
                                    <div className="row">
                                        <div className="col-md-6 offset-md-6">
                                            <table className="table table-bordered mb-0">
                                                <tbody>
                                                    <tr style={{ backgroundColor: '#e9ecef' }}>
                                                        <td className="fw-bold fs-5">{tr('Grand Total:', 'සම්පූර්ණ එකතුව (Grand Total):')}</td>
                                                        <td className="text-end fw-bold fs-5 text-primary">
                                                            {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </td>
                                                    </tr>
                                                    <tr style={{ backgroundColor: '#e9ecef' }}>
                                                        <td className="fw-bold fs-5">{tr('Grand Profit:', 'සම්පූර්ණ ලාභය (Grand Profit):')}</td>
                                                        <td className="text-end fw-bold fs-5 text-success">
                                                            {grandProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </td>
                                                    </tr>
                                                    {(searchSupplierCode || searchSupplierBillNo || startDate || endDate) && (
                                                        <tr style={{ backgroundColor: '#fff3cd' }}>
                                                            <td colSpan="2" className="text-muted small">
                                                                <i className="bi bi-info-circle"></i> 
                                                                {tr('Filtered results', 'පෙරහනට අනුව ගණනය කරන ලදී (Filtered results)')}
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}

            </div>
        </div>
    );
};

export default SupplierReport;