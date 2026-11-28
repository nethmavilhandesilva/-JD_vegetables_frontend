// Supplier bill print templates (A4 and thermal), used by the Supplier Bills page
// (components/Suppliers/SupplierReport.jsx) and the supplier report page
// (components/Reports/supplierfinalreport.jsx), so both print exactly the same bill.
import { SHOP_NAME, SHOP_PHONE, SHOP_ADDRESS, SHOP_STALL_NO } from '../config/shop';
import { tr } from '../i18n/language';
import { billDate, totalKuliya } from './billDate';

// Advance and Hire on every supplier bill: bold black text inside a thick black box, so
// the amounts taken off the bill stand out. `lines` = [[label, amountText], ...].
// Returns one table row (colspan 2) for the thermal-style bills.
export const supplierChargesBoxRow = (lines, { fontSize = '15px' } = {}) => `
        <tr>
          <td colspan="2" style="padding-top:6px;">
            <div style="border:3px solid #000; padding:4px 8px; color:#000; font-weight:900;">
              ${lines.map(([label, value]) => `<div style="display:flex; justify-content:space-between; gap:10px; font-size:${fontSize}; font-weight:900; color:#000; padding:2px 0;"><span style="font-weight:900; color:#000;">${label}</span><span style="font-weight:900; color:#000; white-space:nowrap;">${value}</span></div>`).join('')}
            </div>
          </td>
        </tr>`;

// Bulk Printing (same idea as the sales entry page): on the printed supplier bill, lines
// for the same item, price and pack cost are merged into one line (whatever the customer)
// with their weight, packs and amount added up. Only the printout changes, not the saved
// records. Each line keeps `packs_list` (every record's weight, bags, price and amount)
// for the pack details page.
const packOf = (record) => ({
    weight: parseFloat(record.weight) || 0,
    packs: parseInt(record.packs) || 0,
    price: parseFloat(record.SupplierPricePerKg) || 0,
    total: parseFloat(record.SupplierTotal) || 0,
});
export const combineSupplierBillLines = (records) => {
    const combined = new Map();
    records.slice().sort((a, b) => (a.id || 0) - (b.id || 0)).forEach(record => {
        const key = [
            String(record.item_code || record.item_name || '').toUpperCase(),
            parseFloat(record.SupplierPricePerKg) || 0,
            parseFloat(record.CustomerPackCost) || 0,
        ].join('|');

        const existing = combined.get(key);
        if (!existing) {
            combined.set(key, { ...record, original_ids: [record.id], packs_list: [packOf(record)] });
            return;
        }
        existing.packs_list.push(packOf(record));
        existing.weight = (parseFloat(existing.weight) || 0) + (parseFloat(record.weight) || 0);
        existing.packs = (parseInt(existing.packs) || 0) + (parseInt(record.packs) || 0);
        existing.SupplierTotal = (parseFloat(existing.SupplierTotal) || 0) + (parseFloat(record.SupplierTotal) || 0);
        existing.original_ids.push(record.id);
    });
    return Array.from(combined.values());
};

