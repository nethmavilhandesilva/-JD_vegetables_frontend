// Customer bill lines: records with the same item and the same price per kg are printed as
// ONE line, whatever their supplier (and however many separate entries there were).
// Weight, bags, kuliya and totals are added up. Records with a different bag price stay
// apart so the bag cost on the bill stays correct. Only the customer bill uses this;
// supplier bills and the saved records are not changed.
// Each line keeps `original_ids` = the record ids it stands for (used to mark them printed).
export const combineCustomerBillLines = (sales = []) => {
    const lines = new Map();
    sales.forEach((sale) => {
        const price = parseFloat(sale.price_per_kg) || 0;
        const packCost = parseFloat(sale.CustomerPackCost) || 0;
        const key = `${String(sale.item_code || sale.item_name || '').toUpperCase()}|${price}|${packCost}`;
        const line = lines.get(key);
        if (!line) {
            lines.set(key, { ...sale, original_ids: [sale.id] });
            return;
        }
        line.weight = (parseFloat(line.weight) || 0) + (parseFloat(sale.weight) || 0);
        line.packs = (parseInt(line.packs) || 0) + (parseInt(sale.packs) || 0);
        line.Kuliya = (parseFloat(line.Kuliya) || 0) + (parseFloat(sale.Kuliya) || 0);
        line.total = line.weight * price;
        line.original_ids.push(sale.id);
    });
    return Array.from(lines.values());
};
