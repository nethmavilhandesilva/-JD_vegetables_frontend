import React, { useState, useEffect } from 'react';
import api from '../../api';
import Layout from '../Layout/Layout';
import './FinancialReport.css';
import { SHOP_NAME } from '../../config/shop';
import { tr } from '../../i18n/language';

const FinancialReport = () => {
    const [loanRows, setLoanRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // Morning drawer cash: typed in the box, applied to the calculations on Enter
    const [openingCash, setOpeningCash] = useState(() => {
        try { return localStorage.getItem('financial_opening_cash') || '0'; } catch { return '0'; }
    });
    const [appliedOpeningCash, setAppliedOpeningCash] = useState(() => parseFloat(openingCash) || 0);

    // State for financial report
    const [financialData, setFinancialData] = useState({
        totalDr: 0,
        totalCr: 0,
        salesTotal: 0,
        supplierTotalCost: 0,
        commissionProfit: 0,
        kuliyaTotal: 0,
        totalProfit: 0,
        totalDamages: 0,
        totalOldLoans: 0,
        totaltodayLoans: 0,
        totalQtySold: 0,
        totalBillsPrinted: 0,
        firstBillTime: '',
        lastBillTime: '',
        firstBillNo: '',
        lastBillNo: '',
        companyName: SHOP_NAME,
        reportDate: new Date().toLocaleString(),
    });

    useEffect(() => {
        fetchSettings();
        fetchFinancialReport();
    }, []);

    // Fetch company name and report date from backend
    const fetchSettings = async () => {
        try {
            const response = await api.get('/settings');
            if (response.data) {
                setFinancialData(prev => ({
                    ...prev,
                    companyName: SHOP_NAME,
                    reportDate: response.data.value || new Date().toLocaleString()
                }));
            }
        } catch (err) {
            console.error("Error fetching settings:", err);
        }
    };

    const fetchFinancialReport = async () => {
        try {
            setLoading(true);
            const response = await api.get('/financial-report');
            if (response.data.success) {
                const data = response.data.data;
                setLoanRows(data.loanRows || []);
                setFinancialData(prev => ({
                    ...prev,
                    totalDr: data.totalDr || 0,
                    totalCr: data.totalCr || 0,
                    salesTotal: data.salesTotal || 0,
                    supplierTotalCost: data.supplierTotalCost || 0,
                    commissionProfit: data.commissionProfit || 0,
                    kuliyaTotal: data.kuliyaTotal || 0,
                    totalProfit: data.totalProfit || 0,
                    totalDamages: data.totalDamages || 0,
                    totalOldLoans: data.totalOldLoans || 0,
                    totaltodayLoans: data.totaltodayLoans || 0,
                    totalQtySold: data.totalQtySold || 0,
                    totalBillsPrinted: data.totalBillsPrinted || 0,
                    firstBillTime: data.firstBillTime || 'N/A',
                    lastBillTime: data.lastBillTime || 'N/A',
                    firstBillNo: data.firstBillNo || 'N/A',
                    lastBillNo: data.lastBillNo || 'N/A',
                }));
            } else {
                setError('Failed to load financial report');
            }
        } catch (err) {
            setError('Error fetching financial report: ' + (err.response?.data?.message || err.message));
            console.error('Error:', err);
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = () => window.print();

    const applyOpeningCash = () => {
        setAppliedOpeningCash(parseFloat(openingCash) || 0);
        try { localStorage.setItem('financial_opening_cash', openingCash); } catch { /* ignore */ }
    };

    const formatNumber = (num) => {
        if (num === null || num === undefined) return '';
        return parseFloat(num).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    };

    if (loading) return (
        <Layout>
            <div className="container mt-4 text-center">
                <div className="spinner-border text-success" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
                <p className="mt-2">Loading financial report...</p>
            </div>
        </Layout>
    );

    if (error) return (
        <Layout>
            <div className="container mt-4">
                <div className="alert alert-danger">{error}</div>
            </div>
        </Layout>
    );

    const salesTotal = financialData.salesTotal;
    const supplierTotal = financialData.supplierTotalCost;
    const commissionProfit = financialData.commissionProfit;
    const kuliyaTotal = financialData.kuliyaTotal;
    const loansReceived = loanRows.reduce((sum, r) => sum + Math.abs(r.received || 0), 0);
    const loansPaid = loanRows.reduce((sum, r) => sum + Math.abs(r.paid || 0), 0);

    // Morning drawer cash is taken off the sales total before working out cash in hand
    const salesAfterOpeningCash = salesTotal - appliedOpeningCash;

    // Cash in hand = everything received - everything paid out
    const totalReceived = salesAfterOpeningCash + loansReceived;
    const totalPaid = supplierTotal + kuliyaTotal + loansPaid;
    const cashInHand = totalReceived - totalPaid;

    return (
        <Layout>
            <div className="container mt-4 financial-report-container fr-fullscreen">
                <div className="report-card">
                    <div className="report-title-bar" style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: 'linear-gradient(90deg, #004d00, #007700)',
                        color: 'white',
                        padding: '15px 20px',
                        borderRadius: '8px',
                        marginBottom: '20px'
                    }}>
                        <h2 style={{ margin: 0, fontWeight: '700' }}>{financialData.companyName}</h2>
                        <h4 style={{ margin: 0 }}>{tr('📄 Sales Report', '📄 විකුණුම් වාර්තාව')}</h4>
                        <div>
                            <span>{financialData.reportDate}</span>
                            <button className="btn btn-light btn-sm ms-2" onClick={handlePrint}>{tr('🖨️ Print', '🖨️ මුද්‍රණය')}</button>
                        </div>
                    </div>

                    {/* Summary: sales, commission profit, farmers' payout */}
                    <div className="fr-summary">
                        <div className="fr-summary-row">
                            <span className="fr-summary-label">{tr('Total Sales :', 'මුළු වෙළදාමේ එකතුව :')}</span>
                            <span className="fr-summary-value">{formatNumber(salesTotal)}</span>
                        </div>
                        <div className="fr-summary-row">
                            <span className="fr-summary-label">{tr('Income from Lorries :', 'ලොරි වලින් ලද ආදායම :')}</span>
                            <span className="fr-summary-value">{formatNumber(0)}</span>
                            <span className="fr-summary-value">{formatNumber(0)}</span>
                            <span className="fr-summary-label ms-auto">{tr('Income from Farmers :', 'ගොවියන්ගෙන් ලද ආදායම :')}</span>
                            <span className="fr-summary-value" title={tr('Customer price - Supplier price (Profit)', 'ගනුදෙ මිල - සැපයුම් මිල (ලාභය)')}>{formatNumber(commissionProfit)}</span>
                            <span className="fr-summary-value" title={tr('Supplier total after commission', 'කොමිස් අඩු කළ සැපයුම්කරු එකතුව')}>{formatNumber(supplierTotal)}</span>
                        </div>
                    </div>

                    {/* Cash ledger */}
                    <table className="fr-ledger">
                        <thead>
                            <tr>
                                <th>{tr('Description', 'විස්තරය')}</th>
                                <th>{tr('Received', 'ලැබීම')}</th>
                                <th>{tr('Paid', 'ගෙවීම')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="fr-row-a">
                                <td>{tr('Total Sales', 'මුළු වෙළදාමේ එකතුව')}</td>
                                <td className="text-end">{formatNumber(salesTotal)}</td>
                                <td></td>
                            </tr>
                            <tr className="fr-row-b">
                                <td>{tr('Paid to Lorries (after commission)', 'කොමිස් අඩු කර ලොරි වලට ගෙවූ මුදල')}</td>
                                <td></td>
                                <td className="text-end">{formatNumber(0)}</td>
                            </tr>
                            <tr className="fr-row-a">
                                <td>{tr('Paid to Farmers (after commission)', 'කොමිස් අඩු කර ගොවියන්ට ගෙවූ මුදල')}</td>
                                <td></td>
                                <td className="text-end">{formatNumber(supplierTotal)}</td>
                            </tr>
                            <tr className="fr-row-b">
                                <td>{tr('Total Kuliya Distributed', 'බෙදා හරිනු ලැබූ මුළු කුලී එකතුව')}</td>
                                <td></td>
                                <td className="text-end">{formatNumber(kuliyaTotal)}</td>
                            </tr>
                            <tr className="fr-row-a">
                                <td>{tr('Opening Drawer Cash', 'දවස ආරම්භයේ ලාච්චුවේ තිබූ මුදල')}</td>
                                <td className="text-end">
                                    <input
                                        type="number"
                                        className="fr-opening-input"
                                        value={openingCash}
                                        onChange={(e) => setOpeningCash(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyOpeningCash(); } }}
                                        onFocus={(e) => e.target.select()}
                                    />
                                </td>
                                <td></td>
                            </tr>
                            <tr className="fr-row-b">
                                <td>{tr('Other Receipts / Income', 'වෙනත් ලැබීම්/ආදායම')}</td>
                                <td className="text-end">{formatNumber(0)}</td>
                                <td></td>
                            </tr>
                        </tbody>
                    </table>

                    {/* Loans received / given today */}
                    <div className="fr-loans">
                        <table>
                            <thead>
                                <tr>
                                    <th>{tr('Description', 'විස්තරය')}</th>
                                    <th>{tr('Received', 'ලැබීම')}</th>
                                    <th>{tr('Paid', 'ගෙවීම')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loanRows.length === 0 ? (
                                    <tr><td colSpan="3" className="text-center">{tr('No loan records', 'ණය වාර්තා නැත')}</td></tr>
                                ) : loanRows.map((row, index) => (
                                    <tr key={index}>
                                        <td>{row.description}</td>
                                        <td className="text-end">{row.received ? formatNumber(Math.abs(row.received)) : ''}</td>
                                        <td className="text-end">{row.paid ? formatNumber(Math.abs(row.paid)) : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Cash in hand */}
                    <div className="fr-summary">
                        <div className="fr-summary-row">
                            <span className="fr-summary-label">{tr('Sales Total - Opening Drawer Cash :', 'වෙළදාමේ එකතුව - ලාච්චුවේ තිබූ මුදල :')}</span>
                            <span className="fr-summary-value">
                                {formatNumber(salesTotal)} - {formatNumber(appliedOpeningCash)} = {formatNumber(salesAfterOpeningCash)}
                            </span>
                        </div>
                        <div className="fr-summary-row">
                            <span className="fr-summary-label">{tr('Cash in Hand', 'ඇතැති මුදල')}</span>
                            <span className="fr-summary-value">{formatNumber(cashInHand)}</span>
                            <span className="fr-summary-label ms-auto">{tr('Cash in Hand (before Kuliya) :', 'කුලී මුදල අඩු නොකර ඇතැති මුදල :')}</span>
                            <span className="fr-summary-value">{formatNumber(cashInHand + kuliyaTotal)}</span>
                        </div>
                        <div className="fr-summary-row">
                            <span className="fr-summary-label">{tr('Total Commission Income', 'මුළු කොමිස් ආදායම')}</span>
                            <span className="fr-summary-value">{formatNumber(commissionProfit)}</span>
                        </div>
                    </div>

                    {/* Other details */}
                    <div className="table-responsive mt-3">
                        <table className="table table-bordered table-striped">
                            <tfoot>
                                <tr className="fw-bold table-warning">
                                    <td>{tr('Total Damage', 'මුළු හානිය')}</td>
                                    <td colSpan="2" className="text-end text-danger">
                                        {formatNumber(financialData.totalDamages)}
                                    </td>
                                </tr>

                                {/* Loans */}
                                <tr className="fw-bold table-warning">
                                    <td colSpan="3">
                                        <div className="d-flex flex-wrap gap-3">
                                            <div className="loan-box">
                                                <div>{tr('Today\'s Old Loans', 'අද දින පරණ නය')}</div>
                                                <div className="fw-bold">{formatNumber(financialData.totalOldLoans)}</div>
                                            </div>
                                            <div className="loan-box">
                                                <div>{tr('Today\'s Loans Taken', 'අද දින නය ගැනීම')}</div>
                                                <div className="fw-bold">{formatNumber(Math.abs(financialData.totaltodayLoans))}</div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>

                                {/* Sales Stats */}
                                <tr className="fw-bold table-warning">
                                    <td colSpan="3">
                                        <div className="d-flex flex-wrap gap-3">
                                            <div className="stat-box">
                                                <div>{tr('Total Sales Quantity', 'මුළු විකිණුම් ප්‍රමාණය')}</div>
                                                <div className="fw-bold">{formatNumber(financialData.totalQtySold)}</div>
                                            </div>
                                            <div className="stat-box">
                                                <div>{tr('Total Printed Bills', 'මුළු මුද්‍රිත බිල්පත්')}</div>
                                                <div className="fw-bold">{financialData.totalBillsPrinted}</div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>

                                {/* Bill Times */}
                                <tr className="fw-bold table-warning">
                                    <td colSpan="3">
                                        <div className="d-flex flex-wrap gap-3">
                                            <div className="bill-time-box">
                                                <div>{tr('First Bill Print Time', 'පළමු බිල් මුද්‍රණ කාලය')}</div>
                                                <div className="fw-bold">{financialData.firstBillTime}</div>
                                                <small>{tr('Bill No:', 'බිල් අංකය:')} {financialData.firstBillNo}</small>
                                            </div>
                                            <div className="bill-time-box">
                                                <div>{tr('Last Bill Print Time', 'අවසන් බිල් මුද්‍රණ කාලය')}</div>
                                                <div className="fw-bold">{financialData.lastBillTime}</div>
                                                <small>{tr('Bill No:', 'බිල් අංකය:')} {financialData.lastBillNo}</small>
                                            </div>
                                        </div>
                                    </td>
                                </tr>

                            </tfoot>
                        </table>
                    </div>
                </div>
            </div>
        </Layout>
    );
};

export default FinancialReport;