import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from "../../api";
import { useNavigate } from 'react-router-dom';
import { SHOP_NAME, SHOP_PHONE, SHOP_ADDRESS, SHOP_STALL_NO } from '../../config/shop';
import { STORAGE_URL } from '../../config/paths';
import { printHtml } from '../../utils/printHtml';
import PrintPreviewDialog from '../PrintPreviewDialog';
import { tr } from '../../i18n/language';

// Surfaces the real backend error (Laravel validation errors, custom error/message
// fields, etc.) instead of a hardcoded generic string, so failures are diagnosable
// from the alert itself rather than requiring a guess-and-check round trip.
const extractApiErrorMessage = (error, fallback) => {
    const data = error?.response?.data;
    if (!data) return error?.message || fallback;
    if (data.errors) {
        return Object.values(data.errors).flat().join('\n');
    }
    return data.message || data.error || fallback;
};

// Bulk Printing (same idea as the sales entry page): on the printed supplier bill, lines
// for the same customer, item, price and pack cost are merged into one line with their
// weight, packs and amount added up. Only the printout changes, not the saved records.
const combineSupplierBillLines = (records) => {
    const combined = new Map();
    records.forEach(record => {
        const key = [
            (record.customer_code || '').toUpperCase(),
            record.item_code || record.item_name || '',
            parseFloat(record.SupplierPricePerKg) || 0,
            parseFloat(record.CustomerPackCost) || 0,
        ].join('|');

        const existing = combined.get(key);
        if (!existing) {
            combined.set(key, { ...record, original_ids: [record.id] });
            return;
        }
        existing.weight = (parseFloat(existing.weight) || 0) + (parseFloat(record.weight) || 0);
        existing.packs = (parseInt(existing.packs) || 0) + (parseInt(record.packs) || 0);
        existing.SupplierTotal = (parseFloat(existing.SupplierTotal) || 0) + (parseFloat(record.SupplierTotal) || 0);
        existing.original_ids.push(record.id);
    });
    return Array.from(combined.values());
};

// Hoisted to module scope (and memoized) so it keeps a stable identity across
// SupplierReport re-renders (e.g. the 3s auto-refresh poll). When this was defined
// inline inside SupplierReport, React treated it as a brand-new component type on
// every render and fully remounted it — which reset its auto-focus effect and
// stole focus out of whichever input the user was typing in every few seconds.
const supplierValueInputStyle = {
    width: '100%',
    padding: '10px 12px',
    border: '2px solid #c7d2fe',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '600',
    boxSizing: 'border-box',
    fontFamily: 'monospace',
    outline: 'none',
    background: '#ffffff'
};