// Second paper of the supplier bill: the weight of every pack for each merged line
export const supplierPackDetailsPage = (billLines, { supplier, billNo, date, width, fontSize }) => {
    const lines = billLines.filter(l => Array.isArray(l.packs_list) && l.packs_list.length > 1);
    if (lines.length === 0) return '';
    const n = (v) => {
        const x = parseFloat(v) || 0;
        return Number.isInteger(x) ? x.toLocaleString('en-US') : x.toLocaleString('en-US', { maximumFractionDigits: 2 });
    };
    const td = 'border:1px solid #000;padding:3px 5px;';
    const rows = lines.map(l => `
        <tr><td colspan="5" style="${td}background:#eee;font-weight:bold;">${l.item_name || ''}</td></tr>
        ${l.packs_list.map((p, i) => `
        <tr>
            <td style="${td}text-align:center;">${i + 1}</td>
            <td style="${td}text-align:center;">${p.packs}</td>
            <td style="${td}text-align:right;">${n(p.weight)}</td>
            <td style="${td}text-align:right;">${n(p.price)}</td>
            <td style="${td}text-align:right;">${n(p.total)}</td>
        </tr>`).join('')}
        <tr style="font-weight:bold;">
            <td style="${td}">${tr('Total', 'එකතුව')}</td>
            <td style="${td}text-align:center;">${l.packs_list.reduce((t, p) => t + p.packs, 0)}</td>
            <td style="${td}text-align:right;">${n(l.packs_list.reduce((t, p) => t + p.weight, 0))}</td>
            <td style="${td}"></td>
            <td style="${td}text-align:right;">${n(l.packs_list.reduce((t, p) => t + p.total, 0))}</td>
        </tr>`).join('');
    return `
    <div class="supplier-pack-page" style="width:${width}; margin:0 auto; padding:8px; background:#fff; color:#000; font-family:Arial, sans-serif; font-weight:bold; font-size:${fontSize};">
        <div style="text-align:center; font-size:1.3em;">${SHOP_NAME} (${SHOP_STALL_NO})</div>
        <div style="text-align:center; margin:2px 0 6px;">${tr('Pack details', 'මලු විස්තර')}</div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span>${tr('Farmer', 'ගොවියා')}: <span style="font-size:1.5em; border:2px solid #000; padding:0 6px;">${(supplier || '').toUpperCase()}</span></span>
            <span>${tr('No:', 'අං:')} ${billNo || ''}<br>${tr('Date', 'දිනය')}: ${date}</span>
        </div>
        <table style="width:100%; border-collapse:collapse;">
            <thead><tr>
                <th style="${td}">${tr('Pack', 'මල්ල')}</th><th style="${td}">${tr('Bags', 'මලු')}</th>
                <th style="${td}text-align:right;">${tr('Weight', 'බර')}</th><th style="${td}text-align:right;">${tr('Price', 'මිල')}</th>
                <th style="${td}text-align:right;">${tr('Total', 'එකතුව')}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
};


// Page 2 of the supplier bill (pack sheet): only the weights of the records, one column per
// item name; an item with more weights than fit down the page carries on in the next column on
// the same page. Printed when an item has more than one record. Page 1 stays the bill alone.
export const supplierPackSheet = (records = [], { supplier, billNo, date, width = '105mm', rowsPerColumn = 20 } = {}) => {
    const columns = [];
    records.slice().sort((a, b) => (a.id || 0) - (b.id || 0)).forEach((r) => {
        const name = String(r.item_name || r.item_code || '').trim();
        let col = columns.find((c) => c.name.toUpperCase() === name.toUpperCase());
        if (!col) { col = { name, weights: [] }; columns.push(col); }
        col.weights.push(parseFloat(r.weight) || 0);
    });
    if (!columns.some((c) => c.weights.length > 1)) return '';
    const n = (v) => (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));
    const chunks = [];
    columns.forEach((c) => {
        for (let i = 0; i < c.weights.length; i += rowsPerColumn) {
            const last = i + rowsPerColumn >= c.weights.length;
            chunks.push({ name: c.name, cont: i > 0, weights: c.weights.slice(i, i + rowsPerColumn), total: last ? c.weights.reduce((x, w) => x + w, 0) : null, count: c.weights.length });
        }
    });
    // Every rule is inline with !important: the A4 bill's own styles ("table { width: 100% }",
    // everything bold) must not change this sheet. Same look as the New Supplier Bills pack sheet.
    const I = (css) => css.split(';').filter(Boolean).map((r) => `${r} !important`).join(';');
    const td = I('border:1px solid #444;padding:0 5px;height:4.2mm;line-height:4.2mm;text-align:right;font-weight:normal;width:auto;white-space:nowrap;font-size:11px');
    const th = I('border:1px solid #444;background:#eee;font-size:10px;font-weight:bold;padding:2px 5px;width:auto;white-space:nowrap;max-width:24mm;overflow:hidden;text-overflow:ellipsis;text-align:center');
    const tot = I('border:1px solid #444;padding:1px 5px;text-align:right;font-weight:bold;width:auto;white-space:nowrap;font-size:11px;line-height:1.2');
    const cols = chunks.map((ch) => `
        <table style="${I('border-collapse:collapse;width:auto;min-width:14mm;table-layout:auto;margin:0;flex:0 0 auto')}">
            <thead><tr><th style="${th}">${ch.name}${ch.cont ? ' ›' : ''}</th></tr></thead>
            <tbody>${ch.weights.map((w) => `<tr><td style="${td}">${n(w)}</td></tr>`).join('')}
            ${ch.total != null ? `<tr><td style="${tot}">${n(ch.total)}<br><span style="${I('font-weight:normal')}">${ch.count} ${tr('packs', 'මලු')}</span></td></tr>` : ''}</tbody>
        </table>`).join('');
    return `
    <div class="supplier-pack-page" style="width:${width}; margin:0 auto; padding:12mm 5mm 5mm 5mm; background:#fff; color:#000; font-family:Arial, sans-serif; box-sizing:border-box;">
        <div style="${I('display:flex;justify-content:space-between;align-items:center;gap:3mm')}">
            <span style="${I('font-weight:bold;font-size:12px')}">${SHOP_NAME}</span><span style="${I('font-weight:normal;font-size:11px')}">${tr('Pack sheet', 'මලු පත්‍රය')}</span>
        </div>
        <div style="${I('display:flex;justify-content:space-between;align-items:flex-start;margin:3px 0 6px')}">
            <span style="${I('font-size:16px;font-weight:bold;border:2px solid #000;padding:0 5px')}">${(supplier || '').toUpperCase()}</span>
            <span style="${I('text-align:right;font-weight:normal;font-size:11px;line-height:1.5')}">${tr('Bill No', 'බිල් අංකය')}: <span style="${I('font-weight:bold')}">${billNo || ''}</span><br>${date || ''}</span>
        </div>
        <div style="${I('display:flex;flex-wrap:wrap;gap:1.5mm;align-items:flex-start;justify-content:flex-start')}">${cols}</div>
    </div>`;
};

// Totals of a supplier bill's records (same sums the Supplier Bills page shows)
export const supplierBillTotals = (supplierDetails = []) => {
    let totalsupplierSales = 0, totalPacksSum = 0, totalCustomerPackCost = 0;
    const itemSummaryData = {};
    supplierDetails.forEach(record => {
        const weight = parseFloat(record.weight) || 0;
        const packs = parseInt(record.packs) || 0;
        const itemName = record.item_name || 'Unknown Item';
        totalsupplierSales += parseFloat(record.SupplierTotal) || 0;
        totalPacksSum += packs;
        totalCustomerPackCost += parseFloat(record?.CustomerPackCost) || 0;
        if (!itemSummaryData[itemName]) itemSummaryData[itemName] = { totalWeight: 0, totalPacks: 0 };
        itemSummaryData[itemName].totalWeight += weight;
        itemSummaryData[itemName].totalPacks += packs;
    });
    return { totalsupplierSales, totalPacksSum, totalCustomerPackCost, itemSummaryData };
};

// A4 supplier bill: full HTML document
export const buildSupplierA4Bill = (supplierDetails = [], {
    selectedSupplier = '', currentBillNo = '', billWidth = '101mm', topMargin = '13mm',
    advanceAmount = 0, hireAmount = 0, payingAmount = 0, farmerLoanTotal = 0, isBulkPrintEnabled = true,
    printDate = null, // date printed on the bill (default today), e.g. the sale date of an old bill
    printPackSheet = false, // page 2 (pack weights in columns) only when asked for
    deductions = 0, deductionNote = '', // other deductions (New Supplier Bills); 0 = no line
} = {}) => {
    const { totalsupplierSales, totalCustomerPackCost } = supplierBillTotals(supplierDetails);
        const date = billDate(printDate || undefined);
        const time = new Date().toLocaleTimeString('si-LK', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const paidAmountValue = parseFloat(payingAmount) || 0;
        const deductionValue = parseFloat(deductions) || 0;
        const netPayable = totalsupplierSales - advanceAmount - hireAmount - paidAmountValue - deductionValue + totalCustomerPackCost;

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
        const grandKuliya = totalKuliya(supplierDetails);
        // Bag cost (Kuliya) is added to what the supplier is paid
        const grandNetPayable = netPayable + grandKuliya;

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
                <div>${tr('Farmer', 'ගොවියා')}: <span style="font-size: ${styles.headerFontSize}; border: 0.4mm solid #000; padding: 0 1mm;">${(selectedSupplier || '').toUpperCase()}</span></div>
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
                    <col style="width: 34%">
                    <col style="width: 12%">
                    <col style="width: 18%">
                    <col style="width: 16%">
                    <col style="width: 20%">
                </colgroup>
                <thead>
                    <tr>
                        <th style="text-align: left; font-size: ${styles.tableHeaderFontSize};">${tr('Type', 'වර්ගය')}</th>
                        <th style="font-size: ${styles.tableHeaderFontSize};">${tr('Bags', 'මලු')}</th>
                        <th style="text-align: right; font-size: ${styles.tableHeaderFontSize};">${tr('Weight', 'බර')}</th>
                        <th style="text-align: right; font-size: ${styles.tableHeaderFontSize};">${tr('Price', 'මිල')}</th>
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
                            <td class="text-right" style="padding: ${styles.cellPadding}; font-size: ${styles.normalFontSize};">${formatNumber(record.SupplierTotal)}</td>
                        </tr>
                    `).join('')}
                </tbody>
                <tfoot>
                    <tr style="background: #f0f0f0;">
                        <td style="font-size: ${styles.smallFontSize}; font-weight: bold; padding: ${styles.cellPadding};">${tr('Page Total', 'මෙම පිටුවේ එකතුව')}</td>
                        <td class="text-center" style="font-size: ${styles.smallFontSize}; font-weight: bold; padding: ${styles.cellPadding};">${pageTotalPacks}</td>
                        <td style="font-size: ${styles.smallFontSize}; font-weight: bold; padding: ${styles.cellPadding};">  </td>
                        <td style="font-size: ${styles.smallFontSize}; font-weight: bold; padding: ${styles.cellPadding};">  </td>
                        <td class="text-right" style="font-size: ${styles.smallFontSize}; font-weight: bold; padding: ${styles.cellPadding};">${formatNumber(pageTotalSales)}</td>
                    </tr>
                </tfoot>
            </table>

            ${isLastPage ? `
            <div class="totals-section">
                <div class="total-row"><span>${tr('Grand Total', 'මුළු එකතුව')}:</span><span>${tr('Rs.', 'රු.')} ${formatNumber(grandTotalSales)}</span></div>
                ${grandTotalPackCost > 0 ? `<div class="total-row"><span>${tr('Bags', 'මලු')}:</span><span>${tr('Rs.', 'රු.')} ${formatNumber(grandTotalPackCost)}</span></div>` : ''}
                <div class="total-row"><span>${tr('Bag Cost', 'මලු වියදම')}:</span><span>${tr('Rs.', 'රු.')} +${formatNumber(grandKuliya)}</span></div>
                <div style="border: 3px solid #000 !important; padding: 1mm 2mm; margin: 1mm 0; color: #000 !important; font-weight: 900 !important;">
                    <div style="display: flex; justify-content: space-between; color: #000 !important; font-weight: 900 !important; font-size: 0.9em;"><span style="color: #000 !important; font-weight: 900 !important;">${tr('Advance', 'අත්තිකාරම්')}:</span><span style="color: #000 !important; font-weight: 900 !important;">${tr('Rs.', 'රු.')} -${formatNumber(grandAdvanceAmount)}</span></div>
                    <div style="display: flex; justify-content: space-between; color: #000 !important; font-weight: 900 !important; font-size: 0.9em;"><span style="color: #000 !important; font-weight: 900 !important;">${tr('Hire', 'කුලී')}:</span><span style="color: #000 !important; font-weight: 900 !important;">${tr('Rs.', 'රු.')} -${formatNumber(hireAmount)}</span></div>
                </div>
                ${deductionValue > 0 ? `<div class="total-row"><span>${tr('Deductions', 'අඩු කිරීම්')}${deductionNote ? ` (${deductionNote})` : ''}:</span><span>${tr('Rs.', 'රු.')} -${formatNumber(deductionValue)}</span></div>` : ''}
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
                <div>${tr('Code', 'කේතය')}: <span style="font-size: ${styles.headerFontSize};">${(selectedSupplier || '').toUpperCase()}</span></div>
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
            if (printPackSheet) allPagesHTML += supplierPackSheet(supplierDetails, {
                supplier: selectedSupplier, billNo: currentBillNo, date, width: styles.containerWidth,
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
                /* the printer cannot print the first few mm of the paper: start the bill below it */
                padding-top: calc(${styles.padding} + 7mm) !important;
                page-break-after: always;
                page-break-inside: avoid;
            }
            /* Quarter-A4 paper fed through the middle of an A4 printer: A4 page, the bill is a
               block in the horizontal centre starting at the top; margin 0 = no browser header */
            @page { 
                size: A4;
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

        .supplier-pack-page { page-break-before: always !important; break-before: page !important; }
        @media screen { .supplier-pack-page { margin-top: 8mm !important; border-top: 2px dashed #999; } }

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
};

// Thermal (80mm) supplier bill: full HTML document
export const buildSupplierThermalBill = (supplierDetails = [], {
    selectedSupplier = '', currentBillNo = '', billSize = '3inch',
    advanceAmount = 0, hireAmount = 0, payingAmount = 0, farmerLoanTotal = 0, isBulkPrintEnabled = true,
    printDate = null, // date printed on the bill (default today), e.g. the sale date of an old bill
    printPackSheet = false, // page 2 (pack weights in columns) only when asked for
    deductions = 0, deductionNote = '', // other deductions (New Supplier Bills); 0 = no line
} = {}) => {
    const { totalsupplierSales, totalPacksSum, totalCustomerPackCost, itemSummaryData } = supplierBillTotals(supplierDetails);
        const date = billDate(printDate || undefined);
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

            return `
        <tr style="font-size:${fontSizeBody}; font-weight:bold; vertical-align: bottom;">
            <td style="text-align:left; padding:10px 0; white-space: nowrap;">${itemName}<br>${formatNumber(packs)}</td>
            <td style="text-align:right; padding:10px 2px; position: relative; left: -70px;">${formatNumber(weight.toFixed(2))}</td>
            <td style="text-align:right; padding:10px 2px; position: relative; left: -65px;">${formatNumber(price.toFixed(2))}</td>
            <td style="padding:10px 0; display:flex; flex-direction:column; align-items:flex-end;">
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
        // Bag cost (Kuliya) is added to what the supplier is paid
        const deductionValue = parseFloat(deductions) || 0;
        const netPayable = totalsupplierSales - advanceAmount - hireAmount - paidAmountValue - deductionValue + totalCustomerPackCost + totalKuliya(supplierDetails);

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
        div.supplier-pack-page { page-break-before: always !important; break-before: page !important; page-break-inside: auto; }
    }
    @media screen { .supplier-pack-page { margin-top: 20px !important; border-top: 2px dashed #999; } }
</style>
</head>
<body>
<div style="width:${receiptMaxWidth}; margin:0 auto; padding:10px; font-family:'Courier New', monospace; color:#000; background:#fff;">
    <div style="text-align:center; font-weight:bold;">
        <div style="font-size:24px;">${SHOP_NAME} (${SHOP_STALL_NO})</div>
        <div style="display:flex; justify-content:center; align-items:center; gap:15px; margin:12px 0;">
            <div style="font-size:18px;">${tr('Farmer', 'ගොවියා')}: <span style="border:2.5px solid #000; padding:5px 12px; font-size:32px;">${selectedSupplier}</span></div>
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
                <th style="text-align:right; padding-bottom:8px; font-size:${fontSizeHeader};"><br>${tr('Value', 'අගය')}</th>
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
          <td style="text-align:right;"><span style="font-size:${fontSizeTotal}; padding:5px 10px;">${totalKuliya(supplierDetails).toFixed(2)}</span></td>
        </tr>
        ${totalCustomerPackCost > 0 ? `
        <tr>
          <td style="font-size:15px; white-space:nowrap; position:relative; left:-15px;">${tr('Bags', 'මලු')}:</td>
          <td style="text-align:right;"><span style="font-size:${fontSizeTotal}; padding:5px 10px;">${totalCustomerPackCost.toFixed(2)}</span></td>
        </tr>` : ''}
        
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

        ${supplierChargesBoxRow([
            [tr('Advance', 'අත්තිකාරම්'), `- ${Number(advanceAmount || 0).toFixed(2)}`],
            [tr('Hire', 'කුලී'), `- ${Number(hireAmount || 0).toFixed(2)}`],
        ])}
        ${deductionValue > 0 ? `
        <tr style="font-size:18px;">
          <td style="font-size:15px; padding-top:5px;">${tr('Deductions', 'අඩු කිරීම්')}${deductionNote ? ` (${deductionNote})` : ''}</td>
          <td style="text-align:right; padding-top:5px; color:#000;">- ${deductionValue.toFixed(2)}</td>
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
${printPackSheet ? supplierPackSheet(supplierDetails, { supplier: selectedSupplier, billNo: currentBillNo, date, width: receiptMaxWidth }) : ''}
</body>
</html>`;
};

// Several supplier bills (each a full HTML document from the builders above) in ONE document,
// each bill starting on a new page, so they print together.
export const joinSupplierBills = (docs = []) => {
    if (docs.length === 0) return '';
    const styles = [...new Set(docs.flatMap(d => d.match(/<style[\s\S]*?<\/style>/gi) || []))].join('\n');
    const bodies = docs.map(d => {
        const m = d.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        return m ? m[1] : d;
    });
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Supplier Bills</title>${styles}
<style>.supplier-bill-break{page-break-before:always;break-before:page;height:0}</style></head>
<body>${bodies.join('<div class="supplier-bill-break"></div>')}</body></html>`;
};
