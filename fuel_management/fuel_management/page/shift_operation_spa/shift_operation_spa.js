window.ACTIVE_SHIFT = null;
window.USERS_LIST = [];
window.PUMP_GROUPS_LIST = [];
window.SHIFT_TEMPLATES = [];

window.STATION_SETTINGS = {};

frappe.pages['shift_operation_spa'].on_page_load = function(wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Shift Operations',
        single_column: true
    });
    
    $(document).ajaxError(function(event, jqXHR, ajaxSettings, thrownError) {
        if(jqXHR.status === 403) {
            let details = "Unknown";
            try {
                details = "URL: " + ajaxSettings.url;
                if(typeof ajaxSettings.data === 'string' && ajaxSettings.data.length > 0) {
                    details += "<br>Data: " + ajaxSettings.data;
                }
            } catch(e) {}
            frappe.msgprint({
                title: "Permission Error Debug",
                message: "A background fetch failed with 403 Forbidden.<br><b>Details:</b> " + details,
                indicator: "red"
            });
        }
    });

    // Render custom HTML structure
    $(wrapper).html(frappe.render_template("shift_operation_spa", {}));
    
    // UI Setup
    setup_tabs(wrapper);
    load_dropdowns(wrapper);
    setup_actions(wrapper);
    
    // Fetch Settings then Initialize State
    frappe.call({
        method: "frappe.client.get",
        args: {
            doctype: "Station Global Settings",
            name: "Station Global Settings"
        },
        callback: function(r) {
            if(r.message) {
                window.STATION_SETTINGS = r.message;
                apply_global_settings(wrapper);
            }
            fetch_active_shift(wrapper);
        }
    });
}

function apply_global_settings(wrapper) {
    const $wrapper = $(wrapper);
    const settings = window.STATION_SETTINGS;
    
    // Fleet Cards
    if (settings.enable_fleet_card_management) {
        $wrapper.find('#nav-fleet-cards').show();
        $wrapper.find('#nav-station-cards').show();
    } else {
        $wrapper.find('#nav-fleet-cards').hide();
        $wrapper.find('#nav-station-cards').show();
    }
    
    // Petty Cash vs Expenses
    if (settings.enable_petty_cash) {
        $wrapper.find('#nav-petty-cash').show();
        $wrapper.find('#nav-expenses').hide();
    } else {
        $wrapper.find('#nav-petty-cash').hide();
        $wrapper.find('#nav-expenses').show();
    }
}

