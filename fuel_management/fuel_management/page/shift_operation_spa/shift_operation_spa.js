window.ACTIVE_SHIFT = null;
window.USERS_LIST = [];
window.PUMP_GROUPS_LIST = [];
window.SHIFT_TEMPLATES = [];

frappe.pages['shift_operation_spa'].on_page_load = function(wrapper) {
    // Render custom HTML structure
    $(wrapper).html(frappe.render_template("shift_operation_spa", {}));
    
    // UI Setup
    setup_tabs(wrapper);
    load_dropdowns(wrapper);
    setup_actions(wrapper);
    
    // Initialize State
    fetch_active_shift(wrapper);
}

function fetch_active_shift(wrapper) {
    const $wrapper = $(wrapper);
    // Find open shift for the logged-in user
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Shift",
            filters: { status: "Open", owner: frappe.session.user },
            fields: ["name", "station", "head_csa", "shift_template", "status"],
            limit_page_length: 1
        },
        callback: function(r) {
            if(r.message && r.message.length > 0) {
                window.ACTIVE_SHIFT = r.message[0];
                lock_ui_for_active_shift($wrapper);
            } else {
                window.ACTIVE_SHIFT = null;
                lock_ui_for_no_shift($wrapper);
            }
        }
    });
}

function lock_ui_for_no_shift($wrapper) {
    $wrapper.find('.nav-item:not([data-target="tab-start"])').css({
        'opacity': '0.5',
        'pointer-events': 'none'
    });
    $wrapper.find('#active-shift-badge').removeClass('active-shift').text('No Active Shift');
    
    // Switch to Start Shift tab
    $wrapper.find('.nav-item[data-target="tab-start"]').click();
}

function lock_ui_for_active_shift($wrapper) {
    $wrapper.find('.nav-item').css({
        'opacity': '1',
        'pointer-events': 'auto'
    });
    // Lock Start Shift module
    $wrapper.find('.nav-item[data-target="tab-start"]').css({
        'opacity': '0.5',
        'pointer-events': 'none'
    });
    
    // Update Badge
    let bShiftName = window.ACTIVE_SHIFT.shift_template ? window.ACTIVE_SHIFT.shift_template : "Shift";
    $wrapper.find('#active-shift-badge').addClass('active-shift').text(`Active: ${bShiftName} - ${window.ACTIVE_SHIFT.name}`);
    
    // Switch to Fuel tab automatically
    $wrapper.find('.nav-item[data-target="tab-fuel"]').click();
    
    // Pre-fill Start Shift form just for viewing
    $wrapper.find('#input-shift-date').val(window.ACTIVE_SHIFT.shift_date).prop('disabled', true);
    $wrapper.find('#select-shift-template').val(window.ACTIVE_SHIFT.shift_template).prop('disabled', true);
    $wrapper.find('#select-station').val(window.ACTIVE_SHIFT.station).prop('disabled', true);
    $wrapper.find('#select-head-csa').val(window.ACTIVE_SHIFT.head_csa).prop('disabled', true);
    $wrapper.find('#btn-start-shift').hide();
    
    // Trigger loading of grid data (Meters, Dips, etc)
    load_shift_data($wrapper);
}

function load_shift_data($wrapper) {
    if(!window.ACTIVE_SHIFT) return;
    
    frappe.call({
        method: "frappe.client.get",
        args: {
            doctype: "Shift",
            name: window.ACTIVE_SHIFT.name
        },
        callback: function(r) {
            if(r.message) {
                window.SHIFT_DOC = r.message;
                render_meters($wrapper);
                render_dips($wrapper);
                render_mpesa($wrapper);
                render_drystock($wrapper);
                if(typeof render_invoices === 'function') render_invoices($wrapper);
            }
        }
    });
}

function render_meters($wrapper) {
    // Fetch nozzle pump group mappings
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Pump Nozzle",
            fields: ["name", "pump_group"],
            limit_page_length: 500
        },
        callback: function(r1) {
            let nozzle_to_pg = {};
            if(r1.message) {
                r1.message.forEach(n => { nozzle_to_pg[n.name] = n.pump_group || "Ungrouped"; });
            }
            
            // Fetch Prices
            frappe.call({
                method: "fuel_management.fuel_management.doctype.shift.shift.get_nozzle_prices",
                args: { station: window.SHIFT_DOC.station, shift_date: window.SHIFT_DOC.shift_date },
                callback: function(r2) {
                    let nozzle_prices = r2.message || {};
                    
                    let grouped = {};
                    (window.SHIFT_DOC.pump_meter_readings || []).forEach(row => {
                        let pg = nozzle_to_pg[row.pump_nozzle] || "Ungrouped";
                        if(!grouped[pg]) grouped[pg] = [];
                        grouped[pg].push(row);
                    });
                    let grouped_entries = Object.entries(grouped);
                    grouped_entries.sort((a, b) => a[0].localeCompare(b[0], undefined, {numeric: true, sensitivity: 'base'}));
                    
                    let html = '';
                    for(const [pg, rows] of grouped_entries) {
                        rows.sort((a, b) => (a.pump_nozzle || "").localeCompare((b.pump_nozzle || ""), undefined, {numeric: true, sensitivity: 'base'}));
                        let assigned_csa_id = "";
                        if (window.SHIFT_DOC.assigned_csas) {
                            let assignment = window.SHIFT_DOC.assigned_csas.find(a => a.pump_group === pg);
                            if (assignment) {
                                assigned_csa_id = assignment.csa;
                            }
                        }
                        
                        let csa_name = assigned_csa_id;
                        if (window.USERS_LIST) {
                            let user = window.USERS_LIST.find(u => u.name === assigned_csa_id);
                            if (user) {
                                csa_name = user.full_name;
                            }
                        }
                        let csa_text = csa_name ? ` &nbsp;|&nbsp; <span style="color: #64748b; font-weight: 500;">CSA: ${csa_name}</span>` : "";

                        html += `
                            <div class="pump-group-card">
                                <div class="pump-group-header">${pg}${csa_text}</div>
                                <div class="pump-nozzles-list">
                        `;
                        rows.forEach(row => {
                            let price = nozzle_prices[row.pump_nozzle] || 0.0;
                            html += `
                                <div class="meter-row" data-name="${row.name}">
                                    <div class="nozzle-col">
                                        <div class="nozzle-name">${row.pump_nozzle}</div>
                                    </div>
                                    
                                    <div class="elec-col">
                                        <div class="col-title">Electronic</div>
                                        <div class="reading-label">Open: <span class="read-only-cell">${row.opening_electronic_meter}</span></div>
                                        <input type="number" step="0.01" class="spa-input meter-closing-elec highlight-input" data-field="closing_electronic_meter" data-opening="${row.opening_electronic_meter}" data-price="${price}" value="${row.closing_electronic_meter || ''}" placeholder="Enter Closing">
                                        <div class="sales-value">Sales: <span class="meter-sales-elec font-weight-bold">0.00</span></div>
                                    </div>
                                    
                                    <div class="manual-col">
                                        <div class="col-title">Manual</div>
                                        <div class="reading-label">Open: <span class="read-only-cell">${row.opening_manual_meter}</span></div>
                                        <input type="number" step="0.01" class="spa-input meter-closing-manual highlight-input" data-field="closing_manual_meter" data-opening="${row.opening_manual_meter}" value="${row.closing_manual_meter || ''}" placeholder="Enter Closing">
                                        <div class="sales-value">Sales: <span class="meter-sales-manual font-weight-bold">0.00</span></div>
                                    </div>
                                    
                                    <div class="summary-col">
                                        <div class="variance-box">Variance: <span class="meter-variance font-weight-bold">0.00</span></div>
                                        <div class="total-box">Value: <span class="meter-total-value font-weight-bold">0.00</span></div>
                                    </div>
                                </div>
                            `;
                        });
                        html += `</div></div>`;
                    }
                    
                    $wrapper.find('#meters-container').html(html);

                    // Format to 2 decimal places on blur
                    $wrapper.find('.meter-closing-elec, .meter-closing-manual').on('blur', function() {
                        if($(this).val()) {
                            $(this).val(parseFloat($(this).val()).toFixed(2));
                        }
                    });

                    // Live Math & Validation
                    function calc_row() {
                        let $row = $(this).closest('.meter-row');
                        let closing_elec = parseFloat($row.find('.meter-closing-elec').val());
                        let opening_elec = parseFloat($row.find('.meter-closing-elec').attr('data-opening')) || 0;
                        let price = parseFloat($row.find('.meter-closing-elec').attr('data-price')) || 0;
                        
                        let closing_manual = parseFloat($row.find('.meter-closing-manual').val());
                        let opening_manual = parseFloat($row.find('.meter-closing-manual').attr('data-opening')) || 0;
                        
                        let sales_elec = 0;
                        if (!isNaN(closing_elec) && closing_elec >= opening_elec) {
                            sales_elec = closing_elec - opening_elec;
                            $row.find('.meter-sales-elec').text(sales_elec.toFixed(2)).css('color', 'var(--text-primary)');
                            $row.find('.meter-closing-elec').removeClass('error-input');
                        } else if(!isNaN(closing_elec)) {
                            $row.find('.meter-sales-elec').text('ERR').css('color', 'var(--danger)');
                            $row.find('.meter-closing-elec').addClass('error-input');
                        }
                        
                        let sales_manual = 0;
                        if (!isNaN(closing_manual) && closing_manual >= opening_manual) {
                            sales_manual = closing_manual - opening_manual;
                            $row.find('.meter-sales-manual').text(sales_manual.toFixed(2)).css('color', 'var(--text-primary)');
                            $row.find('.meter-closing-manual').removeClass('error-input');
                        } else if(!isNaN(closing_manual)) {
                            $row.find('.meter-sales-manual').text('ERR').css('color', 'var(--danger)');
                            $row.find('.meter-closing-manual').addClass('error-input');
                        }
                        
                        let variance = Math.abs(sales_elec - sales_manual);
                        $row.find('.meter-variance').text(variance.toFixed(2));
                        
                        if (variance > 2.0 && sales_manual > 0) {
                            $row.find('.meter-variance').addClass('variance-alert');
                        } else {
                            $row.find('.meter-variance').removeClass('variance-alert');
                        }
                        
                        let total_value = sales_elec * price;
                        $row.find('.meter-total-value').text(total_value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
                    }
                    
                    $wrapper.find('.meter-closing-elec, .meter-closing-manual').on('input', calc_row);
                    // Trigger initial
                    $wrapper.find('.meter-closing-elec').each(calc_row);
                }
            });
        }
    });
}

