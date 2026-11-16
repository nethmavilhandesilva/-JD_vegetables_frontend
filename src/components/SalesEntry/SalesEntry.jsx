import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Select from "react-select";
import Layout from "../Layout/Layout";
import '../../App.css';
import api from "../../api";
import AdminView from "../AdminView";
import { ThermalBillHTML, A4BillHTML } from '../BillTemplates';
import ImagePreviewModal from '../ImagePreviewModal';
import { SHOP_PHONE } from '../../config/shop';
import { BACKEND_URL } from '../../config/paths';
import { printHtml } from '../../utils/printHtml';
import { combineCustomerBillLines } from '../../utils/combineCustomerBillLines';
import PrintPreviewDialog from '../PrintPreviewDialog';
import { tr } from '../../i18n/language';

const routes = {
    markPrinted: "/sales/mark-printed",
    confirmPrint: "/sales/confirm-print",
    cancelPrint: "/sales/cancel-print",
    getLoanAmount: "/get-loan-amount",
    markAllProcessed: "/sales/mark-all-processed",
    givenAmount: "/sales",
    sales: "/sales",
    customers: "/customers",
    items: "/items",
    suppliers: "/suppliers",
    getCustomerGivenAmount: "/sales/customer/given-amount",
    bulkUpdateCustomer: "/sales/bulk-update-supplier",
    ttsSpeak: "/tts/speak"
};

// --- Sinhala number-to-words + speech announcement for the bill total (F1 print) ---
const numberToSinhalaWords = (num) => {
    const ones = ['', 'එක', 'දෙක', 'තුන', 'හතර', 'පහ', 'හය', 'හත', 'අට', 'නවය'];
    const teens = ['දහය', 'එකොළහ', 'දොළහ', 'දහතුන', 'දාහතර', 'පහළොව්', 'දහසය', 'දාහත', 'දහඅට', 'දහනවය'];
    const tensPrefix = ['', '', 'විසි', 'තිස්', 'හතළිස්', 'පණස්', 'හැට', 'හැත්තෑ', 'අසූ', 'අනූ'];
    const tensStandalone = ['', '', 'විස්ස', 'තිහ', 'හතළිහ', 'පනහ', 'හැට', 'හැත්තෑව', 'අසූව', 'අනූව'];
    const hundredsWord = ['', 'එකසිය', 'දෙසිය', 'තුන්සිය', 'හාරසිය', 'පන්සිය', 'හයසිය', 'හත්සිය', 'අටසිය', 'නවසිය'];

    const twoDigits = (n) => {
        if (n === 0) return '';
        if (n < 10) return ones[n];
        if (n < 20) return teens[n - 10];
        const t = Math.floor(n / 10);
        const o = n % 10;
        return o === 0 ? tensStandalone[t] : tensPrefix[t] + ones[o];
    };

    const threeDigits = (n) => {
        const h = Math.floor(n / 100);
        const rest = n % 100;
        const parts = [];
        if (h > 0) parts.push(hundredsWord[h]);
        if (rest > 0) parts.push(twoDigits(rest));
        return parts.join(' ');
    };

    const groupWords = (n, suffix) => (n > 0 ? `${threeDigits(n)} ${suffix}` : '');

    let n = Math.round(Math.abs(num));
    if (n === 0) return 'බිංදුව';

    const crore = Math.floor(n / 10000000); n %= 10000000;
    const lakh = Math.floor(n / 100000); n %= 100000;
    const thousand = Math.floor(n / 1000); n %= 1000;
    const rest = n;

    const parts = [];
    if (crore > 0) parts.push(groupWords(crore, 'කෝටි'));
    if (lakh > 0) parts.push(groupWords(lakh, 'ලක්ෂ'));
    if (thousand > 0) parts.push(groupWords(thousand, 'දහස්'));
    if (rest > 0) parts.push(threeDigits(rest));

    return parts.join(' ').trim();
};

// Fetches Sinhala speech audio from the backend (Google Cloud TTS proxy, cached server-side
// by text) once, then plays that single clip back-to-back `times` times.
const speakSinhalaBillTotal = async (amount, times = 3) => {
    const words = numberToSinhalaWords(amount);
    const text = `බිල්පත් එකතුව රුපියල් ${words} යි`;
    try {
        const res = await api.post(routes.ttsSpeak, { text });
        const audioContent = res.data?.audioContent;
        if (!audioContent) throw new Error("No audio returned from TTS endpoint");
        const audioSrc = `data:audio/mp3;base64,${audioContent}`;

        for (let i = 0; i < times; i++) {
            await new Promise((resolve) => {
                const audioEl = new Audio(audioSrc);
                audioEl.onended = resolve;
                audioEl.onerror = resolve;
                audioEl.play().catch(resolve);
            });
        }
    } catch (e) {
        console.warn("Sinhala bill total announcement failed:", e);
    }
};

// --- Dashboard grouping ---
// Every entry is saved as its own sales record, so bills print each entry on its own line.
// The table on this page still shows entries of the same customer, item, supplier and price
// (same bill status) as one row, like before; the breakdown box lists the separate entries.
const parseHistory = (sale) => {
    try {
        const h = typeof sale.breakdown_history === 'string' ? JSON.parse(sale.breakdown_history) : sale.breakdown_history;
        return Array.isArray(h) ? h : [];
    } catch { return []; }
};
const entryTime = (sale) => {
    const d = new Date(sale.created_at || sale.timestamp || '');
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};
const groupSalesForTable = (sales) => {
    const groups = new Map();
    sales.forEach((s) => {
        const key = [
            (s.customer_code || '').toUpperCase(), s.item_code || '', (s.supplier_code || '').toUpperCase(),
            parseFloat(s.price_per_kg) || 0, s.bill_printed || 'N', s.bill_no || '',
        ].join('|');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
    });
    // Rows keep the table's order (position of the first record seen in each group)
    return Array.from(groups.values()).map((members) => {
        if (members.length === 1) return members[0];
        const ordered = members.slice().sort((a, b) => (a.id || 0) - (b.id || 0));
        const add = (k) => ordered.reduce((t, m) => t + (parseFloat(m[k]) || 0), 0);
        const history = ordered.flatMap((m) => {
            const h = parseHistory(m);
            return h.length > 0 ? h : [{ time: entryTime(m), weight: parseFloat(m.weight) || 0, packs: parseInt(m.packs) || 0 }];
        });
        return {
            ...ordered[0],
            weight: add('weight'),
            packs: add('packs'),
            Kuliya: add('Kuliya'),
            total: add('total'),
            SupplierTotal: add('SupplierTotal'),
            breakdown_history: history,
            group_ids: ordered.map((m) => m.id),
            group_members: ordered,
        };
    });
};
const rowIds = (row) => row.group_ids || [row.id];

// --- Sub-Components  ---
const BreakdownDisplay = ({ sale, formatDecimal }) => {
    if (!sale?.breakdown_history) return null;
    let history = [];
    try {
        history = typeof sale.breakdown_history === 'string' ? JSON.parse(sale.breakdown_history) : sale.breakdown_history;
    } catch (e) { return null; }
    if (!Array.isArray(history) || history.length < 2) return null;

    return (
        <div className="mt-4 p-3 bg-white rounded-lg border-2 border-blue-500 shadow-sm" style={{ width: '450px', margin: '10px auto' }}>
            <div style={{ maxHeight: '150px' }}>
                <table className="w-full text-xs text-black" style={{ marginTop: "-6px" }}>
                    <thead>
                        <tr className="text-gray-500 border-b">
                            <th className="text-left py-1">{tr('(Time)', '(වේලාව)')}</th>
                            <th className="text-right py-1">{tr('(Weight)', '(බර)')}</th>
                            <th className="text-right py-1">{tr('(Bags)', '(මලු)')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.map((entry, i) => (
                            <tr key={i} className="border-b border-gray-50 last:border-0">
                                <td className="py-1 text-white">{entry.time}</td>
                                <td className="py-1 text-right font-bold text-white">{formatDecimal(entry.weight)} kg</td>
                                <td className="py-1 text-right font-bold text-white">{entry.packs}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="mt-2 pt-1 border-t-2 border-blue-200 text-right font-black text-sm text-black">
                Total: {formatDecimal(sale.weight)}kg / {sale.packs}p
            </div>
        </div>
    );
};

//customer list section
const CustomerList = React.memo(({ customers, type, searchQuery, onSearchChange, selectedPrintedCustomer, selectedUnprintedCustomer, handleCustomerClick, formatDecimal, allSales, isCashFilterActive, toggleCashFilter }) => {
    const getPrintedCustomerGroups = () => {
        const groups = {};
        allSales.filter(s => s.bill_printed === 'Y' && s.bill_no).forEach(sale => {

            // --- UPDATED FILTER LOGIC ---
            if (type === "printed") {
                if (isCashFilterActive) {
                    // When ticked: show only 'N' (Cash)
                    if (sale.credit_transaction !== 'Y') return;
                } else {
                    // When unticked (Default): show only 'Y' (Credit)
                    if (sale.credit_transaction !== 'N') return;
                }
            }

            const groupKey = `${sale.customer_code}-${sale.bill_no}`;
            if (!groups[groupKey]) groups[groupKey] = {
                customerCode: sale.customer_code,
                billNo: sale.bill_no,
                displayText: sale.customer_code
            };
        });
        return groups;
    };
    const getUnprintedCustomers = () => {
        const customerMap = {};
        allSales.filter(s => s.bill_printed === 'N').forEach(sale => {
            const customerCode = sale.customer_code;
            const saleTimestamp = new Date(sale.timestamp || sale.created_at || sale.date || sale.id);
            if (!customerMap[customerCode] || saleTimestamp > new Date(customerMap[customerCode].latestTimestamp)) {
                customerMap[customerCode] = { customerCode, latestTimestamp: sale.timestamp || sale.created_at || sale.date || sale.id, originalItem: customerCode };
            }
        });
        return customerMap;
    };

    // Recomputed only when the sales data or the cash filter changes, not on every keystroke
    const printedCustomerGroups = useMemo(() => (type === "printed" ? getPrintedCustomerGroups() : {}), [allSales, type, isCashFilterActive]); // eslint-disable-line react-hooks/exhaustive-deps
    const unprintedCustomerMap = useMemo(() => (type === "unprinted" ? getUnprintedCustomers() : {}), [allSales, type]); // eslint-disable-line react-hooks/exhaustive-deps

    const filteredPrintedGroups = useMemo(() => {
        if (type !== "printed") return [];
        let groupsArray = Object.values(printedCustomerGroups);
        if (searchQuery) {
            const lowerQuery = searchQuery.toLowerCase();
            groupsArray = groupsArray.filter(g => g.customerCode.toLowerCase().startsWith(lowerQuery) || g.billNo.toString().toLowerCase().startsWith(lowerQuery) || g.displayText.toLowerCase().startsWith(lowerQuery));
        }
        return groupsArray.sort((a, b) => (parseInt(b.billNo) || 0) - (parseInt(a.billNo) || 0));
    }, [printedCustomerGroups, searchQuery, type]);

    const filteredUnprintedCustomers = useMemo(() => {
        if (type !== "unprinted") return [];
        let customersArray = Object.values(unprintedCustomerMap);
        if (searchQuery) customersArray = customersArray.filter(c => c.customerCode.toLowerCase().startsWith(searchQuery.toLowerCase()));
        return customersArray.sort((a, b) => new Date(b.latestTimestamp) - new Date(a.latestTimestamp));
    }, [unprintedCustomerMap, searchQuery, type]);

    const displayItems = type === "printed" ? filteredPrintedGroups : filteredUnprintedCustomers;
    const isSelected = (item) => type === "printed" ? selectedPrintedCustomer === `${item.customerCode}-${item.billNo}` : selectedUnprintedCustomer === item.customerCode;

    return (
        <div className="w-full shadow-xl rounded-xl overflow-y-auto border border-black" style={{ backgroundColor: "#1ec139ff", maxHeight: "80.5vh", overflowY: "auto" }}>
            <div style={{ backgroundColor: "#006400" }} className="p-1 rounded-t-xl">
                <div className="flex items-center justify-center gap-2 mb-1">
                    <h2 className="font-bold text-white whitespace-nowrap" style={{ fontSize: '14px' }}>
                        {type === "printed" ? tr('Printed', 'මුද්‍රණය කළ') : tr('Unprinted', 'මුද්‍රණය නොකළ')}
                    </h2>

                    {/* Only show the checkbox for the "printed" column */}
                    {type === "printed" && (
                        <div onClick={() => toggleCashFilter()} className="cursor-pointer transition-all border border-white rounded" style={{ width: '18px', height: '18px', backgroundColor: isCashFilterActive ? '#2563eb' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: '90px', marginTop: '-22px' }}>
                            {isCashFilterActive && <span style={{ color: 'white', fontSize: '12px', fontWeight: 'bold' }}>✓</span>}
                        </div>
                    )}
                </div>

                <input
                    type="text"
                    placeholder={type === "printed" ? tr('Search bill no / code...', 'සෙවීම බිල්පත් අංකය/කේතය...') : tr('Search customer code...', 'සෙවීම ගනුදෙනු කේතය...')}
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value.toUpperCase())}
                    className="px-4 py-0.5 border rounded-xl focus:ring-2 focus:ring-blue-300 uppercase block mx-auto"
                    style={{ width: '169px' }}
                />
            </div>
            <div className="py-1">
                {displayItems.length === 0 ? (<p className="text-gray-700 p-2 text-center text-xs">{tr('No records.', 'වාර්තා නොමැත.')}</p>) : (
                    <ul className="flex flex-col px-1">
                        {displayItems.map((item) => {
                            const customerCode = item.customerCode;
                            // Printed: customer_code-bill_no; unprinted: customer_code
                            const displayText = type === "printed" ? `${item.customerCode}-${item.billNo}` : item.customerCode;
                            // The bill's records are looked up only when the button is clicked
                            const billSalesFor = () => (type === "printed"
                                ? allSales.filter(s => s.customer_code === item.customerCode && s.bill_no === item.billNo)
                                : allSales.filter(s => s.customer_code === item.customerCode && (s.bill_printed === 'N' || !s.bill_printed || s.bill_printed === '')));
                            const isItemSelected = isSelected(item);
                            // Remove the total amount from button text
                            const buttonText = displayText.replace(/\n/g, ' ');

                            return (
                                <li key={type === "printed" ? `${item.customerCode}-${item.billNo}` : item.customerCode} className="flex">
                                    <button
                                        onClick={() => handleCustomerClick(type, customerCode, item.billNo || null, billSalesFor())}
                                        className={`py-1 mb-2 rounded-xl border ${isItemSelected ? "border-blue-600" : "bg-gray-50 hover:bg-gray-100 border-gray-200"}`}
                                        style={isItemSelected ? { backgroundColor: '#93C5FD', paddingLeft: '05px', width: '280px', textAlign: 'left' } : { paddingLeft: '1px', width: '280px', textAlign: 'left' }}
                                    >
                                        <span
                                            style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'inherit', width: '100%' }}
                                            className={`font-semibold ${isItemSelected ? 'text-black' : 'text-gray-700'}`}
                                            title={buttonText}
                                        >
                                            {buttonText}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
});

const ItemSummary = ({ sales }) => {

    const formatWeight = (value) => {
        if (!value) return "0";
        const num = parseFloat(value);
        return num % 1 === 0 ? num.toString() : num.toFixed(1);
    };

    const formatPacks = (value) => {
        if (!value) return "0";
        return parseInt(value).toString();
    };

    const summary = useMemo(() => {
        const result = {};
        sales.forEach(sale => {
            const itemName = sale.item_name || 'Unknown';
            if (!result[itemName]) result[itemName] = { totalWeight: 0, totalPacks: 0 };
            result[itemName].totalWeight += parseFloat(sale.weight) || 0;
            result[itemName].totalPacks += parseInt(sale.packs) || 0;
        });
        return result;
    }, [sales]);

    if (Object.keys(summary).length === 0) return null;

    const items = Object.entries(summary);

    const rows = [];
    for (let i = 0; i < items.length; i += 3) {
        rows.push(items.slice(i, i + 3));
    }

    return (
        <div style={{
            width: '100%',
            backgroundColor: '#ffffff',
            color: '#000000',
            fontFamily: "'Segoe UI', Tahoma",
            marginTop: '10px'
        }}>
            <div style={{
                textAlign: 'center',
                marginBottom: '10px'
            }}>
                <span style={{ fontSize: '18px', fontWeight: '800' }}>Item Summary</span>
            </div>

            {rows.map((row, rowIndex) => (
                <div
                    key={rowIndex}
                    style={{
                        display: 'flex',
                        gap: '10px',
                        marginBottom: '5px',
                        backgroundColor: '#ffffff'
                    }}
                >
                    {row.map(([itemName, data]) => (
                        <div key={itemName} style={{ flex: 1 }}>

                            {/* Compact format */}
                            <span style={{
                                fontSize: '16px',
                                fontWeight: '700',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                display: 'block'
                            }}>
                                {itemName}: {formatWeight(data.totalWeight)}kg/{formatPacks(data.totalPacks)}p
                            </span>

                        </div>
                    ))}

                    {row.length < 3 &&
                        Array.from({ length: 3 - row.length }).map((_, idx) => (
                            <div key={idx} style={{ flex: 1 }} />
                        ))
                    }
                </div>
            ))}
        </div>
    );
};


const SalesSummaryFooter = ({ sales, formatDecimal }) => {
    const totals = useMemo(() => {
        return sales.reduce((acc, s) => {
            const weight = parseFloat(s.weight) || 0;
            const price = parseFloat(s.price_per_kg) || 0;
            const packs = parseFloat(s.packs) || 0;
            const packCost = parseFloat(s.CustomerPackCost) || 0;
            const packLabour = parseFloat(s.CustomerPackLabour) || 0;
            acc.billTotal += (weight * price);
            acc.totalBagPrice += (packs * packCost);
            acc.totalLabour += (packs * packLabour);
            acc.totalKuliya += parseFloat(s.Kuliya) || 0;
            return acc;
        }, { billTotal: 0, totalBagPrice: 0, totalLabour: 0, totalKuliya: 0 });
    }, [sales]);

    const finalPayable = totals.billTotal + totals.totalBagPrice + totals.totalKuliya;

    return (
        <div className="sales-totals-bar flex flex-row flex-nowrap items-center justify-between w-full p-2 mt-2 rounded-xl border-2 border-blue-500 bg-gray-900 text-white font-bold shadow-lg overflow-hidden">
            <div className="flex items-center gap-4 px-3 border-r border-gray-700 flex-1 justify-center">
                <span className="text-gray-400 uppercase text-[10px] whitespace-nowrap">{tr('Total:', 'එකතුව:')}</span>
                <span className="text-white text-sm whitespace-nowrap" style={{ marginLeft: '6px' }}>
                    {formatDecimal(totals.billTotal)}
                </span>

            </div>
            <div className="flex items-center gap-2 px-3 border-r border-gray-700 flex-1 justify-center" style={{ marginLeft: '20px', transform: 'translateY(-24px)' }}>
                <span className="text-gray-400 uppercase text-[10px] whitespace-nowrap" style={{ marginLeft: '140px' }}>{tr('Bag Price:', 'බෑග් මිල:')}</span>
                <span className="text-white text-sm whitespace-nowrap" style={{ marginLeft: '6px' }}>{formatDecimal(totals.totalBagPrice)}</span>
            </div>
            <div className="flex flex-row items-center whitespace-nowrap px-4 border-r border-gray-700 h-full ml-auto" style={{ transform: 'translateY(-48px)' }}>
                <span className="text-gray-400 uppercase text-[10px] mr-2" style={{ marginLeft: '310px' }}>{tr('Laborer:', 'කාම්කරු:')}</span>
                <span className="font-bold text-sm" style={{ marginLeft: '6px' }}>0</span>
            </div>
            <div className="flex flex-row items-center whitespace-nowrap px-4 border-r border-gray-700 h-full ml-auto" style={{ transform: 'translateY(-72px)' }}>
                <span className="text-gray-400 uppercase text-[10px] mr-2" style={{ marginLeft: '480px' }}>{tr('Payable:', 'ගෙවිය:')}</span>
                <span className="font-bold text-sm text-yellow-400" style={{ marginLeft: '6px' }}>{formatDecimal(finalPayable)}</span>
                <span className="text-gray-400 text-[10px]" style={{ marginLeft: '6px' }}>{tr('(Kuliya:', '(කුලිය:')} {formatDecimal(totals.totalKuliya)})</span>
            </div>
        </div>
    );
};

// --- Main Export Component ---
// Hoisted to module scope so it keeps a stable identity across SalesEntry re-renders.
// Defined inside SalesEntry, the 5s sales poll made React remount it on every render,
// wiping the typed customer code and stealing focus from the input.
const ContextMenu = React.memo(({ show, onClose, onUpdate, selectionCriteria, selectedCount }) => {
    const [localCustomerCode, setLocalCustomerCode] = React.useState('');

    React.useEffect(() => {
        if (show) {
            setLocalCustomerCode('');
        }
    }, [show]);

    const handleInputChange = (e) => {
        const value = e.target.value.toUpperCase();
        setLocalCustomerCode(value);
    };

    const handleUpdate = () => {
        if (localCustomerCode.trim()) {
            onUpdate(localCustomerCode.trim().toUpperCase());
            setLocalCustomerCode('');
        } else {
            alert("Please enter a customer code");
        }
    };

    const handleClose = () => {
        setLocalCustomerCode('');
        onClose();
    };

    if (!show) return null;

    return (
        <>
            {/* Backdrop Overlay */}
            <div
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    backdropFilter: 'blur(4px)',
                    zIndex: 9999
                }}
                onClick={handleClose}
            />

            {/* Modal Container */}
            <div
                style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: '#ffffff',
                    borderRadius: '16px',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                    zIndex: 10000,
                    width: '90%',
                    maxWidth: '450px',
                    maxHeight: '90vh',
                    overflow: 'auto'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <style>{`
                @keyframes fadeIn { 
                    from { opacity: 0; } 
                    to { opacity: 1; } 
                } 
                .modal-button { 
                    transition: all 0.2s ease; 
                    cursor: pointer; 
                } 
                .modal-button:hover { 
                    transform: translateY(-1px); 
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); 
                } 
                .modal-button:active { 
                    transform: translateY(0); 
                }
            `}</style>

                {/* Header with Icon */}
                <div style={{
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    padding: '12px 20px',
                    borderTopLeftRadius: '16px',
                    borderTopRightRadius: '16px',
                    color: 'white'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                            width: '32px',
                            height: '32px',
                            background: 'rgba(255, 255, 255, 0.2)',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '16px'
                        }}>
                            ⚡
                        </div>
                        <div>
                            <h2 style={{
                                margin: 0,
                                fontSize: '16px',
                                fontWeight: 'bold',
                                letterSpacing: '-0.5px'
                            }}>
                                Bulk Update Customer
                            </h2>
                            <p style={{
                                margin: '2px 0 0 0',
                                fontSize: '11px',
                                opacity: 0.9
                            }}>
                                Update multiple customer codes at once
                            </p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div style={{ padding: '16px 20px' }}>
                    {/* Selection Criteria Card */}
                    {selectionCriteria && (
                        <div style={{
                            background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                            borderRadius: '10px',
                            padding: '10px 12px',
                            marginBottom: '16px',
                            border: '1px solid #fbbf24'
                        }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                marginBottom: '8px'
                            }}>
                                <span style={{ fontSize: '14px' }}>📋</span>
                                <span style={{
                                    fontWeight: 'bold',
                                    fontSize: '11px',
                                    color: '#92400e',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px'
                                }}>
                                    Current Selection
                                </span>
                            </div>

                            <div style={{ display: 'grid', gap: '6px' }}>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '6px 8px',
                                    background: 'white',
                                    borderRadius: '6px'
                                }}>
                                    <span style={{ fontSize: '11px', color: '#78350f' }}>Customer:</span>
                                    <span style={{
                                        fontWeight: 'bold',
                                        fontSize: '12px',
                                        color: '#92400e',
                                        fontFamily: 'monospace'
                                    }}>
                                        {selectionCriteria.customer_code}
                                    </span>
                                </div>

                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '6px 8px',
                                    background: 'white',
                                    borderRadius: '6px'
                                }}>
                                    <span style={{ fontSize: '11px', color: '#78350f' }}>Item:</span>
                                    <span style={{
                                        fontWeight: 'bold',
                                        fontSize: '12px',
                                        color: '#92400e',
                                        fontFamily: 'monospace'
                                    }}>
                                        {selectionCriteria.item_code}
                                    </span>
                                </div>

                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '6px 8px',
                                    background: '#10b981',
                                    borderRadius: '6px',
                                    color: 'white'
                                }}>
                                    <span style={{ fontSize: '11px' }}>Selected:</span>
                                    <span style={{
                                        fontWeight: 'bold',
                                        fontSize: '14px'
                                    }}>
                                        {selectedCount || 0}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Input Field */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '6px',
                            fontWeight: '600',
                            fontSize: '12px',
                            color: '#374151'
                        }}>
                            ✏️ New Customer Code
                        </label>
                        <input
                            type="text"
                            value={localCustomerCode}
                            onChange={handleInputChange}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleUpdate();
                                }
                            }}
                            style={{
                                width: '100%',
                                padding: '10px 12px',
                                border: '2px solid #e5e7eb',
                                borderRadius: '10px',
                                fontSize: '13px',
                                fontWeight: '500',
                                transition: 'all 0.2s ease',
                                outline: 'none',
                                boxSizing: 'border-box',
                                fontFamily: 'monospace'
                            }}
                            onFocus={(e) => {
                                e.target.style.borderColor = '#667eea';
                                e.target.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.1)';
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = '#e5e7eb';
                                e.target.style.boxShadow = 'none';
                            }}
                            autoFocus
                            placeholder="e.g., CUST001"
                        />
                    </div>

                    {/* Primary Action Button */}
                    <button
                        onClick={handleUpdate}
                        className="modal-button"
                        style={{
                            width: '100%',
                            padding: '12px',
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            fontSize: '14px',
                            marginBottom: '0'
                        }}
                    >
                        🚀 Update {selectedCount || 0} Record{selectedCount !== 1 ? 's' : ''}
                    </button>
                </div>

                {/* Footer with Close Button */}
                <div style={{
                    padding: '12px 20px',
                    background: '#f9fafb',
                    borderBottomLeftRadius: '16px',
                    borderBottomRightRadius: '16px',
                    borderTop: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'flex-end'
                }}>
                    <button
                        onClick={handleClose}
                        style={{
                            padding: '6px 16px',
                            background: 'transparent',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            color: '#6b7280',
                            fontSize: '12px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            fontWeight: '500'
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.background = '#f3f4f6';
                            e.target.style.borderColor = '#d1d5db';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.background = 'transparent';
                            e.target.style.borderColor = '#e5e7eb';
                        }}
                    >
                        Cancel (ESC)
                    </button>
                </div>
            </div>
        </>
    );
});