function fetch_active_shift(wrapper) {
    const $wrapper = $(wrapper);
    // Find open shift for the logged-in user
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Shift",
            filters: { status: "Open", owner: frappe.session.user },
            fields: ["name", "station", "head_csa", "shift_template", "shift_date", "status"],
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
    let formattedDate = window.ACTIVE_SHIFT.shift_date ? frappe.datetime.str_to_user(window.ACTIVE_SHIFT.shift_date) : "";
    $wrapper.find('#active-shift-badge').addClass('active-shift').text(`Active: ${formattedDate}(${bShiftName})`);
    
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
                if(typeof render_customer_payments === 'function') render_customer_payments($wrapper);
                if(typeof render_station_cards === 'function') render_station_cards($wrapper);
                if(typeof render_petty_cash === 'function') render_petty_cash($wrapper);
                if(typeof render_cash_transfers === 'function') render_cash_transfers($wrapper);
                if(typeof render_reconcile === 'function') render_reconcile($wrapper);
                if(typeof render_station_expenses === 'function') render_station_expenses($wrapper);
                if(typeof render_rtt === 'function') render_rtt($wrapper);
                if(typeof render_topups === 'function') render_topups($wrapper);
                if(typeof render_purchases === 'function') render_purchases($wrapper);
                if(typeof render_greasing === 'function') render_greasing($wrapper);
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
                    
                    window.METER_GROUPS = grouped;
                    window.NOZZLE_PRICES = nozzle_prices;
                    
                    // Render Selector
                    let pg_options = '<option value="">Select a Pump Group...</option>';
                    Object.keys(grouped).sort().forEach(pg => {
                        pg_options += `<option value="${pg}">${pg}</option>`;
                    });
                    
                    let html = `
                    <div class="meter-entry-header" style="margin-bottom: 15px;">
                        <label style="font-weight: bold; color: var(--text-primary);">Select Pump Group to Enter Readings</label>
                        <select class="spa-input" id="pg-selector" style="max-width: 400px; display: inline-block; margin-left: 10px;">
                            ${pg_options}
                        </select>
                    </div>
                    
                    <div id="pg-entry-form" style="display: none; margin-top: 15px;">
                        <!-- dynamic rows go here -->
                    </div>
                    
                    <hr style="margin: 30px 0;">
                    <div class="meter-history-header">
                        <h5 style="color: var(--primary); font-weight: bold; margin-bottom: 15px;">Posted Meter Readings (Current Shift)</h5>
                        <div class="table-responsive">
                            <table class="table table-bordered history-table" style="background: white; border-radius: 8px;">
                                <thead style="background: var(--bg-light); color: var(--text-secondary);">
                                    <tr>
                                        <th>Pump Group</th>
                                        <th>Nozzles</th>
                                        <th>Status</th>
                                        <th style="width: 150px; text-align: center;">Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="pg-history-body">
                                </tbody>
                            </table>
                        </div>
                    </div>
                    `;
                    
                    $wrapper.find('#meters-container').html(html);
                    
                    render_history();
                    
                    $wrapper.find('#pg-selector').on('change', function() {
                        let selected_pg = $(this).val();
                        if (window.EDITING_PG && window.EDITING_PG !== selected_pg) {
                            window.EDITING_PG = null; // Clear edit mode if they manually select another group
                        }
                        if (selected_pg) {
                            render_pg_form(selected_pg);
                            $wrapper.find('#pg-entry-form').slideDown();
                        } else {
                            $wrapper.find('#pg-entry-form').slideUp();
                        }
                    });
                    
                    function render_history() {
                        let history_html = '';
                        Object.entries(window.METER_GROUPS).sort().forEach(([pg, rows]) => {
                            let has_readings = rows.some(r => r.closing_electronic_meter > 0 || r.closing_manual_meter > 0);
                            if (has_readings) {
                                let nozzle_names = rows.map(r => r.pump_nozzle).join(', ');
                                history_html += `
                                <tr>
                                    <td><strong>${pg}</strong></td>
                                    <td style="font-size: 0.85em; color: #64748b;">${nozzle_names}</td>
                                    <td><span class="badge" style="background: var(--success); color: white; padding: 5px 10px;">Saved</span></td>
                                    <td style="text-align: center;">
                                        <button class="btn btn-xs btn-primary btn-edit-pg" data-pg="${pg}"><i class="fa fa-edit"></i> Edit</button>
                                        <button class="btn btn-xs btn-danger btn-delete-pg" data-pg="${pg}"><i class="fa fa-trash"></i> Clear</button>
                                    </td>
                                </tr>
                                `;
                            }
                        });
                        if (!history_html) history_html = '<tr><td colspan="4" class="text-center text-muted" style="padding: 20px;">No readings posted yet for this shift.</td></tr>';
                        $wrapper.find('#pg-history-body').html(history_html);
                    }
                    
                    $wrapper.on('click', '.btn-edit-pg', function() {
                        let pg = $(this).attr('data-pg');
                        window.EDITING_PG = pg;
                        $wrapper.find('#pg-selector').val(pg).trigger('change');
                        $("html, body").animate({ scrollTop: 0 }, "fast");
                    });
                    
                    $wrapper.on('click', '.btn-delete-pg', function() {
                        let pg = $(this).attr('data-pg');
                        frappe.confirm(`Are you sure you want to clear the readings for <b>${pg}</b>?`, function() {
                            let rows_to_clear = window.METER_GROUPS[pg].map(r => {
                                return {
                                    name: r.name,
                                    closing_electronic_meter: 0,
                                    closing_manual_meter: 0
                                };
                            });
                            save_child_table("pump_meter_readings", rows_to_clear, `${pg} cleared!`, null, null, function() {
                                window.METER_GROUPS[pg].forEach(r => {
                                    r.closing_electronic_meter = 0;
                                    r.closing_manual_meter = 0;
                                });
                                window.EDITING_PG = null;
                                render_history();
                                if ($wrapper.find('#pg-selector').val() === pg) {
                                    $wrapper.find('#pg-selector').val('').trigger('change');
                                }
                            });
                        });
                    });
                    
                    function render_pg_form(pg) {
                        let rows = window.METER_GROUPS[pg];
                        rows.sort((a, b) => (a.pump_nozzle || "").localeCompare((b.pump_nozzle || ""), undefined, {numeric: true, sensitivity: 'base'}));
                        
                        let has_saved = rows.some(r => r.closing_electronic_meter > 0 || r.closing_manual_meter > 0);
                        let is_locked = has_saved && window.EDITING_PG !== pg;
                        let disable_attr = is_locked ? 'disabled' : '';
                        
                        let assigned_csa_id = "";
                        if (window.SHIFT_DOC.assigned_csas) {
                            let assignment = window.SHIFT_DOC.assigned_csas.find(a => a.pump_group === pg);
                            if (assignment) assigned_csa_id = assignment.csa;
                        }
                        let csa_name = assigned_csa_id;
                        if (window.USERS_LIST) {
                            let user = window.USERS_LIST.find(u => u.name === assigned_csa_id);
                            if (user) csa_name = user.employee_name;
                        }
                        let csa_text = csa_name ? `<div style="font-size: 0.85em; color: var(--primary); margin-top: 5px;">Assigned CSA: <strong>${csa_name}</strong></div>` : "";
                        
                        let html = `
                            <div class="pump-group-card" style="margin-bottom: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 2px solid var(--primary-light);">
                                <div class="pump-group-header" style="background: var(--primary-light); color: var(--primary); padding: 12px 20px; font-size: 1.1em;">
                                    ${pg} ${csa_text}
                                </div>
                                <div class="pump-nozzles-list" style="padding: 10px;">
                        `;
                        
                        rows.forEach(row => {
                            let price_obj = window.NOZZLE_PRICES[row.pump_nozzle] || {};
                            let price = price_obj.price || 0.0;
                            let item_code = price_obj.item || '';
                            let item_upper = item_code.toUpperCase();
                            let is_ago = (item_upper.indexOf('AGO') !== -1 || item_upper.indexOf('DIESEL') !== -1);
                            let is_pms = (item_upper.indexOf('PMS') !== -1 || item_upper.indexOf('PETROL') !== -1 || item_upper.indexOf('SUPER') !== -1 || item_upper.indexOf('V-POWER') !== -1);
                            if (!is_ago && !is_pms) {
                                let noz_upper = (row.pump_nozzle || "").toUpperCase();
                                if (noz_upper.indexOf('AGO') !== -1 || noz_upper.indexOf('DIESEL') !== -1) is_ago = true;
                                if (noz_upper.indexOf('PMS') !== -1 || noz_upper.indexOf('SUPER') !== -1) is_pms = true;
                            }
                            let fuel_type = is_ago ? 'AGO' : (is_pms ? 'PMS' : (item_code || 'UNKNOWN'));
                            
                            html += `
                                <div class="meter-row" data-name="${row.name}" data-fuel-type="${fuel_type}" style="padding: 10px 15px; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0;">
                                    <div class="nozzle-col" style="flex: 0 0 150px;">
                                        <div class="nozzle-name" style="font-size: 1.1em; color: var(--primary); font-weight: bold;">${row.pump_nozzle}</div>
                                        <div style="font-size: 0.85em; color: #64748b; background: #f1f5f9; display: inline-block; padding: 2px 6px; border-radius: 4px; margin-top: 4px;">${fuel_type} @ ${price.toFixed(2)}</div>
                                    </div>
                                    
                                    <div class="elec-col" style="flex: 1; padding: 0 10px;">
                                        <div class="col-title" style="font-size: 0.8em; margin-bottom: 2px;">Electronic</div>
                                        <div class="reading-label" style="font-size: 0.8em;">Opening: <span class="read-only-cell" style="font-weight: bold;">${row.opening_electronic_meter}</span></div>
                                        <input type="number" step="0.01" class="spa-input meter-closing-elec highlight-input" data-opening="${row.opening_electronic_meter}" data-price="${price}" value="${row.closing_electronic_meter || ''}" placeholder="Closing Elec" style="padding: 6px; font-size: 1em; height: 35px;" ${disable_attr}>
                                        <div class="sales-value" style="font-size: 0.85em; margin-top: 4px;">Sales: <span class="meter-sales-elec font-weight-bold">0.00</span></div>
                                    </div>
                                    
                                    <div class="manual-col" style="flex: 1; padding: 0 10px;">
                                        <div class="col-title" style="font-size: 0.8em; margin-bottom: 2px;">Manual</div>
                                        <div class="reading-label" style="font-size: 0.8em;">Opening: <span class="read-only-cell" style="font-weight: bold;">${row.opening_manual_meter}</span></div>
                                        <input type="number" step="0.01" class="spa-input meter-closing-manual highlight-input" data-opening="${row.opening_manual_meter}" value="${row.closing_manual_meter || ''}" placeholder="Closing Manual" style="padding: 6px; font-size: 1em; height: 35px;" ${disable_attr}>
                                        <div class="sales-value" style="font-size: 0.85em; margin-top: 4px;">Sales: <span class="meter-sales-manual font-weight-bold">0.00</span></div>
                                    </div>
                                    
                                    <div class="summary-col" style="flex: 1; text-align: right; justify-content: center;">
                                        <div class="variance-box" style="font-size: 0.9em; margin-bottom: 5px;">Var: <span class="meter-variance font-weight-bold">0.00</span></div>
                                        <div class="total-box" style="font-size: 1em; color: var(--primary);">Value: <br><span class="meter-total-value font-weight-bold">0.00</span></div>
                                    </div>
                                </div>
                            `;
                        });
                        
                        html += `
                                </div>
                                <div class="pg-summary-footer" style="background: #f8fafc; padding: 15px 20px; border-top: 1px solid #e2e8f0; border-radius: 0 0 8px 8px;">
                                    <div class="row text-center">
                                        <div class="col-md-3" style="border-right: 1px solid #e2e8f0;">
                                            <div style="font-size: 0.85em; color: #64748b; font-weight: bold; text-transform: uppercase;">Total AGO Ltrs</div>
                                            <div id="sum-ago-ltrs" style="font-size: 1.4em; color: var(--primary); font-weight: bold;">0.00</div>
                                        </div>
                                        <div class="col-md-3" style="border-right: 1px solid #e2e8f0;">
                                            <div style="font-size: 0.85em; color: #64748b; font-weight: bold; text-transform: uppercase;">Total PMS Ltrs</div>
                                            <div id="sum-pms-ltrs" style="font-size: 1.4em; color: var(--primary); font-weight: bold;">0.00</div>
                                        </div>
                                        <div class="col-md-3" style="border-right: 1px solid #e2e8f0;">
                                            <div style="font-size: 0.85em; color: #64748b; font-weight: bold; text-transform: uppercase;">Total AGO Value</div>
                                            <div id="sum-ago-val" style="font-size: 1.4em; color: #10b981; font-weight: bold;">0.00</div>
                                        </div>
                                        <div class="col-md-3">
                                            <div style="font-size: 0.85em; color: #64748b; font-weight: bold; text-transform: uppercase;">Total PMS Value</div>
                                            <div id="sum-pms-val" style="font-size: 1.4em; color: #10b981; font-weight: bold;">0.00</div>
                                        </div>
                                    </div>
                                    <div style="margin-top: 20px; text-align: center;">
                                        ${is_locked ? 
                                        `<div class="alert alert-warning" style="display:inline-block; margin-bottom:0;">
                                            <i class="fa fa-lock"></i> Readings for ${pg} are already saved. Use the <b>Edit</b> button in the History table to modify.
                                        </div>` : 
                                        `<button class="btn btn-primary btn-lg" id="btn-save-single-pg" data-pg="${pg}" style="min-width: 250px; border-radius: 30px;">
                                            <span class="spinner hidden"><i class="fa fa-spinner fa-spin"></i></span>
                                            <i class="fa fa-save"></i> Save ${pg} Readings
                                        </button>`}
                                    </div>
                                </div>
                            </div>
                        `;
                        
                        $wrapper.find('#pg-entry-form').html(html);
                        
                        $wrapper.find('.meter-closing-elec, .meter-closing-manual').on('blur', function() {
                            if($(this).val()) $(this).val(parseFloat($(this).val()).toFixed(2));
                        });
                        
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
                            
                            let sales_to_use = sales_elec > 0 ? sales_elec : sales_manual;
                            let total_value = sales_to_use * price;
                            $row.find('.meter-total-value').attr('data-val', total_value).text(total_value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
                            $row.attr('data-sales-ltrs', sales_to_use);
                            
                            calc_footer();
                        }
                        
                        function calc_footer() {
                            let ago_ltrs = 0, pms_ltrs = 0, ago_val = 0, pms_val = 0;
                            $wrapper.find('#pg-entry-form .meter-row').each(function() {
                                let fuel = $(this).attr('data-fuel-type');
                                let ltrs = parseFloat($(this).attr('data-sales-ltrs')) || 0;
                                let val = parseFloat($(this).find('.meter-total-value').attr('data-val')) || 0;
                                if (fuel === 'AGO') { ago_ltrs += ltrs; ago_val += val; }
                                else if (fuel === 'PMS') { pms_ltrs += ltrs; pms_val += val; }
                            });
                            $wrapper.find('#sum-ago-ltrs').text(ago_ltrs.toFixed(2));
                            $wrapper.find('#sum-pms-ltrs').text(pms_ltrs.toFixed(2));
                            $wrapper.find('#sum-ago-val').text(ago_val.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
                            $wrapper.find('#sum-pms-val').text(pms_val.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
                        }
                        
                        $wrapper.find('.meter-closing-elec, .meter-closing-manual').on('input', calc_row);
                        $wrapper.find('.meter-closing-elec').each(calc_row);
                        
                        // Save handler for this PG
                        $wrapper.find('#btn-save-single-pg').on('click', function() {
                            let btn = $(this);
                            let originalText = btn.html();
                            let pg_name = btn.attr('data-pg');
                            let has_empty = false;
                            let rows_data = [];
                            
                            $wrapper.find('#pg-entry-form .meter-row[data-name]').each(function() {
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
                                frappe.msgprint({ title: __('Validation Error'), indicator: 'red', message: __('Please enter all closing meter readings for this group.') });
                                return;
                            }
                            
                            let ago_val = $wrapper.find('#sum-ago-val').text();
                            let pms_val = $wrapper.find('#sum-pms-val').text();
                            
                            frappe.confirm(`<b>Confirm Save for ${pg_name}</b><br><br><span style="color:var(--primary); font-size:1.1em;">Total AGO Value:</span> <b>Ksh ${ago_val}</b><br><span style="color:var(--primary); font-size:1.1em;">Total PMS Value:</span> <b>Ksh ${pms_val}</b>`, function() {
                                btn.prop('disabled', true); btn.find('.spinner').removeClass('hidden');
                                save_child_table("pump_meter_readings", rows_data, `${pg_name} saved!`, btn, originalText, function() {
                                    // Update local state
                                    rows_data.forEach(rd => {
                                        let mr = window.METER_GROUPS[pg_name].find(m => m.name === rd.name);
                                        if (mr) {
                                            mr.closing_electronic_meter = rd.closing_electronic_meter;
                                            mr.closing_manual_meter = rd.closing_manual_meter;
                                        }
                                    });
                                    // Clear form and re-render history
                                    window.EDITING_PG = null;
                                    $wrapper.find('#pg-selector').val('').trigger('change');
                                    render_history();
                                    frappe.show_alert({message: `${pg_name} readings successfully saved!`, indicator: 'green'});
                                });
                            }, function() {
                                // User clicked cancel on confirm
                            });
                        });
                    }
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
    if(!window.TILL_CSA_MAPPING) {
        frappe.call({
            method: "fuel_management.fuel_management.doctype.shift.shift.get_till_pump_groups",
            callback: function(r) {
                let mapping = {};
                if(r.message) {
                    let pg_to_csa = {};
                    (window.SHIFT_DOC.assigned_csas || []).forEach(row => {
                        let csa_name = row.csa;
                        if(window.USERS_LIST) {
                            let u = window.USERS_LIST.find(user => user.name === row.csa);
                            if(u) csa_name = u.employee_name;
                        }
                        if(!pg_to_csa[row.pump_group]) pg_to_csa[row.pump_group] = [];
                        pg_to_csa[row.pump_group].push(csa_name);
                    });
                    
                    r.message.forEach(row => {
                        if(!mapping[row.parent]) mapping[row.parent] = [];
                        if(pg_to_csa[row.pump_group]) {
                            mapping[row.parent].push(...pg_to_csa[row.pump_group]);
                        }
                    });
                }
                window.TILL_CSA_MAPPING = mapping;
                render_mpesa($wrapper);
            }
        });
        return;
    }

    let html = '';
    let posted_html = '';
    (window.SHIFT_DOC.mpesa_payments || []).forEach(row => {
        let csa_names = window.TILL_CSA_MAPPING[row.mpesa_till] || [];
        let unique_csas = [...new Set(csa_names)];
        let csa_text = unique_csas.length > 0 ? `<div style="font-size: 0.85em; color: var(--primary); margin-top: 5px;">Assigned CSA: <strong>${unique_csas.join(', ')}</strong></div>` : "";

        if (row.posted) {
            posted_html += `
                <tr data-name="${row.name}">
                    <td style="font-weight: 600; color: var(--text-primary);">
                        ${row.mpesa_till}
                        ${csa_text}
                    </td>
                    <td><span class="read-only-cell">${Number(row.opening_balance || 0).toLocaleString('en-US', {maximumFractionDigits: 0})}</span></td>
                    <td><span class="read-only-cell">${Number(row.transfers_made || 0).toLocaleString('en-US', {maximumFractionDigits: 0})}</span></td>
                    <td><span class="read-only-cell">${Number(row.closing_balance || 0).toLocaleString('en-US', {maximumFractionDigits: 0})}</span></td>
                    <td class="font-weight-bold">${Number(row.amount || 0).toLocaleString('en-US', {maximumFractionDigits: 0})}</td>
                    <td>
                        <button class="btn-clear-mpesa btn-secondary btn-sm" style="color: #dc2626; border-color: #fca5a5;">Edit/Clear</button>
                    </td>
                </tr>
            `;
        } else {
            html += `
                <tr data-name="${row.name}">
                    <td style="font-weight: 600; color: var(--text-primary);">
                        ${row.mpesa_till}
                        ${csa_text}
                    </td>
                    <td><span class="read-only-cell">${Number(row.opening_balance || 0).toLocaleString('en-US', {maximumFractionDigits: 0})}</span></td>
                    <td>
                        <input type="number" class="spa-input mpesa-transfers highlight-input" data-field="transfers_made" value="${row.transfers_made || ''}" placeholder="Enter Transfers">
                    </td>
                    <td>
                        <input type="number" class="spa-input mpesa-closing highlight-input" data-field="closing_balance" data-opening="${row.opening_balance || 0}" value="${row.closing_balance || ''}" placeholder="Enter Closing">
                    </td>
                    <td class="mpesa-collected font-weight-bold">0.00</td>
                </tr>
            `;
        }
    });
    $wrapper.find('#mpesa-tills-container').html(html || '<tr><td colspan="5" class="text-center">No pending tills to input.</td></tr>');
    $wrapper.find('#posted-mpesa-container').html(posted_html || '<tr><td colspan="6" class="text-center">No posted tills yet.</td></tr>');

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
            $row.find('.mpesa-collected').text(collected.toLocaleString('en-US', {maximumFractionDigits: 0})).css('color', 'var(--text-primary)');
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
    let lubes_assignment = (window.SHIFT_DOC.assigned_csas || []).find(a => (a.pump_group || '').toLowerCase().includes('lube'));
    if (lubes_assignment) {
        let u = window.USERS_LIST.find(u => u.name === lubes_assignment.csa);
        let name = u ? u.employee_name : lubes_assignment.csa;
        $wrapper.find('#drystock-liability-csa').text(name + " (Assigned)");
    } else {
        $wrapper.find('#drystock-liability-csa').text("Select Sold By (Fallback)");
    }

    // Populate CSA dropdown
    let csaOptions = '<option value="">Select CSA...</option>';
    if (window.USERS_LIST) {
        window.USERS_LIST.forEach(u => { csaOptions += `<option value="${u.name}">${u.employee_name}</option>`; });
    }
    $wrapper.find('#drystock-csa').html(csaOptions).off('change').on('change', function() {
        if (!lubes_assignment) {
            let u = window.USERS_LIST.find(u => u.name === $(this).val());
            let name = u ? u.employee_name : "Whoever sells it";
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
        
        if (!item || qty <= 0) {
            frappe.show_alert({message: "Please search for a valid Item and enter quantity.", indicator: "red"});
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
            if(u) csa_name = u.employee_name;
        }
        
        let entry_id = 1000 + idx + 1;
        let time_val = frappe.datetime.now_time().substring(0, 5);
        let date_val = frappe.datetime.str_to_user(window.SHIFT_DOC.shift_date || frappe.datetime.now_date());
        
        let del_btn = is_locked ? `<button class="btn btn-xs btn-danger" disabled>X</button>` : `<button class="btn btn-xs btn-danger btn-remove-drystock">X</button>`;
        
        let category = '';
        if (window.DRYSTOCK_ITEMS) {
            let i = window.DRYSTOCK_ITEMS.find(i => i.item_code === row.item);
            if (i) category = i.item_group || '';
        }

        html += `
            <tr data-idx="${idx}">
                <td style="font-family: monospace; color: #64748b;">${entry_id} (Pending)</td>
                <td style="color: #64748b;">${date_val}</td>
                <td><span class="badge" style="background-color: #f8fafc; color: #64748b;">${window.ACTIVE_SHIFT.shift_template || ""}</span></td>
                <td>${csa_name || ''}</td>
                <td>${row.item}</td>
                <td>${category}</td>
                <td>${row.quantity}</td>
                <td>${row.total_volume || 0}</td>
                <td style="font-weight: 600;">${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
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
    let total_amount_saved = 0;
    (window.SHIFT_DOC.inventory_sales || []).forEach((row, idx) => {
        let row_date = row.creation ? row.creation.split(" ")[0] : frappe.datetime.now_date();
        if (start_date && row_date < start_date) return;
        if (end_date && row_date > end_date) return;
        let category = '';
        if (window.DRYSTOCK_ITEMS) {
            let i = window.DRYSTOCK_ITEMS.find(i => i.item_code === row.item);
            if (i) category = i.item_group || '';
        }

        if (filter_search && 
            !(row.item && row.item.toLowerCase().includes(filter_search)) && 
            !(category && category.toLowerCase().includes(filter_search))) return;
            
        let csa_name = row.sold_by;
        if (window.USERS_LIST) {
            let u = window.USERS_LIST.find(u => u.name === row.sold_by);
            if(u) csa_name = u.employee_name;
        }
        let entry_id = 1000 + (row.idx || (idx + 1));
        let time_val = row.creation ? row.creation.split(" ")[1].substring(0, 5) : frappe.datetime.now_time().substring(0, 5);
        let date_val = frappe.datetime.str_to_user(window.SHIFT_DOC.shift_date || frappe.datetime.now_date());
        
        let del_btn = '';
        if (row.is_invoice_sale) {
            del_btn = `<span class="badge" style="background-color: var(--blue-50); color: var(--blue-600); border: 1px solid var(--blue-200);">Invoice Sale</span>`;
        } else if (is_locked) {
            del_btn = `<button class="btn btn-xs btn-danger" disabled>X</button>`;
        } else {
            del_btn = `<button class="btn btn-xs btn-secondary btn-edit-saved" data-idx="${idx}" style="margin-right:0.25rem;">Edit</button>
             <button class="btn btn-xs btn-danger btn-remove-saved" data-idx="${idx}">X</button>`;
        }
        
        total_amount_saved += parseFloat(row.amount || 0);

        html_saved += `
            <tr>
                <td style="font-family: monospace; color: #64748b;">${entry_id}</td>
                <td style="color: #64748b;">${date_val}</td>
                <td><span class="badge" style="background-color: #f8fafc; color: #64748b;">${window.ACTIVE_SHIFT.shift_template || ""}</span></td>
                <td>${csa_name || ''}</td>
                <td>${row.item}</td>
                <td><span class="badge" style="background-color: #f1f5f9; color: #475569; font-weight: normal;">${category}</span></td>
                <td>${row.quantity}</td>
                <td>${row.total_volume || 0}</td>
                <td style="font-weight: 600;">${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                <td>${del_btn}</td>
            </tr>
        `;
    });
    
    $wrapper.find('#drystock-history-total').text('Total Amount: KES ' + (total_amount_saved + total_amount).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
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
                            
                            let full_item_name = row.item;
                            if (window.DRYSTOCK_ITEMS) {
                                let match = window.DRYSTOCK_ITEMS.find(i => i.item_code === row.item);
                                if (match) full_item_name = `${match.item_name} - ${match.item_code}`;
                            }
                            $wrapper.find('#drystock-item-input').val(full_item_name);
                            
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
                frappe.call({
                    method: "frappe.client.get_list",
                    args: { doctype: "Item", fields: ["name", "item_group"], limit_page_length: 500 },
                    callback: function(r2) {
                        let groups = {};
                        if(r2.message) r2.message.forEach(i => groups[i.name] = i.item_group);
                        r.message.forEach(item => item.item_group = groups[item.item_code] || "");
                        window.DRYSTOCK_ITEMS = r.message;
                        let options = '';
                        r.message.forEach(item => {
                            options += `<option value="${item.item_name} - ${item.item_code}"></option>`;
                        });
                        $(wrapper).find('#drystock-items-list').html(options);
                    }
                });
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

    // Fetch Head CSAs (Users)
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "User",
            filters: { enabled: 1 },
            fields: ["name", "full_name"]
        },
        callback: function(r) {
            if(r.message) {
                let options = '<option value="">Select Head CSA...</option>';
                r.message.forEach(u => {
                    let selected = (u.name === frappe.session.user) ? 'selected' : '';
                    options += `<option value="${u.name}" ${selected}>${u.full_name}</option>`;
                });
                $(wrapper).find('#select-head-csa').html(options);
            }
        }
    });

    // Fetch Employees (for pump attendants, using legacy USERS_LIST variable)
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Employee",
            filters: { status: "Active" },
            fields: ["name", "employee_name"]
        },
        callback: function(r) {
            if(r.message) {
                window.USERS_LIST = r.message;
                render_pump_group_rows($(wrapper));
            }
        }
    });

    function render_pump_group_rows($w) {
        if(!window.USERS_LIST || window.USERS_LIST.length === 0) return;
        if(!window.PUMP_GROUPS_LIST || window.PUMP_GROUPS_LIST.length === 0) return;
        
        let csaOptions = '<option value="">Select CSA...</option>';
        window.USERS_LIST.forEach(u => { csaOptions += `<option value="${u.name}">${u.employee_name}</option>`; });
        
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

    // M-Pesa Segmented Control
    $wrapper.find('#tab-mpesa .seg-btn').off('click').on('click', function() {
        let targetView = $(this).attr('data-view');
        $wrapper.find('#tab-mpesa .seg-btn').removeClass('active');
        $(this).addClass('active');
        
        $wrapper.find('#tab-mpesa .view-pane').removeClass('active');
        $wrapper.find(`#mpesa-${targetView}-view`).addClass('active');
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
    // Old bulk save wetstock removed in favor of per-pump-group save.

    
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
        let btn = $(this);
        let readings = [];
        let valid = true;
        let missing = 0;
        let originalText = btn.html();
        btn.html('<span class="spinner"></span> Saving...');
        btn.prop('disabled', true);
        
        $wrapper.find('#mpesa-tills-container tr').each(function() {
            let closing = $(this).find('.mpesa-closing').val();
            let transfers = $(this).find('.mpesa-transfers').val();
            if(closing !== "") {
                readings.push({
                    name: $(this).attr('data-name'),
                    transfers_made: transfers || 0,
                    closing_balance: closing,
                    posted: 1
                });
            } else {
                missing++;
            }
        });
        
        if(readings.length === 0) {
            frappe.msgprint("Please enter closing balances for at least one till before saving.");
            btn.html(originalText);
            btn.prop('disabled', false);
            return;
        }
        if(missing > 0) {
            // It's fine if they don't save all of them at once.
        }
        save_child_table("mpesa_payments", readings, "M-Pesa Tills saved!", btn, originalText, function() {
            render_mpesa($wrapper);
        });
    });
    
    $wrapper.on('click', '.btn-clear-mpesa', function() {
        let name = $(this).closest('tr').attr('data-name');
        let btn = $(this);
        frappe.confirm('Are you sure you want to edit/clear this till reading?', () => {
            btn.text('Clearing...');
            save_child_table("mpesa_payments", [{
                name: name,
                closing_balance: 0,
                transfers_made: 0,
                posted: 0
            }], "Till Cleared!", null, null, function() {
                render_mpesa($wrapper);
            });
        });
    });
    
    function save_child_table(table_name, rows_data, success_msg, btn = null, originalText = null, callback = null) {
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
            if(callback) callback(r2);
                        }
                    });
                } else {
                    if(btn) { btn.find('.spinner').addClass('hidden'); btn.prop('disabled', false); }
            if(callback) callback(r2);
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
    let allowed_csas = [];
    if(window.SHIFT_DOC.head_csa) allowed_csas.push(window.SHIFT_DOC.head_csa);
    (window.SHIFT_DOC.assigned_csas || []).forEach(row => {
        if(row.csa) allowed_csas.push(row.csa);
    });
    
    // Remove duplicates
    allowed_csas = [...new Set(allowed_csas)];
    
    allowed_csas.forEach(csa => {
        let u = window.USERS_LIST.find(u => u.name === csa);
        let name = u ? u.employee_name : csa;
        csaOptions += `<option value="${csa}">${name}</option>`;
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
            limit_page_length: 5000
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
        let unique_v = [];
        if(window.SHIFT_DOC && window.SHIFT_DOC.invoices) {
            window.SHIFT_DOC.invoices.forEach(row => {
                if(row.customer === cust && row.vehicle_registration) {
                    unique_v.push(row.vehicle_registration);
                }
            });
        }
        unique_v = [...new Set(unique_v)];
        let vOpts = '';
        unique_v.forEach(v => {
            if(v) vOpts += `<option value="${v}">`;
        });
        $wrapper.find('#invoice-vehicles-list').html(vOpts);
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
        let item = (window.INVOICE_ITEMS || []).find(i => `${i.item_name} - ${i.item_code}` === item_val);
        
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
        let c = (window.CUSTOMERS_LIST || []).find(c => c.name === row.customer);
        let customer_name = c ? c.customer_name : row.customer;
        
        let csa_name = row.csa;
        if(window.USERS_LIST) {
            let u = window.USERS_LIST.find(u => u.name === row.csa);
            if(u) csa_name = u.employee_name;
        }

        let del_btn = is_locked ? 
            `<button class="btn btn-xs btn-danger" disabled>X</button>` : 
            `<button class="btn btn-xs btn-danger btn-remove-saved-invoice" data-idx="${idx}">X</button>`;
            
        let edit_btn = is_locked ?
            `<button class="btn btn-xs btn-default" disabled>Edit</button>` :
            `<button class="btn btn-xs btn-default btn-edit-saved-invoice" data-idx="${idx}">Edit</button>`;

        let action_html = `<div style="display:flex; gap:0.5rem;">${edit_btn}${del_btn}</div>`;

        let sDate = window.ACTIVE_SHIFT.shift_date || window.ACTIVE_SHIFT.creation || frappe.datetime.now_date();
        let shiftName = window.ACTIVE_SHIFT.shift_template ? `${window.ACTIVE_SHIFT.shift_template}` : window.ACTIVE_SHIFT.name;

        html_saved += `
            <tr>
                <td><span class="badge" style="background: #e2e8f0; color: #0f172a;">${row.entry_number || '-'}</span></td>
                <td style="color: #64748b;">${sDate.split(" ")[0]}</td>
                <td style="color: #64748b;">${shiftName}</td>
                <td><strong>${customer_name || ''}</strong></td>
                <td>${row.purchase_order || '-'}</td>
                <td>${row.vehicle_registration || '-'}</td>
                <td>${row.item_name || row.item || ''}</td>
                <td>${row.quantity || 0}</td>
                <td>${csa_name || ''}</td>
                <td><strong>${frappe.format(row.amount, {fieldtype: 'Currency'})}</strong></td>
                <td>${action_html}</td>
            </tr>
        `;
    });
    if(!html_saved) {
        html_saved = `<tr><td colspan="11" style="text-align: center; color: #64748b; padding: 2rem;">No historical invoices match filters.</td></tr>`;
    }
    $wrapper.find('#list-invoice-saved').html(html_saved);

    // Edit Historical Action
    $wrapper.find('.btn-edit-saved-invoice').off('click').on('click', function() {
        if(is_locked) return;
        let idx = parseInt($(this).attr('data-idx'));
        let row = window.SHIFT_DOC.invoices[idx];
        
        frappe.confirm('This will load the invoice back into the entry form and remove it from history. Continue?', () => {
            // Populate form
            let c = (window.CUSTOMERS_LIST || []).find(c => c.name === row.customer);
            let customer_name = c ? c.customer_name : '';
            $wrapper.find('#invoice-customer-input').val(`${row.customer} - ${customer_name}`);
            $wrapper.find('#invoice-customer-input').trigger('change');
            
            $wrapper.find('#invoice-csa').val(row.csa);
            $wrapper.find('#invoice-po').val(row.purchase_order);
            $wrapper.find('#invoice-vehicle').val(row.vehicle_registration);
            $wrapper.find('#invoice-item-input').val(`${row.item_name} - ${row.item}`);
            $wrapper.find('#invoice-qty').val(row.quantity);
            $wrapper.find('#invoice-rate').val(row.rate);
            $wrapper.find('#invoice-amount').val(row.amount);
            
            // Delete from history
            window.SHIFT_DOC.invoices.splice(idx, 1);
            frappe.call({
                method: "frappe.client.get",
                args: { doctype: "Shift", name: window.ACTIVE_SHIFT.name },
                callback: function(r) {
                    if(r.message) {
                        let doc = r.message;
                        doc.invoices = window.SHIFT_DOC.invoices.map(r2 => {
                            return { ...r2, name: r2._is_new ? undefined : r2.name };
                        });
                        frappe.call({
                            method: "frappe.client.save",
                            args: { doc: doc },
                            callback: function(r2) {
                                if(r2.message) window.SHIFT_DOC = r2.message;
                                refresh_invoice_cart($wrapper);
                                $wrapper.find('.seg-btn[data-view="entry"]').click();
                            }
                        });
                    }
                }
            });
        });
    });

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

// =========================================================
// CUSTOMER PAYMENTS MODULE
// =========================================================
function render_customer_payments($wrapper) {
    if(!window.ACTIVE_SHIFT) return;

    let is_locked = window.ACTIVE_SHIFT.status !== 'Open';

    // 1. Setup Segmented Control
    $wrapper.find('#tab-customer-payments .seg-btn').off('click').on('click', function() {
        let $btn = $(this);
        let targetView = $btn.attr('data-view');
        
        $wrapper.find('#tab-customer-payments .seg-btn').removeClass('active');
        $btn.addClass('active');
        
        $wrapper.find('#tab-customer-payments .view-pane').removeClass('active');
        $wrapper.find(`#cp-${targetView}-view`).addClass('active');
    });

    // 2. Populate CSAs
    let csaOptions = '<option value="">Select CSA...</option>';
    let allowed_csas = [];
    if(window.SHIFT_DOC.head_csa) allowed_csas.push(window.SHIFT_DOC.head_csa);
    (window.SHIFT_DOC.assigned_csas || []).forEach(row => {
        if(row.csa) allowed_csas.push(row.csa);
    });
    
    // Remove duplicates
    allowed_csas = [...new Set(allowed_csas)];
    
    allowed_csas.forEach(csa => {
        let u = window.USERS_LIST.find(u => u.name === csa);
        let name = u ? u.employee_name : csa;
        csaOptions += `<option value="${csa}">${name}</option>`;
    });
    $wrapper.find('#cp-csa').html(csaOptions);

    // 3. Populate Customers (reuses window.CUSTOMERS_LIST fetched by invoices)
    let pop_cust = function() {
        if(window.CUSTOMERS_LIST) {
            let custOpts = '';
            window.CUSTOMERS_LIST.forEach(c => {
                custOpts += `<option value="${c.name}">${c.customer_name}</option>`;
            });
            $wrapper.find('#cp-customers-list').html(custOpts);
        }
    };
    if(window.CUSTOMERS_LIST) {
        pop_cust();
    } else {
        frappe.call({
            method: "frappe.client.get_list",
            args: { doctype: "Customer", fields: ["name", "customer_name"], limit_page_length: 5000 },
            callback: function(r) {
                if(r.message) {
                    window.CUSTOMERS_LIST = r.message;
                    pop_cust();
                }
            }
        });
    }

    // 4. Populate Mode of Payment
    frappe.call({
        method: "frappe.client.get_list",
        args: { doctype: "Mode of Payment", fields: ["name"], limit_page_length: 100 },
        callback: function(r) {
            if(r.message) {
                let mopOpts = '<option value="">Select Mode...</option>';
                r.message.forEach(m => {
                    mopOpts += `<option value="${m.name}">${m.name}</option>`;
                });
                $wrapper.find('#cp-mode').html(mopOpts);
            }
        }
    });

    // 5. Fetch and Render History
    let fetch_history = function() {
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Customer Payment",
                filters: { shift: window.ACTIVE_SHIFT.name },
                fields: ["name", "date", "shift", "creation", "customer", "csa", "mode_of_payment", "amount"],
                order_by: "name desc"
            },
            callback: function(r) {
                let html = '';
                if(r.message) {
                    r.message.forEach(row => {
                        let time_val = row.creation ? row.creation.split(" ")[1].substring(0, 5) : "";
                        let csa_name = row.csa;
                        if (window.USERS_LIST) {
                            let u = window.USERS_LIST.find(u => u.name === row.csa);
                            if(u) csa_name = u.employee_name;
                        }
                        
                        html += `
                            <tr>
                                <td style="font-family: monospace; color: #64748b;">${row.name}</td>
                                <td>${row.date || ""}</td>
                                <td><span class="badge" style="background-color: #f8fafc; color: #64748b;">${window.ACTIVE_SHIFT.shift_template || ""}</span></td>
                                <td style="color: #64748b;">${time_val}</td>
                                <td>${row.customer}</td>
                                <td>${csa_name}</td>
                                <td><span class="badge" style="background-color: #f1f5f9; color: #475569; font-weight: normal;">${row.mode_of_payment}</span></td>
                                <td style="font-weight: 600;">${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            </tr>
                        `;
                    });
                }
                if(html === '') html = '<tr><td colspan="8" class="text-center" style="color: #94a3b8; padding: 2rem;">No payments recorded yet.</td></tr>';
                $wrapper.find('#list-customer-payments-saved').html(html);
            }
        });
    };
    fetch_history();

    // 6. Save Payment
    $wrapper.find('#btn-save-customer-payment').off('click').on('click', function() {
        if (is_locked) {
            frappe.show_alert({message: "Shift is closed/locked.", indicator: "red"});
            return;
        }

        let customer = $wrapper.find('#cp-customer-input').val();
        let csa = $wrapper.find('#cp-csa').val();
        let mode = $wrapper.find('#cp-mode').val();
        let trans_no = $wrapper.find('#cp-trans-no').val();
        let amount = parseFloat($wrapper.find('#cp-amount').val()) || 0;
        let memo = $wrapper.find('#cp-memo').val();

        if (!customer || !csa || !mode || amount <= 0) {
            frappe.show_alert({message: "Customer, CSA, Mode of Payment, and valid Amount are required.", indicator: "red"});
            return;
        }

        let $btn = $(this);
        let orig_html = $btn.html();
        $btn.html('<span class="spinner-border spinner-border-sm"></span> Saving...').prop('disabled', true);

        frappe.call({
            method: "frappe.client.insert",
            args: {
                doc: {
                    doctype: "Customer Payment",
                    shift: window.ACTIVE_SHIFT.name,
                    date: window.SHIFT_DOC.shift_date || frappe.datetime.nowdate(),
                    customer: customer,
                    csa: csa,
                    mode_of_payment: mode,
                    trans_no: trans_no,
                    amount: amount,
                    memo: memo
                }
            },
            callback: function(r) {
                $btn.html(orig_html).prop('disabled', false);
                if(r.message) {
                    frappe.show_alert({message: "Customer Payment saved successfully!", indicator: "green"});
                    
                    // Clear inputs
                    $wrapper.find('#cp-customer-input').val('');
                    $wrapper.find('#cp-trans-no').val('');
                    $wrapper.find('#cp-amount').val('');
                    $wrapper.find('#cp-memo').val('');
                    
                    // Switch to history view and refresh
                    $wrapper.find('#tab-customer-payments .seg-btn[data-view="history"]').click();
                    fetch_history();
                }
            }
        });
    });
}

// =========================================================
// STATION CARDS MODULE
// =========================================================
function render_fleet_cards($wrapper) {
    if(!window.ACTIVE_SHIFT) return;

    let is_locked = window.ACTIVE_SHIFT.status !== 'Open';

    // 1. Setup Segmented Control
    $wrapper.find('#tab-station-cards .seg-btn').off('click').on('click', function() {
        let $btn = $(this);
        let targetView = $btn.attr('data-view');
        
        $wrapper.find('#tab-station-cards .seg-btn').removeClass('active');
        $btn.addClass('active');
        
        $wrapper.find('#tab-station-cards .view-pane').removeClass('active');
        $wrapper.find(`#sc-${targetView}-view`).addClass('active');
    });

    // 2. Populate CSAs
    let csaOptions = '<option value="">Select CSA...</option>';
    let allowed_csas = [];
    if(window.SHIFT_DOC.head_csa) allowed_csas.push(window.SHIFT_DOC.head_csa);
    (window.SHIFT_DOC.assigned_csas || []).forEach(row => {
        if(row.csa) allowed_csas.push(row.csa);
    });
    
    // Remove duplicates
    allowed_csas = [...new Set(allowed_csas)];
    
    allowed_csas.forEach(csa => {
        let u = window.USERS_LIST.find(u => u.name === csa);
        let name = u ? u.employee_name : csa;
        csaOptions += `<option value="${csa}">${name}</option>`;
    });
    $wrapper.find('#sc-csa').html(csaOptions);

    // 3. Populate Cards (from Station Card Type DocType)
    frappe.call({
        method: "frappe.client.get_list",
        args: { doctype: "Station Card Type", fields: ["name", "card_name", "status"], limit_page_length: 500, filters: { status: "Active" } },
        callback: function(r) {
            if(r.message) {
                let cardOpts = '<option value="">Select Card...</option>';
                r.message.forEach(c => {
                    cardOpts += `<option value="${c.name}">${c.card_name}</option>`;
                });
                $wrapper.find('#sc-card').html(cardOpts);
            }
        }
    });

    // 4. Fetch and Render History
    let fetch_history = function() {
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Station Cards",
                filters: { shift: window.ACTIVE_SHIFT.name },
                fields: ["name", "date", "shift", "creation", "card", "csa", "receipt_no", "amount"],
                order_by: "name desc"
            },
            callback: function(r) {
                let html = '';
                if(r.message) {
                    r.message.forEach(row => {
                        let time_val = row.creation ? row.creation.split(" ")[1].substring(0, 5) : "";
                        let csa_name = row.csa;
                        if (window.USERS_LIST) {
                            let u = window.USERS_LIST.find(u => u.name === row.csa);
                            if(u) csa_name = u.employee_name;
                        }
                        
                        html += `
                            <tr>
                                <td style="font-family: monospace; color: #64748b;">${row.name}</td>
                                <td>${row.date || ""}</td>
                                <td><span class="badge" style="background-color: #f8fafc; color: #64748b;">${window.ACTIVE_SHIFT.shift_template || ""}</span></td>
                                <td style="color: #64748b;">${time_val}</td>
                                <td><span class="badge" style="background-color: #f1f5f9; color: #475569; font-weight: normal;">${row.receipt_no}</span></td>
                                <td>${row.card}</td>
                                <td>${csa_name}</td>
                                <td style="font-weight: 600;">${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            </tr>
                        `;
                    });
                }
                if(html === '') html = '<tr><td colspan="8" class="text-center" style="color: #94a3b8; padding: 2rem;">No card payments recorded yet.</td></tr>';
                $wrapper.find('#list-station-cards-saved').html(html);
            }
        });
    };
    fetch_history();

    // 5. Save Station Card Payment
    $wrapper.find('#btn-save-station-card').off('click').on('click', function() {
        if (is_locked) {
            frappe.show_alert({message: "Shift is closed/locked.", indicator: "red"});
            return;
        }

        let card = $wrapper.find('#sc-card').val();
        let csa = $wrapper.find('#sc-csa').val();
        let receipt_no = $wrapper.find('#sc-receipt-no').val();
        let amount = parseFloat($wrapper.find('#sc-amount').val()) || 0;
        let memo = $wrapper.find('#sc-memo').val();

        if (!card || !csa || !receipt_no || amount <= 0) {
            frappe.show_alert({message: "Card, CSA, Receipt No, and valid Amount are required.", indicator: "red"});
            return;
        }

        let $btn = $(this);
        let orig_html = $btn.html();
        $btn.html('<span class="spinner-border spinner-border-sm"></span> Saving...').prop('disabled', true);

        frappe.call({
            method: "frappe.client.insert",
            args: {
                doc: {
                    doctype: "Station Cards",
                    shift: window.ACTIVE_SHIFT.name,
                    date: window.SHIFT_DOC.shift_date || frappe.datetime.nowdate(),
                    card: card,
                    csa: csa,
                    receipt_no: receipt_no,
                    amount: amount,
                    memo: memo
                }
            },
            callback: function(r) {
                $btn.html(orig_html).prop('disabled', false);
                if(r.message) {
                    frappe.show_alert({message: "Station Card Payment saved successfully!", indicator: "green"});
                    
                    // Clear inputs
                    $wrapper.find('#sc-card').val('');
                    $wrapper.find('#sc-receipt-no').val('');
                    $wrapper.find('#sc-amount').val('');
                    $wrapper.find('#sc-memo').val('');
                    
                    // Switch to history view and refresh
                    $wrapper.find('#tab-station-cards .seg-btn[data-view="history"]').click();
                    fetch_history();
                }
            }
        });
    });
}