function render_dips($wrapper) {
    let html = '';
    (window.SHIFT_DOC.dip_stick_readings || []).forEach(row => {
        html += `
            <tr data-name="${row.name}">
                <td style="font-weight: 600; color: var(--text-primary);">${row.fuel_tank}</td>
                <td><span class="read-only-cell">${row.opening_dip || 0}</span></td>
                <td>
                    <input type="number" class="spa-input dip-closing highlight-input" data-field="closing_dip" value="${row.closing_dip || ''}" placeholder="Enter Closing">
                </td>
            </tr>
        `;
    });
    $wrapper.find('#dips-container').html(html);
}

function render_mpesa($wrapper) {
    let html = '';
    (window.SHIFT_DOC.mpesa_payments || []).forEach(row => {
        html += `
            <tr data-name="${row.name}">
                <td style="font-weight: 600; color: var(--text-primary);">${row.mpesa_till}</td>
                <td><span class="read-only-cell">${row.opening_balance || 0}</span></td>
                <td>
                    <input type="number" class="spa-input mpesa-transfers highlight-input" data-field="transfers_made" value="${row.transfers_made || ''}" placeholder="Enter Transfers">
                </td>
                <td>
                    <input type="number" class="spa-input mpesa-closing highlight-input" data-field="closing_balance" data-opening="${row.opening_balance || 0}" value="${row.closing_balance || ''}" placeholder="Enter Closing">
                </td>
                <td class="mpesa-collected font-weight-bold">0.00</td>
            </tr>
        `;
    });
    $wrapper.find('#mpesa-tills-container').html(html);

    // Add Live Math
    function calc_mpesa() {
        let $row = $(this).closest('tr');
        let closing = parseFloat($row.find('.mpesa-closing').val());
        let opening = parseFloat($row.find('.mpesa-closing').attr('data-opening')) || 0;
        let transfers = parseFloat($row.find('.mpesa-transfers').val()) || 0;
        
        let $closingInput = $row.find('.mpesa-closing');
        let collected = (isNaN(closing) ? 0 : closing) - opening + transfers;
        
        if (!isNaN(closing) && collected < 0) {
            $closingInput.addClass('error-input');
            $row.find('.mpesa-collected').text('ERR').css('color', 'var(--danger)');
        } else {
            $closingInput.removeClass('error-input');
            $row.find('.mpesa-collected').text(collected.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})).css('color', 'var(--text-primary)');
        }
    }
    
    $wrapper.find('.mpesa-closing, .mpesa-transfers').on('input', calc_mpesa);
    // Trigger initial
    $wrapper.find('.mpesa-closing').trigger('input');
}