const KULIYA_PER_BAG = 40;
// Records typed in are shown at once with a temporary id (above any real id) until the
// server confirms them; then the saved database record replaces the temporary one.
const TEMP_ID_BASE = 9e15;
let tempIdCounter = 0;
const nextTempId = () => TEMP_ID_BASE + (++tempIdCounter);
const isTempId = (id) => typeof id === 'number' && id >= TEMP_ID_BASE;
const hasPending = (row) => !!row && (row._pending || (row.group_members || []).some(m => m._pending));
// One shared formatter: creating Intl.NumberFormat per value was slow on large tables
const DECIMAL_FORMAT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatDecimalShared = (value) => DECIMAL_FORMAT.format(Number(value || 0));
const initialFormData = { customer_code: "", customer_name: "", supplier_code: "", code: "", item_code: "", item_name: "", weight: "", price_per_kg: "", pack_due: "", total: "", packs: "", given_amount: "", pack_cost: "", telephone_no: "", kuliya: "", };
const fieldOrder = ["telephone_no", "customer_code_input", "customer_code_select", "supplier_code", "item_code_select", "weight", "price_per_kg_grid_item", "packs", "kuliya"];
const skipMap = { telephone_no: "customer_code_input", customer_code_input: "supplier_code", customer_code_select: "supplier_code", given_amount: "supplier_code", supplier_code: "item_code_select", item_code_select: "weight", price_per_kg: "packs", price_per_kg_grid_item: "packs", packs: "kuliya", kuliya: null };