// =========================================================
// STATION EXPENSES MODULE
// =========================================================
function render_station_expenses($wrapper) {
    if(!window.ACTIVE_SHIFT) return;

    let is_locked = window.ACTIVE_SHIFT.status !== 'Open';

    // 1. Setup Segmented Control
    $wrapper.find('#tab-expenses .seg-btn').off('click').on('click', function() {
        let $btn = $(this);
        let targetView = $btn.attr('data-view');
        
        $wrapper.find('#tab-expenses .seg-btn').removeClass('active');
        $btn.addClass('active');
        
        $wrapper.find('#tab-expenses .view-pane').removeClass('active');
        $wrapper.find(`#expenses-${targetView}-view`).addClass('active');
    });

    // 2. Populate CSAs
    let csaOptions = '<option value="">Select CSA...</option>';
    let allowed_csas = [];
    if(window.SHIFT_DOC.head_csa) allowed_csas.push(window.SHIFT_DOC.head_csa);
    (window.SHIFT_DOC.assigned_csas || []).forEach(row => {
        if(row.csa) allowed_csas.push(row.csa);
    });
    
    // Remove duplicates
    allowed_csas = [...new Set(allowed_csas)];
    
    allowed_csas.forEach(csa => {
        let u = window.USERS_LIST.find(u => u.name === csa);
        let name = u ? u.employee_name : csa;
        csaOptions += `<option value="${csa}">${name}</option>`;
    });
    $wrapper.find('#se-csa').html(csaOptions);

    // 3. Populate Categories (from Expense Claim Type)
    frappe.call({
        method: "frappe.client.get_list",
        args: { doctype: "Expense Claim Type", fields: ["name"], limit_page_length: 500 },
        callback: function(r) {
            if(r.message) {
                let catOpts = '<option value="">Select Category...</option>';
                r.message.forEach(c => {
                    catOpts += `<option value="${c.name}">${c.name}</option>`;
                });
                $wrapper.find('#se-category').html(catOpts);
            }
        }
    });

    // 4. Fetch and Render History
    let fetch_history = function() {
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Station Expense",
                filters: { shift: window.ACTIVE_SHIFT.name },
                fields: ["name", "date", "shift", "creation", "category", "csa", "memo", "amount"],
                order_by: "name desc"
            },
            callback: function(r) {
                let html = '';
                if(r.message) {
                    r.message.forEach(row => {
                        let time_val = row.creation ? row.creation.split(" ")[1].substring(0, 5) : "";
                        let csa_name = row.csa;
                        if (window.USERS_LIST) {
                            let u = window.USERS_LIST.find(u => u.name === row.csa);
                            if(u) csa_name = u.employee_name;
                        }
                        
                        html += `
                            <tr>
                                <td style="font-family: monospace; color: #64748b;">${row.name}</td>
                                <td>${row.date || ""}</td>
                                <td><span class="badge" style="background-color: #f8fafc; color: #64748b;">${window.ACTIVE_SHIFT.shift_template || ""}</span></td>
                                <td style="color: #64748b;">${time_val}</td>
                                <td><span class="badge" style="background-color: #f1f5f9; color: #475569; font-weight: normal;">${row.category}</span></td>
                                <td>${csa_name}</td>
                                <td>${row.memo || ""}</td>
                                <td style="font-weight: 600;">${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            </tr>
                        `;
                    });
                }
                if(html === '') html = '<tr><td colspan="8" class="text-center" style="color: #94a3b8; padding: 2rem;">No expenses recorded yet.</td></tr>';
                $wrapper.find('#list-station-expenses-saved').html(html);
            }
        });
    };
    fetch_history();

    // 5. Save Station Expense
    $wrapper.find('#btn-save-station-expense').off('click').on('click', function() {
        if (is_locked) {
            frappe.show_alert({message: "Shift is closed/locked.", indicator: "red"});
            return;
        }

        let category = $wrapper.find('#se-category').val();
        let csa = $wrapper.find('#se-csa').val();
        let amount = parseFloat($wrapper.find('#se-amount').val()) || 0;
        let memo = $wrapper.find('#se-memo').val();

        if (!category || !csa || amount <= 0) {
            frappe.show_alert({message: "Category, CSA, and valid Amount are required.", indicator: "red"});
            return;
        }

        let $btn = $(this);
        let orig_html = $btn.html();
        $btn.html('<span class="spinner-border spinner-border-sm"></span> Saving...').prop('disabled', true);

        frappe.call({
            method: "frappe.client.insert",
            args: {
                doc: {
                    doctype: "Station Expense",
                    shift: window.ACTIVE_SHIFT.name,
                    date: window.SHIFT_DOC.shift_date || frappe.datetime.nowdate(),
                    category: category,
                    csa: csa,
                    amount: amount,
                    memo: memo
                }
            },
            callback: function(r) {
                $btn.html(orig_html).prop('disabled', false);
                if(r.message) {
                    frappe.show_alert({message: "Station Expense saved successfully!", indicator: "green"});
                    
                    // Clear inputs
                    $wrapper.find('#se-category').val('');
                    $wrapper.find('#se-amount').val('');
                    $wrapper.find('#se-memo').val('');
                    
                    // Switch to history view and refresh
                    $wrapper.find('#tab-expenses .seg-btn[data-view="history"]').click();
                    fetch_history();
                }
            }
        });
    });
}


