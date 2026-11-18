import React, { useState, useEffect } from 'react';
import api from '../../api';
import Sidebar from '../Sidebar';
import { tr } from '../../i18n/language';

const SupplierReport = () => {

    // Report Data
    const [reportData, setReportData] = useState({ billed: {}, nonBilled: {} });
    const [filteredReportData, setFilteredReportData] = useState({ billed: {}, nonBilled: {} });
    const [loading, setLoading] = useState(false);

    // Date Filters
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Search Filter
    const [searchSupplierBillNo, setSearchSupplierBillNo] = useState('');

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
            setFilteredReportData(searchSupplierBillNo.trim() ? applyBillFilter(response.data, searchSupplierBillNo) : response.data);
        } catch (error) {
            console.error("Error fetching report:", error);
        } finally {
            setLoading(false);
        }
    };

    // Records of the report that match a supplier bill number
    const applyBillFilter = (data, searchTerm) => {
        const filterGroups = (groups = {}) => {
            const filtered = {};
            Object.keys(groups).forEach(key => {
                const rows = groups[key].filter(sale =>
                    sale.supplier_bill_no && String(sale.supplier_bill_no).toLowerCase().includes(searchTerm.toLowerCase()));
                if (rows.length > 0) filtered[key] = rows;
            });
            return filtered;
        };
        return { ...data, billed: filterGroups(data.billed), nonBilled: filterGroups(data.nonBilled) };
    };

    // Filter by Supplier Bill Number
    const filterBySupplierBillNo = (searchTerm) => {
        if (!searchTerm.trim()) {
            setFilteredReportData(reportData);
            return;
        }

        const filterGroups = (groups) => {
            const filtered = {};
            Object.keys(groups).forEach(supplierCode => {
                const filteredSales = groups[supplierCode].filter(sale => 
                    sale.supplier_bill_no && 
                    sale.supplier_bill_no.toLowerCase().includes(searchTerm.toLowerCase())
                );
                if (filteredSales.length > 0) {
                    filtered[supplierCode] = filteredSales;
                }
            });
            return filtered;
        };

        setFilteredReportData({
            billed: filterGroups(reportData.billed),
            nonBilled: filterGroups(reportData.nonBilled)
        });
    };

    // Handle search input change
    const handleSearchChange = (e) => {
        const value = e.target.value;
        setSearchSupplierBillNo(value);
        filterBySupplierBillNo(value);
    };

    // Clear search
    const handleClearSearch = () => {
        setSearchSupplierBillNo('');
        setFilteredReportData(reportData);
    };

    // Reset Function
    const handleReset = async () => {
        setStartDate('');
        setEndDate('');
        setSearchSupplierBillNo('');
        setLoading(true);

        try {
            const response = await api.get('/supplier-report');
            setReportData(response.data);
            setFilteredReportData(response.data);
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
                    <span className="badge bg-white text-primary">
                        {tr('Records:', 'වාර්තා ගණන:')} {groups[key].length}
                    </span>
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
            {/* Full-screen report: these rules override the page's normal width / padding */}
            <style>{`
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
                        <div className="col-md-8">
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
                            {searchSupplierBillNo && (
                                <div className="alert alert-info mb-0 py-2">
                                    <i className="bi bi-search"></i> {tr('Filter:', 'පෙරහන:')} <strong>{searchSupplierBillNo}</strong>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* TITLE */}
                <div className="d-flex justify-content-between align-items-center mb-4">
                    <h2 className="fw-bold">{tr('Report by Supplier', 'සැපයුම්කරු අනුව වාර්තාව')}</h2>
                    <button className="btn btn-success" onClick={() => window.print()}>
                        Print
                    </button>
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
                                {searchSupplierBillNo ? tr(`No records found for "${searchSupplierBillNo}"`, `"${searchSupplierBillNo}" සඳහා වාර්තා හමු නොවිණි`) : tr('No records found', 'වාර්තා හමු නොවිණි')}
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
                                                    {(searchSupplierBillNo || startDate || endDate) && (
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