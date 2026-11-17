// Customer bill lines: records with the same item and the same price per kg are printed as
// ONE line, whatever their supplier (and however many separate entries there were).
// Weight, bags, kuliya and totals are added up. Records with a different bag price stay
// apart so the bag cost on the bill stays correct. Only the customer bill uses this;
// supplier bills and the saved records are not changed.
// Each line keeps `original_ids` = the record ids it stands for (used to mark them printed).
//
// options.packWeights (Pack by pack): each line also gets `pack_weights` = the weight typed
// for every record on that line, in entry order, and `pack_amounts` = each record's amount
// (its weight after bags x price), so the pack details page can list every pack.

// Weight typed for a record (before the bag weight is taken off), from its entry history
export const enteredWeight = (sale) => {
    const history = Array.isArray(sale.breakdown_history) ? sale.breakdown_history : [];
    const typed = history.reduce((sum, h) => sum + (parseFloat(h?.weight) || 0), 0);
    return typed > 0 ? typed : (parseFloat(sale.weight) || 0);
};

// Amount of one record on the bill: weight (after bags) x price, same as the bill's Total
const recordAmount = (sale) => (parseFloat(sale.weight) || 0) * (parseFloat(sale.price_per_kg) || 0);

export const combineCustomerBillLines = (sales = [], options = {}) => {
    const lines = new Map();
    sales.forEach((sale) => {
        const price = parseFloat(sale.price_per_kg) || 0;
        const packCost = parseFloat(sale.CustomerPackCost) || 0;
        const key = `${String(sale.item_code || sale.item_name || '').toUpperCase()}|${price}|${packCost}`;
        const line = lines.get(key);
        if (!line) {
            lines.set(key, {
                ...sale,
                original_ids: [sale.id],
                ...(options.packWeights && { pack_weights: [enteredWeight(sale)], pack_amounts: [recordAmount(sale)] }),
            });
            return;
        }
        line.weight = (parseFloat(line.weight) || 0) + (parseFloat(sale.weight) || 0);
        line.packs = (parseInt(line.packs) || 0) + (parseInt(sale.packs) || 0);
        line.Kuliya = (parseFloat(line.Kuliya) || 0) + (parseFloat(sale.Kuliya) || 0);
        line.total = line.weight * price;
        line.original_ids.push(sale.id);
        if (options.packWeights) {
            line.pack_weights.push(enteredWeight(sale));
            line.pack_amounts.push(recordAmount(sale));
        }
    });
    return Array.from(lines.values());
};