function render_drystock($wrapper) {
    if (!window.ACTIVE_SHIFT) return;
    let sDate = window.ACTIVE_SHIFT.shift_date || window.ACTIVE_SHIFT.creation || frappe.datetime.now_date();
    let shiftName = window.ACTIVE_SHIFT.shift_template ? `${window.ACTIVE_SHIFT.shift_template}` : window.ACTIVE_SHIFT.name;
    $wrapper.find('#drystock-shift-name').text(shiftName);
    $wrapper.find('#drystock-shift-date').text(sDate.split(" ")[0]);
    $wrapper.find('#drystock-history-shift-name').text(shiftName);
    $wrapper.find('#drystock-history-shift-date').text(sDate.split(" ")[0]);

    // Calculate Liability CSA
    let lubes_assignment = (window.ACTIVE_SHIFT.csa_assignments || []).find(a => a.pump_group.toLowerCase().includes('lube'));
    if (lubes_assignment) {
        let u = window.USERS_LIST.find(u => u.name === lubes_assignment.csa);
        let name = u ? u.full_name : lubes_assignment.csa;
        $wrapper.find('#drystock-liability-csa').text(name + " (Assigned)");
    } else {
        $wrapper.find('#drystock-liability-csa').text("Select Sold By (Fallback)");
    }

    // Populate CSA dropdown
    let csaOptions = '<option value="">Select CSA...</option>';
    if (window.USERS_LIST) {
        window.USERS_LIST.forEach(u => { csaOptions += `<option value="${u.name}">${u.full_name}</option>`; });
    }
    $wrapper.find('#drystock-csa').html(csaOptions).off('change').on('change', function() {
        if (!lubes_assignment) {
            let u = window.USERS_LIST.find(u => u.name === $(this).val());
            let name = u ? u.full_name : "Whoever sells it";
            $wrapper.find('#drystock-liability-csa').text(name + " (Fallback)");
        }
    });

    // Event listeners for calculating
    function calc_drystock() {
        let qty = parseFloat($wrapper.find('#drystock-qty').val()) || 0;
        if(qty < 0) { qty = 0; $wrapper.find('#drystock-qty').val(0); }
        let uom = parseFloat($wrapper.find('#drystock-uom').val()) || 0;
        let price = parseFloat($wrapper.find('#drystock-price').val()) || 0;
        
        $wrapper.find('#drystock-volume').val((qty * uom).toFixed(2));
        $wrapper.find('#drystock-total').val((qty * price).toFixed(2));
    }

    $wrapper.find('#drystock-item-input').off('change').on('change', function() {
        let val = $(this).val();
        let item = window.DRYSTOCK_ITEMS.find(i => `${i.item_name} - ${i.item_code}` === val);
        if(item) {
            $wrapper.find('#drystock-price').val(parseFloat(item.price_list_rate).toFixed(2));
            
            // Regex to extract multiplier (e.g. 1L, 4L, 500ML, 0.5KG)
            let mult = 1;
            let m = item.item_name.match(/(\d+(?:\.\d+)?)\s*(L|ML|KG|G|LITRE|LTR)s?\b/i);
            if(m) {
                mult = parseFloat(m[1]);
                let unit = m[2].toUpperCase();
                if (unit === 'ML' || unit === 'G') {
                    mult = mult / 1000.0;
                }
            }
            $wrapper.find('#drystock-uom').val(mult);
        } else {
            $wrapper.find('#drystock-price').val('0.00');
            $wrapper.find('#drystock-uom').val('0');
        }
        calc_drystock();
    });

    $wrapper.find('#drystock-qty, #drystock-uom').off('input').on('input', calc_drystock);

    // Add to Cart
    $wrapper.find('#btn-add-drystock').off('click').on('click', function() {
        let csa = $wrapper.find('#drystock-csa').val();
        let item_val = $wrapper.find('#drystock-item-input').val();
        let item = window.DRYSTOCK_ITEMS.find(i => `${i.item_name} - ${i.item_code}` === item_val);
        
        let qty = parseFloat($wrapper.find('#drystock-qty').val()) || 0;
        if(qty < 0) { qty = 0; $wrapper.find('#drystock-qty').val(0); }
        let uom = parseFloat($wrapper.find('#drystock-uom').val()) || 0;
        let price = parseFloat($wrapper.find('#drystock-price').val()) || 0;
        
        if (!csa || !item || qty <= 0) {
            frappe.show_alert({message: "Please select CSA, search for a valid Item, and enter quantity.", indicator: "red"});
            return;
        }

        let volume = qty * uom;
        let amount = qty * price;

        if (!window.PENDING_DRYSTOCK) window.PENDING_DRYSTOCK = [];
        
        let new_row = {
            doctype: "Shift Inventory Sale",
            sold_by: csa,
            item: item.item_code,
            quantity: qty,
            uom_multiplier: uom,
            total_volume: volume,
            selling_price: price,
            amount: amount,
            _is_new: true
        };
        window.PENDING_DRYSTOCK.push(new_row);
        
        // Reset form
        $wrapper.find('#drystock-item-input').val('');
        $wrapper.find('#drystock-qty').val('');
        $wrapper.find('#drystock-uom').val('');
        $wrapper.find('#drystock-price').val('0.00');
        $wrapper.find('#drystock-volume').val('0.00');
        $wrapper.find('#drystock-total').val('0.00');
        calc_drystock();
        
        refresh_drystock_cart($wrapper);
    });

    refresh_drystock_cart($wrapper);
    
    // Also update variance fields if they already exist in doc
    $wrapper.find('#cash-variance-val').text(window.SHIFT_DOC.cash_variance ? 'KES ' + window.SHIFT_DOC.cash_variance.toLocaleString('en-US', {minimumFractionDigits: 2}) : 'KES 0.00');
    $wrapper.find('#drystock-variance-val').text(window.SHIFT_DOC.dry_stock_cash_variance ? 'KES ' + window.SHIFT_DOC.dry_stock_cash_variance.toLocaleString('en-US', {minimumFractionDigits: 2}) : 'KES 0.00');
    $wrapper.find('#actual-cash-input').val(window.SHIFT_DOC.actual_cash || '');
    $wrapper.find('#actual-drystock-cash-input').val(window.SHIFT_DOC.actual_dry_stock_cash || '');
}

