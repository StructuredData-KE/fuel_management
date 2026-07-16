frappe.ui.form.on('Shift', {
    refresh: function(frm) {
        check_all_variances(frm);
    }
});

frappe.ui.form.on('Pump Meter Reading', {
    opening_electronic_meter: function(frm, cdt, cdn) { calculate_pump_variance(frm, cdt, cdn); },
    closing_electronic_meter: function(frm, cdt, cdn) { calculate_pump_variance(frm, cdt, cdn); },
    opening_manual_meter: function(frm, cdt, cdn) { calculate_pump_variance(frm, cdt, cdn); },
    closing_manual_meter: function(frm, cdt, cdn) { calculate_pump_variance(frm, cdt, cdn); }
});

function calculate_pump_variance(frm, cdt, cdn) {
    let row = frappe.get_doc(cdt, cdn);
    let sales_elec = (row.closing_electronic_meter || 0) - (row.opening_electronic_meter || 0);
    let sales_manual = (row.closing_manual_meter || 0) - (row.opening_manual_meter || 0);
    
    frappe.model.set_value(cdt, cdn, 'sales_quantity_electronic', sales_elec);
    frappe.model.set_value(cdt, cdn, 'sales_quantity_manual', sales_manual);
    
    let variance = sales_elec - sales_manual;
    frappe.model.set_value(cdt, cdn, 'variance', variance);
    
    check_all_variances(frm);
}

frappe.ui.form.on('Dip Stick Reading', {
    opening_dip: function(frm, cdt, cdn) { calculate_dip_variance(frm, cdt, cdn); },
    closing_dip: function(frm, cdt, cdn) { calculate_dip_variance(frm, cdt, cdn); },
    expected_stock: function(frm, cdt, cdn) { calculate_dip_variance(frm, cdt, cdn); }
});

function calculate_dip_variance(frm, cdt, cdn) {
    let row = frappe.get_doc(cdt, cdn);
    let variance = (row.expected_stock || 0) - (row.closing_dip || 0);
    frappe.model.set_value(cdt, cdn, 'variance', variance);
    
    check_all_variances(frm);
}

function check_all_variances(frm) {
    let has_variance = false;
    
    if (frm.doc.pump_meter_readings) {
        frm.doc.pump_meter_readings.forEach(d => {
            if (d.variance && d.variance !== 0) {
                has_variance = true;
            }
        });
    }
    
    if (frm.doc.dip_stick_readings) {
        frm.doc.dip_stick_readings.forEach(d => {
            if (d.variance && d.variance !== 0) {
                has_variance = true;
            }
        });
    }
    
    if (has_variance) {
        frm.set_intro('<b>⚠️ Warning: There are meter/dip stick variances in this Shift!</b>', 'red');
    } else {
        frm.set_intro('');
    }
}