// =========================================================
// RETURN TO TANK (RTT) MODULE
// =========================================================
function render_rtt($wrapper) {
    if(!window.ACTIVE_SHIFT) return;

    let is_locked = window.ACTIVE_SHIFT.status !== 'Open';

    // 1. Setup Segmented Control
    $wrapper.find('#tab-rtt .seg-btn').off('click').on('click', function() {
        let $btn = $(this);
        let targetView = $btn.attr('data-view');
        
        $wrapper.find('#tab-rtt .seg-btn').removeClass('active');
        $btn.addClass('active');
        
        $wrapper.find('#tab-rtt .view-pane').removeClass('active');
        $wrapper.find(`#rtt-${targetView}-view`).addClass('active');
    });

    // 2. Fetch Nozzle Prices map
    let nozzlePrices = {};
    frappe.call({
        method: "fuel_management.fuel_management.doctype.shift.shift.get_nozzle_prices",
        args: { station: window.SHIFT_DOC.station, shift_date: window.SHIFT_DOC.shift_date },
        callback: function(r) {
            if(r.message) {
                nozzlePrices = r.message;
                populateItems();
            }
        }
    });

    // 3. Setup Nozzle Dropdown
    let nozOptions = '<option value="">Select Nozzle...</option>';
    let availableNozzles = [];
    (window.SHIFT_DOC.pump_meter_readings || []).forEach(row => {
        if(row.pump_nozzle) availableNozzles.push(row.pump_nozzle);
    });
    
    availableNozzles = [...new Set(availableNozzles)];
    availableNozzles.forEach(noz => {
        nozOptions += `<option value="${noz}">${noz}</option>`;
    });
    $wrapper.find('#rtt-nozzle').html(nozOptions);

    // 3.5 Populate Item Dropdown
    let populateItems = function() {
        let uniqueItems = {};
        for (let noz in nozzlePrices) {
            let item = nozzlePrices[noz].item;
            let price = nozzlePrices[noz].price;
            if(item && !uniqueItems[item]) {
                uniqueItems[item] = price;
            }
        }
        let itemOpts = '<option value="">Select Item...</option>';
        for (let item in uniqueItems) {
            itemOpts += `<option value="${item}" data-price="${uniqueItems[item]}">${item}</option>`;
        }
        $wrapper.find('#rtt-item').html(itemOpts);
    };

    // 4. Auto-Fill CSA and Item on Nozzle Change
    $wrapper.find('#rtt-nozzle').off('change').on('change', function() {
        let nozzle = $(this).val();
        if(!nozzle) {
            $wrapper.find('#rtt-csa, #rtt-csa-display').val('');
            return;
        }

        frappe.db.get_value('Pump Nozzle', nozzle, 'pump_group', function(r) {
            if(r && r.pump_group) {
                let csa = window.SHIFT_DOC.head_csa;
                let assigned = (window.SHIFT_DOC.assigned_csas || []).find(a => a.pump_group === r.pump_group);
                if(assigned && assigned.csa) csa = assigned.csa;

                if(csa) {
                    $wrapper.find('#rtt-csa').val(csa);
                    let u = window.USERS_LIST.find(user => user.name === csa);
                    $wrapper.find('#rtt-csa-display').val(u ? u.employee_name : csa);
                }
            }
        });

        if(nozzlePrices[nozzle] && nozzlePrices[nozzle].item) {
            $wrapper.find('#rtt-item').val(nozzlePrices[nozzle].item).trigger('change');
        }
    });

    // 4.5 Auto-Update Price Indicator on Item Change
    $wrapper.find('#rtt-item').off('change').on('change', function() {
        let price = parseFloat($(this).find(':selected').data('price')) || 0;
        if(price > 0) {
            $wrapper.find('#rtt-price-indicator').text(`(@ ${price}/L)`);
            let amount = parseFloat($wrapper.find('#rtt-amount').val()) || 0;
            $wrapper.find('#rtt-volume').val((amount / price).toFixed(4));
        } else {
            $wrapper.find('#rtt-price-indicator').text('');
            $wrapper.find('#rtt-volume').val('');
        }
    });

    // 5. Auto-Calculate Volume on Amount Input
    $wrapper.find('#rtt-amount').off('input').on('input', function() {
        let amount = parseFloat($(this).val()) || 0;
        let price = parseFloat($wrapper.find('#rtt-item').find(':selected').data('price')) || 0;
        if(price > 0) {
            $wrapper.find('#rtt-volume').val((amount / price).toFixed(4));
        }
    });

    // 6. Fetch and Render History
    let fetch_history = function() {
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Station Return To Tank",
                filters: { shift: window.ACTIVE_SHIFT.name },
                fields: ["name", "date", "shift", "creation", "pump_nozzle", "csa", "item", "volume_returned", "amount"],
                order_by: "name desc"
            },
            callback: function(r) {
                let html = '';
                if(r.message) {
                    r.message.forEach(row => {
                        let time_val = row.creation ? row.creation.split(" ")[1].substring(0, 5) : "";
                        let csa_name = row.csa;
                        if (window.USERS_LIST) {
                            let u = window.USERS_LIST.find(u => u.name === row.csa);
                            if(u) csa_name = u.employee_name;
                        }
                        
                        html += `
                            <tr>
                                <td style="font-family: monospace; color: #64748b;">${row.name}</td>
                                <td>${row.date || ""}</td>
                                <td><span class="badge" style="background-color: #f8fafc; color: #64748b;">${window.ACTIVE_SHIFT.shift_template || ""}</span></td>
                                <td style="color: #64748b;">${time_val}</td>
                                <td><span class="badge" style="background-color: #f1f5f9; color: #475569; font-weight: normal;">${row.pump_nozzle}</span></td>
                                <td>${csa_name}</td>
                                <td>${row.item}</td>
                                <td>${row.volume_returned} L</td>
                                <td style="font-weight: 600;">${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            </tr>
                        `;
                    });
                }
                if(html === '') html = '<tr><td colspan="9" class="text-center" style="color: #94a3b8; padding: 2rem;">No RTT recorded yet.</td></tr>';
                $wrapper.find('#list-station-rtt-saved').html(html);
            }
        });
    };
    fetch_history();

    // 7. Save RTT
    $wrapper.find('#btn-save-station-rtt').off('click').on('click', function() {
        if (is_locked) {
            frappe.show_alert({message: "Shift is closed/locked.", indicator: "red"});
            return;
        }

        let nozzle = $wrapper.find('#rtt-nozzle').val();
        let csa = $wrapper.find('#rtt-csa').val();
        let item = $wrapper.find('#rtt-item').val();
        let vol = parseFloat($wrapper.find('#rtt-volume').val()) || 0;
        let amount = parseFloat($wrapper.find('#rtt-amount').val()) || 0;
        let memo = $wrapper.find('#rtt-memo').val();

        if (!nozzle || !csa || !item || vol <= 0 || amount <= 0) {
            frappe.show_alert({message: "Please fill all required fields properly.", indicator: "red"});
            return;
        }

        let $btn = $(this);
        let orig_html = $btn.html();
        $btn.html('<span class="spinner-border spinner-border-sm"></span> Saving...').prop('disabled', true);

        frappe.call({
            method: "frappe.client.insert",
            args: {
                doc: {
                    doctype: "Station Return To Tank",
                    shift: window.ACTIVE_SHIFT.name,
                    date: window.SHIFT_DOC.shift_date || frappe.datetime.nowdate(),
                    pump_nozzle: nozzle,
                    csa: csa,
                    item: item,
                    volume_returned: vol,
                    amount: amount,
                    memo: memo
                }
            },
            callback: function(r) {
                $btn.html(orig_html).prop('disabled', false);
                if(r.message) {
                    frappe.show_alert({message: "Return To Tank saved successfully!", indicator: "green"});
                    
                    // Clear inputs
                    $wrapper.find('#rtt-nozzle').val('').trigger('change');
                    $wrapper.find('#rtt-volume').val('');
                    $wrapper.find('#rtt-memo').val('');
                    
                    // Switch to history view and refresh
                    $wrapper.find('#tab-rtt .seg-btn[data-view="history"]').click();
                    fetch_history();
                }
            }
        });
    });
}