function refresh_drystock_cart($wrapper) {
    let html = '';
    
    let is_locked = window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.status !== "Open" && !(frappe.user.has_role("System Manager") || frappe.user.has_role("Fuel Station Owner"));
    
    let total_qty = 0;
    let total_volume = 0;
    let total_amount = 0;

    (window.PENDING_DRYSTOCK || []).forEach((row, idx) => {
        total_qty += row.quantity || 0;
        total_volume += row.total_volume || 0;
        total_amount += row.amount || 0;
        
        let csa_name = row.sold_by;
        if (window.USERS_LIST) {
            let u = window.USERS_LIST.find(u => u.name === row.sold_by);
            if(u) csa_name = u.full_name;
        }
        
        let entry_id = row.name && !row._is_new ? row.name.substring(0, 8) : "Pending...";
        let time_val = row.creation ? row.creation.split(" ")[1].substring(0, 5) : frappe.datetime.now_time().substring(0, 5);
        
        let del_btn = is_locked ? `<button class="btn btn-xs btn-danger" disabled>X</button>` : `<button class="btn btn-xs btn-danger btn-remove-drystock">X</button>`;
        
        html += `
            <tr data-idx="${idx}">
                <td style="font-family: monospace; color: #64748b;">${entry_id}</td>
                <td style="color: #64748b;">${time_val}</td>
                <td>${csa_name || ''}</td>
                <td>${row.item}</td>
                <td>${row.quantity}</td>
                <td>${row.total_volume || 0}</td>
                <td>${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                <td>${del_btn}</td>
            </tr>
        `;
    });
    
    $wrapper.find('#list-drystock').html(html);
    
    // Also render saved items
    let start_date = $wrapper.find('#drystock-filter-start-date').val();
    let end_date = $wrapper.find('#drystock-filter-end-date').val();
    let filter_search = ($wrapper.find('#drystock-filter-search').val() || '').toLowerCase();
    
    let html_saved = '';
    (window.SHIFT_DOC.inventory_sales || []).forEach((row, idx) => {
        let row_date = row.creation ? row.creation.split(" ")[0] : frappe.datetime.now_date();
        if (start_date && row_date < start_date) return;
        if (end_date && row_date > end_date) return;
        if (filter_search && row.item && !row.item.toLowerCase().includes(filter_search)) return;
        
        let csa_name = row.sold_by;
        if (window.USERS_LIST) {
            let u = window.USERS_LIST.find(u => u.name === row.sold_by);
            if(u) csa_name = u.full_name;
        }
        let entry_id = row.name && !row._is_new ? row.name.substring(0, 8) : "Saved";
        let time_val = row.creation ? row.creation.split(" ")[1].substring(0, 5) : frappe.datetime.now_time().substring(0, 5);
        let del_btn = is_locked ? 
            `<button class="btn btn-xs btn-danger" disabled>X</button>` : 
            `<button class="btn btn-xs btn-secondary btn-edit-saved" data-idx="${idx}" style="margin-right:0.25rem;">Edit</button>
             <button class="btn btn-xs btn-danger btn-remove-saved" data-idx="${idx}">X</button>`;
        
        html_saved += `
            <tr>
                <td style="font-family: monospace; color: #64748b;">${entry_id}</td>
                <td style="color: #64748b;">${time_val}</td>
                <td>${csa_name || ''}</td>
                <td>${row.item}</td>
                <td>${row.quantity}</td>
                <td>${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                <td>${del_btn}</td>
            </tr>
        `;
    });
    $wrapper.find('#list-drystock-saved').html(html_saved);
    
    $wrapper.find('.btn-edit-saved').off('click').on('click', function() {
        if (is_locked) return;
        let idx = parseInt($(this).attr('data-idx'));
        let row = window.SHIFT_DOC.inventory_sales[idx];
        
        // Remove from DB first
        window.SHIFT_DOC.inventory_sales.splice(idx, 1);
        
        frappe.call({
            method: "frappe.client.get",
            args: { doctype: "Shift", name: window.ACTIVE_SHIFT.name },
            callback: function(r) {
                if(r.message) {
                    let doc = r.message;
                    doc.inventory_sales = window.SHIFT_DOC.inventory_sales.map(r2 => {
                        return {
                            name: r2._is_new ? undefined : r2.name,
                            sold_by: r2.sold_by,
                            item: r2.item,
                            quantity: r2.quantity,
                            uom_multiplier: r2.uom_multiplier,
                            total_volume: r2.total_volume,
                            selling_price: r2.selling_price,
                            amount: r2.amount
                        };
                    });
                    frappe.call({
                        method: "frappe.client.save",
                        args: { doc: doc },
                        callback: function(r2) {
                            if(r2.message) window.SHIFT_DOC = r2.message;
                            
                            // Load into form
                            $wrapper.find('#drystock-csa').val(row.sold_by);
                            $wrapper.find('#drystock-item-input').val(row.item);
                            $wrapper.find('#drystock-qty').val(row.quantity);
                            $wrapper.find('#drystock-uom').val(row.uom_multiplier);
                            $wrapper.find('#drystock-price').val(row.selling_price);
                            $wrapper.find('#drystock-volume').val(row.total_volume);
                            $wrapper.find('#drystock-total').val(row.amount);
                            
                            // Switch to entry view
                            $wrapper.find('.seg-btn[data-view="entry"]').click();
                            refresh_drystock_cart($wrapper);
                            
                            frappe.show_alert({message: "Item moved to cart for editing", indicator: "orange"});
                        }
                    });
                }
            }
        });
    });

    $wrapper.find('.btn-remove-saved').off('click').on('click', function() {
        if (is_locked) return;
        let idx = parseInt($(this).attr('data-idx'));
        window.SHIFT_DOC.inventory_sales.splice(idx, 1);
        
        // Auto-save the deletion immediately so the backend is in sync
        frappe.call({
            method: "frappe.client.get",
            args: { doctype: "Shift", name: window.ACTIVE_SHIFT.name },
            callback: function(r) {
                if(r.message) {
                    let doc = r.message;
                    doc.inventory_sales = window.SHIFT_DOC.inventory_sales.map(r => {
                        return {
                            name: r._is_new ? undefined : r.name,
                            sold_by: r.sold_by,
                            item: r.item,
                            quantity: r.quantity,
                            uom_multiplier: r.uom_multiplier,
                            total_volume: r.total_volume,
                            selling_price: r.selling_price,
                            amount: r.amount
                        };
                    });
                    frappe.call({
                        method: "frappe.client.save",
                        args: { doc: doc },
                        callback: function(r2) {
                            if(r2.message) window.SHIFT_DOC = r2.message;
                            refresh_drystock_cart($wrapper);
                        }
                    });
                }
            }
        });
    });
    
    $wrapper.find('#drystock-total-qty').text(total_qty);
    $wrapper.find('#drystock-total-volume').text(total_volume.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
    $wrapper.find('#drystock-total-amount').text(total_amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));

    $wrapper.find('.btn-remove-drystock').off('click').on('click', function() {
        if (is_locked) return;
        let idx = parseInt($(this).closest('tr').attr('data-idx'));
        window.PENDING_DRYSTOCK.splice(idx, 1);
        refresh_drystock_cart($wrapper);
    });
}

function setup_tabs(wrapper) {
    const $wrapper = $(wrapper);
    $wrapper.on('click', '.seg-btn', function() {
        let $btn = $(this);
        let view = $btn.attr('data-view');
        let $tab = $btn.closest('.tab-pane');
        
        $tab.find('.seg-btn').removeClass('active');
        $btn.addClass('active');
        
        $tab.find('.view-pane').removeClass('active');
        $tab.find('.view-pane[id$="-' + view + '-view"]').addClass('active');
    });
    
    $wrapper.find('.nav-item').on('click', function(e) {
        e.preventDefault();
        
        // Remove active class from all tabs and panes
        $wrapper.find('.nav-item').removeClass('active');
        $wrapper.find('.tab-pane').removeClass('active');
        
        // Add active class to clicked tab and target pane
        $(this).addClass('active');
        const target = $(this).attr('data-target');
        $wrapper.find('#' + target).addClass('active');
        
        // Update topbar title
        const tabName = $(this).find('span').text();
        let displayTitle = tabName;
        if(window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.name) {
            let d = new Date(window.ACTIVE_SHIFT.shift_date || new Date());
            let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            let day = d.getDate();
            let suffix = 'th';
            if(day % 10 === 1 && day !== 11) suffix = 'st';
            else if(day % 10 === 2 && day !== 12) suffix = 'nd';
            else if(day % 10 === 3 && day !== 13) suffix = 'rd';
            let formattedDate = `${day}${suffix} ${months[d.getMonth()]}`.toUpperCase();
            
            let template = window.ACTIVE_SHIFT.shift_template ? `(${window.ACTIVE_SHIFT.shift_template})` : '';
            let titlePrefix = tabName === "Dry Stock (Inventory)" ? "Inventory sales" : tabName;
            displayTitle = `${titlePrefix} ${formattedDate} ${template}`;
        }
        $wrapper.find('#current-module-title').text(displayTitle);
    });
}

