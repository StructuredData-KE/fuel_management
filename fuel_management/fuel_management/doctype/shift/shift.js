frappe.ui.form.on('Shift', {
    setup(frm) {
        // Dynamic Dropdown Filtering for CSA
        let csa_query = function(doc, cdt, cdn) {
            let csas = (doc.assigned_csas || []).map(r => r.csa).filter(c => c);
            if(csas.length > 0) {
                return {
                    filters: {
                        'name': ['in', csas]
                    }
                };
            }
            return {};
        };
        
        frm.set_query("csa", "inventory_sales", csa_query);
        frm.set_query("csa", "invoices", csa_query);
        frm.set_query("csa", "mpesa_payments", csa_query);
        frm.set_query("csa", "card_payments", csa_query);
        frm.set_query("csa", "shift_expenses", csa_query);
    },
    actual_cash: function(frm) {
        if (frm.doc.expected_cash !== undefined && frm.doc.expected_cash !== null) {
            let variance = flt(frm.doc.actual_cash) - flt(frm.doc.expected_cash);
            frm.set_value('cash_variance', variance);
        }
    }
});

function recalculate_totals(frm) {
    let inventory_sales = 0;
    (frm.doc.inventory_sales || []).forEach(row => {
        inventory_sales += flt(row.amount);
    });

    let mpesa = 0;
    (frm.doc.mpesa_payments || []).forEach(row => {
        mpesa += flt(row.amount);
    });

    let cards = 0;
    (frm.doc.card_payments || []).forEach(row => {
        cards += flt(row.amount);
    });

    let invoices = 0;
    (frm.doc.invoices || []).forEach(row => {
        invoices += flt(row.amount);
    });

    let expenses = 0;
    (frm.doc.shift_expenses || []).forEach(row => {
        expenses += flt(row.amount);
    });

    let procurement = 0;
    (frm.doc.procurement || []).forEach(row => {
        procurement += flt(row.amount);
    });

    // Note: Fuel sales amount is calculated dynamically on the backend during save because it requires querying Item Prices.
    // The user should click 'Save' to fetch the true expected cash.
}

frappe.ui.form.on('Shift Inventory Sale', {
    quantity: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (row.quantity && row.selling_price) {
            frappe.model.set_value(cdt, cdn, 'amount', flt(row.quantity) * flt(row.selling_price));
        }
    },
    selling_price: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (row.quantity && row.selling_price) {
            frappe.model.set_value(cdt, cdn, 'amount', flt(row.quantity) * flt(row.selling_price));
        }
    },
    item: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (row.item) {
            frappe.db.get_value('Item Price', {item_code: row.item, price_list: 'Standard Selling'}, 'price_list_rate')
            .then(r => {
                if (r && r.message) {
                    frappe.model.set_value(cdt, cdn, 'selling_price', r.message.price_list_rate);
                }
            });
        }
    }
});
