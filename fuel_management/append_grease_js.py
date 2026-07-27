import os

js_code = """
// =========================================================
// GREASING MODULE
// =========================================================
function render_greasing(wrapper) {
    const $wrapper = $(wrapper);
    if(!window.ACTIVE_SHIFT) return;

    let is_locked = window.ACTIVE_SHIFT.status !== 'Open';
    
    // Load Inventory Values
    $wrapper.find('#greasing-opening-balance').val(window.SHIFT_DOC.grease_opening_balance || 0);
    $wrapper.find('#greasing-top-up').val(window.SHIFT_DOC.grease_top_up || 0);
    $wrapper.find('#greasing-closing-balance').val(window.SHIFT_DOC.grease_closing_balance || 0);
    $wrapper.find('#greasing-total-used').val(window.SHIFT_DOC.grease_used || 0);

    let calc_used = function() {
        let op = parseFloat($wrapper.find('#greasing-opening-balance').val()) || 0;
        let top = parseFloat($wrapper.find('#greasing-top-up').val()) || 0;
        let cl = parseFloat($wrapper.find('#greasing-closing-balance').val()) || 0;
        $wrapper.find('#greasing-total-used').val(op + top - cl);
    };

    $wrapper.find('#greasing-opening-balance, #greasing-top-up, #greasing-closing-balance').on('input', calc_used);

    // Populate CSA Dropdown
    let csa_html = '<option value="">Select CSA...</option>';
    (window.SHIFT_DOC.assigned_csas || []).forEach(csa_row => {
        if(csa_row.csa) {
            csa_html += `<option value="${csa_row.csa}">${csa_row.csa}</option>`;
        }
    });
    $wrapper.find('#greasing-csa').html(csa_html);

    // Fetch and Populate Vehicle Types
    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Grease Vehicle Type',
            fields: ['name', 'vehicle_type', 'greasing_price'],
            limit_page_length: 500
        },
        callback: function(r) {
            let vt_html = '<option value="">Select Vehicle Type...</option>';
            if(r.message) {
                window.GREASE_VEHICLE_TYPES = {};
                r.message.forEach(vt => {
                    window.GREASE_VEHICLE_TYPES[vt.name] = vt.greasing_price;
                    vt_html += `<option value="${vt.name}">${vt.vehicle_type} (KES ${vt.greasing_price})</option>`;
                });
                $wrapper.find('#greasing-vehicle-type').html(vt_html);
            }
        }
    });

    // Auto-calculate amounts
    let calc_grease_amount = function() {
        let vt = $wrapper.find('#greasing-vehicle-type').val();
        let num = parseInt($wrapper.find('#greasing-num-vehicles').val()) || 1;
        if(vt && window.GREASE_VEHICLE_TYPES && window.GREASE_VEHICLE_TYPES[vt]) {
            let price = window.GREASE_VEHICLE_TYPES[vt];
            $wrapper.find('#greasing-amount-per').val(price);
            // $wrapper.find('#greasing-total-entry').val(price * num); // Not needed in UI, just read amount_per_vehicle
        } else {
            $wrapper.find('#greasing-amount-per').val('');
        }
    };

    $wrapper.find('#greasing-vehicle-type, #greasing-num-vehicles').on('change input', calc_grease_amount);

    let refresh_table = function() {
        let tbody = '';
        let total = 0;
        (window.SHIFT_DOC.greasing_sales || []).forEach((row, idx) => {
            tbody += `
                <tr data-idx="${idx}">
                    <td>${row.csa}</td>
                    <td>${row.vehicle_type}</td>
                    <td>${row.number_of_vehicles}</td>
                    <td>${frappe.format(row.amount_per_vehicle, {fieldtype: 'Currency'})}</td>
                    <td>${frappe.format(row.total_amount, {fieldtype: 'Currency'})}</td>
                    <td>
                        <button class="btn-danger btn-sm btn-delete-greasing" data-idx="${idx}" ${is_locked ? 'disabled' : ''}>Delete</button>
                    </td>
                </tr>
            `;
            total += (row.total_amount || 0);
        });
        
        if(!tbody) tbody = '<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 2rem;">No greasing sales found</td></tr>';
        $wrapper.find('#list-greasing-sales').html(tbody);
        $wrapper.find('#greasing-total-sales-amount').text(frappe.format(total, {fieldtype: 'Currency'}));

        // Delete Handler
        $wrapper.find('.btn-delete-greasing').off('click').on('click', function() {
            if(is_locked) return;
            let idx = $(this).data('idx');
            window.SHIFT_DOC.greasing_sales.splice(idx, 1);
            refresh_table();
        });
    };

    refresh_table();

    // Add Greasing Sale
    $wrapper.find('#btn-add-greasing').off('click').on('click', function() {
        if(is_locked) return;
        let csa = $wrapper.find('#greasing-csa').val();
        let vt = $wrapper.find('#greasing-vehicle-type').val();
        let num = parseInt($wrapper.find('#greasing-num-vehicles').val()) || 1;
        let amount = parseFloat($wrapper.find('#greasing-amount-per').val()) || 0;

        if(!csa || !vt || num < 1 || amount <= 0) {
            frappe.show_alert({message: "Please fill all required fields correctly.", indicator: "red"});
            return;
        }

        if(!window.SHIFT_DOC.greasing_sales) window.SHIFT_DOC.greasing_sales = [];
        window.SHIFT_DOC.greasing_sales.push({
            csa: csa,
            vehicle_type: vt,
            number_of_vehicles: num,
            amount_per_vehicle: amount,
            total_amount: num * amount
        });

        refresh_table();
        
        // Reset form
        $wrapper.find('#greasing-vehicle-type').val('');
        $wrapper.find('#greasing-num-vehicles').val(1);
        $wrapper.find('#greasing-amount-per').val('');
    });

    // Save Greasing Data
    $wrapper.find('#btn-save-greasing').off('click').on('click', function() {
        if(is_locked) return;
        let $btn = $(this);
        let orig = $btn.html();
        
        let op = parseFloat($wrapper.find('#greasing-opening-balance').val()) || 0;
        let top = parseFloat($wrapper.find('#greasing-top-up').val()) || 0;
        let cl = parseFloat($wrapper.find('#greasing-closing-balance').val()) || 0;
        
        $btn.html('<span class="spinner"></span> Saving...').prop('disabled', true);

        frappe.call({
            method: "frappe.client.set_value",
            args: {
                doctype: "Shift",
                name: window.ACTIVE_SHIFT.name,
                fieldname: {
                    "grease_opening_balance": op,
                    "grease_top_up": top,
                    "grease_closing_balance": cl,
                    "greasing_sales": window.SHIFT_DOC.greasing_sales || []
                }
            },
            callback: function(r) {
                if(!r.exc) {
                    frappe.show_alert({message: "Greasing Data Saved Successfully", indicator: "green"});
                    load_shift_data($wrapper);
                }
            },
            always: function() {
                $btn.html(orig).prop('disabled', false);
            }
        });
    });
}
"""

with open(r'c:\Users\USER\Documents\ANTIGRAV\ERPNext\fuel_management\fuel_management\fuel_management\page\shift_operation_spa\shift_operation_spa.js', 'a') as f:
    f.write(js_code)

print("Appended render_greasing to shift_operation_spa.js")