window.DRYSTOCK_ITEMS = [];
window.PENDING_DRYSTOCK = [];
function load_dropdowns(wrapper) {
    // Fetch Items for Dry Stock
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Item Price",
            filters: { price_list: "Standard Selling" },
            fields: ["item_code", "item_name", "price_list_rate"],
            limit_page_length: 500
        },
        callback: function(r) {
            if(r.message) {
                window.DRYSTOCK_ITEMS = r.message;
                let options = '';
                r.message.forEach(item => {
                    // Populate datalist with name - code so it's readable but parseable
                    options += `<option value="${item.item_name} - ${item.item_code}"></option>`;
                });
                $(wrapper).find('#drystock-items-list').html(options);
            }
        }
    });

    // Fetch Stations
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Fuel Station",
            fields: ["name"]
        },
        callback: function(r) {
            if(r.message) {
                let options = '<option value="">Select Station...</option>';
                r.message.forEach(st => {
                    options += `<option value="${st.name}">${st.name}</option>`;
                });
                $(wrapper).find('#select-station').html(options);
            }
        }
    });

    // Fetch Fuel Shift Templates
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Fuel Shift Template",
            fields: ["name", "start_time", "end_time"]
        },
        callback: function(r) {
            if(r.message) {
                window.SHIFT_TEMPLATES = r.message;
                let options = '<option value="">Select Template...</option>';
                r.message.forEach(t => {
                    options += `<option value="${t.name}">${t.name} (${t.start_time} - ${t.end_time})</option>`;
                });
                $(wrapper).find('#select-shift-template').html(options);
                auto_suggest_shift($(wrapper));
            }
        }
    });

    function auto_suggest_shift($w) {
        if (!window.SHIFT_TEMPLATES || window.SHIFT_TEMPLATES.length === 0) return;
        
        let now = frappe.datetime.now_datetime(); // e.g. "2024-07-17 08:30:00"
        let timeParts = now.split(' ')[1].split(':');
        let currentHour = parseInt(timeParts[0]);
        
        // Find suitable template
        // Simple logic: if current time is between start and end, select it.
        // For night shifts (e.g. 18:00 to 06:00), if current time >= 18 or < 6, select it.
        let selectedTemplate = null;
        let isPastMidnight = false;
        
        for (let t of window.SHIFT_TEMPLATES) {
            let startH = parseInt(t.start_time.split(':')[0]);
            let endH = parseInt(t.end_time.split(':')[0]);
            
            if (startH < endH) {
                // Day shift e.g. 06 to 18
                if (currentHour >= startH && currentHour < endH) {
                    selectedTemplate = t.name;
                    break;
                }
            } else {
                // Night shift e.g. 18 to 06
                if (currentHour >= startH || currentHour < endH) {
                    selectedTemplate = t.name;
                    if (currentHour < endH) {
                        isPastMidnight = true;
                    }
                    break;
                }
            }
        }
        
        if (!selectedTemplate) selectedTemplate = window.SHIFT_TEMPLATES[0].name;
        
        let suggestedDate = frappe.datetime.get_today();
        if (isPastMidnight) {
            // Subtract one day logically
            suggestedDate = frappe.datetime.add_days(suggestedDate, -1);
        }
        
        $w.find('#input-shift-date').val(suggestedDate);
        $w.find('#input-shift-date').attr('max', frappe.datetime.get_today());
        $w.find('#select-shift-template').val(selectedTemplate);
    }

    // Fetch Pump Groups
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Pump Group",
            fields: ["name"]
        },
        callback: function(r) {
            if(r.message) {
                window.PUMP_GROUPS_LIST = r.message;
                render_pump_group_rows($(wrapper));
            }
        }
    });

    // Fetch Head CSAs and normal CSAs (Users with enabled: 1)
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "User",
            filters: { enabled: 1 },
            fields: ["name", "full_name"]
        },
        callback: function(r) {
            if(r.message) {
                window.USERS_LIST = r.message;
                let options = '<option value="">Select Head CSA...</option>';
                r.message.forEach(u => {
                    let selected = (u.name === frappe.session.user) ? 'selected' : '';
                    options += `<option value="${u.name}" ${selected}>${u.full_name}</option>`;
                });
                $(wrapper).find('#select-head-csa').html(options);
                render_pump_group_rows($(wrapper));
            }
        }
    });

    function render_pump_group_rows($w) {
        if(!window.USERS_LIST || window.USERS_LIST.length === 0) return;
        if(!window.PUMP_GROUPS_LIST || window.PUMP_GROUPS_LIST.length === 0) return;
        
        let csaOptions = '<option value="">Select CSA...</option>';
        window.USERS_LIST.forEach(u => { csaOptions += `<option value="${u.name}">${u.full_name}</option>`; });
        
        let html = '';
        window.PUMP_GROUPS_LIST.forEach(pg => {
            html += `
             <tr data-pg="${pg.name}">
                 <td style="font-weight: bold; color: #1e293b;">${pg.name}</td>
                 <td><select class="spa-input csa-select">${csaOptions}</select></td>
             </tr>
            `;
        });
        $w.find('#csa-assignment-body').html(html);
    }
}