export default function SalesEntry({ printMode: propPrintMode = 'a4', setPrintMode: propSetPrintMode }) {
    const [localPrintMode, setLocalPrintMode] = useState(propPrintMode || 'a4');

    // Use propPrintMode if available, otherwise use local state
    const printMode = propPrintMode || localPrintMode;
    const setPrintMode = propSetPrintMode || setLocalPrintMode;
    // Last printed bill's final total, persisted in localStorage so it survives reloads/navigation
    // Bill waiting in the app's own print window (F1): nothing is marked printed until Print
    const [printJob, setPrintJob] = useState(null);
    const [lastPrintedBill, setLastPrintedBill] = useState(() => {
        try {
            const saved = localStorage.getItem('lastPrintedBill');
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            return null;
        }
    });

    const refs = {
        telephone_no: useRef(null), customer_code_input: useRef(null), customer_code_select: useRef(null), given_amount: useRef(null),
        supplier_code: useRef(null), item_code_select: useRef(null), item_name: useRef(null),
        weight: useRef(null), price_per_kg: useRef(null), packs: useRef(null), total: useRef(null),
        price_per_kg_grid_item: useRef(null), kuliya: useRef(null),
    };
    const adminViewRef = useRef(null);
    // Tracks in-flight /sales save requests so printing (F1) can wait for them to land
    // before snapshotting what to print — otherwise a record entered a split second
    // before F1 could still be mid-request and get left out of the bill.
    const kuliyaBaseRef = useRef(null); // { packs, item_code } of the record being edited
    const pendingSaveRequestsRef = useRef([]);

    const [state, setState] = useState({
        allSales: [], selectedPrintedCustomer: null, selectedUnprintedCustomer: null, editingSaleId: null,
        searchQueries: { printed: "", unprinted: "", farmerPrinted: "", farmerUnprinted: "" }, errors: {}, loanAmount: 0, isManualClear: false,
        isSubmitting: false, formData: initialFormData, packCost: 0, customerSearchInput: "", itemSearchInput: "",
        supplierSearchInput: "", currentBillNo: null, isLoading: false, customers: [], items: [], suppliers: [],
        forceUpdate: null, windowFocused: null, isPrinting: false, billSize: '3inch', priceManuallyChanged: false,
        gridPricePerKg: "", selectedSaleForBreakdown: null, showSavePhoneButton: false, isTelephoneValid: false,
        currentUser: null, bulkUpdateCustomerCode: "",
        isGivenAmountManuallyTouched: false, filterOnlyCash: false, customerProfilePic: null, supplierProfilePic: null, customerNameDisplay: "", supplierNameDisplay: "", isImageModalOpen: false, selectedImageData: { profile: null, nic_front: null, nic_back: null, title: "" }, selectedSalesIds: [], selectionCriteria: null, isBulkUpdateModalOpen: false, bulkUpdateSupplierCode: "", bulkUpdateContextMenu: { x: 0, y: 0, show: false }, isBulkPrintEnabled: true, isKuliyaManuallyChanged: false, showBillPreview: false,
    });

    const setFormData = (updater) => setState(prev => ({ ...prev, formData: typeof updater === 'function' ? updater(prev.formData) : updater }));
    const updateState = (updates) => setState(prev => ({ ...prev, ...updates }));

    const { allSales, customerSearchInput, selectedPrintedCustomer, selectedUnprintedCustomer, editingSaleId,
        searchQueries, errors, loanAmount, isManualClear, formData, packCost, isLoading, customers,
        items, suppliers, isPrinting, billSize, gridPricePerKg, selectedSaleForBreakdown, currentUser,
    } = state;

    // ---- Sales data from the database (one source for the whole screen) ----
    // allSalesRef always holds the newest list, so async code (printing) never uses a stale copy.
    const allSalesRef = useRef(allSales);
    allSalesRef.current = allSales;
    const salesVersionRef = useRef(null);   // version of the list we hold (see SalesEntryController@index)
    const salesFetchRef = useRef(null);     // in-flight poll, so polls never pile up

    // The "All Sales Records" table shows the same data, newest first
    const allSalesRecords = allSales;
    const isLoadingAllSales = isLoading;
    const sortedAllSalesRecords = useMemo(() => [...allSales].sort((a, b) => (b.id || 0) - (a.id || 0)), [allSales]);
    const fetchAllSalesRecords = () => fetchSalesOnly();

    // Change the sales list now: the ref is updated at once (so F1/F5 read the newest list
    // without waiting for a render) and the same change is queued into React state.
    const commitSales = (updater) => {
        allSalesRef.current = updater(allSalesRef.current);
        setState(prev => ({ ...prev, allSales: updater(prev.allSales) }));
    };

    // Stable callbacks so the memoized sidebars only re-render when their data changes
    const customerClickRef = useRef(null);
    const editClickRef = useRef(null);
    const stableCustomerClick = useCallback((...args) => customerClickRef.current?.(...args), []);
    const setPrintedSearch = useCallback((value) => setState(prev => ({ ...prev, searchQueries: { ...prev.searchQueries, printed: value } })), []);
    const setUnprintedSearch = useCallback((value) => setState(prev => ({ ...prev, searchQueries: { ...prev.searchQueries, unprinted: value } })), []);
    const toggleCashFilterStable = useCallback(() => setState(prev => ({ ...prev, isCashFilterActive: !prev.isCashFilterActive })), []);

    // --- Logic for Farmer Lists (Admin View) ---
    const printedFarmers = useMemo(() => {
        const groups = {};
        allSales.filter(s => s.supplier_bill_printed === 'Y').forEach(sale => {
            const code = sale.supplier_code;
            if (code && !groups[code]) groups[code] = { supplier_code: code };
        });
        return Object.values(groups);
    }, [allSales]);
    // Customer bill: same item + same price = one line, whatever the supplier
    const combineSalesForPrinting = combineCustomerBillLines;
    // Auto-calculate Kuliya when weight, packs, or item changes
    useEffect(() => {
        const fetchKuliya = async () => {
            // Don't calculate if required fields are missing
            if (!formData.item_code || formData.packs === "" || formData.packs === null || formData.packs === undefined) {
                return;
            }

            // Don't override if user manually changed the value
            if (state.isKuliyaManuallyChanged) {
                return;
            }

            // A record opened for editing keeps its saved Kuliya (which may have been typed
            // in by hand) until its bags or item are changed
            const base = kuliyaBaseRef.current;
            if (editingSaleId && base && String(formData.packs) === base.packs && formData.item_code === base.item_code) {
                return;
            }

            // Show a value instantly from the local formula so the field never sits empty
            // while waiting on the network; the backend value below corrects it if different.
            const instantKuliya = calculateKuliyaLocally(
                formData.item_code,
                formData.item_name,
                parseFloat(formData.weight) || 0,
                parseInt(formData.packs) || 0,
                items
            );
            if (instantKuliya !== undefined) {
                setFormData(prev => ({ ...prev, kuliya: instantKuliya }));
            }

        };

        fetchKuliya();
    }, [formData.item_code, formData.item_name, formData.weight, formData.packs, items, state.isKuliyaManuallyChanged, editingSaleId]);
    // Kuliya = bags x 40 for every item (same rule as the backend). The Kuliya box can
    // still be typed over; a typed value is saved as-is.
    const calculateKuliyaLocally = (itemCode, itemName, weight, packs) => {
        const bags = Math.max(0, parseInt(packs) || 0);
        return bags * KULIYA_PER_BAG;
    };
    const handleKuliyaChange = (value) => {
        // Allow only numbers and decimal point
        if (/^\d*\.?\d*$/.test(value) || value === "") {
            setFormData(prev => ({ ...prev, kuliya: value }));
            updateState({ isKuliyaManuallyChanged: true });
        }
    };
    //functions related to multiselect and bulk update
    const toggleSaleSelection = (saleId, e) => {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }

        const saleToSelect = displayedSales.find(s => s.id === saleId);
        if (!saleToSelect) return;

        const isCurrentlySelected = state.selectedSalesIds.includes(saleId);

        if (isCurrentlySelected) {
            setState(prev => {
                const newSelectedIds = prev.selectedSalesIds.filter(id => id !== saleId);
                return {
                    ...prev,
                    selectedSalesIds: newSelectedIds,
                    selectionCriteria: newSelectedIds.length === 0 ? null : prev.selectionCriteria
                };
            });
            return;
        }

        // Any record can be selected; criteria just records the first selection for the bulk-update modal header
        setState(prev => ({
            ...prev,
            selectedSalesIds: [...prev.selectedSalesIds, saleId],
            selectionCriteria: prev.selectionCriteria || {
                customer_code: saleToSelect.customer_code,
                item_code: saleToSelect.item_code
            }
        }));
    };

    // Checkbox of a grouped table row ticks/unticks every record in that group
    const toggleRowSelection = (row) => {
        if (hasPending(row)) return; // still saving
        const ids = rowIds(row);
        if (ids.length === 1) { toggleSaleSelection(ids[0]); return; }
        const allSelected = ids.every(id => state.selectedSalesIds.includes(id));
        setState(prev => {
            const next = allSelected
                ? prev.selectedSalesIds.filter(id => !ids.includes(id))
                : [...new Set([...prev.selectedSalesIds, ...ids])];
            return {
                ...prev,
                selectedSalesIds: next,
                selectionCriteria: next.length === 0 ? null : (prev.selectionCriteria || { customer_code: row.customer_code, item_code: row.item_code })
            };
        });
    };

    // Select-all checkbox: ticks/unticks every record currently shown in the table
    const toggleSelectAllSales = () => {
        const allDisplayedSelected = displayedSales.length > 0 && displayedSales.every(s => state.selectedSalesIds.includes(s.id));
        if (allDisplayedSelected) {
            setState(prev => ({ ...prev, selectedSalesIds: [], selectionCriteria: null }));
            return;
        }
        const first = displayedSales[0];
        setState(prev => ({
            ...prev,
            selectedSalesIds: displayedSales.filter(s => !isTempId(s.id)).map(s => s.id),
            selectionCriteria: prev.selectionCriteria || { customer_code: first.customer_code, item_code: first.item_code }
        }));
    };
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape' && state.bulkUpdateContextMenu.show) {
                closeContextMenu();
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [state.bulkUpdateContextMenu.show]);

    // Handle right-click on selected records on bulk update
    const handleRightClick = (e, sale) => {
        e.preventDefault();
        e.stopPropagation();

        const ids = rowIds(sale).filter(id => !isTempId(id));
        if (ids.length === 0) return; // still saving
        const isSelected = ids.every(id => state.selectedSalesIds.includes(id));

        if (!isSelected) {
            setState(prev => ({
                ...prev,
                selectedSalesIds: [...new Set([...prev.selectedSalesIds, ...ids])],
                selectionCriteria: prev.selectionCriteria || {
                    customer_code: sale.customer_code,
                    item_code: sale.item_code
                }
            }));
        }

        setState(prev => ({
            ...prev,
            bulkUpdateContextMenu: {
                show: true,
                x: e.clientX,
                y: e.clientY
            },
            bulkUpdateCustomerCode: ""  // ← CHANGED
        }));
    };
    const handleBulkUpdateCustomer = async (newCustomerCode) => {
        const customerCodeToUpdate = newCustomerCode || state.bulkUpdateCustomerCode;
        const finalCustomerCode = customerCodeToUpdate.trim().toUpperCase();

        if (!finalCustomerCode) {
            alert("Please enter a customer code");
            return;
        }

        if (state.selectedSalesIds.length === 0) {
            alert("No sales selected");
            return;
        }

        try {
            updateState({ isSubmitting: true });

            // Same endpoint the Supplier Report bulk edit uses; it updates customer_code
            // when given only that field. (POST /sales/bulk-update-customer 404s on the live server.)
            await api.put(routes.bulkUpdateCustomer, {
                transaction_ids: state.selectedSalesIds,
                customer_code: finalCustomerCode
            });

            await fetchAllSalesRecords();

            // Full page refresh
            window.location.reload();
        } catch (error) {
            console.error("Bulk update error:", error);
            const data = error.response?.data;
            const reason = data?.errors ? Object.values(data.errors).flat().join('\n') : (data?.message || data?.error || error.message);
            alert("Failed to update customer codes:\n" + reason);
            updateState({ isSubmitting: false });
        }
    };

    // Handle bulk update submission
    const handleBulkUpdateSupplier = async (newSupplierCode) => {
        // Use the passed parameter instead of state
        const supplierCodeToUpdate = newSupplierCode || state.bulkUpdateSupplierCode;
        const finalSupplierCode = supplierCodeToUpdate.trim().toUpperCase();

        if (!finalSupplierCode) {
            alert("Please enter a supplier code");
            return;
        }

        if (state.selectedSalesIds.length === 0) {
            alert("No sales selected");
            return;
        }

        try {
            // Show loading state
            updateState({ isSubmitting: true });

            // Send bulk update request
            const response = await api.post('/sales/bulk-update-supplier', {
                sale_ids: state.selectedSalesIds,
                supplier_code: finalSupplierCode
            });

            if (response.data.success) {
                // Update local state with new supplier codes
                const updatedSales = response.data.sales || [];
                const updatedSalesMap = {};
                updatedSales.forEach(sale => {
                    updatedSalesMap[sale.id] = sale;
                });

                updateState({
                    allSales: allSales.map(s => updatedSalesMap[s.id] ? updatedSalesMap[s.id] : s),
                    selectedSalesIds: [], // Clear selection after update
                    bulkUpdateContextMenu: { show: false, x: 0, y: 0 },
                    bulkUpdateSupplierCode: "", // Reset
                    isSubmitting: false
                });
                await fetchAllSalesRecords();

            } else {
                throw new Error(response.data.message || "Update failed");
            }
        } catch (error) {
            console.error("Bulk update error:", error);
            alert("Failed to update supplier codes. Please try again.");
            updateState({ isSubmitting: false });
        }
    };

    // Close context menu
    const closeContextMenu = () => {
        setState(prev => ({
            ...prev,
            bulkUpdateContextMenu: { show: false, x: 0, y: 0 },
            bulkUpdateSupplierCode: "",
            bulkUpdateCustomerCode: ""
        }));
    };
    //End of functions releated to multiselect and bulk update

    const unprintedFarmers = useMemo(() => {
        const groups = {};
        allSales.filter(s => s.supplier_bill_printed === 'N' || !s.supplier_bill_printed).forEach(sale => {
            const code = sale.supplier_code;
            if (code && !groups[code]) groups[code] = { supplier_code: code };
        });
        return Object.values(groups);
    }, [allSales]);

    const { newSales, printedSales, unprintedSales } = useMemo(() => ({
        newSales: allSales.filter(s => s.id && s.bill_printed !== 'Y' && s.bill_printed !== 'N'),
        printedSales: allSales.filter(s => s.bill_printed === 'Y'),
        unprintedSales: allSales.filter(s => s.bill_printed === 'N' || !s.bill_printed || s.bill_printed === '')
    }), [allSales]);

    const filterCustomers = (sales, query, searchByBillNo = false) => {
        const allCustomers = [...new Set(sales.map(s => s.customer_code))];
        if (!query) return allCustomers;
        const lowerQuery = query.toLowerCase();
        if (searchByBillNo) {
            const byBillNo = sales.filter(s => (s.bill_no?.toString() || '').toLowerCase().includes(lowerQuery)).map(s => s.customer_code);
            const byCode = allCustomers.filter(code => code.toLowerCase().includes(lowerQuery));
            return [...new Set([...byBillNo, ...byCode])];
        }
        return allCustomers.filter(code => code.toLowerCase().includes(lowerQuery));
    };

    const printedCustomers = useMemo(() => filterCustomers(printedSales, searchQueries.printed, true), [printedSales, searchQueries.printed]);
    const unprintedCustomers = useMemo(() => filterCustomers(unprintedSales, searchQueries.unprinted), [unprintedSales, searchQueries.unprinted]);

    const displayedSales = useMemo(() => {
        let sales = newSales;

        if (selectedUnprintedCustomer) {
            // Filter by customer code for unprinted records
            sales = [...sales, ...unprintedSales.filter(s => s.customer_code === selectedUnprintedCustomer)];
        }
        else if (selectedPrintedCustomer) {
            if (selectedPrintedCustomer.includes('-')) {
                // Split the key "CODE-BILLNO" and filter by both fields
                const [cCode, bNo] = selectedPrintedCustomer.split('-');
                sales = [...sales, ...printedSales.filter(s =>
                    s.customer_code === cCode && String(s.bill_no) === String(bNo)
                )];
            } else {
                // Fallback for single code selection
                sales = [...sales, ...printedSales.filter(s => s.customer_code === selectedPrintedCustomer)];
            }
        }

        return sales.slice().reverse();
    }, [newSales, unprintedSales, printedSales, selectedUnprintedCustomer, selectedPrintedCustomer]);

    const tableRows = useMemo(() => groupSalesForTable(displayedSales), [displayedSales]);

    const allDisplayedSelected = displayedSales.length > 0 && displayedSales.every(s => state.selectedSalesIds.includes(s.id));
    // Customers/items across every ticked record, for the bulk-update modal's "Current Selection" card
    const selectedSalesSummary = useMemo(() => {
        const selected = displayedSales.filter(s => state.selectedSalesIds.includes(s.id));
        if (selected.length === 0) return null;
        const unique = (key) => [...new Set(selected.map(s => s[key]).filter(Boolean))].join(', ');
        return { customer_code: unique('customer_code'), item_code: unique('item_code') };
    }, [displayedSales, state.selectedSalesIds]);
    const autoCustomerCode = useMemo(() => displayedSales.length > 0 && !isManualClear ? displayedSales[0].customer_code || "" : "", [displayedSales, isManualClear]);
    const currentBillNo = useMemo(() => {
        if (selectedPrintedCustomer && selectedPrintedCustomer.includes('-')) return selectedPrintedCustomer.split('-')[1] || "N/A";
        if (selectedPrintedCustomer) return printedSales.find(s => s.customer_code === selectedPrintedCustomer)?.bill_no || "N/A";
        return "";
    }, [selectedPrintedCustomer, printedSales]);

    const formatDecimal = formatDecimalShared;


    const fetchLoanAmount = async (customerCode) => {
        if (!customerCode) return updateState({ loanAmount: 0 });
        try {
            const response = await api.post(routes.getLoanAmount, { customer_short_name: customerCode });
            updateState({ loanAmount: parseFloat(response.data.total_loan_amount) || 0 });
        } catch { updateState({ loanAmount: 0 }); }
    };

    const fetchInitialData = async () => {
        try {
            const userData = JSON.parse(localStorage.getItem('user'));
            const [resSales, resCustomers, resItems, resSuppliers] = await Promise.all([
                api.get(routes.sales), api.get(routes.customers), api.get(routes.items), api.get(routes.suppliers)
            ]);
            const salesData = resSales.data.data || resSales.data.sales || resSales.data || [];
            salesVersionRef.current = resSales.data.version || null;
            const customersData = resCustomers.data.data || resCustomers.data.customers || resCustomers.data || [];
            const itemsData = resItems.data.data || resItems.data.items || resItems.data || [];
            const suppliersData = resSuppliers.data.data || resSuppliers.data.suppliers || resSuppliers.data || [];
            updateState({
                allSales: salesData,
                customers: customersData,
                items: itemsData,
                suppliers: suppliersData,
                isLoading: false,
                currentUser: userData
            });
        } catch {
            updateState({ errors: { form: 'Failed to load data. Check console.' } });
        }
    };

    // Lightweight refresh of just the sales list (used for real-time sidebar sync, no full page reload)
    // Polls send the version we hold: when the database has not changed the server answers
    // {unchanged: true} and nothing re-renders. force=true always downloads the full list.
    // Returns the newest sales list.
    const fetchSalesOnly = async ({ force = false } = {}) => {
        if (!force && salesFetchRef.current) return salesFetchRef.current;
        const run = (async () => {
            try {
                const listAtStart = allSalesRef.current;
                const params = !force && salesVersionRef.current ? { version: salesVersionRef.current } : {};
                const res = await api.get(routes.sales, { params });
                if (res.data?.unchanged) return allSalesRef.current;
                // While saves are still in flight, or if the list changed during this request,
                // this answer may be older than what is on screen: skip it (the next poll,
                // 3 s later, brings the newest data). Keeps fast entry smooth.
                if (!force && (allSalesRef.current !== listAtStart || pendingSaveRequestsRef.current.length > 0)) {
                    return allSalesRef.current;
                }
                const serverSales = res.data.data || res.data.sales || (Array.isArray(res.data) ? res.data : []);
                salesVersionRef.current = res.data.version || null;
                // Keep records that are still being saved
                const stillSaving = allSalesRef.current.filter(s => isTempId(s.id));
                const salesData = stillSaving.length ? serverSales.concat(stillSaving) : serverSales;
                allSalesRef.current = salesData;
                updateState({ allSales: salesData });
                return salesData;
            } catch (error) {
                console.error("Failed to refresh sales data:", error);
                return allSalesRef.current;
            }
        })();
        if (!force) salesFetchRef.current = run;
        try {
            return await run;
        } finally {
            if (salesFetchRef.current === run) salesFetchRef.current = null;
        }
    };

    // Poll the database periodically so the printed/unprinted sidebars stay live without reloading the page
    useEffect(() => {
        const interval = setInterval(() => {
            if (!document.hidden) fetchSalesOnly();
        }, 3000);
        const onVisible = () => { if (!document.hidden) fetchSalesOnly(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    useEffect(() => {
        if (displayedSales.length > 0) {
            const totals = displayedSales.reduce((acc, s) => {
                const weight = parseFloat(s.weight) || 0;
                const price = parseFloat(s.price_per_kg) || 0;
                const packs = parseFloat(s.packs) || 0;
                const pCost = parseFloat(s.CustomerPackCost) || 0;
                const pLabour = parseFloat(s.CustomerPackLabour) || 0;
                acc.billTotal += (weight * price);
                acc.totalBagPrice += (packs * pCost);
                acc.totalLabour += (packs * pLabour);
                return acc;
            }, { billTotal: 0, totalBagPrice: 0, totalLabour: 0 });
            const calculatedFinal = totals.billTotal + totals.totalBagPrice;
            //  setFormData(prev => prev.given_amount === null || prev.given_amount === "" ? { ...prev, given_amount: calculatedFinal.toFixed(2) } : prev);
        } else {
            setFormData(prev => ({ ...prev, given_amount: "" }));
        }
    }, [displayedSales]);
    useEffect(() => {
        // Determine the code to search for: manually entered, phone-matched, or sidebar-selected
        const code = formData.customer_code || autoCustomerCode;

        if (code && customers.length > 0) {
            const customer = customers.find(c =>
                String(c.short_name).toUpperCase() === String(code).toUpperCase()
            );

            if (customer) {
                const baseUrl = BACKEND_URL;
                let fileName = customer.profile_pic;
                let fullPath = null;

                if (fileName) {
                    if (fileName.startsWith('http')) {
                        fullPath = fileName;
                    } else {
                        const cleanFileName = fileName.replace('public/', '');
                        const subPath = cleanFileName.includes('customers')
                            ? cleanFileName
                            : `customers/${cleanFileName}`;

                        fullPath = `${baseUrl}/storage/${subPath}`;
                    }
                }

                updateState({
                    customerProfilePic: fullPath,
                    customerNameDisplay: customer.name || ""
                });
            } else {
                updateState({ customerProfilePic: null, customerNameDisplay: "" });
            }
        } else {
            updateState({ customerProfilePic: null, customerNameDisplay: "" });
        }
    }, [formData.customer_code, autoCustomerCode, customers]);
    // useEffect to fetch Supplier profile pic
    useEffect(() => {
        const code = formData.supplier_code;
        if (code && suppliers.length > 0) {
            const supplier = suppliers.find(s =>
                String(s.code).toUpperCase() === String(code).toUpperCase()
            );

            if (supplier) {
                // Root path where the 'storage' symlink is located
                const baseUrl = BACKEND_URL;
                let fileName = supplier.profile_pic;

                let fullPath = null;

                if (fileName) {
                    if (fileName.startsWith('http')) {
                        // Use directly if it's already a full URL
                        fullPath = fileName;
                    } else {
                        // Check if 'suppliers/profiles' is already in the filename string from DB
                        // If not, we manually add it to match your folder structure
                        const subPath = fileName.includes('suppliers/profiles')
                            ? fileName.replace('public/', '')
                            : `suppliers/profiles/${fileName.replace('public/', '')}`;

                        fullPath = `${baseUrl}/storage/${subPath}`;
                    }
                }

                updateState({
                    supplierProfilePic: fullPath,
                    supplierNameDisplay: supplier.name || ""
                });
            } else {
                updateState({ supplierProfilePic: null, supplierNameDisplay: "" });
            }
        } else {
            updateState({ supplierProfilePic: null, supplierNameDisplay: "" });
        }
    }, [formData.supplier_code, suppliers]);
    useEffect(() => {
        const w = parseFloat(formData.weight) || 0;
        const p = parseFloat(formData.price_per_kg) || 0;
        const packs = parseInt(formData.packs) || 0;
        const packDue = parseFloat(formData.pack_due) || 0;
        const total = (w * p);
        setFormData(prev => ({ ...prev, total: Number(total.toFixed(2)) }));
        if (!state.priceManuallyChanged) updateState({ gridPricePerKg: formData.price_per_kg });
    }, [formData.weight, formData.price_per_kg, formData.packs, formData.pack_due]);

    useEffect(() => {
        const handleWindowFocus = () => { fetchSalesOnly(); };
        window.addEventListener('focus', handleWindowFocus);
        return () => window.removeEventListener('focus', handleWindowFocus);
    }, []);

    useEffect(() => { fetchInitialData(); refs.customer_code_input.current?.focus(); }, []);

    const handleKeyDown = async (e, currentFieldName) => {
        if (e.key === "Enter") {
            e.preventDefault();

            // 1. Handle Given Amount
            if (currentFieldName === "given_amount") {
                const success = await handleSubmitGivenAmount(e);
                if (success) {
                    handlePrintAndClear();
                }
                return;
            }

            // 2. Handle KULIYA field - Submit form when Enter pressed on kuliya
            if (currentFieldName === "kuliya") {
                await handleSubmit(e);
                return;
            }

            // 3. Logic for TELEPHONE input
            if (currentFieldName === "telephone_no") {
                updateState({ showSavePhoneButton: false });
                refs.customer_code_input.current?.focus();
                return;
            }

            // 4. Logic for CUSTOMER CODE input
            if (currentFieldName === "customer_code_input") {
                const code = (formData.customer_code || autoCustomerCode).trim().toUpperCase();

                // IF EMPTY: Smoothly pass the cursor forward to supplier_code anyway
                if (!code) {
                    refs.supplier_code.current?.focus();
                    return;
                }

                // If filled, process profile mappings normally
                const match = customers.find(c => String(c.short_name).toUpperCase() === code);
                if (match) {
                    setFormData(prev => ({ ...prev, customer_name: match.name || "" }));
                    fetchLoanAmount(code);
                }

                refs.supplier_code.current?.focus();
                return;
            }

            // 5. Logic for SUPPLIER CODE input
            if (currentFieldName === "supplier_code") {
                // IF EMPTY or filled: Pass focus seamlessly to item selection container
                if (refs.item_code_select.current) {
                    refs.item_code_select.current.focus();
                }
                return;
            }

            // 6. Logic for ITEM SELECT
            if (currentFieldName === "item_code_select") {
                // IF EMPTY or filled: Move straight into the weight input box
                if (refs.weight.current) {
                    refs.weight.current.focus();
                    refs.weight.current.select();
                }
                return;
            }

            // 7. Logic for WEIGHT field (The Hard Boundary Stop)
            if (currentFieldName === "weight") {
                const weightValue = formData.weight?.trim();

                // STOP RIGHT HERE: If weight is completely blank, enforce input
                if (!weightValue) {
                    updateState({ errors: { form: tr('Please enter the weight', 'කරුණාකර බර ඇතුළත් කරන්න') } });
                    refs.weight.current?.focus();
                    refs.weight.current?.select();
                    return; // Enforces the hold at the weight field
                }

                // Enforce correct value formatting
                const weightNum = parseFloat(weightValue);
                if (isNaN(weightNum) || weightNum <= 0) {
                    updateState({ errors: { form: tr('Please enter a valid weight', 'කරුණාකර වලංගු බරක් ඇතුළත් කරන්න') } });
                    refs.weight.current?.focus();
                    refs.weight.current?.select();
                    return;
                }

                // SUCCESS: If a correct weight value exists, step to the price element
                if (refs.price_per_kg_grid_item.current) {
                    refs.price_per_kg_grid_item.current.focus();
                    refs.price_per_kg_grid_item.current.select();
                }
                return;
            }

            // 8. Logic for PRICE field
            if (currentFieldName === "price_per_kg_grid_item") {
                if (refs.packs.current) {
                    refs.packs.current.focus();
                    refs.packs.current.select();
                }
                return;
            }

            // 9. Logic for PACKS field
            if (currentFieldName === "packs") {
                if (refs.kuliya.current) {
                    refs.kuliya.current.focus();
                    refs.kuliya.current.select();
                }
                return;
            }

            // 10. Fallback standard positioning loop
            let nextFieldName = skipMap[currentFieldName];

            if (!nextFieldName && currentFieldName !== "kuliya") {
                const currentIndex = fieldOrder.indexOf(currentFieldName);
                let nextIndex = currentIndex + 1;
                while (nextIndex < fieldOrder.length &&
                    ["customer_code_select", "item_name"].includes(fieldOrder[nextIndex])) {
                    nextIndex++;
                }
                nextFieldName = nextIndex < fieldOrder.length ? fieldOrder[nextIndex] : null;
            }

            if (nextFieldName) {
                const nextRef = refs[nextFieldName];
                if (nextRef?.current) {
                    nextRef.current.focus();
                    if (!nextFieldName.includes("select")) nextRef.current.select();
                }
            }
        }
    };

    const salesTotal = displayedSales.reduce((sum, s) => sum + ((parseFloat(s.weight) || 0) * (parseFloat(s.price_per_kg) || 0)), 0);
    const packCostTotal = displayedSales.reduce((sum, s) => sum + ((parseFloat(s.CustomerPackCost) || 0) * (parseFloat(s.packs) || 0)), 0);
    const kuliyaTotal = displayedSales.reduce((sum, s) => sum + (parseFloat(s.Kuliya) || 0), 0);
    const totalSalesValue = salesTotal + packCostTotal + kuliyaTotal;

    const handleInputChange = (field, value) => {
        if (field === 'price_per_kg') {
            setFormData(prev => ({ ...prev, [field]: value }));
            updateState({ priceManuallyChanged: true, gridPricePerKg: value });
        } else if (field === 'price_per_kg_grid_item') {
            setFormData(prev => ({ ...prev, 'price_per_kg': value }));
            updateState({ gridPricePerKg: value, priceManuallyChanged: false });
        } else {
            setFormData(prev => ({ ...prev, [field]: value }));
        }

        if (field === 'customer_code') {
            const trimmedValue = value.trim();
            updateState({ isManualClear: value === '' });
            const matchingCustomer = unprintedCustomers.find(code => code.toLowerCase() === trimmedValue.toLowerCase());

            if (matchingCustomer) updateState({ selectedUnprintedCustomer: matchingCustomer, selectedPrintedCustomer: null });
            else if (selectedUnprintedCustomer) updateState({ selectedUnprintedCustomer: null });

            if (!trimmedValue) {
                updateState({ loanAmount: 0 });
                setFormData(prev => ({ ...prev, given_amount: "" }));
            }

            const customer = customers.find(c => c.short_name === value);
            const customerSales = allSales.filter(s => s.customer_code === trimmedValue);
            const firstSale = customerSales[0];
            const givenAmount = firstSale?.given_amount || "";
            setFormData(prev => ({ ...prev, customer_name: customer?.name || "", given_amount: givenAmount }));
            fetchLoanAmount(trimmedValue);

            // Check if both conditions are met to show the save button
            const telephoneNo = formData.telephone_no || "";
            const hasValidPhone = telephoneNo.length === 10 && /^\d+$/.test(telephoneNo);
            updateState({
                showSavePhoneButton: value.trim().length > 0 && hasValidPhone
            });
        }

        if (field === 'telephone_no') {
            // Check if phone number has exactly 10 digits
            const isValidPhone = value.length === 10 && /^\d+$/.test(value);
            updateState({ isTelephoneValid: isValidPhone });

            // Show save button only if customer code is filled AND phone number has 10 digits
            const customerCode = formData.customer_code || autoCustomerCode;
            updateState({
                showSavePhoneButton: customerCode.trim().length > 0 && isValidPhone
            });
        }

        if (field === 'supplier_code') setFormData(prev => ({ ...prev, supplier_code: value }));
        if (field === "given_amount") {
            updateState({ isGivenAmountManuallyTouched: true });
        }
    };
    const handleItemSelect = (selectedOption) => {
        if (selectedOption) {
            const { item } = selectedOption;
            const fetchedPackDue = parseFloat(item?.pack_due) || 0;
            const fetchedPackCost = parseFloat(item?.pack_cost) || 0;

            // Grab instant values from input references to bypass React state sync lags
            const liveWeightVal = refs.weight.current ? refs.weight.current.value : formData.weight;
            const livePacksVal = refs.packs.current ? refs.packs.current.value : formData.packs;

            const parsedWeight = parseFloat(liveWeightVal) || 0;
            const parsedPacks = parseInt(livePacksVal) || 0;

            // Update form data synchronously with new item codes AND live grid values
            setFormData(prev => ({
                ...prev,
                item_code: item.no,
                item_name: item.type,
                pack_due: fetchedPackDue,
                weight: liveWeightVal,
                packs: livePacksVal
            }));

            updateState({
                packCost: fetchedPackCost,
                itemSearchInput: "",
                gridPricePerKg: formData.price_per_kg || "",
                isKuliyaManuallyChanged: false  // ← ADD THIS LINE - Reset manual flag when item changes
            });

            // Trigger calculation immediately using parsed metrics
            if (parsedWeight > 0 && parsedPacks > 0) {
                // Show a value instantly from the local formula, then confirm with the backend
                const instantKuliya = calculateKuliyaLocally(item.no, item.type, parsedWeight, parsedPacks, items);
                if (instantKuliya !== undefined) {
                    setFormData(prev => ({ ...prev, kuliya: instantKuliya }));
                }

            }

            refs.weight.current?.focus();
        } else {
            setFormData(prev => ({
                ...prev,
                item_code: "",
                item_name: "",
                pack_due: ""
            }));
            updateState({ packCost: 0, itemSearchInput: "", isKuliyaManuallyChanged: false }); // Also reset here
        }
    };

    const handleCustomerSelect = (selectedOption) => {
        const short = selectedOption ? selectedOption.value : "";
        const customer = customers.find(x => String(x.short_name) === String(short));
        updateState({ selectedUnprintedCustomer: unprintedCustomers.includes(short) ? short : null, selectedPrintedCustomer: null, customerSearchInput: "" });
        const existingGivenAmount = allSales.find(s => s.customer_code === short)?.given_amount || "";
        setFormData(prev => ({ ...prev, customer_code: short || "", customer_name: customer?.name || "", given_amount: existingGivenAmount }));
        fetchLoanAmount(short);
        updateState({ isManualClear: false });
        refs.price_per_kg.current?.focus();
        refs.price_per_kg.current?.select();
    };
    //function to display customer image
    const handleImageClick = (entityType) => {
        const code = entityType === 'customer' ? (formData.customer_code || autoCustomerCode) : formData.supplier_code;
        const list = entityType === 'customer' ? customers : suppliers;

        const person = list.find(p =>
            String(entityType === 'customer' ? p.short_name : p.code).toUpperCase() === String(code).toUpperCase()
        );

        if (person) {
            updateState({
                isImageModalOpen: true,
                selectedImageData: {
                    profile: entityType === 'customer' ? state.customerProfilePic : state.supplierProfilePic,
                    nic_front: person.nic_front,
                    nic_back: person.nic_back,
                    title: person.name || code,
                    type: entityType // <--- ADD THIS LINE
                }
            });
        }
    };

    // Rows of the "All Sales Records" table are rebuilt only when the data or the selected
    // record changes, not on every keystroke in the entry form
    const allSalesRows = useMemo(() => (
        sortedAllSalesRecords.map((sale, index) => (
                                                            <tr
                                                                key={sale.id || index}
                                                                onClick={() => editClickRef.current?.(sale)}
                                                                style={{
                                                                    borderBottom: "1px solid #2a2a3e",
                                                                    cursor: "pointer",
                                                                    opacity: sale._pending ? 0.55 : 1,
                                                                    backgroundColor:
                                                                        editingSaleId === sale.id
                                                                            ? "#1e3a5f"
                                                                            : "transparent",
                                                                    transition: "background-color 0.2s"
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    if (editingSaleId !== sale.id) {
                                                                        e.currentTarget.style.backgroundColor = "#252540";
                                                                    }
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    if (editingSaleId !== sale.id) {
                                                                        e.currentTarget.style.backgroundColor = "transparent";
                                                                    }
                                                                }}
                                                            >
                                                                <td style={{ padding: "8px" }}>
                                                                    {sale.bill_no || "-"}
                                                                </td>

                                                                <td style={{ padding: "8px", fontWeight: "500" }}>
                                                                    {sale.customer_code || "-"}
                                                                </td>

                                                                <td style={{ padding: "8px" }}>
                                                                    {sale.supplier_code || "-"}
                                                                </td>

                                                                <td style={{ padding: "8px" }}>
                                                                    {sale.item_code || "-"}
                                                                </td>

                                                                <td
                                                                    style={{
                                                                        padding: "8px",
                                                                        maxWidth: "150px",
                                                                        overflow: "hidden",
                                                                        textOverflow: "ellipsis",
                                                                        whiteSpace: "nowrap"
                                                                    }}
                                                                    title={sale.item_name}
                                                                >
                                                                    {sale.item_name || "-"}
                                                                </td>

                                                                <td style={{ padding: "8px", textAlign: "right" }}>
                                                                    {formatDecimal(sale.weight)}
                                                                </td>

                                                                <td style={{ padding: "8px", textAlign: "right" }}>
                                                                    {formatDecimal(sale.price_per_kg)}
                                                                </td>

                                                                <td style={{ padding: "8px", textAlign: "right" }}>
                                                                    {sale.packs || "0"}
                                                                </td>

                                                                <td
                                                                    style={{
                                                                        padding: "8px",
                                                                        textAlign: "right",
                                                                        color:
                                                                            sale.Kuliya > 0
                                                                                ? "#ffd700"
                                                                                : "#888"
                                                                    }}
                                                                >
                                                                    {formatDecimal(sale.Kuliya || 0)}
                                                                </td>

                                                                <td
                                                                    style={{
                                                                        padding: "8px",
                                                                        textAlign: "right",
                                                                        fontWeight: "bold",
                                                                        color: "#4ade80"
                                                                    }}
                                                                >
                                                                    {formatDecimal(sale.total || 0)}
                                                                </td>
                                                            </tr>
                                                        ))
    ), [sortedAllSalesRecords, editingSaleId]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleEditClick = (sale) => {
        if (hasPending(sale)) return; // still saving: can be opened a moment later
        // If same record clicked again → clear fields EXCEPT customer/contact fields
        if (state.editingSaleId === sale.id) {
            setFormData((prev) => ({
                ...prev,
                customer_code: sale.customer_code || "",
                customer_name: sale.customer_name || "",
                telephone_no: prev.telephone_no || "",
                supplier_code: "",
                item_code: "",
                item_name: "",
                weight: "",
                price_per_kg: "",
                pack_due: "",
                total: "",
                packs: "",
                kuliya: ""  // ← ADD THIS
            }));

            updateState({
                editingSaleId: null,
                isManualClear: true,
                priceManuallyChanged: false,
                gridPricePerKg: "",
                selectedSaleForBreakdown: null,
                editingGroup: null,
                isKuliyaManuallyChanged: false  // ← ADD THIS
            });

            setTimeout(() => {
                refs.supplier_code?.current?.focus();
                refs.supplier_code?.current?.select();
            }, 0);

            return;
        }

        // === Normal behavior when selecting a record to edit ===
        let fetchedPackDue = sale.pack_due || "";
        if (sale.item_code) {
            const matchingItem = items.find(i => String(i.no) === String(sale.item_code));
            fetchedPackDue = parseFloat(matchingItem?.pack_due) || sale.pack_due || "";
        }

        setFormData((prev) => ({
            ...sale,
            item_name: sale.item_name || "",
            customer_code: sale.customer_code || "",
            customer_name: sale.customer_name || "",
            telephone_no: sale.telephone_no || prev.telephone_no || "",
            supplier_code: sale.supplier_code || "",
            item_code: sale.item_code || "",
            weight: sale.weight || "",
            price_per_kg: sale.price_per_kg || "",
            pack_due: fetchedPackDue,
            total: sale.total || "",
            packs: sale.packs || "",
            kuliya: sale.Kuliya || ""  // ← ADD THIS
        }));
        kuliyaBaseRef.current = { packs: String(sale.packs ?? ""), item_code: sale.item_code };
        updateState({
            editingSaleId: sale.id,
            isManualClear: false,
            priceManuallyChanged: false,
            gridPricePerKg: sale.price_per_kg || "",
            selectedSaleForBreakdown: sale,
            editingGroup: sale.group_members && sale.group_members.length > 1 ? sale.group_members : null,
            isKuliyaManuallyChanged: false  // ← ADD THIS
        });

        // FIX: Set focus to weight field and ensure Enter key navigation works
        setTimeout(() => {
            if (refs.weight.current) {
                refs.weight.current.focus();
                // Select the text so user can type over it if they want
                refs.weight.current.select();

                // Add a one-time keydown listener to handle Enter when value hasn't changed
                const handleWeightEnter = (e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        // Remove this listener to avoid duplicates
                        refs.weight.current.removeEventListener('keydown', handleWeightEnter);
                        // Move focus to price field
                        if (refs.price_per_kg_grid_item.current) {
                            refs.price_per_kg_grid_item.current.focus();
                            refs.price_per_kg_grid_item.current.select();
                        }
                    }
                };

                // Remove any existing listener first to avoid duplicates
                refs.weight.current.removeEventListener('keydown', handleWeightEnter);
                // Add the new listener
                refs.weight.current.addEventListener('keydown', handleWeightEnter);
            }
        }, 0);
    };

    editClickRef.current = handleEditClick;

    const handleClearForm = (clearBillNo = false) => {
        setFormData(initialFormData);
        updateState({
            editingSaleId: null,
            loanAmount: 0,
            isManualClear: false,
            packCost: 0,
            customerSearchInput: "",
            itemSearchInput: "",
            supplierSearchInput: "",
            priceManuallyChanged: false,
            isKuliyaManuallyChanged: false,  // ← ADD THIS
            gridPricePerKg: "",
            isGivenAmountManuallyTouched: false,
            selectedSaleForBreakdown: null,
            editingGroup: null,
            ...(clearBillNo && { currentBillNo: null })
        });
    };
    const handleDeleteRecord = async (saleId, groupIds = null) => {
        const ids = groupIds && groupIds.length > 0 ? groupIds : [saleId];
        if (ids.some(isTempId)) return; // still saving
        const question = ids.length > 1
            ? tr(`Delete all ${ids.length} entries in this row?`, `මෙම පේළියේ ඇතුළත් කිරීම් ${ids.length} ම මකන්නද?`)
            : "Are you sure you want to delete this sales record?";
        if (!saleId || !window.confirm(question)) return;
        try {
            for (const id of ids) await api.delete(`${routes.sales}/${id}`);
            await fetchAllSalesRecords();
            updateState({ allSales: allSales.filter(s => !ids.includes(s.id)) });
            if (ids.includes(editingSaleId)) handleClearForm();
        } catch (error) { updateState({ errors: { form: error.response?.data?.message || error.message } }); }
    };

    const handleSubmitGivenAmount = async (e) => {
        if (e) e.preventDefault();
        updateState({ errors: {} });

        const customerCode = (formData.customer_code || autoCustomerCode).trim().toUpperCase();
        if (!customerCode) return null;

        const salesToUpdate = displayedSales.filter(s => s.id);
        if (salesToUpdate.length === 0) return null;

        try {
            // 1. Get the entered amount
            const currentInputAmount = parseFloat(formData.given_amount.toString().replace(/,/g, "")) || 0;

            // 2. DETECT CREDIT STATUS based on your calculated logic
            // We calculate it here to know if we should block the process before the API call
            const totals = salesToUpdate.reduce((acc, s) => {
                const weight = parseFloat(s.weight) || 0;
                const price = parseFloat(s.price_per_kg) || 0;
                const packs = parseFloat(s.packs) || 0;
                const pCost = parseFloat(s.CustomerPackCost) || 0;
                const pLabour = parseFloat(s.CustomerPackLabour) || 0;
                acc.billTotal += (weight * price);
                acc.totalBagPrice += (packs * pCost);
                acc.totalLabour += (packs * pLabour);
                return acc;
            }, { billTotal: 0, totalBagPrice: 0, totalLabour: 0 });

            const autoCalculatedGrandTotal = totals.billTotal + totals.totalBagPrice;
            const isCredit = Math.abs(currentInputAmount - autoCalculatedGrandTotal) > 0.01;
            const creditTransactionStatus = isCredit ? 'Y' : 'N';

            // 4. PROCEED: Update database with the determined status
            const updatePromises = salesToUpdate.map(sale =>
                api.put(`${routes.sales}/${sale.id}/given-amount`, {
                    given_amount: currentInputAmount,
                    credit_transaction: creditTransactionStatus
                })
            );

            const results = await Promise.all(updatePromises);
            updateState({ isGivenAmountManuallyTouched: false });

            const updatedSalesFromApi = results.map(response => response.data.sale);
            const updatedSalesMap = {};
            updatedSalesFromApi.forEach(sale => { updatedSalesMap[sale.id] = sale; });

            updateState({
                allSales: allSales.map(s => updatedSalesMap[s.id] ? updatedSalesMap[s.id] : s)
            });

            return updatedSalesFromApi;
        } catch (error) {
            updateState({ errors: { form: error.response?.data?.message || error.message } });
            return null;
        }
    };
    // Save an edit made on a grouped table row. The entries stay separate records:
    //  - price / item / supplier / customer changes go to every entry
    //  - a change in total weight, bags or kuliya goes onto the first entry, so the
    //    row total matches what was typed (the admin SMS is sent for that entry only)
    const handleGroupSubmit = async (members) => {
        const ordered = members.slice().sort((a, b) => (a.id || 0) - (b.id || 0));
        const [first, ...rest] = ordered;
        const sumOf = (list, k) => list.reduce((t, m) => t + (parseFloat(m[k]) || 0), 0);
        const round3 = (v) => Math.round(v * 1000) / 1000;

        const customerCode = (formData.customer_code || autoCustomerCode).toUpperCase();
        const newWeight = parseFloat(formData.weight) || 0;
        const newPacks = parseFloat(formData.packs) || 0;
        const price = parseFloat(formData.price_per_kg) || 0;
        const packDue = parseFloat(formData.pack_due) || 0;

        const firstWeight = round3(newWeight - sumOf(rest, 'weight'));
        const firstPacks = newPacks - sumOf(rest, 'packs');
        if (firstWeight < 0 || firstPacks < 0) {
            updateState({ errors: { form: tr('Weight or bags cannot be less than the other entries in this row. Delete entries instead.', 'බර හෝ මලු මෙම පේළියේ අනෙක් ඇතුළත් කිරීම් වලට වඩා අඩු විය නොහැක. ඒ වෙනුවට ඇතුළත් කිරීම් මකන්න.') } });
            return;
        }

        const totalsChanged = Math.abs(newWeight - sumOf(ordered, 'weight')) > 0.0005 || newPacks !== sumOf(ordered, 'packs');
        let firstKuliya;
        if (state.isKuliyaManuallyChanged && formData.kuliya !== '' && formData.kuliya !== null) {
            firstKuliya = Math.round(((parseFloat(formData.kuliya) || 0) - sumOf(rest, 'Kuliya')) * 100) / 100;
            if (firstKuliya < 0) {
                updateState({ errors: { form: tr('Kuliya cannot be less than the other entries in this row.', 'කුලිය මෙම පේළියේ අනෙක් ඇතුළත් කිරීම් වලට වඩා අඩු විය නොහැක.') } });
                return;
            }
        } else {
            firstKuliya = totalsChanged ? null : (parseFloat(first.Kuliya) || 0); // null = server recalculates
        }

        const shared = {
            supplier_code: (formData.supplier_code || '').toUpperCase(),
            customer_code: customerCode,
            customer_name: formData.customer_name,
            item_code: formData.item_code,
            item_name: formData.item_name,
            price_per_kg: price,
            pack_due: packDue,
            given_amount: formData.given_amount ? parseFloat(formData.given_amount) : null,
            update_related_price: false,
        };
        const sharedChanged = price !== (parseFloat(first.price_per_kg) || 0)
            || shared.item_code !== first.item_code
            || shared.supplier_code !== (first.supplier_code || '').toUpperCase()
            || shared.customer_code !== (first.customer_code || '').toUpperCase();

        const requests = [api.put(`${routes.sales}/${first.id}`, {
            ...shared, weight: firstWeight, packs: firstPacks, kuliya: firstKuliya,
            total: firstWeight * price + firstPacks * packDue,
        })];
        if (sharedChanged) {
            rest.forEach(m => {
                const w = parseFloat(m.weight) || 0, p = parseFloat(m.packs) || 0;
                requests.push(api.put(`${routes.sales}/${m.id}`, {
                    ...shared, weight: w, packs: p, kuliya: parseFloat(m.Kuliya) || 0,
                    total: w * price + p * packDue, group_follow_up: true,
                }));
            });
        }

        setFormData({ ...initialFormData, customer_code: customerCode, customer_name: formData.customer_name, telephone_no: formData.telephone_no, supplier_code: formData.supplier_code });
        updateState({ errors: {}, editingSaleId: null, editingGroup: null, isManualClear: false, priceManuallyChanged: false, gridPricePerKg: "", selectedSaleForBreakdown: null, isKuliyaManuallyChanged: false });
        refs.supplier_code.current?.focus();
        refs.supplier_code.current?.select();

        const tracked = Promise.allSettled(requests);
        pendingSaveRequestsRef.current.push(tracked);
        try {
            const results = await tracked;
            const updated = results.filter(r => r.status === 'fulfilled')
                .flatMap(r => r.value.data.sales || [r.value.data.sale || r.value.data.data].filter(Boolean));
            const updatedIds = updated.map(s => s.id);
            setState(prev => ({ ...prev, allSales: prev.allSales.filter(s => !updatedIds.includes(s.id)).concat(updated) }));
            const failed = results.find(r => r.status === 'rejected');
            if (failed) {
                updateState({ errors: { form: failed.reason?.response?.data?.message || failed.reason?.message || tr('Some entries could not be updated', 'සමහර ඇතුළත් කිරීම් යාවත්කාලීන කළ නොහැකි විය') } });
            }
            fetchAllSalesRecords();
        } finally {
            pendingSaveRequestsRef.current = pendingSaveRequestsRef.current.filter(p => p !== tracked);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        // NOTE: no isSubmitting guard here — each Enter press is a distinct, legitimate
        // record. Rapid typing must let every one of them fire its own save request
        // concurrently; blocking on a shared flag silently drops records that were
        // never actually sent to the server. Safety against clobbering state when
        // several saves resolve out of order is handled below via functional setState.

        // --- 1. VALIDATION LOGIC ---
        const requiredFields = [
            { key: "customer_code", ref: "customer_code_input", label: "Customer Code" },
            { key: "supplier_code", ref: "supplier_code", label: "Supplier Code" },
            { key: "item_code", ref: "item_code_select", label: "Item" },
            { key: "weight", ref: "weight", label: "Weight" },
            { key: "packs", ref: "packs", label: "Packs" }
        ];

        for (const field of requiredFields) {
            const value = formData[field.key];
            if (value === null || value === undefined || value.toString().trim() === "") {
                updateState({ errors: { form: tr(`Please enter ${field.label}`, `කරුණාකර ${field.label} ඇතුළත් කරන්න`) } });
                const targetRef = refs[field.ref];
                if (targetRef?.current) {
                    targetRef.current.focus();
                    if (!field.ref.includes("select")) targetRef.current.select();
                }
                return;
            }
        }

        // --- 2. PRE-FLIGHT PREPARATION ---
        // Capture these now so they are available for the reset after the async gap
        const isEditing = editingSaleId !== null;

        // Editing a grouped row (several entries shown as one) updates each entry
        if (isEditing && state.editingGroup && state.editingGroup.length > 1) {
            await handleGroupSubmit(state.editingGroup);
            return;
        }

        // Printed bills are closed: existing records can still be edited, but no new ones added
        if (!isEditing && selectedPrintedCustomer) {
            updateState({ errors: { form: tr('Cannot add new records to a printed bill', 'මුද්‍රණය කළ බිලට නව වාර්තා එක් කළ නොහැක') } });
            return;
        }
        const customerCode = (formData.customer_code || autoCustomerCode).toUpperCase();
        const currentSupplierCode = formData.supplier_code;
        const currentCustomerName = formData.customer_name;
        const currentTelephone = formData.telephone_no;
        const shouldUpdateRelatedPrice = state.priceManuallyChanged;

        // --- 3. BILLING LOGIC ---
        let billPrintedStatus = undefined, billNoToUse = null;
        if (!isEditing) {
            if (state.currentBillNo) {
                billPrintedStatus = 'Y';
                billNoToUse = state.currentBillNo;
            } else if (selectedPrintedCustomer) {
                billPrintedStatus = 'Y';
                billNoToUse = selectedPrintedCustomer.includes('-')
                    ? selectedPrintedCustomer.split('-')[1]
                    : printedSales.find(s => s.customer_code === selectedPrintedCustomer)?.bill_no;
            } else if (selectedUnprintedCustomer) {
                billPrintedStatus = 'N';
            }
        }

        const payload = {
            supplier_code: currentSupplierCode.toUpperCase(),
            customer_code: customerCode,
            customer_name: currentCustomerName,
            item_code: formData.item_code,
            item_name: formData.item_name,
            weight: parseFloat(formData.weight) || 0,
            price_per_kg: parseFloat(formData.price_per_kg) || 0,
            pack_due: parseFloat(formData.pack_due) || 0,
            total: parseFloat(formData.total) || 0,
            packs: parseFloat(formData.packs) || 0,
            given_amount: formData.given_amount ? parseFloat(formData.given_amount) : null,
            kuliya: formData.kuliya ? parseFloat(formData.kuliya) : null,
            ...(billPrintedStatus && { bill_printed: billPrintedStatus }),
            ...(billNoToUse && { bill_no: billNoToUse }),
            update_related_price: shouldUpdateRelatedPrice
        };

        const url = isEditing ? `${routes.sales}/${editingSaleId}` : routes.sales;
        const method = isEditing ? "put" : "post";

        // --- INSTANT UI RESET: clear the form and jump the cursor to supplier_code right away
        // so data entry isn't blocked — but the table itself only updates once the record is
        // actually confirmed saved below, never before. ---
        setFormData({ ...initialFormData, customer_code: customerCode, customer_name: currentCustomerName, telephone_no: currentTelephone, supplier_code: currentSupplierCode });
        updateState({ errors: {}, editingSaleId: null, isManualClear: false, priceManuallyChanged: false, gridPricePerKg: "" });
        if (refs.supplier_code.current) {
            refs.supplier_code.current.focus();
            refs.supplier_code.current.select();
        }

        // --- 4. SHOW IT AT ONCE: the record appears in the table straight away (marked as
        // saving) and is replaced by the database record when the server confirms it ---
        const item = items.find(i => String(i.no) === String(payload.item_code));
        const bagWeight = (parseFloat(item?.bag_real_price) || 0) * payload.packs;
        const netWeight = payload.weight - bagWeight;
        const shownFields = {
            ...payload,
            weight: netWeight,
            SupplierWeight: netWeight,
            total: netWeight * payload.price_per_kg,
            Kuliya: payload.kuliya !== null && payload.kuliya !== undefined ? payload.kuliya : payload.packs * KULIYA_PER_BAG,
            CustomerPackCost: parseFloat(item?.pack_cost) || 0,
            CustomerPackLabour: parseFloat(item?.pack_due) || 0,
            _pending: true,
        };
        const tempId = isEditing ? null : nextTempId();
        if (isEditing) {
            commitSales(list => list.map(s => (s.id === editingSaleId ? { ...s, ...shownFields } : s)));
        } else {
            commitSales(list => list.concat({
                ...shownFields,
                id: tempId,
                bill_printed: billPrintedStatus,
                bill_no: billNoToUse,
                created_at: new Date().toISOString(),
                breakdown_history: [{ time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), weight: payload.weight, packs: payload.packs }],
            }));
        }

        // --- 5. SAVE: several saves can run at once while typing fast. F1/F5 wait for the
        // ones still running, so a bill never misses a record. ---
        const saveTask = (async () => {
            try {
                const response = await api[method](url, payload);
                const updatedSales = response.data.sales || [response.data.sale || response.data.data || response.data];
                const updatedIds = updatedSales.map(s => s.id);
                commitSales(list => list
                    .filter(s => s.id !== tempId && !updatedIds.includes(s.id))
                    .concat(updatedSales));
            } catch (error) {
                if (tempId) commitSales(list => list.filter(s => s.id !== tempId));
                updateState({
                    errors: { form: error.response?.data?.message || error.message || "An error occurred" }
                });
                if (isEditing) fetchSalesOnly({ force: true }); // put the real values back
            }
        })();
        pendingSaveRequestsRef.current.push(saveTask);
        try {
            await saveTask;
        } finally {
            pendingSaveRequestsRef.current = pendingSaveRequestsRef.current.filter(p => p !== saveTask);
        }
    };
    const handleCustomerClick = async (type, customerCode, billNo = null, salesRecords = []) => {
        return handleCustomerClickImpl(type, customerCode, billNo, salesRecords);
    };
    customerClickRef.current = handleCustomerClick;
    const handleCustomerClickImpl = async (type, customerCode, billNo = null, salesRecords = []) => {
        if (state.isPrinting) return;

        if (currentUser?.role === 'Admin') {
            console.log("Admin user clicked customer:", { customerCode, billNo, salesRecords });
            console.log("adminViewRef current:", adminViewRef.current);

            // Call the function from AdminView to open customer bill modal
            if (adminViewRef.current && adminViewRef.current.openCustomerBill) {
                adminViewRef.current.openCustomerBill(customerCode, billNo, salesRecords);
            } else {
                console.error("AdminView ref not available", adminViewRef.current);
                alert("Customer bill view is loading. Please try again.");
            }
            return;
        }

        const isPrinted = type === 'printed';
        let selectionKey = customerCode;
        if (isPrinted && billNo) selectionKey = `${customerCode}-${billNo}`;
        const isCurrentlySelected = isPrinted ? selectedPrintedCustomer === selectionKey : selectedUnprintedCustomer === selectionKey;

        if (isPrinted) {
            updateState({
                selectedPrintedCustomer: isCurrentlySelected ? null : selectionKey,
                selectedUnprintedCustomer: null,
                currentBillNo: isCurrentlySelected ? null : billNo
            });
        } else {
            updateState({
                selectedUnprintedCustomer: isCurrentlySelected ? null : selectionKey,
                selectedPrintedCustomer: null,
                currentBillNo: null
            });
        }

        const customer = customers.find(x => String(x.short_name).toUpperCase() === String(customerCode).toUpperCase());

        if (!isCurrentlySelected) {
            // --- NEW CALCULATION LOGIC FOR GIVEN AMOUNT ---
            // We calculate the sum of the records that are about to be displayed
            const totals = salesRecords.reduce((acc, s) => {
                const weight = parseFloat(s.weight) || 0;
                const price = parseFloat(s.price_per_kg) || 0;
                const packs = parseFloat(s.packs) || 0;
                const pCost = parseFloat(s.CustomerPackCost) || 0;

                acc.billTotal += (weight * price);
                acc.totalBagPrice += (packs * pCost);

                return acc;
            }, { billTotal: 0, totalBagPrice: 0, totalLabour: 0 });

            const calculatedFinal = totals.billTotal + totals.totalBagPrice;

            try {
                let fetchedGivenAmount = "";
                // If it's a printed bill, try to fetch the amount already stored
                if (isPrinted) {
                    try {
                        const response = await api.get(`${routes.getCustomerGivenAmount}/${customerCode}`);
                        fetchedGivenAmount = response.data?.given_amount ?? calculatedFinal.toFixed(2);
                    } catch (error) {
                        fetchedGivenAmount = salesRecords[0]?.given_amount || calculatedFinal.toFixed(2);
                    }
                }

                setFormData({
                    ...initialFormData,
                    customer_code: customerCode,
                    customer_name: customer?.name || "",
                    telephone_no: customer?.telephone_no || "",
                    given_amount: fetchedGivenAmount // This fills the field immediately
                });

                fetchLoanAmount(customerCode);
                refs.supplier_code.current?.focus();

            } catch (error) {
                setFormData({
                    ...initialFormData,
                    customer_code: customerCode,
                    customer_name: customer?.name || "",
                    telephone_no: customer?.telephone_no || "",
                    given_amount: calculatedFinal.toFixed(2)
                });
                fetchLoanAmount(customerCode);
            }
        } else {
            handleClearForm();
        }

        updateState({ editingSaleId: null, isManualClear: false, customerSearchInput: "", priceManuallyChanged: false, gridPricePerKg: "" });
    };
    // F5 hold: the screen clears at once; the hold is saved in the background
    const holdInFlightRef = useRef(false);
    const handleMarkAllProcessed = async () => {
        if (holdInFlightRef.current) return;
        holdInFlightRef.current = true;
        try {
            // Records still being saved must be on the server before the hold
            const pendingSaves = pendingSaveRequestsRef.current.slice();
            if (pendingSaves.length > 0) await Promise.allSettled(pendingSaves);

            const current = allSalesRef.current;
            const salesToProcess = current.filter(s => s.id && !isTempId(s.id) && s.bill_printed !== 'Y');
            if (salesToProcess.length === 0) return;
            const ids = new Set(salesToProcess.map(s => s.id));

            commitSales(list => list.map(s => (ids.has(s.id) ? { ...s, bill_printed: "N" } : s)));
            handleClearForm();
            updateState({ selectedUnprintedCustomer: null, selectedPrintedCustomer: null });
            refs.customer_code_input.current?.focus();

            try {
                const response = await api.post(routes.markAllProcessed, { sales_ids: [...ids] });
                if (!response.data.success) throw new Error(response.data.message || 'Hold failed');
            } catch (err) {
                console.error("Failed to mark sales as processed:", err.message);
                updateState({ errors: { form: tr('Hold (F5) failed, please press F5 again.', 'රඳවා ගැනීම (F5) අසාර්ථකයි, නැවත F5 ඔබන්න.') } });
                fetchSalesOnly({ force: true });
            }
        } finally {
            holdInFlightRef.current = false;
        }
    };
    const printSingleContent = async (html, customerName) => {
        return new Promise((resolve) => {
            const printWindow = window.open('', '_blank', 'width=800,height=600');
            if (!printWindow) { alert("Please allow pop-ups for printing"); resolve(); return; }
            printWindow.document.open();
            printWindow.document.write(`<!DOCTYPE html><html><head><title>Print Bill - ${customerName}</title><style>body { margin: 0; padding: 20px; }@media print { body { padding: 0; } }</style></head><body>${html}<script>window.onload = function() { setTimeout(function() { window.print(); setTimeout(function() { window.close(); }, 1000); }, 500); }; window.onafterprint = function() { setTimeout(function() { window.close(); }, 500); };</script></body></html>`);
            printWindow.document.close();
            const checkPrintWindow = setInterval(() => { if (printWindow.closed) { clearInterval(checkPrintWindow); resolve(); } }, 500);
            setTimeout(() => { clearInterval(checkPrintWindow); if (!printWindow.closed) printWindow.close(); resolve(); }, 10000);
        });
    };

    const buildFullReceiptHTML = (salesData, billNo, customerName, mobile, globalLoanAmount = 0, billSize = '3inch') => {
        return ThermalBillHTML({ salesData, billNo, customerName, mobile, globalLoanAmount, billSize });
    };

    const formatReceiptValue = (value) => {
        if (value === null || value === undefined || value === '') return '0.00';
        const num = parseFloat(value);
        if (isNaN(num)) return '0.00';
        return num.toFixed(2);
    };
    const buildA4ReceiptHTML = (salesData, billNo, customerName, mobile, globalLoanAmount = 0) => {
        return A4BillHTML({ salesData, billNo, customerName, mobile, globalLoanAmount });
    };

    // F2 quick preview: shows the bill exactly as F1 would print it, built straight from
    // the currently displayed sales (no server refetch), in a small modal — no print dialog.
    const renderBillPreviewModal = () => {
        if (!state.showBillPreview) return null;
        if (displayedSales.length === 0) return null;

        const onClose = () => updateState({ showBillPreview: false });

        const printData = state.isBulkPrintEnabled
            ? combineSalesForPrinting(displayedSales)
            : displayedSales.map(s => ({ ...s, original_ids: [s.id] }));
        const customerName = displayedSales[0]?.customer_code || "N/A";
        const mobile = formData.telephone_no || SHOP_PHONE;
        const currentLoan = loanAmount || 0;
        const isA4 = printMode === 'a4';
        const previewHtml = isA4
            ? buildA4ReceiptHTML(printData, currentBillNo || "N/A", customerName, mobile, currentLoan)
            : buildFullReceiptHTML(printData, currentBillNo || "N/A", customerName, mobile, currentLoan, billSize);

        return (
            <div
                style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
                onClick={onClose}
            >
                <div
                    style={{ backgroundColor: '#ffffff', borderRadius: '12px', width: '95%', maxWidth: isA4 ? '650px' : '380px', maxHeight: '90vh', padding: '0', position: 'relative', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#111439' }}>
                        <span style={{ color: 'white', fontWeight: 'bold', fontSize: '14px' }}>
                            {tr('Bill Preview (F2)', 'බිල් පෙරදසුන (F2)')} — {customerName}
                        </span>
                        <button
                            onClick={onClose}
                            style={{ background: '#374151', border: 'none', color: 'white', width: '28px', height: '28px', borderRadius: '50%', cursor: 'pointer', fontSize: '14px' }}
                        > ✕ </button>
                    </div>
                    <div style={{ overflowY: 'auto', padding: '16px', backgroundColor: '#f1f1f1' }}>
                        <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    </div>
                    <div style={{ padding: '12px 16px', borderTop: '1px solid #ddd', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button
                            onClick={() => { onClose(); handlePrintAndClear(); }}
                            style={{ padding: '8px 18px', backgroundColor: '#ffc107', color: '#343a40', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                        >🖨️ Print (F1)</button>
                        <button
                            onClick={onClose}
                            style={{ padding: '8px 18px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                        >Close</button>
                    </div>
                </div>
            </div>
        );
    };

    // In your SalesEntry component, modify the handlePrintAndClear function:

    const handlePrintAndClear = async () => {
        // If any record submitted moments ago is still mid-request, wait for it to land
        // before deciding what belongs on this bill — otherwise it can get left out.
        const pendingSaves = pendingSaveRequestsRef.current.slice();
        if (pendingSaves.length > 0) {
            await Promise.allSettled(pendingSaves);
        }

        // Every record on screen is the server's saved copy (save responses + polling), and the
        // saves above have finished, so the bill is built at once without a full download.
        const freshAllSales = allSalesRef.current.filter(s => !isTempId(s.id));

        // Recompute the same selection the sidebar/table currently shows, against fresh data
        const freshNewSales = freshAllSales.filter(s => s.id && s.bill_printed !== 'Y' && s.bill_printed !== 'N');
        const freshUnprintedSales = freshAllSales.filter(s => s.bill_printed === 'N' || !s.bill_printed || s.bill_printed === '');
        const freshPrintedSales = freshAllSales.filter(s => s.bill_printed === 'Y');

        let salesData = freshNewSales;
        if (selectedUnprintedCustomer) {
            salesData = [...salesData, ...freshUnprintedSales.filter(s => s.customer_code === selectedUnprintedCustomer)];
        } else if (selectedPrintedCustomer) {
            if (selectedPrintedCustomer.includes('-')) {
                const [cCode, bNo] = selectedPrintedCustomer.split('-');
                salesData = [...salesData, ...freshPrintedSales.filter(s => s.customer_code === cCode && String(s.bill_no) === String(bNo))];
            } else {
                salesData = [...salesData, ...freshPrintedSales.filter(s => s.customer_code === selectedPrintedCustomer)];
            }
        }

        const seenIds = new Set();
        salesData = salesData.filter(s => {
            if (!s.id || seenIds.has(s.id)) return false;
            seenIds.add(s.id);
            return true;
        });

        if (!salesData.length) {
            alert(tr('No data to print!', 'මුද්‍රණය කිරීමට දත්ත නොමැත!'));
            return;
        }

        // Bulk Printing ticked: records with the same item and price are one line (any
        // supplier). Unticked: every record is its own line.
        const printData = state.isBulkPrintEnabled
            ? combineSalesForPrinting(salesData)
            : salesData.map(s => ({ ...s, original_ids: [s.id] }));

        // --- ZERO PRICE VALIDATION ---
        const hasZeroPrice = printData.some(s => parseFloat(s.price_per_kg) === 0);
        if (hasZeroPrice) {
            alert(tr('Items with a price of 0 cannot be printed.', 'මිල 0 ලෙස ඇති අයිතම මුද්‍රණය කළ නොහැක.'));
            return;
        }

        const customerCode = salesData[0].customer_code || "N/A";
        const customerName = salesData[0].customer_code || salesData[0].customer_code || customerCode;
        const mobile = salesData[0].mobile || SHOP_PHONE;

        // Reuse the loan amount already tracked in state (kept fresh as the customer is
        // selected/typed via fetchLoanAmount) instead of re-fetching it here.
        const currentLoan = loanAmount || 0;

        // Get original IDs for marking as printed
        const idsToMark = printData.flatMap(s => s.original_ids);

        // Compute the same bill total shown as "එකතුව" on the receipt (weight*price + pack cost + Kuliya,
        // grouped by row id the same way ThermalBillHTML groups it) so the spoken amount matches the print.
        const billFinalTotal = printData.reduce((sum, s) => {
            const weight = parseFloat(s.weight) || 0;
            const price = parseFloat(s.price_per_kg) || 0;
            const packs = parseInt(s.packs) || 0;
            const packCost = parseFloat(s.CustomerPackCost) || 0;
            const kuliya = parseFloat(s.Kuliya) || 0;
            return sum + (weight * price) + (packs * packCost) + kuliya;
        }, 0);

        // FIXED: Use the printMode prop to determine which template to use
        const buildReceipt = (billNo) => (printMode === 'a4'
            ? buildA4ReceiptHTML(printData, billNo, customerName, mobile, currentLoan)
            : buildFullReceiptHTML(printData, billNo, customerName, mobile, currentLoan, billSize));

        // Open the app's own print window. The bill number is given when Print is pressed;
        // a reprint already has its number.
        const previewBillNo = salesData.find(s => s.bill_no)?.bill_no || "—";
        setPrintJob({
            previewHtml: buildReceipt(previewBillNo),
            buildReceipt,
            customerCode,
            customerName,
            currentLoan,
            idsToMark,
            telephoneNo: formData.telephone_no,
            billFinalTotal,
            busy: false,
            error: '',
        });
    };

    // Cancel in the print window: nothing was marked, the bill stays where it is
    const handleCancelPrintJob = () => {
        setPrintJob(null);
        refs.customer_code_input.current?.focus();
    };

    // Print in the print window: mark printed (bill number + SMS), then print
    const executePrintJob = async () => {
        const job = printJob;
        if (!job || job.busy) return;

        setPrintJob(prev => (prev ? { ...prev, busy: true, error: '' } : prev));
        updateState({ isPrinting: true });

        try {
            const { idsToMark, customerName, billFinalTotal } = job;

            const printResponse = await api.post(routes.markPrinted, {
                sales_ids: idsToMark,
                telephone_no: job.telephoneNo,
                customer_code: job.customerCode,
                customer_name: customerName,
                loan_amount: job.currentLoan
            });

            if (printResponse.data.status !== "success") {
                throw new Error(tr('Printing failed', 'මුද්‍රණය අසාර්ථකයි'));
            }

            let billNo = printResponse.data.bill_no
                || printResponse.data.data?.bill_no
                || printResponse.data.sale?.bill_no
                || printResponse.data.sales?.[0]?.bill_no
                || (Array.isArray(printResponse.data.data) && printResponse.data.data[0]?.bill_no)
                || "";

            if (!billNo) {
                console.warn("mark-printed response did not include a bill_no, refetching sales to find it:", printResponse.data);
                try {
                    const freshRes = await api.get(routes.sales);
                    const freshSales = freshRes.data.data || freshRes.data.sales || freshRes.data || [];
                    const matched = freshSales.find(s => idsToMark.includes(s.id) && s.bill_no);
                    billNo = matched?.bill_no || "";
                } catch (refetchErr) {
                    console.warn("Failed to refetch sales for bill_no fallback:", refetchErr);
                }
            }

            // Persist the last printed bill's total so it's still shown after a page reload/navigation
            const lastPrintedBillInfo = { billNo, customerName, total: billFinalTotal, timestamp: Date.now() };
            try {
                localStorage.setItem('lastPrintedBill', JSON.stringify(lastPrintedBillInfo));
            } catch (e) {
                console.warn("Failed to persist last printed bill to localStorage:", e);
            }
            setLastPrintedBill(lastPrintedBillInfo);

            // Update local state immediately (optimistic, no page reload). Uses a functional
            // setState so this doesn't clobber any save that resolved into allSales meanwhile.
            const markedIds = new Set(idsToMark);
            allSalesRef.current = allSalesRef.current.map(s => (markedIds.has(s.id) ? { ...s, bill_printed: "Y", bill_no: billNo } : s));
            setState(prev => ({
                ...prev,
                allSales: prev.allSales.map(s =>
                    markedIds.has(s.id)
                        ? { ...s, bill_printed: "Y", bill_no: billNo }
                        : s
                ),
                selectedPrintedCustomer: null,
                selectedUnprintedCustomer: null,
                isPrinting: false
            }));

            setPrintJob(null);
            handleClearForm(true);

            // Announce the bill total in Sinhala (x3) as it prints
            speakSinhalaBillTotal(billFinalTotal);
            await printHtml(job.buildReceipt(billNo));

            // Keep the cursor in the customer code field
            refs.customer_code_input.current?.focus();

            // Sync with the server in the background so the sidebars reflect the DB
            fetchSalesOnly({ force: true });

        } catch (error) {
            console.error("Printing error:", error);
            setPrintJob(prev => (prev ? { ...prev, busy: false, error: tr('Printing failed, please try again.', 'මුද්‍රණය කිරීමේදී දෝෂයක් ඇති විය.') } : prev));
            updateState({ isPrinting: false });
        }
    };
    const handleBillSizeChange = (e) => updateState({ billSize: e.target.value });
    useEffect(() => {
        if (currentUser?.role === 'Admin') {
            console.log("AdminView ref after mount:", adminViewRef.current);
        }
    }, [currentUser]);


    useEffect(() => {
        const handleShortcut = (e) => {
            if (e.key === "F10") {
                e.preventDefault();
                // This reloads the entire page from the server
                window.location.reload();
            }
            if (selectedPrintedCustomer && e.key === "F5") {
                e.preventDefault();
                return;
            }
            if (e.key === "F1") {
                e.preventDefault();
                // Directly call print function without focusing on given amount field
                handlePrintAndClear();
            }
            else if (e.key === "F5") {
                e.preventDefault();
                if (typeof handleMarkAllProcessed === "function") handleMarkAllProcessed();
            }
            else if (e.key === "F2" && displayedSales.length > 0) {
                e.preventDefault();
                updateState({ showBillPreview: true });
            }
        };
        window.addEventListener("keydown", handleShortcut);
        return () => window.removeEventListener("keydown", handleShortcut);
    }, [displayedSales, newSales, selectedPrintedCustomer, handlePrintAndClear, handleMarkAllProcessed, handleSubmitGivenAmount]);

    //new function to save phone no 
    const savePhoneNumber = async () => {
        const phoneNumber = formData.telephone_no;
        const customerCode = formData.customer_code || autoCustomerCode;

        if (!phoneNumber || !customerCode) {
            alert("Please enter both phone number and customer code");
            return;
        }

        // Validate phone number has exactly 10 digits
        if (phoneNumber.length !== 10 || !/^\d+$/.test(phoneNumber)) {
            alert("Please enter a valid 10-digit phone number");
            return;
        }

        try {
            const response = await api.post('/customers/check-or-create', {
                short_name: customerCode,
                telephone_no: phoneNumber
            });

            if (response.data.customer) {
                // Update the customer name if returned
                setFormData(prev => ({
                    ...prev,
                    customer_name: response.data.customer.name || prev.customer_name
                }));
                // Hide the save button after saving
                updateState({
                    showSavePhoneButton: false,
                    isTelephoneValid: false
                });
            }
        } catch (err) {
            console.error("Failed to save phone number:", err);
            alert("Failed to save phone number. Please try again.");
        }
    };

    const hasData = allSales.length > 0 || customers.length > 0 || items.length > 0 || suppliers.length > 0;
    //context related to bulkupdate
    return (
        <div className="sales-layout" style={{ maxWidth: '1400px', margin: '0 auto' }}>
            {isLoading && (<div className="fixed top-0 left-0 right-0 bg-blue-500 text-white py-1 text-center text-sm z-50">Refreshing data...</div>)}
            {state.isPrinting && (<div className="fixed top-0 left-0 right-0 bg-yellow-500 text-black py-1 text-center text-sm z-50">Printing in progress... Please wait</div>)}

            <div className="three-column-layout" style={{ opacity: isLoading ? 0.7 : 1, display: 'grid', gridTemplateColumns: '200px 1fr 200px', gap: '16px', padding: '10px', marginTop: '-149px' }}>
                <div className="left-sidebar" style={{ backgroundColor: '#1ec139ff', borderRadius: '0.75rem', maxHeight: '80.5vh', overflowY: 'auto' }}>
                    {hasData ? (
                        <CustomerList customers={printedCustomers} type="printed" searchQuery={searchQueries.printed} onSearchChange={setPrintedSearch} selectedPrintedCustomer={selectedPrintedCustomer} selectedUnprintedCustomer={selectedUnprintedCustomer} handleCustomerClick={stableCustomerClick} formatDecimal={formatDecimal} allSales={allSales} isCashFilterActive={state.isCashFilterActive} toggleCashFilter={toggleCashFilterStable} />
                    ) : (
                        <div className="w-full shadow-xl rounded-xl overflow-y-auto border border-black p-4 text-center" style={{ backgroundColor: "#1ec139ff", maxHeight: "80.5vh" }}>
                            <div style={{ backgroundColor: "#006400" }} className="p-1 rounded-t-xl">
                                <h2 className="font-bold text-white mb-1 whitespace-nowrap text-center" style={{ fontSize: '14px' }}>
                                    {tr('Printed', 'මුද්‍රණය කළ')}
                                </h2>
                            </div>
                            <div className="py-4">
                                <p className="text-gray-700">{tr('No printed transactions.', 'මුද්‍රණය කළ ගනුදෙනු දත්ත නොමැත.')}</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="center-form flex flex-col" style={{ backgroundColor: '#111439ff', padding: '20px', borderRadius: '0.75rem', color: 'white', minHeight: '100vh', height: 'auto', boxSizing: 'border-box', gridColumnStart: 2, gridColumnEnd: 3 }}>
                    {currentUser?.role === 'Admin' ? (
                        <AdminView
                            ref={adminViewRef}
                            allSales={allSales}
                            customers={customers}
                            items={items}
                            suppliers={suppliers}
                        />
                    ) : (
                        <div className="pos-sales-view flex flex-col h-full">
                            <div className="flex-shrink-0">
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div className="w-full flex justify-between items-center">
                                        <div style={{ position: 'relative', top: '-20px', display: 'flex', alignItems: 'center', flexWrap: 'nowrap', flexShrink: 0, zIndex: 20 }}>
                                            <div className="font-bold text-lg whitespace-nowrap" style={{ color: 'red', fontSize: '1.35rem' }}>
                                                {tr('Bill No:', 'බිල් අං:')} {currentBillNo}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginLeft: '100px' }}>
                                                <div className="font-bold text-xl whitespace-nowrap" style={{ color: 'red', fontSize: '1.15rem' }}>
                                                    {tr('Total Sales:', 'මුළු විකුණුම්:')} Rs. {formatDecimal(totalSalesValue)}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {/* Bulk Printing ticked: the same item at the same price is one line on the
                                                        customer bill (any supplier). Unticked: every record on its own line. */}
                                                    <input
                                                        type="checkbox"
                                                        id="bulkPrintCheckbox"
                                                        checked={state.isBulkPrintEnabled}
                                                        onChange={(e) => updateState({ isBulkPrintEnabled: e.target.checked })}
                                                        style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#4CAF50' }}
                                                    />
                                                    <label htmlFor="bulkPrintCheckbox" style={{ color: 'white', fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                        {tr('Bulk Printing', 'තොග මුද්‍රණය')}
                                                    </label>
                                                    {lastPrintedBill && (
                                                        <div className="font-bold text-xl whitespace-nowrap" style={{ color: '#4ade80', fontSize: '1.15rem', marginLeft: '15px' }}>
                                                            {tr('Last Bill Total:', 'අවසන් බිල් එකතුව:')} Rs. {formatDecimal(lastPrintedBill.total)} (#{lastPrintedBill.billNo})
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-10 items-center justify-start mt-4 mb-4 relative" style={{ minHeight: '150px' }}>
                                            {state.customerProfilePic && (
                                                <div onClick={() => handleImageClick('customer')} className="cursor-pointer hover:scale-105 transition-transform" style={{ position: 'absolute', left: '805px', top: '100px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', zIndex: 10 }}>
                                                    <span className="text-xs text-gray-400">{tr('Cust', 'ගැ')}</span>
                                                    <div style={{ width: '100px', height: '100px', backgroundColor: 'white', border: '5px solid #1ec139', borderRadius: '15px', overflow: 'hidden', boxShadow: '0 10px 20px rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                                        <img src={state.customerProfilePic} alt="Customer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    </div>
                                                </div>
                                            )}
                                            {state.supplierProfilePic && (
                                                <div onClick={() => handleImageClick('supplier')} className="cursor-pointer hover:scale-105 transition-transform" style={{ position: 'absolute', left: '940px', top: '100px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                                                    <span className="text-xs text-gray-400">{tr('Supp', 'සැ')}</span>
                                                    <div style={{ width: '100px', height: '100px', backgroundColor: 'white', border: '5px solid #3b82f6', borderRadius: '15px', overflow: 'hidden', boxShadow: '0 10px 20px rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                                        <img src={state.supplierProfilePic} alt="Supplier Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    </div>
                                                </div>
                                            )}
                                            <ImagePreviewModal isOpen={state.isImageModalOpen} onClose={() => updateState({ isImageModalOpen: false })} data={state.selectedImageData} />
                                        </div>
                                    </div>

                                    <div className="flex items-end gap-3 w-full" style={{ marginTop: '-160px' }}>
                                        <div className="flex flex-col gap-2 w-full">
                                            <div className="flex-1 min-w-0" style={{ position: 'relative', top: '-50px' }}>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <input id="telephone_no" ref={refs.telephone_no} name="telephone_no" value={formData.telephone_no || ""} onChange={(e) => handleInputChange("telephone_no", e.target.value)} onKeyDown={(e) => handleKeyDown(e, "telephone_no")} type="tel" maxLength="10" pattern="\d*" placeholder={tr('Phone number (10 digits)', 'දුරකථන අංකය (10 ඉලක්කම්)')} disabled={!!selectedPrintedCustomer} className="px-2 py-1 font-bold text-sm w-full border rounded text-black placeholder-gray-500" style={{ backgroundColor: selectedPrintedCustomer ? '#4a5568' : '#f6f6ff', border: '1px solid #4a5568', color: 'white', height: '36px', fontSize: '1rem', padding: '0 0.75rem', borderRadius: '0.5rem', boxSizing: 'border-box', cursor: selectedPrintedCustomer ? 'not-allowed' : 'text', opacity: selectedPrintedCustomer ? 0.7 : 1, flex: 1 }} />
                                                    {state.showSavePhoneButton && (
                                                        <button onClick={savePhoneNumber} style={{ backgroundColor: '#4CAF50', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem', whiteSpace: 'nowrap', height: '36px' }}>
                                                            Save
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0" style={{ marginTop: '-40px' }}>
                                                <input id="customer_code_input" ref={refs.customer_code_input} name="customer_code" value={formData.customer_code || autoCustomerCode} onChange={(e) => handleInputChange("customer_code", e.target.value.toUpperCase())} onKeyDown={(e) => handleKeyDown(e, "customer_code_input")} type="text" placeholder={tr('Customer code', 'පාරිභෝගික කේතය')} className="px-2 py-1 uppercase font-bold text-sm w-full border rounded bg-white text-black placeholder-gray-500" style={{ backgroundColor: '#0d0d4d', border: '1px solid #4a5568', color: 'white', height: '36px', fontSize: '1rem', padding: '0 0.75rem', borderRadius: '0.5rem', boxSizing: 'border-box' }} />
                                            </div>
                                        </div>
                                        <div style={{ flex: '0 0 150px', minWidth: '120px', marginLeft: '-100px' }}>
                                            <Select id="customer_code_select" ref={refs.customer_code_select} value={formData.customer_code ? { value: formData.customer_code, label: `${formData.customer_code}` } : null} onChange={handleCustomerSelect} options={customers.filter(c => !customerSearchInput || c.short_name.charAt(0).toUpperCase() === customerSearchInput.charAt(0).toUpperCase()).map(c => ({ value: c.short_name, label: `${c.short_name}` }))} onInputChange={(v, { action }) => action === "input-change" && updateState({ customerSearchInput: v.toUpperCase() })} inputValue={customerSearchInput} placeholder={tr('Select customer', 'පාරිභෝගිකයා තෝරන්න')} isClearable isSearchable styles={{ control: b => ({ ...b, minHeight: "36px", height: "36px", fontSize: "25px", backgroundColor: "white", borderColor: "#4a5568", borderRadius: "0.5rem" }), valueContainer: b => ({ ...b, padding: "0 6px", height: "36px" }), placeholder: b => ({ ...b, fontSize: "12px", color: "#a0aec0" }), input: b => ({ ...b, fontSize: "12px", color: "black", fontWeight: "bold" }), singleValue: b => ({ ...b, color: "black", fontSize: "12px", fontWeight: "bold" }), option: (b, s) => ({ ...b, color: "black", fontWeight: "bold", fontSize: "12px", backgroundColor: s.isFocused ? "#e5e7eb" : "white", cursor: "pointer" }) }} />
                                        </div>
                                        <div style={{ flex: '0 0 60px', minWidth: '120px' }}>
                                            <input id="price_per_kg" ref={refs.price_per_kg} name="price_per_kg" type="text" value={formData.price_per_kg} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && handleInputChange('price_per_kg', e.target.value)} onKeyDown={(e) => handleKeyDown(e, "price_per_kg")} placeholder={tr('Bulk price', 'එකවර මිල')} className="px-2 py-1 uppercase font-bold text-sm w-full border rounded bg-white text-black placeholder-gray-500" style={{ backgroundColor: '#0d0d4d', border: '1px solid #4a5568', color: 'white', height: '36px', fontSize: '1rem', padding: '0 0.75rem', borderRadius: '0.5rem', boxSizing: 'border-box' }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="rounded-lg border relative bg-white flex items-center justify-start pl-2 pt-2.5" style={{ flex: "0 0 100px", marginLeft: "5px", height: "36px" }}>
                                                <span className="absolute left-2 top-1 text-gray-400 text-[10px] pointer-events-none">Loan Amount</span>
                                                <span className="text-black font-bold text-sm">Rs. {loanAmount < 0 ? formatDecimal(Math.abs(loanAmount)) : formatDecimal(loanAmount)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="w-full" style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", columnGap: "8px", alignItems: "end", marginTop: "8px" }}>
                                        <div style={{ gridColumnStart: 1, gridColumnEnd: 3 }}>
                                            <input id="supplier_code" ref={refs.supplier_code} name="supplier_code" value={formData.supplier_code} onChange={(e) => handleInputChange("supplier_code", e.target.value.toUpperCase())} onKeyDown={(e) => handleKeyDown(e, "supplier_code")} type="text" placeholder={tr('Supplier', 'සැපයුම්කරු')} className="px-2 py-1 uppercase font-bold text-xs border rounded bg-white text-black placeholder-gray-500 w-full" style={{ width: "150px", backgroundColor: '#0d0d4d', border: '1px solid #4a5568', color: 'white', height: '44px', fontSize: '1.25rem', padding: '0 1rem', borderRadius: '0.5rem', boxSizing: 'border-box' }} />
                                        </div>
                                        <div style={{ gridColumnStart: 5, gridColumnEnd: 7, marginLeft: "-120px", marginRight: "-2px", position: "relative", zIndex: 30 /* above the page's own fields (max 20), below report modals/popups (Bootstrap ~1055) */ }}>
                                            {(() => {
                                                const currentFilteredOptions = [...items]
                                                    .filter(item => {
                                                        if (!state.itemSearchInput) return true;
                                                        const input = state.itemSearchInput.toUpperCase();
                                                        return String(item.no).toUpperCase().startsWith(input);
                                                    })
                                                    .sort((a, b) => {
                                                        const isANumeric = !isNaN(a.no);
                                                        const isBNumeric = !isNaN(b.no);
                                                        if (isANumeric && !isBNumeric) return 1;
                                                        if (!isANumeric && isBNumeric) return -1;
                                                        return String(a.no).toUpperCase().localeCompare(String(b.no).toUpperCase());
                                                    })
                                                    .map(item => ({ value: item.no, label: `${item.no} - ${item.type}`, item }));

                                                return (
                                                    <Select
                                                        id="item_code_select"
                                                        ref={refs.item_code_select}
                                                        openMenuOnFocus={false}
                                                        isSearchable
                                                        tabSelectsValue={false}
                                                        closeMenuOnSelect={true}
                                                        blurInputOnSelect={true}
                                                        inputValue={state.itemSearchInput}
                                                        options={currentFilteredOptions}
                                                        placeholder={tr('Item', 'භාණ්ඩය')}
                                                        defaultMenuIsOpen={false}
                                                        value={formData.item_code ? { value: formData.item_code, label: formData.item_name || formData.item_code } : null}
                                                        onInputChange={(value, meta) => { if (meta.action === "input-change") { updateState({ itemSearchInput: value.toUpperCase() }); } }}
                                                        onChange={(selectedOption) => {
                                                            if (!selectedOption) return;
                                                            handleItemSelect(selectedOption);
                                                            updateState({ itemSearchInput: "" });
                                                            refs.weight.current?.focus();
                                                            refs.weight.current?.select();
                                                        }}
                                                        onKeyDown={(e) => {
                                                            // Handle Enter key - Let react-select handle selection when menu is open
                                                            if (e.key === "Enter") {
                                                                // Check if the user is currently highlighting an item in the open menu using arrow keys
                                                                const isMenuFocused = refs.item_code_select.current?.state?.focusedOptionId;

                                                                if (isMenuFocused) {
                                                                    // Let react-select natively select the highlighted item with Enter.
                                                                    // The native onChange handler above will automatically push focus to the weight field.
                                                                    return;
                                                                }

                                                                // FIXED: Prevent native HTML form submission from jumping focus back to Customer Code
                                                                e.preventDefault();

                                                                // Don't prevent default if menu might be open
                                                                // The onChange will handle moving to weight after selection
                                                                // We'll let react-select do its thing first
                                                                setTimeout(() => {
                                                                    // After a short delay, check if an item was selected
                                                                    // If no item was selected (formData.item_code is still empty), move to weight
                                                                    if (!formData.item_code) {
                                                                        // Check for shortcut keys (+, 0, 1, 2, 3)
                                                                        const shortcutKeys = ["+", "0", "1", "2", "3"];
                                                                        if (shortcutKeys.includes(state.itemSearchInput)) {
                                                                            const searchValue = state.itemSearchInput;
                                                                            let itemToUse = null;
                                                                            if (searchValue !== "+") {
                                                                                const matchingItem = items.find(item => String(item.no).toUpperCase() === searchValue.toUpperCase());
                                                                                if (matchingItem) {
                                                                                    itemToUse = { no: matchingItem.no, type: matchingItem.type, pack_due: matchingItem.pack_due, price_per_kg: matchingItem.price_per_kg };
                                                                                }
                                                                            }
                                                                            if (!itemToUse) {
                                                                                const lastSale = displayedSales[0];
                                                                                if (lastSale) {
                                                                                    itemToUse = { no: lastSale.item_code, type: lastSale.item_name, pack_due: lastSale.pack_due, price_per_kg: lastSale.price_per_kg };
                                                                                }
                                                                            }
                                                                            if (itemToUse) {
                                                                                const mockOption = { value: itemToUse.no, label: `${itemToUse.no} - ${itemToUse.type}`, item: { no: itemToUse.no, type: itemToUse.type, pack_due: itemToUse.pack_due, pack_cost: itemToUse.pack_cost, price_per_kg: itemToUse.price_per_kg } };
                                                                                handleItemSelect(mockOption);
                                                                                updateState({ itemSearchInput: "" });
                                                                            }
                                                                        }

                                                                        // Move to weight field after a short delay
                                                                        setTimeout(() => {
                                                                            if (refs.weight.current) {
                                                                                refs.weight.current.focus();
                                                                                refs.weight.current.select();
                                                                            }
                                                                        }, 100);
                                                                    }
                                                                }, 50);
                                                                // Don't call preventDefault here - let react-select handle selection
                                                                return;
                                                            }
                                                        }}
                                                        className="react-select-container font-bold text-sm w-full"
                                                        styles={{
                                                            control: base => ({
                                                                ...base,
                                                                height: "44px",
                                                                minHeight: "44px",
                                                                fontSize: "1.25rem",
                                                                backgroundColor: "white",
                                                                borderColor: "#4a5568",
                                                                borderRadius: "0.5rem",
                                                                zIndex: 10001
                                                            }),
                                                            valueContainer: base => ({ ...base, padding: "0 1rem", height: "44px" }),
                                                            input: base => ({ ...base, color: "black", fontSize: "1.25rem" }),
                                                            singleValue: base => ({ ...base, color: "black", fontWeight: "bold", fontSize: "1.25rem" }),
                                                            option: (base, state) => ({
                                                                ...base,
                                                                fontWeight: "bold",
                                                                color: "black",
                                                                backgroundColor: state.isFocused ? "#e5e7eb" : "white",
                                                                fontSize: "1rem",
                                                                ...(state.isSelected && { backgroundColor: "#e5e7eb" }),
                                                                zIndex: 10002
                                                            }),
                                                            menu: base => ({
                                                                ...base,
                                                                marginTop: "4px",
                                                                zIndex: 10003,
                                                                position: "absolute"
                                                            }),
                                                            menuPortal: base => ({ ...base, zIndex: 10003 })
                                                        }}
                                                        openMenuOnClick={true}
                                                        menuPlacement="auto"
                                                        menuPortalTarget={document.body}
                                                    />
                                                );
                                            })()}
                                        </div>
                                        {[
                                            { id: 'weight', placeholder: tr('Weight', 'බර'), fieldRef: refs.weight },
                                            { id: 'price_per_kg_grid_item', placeholder: tr('Price', 'මිල'), fieldRef: refs.price_per_kg_grid_item },
                                            { id: 'packs', placeholder: tr('Packs', 'අසුරුම්'), fieldRef: refs.packs },
                                            { id: 'kuliya', placeholder: tr('Kuliya', 'කුලිය'), fieldRef: refs.kuliya, isReadOnly: false }
                                        ].map(({ id, placeholder, fieldRef, isReadOnly = false }) => (
                                            <div key={id} style={{
                                                ...(id === 'weight' && { gridColumnStart: 8, gridColumnEnd: 9, marginLeft: "-70px", width: "100px" }),
                                                ...(id === 'price_per_kg_grid_item' && { gridColumnStart: 9, gridColumnEnd: 10, marginLeft: "-30px", width: "105px" }),
                                                ...(id === 'packs' && { gridColumnStart: 10, gridColumnEnd: 11 }),
                                                ...(id === 'kuliya' && { gridColumnStart: 11, gridColumnEnd: 13, marginLeft: "10px" })
                                            }}>
                                                <input
                                                    id={id}
                                                    ref={fieldRef}
                                                    name={id}
                                                    type="text"
                                                    value={id === 'price_per_kg_grid_item' ? gridPricePerKg : formData[id]}
                                                    onChange={(e) => {
                                                        if (id === 'price_per_kg_grid_item') {
                                                            handleInputChange(id, e.target.value);
                                                        } else if (id === 'kuliya') {
                                                            const newValue = e.target.value;
                                                            // Allow empty or numbers (including 0)
                                                            if (newValue === '' || /^\d*\.?\d*$/.test(newValue)) {
                                                                handleKuliyaChange(newValue);
                                                                handleInputChange(id, newValue);
                                                            }
                                                        } else if (/^\d*\.?\d*$/.test(e.target.value)) {
                                                            handleInputChange(id, e.target.value);
                                                            if (id === 'weight' || id === 'packs') {
                                                                updateState({ isKuliyaManuallyChanged: false });
                                                            }
                                                        }
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (id === 'kuliya') {
                                                            // Submit via handleKeyDown so focus moves to supplier_code afterward
                                                            if (e.key === 'Enter') {
                                                                handleKeyDown(e, id);
                                                                return;
                                                            }
                                                            // Block number keys (0-9) and other keys except backspace, delete, tab, etc.
                                                            const blockedKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '-', 'e', 'E', '+'];
                                                            if (blockedKeys.includes(e.key)) {
                                                                e.preventDefault();
                                                            }
                                                        } else {
                                                            handleKeyDown(e, id);
                                                        }
                                                    }}
                                                    onBlur={(e) => {
                                                        if (id === 'kuliya') {
                                                            // If value is empty or not a number, set to 0
                                                            if (!e.target.value || isNaN(parseFloat(e.target.value))) {
                                                                const zeroValue = '0';
                                                                handleKuliyaChange(zeroValue);
                                                                handleInputChange(id, zeroValue);
                                                            }
                                                        }
                                                    }}
                                                    placeholder={placeholder}
                                                    readOnly={isReadOnly}
                                                    className="px-2 py-1 uppercase font-bold text-xs border rounded bg-white text-black placeholder-gray-500 text-center"
                                                    style={{
                                                        backgroundColor: isReadOnly ? '#e2e8f0' : 'white',
                                                        borderRadius: '0.5rem',
                                                        textAlign: 'right',
                                                        fontSize: '1.125rem',
                                                        height: '40px',
                                                        boxSizing: 'border-box',
                                                        width: '100%'
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <button type="submit" style={{ display: "none" }}></button>
                                </form>
                                {errors.form && <div className="mt-6 p-3 bg-red-100 text-red-700 rounded-xl">{errors.form}</div>}
                            </div>

                            {/* MAIN TABLE SECTION - ONLY ONE INSTANCE */}
                            <div className="flex-grow overflow-y-auto mt-1">
                                {displayedSales.length > 0 ? (
                                    <>
                                        <table className="min-w-full border-gray-200 rounded-xl text-sm" style={{ backgroundColor: '#000000', color: 'white', borderCollapse: 'collapse', margin: '0px 0', width: '100%' }}>
                                            <thead>
                                                <tr style={{ backgroundColor: '#000000' }}>
                                                    <th className="px-2 py-2 border text-center" style={{ backgroundColor: '#f5fafb', color: '#000000', width: '40px' }}>
                                                        <input type="checkbox" checked={allDisplayedSelected} onChange={toggleSelectAllSales} disabled={displayedSales.length === 0} title="Select all" style={{ cursor: 'pointer' }} />
                                                    </th>
                                                    {[tr('Sup code', 'Sup code'), tr('Code', 'කේතය'), tr('Item', 'අයිතමය'), tr('Weight(kg)', 'බර(kg)'), tr('Price', 'මිල'), tr('Value', 'අගය'), tr('Bags', 'මලු'), tr('Actions', 'Actions')].map((header, index) => (
                                                        <th key={index} className="px-4 py-2 border" style={{ backgroundColor: '#f5fafb', color: '#000000' }}>{header}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {tableRows.map((s, idx) => {
                                                    const isSelected = rowIds(s).every(id => state.selectedSalesIds.includes(id));
                                                    return (
                                                        <tr key={idx} tabIndex={0} className={`text-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${isSelected ? 'bg-blue-900' : ''}`} onClick={() => handleEditClick(s)} onContextMenu={(e) => handleRightClick(e, s)} title={hasPending(s) ? tr('Saving...', 'සුරකිමින්...') : undefined} style={{ backgroundColor: isSelected ? '#1e40af' : 'transparent', opacity: hasPending(s) ? 0.55 : 1 }}>
                                                            <td className="px-2 py-2 border text-center" onClick={(e) => e.stopPropagation()}>
                                                                <input type="checkbox" checked={isSelected} onChange={() => toggleRowSelection(s)} onClick={(e) => e.stopPropagation()} style={{ cursor: 'pointer' }} />
                                                            </td>
                                                            <td className="px-4 py-2 border">{s.supplier_code}</td>
                                                            <td className="px-4 py-2 border">{s.item_code}</td>
                                                            <td className="px-4 py-2 border">{s.item_name}</td>
                                                            <td className="px-2 py-2 border">{formatDecimal(s.weight)}</td>
                                                            <td className="px-2 py-2 border">{formatDecimal(s.price_per_kg)}</td>
                                                            <td className="px-2 py-2 border">
                                                                {formatDecimal((parseFloat(s.weight) || 0) * (parseFloat(s.price_per_kg) || 0) + (parseFloat(s.packs) || 0) * (parseFloat(s.pack_due) || 0))}
                                                            </td>
                                                            <td className="px-2 py-2 border">{s.packs}</td>
                                                            <td className="px-2 py-2 border text-center">
                                                                <button onClick={(e) => { e.stopPropagation(); handleDeleteRecord(s.id, s.group_ids); }} className="text-black font-bold p-1 rounded-full bg-white hover:bg-gray-200">🗑️</button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>

                                        <ContextMenu show={state.bulkUpdateContextMenu.show} onClose={closeContextMenu} onUpdate={handleBulkUpdateCustomer} selectionCriteria={selectedSalesSummary} selectedCount={state.selectedSalesIds.length} />

                                        {displayedSales.length > 0 && (<SalesSummaryFooter sales={displayedSales} formatDecimal={formatDecimal} />)}

                                        <div className="flex gap-4 items-start">
                                            <ItemSummary sales={displayedSales} formatDecimal={formatDecimal} />
                                            <BreakdownDisplay sale={selectedSaleForBreakdown} formatDecimal={formatDecimal} />
                                        </div>

                                        <div className="flex items-center justify-between mb-4" style={{ marginTop: "35px" }}>
                                            {displayedSales.length > 0 && (
                                                <div className="text-2xl font-bold" style={{ color: 'red' }}>
                                                    {tr('(Sales:', '(විකුණුම්:')} Rs. {formatDecimal(salesTotal)} + {tr('Bag Value:', 'මල්ලක අගය:')} Rs. {formatDecimal(packCostTotal)} + {tr('Kuliya:', 'කුලිය:')} Rs. {formatDecimal(kuliyaTotal)} )
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div
                                        style={{
                                            height: "650px", // Fixed full section height
                                            display: "flex",
                                            flexDirection: "column"
                                        }}
                                    >
                                        {/* Header */}
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                marginBottom: "8px",
                                                padding: "0 4px",
                                                flexShrink: 0
                                            }}
                                        >
                                            <span
                                                style={{
                                                    color: "#888",
                                                    fontSize: "13px",
                                                    fontWeight: "500"
                                                }}
                                            >
                                                📋 All Sales Records ({allSalesRecords.length} total)
                                            </span>

                                            {isLoadingAllSales && (
                                                <span
                                                    style={{
                                                        color: "#ffd700",
                                                        fontSize: "12px"
                                                    }}
                                                >
                                                    Loading...
                                                </span>
                                            )}
                                        </div>

                                        {/* Scrollable Table Container */}
                                        <div
                                            style={{
                                                flex: 1,
                                                overflowY: "auto",
                                                overflowX: "auto",
                                                border: "1px solid #4a5568",
                                                borderRadius: "0.5rem",
                                                backgroundColor: "#1a1a2e",
                                                minHeight: 0
                                            }}
                                        >
                                            <table
                                                style={{
                                                    width: "100%",
                                                    borderCollapse: "collapse",
                                                    color: "white",
                                                    fontSize: "13px",
                                                    marginTop: "-6px"
                                                }}
                                            >
                                                {/* Transparent Sticky Header */}
                                                <thead
                                                    style={{
                                                        position: "sticky",
                                                        top: 0,
                                                        zIndex: 1, // lower than dropdown
                                                        background: "transparent",
                                                        backdropFilter: "blur(1px)"
                                                    }}
                                                >
                                                    <tr
                                                        style={{
                                                            backgroundColor: "transparent",
                                                            borderBottom: "1px solid rgba(255,255,255,0.1)"
                                                        }}
                                                    >
                                                        <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: "bold" }}>Bill No</th>
                                                        <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: "bold" }}>Customer</th>
                                                        <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: "bold" }}>Supplier</th>
                                                        <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: "bold" }}>Item Code</th>
                                                        <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: "bold" }}>Item Name</th>
                                                        <th style={{ padding: "10px 8px", textAlign: "right", fontWeight: "bold" }}>Weight (kg)</th>
                                                        <th style={{ padding: "10px 8px", textAlign: "right", fontWeight: "bold" }}>Price/kg</th>
                                                        <th style={{ padding: "10px 8px", textAlign: "right", fontWeight: "bold" }}>Packs</th>
                                                        <th style={{ padding: "10px 8px", textAlign: "right", fontWeight: "bold" }}>Kuliya</th>
                                                        <th style={{ padding: "10px 8px", textAlign: "right", fontWeight: "bold" }}>Total</th>
                                                    </tr>
                                                </thead>

                                                <tbody>
                                                    {isLoadingAllSales ? (
                                                        <tr>
                                                            <td
                                                                colSpan="10"
                                                                style={{
                                                                    padding: "40px",
                                                                    textAlign: "center",
                                                                    color: "#888"
                                                                }}
                                                            >
                                                                Loading sales records...
                                                            </td>
                                                        </tr>
                                                    ) : allSalesRecords.length === 0 ? (
                                                        <tr>
                                                            <td
                                                                colSpan="10"
                                                                style={{
                                                                    padding: "40px",
                                                                    textAlign: "center",
                                                                    color: "#888",
                                                                    fontStyle: "italic"
                                                                }}
                                                            >
                                                                No sales records found in database.
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        allSalesRows
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Footer Summary */}
                                        {allSalesRecords.length > 0 && !isLoadingAllSales && (
                                            <div
                                                style={{
                                                    padding: "12px",
                                                    backgroundColor: "#0f0f23",
                                                    borderRadius: "0.5rem",
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    marginTop: "6px",
                                                    flexShrink: 0
                                                }}
                                            >
                                                <span style={{ color: "#888", fontSize: "12px" }}>
                                                    Total Records: {allSalesRecords.length}
                                                </span>

                                                <span style={{ color: "#888", fontSize: "12px" }}>
                                                    Total Weight:{" "}
                                                    {formatDecimal(
                                                        allSalesRecords.reduce(
                                                            (sum, s) => sum + (parseFloat(s.weight) || 0),
                                                            0
                                                        )
                                                    )}{" "}
                                                    kg
                                                </span>

                                                <span
                                                    style={{
                                                        color: "#4ade80",
                                                        fontSize: "12px",
                                                        fontWeight: "bold"
                                                    }}
                                                >
                                                    Total Value: Rs.{" "}
                                                    {formatDecimal(
                                                        allSalesRecords.reduce(
                                                            (sum, s) => sum + (parseFloat(s.total) || 0),
                                                            0
                                                        )
                                                    )}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="right-sidebar" style={{ backgroundColor: '#1ec139ff', borderRadius: '0.75rem', maxHeight: '80.5vh', overflowY: 'auto', gridColumnStart: 3, gridColumnEnd: 4 }}>
                    {hasData ? (
                        <CustomerList customers={unprintedCustomers} type="unprinted" searchQuery={searchQueries.unprinted} onSearchChange={setUnprintedSearch} selectedPrintedCustomer={selectedPrintedCustomer} selectedUnprintedCustomer={selectedUnprintedCustomer} handleCustomerClick={stableCustomerClick} formatDecimal={formatDecimal} allSales={allSales} />
                    ) : (
                        <div className="w-full shadow-xl rounded-xl overflow-y-auto border border-black p-4 text-center" style={{ backgroundColor: "#1ec139ff", maxHeight: "80.5vh" }}>
                            <div style={{ backgroundColor: "#006400" }} className="p-1 rounded-t-xl">
                                <h2 className="font-bold text-white mb-1 whitespace-nowrap text-center" style={{ fontSize: '14px' }}>{tr('Unprinted', 'මුද්‍රණය නොකළ')}</h2>
                            </div>
                            <div className="py-4">
                                <p className="text-gray-700">{tr('No unprinted sales found', 'මුද්‍රණය නොකළ විකුණුම් කිසිවක් සොයාගත නොහැක')}</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {renderBillPreviewModal()}
            {printJob && (
                <PrintPreviewDialog
                    html={printJob.previewHtml}
                    title={`${tr('Print bill', 'බිල මුද්‍රණය')} — ${printJob.customerName}`}
                    onPrint={executePrintJob}
                    onCancel={handleCancelPrintJob}
                    busy={printJob.busy}
                    error={printJob.error}
                    wide={printMode === 'a4'}
                />
            )}
        </div>
    );
}