// =========================================================
// SUPPLIER TOP-UPS MODULE
// =========================================================
function render_topups($wrapper) {
    if(!window.ACTIVE_SHIFT) return;

    let is_locked = window.ACTIVE_SHIFT.status !== 'Open';

    // 1. Setup Segmented Control
    $wrapper.find('#tab-topups .seg-btn').off('click').on('click', function() {
        let $btn = $(this);
        let targetView = $btn.attr('data-view');
        
        $wrapper.find('#tab-topups .seg-btn').removeClass('active');
        $btn.addClass('active');
        
        $wrapper.find('#tab-topups .view-pane').removeClass('active');
        $wrapper.find(`#topups-${targetView}-view`).addClass('active');
    });

    // 2. Setup CSA Dropdown
    let csaOptions = '<option value="">Select CSA...</option>';
    let availableCSAs = [window.SHIFT_DOC.head_csa];
    (window.SHIFT_DOC.assigned_csas || []).forEach(row => {
        if(row.csa) availableCSAs.push(row.csa);
    });
    
    availableCSAs = [...new Set(availableCSAs)];
    availableCSAs.forEach(csa => {
        if(!csa) return;
        let csa_name = csa;
        if(window.USERS_LIST) {
            let u = window.USERS_LIST.find(user => user.name === csa);
            if(u) csa_name = u.employee_name;
        }
        csaOptions += `<option value="${csa}">${csa_name}</option>`;
    });
    $wrapper.find('#topup-csa').html(csaOptions);

    // 2.5 Setup Mode of Payment Dropdown
    frappe.call({
        method: "frappe.client.get_list",
        args: { doctype: "Mode of Payment", fields: ["name"], limit_page_length: 100 },
        callback: function(r) {
            let mopOpts = '<option value="">Select Mode...</option>';
            if(r.message) {
                r.message.forEach(m => {
                    mopOpts += `<option value="${m.name}">${m.name}</option>`;
                });
            }
            $wrapper.find('#topup-mop').html(mopOpts);
        }
    });

    // 3. Setup Cards Dropdown
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Supplier Card",
            filters: { status: "Active" },
            fields: ["name", "card_name"]
        },
        callback: function(r) {
            let cardOpts = '<option value="">Select Supplier Card...</option>';
            if(r.message) {
                r.message.forEach(card => {
                    cardOpts += `<option value="${card.name}">${card.card_name}</option>`;
                });
            }
            $wrapper.find('#topup-card').html(cardOpts);
        }
    });

    // 4. Fetch and Render History
    let fetch_history = function() {
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Station Supplier Top Up",
                filters: { shift: window.ACTIVE_SHIFT.name },
                fields: ["name", "date", "shift", "creation", "card", "csa", "rrn_number", "mode_of_payment", "amount"],
                order_by: "name desc"
            },
            callback: function(r) {
                let html = '';
                if(r.message) {
                    r.message.forEach(row => {
                        let time_val = row.creation ? row.creation.split(" ")[1].substring(0, 5) : "";
                        let csa_name = row.csa;
                        if (window.USERS_LIST) {
                            let u = window.USERS_LIST.find(u => u.name === row.csa);
                            if(u) csa_name = u.employee_name;
                        }
                        
                        html += `
                            <tr>
                                <td style="font-family: monospace; color: #64748b;">${row.name}</td>
                                <td>${row.date || ""}</td>
                                <td><span class="badge" style="background-color: #f8fafc; color: #64748b;">${window.ACTIVE_SHIFT.shift_template || ""}</span></td>
                                <td style="color: #64748b;">${time_val}</td>
                                <td><span class="badge" style="background-color: #f1f5f9; color: #475569; font-weight: normal;">${row.card}</span></td>
                                <td>${csa_name}</td>
                                <td>${row.rrn_number}</td>
                                <td><span class="badge">${row.mode_of_payment || ""}</span></td>
                                <td style="font-weight: 600;">${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            </tr>
                        `;
                    });
                }
                if(html === '') html = '<tr><td colspan="8" class="text-center" style="color: #94a3b8; padding: 2rem;">No Top-Ups recorded yet.</td></tr>';
                $wrapper.find('#list-station-topups-saved').html(html);
            }
        });
    };
    fetch_history();

    // 5. Save Top-Up
    $wrapper.find('#btn-save-station-topup').off('click').on('click', function() {
        if (is_locked) {
            frappe.show_alert({message: "Shift is closed/locked.", indicator: "red"});
            return;
        }

        let card = $wrapper.find('#topup-card').val();
        let csa = $wrapper.find('#topup-csa').val();
        let rrn = $wrapper.find('#topup-rrn').val();
        let mop = $wrapper.find('#topup-mop').val();
        let amount = parseFloat($wrapper.find('#topup-amount').val()) || 0;

        if (!card || !csa || !rrn || !mop || amount <= 0) {
            frappe.show_alert({message: "Please fill all required fields.", indicator: "red"});
            return;
        }

        let $btn = $(this);
        let orig_html = $btn.html();
        $btn.html('<span class="spinner-border spinner-border-sm"></span> Saving...').prop('disabled', true);

        frappe.call({
            method: "frappe.client.insert",
            args: {
                doc: {
                    doctype: "Station Supplier Top Up",
                    shift: window.ACTIVE_SHIFT.name,
                    date: window.SHIFT_DOC.shift_date || frappe.datetime.nowdate(),
                    card: card,
                    csa: csa,
                    rrn_number: rrn,
                    mode_of_payment: mop,
                    amount: amount
                }
            },
            callback: function(r) {
                $btn.html(orig_html).prop('disabled', false);
                if(r.message) {
                    frappe.show_alert({message: "Top-Up saved successfully!", indicator: "green"});
                    
                    // Clear inputs
                    $wrapper.find('#topup-card').val('');
                    $wrapper.find('#topup-csa').val('');
                    $wrapper.find('#topup-rrn').val('');
                    $wrapper.find('#topup-amount').val('');
                    $wrapper.find('#topup-mop').val('');
                    
                    // Switch to history view and refresh
                    $wrapper.find('#tab-topups .seg-btn[data-view="history"]').click();
                    fetch_history();
                }
            }
        });
    });
}