function setup_actions(wrapper) {
    const $wrapper = $(wrapper);
    
    // Bind Dry Stock History Filters
    $wrapper.find('#drystock-filter-start-date, #drystock-filter-end-date, #drystock-filter-search').on('input', function() {
        if(typeof refresh_drystock_cart === 'function') {
            refresh_drystock_cart($wrapper);
        }
    });
    
    // Start Shift Logic
    $wrapper.find('#btn-start-shift').on('click', function() {
        const station = $wrapper.find('#select-station').val();
        const head_csa = $wrapper.find('#select-head-csa').val();
        const shift_date = $wrapper.find('#input-shift-date').val();
        const shift_template = $wrapper.find('#select-shift-template').val();
        
        let assigned_csas = [];
        let unassigned_pgs = [];
        $wrapper.find('#csa-assignment-body tr').each(function() {
            let csa = $(this).find('.csa-select').val();
            let pg = $(this).attr('data-pg');
            if(csa) {
                assigned_csas.push({
                    "csa": csa,
                    "pump_group": pg
                });
            } else {
                unassigned_pgs.push(pg);
            }
        });
        
        if(unassigned_pgs.length > 0) {
            frappe.show_alert({message: `You must assign a CSA to all Pump Groups. Missing: ${unassigned_pgs.join(", ")}`, indicator: "red"});
            return;
        }
        
        if(!station || !head_csa || !shift_date || !shift_template) {
            frappe.show_alert({message: "Please fill all fields (Date, Template, Station, Head CSA).", indicator: "red"});
            return;
        }
        
        frappe.confirm(`You are starting a <b>${shift_template}</b> for Date <b>${shift_date}</b>. Is this correct?`, () => {
            let $btn = $(this);
            $btn.find('.spinner').removeClass('hidden');
            $btn.prop('disabled', true);
            
            frappe.call({
                method: "frappe.client.insert",
                args: {
                    doc: {
                        doctype: "Shift",
                        shift_date: shift_date,
                        shift_template: shift_template,
                        station: station,
                        head_csa: head_csa,
                        status: "Open",
                        start_time: frappe.datetime.now_datetime(),
                        assigned_csas: assigned_csas
                    }
                },
                callback: function(r) {
                    $btn.find('.spinner').addClass('hidden');
                    $btn.prop('disabled', false);
                    
                    if(r.message) {
                        frappe.show_alert({message: "Shift Started Successfully!", indicator: "green"});
                        window.ACTIVE_SHIFT = r.message;
                        lock_ui_for_active_shift($wrapper);
                    }
                }
            });
        });
    });

    // ---------------------------------------------------
    // Save Handlers
    // ---------------------------------------------------
    $wrapper.on('click', '#btn-save-wetstock', function() {
        let btn = $(this);
        let originalText = btn.text();
        btn.prop('disabled', true); btn.find('.spinner').removeClass('hidden');
        
        let has_empty = false;
        let rows_data = [];
        $wrapper.find('#meters-container .meter-row[data-name]').each(function() {
            let row_name = $(this).attr('data-name');
            let elec_input = $(this).find('.meter-closing-elec');
            let man_input = $(this).find('.meter-closing-manual');
            
            let elec_val = elec_input.val();
            let man_val = man_input.val();
            
            if (elec_val === "" || elec_val === null || man_val === "" || man_val === null) {
                has_empty = true;
                if (elec_val === "" || elec_val === null) elec_input.addClass('error-input');
                if (man_val === "" || man_val === null) man_input.addClass('error-input');
            }
            
            rows_data.push({
                name: row_name,
                closing_electronic_meter: elec_val ? parseFloat(elec_val) : 0,
                closing_manual_meter: man_val ? parseFloat(man_val) : 0
            });
        });
        
        if (has_empty) {
            frappe.msgprint({
                title: __('Validation Error'),
                indicator: 'red',
                message: __('Please enter all closing meter readings before saving. Fields cannot be empty.')
            });
            btn.prop('disabled', false).text(originalText);
            return;
        }
        save_child_table("pump_meter_readings", rows_data, "Meter Readings saved!", btn, originalText);
    });
    
    $wrapper.find('#btn-save-dips').on('click', function() {
        let readings = [];
        $wrapper.find('#dips-container tr').each(function() {
            readings.push({
                name: $(this).attr('data-name'),
                opening_dip: $(this).find('.dip-opening').val(),
                closing_dip: $(this).find('.dip-closing').val()
            });
        });
        save_child_table("dip_stick_readings", readings, "Dip Sticks saved!");
    });
    
    $wrapper.find('#btn-save-mpesa').on('click', function() {
        let readings = [];
        $wrapper.find('#mpesa-tills-container tr').each(function() {
            readings.push({
                name: $(this).attr('data-name'),
                transfers_made: $(this).find('.mpesa-transfers').val(),
                closing_balance: $(this).find('.mpesa-closing').val()
            });
        });
        save_child_table("mpesa_payments", readings, "M-Pesa Tills saved!");
    });
    
    function save_child_table(table_name, rows_data, success_msg, btn = null, originalText = null) {
        if (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.status !== "Open" && !(frappe.user.has_role("System Manager") || frappe.user.has_role("Fuel Station Owner"))) {
            frappe.show_alert({message: "This shift is closed. Only System Managers or Fuel Station Owners can modify data.", indicator: "red"});
            if(btn) { btn.find('.spinner').addClass('hidden'); btn.prop('disabled', false); }
            return;
        }
        frappe.call({
            method: "frappe.client.get",
            args: { doctype: "Shift", name: window.ACTIVE_SHIFT.name },
            callback: function(r) {
                if(r.message) {
                    let doc = r.message;
                    rows_data.forEach(updated_row => {
                        let existing = doc[table_name].find(d => d.name === updated_row.name);
                        if(existing) {
                            Object.assign(existing, updated_row);
                        }
                    });
                    
                    frappe.call({
                        method: "frappe.client.save",
                        args: { doc: doc },
                        callback: function(r2) {
                            if(r2.message) {
                                frappe.show_alert({message: success_msg, indicator: "green"});
                            }
                            if(btn) { btn.find('.spinner').addClass('hidden'); btn.prop('disabled', false); }
                        }
                    });
                } else {
                    if(btn) { btn.find('.spinner').addClass('hidden'); btn.prop('disabled', false); }
                }
            }
        });
    }

    
    $wrapper.on('click', '#btn-save-drystock', function() {
        if (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.status !== "Open" && !(frappe.user.has_role("System Manager") || frappe.user.has_role("Fuel Station Owner"))) {
            frappe.show_alert({message: "This shift is closed. Only System Managers or Fuel Station Owners can modify data.", indicator: "red"});
            return;
        }
        
        if (!window.PENDING_DRYSTOCK || window.PENDING_DRYSTOCK.length === 0) {
            frappe.show_alert({message: "Cart is empty. Add items first.", indicator: "orange"});
            return;
        }
        
        let btn = $(this);
        let originalHTML = btn.html();
        btn.prop('disabled', true); 
        btn.find('.spinner').removeClass('hidden');
        
        // Append pending items to existing items
        let combined_rows = [...(window.SHIFT_DOC.inventory_sales || []), ...window.PENDING_DRYSTOCK];
        
        let rows_data = combined_rows.map(r => {
            return {
                name: r._is_new ? undefined : r.name,
                sold_by: r.sold_by,
                item: r.item,
                quantity: r.quantity,
                uom_multiplier: r.uom_multiplier,
                total_volume: r.total_volume,
                selling_price: r.selling_price,
                amount: r.amount
            };
        });
        
        frappe.call({
            method: "frappe.client.get",
            args: { doctype: "Shift", name: window.ACTIVE_SHIFT.name },
            callback: function(r) {
                if(r.message) {
                    let doc = r.message;
                    doc.inventory_sales = rows_data;
                    frappe.call({
                        method: "frappe.client.save",
                        args: { doc: doc },
                        callback: function(r2) {
                            if(r2.message) {
                                frappe.show_alert({message: "Inventory Sales saved successfully!", indicator: "green"});
                                window.SHIFT_DOC = r2.message; 
                                window.PENDING_DRYSTOCK = [];
                                $wrapper.find('#drystock-csa').val('');
                                refresh_drystock_cart($wrapper);
                                // Automatically jump back to history view on success
                                $wrapper.find('.seg-btn[data-view="history"]').click();
                            }
                            btn.prop('disabled', false).html(originalHTML);
                            btn.find('.spinner').addClass('hidden');
btn.find('.spinner').addClass('hidden');
                        }
                    });
                } else {
                    btn.prop('disabled', false).html(originalHTML);
btn.find('.spinner').addClass('hidden');
                }
            }
        });
    });

    // Close Shift Logic
    $wrapper.find('#btn-close-shift').on('click', function() {
        if(!window.ACTIVE_SHIFT) return;
        
        const cashCaptured = $wrapper.find('#chk-cash-captured').is(':checked');
        const reportsPrinted = $wrapper.find('#chk-reports-printed').is(':checked');
        
        if(!cashCaptured || !reportsPrinted) {
            frappe.show_alert({message: "You must complete the entire Pre-Close Checklist before closing.", indicator: "red"});
            return;
        }
        
        let actual_fuel_cash = parseFloat($wrapper.find('#actual-cash-input').val()) || 0;
        let actual_drystock_cash = parseFloat($wrapper.find('#actual-drystock-cash-input').val()) || 0;

        frappe.confirm('Are you absolutely sure you want to close this shift? This will permanently lock the data and generate accounting entries.', () => {
            frappe.call({
                method: "frappe.client.get",
                args: { doctype: "Shift", name: window.ACTIVE_SHIFT.name },
                callback: function(res) {
                    if (res.message) {
                        let doc = res.message;
                        doc.actual_cash = actual_fuel_cash;
                        doc.actual_dry_stock_cash = actual_drystock_cash;
                        doc.status = "Closed";
                        
                        frappe.call({
                            method: "frappe.client.save",
                            args: { doc: doc },
                            callback: function(r) {
                                if(r.message) {
                                    frappe.show_alert({message: "Shift Closed successfully!", indicator: "green"});
                                    setTimeout(() => {
                                        location.reload();
                                    }, 2000);
                                }
                            }
                        });
                    }
                }
            });
        });
    });
}

