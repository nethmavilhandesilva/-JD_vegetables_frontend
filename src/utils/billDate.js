// Date printed on bills as day/month/year, e.g. 18/11/2026.
// Takes a Date, a 'YYYY-MM-DD' string (read as that calendar day) or nothing (today).
export const billDate = (value = new Date()) => {
    let d = value;
    if (typeof value === 'string') {
        const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
        d = new Date(value);
    }
    if (!(d instanceof Date) || isNaN(d)) return String(value ?? '');
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
};

// Total Kuliya of the records on a bill (printed on bills as "Bag Cost")
export const totalKuliya = (records = []) =>
    records.reduce((sum, r) => sum + (parseFloat(r.Kuliya) || 0), 0);