// =========================================================
// STATION PURCHASES MODULE
// =========================================================
function render_purchases($wrapper) {
    if(!window.ACTIVE_SHIFT) return;

    let is_locked = window.ACTIVE_SHIFT.status !== 'Open';
    window.PURCHASE_CART = [];

    // 1. Segments
    $wrapper.find('#tab-purchases .seg-btn').off('click').on('click', function() {
        let $btn = $(this);
        let targetView = $btn.attr('data-view');
        
        $wrapper.find('#tab-purchases .seg-btn').removeClass('active');
        $btn.addClass('active');
        
        $wrapper.find('#tab-purchases .view-pane').removeClass('active');
        $wrapper.find(`#purchases-${targetView}-view`).addClass('active');
    });

    // 2. Dates
    $wrapper.find('#pur-rec-date').val(window.SHIFT_DOC.shift_date);
    $wrapper.find('#pur-doc-date').val(window.SHIFT_DOC.shift_date);
    
    // Set max date to today
    let today = frappe.datetime.nowdate();
    $wrapper.find('#pur-rec-date').attr('max', today);
    $wrapper.find('#pur-doc-date').attr('max', today);

    // 3. Supplier Dropdown
    frappe.call({
        method: "frappe.client.get_list",
        args: { doctype: "Supplier", fields: ["name"], limit_page_length: 500 },
        callback: function(r) {
            let opts = '<option value="">Select Supplier...</option>';
            if(r.message) {
                window.PURCHASE_SUPPLIERS = r.message;
                r.message.forEach(s => { opts += `<option value="${s.name}">${s.name}</option>`; });
            }
            $wrapper.find('#pur-supplier').html(opts);
        }
    });

    // 4. Item Dropdown (Datalist approach)
    frappe.call({
        method: "frappe.client.get_list",
        args: { doctype: "Item", fields: ["name", "item_name"], filters: {disabled: 0}, limit_page_length: 5000 },
        callback: function(r) {
            let opts = '';
            if(r.message) {
                window.PURCHASE_ITEMS = r.message;
                r.message.forEach(i => { opts += `<option value="${i.item_name} - ${i.name}"></option>`; });
            }
            $wrapper.find('#pur-items-list').html(opts);
        }
    });

    // 5. Target Location Dropdown
    frappe.call({
        method: "frappe.client.get_list",
        args: { doctype: "Warehouse", fields: ["name", "warehouse_name"], filters: {is_group: 0}, limit_page_length: 500 },
        callback: function(r) {
            let opts = '<option value="">Select Target...</option>';
            if(r.message) {
                r.message.forEach(w => { opts += `<option value="${w.name}">${w.warehouse_name}</option>`; });
            }
            $wrapper.find('#pur-target').html(opts);
        }
    });

    // 6. Refresh Cart Function
    let refresh_purchase_cart = function() {
        let html = '';
        let items_total = 0;
        
        window.PURCHASE_CART.forEach((row, idx) => {
            let amount = row.quantity * row.unit_cost;
            items_total += amount;
            html += `
                <tr>
                    <td>${row.item_name}</td>
                    <td>${row.target_location}</td>
                    <td>${row.quantity}</td>
                    <td>${frappe.format(row.unit_cost, {fieldtype: 'Currency'})}</td>
                    <td><strong>${frappe.format(amount, {fieldtype: 'Currency'})}</strong></td>
                    <td><button class="btn btn-xs btn-danger btn-remove-pur-cart" data-idx="${idx}">X</button></td>
                </tr>
            `;
        });
        
        if(html === '') {
            html = '<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 2rem;">Cart is empty</td></tr>';
        }
        
        $wrapper.find('#list-purchase-cart').html(html);
        
        $wrapper.find('.btn-remove-pur-cart').off('click').on('click', function() {
            let idx = parseInt($(this).attr('data-idx'));
            window.PURCHASE_CART.splice(idx, 1);
            refresh_purchase_cart();
        });
        
        // Update Totals
        let transport = parseFloat($wrapper.find('#pur-transport-charge').val()) || 0;
        let isVat = $wrapper.find('#pur-vat').is(':checked');
        
        let grand_total = items_total + transport;
        let net = grand_total;
        if(isVat) {
            net = grand_total / 1.16;
        }
        
        $wrapper.find('#pur-net').text(frappe.format(items_total, {fieldtype: 'Currency'})); // display items total here
        $wrapper.find('#pur-total').text(frappe.format(grand_total, {fieldtype: 'Currency'}));
    };

    $wrapper.find('#pur-transport-charge, #pur-vat').on('input change', refresh_purchase_cart);

    // 7. Add Item to Cart
    $wrapper.find('#btn-add-purchase-item').off('click').on('click', function() {
        let val = $wrapper.find('#pur-item-input').val();
        let match = (window.PURCHASE_ITEMS || []).find(i => `${i.item_name} - ${i.name}` === val);
        let item_code = match ? match.name : val;
        let item_name = match ? match.item_name : val;
        
        let target = $wrapper.find('#pur-target').val();
        let qty = parseFloat($wrapper.find('#pur-qty').val()) || 0;
        let cost = parseFloat($wrapper.find('#pur-cost').val()) || 0;
        
        if (!item_code || !target || qty <= 0 || cost <= 0) {
            frappe.show_alert({message: "Item, Target, Quantity, and Unit Cost are required.", indicator: "red"});
            return;
        }
        
        window.PURCHASE_CART.push({
            item: item_code,
            item_name: item_name,
            target_location: target,
            quantity: qty,
            unit_cost: cost
        });
        
        // Clear item inputs
        $wrapper.find('#pur-item-input').val('');
        $wrapper.find('#pur-qty').val('');
        $wrapper.find('#pur-cost').val('');
        
        refresh_purchase_cart();
    });

    // 8. Fetch History
    let fetch_history = function() {
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Station Purchase",
                filters: { shift: window.ACTIVE_SHIFT.name },
                fields: ["name", "receiving_date", "supplier", "tax_invoice_number", "document_invoice_number", "grand_total"],
                order_by: "name desc"
            },
            callback: function(r) {
                let html = '';
                if(r.message) {
                    r.message.forEach(row => {
                        html += `
                            <tr>
                                <td style="font-family: monospace; color: #64748b;">${row.name}</td>
                                <td>${row.receiving_date}</td>
                                <td>${row.supplier}</td>
                                <td><span class="badge" style="background: #f1f5f9;">${row.tax_invoice_number || "N/A"}</span></td>
                                <td><span class="badge" style="background: #f1f5f9;">${row.document_invoice_number || "N/A"}</span></td>
                                <td style="font-weight: 600;">${frappe.format(row.grand_total || 0, {fieldtype: 'Currency'})}</td>
                            </tr>
                        `;
                    });
                }
                if(html === '') html = '<tr><td colspan="6" class="text-center" style="color: #94a3b8; padding: 2rem;">No purchases recorded yet.</td></tr>';
                $wrapper.find('#list-station-purchases-saved').html(html);
            }
        });
    };
    fetch_history();

    // 9. Save Entire Purchase
    $wrapper.find('#btn-save-purchase').off('click').on('click', function() {
        if (is_locked) {
            frappe.show_alert({message: "Shift is closed.", indicator: "red"});
            return;
        }
        
        if (window.PURCHASE_CART.length === 0) {
            frappe.show_alert({message: "Cart is empty. Add items first.", indicator: "red"});
            return;
        }

        let supplier = $wrapper.find('#pur-supplier').val();
        let doc_invoice = $wrapper.find('#pur-doc-invoice').val();
        let kra_invoice = $wrapper.find('#pur-kra-invoice').val();
        let rec_date = $wrapper.find('#pur-rec-date').val();
        let doc_date = $wrapper.find('#pur-doc-date').val();
        let transport = parseFloat($wrapper.find('#pur-transport-charge').val()) || 0;
        let isVat = $wrapper.find('#pur-vat').is(':checked') ? 1 : 0;

        if (!supplier || !doc_invoice || !rec_date || !doc_date) {
            frappe.show_alert({message: "Supplier, Document Invoice No, Receiving Date and Document Date are required.", indicator: "red"});
            return;
        }

        let pendingPurchase = {
            doctype: "Station Purchase",
            shift: window.ACTIVE_SHIFT.name,
            receiving_date: rec_date,
            document_date: doc_date,
            supplier: supplier,
            document_invoice_number: doc_invoice,
            tax_invoice_number: kra_invoice,
            custom_kra_invoice_number: kra_invoice,
            transport_charge: transport,
            vat_inclusive: isVat,
            items: window.PURCHASE_CART.map(item => {
                return {
                    item: item.item,
                    target_location: item.target_location,
                    quantity: item.quantity,
                    unit_cost: item.unit_cost
                };
            })
        };

        let $btn = $(this);
        let orig_html = $btn.html();
        $btn.html('<span class="spinner-border spinner-border-sm"></span> Saving...').prop('disabled', true);

        frappe.call({
            method: "frappe.client.insert",
            args: { doc: pendingPurchase },
            callback: function(r) {
                $btn.html(orig_html).prop('disabled', false);
                
                if(r.message) {
                    frappe.show_alert({message: "Purchase recorded successfully!", indicator: "green"});
                    
                    // Clear form
                    $wrapper.find('#pur-supplier').val('').trigger('change');
                    $wrapper.find('#pur-doc-invoice').val('');
                    $wrapper.find('#pur-kra-invoice').val('');
                    $wrapper.find('#pur-transport-charge').val('');
                    window.PURCHASE_CART = [];
                    refresh_purchase_cart();
                    
                    // Switch to history view and refresh
                    $wrapper.find('#tab-purchases .seg-btn[data-view="history"]').click();
                    fetch_history();
                }
            },
            error: function() {
                $btn.html(orig_html).prop('disabled', false);
            }
        });
    });
}