// ==========================================
// CREDIT INVOICE POS LOGIC
// ==========================================

function render_invoices($wrapper) {
    if (!window.ACTIVE_SHIFT) return;
    window.PENDING_INVOICES = [];
    
    let sDate = window.ACTIVE_SHIFT.shift_date || window.ACTIVE_SHIFT.creation || frappe.datetime.now_date();
    let shiftName = window.ACTIVE_SHIFT.shift_template ? `${window.ACTIVE_SHIFT.shift_template}` : window.ACTIVE_SHIFT.name;
    $wrapper.find('#invoice-shift-name, #invoice-history-shift-name').text(shiftName);
    $wrapper.find('#invoice-shift-date, #invoice-history-shift-date').text(sDate.split(" ")[0]);

    // 1. Generate Entry Number (e.g. INV001)
    let max_inv = 0;
    (window.SHIFT_DOC.invoices || []).forEach(row => {
        if(row.entry_number && row.entry_number.startsWith('INV')) {
            let num = parseInt(row.entry_number.replace('INV', ''));
            if(!isNaN(num) && num > max_inv) max_inv = num;
        }
    });
    let next_entry = "INV" + String(max_inv + 1).padStart(3, '0');
    $wrapper.find('#invoice-entry-number').text(next_entry);

    // 2. Fetch Active CSAs
    let csaOptions = '<option value="">Select CSA...</option>';
    (window.ACTIVE_SHIFT.csa_assignments || []).forEach(a => {
        if(a.csa) {
            let u = window.USERS_LIST.find(u => u.name === a.csa);
            let name = u ? u.full_name : a.csa;
            // avoid duplicates
            if(csaOptions.indexOf(`value="${a.csa}"`) === -1) {
                csaOptions += `<option value="${a.csa}">${name}</option>`;
            }
        }
    });
    $wrapper.find('#invoice-csa').html(csaOptions);

    // 3. Use identical items as Drystock (Item Price query)
    window.INVOICE_ITEMS = window.DRYSTOCK_ITEMS;
    let itemOpts = '';
    (window.INVOICE_ITEMS || []).forEach(i => {
        itemOpts += `<option value="${i.item_name} - ${i.item_code}">`;
    });
    $wrapper.find('#invoice-items-list').html(itemOpts);

    // 4. Fetch Customers
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Customer",
            fields: ["name", "customer_name"],
            limit: 5000
        },
        callback: function(r) {
            if(r.message) {
                window.CUSTOMERS_LIST = r.message;
                let custOpts = '';
                r.message.forEach(c => {
                    custOpts += `<option value="${c.name}">${c.customer_name}</option>`;
                });
                $wrapper.find('#invoice-customers-list').html(custOpts);
            }
        }
    });

    // Event: Customer changes -> Fetch Vehicles
    $wrapper.find('#invoice-customer-input').off('change').on('change', function() {
        let cust = $(this).val();
        $wrapper.find('#invoice-vehicles-list').empty();
        if(cust) {
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Shift Invoice",
                    fields: ["vehicle_registration"],
                    filters: { customer: cust, vehicle_registration: ["!=", ""] },
                    limit: 100
                },
                callback: function(r) {
                    if(r.message) {
                        let vOpts = '';
                        let unique_v = [...new Set(r.message.map(m => m.vehicle_registration))];
                        unique_v.forEach(v => {
                            if(v) vOpts += `<option value="${v}">`;
                        });
                        $wrapper.find('#invoice-vehicles-list').html(vOpts);
                    }
                }
            });
        }
    });

    // Event: Item changes -> Fetch Rate
    $wrapper.find('#invoice-item-input').off('change').on('change', function() {
        let val = $(this).val();
        let item = (window.INVOICE_ITEMS || []).find(i => `${i.item_name} - ${i.item_code}` === val);
        if(item) {
            $wrapper.find('#invoice-rate').val(parseFloat(item.price_list_rate || 0).toFixed(2));
            calc_invoice();
        } else {
            $wrapper.find('#invoice-rate').val('');
        }
    });

    // Event: Calc Qty
    function calc_invoice() {
        let amount = parseFloat($wrapper.find('#invoice-amount').val()) || 0;
        let rate = parseFloat($wrapper.find('#invoice-rate').val()) || 0;
        if(rate > 0) {
            $wrapper.find('#invoice-qty').val((amount / rate).toFixed(4));
        } else {
            $wrapper.find('#invoice-qty').val('');
        }
    }
    $wrapper.find('#invoice-amount').off('input').on('input', calc_invoice);

    // Add to Cart
    $wrapper.find('#btn-add-invoice-item').off('click').on('click', function() {
        let customer = $wrapper.find('#invoice-customer-input').val();
        let csa = $wrapper.find('#invoice-csa').val();
        let po = $wrapper.find('#invoice-po').val();
        let vehicle = $wrapper.find('#invoice-vehicle').val();
        
        let item_val = $wrapper.find('#invoice-item-input').val();
        let item = (window.INVOICE_ITEMS || []).find(i => `${i.item_name} - ${i.name}` === item_val);
        
        let amount = parseFloat($wrapper.find('#invoice-amount').val()) || 0;
        let rate = parseFloat($wrapper.find('#invoice-rate').val()) || 0;
        let qty = parseFloat($wrapper.find('#invoice-qty').val()) || 0;

        if (!customer || !csa || !item || amount <= 0 || rate <= 0) {
            frappe.show_alert({message: "Customer, CSA, Item, and valid Amount are required.", indicator: "red"});
            return;
        }

        window.PENDING_INVOICES.push({
            _is_new: true,
            customer: customer,
            csa: csa,
            purchase_order: po,
            vehicle_registration: vehicle,
            item: item.name,
            item_name: item.item_name,
            quantity: qty,
            rate: rate,
            amount: amount,
            entry_number: next_entry
        });

        // clear item row
        $wrapper.find('#invoice-item-input').val('');
        $wrapper.find('#invoice-amount').val('');
        $wrapper.find('#invoice-rate').val('');
        $wrapper.find('#invoice-qty').val('');
        
        refresh_invoice_cart($wrapper);
    });

    // Save Cart
    $wrapper.find('#btn-save-invoice').off('click').on('click', function() {
        if (!window.PENDING_INVOICES || window.PENDING_INVOICES.length === 0) {
            frappe.show_alert({message: "Cart is empty.", indicator: "red"});
            return;
        }

        let is_locked = window.ACTIVE_SHIFT.status !== 'Open';
        if(is_locked) {
            frappe.show_alert({message: "Shift is closed/locked.", indicator: "red"});
            return;
        }

        let $btn = $(this);
        let orig_html = $btn.html();
        $btn.html('<span class="spinner-border spinner-border-sm"></span> Saving...').prop('disabled', true);

        // Fetch latest doc
        frappe.call({
            method: "frappe.client.get",
            args: { doctype: "Shift", name: window.ACTIVE_SHIFT.name },
            callback: function(r) {
                if(r.message) {
                    let doc = r.message;
                    
                    // merge existing and pending
                    let new_list = (doc.invoices || []).map(r2 => {
                        return {
                            name: r2.name,
                            customer: r2.customer,
                            csa: r2.csa,
                            purchase_order: r2.purchase_order,
                            vehicle_registration: r2.vehicle_registration,
                            item: r2.item,
                            item_name: r2.item_name,
                            quantity: r2.quantity,
                            rate: r2.rate,
                            amount: r2.amount,
                            entry_number: r2.entry_number
                        };
                    });

                    window.PENDING_INVOICES.forEach(p => {
                        new_list.push({
                            customer: p.customer,
                            csa: p.csa,
                            purchase_order: p.purchase_order,
                            vehicle_registration: p.vehicle_registration,
                            item: p.item,
                            item_name: p.item_name,
                            quantity: p.quantity,
                            rate: p.rate,
                            amount: p.amount,
                            entry_number: p.entry_number
                        });
                    });

                    doc.invoices = new_list;

                    frappe.call({
                        method: "frappe.client.save",
                        args: { doc: doc },
                        callback: function(r2) {
                            $btn.html(orig_html).prop('disabled', false);
                            if(r2.message) {
                                window.SHIFT_DOC = r2.message;
                                window.PENDING_INVOICES = [];
                                
                                // Reset form partially (keep CSA, Customer, etc or clear? Let's clear header fields for next customer)
                                $wrapper.find('#invoice-customer-input').val('');
                                $wrapper.find('#invoice-po').val('');
                                $wrapper.find('#invoice-vehicle').val('');
                                
                                // Auto-jump to history
                                $wrapper.find('.seg-btn[data-view="history"]').click();
                                
                                // Re-render to update the Entry No
                                render_invoices($wrapper);
                                frappe.show_alert({message: "Credit Invoice Saved!", indicator: "green"});
                            }
                        },
                        error: function() {
                            $btn.html(orig_html).prop('disabled', false);
                        }
                    });
                } else {
                    $btn.html(orig_html).prop('disabled', false);
                }
            }
        });
    });

    refresh_invoice_cart($wrapper);
}

