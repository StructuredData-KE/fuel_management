// Copyright (c) 2026, USER and contributors
// For license information, please see license.txt

frappe.ui.form.on("Station Opening Balance", {
    station: function(frm) {
        if (frm.doc.station) {
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Pump Group",
                    filters: { station: frm.doc.station },
                    pluck: "name"
                },
                callback: function(r) {
                    if (r.message && r.message.length > 0) {
                        frappe.call({
                            method: "frappe.client.get_list",
                            args: {
                                doctype: "Pump Nozzle",
                                filters: { pump_group: ["in", r.message] },
                                fields: ["name"]
                            },
                            callback: function(r2) {
                                frm.clear_table("nozzle_balances");
                                if (r2.message) {
                                    r2.message.forEach(n => {
                                        let row = frm.add_child("nozzle_balances");
                                        row.pump_nozzle = n.name;
                                        row.opening_electronic_meter = 0;
                                        row.opening_manual_meter = 0;
                                    });
                                    frm.refresh_field("nozzle_balances");
                                }
                            }
                        });
                    }
                }
            });

            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "M-Pesa Till",
                    filters: { station: frm.doc.station, is_active: 1 },
                    fields: ["name"]
                },
                callback: function(r) {
                    frm.clear_table("mpesa_balances");
                    if (r.message) {
                        r.message.forEach(t => {
                            let row = frm.add_child("mpesa_balances");
                            row.mpesa_till = t.name;
                            row.opening_balance = 0;
                        });
                        frm.refresh_field("mpesa_balances");
                    }
                }
            });
        }
    }
});