// ==========================================
// PETTY CASH LOGIC
// ==========================================
function render_petty_cash(wrapper) {
    const $wrapper = $(wrapper);
    
    // Setup Segmented Control
    $wrapper.find('#tab-petty-cash .seg-btn').off('click').on('click', function() {
        $wrapper.find('#tab-petty-cash .seg-btn').removeClass('active');
        $(this).addClass('active');
        
        const view = $(this).data('view');
        $wrapper.find('#tab-petty-cash .view-pane').removeClass('active');
        $wrapper.find('#pc-' + view + '-view').addClass('active');
    });
    
    // Load active accounts
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Station Petty Cash Account",
            filters: { status: "Active" },
            fields: ["name", "current_balance"]
        },
        callback: function(r) {
            let $select = $wrapper.find('#pc-account');
            $select.empty().append('<option value="">Select Account...</option>');
            if(r.message) {
                window.PETTY_CASH_ACCOUNTS = r.message;
                r.message.forEach(acc => {
                    $select.append(`<option value="${acc.name}">${acc.name}</option>`);
                });
            }
        }
    });
    
    // On Account Change
    $wrapper.find('#pc-account').off('change').on('change', function() {
        let acc_name = $(this).val();
        let acc = (window.PETTY_CASH_ACCOUNTS || []).find(a => a.name === acc_name);
        if (acc) {
            $wrapper.find('#pc-balance').val(format_currency(acc.current_balance));
        } else {
            $wrapper.find('#pc-balance').val('');
        }
    });
    
    // Load Categories
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Expense Claim Type",
            fields: ["name"],
            limit_page_length: 100
        },
        callback: function(r) {
            let $select = $wrapper.find('#pc-category');
            $select.empty().append('<option value="">Select Category...</option>');
            if(r.message) {
                r.message.forEach(cat => {
                    $select.append(`<option value="${cat.name}">${cat.name}</option>`);
                });
            }
        }
    });

    // Save logic
    $wrapper.find('#btn-save-petty-cash').off('click').on('click', function() {
        if(!window.ACTIVE_SHIFT) {
            frappe.msgprint("No active shift.");
            return;
        }
        
        let account = $wrapper.find('#pc-account').val();
        let category = $wrapper.find('#pc-category').val();
        let payee = $wrapper.find('#pc-payee').val();
        let amount = parseFloat($wrapper.find('#pc-amount').val());
        let memo = $wrapper.find('#pc-memo').val();
        
        if(!account || !category || !payee || isNaN(amount) || amount <= 0 || !memo) {
            frappe.msgprint("Please fill all mandatory fields with valid values.");
            return;
        }
        
        let $btn = $(this);
        $btn.prop('disabled', true);
        $btn.find('.spinner').removeClass('hidden');
        
        frappe.call({
            method: "frappe.client.insert",
            args: {
                doc: {
                    doctype: "Station Petty Cash Entry",
                    shift: window.ACTIVE_SHIFT.name,
                    date: frappe.datetime.get_today(),
                    petty_cash_account: account,
                    category: category,
                    payee: payee,
                    amount: amount,
                    memo: memo,
                    csa: frappe.session.user
                }
            },
            callback: function(r) {
                $btn.prop('disabled', false);
                $btn.find('.spinner').addClass('hidden');
                
                if(!r.exc) {
                    frappe.show_alert({message: "Petty Cash Entry saved!", indicator: "green"});
                    // Reset form
                    $wrapper.find('#pc-account').val('').trigger('change');
                    $wrapper.find('#pc-category').val('');
                    $wrapper.find('#pc-payee').val('');
                    $wrapper.find('#pc-amount').val('');
                    $wrapper.find('#pc-memo').val('');
                    
                    // Refresh History
                    load_petty_cash_history($wrapper);
                    
                    // Switch back to history view
                    $wrapper.find('#tab-petty-cash .seg-btn[data-view="history"]').click();
                }
            }
        });
    });

    load_petty_cash_history($wrapper);
}

function load_petty_cash_history($wrapper) {
    if(!window.ACTIVE_SHIFT) return;
    
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Station Petty Cash Entry",
            filters: { shift: window.ACTIVE_SHIFT.name },
            fields: ["name", "date", "creation", "petty_cash_account", "category", "payee", "amount"],
            order_by: "creation desc"
        },
        callback: function(r) {
            let $tbody = $wrapper.find('#list-petty-cash-saved');
            $tbody.empty();
            
            if(r.message && r.message.length > 0) {
                r.message.forEach(row => {
                    let timeStr = frappe.datetime.str_to_user(row.creation).split(' ')[1] || "";
                    let html = `
                        <tr>
                            <td><b>${row.name}</b></td>
                            <td>${frappe.datetime.str_to_user(row.date)}</td>
                            <td>${timeStr}</td>
                            <td>${row.petty_cash_account}</td>
                            <td>${row.category}</td>
                            <td>${row.payee}</td>
                            <td class="text-right"><b>${format_currency(row.amount)}</b></td>
                        </tr>
                    `;
                    $tbody.append(html);
                });
            } else {
                $tbody.append('<tr><td colspan="7" class="text-center text-muted">No petty cash entries for this shift yet.</td></tr>');
            }
        }
    });
}



// ==========================================
// CASH TRANSFERS LOGIC
// ==========================================
function render_cash_transfers(wrapper) {
    const $wrapper = $(wrapper);
    
    // Set default date
    $wrapper.find('#ct-date').val(frappe.datetime.get_today());
    
    // Setup Segmented Control
    $wrapper.find('#tab-cash-transfers .seg-btn').off('click').on('click', function() {
        $wrapper.find('#tab-cash-transfers .seg-btn').removeClass('active');
        $(this).addClass('active');
        
        const view = $(this).data('view');
        $wrapper.find('#tab-cash-transfers .view-pane').removeClass('active');
        $wrapper.find('#ct-' + view + '-view').addClass('active');
    });
    
    // Load ERPNext Accounts
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Account",
            filters: { is_group: 0, account_type: ["in", ["Bank", "Cash"]] },
            fields: ["name"],
            limit_page_length: 500
        },
        callback: function(r) {
            let $select = $wrapper.find('#ct-account');
            $select.empty().append('<option value="">Select Destination Account...</option>');
            if(r.message) {
                r.message.forEach(acc => {
                    $select.append(`<option value="${acc.name}">${acc.name}</option>`);
                });
            }
        }
    });

    // Save logic
    $wrapper.find('#btn-save-cash-transfer').off('click').on('click', function() {
        let date = $wrapper.find('#ct-date').val();
        let ref = $wrapper.find('#ct-ref').val();
        let account = $wrapper.find('#ct-account').val();
        let amount = parseFloat($wrapper.find('#ct-amount').val());
        
        if(!date || !ref || !account || isNaN(amount) || amount <= 0) {
            frappe.msgprint("Please fill all mandatory fields with valid values.");
            return;
        }
        
        let $btn = $(this);
        $btn.prop('disabled', true);
        $btn.find('.spinner').removeClass('hidden');
        
        frappe.call({
            method: "frappe.client.insert",
            args: {
                doc: {
                    doctype: "Station Cash Transfer",
                    date: date,
                    transaction_number: ref,
                    destination_account: account,
                    amount: amount,
                    entered_by: frappe.session.user
                }
            },
            callback: function(r) {
                $btn.prop('disabled', false);
                $btn.find('.spinner').addClass('hidden');
                
                if(!r.exc) {
                    frappe.show_alert({message: "Cash Transfer recorded!", indicator: "green"});
                    // Reset form
                    $wrapper.find('#ct-date').val(frappe.datetime.get_today());
                    $wrapper.find('#ct-ref').val('');
                    $wrapper.find('#ct-account').val('');
                    $wrapper.find('#ct-amount').val('');
                    
                    // Refresh History
                    load_cash_transfer_history($wrapper);
                    
                    // Switch back to history view
                    $wrapper.find('#tab-cash-transfers .seg-btn[data-view="history"]').click();
                }
            }
        });
    });

    load_cash_transfer_history($wrapper);
}

function load_cash_transfer_history($wrapper) {
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Station Cash Transfer",
            fields: ["name", "date", "transaction_number", "destination_account", "amount", "entered_by"],
            order_by: "creation desc",
            limit_page_length: 100
        },
        callback: function(r) {
            let $tbody = $wrapper.find('#list-cash-transfers-saved');
            $tbody.empty();
            
            if(r.message && r.message.length > 0) {
                r.message.forEach(row => {
                    let html = `
                        <tr>
                            <td><b>${row.name}</b></td>
                            <td>${frappe.datetime.str_to_user(row.date)}</td>
                            <td>${row.transaction_number}</td>
                            <td>${row.destination_account}</td>
                            <td>${row.entered_by || ''}</td>
                            <td class="text-right"><b>${format_currency(row.amount)}</b></td>
                        </tr>
                    `;
                    $tbody.append(html);
                });
            } else {
                $tbody.append('<tr><td colspan="6" class="text-center text-muted">No external cash transfers recorded yet.</td></tr>');
            }
        }
    });
}