function refresh_invoice_cart($wrapper) {
    let is_locked = window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.status !== 'Open';
    
    // Render Pending Cart
    let html_cart = '';
    let grand_total = 0;
    (window.PENDING_INVOICES || []).forEach((row, idx) => {
        grand_total += (row.amount || 0);
        html_cart += `
            <tr>
                <td>${row.item_name || row.item}</td>
                <td>${row.quantity}</td>
                <td>${frappe.format(row.rate, {fieldtype: 'Currency'})}</td>
                <td>${frappe.format(row.amount, {fieldtype: 'Currency'})}</td>
                <td><button class="btn btn-xs btn-danger btn-remove-invoice-cart" data-idx="${idx}">X</button></td>
            </tr>
        `;
    });
    if(!html_cart) {
        html_cart = `<tr><td colspan="5" style="text-align: center; color: #64748b; padding: 2rem;">Cart is empty</td></tr>`;
    }
    $wrapper.find('#list-invoice-cart').html(html_cart);
    $wrapper.find('#invoice-cart-total-amount').text(frappe.format(grand_total, {fieldtype: 'Currency'}));

    $wrapper.find('.btn-remove-invoice-cart').off('click').on('click', function() {
        let idx = parseInt($(this).attr('data-idx'));
        window.PENDING_INVOICES.splice(idx, 1);
        refresh_invoice_cart($wrapper);
    });

    // Render Historical Table
    let filter_search = ($wrapper.find('#invoice-filter-search').val() || '').toLowerCase();
    
    let html_saved = '';
    (window.SHIFT_DOC.invoices || []).forEach((row, idx) => {
        let searchStr = `${row.customer} ${row.entry_number} ${row.vehicle_registration}`.toLowerCase();
        if (filter_search && !searchStr.includes(filter_search)) return;
        
        let del_btn = is_locked ? 
            `<button class="btn btn-xs btn-danger" disabled>X</button>` : 
            `<button class="btn btn-xs btn-danger btn-remove-saved-invoice" data-idx="${idx}">X</button>`;

        let sDate = window.ACTIVE_SHIFT.shift_date || window.ACTIVE_SHIFT.creation || frappe.datetime.now_date();
        let shiftName = window.ACTIVE_SHIFT.shift_template ? `${window.ACTIVE_SHIFT.shift_template}` : window.ACTIVE_SHIFT.name;

        html_saved += `
            <tr>
                <td><span class="badge" style="background: #e2e8f0; color: #0f172a;">${row.entry_number || '-'}</span></td>
                <td style="color: #64748b;">${sDate.split(" ")[0]}</td>
                <td style="color: #64748b;">${shiftName}</td>
                <td><strong>${row.customer || ''}</strong></td>
                <td>${row.purchase_order || '-'}</td>
                <td>${row.vehicle_registration || '-'}</td>
                <td>${row.item_name || row.item || ''}</td>
                <td>${row.quantity || 0}</td>
                <td><strong>${frappe.format(row.amount, {fieldtype: 'Currency'})}</strong></td>
                <td>${del_btn}</td>
            </tr>
        `;
    });
    if(!html_saved) {
        html_saved = `<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 2rem;">No historical invoices match filters.</td></tr>`;
    }
    $wrapper.find('#list-invoice-saved').html(html_saved);

    // Delete Historical Action
    $wrapper.find('.btn-remove-saved-invoice').off('click').on('click', function() {
        if (is_locked) return;
        let idx = parseInt($(this).attr('data-idx'));
        
        frappe.confirm('Are you sure you want to delete this historical invoice item?', () => {
            window.SHIFT_DOC.invoices.splice(idx, 1);
            
            frappe.call({
                method: "frappe.client.get",
                args: { doctype: "Shift", name: window.ACTIVE_SHIFT.name },
                callback: function(r) {
                    if(r.message) {
                        let doc = r.message;
                        doc.invoices = window.SHIFT_DOC.invoices.map(r2 => {
                            return {
                                name: r2._is_new ? undefined : r2.name,
                                customer: r2.customer,
                                csa: r2.csa,
                                purchase_order: r2.purchase_order,
                                vehicle_registration: r2.vehicle_registration,
                                item: r2.item,
                                item_name: r2.item_name,
                                quantity: r2.quantity,
                                rate: r2.rate,
                                amount: r2.amount,
                                entry_number: r2.entry_number
                            };
                        });
                        frappe.call({
                            method: "frappe.client.save",
                            args: { doc: doc },
                            callback: function(r2) {
                                if(r2.message) window.SHIFT_DOC = r2.message;
                                refresh_invoice_cart($wrapper);
                                frappe.show_alert({message: "Item deleted from history", indicator: "green"});
                            }
                        });
                    }
                }
            });
        });
    });
}