const BulkUpdateContextMenu = React.memo(({
    show,
    selectionCriteria,
    selectedTransactionIds,
    bulkUpdateSupplierCode,
    setBulkUpdateSupplierCode,
    bulkUpdateCustomerCode,
    setBulkUpdateCustomerCode,
    bulkUpdateSupplierWeight,
    setBulkUpdateSupplierWeight,
    bulkUpdateSupplierPrice,
    setBulkUpdateSupplierPrice,
    selectedRecord,
    handleBulkUpdate,
    closeContextMenu
}) => {
    const supplierInputRef = useRef(null);
    const customerInputRef = useRef(null);
    const supplierWeightInputRef = useRef(null);
    const supplierPriceInputRef = useRef(null);

    // Auto-focus on the first input when modal opens
    useEffect(() => {
        if (show) {
            // Small delay to ensure modal is rendered
            setTimeout(() => {
                if (supplierInputRef.current) {
                    supplierInputRef.current.focus();
                }
            }, 100);
        }
    }, [show]);

    if (!show) return null;

    return (
        <>
            {/* Backdrop Overlay - Use onClick to close, but don't capture focus */}
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
                onClick={closeContextMenu}
                onMouseDown={(e) => {
                    // Prevent backdrop from stealing focus from inputs
                    if (e.target === e.currentTarget) {
                        e.preventDefault();
                    }
                }}
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
                onMouseDown={(e) => e.stopPropagation()}
            >
                {/* Header */}
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
                            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
                                Bulk Update Transactions
                            </h2>
                            <p style={{ margin: '2px 0 0 0', fontSize: '11px', opacity: 0.9 }}>
                                Update multiple records at once
                            </p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div style={{ padding: '16px 20px' }}>
                    {selectionCriteria && (
                        <div style={{
                            background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                            borderRadius: '10px',
                            padding: '10px 12px',
                            marginBottom: '16px',
                            border: '1px solid #fbbf24'
                        }}>
                            <div style={{ marginBottom: '8px' }}>
                                <span style={{ fontSize: '14px' }}>📋</span>
                                <span style={{ fontWeight: 'bold', fontSize: '11px', color: '#92400e', marginLeft: '6px' }}>
                                    Current Selection
                                </span>
                            </div>
                            <div style={{ display: 'grid', gap: '6px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'white', borderRadius: '6px' }}>
                                    <span style={{ fontSize: '11px' }}>Supplier:</span>
                                    <span style={{ fontWeight: 'bold', fontSize: '12px', fontFamily: 'monospace' }}>
                                        {selectionCriteria.supplier_code}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'white', borderRadius: '6px' }}>
                                    <span style={{ fontSize: '11px' }}>Item:</span>
                                    <span style={{ fontWeight: 'bold', fontSize: '12px', fontFamily: 'monospace' }}>
                                        {selectionCriteria.item_name}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'white', borderRadius: '6px' }}>
                                    <span style={{ fontSize: '11px' }}>Customer:</span>
                                    <span style={{ fontWeight: 'bold', fontSize: '12px', fontFamily: 'monospace' }}>
                                        {selectionCriteria.customer_code}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: '#10b981', borderRadius: '6px', color: 'white' }}>
                                    <span style={{ fontSize: '11px' }}>Selected:</span>
                                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>
                                        {selectedTransactionIds.length}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Supplier Code Input */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '12px', color: '#374151' }}>
                            ✏️ New Supplier Code (Optional)
                        </label>
                        <input
                            ref={supplierInputRef}
                            type="text"
                            value={bulkUpdateSupplierCode}
                            onChange={(e) => setBulkUpdateSupplierCode(e.target.value.toUpperCase())}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    // Move to customer field
                                    if (customerInputRef.current) {
                                        customerInputRef.current.focus();
                                    }
                                } else if (e.key === 'Escape') {
                                    closeContextMenu();
                                }
                            }}
                            style={{
                                width: '100%',
                                padding: '12px 12px',
                                border: '2px solid #e5e7eb',
                                borderRadius: '10px',
                                fontSize: '14px',
                                fontWeight: '500',
                                boxSizing: 'border-box',
                                fontFamily: 'monospace',
                                outline: 'none',
                                transition: 'border-color 0.2s'
                            }}
                            onFocus={(e) => {
                                e.target.style.borderColor = '#667eea';
                                e.target.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.1)';
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = '#e5e7eb';
                                e.target.style.boxShadow = 'none';
                            }}
                            placeholder="e.g., SUP001 (leave empty to skip)"
                            autoFocus={true}
                        />
                    </div>

                    {/* Customer Code Input */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '12px', color: '#374151' }}>
                            ✏️ New Customer Code (Optional)
                        </label>
                        <input
                            ref={customerInputRef}
                            type="text"
                            value={bulkUpdateCustomerCode}
                            onChange={(e) => setBulkUpdateCustomerCode(e.target.value.toUpperCase())}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    // Move to the supplier weight / price fields
                                    (supplierWeightInputRef.current || supplierPriceInputRef.current)?.focus();
                                } else if (e.key === 'Escape') {
                                    closeContextMenu();
                                }
                            }}
                            style={{
                                width: '100%',
                                padding: '12px 12px',
                                border: '2px solid #e5e7eb',
                                borderRadius: '10px',
                                fontSize: '14px',
                                fontWeight: '500',
                                boxSizing: 'border-box',
                                fontFamily: 'monospace',
                                outline: 'none',
                                transition: 'border-color 0.2s'
                            }}
                            onFocus={(e) => {
                                e.target.style.borderColor = '#667eea';
                                e.target.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.1)';
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = '#e5e7eb';
                                e.target.style.boxShadow = 'none';
                            }}
                            placeholder="e.g., CUST001 (leave empty to skip)"
                        />
                    </div>

                    {/* Supplier-side values (SupplierWeight / SupplierPricePerKg in the sales table) */}
                    <div style={{
                        border: '1px solid #c7d2fe',
                        background: '#eef2ff',
                        borderRadius: '10px',
                        padding: '12px',
                        marginBottom: '20px'
                    }}>
                        <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#3730a3', marginBottom: '10px' }}>
                            ⚖️ {tr('Supplier Weight & Price', 'සැපයුම්කරු බර සහ මිල')}
                        </div>

                        {selectedRecord ? (
                            <div style={{ marginBottom: '12px' }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '12px', color: '#374151' }}>
                                    {tr('Supplier Weight (kg)', 'සැපයුම්කරු බර (kg)')}
                                </label>
                                <input
                                    ref={supplierWeightInputRef}
                                    type="number"
                                    step="0.001"
                                    min="0"
                                    inputMode="decimal"
                                    value={bulkUpdateSupplierWeight}
                                    onChange={(e) => setBulkUpdateSupplierWeight(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            supplierPriceInputRef.current?.focus();
                                        } else if (e.key === 'Escape') {
                                            closeContextMenu();
                                        }
                                    }}
                                    style={supplierValueInputStyle}
                                />
                                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                                    {tr('Customer weight', 'පාරිභෝගික බර')}: {selectedRecord.customer_weight ?? selectedRecord.weight} kg
                                </div>
                            </div>
                        ) : (
                            <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '10px' }}>
                                {tr('Select a single record to change its supplier weight.', 'සැපයුම්කරු බර වෙනස් කිරීමට එක් වාර්තාවක් පමණක් තෝරන්න.')}
                            </div>
                        )}

                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '12px', color: '#374151' }}>
                                {tr('Supplier Price / kg', 'සැපයුම්කරු මිල / kg')}
                                {!selectedRecord && ` (${tr('applies to all selected', 'තෝරාගත් සියල්ලටම')})`}
                            </label>
                            <input
                                ref={supplierPriceInputRef}
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                value={bulkUpdateSupplierPrice}
                                onChange={(e) => setBulkUpdateSupplierPrice(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleBulkUpdate();
                                    } else if (e.key === 'Escape') {
                                        closeContextMenu();
                                    }
                                }}
                                placeholder={selectedRecord ? '' : tr('leave empty to skip', 'මඟ හැරීමට හිස්ව තබන්න')}
                                style={supplierValueInputStyle}
                            />
                            {selectedRecord && (
                                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                                    {tr('Customer price', 'පාරිභෝගික මිල')}: {selectedRecord.price_per_kg} / kg
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                        <button
                            onClick={handleBulkUpdate}
                            style={{
                                flex: 2,
                                padding: '12px',
                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '14px',
                                transition: 'transform 0.2s, opacity 0.2s'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-1px)';
                                e.currentTarget.style.opacity = '0.9';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.opacity = '1';
                            }}
                        >
                            🚀 Update {selectedTransactionIds.length} Record{selectedTransactionIds.length !== 1 ? 's' : ''}
                        </button>
                        <button
                            onClick={closeContextMenu}
                            style={{
                                flex: 1,
                                padding: '12px',
                                background: '#6c757d',
                                color: 'white',
                                border: 'none',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '14px',
                                transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#5a6268';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = '#6c757d';
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
});

const SupplierReport = () => {
    const navigate = useNavigate();

    // State for all data
    const [summary, setSummary] = useState({ printed: [], unprinted: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false); // New state for auto-refresh indicator

    // 🚀 BULK SELECTION STATE (add these with your other state variables)
    const [selectedTransactionIds, setSelectedTransactionIds] = useState([]);
    const [selectionCriteria, setSelectionCriteria] = useState(null);
    const [bulkUpdateContextMenu, setBulkUpdateContextMenu] = useState({ show: false, x: 0, y: 0 });
    const [bulkUpdateSupplierCode, setBulkUpdateSupplierCode] = useState('');
    const [bulkUpdateCustomerCode, setBulkUpdateCustomerCode] = useState('');
    // Supplier-side values (SupplierWeight / SupplierPricePerKg) edited from the same menu
    const [bulkUpdateSupplierWeight, setBulkUpdateSupplierWeight] = useState('');
    const [bulkUpdateSupplierPrice, setBulkUpdateSupplierPrice] = useState('');

    // 🚀 NEW STATE: Bill size selector (3mm or 4mm) - PERSISTED
    const [billSize, setBillSize] = useState(() => {
        const saved = localStorage.getItem('supplier_bill_size');
        return saved || '3mm';
    });

    // 🚀 NEW STATE: Print Format selector (Thermal or A4) - PERSISTED
    const [printFormat, setPrintFormat] = useState(() => {
        const saved = localStorage.getItem('supplier_print_format_v2');
        return saved || 'a4';
    });

    // Bulk Printing: merge matching bill lines on the printout - PERSISTED, on by default like sales entry
    const [isBulkPrintEnabled, setIsBulkPrintEnabled] = useState(() => {
        try {
            return localStorage.getItem('supplier_bulk_print') !== 'false';
        } catch {
            return true;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem('supplier_bulk_print', String(isBulkPrintEnabled));
        } catch {
            // ignore storage errors (private mode etc.)
        }
    }, [isBulkPrintEnabled]);

    // Save billSize to localStorage whenever it changes
    useEffect(() => {
        localStorage.setItem('supplier_bill_size', billSize);
    }, [billSize]);

    // Save printFormat to localStorage whenever it changes
    useEffect(() => {
        localStorage.setItem('supplier_print_format_v2', printFormat);
    }, [printFormat]);

    const [printedSearchTerm, setPrintedSearchTerm] = useState('');
    const [unprintedSearchTerm, setUnprintedSearchTerm] = useState('');
    const [isPhoneManuallyChanged, setIsPhoneManuallyChanged] = useState(false);
    //new states  in adding telephone no
    const [phoneNo, setPhoneNo] = useState('');
    const [phoneStatus, setPhoneStatus] = useState(''); // For feedback
    const [enteredAmount, setEnteredAmount] = useState(0);

    // 🚀 NEW STATE: For loan/paying amount
    const [payingAmount, setPayingAmount] = useState('');
    const [loanStatus, setLoanStatus] = useState(''); // For feedback

    const [currentView, setCurrentView] = useState('summary');
    const [profilePic, setProfilePic] = useState(null);
    // Add these with your other state variables
    const [isImageModalOpen, setIsImageModalOpen] = useState(false);
    const [supplierDocs, setSupplierDocs] = useState({ title: '', profile: null, nic_front: null, nic_back: null });
    // F2 quick bill preview (small modal, no print dialog)
    const [showBillPreview, setShowBillPreview] = useState(false);
    //useeffects to store the option in local storage and retrieve it on component mount
    // Add these after your existing useState declarations (around line 30-35)

    // Load saved values from localStorage on component mount
    useEffect(() => {
        const savedBillSize = localStorage.getItem('supplier_bill_size');
        if (savedBillSize) {
            setBillSize(savedBillSize);
        }

        const savedPrintFormat = localStorage.getItem('supplier_print_format_v2');
        if (savedPrintFormat) {
            setPrintFormat(savedPrintFormat);
        }
    }, []);

    // Save billSize to localStorage whenever it changes
    useEffect(() => {
        localStorage.setItem('supplier_bill_size', billSize);
    }, [billSize]);

    // Save printFormat to localStorage whenever it changes
    useEffect(() => {
        localStorage.setItem('supplier_print_format_v2', printFormat);
    }, [printFormat]);
    // State for Details Panel
    const [selectedSupplier, setSelectedSupplier] = useState(null);
    const [selectedBillNo, setSelectedBillNo] = useState(null);
    const [isUnprintedBill, setIsUnprintedBill] = useState(false);
    // (kept in a ref too, for the auto-refresh callbacks)
    const [supplierDetails, setSupplierDetails] = useState([]);
    const [isDetailsLoading, setIsDetailsLoading] = useState(false);

    // 🚀 NEW STATE: To hold the advance amount from the suppliers table
    const [advanceAmount, setAdvanceAmount] = useState(0);
    // Bill waiting in the app's own print window (F4)
    const [printJob, setPrintJob] = useState(null);
    // Farmer's outstanding loan from the loan manager (ගොවියා ලාද පරණ නය / අද දින නය ගැනීම),
    // printed on the bill as "පෙර ණය" the same way customer bills show it
    const [farmerLoanTotal, setFarmerLoanTotal] = useState(0);

    // 🚀 NEW STATE: For the Advance Entry Form Logic
    const [advancePayload, setAdvancePayload] = useState({ code: '', advance_amount: '' });
    const [advanceLoading, setAdvanceLoading] = useState(false);
    const [advanceStatus, setAdvanceStatus] = useState({ type: '', text: '' });
    // Hire (transport) amount: saved on the supplier like the advance, deducted on the next
    // printed bill and then cleared. A printed bill shows the amounts it was printed with.
    const [hireAmount, setHireAmount] = useState(0);
    const [hireInput, setHireInput] = useState('');
    const [hireLoading, setHireLoading] = useState(false);
    const [hireStatus, setHireStatus] = useState({ type: '', text: '' });
    const isUnprintedBillRef = useRef(false);

    // 🚀 NEW STATE: For Editing Records
    const [editingRecord, setEditingRecord] = useState(null);
    const [newFarmerCode, setNewFarmerCode] = useState('');
    const [newCustomerCode, setNewCustomerCode] = useState('');
    // 🚀 BULK EDIT STATE
    const [applyToAllSameItems, setApplyToAllSameItems] = useState(true);

    // 🚀 AUTO-REFRESH: Store interval reference
    const refreshIntervalRef = useRef(null);
    const isPrintingOrUpdatingRef = useRef(false);
    // Identifies the bill currently selected, so late responses for a previously
    // clicked bill (or an in-flight auto-refresh) can't overwrite the details panel.
    const activeBillKeyRef = useRef(null);

    // --- Function to fetch the summary data ---
    const fetchSummary = useCallback(async (isAutoRefresh = false) => {
        // Don't fetch if we're in the middle of printing or updating
        if (isPrintingOrUpdatingRef.current) {
            console.log("⏸️ Skipping refresh - printing or updating in progress");
            return;
        }

        // Set refreshing state for auto-refresh, but not for initial load
        if (isAutoRefresh) {
            setIsRefreshing(true);
        } else {
            setIsLoading(true);
        }

        setCurrentView('summary');
        console.log("➡️ Attempting to fetch supplier summary data from backend...");
        try {
            const response = await api.get('/suppliers/bill-status-summary');

            if (response.data) {
                console.log("✅ Summary data received.");
                setSummary({
                    printed: response.data.printed || [],
                    unprinted: response.data.unprinted || [],
                });
            } else {
                console.warn("⚠️ Received empty response body or data structure from /suppliers/bill-status-summary.");
                setSummary({ printed: [], unprinted: [] });
            }

        } catch (error) {
            console.error('❌ Error fetching summary data:', error.message, error.response?.data);
            setSummary({ printed: [], unprinted: [] });
        } finally {
            if (isAutoRefresh) {
                setIsRefreshing(false);
            } else {
                setIsLoading(false);
            }
        }
    }, []);

    // 🚀 NEW: Function to refresh supplier profile data
    const fetchFarmerLoanTotal = useCallback(async (supplierCode) => {
        if (!supplierCode) return 0;
        try {
            const res = await api.get(`/farmers/${encodeURIComponent(supplierCode)}/loans-total`);
            return parseFloat(res.data?.total_amount) || 0;
        } catch (error) {
            console.error("Error fetching farmer loan total:", error.message);
            return 0;
        }
    }, []);

    // 🚀 NEW: Function to refresh supplier profile data (preserves manual phone changes)
    const fetchSupplierProfile = useCallback(async (supplierCode) => {
        if (!supplierCode || isPrintingOrUpdatingRef.current) return;

        try {
            const supRes = await api.get(`/suppliers/search-by-code/${supplierCode}`);
            setFarmerLoanTotal(await fetchFarmerLoanTotal(supplierCode));
            if (supRes.data) {
                // Printed bills keep the advance/hire they were printed with (loaded in loadBill)
                if (isUnprintedBillRef.current) {
                    setAdvanceAmount(parseFloat(supRes.data.advance_amount) || 0);
                    setHireAmount(parseFloat(supRes.data.hire_amount) || 0);
                }
                setProfilePic(supRes.data.profile_pic);

                // Only update phone number if it hasn't been manually changed by user
                if (!isPhoneManuallyChanged) {
                    setPhoneNo(supRes.data.telephone_no || '');
                }

                setSupplierDocs({
                    title: supRes.data.name || supplierCode,
                    profile: supRes.data.profile_pic,
                    nic_front: supRes.data.nic_front,
                    nic_back: supRes.data.nic_back
                });
            }
        } catch (error) {
            console.error("Error refreshing supplier profile:", error);
        }
    }, [isPhoneManuallyChanged, fetchFarmerLoanTotal]);

    // 🚀 NEW: Function to refresh bill details
    const refreshBillDetails = useCallback(async () => {
        if (!selectedSupplier || isPrintingOrUpdatingRef.current) return;

        const requestKey = activeBillKeyRef.current;
        try {
            if (isUnprintedBill) {
                const response = await api.get(`/suppliers/${selectedSupplier}/unprinted-details`);
                if (activeBillKeyRef.current === requestKey) setSupplierDetails(response.data);
            } else if (selectedBillNo) {
                const response = await api.get(`/suppliers/bill/${selectedBillNo}/details`);
                if (activeBillKeyRef.current === requestKey) setSupplierDetails(response.data);
            }
        } catch (error) {
            console.error("Error refreshing bill details:", error);
        }
    }, [selectedSupplier, selectedBillNo, isUnprintedBill]);

    // 🚀 AUTO-REFRESH: Setup interval to refresh all data periodically, keeping the
    // dashboard near-real-time without a manual page reload. Skipped entirely while
    // the bulk-update modal is open — BulkUpdateContextMenu is now hoisted/memoized
    // (see top of file) so this no longer remounts it and steals input focus.
    useEffect(() => {
        refreshIntervalRef.current = setInterval(async () => {
            if (bulkUpdateContextMenu.show) return;

            console.log("🔄 Auto-refreshing data...");

            // Refresh summary (pass true to indicate auto-refresh)
            await fetchSummary(true);

            // Refresh current bill details if a supplier is selected
            if (selectedSupplier) {
                await refreshBillDetails();
                await fetchSupplierProfile(selectedSupplier);
            }
        }, 3000); // 3 seconds

        // Cleanup on component unmount
        return () => {
            if (refreshIntervalRef.current) {
                clearInterval(refreshIntervalRef.current);
                refreshIntervalRef.current = null;
            }
        };
    }, [fetchSummary, refreshBillDetails, fetchSupplierProfile, selectedSupplier, bulkUpdateContextMenu.show]);

    // --- Initial Fetch ---
    useEffect(() => {
        fetchSummary();
    }, [fetchSummary]);

    // --- Navigation Handler ---
    const goToSalesEntry = () => {
        navigate('/sales');
    };

    // 🚀 NEW: Handle Advance Entry Form Submission
    const handleAdvanceSubmit = async (e) => {
        e.preventDefault();
        const amount = parseFloat(advancePayload.advance_amount);
        if (!advancePayload.code) {
            setAdvanceStatus({ type: 'error', text: tr('Select a supplier bill first.', 'පළමුව සැපයුම්කරු බිලක් තෝරන්න.') });
            return;
        }
        if (!isUnprintedBill) {
            setAdvanceStatus({ type: 'error', text: tr('This bill is already printed. Open an unprinted bill to add an advance.', 'මෙම බිල දැනටමත් මුද්‍රණය කර ඇත. අත්තිකාරම් එක් කිරීමට මුද්‍රණය නොකළ බිලක් විවෘත කරන්න.') });
            return;
        }
        if (advancePayload.advance_amount === '' || !Number.isFinite(amount) || amount < 0) {
            setAdvanceStatus({ type: 'error', text: tr('Enter a valid amount (0 or more).', 'වලංගු මුදලක් ඇතුළත් කරන්න (0 හෝ වැඩි).') });
            return;
        }
        setAdvanceLoading(true);
        setAdvanceStatus({ type: '', text: '' });

        // Pause auto-refresh during update
        isPrintingOrUpdatingRef.current = true;

        try {
            const response = await api.post('/suppliers/advance', { code: advancePayload.code, advance_amount: amount });
            setAdvanceStatus({ type: 'success', text: tr('Success! Advance updated.', 'සාර්ථකයි! අත්තිකාරම් යාවත්කාලීන විය.') });

            // Immediately update the display advance amount
            setAdvanceAmount(parseFloat(response.data.data.advance_amount) || 0);
            setAdvancePayload({ ...advancePayload, advance_amount: '' });

            // Refresh data after update
            await fetchSummary();
            if (selectedSupplier) {
                await fetchSupplierProfile(selectedSupplier);
            }
        } catch (error) {
            console.error("Advance Update Error:", error);
            setAdvanceStatus({ type: 'error', text: `${tr('Update failed', 'යාවත්කාලීන කිරීම අසාර්ථක විය')}: ${extractApiErrorMessage(error, '')}` });
        } finally {
            setAdvanceLoading(false);
            setTimeout(() => {
                isPrintingOrUpdatingRef.current = false;
            }, 500);
        }
    };

    // Hire Entry: saves the hire amount on the supplier (deducted on the next printed bill)
    const handleHireSubmit = async (e) => {
        e.preventDefault();
        const amount = parseFloat(hireInput);
        if (!selectedSupplier) {
            setHireStatus({ type: 'error', text: tr('Select a supplier bill first.', 'පළමුව සැපයුම්කරු බිලක් තෝරන්න.') });
            return;
        }
        if (!isUnprintedBill) {
            setHireStatus({ type: 'error', text: tr('This bill is already printed. Open an unprinted bill to add hire.', 'මෙම බිල දැනටමත් මුද්‍රණය කර ඇත. කුලී එක් කිරීමට මුද්‍රණය නොකළ බිලක් විවෘත කරන්න.') });
            return;
        }
        if (hireInput === '' || !Number.isFinite(amount) || amount < 0) {
            setHireStatus({ type: 'error', text: tr('Enter a valid amount (0 or more).', 'වලංගු මුදලක් ඇතුළත් කරන්න (0 හෝ වැඩි).') });
            return;
        }
        setHireLoading(true);
        setHireStatus({ type: '', text: '' });
        isPrintingOrUpdatingRef.current = true;
        try {
            const response = await api.post('/suppliers/hire', { code: selectedSupplier, hire_amount: amount });
            setHireAmount(parseFloat(response.data?.data?.hire_amount) || 0);
            setHireInput('');
            setHireStatus({ type: 'success', text: tr('Success! Hire amount updated.', 'සාර්ථකයි! කුලී මුදල යාවත්කාලීන විය.') });
        } catch (error) {
            console.error("Hire Update Error:", error);
            setHireStatus({ type: 'error', text: `${tr('Update failed', 'යාවත්කාලීන කිරීම අසාර්ථක විය')}: ${extractApiErrorMessage(error, '')}` });
        } finally {
            setHireLoading(false);
            setTimeout(() => { isPrintingOrUpdatingRef.current = false; }, 500);
        }
    };

    // --- 🚀 NEW: Update Farmer Logic (Enhanced for Bulk) ---
    const handleUpdateFarmer = async () => {
        const finalSupplierCode = newFarmerCode || editingRecord.supplier_code;
        const finalCustomerCode = newCustomerCode || editingRecord.customer_code;

        // Logic to determine which IDs to update
        let idsToUpdate = [editingRecord.id];
        if (applyToAllSameItems) {
            idsToUpdate = supplierDetails
                .filter(item => item.item_name === editingRecord.item_name)
                .map(item => item.id);
        }

        // Pause auto-refresh during update
        isPrintingOrUpdatingRef.current = true;

        try {
            setIsDetailsLoading(true);
            // Using a generic update endpoint that handles arrays or multiple IDs
            const response = await api.put(`/sales/bulk-update-supplier`, {
                transaction_ids: idsToUpdate,
                supplier_code: finalSupplierCode,
                customer_code: finalCustomerCode
            });

            if (response.status === 200) {
                setEditingRecord(null);
                setNewFarmerCode('');
                setNewCustomerCode('');
                setApplyToAllSameItems(true);

                // Refresh current view
                if (isUnprintedBill) {
                    await handleUnprintedBillClick(selectedSupplier, null);
                } else {
                    await handlePrintedBillClick(selectedSupplier, selectedBillNo);
                }
                await fetchSummary();
            }
        } catch (error) {
            console.error("Update failed:", error);
            alert("Failed to update records:\n" + extractApiErrorMessage(error, "Please try again."));
        } finally {
            setIsDetailsLoading(false);
            setTimeout(() => {
                isPrintingOrUpdatingRef.current = false;
            }, 500);
        }
    };

    // --- Filtering Logic ---
    const filteredPrintedItems = useMemo(() => {
        const lowerCaseSearch = printedSearchTerm.toLowerCase();
        const filtered = summary.printed.filter(item =>
            item.supplier_code.toLowerCase().includes(lowerCaseSearch) ||
            (item.supplier_bill_no && item.supplier_bill_no.toLowerCase().includes(lowerCaseSearch))
        );
        return filtered;
    }, [printedSearchTerm, summary.printed]);

    const filteredUnprintedItems = useMemo(() => {
        const lowerCaseSearch = unprintedSearchTerm.toLowerCase();
        const filtered = summary.unprinted.filter(item =>
            item.supplier_code.toLowerCase().includes(lowerCaseSearch)
        );
        return filtered;
    }, [unprintedSearchTerm, summary.unprinted]);

    // --- Shared loader for both side bars ---
    // Details and supplier profile are fetched independently: the details table is
    // filled as soon as its own request returns, and a failed profile lookup (e.g. a
    // supplier code missing from the suppliers table) no longer discards the details.
    const loadBill = async (supplierCode, billNo, isUnprinted) => {
        const requestKey = `${isUnprinted ? 'U' : 'P'}|${supplierCode}|${billNo}`;
        activeBillKeyRef.current = requestKey;
        const isStale = () => activeBillKeyRef.current !== requestKey;

        // Pause auto-refresh while loading new data
        isPrintingOrUpdatingRef.current = true;

        setSelectedSupplier(supplierCode);
        setSelectedBillNo(billNo);
        setIsUnprintedBill(isUnprinted);
        isUnprintedBillRef.current = isUnprinted;
        setHireAmount(0);
        setHireInput('');
        setHireStatus({ type: '', text: '' });
        setAdvanceStatus({ type: '', text: '' });
        setSupplierDetails([]);
        setSelectedTransactionIds([]); // Ticks belong to the previous bill's rows
        setSelectionCriteria(null);
        setAdvanceAmount(0);
        setFarmerLoanTotal(0);
        setProfilePic(null);
        setPhoneNo(''); // Reset before fetch
        setIsPhoneManuallyChanged(false); // 🔄 RESET manual change flag for new bill
        setPayingAmount(''); // Reset paying amount
        setAdvancePayload({ code: supplierCode, advance_amount: '' });
        setIsDetailsLoading(true);

        const detailsUrl = isUnprinted
            ? `/suppliers/${supplierCode}/unprinted-details`
            : `/suppliers/bill/${billNo}/details`;

        const detailsPromise = api.get(detailsUrl)
            .then(res => {
                if (isStale()) return;
                setSupplierDetails(Array.isArray(res.data) ? res.data : (res.data?.data || []));
            })
            .catch(error => console.error(`❌ Error fetching ${isUnprinted ? 'unprinted' : 'printed'} details:`, error.message, error.response?.data))
            .finally(() => {
                if (!isStale()) setIsDetailsLoading(false);
            });

        const profilePromise = api.get(`/suppliers/search-by-code/${supplierCode}`)
            .then(supRes => {
                if (isStale() || !supRes.data) return;
                if (isUnprinted) {
                    setAdvanceAmount(parseFloat(supRes.data.advance_amount) || 0);
                    setHireAmount(parseFloat(supRes.data.hire_amount) || 0);
                }
                setProfilePic(supRes.data.profile_pic);
                // 🚀 MATCHING & FETCHING: This gets the phone from the DB record
                setPhoneNo(supRes.data.telephone_no || '');

                setSupplierDocs({
                    title: supRes.data.name || supplierCode,
                    profile: supRes.data.profile_pic,
                    nic_front: supRes.data.nic_front,
                    nic_back: supRes.data.nic_back
                });
            })
            .catch(error => console.error(`❌ Error fetching supplier profile:`, error.message));

        const loanPromise = fetchFarmerLoanTotal(supplierCode)
            .then(total => { if (!isStale()) setFarmerLoanTotal(total); });

        // Printed bill: the advance and hire it was printed with
        const chargesPromise = isUnprinted ? Promise.resolve() : api.get(`/suppliers/bill/${encodeURIComponent(billNo)}/charges`)
            .then(res => {
                if (isStale()) return;
                setAdvanceAmount(parseFloat(res.data?.advance_amount) || 0);
                setHireAmount(parseFloat(res.data?.hire_amount) || 0);
            })
            .catch(error => console.error('❌ Error fetching bill charges:', error.message));

        await Promise.allSettled([detailsPromise, profilePromise, loanPromise, chargesPromise]);
        setTimeout(() => {
            if (!isStale()) isPrintingOrUpdatingRef.current = false;
        }, 500);
    };

    // --- Handle Printed Bill Click ---
    const handlePrintedBillClick = (supplierCode, billNo) => loadBill(supplierCode, billNo, false);

    // --- Handle Unprinted Bill Click ---
    const handleUnprintedBillClick = (supplierCode, billNo) => loadBill(supplierCode, billNo, true);

    // --- Function to reset details ---
    const resetDetails = () => {
        activeBillKeyRef.current = null;
        setSelectedSupplier(null);
        setSelectedBillNo(null);
        setIsUnprintedBill(false);
        isUnprintedBillRef.current = false;
        setSupplierDetails([]);
        setAdvanceAmount(0);
        setHireAmount(0);
        setHireInput('');
        setFarmerLoanTotal(0);
        setAdvancePayload({ code: '', advance_amount: '' });
        setProfilePic(null);
        fetchSummary();
    };

    // --- Helper function for details panel ---
    const formatDecimal = (value, decimals = 2) => (parseFloat(value) || 0).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });

    //function to add telephone number
    const handlePhoneSubmit = async (e) => {
        if (e.key === 'Enter') {
            if (!selectedSupplier) return;

            // Pause auto-refresh during update
            isPrintingOrUpdatingRef.current = true;

            setPhoneStatus('Updating...');
            try {
                await api.post('/suppliers/update-phone', {
                    code: selectedSupplier,
                    telephone_no: phoneNo
                });
                setPhoneStatus('✅ Saved');
                setTimeout(() => setPhoneStatus(''), 2000);

                // Refresh supplier profile after update
                await fetchSupplierProfile(selectedSupplier);
            } catch (error) {
                console.error("Phone Update Error:", error);
                setPhoneStatus('❌ Error');
            } finally {
                setTimeout(() => {
                    isPrintingOrUpdatingRef.current = false;
                }, 500);
            }
        }
    };
    // 🚀 BULK SELECTION: Toggle individual row selection - any record can be selected
    const toggleTransactionSelection = (transactionId, e) => {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }

        const transactionToSelect = supplierDetails.find(t => t.id === transactionId);
        if (!transactionToSelect) return;

        // If already selected, just unselect it
        if (selectedTransactionIds.includes(transactionId)) {
            const newSelectedIds = selectedTransactionIds.filter(id => id !== transactionId);
            setSelectedTransactionIds(newSelectedIds);
            if (newSelectedIds.length === 0) {
                setSelectionCriteria(null);
            }
            return;
        }

        setSelectedTransactionIds([...selectedTransactionIds, transactionId]);
        // Criteria only records the first selected record, for the bulk-update modal header
        if (!selectionCriteria) {
            setSelectionCriteria({
                supplier_code: transactionToSelect.supplier_code,
                item_name: transactionToSelect.item_name,
                customer_code: transactionToSelect.customer_code
            });
        }
    };

    // 🚀 BULK SELECTION: Select-all checkbox - ticks/unticks every record in the details table
    const allDetailsSelected = supplierDetails.length > 0 && supplierDetails.every(t => selectedTransactionIds.includes(t.id));
    const toggleSelectAllTransactions = () => {
        if (allDetailsSelected) {
            setSelectedTransactionIds([]);
            setSelectionCriteria(null);
            return;
        }
        setSelectedTransactionIds(supplierDetails.map(t => t.id));
        if (!selectionCriteria) {
            const first = supplierDetails[0];
            setSelectionCriteria({
                supplier_code: first.supplier_code,
                item_name: first.item_name,
                customer_code: first.customer_code
            });
        }
    };

    // 🚀 BULK SELECTION: Handle right-click on row - selects it (no restriction) and opens the bulk-update menu
    const handleRowRightClick = (e, transaction) => {
        e.preventDefault();
        e.stopPropagation();

        const nextSelectedIds = selectedTransactionIds.includes(transaction.id)
            ? selectedTransactionIds
            : [...selectedTransactionIds, transaction.id];
        const singleRecord = nextSelectedIds.length === 1
            ? supplierDetails.find(r => r.id === nextSelectedIds[0])
            : null;
        // One record: start from its current supplier weight / price. Several: start empty (= skip).
        setBulkUpdateSupplierWeight(singleRecord ? String(singleRecord.weight ?? '') : '');
        setBulkUpdateSupplierPrice(singleRecord ? String(singleRecord.SupplierPricePerKg ?? '') : '');

        if (!selectedTransactionIds.includes(transaction.id)) {
            setSelectedTransactionIds([...selectedTransactionIds, transaction.id]);
            if (!selectionCriteria) {
                setSelectionCriteria({
                    supplier_code: transaction.supplier_code,
                    item_name: transaction.item_name,
                    customer_code: transaction.customer_code
                });
            }
        }

        setBulkUpdateContextMenu({
            show: true,
            x: e.clientX,
            y: e.clientY
        });
        setBulkUpdateSupplierCode('');
        setBulkUpdateCustomerCode('');
    };
    // 🚀 BULK SELECTION: Close context menu
    const closeContextMenu = () => {
        setBulkUpdateContextMenu({ show: false, x: 0, y: 0 });
        setBulkUpdateSupplierCode('');
        setBulkUpdateCustomerCode('');
        setBulkUpdateSupplierWeight('');
        setBulkUpdateSupplierPrice('');
    };

    // 🚀 BULK SELECTION: Handle Escape key
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape' && bulkUpdateContextMenu.show) {
                closeContextMenu();
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [bulkUpdateContextMenu.show]);

    // 🚀 BULK UPDATE: Update selected transactions
    const handleBulkUpdate = async () => {
        const finalSupplierCode = bulkUpdateSupplierCode.trim().toUpperCase();
        const finalCustomerCode = bulkUpdateCustomerCode.trim().toUpperCase();

        if (selectedTransactionIds.length === 0) {
            alert("No transactions selected");
            return;
        }

        // --- Supplier weight / price (sales.SupplierWeight / sales.SupplierPricePerKg) ---
        const singleRecord = selectedTransactionIds.length === 1
            ? supplierDetails.find(r => r.id === selectedTransactionIds[0])
            : null;
        const parseValue = (raw, label) => {
            const text = String(raw ?? '').trim();
            if (text === '') return { value: null };
            const num = Number(text);
            if (!Number.isFinite(num) || num < 0) {
                return { error: tr(`Please enter a valid ${label}.`, `කරුණාකර නිවැරදි ${label} ඇතුළත් කරන්න.`) };
            }
            return { value: num };
        };
        const weightInput = singleRecord ? parseValue(bulkUpdateSupplierWeight, tr('supplier weight', 'සැපයුම්කරු බර')) : { value: null };
        const priceInput = parseValue(bulkUpdateSupplierPrice, tr('supplier price', 'සැපයුම්කරු මිල'));
        if (weightInput.error || priceInput.error) {
            alert(weightInput.error || priceInput.error);
            return;
        }

        const sameNumber = (a, b) => Math.abs((parseFloat(a) || 0) - (parseFloat(b) || 0)) < 0.0005;
        let supplierValueUpdates = [];
        if (singleRecord) {
            // Only send what actually changed from the record's current values
            const update = { id: singleRecord.id };
            if (weightInput.value !== null && !sameNumber(weightInput.value, singleRecord.weight)) {
                update.SupplierWeight = weightInput.value;
            }
            if (priceInput.value !== null && !sameNumber(priceInput.value, singleRecord.SupplierPricePerKg)) {
                update.SupplierPricePerKg = priceInput.value;
            }
            if (update.SupplierWeight !== undefined || update.SupplierPricePerKg !== undefined) {
                supplierValueUpdates = [update];
            }
        } else if (priceInput.value !== null) {
            supplierValueUpdates = selectedTransactionIds.map(id => ({ id, SupplierPricePerKg: priceInput.value }));
        }

        if (!finalSupplierCode && !finalCustomerCode && supplierValueUpdates.length === 0) {
            alert(tr(
                "Please enter a supplier code, customer code, supplier weight or supplier price to update.",
                "යාවත්කාලීන කිරීමට සැපයුම්කරු කේතය, පාරිභෝගික කේතය, සැපයුම්කරු බර හෝ මිල ඇතුළත් කරන්න."
            ));
            return;
        }

        // Pause auto-refresh during update
        isPrintingOrUpdatingRef.current = true;

        try {
            let response = { status: 200 };

            // 1. Codes first: a new supplier code re-applies the commission rules on the
            //    server, which would otherwise overwrite a supplier price set below.
            if (finalSupplierCode || finalCustomerCode) {
                const payload = {
                    transaction_ids: selectedTransactionIds,
                    ...(finalSupplierCode && { supplier_code: finalSupplierCode }),
                    ...(finalCustomerCode && { customer_code: finalCustomerCode })
                };
                response = await api.put(`/sales/bulk-update-supplier`, payload);
            }

            // 2. Supplier weight / price (server recalculates SupplierTotal, profit and commission)
            if (response.status === 200 && supplierValueUpdates.length > 0) {
                response = await api.put(`/sales/supplier-values`, { updates: supplierValueUpdates });
            }

            if (response.status === 200) {
                // Clear selection
                setSelectedTransactionIds([]);
                setSelectionCriteria(null);
                closeContextMenu();

                // Refresh current view
                if (isUnprintedBill) {
                    await handleUnprintedBillClick(selectedSupplier, null);
                } else if (selectedBillNo) {
                    await handlePrintedBillClick(selectedSupplier, selectedBillNo);
                }
                await fetchSummary();

               
            }
        } catch (error) {
            console.error("Bulk update failed:", error);
            alert("Failed to update records:\n" + extractApiErrorMessage(error, "Please try again."));
        } finally {
            setTimeout(() => {
                isPrintingOrUpdatingRef.current = false;
            }, 500);
        }
    };

    // 🚀 BULK SELECTION: Clear all selections
    const clearSelections = () => {
        setSelectedTransactionIds([]);
        setSelectionCriteria(null);
        closeContextMenu();
    };

    // 🚀 NEW: Handle loan amount submission and trigger print
    const handleLoanSubmit = async (e) => {
        if (e.key === 'Enter') {
            if (!selectedSupplier || !payingAmount || parseFloat(payingAmount) <= 0) {
                setLoanStatus('⚠️ Invalid amount');
                setTimeout(() => setLoanStatus(''), 2000);
                return;
            }

            // Pause auto-refresh during loan processing
            isPrintingOrUpdatingRef.current = true;
            setLoanStatus('Processing...');

            try {
                // Calculate total amount (SupplierTotal - payingAmount)
                const totalAmount = totalsupplierSales - parseFloat(payingAmount);

                // Save the loan amount
                await api.post('/supplier-loan', {
                    code: selectedSupplier,
                    loan_amount: parseFloat(payingAmount),
                    total_amount: totalAmount,
                    bill_no: selectedBillNo || null
                });

                setLoanStatus('✅ Loan saved');

                // Clear the input
                setPayingAmount('');

                // Small delay to ensure the loan is saved before printing
                setTimeout(() => {
                    // Trigger the print function
                    handlePrint();
                }, 300);

            } catch (error) {
                console.error("Loan Update Error:", error);

                if (error.response && error.response.status === 422) {
                    setLoanStatus('⚠️ Invalid supplier code');
                } else {
                    setLoanStatus('❌ Error');
                }

                setTimeout(() => setLoanStatus(''), 2000);
            } finally {
                setTimeout(() => {
                    isPrintingOrUpdatingRef.current = false;
                }, 1000);
            }
        }
    };

    const getRowStyle = (index) => index % 2 === 0 ? { backgroundColor: '#f8f9fa' } : { backgroundColor: '#ffffff' };

    // --- CALCULATIONS (Updated to include CustomerPackCost) ---
    const {
        totalWeight,
        totalCommission,
        amountPayable,
        itemSummaryData,
        totalPacksSum,
        totalsupplierSales,
        totalSupplierPackCost,
        totalCusGross,
        totalCustomerPackCost, // <-- NEW: Sum of CustomerPackCost
    } = useMemo(() => {
        let totalWeight = 0, totalsupplierSales = 0, totalCommission = 0, totalPacksSum = 0, totalSupplierPackCost = 0, totalCusGross = 0, totalCustomerPackCost = 0;
        const itemSummary = {};

        supplierDetails.forEach(record => {
            const weight = parseFloat(record.weight) || 0;
            const commission = parseFloat(record.commission_amount) || 0;
            const packs = parseInt(record.packs) || 0;
            const SupplierTotal = parseFloat(record.SupplierTotal) || 0;
            const itemName = record.item_name || 'Unknown Item';
            const rowCusGross = (parseFloat(record?.total) || 0) - (parseFloat(record?.CustomerPackLabour) || 0);
            const packCost = parseFloat(record?.CustomerPackCost) || 0; // <-- NEW: Get pack cost

            totalWeight += weight;
            totalsupplierSales += SupplierTotal;
            totalCommission += commission;
            totalPacksSum += packs;
            totalCusGross += rowCusGross;
            totalCustomerPackCost += packCost; // <-- NEW: Add to total

            if (!itemSummary[itemName]) {
                itemSummary[itemName] = { totalWeight: 0, totalPacks: 0 };
            }
            itemSummary[itemName].totalWeight += weight;
            itemSummary[itemName].totalPacks += packs;
        });

        return {
            totalWeight, totalCommission, amountPayable: totalsupplierSales, itemSummaryData: itemSummary,
            totalPacksSum, totalsupplierSales, totalSupplierPackCost, totalCusGross,
            totalCustomerPackCost, // <-- NEW: Return the total
        };
    }, [supplierDetails]);

    // 🚀 FIXED: Customizable width bill with center alignment and ultra-clear high-visibility styling
    const getA4Content = useCallback((currentBillNo, billWidth = "101mm", topMargin = "13mm") => {
        const date = new Date().toLocaleDateString('si-LK');
        const time = new Date().toLocaleTimeString('si-LK', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const paidAmountValue = parseFloat(payingAmount) || 0;
        const netPayable = totalsupplierSales - advanceAmount - hireAmount - paidAmountValue + totalCustomerPackCost;

        // Format numbers WITHOUT unnecessary decimal places
        const formatNumber = (num) => {
            if (typeof num !== 'number' && typeof num !== 'string') return '0';
            const number = parseFloat(num);
            if (isNaN(number)) return '0';

            if (Number.isInteger(number)) {
                return number.toLocaleString('en-US');
            }

            const roundedToWhole = Math.round(number);
            if (Math.abs(number - roundedToWhole) < 0.001) {
                return roundedToWhole.toLocaleString('en-US');
            }

            return number.toLocaleString('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            });
        };

        // ALL SIZES MULTIPLIED BY 0.65 (65% of original)
        const getStyles = (width) => {
            const widthNum = parseInt(width);

            let headerFontSize, shopFontSize, normalFontSize, smallFontSize, tinyFontSize;
            let tableHeaderFontSize, totalRowFontSize, netTotalFontSize;

            if (widthNum <= 58) {
                headerFontSize = '2.9mm';    // 4.5mm × 0.65
                shopFontSize = '2.3mm';      // 3.5mm × 0.65
                normalFontSize = '2.3mm';    // 3.5mm × 0.65
                smallFontSize = '2.1mm';     // 3.2mm × 0.65
                tinyFontSize = '2mm';        // 3mm × 0.65
                tableHeaderFontSize = '2.1mm'; // 3.2mm × 0.65
                totalRowFontSize = '2.5mm';    // 3.8mm × 0.65
                netTotalFontSize = '2.9mm';    // 4.5mm × 0.65
            } else if (widthNum <= 80) {
                headerFontSize = '3.6mm';    // 5.5mm × 0.65
                shopFontSize = '2.6mm';      // 4mm × 0.65
                normalFontSize = '2.6mm';    // 4mm × 0.65
                smallFontSize = '2.4mm';     // 3.7mm × 0.65
                tinyFontSize = '2.3mm';      // 3.5mm × 0.65
                tableHeaderFontSize = '2.4mm'; // 3.7mm × 0.65
                totalRowFontSize = '2.7mm';    // 4.2mm × 0.65
                netTotalFontSize = '3.3mm';    // 5mm × 0.65
            } else {
                headerFontSize = '4.6mm';    // 7mm × 0.65
                shopFontSize = '2.9mm';      // 4.5mm × 0.65
                normalFontSize = '2.7mm';    // 4.2mm × 0.65
                smallFontSize = '2.6mm';     // 4mm × 0.65
                tinyFontSize = '2.4mm';      // 3.7mm × 0.65
                tableHeaderFontSize = '2.6mm'; // 4mm × 0.65
                totalRowFontSize = '2.9mm';    // 4.5mm × 0.65
                netTotalFontSize = '3.6mm';    // 5.5mm × 0.65
            }

            return {
                containerWidth: width,
                headerFontSize,
                shopFontSize,
                normalFontSize,
                smallFontSize,
                tinyFontSize,
                tableHeaderFontSize,
                totalRowFontSize,
                netTotalFontSize,
                padding: widthNum <= 58 ? '2mm' : '2.6mm',      // 3mm/4mm × 0.65
                cellPadding: widthNum <= 58 ? '1mm' : '1.3mm'  // 1.5mm/2mm × 0.65
            };
        };

        const styles = getStyles(billWidth);

        // Split supplier details into pages with 9 items per page
        const ITEMS_PER_PAGE = 9;

        const splitItemsIntoPages = (items, itemsPerPage = 9) => {
            const pages = [];
            for (let i = 0; i < items.length; i += itemsPerPage) {
                pages.push(items.slice(i, i + itemsPerPage));
            }
            return pages;
        };

        const billLines = isBulkPrintEnabled ? combineSupplierBillLines(supplierDetails) : supplierDetails;
        const itemPages = splitItemsIntoPages(billLines, ITEMS_PER_PAGE);

        // Calculate grand totals once for all pages
        const grandTotalPacks = supplierDetails.reduce((sum, record) => sum + (parseInt(record.packs) || 0), 0);
        const grandTotalSales = totalsupplierSales;
        const grandTotalPackCost = totalCustomerPackCost;
        const grandAdvanceAmount = advanceAmount;
        const grandPaidAmount = paidAmountValue;
        const grandNetPayable = netPayable;

        // Generate HTML for each page
        const generatePage = (pageItems, pageNumber, isLastPage) => {
            // Calculate page-specific totals
            let pageTotalSales = 0;
            let pageTotalPacks = 0;

            pageItems.forEach(record => {
                pageTotalSales += parseFloat(record.SupplierTotal) || 0;
                pageTotalPacks += parseInt(record.packs) || 0;
            });

            return `
        <div class="bill-border" style="page-break-after: ${isLastPage ? 'avoid' : 'always'};">
            ${pageNumber === 1 ? `
            <div class="header">
                <div class="shop-name">${SHOP_NAME} (${SHOP_STALL_NO})</div>
                <div class="shop-address">${SHOP_ADDRESS}</div>
                <div class="shop-phone">${tr('Tel', 'දුරකථන')}: ${SHOP_PHONE}</div>
            </div>
            
            <div class="info-row" style="display: flex; flex-wrap: nowrap; gap: 3.3mm; white-space: nowrap;">
                <div>${tr('Farmer', 'ගොවියා')}: ${(selectedSupplier || '').toUpperCase()}</div>
                <div>${tr('No:', 'අං:')} ${currentBillNo || ''}</div>
                <div>${tr('Date', 'දිනය')}: ${date}</div>
                <div>${time}</div>
            </div>
            ` : `
            <div class="header-continued">
                <div class="continued-label">(${tr('Page', 'පිටුව')} ${pageNumber} / ${itemPages.length} - ${tr('please continue reading', 'කරුණාකර දිගටම කියවන්න')})</div>
            </div>
            `}

            ${itemPages.length > 1 ? `
            <div style="margin-bottom: 1.3mm; font-size: ${styles.tinyFontSize}; text-align: center; font-weight: bold;">
                ${tr('Page', 'පිටුව')} ${pageNumber} / ${itemPages.length}
            </div>
            ` : ''}

            <table>
                <colgroup>
                    <col style="width: 30%">
                    <col style="width: 10%">
                    <col style="width: 15%">
                    <col style="width: 15%">
                    <col style="width: 15%">
                    <col style="width: 15%">
                </colgroup>
                <thead>
                    <tr>
                        <th style="text-align: left; font-size: ${styles.tableHeaderFontSize};">${tr('Type', 'වර්ගය')}</th>
                        <th style="font-size: ${styles.tableHeaderFontSize};">${tr('Bags', 'මලු')}</th>
                        <th style="text-align: right; font-size: ${styles.tableHeaderFontSize};">${tr('Weight', 'බර')}</th>
                        <th style="text-align: right; font-size: ${styles.tableHeaderFontSize};">${tr('Price', 'මිල')}</th>
                        <th style="text-align: center; font-size: ${styles.tableHeaderFontSize};">${tr('Cust', 'ගනු')}</th>
                        <th style="text-align: right; font-size: ${styles.tableHeaderFontSize};">${tr('Total', 'එකතුව')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${pageItems.map(record => `
                        <tr style="page-break-inside: avoid;">
                            <td style="text-align: left; padding: ${styles.cellPadding}; font-size: ${styles.normalFontSize};">${record.item_name || ''}</td>
                            <td style="text-align: center; padding: ${styles.cellPadding}; font-size: ${styles.normalFontSize};">${record.packs || 0}</td>
                            <td class="text-right" style="padding: ${styles.cellPadding}; font-size: ${styles.normalFontSize};">${formatNumber(record.weight)}</td>
                            <td class="text-right" style="padding: ${styles.cellPadding}; font-size: ${styles.normalFontSize};">${formatNumber(record.SupplierPricePerKg)}</td>
                            <td style="text-align: center; padding: ${styles.cellPadding}; font-size: ${styles.normalFontSize};">${(record.customer_code || '').toUpperCase()}</td>
                            <td class="text-right" style="padding: ${styles.cellPadding}; font-size: ${styles.normalFontSize};">${formatNumber(record.SupplierTotal)}</td>
                        </tr>
                    `).join('')}
                </tbody>
                <tfoot>
                    <tr style="background: #f0f0f0;">
                        <td colspan="2" style="font-size: ${styles.smallFontSize}; font-weight: bold; padding: ${styles.cellPadding};">${tr('Page Total', 'මෙම පිටුවේ එකතුව')}</td>
                        <td class="text-right" style="font-size: ${styles.smallFontSize}; font-weight: bold; padding: ${styles.cellPadding};">  </td>
                        <td style="font-size: ${styles.smallFontSize}; font-weight: bold; padding: ${styles.cellPadding};">  </td>
                        <td class="text-center" style="font-size: ${styles.smallFontSize}; font-weight: bold; padding: ${styles.cellPadding};">${pageTotalPacks}</td>
                        <td class="text-right" style="font-size: ${styles.smallFontSize}; font-weight: bold; padding: ${styles.cellPadding};">${formatNumber(pageTotalSales)}</td>
                    </tr>
                </tfoot>
            </table>

            ${isLastPage ? `
            <div class="totals-section">
                <div class="total-row"><span>${tr('Grand Total', 'මුළු එකතුව')}:</span><span>${tr('Rs.', 'රු.')} ${formatNumber(grandTotalSales)}</span></div>
                <div class="total-row"><span>${tr('Bag Cost', 'මලු වියදම')}:</span><span>${tr('Rs.', 'රු.')} ${formatNumber(grandTotalPackCost)}</span></div>
                <div class="total-row"><span>${tr('Advance', 'අත්තිකාරම්')}:</span><span style="color: red !important;">${tr('Rs.', 'රු.')} -${formatNumber(grandAdvanceAmount)}</span></div>
                ${hireAmount > 0 ? `<div class="total-row"><span>${tr('Hire', 'කුලී')}:</span><span style="color: red !important;">${tr('Rs.', 'රු.')} -${formatNumber(hireAmount)}</span></div>` : ''}
                ${grandPaidAmount > 0 ? `<div class="total-row"><span>${tr('Paid Amount', 'ගෙවූ මුදල')}:</span><span>${tr('Rs.', 'රු.')} -${formatNumber(grandPaidAmount)}</span></div>` : ''}
                <div class="net-total">
                    <span>${tr('Amount Payable', 'ගෙවිය යුතු මුදල')}:</span>
                    <span>${tr('Rs.', 'රු.')} ${formatNumber(grandNetPayable)}</span>
                </div>
                ${farmerLoanTotal !== 0 ? `<div class="total-row"><span>${tr('Previous Loan', 'පෙර ණය')}:</span><span>${tr('Rs.', 'රු.')} ${Math.abs(farmerLoanTotal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>` : ''}
            </div>
            
            <div class="footer">
                ${tr('*** Thank you! Please come again ***', '*** ස්තුතියි! නැවත පැමිණෙන්න ***')}
                <div style="margin-top: 1mm; font-size: ${styles.tinyFontSize};">${date} | ${time}</div>
            </div>
            ` : `
            <div class="footer" style="margin-top: 2.6mm; text-align: center; font-size: ${styles.smallFontSize}; border-top: 0.3mm dashed #000; padding-top: 1.6mm;">
                ${tr('*** Please turn to the next page ***', '*** කරුණාකර පහත පිටුවට හැරෙන්න ***')}
            </div>
            `}
        </div>
    `;
        };

        // Generate all pages
        let allPagesHTML = '';
        if (supplierDetails.length === 0) {
            allPagesHTML = `
        <div class="bill-border">
            <div class="header">
                <div class="shop-name">${SHOP_NAME} (${SHOP_STALL_NO})</div>
                <div class="shop-address">${SHOP_ADDRESS}</div>
                <div class="shop-phone">${tr('Tel', 'දුරකථන')}: ${SHOP_PHONE}</div>
            </div>
            
            <div class="info-row">
                <div>${tr('Code', 'කේතය')}: ${(selectedSupplier || '').toUpperCase()}</div>
                <div>${tr('No', 'අංකය')}: ${currentBillNo || ''}</div>
                <div>${tr('Date', 'දිනය')}: ${date}</div>
                <div>${tr('Time', 'වේලාව')}: ${time}</div>
            </div>
            
            <div style="text-align: center; padding: 6.5mm; font-size: ${styles.headerFontSize}; font-weight: bold;">
                ${tr('No items', 'අයිතම නොමැත')}
            </div>
            
            <div class="footer">
                ${tr('*** Thank you! Please come again ***', '*** ස්තුතියි! නැවත පැමිණෙන්න ***')}
                <div style="margin-top: 1mm; font-size: ${styles.tinyFontSize};">${date} | ${time}</div>
            </div>
        </div>
    `;
        } else {
            itemPages.forEach((page, idx) => {
                allPagesHTML += generatePage(page, idx + 1, idx === itemPages.length - 1);
            });
        }

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        
        body { 
            font-family: 'Iskoola Pota', Arial, sans-serif; 
            background: #f0f0f0; 
            padding: 0;
            margin: 0;
        }

        .bill-border { 
            width: ${styles.containerWidth}; 
            max-width: ${styles.containerWidth};
            min-width: ${styles.containerWidth};
            background: white;
            padding: ${styles.padding};
            margin: ${topMargin} auto 0 auto;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
            page-break-after: always;
            page-break-inside: avoid;
        }

        @media print {
            body { 
                background: white; 
                padding: 0; 
                margin: 0;
            }
            .bill-border { 
                box-shadow: none; 
                margin: 0 auto !important;
                page-break-after: always;
                page-break-inside: avoid;
            }
            @page { 
                size: ${styles.containerWidth} auto;
                margin: 0mm;
            }
        }

        div, span, p, td, th, strong, .shop-name, .shop-address, .shop-phone, 
        .info-row, .total-row, .net-total, .footer, .header-continued { 
            color: #000 !important; 
            font-weight: bold !important; 
        }

        .header { 
            text-align: center; 
            border-bottom: 0.5mm solid #000; 
            padding-bottom: 1.6mm; 
            margin-bottom: 1.6mm; 
        }
        
        .header-continued {
            text-align: center;
            border-bottom: 0.3mm solid #000;
            padding-bottom: 1.3mm;
            margin-bottom: 1.6mm;
        }
        
        .continued-label {
            font-size: ${styles.smallFontSize};
            font-weight: bold;
            color: #333;
        }
        
        .shop-name { 
            font-size: ${styles.headerFontSize}; 
            margin-bottom: 1mm; 
            font-weight: bold;
        }
        .shop-address, .shop-phone { 
            font-size: ${styles.shopFontSize}; 
            margin: 0.7mm 0; 
            font-weight: bold;
        }

        .info-row { 
            display: flex; 
            justify-content: space-between; 
            margin-bottom: 1.6mm; 
            padding: 1.3mm; 
            border: 0.3mm solid #000; 
            font-size: ${styles.normalFontSize};
            font-weight: bold;
        }

        table { 
            width: 100%; 
            border-collapse: collapse; 
            margin-bottom: 1.6mm;
            table-layout: fixed;
        }
        
        th { 
            border: 0.3mm solid #000; 
            padding: ${styles.cellPadding}; 
            background: #eee; 
            font-weight: bold;
        }
        
        td { 
            border: 0.2mm solid #000; 
            vertical-align: top;
            font-weight: bold;
        }

        .text-right { text-align: right; }
        .text-center { text-align: center; }

        .totals-section { 
            margin-top: 1.6mm; 
            border-top: 0.3mm solid #000; 
            padding-top: 1.6mm;
        }
        
        .total-row { 
            display: flex; 
            justify-content: space-between; 
            padding: 1mm 0; 
            font-size: ${styles.totalRowFontSize};
            font-weight: bold;
        }
        
        .net-total { 
            display: flex; 
            justify-content: space-between; 
            padding: 1.6mm 1mm; 
            border-top: 0.5mm solid #000; 
            border-bottom: 0.5mm solid #000;
            font-size: ${styles.netTotalFontSize};
            margin-top: 1.3mm; 
            background: #f9f9f9;
            font-weight: bold;
        }

        .footer { 
            margin-top: 2.6mm; 
            text-align: center; 
            font-size: ${styles.smallFontSize}; 
            border-top: 0.3mm dashed #000; 
            padding-top: 1.6mm; 
            font-weight: bold;
        }
    </style>
</head>
<body>
    ${allPagesHTML}
</body>
</html>`;
    }, [selectedSupplier, supplierDetails, totalsupplierSales, advanceAmount, hireAmount, payingAmount, totalPacksSum, totalWeight, totalCustomerPackCost, farmerLoanTotal, isBulkPrintEnabled]);

    const getBillContent = useCallback((currentBillNo) => {
        const date = new Date().toLocaleDateString('si-LK');
        const mobile = SHOP_PHONE;
        const is4Inch = billSize === '4inch';
        const receiptMaxWidth = is4Inch ? '4in' : '350px';
        const fontSizeBody = '18px';
        const fontSizeHeader = '18px';
        const fontSizeTotal = '28px';

        // 🚀 NEW: Calculation for Loan/Partial Payment
        const paidAmountValue = parseFloat(payingAmount) || 0;
        const remainingAfterPayment = totalsupplierSales - paidAmountValue;

        const colGroups = `
    <colgroup>
        <col style="width:32%;"> 
        <col style="width:21%;">
        <col style="width:21%;">
        <col style="width:26%;">
    </colgroup>`;

        const formatNumber = (value, maxDecimals = 3) => {
            if (typeof value !== 'number' && typeof value !== 'string') return '0';
            const number = parseFloat(value);
            if (isNaN(number)) return '0';
            if (Number.isInteger(number)) return number.toLocaleString('en-US');
            const parts = number.toFixed(maxDecimals).replace(/\.?0+$/, '').split('.');
            const wholePart = parseInt(parts[0]).toLocaleString('en-US');
            return parts[1] ? `${wholePart}.${parts[1]}` : wholePart;
        };

        const billLines = isBulkPrintEnabled ? combineSupplierBillLines(supplierDetails) : supplierDetails;
        const detailedItemsHtml = billLines.map(record => {
            const weight = parseFloat(record.weight) || 0;
            const packs = parseInt(record.packs) || 0;
            const price = parseFloat(record.SupplierPricePerKg) || 0;
            const total = parseFloat(record.SupplierTotal) || 0;
            const itemName = record.item_name || '';
            const customerCode = record.customer_code?.toUpperCase() || '';

            return `
        <tr style="font-size:${fontSizeBody}; font-weight:bold; vertical-align: bottom;">
            <td style="text-align:left; padding:10px 0; white-space: nowrap;">${itemName}<br>${formatNumber(packs)}</td>
            <td style="text-align:right; padding:10px 2px; position: relative; left: -70px;">${formatNumber(weight.toFixed(2))}</td>
            <td style="text-align:right; padding:10px 2px; position: relative; left: -65px;">${formatNumber(price.toFixed(2))}</td>
            <td style="padding:10px 0; display:flex; flex-direction:column; align-items:flex-end;">
                <div style="font-size:25px; white-space:nowrap;">${customerCode}</div>
                <div style="font-weight:900; white-space:nowrap;">${formatNumber(total.toFixed(2))}</div>
            </td>
          </tr>`;
        }).join("");

        const summaryEntries = Object.entries(itemSummaryData);
        let itemSummaryHtml = '';
        for (let i = 0; i < summaryEntries.length; i += 2) {
            const [name1, d1] = summaryEntries[i];
            const [name2, d2] = summaryEntries[i + 1] || [null, null];
            const text1 = `${name1}:${formatNumber(d1.totalWeight)}/${formatNumber(d1.totalPacks)}`;
            const text2 = d2 ? `${name2}:${formatNumber(d2.totalWeight)}/${formatNumber(d2.totalPacks)}` : '';
            itemSummaryHtml += `<tr><td style="padding:6px; width:50%; font-weight:bold; white-space:nowrap; font-size:14px;">${text1}</td><td style="padding:6px; width:50%; font-weight:bold; white-space:nowrap; font-size:14px;">${text2}</td></tr>`;
        }

        // 🚀 CALCULATION FOR FINAL NET AMOUNT
        // We subtract both Advance and any current payment made
        const netPayable = totalsupplierSales - advanceAmount - hireAmount - paidAmountValue + totalCustomerPackCost;

        return `
<!DOCTYPE html>
<html>
<head>
<style>
    @page {
        size: 80mm auto;
        margin: 0mm;
    }
    @media print {
        body {
            margin: 0;
            padding: 0;
        }
        html, body {
            width: 80mm;
            margin: 0;
            padding: 0;
        }
        div, table, tr, td, tbody, thead, tfoot {
            page-break-inside: avoid;
            page-break-after: avoid;
            page-break-before: avoid;
        }
    }
</style>
</head>
<body>
<div style="width:${receiptMaxWidth}; margin:0 auto; padding:10px; font-family:'Courier New', monospace; color:#000; background:#fff;">
    <div style="text-align:center; font-weight:bold;">
        <div style="font-size:24px;">${SHOP_NAME} (${SHOP_STALL_NO})</div>
        <div style="display:flex; justify-content:center; align-items:center; gap:15px; margin:12px 0;">
            <div style="font-size:18px;">${tr('Farmer', 'ගොවියා')}: <span style="border:2.5px solid #000; padding:5px 10px; font-size:22px;">${selectedSupplier}</span></div>
        </div>
      <div style="font-size:16px; white-space: nowrap;">${SHOP_ADDRESS}</div>
    </div>
    <div style="font-size:19px; margin-top:10px; padding:0 5px;">
        <div style="font-weight: bold; white-space: normal;">${tr('Tel', 'දුර')}: ${mobile}</div>
        <div style="display:flex; justify-content:space-between; margin-top:3px;">
            <span>${tr('Bill No', 'බිල් අංකය')}:${currentBillNo}</span>
            <span>${tr('Date', 'දිනය')}:${date}</span>
        </div>
    </div>
    <hr style="border:none; border-top:2.5px solid #000; margin:10px 0;">
    <table style="width:100%; border-collapse:collapse; font-size:${fontSizeBody}; table-layout: fixed;">
        ${colGroups}
        <thead>
            <tr style="border-bottom:2.5px solid #000; font-weight:bold;">
                <th style="text-align:left; padding-bottom:8px; font-size:${fontSizeHeader};">${tr('Type', 'වර්ගය')}<br>${tr('Bags', 'මලු')}</th>
                <th style="text-align:right; padding-bottom:8px; font-size:${fontSizeHeader}; position: relative; left: -50px; top: 24px;"> ${tr('Kg', 'කිලෝ')} </th>
                 <th style="text-align:right; padding-bottom:8px; font-size:${fontSizeHeader}; position: relative; left: -45px; top: 24px;">${tr('Price', 'මිල')}</th>
                <th style="text-align:right; padding-bottom:8px; font-size:${fontSizeHeader};">${tr('Code', 'කේතය')}<br>${tr('Value', 'අගය')}</th>
              </tr>
        </thead>
        <tbody>${detailedItemsHtml}</tbody>
        <tfoot>
            <tr style="border-top:2.5px solid #000; font-weight:bold;">
                <td style="padding-top:12px; font-size:${fontSizeTotal};">${formatNumber(totalPacksSum)}</td>
                <td colspan="3" style="padding-top:12px; font-size:${fontSizeTotal};"><div style="text-align:right; float:right; white-space:nowrap;">${(totalsupplierSales.toFixed(2))}</div></td>
              </tr>
        </tfoot>
      </table>

    <table style="width:100%; margin-top:20px; font-weight:bold; font-size:22px; padding:0 5px;">
         <tr>
          <td style="font-size:15px; white-space:nowrap; position:relative; left:-15px;">${tr('Total value of this bill', 'මෙම බිලට මුළු අගය')}:</td>
          <td style="text-align:right;"><span style="border-bottom:2px solid #000; font-size:${fontSizeTotal}; padding:5px 10px;">${(totalsupplierSales.toFixed(2))}</span></td>
         </tr>
        <tr>
          <td style="font-size:15px; white-space:nowrap; position:relative; left:-15px;">${tr('Bag Cost', 'මලු වියදම')}:</td>
          <td style="text-align:right;"><span style="font-size:${fontSizeTotal}; padding:5px 10px;">${totalCustomerPackCost.toFixed(2)}</span></td>
        </tr>
        
        ${paidAmountValue > 0 ? `
        <tr style="font-size:18px;">
            <td style="font-size:15px; padding-top:10px;">${tr('Paid', 'ගෙවූ මුදල (Paid)')}:</td>
            <td style="text-align:right; padding-top:10px; color:#000;">
                - ${paidAmountValue.toFixed(2)}
              </td>
          </tr>
        <tr style="font-size:18px;">
            <td style="font-size:15px; padding-top:5px;">${tr('Remaining', 'ඉතිරි මුදල (Remaining)')}:</td>
            <td style="text-align:right; padding-top:5px; color:#000;">
                ${remainingAfterPayment.toFixed(2)}
              </td>
          </tr>
        <tr><td colspan="2" style="border-top:1px dashed #000; padding: 5px 0;"></td></tr>
        ` : ''}

        <tr style="font-size:18px;">
          <td style="font-size:15px; padding-top:5px;">${tr('Advance', 'අත්තිකාරම්')}</td>
          <td style="text-align:right; padding-top:5px; color:#000;">
            - ${advanceAmount.toFixed(2)}
           </td>
          </tr>
        ${hireAmount > 0 ? `
        <tr style="font-size:18px;">
          <td style="font-size:15px; padding-top:5px;">${tr('Hire', 'කුලී')}</td>
          <td style="text-align:right; padding-top:5px; color:#000;">
            - ${hireAmount.toFixed(2)}
           </td>
          </tr>` : ''}

        <tr style="font-weight:900;">
          <td style="font-size:18px; padding-top:10px;">${tr('Net Remaining Balance', 'ශුද්ධ ඉතිරි ශේෂය')}:</td>
          <td style="text-align:right; padding-top:10px;">
            <span style="color:#000; font-size:${fontSizeTotal}; border-bottom:5px double #000; border-top:2px solid #000;">
              ${netPayable.toFixed(2)}
            </span>
           </td>
        </tr>
        ${farmerLoanTotal !== 0 ? `
        <tr>
          <td style="font-size:18px; padding-top:10px;">${tr('Previous Loan', 'පෙර ණය')}:</td>
          <td style="text-align:right; font-size:20px; padding-top:10px;">
            Rs. ${Math.abs(farmerLoanTotal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </td>
        </tr>` : ''}
    </table>

    <div style="margin-top:25px; border-top:1px dashed #000; padding-top:10px;"><table style="width:100%; border-collapse:collapse; font-size:14px; text-align:center;">${itemSummaryHtml}</table></div>
</div>
</body>
</html>`;
    }, [selectedSupplier, supplierDetails, totalPacksSum, totalsupplierSales, itemSummaryData, billSize, advanceAmount, hireAmount, payingAmount, totalCustomerPackCost, farmerLoanTotal, isBulkPrintEnabled]);

    // F4: open the app's own print window. Nothing is marked printed until Print is pressed.
    const handlePrint = useCallback(() => {
        if (!supplierDetails || supplierDetails.length === 0) return;

        // Pause auto-refresh while the print window is open
        isPrintingOrUpdatingRef.current = true;

        // 🎯 ONLY apply top margin for A4 format
        const isA4 = printFormat === 'a4';
        const topMargin = "20mm"; // Only used for A4

        // Full print document for a bill number (the number of a new bill is only known after Print)
        const buildDocument = (billNo) => {
            const content = isA4 ? getA4Content(billNo, "98mm", topMargin) : getBillContent(billNo);
            return `
        <!DOCTYPE html>
        <html>
            <head>
                <title>Print Bill</title>
                <style>
                    /* CRITICAL FIX: Force margins in print */
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    
                    @media print {
                        @page {
                            margin: 0;
                            ${isA4 ? '' : 'size: 80mm auto;'}
                        }
                        body {
                            margin: 0 !important;
                            padding: 0 !important;
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                        /* 🎯 ONLY apply margin-top when printing A4 */
                        ${isA4 ? `
                        .print-container {
                            margin-top: ${topMargin} !important;
                            padding-top: 0 !important;
                        }
                        ` : `
                        .print-container {
                            margin-top: 0 !important;
                            padding-top: 0 !important;
                        }
                        `}
                    }
                    body {
                        margin: 0;
                        padding: 0;
                        background: white;
                        font-family: 'Iskoola Pota', 'Courier New', monospace;
                    }
                </style>
            </head>
            <body>
                <div class="print-container">
                    ${content}
                </div>
            </body>
        </html>
    `;
        };

        setPrintJob({
            previewHtml: buildDocument(isUnprintedBill ? '—' : selectedBillNo),
            buildDocument,
            isUnprinted: isUnprintedBill,
            billNo: selectedBillNo,
            transactionIds: supplierDetails.map(r => r.id),
            phoneNo,
            advanceAmount,
            hireAmount,
            supplierCode: selectedSupplier,
            isA4,
            busy: false,
            error: '',
        });
    }, [supplierDetails, selectedBillNo, isUnprintedBill, phoneNo, advanceAmount, hireAmount, selectedSupplier, getBillContent, getA4Content, printFormat]);

    // Cancel in the print window: nothing was marked, the bill stays unprinted
    const handleCancelPrintJob = () => {
        setPrintJob(null);
        isPrintingOrUpdatingRef.current = false;
    };

    // Print in the print window: finalize a new bill (bill number + SMS), then print
    const executePrintJob = async () => {
        const job = printJob;
        if (!job || job.busy) return;

        setPrintJob(prev => (prev ? { ...prev, busy: true, error: '' } : prev));
        let finalBillNo = job.billNo;

        if (job.isUnprinted) {
            try {
                const response = await api.post('/suppliers/mark-as-printed', {
                    transaction_ids: job.transactionIds,
                    telephone_no: job.phoneNo,
                    advance_amount: job.advanceAmount,
                    hire_amount: job.hireAmount,
                    supplier_code: job.supplierCode
                });
                finalBillNo = response.data.new_bill_no;
            } catch (err) {
                console.error('Finalize Error:', err);
                setPrintJob(prev => (prev ? { ...prev, busy: false, error: `Bill could not be finalized: ${extractApiErrorMessage(err, 'Unknown error')}` } : prev));
                return;
            }
        }

        await printHtml(job.buildDocument(finalBillNo));

        if (!job.isUnprinted && job.phoneNo) {
            // Reprint of an already printed bill: resend the SMS.
            // The backend skips it when no SMS credentials are configured.
            try {
                await api.post('/suppliers/resend-sms', {
                    bill_no: job.billNo,
                    telephone_no: job.phoneNo,
                    supplier_code: job.supplierCode,
                    transaction_ids: job.transactionIds,
                    advance_amount: job.advanceAmount,
                    hire_amount: job.hireAmount,
                    is_reprint: true
                });
            } catch (err) {
                console.error('SMS Resend Error:', err);
            }
        }

        // Reload so both sections show the bill where it now belongs
        window.location.reload();
    };

    // --- Keyboard event listener ---
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'F1' || event.keyCode === 112) { event.preventDefault(); return false; }
            if ((event.key === 'F4' || event.keyCode === 115) && supplierDetails.length > 0 && !isDetailsLoading) {
                event.preventDefault();
                handlePrint();
            }
            if ((event.key === 'F2' || event.keyCode === 113) && supplierDetails.length > 0 && !isDetailsLoading) {
                event.preventDefault();
                setShowBillPreview(true);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [supplierDetails, handlePrint, isDetailsLoading]);
    // F2 quick preview: shows the same bill content handlePrint would send to the
    // printer, in a small scrollable modal, without opening the print dialog.
    const renderBillPreviewModal = () => {
        if (!showBillPreview) return null;

        const onClose = () => setShowBillPreview(false);
        const isA4 = printFormat === 'a4';
        const previewHtml = isA4 ? getA4Content(selectedBillNo, "98mm", "20mm") : getBillContent(selectedBillNo);

        return (
            <div
                style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
                onClick={onClose}
            >
                <div
                    style={{ backgroundColor: '#ffffff', borderRadius: '12px', width: '95%', maxWidth: isA4 ? '650px' : '380px', maxHeight: '90vh', padding: '0', position: 'relative', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#343a40' }}>
                        <span style={{ color: 'white', fontWeight: 'bold', fontSize: '14px' }}>
                            {tr('Bill Preview (F2)', 'බිල් පෙරදසුන (F2)')} — #{selectedBillNo || 'N/A'}
                        </span>
                        <button
                            onClick={onClose}
                            style={{ background: '#495057', border: 'none', color: 'white', width: '28px', height: '28px', borderRadius: '50%', cursor: 'pointer', fontSize: '14px' }}
                        > ✕ </button>
                    </div>
                    <div style={{ overflowY: 'auto', padding: '16px', backgroundColor: '#f1f1f1' }}>
                        <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    </div>
                    <div style={{ padding: '12px 16px', borderTop: '1px solid #ddd', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button
                            onClick={() => { onClose(); handlePrint(); }}
                            style={{ padding: '8px 18px', backgroundColor: '#ffc107', color: '#343a40', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                        >🖨️ Print (F4)</button>
                        <button
                            onClick={onClose}
                            style={{ padding: '8px 18px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                        >Close</button>
                    </div>
                </div>
            </div>
        );
    };

    //new profile pic view modal
    const renderImageModal = () => {
        if (!isImageModalOpen) return null;

        // Helper to format URLs correctly
        const formatUrl = (path) => {
            if (!path) return null;
            return path.startsWith('http') ? path : `${STORAGE_URL}/${path}`;
        };

        const onClose = () => setIsImageModalOpen(false);

        return (
            <div
                style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
                onClick={onClose}
            >
                <div
                    style={{ backgroundColor: '#1f2937', borderRadius: '20px', width: '95%', maxWidth: '1000px', maxHeight: '95vh', padding: '25px', position: 'relative', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)', border: '1px solid #4b5563', display: 'flex', flexDirection: 'column' }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header Area */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #374151', paddingBottom: '15px' }}>
                        <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: 'white', margin: 0 }}>
                            {supplierDocs.title} {tr('- Document Check', '- ලේඛන පරීක්ෂාව')}
                        </h2>
                        <button
                            onClick={onClose}
                            style={{ background: '#374151', border: 'none', color: 'white', width: '35px', height: '35px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}
                        > ✕ </button>
                    </div>

                    {/* Larger Images Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1.5fr', gap: '20px', overflowY: 'auto', padding: '5px' }}>
                        {/* Profile Picture */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <span style={{ color: '#60a5fa', fontSize: '12px', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase' }}>{tr('Main Photo', 'ප්‍රධාන රූපය')}</span>
                            <div style={{ width: '100%', borderRadius: '12px', overflow: 'hidden', border: '2px solid #3b82f6', backgroundColor: '#111827', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                                <img src={formatUrl(supplierDocs.profile)} style={{ width: '100%', height: 'auto', display: 'block' }} alt="Profile" />
                            </div>
                        </div>

                        {/* NIC Front */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <span style={{ color: '#9ca3af', fontSize: '12px', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase' }}>{tr('NIC Front', 'NIC ඉදිරිපස')}</span>
                            <div style={{ width: '100%', borderRadius: '12px', overflow: 'hidden', border: '2px solid #4b5563', backgroundColor: '#111827', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                                {supplierDocs.nic_front ? (
                                    <img src={formatUrl(supplierDocs.nic_front)} style={{ width: '100%', height: 'auto', maxHeight: '500px', display: 'block', objectFit: 'contain' }} alt="NIC Front" />
                                ) : (
                                    <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>{tr('No photo', 'ඡායාරූපයක් නොමැත')}</div>
                                )}
                            </div>
                        </div>

                        {/* NIC Back */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <span style={{ color: '#9ca3af', fontSize: '12px', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase' }}>{tr('NIC Back', 'NIC පසුපස')}</span>
                            <div style={{ width: '100%', borderRadius: '12px', overflow: 'hidden', border: '2px solid #4b5563', backgroundColor: '#111827', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                                {supplierDocs.nic_back ? (
                                    <img src={formatUrl(supplierDocs.nic_back)} style={{ width: '100%', height: 'auto', maxHeight: '500px', display: 'block', objectFit: 'contain' }} alt="NIC Back" />
                                ) : (
                                    <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>{tr('No photo', 'ඡායාරූපයක් නොමැත')}</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Action Area */}
                    <div style={{ marginTop: '25px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #374151', paddingTop: '15px' }}>
                        <button
                            onClick={onClose}
                            style={{ backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '12px 30px', borderRadius: '10px', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer' }}
                        >Close </button>
                    </div>
                </div>
            </div>
        );
    };

    // 🚀 NEW: Edit Modal UI
    const renderEditModal = () => {
        if (!editingRecord) return null;

        // Logic to count how many records have the same item name
        const sameItemCount = supplierDetails.filter(item => item.item_name === editingRecord.item_name).length;

        return (
            <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
                <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '8px', width: '400px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                    <h3 style={{ marginTop: 0, color: '#091d3d', borderBottom: '2px solid #007bff', paddingBottom: '10px' }}>{tr('Edit Transaction', 'ගනුදෙනුව වෙනස් කරන්න')}</h3>

                    <div style={{ margin: '15px 0', fontSize: '0.9rem', color: '#666', backgroundColor: '#f8f9fa', padding: '10px', borderRadius: '4px' }}>
                        <p style={{ margin: '2px 0' }}><strong>{tr('Bill No:', 'බිල් අං:')}</strong> {editingRecord.bill_no || selectedBillNo}</p>
                        <p style={{ margin: '2px 0' }}><strong>{tr('Item:', 'අයිතමය:')}</strong> {editingRecord.item_name} | {editingRecord.weight} kg</p>
                    </div>

                    {/* 🚀 BULK CHECKBOX */}
                    {sameItemCount > 1 && (
                        <div style={{ backgroundColor: '#fff3cd', padding: '10px', borderRadius: '4px', marginBottom: '15px', border: '1px solid #ffeeba' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.85rem', color: '#856404', fontWeight: 'bold' }}>
                                <input
                                    type="checkbox"
                                    checked={applyToAllSameItems}
                                    onChange={(e) => setApplyToAllSameItems(e.target.checked)}
                                    style={{ width: '18px', height: '18px' }}
                                />
                                {tr('Change all', 'සියලුම')} "{editingRecord.item_name}" ({sameItemCount}) {tr('', 'වෙනස් කරන්න')}
                            </label>
                        </div>
                    )}

                    {/* Supplier Code Input */}
                    <div style={{ marginTop: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: '#555' }}>{tr('New Supplier Code (Optional):', 'නව ගොවි කේතය (Supplier - Optional):')}</label>
                        <input
                            type="text"
                            placeholder={editingRecord.supplier_code} // Show current code as placeholder
                            value={newFarmerCode}
                            onChange={(e) => setNewFarmerCode(e.target.value.toUpperCase())}
                            style={{ width: '100%', padding: '10px', fontSize: '1rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                            autoFocus
                        />
                    </div>

                    {/* Customer Code Input */}
                    <div style={{ marginTop: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: '#555' }}>{tr('New Customer (Optional):', 'නව ගැනුම්කරු (Customer - Optional):')}</label>
                        <input
                            type="text"
                            placeholder={editingRecord.customer_code} // Show current code as placeholder
                            value={newCustomerCode}
                            onChange={(e) => setNewCustomerCode(e.target.value.toUpperCase())}
                            style={{ width: '100%', padding: '10px', fontSize: '1rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '25px' }}>
                        <button onClick={handleUpdateFarmer} style={{ flex: 1, padding: '12px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>OK</button>
                        <button onClick={() => { setEditingRecord(null); setNewFarmerCode(''); setNewCustomerCode(''); setApplyToAllSameItems(true); }} style={{ flex: 1, padding: '12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Cancel</button>
                    </div>
                </div>
            </div>
        );
    };

    // Helper component for rendering supplier codes
    const SupplierCodeList = ({ items, type, searchTerm }) => {
        const groupedItems = useMemo(() => {
            return items.reduce((acc, item) => {
                const { supplier_code, supplier_bill_no } = item;
                if (!supplier_code) return acc;
                if (!acc[supplier_code]) acc[supplier_code] = [];
                if (type === 'printed' && supplier_bill_no) acc[supplier_code].push(supplier_bill_no);
                else if (type === 'unprinted' && !acc[supplier_code].includes(supplier_code)) acc[supplier_code].push(supplier_code);
                return acc;
            }, {});
        }, [items, type]);

        const supplierCodes = Object.keys(groupedItems);
        const buttonBaseStyle = { width: '100%', display: 'block', textAlign: 'left', padding: '10px 15px', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', fontSize: '1rem', marginBottom: '4px', boxSizing: 'border-box' };
        const buttonStyle = type === 'printed' ? { ...buttonBaseStyle, backgroundColor: '#1E88E5', color: 'white' } : { ...buttonBaseStyle, backgroundColor: '#FF7043', color: 'white' };

        if (items.length === 0) return <p style={{ color: '#6c757d', padding: '10px' }}>{searchTerm ? `No results found` : tr('No suppliers in this category', 'මෙම ප්‍රවර්ගයේ සැපයුම්කරු නොමැත')}</p>;

        return (
            <div style={listContainerStyle}>
                {supplierCodes.map(code => (
                    <div key={code}>
                        {groupedItems[code].map(id => (
                            <button key={id} onClick={() => type === 'printed' ? handlePrintedBillClick(code, id) : handleUnprintedBillClick(code, null)} style={buttonStyle}>
                                <span style={{ display: "block", textAlign: "left", fontSize: "15px", fontWeight: "600" }}>{type === 'printed' ? `${code}-${id}` : `${code}`}</span>
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        );
    };

    // --- ALWAYS DISPLAYED DETAILS PANEL ---
    const renderDetailsPanel = () => {
        const panelContainerStyle = { backgroundColor: '#091d3d', padding: '30px', borderRadius: '12px', maxWidth: '100%', maxHeight: 'calc(100vh - 60px)', overflowY: 'auto', position: 'relative', boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)', fontFamily: 'Roboto, Arial, sans-serif', marginTop: '-10px', width: '850px', minHeight: '550px', marginLeft: '0' };
        const headerStyle = { color: '#007bff', borderBottom: '2px solid #e9ecef', paddingBottom: '10px', marginTop: '0', marginBottom: '20px', fontSize: '1.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
        const thStyle = { backgroundColor: '#007bff', color: 'white', fontWeight: '600', padding: '6px 8px', textAlign: 'left', position: 'sticky', top: '0', zIndex: 10, fontSize: '0.8rem', whiteSpace: 'nowrap' };
        const tdStyle = { padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #dee2e6', whiteSpace: 'normal' };

        const renderDataRows = () => (
            <tbody>
                {supplierDetails.map((record, index) => {
                    const isSelected = selectedTransactionIds.includes(record.id);
                    return (
                        <tr
                            key={record.id || index}
                            style={{
                                ...getRowStyle(index),
                                cursor: 'pointer',
                                backgroundColor: isSelected ? '#1e40af' : (index % 2 === 0 ? '#f8f9fa' : '#ffffff'),
                                color: isSelected ? 'white' : 'inherit'
                            }}
                            onClick={() => toggleTransactionSelection(record.id)}
                            onContextMenu={(e) => handleRowRightClick(e, record)}
                        >
                            <td style={{ ...tdStyle, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleTransactionSelection(record.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                                />
                            </td>
                            <td style={tdStyle}>{record.bill_no || selectedBillNo}</td>
                            <td style={tdStyle}>{record.customer_code}</td>
                            <td style={tdStyle}><strong>{record.item_name}</strong></td>
                            <td style={tdStyle}>{record.packs}</td>
                            <td style={tdStyle}>{record.weight}</td>
                            <td style={tdStyle}>{record.price_per_kg}</td>
                            <td style={tdStyle}>{record.SupplierPricePerKg}</td>
                            <td style={tdStyle}>{formatDecimal((record?.total || 0) - (record?.CustomerPackLabour || 0))}</td>
                            <td style={tdStyle}>{record.SupplierTotal}</td>
                            <td style={tdStyle}>{record.commission_amount}</td>
                            <td style={tdStyle}>{record.CustomerPackCost}</td>
                        </tr>
                    );
                })}
                {supplierDetails.length > 0 && (
                    <tr style={{ fontWeight: 'bold', borderTop: '2px solid #000', backgroundColor: '#e9ecef' }}>
                        <td style={tdStyle} colSpan="4"><strong>TOTALS</strong></td>
                        <td style={tdStyle}>{totalPacksSum}</td>
                        <td style={tdStyle}>{totalWeight.toFixed(3)}</td>
                        <td style={tdStyle}>-</td>
                        <td style={tdStyle}>-</td>
                        <td style={tdStyle}>{totalCusGross.toFixed(2)}</td>
                        <td style={tdStyle}>{totalsupplierSales.toFixed(2)}</td>
                        <td style={tdStyle}>-</td>
                        <td style={tdStyle}>{totalCustomerPackCost.toFixed(2)}</td>
                    </tr>
                )}
                {selectedTransactionIds.length > 0 && (
                    <tr>
                        <td colSpan="12" style={{ padding: '10px', textAlign: 'center', backgroundColor: '#e3f2fd' }}>
                            <span style={{ fontWeight: 'bold' }}>
                                ✅ {selectedTransactionIds.length} record(s) selected
                            </span>
                            <button
                                onClick={clearSelections}
                                style={{
                                    marginLeft: '15px',
                                    padding: '4px 12px',
                                    backgroundColor: '#dc3545',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '12px'
                                }}
                            >
                                Clear Selection
                            </button>
                            <span style={{ marginLeft: '15px', fontSize: '12px', color: '#666' }}>
                                💡 Right-click on selected row for bulk update
                            </span>
                        </td>
                    </tr>
                )}
            </tbody>
        );

        return (
            <div className="sr-panel" style={panelContainerStyle}>
                <div style={headerStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <h2 style={{ fontSize: "1.5rem", color: "white", margin: 0 }}>
                            {tr('Transaction Details (Bill No:', 'ගනුදෙනු විස්තර (බිල් අංකය:')} <strong>{selectedBillNo || 'N/A'}</strong>)
                        </h2>

                        {/* TELEPHONE INPUT - DISABLED FOR PRINTED BILLS */}
                        {/* TELEPHONE INPUT - DISABLED FOR PRINTED BILLS */}
                        {selectedSupplier && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="text"
                                    placeholder={tr('Phone number...', 'දුරකථන අංකය...')}
                                    value={phoneNo}
                                    onChange={(e) => {
                                        setPhoneNo(e.target.value);
                                        setIsPhoneManuallyChanged(true); // 🔄 MARK as manually changed
                                    }}
                                    onKeyDown={handlePhoneSubmit}
                                    disabled={!isUnprintedBill}
                                    style={{
                                        padding: '10px 15px',
                                        borderRadius: '8px',
                                        border: '2px solid #ffc107',
                                        fontSize: '1rem',
                                        width: '200px',
                                        backgroundColor: !isUnprintedBill ? '#e9ecef' : '#ffffff',
                                        color: '#000000',
                                        fontWeight: 'bold',
                                        outline: 'none',
                                        boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                                        cursor: !isUnprintedBill ? 'not-allowed' : 'text',
                                        opacity: !isUnprintedBill ? '0.8' : 1
                                    }}
                                />
                                {phoneStatus && (
                                    <span style={{ fontSize: '0.9rem', color: '#00ff00', fontWeight: 'bold', backgroundColor: 'rgba(0,0,0,0.3)', padding: '4px 8px', borderRadius: '4px' }}>
                                        {phoneStatus}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 🚀 DISPLAY PROFILE PIC ON THE RIGHT */}
                    {profilePic && (
                        <div style={{ marginLeft: '20px' }}>
                            <img
                                src={profilePic.startsWith('http') ? profilePic : `${STORAGE_URL}/${profilePic}`}
                                alt="Supplier"
                                onClick={() => setIsImageModalOpen(true)}
                                style={{
                                    width: '60px',
                                    height: '60px',
                                    borderRadius: '50%',
                                    border: '2px solid white',
                                    objectFit: 'cover',
                                    backgroundColor: '#ccc',
                                    cursor: 'pointer'
                                }}
                                onError={(e) => { e.target.style.display = 'none'; }}
                            />
                        </div>
                    )}
                </div>

                <div style={{ marginTop: '20px', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '250px', fontSize: '0.9rem', marginBottom: '30px' }}>
                        <thead>
                            <tr>
                                <th style={{ ...thStyle, textAlign: 'center' }}><input type="checkbox" checked={allDetailsSelected} onChange={toggleSelectAllTransactions} disabled={supplierDetails.length === 0} title="Select all" style={{ cursor: 'pointer', width: '16px', height: '16px' }} /></th>
                                <th style={thStyle}>{tr('Bill No:', 'බිල් අං:')}</th>
                                <th style={thStyle}>{tr('Customer', 'ගනුදෙ')}</th>
                                <th style={thStyle}>{tr('Item', 'අයිත')}</th>
                                <th style={thStyle}>{tr('Packs', 'අසුරුම්')}</th>
                                <th style={thStyle}>{tr('Weight', 'බර')}</th>
                                <th style={thStyle}>{tr('Cust. Price', 'ගනුදෙ මිල')}</th>
                                <th style={thStyle}>{tr('Supp. Price', 'සැපයුම් මිල')}</th>
                                <th style={thStyle}>{tr('Cust. Total', 'ගනුදෙ එක')}</th>
                                <th style={thStyle}>{tr('Supp. Total', 'සැපයුම් එක')}</th>
                                <th style={thStyle}>{tr('Comm.', 'කොමි')}</th>
                                <th style={thStyle}>{tr('Bag Cost', 'මලු විය')}</th>
                            </tr>
                        </thead>
                        {selectedSupplier && supplierDetails.length > 0 ? renderDataRows() : <tbody><tr><td colSpan="12" style={{ textAlign: 'center', color: '#6c757d', fontStyle: 'italic', padding: '50px 0' }}>Select a bill to view details</td></tr></tbody>}
                    </table>
                </div>

                {selectedSupplier && Object.keys(itemSummaryData).length > 0 && (
                    <>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0px' }}>
                            <thead>
                                <tr><th style={{ ...thStyle, backgroundColor: '#6c757d' }}>{tr('Item Name', 'අයිතමය නම')}</th><th style={{ ...thStyle, backgroundColor: '#6c757d' }}>{tr('Total Weight', 'සම්පූර්ණ බර')}</th><th style={{ ...thStyle, backgroundColor: '#6c757d' }}>{tr('Total Packs', 'මුළු අසුරුම්')}</th></tr>
                            </thead>
                            <tbody>
                                {Object.keys(itemSummaryData).map((name, i) => (
                                    <tr key={name} style={getRowStyle(i)}><td style={tdStyle}>{name}</td><td style={tdStyle}>{formatDecimal(itemSummaryData[name].totalWeight, 3)}</td><td style={tdStyle}>{itemSummaryData[name].totalPacks}</td></tr>
                                ))}
                            </tbody>
                        </table>

                        <div style={{ marginTop: '30px', padding: '20px', border: '1px solid #ffffff33', borderRadius: '8px', backgroundColor: '#ffffff11' }}>
                            <h3 style={{ color: '#ffc107', marginTop: 0, fontSize: '1.2rem' }}>{tr('Advance Entry', 'අත්තිකාරම් ඇතුලත් කරන්න (Advance Entry)')}</h3>
                            <form onSubmit={handleAdvanceSubmit} style={{ display: 'flex', gap: '15px', alignItems: 'flex-end' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.8rem', color: '#eee', display: 'block', marginBottom: '5px' }}>Supplier Code</label>
                                    <input
                                        type="text"
                                        value={advancePayload.code}
                                        readOnly
                                        style={{ width: '100%', padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: '#eee', color: '#000' }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.8rem', color: '#eee', display: 'block', marginBottom: '5px' }}>{tr('Amount (Rs:)', 'Amount (රු:)')}</label>
                                    <input
                                        type="number"
                                        name="advance_amount"
                                        value={advancePayload.advance_amount}
                                        onChange={(e) => setAdvancePayload({ ...advancePayload, advance_amount: e.target.value })}
                                        disabled={!isUnprintedBill}
                                        min="0"
                                        step="any"
                                        style={{ width: '100%', padding: '10px', borderRadius: '4px', border: 'none', color: '#000' }}
                                        placeholder={advanceAmount > 0 ? advanceAmount.toFixed(2) : '0.00'}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={advanceLoading || !selectedSupplier || !isUnprintedBill}
                                    style={{ padding: '10px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', height: '40px' }}
                                >
                                    {advanceLoading ? tr('Saving...', 'සුරකිමින්...') : tr('Update Advance', 'අත්තිකාරම් යාවත්කාලීන')}
                                </button>
                            </form>
                            <p style={{ color: '#ddd', margin: '8px 0 0', fontSize: '0.85rem' }}>
                                {isUnprintedBill
                                    ? tr(`Advance on this bill: Rs. ${advanceAmount.toFixed(2)} (deducted once, when this bill is printed)`, `මෙම බිලේ අත්තිකාරම්: රු. ${advanceAmount.toFixed(2)} (බිල මුද්‍රණය කරන විට එක් වරක් අඩු කෙරේ)`)
                                    : tr(`Printed bill: advance Rs. ${advanceAmount.toFixed(2)} was deducted on this bill.`, `මුද්‍රිත බිල: අත්තිකාරම් රු. ${advanceAmount.toFixed(2)} මෙම බිලෙන් අඩු කෙරිණි.`)}
                            </p>
                            {advanceStatus.text && (
                                <p style={{ color: advanceStatus.type === 'success' ? '#28a745' : '#ff4444', marginTop: '10px', fontWeight: 'bold' }}>
                                    {advanceStatus.text}
                                </p>
                            )}
                        </div>

                        {/* Hire Entry: hire (transport) amount deducted on this bill */}
                        <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #ffffff33', borderRadius: '8px', backgroundColor: '#ffffff11' }}>
                            <h3 style={{ color: '#ffc107', marginTop: 0, fontSize: '1.2rem' }}>{tr('Hire Entry', 'කුලී ඇතුලත් කරන්න (Hire Entry)')}</h3>
                            <form onSubmit={handleHireSubmit} style={{ display: 'flex', gap: '15px', alignItems: 'flex-end' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.8rem', color: '#eee', display: 'block', marginBottom: '5px' }}>{tr('Supplier Code', 'සැපයුම්කරු කේතය')}</label>
                                    <input
                                        type="text"
                                        value={selectedSupplier || ''}
                                        readOnly
                                        style={{ width: '100%', padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: '#eee', color: '#000' }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.8rem', color: '#eee', display: 'block', marginBottom: '5px' }}>{tr('Hire Amount (Rs:)', 'කුලී මුදල (රු:)')}</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={hireInput}
                                        onChange={(e) => setHireInput(e.target.value)}
                                        disabled={!isUnprintedBill}
                                        style={{ width: '100%', padding: '10px', borderRadius: '4px', border: 'none', color: '#000' }}
                                        placeholder={hireAmount > 0 ? hireAmount.toFixed(2) : '0.00'}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={hireLoading || !selectedSupplier || !isUnprintedBill}
                                    style={{ padding: '10px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', height: '40px', opacity: (!selectedSupplier || !isUnprintedBill) ? 0.6 : 1 }}
                                >
                                    {hireLoading ? tr('Saving...', 'සුරකිමින්...') : tr('Update Hire', 'කුලී යාවත්කාලීන')}
                                </button>
                            </form>
                            <p style={{ color: '#ddd', margin: '8px 0 0', fontSize: '0.85rem' }}>
                                {isUnprintedBill
                                    ? tr(`Hire on this bill: Rs. ${hireAmount.toFixed(2)} (deducted when this bill is printed)`, `මෙම බිලේ කුලී: රු. ${hireAmount.toFixed(2)} (බිල මුද්‍රණය කරන විට අඩු කෙරේ)`)
                                    : tr(`Printed bill: hire Rs. ${hireAmount.toFixed(2)} was deducted on this bill.`, `මුද්‍රිත බිල: කුලී රු. ${hireAmount.toFixed(2)} මෙම බිලෙන් අඩු කෙරිණි.`)}
                            </p>
                            {hireStatus.text && (
                                <p style={{ color: hireStatus.type === 'success' ? '#28a745' : '#ff4444', marginTop: '10px', fontWeight: 'bold' }}>
                                    {hireStatus.text}
                                </p>
                            )}
                        </div>

                        {/* 🚀 NEW: Loan/Payment Input before Print */}
                        <div style={{ marginTop: '20px', padding: '15px', border: '2px solid #17a2b8', borderRadius: '8px', backgroundColor: '#091d3d' }}>
                            <label style={{ color: '#17a2b8', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>{tr('Enter Paying Amount & Press Enter to Print:', 'ගෙවන මුදල ඇතුලත් කර Print කරන්න (Enter Paying Amount & Enter):')}</label>
                            <input
                                type="number"
                                value={payingAmount}
                                onChange={(e) => setPayingAmount(e.target.value)}
                                onKeyDown={handleLoanSubmit}
                                placeholder="0.00"
                                style={{ width: '100%', padding: '12px', fontSize: '1.2rem', fontWeight: 'bold', borderRadius: '6px', border: '2px solid #ffc107' }}
                            />
                            {loanStatus && <p style={{ color: 'white', marginTop: '5px' }}>{loanStatus}</p>}
                        </div>
                    </>
                )}
                {selectedSupplier && supplierDetails.length > 0 && (
                    <div style={{
                        marginTop: '20px',
                        padding: '14px 20px',
                        borderRadius: '8px',
                        border: '2px solid #28a745',
                        backgroundColor: '#0f2a1c',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <span style={{ color: '#9ca3af', fontWeight: 'bold', fontSize: '1rem', textTransform: 'uppercase' }}>
                            {tr('Selected Bill Total', 'තෝරාගත් බිල් එකතුව (Selected Bill Total)')}
                        </span>
                        <span style={{ color: '#28a745', fontWeight: 'bold', fontSize: '1.5rem' }}>
                            Rs. {(totalsupplierSales + totalCustomerPackCost).toFixed(2)}
                            <span style={{ color: '#9ca3af', fontSize: '0.9rem', marginLeft: '8px' }}>
                                {tr('(Bags:', '(මලු:')} {totalCustomerPackCost.toFixed(2)})
                            </span>
                        </span>
                    </div>
                )}
                <div style={{ textAlign: 'center' }}>
                    <button style={{ padding: '10px 20px', fontSize: '1.1rem', fontWeight: 'bold', backgroundColor: '#ffc107', color: '#343a40', border: 'none', borderRadius: '6px', cursor: 'pointer', marginTop: '20px', opacity: selectedSupplier ? 1 : 0.5 }} onClick={handlePrint} disabled={!selectedSupplier || isDetailsLoading || supplierDetails.length === 0}>
                        🖨️ {isDetailsLoading ? 'Processing...' : (selectedSupplier ? (isUnprintedBill ? `Print & Finalize Bill (F4)` : `Print Copy (F4)`) : 'Select a Bill First')}
                    </button>
                    <div style={{ marginTop: '8px', color: '#9ca3af', fontSize: '0.85rem' }}>
                        Press F2 to preview this bill
                    </div>
                </div>
            </div>
        );
    };

    const navBarStyle = { backgroundColor: '#343a40', padding: '15px 50px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1030, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' };
    const reportContainerStyle = { minHeight: '100vh', padding: '90px 50px 50px 50px', fontFamily: 'Roboto, Arial, sans-serif', boxSizing: 'border-box', backgroundColor: '#1ec139ff', marginTop: '-25px' };

    // Only show full page loading on initial load, not on auto-refresh
    if (isLoading) return <div style={loadingStyle}>Loading Supplier Report...</div>;

    return (
        <>
            <nav className="sr-nav" style={navBarStyle}>
                <h1 style={{ color: 'white', fontSize: '1.5rem', margin: 0 }}>{tr('Supplier Report', 'සැපයුම්කරු වාර්තාව')}</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    {/* Auto-refresh indicator with animation when refreshing */}
                    <div style={{
                        backgroundColor: isRefreshing ? '#28a745' : '#6c757d',
                        padding: '5px 10px',
                        borderRadius: '5px',
                        fontSize: '0.8rem',
                        color: 'white',
                        fontWeight: 'bold',
                        transition: 'background-color 0.3s ease',
                        animation: isRefreshing ? 'pulse 1s infinite' : 'none'
                    }}>
                        🔄 {isRefreshing ? 'Refreshing...' : 'Auto-refresh (3s)'}
                    </div>

                    {/* 🚀 NEW: Print Format Selector */}
                    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#495057', padding: '5px 10px', borderRadius: '5px', gap: '10px' }}>
                        <label style={{ color: 'white', fontSize: '0.9rem', fontWeight: 'bold' }}>Format:</label>
                        <select
                            value={printFormat}
                            onChange={(e) => setPrintFormat(e.target.value)}
                            style={{ padding: '5px', borderRadius: '4px', border: 'none', backgroundColor: 'white', fontWeight: 'bold' }}
                        >
                            <option value="thermal">Thermal</option>
                            <option value="a4">A4 Paper</option>
                        </select>
                    </div>

                    {/* Bulk Printing: merge matching lines on the printed bill (same as sales entry) */}
                    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#495057', padding: '5px 10px', borderRadius: '5px', gap: '8px' }}>
                        <input
                            type="checkbox"
                            id="bulkPrintCheckbox"
                            checked={isBulkPrintEnabled}
                            onChange={(e) => setIsBulkPrintEnabled(e.target.checked)}
                            style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#4CAF50' }}
                        />
                        <label htmlFor="bulkPrintCheckbox" style={{ color: 'white', fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Bulk Printing
                        </label>
                    </div>

                    {/* 🚀 NEW: Bill Size (Only for Thermal) */}
                    {printFormat === 'thermal' && (
                        <button style={{ padding: '8px 15px', fontSize: '0.9rem', fontWeight: 'bold', backgroundColor: '#17a2b8', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }} onClick={() => setBillSize(billSize === '3inch' ? '4inch' : '3inch')}>
                            Size: {billSize}
                        </button>
                    )}

                    <button style={{ padding: '8px 15px', fontSize: '1rem', fontWeight: 'bold', backgroundColor: '#e83e8c', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }} onClick={() => navigate('/suppliers/printed-report')}>{tr('Supplier Loans', 'සැපයුම්කරු ණය')}</button>
                    <button style={{ padding: '10px 20px', fontSize: '1rem', fontWeight: 'bold', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }} onClick={goToSalesEntry}>{tr('Home', 'මුල් පිටුව')}</button>
                </div>
            </nav>

            <div className="sr-container" style={reportContainerStyle}>
                <div className="sr-sections" style={sectionsContainerStyle}>
                    <div className="sr-side" style={printedContainerStyle}>
                        <div className="sr-side-section" style={printedSectionStyle}>
                            <h2 style={{ ...printedHeaderStyle, padding: '0 25px 10px 25px', marginBottom: '15px' }}> {tr('Printed', 'මුද්‍රණය කළ')} </h2>
                            <input type="text" placeholder={tr('🔍 Search printed...', '🔍 මුද්‍රිත සෙවීම...')} value={printedSearchTerm} onChange={(e) => setPrintedSearchTerm(e.target.value)} style={{ ...searchBarStyle, marginBottom: '20px', height: '22px', padding: '12px 25px' }} />
                            <SupplierCodeList items={filteredPrintedItems} type="printed" searchTerm={printedSearchTerm} />
                        </div>
                    </div>
                    <div className="sr-center" style={centerPanelContainerStyle}>{renderDetailsPanel()}</div>
                    <div className="sr-side" style={unprintedContainerStyle}>
                        <div className="sr-side-section" style={unprintedSectionStyle}>
                            <h2 style={{ ...unprintedHeaderStyle, padding: '0 25px 10px 25px', marginBottom: '15px', whiteSpace: 'nowrap' }}>{tr('Unprinted', 'මුද්‍රණය නොකළ')}</h2>
                            <input type="text" placeholder={tr('🔍 Search unprinted...', '🔍 මුද්‍රණ නොකළ සෙවීම...')} value={unprintedSearchTerm} onChange={(e) => setUnprintedSearchTerm(e.target.value)} style={{ ...searchBarStyle, marginBottom: '20px', height: '22px', padding: '12px 25px' }} />
                            <SupplierCodeList items={filteredUnprintedItems} type="unprinted" searchTerm={unprintedSearchTerm} />
                        </div>
                    </div>
                </div>
            </div>
            {renderImageModal()}
            {renderEditModal()}
            {renderBillPreviewModal()}
            <BulkUpdateContextMenu
                show={bulkUpdateContextMenu.show}
                selectionCriteria={selectionCriteria}
                selectedTransactionIds={selectedTransactionIds}
                bulkUpdateSupplierCode={bulkUpdateSupplierCode}
                setBulkUpdateSupplierCode={setBulkUpdateSupplierCode}
                bulkUpdateCustomerCode={bulkUpdateCustomerCode}
                setBulkUpdateCustomerCode={setBulkUpdateCustomerCode}
                bulkUpdateSupplierWeight={bulkUpdateSupplierWeight}
                setBulkUpdateSupplierWeight={setBulkUpdateSupplierWeight}
                bulkUpdateSupplierPrice={bulkUpdateSupplierPrice}
                setBulkUpdateSupplierPrice={setBulkUpdateSupplierPrice}
                selectedRecord={selectedTransactionIds.length === 1 ? supplierDetails.find(r => r.id === selectedTransactionIds[0]) || null : null}
                handleBulkUpdate={handleBulkUpdate}
                closeContextMenu={closeContextMenu}
            />
            {printJob && (
                <PrintPreviewDialog
                    html={printJob.previewHtml}
                    title={`${tr('Print supplier bill', 'ගොවි බිල මුද්‍රණය')} — ${printJob.supplierCode}`}
                    onPrint={executePrintJob}
                    onCancel={handleCancelPrintJob}
                    busy={printJob.busy}
                    error={printJob.error}
                    wide={printJob.isA4}
                />
            )}
        </>
    );
};

// Add CSS animation for the refresh indicator
const style = document.createElement('style');
style.textContent = `
    @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.6; }
        100% { opacity: 1; }
    }
`;
document.head.appendChild(style);

// --- STYLES ---
const headerContainerStyle = { padding: '40px 0 30px 0', borderBottom: '1px solid #E0E0E0', marginBottom: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', backgroundColor: '#1ec139ff' };
const searchBarStyle = { width: '100%', fontSize: '1rem', borderRadius: '6px', border: '1px solid #E0E0E0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', boxSizing: 'border-box', backgroundColor: 'white' };
const sectionsContainerStyle = { display: 'flex', justifyContent: 'space-between', gap: '20px' };
const printedContainerStyle = { width: '200px', flexShrink: 0, marginLeft: '-45px', marginTop: '-10px', border: '2px solid black' };
const unprintedContainerStyle = { width: '180px', flexShrink: 0, marginRight: '-45px', marginTop: '-10px', marginLeft: '0', border: '2px solid black' };
const centerPanelContainerStyle = { flex: '3', minWidth: '700px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' };
const baseSectionStyle = { padding: '25px 0 25px 0', borderRadius: '12px', boxShadow: '0 6px 15px rgba(0, 0, 0, 0.08)', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 210px)' };
const printedSectionStyle = { ...baseSectionStyle, backgroundColor: '#1ec139ff', borderLeft: '5px solid #FFFFFF', minHeight: '550px' };
const unprintedSectionStyle = { ...baseSectionStyle, backgroundColor: '#1ec139ff', borderLeft: '5px solid #FFFFFF', minHeight: '550px' };
const printedHeaderStyle = { color: '#07090ae6', borderBottom: '2px solid #1E88E530', flexShrink: 0, fontSize: '1.3rem' };
const unprintedHeaderStyle = { color: '#07090ae6', borderBottom: '2px solid #FF704330', flexShrink: 0, fontSize: '1.3rem' };
const listContainerStyle = { display: 'flex', flexDirection: 'column', gap: '0px', marginTop: '5px', overflowY: 'auto', padding: '0 5px 0 5px', flexGrow: 1, height: '900px' };
const loadingStyle = { textAlign: 'center', padding: '50px', fontSize: '1.5rem', color: '#1E88E5', backgroundColor: '#1ec139ff' };

export default SupplierReport;