// ==========================================
// RECONCILIATION LOGIC
// ==========================================
function render_reconcile(wrapper) {
    const $wrapper = $(wrapper);
    
    // We need to fetch all components asynchronously and then calculate
    window.RECONCILE_DATA = {
        fuel_sales: 0,
        drystock_sales: 0,
        expenses: 0,
        fleet_drops: 0
    };
    
    if(!window.ACTIVE_SHIFT) return;
    let shift_name = window.ACTIVE_SHIFT.name;
    
    // 1. Calculate Fuel Sales from loaded Shift Doc
    let fuel = 0;
    if(window.SHIFT_DOC && window.SHIFT_DOC.pump_meter_readings) {
        window.SHIFT_DOC.pump_meter_readings.forEach(x => fuel += (x.amount || 0));
    }
    window.RECONCILE_DATA.fuel_sales = fuel;
    update_reconcile_ui($wrapper);
    
    // 2. Calculate Dry Stock Sales from loaded Shift Doc
    let dry = 0;
    if(window.SHIFT_DOC && window.SHIFT_DOC.inventory_sales) {
        window.SHIFT_DOC.inventory_sales.forEach(x => dry += (x.amount || 0));
    }
    window.RECONCILE_DATA.drystock_sales = dry;
    update_reconcile_ui($wrapper);
    
    // 3. Fetch Expenses & Petty Cash (Station Expense + Station Petty Cash Entry)
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Station Expense",
            filters: { shift: shift_name },
            fields: ["amount"]
        },
        callback: function(r) {
            let exp = 0;
            if(r.message) {
                r.message.forEach(x => exp += (x.amount || 0));
            }
            
            // Also fetch petty cash
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Station Petty Cash Entry",
                    filters: { shift: shift_name },
                    fields: ["amount"]
                },
                callback: function(r2) {
                    if(r2.message) {
                        r2.message.forEach(x => exp += (x.amount || 0));
                    }
                    window.RECONCILE_DATA.expenses = exp;
                    update_reconcile_ui($wrapper);
                }
            });
        }
    });
    
    // 4. Fetch Fleet Card Drops
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Fleet Card Shift Summary",
            filters: { shift: shift_name },
            fields: ["total_csa_drops"]
        },
        callback: function(r) {
            let fleet = 0;
            if(r.message) {
                r.message.forEach(x => fleet += (x.total_csa_drops || 0));
            }
            window.RECONCILE_DATA.fleet_drops = fleet;
            update_reconcile_ui($wrapper);
        }
    });
    
    // Listen to actual cash inputs
    $wrapper.find('#actual-cash-input, #actual-drystock-cash-input').off('input').on('input', function() {
        update_reconcile_ui($wrapper);
    });
}

function update_reconcile_ui($wrapper) {
    let d = window.RECONCILE_DATA;
    if(!d) return;
    
    $wrapper.find('#rec-fuel-sales').text(format_currency(d.fuel_sales));
    $wrapper.find('#rec-drystock-sales').text(format_currency(d.drystock_sales));
    $wrapper.find('#rec-expenses').text(format_currency(d.expenses));
    $wrapper.find('#rec-fleet-drops').text(format_currency(d.fleet_drops));
    
    // Net Expected = Fuel + Dry - Expenses - FleetDrops
    let net = d.fuel_sales + d.drystock_sales - d.expenses - d.fleet_drops;
    $wrapper.find('#rec-net-expected').text(format_currency(net));
    
    // Actual Cash
    let actual_fuel = parseFloat($wrapper.find('#actual-cash-input').val()) || 0;
    let actual_dry = parseFloat($wrapper.find('#actual-drystock-cash-input').val()) || 0;
    let total_actual = actual_fuel + actual_dry;
    
    let variance = total_actual - net;
    let $var = $wrapper.find('#rec-variance');
    $var.text(format_currency(variance));
    if (variance < 0) {
        $var.css('color', '#dc2626');
    } else {
        $var.css('color', '#16a34a');
    }
}


function render_station_cards($wrapper) {
    if(!window.ACTIVE_SHIFT) return;

    let is_locked = window.ACTIVE_SHIFT.status !== 'Open';

    // 1. Setup Segmented Control
    $wrapper.find('#tab-station-cards .seg-btn').off('click').on('click', function() {
        let $btn = $(this);
        let targetView = $btn.attr('data-view');
        
        $wrapper.find('#tab-station-cards .seg-btn').removeClass('active');
        $btn.addClass('active');
        
        $wrapper.find('#tab-station-cards .view-pane').removeClass('active');
        $wrapper.find(`#sc-${targetView}-view`).addClass('active');
    });

    // 2. Populate CSAs
    let csaOptions = '<option value="">Select CSA...</option>';
    let allowed_csas = [];
    if(window.SHIFT_DOC.head_csa) allowed_csas.push(window.SHIFT_DOC.head_csa);
    (window.SHIFT_DOC.assigned_csas || []).forEach(row => {
        if(row.csa) allowed_csas.push(row.csa);
    });
    
    // Remove duplicates
    allowed_csas = [...new Set(allowed_csas)];
    
    allowed_csas.forEach(csa => {
        let u = window.USERS_LIST.find(u => u.name === csa);
        let name = u ? (u.employee_name || u.full_name) : csa;
        csaOptions += `<option value="${csa}">${name}</option>`;
    });
    $wrapper.find('#sc-csa').html(csaOptions);

    // 3. Populate Cards (from Station Card Type DocType)
    frappe.call({
        method: "frappe.client.get_list",
        args: { doctype: "Station Card Type", fields: ["name", "card_name", "status"], limit_page_length: 500, filters: { status: "Active" } },
        callback: function(r) {
            if(r.message) {
                let cardOpts = '<option value="">Select Card...</option>';
                let filterOpts = '<option value="">All Cards</option>';
                r.message.forEach(c => {
                    cardOpts += `<option value="${c.name}">${c.card_name}</option>`;
                    filterOpts += `<option value="${c.name}">${c.card_name}</option>`;
                });
                $wrapper.find('#sc-card').html(cardOpts);
                $wrapper.find('#sc-filter-card').html(filterOpts);
            }
        }
    });

    // 4. Fetch and Render History
    let fetch_history = function() {
        let filters = { shift: window.ACTIVE_SHIFT.name };
        let date_from = $wrapper.find('#sc-filter-date-from').val();
        let date_to = $wrapper.find('#sc-filter-date-to').val();
        let card_filter = $wrapper.find('#sc-filter-card').val();
        
        if (date_from && date_to) {
            filters.date = ["between", [date_from, date_to]];
        } else if (date_from) {
            filters.date = [">=", date_from];
        } else if (date_to) {
            filters.date = ["<=", date_to];
        }
        
        if (card_filter) filters.card = card_filter;

        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Station Cards",
                filters: filters,
                fields: ["name", "date", "shift", "creation", "card", "csa", "receipt_no", "amount", "memo"],
                order_by: "name desc"
            },
            callback: function(r) {
                let html = '';
                if(r.message) {
                    r.message.forEach(row => {
                        let time_val = row.creation ? row.creation.split(" ")[1].substring(0, 5) : "";
                        let csa_name = row.csa;
                        if (window.USERS_LIST) {
                            let u = window.USERS_LIST.find(u => u.name === row.csa);
                            if (u) csa_name = u.employee_name || u.full_name;
                        }
                        
                        html += `
                            <tr data-name="${row.name}" data-card="${row.card}" data-csa="${row.csa}" data-receipt="${row.receipt_no}" data-amount="${row.amount}" data-memo="${row.memo || ''}">
                                <td>${row.name}</td>
                                <td>${frappe.datetime.str_to_user(row.date)} (${window.ACTIVE_SHIFT.shift_template || ""})</td>
                                <td><a href="/app/station-cards/${row.name}">${row.receipt_no}</a></td>
                                <td>${row.card}</td>
                                <td>${csa_name}</td>
                                <td style="font-weight: 600;">${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                                <td>
                                    <button class="btn btn-xs btn-secondary btn-edit-sc">Edit</button>
                                    <button class="btn btn-xs btn-danger btn-delete-sc" style="margin-left: 5px;">Delete</button>
                                </td>
                            </tr>
                        `;
                    });
                }
                if(html === '') html = '<tr><td colspan="7" class="text-center" style="color: #94a3b8; padding: 2rem;">No card payments recorded yet.</td></tr>';
                $wrapper.find('#list-station-cards-saved').html(html);

                // Action listeners
                $wrapper.find('.btn-delete-sc').click(function() {
                    let name = $(this).closest('tr').data('name');
                    frappe.confirm('Are you sure you want to delete this record?', () => {
                        frappe.call({
                            method: "frappe.client.delete",
                            args: { doctype: "Station Cards", name: name },
                            callback: function(res) {
                                if(!res.exc) fetch_history();
                            }
                        });
                    });
                });

                $wrapper.find('.btn-edit-sc').click(function() {
                    let $tr = $(this).closest('tr');
                    $wrapper.find('#sc-card').val($tr.data('card'));
                    $wrapper.find('#sc-csa').val($tr.data('csa'));
                    $wrapper.find('#sc-receipt-no').val($tr.data('receipt'));
                    $wrapper.find('#sc-amount').val($tr.data('amount'));
                    $wrapper.find('#sc-memo').val($tr.data('memo'));
                    $wrapper.data('editing-sc', $tr.data('name')); 
                    
                    // Switch to entry view
                    $wrapper.find('#tab-station-cards .seg-btn[data-view="entry"]').click();
                    $wrapper.find('#sc-entry-view .card-header-flex h3').text('Edit Station Card Payment');
                    $wrapper.find('#btn-save-station-card').text('Update Payment');
                });
            }
        });
    };
    fetch_history();

    $wrapper.find('#sc-filter-date-from, #sc-filter-date-to, #sc-filter-card').on('change', fetch_history);

    // 5. Save Station Card Payment
    $wrapper.find('#btn-save-station-card').off('click').on('click', function() {
        if (is_locked) {
            frappe.show_alert({message: "Shift is closed/locked.", indicator: "red"});
            return;
        }

        let card = $wrapper.find('#sc-card').val();
        let csa = $wrapper.find('#sc-csa').val();
        let receipt_no = $wrapper.find('#sc-receipt-no').val();
        let amount = parseFloat($wrapper.find('#sc-amount').val()) || 0;
        let memo = $wrapper.find('#sc-memo').val();

        if (!card || !csa || !receipt_no || amount <= 0) {
            frappe.show_alert({message: "Card, CSA, Receipt No, and valid Amount are required.", indicator: "red"});
            return;
        }

        let $btn = $(this);
        let orig_html = $btn.html();
        $btn.html('<span class="spinner-border spinner-border-sm"></span> Saving...').prop('disabled', true);

        let edit_id = $wrapper.data('editing-sc');
        let method = edit_id ? "frappe.client.set_value" : "frappe.client.insert";
        let args = edit_id ? {
            doctype: "Station Cards",
            name: edit_id,
            fieldname: {
                card: card,
                csa: csa,
                receipt_no: receipt_no,
                amount: amount,
                memo: memo
            }
        } : {
            doc: {
                doctype: "Station Cards",
                shift: window.ACTIVE_SHIFT.name,
                date: window.SHIFT_DOC.shift_date || frappe.datetime.nowdate(),
                card: card,
                csa: csa,
                receipt_no: receipt_no,
                amount: amount,
                memo: memo
            }
        };

        frappe.call({
            method: method,
            args: args,
            callback: function(r) {
                $btn.html(orig_html).prop('disabled', false);
                if(r.message) {
                    frappe.show_alert({message: "Station Card Payment saved successfully!", indicator: "green"});
                    
                    // Clear inputs and reset state
                    $wrapper.data('editing-sc', null);
                    $wrapper.find('#sc-entry-view .card-header-flex h3').text('New Station Card Payment');
                    $wrapper.find('#btn-save-station-card').text('Save Payment');
                    $wrapper.find('#sc-card').val('');
                    $wrapper.find('#sc-receipt-no').val('');
                    $wrapper.find('#sc-amount').val('');
                    $wrapper.find('#sc-memo').val('');
                    
                    // Switch to history view and refresh
                    $wrapper.find('#tab-station-cards .seg-btn[data-view="history"]').click();
                    fetch_history();
                }
            }
        });
    });
}

// =========================================================
// STATION EXPENSES MODULE
// =========================================================

// =========================================================
// GREASING MODULE
// =========================================================
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
    let csa_count = 0;
    (window.SHIFT_DOC.assigned_csas || []).forEach(csa_row => {
        if(csa_row.csa) {
            csa_count++;
            let csa_name = csa_row.csa;
            if(window.USERS_LIST) {
                let u = window.USERS_LIST.find(user => user.name === csa_row.csa);
                if(u) csa_name = u.employee_name || u.full_name;
            }
            csa_html += `<option value="${csa_row.csa}">${csa_name}</option>`;
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
        },
        error: function(err) {
            console.error("Error loading Grease Vehicle Types: ", err);
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

        let doc = window.SHIFT_DOC;
        doc.grease_opening_balance = op;
        doc.grease_top_up = top;
        doc.grease_closing_balance = cl;
        
        frappe.call({
            method: "frappe.client.save",
            args: {
                doc: doc
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
