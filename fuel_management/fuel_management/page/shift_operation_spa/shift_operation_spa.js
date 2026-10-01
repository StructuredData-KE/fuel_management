try {
    window.ACTIVE_SHIFT = null;
    window.USERS_LIST = [];
    window.PUMP_GROUPS_LIST = [];
    window.SHIFT_TEMPLATES = [];
    
    window.STATION_SETTINGS = {};
    
    console.log("HELLO SPA JS LOADED!");
    
    function sort_pump_groups(list) {
        if (!list || !list.length) return [];
        return list.slice().sort((a, b) => {
            let nameA = (typeof a === 'string' ? a : (a.name || "")).trim();
            let nameB = (typeof b === 'string' ? b : (b.name || "")).trim();
            
            // Extract pump number if it's "Pump X" or "PUMP X"
            let matchA = nameA.match(/^pump\s*(\d+)/i);
            let matchB = nameB.match(/^pump\s*(\d+)/i);
            
            // If both are numbered pumps, sort numerically (Pump 1, Pump 2, Pump 3...)
            if (matchA && matchB) {
                return parseInt(matchA[1], 10) - parseInt(matchB[1], 10);
            }
            // If only A is a numbered pump, A comes first (Pump 1 before Lubes)
            if (matchA && !matchB) {
                return -1;
            }
            // If only B is a numbered pump, B comes first
            if (!matchA && matchB) {
                return 1;
            }
            
            // If one is lubes, put lubes towards the end
            let isLubeA = /lube/i.test(nameA);
            let isLubeB = /lube/i.test(nameB);
            if (isLubeA && !isLubeB) return 1;
            if (!isLubeA && isLubeB) return -1;
            
            // Default natural alphabetical comparison
            return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
        });
    }
    
    // Find the wrapper dynamically regardless of name!
    var page_keys = Object.keys(frappe.pages);
    var my_page_name = 'shift_operation_spa';
    if (!frappe.pages[my_page_name]) {
        console.warn("frappe.pages['shift_operation_spa'] is UNDEFINED! Available pages:", page_keys);
        // use the most recently added page
        my_page_name = page_keys[page_keys.length - 1];
    }
    
    frappe.pages[my_page_name].on_page_load = function(wrapper) {
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
    try {
        $(page.main).html(frappe.render_template("shift_operation_spa", {}));
    } catch (e) {
        frappe.msgprint("Template Render Error: " + e.message);
        console.error("TEMPLATE RENDER ERROR:", e);
    }
    
    try {
        // UI Setup
        setup_tabs(wrapper);
        load_dropdowns(wrapper);
        setup_actions(wrapper);
        if (window.render_homepage) {
            window.render_homepage($(wrapper));
        }
    } catch(e) {
        frappe.msgprint("Setup Error: " + e.message);
        console.error("SETUP ERROR:", e);
    }
    
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
            
            // Initialize Debtors Module
            if (typeof window.init_debtors_module === 'function') {
                window.init_debtors_module(wrapper);
            }
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
    frappe.call({
        method: "fuel_management.fuel_management.api.get_active_shift",
        args: {
            station: (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) || (frappe.defaults.get_user_default("station") || null)
        },
        callback: function(r) {
            if(r.message) {
                window.ACTIVE_SHIFT = r.message;
                lock_ui_for_active_shift($wrapper);
            } else {
                window.ACTIVE_SHIFT = null;
                lock_ui_for_no_shift($wrapper);
            }
        }
    });
}

function lock_ui_for_no_shift($wrapper) {
    $wrapper.find('.nav-item:not([data-target="tab-start"]):not([data-target="tab-home"])').css({
        'opacity': '0.5',
        'pointer-events': 'none'
    });
    
    // Update Top Navbar
    $wrapper.find('#active-shift-badge').text('No Active Shift');
    $wrapper.find('#active-shift-badge').css('background', 'rgba(255,255,255,0.15)');
    $wrapper.find('#user-greeting-desktop').text(`Welcome back ${frappe.session.user_fullname || frappe.session.user || "User"}`);
    let hour = new Date().getHours();
    let time_greeting = "Good morning";
    if (hour >= 12 && hour < 17) time_greeting = "Good afternoon";
    else if (hour >= 17) time_greeting = "Good evening";
    let fname = frappe.session.user_fullname || frappe.session.user || "User";
    $wrapper.find('#home-greeting').text(`${time_greeting}, ${fname}`);
    
    // Switch to Home Shift tab
    $wrapper.find('.nav-item[data-target="tab-home"]').click();
}

function lock_ui_for_active_shift($wrapper) {
    $wrapper.find('.nav-item').css({
        'opacity': '1',
        'pointer-events': 'auto'
    });
    
    // Update Top Navbar
    let bShiftName = window.ACTIVE_SHIFT.shift_template ? window.ACTIVE_SHIFT.shift_template : "Shift";
    let formattedDate = window.ACTIVE_SHIFT.shift_date ? frappe.datetime.str_to_user(window.ACTIVE_SHIFT.shift_date) : "";
    $wrapper.find('#active-shift-badge').text(`Active Shift: ${formattedDate} (${bShiftName})`);
    $wrapper.find('#active-shift-badge').css('background', '#16a34a'); // Green badge for active
    $wrapper.find('#user-greeting-desktop').text(`Welcome back ${frappe.session.user_fullname || frappe.session.user || "User"}`);
    let hour = new Date().getHours();
    let time_greeting = "Good morning";
    if (hour >= 12 && hour < 17) time_greeting = "Good afternoon";
    else if (hour >= 17) time_greeting = "Good evening";
    let fname = frappe.session.user_fullname || frappe.session.user || "User";
    $wrapper.find('#home-greeting').text(`${time_greeting}, ${fname}`);
    
    // Switch to Home tab automatically
    $wrapper.find('.nav-item[data-target="tab-home"]').click();
    
    // Pre-fill Start Shift form just for viewing
    $wrapper.find('#input-shift-date').val(window.ACTIVE_SHIFT.shift_date).prop('disabled', true);
    $wrapper.find('#select-shift-template').val(window.ACTIVE_SHIFT.shift_template).prop('disabled', true);
    $wrapper.find('#select-station').val(window.ACTIVE_SHIFT.station).prop('disabled', true);
    $wrapper.find('#select-head-csa').val(window.ACTIVE_SHIFT.head_csa).prop('disabled', true);
    $wrapper.find('#btn-start-shift').hide();
    
    if (window.ACTIVE_SHIFT.status === 'Closed') {
        $wrapper.find('#btn-close-shift').hide();
        $wrapper.find('#btn-email-shift-report').show();
        $wrapper.find('#btn-update-assignments').hide();
        $wrapper.find('#csa-assignment-body .csa-select').prop('disabled', true);
    } else {
        $wrapper.find('#btn-close-shift').show();
        $wrapper.find('#btn-email-shift-report').hide();
        $wrapper.find('#btn-update-assignments').removeClass('hidden').show();
    }
    
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

                // Prefill CSA assignments
                if(window.SHIFT_DOC && window.SHIFT_DOC.assigned_csas) {
                    window.SHIFT_DOC.assigned_csas.forEach(a => {
                        let row = $wrapper.find(`.assignment-row[data-pg="${a.pump_group}"]`);
                        if(row.length) {
                            row.find('.csa-select').val(a.csa);
                        }
                    });
                }
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
                  window.PUMP_NOZZLES = r1.message;
                r1.message.forEach(n => { nozzle_to_pg[n.name] = n.pump_group || "Ungrouped"; });
            }
            
            // Fetch Prices
            frappe.call({
                method: "fuel_management.fuel_management.doctype.shift.shift.get_nozzle_prices",
                args: { station: window.SHIFT_DOC.station, shift_date: window.SHIFT_DOC.shift_date },
                callback: function(r2) {
                    let nozzle_prices = r2.message || {};
                    let grouped = {};
                  window.NOZZLE_ITEMS = {};
                    window.FUEL_PRICES = {};
                    Object.keys(nozzle_prices).forEach(noz => {
                        window.NOZZLE_ITEMS[noz] = nozzle_prices[noz].item;
                        window.FUEL_PRICES[nozzle_prices[noz].item] = nozzle_prices[noz].price;
                    });
                    (window.SHIFT_DOC.pump_meter_readings || []).forEach(row => {
                        let pg = nozzle_to_pg[row.pump_nozzle] || "Ungrouped";
                        if(!grouped[pg]) grouped[pg] = [];
                        grouped[pg].push(row);
                    });
                    
                    window.METER_GROUPS = grouped;
                    window.NOZZLE_PRICES = nozzle_prices;
                    
                    // Render Selector
                    let pg_options = '<option value="">Select a Pump Group...</option>';
                    let sorted_pg_names = sort_pump_groups(Object.keys(grouped).map(name => ({name: name}))).map(x => x.name);
                    sorted_pg_names.forEach(pg => {
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
                        rows.sort((a, b) => {
                            let a_nozzle = a.pump_nozzle || "";
                            let b_nozzle = b.pump_nozzle || "";
                            let a_is_pms = a_nozzle.toUpperCase().includes("PMS");
                            let b_is_pms = b_nozzle.toUpperCase().includes("PMS");
                            if (a_is_pms && !b_is_pms) return -1;
                            if (!a_is_pms && b_is_pms) return 1;
                            return a_nozzle.localeCompare(b_nozzle, undefined, {numeric: true, sensitivity: 'base'});
                        });
                        
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
                        let csa_text = csa_name ? `<div style="font-size: 0.875rem; color: #e2e8f0;">Assigned CSA: <strong style="font-weight: 700; color: #ffffff;">${csa_name}</strong></div>` : "";
                        
                        let html = `
                            <div class="pump-group-card" style="margin-bottom: 0;">
                                <div class="pump-group-header" style="padding-bottom: 1rem; margin-bottom: 1rem; border-bottom: 2px solid #1e3a8a;">
                                    <div style="font-size: 1.25rem; font-weight: 700; color: #ffffff;">${pg}</div>
                                    ${csa_text}
                                </div>
                                <div class="pump-nozzles-list">
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
                                <div class="meter-row" data-name="${row.name}" data-fuel-type="${fuel_type}" style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 1rem; padding: 1rem 0; border-bottom: 1px solid #f1f5f9; align-items: center; transition: background-color 0.2s;">
                                    <div style="grid-column: span 2 / span 2;">
                                        <span style="display: block; font-size: 1.125rem; font-weight: 700; color: #1e293b; margin-bottom: 0.25rem;">${row.pump_nozzle}</span>
                                        <span style="display: inline-block; background-color: #172554; color: #fbbf24; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.625rem; border-radius: 0.375rem; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">${fuel_type} @ ${price.toFixed(2)}</span>
                                    </div>
                                    
                                    <div style="grid-column: span 4 / span 4;">
                                        <span style="display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 0.5rem;">ELECTRONIC</span>
                                        <div style="font-size: 0.875rem; margin-bottom: 0.5rem;">Opening: <span class="read-only-cell" style="background-color: #f1f5f9; border: 1px solid #e2e8f0; color: #475569; font-family: monospace; padding: 0.25rem 0.5rem; border-radius: 0.25rem;">${row.opening_electronic_meter}</span></div>
                                        <input type="number" step="0.01" class="spa-input meter-closing-elec" data-opening="${row.opening_electronic_meter}" data-price="${price}" value="${row.closing_electronic_meter || ''}" placeholder="Closing Elec" style="width: 100%; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 0.5rem; padding: 0.5rem 0.75rem; color: #0f172a; font-family: monospace; outline: none; transition: all 0.2s;" ${disable_attr}>
                                        <div style="font-size: 0.75rem; font-weight: 500; color: #64748b; margin-top: 0.25rem;">Sales: <span class="meter-sales-elec" style="font-weight: 700;">0.00</span></div>
                                    </div>
                                    
                                    <div style="grid-column: span 4 / span 4;">
                                        <span style="display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 0.5rem;">MANUAL</span>
                                        <div style="font-size: 0.875rem; margin-bottom: 0.5rem;">Opening: <span class="read-only-cell" style="background-color: #f1f5f9; border: 1px solid #e2e8f0; color: #475569; font-family: monospace; padding: 0.25rem 0.5rem; border-radius: 0.25rem;">${row.opening_manual_meter}</span></div>
                                        <input type="number" step="0.01" class="spa-input meter-closing-manual" data-opening="${row.opening_manual_meter}" value="${row.closing_manual_meter || ''}" placeholder="Closing Manual" style="width: 100%; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 0.5rem; padding: 0.5rem 0.75rem; color: #0f172a; font-family: monospace; outline: none; transition: all 0.2s;" ${disable_attr}>
                                        <div style="font-size: 0.75rem; font-weight: 500; color: #64748b; margin-top: 0.25rem;">Sales: <span class="meter-sales-manual" style="font-weight: 700;">0.00</span></div>
                                    </div>
                                    
                                    <div style="grid-column: span 2 / span 2; text-align: right;">
                                        <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem;">Variance: <span class="meter-variance">0.00</span></div>
                                        <div style="font-size: 1.125rem; font-weight: 700; color: #172554;">Value: <br><span class="meter-total-value">0.00</span></div>
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
                            
                            let ago_ltrs = $wrapper.find('#sum-ago-ltrs').text();
                            let pms_ltrs = $wrapper.find('#sum-pms-ltrs').text();
                            
                            frappe.confirm(`<b>Confirm Save for ${pg_name}</b><br><br><span style="color:var(--primary); font-size:1.1em;">Total AGO Ltrs:</span> <b>${ago_ltrs} Ltrs</b><br><span style="color:var(--primary); font-size:1.1em;">Total PMS Ltrs:</span> <b>${pms_ltrs} Ltrs</b>`, function() {
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
                                    if (window.render_homepage) window.render_homepage($wrapper);
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
    if (!window.ACTIVE_SHIFT) return;

    let sDate = window.ACTIVE_SHIFT.shift_date || window.ACTIVE_SHIFT.creation || frappe.datetime.now_date();
    let shiftName = window.ACTIVE_SHIFT.shift_template ? `${window.ACTIVE_SHIFT.shift_template}` : window.ACTIVE_SHIFT.name;
    let stationName = window.ACTIVE_SHIFT.station || (frappe.defaults.get_user_default("station") || "");

    $wrapper.find('#dips-shift-name').text(shiftName);
    $wrapper.find('#dips-shift-date').text(sDate.split(" ")[0]);
    $wrapper.find('#dips-station-name').text(stationName);

    // 1. Setup Segmented Control
    $wrapper.find('#tab-dips .seg-btn').off('click').on('click', function() {
        let $btn = $(this);
        let targetView = $btn.attr('data-view');
        
        $wrapper.find('#tab-dips .seg-btn').removeClass('active');
        $btn.addClass('active');
        
        $wrapper.find('#tab-dips .view-pane').removeClass('active');
        $wrapper.find(`#dips-${targetView}-view`).addClass('active');

        if (targetView === 'history') {
            fetch_dips_history($wrapper);
        }
    });

    // 2. Render Entry View Readings
    let html = '';
    let uniqueTanks = [];
    (window.SHIFT_DOC.dip_stick_readings || []).forEach(row => {
        if (row.fuel_tank && !uniqueTanks.includes(row.fuel_tank)) {
            uniqueTanks.push(row.fuel_tank);
        }
        let openDip = parseFloat(row.opening_dip || 0);
        let closeDip = (row.closing_dip !== null && row.closing_dip !== undefined && row.closing_dip !== "") ? parseFloat(row.closing_dip) : null;
        let dropText = '-';
        let dropColor = '#64748b';
        if (closeDip !== null) {
            let drop = openDip - closeDip;
            dropText = drop.toFixed(2) + ' L';
            dropColor = drop >= 0 ? '#166534' : '#dc2626';
        }

        html += `
            <tr data-name="${row.name}" data-tank="${row.fuel_tank}">
                <td style="font-weight: 600; color: var(--text-primary); font-size: 0.95rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #3b82f6;"></span>
                        ${row.fuel_tank}
                    </div>
                </td>
                <td style="text-align: right;"><span class="read-only-cell dip-opening" style="font-family: monospace; font-weight: 600; font-size: 0.95rem;">${openDip.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></td>
                <td>
                    <input type="number" step="0.01" class="spa-input dip-closing highlight-input" data-field="closing_dip" data-opening="${openDip}" value="${closeDip !== null ? closeDip : ''}" placeholder="Enter closing dip (L)" style="font-family: monospace; font-weight: 600; font-size: 0.95rem;">
                </td>
                <td style="text-align: right;">
                    <span class="dip-drop" style="font-family: monospace; font-weight: 700; color: ${dropColor}; font-size: 0.95rem;">${dropText}</span>
                </td>
            </tr>
        `;
    });

    if (!html) {
        html = '<tr><td colspan="4" class="text-center" style="padding: 2rem; color: #94a3b8;">No tanks assigned to this station/shift.</td></tr>';
    }
    $wrapper.find('#dips-container').html(html);

    // Live calculation on closing input
    $wrapper.find('#dips-container .dip-closing').off('input').on('input', function() {
        let $row = $(this).closest('tr');
        let openVal = parseFloat($row.find('.dip-opening').text().replace(/,/g, '')) || 0;
        let closeStr = $(this).val();
        if (closeStr !== "" && !isNaN(parseFloat(closeStr))) {
            let closeVal = parseFloat(closeStr);
            let drop = openVal - closeVal;
            $row.find('.dip-drop').text(drop.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' L')
                .css('color', drop >= 0 ? '#166534' : '#dc2626');
        } else {
            $row.find('.dip-drop').text('-').css('color', '#64748b');
        }
    });

    // Populate tank filter options in history view
    let currentTankFilter = $wrapper.find('#dips-filter-tank').val();
    let tankOpts = '<option value="">All Fuel Tanks</option>';
    uniqueTanks.forEach(t => {
        let selected = t === currentTankFilter ? 'selected' : '';
        tankOpts += `<option value="${t}" ${selected}>${t}</option>`;
    });
    $wrapper.find('#dips-filter-tank').html(tankOpts);

    // Setup history filters
    $wrapper.find('#dips-filter-date-from, #dips-filter-date-to, #dips-filter-tank').off('change').on('change', function() {
        fetch_dips_history($wrapper);
    });
    $wrapper.find('#btn-refresh-dips-history').off('click').on('click', function() {
        fetch_dips_history($wrapper);
    });

    // Hover effect for auto-fill button
    $wrapper.find('#btn-auto-fill-dips').hover(
        function() { $(this).css({background: '#f1f5f9', color: '#0f172a', borderColor: '#cbd5e1'}); },
        function() { $(this).css({background: '#f8fafc', color: '#475569', borderColor: '#e2e8f0'}); }
    );

    // Click handler for Auto-Fill
    $wrapper.find('#btn-auto-fill-dips').off('click').on('click', function() {
        let $btn = $(this);
        let orig_html = $btn.html();
        $btn.html('<span class="spinner-border spinner-border-sm" style="width: 14px; height: 14px;"></span> Calculating...').prop('disabled', true);
        
        frappe.call({
            method: "fuel_management.fuel_management.api.get_expected_dips",
            args: { shift_id: window.ACTIVE_SHIFT.name },
            callback: function(r) {
                $btn.html(orig_html).prop('disabled', false);
                if(r.message) {
                    let expected_dips = r.message;
                    let filled_count = 0;
                    
                    $wrapper.find('#dips-container tr').each(function() {
                        let tank = $(this).attr('data-tank');
                        if (tank && expected_dips[tank] !== undefined) {
                            let exp_val = expected_dips[tank];
                            exp_val = Math.round(exp_val * 100) / 100;
                            $(this).find('.dip-closing').val(exp_val).trigger('input');
                            filled_count++;
                        }
                    });
                    
                    if(filled_count > 0) {
                        frappe.show_alert({message: `Successfully populated dummy dips for ${filled_count} tanks.`, indicator: "green"});
                    } else {
                        frappe.show_alert({message: "No tanks found to populate.", indicator: "orange"});
                    }
                }
            },
            error: function() {
                $btn.html(orig_html).prop('disabled', false);
            }
        });
    });

    // Fetch history
    fetch_dips_history($wrapper);
}

function fetch_dips_history($wrapper) {
    if (!window.ACTIVE_SHIFT && !frappe.defaults.get_user_default("station")) return;

    let station = window.ACTIVE_SHIFT ? window.ACTIVE_SHIFT.station : (frappe.defaults.get_user_default("station") || "");
    let from_date = $wrapper.find('#dips-filter-date-from').val();
    let to_date = $wrapper.find('#dips-filter-date-to').val();
    let tank = $wrapper.find('#dips-filter-tank').val();

    $wrapper.find('#list-dips-saved').html('<tr><td colspan="10" class="text-center" style="color: #94a3b8; padding: 2rem;"><span class="spinner-border spinner-border-sm"></span> Loading dips history...</td></tr>');

    frappe.call({
        method: "fuel_management.fuel_management.api.get_shift_dips_history",
        args: {
            station: station,
            from_date: from_date || null,
            to_date: to_date || null,
            tank: tank || null
        },
        callback: function(r) {
            let count = r.message ? r.message.length : 0;
            if (!from_date && !to_date && !tank) {
                $wrapper.find('#dips-history-subtitle').html(`<span style="color:#64748b; font-size:0.85rem;">(Showing latest 20 entries &bull; Use date filter for more)</span>`);
            } else {
                $wrapper.find('#dips-history-subtitle').html(`<span style="color:#047857; font-size:0.85rem; font-weight:600;">(Showing ${count} filtered entries)</span>`);
            }
            let html = '';
            if (r.message && r.message.length > 0) {
                // Populate tanks dropdown if options are only default
                if ($wrapper.find('#dips-filter-tank option').length <= 1) {
                    let tanks = [...new Set(r.message.map(d => d.fuel_tank).filter(Boolean))];
                    let opts = '<option value="">All Fuel Tanks</option>';
                    tanks.forEach(t => {
                        opts += `<option value="${t}">${t}</option>`;
                    });
                    $wrapper.find('#dips-filter-tank').html(opts);
                }

                r.message.forEach(row => {
                    let openDip = row.opening_dip !== null ? parseFloat(row.opening_dip) : null;
                    let closeDip = row.closing_dip !== null ? parseFloat(row.closing_dip) : null;
                    let diffDip = (openDip !== null && closeDip !== null) ? (openDip - closeDip) : null;
                    let expStock = row.expected_stock !== null ? parseFloat(row.expected_stock) : null;
                    let variance = row.variance !== null ? parseFloat(row.variance) : null;

                    let statusBadge = row.shift_status === 'Open'
                        ? '<span class="badge" style="background-color: #dcfce7; color: #166534; font-weight: 600; padding: 3px 8px; border-radius: 6px;">Live Open</span>'
                        : '<span class="badge" style="background-color: #f1f5f9; color: #475569; font-weight: 600; padding: 3px 8px; border-radius: 6px;">Closed</span>';

                    let varDisplay = '-';
                    if (variance !== null) {
                        let varColor = variance < 0 ? '#dc2626' : (variance > 0 ? '#16a34a' : '#475569');
                        varDisplay = `<span style="font-weight: 700; color: ${varColor}; font-family: monospace;">${variance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`;
                    }

                    let diffDisplay = diffDip !== null 
                        ? `<span style="font-family: monospace; font-weight: 600; color: ${diffDip >= 0 ? '#166534' : '#dc2626'};">${diffDip.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>` 
                        : '<span style="color: #94a3b8;">-</span>';

                    let closeDisplay = closeDip !== null 
                        ? `<span style="font-family: monospace; font-weight: 600; color: #0f172a;">${closeDip.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
                        : '<span style="color: #94a3b8; font-style: italic; font-size: 0.8rem;">Not Recorded</span>';

                    let openDisplay = openDip !== null
                        ? `<span style="font-family: monospace; font-weight: 600; color: #475569;">${openDip.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
                        : '<span style="color: #94a3b8;">0.00</span>';

                    let expDisplay = expStock !== null
                        ? `<span style="font-family: monospace; font-weight: 500; color: #475569;">${expStock.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
                        : '<span style="color: #94a3b8;">-</span>';

                    html += `
                        <tr data-id="${row.name}" data-shift="${row.shift}" data-tank="${row.fuel_tank}">
                            <td style="font-weight: 500; color: #1e293b; white-space: nowrap;">${row.shift_date || ''}</td>
                            <td><span class="badge" style="background-color: #eff6ff; color: #1e40af; font-weight: 600; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem;">${row.shift_template || row.shift}</span></td>
                            <td style="font-weight: 600; color: #0f172a;">${row.fuel_tank}</td>
                            <td style="text-align: right;">${openDisplay}</td>
                            <td style="text-align: right;">${closeDisplay}</td>
                            <td style="text-align: right;">${diffDisplay}</td>
                            <td style="text-align: right;">${expDisplay}</td>
                            <td style="text-align: right;">${varDisplay}</td>
                            <td style="text-align: center;">${statusBadge}</td>
                            <td style="text-align: center; white-space: nowrap;">
                                <button class="btn btn-xs btn-secondary btn-edit-dip" data-id="${row.name}" data-shift="${row.shift}" data-tank="${row.fuel_tank}" data-opening="${openDip || 0}" data-closing="${closeDip !== null ? closeDip : ''}" style="margin-right: 4px; padding: 2px 8px; font-size: 0.75rem; border-radius: 4px;">Edit</button>
                                <button class="btn btn-xs btn-secondary btn-delete-dip" data-id="${row.name}" data-shift="${row.shift}" data-tank="${row.fuel_tank}" style="color: #dc2626; border-color: #fca5a5; padding: 2px 8px; font-size: 0.75rem; border-radius: 4px;">Clear</button>
                            </td>
                        </tr>
                    `;
                });
            } else {
                html = '<tr><td colspan="10" class="text-center" style="color: #94a3b8; padding: 2rem;">No historical dip stick readings found for this selection.</td></tr>';
            }
            $wrapper.find('#list-dips-saved').html(html);

            // Bind Edit Action
            $wrapper.find('.btn-edit-dip').off('click').on('click', function() {
                let readingId = $(this).attr('data-id');
                let shiftName = $(this).attr('data-shift');
                let tankName = $(this).attr('data-tank');
                let openVal = parseFloat($(this).attr('data-opening')) || 0;
                let closeVal = $(this).attr('data-closing');

                if (window.ACTIVE_SHIFT && shiftName === window.ACTIVE_SHIFT.name) {
                    // Switch to entry view
                    $wrapper.find('#tab-dips .seg-btn[data-view="entry"]').click();
                    let $targetRow = $wrapper.find(`#dips-container tr[data-name="${readingId}"]`);
                    if ($targetRow.length) {
                        $targetRow.css({ transition: 'background-color 0.3s', backgroundColor: '#fef9c3' });
                        setTimeout(() => { $targetRow.css('backgroundColor', ''); }, 2500);
                        $targetRow.find('.dip-closing').focus().select();
                        frappe.show_alert({message: `Editing ${tankName} in active shift form.`, indicator: "blue"});
                    }
                } else {
                    // Prompt modal for past shift or external reading
                    frappe.prompt([
                        {
                            label: 'Fuel Tank',
                            fieldname: 'fuel_tank',
                            fieldtype: 'Data',
                            default: tankName,
                            read_only: 1
                        },
                        {
                            label: 'Shift',
                            fieldname: 'shift',
                            fieldtype: 'Data',
                            default: shiftName,
                            read_only: 1
                        },
                        {
                            label: 'Opening Dip (Liters)',
                            fieldname: 'opening_dip',
                            fieldtype: 'Float',
                            default: openVal
                        },
                        {
                            label: 'Closing Dip (Liters)',
                            fieldname: 'closing_dip',
                            fieldtype: 'Float',
                            default: closeVal !== '' ? parseFloat(closeVal) : ''
                        }
                    ], function(values) {
                        frappe.dom.freeze("Updating Dip Reading...");
                        frappe.call({
                            method: "fuel_management.fuel_management.api.update_dip_reading",
                            args: {
                                reading_id: readingId,
                                opening_dip: values.opening_dip,
                                closing_dip: values.closing_dip
                            },
                            callback: function(r) {
                                frappe.dom.unfreeze();
                                if (r.message && r.message.status === "success") {
                                    frappe.show_alert({message: "Dip Stick reading updated successfully!", indicator: "green"});
                                    fetch_dips_history($wrapper);
                                    if (window.ACTIVE_SHIFT && shiftName === window.ACTIVE_SHIFT.name) {
                                        frappe.client.get({
                                            doctype: "Shift",
                                            name: window.ACTIVE_SHIFT.name,
                                            callback: function(res) {
                                                if (res.message) {
                                                    window.SHIFT_DOC = res.message;
                                                    render_dips($wrapper);
                                                }
                                            }
                                        });
                                    }
                                }
                            },
                            error: function() {
                                frappe.dom.unfreeze();
                            }
                        });
                    }, `Edit Dip Reading: ${tankName}`, 'Save Changes');
                }
            });

            // Bind Delete / Clear Action
            $wrapper.find('.btn-delete-dip').off('click').on('click', function() {
                let readingId = $(this).attr('data-id');
                let shiftName = $(this).attr('data-shift');
                let tankName = $(this).attr('data-tank');

                frappe.confirm(`Are you sure you want to clear the closing dip reading for <b>${tankName}</b> (${shiftName})?`, function() {
                    frappe.dom.freeze("Clearing Dip Reading...");
                    frappe.call({
                        method: "fuel_management.fuel_management.api.clear_dip_reading",
                        args: { reading_id: readingId },
                        callback: function(r) {
                            frappe.dom.unfreeze();
                            if (r.message && r.message.status === "success") {
                                frappe.show_alert({message: `Dip reading for ${tankName} cleared.`, indicator: "green"});
                                fetch_dips_history($wrapper);
                                if (window.ACTIVE_SHIFT && shiftName === window.ACTIVE_SHIFT.name) {
                                    let row = (window.SHIFT_DOC.dip_stick_readings || []).find(d => d.name === readingId);
                                    if (row) row.closing_dip = null;
                                    let $inputRow = $wrapper.find(`#dips-container tr[data-name="${readingId}"]`);
                                    if ($inputRow.length) {
                                        $inputRow.find('.dip-closing').val('').trigger('input');
                                    }
                                }
                            }
                        },
                        error: function() {
                            frappe.dom.unfreeze();
                        }
                    });
                });
            });
        },
        error: function() {
            $wrapper.find('#list-dips-saved').html('<tr><td colspan="10" class="text-center" style="color: #dc2626; padding: 2rem;">Failed to load dips history.</td></tr>');
        }
    });
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
                        <div style="font-size: 0.75em; color: #64748b; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">${row.bank_name ? 'to ' + row.bank_name : 'Transfer to Bank'}</div>
                        <input type="number" class="spa-input mpesa-transfers highlight-input" data-field="transfers_made" value="${row.transfers_made || ''}" placeholder="Enter Transfers">
                    </td>
                    <td>
                        <input type="number" class="spa-input mpesa-closing highlight-input" data-field="closing_balance" data-opening="${row.opening_balance || 0}" value="${row.closing_balance || ''}" placeholder="Enter closing reading here">
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

    // Initialize date filters if empty
    let curStartDate = $wrapper.find('#drystock-filter-start-date').val();
    let curEndDate = $wrapper.find('#drystock-filter-end-date').val();
    if (!curStartDate) {
        let baseDateStr = sDate.split(" ")[0];
        let d = frappe.datetime.str_to_obj(baseDateStr);
        let firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
        $wrapper.find('#drystock-filter-start-date').val(frappe.datetime.obj_to_str(firstOfMonth));
    }
    if (!curEndDate) {
        $wrapper.find('#drystock-filter-end-date').val(sDate.split(" ")[0]);
    }

    // Calculate Liability CSA
    let lubes_assignment = (window.SHIFT_DOC.assigned_csas || []).find(a => (a.pump_group || '').toLowerCase().includes('lube'));
    if (lubes_assignment) {
        let u = window.USERS_LIST ? window.USERS_LIST.find(u => u.name === lubes_assignment.csa) : null;
        let name = u ? (u.employee_name || u.full_name) : lubes_assignment.csa;
        $wrapper.find('#drystock-liability-csa').text(name + " (Assigned)");
    } else {
        $wrapper.find('#drystock-liability-csa').text("Select Sold By (Fallback)");
    }

    // Populate CSA dropdown
    let csaOptions = '<option value="">Select CSA (Optional Pitch Attribution)...</option>';
    if (window.USERS_LIST) {
        window.USERS_LIST.forEach(u => { 
            let uName = u.employee_name || u.full_name || u.name;
            csaOptions += `<option value="${u.name}">${uName}</option>`; 
        });
    }
    $wrapper.find('#drystock-csa').html(csaOptions).off('change').on('change', function() {
        if (!lubes_assignment) {
            let u = window.USERS_LIST ? window.USERS_LIST.find(u => u.name === $(this).val()) : null;
            let name = u ? (u.employee_name || u.full_name) : "Whoever sells it";
            $wrapper.find('#drystock-liability-csa').text(name + " (Fallback)");
        }
    });

    // Ensure items are loaded
    if (!window.DRYSTOCK_ITEMS || window.DRYSTOCK_ITEMS.length === 0) {
        frappe.call({
            method: "fuel_management.fuel_management.api.get_active_item_prices",
            callback: function(r) {
                if (r.message) {
                    window.DRYSTOCK_ITEMS = r.message;
                    window.INVOICE_ITEMS = r.message;
                }
            }
        });
    }

    // -------------------------------------------------------------
    // SEARCHABLE COMBOBOX: INVENTORY ITEM
    // -------------------------------------------------------------
    function render_drystock_item_dropdown(filter_text = '') {
        let items = window.DRYSTOCK_ITEMS || [];
        let query = (filter_text || '').toLowerCase().trim();

        let gas_items = [];
        let lube_items = [];
        let filter_items = [];
        let other_items = [];

        items.forEach(i => {
            let grp = (i.item_group || '').toUpperCase();
            let nm = (i.item_name || i.item_code || '').toUpperCase();
            
            // Skip fuels and non-sale utility items
            if (grp === 'NOT FOR SALE' || grp === 'FUELS' || nm === 'OPENING BALANCE' || nm === 'PETROL' || nm === 'DIESEL') return;

            let matches = !query || nm.toLowerCase().includes(query) || (i.item_code || '').toLowerCase().includes(query) || grp.toLowerCase().includes(query);
            if (!matches) return;

            if (grp.includes('GAS') || grp.includes('CYLINDER') || nm.includes('CYLINDER') || nm.includes('LPG') || nm.includes('GAS')) {
                gas_items.push(i);
            } else if (grp.includes('LUBE') || grp.includes('OIL') || nm.includes('HELIX') || nm.includes('RIMULA') || nm.includes('COOLANT') || nm.includes('BRAKE') || nm.includes('ATF') || nm.includes('GREASE') || nm.includes('ADBLUE') || nm.includes('FLUID') || nm.includes('GTX') || nm.includes('MAGNATEC') || nm.includes('EDGE')) {
                lube_items.push(i);
            } else if (grp.includes('FILTER') || nm.includes('FILTER') || nm.includes('PLUG') || nm.includes('PAD') || nm.includes('SHOE') || nm.includes('CLEANER')) {
                filter_items.push(i);
            } else {
                other_items.push(i);
            }
        });

        let total = gas_items.length + lube_items.length + filter_items.length + other_items.length;
        let html = '';

        if (total === 0) {
            html = '<div style="padding: 0.85rem 1rem; color: #94a3b8; font-size: 0.85rem; text-align: center;">No matching inventory products found</div>';
        } else {
            function build_group(label, list, badgeColor, badgeBg) {
                if (list.length === 0) return '';
                let g_html = `<div class="combobox-group-header">${label}</div>`;
                list.forEach(i => {
                    let displayName = i.item_name || i.item_code;
                    let rate_str = i.price_list_rate ? `KES ${parseFloat(i.price_list_rate).toLocaleString('en-US', {minimumFractionDigits: 2})}` : '';
                    g_html += `
                        <div class="combobox-item drystock-item-opt" data-id="${i.item_code}" data-name="${frappe.utils.escape_html(displayName)}" data-rate="${i.price_list_rate || 0}" data-group="${frappe.utils.escape_html(i.item_group || '')}">
                            <div style="font-weight: 700; color: #0f172a; font-size: 0.9rem;">${frappe.utils.escape_html(displayName)}</div>
                            <span style="font-size: 0.8rem; font-weight: 800; color: ${badgeColor}; background: ${badgeBg}; padding: 2px 8px; border-radius: 4px; font-family: monospace;">${rate_str}</span>
                        </div>
                    `;
                });
                return g_html;
            }

            html += build_group('🔥 Gas Cylinders & LPG', gas_items, '#d97706', '#fffbeb');
            html += build_group('📦 Lubricants & Engine Fluids', lube_items, '#7c3aed', '#faf5ff');
            html += build_group('🚗 Filters, Plugs & Service Parts', filter_items, '#0284c7', '#f0f9ff');
            html += build_group('🔧 Accessories & Other Stock', other_items, '#475569', '#f8fafc');
        }

        $wrapper.find('#drystock-item-dropdown').html(html).show();
    }

    function select_drystock_item(item_code, item_name, rate, item_group) {
        $wrapper.find('#drystock-item-hidden').val(item_code);
        $wrapper.find('#drystock-item-input').val(item_name);
        $wrapper.find('#drystock-item-dropdown').hide();

        let item = (window.DRYSTOCK_ITEMS || []).find(i => i.item_code === item_code || i.item_name === item_name);
        let price = (item && item.price_list_rate) ? item.price_list_rate : (rate || 0);
        $wrapper.find('#drystock-price').val(parseFloat(price).toFixed(2));

        // Calculate pack multiplier
        let mult = 1;
        let grp = (item_group || (item ? item.item_group : '') || '').toUpperCase();
        let nm = (item_name || '').toUpperCase();
        if (grp.includes('GAS') || grp.includes('CYLINDER') || grp.includes('LUBES')) {
            let m = nm.match(/(\d+(?:\.\d+)?)\s*(L|ML|KG|G|LITRE|LTR)s?\b/i);
            if (m) {
                mult = parseFloat(m[1]);
                let unit = m[2].toUpperCase();
                if (unit === 'ML' || unit === 'G') mult = mult / 1000.0;
            }
        }
        $wrapper.find('#drystock-uom').val(mult);

        // Forecourt stock balance check
        $wrapper.find('#drystock-fc-stock-pill').html('⏳ Checking stock balance...').css({ background: '#fef3c7', color: '#b45309', borderColor: '#fde68a' });
        
        frappe.call({
            method: "fuel_management.fuel_management.api.get_item_forecourt_balance",
            args: {
                station_id: window.ACTIVE_SHIFT.station,
                item_code: item_code
            },
            callback: function(r) {
                let bal = r.message !== undefined ? r.message : 0;
                if (item) item.fc_balance = bal;
                if (bal > 10) {
                    $wrapper.find('#drystock-fc-stock-pill').html(`🟢 In Stock: <strong>${bal} Units</strong>`).css({ background: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0' });
                } else if (bal > 0) {
                    $wrapper.find('#drystock-fc-stock-pill').html(`🟡 Low Stock: <strong>${bal} Units</strong>`).css({ background: '#fffbeb', color: '#b45309', borderColor: '#fde68a' });
                } else {
                    $wrapper.find('#drystock-fc-stock-pill').html(`🔴 Out of Stock: <strong>0 Units</strong>`).css({ background: '#fef2f2', color: '#b91c1c', borderColor: '#fecaca' });
                }
            }
        });

        // Default Qty to 1 if empty
        if (!$wrapper.find('#drystock-qty').val() || parseFloat($wrapper.find('#drystock-qty').val()) <= 0) {
            $wrapper.find('#drystock-qty').val(1);
        }
        calc_drystock();
        $wrapper.find('#drystock-qty').focus().select();
    }

    $wrapper.find('#drystock-item-input').off('focus input').on('focus input', function() {
        let txt = $(this).val();
        render_drystock_item_dropdown(txt);
    });

    $wrapper.find('#btn-toggle-drystock-dropdown').off('click').on('click', function(e) {
        e.stopPropagation();
        let $dd = $wrapper.find('#drystock-item-dropdown');
        if ($dd.is(':visible')) {
            $dd.hide();
        } else {
            $wrapper.find('#drystock-item-input').focus();
            render_drystock_item_dropdown($wrapper.find('#drystock-item-input').val());
        }
    });

    $wrapper.find('#drystock-item-dropdown').off('click', '.drystock-item-opt').on('click', '.drystock-item-opt', function() {
        let id = $(this).attr('data-id');
        let name = $(this).attr('data-name');
        let rate = $(this).attr('data-rate');
        let group = $(this).attr('data-group');
        select_drystock_item(id, name, rate, group);
    });

    // Close dropdowns on outside click
    $(document).off('click.drystock_combobox').on('click.drystock_combobox', function(e) {
        if (!$(e.target).closest('#drystock-combobox-wrap').length) {
            $wrapper.find('#drystock-item-dropdown').hide();
        }
    });

    // -------------------------------------------------------------
    // CALCULATIONS & FORM CONTROLS
    // -------------------------------------------------------------
    function calc_drystock() {
        let qty = parseFloat($wrapper.find('#drystock-qty').val()) || 0;
        if (qty < 0) { qty = 0; $wrapper.find('#drystock-qty').val(0); }
        let uom = parseFloat($wrapper.find('#drystock-uom').val()) || 0;
        let price = parseFloat($wrapper.find('#drystock-price').val()) || 0;
        
        let vol = (qty * uom);
        let total = (qty * price);
        
        $wrapper.find('#drystock-volume').val(vol.toFixed(2));
        $wrapper.find('#drystock-total').val(total.toFixed(2));
        $wrapper.find('#drystock-total-display').text(total.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
    }

    $wrapper.find('#drystock-qty, #drystock-uom').off('input').on('input', calc_drystock);

    // Filter events for historical view
    $wrapper.find('#drystock-filter-start-date, #drystock-filter-end-date').off('change').on('change', function() {
        fetch_drystock_history($wrapper);
    });
    $wrapper.find('#drystock-filter-search').off('input').on('input', function() {
        fetch_drystock_history($wrapper);
    });

    // Add to Cart
    $wrapper.find('#btn-add-drystock').off('click').on('click', function() {
        let csa = $wrapper.find('#drystock-csa').val();
        let item_code = ($wrapper.find('#drystock-item-hidden').val() || '').trim();
        let item_name_input = ($wrapper.find('#drystock-item-input').val() || '').trim();
        
        let item = null;
        if (item_code) {
            item = (window.DRYSTOCK_ITEMS || []).find(i => i.item_code === item_code);
        }
        if (!item && item_name_input) {
            item = (window.DRYSTOCK_ITEMS || []).find(i => 
                (i.item_name && i.item_name.toLowerCase() === item_name_input.toLowerCase()) || 
                (i.item_code && i.item_code.toLowerCase() === item_name_input.toLowerCase())
            );
        }

        let qty = parseFloat($wrapper.find('#drystock-qty').val()) || 0;
        if (qty < 0) qty = 0;
        let uom = parseFloat($wrapper.find('#drystock-uom').val()) || 1;
        let price = parseFloat($wrapper.find('#drystock-price').val()) || (item ? item.price_list_rate : 0);
        
        if (!item || qty <= 0) {
            frappe.show_alert({message: "Please select an inventory product and enter a valid quantity.", indicator: "orange"});
            if (!item) $wrapper.find('#drystock-item-input').focus();
            else $wrapper.find('#drystock-qty').focus();
            return;
        }

        // Validate forecourt stock balance
        let fc_stock = item.fc_balance !== undefined ? item.fc_balance : null;
        let existing_qty = 0;
        if (window.PENDING_DRYSTOCK) {
            window.PENDING_DRYSTOCK.forEach(row => {
                if (row.item === item.item_code) {
                    existing_qty += row.quantity;
                }
            });
        }

        if (fc_stock !== null && (qty + existing_qty) > fc_stock) {
            frappe.msgprint({
                title: __('Insufficient Forecourt Stock'),
                indicator: 'red',
                message: __('Cannot add <b>{0}</b>.<br><br>Forecourt Stock Available: <b>{1} units</b><br>Already in Cart: <b>{2} units</b><br>Attempting to add: <b>{3} units</b><br><br>Please perform a stock transfer to forecourt first.', [item.item_name, fc_stock, existing_qty, qty])
            });
            return;
        }

        let volume = qty * uom;
        let amount = qty * price;

        if (!window.PENDING_DRYSTOCK) window.PENDING_DRYSTOCK = [];
        
        let new_row = {
            doctype: "Shift Inventory Sale",
            sold_by: csa,
            item: item.item_code,
            item_name: item.item_name || item.item_code,
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
        $wrapper.find('#drystock-item-hidden').val('');
        $wrapper.find('#drystock-qty').val('');
        $wrapper.find('#drystock-uom').val('1');
        $wrapper.find('#drystock-price').val('0.00');
        $wrapper.find('#drystock-volume').val('0.00');
        $wrapper.find('#drystock-total').val('0.00');
        $wrapper.find('#drystock-total-display').text('0.00');
        $wrapper.find('#drystock-fc-stock-pill').html('Select item to view stock').css({ background: '#f1f5f9', color: '#64748b', borderColor: '#e2e8f0' });
        
        refresh_drystock_cart($wrapper);
        frappe.show_alert({message: `Added ${qty}x ${item.item_name} to cart`, indicator: "green"});
    });

    refresh_drystock_cart($wrapper);
    fetch_drystock_history($wrapper);
    
    // Also update variance fields if they already exist in doc
    $wrapper.find('#cash-variance-val').text(window.SHIFT_DOC.cash_variance ? 'KES ' + window.SHIFT_DOC.cash_variance.toLocaleString('en-US', {minimumFractionDigits: 2}) : 'KES 0.00');
    $wrapper.find('#drystock-variance-val').text(window.SHIFT_DOC.dry_stock_cash_variance ? 'KES ' + window.SHIFT_DOC.dry_stock_cash_variance.toLocaleString('en-US', {minimumFractionDigits: 2}) : 'KES 0.00');
    $wrapper.find('#actual-cash-input').val(window.SHIFT_DOC.actual_cash || '');
    $wrapper.find('#actual-drystock-cash-input').val(window.SHIFT_DOC.actual_dry_stock_cash || '');
}

function fetch_drystock_history($wrapper) {
    if (!window.ACTIVE_SHIFT || !window.ACTIVE_SHIFT.station) return;
    
    let start_date = $wrapper.find('#drystock-filter-start-date').val();
    let end_date = $wrapper.find('#drystock-filter-end-date').val();
    let filter_search = ($wrapper.find('#drystock-filter-search').val() || '').trim().toLowerCase();
    
    let is_locked = window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.status !== "Open" && !(frappe.user.has_role("System Manager") || frappe.user.has_role("Fuel Station Owner"));
    
    $wrapper.find('#list-drystock-saved').html('<tr><td colspan="10" class="text-center" style="color: #64748b; padding: 2rem;">Loading sales history...</td></tr>');
    
    frappe.call({
        method: "fuel_management.fuel_management.api.get_inventory_sales_history",
        args: {
            station: window.ACTIVE_SHIFT.station,
            from_date: start_date || undefined,
            to_date: end_date || undefined,
            search: filter_search || undefined
        },
        callback: function(r) {
            let sales = r.message || [];
            let count = sales.length;
            if (!start_date && !end_date && !filter_search) {
                $wrapper.find('#drystock-history-subtitle').html(`<span style="color:#64748b; font-size:0.85rem;">(Showing latest ${count} entries &bull; Use date filter for more)</span>`);
            } else {
                $wrapper.find('#drystock-history-subtitle').html(`<span style="color:#047857; font-size:0.85rem; font-weight:600;">(Showing ${count} filtered entries)</span>`);
            }
            let html_saved = '';
            let total_amount_saved = 0;
            
            if (sales && sales.length > 0) {
                sales.forEach((row, idx) => {
                    let item_obj = (window.DRYSTOCK_ITEMS || []).find(i => i.item_code === row.item || i.item_name === row.item);
                    let display_name = item_obj ? (item_obj.item_name || item_obj.item_code) : (row.item_name || row.item);
                    let category = row.item_group || (item_obj ? item_obj.item_group : '') || 'Stock';

                    if (filter_search) {
                        let matchStr = `${display_name} ${category} ${row.sold_by || ''}`.toLowerCase();
                        if (!matchStr.includes(filter_search)) return;
                    }

                    let csa_name = row.sold_by;
                    if (window.USERS_LIST) {
                        let u = window.USERS_LIST.find(u => u.name === row.sold_by);
                        if (u) csa_name = u.employee_name || u.full_name || row.sold_by;
                    }
                    
                    let entry_id = 1000 + (row.idx || (idx + 1));
                    let date_val = row.shift_date ? frappe.datetime.str_to_user(row.shift_date).split(' ')[0] : '';
                    let shift_label = row.shift_template || row.shift_name_display || row.shift || '';
                    
                    let is_active_shift = (row.shift === window.ACTIVE_SHIFT.name || row.parent === window.ACTIVE_SHIFT.name);
                    let can_edit = is_active_shift && !is_locked && !row.is_invoice_sale;
                    
                    let del_btn = '';
                    if (row.is_invoice_sale) {
                        del_btn = `<span class="badge" style="background-color: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; white-space: nowrap;">Invoice Sale</span>`;
                    } else if (can_edit) {
                        del_btn = `<div style="display:flex; gap:0.35rem; justify-content:center; align-items:center;">
                            <button class="btn btn-xs btn-primary btn-edit-saved" data-name="${row.name}" data-item="${frappe.utils.escape_html(row.item)}" data-qty="${row.quantity}" data-price="${row.selling_price}" data-sold-by="${frappe.utils.escape_html(row.sold_by || '')}" data-uom="${row.uom_multiplier || 1}" style="font-weight:700; padding:3px 8px; font-size:0.76rem; border-radius:4px; background:#2563eb; color:#fff; border:none; cursor:pointer;">Edit</button>
                            <button class="btn btn-xs btn-danger btn-remove-saved" data-name="${row.name}" style="font-weight:700; padding:3px 7px; font-size:0.76rem; border-radius:4px; background:#ef4444; color:#fff; border:none; cursor:pointer;" title="Delete this sale">✕</button>
                        </div>`;
                    } else {
                        del_btn = `<div style="display:flex; gap:0.35rem; justify-content:center; align-items:center;">
                            <button class="btn btn-xs btn-default" disabled style="opacity:0.5; padding:3px 8px; font-size:0.76rem; cursor:not-allowed;" title="Only active shift records can be edited">Edit</button>
                            <button class="btn btn-xs btn-default" disabled style="opacity:0.5; padding:3px 7px; font-size:0.76rem; cursor:not-allowed;" title="Only active shift records can be deleted">✕</button>
                        </div>`;
                    }
                    
                    let amt = parseFloat(row.amount || 0);
                    total_amount_saved += amt;
                    let vol = parseFloat(row.total_volume || (row.quantity * (row.uom_multiplier || 1)) || 0);
                    let amt_str = amt.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                    
                    html_saved += `
                        <tr style="background: ${is_active_shift ? '#f0fdf4' : 'transparent'}; border-bottom: 1px solid #f1f5f9;">
                            <td style="font-family: monospace; color: #64748b; font-weight:700; text-align:center; vertical-align: middle;">#${entry_id}</td>
                            <td style="color: #64748b; vertical-align: middle; white-space: nowrap;">${date_val}</td>
                            <td style="vertical-align: middle;">
                                <span class="badge" style="background-color: ${is_active_shift ? '#dcfce7' : '#f8fafc'}; color: ${is_active_shift ? '#166534' : '#64748b'}; font-weight: 600; border: 1px solid ${is_active_shift ? '#86efac' : '#e2e8f0'}; padding: 2px 7px; border-radius: 4px; font-size: 0.74rem; display: inline-block; white-space: nowrap;">
                                    ${frappe.utils.escape_html(shift_label)} ${is_active_shift ? '⚡' : ''}
                                </span>
                            </td>
                            <td style="color: #334155; font-weight: 500; vertical-align: middle;">${frappe.utils.escape_html(csa_name || '-')}</td>
                            <td style="vertical-align: middle;">
                                <div style="font-weight: 700; color: #0f172a; font-size: 0.88rem; line-height: 1.35;">${frappe.utils.escape_html(display_name)}</div>
                            </td>
                            <td style="text-align: center; vertical-align: middle;">
                                <span style="background: #f1f5f9; color: #475569; font-weight: 600; font-size: 0.74rem; padding: 2px 8px; border-radius: 4px; border: 1px solid #e2e8f0; display: inline-block; white-space: nowrap;">
                                    ${frappe.utils.escape_html(category)}
                                </span>
                            </td>
                            <td style="text-align: center; vertical-align: middle;"><strong style="color: #047857; font-size: 0.92rem;">${row.quantity || 0}</strong></td>
                            <td style="text-align: center; color: #64748b; vertical-align: middle; font-family: monospace;">${vol.toFixed(2)}</td>
                            <td style="text-align: right; vertical-align: middle;"><strong style="color: #047857; font-family: monospace; font-size: 0.92rem;">${amt_str}</strong></td>
                            <td style="text-align: center; vertical-align: middle;">${del_btn}</td>
                        </tr>
                    `;
                });
            }
            
            if (!html_saved) {
                html_saved = '<tr><td colspan="10" class="text-center" style="color: #64748b; padding: 2.5rem;">No inventory sales found matching filters.</td></tr>';
            }
            
            let total_saved_str = total_amount_saved.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            $wrapper.find('#list-drystock-saved').html(html_saved);
            $wrapper.find('#drystock-history-total').html(`Total Amount: <span style="color: #047857; font-weight: 900;">KES ${total_saved_str}</span>`);
            
            // Bind edit handler
            $wrapper.find('.btn-edit-saved').off('click').on('click', function() {
                if (is_locked) return;
                let row_name = $(this).attr('data-name');
                let row_item = $(this).attr('data-item');
                let row_qty = parseFloat($(this).attr('data-qty') || 1);
                let row_price = parseFloat($(this).attr('data-price') || 0);
                let row_sold_by = $(this).attr('data-sold-by');
                let row_uom = parseFloat($(this).attr('data-uom') || 1);
                
                frappe.confirm('This will load the item back into the entry form and remove it from history. Continue?', () => {
                    frappe.call({
                        method: "frappe.client.get",
                        args: { doctype: "Shift", name: window.ACTIVE_SHIFT.name },
                        callback: function(r2) {
                            if (r2.message) {
                                let doc = r2.message;
                                let sales_arr = doc.inventory_sales || [];
                                let idx = sales_arr.findIndex(r => r.name === row_name);
                                if (idx === -1) {
                                    frappe.show_alert({message: "Record not found in active shift", indicator: "red"});
                                    return;
                                }
                                let row = sales_arr[idx];
                                sales_arr.splice(idx, 1);
                                doc.inventory_sales = sales_arr.map(r3 => {
                                    return { ...r3, name: r3._is_new ? undefined : r3.name };
                                });
                                frappe.call({
                                    method: "frappe.client.save",
                                    args: { doc: doc },
                                    callback: function(r3) {
                                        if (r3.message) window.SHIFT_DOC = r3.message;
                                        
                                        // Load into form
                                        $wrapper.find('#drystock-csa').val(row.sold_by || row_sold_by);
                                        
                                        let item_obj = (window.DRYSTOCK_ITEMS || []).find(i => i.item_code === (row.item || row_item) || i.item_name === (row.item || row_item));
                                        let display_name = item_obj ? (item_obj.item_name || item_obj.item_code) : (row.item_name || row_item);
                                        
                                        // Switch to entry view
                                        $wrapper.find('#tab-drystock .seg-btn[data-view="entry"]').click();
                                        
                                        select_drystock_item(row.item || row_item, display_name, row.selling_price || row_price, item_obj ? item_obj.item_group : '');
                                        $wrapper.find('#drystock-qty').val(row.quantity || row_qty);
                                        $wrapper.find('#drystock-uom').val(row.uom_multiplier || row_uom);
                                        $wrapper.find('#drystock-price').val(row.selling_price || row_price);
                                        calc_drystock();
                                        
                                        refresh_drystock_cart($wrapper);
                                        fetch_drystock_history($wrapper);
                                        
                                        frappe.show_alert({message: "Item loaded into form for editing", indicator: "green"});
                                    }
                                });
                            }
                        }
                    });
                });
            });
            
            // Bind delete handler
            $wrapper.find('.btn-remove-saved').off('click').on('click', function() {
                if (is_locked) return;
                let row_name = $(this).attr('data-name');
                frappe.confirm('Are you sure you want to delete this inventory sale?', () => {
                    frappe.call({
                        method: "frappe.client.get",
                        args: { doctype: "Shift", name: window.ACTIVE_SHIFT.name },
                        callback: function(r2) {
                            if (r2.message) {
                                let doc = r2.message;
                                let sales_arr = doc.inventory_sales || [];
                                let idx = sales_arr.findIndex(r => r.name === row_name);
                                if (idx > -1) {
                                    sales_arr.splice(idx, 1);
                                    doc.inventory_sales = sales_arr.map(r3 => {
                                        return { ...r3, name: r3._is_new ? undefined : r3.name };
                                    });
                                    frappe.call({
                                        method: "frappe.client.save",
                                        args: { doc: doc },
                                        callback: function(r3) {
                                            if (r3.message) window.SHIFT_DOC = r3.message;
                                            frappe.show_alert({message: "Inventory sale deleted successfully", indicator: "green"});
                                            fetch_drystock_history($wrapper);
                                            refresh_drystock_cart($wrapper);
                                        }
                                    });
                                } else {
                                    frappe.show_alert({message: "Record not found in active shift", indicator: "red"});
                                }
                            }
                        }
                    });
                });
            });
        }
    });
}

function refresh_drystock_cart($wrapper) {
    let html = '';
    let is_locked = window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.status !== "Open" && !(frappe.user.has_role("System Manager") || frappe.user.has_role("Fuel Station Owner"));
    
    let total_qty = 0;
    let total_volume = 0;
    let total_amount = 0;

    let cart_items = window.PENDING_DRYSTOCK || [];

    if (cart_items.length === 0) {
        html = `<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 2.5rem;">Cart is empty &bull; Select an inventory item above and click "+ Add Item"</td></tr>`;
    } else {
        cart_items.forEach((row, idx) => {
            total_qty += row.quantity || 0;
            total_volume += row.total_volume || (row.quantity * (row.uom_multiplier || 1)) || 0;
            total_amount += row.amount || 0;
            
            let csa_name = row.sold_by;
            if (window.USERS_LIST) {
                let u = window.USERS_LIST.find(u => u.name === row.sold_by);
                if (u) csa_name = u.employee_name || u.full_name;
            }
            
            let del_btn = is_locked ? 
                `<button class="btn btn-xs btn-danger" disabled>✕</button>` : 
                `<button class="btn btn-xs btn-danger btn-remove-drystock" data-idx="${idx}" style="border-radius:6px; padding:4px 8px; font-weight:700;" title="Remove Item">✕</button>`;
            
            let item_obj = (window.DRYSTOCK_ITEMS || []).find(i => i.item_code === row.item || i.item_name === row.item);
            let display_name = item_obj ? (item_obj.item_name || item_obj.item_code) : (row.item_name || row.item);
            let category = item_obj ? (item_obj.item_group || 'Stock') : 'Stock';

            let price_str = parseFloat(row.selling_price || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            let amount_str = parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

            html += `
                <tr data-idx="${idx}">
                    <td style="font-family: monospace; color: #64748b; font-weight:700; text-align:center;">#${idx + 1}</td>
                    <td><strong style="color: #0f172a; font-size: 0.92rem;">${frappe.utils.escape_html(display_name)}</strong></td>
                    <td><span class="badge" style="background-color: #f1f5f9; color: #475569; font-weight: 600;">${frappe.utils.escape_html(category)}</span></td>
                    <td style="color: #475569;">${frappe.utils.escape_html(csa_name || '-')}</td>
                    <td style="text-align: center;"><strong style="color: #047857; font-size: 0.95rem;">${row.quantity}</strong></td>
                    <td style="text-align: right; color: #64748b; font-family: monospace;">${price_str}</td>
                    <td style="text-align: center; color: #64748b;">${parseFloat(row.total_volume || (row.quantity * (row.uom_multiplier || 1)) || 0).toFixed(2)}</td>
                    <td style="text-align: right;"><strong style="color: #047857; font-size: 0.95rem; font-family: monospace;">${amount_str}</strong></td>
                    <td style="text-align: center;">${del_btn}</td>
                </tr>
            `;
        });
    }
    
    $wrapper.find('#list-drystock').html(html);
    $wrapper.find('#drystock-total-qty').text(total_qty);
    $wrapper.find('#drystock-total-volume').text(total_volume.toFixed(2));
    $wrapper.find('#drystock-total-amount').text(total_amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));

    $wrapper.find('.btn-remove-drystock').off('click').on('click', function() {
        if (is_locked) return;
        let idx = parseInt($(this).attr('data-idx'));
        window.PENDING_DRYSTOCK.splice(idx, 1);
        refresh_drystock_cart($wrapper);
    });
}

function setup_tabs(wrapper) {
    const $wrapper = $(wrapper);
    
    // Sidebar Toggle
    $wrapper.on('click', '#sidebar-toggle', function() {
        $wrapper.find('.sidebar').toggleClass('sidebar-collapsed');
    });

    $wrapper.on('click', '.seg-btn', function() {
        let $btn = $(this);
        let view = $btn.attr('data-view');
        let $tab = $btn.closest('.tab-pane');
        
        $tab.find('.seg-btn').removeClass('active');
        $btn.addClass('active');
        
        $tab.find('.view-pane').removeClass('active');
        $tab.find('.view-pane[id$="-' + view + '-view"]').addClass('active');

        if ($tab.attr('id') === 'tab-drystock' && view === 'history' && typeof fetch_drystock_history === 'function') {
            fetch_drystock_history($wrapper);
        }
        if ($tab.attr('id') === 'tab-invoices' && view === 'history' && typeof fetch_invoice_history === 'function') {
            fetch_invoice_history($wrapper);
        }
        if ($tab.attr('id') === 'tab-invoices' && view === 'discounts' && typeof fetch_discounts_report === 'function') {
            fetch_discounts_report($wrapper);
        }
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
        
        // Check for specific tab renders
        if (target === 'tab-inventory') {
            render_inventory_status($wrapper);
        } else if (target === 'tab-drystock') {
            render_drystock($wrapper);
        } else if (target === 'tab-invoices') {
            render_invoices($wrapper);
        } else if (target === 'tab-forecourt-inventory') {
            render_warehouse_inventory($wrapper, 'forecourt');
        } else if (target === 'tab-store-inventory') {
            render_warehouse_inventory($wrapper, 'store');
        } else if (target === 'tab-stock-transfer') {
            render_stock_transfer($wrapper);
        } else if (target === 'tab-borrowed') {
            render_borrowed_products($wrapper);
        } else if (target === 'tab-report') {
            if (typeof window.generate_end_shift_report === 'function') {
                window.generate_end_shift_report($wrapper);
            }
        } else if (target === 'tab-past-reports') {
            if (typeof render_past_reports === 'function') {
                render_past_reports($wrapper);
            }
        } else if (target === 'tab-customer-payments') {
            if (typeof render_customer_payments === 'function') {
                render_customer_payments($wrapper);
            }
        } else if (target === 'tab-reconcile') {
            if (typeof render_reconcile === 'function') {
                render_reconcile($wrapper);
            }
        } else if (target === 'tab-petty-cash') {
            if (typeof render_petty_cash === 'function') {
                render_petty_cash($wrapper);
            }
        } else if (target === 'tab-shorts-report') {
            if (typeof render_shorts_report === 'function') {
                render_shorts_report($wrapper);
            }
        } else if (target === 'tab-shortage-mgmt') {
            if (typeof render_shortage_mgmt === 'function') {
                render_shortage_mgmt($wrapper);
            }
        } else if (target === 'tab-purchases') {
            if (typeof render_purchases === 'function') {
                render_purchases($wrapper);
            }
        } else if (target === 'tab-dips') {
            if (typeof render_dips === 'function') {
                render_dips($wrapper);
            }
        } else if (target === 'tab-debtors') {
            let subview = $(this).attr('data-debtors-subview') || 'balances';
            if (typeof window.switch_debtors_subview === 'function') {
                window.switch_debtors_subview(subview);
            }
        }
        
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
    // Fetch Active Items for Dry Stock
    frappe.call({
        method: "fuel_management.fuel_management.api.get_active_item_prices",
        callback: function(r) {
            if(r.message) {
                window.DRYSTOCK_ITEMS = r.message;
                window.INVOICE_ITEMS = r.message;
                let st_options = '';
                r.message.forEach(item => {
                    let displayName = item.item_name || item.item_code;
                    st_options += `<option data-value="${item.item_code}" value="${displayName}"></option>`;
                });
                $(wrapper).find('#stock-transfer-item-list').html(st_options);
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
                
                let default_station = frappe.defaults.get_user_default("Fuel Station") || frappe.defaults.get_user_default("station");
                if (default_station) {
                    $(wrapper).find('#select-station').val(default_station);
                }
                
                $(wrapper).find('#select-station').on('change', function() {
                    let station = $(this).val();
                    if(station) {
                        frappe.db.get_list('Shift', {
                            filters: { station: station },
                            fields: ['name', 'shift_template', 'shift_date'],
                            limit: 1,
                            order_by: 'creation desc'
                        }).then(r => {
                            if (r && r.length > 0) {
                                let last_shift = r[0];
                                $(wrapper).find('#previous-shift-badge').text(`Last Shift: ${last_shift.shift_template} (${frappe.datetime.str_to_user(last_shift.shift_date)})`).removeClass('hidden');
                                
                                // Smart Prediction Logic
                                if (window.SHIFT_TEMPLATES) {
                                    let last_template = window.SHIFT_TEMPLATES.find(t => t.name === last_shift.shift_template);
                                    if (last_template && last_template.next_shift_template) {
                                        let next_date_obj = frappe.datetime.str_to_obj(last_shift.shift_date);
                                        if (last_template.rolls_over_date) {
                                            next_date_obj.setDate(next_date_obj.getDate() + 1);
                                        }
                                        let next_date_str = frappe.datetime.obj_to_str(next_date_obj);
                                        
                                        // Update UI
                                        $(wrapper).find('#input-shift-date').val(next_date_str);
                                        $(wrapper).find('#select-shift-template').val(last_template.next_shift_template);
                                    }
                                }
                            } else {
                                $(wrapper).find('#previous-shift-badge').addClass('hidden');
                            }
                        });
                    } else {
                        $(wrapper).find('#previous-shift-badge').addClass('hidden');
                    }
                });
                // Trigger change immediately to load for default station
                $(wrapper).find('#select-station').trigger('change');
            }
        }
    });

    // Fetch Fuel Shift Templates
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Fuel Shift Template",
            fields: ["name", "start_time", "end_time", "next_shift_template", "rolls_over_date"]
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
            fields: ["name"],
            limit_page_length: 0
        },
        callback: function(r) {
            if(r.message) {
                window.PUMP_GROUPS_LIST = sort_pump_groups(r.message);
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
                r.message.sort((a,b) => (a.full_name || "").localeCompare(b.full_name || ""));
                let options = '<option value="">Select Head CSA...</option>';
                r.message.forEach(u => {
                    let selected = (u.name === frappe.session.user) ? 'selected' : '';
                    options += `<option value="${u.name}" ${selected}>${u.full_name}</option>`;
                });
                $(wrapper).find('#select-head-csa').html(options).prop('disabled', true).css({'background-color': '#f1f5f9', 'cursor': 'not-allowed'});
            }
        }
    });

    // Fetch Employees (for pump attendants, using legacy USERS_LIST variable)
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Employee",
            filters: { status: "Active" },
            fields: ["name", "employee_name", "user_id"],
            limit_page_length: 0
        },
        callback: function(r) {
            if(r.message) {
                window.USERS_LIST = r.message;
                window.USERS_LIST.sort((a,b) => (a.employee_name || a.full_name || a.name || "").localeCompare(b.employee_name || b.full_name || b.name || ""));
                render_pump_group_rows($(wrapper));
            }
        }
    });

    function render_pump_group_rows($w) {
        if(!window.USERS_LIST || window.USERS_LIST.length === 0) return;
        if(!window.PUMP_GROUPS_LIST || window.PUMP_GROUPS_LIST.length === 0) return;
        
        window.PUMP_GROUPS_LIST = sort_pump_groups(window.PUMP_GROUPS_LIST);
        
        let csaOptions = '<option value="">Select CSA...</option>';
        window.USERS_LIST.forEach(u => { csaOptions += `<option value="${u.name}">${u.employee_name}</option>`; });
        
        let html = '';
        window.PUMP_GROUPS_LIST.forEach(pg => {
            html += `
             <div class="assignment-row" data-pg="${pg.name}">
                 <label class="block text-xs font-bold text-slate-500 uppercase mb-1">${pg.name}</label>
                 <select class="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-2 text-slate-800 csa-select">${csaOptions}</select>
             </div>
            `;
        });
        $w.find('#csa-assignment-body').html(html);
        
        // Prefill if already loaded
        if(window.SHIFT_DOC && window.SHIFT_DOC.assigned_csas) {
            window.SHIFT_DOC.assigned_csas.forEach(a => {
                let row = $w.find(`.assignment-row[data-pg="${a.pump_group}"]`);
                if(row.length) {
                    row.find('.csa-select').val(a.csa);
                }
            });
        }
    }
}

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
                let modified = false;
                rows_data.forEach(updated_row => {
                    let existing = doc[table_name].find(d => d.name === updated_row.name);
                    if(existing) {
                        Object.assign(existing, updated_row);
                        modified = true;
                    }
                });
                
                if (!modified) {
                    frappe.msgprint("Warning: Rows were not found in the current shift document. Try refreshing the page.");
                    if(btn) { btn.find('.spinner').addClass('hidden'); btn.prop('disabled', false); if(originalText) btn.html(originalText); }
                    return;
                }

                frappe.call({
                    method: "frappe.client.save",
                    args: { doc: doc },
                    callback: function(r2) {
                        if(r2.message) {
                            window.SHIFT_DOC = r2.message;
                            frappe.show_alert({message: success_msg, indicator: "green"});
                        }
                    },
                    error: function(r) {
                        frappe.msgprint("Failed to save data. Please check the error logs or refresh the page.");
                    },
                    always: function() {
                        if(btn) { btn.find('.spinner').addClass('hidden'); btn.prop('disabled', false); if(originalText) btn.html(originalText); }
                        if(callback) callback();
                    }
                });
            } else {
                frappe.msgprint("Failed to load shift document.");
                if(btn) { btn.find('.spinner').addClass('hidden'); btn.prop('disabled', false); if(originalText) btn.html(originalText); }
            }
        }
    });
}

function setup_actions(wrapper) {
    const $wrapper = $(wrapper);
    
    // Home Dashboard Daily Sales Breakdown & Quick Actions
    $wrapper.off('click', '.btn-open-dsb').on('click', '.btn-open-dsb', function() {
        let metric = $(this).attr('data-metric') || 'all';
        if (typeof window.open_daily_sales_breakdown === 'function') {
            window.open_daily_sales_breakdown(metric);
        }
    });

    $wrapper.off('click', '.btn-close-dsb, #modal-dsb-close').on('click', '.btn-close-dsb, #modal-dsb-close', function() {
        if (typeof window.close_daily_sales_breakdown === 'function') {
            window.close_daily_sales_breakdown();
        }
    });

    $wrapper.off('click', '.dsb-filter-pill').on('click', '.dsb-filter-pill', function() {
        let focus = $(this).attr('data-focus') || 'all';
        if (typeof window.filter_dsb_focus === 'function') {
            window.filter_dsb_focus(focus);
        }
    });

    $wrapper.off('click', '.home-quick-action[data-nav]').on('click', '.home-quick-action[data-nav]', function(e) {
        e.preventDefault();
        let targetTab = $(this).attr('data-nav');
        if (targetTab) {
            $wrapper.find(`[data-target="${targetTab}"]`).click();
        }
    });

    // Bind Dry Stock History Filters
    $wrapper.find('#drystock-filter-start-date, #drystock-filter-end-date').off('change').on('change', function() {
        if(typeof fetch_drystock_history === 'function') {
            fetch_drystock_history($wrapper);
        }
    });
    $wrapper.find('#drystock-filter-search').off('keyup input').on('keyup input', function() {
        clearTimeout(window._drystock_search_timeout);
        window._drystock_search_timeout = setTimeout(() => {
            if(typeof fetch_drystock_history === 'function') {
                fetch_drystock_history($wrapper);
            }
        }, 300);
    });

    // M-Pesa Segmented Control
    $wrapper.find('#tab-mpesa .seg-btn').off('click').on('click', function() {
        let targetView = $(this).attr('data-view');
        $wrapper.find('#tab-mpesa .seg-btn').removeClass('active');
        $(this).addClass('active');
        
        $wrapper.find('#tab-mpesa .view-pane').removeClass('active');
        $wrapper.find(`#mpesa-${targetView}-view`).addClass('active');
    });
    
    // Update Assignments Logic
    $wrapper.find('#btn-update-assignments').on('click', function() {
        if(!window.ACTIVE_SHIFT) return;
        let btn = $(this);
        let assigned_csas = [];
        $wrapper.find('#csa-assignment-body div[data-pg]').each(function() {
            let csa = $(this).find('.csa-select').val();
            let pg = $(this).attr('data-pg');
            if(csa) {
                assigned_csas.push({
                    "csa": csa,
                    "pump_group": pg
                });
            }
        });
        
        btn.find('.spinner').removeClass('hidden');
        btn.prop('disabled', true);
        
        frappe.call({
            method: "frappe.client.set_value",
            args: {
                doctype: "Shift",
                name: window.ACTIVE_SHIFT.name,
                fieldname: {
                    "assigned_csas": assigned_csas
                }
            },
            callback: function(r) {
                btn.find('.spinner').addClass('hidden');
                btn.prop('disabled', false);
                if(!r.exc) {
                    frappe.show_alert({message: "Pump Assignments Updated Successfully!", indicator: "green"});
                    window.SHIFT_DOC.assigned_csas = assigned_csas;
                    window.ACTIVE_SHIFT.assigned_csas = assigned_csas;
                }
            }
        });
    });

    // Start Shift Logic
    $wrapper.find('#btn-start-shift').on('click', function() {
        const station = $wrapper.find('#select-station').val();
        const head_csa = $wrapper.find('#select-head-csa').val();
        const shift_date = $wrapper.find('#input-shift-date').val();
        const shift_template = $wrapper.find('#select-shift-template').val();
        
        let assigned_csas = [];
        let unassigned_pgs = [];
        let csa_names = [];
        $wrapper.find('#csa-assignment-body div[data-pg]').each(function() {
            let $select = $(this).find('.csa-select');
            let csa = $select.val();
            let pg = $(this).attr('data-pg');
            if(csa) {
                assigned_csas.push({
                    "csa": csa,
                    "pump_group": pg
                });
                let csa_name = $select.find('option:selected').text();
                csa_names.push(`<b>${pg}:</b> ${csa_name}`);
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
        
        let confirm_html = `You are starting a <b>${shift_template}</b> for Date <b>${shift_date}</b>.<br><br><span style="color:var(--primary); font-size:1.1em; font-weight:600;">Assignments:</span><br>` + csa_names.join('<br>') + `<br><br>Is this correct?`;
        
        frappe.confirm(confirm_html, () => {
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
                        window.SHIFT_DOC = null; // Force reload of new shift data
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

    
    $wrapper.find('#btn-save-dips').off('click').on('click', function() {
        let btn = $(this);
        let orig_html = btn.html();

        if (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.status !== "Open" && !(frappe.user.has_role("System Manager") || frappe.user.has_role("Fuel Station Owner"))) {
            frappe.show_alert({message: "This shift is closed. Only System Managers or Fuel Station Owners can modify data.", indicator: "red"});
            return;
        }

        let readings = [];
        $wrapper.find('#dips-container tr').each(function() {
            let rowName = $(this).attr('data-name');
            let openingVal = parseFloat($(this).find('.dip-opening').text().replace(/,/g, '')) || 0;
            let closingStr = $(this).find('.dip-closing').val();
            let closingVal = (closingStr !== "" && closingStr !== null && closingStr !== undefined) ? parseFloat(closingStr) : null;
            readings.push({
                name: rowName,
                opening_dip: openingVal,
                closing_dip: closingVal
            });
        });

        // Show Loading Overlay and Button Spinner
        frappe.dom.freeze("Saving Dip Stick Readings...");
        btn.html('<span class="spinner-border spinner-border-sm" style="width: 14px; height: 14px;"></span> Saving...').prop('disabled', true);

        save_child_table("dip_stick_readings", readings, "Dip Sticks saved successfully!", btn, orig_html, function() {
            frappe.dom.unfreeze();
            if (typeof fetch_dips_history === 'function') {
                fetch_dips_history($wrapper);
            }
            if (window.render_homepage) {
                window.render_homepage($wrapper);
            }
            // Switch to Historical View
            $wrapper.find('#tab-dips .seg-btn[data-view="history"]').click();
        });
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
            $wrapper.find('#tab-mpesa .seg-btn[data-view="history"]').click();
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
            return { ...r, name: r._is_new ? undefined : r.name };
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
                                $wrapper.find('#tab-drystock .seg-btn[data-view="history"]').click();
                                if (typeof fetch_drystock_history === 'function') {
                                    fetch_drystock_history($wrapper);
                                }
                            }
                            btn.prop('disabled', false).html(originalHTML);
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
          
          if (!window.ACTIVE_SHIFT.report_sent) {
              frappe.msgprint({
                  title: __('Action Required'),
                  indicator: 'orange',
                  message: __('You must generate and send the End Shift Report to the owner before closing this shift. Please go to the "End Shift Report" tab and click "Send Report to Owner".')
              });
              return;
          }
        
        const cashCaptured = $wrapper.find('#chk-cash-captured').is(':checked');
        const reportsPrinted = $wrapper.find('#chk-reports-printed').is(':checked');
        
        if(!cashCaptured || !reportsPrinted) {
            frappe.show_alert({message: "You must complete the entire Pre-Close Checklist before closing.", indicator: "red"});
            return;
        }
        
        let actual_fuel_cash = parseFloat($wrapper.find('#actual-cash-input').val()) || 0;
        let actual_drystock_cash = parseFloat($wrapper.find('#actual-drystock-cash-input').val()) || 0;

        frappe.confirm('Are you absolutely sure you want to close this shift? This will permanently lock the data and generate accounting entries.', () => {
            let overlay = $(`
                <div id="close-shift-overlay" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); z-index: 99999; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; backdrop-filter: blur(4px);">
                    <div style="border: 4px solid #333; border-top: 4px solid #ef4444; border-radius: 50%; width: 60px; height: 60px; animation: spin 1s linear infinite; margin-bottom: 25px;"></div>
                    <h2 style="margin: 0; color: white; font-size: 1.5rem; font-weight: 600;">Closing Shift & Locking Data...</h2>
                    <p style="margin-top: 15px; color: #cbd5e1; font-size: 1rem;">Generating accounting entries. Please wait.</p>
                    <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                </div>
            `);
            $('body').append(overlay);

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
                                    $('#close-shift-overlay h2').text('Shift Closed successfully!');
                                    $('#close-shift-overlay p').text('Reloading dashboard...');
                                    $('#close-shift-overlay div:first').hide();
                                    setTimeout(() => {
                                        location.reload();
                                    }, 2000);
                                } else {
                                    $('#close-shift-overlay').remove();
                                }
                            },
                            error: function() {
                                $('#close-shift-overlay').remove();
                            }
                        });
                    } else {
                        $('#close-shift-overlay').remove();
                    }
                },
                error: function() {
                    $('#close-shift-overlay').remove();
                }
            });
        });
    });

    // Email Shift Report Logic
    $wrapper.find('#btn-email-shift-report').on('click', function() {
        if(!window.ACTIVE_SHIFT) return;
        
        let btn = $wrapper.find('#btn-email-shift-report');
        let origHTML = btn.html();
        btn.html('<span class="spinner-border spinner-border-sm"></span> Sending...').prop('disabled', true);
        
        frappe.call({
            method: "fuel_management.fuel_management.api.email_shift_report",
            args: {
                shift_name: window.ACTIVE_SHIFT.name
            },
            callback: function(r) {
                btn.html(origHTML).prop('disabled', false);
                if(r.message && r.message.status === 'success') {
                    frappe.show_alert({message: r.message.message, indicator: "green"});
                } else if(r.message && r.message.status === 'error') {
                    frappe.show_alert({message: r.message.message, indicator: "red"});
                } else {
                    frappe.show_alert({message: "Failed to send email. Check error logs.", indicator: "red"});
                }
            }
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

    // Segmented Control for tab-invoices
    $wrapper.find('#tab-invoices .seg-btn').off('click').on('click', function() {
        let $btn = $(this);
        let targetView = $btn.attr('data-view');
        
        $wrapper.find('#tab-invoices .seg-btn').removeClass('active');
        $btn.addClass('active');
        
        $wrapper.find('#tab-invoices .view-pane').removeClass('active');
        $wrapper.find(`#invoice-${targetView}-view`).addClass('active');
        
        if (targetView === 'discounts') {
            fetch_discounts_report($wrapper);
        } else if (targetView === 'history') {
            fetch_invoice_history($wrapper);
        }
    });

    // 1. Fetch & Display Continuous Next Entry Number (e.g. INV006)
    function refresh_next_entry_badge() {
        if (window.EDITING_INVOICE_ENTRY_NUMBER) {
            $wrapper.find('#invoice-entry-number').text(`${window.EDITING_INVOICE_ENTRY_NUMBER} (Editing)`);
            return;
        }
        if (window.PENDING_INVOICES && window.PENDING_INVOICES.length > 0 && window.PENDING_INVOICES[0].entry_number) {
            $wrapper.find('#invoice-entry-number').text(window.PENDING_INVOICES[0].entry_number);
            return;
        }
        
        frappe.call({
            method: "fuel_management.fuel_management.api.get_next_shift_invoice_number",
            args: { station: window.ACTIVE_SHIFT.station },
            callback: function(r) {
                if (r.message && r.message.next_invoice_number) {
                    window.CURRENT_NEXT_INVOICE_NUMBER = r.message.next_invoice_number;
                    if (!window.EDITING_INVOICE_ENTRY_NUMBER && (!window.PENDING_INVOICES || window.PENDING_INVOICES.length === 0)) {
                        $wrapper.find('#invoice-entry-number').text(r.message.next_invoice_number);
                    }
                }
            }
        });
    }

    refresh_next_entry_badge();

    // 2. Fetch Active CSAs
    let csaOptions = '<option value="">Select CSA...</option>';
    let allowed_csas = [];
    if(window.SHIFT_DOC.head_csa) {
        let head_emp = window.USERS_LIST ? window.USERS_LIST.find(u => u.user_id === window.SHIFT_DOC.head_csa) : null;
        if (head_emp) allowed_csas.push(head_emp.name);
    }
    (window.SHIFT_DOC.assigned_csas || []).forEach(row => {
        if(row.csa) allowed_csas.push(row.csa);
    });
    
    // Remove duplicates
    allowed_csas = [...new Set(allowed_csas)];
    
    let sorted_csas = allowed_csas.map(csa => {
        let u = window.USERS_LIST ? window.USERS_LIST.find(u => u.name === csa) : null;
        let name = u ? (u.employee_name || u.full_name) : csa;
        return {csa, name};
    }).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
    
    sorted_csas.forEach(item => {
        csaOptions += `<option value="${item.csa}">${item.name}</option>`;
    });

    $wrapper.find('#invoice-csa').html(csaOptions);
    $wrapper.find('#invoice-inventory-csa').html(csaOptions);

    // Populate Discount Beneficiary CSA (can relieve any active or station CSA)
    let discCsaOptions = '<option value="">Select CSA to Relieve...</option>';
    if (window.USERS_LIST && window.USERS_LIST.length > 0) {
        window.USERS_LIST.forEach(u => {
            let name = u.employee_name || u.full_name || u.name;
            discCsaOptions += `<option value="${u.name}">${name}</option>`;
        });
    } else {
        sorted_csas.forEach(item => {
            discCsaOptions += `<option value="${item.csa}">${item.name}</option>`;
        });
    }
    $wrapper.find('#invoice-discount-csa').html(discCsaOptions);

    // Auto default discount CSA when invoice CSA changes
    $wrapper.find('#invoice-csa').off('change').on('change', function() {
        let sel = $(this).val();
        if (sel && !$wrapper.find('#invoice-discount-csa').val()) {
            $wrapper.find('#invoice-discount-csa').val(sel);
        }
    });

    // Auto-detect designated Lubes & Accessories CSA
    let default_lubes_csa = '';
    if (window.SHIFT_DOC && window.SHIFT_DOC.assigned_csas) {
        let lubes_row = window.SHIFT_DOC.assigned_csas.find(r => {
            if (!r.pump_group) return false;
            let pg = r.pump_group.toUpperCase();
            return pg.includes('LUBE') || pg.includes('ACCESSOR') || pg.includes('DRYSTOCK') || pg.includes('STORE');
        });
        if (lubes_row && lubes_row.csa) {
            default_lubes_csa = lubes_row.csa;
        }
    }
    if (default_lubes_csa) {
        $wrapper.find('#invoice-inventory-csa').val(default_lubes_csa);
    }

    function is_non_fuel_item(item_obj) {
        if (!item_obj) return false;
        let group = (item_obj.item_group || '').toUpperCase().trim();
        if (group === 'FUEL' || group === 'FUELS' || group.includes('FUEL')) {
            return false;
        }
        let name = (item_obj.item_name || item_obj.item_code || item_obj.name || '').toUpperCase().trim();
        if (name.includes('PETROL') || name.includes('DIESEL') || name.includes('KEROSENE') || 
            name.includes('AGO') || name.includes('PMS') || name.includes('IK') || 
            name.includes('SUPER UNLEADED') || name.includes('SUPER') || name.includes('REGULAR')) {
            return false;
        }
        return true;
    }

    function is_greasing_service_item(item_obj) {
        if (!item_obj) return false;
        let group = (item_obj.item_group || '').toUpperCase().trim();
        let name = (item_obj.item_name || item_obj.item_code || item_obj.name || '').toUpperCase().trim();
        if (group.includes('GREAS') || name.startsWith('GREASING') || name.includes('GREASE')) {
            return true;
        }
        return false;
    }

    // Ensure items are loaded
    if (!window.INVOICE_ITEMS || window.INVOICE_ITEMS.length === 0) {
        window.INVOICE_ITEMS = window.DRYSTOCK_ITEMS || [];
        if (!window.INVOICE_ITEMS || window.INVOICE_ITEMS.length === 0) {
            frappe.call({
                method: "fuel_management.fuel_management.api.get_active_item_prices",
                callback: function(r) {
                    if (r.message) {
                        window.DRYSTOCK_ITEMS = r.message;
                        window.INVOICE_ITEMS = r.message;
                    }
                }
            });
        }
    }

    // -------------------------------------------------------------
    // SEARCHABLE COMBOBOX: CUSTOMER
    // -------------------------------------------------------------
    function render_customer_dropdown(filter_text = '') {
        let customers = window.CUSTOMERS_LIST || [];
        let query = (filter_text || '').toLowerCase().trim();
        let matches = customers.filter(c => {
            let name = (c.customer_name || c.name || '').toLowerCase();
            let code = (c.name || '').toLowerCase();
            return !query || name.includes(query) || code.includes(query);
        });

        let html = '';
        if (matches.length === 0) {
            html = '<div style="padding: 0.75rem 1rem; color: #94a3b8; font-size: 0.85rem; text-align: center;">No matching customers found</div>';
        } else {
            matches.slice(0, 80).forEach(c => {
                let displayName = c.customer_name || c.name;
                html += `
                    <div class="combobox-item invoice-cust-opt" data-id="${c.name}" data-name="${frappe.utils.escape_html(displayName)}">
                        <div style="font-weight: 700; color: #0f172a;">${frappe.utils.escape_html(displayName)}</div>
                    </div>
                `;
            });
        }
        $wrapper.find('#invoice-customer-dropdown').html(html).show();
    }

    function select_customer(id, name) {
        $wrapper.find('#invoice-customer-hidden').val(id);
        $wrapper.find('#invoice-customer-input').val(name);
        $wrapper.find('#invoice-customer-dropdown').hide();

        // Update Vehicles
        $wrapper.find('#invoice-vehicles-list').empty();
        if (id) {
            let unique_v = [];
            if (window.SHIFT_DOC && window.SHIFT_DOC.invoices) {
                window.SHIFT_DOC.invoices.forEach(row => {
                    if (row.customer === id && row.vehicle_registration) {
                        unique_v.push(row.vehicle_registration);
                    }
                });
            }
            unique_v = [...new Set(unique_v)];
            let vOpts = '';
            unique_v.forEach(v => {
                if (v) vOpts += `<option value="${v}">`;
            });
            $wrapper.find('#invoice-vehicles-list').html(vOpts);
        }
    }

    $wrapper.find('#invoice-customer-input').off('focus input').on('focus input', function() {
        let txt = $(this).val();
        render_customer_dropdown(txt);
    });

    $wrapper.find('#btn-toggle-customer-dropdown').off('click').on('click', function(e) {
        e.stopPropagation();
        let $dd = $wrapper.find('#invoice-customer-dropdown');
        if ($dd.is(':visible')) {
            $dd.hide();
        } else {
            $wrapper.find('#invoice-customer-input').focus();
            render_customer_dropdown($wrapper.find('#invoice-customer-input').val());
        }
    });

    $wrapper.find('#invoice-customer-dropdown').off('click', '.invoice-cust-opt').on('click', '.invoice-cust-opt', function() {
        let id = $(this).attr('data-id');
        let name = $(this).attr('data-name');
        select_customer(id, name);
    });

    // -------------------------------------------------------------
    // SEARCHABLE COMBOBOX: PRODUCT / ITEM
    // -------------------------------------------------------------
    function render_item_dropdown(filter_text = '') {
        let items = window.INVOICE_ITEMS || window.DRYSTOCK_ITEMS || [];
        let query = (filter_text || '').toLowerCase().trim();

        let greasing_items = [];
        let fuel_items = [];
        let lube_items = [];
        let gas_items = [];
        let other_items = [];

        items.forEach(i => {
            let grp = (i.item_group || '').toUpperCase();
            let nm = (i.item_name || i.item_code || '').toUpperCase();
            let matches_query = !query || nm.toLowerCase().includes(query) || grp.toLowerCase().includes(query) || (i.item_code || '').toLowerCase().includes(query);

            if (!matches_query) return;

            if (grp.includes('GREAS') || nm.startsWith('GREASING') || nm.includes('GREASE')) {
                greasing_items.push(i);
            } else if (grp.includes('FUEL') || nm.includes('PMS') || nm.includes('AGO') || nm.includes('IK') || nm.includes('PETROL') || nm.includes('DIESEL') || nm.includes('KEROSENE') || nm.includes('SUPER')) {
                fuel_items.push(i);
            } else if (grp.includes('LUBE') || grp.includes('OIL') || nm.includes('HELIX') || nm.includes('RIMULA') || nm.includes('BRAKE') || nm.includes('COOLANT')) {
                lube_items.push(i);
            } else if (grp.includes('GAS') || grp.includes('LPG') || nm.includes('LPG') || nm.includes('GAS') || nm.includes('CYLINDER')) {
                gas_items.push(i);
            } else {
                other_items.push(i);
            }
        });

        let html = '';
        let total_count = greasing_items.length + fuel_items.length + lube_items.length + gas_items.length + other_items.length;

        if (total_count === 0) {
            html = '<div style="padding: 0.75rem 1rem; color: #94a3b8; font-size: 0.85rem; text-align: center;">No matching products found</div>';
        } else {
            function build_group_html(label, list, badge_type) {
                if (list.length === 0) return '';
                let g_html = `<div class="combobox-group-header">${label}</div>`;
                list.forEach(i => {
                    let suffix = badge_type === 'fuel' ? '/L' : (badge_type === 'service' ? '/Veh' : '');
                    let rate_str = i.price_list_rate ? `KES ${parseFloat(i.price_list_rate).toFixed(2)}${suffix}` : '';
                    let badge_color = badge_type === 'fuel' ? '#047857' : (badge_type === 'service' ? '#b45309' : '#7c3aed');
                    let badge_bg = badge_type === 'fuel' ? '#ecfdf5' : (badge_type === 'service' ? '#fef3c7' : '#faf5ff');
                    g_html += `
                        <div class="combobox-item invoice-item-opt" data-id="${i.item_code}" data-name="${frappe.utils.escape_html(i.item_name || i.item_code)}" data-rate="${i.price_list_rate || 0}">
                            <div style="font-weight: 700; color: #0f172a;">${frappe.utils.escape_html(i.item_name || i.item_code)}</div>
                            <span style="font-size: 0.8rem; font-weight: 800; color: ${badge_color}; background: ${badge_bg}; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${rate_str}</span>
                        </div>
                    `;
                });
                return g_html;
            }

            html += build_group_html('🚗 Greasing Services (Packages)', greasing_items, 'service');
            html += build_group_html('⛽ Fuel Products (PMS / AGO / IK)', fuel_items, 'fuel');
            html += build_group_html('📦 Lubricants & Engine Oils', lube_items, 'other');
            html += build_group_html('🔥 Gas / LPG Cylinders', gas_items, 'other');
            html += build_group_html('🔧 Accessories & Other Stock', other_items, 'other');
        }

        $wrapper.find('#invoice-item-dropdown').html(html).show();
    }

    function select_item(code, name, rate) {
        $wrapper.find('#invoice-item-hidden').val(code);
        $wrapper.find('#invoice-item-input').val(name);
        $wrapper.find('#invoice-item-dropdown').hide();

        let item = (window.INVOICE_ITEMS || []).find(i => i.item_code === code);
        let actual_rate = (item && item.price_list_rate) ? item.price_list_rate : (rate || 0);
        
        $wrapper.find('#invoice-rate').val(parseFloat(actual_rate).toFixed(2));
        
        update_inventory_csa_visibility();
    }

    $wrapper.find('#invoice-item-input').off('focus input blur change').on('focus input', function() {
        let txt = $(this).val();
        render_item_dropdown(txt);
    }).on('blur change', function() {
        update_inventory_csa_visibility();
    });

    $wrapper.find('#btn-toggle-item-dropdown').off('click').on('click', function(e) {
        e.stopPropagation();
        let $dd = $wrapper.find('#invoice-item-dropdown');
        if ($dd.is(':visible')) {
            $dd.hide();
        } else {
            $wrapper.find('#invoice-item-input').focus();
            render_item_dropdown($wrapper.find('#invoice-item-input').val());
        }
    });

    $wrapper.find('#invoice-item-dropdown').off('click', '.invoice-item-opt').on('click', '.invoice-item-opt', function() {
        let id = $(this).attr('data-id');
        let name = $(this).attr('data-name');
        let rate = $(this).attr('data-rate');
        select_item(id, name, rate);
    });

    // Close dropdowns on outside click
    $(document).off('click.invoice_combobox').on('click.invoice_combobox', function(e) {
        if (!$(e.target).closest('.searchable-combobox-wrap').length) {
            $wrapper.find('#invoice-customer-dropdown, #invoice-item-dropdown').hide();
        }
    });

    function update_inventory_csa_visibility() {
        let selected_code = ($wrapper.find('#invoice-item-hidden').val() || '').trim();
        let input_name = ($wrapper.find('#invoice-item-input').val() || '').trim();
        
        let selected_item = null;
        if (selected_code) {
            selected_item = (window.INVOICE_ITEMS || []).find(i => i.item_code === selected_code);
        }
        if (!selected_item && input_name) {
            selected_item = (window.INVOICE_ITEMS || []).find(i => 
                (i.item_name && i.item_name.toLowerCase() === input_name.toLowerCase()) || 
                (i.item_code && i.item_code.toLowerCase() === input_name.toLowerCase())
            );
            if (selected_item) {
                $wrapper.find('#invoice-item-hidden').val(selected_item.item_code);
                $wrapper.find('#invoice-rate').val(parseFloat(selected_item.price_list_rate || 0).toFixed(2));
            }
        }

        let is_greasing_selected = selected_item && is_greasing_service_item(selected_item);
        let has_non_fuel_selected = selected_item && is_non_fuel_item(selected_item);
        
        let has_pure_drystock_selected = has_non_fuel_selected && !is_greasing_selected;
        let has_pure_drystock_in_cart = (window.PENDING_INVOICES || []).some(p => {
            let p_item = (window.INVOICE_ITEMS || []).find(i => i.item_code === p.item || i.item_name === p.item);
            return p_item ? (is_non_fuel_item(p_item) && !is_greasing_service_item(p_item)) : false;
        });

        if (has_pure_drystock_selected || has_pure_drystock_in_cart) {
            $wrapper.find('#invoice-inventory-csa-group').show();
            let current_inv_csa = $wrapper.find('#invoice-inventory-csa').val();
            if (!current_inv_csa && default_lubes_csa) {
                $wrapper.find('#invoice-inventory-csa').val(default_lubes_csa);
            }
        } else {
            $wrapper.find('#invoice-inventory-csa-group').hide();
        }

        // QUANTITY vs GROSS AMOUNT ENTRY RULES:
        if (is_greasing_selected) {
            // GREASING SERVICE: User enters Quantity (Vehicles) -> Gross Amount is auto-calculated
            $wrapper.find('#invoice-mode-badge').html('🚗 Service Mode: Enter Quantity (Vehicles)').css({
                background: '#fef3c7',
                color: '#b45309',
                borderColor: '#fde68a'
            });

            $wrapper.find('#invoice-qty').prop('readonly', false).removeClass('readonly-style').css({
                border: '2px solid #d97706',
                background: '#ffffff',
                color: '#92400e',
                fontWeight: '800'
            }).attr('placeholder', 'e.g. 1');
            $wrapper.find('#lbl-invoice-qty').text('Vehicles Serviced').css({ color: '#b45309', fontWeight: '800' });
            $wrapper.find('#badge-qty-indicator').html('⚡ ENTER').css({ background: '#fef3c7', color: '#b45309', fontWeight: '800' });

            $wrapper.find('#invoice-gross-amount').prop('readonly', true).addClass('readonly-style').css({
                border: '1.5px solid #cbd5e1',
                background: '#f8fafc',
                color: '#64748b',
                fontWeight: '700'
            }).attr('placeholder', 'Auto-calc');
            $wrapper.find('#lbl-invoice-gross').text('Gross Amount (KES)').css({ color: '#64748b', fontWeight: '600' });
            $wrapper.find('#badge-gross-indicator').html('Auto').css({ background: '#f1f5f9', color: '#64748b', fontWeight: '600' });

            // DISCOUNT SECTION: Visible for service
            $wrapper.find('#invoice-discount-section').slideDown(150);

            if (!$wrapper.find('#invoice-qty').val() || parseFloat($wrapper.find('#invoice-qty').val()) <= 0) {
                $wrapper.find('#invoice-qty').val(1);
            }
            calc_from_qty();
        } else if (has_non_fuel_selected) {
            // NON-FUEL / INVENTORY: User enters Quantity -> Gross Amount is auto-calculated
            $wrapper.find('#invoice-mode-badge').html('📦 Inventory Mode: Enter Quantity (Units)').css({
                background: '#f3e8ff',
                color: '#6b21a8',
                borderColor: '#d8b4fe'
            });

            $wrapper.find('#invoice-qty').prop('readonly', false).removeClass('readonly-style').css({
                border: '2px solid #059669',
                background: '#ffffff',
                color: '#065f46',
                fontWeight: '800'
            }).attr('placeholder', 'e.g. 4');
            $wrapper.find('#lbl-invoice-qty').text('Quantity (Units)').css({ color: '#047857', fontWeight: '800' });
            $wrapper.find('#badge-qty-indicator').html('⚡ ENTER').css({ background: '#dcfce7', color: '#059669', fontWeight: '800' });

            $wrapper.find('#invoice-gross-amount').prop('readonly', true).addClass('readonly-style').css({
                border: '1.5px solid #cbd5e1',
                background: '#f8fafc',
                color: '#64748b',
                fontWeight: '700'
            }).attr('placeholder', 'Auto-calc');
            $wrapper.find('#lbl-invoice-gross').text('Gross Amount (KES)').css({ color: '#64748b', fontWeight: '600' });
            $wrapper.find('#badge-gross-indicator').html('Auto').css({ background: '#f1f5f9', color: '#64748b', fontWeight: '600' });

            // DISCOUNT SECTION: ONLY visible for inventory items
            $wrapper.find('#invoice-discount-section').slideDown(150);

            calc_from_qty();
        } else {
            // FUEL PRODUCT: User enters Gross Amount -> Quantity is auto-calculated
            $wrapper.find('#invoice-mode-badge').html('⛽ Fuel Mode: Enter Gross Amount').css({
                background: '#dcfce7',
                color: '#166534',
                borderColor: '#86efac'
            });

            $wrapper.find('#invoice-gross-amount').prop('readonly', false).removeClass('readonly-style').css({
                border: '2px solid #059669',
                background: '#ffffff',
                color: '#065f46',
                fontWeight: '800'
            }).attr('placeholder', 'e.g. 2000');
            $wrapper.find('#lbl-invoice-gross').text('Gross Amount (KES)').css({ color: '#047857', fontWeight: '800' });
            $wrapper.find('#badge-gross-indicator').html('⚡ ENTER').css({ background: '#dcfce7', color: '#059669', fontWeight: '800' });

            $wrapper.find('#invoice-qty').prop('readonly', true).addClass('readonly-style').css({
                border: '1.5px solid #cbd5e1',
                background: '#f8fafc',
                color: '#64748b',
                fontWeight: '700'
            }).attr('placeholder', 'Auto-calc');
            $wrapper.find('#lbl-invoice-qty').text('Quantity (Litres)').css({ color: '#64748b', fontWeight: '600' });
            $wrapper.find('#badge-qty-indicator').html('Auto').css({ background: '#f1f5f9', color: '#64748b', fontWeight: '600' });

            // DISCOUNT SECTION: Hidden for fuel
            $wrapper.find('#invoice-discount-section').hide();
            $wrapper.find('#invoice-discount-amount').val('');
            $wrapper.find('#invoice-discount-reason').val('');

            calc_from_gross();
        }
    }

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
                let filterOpts = '<option value="">All Customers</option>';
                
                let sorted = [...r.message].sort((a,b) => (a.customer_name || a.name).localeCompare(b.customer_name || b.name));
                sorted.forEach(c => {
                    let cName = c.customer_name || c.name;
                    filterOpts += `<option value="${c.name}">${cName}</option>`;
                });
                $wrapper.find('#inv-filter-customer').html(filterOpts);
                $wrapper.find('#disc-filter-customer').html(filterOpts);
                
                $wrapper.find('#inv-filter-date-from, #inv-filter-date-to, #inv-filter-customer').off('change').on('change', () => fetch_invoice_history($wrapper));
                $wrapper.find('#invoice-filter-search').off('keyup').on('keyup', () => fetch_invoice_history($wrapper));
                
                refresh_invoice_cart($wrapper);
            }
        }
    });

    // Bidirectional Calculations
    function calc_from_qty() {
        let qty = parseFloat($wrapper.find('#invoice-qty').val()) || 0;
        let rate = parseFloat($wrapper.find('#invoice-rate').val()) || 0;
        let gross = qty * rate;
        $wrapper.find('#invoice-gross-amount').val(gross > 0 ? gross.toFixed(2) : '');
        
        let discount = parseFloat($wrapper.find('#invoice-discount-amount').val()) || 0;
        let net = Math.max(0, gross - discount);
        $wrapper.find('#invoice-amount').val(net > 0 ? net.toFixed(2) : (gross > 0 ? '0.00' : ''));
    }

    function calc_from_gross() {
        let gross = parseFloat($wrapper.find('#invoice-gross-amount').val()) || 0;
        let rate = parseFloat($wrapper.find('#invoice-rate').val()) || 0;
        if (rate > 0 && gross > 0) {
            let qty = gross / rate;
            $wrapper.find('#invoice-qty').val(qty.toFixed(4));
        }
        let discount = parseFloat($wrapper.find('#invoice-discount-amount').val()) || 0;
        let net = Math.max(0, gross - discount);
        $wrapper.find('#invoice-amount').val(net > 0 ? net.toFixed(2) : (gross > 0 ? '0.00' : ''));
    }

    function calc_from_discount() {
        let gross = parseFloat($wrapper.find('#invoice-gross-amount').val()) || 0;
        if (gross <= 0) {
            let qty = parseFloat($wrapper.find('#invoice-qty').val()) || 0;
            let rate = parseFloat($wrapper.find('#invoice-rate').val()) || 0;
            gross = qty * rate;
            $wrapper.find('#invoice-gross-amount').val(gross > 0 ? gross.toFixed(2) : '');
        }
        let discount = parseFloat($wrapper.find('#invoice-discount-amount').val()) || 0;
        let net = Math.max(0, gross - discount);
        $wrapper.find('#invoice-amount').val(net > 0 ? net.toFixed(2) : (gross > 0 ? '0.00' : ''));
    }

    $wrapper.find('#invoice-qty').off('input change').on('input change', calc_from_qty);
    $wrapper.find('#invoice-gross-amount').off('input change').on('input change', calc_from_gross);
    $wrapper.find('#invoice-discount-amount').off('input change').on('input change', calc_from_discount);

    // Add to Cart
    $wrapper.find('#btn-add-invoice-item').off('click').on('click', function() {
        let customer_id = ($wrapper.find('#invoice-customer-hidden').val() || '').trim();
        let customer_name = ($wrapper.find('#invoice-customer-input').val() || '').trim();
        
        if (!customer_id && customer_name) {
            let match = (window.CUSTOMERS_LIST || []).find(c => 
                (c.customer_name && c.customer_name.toLowerCase() === customer_name.toLowerCase()) || 
                (c.name && c.name.toLowerCase() === customer_name.toLowerCase())
            );
            if (match) customer_id = match.name;
        }

        let csa = $wrapper.find('#invoice-csa').val();
        let inv_csa = $wrapper.find('#invoice-inventory-csa').val();
        let po = $wrapper.find('#invoice-po').val();
        let vehicle = $wrapper.find('#invoice-vehicle').val();
        
        let item_code = ($wrapper.find('#invoice-item-hidden').val() || '').trim();
        let item_name = ($wrapper.find('#invoice-item-input').val() || '').trim();
        
        let item = null;
        if (item_code) {
            item = (window.INVOICE_ITEMS || []).find(i => i.item_code === item_code);
        }
        if (!item && item_name) {
            item = (window.INVOICE_ITEMS || []).find(i => 
                (i.item_name && i.item_name.toLowerCase() === item_name.toLowerCase()) || 
                (i.item_code && i.item_code.toLowerCase() === item_name.toLowerCase())
            );
        }
        
        let qty = parseFloat($wrapper.find('#invoice-qty').val()) || 0;
        let rate = parseFloat($wrapper.find('#invoice-rate').val()) || 0;
        let gross_amount = parseFloat($wrapper.find('#invoice-gross-amount').val()) || (qty * rate);
        let discount_amount = parseFloat($wrapper.find('#invoice-discount-amount').val()) || 0;
        let discount_csa = $wrapper.find('#invoice-discount-csa').val() || (discount_amount > 0 ? csa : '');
        let discount_reason = $wrapper.find('#invoice-discount-reason').val() || '';
        let net_amount = parseFloat($wrapper.find('#invoice-amount').val()) || Math.max(0, gross_amount - discount_amount);

        if (!customer_id) {
            frappe.show_alert({message: "Please select a Credit Customer.", indicator: "red"});
            return;
        }
        if (!csa) {
            frappe.show_alert({message: "Please select an Assigned CSA (Issuer).", indicator: "red"});
            return;
        }
        if (!item) {
            frappe.show_alert({message: "Please select a Product / Item.", indicator: "red"});
            return;
        }
        if (qty <= 0 || rate <= 0 || net_amount <= 0) {
            frappe.show_alert({message: "Valid Quantity and Rate are required.", indicator: "red"});
            return;
        }

        if (discount_amount > 0 && !discount_csa) {
            frappe.show_alert({message: "Please select which CSA to relieve for this discount.", indicator: "red"});
            return;
        }

        let is_non_fuel = is_non_fuel_item(item);
        let is_greasing = is_greasing_service_item(item);
        let final_inv_csa = (is_non_fuel && !is_greasing) ? (inv_csa || default_lubes_csa || csa) : '';

        // Determine Entry Number: Preserve editing number if in edit mode, or use cart's active number, or latest global next number
        let entry_no = window.EDITING_INVOICE_ENTRY_NUMBER;
        if (!entry_no) {
            if (window.PENDING_INVOICES && window.PENDING_INVOICES.length > 0 && window.PENDING_INVOICES[0].entry_number) {
                entry_no = window.PENDING_INVOICES[0].entry_number;
            } else if (window.CURRENT_NEXT_INVOICE_NUMBER) {
                entry_no = window.CURRENT_NEXT_INVOICE_NUMBER;
            } else {
                let badge_txt = ($wrapper.find('#invoice-entry-number').text() || '').replace(' (Editing)', '').trim();
                entry_no = badge_txt || 'INV001';
            }
        }

        window.PENDING_INVOICES.push({
            _is_new: true,
            customer: customer_id,
            csa: csa,
            inventory_csa: final_inv_csa,
            purchase_order: po,
            vehicle_registration: vehicle,
            item: item.item_code,
            item_name: item.item_name,
            quantity: qty,
            rate: rate,
            gross_amount: gross_amount,
            discount_amount: discount_amount,
            discount_csa: discount_csa,
            discount_reason: discount_reason,
            amount: net_amount,
            entry_number: entry_no
        });

        // clear item fields
        $wrapper.find('#invoice-item-input').val('');
        $wrapper.find('#invoice-item-hidden').val('');
        $wrapper.find('#invoice-rate').val('');
        $wrapper.find('#invoice-qty').val('');
        $wrapper.find('#invoice-gross-amount').val('');
        $wrapper.find('#invoice-discount-amount').val('');
        $wrapper.find('#invoice-discount-reason').val('');
        $wrapper.find('#invoice-amount').val('');
        
        refresh_invoice_cart($wrapper);
        update_inventory_csa_visibility();
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
                        return { ...r2, name: r2._is_new ? undefined : r2.name };
                    });

                    window.PENDING_INVOICES.forEach(p => {
                        new_list.push({
                            customer: p.customer,
                            csa: p.csa,
                            inventory_csa: p.inventory_csa || '',
                            purchase_order: p.purchase_order,
                            vehicle_registration: p.vehicle_registration,
                            item: p.item,
                            item_name: p.item_name,
                            quantity: p.quantity,
                            rate: p.rate,
                            gross_amount: p.gross_amount || (p.quantity * p.rate),
                            discount_amount: p.discount_amount || 0,
                            discount_csa: p.discount_csa || '',
                            discount_reason: p.discount_reason || '',
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
                                window.EDITING_INVOICE_ENTRY_NUMBER = null;
                                
                                // Reset form header fields
                                $wrapper.find('#invoice-customer-input').val('');
                                $wrapper.find('#invoice-customer-hidden').val('');
                                $wrapper.find('#invoice-po').val('');
                                $wrapper.find('#invoice-vehicle').val('');
                                
                                // Auto-jump to history
                                $wrapper.find('#tab-invoices .seg-btn[data-view="history"]').click();
                                
                                // Re-render to update the Entry No and linked sections
                                render_invoices($wrapper);
                                if(typeof render_greasing === 'function') render_greasing($wrapper);
                                if(typeof render_dry_stock === 'function') render_dry_stock($wrapper);
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

    // Wire Discounts Report listeners
    $wrapper.find('#btn-refresh-discounts, #disc-filter-from, #disc-filter-to, #disc-filter-customer').off('click change').on('click change', function() {
        fetch_discounts_report($wrapper);
    });

    $wrapper.find('#btn-print-discounts-report').off('click').on('click', function() {
        let printContents = $wrapper.find('#table-discounts-report').parent().html();
        let totalDisc = $wrapper.find('#disc-rep-total-discounts').text();
        let totalGross = $wrapper.find('#disc-rep-total-gross').text();
        let totalNet = $wrapper.find('#disc-rep-total-net').text();
        let countText = $wrapper.find('#disc-rep-count').text();

        let printWindow = window.open('', '', 'height=700,width=950');
        printWindow.document.write('<html><head><title>Shift Discounts Report</title>');
        printWindow.document.write('<style>body{font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px; padding: 20px;} table{width:100%; border-collapse: collapse; margin-top: 15px;} th, td{border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left;} th{background: #f1f5f9; font-weight: 700;} .summary-box{display: flex; gap: 20px; margin-bottom: 15px;} .box{border: 1px solid #cbd5e1; padding: 10px; border-radius: 6px; flex: 1;}</style>');
        printWindow.document.write('</head><body>');
        printWindow.document.write('<h2>Shift Discounts Report</h2>');
        printWindow.document.write('<p><strong>Station:</strong> ' + (window.ACTIVE_SHIFT ? window.ACTIVE_SHIFT.station : '') + ' &bull; <strong>Generated:</strong> ' + frappe.datetime.now_datetime() + '</p>');
        printWindow.document.write('<div class="summary-box">');
        printWindow.document.write('<div class="box"><strong>Total Discounts:</strong> ' + totalDisc + ' (' + countText + ')</div>');
        printWindow.document.write('<div class="box"><strong>Total Gross:</strong> ' + totalGross + '</div>');
        printWindow.document.write('<div class="box"><strong>Total Net Invoiced:</strong> ' + totalNet + '</div>');
        printWindow.document.write('</div>');
        printWindow.document.write(printContents);
        printWindow.document.write('</body></html>');
        printWindow.document.close();
        printWindow.focus();
        setTimeout(function() { printWindow.print(); }, 500);
    });

    update_inventory_csa_visibility();

    refresh_invoice_cart($wrapper);
}

function refresh_invoice_cart($wrapper) {
    let is_locked = window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.status !== 'Open';
    
    // Render Pending Cart
    let html_cart = '';
    let grand_total = 0;
    (window.PENDING_INVOICES || []).forEach((row, idx) => {
        grand_total += (row.amount || 0);
        let source_info = '';
        if (row.inventory_csa) {
            let inv_user = window.USERS_LIST ? window.USERS_LIST.find(u => u.name === row.inventory_csa) : null;
            let inv_name = inv_user ? (inv_user.employee_name || inv_user.full_name) : row.inventory_csa;
            source_info = `<small style="display:block; color:#0284c7; font-size:0.75rem; font-weight:600; margin-top:2px;">📦 Source CSA: ${inv_name}</small>`;
        }

        let is_fuel = !row.inventory_csa && (row.item_name || '').toUpperCase().match(/(PMS|AGO|IK|PETROL|DIESEL|KEROSENE|SUPER)/);
        let type_badge = is_fuel 
            ? `<span style="background:#dcfce7; color:#166534; font-size:0.7rem; font-weight:700; padding:2px 6px; border-radius:4px; margin-right:6px; display:inline-block;">⛽ Fuel</span>`
            : `<span style="background:#f3e8ff; color:#6b21a8; font-size:0.7rem; font-weight:700; padding:2px 6px; border-radius:4px; margin-right:6px; display:inline-block;">📦 Stock</span>`;

        let discount_display = '<span style="color:#94a3b8;">-</span>';
        if (row.discount_amount > 0) {
            let disc_user = window.USERS_LIST ? window.USERS_LIST.find(u => u.name === row.discount_csa) : null;
            let disc_csa_name = disc_user ? (disc_user.employee_name || disc_user.full_name) : (row.discount_csa || '');
            discount_display = `<span style="background:#faf5ff; border:1px solid #d8b4fe; color:#7e22ce; font-weight:800; padding:2px 6px; border-radius:4px; font-size:0.85rem;">-${frappe.format(row.discount_amount, {fieldtype: 'Currency'})}</span><small style="display:block; color:#6b21a8; font-size:0.75rem; margin-top:2px;">Relieved: ${disc_csa_name}</small>`;
        }

        let gross_val = row.gross_amount || (row.quantity * row.rate);

        html_cart += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 0.85rem;">${type_badge}<strong>${row.item_name || row.item}</strong>${source_info}</td>
                <td style="padding: 0.85rem; font-weight:800; font-family:monospace; font-size:0.95rem;">${row.quantity}</td>
                <td style="padding: 0.85rem; font-family:monospace;">${frappe.format(row.rate, {fieldtype: 'Currency'})}</td>
                <td style="padding: 0.85rem; color:#64748b; font-family:monospace;">${frappe.format(gross_val, {fieldtype: 'Currency'})}</td>
                <td style="padding: 0.85rem;">${discount_display}</td>
                <td style="padding: 0.85rem; font-weight:900; color:#047857; font-family:monospace; font-size:1.05rem;">${frappe.format(row.amount, {fieldtype: 'Currency'})}</td>
                <td style="padding: 0.85rem; text-align:center;">
                    <button class="btn btn-xs btn-danger btn-remove-invoice-cart" data-idx="${idx}" style="border-radius:6px; padding:4px 8px; font-weight:700;" title="Remove Item">✕</button>
                </td>
            </tr>
        `;
    });
    if(!html_cart) {
        html_cart = `<tr><td colspan="7" style="text-align: center; color: #64748b; padding: 2.5rem;">Cart is empty &bull; Select a product above and click "+ Add Item"</td></tr>`;
    }
    $wrapper.find('#list-invoice-cart').html(html_cart);
    $wrapper.find('#invoice-cart-total-amount').html(frappe.format(grand_total, {fieldtype: 'Currency'}));

    $wrapper.find('.btn-remove-invoice-cart').off('click').on('click', function() {
        let idx = parseInt($(this).attr('data-idx'));
        window.PENDING_INVOICES.splice(idx, 1);
        refresh_invoice_cart($wrapper);
        update_inventory_csa_visibility();
    });

    fetch_invoice_history($wrapper);
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

    // 2. Populate CSAs (All available CSAs in the station)
    let csaOptions = '<option value="">Select CSA...</option>';
    if (window.USERS_LIST) {
        window.USERS_LIST.forEach(u => {
            let name = u.employee_name || u.full_name || u.name;
            csaOptions += `<option value="${u.name}">${name}</option>`;
        });
    }
    $wrapper.find('#cp-csa').html(csaOptions);

    // 3. Populate Customers (reuses window.CUSTOMERS_LIST fetched by invoices)
    let pop_cust = function() {
        if(window.CUSTOMERS_LIST) {
            let custOpts = '';
            window.CUSTOMERS_LIST.forEach(c => {
                custOpts += `<option value="${c.name} - ${c.customer_name}">`;
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
        args: { doctype: "Mode of Payment", filters: { enabled: 1 }, fields: ["name"], limit_page_length: 100 },
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

    let custFilterOpts = '<option value="">All Customers</option>';
    (window.CUSTOMERS_LIST || []).forEach(c => {
        custFilterOpts += `<option value="${c.name}">${c.customer_name}</option>`;
    });
    $wrapper.find('#cp-filter-customer').html(custFilterOpts);

    let fetch_history = function() {
        let start_date = $wrapper.find('#cp-filter-date-from').val();
        let end_date = $wrapper.find('#cp-filter-date-to').val();
        let customer_filter = $wrapper.find('#cp-filter-customer').val();

        let render_table = function(items) {
            let count = items ? items.length : 0;
            if (!start_date && !end_date && !customer_filter) {
                $wrapper.find('#cp-history-subtitle').html(`<span style="color:#64748b; font-size:0.85rem;">(Showing latest 20 entries &bull; Use date filter for more)</span>`);
            } else {
                $wrapper.find('#cp-history-subtitle').html(`<span style="color:#047857; font-size:0.85rem; font-weight:600;">(Showing ${count} filtered entries)</span>`);
            }
            let html = '';
            let total_amount = 0;
            
            if(items) {
                items.forEach(row => {
                    total_amount += parseFloat(row.amount || 0);
                    let time_val = row.creation ? row.creation.split(" ")[1].substring(0, 5) : "";
                    if (row.time) time_val = row.time; 
                    
                    let csa_name = row.csa || "N/A";
                    if (row.csa && window.USERS_LIST) {
                        let u = window.USERS_LIST.find(u => u.name === row.csa);
                        if(u) csa_name = u.employee_name;
                    }
                    
                    let cust = (window.CUSTOMERS_LIST || []).find(c => c.name === row.customer);
                    let customer_name = cust ? cust.customer_name : row.customer;
                    
                    let sDate = row.shift_date || row.date || "";
                    let shiftName = row.shift_template || row.shift || "";

                    let show_actions = (!is_locked && row.shift === window.ACTIVE_SHIFT.name);
                    
                    let del_btn = !show_actions ? 
                        `<button class="btn btn-xs btn-danger" disabled>X</button>` :
                        `<button class="btn btn-xs btn-danger btn-delete-cp" data-name="${row.name}">X</button>`;
                        
                    let edit_btn = !show_actions ?
                        `<button class="btn btn-xs btn-default" disabled>Edit</button>` :
                        `<button class="btn btn-xs btn-default btn-edit-cp" data-name="${row.name}" data-customer="${row.customer}" data-csa="${row.csa}" data-mode="${row.mode_of_payment}" data-amount="${row.amount}">Edit</button>`;
                        
                    let action_html = `<div style="display:flex; gap:0.5rem;">${edit_btn}${del_btn}</div>`;
                    
                    html += `
                        <tr>
                            <td style="font-family: monospace; color: #64748b;">${row.name}</td>
                            <td>${sDate ? frappe.datetime.str_to_user(sDate) : ''} (${shiftName})</td>
                            <td><span class="badge" style="background-color: #f8fafc; color: #64748b;">${shiftName}</span></td>
                            <td style="color: #64748b;">${time_val}</td>
                            <td><strong>${customer_name}</strong></td>
                            <td>${csa_name}</td>
                            <td><span class="badge" style="background-color: #f1f5f9; color: #475569;">${row.mode_of_payment || ""}</span></td>
                            <td style="font-weight: 600; text-align:right;">${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td>${action_html}</td>
                        </tr>
                    `;
                });
            }
            if(html === '') html = '<tr><td colspan="9" class="text-center" style="color: #94a3b8; padding: 2rem;">No payments found.</td></tr>';
            $wrapper.find('#list-customer-payments-saved').html(html);
            
            $wrapper.find('.btn-delete-cp').off('click').on('click', function() {
                let cp_name = $(this).attr('data-name');
                frappe.confirm('Are you sure you want to delete this payment?', () => {
                    frappe.call({
                        method: "frappe.client.delete",
                        args: { doctype: "Customer Payment", name: cp_name },
                        callback: function(del_r) {
                            if(!del_r.exc) {
                                frappe.show_alert({message: "Payment deleted", indicator: "green"});
                                fetch_history();
                            }
                        }
                    });
                });
            });
            
            $wrapper.find('.btn-edit-cp').off('click').on('click', function() {
                let $btn = $(this);
                let cp_name = $btn.attr('data-name');
                
                frappe.confirm('This will load the payment back into the entry form and delete it from history. Continue?', () => {
                    let cust_code = $btn.attr('data-customer');
                    let c_obj = (window.CUSTOMERS_LIST || []).find(c => c.name === cust_code);
                    $wrapper.find('#cp-customer-input').val(c_obj ? `${c_obj.name} - ${c_obj.customer_name}` : cust_code);
                    $wrapper.find('#cp-customer-input').trigger('change');
                    $wrapper.find('#cp-csa').val($btn.attr('data-csa'));
                    $wrapper.find('#cp-mode').val($btn.attr('data-mode'));
                    $wrapper.find('#cp-amount').val($btn.attr('data-amount'));
                    
                    frappe.call({
                        method: "frappe.client.delete",
                        args: { doctype: "Customer Payment", name: cp_name },
                        callback: function(del_r) {
                            if(!del_r.exc) {
                                $wrapper.find('#tab-customer-payments .seg-btn[data-view="entry"]').click();
                                fetch_history();
                            }
                        }
                    });
                });
            });
        };

        $wrapper.find('#list-customer-payments-saved').html('<tr><td colspan="9" class="text-center"><div class="spinner"></div> Fetching history...</td></tr>');
        frappe.call({
            method: "fuel_management.fuel_management.api.get_customer_payments_history",
            args: {
                station: window.ACTIVE_SHIFT.station,
                from_date: start_date,
                to_date: end_date,
                customer: customer_filter
            },
            callback: function(r) {
                render_table(r.message || []);
            }
        });
    };
    
    $wrapper.find('#cp-filter-date-from, #cp-filter-date-to, #cp-filter-customer').off('change').on('change', function() {
        fetch_history();
    });
    fetch_history();

    // 6. Save Payment
    $wrapper.find('#btn-save-customer-payment').off('click').on('click', function() {
        if (is_locked) {
            frappe.show_alert({message: "Shift is closed/locked.", indicator: "red"});
            return;
        }

        let customer_raw = ($wrapper.find('#cp-customer-input').val() || '').trim();
        let customer = customer_raw ? customer_raw.split(' - ')[0].trim() : '';
        let custMatch = (window.CUSTOMERS_LIST || []).find(c => 
            c.name === customer || 
            (c.customer_name && c.customer_name.toLowerCase() === customer_raw.toLowerCase()) ||
            `${c.name} - ${c.customer_name}`.toLowerCase() === customer_raw.toLowerCase()
        );
        if (custMatch) {
            customer = custMatch.name;
        }
        let csa = $wrapper.find('#cp-csa').val();
        let mode = $wrapper.find('#cp-mode').val();
        let trans_no = $wrapper.find('#cp-trans-no').val();
        let amount = parseFloat($wrapper.find('#cp-amount').val()) || 0;
        let memo = $wrapper.find('#cp-memo').val();

        if (!customer || !mode || amount <= 0) {
            frappe.show_alert({message: "Customer, Mode of Payment, and valid Amount are required.", indicator: "red"});
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
    if(window.SHIFT_DOC.head_csa) {
        let head_emp = window.USERS_LIST ? window.USERS_LIST.find(u => u.user_id === window.SHIFT_DOC.head_csa) : null;
        if (head_emp) allowed_csas.push(head_emp.name);
    }
    (window.SHIFT_DOC.assigned_csas || []).forEach(row => {
        if(row.csa) allowed_csas.push(row.csa);
    });
    
    // Remove duplicates
    allowed_csas = [...new Set(allowed_csas)];
    
    
    let sorted_csas = allowed_csas.map(csa => {
        let u = window.USERS_LIST ? window.USERS_LIST.find(u => u.name === csa) : null;
        let name = u ? (u.employee_name || u.full_name) : csa;
        return {csa, name};
    }).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
    
    sorted_csas.forEach(item => {
        csaOptions += `<option value="${item.csa}">${item.name}</option>`;
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
                let total_amount = 0;
                if(r.message) {
                    r.message.forEach(row => {
                        total_amount += parseFloat(row.amount || 0);
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
    if(window.SHIFT_DOC.head_csa) {
        let head_emp = window.USERS_LIST ? window.USERS_LIST.find(u => u.user_id === window.SHIFT_DOC.head_csa) : null;
        if (head_emp) allowed_csas.push(head_emp.name);
    }
    (window.SHIFT_DOC.assigned_csas || []).forEach(row => {
        if(row.csa) allowed_csas.push(row.csa);
    });
    
    // Remove duplicates
    allowed_csas = [...new Set(allowed_csas)];
    
    
    let sorted_csas = allowed_csas.map(csa => {
        let u = window.USERS_LIST ? window.USERS_LIST.find(u => u.name === csa) : null;
        let name = u ? (u.employee_name || u.full_name) : csa;
        return {csa, name};
    }).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
    
    sorted_csas.forEach(item => {
        csaOptions += `<option value="${item.csa}">${item.name}</option>`;
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
                let total_amount = 0;
                if(r.message) {
                    r.message.forEach(row => {
                        total_amount += parseFloat(row.amount || 0);
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
                let head_emp = window.USERS_LIST ? window.USERS_LIST.find(u => u.user_id === window.SHIFT_DOC.head_csa) : null;
                let csa = head_emp ? head_emp.name : null;
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
                let total_amount = 0;
                if(r.message) {
                    r.message.forEach(row => {
                        total_amount += parseFloat(row.amount || 0);
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

    // 2. Setup CSA Dropdown (Allow any active CSA across the station/company)
    let populate_topup_csas = function() {
        if(window.USERS_LIST && window.USERS_LIST.length > 0) {
            let csaOptions = '<option value="">Select CSA...</option>';
            let sorted_csas = window.USERS_LIST.slice().sort((a,b) => (a.employee_name || a.full_name || a.name || "").localeCompare(b.employee_name || b.full_name || b.name || ""));
            sorted_csas.forEach(u => {
                let label = u.employee_name || u.full_name || u.name;
                csaOptions += `<option value="${u.name}">${label}</option>`;
            });
            $wrapper.find('#topup-csa').html(csaOptions);
        } else {
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Employee",
                    filters: { status: "Active" },
                    fields: ["name", "employee_name", "user_id"],
                    limit_page_length: 500
                },
                callback: function(r) {
                    if(r.message) {
                        window.USERS_LIST = r.message;
                        let csaOptions = '<option value="">Select CSA...</option>';
                        let sorted = r.message.sort((a,b) => (a.employee_name || a.full_name || a.name || "").localeCompare(b.employee_name || b.full_name || b.name || ""));
                        sorted.forEach(u => {
                            let label = u.employee_name || u.full_name || u.name;
                            csaOptions += `<option value="${u.name}">${label}</option>`;
                        });
                        $wrapper.find('#topup-csa').html(csaOptions);
                    }
                }
            });
        }
    };
    populate_topup_csas();

    // 2.5 Setup Mode of Payment Dropdown
    frappe.call({
        method: "frappe.client.get_list",
        args: { doctype: "Mode of Payment", filters: { enabled: 1 }, fields: ["name"], limit_page_length: 100 },
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
            filters: { status: "Active", supplier: ["like", "%Rubis%"] },
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
        let start_date = $wrapper.find('#tp-filter-date-from').val();
        let end_date = $wrapper.find('#tp-filter-date-to').val();

        let render_table = function(items) {
            let count = items ? items.length : 0;
            if (!start_date && !end_date) {
                $wrapper.find('#topups-history-subtitle').html(`<span style="color:#64748b; font-size:0.85rem;">(Showing latest 20 entries &bull; Use date filter for more)</span>`);
            } else {
                $wrapper.find('#topups-history-subtitle').html(`<span style="color:#047857; font-size:0.85rem; font-weight:600;">(Showing ${count} filtered entries)</span>`);
            }
            let html = '';
            let total_amount = 0;
            
            if(items) {
                items.forEach(row => {
                    total_amount += parseFloat(row.amount || 0);
                    let time_val = row.creation ? row.creation.split(" ")[1].substring(0, 5) : "";
                    
                    let csa_name = row.csa || "N/A";
                    if (row.csa && window.USERS_LIST) {
                        let u = window.USERS_LIST.find(u => u.name === row.csa);
                        if(u) csa_name = u.employee_name;
                    }
                    
                    let sDate = row.shift_date || row.date || "";
                    let shiftName = row.shift_template || row.shift || "";
                    
                    html += `
                        <tr>
                            <td style="font-family: monospace; color: #64748b;">${row.name}</td>
                            <td>${sDate ? frappe.datetime.str_to_user(sDate) : ''} (${shiftName})</td>
                            <td><span class="badge" style="background-color: #f8fafc; color: #64748b;">${shiftName}</span></td>
                            <td style="color: #64748b;">${time_val}</td>
                            <td><span class="badge" style="background-color: #f1f5f9; color: #475569; font-weight: normal;">${row.card || "-"}</span></td>
                            <td>${csa_name}</td>
                            <td>${row.rrn_number || "-"}</td>
                            <td><span class="badge">${row.mode_of_payment || ""}</span></td>
                            <td style="font-weight: 600;">${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        </tr>
                    `;
                });
            }
            if(html === '') html = '<tr><td colspan="9" class="text-center" style="color: #94a3b8; padding: 2rem;">No Top-Ups recorded yet.</td></tr>';
            $wrapper.find('#list-station-topups-saved').html(html);
        };

        $wrapper.find('#list-station-topups-saved').html('<tr><td colspan="9" class="text-center"><div class="spinner"></div> Fetching history...</td></tr>');
        frappe.call({
            method: "fuel_management.fuel_management.api.get_topups_history",
            args: {
                station: window.ACTIVE_SHIFT.station,
                from_date: start_date,
                to_date: end_date
            },
            callback: function(r) {
                render_table(r.message || []);
            }
        });
    };
    
    $wrapper.find('#tp-filter-date-from, #tp-filter-date-to').off('change').on('change', function() {
        fetch_history();
    });
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
// TOTAL INVENTORY STATUS MODULE
// =========================================================

function render_inventory_status($wrapper) {
    if(!window.ACTIVE_SHIFT || !window.ACTIVE_SHIFT.station) return;
    
    let fromInput = $wrapper.find('#inventory-date-from');
    let toInput = $wrapper.find('#inventory-date-to');
    
    if (!fromInput.val()) {
        let d = new Date();
        fromInput.val(new Date(d.getFullYear(), d.getMonth(), 2).toISOString().split('T')[0]);
    }
    if (!toInput.val()) {
        let d = new Date();
        toInput.val(new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().split('T')[0]);
    }

    $wrapper.find('#btn-refresh-inventory-report').off('click').on('click', function() {
        fetch_inventory_report($wrapper);
    });

    $wrapper.find('#inventory-search').off('input').on('input', function() {
        let val = $(this).val().toLowerCase();
        $wrapper.find('#list-inventory-status tr.data-row').each(function() {
            let text = $(this).find('.th-product').text().toLowerCase();
            $(this).toggle(text.includes(val));
        });
        
        $wrapper.find('#list-inventory-status tr.row-group-header').each(function() {
            let $group = $(this);
            let $rows = $group.nextUntil('.row-group-header', 'tr.data-row');
            if ($rows.filter(':visible').length === 0) {
                $group.hide();
            } else {
                $group.show();
            }
        });
    });
    
    // Zoom Controls
    let currentZoom = parseFloat($wrapper.find('.inventory-report-wrapper').css('--table-scale')) || 1.0;
    
    $wrapper.find('#btn-zoom-in').off('click').on('click', function() {
        if(currentZoom < 1.5) {
            currentZoom += 0.1;
            updateZoom();
        }
    });
    
    $wrapper.find('#btn-zoom-out').off('click').on('click', function() {
        if(currentZoom > 0.5) {
            currentZoom -= 0.1;
            updateZoom();
        }
    });
    
    $wrapper.find('#btn-zoom-reset').off('click').on('click', function() {
        currentZoom = 1.0;
        updateZoom();
    });
    
    function updateZoom() {
        $wrapper.find('.inventory-report-wrapper').css('--table-scale', currentZoom.toFixed(1));
        $wrapper.find('#zoom-level').text(Math.round(currentZoom * 100) + '%');
    }
    
    // Compact Mode Toggle
    $wrapper.find('#toggle-compact').off('change').on('change', function() {
        if($(this).is(':checked')) {
            $wrapper.find('.inventory-report-wrapper').addClass('compact-mode');
        } else {
            $wrapper.find('.inventory-report-wrapper').removeClass('compact-mode');
        }
    });
    
    // Collapse Columns
    $wrapper.find('.collapse-icon').off('click').on('click', function() {
        let target = $(this).data('target');
        let table = $wrapper.find('.inventory-report-table');
        let isCollapsed = table.hasClass('collapsed-' + target);
        
        if (isCollapsed) {
            table.removeClass('collapsed-' + target);
            $(this).text('[-]');
            $wrapper.find('#th-' + target + '-group').attr('colspan', 3);
        } else {
            table.addClass('collapsed-' + target);
            $(this).text('[+]');
            $wrapper.find('#th-' + target + '-group').attr('colspan', 1);
        }
    });

    fetch_inventory_report($wrapper);
}

function fetch_inventory_report($wrapper) {
    let fromInput = $wrapper.find('#inventory-date-from');
    let toInput = $wrapper.find('#inventory-date-to');
    
    if (!fromInput.val()) {
        let d = new Date();
        fromInput.val(new Date(d.getFullYear(), d.getMonth(), 2).toISOString().split('T')[0]);
    }
    if (!toInput.val()) {
        let d = new Date();
        toInput.val(new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().split('T')[0]);
    }
    
    let fromDate = fromInput.val();
    let toDate = toInput.val();
    
    $wrapper.find('#btn-refresh-inventory-report .spinner').removeClass('hidden');
    $wrapper.find('#list-inventory-status').html('<tr><td colspan="10" class="text-center">Loading inventory report...</td></tr>');
    
    frappe.call({
        method: "fuel_management.fuel_management.api.get_inventory_status_report",
        args: { 
            station_id: window.ACTIVE_SHIFT.station,
            from_date: fromDate,
            to_date: toDate
        },
        callback: function(r) {
            $wrapper.find('#btn-refresh-inventory-report .spinner').addClass('hidden');
            let html = '';
            
            if(r.message && r.message.data && Object.keys(r.message.data).length > 0) {
                // Update Company Name
                $wrapper.find('#inventory-report-company').text(r.message.company);
                
                let data = r.message.data;
                let no = 1;
                
                let unique_items = [];
                let item_opts = '';
                
                Object.keys(data).forEach(group => {
                    // Group Header
                    html += `
                        <tr class="row-group-header">
                            <td colspan="10">${group.toUpperCase()}</td>
                        </tr>
                    `;
                    
                    data[group].forEach(row => {
                        if(!unique_items.includes(row.item_code) && row.item_group !== 'FUEL') {
                            unique_items.push(row.item_code);
                            item_opts += `<option data-value="${row.item_code}" value="${row.item_name} (${row.item_code})"></option>`;
                        }
                        
                        let cl_store_cls = (row.cl_store < 0) ? 'negative-val' : '';
                        let cl_fc_cls = (row.cl_forecourt < 0) ? 'negative-val' : '';
                        let cl_tot_cls = (row.cl_total < 0) ? 'negative-val' : '';
                        
                        html += `
                            <tr class="data-row">
                                <td class="sticky-col th-no">${no++}</td>
                                <td class="sticky-col th-product">${row.item_name}</td>
                                
                                <td class="col-op text-center">${row.op_store || 0}</td>
                                <td class="col-op text-center">${row.op_forecourt || 0}</td>
                                <td class="text-center" style="font-weight:bold;">${row.op_total || 0}</td>
                                
                                <td class="text-center">${row.purchases || 0}</td>
                                <td class="text-center">${row.sales || 0}</td>
                                <td class="text-center">${row.borrowed_in || 0}</td>
                                <td class="text-center">${row.borrowed_out || 0}</td>
                                
                                <td class="col-cl text-center ${cl_store_cls}">${row.cl_store || 0}</td>
                                <td class="col-cl text-center ${cl_fc_cls}">${row.cl_forecourt || 0}</td>
                                <td class="text-center ${cl_tot_cls}" style="font-weight:bold;">${row.cl_total || 0}</td>
                            </tr>
                        `;
                    });
                });
                
                if ($wrapper.find('#stock-transfer-item-list').children().length === 0) {
                    $wrapper.find('#stock-transfer-item-list').html(item_opts);
                }
                
            } else {
                html = '<tr><td colspan="10" class="text-center" style="color: #64748b; padding: 2rem;">No inventory data found for this period.</td></tr>';
            }
            
            $wrapper.find('#list-inventory-status').html(html);
        }
    });
}


// =========================================================
// WAREHOUSE INVENTORY MODULE
// =========================================================

function render_warehouse_inventory($wrapper, warehouse_type) {
    if(!window.ACTIVE_SHIFT || !window.ACTIVE_SHIFT.station) return;
    
    let fromInput = $wrapper.find(`#${warehouse_type}-inventory-date-from`);
    let toInput = $wrapper.find(`#${warehouse_type}-inventory-date-to`);
    
    if (!fromInput.val()) {
        let d = new Date();
        fromInput.val(new Date(d.getFullYear(), d.getMonth(), 2).toISOString().split('T')[0]);
    }
    if (!toInput.val()) {
        let d = new Date();
        toInput.val(new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().split('T')[0]);
    }

    $wrapper.find(`#btn-refresh-${warehouse_type}-inventory`).off('click').on('click', function() {
        fetch_warehouse_inventory_report($wrapper, warehouse_type);
    });

    $wrapper.find(`#${warehouse_type}-inventory-search`).off('input').on('input', function() {
        let val = $(this).val().toLowerCase();
        $wrapper.find(`#list-${warehouse_type}-inventory tr.data-row`).each(function() {
            let text = $(this).find('td:nth-child(2)').text().toLowerCase();
            $(this).toggle(text.includes(val));
        });
        
        $wrapper.find(`#list-${warehouse_type}-inventory tr.row-group-header`).each(function() {
            let $group = $(this);
            let $rows = $group.nextUntil('.row-group-header', 'tr.data-row');
            if ($rows.filter(':visible').length === 0) {
                $group.hide();
            } else {
                $group.show();
            }
        });
    });

    fetch_warehouse_inventory_report($wrapper, warehouse_type);
}

function fetch_warehouse_inventory_report($wrapper, warehouse_type) {
    let fromInput = $wrapper.find(`#${warehouse_type}-inventory-date-from`);
    let toInput = $wrapper.find(`#${warehouse_type}-inventory-date-to`);
    
    if (!fromInput.val()) {
        let d = new Date();
        fromInput.val(new Date(d.getFullYear(), d.getMonth(), 2).toISOString().split('T')[0]);
    }
    if (!toInput.val()) {
        let d = new Date();
        toInput.val(new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().split('T')[0]);
    }
    
    let fromDate = fromInput.val();
    let toDate = toInput.val();
    let $tbody = $wrapper.find(`#list-${warehouse_type}-inventory`);
    let $spinner = $wrapper.find(`#btn-refresh-${warehouse_type}-inventory .spinner`);
    
    $spinner.removeClass('hidden');
    $tbody.html('<tr><td colspan="6" class="text-center">Loading inventory report...</td></tr>');
    
    frappe.call({
        method: "fuel_management.fuel_management.api.get_inventory_status_report",
        args: { 
            station_id: window.ACTIVE_SHIFT.station,
            from_date: fromDate,
            to_date: toDate,
            warehouse_type: warehouse_type
        },
        callback: function(r) {
            $spinner.addClass('hidden');
            let html = '';
            
            if (!window.INVENTORY_DATA) window.INVENTORY_DATA = {};
            window.INVENTORY_DATA[warehouse_type] = r.message ? r.message.data : null;
            
            if(r.message && r.message.data && Object.keys(r.message.data).length > 0) {
                // Update Company Name
                $wrapper.find(`#${warehouse_type}-inventory-report-company`).text(r.message.company);
                
                let data = r.message.data;
                let no = 1;
                
                let item_opts = '';
                let unique_items = [];
                
                Object.keys(data).forEach(group => {
                    html += `
                        <tr class="row-group-header">
                            <td colspan="6">${group.toUpperCase()}</td>
                        </tr>
                    `;
                    
                    data[group].forEach(row => {
                        if(!unique_items.includes(row.item_code) && row.item_group !== 'FUEL') {
                            unique_items.push(row.item_code);
                            item_opts += `<option data-value="${row.item_code}" value="${row.item_name} (${row.item_code})"></option>`;
                        }
                        
                        let op_val = (warehouse_type === "forecourt" ? row.op_forecourt : row.op_store) || 0;
                        let cl_val = (warehouse_type === "forecourt" ? row.cl_forecourt : row.cl_store) || 0;
                        let cl_cls = (cl_val < 0) ? 'negative-val' : '';
                        
                        html += `
                            <tr class="data-row">
                                <td style="text-align: center;">${no++}</td>
                                <td style="font-weight: 600; color: #1e293b;">${row.item_name}</td>
                                <td class="text-center">${op_val}</td>
                                <td class="text-center">${row.purchases || 0}</td>
                                <td class="text-center">${row.sales || 0}</td>
                                <td class="text-center ${cl_cls}" style="font-weight:bold;">${cl_val}</td>
                            </tr>
                        `;
                    });
                });
                
                if ($wrapper.find('#stock-transfer-item-list').children().length === 0) {
                    $wrapper.find('#stock-transfer-item-list').html(item_opts);
                }
                
            } else {
                html = '<tr><td colspan="6" class="text-center" style="color: #64748b; padding: 2rem;">No inventory data found for this period.</td></tr>';
            }
            
            $tbody.html(html);
            
            $wrapper.find(`#btn-print-${warehouse_type}-sheet`).off('click').on('click', function() {
                let data = window.INVENTORY_DATA[warehouse_type];
                if (data) {
                    print_stock_sheet(warehouse_type, data, r.message.company);
                } else {
                    frappe.show_alert({message: "No inventory data to print. Please refresh.", indicator: "orange"});
                }
            });
        }
    });
}

    
window.STOCK_TRANSFER_CART = [];

function render_stock_transfer_cart(wrapper) {
    let $wrapper = $(wrapper);
    let html = '';
    if(window.STOCK_TRANSFER_CART.length === 0) {
        html = '<tr><td colspan="4" class="text-center" style="color: #64748b; padding: 2rem;">Cart is empty</td></tr>';
    } else {
        window.STOCK_TRANSFER_CART.forEach((row, idx) => {
            html += `
                <tr>
                    <td>${row.direction}</td>
                    <td>${row.item_name}</td>
                    <td>${row.qty}</td>
                    <td><button class="btn btn-sm btn-remove-st-cart" data-idx="${idx}" style="color: #ef4444; border: 1px solid #ef4444; background: transparent;">X</button></td>
                </tr>
            `;
        });
    }
    $wrapper.find('#st-cart-body').html(html);
    
    $wrapper.find('.btn-remove-st-cart').off('click').on('click', function() {
        let idx = parseInt($(this).attr('data-idx'));
        window.STOCK_TRANSFER_CART.splice(idx, 1);
        render_stock_transfer_cart($wrapper);
    });
}
function render_stock_transfer($wrapper) {
    render_stock_transfer_cart($wrapper);
    if(!window.ACTIVE_SHIFT || !window.ACTIVE_SHIFT.station) return;

    if ($wrapper.find('#stock-transfer-item-list').children().length === 0) {
        fetch_warehouse_inventory_report($wrapper, 'store');
    }

    $wrapper.find('#btn-add-st-cart').off('click').on('click', function() {
        let item_val = $wrapper.find('#stock-transfer-item').val();
        let selected_option = $wrapper.find(`#stock-transfer-item-list option[value="${item_val}"]`);
        if (!selected_option.length) {
            selected_option = $wrapper.find(`#stock-transfer-item-list option[data-value="${item_val}"]`);
        }
        let item = selected_option.length ? selected_option.attr('data-value') : item_val;
        
        let qty = parseFloat($wrapper.find('#stock-transfer-qty').val()) || 0;
        let direction = $wrapper.find('#stock-transfer-direction').val() || "Store to Forecourt";
        
        if(!item || qty <= 0) {
            frappe.show_alert({message: "Please select an item and enter a valid quantity.", indicator: "orange"});
            return;
        }
        
        window.STOCK_TRANSFER_CART.push({
            item: item,
            item_name: item_val,
            qty: qty,
            direction: direction
        });
        
        $wrapper.find('#stock-transfer-item').val('');
        $wrapper.find('#stock-transfer-qty').val('');
        render_stock_transfer_cart($wrapper);
    });

    $wrapper.find('#btn-submit-stock-transfer').off('click').on('click', function() {
        if(window.STOCK_TRANSFER_CART.length === 0) {
            frappe.show_alert({message: "Cart is empty.", indicator: "orange"});
            return;
        }
        
        let $btn = $(this);
        $btn.find('.spinner').removeClass('hidden');
        $btn.prop('disabled', true);
        
        frappe.call({
            method: "fuel_management.fuel_management.api.create_spa_stock_transfer",
            args: {
                station_id: window.ACTIVE_SHIFT.station,
                items: JSON.stringify(window.STOCK_TRANSFER_CART)
            },
            callback: function(res) {
                $btn.find('.spinner').addClass('hidden');
                $btn.prop('disabled', false);
                
                if(res.message && res.message.status === "success") {
                    frappe.show_alert({message: res.message.message, indicator: "green"});
                    window.STOCK_TRANSFER_CART = [];
                    render_stock_transfer_cart($wrapper);
                    $wrapper.find('#stock-transfer-item').val('');
                    $wrapper.find('#stock-transfer-qty').val('');
                    fetch_warehouse_inventory_report($wrapper, 'store');
                    $wrapper.find('#tab-stock-transfer .seg-btn[data-view="history"]').click();
                    fetch_st_history();
                }
            },
            error: function() {
                $btn.find('.spinner').addClass('hidden');
                $btn.prop('disabled', false);
            }
        });
    });

    // Segmented Control Logic
    $wrapper.find('#tab-stock-transfer .seg-btn').off('click').on('click', function() {
        $wrapper.find('#tab-stock-transfer .seg-btn').removeClass('active');
        $(this).addClass('active');
        
        const view = $(this).data('view');
        $wrapper.find('#tab-stock-transfer .view-pane').removeClass('active');
        $wrapper.find('#st-' + view + '-view').addClass('active');
    });

    window.ST_HISTORY_CACHE = [];
    window.EDIT_ST_ITEMS = [];

    function render_edit_st_items_table() {
        let $tbody = $('#edit-st-items-body');
        $tbody.empty();
        
        if (!window.EDIT_ST_ITEMS || window.EDIT_ST_ITEMS.length === 0) {
            $tbody.html('<tr><td colspan="3" class="text-center" style="color:#94a3b8; padding:1.5rem;">No items in transfer. Use the form above to add items.</td></tr>');
            return;
        }
        
        window.EDIT_ST_ITEMS.forEach((item, idx) => {
            $tbody.append(`
                <tr>
                    <td style="padding:8px 12px; font-weight:500; font-size:0.875rem;">
                        ${item.item_name}
                        <div style="font-size:0.75rem; color:#64748b;">${item.item}</div>
                    </td>
                    <td style="padding:8px 12px;">
                        <input type="number" class="spa-input form-control edit-st-item-qty" data-idx="${idx}" min="0.01" step="0.01" value="${item.qty}" style="height:32px; padding:2px 8px; font-size:0.875rem; width:100%;">
                    </td>
                    <td style="text-align:center; padding:8px 12px;">
                        <button type="button" class="btn btn-xs btn-danger btn-remove-edit-st-item" data-idx="${idx}" style="padding:3px 7px;" title="Remove Item">
                            <i class="fa fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `);
        });

        $tbody.find('.edit-st-item-qty').off('change input').on('change input', function() {
            let idx = parseInt($(this).attr('data-idx'));
            let val = parseFloat($(this).val()) || 0;
            if (window.EDIT_ST_ITEMS[idx]) {
                window.EDIT_ST_ITEMS[idx].qty = val;
            }
        });

        $tbody.find('.btn-remove-edit-st-item').off('click').on('click', function() {
            let idx = parseInt($(this).attr('data-idx'));
            window.EDIT_ST_ITEMS.splice(idx, 1);
            render_edit_st_items_table();
        });
    }

    // Modal close handlers
    $('#modal-edit-st-close, #btn-edit-st-cancel').off('click').on('click', function() {
        $('#modal-edit-stock-transfer').hide();
    });

    // Add item inside edit modal
    $('#btn-edit-st-add-item').off('click').on('click', function() {
        let item_val = $('#edit-st-new-item').val().trim();
        if (!item_val) {
            frappe.show_alert({message: "Please select an item.", indicator: "orange"});
            return;
        }
        
        let selected_option = $(`#stock-transfer-item-list option[value="${item_val}"]`);
        if (!selected_option.length) {
            selected_option = $(`#stock-transfer-item-list option[data-value="${item_val}"]`);
        }
        let item_code = selected_option.length ? selected_option.attr('data-value') : item_val;
        let item_name = item_val;
        
        let qty = parseFloat($('#edit-st-new-qty').val()) || 0;
        if (qty <= 0) {
            frappe.show_alert({message: "Please enter a valid quantity.", indicator: "orange"});
            return;
        }

        let existing = window.EDIT_ST_ITEMS.find(i => i.item === item_code);
        if (existing) {
            existing.qty += qty;
        } else {
            window.EDIT_ST_ITEMS.push({
                item: item_code,
                item_name: item_name,
                qty: qty
            });
        }

        $('#edit-st-new-item').val('');
        $('#edit-st-new-qty').val('');
        render_edit_st_items_table();
    });

    // Save changes in edit modal
    $('#btn-edit-st-save').off('click').on('click', function() {
        let stock_entry_id = $('#edit-st-id').val();
        let direction = $('#edit-st-direction').val();
        
        // Sync any active input values
        $('#edit-st-items-body .edit-st-item-qty').each(function() {
            let idx = parseInt($(this).attr('data-idx'));
            let val = parseFloat($(this).val()) || 0;
            if (window.EDIT_ST_ITEMS[idx]) {
                window.EDIT_ST_ITEMS[idx].qty = val;
            }
        });

        let valid_items = (window.EDIT_ST_ITEMS || []).filter(i => i.qty > 0);
        if (valid_items.length === 0) {
            frappe.show_alert({message: "Transfer must contain at least one item with quantity > 0.", indicator: "orange"});
            return;
        }

        let $btn = $(this);
        $btn.find('.spinner').removeClass('hidden');
        $btn.prop('disabled', true);

        frappe.call({
            method: "fuel_management.fuel_management.api.update_spa_stock_transfer",
            args: {
                stock_entry_id: stock_entry_id,
                station_id: window.ACTIVE_SHIFT.station,
                direction: direction,
                items: JSON.stringify(valid_items)
            },
            callback: function(res) {
                $btn.find('.spinner').addClass('hidden');
                $btn.prop('disabled', false);
                if (res.message && res.message.status === "success") {
                    frappe.show_alert({message: res.message.message, indicator: "green"});
                    $('#modal-edit-stock-transfer').hide();
                    fetch_st_history();
                    fetch_warehouse_inventory_report($wrapper, 'store');
                }
            },
            error: function() {
                $btn.find('.spinner').addClass('hidden');
                $btn.prop('disabled', false);
            }
        });
    });

    function fetch_st_history() {
        let df = $wrapper.find('#st-filter-date-from').val();
        let dt = $wrapper.find('#st-filter-date-to').val();
        
        $wrapper.find('#st-history-body').html('<tr><td colspan="5" class="text-center">Loading...</td></tr>');
        
        frappe.call({
            method: "fuel_management.fuel_management.api.get_historical_stock_transfers",
            args: {
                station_id: window.ACTIVE_SHIFT.station,
                date_from: df,
                date_to: dt
            },
            callback: function(r) {
                window.ST_HISTORY_CACHE = r.message || [];
                let count = window.ST_HISTORY_CACHE.length;
                if (!df && !dt) {
                    $wrapper.find('#st-history-subtitle').html(`<span style="color:#64748b; font-size:0.85rem;">(Showing latest 20 entries &bull; Use date filter for more)</span>`);
                } else {
                    $wrapper.find('#st-history-subtitle').html(`<span style="color:#047857; font-size:0.85rem; font-weight:600;">(Showing ${count} filtered entries)</span>`);
                }
                let $tbody = $wrapper.find('#st-history-body');
                $tbody.empty();
                
                if (window.ST_HISTORY_CACHE.length > 0) {
                    window.ST_HISTORY_CACHE.forEach(row => {
                        let itemSum = (row.items || []).map(i => `${i.item_name || i.item_code} (${i.qty})`).join(', ');
                        let dirBadgeStyle = row.direction === "Store to Forecourt" 
                            ? "background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;" 
                            : "background:#fef3c7; color:#b45309; border:1px solid #fde68a;";
                        $tbody.append(`
                            <tr>
                                <td style="font-weight:600; color:#1e293b;">${row.name}</td>
                                <td>${frappe.datetime.str_to_user(row.posting_date)} ${row.posting_time || ''}</td>
                                <td>
                                    <span style="display:inline-block; padding:3px 8px; border-radius:4px; font-size:0.75rem; font-weight:600; ${dirBadgeStyle}">
                                        ${row.direction}
                                    </span>
                                </td>
                                <td style="max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${itemSum}">${itemSum}</td>
                                <td style="text-align:center; white-space:nowrap;">
                                    <button class="btn btn-xs btn-default btn-edit-st" data-entry="${row.name}" style="margin-right:4px; padding:3px 8px; font-size:0.75rem; font-weight:600;" title="Edit Transfer">
                                        <i class="fa fa-pencil text-primary"></i> Edit
                                    </button>
                                    <button class="btn btn-xs btn-default btn-delete-st" data-entry="${row.name}" style="padding:3px 8px; font-size:0.75rem; font-weight:600;" title="Delete Transfer">
                                        <i class="fa fa-trash text-danger"></i> Delete
                                    </button>
                                </td>
                            </tr>
                        `);
                    });

                    // Bind Edit button click
                    $tbody.find('.btn-edit-st').off('click').on('click', function(e) {
                        e.stopPropagation();
                        let entry_id = $(this).attr('data-entry');
                        let entry = (window.ST_HISTORY_CACHE || []).find(e => e.name === entry_id);
                        if (!entry) return;

                        $('#edit-st-id').val(entry.name);
                        $('#edit-st-entry-info').html(`<b>${entry.name}</b> &bull; ${frappe.datetime.str_to_user(entry.posting_date)} ${entry.posting_time || ''}`);
                        $('#edit-st-direction').val(entry.direction || "Store to Forecourt");
                        $('#edit-st-new-item').val('');
                        $('#edit-st-new-qty').val('');

                        window.EDIT_ST_ITEMS = (entry.items || []).map(i => ({
                            item: i.item_code,
                            item_name: i.item_name || i.item_code,
                            qty: parseFloat(i.qty) || 0
                        }));

                        render_edit_st_items_table();
                        $('#modal-edit-stock-transfer').css('display', 'flex');
                    });

                    // Bind Delete button click
                    $tbody.find('.btn-delete-st').off('click').on('click', function(e) {
                        e.stopPropagation();
                        let entry_id = $(this).attr('data-entry');
                        frappe.confirm(
                            `Are you sure you want to delete Stock Transfer <b>${entry_id}</b>?<br><span style="color:#ef4444; font-size:0.85rem;">This will reverse the inventory transfer and remove the entry.</span>`,
                            function() {
                                frappe.call({
                                    method: "fuel_management.fuel_management.api.delete_spa_stock_transfer",
                                    args: {
                                        stock_entry_id: entry_id
                                    },
                                    callback: function(res) {
                                        if (res.message && res.message.status === "success") {
                                            frappe.show_alert({message: res.message.message, indicator: "green"});
                                            fetch_st_history();
                                            fetch_warehouse_inventory_report($wrapper, 'store');
                                        }
                                    }
                                });
                            }
                        );
                    });

                } else {
                    $tbody.html('<tr><td colspan="5" class="text-center">No transfers found.</td></tr>');
                }
            }
        });
    }

    $wrapper.find('#st-filter-date-from, #st-filter-date-to').off('change').on('change', fetch_st_history);
    fetch_st_history();
}

function print_stock_sheet(warehouse_type, data, company) {
    if (!window.ACTIVE_SHIFT) return;
    
    let station_name = window.ACTIVE_SHIFT.station || "";
    let display_company = company || "K INVESTMENTS";
    
    let d = new Date(window.ACTIVE_SHIFT.shift_date || new Date());
    let formatted_date = ("0" + d.getDate()).slice(-2) + "." + ("0" + (d.getMonth() + 1)).slice(-2) + "." + d.getFullYear();
    
    let shift_name = (window.ACTIVE_SHIFT.shift_template || "").toUpperCase();
    if (shift_name.includes("DAY")) {
        shift_name = "DAY";
    } else if (shift_name.includes("NIGHT")) {
        shift_name = "NIGHT";
    }
    
    let assigned_names = [];
    if (window.SHIFT_DOC && window.SHIFT_DOC.assigned_csas) {
        window.SHIFT_DOC.assigned_csas.forEach(c => {
            let name = c.csa_name || c.csa;
            if (window.USERS_LIST) {
                let u = window.USERS_LIST.find(u => u.name === name);
                if (u) name = u.employee_name || u.full_name;
            }
            assigned_names.push(name.toUpperCase());
        });
    }
    let name_str = assigned_names.join(".");
    if (!name_str) name_str = "STEVE.BEATRICE.SHADDY";
    
    let title = (warehouse_type === "forecourt" ? "FORECOURT STOCK SHEET" : "STORE STOCK SHEET");
    
    let print_html = `
    <html>
    <head>
        <title>${title}</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #000; }
            .header { text-align: center; margin-bottom: 20px; }
            .company { font-size: 24px; font-weight: bold; margin-bottom: 5px; text-transform: uppercase; color: #1e3a8a; }
            .station { font-size: 16px; font-weight: bold; text-transform: uppercase; color: #475569; }
            
            .meta-bar { 
                display: flex; 
                justify-content: space-between; 
                border: 2px solid #1e3a8a; 
                padding: 10px 15px; 
                margin-bottom: 15px; 
                font-weight: bold;
                font-size: 14px;
            }
            
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #94a3b8; padding: 10px 12px; font-size: 13px; vertical-align: middle; }
            th { font-weight: bold; background-color: #1e3a8a; color: #ffffff; text-transform: uppercase; border: 1px solid #1e3a8a; }
            
            .text-left { text-align: left; }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            
            tr.group-header td { 
                background-color: #f1f5f9; 
                color: #1e3a8a; 
                font-weight: bold; 
                font-size: 14px;
                border: 1px solid #94a3b8;
            }
            
            @media print {
                body { padding: 0; }
                @page { margin: 1cm; }
            }
            
            .data-row td { height: 32px; }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="company">${display_company}</div>
            <div class="station">${station_name}</div>
        </div>
        
        <div class="meta-bar">
            <div>DATE: ${formatted_date}</div>
            <div>SHIFT: ${shift_name}</div>
            <div>NAME: ${name_str}</div>
        </div>
        
        <table>
            <thead>
                <tr>
                    <th style="width: 50px;" class="text-center">NO.</th>
                    <th class="text-left">PRODUCT</th>
                    <th style="width: 80px;" class="text-center">O.STOCK</th>
                    <th style="width: 95px;" class="text-center">ADDITION</th>
                    <th style="width: 95px;" class="text-center">C.STOCK</th>
                    <th style="width: 90px;" class="text-center">U.SOLD</th>
                    <th style="width: 90px;" class="text-center">U.PRICE</th>
                    <th style="width: 100px;" class="text-center">AMOUNT</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    let no = 1;
    let groups = Object.keys(data).sort();
    groups.forEach(group => {
        print_html += `
            <tr class="group-header">
                <td colspan="8" class="text-left">${group.toUpperCase()}</td>
            </tr>
        `;
        
        data[group].forEach(row => {
            let o_stock = (warehouse_type === "forecourt" ? row.op_forecourt : row.op_store) || 0;
            let price = row.unit_price || 0;
            
            print_html += `
                <tr class="data-row">
                    <td class="text-center">${no++}</td>
                    <td class="text-left" style="font-weight: bold;">${row.item_name}</td>
                    <td class="text-center">${o_stock}</td>
                    <td class="text-center"></td>
                    <td></td>
                    <td></td>
                    <td class="text-center">${price}</td>
                    <td></td>
                </tr>
            `;
        });
    });
    
    print_html += `
            </tbody>
        </table>
    </body>
    </html>
    `;
    
    let print_win = window.open('', '_blank');
    print_win.document.write(print_html);
    print_win.document.close();
    print_win.focus();
    setTimeout(() => {
        print_win.print();
        print_win.close();
    }, 500);
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
        
        if(targetView === 'form' && !$btn.hasClass('active')) {
            // They are manually clicking "New Purchase"
            window.EDITING_PURCHASE_ID = null;
            window.PURCHASE_CART = [];
            
            // clear form
            $wrapper.find('#pur-supplier').val('');
            $wrapper.find('#pur-doc-invoice').val('');
            $wrapper.find('#pur-kra-invoice').val('');
            $wrapper.find('#pur-rec-date').val(frappe.datetime.get_today());
            $wrapper.find('#pur-doc-date').val(frappe.datetime.get_today());
            $wrapper.find('#pur-transport-charge').val('');
            $wrapper.find('#pur-transport-vat').val('16');
            $wrapper.find('#pur-vat-rate').val('8');
            $wrapper.find('#pur-vat-incl').prop('checked', false);
            
            refresh_purchase_cart();
        }
        
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
        args: { doctype: "Item", fields: ["name", "item_name", "item_group"], filters: {disabled: 0}, limit_page_length: 5000 },
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
        args: { doctype: "Warehouse", fields: ["name", "warehouse_name"], filters: {is_group: 0, disabled: 0}, limit_page_length: 500 },
        callback: function(r) {
            let opts = '<option value="">Select Target...</option>';
            let forecourt_wh = "";
            if(r.message) {
                r.message.forEach(w => {
                    opts += `<option value="${w.name}">${w.warehouse_name}</option>`;
                    if (w.warehouse_name.toLowerCase().includes("forecourt") || w.name.toLowerCase().includes("forecourt")) {
                        forecourt_wh = w.name;
                    }
                });
            }
            $wrapper.find('#pur-target').html(opts);
            if (forecourt_wh) {
                $wrapper.find('#pur-target').val(forecourt_wh);
            }
        }
    });

        // 6. Refresh Cart Function
        let refresh_purchase_cart = function() {
            let html = '';
            let items_total = 0;
            
            window.PURCHASE_CART.forEach((row, idx) => {
                let amount = row.quantity * row.unit_cost;
                let vat_rate = parseFloat(row.vat_rate) || 0;
                let amount_grand = amount;
                if(!row.vat_inclusive && vat_rate > 0) {
                    amount_grand = amount * (1 + (vat_rate / 100));
                }
                items_total += amount_grand;
                
                let vat_lbl = row.vat_inclusive ? 'Incl' : (vat_rate > 0 ? '+VAT' : 'No VAT');
                
                html += `
                    <tr>
                        <td>${row.item_name} <br><small style="color:var(--text-muted)">VAT: ${vat_rate}% (${vat_lbl})</small></td>
                        <td>${row.target_location}</td>
                        <td>${row.quantity}</td>
                        <td>${frappe.format(row.unit_cost, {fieldtype: 'Currency'})}</td>
                        <td>${frappe.format(amount_grand, {fieldtype: 'Currency'})}</td>
                        <td><button class="btn-secondary btn-remove-pur-cart" data-idx="${idx}" style="padding: 4px 8px; font-size: 12px; color: #ef4444; border-color: #fca5a5;">X</button></td>
                    </tr>
                `;
            });
            
            if (window.PURCHASE_CART.length === 0) {
                html = '<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 2rem;">Cart is empty</td></tr>';
            }
            
            $wrapper.find('#list-purchase-cart').html(html);
            
            $wrapper.find('.btn-remove-pur-cart').off('click').on('click', function() {
                let idx = parseInt($(this).attr('data-idx'));
                window.PURCHASE_CART.splice(idx, 1);
                refresh_purchase_cart();
            });
            
            // Update Totals
            let transport_base = parseFloat($wrapper.find('#pur-transport-charge').val()) || 0;
            let transport_vat = parseFloat($wrapper.find('#pur-transport-vat').val()) || 0;
            let transport = transport_base;
            if (transport_vat > 0) {
                transport = transport_base * (1 + (transport_vat / 100));
            }
            
            let grand_total = items_total + transport;
            
            $wrapper.find('#pur-net').html(frappe.format(items_total, {fieldtype: 'Currency'})); // display items total here
            $wrapper.find('#pur-total').html(frappe.format(grand_total, {fieldtype: 'Currency'}));
        };
    
        $wrapper.find('#pur-transport-charge, #pur-transport-vat').on('input change', refresh_purchase_cart);
        
        let calculate_live_total = function() {
            let qty = parseFloat($wrapper.find('#pur-qty').val()) || 0;
            let cost = parseFloat($wrapper.find('#pur-cost').val()) || 0;
            let vat_rate = parseFloat($wrapper.find('#pur-vat-rate').val()) || 0;
            let is_incl = $wrapper.find('#pur-vat-incl').is(':checked');
            
            let total = qty * cost;
            if(!is_incl && vat_rate > 0) {
                total = total * (1 + (vat_rate / 100));
            }
            $wrapper.find('#pur-live-total').html(frappe.format(total, {fieldtype: 'Currency'}));
        };
        
        $wrapper.find('#pur-qty, #pur-cost, #pur-vat-rate, #pur-vat-incl').on('input change', calculate_live_total);

    
        $wrapper.find('#pur-item-input').off('input change').on('input change', function() {
            let val = ($(this).val() || '').trim();
            if (!val) return;
            let match = (window.PURCHASE_ITEMS || []).find(i => 
                `${i.item_name} - ${i.name}`.toLowerCase() === val.toLowerCase() ||
                (i.name && i.name.toLowerCase() === val.toLowerCase()) ||
                (i.item_name && i.item_name.toLowerCase() === val.toLowerCase())
            );
            if (match) {
                let group = (match.item_group || '').toUpperCase();
                let name = (match.item_name || match.name || '').toUpperCase();

                let is_fuel = group.includes("FUEL") || name.includes("PETROL") || name.includes("DIESEL") || name.includes("KEROSENE") || name.includes("AGO") || name.includes("PMS") || name.includes("IK");
                let is_gas = group.includes("GAS") || group.includes("CYLINDER") || name.includes("GAS") || name.includes("CYLINDER") || name.includes("LPG") || name.includes("6KG") || name.includes("13KG") || name.includes("35KG") || name.includes("50KG");

                let forecourt_wh = "";
                let store_wh = "";
                $wrapper.find('#pur-target option').each(function() {
                    let txt = $(this).text().toLowerCase();
                    let v = $(this).val();
                    if (v) {
                        if (txt.includes("forecourt")) forecourt_wh = v;
                        else if (txt.includes("store")) store_wh = v;
                    }
                });

                if (is_fuel) {
                    // 1. Fuels -> Forecourt & 8% VAT
                    if (forecourt_wh) $wrapper.find('#pur-target').val(forecourt_wh);
                    $wrapper.find('#pur-vat-rate').val('8');
                } else if (is_gas) {
                    // 2. Gasses and Cylinders -> Forecourt & 0% VAT
                    if (forecourt_wh) $wrapper.find('#pur-target').val(forecourt_wh);
                    $wrapper.find('#pur-vat-rate').val('0');
                } else {
                    // 3. Other items (Lubes, Filters, Accessories, etc.) -> Store & 16% VAT
                    if (store_wh) $wrapper.find('#pur-target').val(store_wh);
                    $wrapper.find('#pur-vat-rate').val('16');
                }
                calculate_live_total();
            }
        });

    // 7. Add Item to Cart
    $wrapper.find('#btn-add-purchase-item').off('click').on('click', function() {
        let val = ($wrapper.find('#pur-item-input').val() || '').trim();
        let match = (window.PURCHASE_ITEMS || []).find(i => 
            `${i.item_name} - ${i.name}`.toLowerCase() === val.toLowerCase() ||
            (i.name && i.name.toLowerCase() === val.toLowerCase()) ||
            (i.item_name && i.item_name.toLowerCase() === val.toLowerCase())
        );
        let item_code = match ? match.name : val;
        let item_name = match ? match.item_name : val;
        
        let target = $wrapper.find('#pur-target').val();
        let qty = parseFloat($wrapper.find('#pur-qty').val()) || 0;
        let cost = parseFloat($wrapper.find('#pur-cost').val()) || 0;
        let vat_rate = parseFloat($wrapper.find('#pur-vat-rate').val()) || 0;
        let vat_incl = $wrapper.find('#pur-vat-incl').is(':checked') ? 1 : 0;
        
        if (!item_code || !target || qty <= 0 || cost <= 0) {
            frappe.show_alert({message: "Item, Target, Quantity, and Unit Cost are required.", indicator: "red"});
            return;
        }
        
        window.PURCHASE_CART.push({
            item: item_code,
            item_name: item_name,
            target_location: target,
            quantity: qty,
            unit_cost: cost,
            vat_rate: vat_rate,
            vat_inclusive: vat_incl
        });
        
        // Clear item inputs
        $wrapper.find('#pur-item-input').val('');
        $wrapper.find('#pur-qty').val('');
        $wrapper.find('#pur-cost').val('');
        $wrapper.find('#pur-vat-rate').val('8');
        $wrapper.find('#pur-vat-incl').prop('checked', false);
        $wrapper.find('#pur-live-total').html('0.00');
        
        refresh_purchase_cart();
    });

    // 8. Fetch History
    let fetch_history = function() {
        let date_from = $wrapper.find('#pur-filter-date-from').val();
        let date_to = $wrapper.find('#pur-filter-date-to').val();

        frappe.call({
            method: "fuel_management.fuel_management.doctype.station_purchase.station_purchase.get_purchases_history",
            args: {
                date_from: date_from,
                date_to: date_to
            },
            callback: function(r) {
                let count = r.message ? r.message.length : 0;
                if (!date_from && !date_to) {
                    $wrapper.find('#pur-history-subtitle').html(`<span style="color:#64748b; font-size:0.85rem;">(Showing latest 20 entries &bull; Use date filter for more)</span>`);
                } else {
                    $wrapper.find('#pur-history-subtitle').html(`<span style="color:#047857; font-size:0.85rem; font-weight:600;">(Showing ${count} filtered entries)</span>`);
                }
                let html = '';
                let total_amount = 0;
                if(r.message) {
                    r.message.forEach(row => {
                        let items_html = (row.items || []).map(i => `<div><small>${i.quantity}x ${i.item}</small></div>`).join('');
                        html += `
                            <tr>
                                <td>${row.name}</td>
                                <td>${row.receiving_date}</td>
                                <td>${row.supplier}</td>
                                <td>${items_html}</td>
                                <td><span class="badge" style="background: #f1f5f9;">${row.tax_invoice_number || "N/A"}</span></td>
                                <td><span class="badge" style="background: #f1f5f9;">${row.document_invoice_number || "N/A"}</span></td>
                                <td style="font-weight: 600;">${frappe.format(row.grand_total || 0, {fieldtype: 'Currency'})}</td>
                                <td>
                                    <button class="btn btn-xs btn-default btn-edit-pur" data-name="${row.name}" style="margin-right: 5px;"><i class="fa fa-pencil"></i></button>
                                    <button class="btn btn-xs btn-danger btn-delete-pur" data-name="${row.name}"><i class="fa fa-trash"></i></button>
                                </td>
                            </tr>
                        `;
                    });
                }
                if(html === '') html = '<tr><td colspan="8" class="text-center" style="color: #94a3b8; padding: 2rem;">No purchases recorded yet.</td></tr>';
                
                $wrapper.find('#list-station-purchases-saved').html(html);
            }
        });
    };
    fetch_history();
    
    $wrapper.find('#pur-filter-date-from, #pur-filter-date-to').on('change', fetch_history);
    $wrapper.on('click', '.btn-delete-pur', function() {
        let name = $(this).data('name');
        frappe.confirm('Are you sure you want to delete purchase ' + name + '? This will also cancel the associated Purchase Invoice and revert tank volumes.', () => {
            frappe.call({
                method: "fuel_management.fuel_management.doctype.station_purchase.station_purchase.delete_purchase",
                args: { purchase_name: name },
                callback: function(r) {
                    if(!r.exc) {
                        frappe.show_alert({message: "Purchase deleted successfully.", indicator: "green"});
                        fetch_history();
                    }
                }
            });
        });
    });

    $wrapper.on('click', '.btn-edit-pur', function() {
        let name = $(this).data('name');
        frappe.call({
            method: "fuel_management.fuel_management.doctype.station_purchase.station_purchase.get_purchase_details",
            args: { purchase_name: name },
            callback: function(r) {
                if(r.message) {
                    let doc = r.message;
                    // Populate form
                    $wrapper.find('#pur-supplier').val(doc.supplier);
                    $wrapper.find('#pur-doc-invoice').val(doc.document_invoice_number);
                    $wrapper.find('#pur-kra-invoice').val(doc.tax_invoice_number);
                    $wrapper.find('#pur-rec-date').val(doc.receiving_date);
                    $wrapper.find('#pur-doc-date').val(doc.document_date);
                    $wrapper.find('#pur-transport-charge').val(doc.transport_charge || 0);
                    $wrapper.find('#pur-transport-vat').val(0); // Optional
                    
                    // Populate cart
                    window.PURCHASE_CART = [];
                    (doc.items || []).forEach(item => {
                        window.PURCHASE_CART.push({
                            item: item.item,
                            item_name: item.item,
                            target_location: item.target_location,
                            quantity: item.quantity,
                            unit_cost: item.unit_cost,
                            vat_rate: item.vat_rate || 0,
                            vat_inclusive: item.vat_inclusive ? 1 : 0
                        });
                    });
                    refresh_purchase_cart();
                    
                    // Set edit mode flag
                    window.EDITING_PURCHASE_ID = name;
                    
                    // Switch view to New Purchase
                    $wrapper.find('#purchases-history-view').removeClass('active');
                    $wrapper.find('#purchases-form-view').addClass('active');
                    $wrapper.find('.seg-btn').removeClass('active');
                    $wrapper.find('.seg-btn[data-view="form"]').addClass('active');
                    
                    frappe.show_alert({message: "Editing Purchase: " + name + ". Save will replace it.", indicator: "blue"});
                }
            }
        });
    });


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
        let transport_base = parseFloat($wrapper.find('#pur-transport-charge').val()) || 0;
        let transport_vat = parseFloat($wrapper.find('#pur-transport-vat').val()) || 0;
        let transport = transport_base;
        if (transport_vat > 0) {
            transport = transport_base * (1 + (transport_vat / 100));
        }

        if (!supplier || !doc_invoice || !rec_date || !doc_date) {
            frappe.show_alert({message: "Supplier, Document Invoice No, Receiving Date and Document Date are required.", indicator: "red"});
            return;
        }
        
        if (window.PURCHASE_CART.length === 0) {
            frappe.show_alert({message: "Please add at least one item.", indicator: "red"});
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
            items: window.PURCHASE_CART.map(item => {
                return {
                    item: item.item,
                    target_location: item.target_location,
                    quantity: item.quantity,
                    unit_cost: item.unit_cost,
                    vat_rate: item.vat_rate,
                    vat_inclusive: item.vat_inclusive
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

    // Update Context Labels
    if (window.ACTIVE_SHIFT) {
        $wrapper.find('#pc-shift-name').text(window.ACTIVE_SHIFT.name || '--');
        $wrapper.find('#pc-shift-date').text(window.ACTIVE_SHIFT.shift_date || frappe.datetime.nowdate());
        $wrapper.find('#pc-history-shift-name').text(window.ACTIVE_SHIFT.name || '--');
        $wrapper.find('#pc-history-shift-date').text(window.ACTIVE_SHIFT.shift_date || frappe.datetime.nowdate());
    }

    // 1. Populate CSAs (Head CSA + Assigned CSAs)
    let csaOptions = '<option value="">Select CSA (Whose Cash was Used)...</option>';
    let allowed_csas = [];
    if(window.SHIFT_DOC && window.SHIFT_DOC.head_csa) {
        let head_emp = window.USERS_LIST ? window.USERS_LIST.find(u => u.user_id === window.SHIFT_DOC.head_csa || u.name === window.SHIFT_DOC.head_csa) : null;
        if (head_emp) allowed_csas.push(head_emp.name);
        else allowed_csas.push(window.SHIFT_DOC.head_csa);
    }
    if(window.SHIFT_DOC && window.SHIFT_DOC.assigned_csas) {
        window.SHIFT_DOC.assigned_csas.forEach(row => {
            if(row.csa) allowed_csas.push(row.csa);
        });
    }
    if(allowed_csas.length === 0 && window.USERS_LIST) {
        window.USERS_LIST.forEach(u => allowed_csas.push(u.name));
    }
    allowed_csas = [...new Set(allowed_csas)];
    let sorted_csas = allowed_csas.map(csa => {
        let u = window.USERS_LIST ? window.USERS_LIST.find(user => user.name === csa || user.user_id === csa) : null;
        let name = u ? (u.employee_name || u.full_name || csa) : csa;
        return {csa, name};
    }).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
    
    sorted_csas.forEach(item => {
        csaOptions += `<option value="${item.csa}">${item.name}</option>`;
    });

    $wrapper.find('#pc-csa').html(csaOptions);
    $wrapper.find('#pc-filter-csa').html('<option value="">All CSAs</option>' + sorted_csas.map(item => `<option value="${item.csa}">${item.name}</option>`).join(''));

    // If only 1 CSA exists on shift, auto-select them
    if (sorted_csas.length === 1) {
        $wrapper.find('#pc-csa').val(sorted_csas[0].csa);
    }

    // Populate Payee Datalist and Quick-Pick Chips
    let datalist_html = '';
    let quick_chips_html = '<span style="font-size: 0.72rem; color: #64748b; font-weight: 700; align-self: center; margin-right: 2px;">Quick CSA Pick:</span>';
    sorted_csas.forEach(item => {
        datalist_html += `<option value="${item.name}">${item.name} (${item.csa})</option>`;
        quick_chips_html += `
            <button type="button" class="btn-pc-csa-quick-chip" data-csa="${item.csa}" data-name="${item.name}" style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; cursor: pointer; transition: all 0.15s; white-space: nowrap;">
                👤 ${item.name}
            </button>
        `;
    });
    datalist_html += `
        <option value="Station Cleaning / Cleaner"></option>
        <option value="Security / Guard"></option>
        <option value="Driver"></option>
        <option value="Hardware / Maintenance"></option>
        <option value="Office Supplies"></option>
        <option value="Electricity / Water Token"></option>
    `;
    $wrapper.find('#pc-payee-datalist').html(datalist_html);
    $wrapper.find('#pc-payee-quick-picks').html(quick_chips_html);

    // Quick chip click handler
    $wrapper.find('.btn-pc-csa-quick-chip').off('click').on('click', function(e) {
        e.preventDefault();
        let csa_id = $(this).data('csa');
        let csa_name = $(this).data('name');
        $wrapper.find('#pc-payee').val(csa_name);
        $wrapper.find('#pc-csa').val(csa_id).trigger('change');
        frappe.show_alert({message: `Selected Payee: ${csa_name} (Deducting from ${csa_name})`, indicator: "blue"});
    });

    // Auto-sync when #pc-csa changes
    $wrapper.find('#pc-csa').off('change').on('change', function() {
        let selected_csa = $(this).val();
        if(selected_csa) {
            let found = sorted_csas.find(item => item.csa === selected_csa);
            if(found && !$wrapper.find('#pc-payee').val()) {
                $wrapper.find('#pc-payee').val(found.name);
            }
        }
    });

    // Auto-sync when #pc-payee is typed or picked
    $wrapper.find('#pc-payee').off('input change').on('input change', function() {
        let val = ($(this).val() || '').trim().toLowerCase();
        if(val) {
            let matched = sorted_csas.find(item => 
                item.name.toLowerCase() === val || 
                item.csa.toLowerCase() === val || 
                item.name.toLowerCase().includes(val) ||
                val.includes(item.name.toLowerCase())
            );
            if(matched && !$wrapper.find('#pc-csa').val()) {
                $wrapper.find('#pc-csa').val(matched.csa);
            }
        }
    });
    
    // 2. Load Active Petty Cash Accounts
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
            if(r.message && r.message.length > 0) {
                window.PETTY_CASH_ACCOUNTS = r.message;
                r.message.forEach(acc => {
                    $select.append(`<option value="${acc.name}">${acc.name}</option>`);
                });
                // Default select the first active account if available
                if (r.message.length === 1) {
                    $select.val(r.message[0].name).trigger('change');
                }
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
    
    // 3. Load Expense Claim Categories
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

    // 4. Load Chart of Accounts Expense Accounts
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Account",
            filters: { root_type: "Expense", is_group: 0 },
            fields: ["name", "account_name", "account_type"],
            order_by: "account_name asc",
            limit_page_length: 500
        },
        callback: function(r) {
            let $select = $wrapper.find('#pc-expense-account');
            $select.empty().append('<option value="">Select Expense Account (Chart of Accounts)...</option>');
            if(r.message) {
                window.COA_EXPENSE_ACCOUNTS = r.message;
                r.message.forEach(acc => {
                    let type_badge = acc.account_type ? ` [${acc.account_type}]` : '';
                    $select.append(`<option value="${acc.name}">${acc.account_name} (${acc.name})${type_badge}</option>`);
                });
            }
        }
    });

    // 5. Filter Listeners for History
    $wrapper.find('#pc-filter-search, #pc-filter-csa').off('input change').on('input change', function() {
        load_petty_cash_history($wrapper);
    });

    // 6. Save Logic
    $wrapper.find('#btn-save-petty-cash').off('click').on('click', function() {
        if(!window.ACTIVE_SHIFT) {
            frappe.show_alert({message: "No active shift found.", indicator: "red"});
            return;
        }

        let is_locked = window.ACTIVE_SHIFT.status !== 'Open';
        if (is_locked) {
            frappe.show_alert({message: "Shift is closed/locked.", indicator: "red"});
            return;
        }
        
        let csa = $wrapper.find('#pc-csa').val();
        let account = $wrapper.find('#pc-account').val();
        let expense_account = $wrapper.find('#pc-expense-account').val();
        let category = $wrapper.find('#pc-category').val();
        let payee = ($wrapper.find('#pc-payee').val() || '').trim();
        let amount = parseFloat($wrapper.find('#pc-amount').val());
        let memo = ($wrapper.find('#pc-memo').val() || '').trim();

        // Auto-resolve CSA from Payee if not explicitly selected
        if(!csa && payee) {
            let matched = sorted_csas.find(item => 
                item.name.toLowerCase() === payee.toLowerCase() || 
                item.csa.toLowerCase() === payee.toLowerCase() ||
                item.name.toLowerCase().includes(payee.toLowerCase()) ||
                payee.toLowerCase().includes(item.name.toLowerCase())
            );
            if(matched) {
                csa = matched.csa;
                $wrapper.find('#pc-csa').val(csa);
            }
        }

        // If only 1 CSA exists on shift and csa is still empty, auto-use that CSA
        if(!csa && sorted_csas.length === 1) {
            csa = sorted_csas[0].csa;
            $wrapper.find('#pc-csa').val(csa);
        }
        
        if(!csa) {
            frappe.show_alert({message: "Please select the CSA who paid/spent this petty cash.", indicator: "red"});
            $wrapper.find('#pc-csa').focus();
            return;
        }
        if(!account) {
            frappe.show_alert({message: "Please select the Petty Cash Account.", indicator: "red"});
            return;
        }
        if(!category) {
            frappe.show_alert({message: "Please select an Expense Category.", indicator: "red"});
            return;
        }
        if(!expense_account) {
            frappe.show_alert({message: "Please select the Chart of Accounts Expense Account.", indicator: "red"});
            return;
        }
        if(!payee) {
            frappe.show_alert({message: "Please enter the Payee / Beneficiary.", indicator: "red"});
            return;
        }
        if(isNaN(amount) || amount <= 0) {
            frappe.show_alert({message: "Please enter a valid positive Amount.", indicator: "red"});
            return;
        }
        if(!memo) {
            frappe.show_alert({message: "Please enter a Description / Purpose.", indicator: "red"});
            return;
        }
        
        let $btn = $(this);
        let orig_html = $btn.html();
        $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span> Saving...');
        
        frappe.call({
            method: "frappe.client.insert",
            args: {
                doc: {
                    doctype: "Station Petty Cash Entry",
                    shift: window.ACTIVE_SHIFT.name,
                    date: (window.SHIFT_DOC && window.SHIFT_DOC.shift_date) || frappe.datetime.get_today(),
                    csa: csa,
                    petty_cash_account: account,
                    expense_account: expense_account,
                    category: category,
                    payee: payee,
                    amount: amount,
                    memo: memo
                }
            },
            callback: function(r) {
                $btn.prop('disabled', false).html(orig_html);
                
                if(!r.exc) {
                    frappe.show_alert({message: "Petty Cash Entry saved successfully!", indicator: "green"});
                    // Reset form
                    $wrapper.find('#pc-csa').val('');
                    $wrapper.find('#pc-category').val('');
                    $wrapper.find('#pc-expense-account').val('');
                    $wrapper.find('#pc-payee').val('');
                    $wrapper.find('#pc-amount').val('');
                    $wrapper.find('#pc-memo').val('');
                    
                    // Update Petty Cash balance in window cache
                    let pc_acc = (window.PETTY_CASH_ACCOUNTS || []).find(a => a.name === account);
                    if (pc_acc) {
                        pc_acc.current_balance = (pc_acc.current_balance || 0) - amount;
                        $wrapper.find('#pc-balance').val(format_currency(pc_acc.current_balance));
                    }
                    
                    // Refresh History
                    load_petty_cash_history($wrapper);
                    
                    // Switch back to history view
                    $wrapper.find('#tab-petty-cash .seg-btn[data-view="history"]').click();
                }
            },
            error: function() {
                $btn.prop('disabled', false).html(orig_html);
            }
        });
    });

    load_petty_cash_history($wrapper);
}

function load_petty_cash_history($wrapper) {
    if(!window.ACTIVE_SHIFT) return;
    
    let search = ($wrapper.find('#pc-filter-search').val() || '').toLowerCase().trim();
    let filter_csa = $wrapper.find('#pc-filter-csa').val();

    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Station Petty Cash Entry",
            filters: { shift: window.ACTIVE_SHIFT.name },
            fields: ["name", "date", "creation", "csa", "petty_cash_account", "expense_account", "category", "payee", "amount", "memo"],
            order_by: "creation desc",
            limit_page_length: 500
        },
        callback: function(r) {
            let $tbody = $wrapper.find('#list-petty-cash-saved');
            $tbody.empty();
            
            let total_shift_pc = 0;

            if(r.message && r.message.length > 0) {
                let filtered = r.message.filter(row => {
                    if (filter_csa && row.csa !== filter_csa) return false;
                    if (search) {
                        let text = `${row.name} ${row.payee || ''} ${row.memo || ''} ${row.category || ''} ${row.expense_account || ''}`.toLowerCase();
                        if (!text.includes(search)) return false;
                    }
                    return true;
                });

                r.message.forEach(row => {
                    total_shift_pc += (parseFloat(row.amount) || 0);
                });

                if (filtered.length > 0) {
                    filtered.forEach(row => {
                        let timeStr = row.creation ? (row.creation.split(' ')[1] ? row.creation.split(' ')[1].substring(0, 5) : "") : "";
                        let csa_name = row.csa;
                        if (window.USERS_LIST) {
                            let u = window.USERS_LIST.find(user => user.name === row.csa);
                            if(u) csa_name = u.employee_name || u.full_name;
                        }

                        let html = `
                            <tr>
                                <td><b style="font-family: monospace; color: #1e293b;">${row.name}</b></td>
                                <td style="color: #64748b; font-size: 0.85rem;">${timeStr}</td>
                                <td><span style="font-weight: 700; color: #1e40af; background: #eff6ff; padding: 2px 6px; border-radius: 4px;">👤 ${csa_name || '--'}</span></td>
                                <td><span class="badge" style="background: #f1f5f9; color: #475569; font-weight: 600;">${row.category || '--'}</span></td>
                                <td style="font-size: 0.85rem; color: #065f46; font-weight: 600;">${row.expense_account || '<span style="color:#94a3b8;">Not Specified</span>'}</td>
                                <td style="font-weight: 600; color: #334155;">${row.payee || '--'}</td>
                                <td class="text-right" style="font-weight: 800; color: #059669; font-size: 0.95rem;">${format_currency(row.amount)}</td>
                                <td style="color: #475569; font-size: 0.85rem;" title="${row.memo || ''}">${row.memo || '--'}</td>
                            </tr>
                        `;
                        $tbody.append(html);
                    });
                } else {
                    $tbody.append('<tr><td colspan="8" class="text-center text-muted" style="padding: 2rem;">No matching petty cash entries found.</td></tr>');
                }
            } else {
                $tbody.append('<tr><td colspan="8" class="text-center text-muted" style="padding: 2rem;">No petty cash entries recorded for this shift yet.</td></tr>');
            }

            $wrapper.find('#pc-history-total').text(`Total Shift Petty Cash: ${format_currency(total_shift_pc)}`);
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

    $wrapper.find('#ct-filter-date-from, #ct-filter-date-to').off('change').on('change', function() {
        load_cash_transfer_history($wrapper);
    });
    load_cash_transfer_history($wrapper);
}

function load_cash_transfer_history($wrapper) {
    let date_from = $wrapper.find('#ct-filter-date-from').val();
    let date_to = $wrapper.find('#ct-filter-date-to').val();
    let filters = { docstatus: ["<", 2] };
    if (date_from && date_to) {
        filters.date = ["between", [date_from, date_to]];
    } else if (date_from) {
        filters.date = [">=", date_from];
    } else if (date_to) {
        filters.date = ["<=", date_to];
    }
    let limit_num = (date_from || date_to) ? 1000 : 20;

    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Station Cash Transfer",
            filters: filters,
            fields: ["name", "date", "transaction_number", "destination_account", "amount", "entered_by"],
            order_by: "date desc, creation desc",
            limit_page_length: limit_num
        },
        callback: function(r) {
            let count = r.message ? r.message.length : 0;
            if (!date_from && !date_to) {
                $wrapper.find('#ct-history-subtitle').html(`<span style="color:#64748b; font-size:0.85rem;">(Showing latest 20 entries &bull; Use date filter for more)</span>`);
            } else {
                $wrapper.find('#ct-history-subtitle').html(`<span style="color:#047857; font-size:0.85rem; font-weight:600;">(Showing ${count} filtered entries)</span>`);
            }
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
    if(!window.ACTIVE_SHIFT) return;
    
    // Populate CSA selector
    let csaOptions = '<option value="">-- Select CSA to Reconcile --</option>';
    let allowed_csas = [];
    // Removed head_csa per user request
    if(window.SHIFT_DOC && window.SHIFT_DOC.assigned_csas) {
        window.SHIFT_DOC.assigned_csas.forEach(row => {
            if(row.csa) allowed_csas.push(row.csa);
        });
    }
    allowed_csas = [...new Set(allowed_csas)];
    
    
    let sorted_csas = allowed_csas.map(csa => {
        let u = window.USERS_LIST ? window.USERS_LIST.find(u => u.name === csa) : null;
        let name = u ? (u.employee_name || u.full_name) : csa;
        return {csa, name};
    }).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
    
    sorted_csas.forEach(item => {
        csaOptions += `<option value="${item.csa}">${item.name}</option>`;
    });

    
    $wrapper.find('#recon-csa-select').html(csaOptions);
    
    // Bind CSA selection
    $wrapper.find('#recon-csa-select').off('change').on('change', function() {
        let csa = $(this).val();
        if(!csa) {
            $wrapper.find('#recon-csa-container').hide();
            return;
        }
        $wrapper.find('#recon-csa-container').show();
        load_csa_reconciliation($wrapper, csa);
    });
    
    // Bind Actual Cash input
    $wrapper.find('#recon-actual-cash').off('input').on('input', function() {
        calculate_csa_variance($wrapper);
    });
    
    // Bind Save
    $wrapper.find('#btn-save-recon').off('click').on('click', function() {
        save_csa_reconciliation($wrapper);
    });
    
    load_reconciliation_history($wrapper);
}

function load_csa_reconciliation($wrapper, csa) {
    let shift_name = window.ACTIVE_SHIFT.name;
    
    // Populate CSA Avatar & Assigned Stations Info
    let u = window.USERS_LIST ? window.USERS_LIST.find(user => user.name === csa) : null;
    let csa_name = u ? (u.employee_name || u.full_name) : csa;
    let initials = csa_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    $wrapper.find('#recon-csa-avatar').text(initials || 'CSA');
    $wrapper.find('#recon-selected-csa-name').text(csa_name);
    
    let assigned_pgs = [];
    if (window.SHIFT_DOC && window.SHIFT_DOC.assigned_csas) {
        window.SHIFT_DOC.assigned_csas.forEach(row => {
            if (row.csa === csa && row.pump_group) assigned_pgs.push(row.pump_group);
        });
    }
    let pgs_text = assigned_pgs.length > 0 ? `Assigned Stations: ${assigned_pgs.join(', ')}` : 'Station Forecourt';
    $wrapper.find('#recon-selected-csa-groups').text(pgs_text);

    // Reset UI
    $wrapper.find('#recon-actual-cash').val('');
    $wrapper.find('#recon-variance').text('Sh 0.00').css('color', '#94a3b8');
    $wrapper.find('#recon-variance-badge').text('Awaiting Input').css({ background: '#f1f5f9', color: '#64748b' });
    $wrapper.find('#recon-variance-box').css({ border: '1px solid #e2e8f0', background: '#f8fafc' });
    
    frappe.call({
        method: "fuel_management.fuel_management.api.get_csa_reconciliation_data",
        args: { shift_id: shift_name, csa_id: csa },
        callback: function(r) {
            if(r.message) {
                window.CURRENT_RECON = r.message;
                window.CURRENT_RECON.csa = csa;
                
                // Liabilities
                $wrapper.find('#recon-meter-sales').text(format_currency(r.message.meter_sales));
                $wrapper.find('#recon-inventory-sales').text(format_currency(r.message.inventory_sales));
                $wrapper.find('#recon-greasing-sales').text(format_currency(r.message.greasing_sales));
                $wrapper.find('#recon-customer-payments').text(format_currency(r.message.customer_payments));
                
                let tot_liab = (r.message.meter_sales || 0) + (r.message.inventory_sales || 0) + (r.message.greasing_sales || 0) + (r.message.customer_payments || 0);
                $wrapper.find('#recon-total-liabilities').text(format_currency(tot_liab));
                window.CURRENT_RECON.total_liabilities = tot_liab;
                
                // Deductions
                $wrapper.find('#recon-mpesa').text(format_currency(r.message.mpesa));
                $wrapper.find('#recon-invoices').text(format_currency(r.message.invoices));
                $wrapper.find('#recon-cards').text(format_currency(r.message.cards));
                $wrapper.find('#recon-expenses').text(format_currency(r.message.expenses));
                $wrapper.find('#recon-rtt').text(format_currency(r.message.rtt_deductions));
                $wrapper.find('#recon-discounts').text(format_currency(r.message.discounts || 0));
                
                let tot_deduct = (r.message.mpesa || 0) + (r.message.invoices || 0) + (r.message.cards || 0) + (r.message.expenses || 0) + (r.message.rtt_deductions || 0) + (r.message.discounts || 0);
                $wrapper.find('#recon-total-deductions').text(format_currency(tot_deduct));
                window.CURRENT_RECON.total_deductions = tot_deduct;
                window.CURRENT_RECON.discounts = r.message.discounts || 0;
                
                // Expected
                let expected = tot_liab - tot_deduct;
                $wrapper.find('#recon-expected-cash').text(format_currency(expected));
                window.CURRENT_RECON.expected_cash = expected;
                
                calculate_csa_variance($wrapper);
            }
        }
    });
}

function calculate_csa_variance($wrapper) {
    if(!window.CURRENT_RECON) return;
    let expected = window.CURRENT_RECON.expected_cash || 0;
    let actual_input = $wrapper.find('#recon-actual-cash').val();
    
    let $var = $wrapper.find('#recon-variance');
    let $badge = $wrapper.find('#recon-variance-badge');
    let $box = $wrapper.find('#recon-variance-box');

    if (actual_input === '' || actual_input === null || actual_input === undefined) {
        $var.text('Sh 0.00').css('color', '#94a3b8');
        $badge.text('Awaiting Input').css({ background: '#f1f5f9', color: '#64748b' });
        $box.css({ border: '1px solid #e2e8f0', background: '#f8fafc' });
        return;
    }

    let actual = parseFloat(actual_input) || 0;
    let variance = actual - expected;
    
    $var.text(format_currency(variance));
    
    if (Math.abs(variance) < 0.01) {
        $var.css('color', '#16a34a');
        $badge.text('Exact Balanced').css({ background: '#dcfce7', color: '#166534' });
        $box.css({ border: '2px solid #86efac', background: '#f0fdf4' });
    } else if (variance < 0) {
        $var.css('color', '#dc2626');
        $badge.text(`Shortage (${format_currency(Math.abs(variance))})`).css({ background: '#fee2e2', color: '#991b1b' });
        $box.css({ border: '2px solid #fca5a5', background: '#fff1f2' });
    } else {
        $var.css('color', '#2563eb');
        $badge.text(`Excess (+${format_currency(variance)})`).css({ background: '#dbeafe', color: '#1e40af' });
        $box.css({ border: '2px solid #93c5fd', background: '#eff6ff' });
    }
}

function save_csa_reconciliation($wrapper) {
    if(!window.CURRENT_RECON) return;
    let actual = parseFloat($wrapper.find('#recon-actual-cash').val());
    if(isNaN(actual)) {
        frappe.msgprint("Please enter the actual cash submitted.");
        return;
    }
    
    let $btn = $wrapper.find('#btn-save-recon');
    $btn.prop('disabled', true);
    $btn.find('.spinner').removeClass('hidden');
    
    frappe.call({
        method: "frappe.client.insert",
        args: {
            doc: {
                doctype: "Shift Cash Reconciliation",
                shift: window.ACTIVE_SHIFT.name,
                csa: window.CURRENT_RECON.csa,
                manager: frappe.session.user,
                timestamp: frappe.datetime.now_datetime(),
                
                meter_sales: window.CURRENT_RECON.meter_sales,
                inventory_sales: window.CURRENT_RECON.inventory_sales,
                greasing_sales: window.CURRENT_RECON.greasing_sales,
                customer_payments: window.CURRENT_RECON.customer_payments,
                
                mpesa: window.CURRENT_RECON.mpesa,
                invoices: window.CURRENT_RECON.invoices,
                cards: window.CURRENT_RECON.cards,
                expenses: window.CURRENT_RECON.expenses,
                rtt_deductions: window.CURRENT_RECON.rtt_deductions,
                discounts: window.CURRENT_RECON.discounts || 0,
                
                actual_cash: actual
            }
        },
        callback: function(r) {
            $btn.prop('disabled', false);
            $btn.find('.spinner').addClass('hidden');
            
            if(!r.exc) {
                frappe.show_alert({message: "Reconciliation Saved!", indicator: "green"});
                
                // Clear inputs
                $wrapper.find('#recon-actual-cash').val('');
                $wrapper.find('#recon-csa-select').val('');
                $wrapper.find('#recon-csa-container').hide();
                window.CURRENT_RECON = null;
                
                load_reconciliation_history($wrapper);
            }
        }
    });
}

function load_reconciliation_history($wrapper) {
    if(!window.ACTIVE_SHIFT) return;
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Shift Cash Reconciliation",
            filters: { shift: window.ACTIVE_SHIFT.name },
            fields: ["name", "timestamp", "csa", "expected_cash", "actual_cash", "variance"],
            order_by: "creation desc"
        },
        callback: function(r) {
            let $tbody = $wrapper.find('#recon-history-body');
            $tbody.empty();
            if(r.message && r.message.length > 0) {
                r.message.forEach(row => {
                    let u = window.USERS_LIST ? window.USERS_LIST.find(u => u.name === row.csa) : null;
                    let csa_name = u ? (u.employee_name || u.full_name) : row.csa;
                    
                    let var_color = row.variance < 0 ? '#dc2626' : '#16a34a';
                    let edit_btn = window.ACTIVE_SHIFT.status === 'Open' ? `<button class="btn btn-xs btn-danger btn-delete-recon" data-name="${row.name}">Delete</button>` : '';
                    let print_btn = `<button class="btn btn-xs btn-primary btn-print-recon" data-name="${row.name}" style="margin-left: 5px;">Print</button>`;
                    
                    let html = `
                        <tr>
                            <td>${frappe.datetime.str_to_user(row.timestamp).split(' ')[1]}</td>
                            <td><b>${csa_name}</b></td>
                            <td class="text-right">${format_currency(row.expected_cash)}</td>
                            <td class="text-right">${format_currency(row.actual_cash)}</td>
                            <td class="text-right" style="color:${var_color}; font-weight:bold;">${format_currency(row.variance)}</td>
                            <td>${edit_btn}${print_btn}</td>
                        </tr>
                    `;
                    $tbody.append(html);
                });
                
                // Bind actions
                $tbody.find('.btn-delete-recon').click(function() {
                    let name = $(this).data('name');
                    frappe.confirm(`Are you sure you want to delete this reconciliation?`, function() {
                        frappe.call({
                            method: "frappe.client.delete",
                            args: { doctype: "Shift Cash Reconciliation", name: name },
                            callback: function(del_res) {
                                if(!del_res.exc) {
                                    frappe.show_alert({message: "Record deleted", indicator: "green"});
                                    load_reconciliation_history($wrapper);
                                }
                            }
                        });
                    });
                });

                $tbody.find('.btn-print-recon').click(function() {
                    let name = $(this).data('name');
                    let url = `/printview?doctype=Shift Cash Reconciliation&name=${encodeURIComponent(name)}&format=CSA Reconciliation Sign-Off`;
                    window.open(url, '_blank');
                });
            } else {
                $tbody.append('<tr><td colspan="6" class="text-center text-muted">No reconciliations completed yet.</td></tr>');
            }
            
            // Bind Consolidated Print
            $wrapper.find('#btn-print-consolidated-recon').off('click').on('click', function() {
                if(!window.ACTIVE_SHIFT) return;
                let url = `/printview?doctype=Shift&name=${encodeURIComponent(window.ACTIVE_SHIFT.name)}&format=Consolidated CSA Sign-Off`;
                window.open(url, '_blank');
            });
            
            // Re-populate dropdown to exclude already saved CSAs
            let saved_csas = r.message ? r.message.map(row => row.csa) : [];
            let csaOptions = '<option value="">-- Select CSA to Reconcile --</option>';
            let allowed_csas = [];
            
            if(window.SHIFT_DOC && window.SHIFT_DOC.assigned_csas) {
                window.SHIFT_DOC.assigned_csas.forEach(row => {
                    if(row.csa && !saved_csas.includes(row.csa)) allowed_csas.push(row.csa);
                });
            }
            allowed_csas = [...new Set(allowed_csas)];
            
            let sorted_csas = allowed_csas.map(csa => {
                let u = window.USERS_LIST ? window.USERS_LIST.find(u => u.name === csa) : null;
                let name = u ? (u.employee_name || u.full_name) : csa;
                return {csa, name};
            }).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
            
            sorted_csas.forEach(item => {
                csaOptions += `<option value="${item.csa}">${item.name}</option>`;
            });
            $wrapper.find('#recon-csa-select').html(csaOptions);
        }
    });
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
    if(window.SHIFT_DOC.head_csa) {
        let head_emp = window.USERS_LIST ? window.USERS_LIST.find(u => u.user_id === window.SHIFT_DOC.head_csa) : null;
        if (head_emp) allowed_csas.push(head_emp.name);
    }
    (window.SHIFT_DOC.assigned_csas || []).forEach(row => {
        if(row.csa) allowed_csas.push(row.csa);
    });
    
    // Remove duplicates
    allowed_csas = [...new Set(allowed_csas)];
    
    
    let sorted_csas = allowed_csas.map(csa => {
        let u = window.USERS_LIST ? window.USERS_LIST.find(u => u.name === csa) : null;
        let name = u ? (u.employee_name || u.full_name) : csa;
        return {csa, name};
    }).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
    
    sorted_csas.forEach(item => {
        csaOptions += `<option value="${item.csa}">${item.name}</option>`;
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
        let date_from = $wrapper.find('#sc-filter-date-from').val();
        let date_to = $wrapper.find('#sc-filter-date-to').val();
        let card_filter = $wrapper.find('#sc-filter-card').val();
        let csa_filter = $wrapper.find('#sc-filter-csa').val();

        frappe.call({
            method: "fuel_management.fuel_management.api.get_station_cards_history",
            args: {
                station: window.ACTIVE_SHIFT.station,
                from_date: date_from,
                to_date: date_to,
                card: card_filter,
                csa: csa_filter
            },
            callback: function(r) {
                if (!date_from && !date_to) {
                    $wrapper.find('#sc-history-subtitle').html(`<span style="color:#64748b; font-size:0.85rem;">(Showing latest 20 entries &bull; Use date filter for more)</span>`);
                } else {
                    $wrapper.find('#sc-history-subtitle').html(`<span style="color:#047857; font-size:0.85rem; font-weight:600;">(Showing ${r.message ? r.message.length : 0} filtered entries)</span>`);
                }
                let html = '';
                let total_amount = 0;
                if(r.message) {
                    r.message.forEach(row => {
                        total_amount += parseFloat(row.amount || 0);
                        let time_val = row.creation ? row.creation.split(" ")[1].substring(0, 5) : "";
                        let csa_name = row.csa;
                        if (window.USERS_LIST) {
                            let u = window.USERS_LIST.find(u => u.name === row.csa);
                            if (u) csa_name = u.employee_name || u.full_name;
                        }
                        
                        let can_edit = row.shift === window.ACTIVE_SHIFT.name && window.ACTIVE_SHIFT.status === 'Open';
                        let action_html = can_edit ? `
                            <button class="btn btn-xs btn-secondary btn-edit-sc">Edit</button>
                            <button class="btn btn-xs btn-danger btn-delete-sc" style="margin-left: 5px;">Delete</button>
                        ` : `
                            <button class="btn btn-xs btn-secondary" disabled>Edit</button>
                            <button class="btn btn-xs btn-danger" disabled style="margin-left: 5px;">Delete</button>
                        `;
                        let shift_name = row.shift_template || window.ACTIVE_SHIFT.shift_template || row.shift;
                        
                        html += `
                            <tr data-name="${row.name}" data-card="${row.card}" data-csa="${row.csa}" data-receipt="${row.receipt_no}" data-amount="${row.amount}" data-memo="${row.memo || ''}">
                                <td>${row.name}</td>
                                <td>${row.date ? frappe.datetime.str_to_user(row.date) : ''} (${shift_name})</td>
                                <td><a href="/app/station-cards/${row.name}">${row.receipt_no}</a></td>
                                <td>${row.card}</td>
                                <td>${csa_name}</td>
                                <td style="font-weight: 600;">${parseFloat(row.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                                <td>${action_html}</td>
                            </tr>
                        `;
                    });
                    
                    html += `
                        <tr style="background-color: #f8fafc;">
                            <td colspan="5" style="text-align: right; font-weight: 600; color: #475569;">TOTAL</td>
                            <td style="font-weight: 700; color: #047857;">${total_amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td></td>
                        </tr>
                    `;
                }
                if(html === '') html = '<tr><td colspan="8" class="text-center" style="color: #94a3b8; padding: 2rem;">No card payments recorded yet.</td></tr>';
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

    $wrapper.find('#sc-filter-date-from, #sc-filter-date-to, #sc-filter-card, #sc-filter-csa').on('change', fetch_history);

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
// =========================================================
// =========================================================
// GREASING MODULE
// =========================================================
function render_greasing(wrapper) {
    const $wrapper = $(wrapper);
    if(!window.ACTIVE_SHIFT && !window.SHIFT_DOC) return;

    let is_locked = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.status !== 'Open') || (window.SHIFT_DOC && window.SHIFT_DOC.status !== 'Open');

    // Set Shift Context Badges
    let shift_name = (window.SHIFT_DOC && (window.SHIFT_DOC.shift_name_display || window.SHIFT_DOC.name)) || (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.name) || "--";
    let shift_date = (window.SHIFT_DOC && window.SHIFT_DOC.shift_date) ? (frappe.datetime.str_to_user(window.SHIFT_DOC.shift_date) || window.SHIFT_DOC.shift_date) : "--";
    
    $wrapper.find('#greasing-shift-name').text(shift_name);
    $wrapper.find('#greasing-shift-date').text(shift_date);

    if(is_locked) {
        $wrapper.find('#greasing-status-badge').html('<span>🔒 Shift Closed / Read-Only</span>').css({
            'background': '#f1f5f9',
            'color': '#475569',
            'border-color': '#cbd5e1'
        });
        $wrapper.find('#greasing-opening-balance, #greasing-top-up, #greasing-closing-balance, #greasing-csa, #greasing-vehicle-type, #greasing-num-vehicles').prop('disabled', true);
        $wrapper.find('#btn-add-greasing, #btn-save-greasing').prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
    } else {
        $wrapper.find('#greasing-status-badge').html('<span>● Active Service</span>').css({
            'background': '#ecfdf5',
            'color': '#065f46',
            'border-color': '#a7f3d0'
        });
        $wrapper.find('#greasing-opening-balance, #greasing-top-up, #greasing-closing-balance, #greasing-csa, #greasing-vehicle-type, #greasing-num-vehicles').prop('disabled', false);
        $wrapper.find('#btn-add-greasing, #btn-save-greasing').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
    }

    // Load Inventory Values
    let op_val = window.SHIFT_DOC.grease_opening_balance !== undefined ? window.SHIFT_DOC.grease_opening_balance : 0;
    let top_val = window.SHIFT_DOC.grease_top_up !== undefined ? window.SHIFT_DOC.grease_top_up : 0;
    let cl_val = window.SHIFT_DOC.grease_closing_balance !== undefined ? window.SHIFT_DOC.grease_closing_balance : 0;

    $wrapper.find('#greasing-opening-balance').val(op_val);
    $wrapper.find('#greasing-top-up').val(top_val);
    $wrapper.find('#greasing-closing-balance').val(cl_val);

    let calc_used = function() {
        let op = parseFloat($wrapper.find('#greasing-opening-balance').val()) || 0;
        let top = parseFloat($wrapper.find('#greasing-top-up').val()) || 0;
        let cl = parseFloat($wrapper.find('#greasing-closing-balance').val()) || 0;
        let used = Math.max(0, op + top - cl);
        $wrapper.find('#greasing-total-used').val(used.toFixed(2));
        $wrapper.find('#greasing-total-used-display').text(used.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
    };

    $wrapper.find('#greasing-opening-balance, #greasing-top-up, #greasing-closing-balance').off('input').on('input', calc_used);
    calc_used();

    // 1. Segmented Control Switch (History vs Active Entry)
    $wrapper.find('#tab-greasing .seg-btn').off('click').on('click', function() {
        let view = $(this).data('view');
        $wrapper.find('#tab-greasing .seg-btn').removeClass('active');
        $(this).addClass('active');
        $wrapper.find('#tab-greasing .view-pane').removeClass('active');
        $wrapper.find('#greasing-' + view + '-view').addClass('active');
        if (view === 'history') {
            fetch_greasing_history();
        }
    });

    // 2. Sub-tab Toggle (Detailed Services Log vs Shift Stock & Consumption Log)
    $wrapper.find('#tab-greasing .gh-subtab-btn').off('click').on('click', function() {
        let subtab = $(this).data('subtab');
        $wrapper.find('#tab-greasing .gh-subtab-btn').css({
            'background': '#f1f5f9',
            'color': '#475569',
            'border': '1px solid #cbd5e1',
            'font-weight': '600'
        }).removeClass('active');
        $(this).css({
            'background': '#1e3a8a',
            'color': '#ffffff',
            'border': 'none',
            'font-weight': '700'
        }).addClass('active');
        
        if (subtab === 'services') {
            $wrapper.find('#gh-subpane-services').show();
            $wrapper.find('#gh-subpane-shifts').hide();
        } else {
            $wrapper.find('#gh-subpane-services').hide();
            $wrapper.find('#gh-subpane-shifts').show();
        }
    });

    // 3. Populate CSA Dropdowns (Entry form + History filter)
    let csa_html = '<option value="">Select CSA in Charge...</option>';
    let filter_csa_html = '<option value="">All CSAs</option>';

    let allowed_csas = [];
    if (window.SHIFT_DOC && window.SHIFT_DOC.head_csa) {
        let head_emp = window.USERS_LIST ? window.USERS_LIST.find(u => u.user_id === window.SHIFT_DOC.head_csa || u.name === window.SHIFT_DOC.head_csa) : null;
        if (head_emp) allowed_csas.push(head_emp.name);
        else allowed_csas.push(window.SHIFT_DOC.head_csa);
    }
    if (window.SHIFT_DOC && window.SHIFT_DOC.assigned_csas) {
        window.SHIFT_DOC.assigned_csas.forEach(r => {
            if (r.csa) allowed_csas.push(r.csa);
        });
    }
    allowed_csas = [...new Set(allowed_csas)];

    let sorted_shift_csas = allowed_csas.map(csa => {
        let u = window.USERS_LIST ? window.USERS_LIST.find(user => user.name === csa || user.user_id === csa) : null;
        let name = u ? (u.employee_name || u.full_name || csa) : csa;
        return {csa, name};
    }).sort((a,b) => (a.name || "").localeCompare(b.name || ""));

    sorted_shift_csas.forEach(item => {
        csa_html += `<option value="${item.csa}">${item.name}</option>`;
    });
    $wrapper.find('#greasing-csa').html(csa_html);

    let all_filter_csas = (window.USERS_LIST || []).map(u => ({
        csa: u.name,
        name: u.employee_name || u.full_name || u.name
    })).sort((a,b) => (a.name || "").localeCompare(b.name || ""));

    if (all_filter_csas.length === 0) {
        all_filter_csas = sorted_shift_csas;
    }

    all_filter_csas.forEach(item => {
        filter_csa_html += `<option value="${item.csa}">${item.name}</option>`;
    });
    $wrapper.find('#greasing-filter-csa').html(filter_csa_html);

    // 4. Fetch and Populate Vehicle Types
    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Grease Vehicle Type',
            fields: ['name', 'vehicle_type', 'greasing_price'],
            limit_page_length: 500
        },
        callback: function(r) {
            let vt_html = '<option value="">Select Vehicle Type...</option>';
            let filter_vt_html = '<option value="">All Vehicle Categories</option>';
            if(r.message && r.message.length) {
                window.GREASE_VEHICLE_TYPES = {};
                window.GREASE_VEHICLE_NAMES = {};
                r.message.forEach(vt => {
                    window.GREASE_VEHICLE_TYPES[vt.name] = vt.greasing_price;
                    window.GREASE_VEHICLE_NAMES[vt.name] = vt.vehicle_type;
                    let price_str = frappe.format(vt.greasing_price, {fieldtype: 'Currency'});
                    vt_html += `<option value="${vt.name}">${vt.vehicle_type} — ${price_str}</option>`;
                    filter_vt_html += `<option value="${vt.name}">${vt.vehicle_type}</option>`;
                });
                $wrapper.find('#greasing-vehicle-type').html(vt_html);
                $wrapper.find('#greasing-filter-vehicle').html(filter_vt_html);
            }
        },
        error: function(err) {
            console.error("Error loading Grease Vehicle Types: ", err);
        }
    });

    // 5. Auto-calculate amounts in Entry Zone
    let calc_grease_amount = function() {
        let vt = $wrapper.find('#greasing-vehicle-type').val();
        let num = parseInt($wrapper.find('#greasing-num-vehicles').val()) || 0;
        if(vt && window.GREASE_VEHICLE_TYPES && window.GREASE_VEHICLE_TYPES[vt] !== undefined) {
            let price = parseFloat(window.GREASE_VEHICLE_TYPES[vt]) || 0;
            $wrapper.find('#greasing-amount-per').val(price.toFixed(2));
            let total = price * num;
            $wrapper.find('#greasing-total-calc').val(total.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
        } else {
            $wrapper.find('#greasing-amount-per').val('');
            $wrapper.find('#greasing-total-calc').val('0.00');
        }
    };

    $wrapper.find('#greasing-vehicle-type, #greasing-num-vehicles').off('change input').on('change input', calc_grease_amount);

    // 6. Active Shift Greasing Table Render
    let refresh_table = function() {
        let tbody = '';
        let total_sales = 0;
        let total_vehicles = 0;
        let count = (window.SHIFT_DOC.greasing_sales || []).length;

        (window.SHIFT_DOC.greasing_sales || []).forEach((row, idx) => {
            let csa_name = row.csa;
            if(window.USERS_LIST) {
                let u = window.USERS_LIST.find(user => user.name === row.csa || user.user_id === row.csa);
                if(u) csa_name = u.employee_name || u.full_name || row.csa;
            }

            let vt_display = row.vehicle_type;
            if(window.GREASE_VEHICLE_NAMES && window.GREASE_VEHICLE_NAMES[row.vehicle_type]) {
                vt_display = window.GREASE_VEHICLE_NAMES[row.vehicle_type];
            }

            let num_v = parseInt(row.number_of_vehicles) || 1;
            let rate = parseFloat(row.amount_per_vehicle) || 0;
            let row_total = parseFloat(row.total_amount) || (num_v * rate);

            total_vehicles += num_v;
            total_sales += row_total;

            let is_inv_sale = !!row.is_invoice_sale;
            let ref_inv = row.reference_invoice || '';

            let action_html = '';
            if (is_inv_sale) {
                action_html = `
                    <button type="button" class="btn btn-xs btn-default btn-jump-invoice" data-invoice="${frappe.utils.escape_html(ref_inv)}" style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 700; cursor: pointer; white-space: nowrap;" title="Auto-posted from Invoice #${frappe.utils.escape_html(ref_inv)}. Click to view & edit in Invoices tab.">
                        📄 Invoice ${ref_inv ? '#' + frappe.utils.escape_html(ref_inv) : 'Sale'}
                    </button>
                `;
            } else {
                action_html = `
                    <div style="display: flex; gap: 0.35rem; justify-content: center; align-items: center;">
                        <button type="button" class="btn btn-xs btn-primary btn-edit-grease-entry" data-idx="${idx}" data-name="${row.name || ''}" ${is_locked ? 'disabled' : ''} style="font-weight: 700; padding: 3px 8px; font-size: 0.76rem; border-radius: 4px; background: #2563eb; color: #fff; border: none; cursor: ${is_locked ? 'not-allowed' : 'pointer'};">Edit</button>
                        <button type="button" class="btn-delete-greasing" data-idx="${idx}" data-name="${row.name || ''}" ${is_locked ? 'disabled' : ''} style="background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; padding: 3px 7px; border-radius: 4px; font-size: 0.76rem; font-weight: 700; cursor: ${is_locked ? 'not-allowed' : 'pointer'}; transition: all 0.2s;" title="Delete entry">✕</button>
                    </div>
                `;
            }

            tbody += `
                <tr data-idx="${idx}" class="hover:bg-slate-50 transition-colors ${is_inv_sale ? 'bg-blue-50/20' : ''}">
                    <td style="padding: 0.75rem 1rem; font-weight: 600; color: #1e293b;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <span style="width: 24px; height: 24px; border-radius: 50%; background: #e0e7ff; color: #4338ca; display: inline-flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 800;">
                                ${(csa_name || "C").charAt(0).toUpperCase()}
                            </span>
                            <span>${csa_name}</span>
                        </div>
                    </td>
                    <td style="padding: 0.75rem 1rem; color: #334155; font-weight: 600;">
                        <span style="background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.85rem; border: 1px solid #e2e8f0;">
                            🚗 ${vt_display}
                        </span>
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: center;">
                        <span class="badge" style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; font-weight: 800; padding: 0.25rem 0.6rem; border-radius: 6px; font-family: monospace;">
                            ${num_v}
                        </span>
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: right; color: #64748b; font-weight: 600; font-family: monospace;">
                        ${frappe.format(rate, {fieldtype: 'Currency'})}
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 800; color: #047857; font-family: monospace; font-size: 0.95rem;">
                        ${frappe.format(row_total, {fieldtype: 'Currency'})}
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: center;">
                        ${action_html}
                    </td>
                </tr>
            `;
        });
        
        if(!tbody) {
            tbody = `
                <tr>
                    <td colspan="6" style="text-align: center; color: #94a3b8; padding: 2.5rem 1rem;">
                        <div style="font-size: 2rem; margin-bottom: 0.5rem;">🚗</div>
                        <div style="font-weight: 700; color: #64748b; font-size: 0.95rem;">No greasing services recorded yet</div>
                        <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 0.25rem;">Select a vehicle type and CSA above to add greasing services.</div>
                    </td>
                </tr>
            `;
        }

        $wrapper.find('#list-greasing-sales').html(tbody);
        $wrapper.find('#greasing-total-vehicles').text(total_vehicles);
        $wrapper.find('#greasing-total-sales-amount').html(frappe.format(total_sales, {fieldtype: 'Currency'}));
        $wrapper.find('#greasing-service-count-badge').text(`${count} service${count === 1 ? '' : 's'} recorded`);

        // Edit Handler in Active Entry view
        $wrapper.find('.btn-edit-grease-entry').off('click').on('click', function() {
            if(is_locked) return;
            let idx = $(this).data('idx');
            let row_name = $(this).attr('data-name');
            let active_sales = window.SHIFT_DOC.greasing_sales || [];
            if (idx >= 0 && idx < active_sales.length) {
                let row = active_sales[idx];
                if (row_name && window.ACTIVE_SHIFT) {
                    frappe.confirm('This will load the greasing service into the entry form and remove it from the shift log. Continue?', () => {
                        frappe.call({
                            method: "fuel_management.fuel_management.api.delete_greasing_sale",
                            args: {
                                shift_name: window.ACTIVE_SHIFT.name,
                                row_name: row_name
                            },
                            freeze: true,
                            freeze_message: "Loading greasing service for edit...",
                            callback: function(r) {
                                if (r.message && r.message.status === "success") {
                                    if (r.message.doc) window.SHIFT_DOC = r.message.doc;
                                    $wrapper.find('#greasing-csa').val(row.csa);
                                    $wrapper.find('#greasing-vehicle-type').val(row.vehicle_type);
                                    $wrapper.find('#greasing-num-vehicles').val(row.number_of_vehicles || 1);
                                    $wrapper.find('#greasing-amount-per').val(parseFloat(row.amount_per_vehicle || 0).toFixed(2));
                                    $wrapper.find('#greasing-total-calc').val(parseFloat(row.total_amount || 0).toFixed(2));
                                    refresh_table();
                                    fetch_greasing_history();
                                    frappe.show_alert({message: "Service loaded into form for editing. Click '+ Add Service' and save when done.", indicator: "orange"});
                                }
                            }
                        });
                    });
                } else {
                    active_sales.splice(idx, 1);
                    $wrapper.find('#greasing-csa').val(row.csa);
                    $wrapper.find('#greasing-vehicle-type').val(row.vehicle_type);
                    $wrapper.find('#greasing-num-vehicles').val(row.number_of_vehicles || 1);
                    $wrapper.find('#greasing-amount-per').val(parseFloat(row.amount_per_vehicle || 0).toFixed(2));
                    $wrapper.find('#greasing-total-calc').val(parseFloat(row.total_amount || 0).toFixed(2));
                    refresh_table();
                    frappe.show_alert({message: "Service loaded into form for editing. Click '+ Add Service' and save when done.", indicator: "orange"});
                }
            }
        });

        // Delete Handler
        $wrapper.find('.btn-delete-greasing').off('click').on('click', function() {
            if(is_locked) return;
            let idx = $(this).data('idx');
            let row_name = $(this).attr('data-name');
            if (row_name && window.ACTIVE_SHIFT) {
                frappe.confirm('Are you sure you want to delete this greasing service from the active shift?', () => {
                    frappe.call({
                        method: "fuel_management.fuel_management.api.delete_greasing_sale",
                        args: {
                            shift_name: window.ACTIVE_SHIFT.name,
                            row_name: row_name
                        },
                        freeze: true,
                        freeze_message: "Deleting greasing service...",
                        callback: function(r) {
                            if (r.message && r.message.status === "success") {
                                if (r.message.doc) window.SHIFT_DOC = r.message.doc;
                                frappe.show_alert({message: "Greasing service deleted successfully", indicator: "green"});
                                fetch_greasing_history();
                                refresh_table();
                            }
                        }
                    });
                });
            } else {
                window.SHIFT_DOC.greasing_sales.splice(idx, 1);
                refresh_table();
            }
        });
    };

    refresh_table();

    // 7. Add Greasing Sale (Active Shift)
    $wrapper.find('#btn-add-greasing').off('click').on('click', function() {
        if(is_locked) return;
        let csa = $wrapper.find('#greasing-csa').val();
        let vt = $wrapper.find('#greasing-vehicle-type').val();
        let num = parseInt($wrapper.find('#greasing-num-vehicles').val()) || 0;
        let amount = parseFloat($wrapper.find('#greasing-amount-per').val()) || 0;

        if(!csa) {
            frappe.show_alert({message: "Please select a CSA in charge.", indicator: "orange"});
            $wrapper.find('#greasing-csa').focus();
            return;
        }
        if(!vt) {
            frappe.show_alert({message: "Please select a Vehicle Type.", indicator: "orange"});
            $wrapper.find('#greasing-vehicle-type').focus();
            return;
        }
        if(num < 1) {
            frappe.show_alert({message: "Number of vehicles must be at least 1.", indicator: "orange"});
            $wrapper.find('#greasing-num-vehicles').focus();
            return;
        }
        if(amount <= 0) {
            frappe.show_alert({message: "Price per vehicle is missing or 0.", indicator: "red"});
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
        $wrapper.find('#greasing-total-calc').val('0.00');

        frappe.show_alert({message: `Added ${num} greasing service(s)`, indicator: "green"});
    });

    // 8. Save Greasing Data & Physical Inventory
    $wrapper.find('#btn-save-greasing').off('click').on('click', function() {
        if(is_locked) return;
        let $btn = $(this);
        let orig = $btn.html();
        
        let op = parseFloat($wrapper.find('#greasing-opening-balance').val()) || 0;
        let top = parseFloat($wrapper.find('#greasing-top-up').val()) || 0;
        let cl = parseFloat($wrapper.find('#greasing-closing-balance').val()) || 0;
        let used = Math.max(0, op + top - cl);

        let total_sales = 0;
        (window.SHIFT_DOC.greasing_sales || []).forEach(row => {
            total_sales += (parseFloat(row.total_amount) || 0);
        });
        
        $btn.html('<span class="spinner inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></span> Saving Greasing Data...').prop('disabled', true);

        let doc = window.SHIFT_DOC;
        doc.grease_opening_balance = op;
        doc.grease_top_up = top;
        doc.grease_closing_balance = cl;
        doc.grease_used = used;
        doc.total_greasing_sales = total_sales;
        
        frappe.call({
            method: "frappe.client.save",
            args: {
                doc: doc
            },
            callback: function(r) {
                if(!r.exc) {
                    frappe.show_alert({message: "Greasing Data & Inventory Saved Successfully!", indicator: "green"});
                    load_shift_data($wrapper);
                }
            },
            always: function() {
                $btn.html(orig).prop('disabled', false);
            }
        });
    });

    // =========================================================
    // 9. HISTORICAL VIEW LOGIC & API INTEGRATION
    // =========================================================
    let current_historical_services = [];
    let current_historical_shifts = [];

    let fetch_greasing_history = function() {
        let from_date = $wrapper.find('#greasing-filter-from').val() || null;
        let to_date = $wrapper.find('#greasing-filter-to').val() || null;
        let csa = $wrapper.find('#greasing-filter-csa').val() || null;
        let vehicle_type = $wrapper.find('#greasing-filter-vehicle').val() || null;
        let station = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) || (window.SHIFT_DOC && window.SHIFT_DOC.station) || null;

        $wrapper.find('#list-greasing-history-services').html(`
            <tr><td colspan="7" style="text-align: center; color: #64748b; padding: 2rem;">
                <span class="spinner inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2"></span> Loading historical services...
            </td></tr>
        `);
        $wrapper.find('#list-greasing-history-shifts').html(`
            <tr><td colspan="7" style="text-align: center; color: #64748b; padding: 2rem;">
                <span class="spinner inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2"></span> Loading historical shift stock...
            </td></tr>
        `);

        frappe.call({
            method: "fuel_management.fuel_management.api.get_historical_greasing_sales",
            args: {
                from_date: from_date,
                to_date: to_date,
                csa: csa,
                vehicle_type: vehicle_type,
                station: station
            },
            callback: function(r) {
                if(r.message) {
                    let data = r.message;
                    current_historical_services = data.services || [];
                    current_historical_shifts = data.shift_summaries || [];

                    render_history_tables();
                }
            },
            error: function(err) {
                console.error("Error fetching greasing history: ", err);
                $wrapper.find('#list-greasing-history-services').html(`
                    <tr><td colspan="7" style="text-align: center; color: #ef4444; padding: 2rem;">Failed to load historical greasing sales.</td></tr>
                `);
                $wrapper.find('#list-greasing-history-shifts').html(`
                    <tr><td colspan="7" style="text-align: center; color: #ef4444; padding: 2rem;">Failed to load shift stock logs.</td></tr>
                `);
            }
        });
    };

    let render_history_tables = function() {
        let search_term = ($wrapper.find('#greasing-filter-search').val() || '').toLowerCase().trim();

        // 1. Filter and render Detailed Services Log
        let filtered_services = current_historical_services.filter(row => {
            if (!search_term) return true;
            let csa_name = row.csa || '';
            if (window.USERS_LIST) {
                let u = window.USERS_LIST.find(user => user.name === row.csa || user.user_id === row.csa);
                if (u) csa_name = u.employee_name || u.full_name || row.csa;
            }
            let vt_display = (window.GREASE_VEHICLE_NAMES && window.GREASE_VEHICLE_NAMES[row.vehicle_type]) || row.vehicle_type || '';
            let shift_name = row.shift_name_display || row.shift || '';
            let date_str = row.shift_date ? frappe.datetime.str_to_user(row.shift_date) : '';

            return csa_name.toLowerCase().includes(search_term) ||
                   vt_display.toLowerCase().includes(search_term) ||
                   shift_name.toLowerCase().includes(search_term) ||
                   date_str.toLowerCase().includes(search_term);
        });

        let s_tbody = '';
        let total_services_count = 0;
        let total_services_amount = 0;

        filtered_services.forEach(row => {
            let csa_name = row.csa || '--';
            if (window.USERS_LIST) {
                let u = window.USERS_LIST.find(user => user.name === row.csa || user.user_id === row.csa);
                if (u) csa_name = u.employee_name || u.full_name || row.csa;
            }

            let vt_display = (window.GREASE_VEHICLE_NAMES && window.GREASE_VEHICLE_NAMES[row.vehicle_type]) || row.vehicle_type;
            let num_v = parseInt(row.number_of_vehicles) || 1;
            let rate = parseFloat(row.amount_per_vehicle) || 0;
            let row_total = parseFloat(row.total_amount) || (num_v * rate);
            let date_str = row.shift_date ? frappe.datetime.str_to_user(row.shift_date) : '--';
            let shift_display = row.shift_name_display || row.shift;

            total_services_count += num_v;
            total_services_amount += row_total;

            let is_active_shift = (window.ACTIVE_SHIFT && (row.shift === window.ACTIVE_SHIFT.name || row.parent === window.ACTIVE_SHIFT.name));
            let is_locked = window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.status !== "Open" && !(frappe.user.has_role("System Manager") || frappe.user.has_role("Fuel Station Owner"));
            let is_inv_sale = !!row.is_invoice_sale;
            let ref_inv = row.reference_invoice || '';

            let action_btn = '';
            if (is_active_shift) {
                if (is_inv_sale) {
                    action_btn = `
                        <button type="button" class="btn btn-xs btn-default btn-jump-invoice" data-invoice="${frappe.utils.escape_html(ref_inv)}" style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 700; cursor: pointer; white-space: nowrap;" title="Auto-posted from Invoice #${frappe.utils.escape_html(ref_inv)}. Click to view & edit in Invoices tab.">
                            📄 Invoice ${ref_inv ? '#' + frappe.utils.escape_html(ref_inv) : 'Sale'}
                        </button>
                    `;
                } else if (!is_locked) {
                    action_btn = `
                        <div style="display: flex; gap: 0.35rem; justify-content: center; align-items: center;">
                            <button type="button" class="btn btn-xs btn-primary btn-edit-grease-history" data-name="${row.name}" data-csa="${frappe.utils.escape_html(row.csa || '')}" data-vt="${frappe.utils.escape_html(row.vehicle_type || '')}" data-num="${num_v}" data-rate="${rate}" style="font-weight: 700; padding: 3px 8px; font-size: 0.76rem; border-radius: 4px; background: #2563eb; color: #fff; border: none; cursor: pointer;">Edit</button>
                            <button type="button" class="btn btn-xs btn-danger btn-delete-grease-history" data-name="${row.name}" style="font-weight: 700; padding: 3px 7px; font-size: 0.76rem; border-radius: 4px; background: #ef4444; color: #fff; border: none; cursor: pointer;" title="Delete this service from active shift">✕</button>
                        </div>
                    `;
                } else {
                    action_btn = `<span style="color: #94a3b8; font-size: 0.75rem;">Locked</span>`;
                }
            } else {
                if (is_inv_sale) {
                    action_btn = `<span class="badge" style="background: #f1f5f9; color: #64748b; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px;">Invoice Sale</span>`;
                } else {
                    action_btn = `<span style="color: #94a3b8; font-size: 0.75rem;">Closed</span>`;
                }
            }

            s_tbody += `
                <tr class="hover:bg-slate-50 transition-colors ${is_active_shift ? 'bg-emerald-50/40' : ''}">
                    <td style="padding: 0.75rem 1rem; color: #475569; font-weight: 600; font-size: 0.85rem;">
                        ${date_str}
                    </td>
                    <td style="padding: 0.75rem 1rem; font-weight: 700; color: #1e293b; font-size: 0.85rem;">
                        <a href="/app/shift/${row.shift}" target="_blank" style="color: #2563eb; text-decoration: none;">
                            ${shift_display} ${is_active_shift ? '⚡' : ''}
                        </a>
                    </td>
                    <td style="padding: 0.75rem 1rem; font-weight: 600; color: #1e293b;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <span style="width: 24px; height: 24px; border-radius: 50%; background: #e0e7ff; color: #4338ca; display: inline-flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 800;">
                                ${(csa_name || "C").charAt(0).toUpperCase()}
                            </span>
                            <span>${csa_name}</span>
                        </div>
                    </td>
                    <td style="padding: 0.75rem 1rem; color: #334155; font-weight: 600;">
                        <span style="background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.85rem; border: 1px solid #e2e8f0;">
                            🚗 ${vt_display}
                        </span>
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: center;">
                        <span class="badge" style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; font-weight: 800; padding: 0.25rem 0.6rem; border-radius: 6px; font-family: monospace;">
                            ${num_v}
                        </span>
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: right; color: #64748b; font-weight: 600; font-family: monospace;">
                        ${frappe.format(rate, {fieldtype: 'Currency'})}
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 800; color: #047857; font-family: monospace; font-size: 0.95rem;">
                        ${frappe.format(row_total, {fieldtype: 'Currency'})}
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: center;">
                        ${action_btn}
                    </td>
                </tr>
            `;
        });

        if (!s_tbody) {
            s_tbody = `
                <tr>
                    <td colspan="8" style="text-align: center; color: #94a3b8; padding: 3rem 1rem;">
                        <div style="font-size: 2rem; margin-bottom: 0.5rem;">🚗</div>
                        <div style="font-weight: 700; color: #64748b; font-size: 0.95rem;">No historical greasing services match your criteria</div>
                        <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 0.25rem;">Try adjusting the date range, CSA, or vehicle filter.</div>
                    </td>
                </tr>
            `;
        }

        $wrapper.find('#list-greasing-history-services').html(s_tbody);
        $wrapper.find('#gh-services-total-count').text(total_services_count);
        $wrapper.find('#gh-services-total-amount').html(frappe.format(total_services_amount, {fieldtype: 'Currency'}));

        // Bind Action buttons in Detailed Services Log
        $wrapper.find('.btn-jump-invoice').off('click').on('click', function(e) {
            e.preventDefault();
            let inv_ref = $(this).attr('data-invoice') || '';
            $wrapper.find('[data-target="tab-invoices"]').click();
            if (inv_ref) {
                setTimeout(() => {
                    $wrapper.find('#invoice-filter-search').val(inv_ref).trigger('input');
                }, 100);
                frappe.show_alert({message: `Navigated to Invoices tab for Invoice #${inv_ref}. Edit or delete that invoice here to update greasing automatically.`, indicator: "blue"});
            }
        });

        $wrapper.find('.btn-edit-grease-history').off('click').on('click', function() {
            if(is_locked) return;
            let row_name = $(this).attr('data-name');
            let row_csa = $(this).attr('data-csa');
            let row_vt = $(this).attr('data-vt');
            let row_num = parseInt($(this).attr('data-num')) || 1;
            let row_rate = parseFloat($(this).attr('data-rate')) || 0;
            
            frappe.confirm('This will load the greasing service into the entry form and remove it from the shift log. Continue?', () => {
                frappe.call({
                    method: "fuel_management.fuel_management.api.delete_greasing_sale",
                    args: {
                        shift_name: window.ACTIVE_SHIFT.name,
                        row_name: row_name
                    },
                    freeze: true,
                    freeze_message: "Loading greasing service for edit...",
                    callback: function(r) {
                        if (r.message && r.message.status === "success") {
                            if (r.message.doc) window.SHIFT_DOC = r.message.doc;
                            
                            // Switch to entry view
                            $wrapper.find('#tab-greasing .seg-btn[data-view="entry"]').click();
                            
                            // Populate form
                            $wrapper.find('#greasing-csa').val(row_csa);
                            $wrapper.find('#greasing-vehicle-type').val(row_vt);
                            $wrapper.find('#greasing-num-vehicles').val(row_num);
                            $wrapper.find('#greasing-amount-per').val(parseFloat(row_rate).toFixed(2));
                            $wrapper.find('#greasing-total-calc').val(parseFloat(row_num * row_rate).toFixed(2));
                            
                            refresh_table();
                            fetch_greasing_history();
                            frappe.show_alert({message: "Greasing service loaded into form for editing. Click '+ Add Service' and save when done.", indicator: "green"});
                        }
                    }
                });
            });
        });

        $wrapper.find('.btn-delete-grease-history').off('click').on('click', function() {
            if(is_locked) return;
            let row_name = $(this).attr('data-name');
            frappe.confirm('Are you sure you want to delete this greasing service from the active shift?', () => {
                frappe.call({
                    method: "fuel_management.fuel_management.api.delete_greasing_sale",
                    args: {
                        shift_name: window.ACTIVE_SHIFT.name,
                        row_name: row_name
                    },
                    freeze: true,
                    freeze_message: "Deleting greasing service...",
                    callback: function(r) {
                        if (r.message && r.message.status === "success") {
                            if (r.message.doc) window.SHIFT_DOC = r.message.doc;
                            frappe.show_alert({message: "Greasing service deleted successfully", indicator: "green"});
                            fetch_greasing_history();
                            refresh_table();
                        }
                    }
                });
            });
        });

        // 2. Filter and render Shift Stock & Consumption Log
        let filtered_shifts = current_historical_shifts.filter(row => {
            if (!search_term) return true;
            let shift_name = row.shift_name_display || row.shift || '';
            let date_str = row.shift_date ? frappe.datetime.str_to_user(row.shift_date) : '';
            return shift_name.toLowerCase().includes(search_term) || date_str.toLowerCase().includes(search_term);
        });

        let sh_tbody = '';
        let total_shifts_used_kg = 0;
        let total_shifts_sales_amount = 0;

        filtered_shifts.forEach(row => {
            let date_str = row.shift_date ? frappe.datetime.str_to_user(row.shift_date) : '--';
            let shift_display = row.shift_name_display || row.shift;
            let op = parseFloat(row.grease_opening_balance) || 0;
            let top = parseFloat(row.grease_top_up) || 0;
            let cl = parseFloat(row.grease_closing_balance) || 0;
            let used = parseFloat(row.grease_used) || Math.max(0, op + top - cl);
            let sales = parseFloat(row.total_greasing_sales) || 0;

            total_shifts_used_kg += used;
            total_shifts_sales_amount += sales;

            sh_tbody += `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td style="padding: 0.75rem 1rem; color: #475569; font-weight: 600; font-size: 0.85rem;">
                        ${date_str}
                    </td>
                    <td style="padding: 0.75rem 1rem; font-weight: 700; color: #1e293b; font-size: 0.85rem;">
                        <a href="/app/shift/${row.shift}" target="_blank" style="color: #2563eb; text-decoration: none;">
                            ${shift_display}
                        </a>
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: right; color: #475569; font-weight: 600; font-family: monospace;">
                        ${op.toFixed(2)} KG
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: right; color: #1e40af; font-weight: 600; font-family: monospace;">
                        +${top.toFixed(2)} KG
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: right; color: #475569; font-weight: 600; font-family: monospace;">
                        ${cl.toFixed(2)} KG
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 800; color: #b45309; font-family: monospace; font-size: 0.95rem;">
                        ${used.toFixed(2)} KG
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 800; color: #047857; font-family: monospace; font-size: 0.95rem;">
                        ${frappe.format(sales, {fieldtype: 'Currency'})}
                    </td>
                </tr>
            `;
        });

        if (!sh_tbody) {
            sh_tbody = `
                <tr>
                    <td colspan="7" style="text-align: center; color: #94a3b8; padding: 3rem 1rem;">
                        <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚖️</div>
                        <div style="font-weight: 700; color: #64748b; font-size: 0.95rem;">No historical shift grease stock logs recorded</div>
                    </td>
                </tr>
            `;
        }

        $wrapper.find('#list-greasing-history-shifts').html(sh_tbody);
        $wrapper.find('#gh-shifts-total-kg').text(`${total_shifts_used_kg.toFixed(2)} KG`);
        $wrapper.find('#gh-shifts-total-amount').html(frappe.format(total_shifts_sales_amount, {fieldtype: 'Currency'}));

        // 3. Update Summary KPI Cards
        let kpi_vehicles = total_services_count;
        let kpi_revenue = total_services_amount > 0 ? total_services_amount : total_shifts_sales_amount;
        let kpi_used_kg = total_shifts_used_kg;
        let kpi_avg_rate = kpi_vehicles > 0 ? (kpi_revenue / kpi_vehicles) : 0;

        $wrapper.find('#gh-kpi-vehicles').text(kpi_vehicles);
        $wrapper.find('#gh-kpi-revenue').html(frappe.format(kpi_revenue, {fieldtype: 'Currency'}));
        $wrapper.find('#gh-kpi-grease-kg').text(`${kpi_used_kg.toFixed(2)} KG`);
        $wrapper.find('#gh-kpi-avg-rate').html(frappe.format(kpi_avg_rate, {fieldtype: 'Currency'}));
    };

    // Event Listeners for Filters
    $wrapper.find('#btn-refresh-greasing-history').off('click').on('click', fetch_greasing_history);
    $wrapper.find('#greasing-filter-from, #greasing-filter-to, #greasing-filter-csa, #greasing-filter-vehicle').off('change').on('change', fetch_greasing_history);
    $wrapper.find('#greasing-filter-search').off('input').on('input', render_history_tables);

    // Print Greasing Report
    $wrapper.find('#btn-print-greasing-report').off('click').on('click', function() {
        let station_name = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) || (window.SHIFT_DOC && window.SHIFT_DOC.station) || "All Stations";
        let from_date = $wrapper.find('#greasing-filter-from').val() || "All Time";
        let to_date = $wrapper.find('#greasing-filter-to').val() || "Present";
        let csa_name = $wrapper.find('#greasing-filter-csa option:selected').text() || "All CSAs";
        let veh_name = $wrapper.find('#greasing-filter-vehicle option:selected').text() || "All Vehicles";

        let kpi_v = $wrapper.find('#gh-kpi-vehicles').text();
        let kpi_r = $wrapper.find('#gh-kpi-revenue').text();
        let kpi_kg = $wrapper.find('#gh-kpi-grease-kg').text();
        let kpi_avg = $wrapper.find('#gh-kpi-avg-rate').text();

        let services_html = $wrapper.find('#list-greasing-history-services').html();
        let shifts_html = $wrapper.find('#list-greasing-history-shifts').html();
        let services_tot_cnt = $wrapper.find('#gh-services-total-count').text();
        let services_tot_amt = $wrapper.find('#gh-services-total-amount').text();
        let shifts_tot_kg = $wrapper.find('#gh-shifts-total-kg').text();
        let shifts_tot_amt = $wrapper.find('#gh-shifts-total-amount').text();

        let print_w = window.open('', '_blank');
        print_w.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Greasing Sales & Consumption Report</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; padding: 25px; margin: 0; }
                    h1, h2, h3 { margin: 0 0 5px 0; color: #0f172a; }
                    .report-header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px; }
                    .meta-grid { display: flex; justify-content: space-between; font-size: 12px; color: #475569; margin-bottom: 15px; }
                    .kpi-grid { display: flex; gap: 12px; margin-bottom: 20px; }
                    .kpi-card { flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 14px; background: #f8fafc; }
                    .kpi-card .label { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; }
                    .kpi-card .val { font-size: 18px; font-weight: 800; color: #0f172a; font-family: monospace; margin-top: 2px; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 12px; }
                    th { background: #f1f5f9; color: #334155; font-weight: 700; text-align: left; padding: 8px 10px; border-bottom: 2px solid #cbd5e1; }
                    td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
                    tfoot td { font-weight: 800; background: #ecfdf5; border-top: 2px solid #86efac; color: #065f46; }
                    .section-title { font-size: 14px; font-weight: 800; margin: 15px 0 8px 0; color: #1e3a8a; }
                    @media print {
                        button { display: none; }
                        body { padding: 0; }
                    }
                </style>
            </head>
            <body>
                <div class="report-header">
                    <h2>🛢️ Greasing Sales & Stock Report</h2>
                    <div style="font-size: 13px; color: #475569;">Station: <strong>${station_name}</strong> | Period: <strong>${from_date}</strong> to <strong>${to_date}</strong></div>
                </div>
                <div class="meta-grid">
                    <div>Filter CSA: <strong>${csa_name}</strong> | Category: <strong>${veh_name}</strong></div>
                    <div>Generated: <strong>${new Date().toLocaleString()}</strong></div>
                </div>
                <div class="kpi-grid">
                    <div class="kpi-card"><div class="label">Vehicles Serviced</div><div class="val">${kpi_v}</div></div>
                    <div class="kpi-card"><div class="label">Total Revenue</div><div class="val">${kpi_r}</div></div>
                    <div class="kpi-card"><div class="label">Total Grease Used</div><div class="val">${kpi_kg}</div></div>
                    <div class="kpi-card"><div class="label">Avg Rate / Vehicle</div><div class="val">${kpi_avg}</div></div>
                </div>
                <div class="section-title">Detailed Vehicle Services Log</div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 80px;">Date</th>
                            <th>Shift</th>
                            <th>CSA Responsible</th>
                            <th>Vehicle Category</th>
                            <th style="text-align: center;">Vehicles</th>
                            <th style="text-align: right;">Rate</th>
                            <th style="text-align: right;">Total Amount</th>
                        </tr>
                    </thead>
                    <tbody>${services_html}</tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4">TOTAL SERVICES:</td>
                            <td style="text-align: center;">${services_tot_cnt}</td>
                            <td></td>
                            <td style="text-align: right;">${services_tot_amt}</td>
                        </tr>
                    </tfoot>
                </table>
                <div class="section-title">Shift Stock & Consumption Log</div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 80px;">Date</th>
                            <th>Shift</th>
                            <th style="text-align: right;">Opening</th>
                            <th style="text-align: right;">Top-Up</th>
                            <th style="text-align: right;">Closing</th>
                            <th style="text-align: right;">Grease Used</th>
                            <th style="text-align: right;">Greasing Sales</th>
                        </tr>
                    </thead>
                    <tbody>${shifts_html}</tbody>
                    <tfoot>
                        <tr>
                            <td colspan="5">TOTAL SHIFT USAGE & SALES:</td>
                            <td style="text-align: right;">${shifts_tot_kg}</td>
                            <td style="text-align: right;">${shifts_tot_amt}</td>
                        </tr>
                    </tfoot>
                </table>
                <script>
                    window.onload = function() { window.print(); };
                <\/script>
            </body>
            </html>
        `);
        print_w.document.close();
    });

    // Initial load for historical view if active
    if ($wrapper.find('#greasing-history-view').hasClass('active')) {
        fetch_greasing_history();
    }
}

  // ==========================================
  // BREAKDOWN MODAL LOGIC
  // ==========================================
  function show_breakdown_modal(title, data, columns) {
      const $modal = $('#breakdown-modal');
      $('#breakdown-modal-title').html(`
          <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #eff6ff; color: #2563eb; border-radius: 6px; font-size: 0.9rem;">📊</span>
              <span>${title}</span>
          </div>
      `);
      
      let sorted_data = (data || []).slice();
      if (columns && columns.length > 0) {
          let firstKey = columns[0].key;
          sorted_data.sort((a, b) => {
              let valA = String(a[firstKey] || '').trim();
              let valB = String(b[firstKey] || '').trim();
              if (firstKey === 'customer' || firstKey === 'customer_name') {
                  let cA = (window.CUSTOMERS_LIST || []).find(c => c.name === valA || c.customer_name === valA);
                  let cB = (window.CUSTOMERS_LIST || []).find(c => c.name === valB || c.customer_name === valB);
                  valA = cA ? (cA.customer_name || cA.name) : valA;
                  valB = cB ? (cB.customer_name || cB.name) : valB;
              }
              return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
          });
      }
      
      // Calculate totals for currency and number columns
      let totals = {};
      let hasTotals = false;
      columns.forEach(col => {
          if (col.format === 'currency' || col.format === 'number') {
              let sum = 0;
              let count = 0;
              sorted_data.forEach(row => {
                  let val = parseFloat(row[col.key]);
                  if (!isNaN(val)) {
                      sum += val;
                      count++;
                  }
              });
              if (count > 0) {
                  totals[col.key] = sum;
                  hasTotals = true;
              }
          }
      });

      let html = `<div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; margin-top: 5px;">
          <table class="dash-table" style="width:100%; border-collapse:collapse; margin: 0;">
          <thead style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
              <tr>`;
      columns.forEach(col => {
          let align = (col.format === 'currency' || col.format === 'number') ? 'right' : 'left';
          html += `<th style="padding: 10px 14px; text-align: ${align}; color:#475569; font-weight:700; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em;">${col.label}</th>`;
      });
      html += `</tr></thead><tbody>`;
      
      if(!sorted_data || sorted_data.length === 0) {
          html += `<tr><td colspan="${columns.length}" style="text-align:center; padding: 2.5rem 1rem; color:#94a3b8; font-size: 0.9rem;">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 0.5rem auto; color: #cbd5e1; display: block;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              No records found for this category
          </td></tr>`;
      } else {
          sorted_data.forEach((row, idx) => {
              let bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
              html += `<tr style="border-bottom:1px solid #f1f5f9; background: ${bg};">`;
              columns.forEach(col => {
                  let val = row[col.key] !== null && row[col.key] !== undefined ? row[col.key] : '';
                  let align = (col.format === 'currency' || col.format === 'number') ? 'right' : 'left';
                  let style = `padding: 10px 14px; text-align: ${align}; color:#1e293b; font-size: 0.9rem;`;
                  
                  if (col.format === 'currency') {
                      val = `<span style="font-family: monospace; font-weight: 700; color: #0f172a;">${format_currency(val)}</span>`;
                  } else if (col.format === 'number') {
                      let num = parseFloat(val);
                      val = `<span style="font-family: monospace; font-weight: 600;">${!isNaN(num) ? num.toLocaleString('en-US', {maximumFractionDigits: 2}) : val}</span>`;
                  } else if (col.key === 'entry_number' || col.key === 'name' || col.key === 'receipt_no') {
                      val = `<span class="badge" style="background:#f1f5f9; color:#475569; font-weight: 600; font-family: monospace; font-size: 0.78rem;">${frappe.utils.escape_html(String(val))}</span>`;
                  } else if (col.key === 'customer' || col.key === 'customer_name' || (col.label && col.label.toLowerCase().includes('customer'))) {
                      let cust = (window.CUSTOMERS_LIST || []).find(c => c.name === val || c.customer_name === val);
                      let displayName = cust ? (cust.customer_name || cust.name) : val;
                      val = `<strong style="color:#0f172a;">${frappe.utils.escape_html(String(displayName || ''))}</strong>`;
                  } else if (col.key === 'item' || col.key === 'item_name' || (col.label && (col.label.toLowerCase().includes('item') || col.label.toLowerCase().includes('product')))) {
                      let allItems = (window.INVENTORY_ITEMS || []).concat(window.INVOICE_ITEMS || []);
                      let found = allItems.find(it => it.item_code === val || it.name === val || it.item_name === val);
                      let displayName = found ? (found.item_name || found.name) : val;
                      val = `<span style="font-weight:600; color:#334155;">${frappe.utils.escape_html(String(displayName || ''))}</span>`;
                  }
                  html += `<td style="${style}">${val}</td>`;
              });
              html += `</tr>`;
          });
      }
      
      html += `</tbody>`;

      if (sorted_data && sorted_data.length > 0 && hasTotals) {
          html += `<tfoot style="background: #f1f5f9; border-top: 2px solid #cbd5e1; font-weight: 700;"><tr>`;
          columns.forEach((col, idx) => {
              let align = (col.format === 'currency' || col.format === 'number') ? 'right' : 'left';
              if (idx === 0) {
                  html += `<td style="padding: 12px 14px; text-align: left; color: #0f172a; font-weight: 800; font-size: 0.9rem;">TOTAL (${sorted_data.length} records)</td>`;
              } else if (totals[col.key] !== undefined) {
                  let totalVal = totals[col.key];
                  if (col.format === 'currency') {
                      html += `<td style="padding: 12px 14px; text-align: right; color: #0f172a; font-family: monospace; font-size: 1rem; font-weight: 800;">${format_currency(totalVal)}</td>`;
                  } else {
                      html += `<td style="padding: 12px 14px; text-align: right; color: #0f172a; font-family: monospace; font-size: 0.95rem; font-weight: 700;">${totalVal.toLocaleString('en-US', {maximumFractionDigits: 2})}</td>`;
                  }
              } else {
                  html += `<td></td>`;
              }
          });
          html += `</tr></tfoot>`;
      }

      html += `</table></div>`;
      $('#breakdown-modal-body').html(html);
      $modal.css('display', 'flex');
      
      $('#breakdown-modal-close').off('click').on('click', function() {
          $modal.hide();
      });
  }

  // Bind clicks
  $(document).on('click', '.recon-link', function() {
      if(!window.CURRENT_RECON) return;
      let type = $(this).attr('data-type');
      let data = [];
      let columns = [];
      let title = "";
      
      if(type === 'meter_sales') {
          title = "Meter Sales Breakdown";
          data = window.CURRENT_RECON.meter_sales_breakdown || [];
          columns = [
              {label: 'Pump Group', key: 'pump_group'},
              {label: 'Petrol (L)', key: 'petrol_liters', format: 'number'},
              {label: 'Diesel (L)', key: 'diesel_liters', format: 'number'},
              {label: 'Amount (KES)', key: 'amount', format: 'currency'}
          ];
      } else if(type === 'inventory_sales') {
          title = "Inventory Sales Breakdown";
          data = window.CURRENT_RECON.inventory_breakdown || [];
          columns = [
              {label: 'Item Name', key: 'item'},
              {label: 'Quantity Sold', key: 'quantity', format: 'number'},
              {label: 'Amount (KES)', key: 'amount', format: 'currency'}
          ];
      } else if(type === 'greasing_sales') {
          title = "Greasing Services Breakdown";
          data = window.CURRENT_RECON.greasing_breakdown || [];
          columns = [
              {label: 'Vehicle Type / Category', key: 'vehicle_type'},
              {label: 'Amount (KES)', key: 'amount', format: 'currency'}
          ];
      } else if(type === 'customer_payments') {
          title = "Customer Payments (Cash & M-Pesa Collected)";
          data = window.CURRENT_RECON.customer_payments_breakdown || [];
          columns = [
              {label: 'Payment Ref', key: 'name'},
              {label: 'Customer Name', key: 'customer'},
              {label: 'Payment Mode', key: 'mode_of_payment'},
              {label: 'Amount (KES)', key: 'amount', format: 'currency'}
          ];
      } else if(type === 'mpesa') {
          title = "M-Pesa Tills Breakdown";
          data = window.CURRENT_RECON.mpesa_breakdown || [];
          columns = [
              {label: 'M-Pesa Till Name', key: 'mpesa_till'},
              {label: 'Amount (KES)', key: 'amount', format: 'currency'}
          ];
      } else if(type === 'invoices') {
          title = "Credit Invoices Breakdown";
          data = window.CURRENT_RECON.invoices_breakdown || [];
          columns = [
              {label: 'Entry / Inv #', key: 'entry_number'},
              {label: 'Customer', key: 'customer'},
              {label: 'Item', key: 'item'},
              {label: 'Qty', key: 'quantity', format: 'number'},
              {label: 'Amount (KES)', key: 'amount', format: 'currency'}
          ];
      } else if(type === 'cards') {
          title = "Station Card Payments Breakdown";
          data = window.CURRENT_RECON.cards_breakdown || [];
          columns = [
              {label: 'Card Type', key: 'card_type'},
              {label: 'Receipt / RRN', key: 'receipt_no'},
              {label: 'Memo / Notes', key: 'memo'},
              {label: 'Amount (KES)', key: 'amount', format: 'currency'}
          ];
      } else if(type === 'expenses') {
          title = "Petty Cash & Expenses Breakdown (CSA Deductions)";
          data = window.CURRENT_RECON.expenses_breakdown || [];
          columns = [
              {label: 'Entry ID', key: 'name'},
              {label: 'Category', key: 'category'},
              {label: 'Expense Account (COA)', key: 'expense_account'},
              {label: 'Payee', key: 'payee'},
              {label: 'Memo / Purpose', key: 'memo'},
              {label: 'Amount (KES)', key: 'amount', format: 'currency'}
          ];
      } else if (type === 'rtt') {
          title = "Return To Tank (RTT / Testing) Breakdown";
          data = window.CURRENT_RECON.rtt_breakdown || [];
          columns = [
              {label: 'Fuel Product / Item', key: 'item'},
              {label: 'Volume Returned (L)', key: 'quantity', format: 'number'},
              {label: 'Amount (KES)', key: 'amount', format: 'currency'}
          ];
      } else if (type === 'discounts') {
          title = "Discounts Breakdown (CSA Liability Relief)";
          data = window.CURRENT_RECON.discounts_breakdown || [];
          columns = [
              {label: 'Entry / Inv #', key: 'entry_number'},
              {label: 'Customer', key: 'customer'},
              {label: 'Item', key: 'item'},
              {label: 'Quantity', key: 'quantity', format: 'number'},
              {label: 'Discount Relief (KES)', key: 'amount', format: 'currency'},
              {label: 'Reason / Notes', key: 'discount_reason'}
          ];
      }
      
      if(title) {
          show_breakdown_modal(title, data, columns);
      }
  });

} catch (e) {
    console.error('SPA JS GLOBAL ERROR:', e);
    if (typeof frappe !== 'undefined' && frappe.msgprint) {
        frappe.msgprint('SPA Global Error: ' + e.message);
    }
}


function render_borrowed_products($wrapper) {
    if(!window.ACTIVE_SHIFT || !window.ACTIVE_SHIFT.station) return;
    
    // Set Active Shift Display
    let shiftDate = window.ACTIVE_SHIFT.shift_date ? frappe.datetime.str_to_user(window.ACTIVE_SHIFT.shift_date) : "";
    let shiftName = window.ACTIVE_SHIFT.shift_template || "";
    $wrapper.find('#bp-shift-display').text(`${shiftDate} (${shiftName})`);
    
    // Segmented control
    $wrapper.find('#tab-borrowed .seg-btn').off('click').on('click', function() {
        let view = $(this).attr('data-view');
        $wrapper.find('#tab-borrowed .seg-btn').removeClass('active');
        $(this).addClass('active');
        
        $wrapper.find('#tab-borrowed .view-pane').removeClass('active');
        $wrapper.find('#bp-' + view + '-view').addClass('active');
        
        if (view === 'history') {
            fetch_bp_history($wrapper);
        }
    });
    
    // Fetch Counterparties
    frappe.call({
        method: 'fuel_management.fuel_management.api.get_borrowing_counterparties',
        callback: function(r) {
            if(r.message) {
                let select = $wrapper.find('#bp-counterparty');
                select.empty().append('<option value="">Select Counterparty...</option>');
                r.message.forEach(c => {
                    select.append(`<option value="${c.value}">${c.label}</option>`);
                });
            }
        }
    });
    
    // Add first item row if empty
    if ($wrapper.find('#bp-items-container').children().length === 0) {
        add_bp_item_row($wrapper);
    }
    
    $wrapper.find('#btn-add-bp-item').off('click').on('click', function() {
        add_bp_item_row($wrapper);
    });
    
    // Set default filter dates to first and last of month
    let fromInput = $wrapper.find('#bp-filter-from-date');
    let toInput = $wrapper.find('#bp-filter-to-date');
    if (!fromInput.val()) {
        let d = new Date();
        fromInput.val(new Date(d.getFullYear(), d.getMonth(), 2).toISOString().split('T')[0]);
    }
    if (!toInput.val()) {
        let d = new Date();
        toInput.val(new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().split('T')[0]);
    }
    
    $wrapper.find('#btn-refresh-bp-history').off('click').on('click', function() {
        fetch_bp_history($wrapper);
    });
    
    $wrapper.find('#btn-cancel-bp').off('click').on('click', function() {
        $wrapper.find('#bp-counterparty').val('');
        $wrapper.find('#bp-memo').val('');
        $wrapper.find('#bp-items-container').empty();
        add_bp_item_row($wrapper);
    });
    
    $wrapper.find('#btn-save-bp').off('click').on('click', function() {
        submit_borrowed_product($wrapper);
    });
    
    // Initial fetch history
    fetch_bp_history($wrapper);
    
    // Return modal events
    $wrapper.find('#bp-return-modal-close, #btn-bp-return-cancel').off('click').on('click', function() {
        $wrapper.find('#bp-return-modal').hide();
    });
    
    $wrapper.find('#btn-bp-return-submit').off('click').on('click', function() {
        submit_bp_return($wrapper);
    });
}

function add_bp_item_row($wrapper) {
    let container = $wrapper.find('#bp-items-container');
    let row_id = frappe.utils.get_random(8);
    
    let html = `
        <div class="bp-item-row" id="bp-row-${row_id}" style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
            <select class="spa-input bp-item-code" style="flex:2;"></select>
            <input type="number" class="spa-input bp-qty" placeholder="Qty" style="flex:1;">
            <button class="btn btn-secondary" onclick="$(this).closest('.bp-item-row').remove();" style="color: #ef4444; border-color: #ef4444; background: transparent; padding: 0.5rem 1rem;">&times;</button>
        </div>
    `;
    
    let $row = $(html);
    container.append($row);
    
    if (window.cached_items) {
        let select = $row.find('.bp-item-code');
        select.append('<option value="">Select Product...</option>');
        window.cached_items.forEach(item => {
            select.append(`<option value="${item.name}">${item.item_name}</option>`);
        });
    } else {
        frappe.call({
            method: 'frappe.client.get_list',
            args: { doctype: "Item", fields: ["name", "item_name", "item_group"], filters: {disabled: 0}, limit_page_length: 5000 },
            callback: function(r) {
                if (r.message) {
                    window.cached_items = r.message;
                    let select = $row.find('.bp-item-code');
                    select.append('<option value="">Select Product...</option>');
                    r.message.forEach(item => {
                        select.append(`<option value="${item.name}">${item.item_name}</option>`);
                    });
                }
            }
        });
    }
}

function submit_borrowed_product($wrapper) {
    let type = $wrapper.find('#bp-type').val();
    let counterparty = $wrapper.find('#bp-counterparty').val();
    let memo = $wrapper.find('#bp-memo').val();
    let date = window.ACTIVE_SHIFT.shift_date || frappe.datetime.get_today();
    
    if (!counterparty) {
        frappe.msgprint("Please select a Counterparty.");
        return;
    }
    
    let items = [];
    let has_error = false;
    
    $wrapper.find('.bp-item-row').each(function() {
        let item_code = $(this).find('.bp-item-code').val();
        let qty = parseFloat($(this).find('.bp-qty').val());
        
        if (item_code && qty > 0) {
            items.push({
                item_code: item_code,
                qty: qty
            });
        } else if (item_code || qty) {
            has_error = true;
        }
    });
    
    if (has_error || items.length === 0) {
        frappe.msgprint("Please select a product and enter a valid quantity for all rows.");
        return;
    }
    
    let payload = {
        station: window.ACTIVE_SHIFT.station,
        type: type,
        date: date,
        counterparty: counterparty,
        memo: memo,
        items: items
    };
    
    let $btn = $wrapper.find('#btn-save-bp');
    $btn.find('.spinner').removeClass('hidden');
    $btn.prop('disabled', true);
    
    frappe.call({
        method: 'fuel_management.fuel_management.api.create_borrowed_product',
        args: { payload: JSON.stringify(payload) },
        callback: function(r) {
            $btn.find('.spinner').addClass('hidden');
            $btn.prop('disabled', false);
            
            if (!r.exc && r.message) {
                frappe.show_alert({message: "Successfully recorded " + type, indicator: "green"});
                $wrapper.find('#bp-counterparty').val('');
                $wrapper.find('#bp-memo').val('');
                $wrapper.find('#bp-items-container').empty();
                add_bp_item_row($wrapper);
                
                // Switch to history tab
                $wrapper.find('#tab-borrowed .seg-btn[data-view="history"]').click();
            }
        }
    });
}

function fetch_bp_history($wrapper) {
    let from_date = $wrapper.find('#bp-filter-from-date').val();
    let to_date = $wrapper.find('#bp-filter-to-date').val();
    let counterparty = $wrapper.find('#bp-filter-counterparty').val() || "";
    
    let $btn = $wrapper.find('#btn-refresh-bp-history');
    $btn.find('.spinner').removeClass('hidden');
    
    let $tbody = $wrapper.find('#list-borrowed-saved');
    $tbody.html('<tr><td colspan="8" class="text-center">Loading history...</td></tr>');
    
    frappe.call({
        method: 'fuel_management.fuel_management.api.get_borrowed_products',
        args: { 
            station: window.ACTIVE_SHIFT.station,
            status: "All",
            from_date: from_date,
            to_date: to_date,
            counterparty: counterparty
        },
        callback: function(r) {
            $btn.find('.spinner').addClass('hidden');
            $tbody.empty();
            let count = r.message ? r.message.length : 0;
            if (!from_date && !to_date && !counterparty) {
                $wrapper.find('#bp-history-subtitle').html(`<span style="color:#64748b; font-size:0.85rem;">(Showing latest 20 entries &bull; Use date filter for more)</span>`);
            } else {
                $wrapper.find('#bp-history-subtitle').html(`<span style="color:#047857; font-size:0.85rem; font-weight:600;">(Showing ${count} filtered entries)</span>`);
            }
            
            if (r.message && r.message.length > 0) {
                r.message.forEach(row => {
                    let type_html = row.type === 'Borrowed In' 
                        ? `<span class="px-2 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">IN</span>` 
                        : `<span class="px-2 py-1 bg-red-100 text-red-800 text-xs font-semibold rounded-full">OUT</span>`;
                        
                    let status_html = row.status === 'Pending Return'
                        ? `<span class="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-md border border-amber-200">Pending Return</span>`
                        : `<span class="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-200">Returned</span>`;
                        
                    let items_html = row.items.map(i => `${i.qty}x ${i.item_code}`).join('<br>');
                    
                    let action_html = "";
                    if (row.status === 'Pending Return') {
                        action_html = `<button class="btn btn-primary" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;" onclick="open_bp_return_modal('${row.name}', '${row.counterparty}')">Return</button>`;
                    }
                    
                    let tr = `
                        <tr>
                            <td class="text-sm font-medium text-gray-900">${row.name}</td>
                            <td class="text-sm text-gray-500">${frappe.datetime.str_to_user(row.date)}</td>
                            <td>${type_html}</td>
                            <td class="text-sm text-gray-900 font-semibold">${row.counterparty}</td>
                            <td class="text-sm text-gray-600">${items_html}</td>
                            <td>${status_html}</td>
                            <td class="text-sm text-gray-500">${row.memo || ""}</td>
                            <td>${action_html}</td>
                        </tr>
                    `;
                    $tbody.append(tr);
                });
            } else {
                $tbody.append('<tr><td colspan="8" class="text-center" style="padding: 2rem; color: #64748b;">No borrowed products found.</td></tr>');
            }
        }
    });
}

window.open_bp_return_modal = function(docname, counterparty) {
    let $wrapper = $('.shift-operation-spa');
    let $modal = $wrapper.find('#bp-return-modal');
    
    $wrapper.find('#bp-return-docname').val(docname);
    $wrapper.find('#bp-return-date').val(window.ACTIVE_SHIFT.shift_date || frappe.datetime.get_today());
    
    $wrapper.find('#bp-return-modal-body').html('<div class="text-center">Loading items...</div>');
    $modal.css('display', 'flex');
    
    // Fetch items for this borrow record to show what's being returned
    frappe.call({
        method: 'frappe.client.get',
        args: {
            doctype: 'Borrowed Product',
            name: docname
        },
        callback: function(r) {
            if (r.message) {
                let html = `<div style="margin-bottom: 10px; font-weight: bold; color: #1e293b;">Items from ${counterparty}:</div>`;
                html += `<table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
                            <thead>
                                <tr style="background: #f1f5f9;">
                                    <th style="padding: 8px; text-align: left; border-bottom: 1px solid #cbd5e1; font-size: 0.85rem; color: #475569;">Item</th>
                                    <th style="padding: 8px; text-align: center; border-bottom: 1px solid #cbd5e1; font-size: 0.85rem; color: #475569;">Qty to Return</th>
                                </tr>
                            </thead>
                            <tbody>`;
                
                r.message.items.forEach(i => {
                    html += `<tr>
                                <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-size: 0.9rem;">${i.item_code}</td>
                                <td style="padding: 8px; text-align: center; border-bottom: 1px solid #e2e8f0; font-size: 0.9rem; font-weight: 600;">${i.qty}</td>
                             </tr>`;
                });
                
                html += `</tbody></table>`;
                html += `<div class="alert alert-warning" style="font-size: 0.85rem; padding: 10px; margin-top: 10px;">
                            <strong>Note:</strong> Returning this will automatically post a reverse Stock Entry.
                         </div>`;
                
                $wrapper.find('#bp-return-modal-body').html(html);
            }
        }
    });
};

function submit_bp_return($wrapper) {
    let docname = $wrapper.find('#bp-return-docname').val();
    
    let $btn = $wrapper.find('#btn-bp-return-submit');
    $btn.find('.spinner').removeClass('hidden');
    $btn.prop('disabled', true);
    
    frappe.call({
        method: 'fuel_management.fuel_management.api.return_borrowed_product',
        args: { docname: docname },
        callback: function(r) {
            $btn.find('.spinner').addClass('hidden');
            $btn.prop('disabled', false);
            
            if (!r.exc) {
                frappe.show_alert({message: "Successfully returned!", indicator: "green"});
                $wrapper.find('#bp-return-modal').hide();
                fetch_bp_history($wrapper);
            }
        }
    });
}


// =========================================================
// END SHIFT REPORT MODULE
// =========================================================
function ensure_nozzles_and_prices(doc, callback) {
    if (window.PUMP_NOZZLES && window.NOZZLE_ITEMS && Object.keys(window.NOZZLE_ITEMS).length > 0 && window.FUEL_PRICES && Object.keys(window.FUEL_PRICES).length > 0) {
        callback();
        return;
    }
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Pump Nozzle",
            fields: ["name", "pump_group"],
            limit_page_length: 500
        },
        callback: function(r1) {
            if (r1.message) {
                window.PUMP_NOZZLES = r1.message;
            }
            frappe.call({
                method: "fuel_management.fuel_management.doctype.shift.shift.get_nozzle_prices",
                args: {
                    station: (doc && doc.station) || (window.ACTIVE_SHIFT ? window.ACTIVE_SHIFT.station : ""),
                    shift_date: (doc && doc.shift_date) || (window.ACTIVE_SHIFT ? window.ACTIVE_SHIFT.shift_date : "")
                },
                callback: function(r2) {
                    let nozzle_prices = r2.message || {};
                    window.NOZZLE_ITEMS = window.NOZZLE_ITEMS || {};
                    window.FUEL_PRICES = window.FUEL_PRICES || {};
                    Object.keys(nozzle_prices).forEach(noz => {
                        window.NOZZLE_ITEMS[noz] = nozzle_prices[noz].item;
                        window.FUEL_PRICES[nozzle_prices[noz].item] = nozzle_prices[noz].price;
                    });
                    callback();
                },
                error: function() {
                    callback();
                }
            });
        },
        error: function() {
            callback();
        }
    });
}

window.generate_end_shift_report = function($wrapper, targetShiftName = null) {
    let shift_name = targetShiftName || (window.ACTIVE_SHIFT ? window.ACTIVE_SHIFT.name : (window.SHIFT_DOC ? window.SHIFT_DOC.name : null));
    if (!shift_name) {
        $wrapper.find('#shift-report-container').html('<div style="text-align:center; padding:3rem; color:#94a3b8;">No shift selected. Please start a shift or pick a past shift from the Past Shift Reports tab.</div>');
        return;
    }
    
    $wrapper.find('#shift-report-container').html('<div style="text-align:center; padding:3rem; color:#64748b;"><div class="spinner" style="margin: 0 auto 10px auto;"></div> Loading End Shift Report...</div>');

    frappe.call({
        method: "frappe.client.get",
        args: {
            doctype: "Shift",
            name: shift_name
        },
        callback: function(shift_res) {
            if (!shift_res.message) {
                $wrapper.find('#shift-report-container').html('<div style="text-align:center; color:#ef4444; padding:3rem;">Failed to load shift details for ' + shift_name + '.</div>');
                return;
            }
            
            let doc = shift_res.message;
            if (!targetShiftName || (window.ACTIVE_SHIFT && shift_name === window.ACTIVE_SHIFT.name)) {
                window.SHIFT_DOC = doc;
            }

            ensure_nozzles_and_prices(doc, function() {
                frappe.call({
                    method: "fuel_management.fuel_management.api.get_shift_report_data",
                    args: {
                        shift_id: doc.name
                    },
                    callback: function(r) {
                        try {
                            doc.csa_reconciliation = (r.message && r.message.reconciliations) ? r.message.reconciliations : [];
                            doc.non_shift_amount = (r.message && r.message.non_shift_amount) ? r.message.non_shift_amount : 0;
                            doc.customer_payments_total = (r.message && r.message.customer_payments_total) ? r.message.customer_payments_total : 0;
                            doc.customer_payments_breakdown = (r.message && r.message.customer_payments_breakdown) ? r.message.customer_payments_breakdown : [];
                            doc.topups_total = (r.message && r.message.topups_total) ? r.message.topups_total : 0;
                            doc.cards_breakdown = (r.message && r.message.cards_breakdown) ? r.message.cards_breakdown : [];
                            doc.invoices_breakdown = (r.message && r.message.invoices_breakdown) ? r.message.invoices_breakdown : [];
                            doc.petty_cash_breakdown = (r.message && r.message.petty_cash_breakdown) ? r.message.petty_cash_breakdown : [];
                            doc.petty_cash_total = (r.message && r.message.petty_cash_total) ? r.message.petty_cash_total : 0;
                            
                            let company = (frappe.boot && frappe.boot.sysdefaults && frappe.boot.sysdefaults.company) ? frappe.boot.sysdefaults.company : "END OF SHIFT REPORT";
                            let headCsaName = doc.head_csa || 'N/A';
                            if (window.USERS_LIST && doc.head_csa) {
                                let u = window.USERS_LIST.find(u => u.name === doc.head_csa);
                                if (u) headCsaName = u.employee_name || u.full_name || doc.head_csa;
                            }

                            let html = `<div class="report-header" style="text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px;">
                                <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">${frappe.utils.escape_html(company)}</h1>
                                <p style="margin: 6px 0 0; font-size: 13px; color: #475569;">
                                    <strong>Station:</strong> ${frappe.utils.escape_html(doc.station || '')} &nbsp;|&nbsp; 
                                    <strong>Shift:</strong> ${frappe.utils.escape_html(doc.shift_template || '')} &nbsp;|&nbsp; 
                                    <strong>Date:</strong> ${frappe.datetime.str_to_user(doc.shift_date || '')} &nbsp;|&nbsp; 
                                    <strong>Head CSA / Cashier:</strong> ${frappe.utils.escape_html(headCsaName)} &nbsp;|&nbsp;
                                    <strong>Status:</strong> <span class="badge" style="background:${doc.status === 'Open' ? '#dcfce7; color:#166534;' : '#f1f5f9; color:#475569;'} font-weight:700;">${doc.status || 'Closed'}</span>
                                </p>
                            </div>`;
                            
                            // 1. METER READINGS (Grouped by Pump)
                            html += `<div class="report-section" style="margin-bottom: 20px;">
                                <div class="report-section-title" style="font-weight: 800; font-size: 12px; padding: 6px 12px; background: #1e293b; color: #ffffff; text-transform: uppercase; border-radius: 6px 6px 0 0;">PUMP METER READINGS</div>
                                <div style="overflow-x: auto; border: 1px solid #cbd5e1; border-top: none; border-radius: 0 0 6px 6px;">
                                <table class="report-table" style="width:100%; border-collapse:collapse; font-size:12px;">
                                    <thead style="background:#f8fafc; border-bottom:1px solid #cbd5e1;">
                                        <tr>
                                            <th style="padding:8px 10px; text-align:left; color:#475569; font-weight:700;">PUMP GROUP</th>
                                            <th style="padding:8px 10px; text-align:left; color:#475569; font-weight:700;">NOZZLE</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">OPEN (E)</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">CLOSE (E)</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">OPEN (M)</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">CLOSE (M)</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">SALES (LTS)</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">UNIT PRICE</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">TOTAL CASH</th>
                                        </tr>
                                    </thead>
                                    <tbody>`;
                                    
                            let total_pump_liters = 0;
                            let total_pump_cash = 0;
                            let total_by_item = {};
                            
                            if (doc.pump_meter_readings && doc.pump_meter_readings.length > 0) {
                                let pumps = {};
                                doc.pump_meter_readings.forEach(row => {
                                    let nozzle_doc = (window.PUMP_NOZZLES || []).find(n => n.name === row.pump_nozzle);
                                    let pump = nozzle_doc ? (nozzle_doc.pump_group || "Ungrouped") : "Ungrouped";
                                    if (!pumps[pump]) pumps[pump] = [];
                                    pumps[pump].push(row);
                                });
                                
                                Object.keys(pumps).sort().forEach(pump => {
                                    let pump_rows = pumps[pump];
                                    pump_rows.forEach((row, idx) => {
                                        let item = (window.NOZZLE_ITEMS && window.NOZZLE_ITEMS[row.pump_nozzle]) ? window.NOZZLE_ITEMS[row.pump_nozzle] : "";
                                        let price = (window.FUEL_PRICES && window.FUEL_PRICES[item]) ? window.FUEL_PRICES[item] : 0;
                                        
                                        let sales_lts = Math.max(0, (row.closing_electronic_meter || 0) - (row.opening_electronic_meter || 0));
                                        let cash = sales_lts * price;
                                        
                                        total_pump_liters += sales_lts;
                                        total_pump_cash += cash;
                                        
                                        if (item) {
                                            if (!total_by_item[item]) total_by_item[item] = { liters: 0, cash: 0 };
                                            total_by_item[item].liters += sales_lts;
                                            total_by_item[item].cash += cash;
                                        }
                                        
                                        html += `<tr style="border-bottom: 1px solid #f1f5f9;">
                                            ${idx === 0 ? `<td rowspan="${pump_rows.length}" style="padding:8px 10px; font-weight:700; color:#0f172a; vertical-align:top; background:#fafafa; border-right:1px solid #f1f5f9;">${frappe.utils.escape_html(pump)}</td>` : ''}
                                            <td style="padding:8px 10px; font-weight:600; color:#334155;">${frappe.utils.escape_html(row.pump_nozzle)} ${item ? `<span style="font-size:0.75rem; color:#64748b;">(${frappe.utils.escape_html(item)})</span>` : ''}</td>
                                            <td style="padding:8px 10px; text-align:right; font-family:monospace;">${frappe.format(row.opening_electronic_meter || 0, {fieldtype: 'Float'})}</td>
                                            <td style="padding:8px 10px; text-align:right; font-family:monospace;">${frappe.format(row.closing_electronic_meter || 0, {fieldtype: 'Float'})}</td>
                                            <td style="padding:8px 10px; text-align:right; font-family:monospace; color:#64748b;">${frappe.format(row.opening_manual_meter || 0, {fieldtype: 'Float'})}</td>
                                            <td style="padding:8px 10px; text-align:right; font-family:monospace; color:#64748b;">${frappe.format(row.closing_manual_meter || 0, {fieldtype: 'Float'})}</td>
                                            <td style="padding:8px 10px; text-align:right; font-weight:700; font-family:monospace; color:#0f172a;">${frappe.format(sales_lts, {fieldtype: 'Float'})}</td>
                                            <td style="padding:8px 10px; text-align:right; font-family:monospace;">${frappe.format(price, {fieldtype: 'Currency'})}</td>
                                            <td style="padding:8px 10px; text-align:right; font-weight:800; font-family:monospace; color:#047857;">${frappe.format(cash, {fieldtype: 'Currency'})}</td>
                                        </tr>`;
                                    });
                                });
                            } else {
                                html += `<tr><td colspan="9" style="text-align:center; padding:2rem; color:#94a3b8;">No meter readings found.</td></tr>`;
                            }
                            
                            html += `</tbody><tfoot style="background:#f1f5f9; border-top:2px solid #cbd5e1;">`;
                                
                            Object.keys(total_by_item).sort().forEach(item => {
                                html += `<tr>
                                    <th colspan="6" style="padding:8px 10px; text-align:left; font-size:13px; font-weight:800; color:#1e293b;">TOTAL ${frappe.utils.escape_html(item.toUpperCase())}</th>
                                    <th style="padding:8px 10px; text-align:right; font-size:13px; font-weight:900; color:#0f172a; font-family:monospace;">${Math.round(total_by_item[item].liters).toLocaleString()} L</th>
                                    <th style="padding:8px 10px;"></th>
                                    <th style="padding:8px 10px; text-align:right; font-size:13px; font-weight:900; color:#047857; font-family:monospace;">${frappe.format(total_by_item[item].cash, {fieldtype: 'Currency'})}</th>
                                </tr>`;
                            });
                                
                            html += `<tr style="background:#e2e8f0; border-top:2px solid #94a3b8;">
                                        <th colspan="6" style="padding:10px; text-align:left; font-size:14px; font-weight:900; color:#0f172a; text-transform:uppercase;">GRAND TOTAL METERS</th>
                                        <th style="padding:10px; text-align:right; font-size:14px; font-weight:900; color:#0f172a; font-family:monospace;">${Math.round(total_pump_liters).toLocaleString()} L</th>
                                        <th style="padding:10px;"></th>
                                        <th style="padding:10px; text-align:right; font-size:14px; font-weight:900; color:#047857; font-family:monospace;">${frappe.format(total_pump_cash, {fieldtype: 'Currency'})}</th>
                                    </tr>
                                </tfoot>
                            </table></div></div>`;
                            
                            // 2. WET STOCK INFORMATION
                            let is_day_shift = (doc.shift_template || '').toLowerCase().includes('day');
                            
                            let dip_section_header = `<div class="report-section" style="margin-bottom: 20px;">
                                <div class="report-section-title green" style="font-weight: 800; font-size: 12px; padding: 6px 12px; background: #047857; color: #ffffff; text-transform: uppercase; border-radius: 6px 6px 0 0;">WET STOCK INFORMATION (DIPS) ${is_day_shift ? '- DAY SHIFT (N/A)' : '- DAILY SUMMARY'}</div>
                                <div style="overflow-x: auto; border: 1px solid #cbd5e1; border-top: none; border-radius: 0 0 6px 6px;">
                                <table class="report-table" style="width:100%; border-collapse:collapse; font-size:12px;">
                                    <thead style="background:#f8fafc; border-bottom:1px solid #cbd5e1;">
                                        <tr>
                                            <th style="padding:8px 10px; text-align:left; color:#475569; font-weight:700;">TANK</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">OPENING DIP</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">PURCHASES (LTS)</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">CLOSING DIP</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">TANK SALES</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">METER SALES (FULL DAY)</th>
                                            <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">DAILY VARIANCE</th>
                                        </tr>
                                    </thead>
                                    <tbody id="dips-tbody">`;
                            
                            function render_report_tail(base_html) {
                                let h = base_html;
                                
                                // 3. CSA RECONCILIATION SUMMARY
                                h += `<div class="report-section" style="margin-bottom: 20px;">
                                    <div class="report-section-title" style="font-weight: 800; font-size: 12px; padding: 6px 12px; background: #1e293b; color: #ffffff; text-transform: uppercase; border-radius: 6px 6px 0 0;">CSA RECONCILIATION SUMMARY</div>
                                    <div style="overflow-x: auto; border: 1px solid #cbd5e1; border-top: none; border-radius: 0 0 6px 6px;">
                                    <table class="report-table" style="width:100%; border-collapse:collapse; font-size:12px;">
                                        <thead style="background:#f8fafc; border-bottom:1px solid #cbd5e1;">
                                            <tr>
                                                <th style="padding:8px 10px; text-align:left; color:#475569; font-weight:700;">CSA NAME</th>
                                                <th style="padding:8px 10px; text-align:left; color:#475569; font-weight:700;">PUMP GROUP</th>
                                                <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">METER SALES</th>
                                                <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">INVOICES &amp; CARDS</th>
                                                <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">MPESA</th>
                                                <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">EXPENSES / ADV</th>
                                                <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">EXPECTED CASH</th>
                                                <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">SUBMITTED CASH</th>
                                                <th style="padding:8px 10px; text-align:right; color:#475569; font-weight:700;">EXCESS / SHORT</th>
                                            </tr>
                                        </thead>
                                        <tbody>`;
                                
                                if (doc.csa_reconciliation && doc.csa_reconciliation.length > 0) {
                                    doc.csa_reconciliation.forEach(row => {
                                        let name = row.csa_name || row.csa || '';
                                        if (window.USERS_LIST) {
                                            let u = window.USERS_LIST.find(u => u.name === name);
                                            if (u) name = u.employee_name || u.full_name;
                                        }
                                        let pg_row = (doc.assigned_csas || []).find(c => c.csa === row.csa);
                                        let pump_group = pg_row ? pg_row.pump_group : '';
                                        let inv = (row.invoices || 0) + (row.cards || 0);
                                        let exp = (row.expenses || 0);
                                        let varColor = (row.variance || 0) < 0 ? '#dc2626' : '#16a34a';
                                        
                                        h += `<tr style="border-bottom: 1px solid #f1f5f9;">
                                            <td style="padding:8px 10px; font-weight:700; color:#0f172a;">${frappe.utils.escape_html(name)}</td>
                                            <td style="padding:8px 10px; color:#475569;">${frappe.utils.escape_html(pump_group)}</td>
                                            <td style="padding:8px 10px; text-align:right; font-family:monospace;">${frappe.format(row.meter_sales || 0, {fieldtype: 'Currency'})}</td>
                                            <td style="padding:8px 10px; text-align:right; font-family:monospace;">${frappe.format(inv, {fieldtype: 'Currency'})}</td>
                                            <td style="padding:8px 10px; text-align:right; font-family:monospace;">${frappe.format(row.mpesa || 0, {fieldtype: 'Currency'})}</td>
                                            <td style="padding:8px 10px; text-align:right; font-family:monospace;">${frappe.format(exp, {fieldtype: 'Currency'})}</td>
                                            <td style="padding:8px 10px; text-align:right; font-weight:800; font-family:monospace;">${frappe.format(row.expected_cash || 0, {fieldtype: 'Currency'})}</td>
                                            <td style="padding:8px 10px; text-align:right; font-family:monospace;">${frappe.format(row.actual_cash || 0, {fieldtype: 'Currency'})}</td>
                                            <td style="padding:8px 10px; text-align:right; font-weight:800; font-family:monospace; color:${varColor};">${frappe.format(row.variance || 0, {fieldtype: 'Currency'})}</td>
                                        </tr>`;
                                    });
                                } else {
                                    h += `<tr><td colspan="9" style="text-align:center; padding:2rem; color:#94a3b8;">No reconciliation data found for this shift.</td></tr>`;
                                }
                                h += `</tbody></table></div></div>`;
                                
                                // 4. GRAND RECONCILIATION
                                let total_invoices = 0, total_cards = 0, total_mpesa = 0, total_expenses = 0, total_discounts = 0, total_submitted_cash = 0, total_variance = 0;
                                if (doc.csa_reconciliation && doc.csa_reconciliation.length > 0) {
                                    doc.csa_reconciliation.forEach(row => {
                                        total_invoices += (row.invoices || 0);
                                        total_cards += (row.cards || 0);
                                        total_mpesa += (row.mpesa || 0);
                                        total_expenses += (row.expenses || 0);
                                        total_discounts += (row.discounts || 0);
                                        total_submitted_cash += (row.actual_cash || 0);
                                        total_variance += (row.variance || 0);
                                    });
                                }
                                
                                let cp_total = doc.customer_payments_total || 0;
                                let topups_total = doc.topups_total || 0;
                                let calc_expected = total_pump_cash - (total_invoices + total_cards + total_mpesa + total_expenses + total_discounts);
                                
                                let cards_html = '';
                                if (doc.cards_breakdown && doc.cards_breakdown.length > 0) {
                                    doc.cards_breakdown.forEach(c => {
                                        cards_html += `<div class="summary-row" style="color: #64748b; padding-left: 15px; font-size: 0.85rem;"><span>↳ ${frappe.utils.escape_html(c.card_type || 'Unknown')}</span> <span>${frappe.format(c.amount || 0, {fieldtype: 'Currency'})}</span></div>`;
                                    });
                                }
                                
                                let invoices_html = '';
                                if (doc.invoices_breakdown && doc.invoices_breakdown.length > 0) {
                                    doc.invoices_breakdown.forEach(inv => {
                                        let custName = inv.customer || 'Unknown';
                                        let cObj = (window.CUSTOMERS_LIST || []).find(c => c.name === custName);
                                        if (cObj && cObj.customer_name) custName = cObj.customer_name;
                                        invoices_html += `<div class="summary-row" style="color: #64748b; padding-left: 15px; font-size: 0.85rem;"><span>↳ ${frappe.utils.escape_html(custName)}</span> <span>${frappe.format(inv.amount || 0, {fieldtype: 'Currency'})}</span></div>`;
                                    });
                                }
                                
                                let grand_variance = total_variance;
                                let grandVarColor = grand_variance < 0 ? '#dc2626' : '#16a34a';
                                
                                h += `<div class="report-section" style="margin-bottom: 20px;">
                                    <div class="report-section-title green" style="font-weight: 800; font-size: 12px; padding: 6px 12px; background: #047857; color: #ffffff; text-transform: uppercase; border-radius: 6px 6px 0 0;">GRAND RECONCILIATION</div>
                                    <div class="report-grid-2" style="display:grid; grid-template-columns: 1fr 1fr; gap: 15px; padding: 15px; border: 1px solid #cbd5e1; border-top: none; border-radius: 0 0 6px 6px; background: #f8fafc;">
                                        <div class="summary-box" style="background:#fff; border:1px solid #e2e8f0; border-radius:6px; padding:12px;">
                                            <div class="summary-row" style="display:flex; justify-content:space-between; padding:4px 0; font-size:12px; border-bottom:1px solid #f1f5f9;"><span>Total Meter Sales (Cash + Digital)</span> <strong style="font-family:monospace;">${frappe.format(total_pump_cash || 0, {fieldtype: 'Currency'})}</strong></div>
                                            <div class="summary-row" style="display:flex; justify-content:space-between; padding:4px 0; font-size:12px; border-bottom:1px solid #f1f5f9;"><span>Total Invoices</span> <strong style="font-family:monospace;">${frappe.format(total_invoices, {fieldtype: 'Currency'})}</strong></div>
                                            ${invoices_html}
                                            <div class="summary-row" style="display:flex; justify-content:space-between; padding:4px 0; font-size:12px; border-bottom:1px solid #f1f5f9;"><span>Total Cards</span> <strong style="font-family:monospace;">${frappe.format(total_cards, {fieldtype: 'Currency'})}</strong></div>
                                            ${cards_html}
                                            <div class="summary-row" style="display:flex; justify-content:space-between; padding:4px 0; font-size:12px; border-bottom:1px solid #f1f5f9;"><span>Total M-Pesa Receipts</span> <strong style="font-family:monospace;">${frappe.format(total_mpesa, {fieldtype: 'Currency'})}</strong></div>
                                            <div class="summary-row" style="display:flex; justify-content:space-between; padding:4px 0; font-size:12px; border-bottom:1px solid #f1f5f9;"><span>Total Expenses &amp; Advances</span> <strong style="font-family:monospace;">${frappe.format(total_expenses, {fieldtype: 'Currency'})}</strong></div>
                                            ${total_discounts > 0 ? `<div class="summary-row" style="display:flex; justify-content:space-between; padding:4px 0; font-size:12px; color: #7c3aed; border-bottom:1px solid #f1f5f9;"><span>Total Discounts Allowed</span> <strong style="font-family:monospace;">${frappe.format(total_discounts, {fieldtype: 'Currency'})}</strong></div>` : ''}
                                            <div class="summary-row total" style="display:flex; justify-content:space-between; padding:8px 0 4px 0; font-size:13px; font-weight:900; border-top:2px solid #0f172a; margin-top:6px;"><span>GRAND EXPECTED CASH</span> <span style="color:#0f172a; font-family:monospace;">${frappe.format(calc_expected, {fieldtype: 'Currency'})}</span></div>
                                        </div>
                                        <div class="summary-box" style="background:#fff; border:1px solid #e2e8f0; border-radius:6px; padding:12px;">
                                            <div class="summary-row" style="display:flex; justify-content:space-between; padding:4px 0; font-size:12px; border-bottom:1px solid #f1f5f9;"><span>Total Cash Submitted by CSAs</span> <strong style="font-family:monospace;">${frappe.format(total_submitted_cash, {fieldtype: 'Currency'})}</strong></div>
                                            <div class="summary-row total" style="display:flex; justify-content:space-between; padding:8px 0 4px 0; font-size:13px; font-weight:900; border-top:2px solid #0f172a; margin-top:6px; color:${grandVarColor};"><span>GRAND STATION VARIANCE</span> <span style="font-family:monospace;">${frappe.format(grand_variance, {fieldtype: 'Currency'})}</span></div>
                                            <div class="summary-row" style="display:flex; justify-content:space-between; padding:6px 0 4px 0; border-top:1px dashed #cbd5e1; margin-top:10px; font-size:12px;"><span>Customer Payments (Non-Shift)</span> <strong style="font-family:monospace;">${frappe.format(cp_total, {fieldtype: 'Currency'})}</strong></div>
                                            ${(function(){
                                                let cp_html = '';
                                                if (doc.customer_payments_breakdown && doc.customer_payments_breakdown.length > 0) {
                                                    doc.customer_payments_breakdown.forEach(cp => {
                                                        let cpCust = cp.customer || 'Unknown';
                                                        let cObj = (window.CUSTOMERS_LIST || []).find(c => c.name === cpCust);
                                                        if (cObj && cObj.customer_name) cpCust = cObj.customer_name;
                                                        cp_html += `<div class="summary-row" style="color: #64748b; padding-left: 15px; font-size: 0.85rem;"><span>↳ ${frappe.utils.escape_html(cpCust)}</span> <span>${frappe.format(cp.amount || 0, {fieldtype: 'Currency'})}</span></div>`;
                                                    });
                                                }
                                                return cp_html;
                                            })()}
                                            <div class="summary-row" style="display:flex; justify-content:space-between; padding:4px 0; font-size:12px; border-bottom:1px solid #f1f5f9;"><span>Supplier Top-Ups (Non-Shift)</span> <strong style="font-family:monospace;">${frappe.format(topups_total, {fieldtype: 'Currency'})}</strong></div>
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="report-section" style="margin-top: 1.5rem;">
                                    <div class="report-section-title" style="background: #e2e8f0; color: #1e293b; padding: 8px 12px; font-weight: bold; font-size: 13px; border-radius: 4px 4px 0 0;">SHIFT NOTES / VARIANCE EXPLANATION</div>
                                    <textarea id="shift-notes-input" style="width: 100%; min-height: 100px; border: 1px solid #cbd5e1; border-radius: 0 0 4px 4px; padding: 12px; font-family: inherit; font-size: 13px; resize: vertical;" placeholder="Type notes here to explain variances before printing...">${doc.shift_notes || ''}</textarea>
                                </div>`;
                                
                                h += `<div style="margin-top: 20px; text-align: center; display:flex; justify-content:center; gap:1rem;">
                                    <button id="btn-send-owner-report" class="btn btn-success btn-lg" style="padding: 10px 24px; font-size: 15px; font-weight: bold; background-color: #16a34a; border-color: #16a34a; border-radius:6px; cursor:pointer;">
                                        Send Report to Owner
                                    </button>
                                </div>`;
                                
                                $wrapper.find('#shift-report-container').html(h);
                                
                                // Wire print button
                                $wrapper.find('#btn-print-report').off('click').on('click', function() {
                                    let shiftTitle = `${doc.station || 'Station'} - ${doc.shift_template || 'Shift'} (${frappe.datetime.str_to_user(doc.shift_date || '')})`;
                                    let printWin = window.open('', '', 'height=850,width=1050');
                                    
                                    let printStyles = `
                                        <style>
                                            @page { size: A4 portrait; margin: 10mm; }
                                            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; color: #1e293b; padding: 15px; margin: 0; }
                                            .report-header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 15px; }
                                            .report-header h1 { margin: 0; font-size: 18px; color: #0f172a; text-transform: uppercase; }
                                            .report-header p { margin: 5px 0 0; font-size: 11px; color: #475569; }
                                            .report-section { margin-bottom: 16px; page-break-inside: avoid; }
                                            .report-section-title { font-weight: 800; font-size: 11px; padding: 6px 10px; background: #1e293b; color: #ffffff; text-transform: uppercase; border-radius: 4px 4px 0 0; }
                                            .report-section-title.green { background: #047857; color: #ffffff; }
                                            .report-table { width: 100%; border-collapse: collapse; margin-top: 0; border: 1px solid #cbd5e1; }
                                            .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: 5px 8px; font-size: 10.5px; text-align: right; }
                                            .report-table th.text-left, .report-table td.text-left { text-align: left; }
                                            .report-table th.text-center, .report-table td.text-center { text-align: center; }
                                            .report-table th { background: #f8fafc; font-weight: 700; color: #334155; }
                                            .report-table tfoot th { background: #f1f5f9; font-weight: 800; }
                                            .bold { font-weight: 700; }
                                            .report-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
                                            .summary-box { border: 1px solid #cbd5e1; padding: 10px; border-radius: 4px; background: #ffffff; }
                                            .summary-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 11px; border-bottom: 1px solid #f1f5f9; }
                                            .summary-row.total { font-weight: 800; font-size: 12px; border-top: 2px solid #0f172a; margin-top: 5px; padding-top: 6px; }
                                            #btn-send-owner-report, #btn-print-report, .no-print { display: none !important; }
                                        </style>
                                    `;

                                    let $clone = $wrapper.find('#shift-report-container').clone();
                                    let notesVal = $wrapper.find('#shift-notes-input').val();
                                    $clone.find('#shift-notes-input').replaceWith(`<div style="padding: 10px; border: 1px solid #cbd5e1; min-height: 60px; font-size: 11px; white-space: pre-wrap;">${frappe.utils.escape_html(notesVal || 'No notes provided.')}</div>`);
                                    $clone.find('#btn-send-owner-report').parent().remove();

                                    printWin.document.write(`<!DOCTYPE html><html><head><title>${frappe.utils.escape_html(shiftTitle)}</title>${printStyles}</head><body>${$clone.html()}</body></html>`);
                                    printWin.document.close();
                                    printWin.focus();
                                    setTimeout(() => {
                                        printWin.print();
                                    }, 400);
                                });

                                // Wire Send to Owner
                                $wrapper.find('#btn-send-owner-report').off('click').on('click', function() {
                                    let $btn = $(this);
                                    let notes = $wrapper.find('#shift-notes-input').val();
                                    
                                    let $reportClone = $wrapper.find('#shift-report-container').clone();
                                    $reportClone.find('#shift-notes-input').replaceWith(`<div style="padding: 15px; border: 1px solid #cbd5e1; min-height: 120px; white-space: pre-wrap; font-size: 14px;">${frappe.utils.escape_html(notes || 'No notes provided.')}</div>`);
                                    $reportClone.find('#btn-send-owner-report').parent().remove();
                                    
                                    let html_content = $reportClone.html();
                                    $btn.prop('disabled', true).text('Sending...');
                                    
                                    frappe.call({
                                        method: "fuel_management.fuel_management.doctype.shift.shift.send_end_shift_report",
                                        args: {
                                            shift_name: doc.name,
                                            html_content: html_content
                                        },
                                        callback: function(r) {
                                            if (!r.exc) {
                                                frappe.show_alert({message: "Report successfully emailed to owner!", indicator: "green"});
                                                $btn.text('Sent Successfully').removeClass('btn-success').addClass('btn-primary').css('background-color', '#2563eb');
                                                if (window.ACTIVE_SHIFT) window.ACTIVE_SHIFT.report_sent = 1;
                                            } else {
                                                $btn.prop('disabled', false).text('Send Report to Owner');
                                            }
                                        }
                                    });
                                });
                            } // end render_report_tail
                            
                            // --- Build dip section and invoke render_report_tail ---
                            if (is_day_shift) {
                                let dip_body = '';
                                let tanks = window.STATION_SETTINGS && window.STATION_SETTINGS.tanks ? window.STATION_SETTINGS.tanks : ['Tank 1 - Petrol', 'Tank 2 - Diesel'];
                                tanks.forEach(tank => {
                                    let tn = typeof tank === 'string' ? tank : (tank.fuel_tank || tank.name);
                                    dip_body += `<tr>
                                        <td style="padding:8px 10px; font-weight:700; color:#94a3b8">${frappe.utils.escape_html(tn)}</td>
                                        <td style="padding:8px 10px; text-align:right; color:#94a3b8">-</td>
                                        <td style="padding:8px 10px; text-align:right; color:#94a3b8">-</td>
                                        <td style="padding:8px 10px; text-align:right; color:#94a3b8">-</td>
                                        <td style="padding:8px 10px; text-align:right; color:#94a3b8">-</td>
                                        <td style="padding:8px 10px; text-align:right; color:#94a3b8">-</td>
                                        <td style="padding:8px 10px; text-align:right; color:#94a3b8">-</td>
                                    </tr>`;
                                });
                                dip_body += `<tr><td colspan="7" style="text-align:center; padding:12px; color:#64748b; font-style:italic;">Dips are recorded at the end of the Night Shift for the entire 24h period.</td></tr>`;
                                
                                let full_html = html + dip_section_header + dip_body + `</tbody></table></div></div>`;
                                render_report_tail(full_html);
                            } else {
                                let placeholder_html = html + dip_section_header + 
                                    `<tr><td colspan="7" style="text-align:center; padding:12px; color:#64748b">Loading daily dip summary...</td></tr>` +
                                    `</tbody></table></div></div>`;
                                
                                render_report_tail(placeholder_html);
                                
                                frappe.call({
                                    method: 'fuel_management.fuel_management.api.get_daily_dip_summary',
                                    args: { shift_id: doc.name },
                                    callback: function(dip_res) {
                                        let dip_rows = dip_res.message || [];
                                        let dip_html = '';
                                        if (dip_rows.length > 0) {
                                            dip_rows.forEach(row => {
                                                let vc = (row.variance || 0) < 0 ? '#dc2626' : '#16a34a';
                                                dip_html += `<tr style="border-bottom: 1px solid #f1f5f9;">
                                                    <td style="padding:8px 10px; font-weight:700; color:#0f172a;">${frappe.utils.escape_html(row.fuel_tank || '')}</td>
                                                    <td style="padding:8px 10px; text-align:right; font-family:monospace;">${frappe.format(row.opening_dip || 0, {fieldtype:'Float'})}</td>
                                                    <td style="padding:8px 10px; text-align:right; font-family:monospace;">${frappe.format(row.injected_purchases || 0, {fieldtype:'Float'})}</td>
                                                    <td style="padding:8px 10px; text-align:right; font-family:monospace;">${frappe.format(row.closing_dip || 0, {fieldtype:'Float'})}</td>
                                                    <td style="padding:8px 10px; text-align:right; font-weight:700; font-family:monospace;">${frappe.format(row.sales_quantity || 0, {fieldtype:'Float'})}</td>
                                                    <td style="padding:8px 10px; text-align:right; font-family:monospace;">${frappe.format(row.meter_sales || 0, {fieldtype:'Float'})}</td>
                                                    <td style="padding:8px 10px; text-align:right; font-weight:800; font-family:monospace; color:${vc};">${frappe.format(row.variance || 0, {fieldtype:'Float'})}</td>
                                                </tr>`;
                                            });
                                        } else {
                                            dip_html = `<tr><td colspan="7" style="text-align:center; padding:12px; color:#94a3b8;">No dip stick readings found.</td></tr>`;
                                        }
                                        $wrapper.find('#dips-tbody').html(dip_html);
                                    }
                                });
                            }
                        } catch (e) {
                            console.error("REPORT GENERATION ERROR:", e);
                            $wrapper.find('#shift-report-container').html(`<div style="padding: 2rem; background: #fee2e2; color: #991b1b; border-radius: 8px;">
                                <h3>Error Generating Report</h3>
                                <pre style="white-space: pre-wrap; font-size: 12px; margin-top: 1rem;">${e.toString()}\n${e.stack}</pre>
                            </div>`);
                        }
                    }
                });
            });
        }
    });
};

// Past Shift Reports Logic
window.load_past_shifts = function() {
    let $wrapper = $('#shift-operation-spa-app');
    let start = $('#past-reports-start').val();
    let end = $('#past-reports-end').val();
    let station = window.ACTIVE_SHIFT ? window.ACTIVE_SHIFT.station : (frappe.defaults.get_user_default("station") || "RUBIS POA PLACE");
    
    let filters = [["station", "=", station]];
    if (start) filters.push(["shift_date", ">=", start]);
    if (end) filters.push(["shift_date", "<=", end]);

    $('#past-shifts-body').html('<tr><td colspan="4" class="text-center py-8 text-gray-500"><div class="spinner"></div> Loading past shifts...</td></tr>');

    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Shift",
            filters: filters,
            fields: ["name", "shift_date", "shift_template", "head_csa", "status", "modified"],
            order_by: "shift_date desc, modified desc",
            limit_page_length: 50
        },
        callback: function(r) {
            if (r.message && r.message.length > 0) {
                let html = '';
                r.message.forEach(s => {
                    let sDate = s.shift_date ? frappe.datetime.str_to_user(s.shift_date) : '';
                    let cashier = s.head_csa || 'N/A';
                    if (window.USERS_LIST) {
                        let u = window.USERS_LIST.find(u => u.name === s.head_csa);
                        if (u) cashier = u.employee_name || u.full_name;
                    }
                    html += `
                        <tr class="hover:bg-gray-50 border-b border-gray-100" style="border-bottom: 1px solid #f1f5f9;">
                            <td class="px-6 py-4 font-mono font-bold text-gray-900" style="padding:12px 16px;">
                                ${s.name} <span class="badge" style="background:#e2e8f0; color:#334155; font-size:0.75rem; font-weight:600; padding:2px 6px; border-radius:4px;">${s.shift_template || ''}</span>
                            </td>
                            <td class="px-6 py-4 text-gray-600" style="padding:12px 16px; color:#475569;">${sDate}</td>
                            <td class="px-6 py-4 font-medium text-gray-800" style="padding:12px 16px; font-weight:600;">${cashier}</td>
                            <td class="px-6 py-4 text-right" style="padding:12px 16px; text-align:right;">
                                <button class="btn btn-xs btn-primary btn-view-past-shift" data-shift="${s.name}" style="padding: 5px 12px; font-weight:700; border-radius:5px; background:#2563eb; color:#fff; border:none; cursor:pointer;">View Report</button>
                            </td>
                        </tr>
                    `;
                });
                $('#past-shifts-body').html(html);

                $('#past-shifts-body').find('.btn-view-past-shift').off('click').on('click', function() {
                    let shiftName = $(this).attr('data-shift');
                    // Switch to End Shift Report tab
                    $wrapper.find('.nav-item[data-target="tab-report"]').click();
                    window.generate_end_shift_report($wrapper, shiftName);
                });
            } else {
                $('#past-shifts-body').html('<tr><td colspan="4" class="text-center py-8 text-gray-500" style="padding:2rem; text-align:center; color:#94a3b8;">No past shifts found for the selected dates.</td></tr>');
            }
        }
    });
};

function render_past_reports($wrapper) {
    let today = frappe.datetime.get_today();
    if (!$wrapper.find('#past-reports-start').val()) {
        $wrapper.find('#past-reports-start').val(frappe.datetime.add_days(today, -7));
    }
    if (!$wrapper.find('#past-reports-end').val()) {
        $wrapper.find('#past-reports-end').val(today);
    }
    window.load_past_shifts();
}
/* =========================================================================
   DEBTORS MANAGEMENT MODULE (Balances, Itemized Statement & AR Aging)
   ========================================================================= */

window.DEBTORS_STATE = {
    wrapper: null,
    debtors: [],
    statement_data: null,
    aging_data: null,
    active_subview: 'balances',
    balances_search: '',
    balances_filter: 'all',
    balances_sort: 'balance_desc',
    aging_search: '',
    aging_filter: 'all',
    selected_customer_id: '',
    is_loading_balances: false,
    is_loading_statement: false,
    is_loading_aging: false
};

function format_kes(amount) {
    let num = Number(amount || 0);
    return 'KES ' + num.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function format_num_only(amount) {
    let num = Number(amount || 0);
    return num.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escape_debtor_html(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

window.init_debtors_module = function(wrapper) {
    window.DEBTORS_STATE.wrapper = wrapper;
    const $wrapper = $(wrapper);

    // 1. Segmented Control Switcher
    $wrapper.on('click', '#debtors-segmented-control .seg-btn', function(e) {
        e.preventDefault();
        let view = $(this).attr('data-view');
        window.switch_debtors_subview(view);
    });

    // 2. Balances View Controls
    $wrapper.on('input', '#db-search-input', function() {
        window.DEBTORS_STATE.balances_search = $(this).val().toLowerCase().trim();
        window.render_debtors_balances();
    });

    $wrapper.on('click', '.db-status-filter', function(e) {
        e.preventDefault();
        $wrapper.find('.db-status-filter').removeClass('active').css({ 'background': 'transparent', 'color': '#64748b', 'font-weight': '500' });
        $(this).addClass('active').css({ 'background': '#ffffff', 'color': '#1e293b', 'font-weight': '600' });
        window.DEBTORS_STATE.balances_filter = $(this).attr('data-filter') || 'all';
        window.render_debtors_balances();
    });

    $wrapper.on('change', '#db-sort-select', function() {
        window.DEBTORS_STATE.balances_sort = $(this).val();
        window.render_debtors_balances();
    });

    // 3. Statement View Controls
    $wrapper.on('change', '#stmt-customer-select', function() {
        let custId = $(this).val();
        window.DEBTORS_STATE.selected_customer_id = custId;
        window.update_statement_customer_card();
        if (custId) {
            window.load_customer_statement();
        }
    });

    $wrapper.on('click', '.stmt-preset-btn', function(e) {
        e.preventDefault();
        $wrapper.find('.stmt-preset-btn').removeClass('active').css({ 'background': '#f8fafc', 'color': '#64748b', 'border-color': '#e2e8f0', 'font-weight': '500' });
        $(this).addClass('active').css({ 'background': '#e0e7ff', 'color': '#3730a3', 'border-color': '#cbd5e1', 'font-weight': '600' });
        
        let preset = $(this).attr('data-preset');
        let today = frappe.datetime.get_today();
        let start = today;
        let end = today;

        let now = new Date();
        if (preset === 'this_month') {
            let y = now.getFullYear();
            let m = String(now.getMonth() + 1).padStart(2, '0');
            start = `${y}-${m}-01`;
            end = today;
        } else if (preset === 'last_month') {
            let prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            let prevLast = new Date(now.getFullYear(), now.getMonth(), 0);
            let py = prev.getFullYear();
            let pm = String(prev.getMonth() + 1).padStart(2, '0');
            let pld = String(prevLast.getDate()).padStart(2, '0');
            start = `${py}-${pm}-01`;
            end = `${py}-${pm}-${pld}`;
        } else if (preset === 'this_year') {
            start = `${now.getFullYear()}-01-01`;
            end = today;
        } else if (preset === 'all_time') {
            start = '2020-01-01';
            end = today;
        }

        $wrapper.find('#stmt-start-date').val(start);
        $wrapper.find('#stmt-end-date').val(end);

        if ($wrapper.find('#stmt-customer-select').val()) {
            window.load_customer_statement();
        }
    });

    // Set Default Statement Dates if empty
    if (!$wrapper.find('#stmt-start-date').val()) {
        let now = new Date();
        let y = now.getFullYear();
        let m = String(now.getMonth() + 1).padStart(2, '0');
        $wrapper.find('#stmt-start-date').val(`${y}-${m}-01`);
    }
    if (!$wrapper.find('#stmt-end-date').val()) {
        $wrapper.find('#stmt-end-date').val(frappe.datetime.get_today());
    }

    // 4. Aging View Controls
    if (!$wrapper.find('#aging-as-of-date').val()) {
        $wrapper.find('#aging-as-of-date').val(frappe.datetime.get_today());
    }

    $wrapper.on('change', '#aging-as-of-date', function() {
        window.load_debtors_aging();
    });

    $wrapper.on('input', '#aging-search-input', function() {
        window.DEBTORS_STATE.aging_search = $(this).val().toLowerCase().trim();
        window.render_debtors_aging();
    });

    $wrapper.on('click', '.aging-risk-filter', function(e) {
        e.preventDefault();
        $wrapper.find('.aging-risk-filter').removeClass('active').css({ 'background': 'transparent', 'color': '#64748b', 'font-weight': '500' });
        $(this).addClass('active').css({ 'background': '#ffffff', 'color': '#1e293b', 'font-weight': '600' });
        window.DEBTORS_STATE.aging_filter = $(this).attr('data-filter') || 'all';
        window.render_debtors_aging();
    });

    // Auto-load Debtors list initially
    window.load_debtors_data();
};

window.switch_debtors_subview = function(subview) {
    subview = subview || 'balances';
    window.DEBTORS_STATE.active_subview = subview;
    const $w = $(window.DEBTORS_STATE.wrapper || document);

    // Segmented buttons
    $w.find('#debtors-segmented-control .seg-btn').removeClass('active');
    $w.find('#debtors-segmented-control .seg-btn[data-view="' + subview + '"]').addClass('active');

    // Panes
    $w.find('#tab-debtors .view-pane').removeClass('active');
    $w.find('#debtors-' + subview + '-view').addClass('active');

    // Sidebar highlight
    $w.find('#nav-debtors-balances, #nav-debtors-statement, #nav-debtors-aging').removeClass('active').css({ 'background': '', 'color': '' });
    $w.find('#nav-debtors-' + subview).addClass('active');

    if (subview === 'balances') {
        if (!window.DEBTORS_STATE.debtors || window.DEBTORS_STATE.debtors.length === 0) {
            window.load_debtors_data();
        } else {
            window.render_debtors_balances();
        }
    } else if (subview === 'statement') {
        window.populate_debtor_dropdown();
        let selectedCust = $w.find('#stmt-customer-select').val();
        if (selectedCust) {
            window.load_customer_statement();
        } else {
            window.update_statement_customer_card();
        }
    } else if (subview === 'aging') {
        if (!window.DEBTORS_STATE.aging_data) {
            window.load_debtors_aging();
        } else {
            window.render_debtors_aging();
        }
    }
};

window.populate_debtor_dropdown = function() {
    const $w = $(window.DEBTORS_STATE.wrapper || document);
    const $select = $w.find('#stmt-customer-select');
    let currentVal = $select.val() || window.DEBTORS_STATE.selected_customer_id;

    let options = '<option value="">Select Customer...</option>';
    let list = (window.DEBTORS_STATE.debtors || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    
    list.forEach(d => {
        let label = d.name;
        if (d.fleet_id && d.fleet_id !== 'N/A' && d.fleet_id !== d.id) {
            label += ` (${d.fleet_id})`;
        } else if (d.id) {
            label += ` (${d.id})`;
        }
        let sel = (d.id === currentVal) ? 'selected' : '';
        options += `<option value="${escape_debtor_html(d.id)}" ${sel}>${escape_debtor_html(label)}</option>`;
    });

    $select.html(options);
    if (currentVal) {
        $select.val(currentVal);
    }
};

window.update_statement_customer_card = function() {
    const $w = $(window.DEBTORS_STATE.wrapper || document);
    let custId = $w.find('#stmt-customer-select').val() || window.DEBTORS_STATE.selected_customer_id;
    let cust = (window.DEBTORS_STATE.debtors || []).find(d => d.id === custId);

    if (cust) {
        $w.find('#stmt-cust-name').text(cust.name);
        $w.find('#stmt-cust-id').text(cust.fleet_id || cust.id || '--');
        $w.find('#stmt-cust-limit').text(format_kes(cust.credit_limit));
    } else {
        $w.find('#stmt-cust-name').text('Select a customer above');
        $w.find('#stmt-cust-id').text('--');
        $w.find('#stmt-cust-limit').text('KES 0.00');
    }
};

window.view_customer_statement = function(customerId) {
    window.DEBTORS_STATE.selected_customer_id = customerId;
    const $w = $(window.DEBTORS_STATE.wrapper || document);
    $w.find('#stmt-customer-select').val(customerId);
    window.switch_debtors_subview('statement');
    window.update_statement_customer_card();
    window.load_customer_statement();
};

/* --- 1. BALANCES LOGIC --- */

window.load_debtors_data = function(callback) {
    const $w = $(window.DEBTORS_STATE.wrapper || document);
    $w.find('#debtors-balances-body').html(`
        <tr>
            <td colspan="9" style="padding: 2.5rem; text-align: center; color: #64748b;">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                    <div style="width: 24px; height: 24px; border: 3px solid #cbd5e1; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                    <span>Loading debtors balances...</span>
                </div>
            </td>
        </tr>
    `);

    frappe.call({
        method: "fuel_management.fuel_management.page.shift_operation_spa.shift_operation_spa.get_debtors_data",
        callback: function(r) {
            let data = r.message || [];
            window.DEBTORS_STATE.debtors = data;
            window.populate_debtor_dropdown();
            window.render_debtors_balances();
            if (typeof callback === 'function') callback();
        },
        error: function(err) {
            console.error("Failed to load debtors:", err);
            $w.find('#debtors-balances-body').html(`
                <tr>
                    <td colspan="9" style="padding: 2rem; text-align: center; color: #ef4444;">
                        Failed to load debtors data. Please check connection and retry.
                    </td>
                </tr>
            `);
        }
    });
};

window.render_debtors_balances = function() {
    const $w = $(window.DEBTORS_STATE.wrapper || document);
    let all = window.DEBTORS_STATE.debtors || [];

    // 1. Calculate Grand Total KPIs
    let grandReceivables = 0;
    let grandOverdue = 0;
    let overdueCount = 0;
    let grandInvoiced = 0;
    let grandPaid = 0;

    all.forEach(d => {
        let bal = Number(d.balance || 0);
        let inv = Number(d.total_invoiced || 0);
        let pd = Number(d.total_paid || 0);
        grandReceivables += bal;
        grandInvoiced += inv;
        grandPaid += pd;
        if (d.status === 'Overdue' || d.status === 'Near Limit') {
            grandOverdue += (bal > 0 ? bal : 0);
            overdueCount++;
        }
    });

    $w.find('#db-kpi-total-receivables').text(format_kes(grandReceivables));
    $w.find('#db-kpi-overdue').text(format_kes(grandOverdue));
    $w.find('#db-kpi-overdue-count').text(`${overdueCount} At Risk Account${overdueCount === 1 ? '' : 's'}`);
    $w.find('#db-kpi-invoiced').text(format_kes(grandInvoiced));
    $w.find('#db-kpi-paid').text(format_kes(grandPaid));
    $w.find('#db-kpi-customers-count').text(`${all.length} Debtors Registered`);

    // 2. Filter list
    let search = (window.DEBTORS_STATE.balances_search || '').toLowerCase();
    let filter = window.DEBTORS_STATE.balances_filter || 'all';

    let filtered = all.filter(d => {
        let nameMatch = (d.name || '').toLowerCase().includes(search) ||
                        (d.fleet_id || '').toLowerCase().includes(search) ||
                        (d.id || '').toLowerCase().includes(search);
        if (!nameMatch) return false;

        let bal = Number(d.balance || 0);
        if (filter === 'outstanding') return bal > 0.01;
        if (filter === 'overdue') return d.status === 'Overdue' || d.status === 'Near Limit';
        if (filter === 'settled') return bal <= 0.01;
        return true;
    });

    // 3. Sort list
    let sortKey = window.DEBTORS_STATE.balances_sort || 'balance_desc';
    filtered.sort((a, b) => {
        if (sortKey === 'balance_desc') return (b.balance || 0) - (a.balance || 0);
        if (sortKey === 'invoiced_desc') return (b.total_invoiced || 0) - (a.total_invoiced || 0);
        if (sortKey === 'paid_desc') return (b.total_paid || 0) - (a.total_paid || 0);
        if (sortKey === 'name_asc') return (a.name || '').localeCompare(b.name || '');
        return 0;
    });

    // 4. Render Table
    if (filtered.length === 0) {
        $w.find('#debtors-balances-body').html(`
            <tr>
                <td colspan="9" style="padding: 2.5rem; text-align: center; color: #64748b;">
                    No debtor records found matching your filter criteria.
                </td>
            </tr>
        `);
        $w.find('#db-foot-invoiced').text('KES 0.00');
        $w.find('#db-foot-paid').text('KES 0.00');
        $w.find('#db-foot-balance').text('KES 0.00');
        return;
    }

    let rowsHtml = '';
    let totInvoiced = 0;
    let totPaid = 0;
    let totBalance = 0;

    filtered.forEach((d, idx) => {
        let inv = Number(d.total_invoiced || 0);
        let pd = Number(d.total_paid || 0);
        let bal = Number(d.balance || 0);
        totInvoiced += inv;
        totPaid += pd;
        totBalance += bal;

        let statusBadge = '';
        if (d.status === 'Overdue') {
            statusBadge = `<span style="background: #fee2e2; color: #991b1b; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; border: 1px solid #fecaca; white-space: nowrap;">⚠️ OVERDUE</span>`;
        } else if (d.status === 'Near Limit') {
            statusBadge = `<span style="background: #fef3c7; color: #92400e; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; border: 1px solid #fde68a; white-space: nowrap;">⚡ NEAR LIMIT</span>`;
        } else if (bal <= 0) {
            statusBadge = `<span style="background: #f1f5f9; color: #475569; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; border: 1px solid #e2e8f0; white-space: nowrap;">✓ SETTLED</span>`;
        } else {
            statusBadge = `<span style="background: #dcfce7; color: #166534; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; border: 1px solid #bbf7d0; white-space: nowrap;">✓ ACTIVE</span>`;
        }

        let balColor = bal > 0 ? '#0f172a' : (bal < 0 ? '#16a34a' : '#64748b');

        rowsHtml += `
            <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <td style="padding: 5px 8px; text-align: center; color: #94a3b8; font-size: 0.75rem; vertical-align: middle;">${idx + 1}</td>
                <td style="padding: 5px 8px; vertical-align: middle;">
                    <div style="font-weight: 700; color: #0f172a; font-size: 0.82rem; line-height: 1.2;">${escape_debtor_html(d.name)}</div>
                    <div style="font-size: 0.7rem; color: #64748b; line-height: 1.2; margin-top: 1px;">
                        <span>Fleet ID: <b>${escape_debtor_html(d.fleet_id || d.id || 'N/A')}</b></span>
                        ${d.phone && d.phone !== 'N/A' ? `<span style="margin-left: 4px; color: #94a3b8;">• ${escape_debtor_html(d.phone)}</span>` : ''}
                    </div>
                </td>
                <td style="padding: 5px 8px; text-align: right; font-family: monospace; color: #64748b; font-size: 0.78rem; vertical-align: middle;">${format_num_only(d.credit_limit)}</td>
                <td style="padding: 5px 8px; text-align: right; font-family: monospace; color: #1e293b; font-size: 0.78rem; vertical-align: middle;">${format_num_only(inv)}</td>
                <td style="padding: 5px 8px; text-align: right; font-family: monospace; color: #16a34a; font-size: 0.78rem; font-weight: 600; vertical-align: middle;">${format_num_only(pd)}</td>
                <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-size: 0.84rem; font-weight: 800; color: ${balColor}; vertical-align: middle;">${format_num_only(bal)}</td>
                <td style="padding: 5px 8px; text-align: center; font-size: 0.72rem; color: #64748b; white-space: nowrap; vertical-align: middle;">${d.last_payment_date ? frappe.datetime.str_to_user(d.last_payment_date) : '--'}</td>
                <td style="padding: 5px 8px; text-align: center; vertical-align: middle;">${statusBadge}</td>
                <td style="padding: 5px 8px; text-align: center; vertical-align: middle;">
                    <button type="button" class="btn btn-xs" onclick="window.view_customer_statement('${escape_debtor_html(d.id)}')" style="padding: 2px 7px; font-size: 0.72rem; font-weight: 600; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff; color: #1e293b; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                        <span>📜 Statement</span>
                    </button>
                </td>
            </tr>
        `;
    });

    $w.find('#debtors-balances-body').html(rowsHtml);
    $w.find('#db-foot-invoiced').text(format_kes(totInvoiced));
    $w.find('#db-foot-paid').text(format_kes(totPaid));
    $w.find('#db-foot-balance').text(format_kes(totBalance));
};

/* --- 2. STATEMENT LOGIC --- */

window.load_customer_statement = function() {
    const $w = $(window.DEBTORS_STATE.wrapper || document);
    let customerId = $w.find('#stmt-customer-select').val() || window.DEBTORS_STATE.selected_customer_id;
    let startDate = $w.find('#stmt-start-date').val();
    let endDate = $w.find('#stmt-end-date').val();

    if (!customerId) {
        frappe.show_alert({ message: "Please select a customer to generate statement", indicator: "orange" });
        return;
    }

    $w.find('#btn-load-statement .spinner').removeClass('hidden');
    $w.find('#debtors-statement-body').html(`
        <tr>
            <td colspan="7" style="padding: 2rem; text-align: center; color: #64748b;">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                    <div style="width: 22px; height: 22px; border: 2.5px solid #cbd5e1; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                    <span style="font-size: 0.82rem;">Loading customer transaction statement...</span>
                </div>
            </td>
        </tr>
    `);

    frappe.call({
        method: "fuel_management.fuel_management.page.shift_operation_spa.shift_operation_spa.get_detailed_customer_statement",
        args: {
            customer: customerId,
            customer_id: customerId,
            start_date: startDate,
            end_date: endDate
        },
        callback: function(r) {
            $w.find('#btn-load-statement .spinner').addClass('hidden');
            let data = r.message;
            window.DEBTORS_STATE.statement_data = data;
            window.render_customer_statement(data);
        },
        error: function(err) {
            $w.find('#btn-load-statement .spinner').addClass('hidden');
            console.error("Failed to load customer statement:", err);
            $w.find('#debtors-statement-body').html(`
                <tr>
                    <td colspan="7" style="padding: 1.5rem; text-align: center; color: #ef4444; font-size: 0.82rem;">
                        Error loading statement. Please check connection and retry.
                    </td>
                </tr>
            `);
        }
    });
};

window.render_customer_statement = function(data) {
    const $w = $(window.DEBTORS_STATE.wrapper || document);
    if (!data) return;

    let cust = data.customer || {};
    $w.find('#stmt-cust-name').text(cust.name || 'Unknown Customer');
    $w.find('#stmt-cust-id').text(cust.fleet_id || cust.id || '--');
    $w.find('#stmt-cust-limit').text(format_kes(cust.credit_limit));

    let openBal = Number(data.opening_balance || 0);
    let periodInvoices = Number(data.period_invoices != null ? data.period_invoices : (data.period_debits || 0));
    let periodPayments = Number(data.period_payments != null ? data.period_payments : (data.period_credits || 0));
    let clBal = Number(data.closing_balance != null ? data.closing_balance : (openBal + periodInvoices - periodPayments));

    // Update KPI summary cards
    $w.find('#stmt-kpi-opening').text(format_kes(openBal));
    $w.find('#stmt-kpi-invoices').text(format_kes(periodInvoices));
    $w.find('#stmt-kpi-payments').text(format_kes(periodPayments));
    $w.find('#stmt-kpi-closing').text(format_kes(clBal));

    let txns = data.transactions || [];
    let rowsHtml = '';

    // 1. Opening Balance Row
    rowsHtml += `
        <tr style="background: #f8fafc; font-weight: 700; border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 5px 8px; color: #475569; white-space: nowrap; font-size: 0.75rem; vertical-align: middle;">${data.start_date ? frappe.datetime.str_to_user(data.start_date) : '--'}</td>
            <td style="padding: 5px 8px; vertical-align: middle;">
                <span style="background: #e2e8f0; color: #334155; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 3px; text-transform: uppercase;">OPENING B/F</span>
            </td>
            <td style="padding: 5px 8px; font-family: monospace; color: #64748b; font-size: 0.75rem; vertical-align: middle;">--</td>
            <td style="padding: 5px 8px; color: #334155; font-size: 0.78rem; font-style: italic; vertical-align: middle;">Balance brought forward from prior period</td>
            <td style="padding: 5px 8px; text-align: right; font-family: monospace; color: #94a3b8; font-size: 0.78rem; vertical-align: middle;">--</td>
            <td style="padding: 5px 8px; text-align: right; font-family: monospace; color: #94a3b8; font-size: 0.78rem; vertical-align: middle;">--</td>
            <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-size: 0.84rem; font-weight: 800; color: #0f172a; vertical-align: middle;">${format_num_only(openBal)}</td>
        </tr>
    `;

    // 2. Transaction Rows
    if (txns.length === 0) {
        rowsHtml += `
            <tr>
                <td colspan="7" style="padding: 1.25rem; text-align: center; color: #64748b; font-style: italic; font-size: 0.82rem; background: #ffffff;">
                    No new invoices or payments recorded during this period (${frappe.datetime.str_to_user(data.start_date)} to ${frappe.datetime.str_to_user(data.end_date)}).
                </td>
            </tr>
        `;
    } else {
        txns.forEach(t => {
            let debit = Number(t.debit || 0);
            let credit = Number(t.credit || 0);
            let bal = Number(t.running_balance != null ? t.running_balance : (t.balance != null ? t.balance : 0));

            let badgeHtml = '';
            let refHtml = '';
            let detailsHtml = '';

            let isInvoice = (t.voucher_type === 'Shift Invoice' || t.ref_type === 'Shift Invoice');
            let isPayment = (t.voucher_type === 'Customer Payment' || t.ref_type === 'Customer Payment');

            if (isInvoice) {
                badgeHtml = `<span style="background: #e0e7ff; color: #3730a3; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 3px; border: 1px solid #c7d2fe; white-space: nowrap;">⛽ INVOICE</span>`;
                
                let refDisplay = t.entry_number ? `#${escape_debtor_html(t.entry_number)}` : escape_debtor_html(t.reference_no || t.reference || '--');
                let poDisplay = t.purchase_order ? `<div style="font-size: 0.68rem; color: #92400e; font-weight: 600; margin-top: 1px;">PO #${escape_debtor_html(t.purchase_order)}</div>` : '';
                refHtml = `<div style="font-weight: 700; color: #1e293b; font-size: 0.76rem; font-family: monospace;">${refDisplay}</div>${poDisplay}`;

                let parts = [];
                if (t.vehicle_registration) {
                    parts.push(`<span style="background: #f1f5f9; color: #0f172a; font-weight: 700; font-family: monospace; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; border: 1px solid #cbd5e1; display: inline-flex; align-items: center; gap: 3px;">🚗 ${escape_debtor_html(t.vehicle_registration)}</span>`);
                }
                let itemStr = t.item || '';
                let qty = Number(t.quantity || 0);
                let rate = Number(t.rate || 0);
                if (itemStr || qty > 0) {
                    let qtyRate = '';
                    if (qty > 0 && rate > 0) {
                        qtyRate = ` <span style="color: #64748b; font-size: 0.72rem; font-family: monospace; font-weight: 500;">(${qty.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}L @ KES ${rate.toFixed(2)})</span>`;
                    } else if (qty > 0) {
                        qtyRate = ` <span style="color: #64748b; font-size: 0.72rem; font-family: monospace; font-weight: 500;">(${qty.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}L)</span>`;
                    }
                    parts.push(`<span style="font-weight: 600; color: #1e293b; font-size: 0.78rem;">${escape_debtor_html(itemStr || 'Fuel')}${qtyRate}</span>`);
                }
                if (parts.length > 0) {
                    detailsHtml = `<div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">${parts.join('')}</div>`;
                } else {
                    detailsHtml = `<span style="color: #334155; font-size: 0.78rem;">${escape_debtor_html(t.description || '--').replace(/\s*\|\s*/g, ' <span style="color:#cbd5e1;">•</span> ')}</span>`;
                }
            } else if (isPayment) {
                badgeHtml = `<span style="background: #dcfce7; color: #166534; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 3px; border: 1px solid #bbf7d0; white-space: nowrap;">💳 PAYMENT</span>`;
                
                let refDisplay = t.trans_no ? escape_debtor_html(t.trans_no) : escape_debtor_html(t.reference_no || t.reference || '--');
                refHtml = `<div style="font-weight: 700; color: #065f46; font-size: 0.76rem; font-family: monospace;">${refDisplay}</div>`;

                let parts = [];
                let mop = t.mode_of_payment || 'Cash';
                parts.push(`<span style="background: #ecfdf5; color: #065f46; font-weight: 700; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; border: 1px solid #a7f3d0; display: inline-flex; align-items: center; gap: 3px;">💳 ${escape_debtor_html(mop)}</span>`);
                
                let csa_name = t.csa || '';
                if (window.USERS_LIST && t.csa) {
                    let u = window.USERS_LIST.find(x => x.name === t.csa || x.user_id === t.csa);
                    if (u) csa_name = u.employee_name || u.full_name || csa_name;
                }
                if (csa_name) {
                    parts.push(`<span style="color: #64748b; font-size: 0.72rem; font-weight: 500;">Recv by: <b style="color: #334155;">${escape_debtor_html(csa_name)}</b></span>`);
                }
                if (t.memo) {
                    parts.push(`<span style="color: #475569; font-size: 0.72rem; font-style: italic; background: #f8fafc; padding: 1px 6px; border-radius: 3px; border: 1px solid #e2e8f0;">"${escape_debtor_html(t.memo)}"</span>`);
                }
                detailsHtml = `<div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">${parts.join('')}</div>`;
            } else {
                badgeHtml = `<span style="background: #f1f5f9; color: #475569; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 3px; border: 1px solid #e2e8f0; white-space: nowrap;">${escape_debtor_html(t.voucher_type || t.ref_type || 'TXN')}</span>`;
                refHtml = `<div style="font-weight: 600; color: #1e293b; font-size: 0.75rem; font-family: monospace;">${escape_debtor_html(t.reference_no || t.reference || '--')}</div>`;
                detailsHtml = `<span style="color: #334155; font-size: 0.78rem;">${escape_debtor_html(t.description || '--').replace(/\s*\|\s*/g, ' <span style="color:#cbd5e1;">•</span> ')}</span>`;
            }

            rowsHtml += `
                <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 5px 8px; color: #334155; white-space: nowrap; font-size: 0.75rem; vertical-align: middle;">${t.date ? frappe.datetime.str_to_user(t.date) : '--'}</td>
                    <td style="padding: 5px 8px; vertical-align: middle;">${badgeHtml}</td>
                    <td style="padding: 5px 8px; vertical-align: middle;">${refHtml}</td>
                    <td style="padding: 5px 8px; vertical-align: middle;">${detailsHtml}</td>
                    <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-weight: 600; color: #dc2626; font-size: 0.78rem; vertical-align: middle;">${debit > 0 ? format_num_only(debit) : '--'}</td>
                    <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-weight: 600; color: #16a34a; font-size: 0.78rem; vertical-align: middle;">${credit > 0 ? format_num_only(credit) : '--'}</td>
                    <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-size: 0.84rem; font-weight: 800; color: #0f172a; vertical-align: middle;">${format_num_only(bal)}</td>
                </tr>
            `;
        });
    }

    // 3. Closing Balance Row
    rowsHtml += `
        <tr style="background: #eef2ff; font-weight: 800; border-top: 2px solid #cbd5e1;">
            <td style="padding: 6px 8px; color: #1e1b4b; white-space: nowrap; font-size: 0.75rem; vertical-align: middle;">${data.end_date ? frappe.datetime.str_to_user(data.end_date) : '--'}</td>
            <td style="padding: 6px 8px; vertical-align: middle;">
                <span style="background: #3730a3; color: #ffffff; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 3px; text-transform: uppercase;">CLOSING C/F</span>
            </td>
            <td style="padding: 6px 8px; font-family: monospace; color: #64748b; font-size: 0.75rem; vertical-align: middle;">--</td>
            <td style="padding: 6px 8px; color: #1e1b4b; font-size: 0.78rem; text-transform: uppercase; vertical-align: middle;">Total Invoiced / Paid / Net Closing Due</td>
            <td style="padding: 6px 8px; text-align: right; font-family: monospace; font-size: 0.78rem; color: #dc2626; vertical-align: middle;">${format_num_only(periodInvoices)}</td>
            <td style="padding: 6px 8px; text-align: right; font-family: monospace; font-size: 0.78rem; color: #16a34a; vertical-align: middle;">${format_num_only(periodPayments)}</td>
            <td style="padding: 6px 8px; text-align: right; font-family: monospace; font-size: 0.9rem; font-weight: 900; color: #1e1b4b; vertical-align: middle;">${format_num_only(clBal)}</td>
        </tr>
    `;

    $w.find('#debtors-statement-body').html(rowsHtml);
};

/* --- 3. AGING ANALYSIS LOGIC --- */

window.load_debtors_aging = function() {
    const $w = $(window.DEBTORS_STATE.wrapper || document);
    let asOfDate = $w.find('#aging-as-of-date').val() || frappe.datetime.get_today();

    $w.find('#btn-load-aging .spinner').removeClass('hidden');
    $w.find('#debtors-aging-body').html(`
        <tr>
            <td colspan="11" style="padding: 2rem; text-align: center; color: #64748b;">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                    <div style="width: 22px; height: 22px; border: 2.5px solid #cbd5e1; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                    <span style="font-size: 0.82rem;">Analyzing accounts receivable aging categories...</span>
                </div>
            </td>
        </tr>
    `);

    frappe.call({
        method: "fuel_management.fuel_management.page.shift_operation_spa.shift_operation_spa.get_debtors_aging_analysis",
        args: {
            as_of_date: asOfDate
        },
        callback: function(r) {
            $w.find('#btn-load-aging .spinner').addClass('hidden');
            let data = r.message;
            window.DEBTORS_STATE.aging_data = data;
            window.render_debtors_aging();
        },
        error: function(err) {
            $w.find('#btn-load-aging .spinner').addClass('hidden');
            console.error("Failed to load aging analysis:", err);
            $w.find('#debtors-aging-body').html(`
                <tr>
                    <td colspan="11" style="padding: 1.5rem; text-align: center; color: #ef4444; font-size: 0.82rem;">
                        Failed to compute aging analysis. Please retry.
                    </td>
                </tr>
            `);
        }
    });
};

window.render_debtors_aging = function() {
    const $w = $(window.DEBTORS_STATE.wrapper || document);
    let data = window.DEBTORS_STATE.aging_data;
    if (!data) return;

    let totals = data.totals_by_bucket || {};
    let pcts = data.percentages || {};

    // 1. KPI Cards
    $w.find('#aging-kpi-total').text(format_kes(data.total_receivables));
    $w.find('#aging-kpi-0-30').text(format_kes(totals['0-30']));
    $w.find('#aging-kpi-0-30-pct').text(`${pcts['0-30'] || 0}% of Total`);

    $w.find('#aging-kpi-31-60').text(format_kes(totals['31-60']));
    $w.find('#aging-kpi-31-60-pct').text(`${pcts['31-60'] || 0}% of Total`);

    $w.find('#aging-kpi-61-90').text(format_kes(totals['61-90']));
    $w.find('#aging-kpi-61-90-pct').text(`${pcts['61-90'] || 0}% of Total`);

    let criticalSum = Number(totals['91-120'] || 0) + Number(totals['120+'] || 0);
    let criticalPct = (Number(pcts['91-120'] || 0) + Number(pcts['120+'] || 0)).toFixed(1);
    $w.find('#aging-kpi-90-plus').text(format_kes(criticalSum));
    $w.find('#aging-kpi-90-plus-pct').text(`${criticalPct}% of Total`);

    // 2. Filter list
    let search = (window.DEBTORS_STATE.aging_search || '').toLowerCase();
    let filter = window.DEBTORS_STATE.aging_filter || 'all';

    let customers = (data.customers || []).filter(c => {
        let nameMatch = (c.name || '').toLowerCase().includes(search) ||
                        (c.fleet_id || '').toLowerCase().includes(search) ||
                        (c.id || '').toLowerCase().includes(search);
        if (!nameMatch) return false;

        let overdueSum = (c.bucket_31_60 || 0) + (c.bucket_61_90 || 0) + (c.bucket_91_120 || 0) + (c.bucket_120_plus || 0);
        let critSum = (c.bucket_91_120 || 0) + (c.bucket_120_plus || 0);

        if (filter === 'overdue') return overdueSum > 0.01;
        if (filter === 'critical') return critSum > 0.01;
        if (filter === 'current') return (c.bucket_0_30 || 0) >= (c.total_balance || 0) - 0.01 && (c.total_balance || 0) > 0;
        return true;
    });

    if (customers.length === 0) {
        $w.find('#debtors-aging-body').html(`
            <tr>
                <td colspan="11" style="padding: 2rem; text-align: center; color: #64748b; font-size: 0.82rem;">
                    No debtor aging records found matching your filter criteria.
                </td>
            </tr>
        `);
        $w.find('#aging-foot-0-30').text('KES 0.00');
        $w.find('#aging-foot-31-60').text('KES 0.00');
        $w.find('#aging-foot-61-90').text('KES 0.00');
        $w.find('#aging-foot-91-120').text('KES 0.00');
        $w.find('#aging-foot-120-plus').text('KES 0.00');
        $w.find('#aging-foot-total').text('KES 0.00');
        return;
    }

    let rowsHtml = '';
    let f0_30 = 0, f31_60 = 0, f61_90 = 0, f91_120 = 0, f120_plus = 0, fTotal = 0;

    customers.forEach((c, idx) => {
        let b0 = Number(c.bucket_0_30 || 0);
        let b31 = Number(c.bucket_31_60 || 0);
        let b61 = Number(c.bucket_61_90 || 0);
        let b91 = Number(c.bucket_91_120 || 0);
        let b120 = Number(c.bucket_120_plus || 0);
        let bal = Number(c.total_balance || 0);

        f0_30 += b0;
        f31_60 += b31;
        f61_90 += b61;
        f91_120 += b91;
        f120_plus += b120;
        fTotal += bal;

        let riskBadge = '';
        if (b120 > 0) {
            riskBadge = `<span style="background: #7f1d1d; color: #fee2e2; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 4px; border: 1px solid #991b1b; white-space: nowrap;">🚨 120d+</span>`;
        } else if (b91 > 0) {
            riskBadge = `<span style="background: #fee2e2; color: #991b1b; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 4px; border: 1px solid #fecaca; white-space: nowrap;">⚠️ 91-120d</span>`;
        } else if (b61 > 0) {
            riskBadge = `<span style="background: #ffedd5; color: #9a3412; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 4px; border: 1px solid #fed7aa; white-space: nowrap;">⏳ 61-90d</span>`;
        } else if (b31 > 0) {
            riskBadge = `<span style="background: #fef3c7; color: #92400e; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 4px; border: 1px solid #fde68a; white-space: nowrap;">👀 31-60d</span>`;
        } else {
            riskBadge = `<span style="background: #dcfce7; color: #166534; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 4px; border: 1px solid #bbf7d0; white-space: nowrap;">✓ 0-30d</span>`;
        }

        rowsHtml += `
            <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <td style="padding: 5px 8px; text-align: center; color: #94a3b8; font-size: 0.75rem; vertical-align: middle;">${idx + 1}</td>
                <td style="padding: 5px 8px; vertical-align: middle;">
                    <div style="font-weight: 700; color: #0f172a; font-size: 0.82rem; line-height: 1.2;">${escape_debtor_html(c.name)}</div>
                    <div style="font-size: 0.7rem; color: #64748b; line-height: 1.2; margin-top: 1px;">
                        <span>Fleet ID: <b>${escape_debtor_html(c.fleet_id || c.id || 'N/A')}</b></span>
                    </div>
                </td>
                <td style="padding: 5px 8px; text-align: right; font-family: monospace; color: #64748b; font-size: 0.78rem; vertical-align: middle;">${format_num_only(c.credit_limit)}</td>
                <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-size: 0.78rem; color: ${b0 > 0 ? '#16a34a; font-weight: 600;' : '#94a3b8;'} vertical-align: middle;">${b0 > 0 ? format_num_only(b0) : '--'}</td>
                <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-size: 0.78rem; color: ${b31 > 0 ? '#b45309; font-weight: 600;' : '#94a3b8;'} vertical-align: middle;">${b31 > 0 ? format_num_only(b31) : '--'}</td>
                <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-size: 0.78rem; color: ${b61 > 0 ? '#c2410c; font-weight: 600;' : '#94a3b8;'} vertical-align: middle;">${b61 > 0 ? format_num_only(b61) : '--'}</td>
                <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-size: 0.78rem; color: ${b91 > 0 ? '#dc2626; font-weight: 600;' : '#94a3b8;'} vertical-align: middle;">${b91 > 0 ? format_num_only(b91) : '--'}</td>
                <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-size: 0.78rem; color: ${b120 > 0 ? '#7f1d1d; font-weight: 800;' : '#94a3b8;'} vertical-align: middle;">${b120 > 0 ? format_num_only(b120) : '--'}</td>
                <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-size: 0.84rem; font-weight: 800; color: #0f172a; vertical-align: middle;">${format_num_only(bal)}</td>
                <td style="padding: 5px 8px; text-align: center; vertical-align: middle;">${riskBadge}</td>
                <td style="padding: 5px 8px; text-align: center; vertical-align: middle;">
                    <button type="button" class="btn btn-xs" onclick="window.view_customer_statement('${escape_debtor_html(c.id)}')" style="padding: 2px 7px; font-size: 0.72rem; font-weight: 600; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff; color: #1e293b; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                        <span>📜 Statement</span>
                    </button>
                </td>
            </tr>
        `;
    });

    $w.find('#debtors-aging-body').html(rowsHtml);
    $w.find('#aging-foot-0-30').text(format_kes(f0_30));
    $w.find('#aging-foot-31-60').text(format_kes(f31_60));
    $w.find('#aging-foot-61-90').text(format_kes(f61_90));
    $w.find('#aging-foot-91-120').text(format_kes(f91_120));
    $w.find('#aging-foot-120-plus').text(format_kes(f120_plus));
    $w.find('#aging-foot-total').text(format_kes(fTotal));
};

/* --- 4. PRINTING & EXPORTS --- */

window.print_debtors_balances = function() {
    let list = window.DEBTORS_STATE.debtors || [];
    if (list.length === 0) {
        frappe.show_alert({ message: "No debtors data to print", indicator: "orange" });
        return;
    }

    let grandInvoiced = 0, grandPaid = 0, grandBalance = 0;
    let rowsHtml = '';
    list.forEach((d, i) => {
        let inv = Number(d.total_invoiced || 0);
        let pd = Number(d.total_paid || 0);
        let bal = Number(d.balance || 0);
        grandInvoiced += inv;
        grandPaid += pd;
        grandBalance += bal;

        rowsHtml += `
            <tr>
                <td style="text-align: center;">${i + 1}</td>
                <td><b>${escape_debtor_html(d.name)}</b><br><small style="color:#666;">Fleet ID: ${escape_debtor_html(d.fleet_id || d.id || 'N/A')}</small></td>
                <td style="text-align: right;">${format_num_only(d.credit_limit)}</td>
                <td style="text-align: right;">${format_num_only(inv)}</td>
                <td style="text-align: right; color: #166534;">${format_num_only(pd)}</td>
                <td style="text-align: right; font-weight: bold;">${format_num_only(bal)}</td>
                <td style="text-align: center;">${d.last_payment_date ? frappe.datetime.str_to_user(d.last_payment_date) : '--'}</td>
                <td style="text-align: center;">${d.status || 'Active'}</td>
            </tr>
        `;
    });

    let stationName = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) || "RUBIS ENERGY - KILIBET SERVICE STATION";
    let printDate = new Date().toLocaleString();

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Debtors Balances Schedule - ${stationName}</title>
            <style>
                body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 20px; }
                .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 15px; }
                .header h2 { margin: 0; font-size: 18px; color: #0f172a; }
                .header p { margin: 3px 0; color: #555; }
                .kpi-row { display: flex; justify-content: space-between; margin-bottom: 15px; border: 1px solid #ddd; background: #f8fafc; padding: 10px; border-radius: 6px; }
                .kpi-box { text-align: center; flex: 1; }
                .kpi-box .val { font-size: 14px; font-weight: bold; font-family: monospace; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #cbd5e1; padding: 6px 8px; }
                th { background: #f1f5f9; text-transform: uppercase; font-size: 10px; }
                tfoot tr { background: #f8fafc; font-weight: bold; }
                @media print { @page { size: landscape; margin: 15mm; } }
            </style>
        </head>
        <body>
            <div class="header">
                <h2>${stationName}</h2>
                <p><b>ACCOUNTS RECEIVABLE / DEBTORS BALANCES SCHEDULE</b></p>
                <p>Run Date & Time: ${printDate} | Generated By: ${frappe.session.user_fullname || frappe.session.user}</p>
            </div>

            <div class="kpi-row">
                <div class="kpi-box"><div>Total Debtors</div><div class="val">${list.length}</div></div>
                <div class="kpi-box"><div>Total Sales Invoiced</div><div class="val">${format_kes(grandInvoiced)}</div></div>
                <div class="kpi-box"><div>Total Payments Received</div><div class="val" style="color:#16a34a;">${format_kes(grandPaid)}</div></div>
                <div class="kpi-box"><div>Total Outstanding Due</div><div class="val" style="color:#1e1b4b;">${format_kes(grandBalance)}</div></div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 30px;">#</th>
                        <th>Customer Name & Fleet ID</th>
                        <th style="text-align: right;">Credit Limit</th>
                        <th style="text-align: right;">Total Invoiced</th>
                        <th style="text-align: right;">Total Paid</th>
                        <th style="text-align: right;">Current Balance</th>
                        <th style="text-align: center;">Last Payment</th>
                        <th style="text-align: center;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" style="text-align: right;">GRAND TOTALS:</td>
                        <td style="text-align: right; font-family: monospace;">${format_kes(grandInvoiced)}</td>
                        <td style="text-align: right; font-family: monospace; color: #166534;">${format_kes(grandPaid)}</td>
                        <td style="text-align: right; font-family: monospace; font-size: 13px;">${format_kes(grandBalance)}</td>
                        <td colspan="2"></td>
                    </tr>
                </tfoot>
            </table>

            <div style="margin-top: 30px; display: flex; justify-content: space-between;">
                <div>Prepared By: __________________________</div>
                <div>Station Manager: __________________________</div>
                <div>Accounts Stamp: __________________________</div>
            </div>
            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `;

    let w = window.open('', '_blank');
    w.document.open();
    w.document.write(html);
    w.document.close();
};

window.save_debtors_statement_pdf = function() {
    let data = window.DEBTORS_STATE.statement_data;
    if (!data || !data.customer) {
        frappe.show_alert({ message: "Please select a customer and load statement first", indicator: "orange" });
        return;
    }
    let cust_id = data.customer.id || data.customer.name;
    let start_date = data.start_date || '';
    let end_date = data.end_date || '';
    let station = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) || '';
    
    frappe.show_alert({ message: "Generating PDF Statement...", indicator: "blue" });
    
    let url = `/api/method/fuel_management.fuel_management.api.download_debtors_statement_pdf?customer=${encodeURIComponent(cust_id)}&start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}&station=${encodeURIComponent(station)}`;
    
    let link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.download = `Statement_${(data.customer.name || cust_id).replace(/\s+/g, '_')}_${start_date}_${end_date}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.print_debtors_statement = function() {
    let data = window.DEBTORS_STATE.statement_data;
    if (!data) {
        frappe.show_alert({ message: "Please load a statement first before printing", indicator: "orange" });
        return;
    }

    let cust = data.customer || {};
    let txns = data.transactions || [];
    let stationName = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) || "RUBIS ENERGY - KILIBET SERVICE STATION";

    let rowsHtml = '';
    // Opening balance
    rowsHtml += `
        <tr style="background: #f8fafc; font-weight: bold;">
            <td>${frappe.datetime.str_to_user(data.start_date)}</td>
            <td>OPENING B/F</td>
            <td>--</td>
            <td>Balance brought forward from prior periods</td>
            <td style="text-align: right;">--</td>
            <td style="text-align: right;">--</td>
            <td style="text-align: right; font-family: monospace;">${format_num_only(data.opening_balance)}</td>
        </tr>
    `;

    txns.forEach(t => {
        let deb = Number(t.debit || 0);
        let crd = Number(t.credit || 0);
        let bal = Number(t.running_balance != null ? t.running_balance : (t.balance != null ? t.balance : 0));
        
        let refStr = t.entry_number ? `#${t.entry_number}` : (t.trans_no || t.reference_no || '--');
        if (t.purchase_order) refStr += ` (PO: ${t.purchase_order})`;

        let csa_name = t.csa || '';
        if (window.USERS_LIST && t.csa) {
            let u = window.USERS_LIST.find(x => x.name === t.csa || x.user_id === t.csa);
            if (u) csa_name = u.employee_name || u.full_name || csa_name;
        }

        let descStr = t.description || '--';
        if (t.vehicle_registration && t.item) {
            let qtyRate = t.quantity > 0 ? ` (${t.quantity}L @ KES ${Number(t.rate).toFixed(2)})` : '';
            descStr = `[${t.vehicle_registration}] ${t.item}${qtyRate}`;
        } else if (t.mode_of_payment) {
            descStr = `${t.mode_of_payment}${csa_name ? ' - Recv: ' + csa_name : ''}${t.memo ? ' - ' + t.memo : ''}`;
        }

        rowsHtml += `
            <tr>
                <td>${frappe.datetime.str_to_user(t.date)}</td>
                <td>${escape_debtor_html(t.voucher_type || t.ref_type || 'TXN')}</td>
                <td><b>${escape_debtor_html(refStr)}</b></td>
                <td>${escape_debtor_html(descStr)}</td>
                <td style="text-align: right; color: #dc2626; font-family: monospace;">${deb > 0 ? format_num_only(deb) : '--'}</td>
                <td style="text-align: right; color: #166534; font-family: monospace;">${crd > 0 ? format_num_only(crd) : '--'}</td>
                <td style="text-align: right; font-weight: bold; font-family: monospace;">${format_num_only(bal)}</td>
            </tr>
        `;
    });

    // Closing balance
    rowsHtml += `
        <tr style="background: #eef2ff; font-weight: bold; border-top: 2px solid #0f172a;">
            <td>${frappe.datetime.str_to_user(data.end_date)}</td>
            <td>CLOSING C/F</td>
            <td>--</td>
            <td>AMOUNT DUE (CARRIED FORWARD)</td>
            <td style="text-align: right; font-family: monospace; color: #dc2626;">${format_num_only(data.period_invoices)}</td>
            <td style="text-align: right; font-family: monospace; color: #166534;">${format_num_only(data.period_payments)}</td>
            <td style="text-align: right; font-size: 13px; font-family: monospace; color: #1e1b4b;">${format_num_only(data.closing_balance)}</td>
        </tr>
    `;

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Statement of Account - ${escape_debtor_html(cust.name)}</title>
            <style>
                body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 25px; line-height: 1.4; }
                .header-table { width: 100%; border-bottom: 2px solid #1e3a8a; padding-bottom: 12px; margin-bottom: 15px; }
                .brand-title { font-size: 20px; font-weight: 800; color: #1e3a8a; }
                .doc-title { font-size: 16px; font-weight: bold; text-align: right; color: #0f172a; text-transform: uppercase; }
                .info-grid { width: 100%; margin-bottom: 15px; }
                .info-box { border: 1px solid #cbd5e1; padding: 10px; border-radius: 6px; background: #f8fafc; }
                table.ledger { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 10.5px; }
                table.ledger th, table.ledger td { border: 1px solid #cbd5e1; padding: 6px 8px; }
                table.ledger th { background: #f1f5f9; text-transform: uppercase; font-size: 9.5px; }
                .banking-box { margin-top: 20px; border: 1px solid #cbd5e1; padding: 10px; border-radius: 6px; background: #fafafa; font-size: 10px; }
                @media print { @page { size: A4 portrait; margin: 12mm; } }
            </style>
        </head>
        <body>
            <table class="header-table">
                <tr>
                    <td style="vertical-align: top;">
                        <div class="brand-title">${stationName}</div>
                        <div style="font-size: 10px; color: #555; margin-top: 3px;">
                            Accounts Receivable Division<br>
                            Eldoret, Kenya<br>
                            Email: accounts@kilibetcore.co.ke
                        </div>
                    </td>
                    <td style="vertical-align: top; text-align: right;">
                        <div class="doc-title">Statement of Account</div>
                        <div style="font-size: 11px; color: #333; margin-top: 3px;">
                            <b>Period:</b> ${frappe.datetime.str_to_user(data.start_date)} &mdash; ${frappe.datetime.str_to_user(data.end_date)}<br>
                            <b>Date Printed:</b> ${new Date().toLocaleDateString()}
                        </div>
                        <div style="margin-top: 6px; font-size: 13px; font-weight: bold; color: #1e3a8a;">
                            Closing Due: ${format_kes(data.closing_balance)}
                        </div>
                    </td>
                </tr>
            </table>

            <table class="info-grid">
                <tr>
                    <td style="width: 55%; vertical-align: top; padding-right: 10px;">
                        <div class="info-box">
                            <div style="font-size: 9px; font-weight: bold; color: #64748b; text-transform: uppercase;">BILL TO CUSTOMER:</div>
                            <div style="font-size: 14px; font-weight: bold; color: #0f172a; margin: 3px 0;">${escape_debtor_html(cust.name)}</div>
                            <div style="font-size: 10px; color: #475569;">
                                <b>Account / Fleet ID:</b> ${escape_debtor_html(cust.fleet_id || cust.id || 'N/A')}<br>
                                ${cust.address && cust.address !== 'N/A' ? `<b>Address:</b> ${escape_debtor_html(cust.address)}<br>` : ''}
                                ${cust.phone && cust.phone !== 'N/A' ? `<b>Phone:</b> ${escape_debtor_html(cust.phone)}` : ''}
                            </div>
                        </div>
                    </td>
                    <td style="width: 45%; vertical-align: top;">
                        <div class="info-box">
                            <div style="font-size: 9px; font-weight: bold; color: #64748b; text-transform: uppercase;">ACCOUNT SUMMARY:</div>
                            <table style="width: 100%; font-size: 10px; margin-top: 3px;">
                                <tr><td><b>Credit Limit:</b></td><td style="text-align: right; font-family: monospace;">${format_kes(cust.credit_limit)}</td></tr>
                                <tr><td><b>Opening Balance (B/F):</b></td><td style="text-align: right; font-family: monospace;">${format_kes(data.opening_balance)}</td></tr>
                                <tr><td><b>Total Invoices (Period):</b></td><td style="text-align: right; font-family: monospace; color:#dc2626;">+ ${format_kes(data.period_invoices)}</td></tr>
                                <tr><td><b>Total Payments (Period):</b></td><td style="text-align: right; font-family: monospace; color:#166534;">- ${format_kes(data.period_payments)}</td></tr>
                                <tr style="border-top: 1px solid #cbd5e1; font-weight: bold;"><td><b>Total Amount Due:</b></td><td style="text-align: right; font-family: monospace; color:#1e3a8a; font-size: 11px;">${format_kes(data.closing_balance)}</td></tr>
                            </table>
                        </div>
                    </td>
                </tr>
            </table>

            <table class="ledger">
                <thead>
                    <tr>
                        <th style="width: 75px;">Date</th>
                        <th style="width: 95px;">Type</th>
                        <th style="width: 100px;">Reference #</th>
                        <th>Description / Details</th>
                        <th style="text-align: right; width: 85px;">Debit (+)</th>
                        <th style="text-align: right; width: 85px;">Credit (-)</th>
                        <th style="text-align: right; width: 95px;">Balance</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>

            <div class="banking-box">
                <b>PAYMENT REMITTANCE INSTRUCTIONS:</b><br>
                Please make all cheque / direct bank transfers payable to <b>Kilibet Core Ltd</b>.<br>
                <b>Bank:</b> Equity Bank Kenya &nbsp;|&nbsp; <b>Account Name:</b> Kilibet Core Ltd &nbsp;|&nbsp; <b>Payment Terms:</b> 30 Days from invoice date.
            </div>

            <div style="margin-top: 25px; display: flex; justify-content: space-between; font-size: 10px;">
                <div><b>Prepared By:</b> __________________________</div>
                <div><b>Accounts Manager:</b> __________________________</div>
                <div><b>Received By (Debtor):</b> __________________________</div>
            </div>

            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `;

    let w = window.open('', '_blank');
    w.document.open();
    w.document.write(html);
    w.document.close();
};

window.print_aging_report = function() {
    let data = window.DEBTORS_STATE.aging_data;
    if (!data) {
        frappe.show_alert({ message: "Please load aging analysis first", indicator: "orange" });
        return;
    }

    let customers = data.customers || [];
    let totals = data.totals_by_bucket || {};
    let stationName = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) || "RUBIS ENERGY - KILIBET SERVICE STATION";

    let rowsHtml = '';
    customers.forEach((c, i) => {
        rowsHtml += `
            <tr>
                <td style="text-align: center;">${i + 1}</td>
                <td><b>${escape_debtor_html(c.name)}</b><br><small style="color:#666;">Fleet ID: ${escape_debtor_html(c.fleet_id || c.id || 'N/A')}</small></td>
                <td style="text-align: right;">${format_num_only(c.credit_limit)}</td>
                <td style="text-align: right; color:#166534;">${c.bucket_0_30 > 0 ? format_num_only(c.bucket_0_30) : '--'}</td>
                <td style="text-align: right; color:#b45309;">${c.bucket_31_60 > 0 ? format_num_only(c.bucket_31_60) : '--'}</td>
                <td style="text-align: right; color:#c2410c;">${c.bucket_61_90 > 0 ? format_num_only(c.bucket_61_90) : '--'}</td>
                <td style="text-align: right; color:#dc2626;">${c.bucket_91_120 > 0 ? format_num_only(c.bucket_91_120) : '--'}</td>
                <td style="text-align: right; color:#7f1d1d; font-weight: bold;">${c.bucket_120_plus > 0 ? format_num_only(c.bucket_120_plus) : '--'}</td>
                <td style="text-align: right; font-weight: bold;">${format_num_only(c.total_balance)}</td>
                <td style="text-align: center;">${c.risk_status || 'Current'}</td>
            </tr>
        `;
    });

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>AR Aging Analysis Report - ${stationName}</title>
            <style>
                body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 20px; }
                .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 15px; }
                .header h2 { margin: 0; font-size: 18px; color: #0f172a; }
                .header p { margin: 3px 0; color: #555; }
                .kpi-row { display: flex; justify-content: space-between; margin-bottom: 15px; border: 1px solid #ddd; background: #f8fafc; padding: 10px; border-radius: 6px; }
                .kpi-box { text-align: center; flex: 1; }
                .kpi-box .val { font-size: 13px; font-weight: bold; font-family: monospace; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #cbd5e1; padding: 6px 8px; }
                th { background: #f1f5f9; text-transform: uppercase; font-size: 9.5px; }
                tfoot tr { background: #f8fafc; font-weight: bold; }
                @media print { @page { size: landscape; margin: 12mm; } }
            </style>
        </head>
        <body>
            <div class="header">
                <h2>${stationName}</h2>
                <p><b>ACCOUNTS RECEIVABLE (AR) AGING ANALYSIS REPORT</b></p>
                <p><b>As of Date:</b> ${frappe.datetime.str_to_user(data.as_of_date)} &nbsp;|&nbsp; <b>Total Outstanding Receivables:</b> ${format_kes(data.total_receivables)}</p>
            </div>

            <div class="kpi-row">
                <div class="kpi-box"><div>0-30 Days (Current)</div><div class="val" style="color:#16a34a;">${format_kes(totals['0-30'])}</div></div>
                <div class="kpi-box"><div>31-60 Days (Watchlist)</div><div class="val" style="color:#b45309;">${format_kes(totals['31-60'])}</div></div>
                <div class="kpi-box"><div>61-90 Days (Overdue)</div><div class="val" style="color:#c2410c;">${format_kes(totals['61-90'])}</div></div>
                <div class="kpi-box"><div>91-120 Days (Critical)</div><div class="val" style="color:#dc2626;">${format_kes(totals['91-120'])}</div></div>
                <div class="kpi-box"><div>120+ Days (Doubtful)</div><div class="val" style="color:#7f1d1d;">${format_kes(totals['120+'])}</div></div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 25px;">#</th>
                        <th>Customer & Fleet ID</th>
                        <th style="text-align: right;">Credit Limit</th>
                        <th style="text-align: right;">0 - 30 Days</th>
                        <th style="text-align: right;">31 - 60 Days</th>
                        <th style="text-align: right;">61 - 90 Days</th>
                        <th style="text-align: right;">91 - 120 Days</th>
                        <th style="text-align: right;">120+ Days</th>
                        <th style="text-align: right;">Total Balance</th>
                        <th style="text-align: center;">Risk Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" style="text-align: right;">TOTAL RECEIVABLES:</td>
                        <td style="text-align: right; font-family: monospace; color:#16a34a;">${format_kes(totals['0-30'])}</td>
                        <td style="text-align: right; font-family: monospace; color:#b45309;">${format_kes(totals['31-60'])}</td>
                        <td style="text-align: right; font-family: monospace; color:#c2410c;">${format_kes(totals['61-90'])}</td>
                        <td style="text-align: right; font-family: monospace; color:#dc2626;">${format_kes(totals['91-120'])}</td>
                        <td style="text-align: right; font-family: monospace; color:#7f1d1d;">${format_kes(totals['120+'])}</td>
                        <td style="text-align: right; font-family: monospace; font-size: 13px;">${format_kes(data.total_receivables)}</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>

            <div style="margin-top: 30px; display: flex; justify-content: space-between;">
                <div>Credit Controller: __________________________</div>
                <div>Finance Director: __________________________</div>
                <div>Station Stamp: __________________________</div>
            </div>
            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `;

    let w = window.open('', '_blank');
    w.document.open();
    w.document.write(html);
    w.document.close();
};

window.export_debtors_csv = function() {
    let list = window.DEBTORS_STATE.debtors || [];
    if (list.length === 0) {
        frappe.show_alert({ message: "No data to export", indicator: "orange" });
        return;
    }

    let csv = "Customer Name,Fleet ID,Customer ID,Credit Limit,Total Invoiced,Total Paid,Current Balance,Last Payment Date,Status\n";
    list.forEach(d => {
        let name = `"${(d.name || '').replace(/"/g, '""')}"`;
        let fleet = `"${(d.fleet_id || '').replace(/"/g, '""')}"`;
        csv += `${name},${fleet},"${d.id || ''}",${d.credit_limit || 0},${d.total_invoiced || 0},${d.total_paid || 0},${d.balance || 0},"${d.last_payment_date || ''}","${d.status || ''}"\n`;
    });

    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Debtors_Balances_${frappe.datetime.get_today()}.csv`;
    link.click();
};

window.export_statement_csv = function() {
    let data = window.DEBTORS_STATE.statement_data;
    if (!data) {
        frappe.show_alert({ message: "Please load statement before exporting", indicator: "orange" });
        return;
    }

    let cust = data.customer || {};
    let txns = data.transactions || [];

    let csv = `Statement of Account: ${cust.name || ''} (${cust.fleet_id || cust.id || ''})\n`;
    csv += `Period: ${data.start_date} to ${data.end_date}\n\n`;
    csv += "Date,Voucher Type,Reference No,Description,Debit,Credit,Running Balance\n";
    csv += `${data.start_date},Opening Balance,--,Balance brought forward,0,0,${data.opening_balance}\n`;

    txns.forEach(t => {
        let refStr = t.entry_number ? `#${t.entry_number}` : (t.trans_no || t.reference_no || '');
        if (t.purchase_order) refStr += ` (PO: ${t.purchase_order})`;
        let csa_name = t.csa || '';
        if (window.USERS_LIST && t.csa) {
            let u = window.USERS_LIST.find(x => x.name === t.csa || x.user_id === t.csa);
            if (u) csa_name = u.employee_name || u.full_name || csa_name;
        }

        let descStr = t.description || '';
        if (t.vehicle_registration && t.item) {
            let qtyRate = t.quantity > 0 ? ` (${t.quantity}L @ KES ${Number(t.rate).toFixed(2)})` : '';
            descStr = `[${t.vehicle_registration}] ${t.item}${qtyRate}`;
        } else if (t.mode_of_payment) {
            descStr = `${t.mode_of_payment}${csa_name ? ' - Recv: ' + csa_name : ''}${t.memo ? ' - ' + t.memo : ''}`;
        }

        let desc = `"${descStr.replace(/"/g, '""')}"`;
        let ref = `"${refStr.replace(/"/g, '""')}"`;
        let bal = t.running_balance != null ? t.running_balance : (t.balance || 0);
        csv += `${t.date},"${t.voucher_type || t.ref_type || 'TXN'}",${ref},${desc},${t.debit || 0},${t.credit || 0},${bal}\n`;
    });

    csv += `${data.end_date},Closing Balance,--,Total amount due,${data.period_invoices},${data.period_payments},${data.closing_balance}\n`;

    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    let custSlug = (cust.name || 'Debtor').replace(/[^a-zA-Z0-9]/g, '_');
    link.download = `Statement_${custSlug}_${data.start_date}_${data.end_date}.csv`;
    link.click();
};

window.export_aging_csv = function() {
    let data = window.DEBTORS_STATE.aging_data;
    if (!data) {
        frappe.show_alert({ message: "Please load aging analysis before exporting", indicator: "orange" });
        return;
    }

    let customers = data.customers || [];
    let csv = `Accounts Receivable Aging Analysis (As of ${data.as_of_date})\n\n`;
    csv += "Customer Name,Fleet ID,Customer ID,Credit Limit,0-30 Days,31-60 Days,61-90 Days,91-120 Days,120+ Days,Total Balance,Risk Status\n";

    customers.forEach(c => {
        let name = `"${(c.name || '').replace(/"/g, '""')}"`;
        let fleet = `"${(c.fleet_id || '').replace(/"/g, '""')}"`;
        csv += `${name},${fleet},"${c.id || ''}",${c.credit_limit || 0},${c.bucket_0_30 || 0},${c.bucket_31_60 || 0},${c.bucket_61_90 || 0},${c.bucket_91_120 || 0},${c.bucket_120_plus || 0},${c.total_balance || 0},"${c.risk_status || ''}"\n`;
    });

    let totals = data.totals_by_bucket || {};
    csv += `TOTALS,,,,"${totals['0-30'] || 0}","${totals['31-60'] || 0}","${totals['61-90'] || 0}","${totals['91-120'] || 0}","${totals['120+'] || 0}","${data.total_receivables || 0}",\n`;

    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `AR_Aging_Analysis_${data.as_of_date}.csv`;
    link.click();
};

window.CURRENT_VIEWED_SHIFT = window.CURRENT_VIEWED_SHIFT || null;
window.AVAILABLE_SHIFTS = window.AVAILABLE_SHIFTS || [];
window.HOMEPAGE_CACHE = window.HOMEPAGE_CACHE || null;

window.render_homepage_dom = function($wrapper, data, from_date, to_date) {
    if (!data) return;
    let mon = data.monthly || {};
    let kpis = data.kpis || {};
    let fmtNum = (n, dec=0) => Number(n||0).toLocaleString(undefined, {minimumFractionDigits: dec, maximumFractionDigits: dec});
    
    // --- A. Header & Shift Context ---
    let greetingHour = new Date().getHours();
    let timeGreeting = greetingHour < 12 ? "Good morning" : (greetingHour < 17 ? "Good afternoon" : "Good evening");
    let userName = (frappe.session.user_fullname || frappe.session.user || "User").split(' ')[0];
    
    $wrapper.find('#home-greeting').text(`${timeGreeting}, ${userName}`);
    $wrapper.find('#home-station-name').text(data.station || (window.ACTIVE_SHIFT ? window.ACTIVE_SHIFT.station : "RUBIS POA PLACE"));
    
    if (from_date && to_date) {
        $wrapper.find('#home-subtext').text(`Period: ${frappe.datetime.str_to_user(from_date)} to ${frappe.datetime.str_to_user(to_date)}`);
        $wrapper.find('#home-date-station').text(`Date Range Filter`);
        $wrapper.find('#home-live-badge').html(`<div style="width: 7px; height: 7px; background: #2563eb; border-radius: 50%;"></div> Filtered Range`).css({'background': '#dbeafe', 'color': '#1e40af'});
        $wrapper.find('#shift-volume-header').text(`Period Volume Breakdown (${frappe.datetime.str_to_user(from_date)} - ${frappe.datetime.str_to_user(to_date)})`);
    } else if (window.ACTIVE_SHIFT) {
        $wrapper.find('#home-subtext').text(`Active Shift: Started at ${window.ACTIVE_SHIFT.shift_date} ${(window.ACTIVE_SHIFT.creation ? window.ACTIVE_SHIFT.creation.split(' ')[1].substring(0,5) : '')} | Station: ${window.ACTIVE_SHIFT.station}`);
        $wrapper.find('#home-date-station').text(`${frappe.datetime.str_to_user(frappe.datetime.nowdate())} — Active Shift`);
        $wrapper.find('#home-live-badge').html(`<div style="width: 7px; height: 7px; background: #16a34a; border-radius: 50%;"></div> Live Shift`).css({'background': '#dcfce7', 'color': '#166534'});
        $wrapper.find('#shift-volume-header').text(`Active Shift Volume Breakdown`);
    } else if (kpis.context_shift) {
        $wrapper.find('#home-subtext').text(`Showing data for Last Closed Shift: ${kpis.context_shift} (${kpis.context_date})`);
        $wrapper.find('#home-date-station').text(`${frappe.datetime.str_to_user(kpis.context_date)} — Closed Shift`);
        $wrapper.find('#home-live-badge').html(`<div style="width: 7px; height: 7px; background: #64748b; border-radius: 50%;"></div> Closed Shift`).css({'background': '#f1f5f9', 'color': '#475569'});
        $wrapper.find('#shift-volume-header').text(`Last Closed Shift Volume (${kpis.context_shift})`);
    } else {
        $wrapper.find('#home-subtext').text("No active shift data available.");
        $wrapper.find('#home-date-station').text(frappe.datetime.str_to_user(frappe.datetime.nowdate()));
        $wrapper.find('#shift-volume-header').text(`Shift Volume Breakdown`);
    }
    
    // --- B. MONTHLY SALES VOLUME SNAPSHOT (Volumes: Litres & KGs, NOT KSh) ---
    $wrapper.find('#home-month-label').text(data.month_label || "This Month");
    $wrapper.find('#mon-kpi-total-litres').text(fmtNum(Math.round(mon.total_litres || 0), 0));
    $wrapper.find('#mon-kpi-petrol-litres').text(fmtNum(Math.round(mon.petrol_litres || 0), 0));
    $wrapper.find('#mon-kpi-diesel-litres').text(fmtNum(Math.round(mon.diesel_litres || 0), 0));
    $wrapper.find('#mon-kpi-lubes-litres').text(fmtNum(Math.round(mon.lubes_litres || 0), 0));
    $wrapper.find('#mon-kpi-gas-kgs').text(fmtNum(Math.round(mon.gas_kgs || 0), 0));
    $wrapper.find('#mon-kpi-gas-cylinders').text((mon.gas_cylinders || 0) + ' cylinders');
    
    let mTot = mon.total_litres || 1;
    let petrolPct = (( (mon.petrol_litres || 0) / mTot ) * 100).toFixed(1);
    let dieselPct = (( (mon.diesel_litres || 0) / mTot ) * 100).toFixed(1);
    $wrapper.find('#mon-pct-petrol').text(petrolPct + '%');
    $wrapper.find('#mon-pct-diesel').text(dieselPct + '%');
    
    // --- C. Shift / Period Volume Cards ---
    let cards_html = "";
    
    // Fuel breakdown cards
    if (kpis.fuel_breakdown && Object.keys(kpis.fuel_breakdown).length > 0) {
        for (let [product, qty] of Object.entries(kpis.fuel_breakdown)) {
            let isZero = qty === 0;
            let isPetrol = product.toUpperCase().includes("PETROL") || product.toUpperCase().includes("PMS") || product.toUpperCase().includes("SUPER");
            let isDiesel = product.toUpperCase().includes("DIESEL") || product.toUpperCase().includes("AGO");
            let themeColor = isPetrol ? '#16a34a' : (isDiesel ? '#d97706' : '#2563eb');
            let bgBadge = isPetrol ? '#dcfce7' : (isDiesel ? '#fef3c7' : '#dbeafe');
            let badgeColor = isPetrol ? '#15803d' : (isDiesel ? '#b45309' : '#1e40af');
            
            cards_html += `
            <div style="background: white; border-radius: 12px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); border: 1px solid #e2e8f0; width: 220px; display: flex; flex-direction: column; justify-content: space-between;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                    <div style="font-size: 0.75rem; color: #475569; font-weight: 700; text-transform: uppercase;">${product}</div>
                    <span style="background: ${bgBadge}; color: ${badgeColor}; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.68rem; font-weight: 700;">Fuel</span>
                </div>
                <div style="font-size: 1.5rem; font-weight: 800; color: ${isZero ? '#64748b' : themeColor}; margin-bottom: 0.5rem; font-family: 'JetBrains Mono', monospace;">
                    ${fmtNum(qty, 2)} <span style="font-size: 0.9rem; font-weight: 600; color: #94a3b8;">L</span>
                </div>
                <div style="font-size: 0.75rem; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 0.4rem;">
                    ${isZero ? 'No sales this shift' : 'Volume dispensed'}
                </div>
            </div>`;
        }
    } else {
        cards_html += `
        <div style="background: white; border-radius: 12px; padding: 1.25rem; border: 1px solid #e2e8f0; width: 220px;">
            <div style="font-size: 0.75rem; color: #475569; font-weight: 700; text-transform: uppercase; margin-bottom: 0.5rem;">Fuel Volume</div>
            <div style="font-size: 1.5rem; font-weight: 800; color: #64748b; font-family: 'JetBrains Mono', monospace; margin-bottom: 0.5rem;">0.00 L</div>
            <div style="font-size: 0.75rem; color: #94a3b8;">No meter sales yet</div>
        </div>`;
    }
    
    // Lubes card
    let lubesQty = kpis.lubes_qty || 0;
    cards_html += `
    <div style="background: white; border-radius: 12px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); border: 1px solid #e2e8f0; width: 220px; display: flex; flex-direction: column; justify-content: space-between;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
            <div style="font-size: 0.75rem; color: #475569; font-weight: 700; text-transform: uppercase;">Lubes Sold</div>
            <span style="background: #e0e7ff; color: #4338ca; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.68rem; font-weight: 700;">Lubes</span>
        </div>
        <div style="font-size: 1.5rem; font-weight: 800; color: #4f46e5; margin-bottom: 0.5rem; font-family: 'JetBrains Mono', monospace;">
            ${fmtNum(lubesQty, 2)} <span style="font-size: 0.9rem; font-weight: 600; color: #94a3b8;">L</span>
        </div>
        <div style="font-size: 0.75rem; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 0.4rem;">
            ${lubesQty > 0 ? 'Lubricants sold' : 'No lubes sales'}
        </div>
    </div>`;
    
    // Gas card
    let gasQty = kpis.gas_qty || 0;
    let cylCount = kpis.cylinders_sold || 0;
    cards_html += `
    <div style="background: white; border-radius: 12px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); border: 1px solid #e2e8f0; width: 220px; display: flex; flex-direction: column; justify-content: space-between;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
            <div style="font-size: 0.75rem; color: #475569; font-weight: 700; text-transform: uppercase;">LPG Gas Sold</div>
            <span style="background: #ede9fe; color: #6d28d9; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.68rem; font-weight: 700;">Gas</span>
        </div>
        <div style="font-size: 1.5rem; font-weight: 800; color: #7c3aed; margin-bottom: 0.5rem; font-family: 'JetBrains Mono', monospace;">
            ${fmtNum(gasQty, 0)} <span style="font-size: 0.9rem; font-weight: 600; color: #94a3b8;">KG</span>
        </div>
        <div style="font-size: 0.75rem; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 0.4rem;">
            ${cylCount > 0 ? cylCount + ' cylinders sold' : 'No gas sales'}
        </div>
    </div>`;
    
    $wrapper.find('#kpi-cards-container').html(cards_html);
    
    // --- D. Tank Levels Priority Section ---
    let tanksHtml = '';
    if (data.tanks && data.tanks.length > 0) {
        data.tanks.forEach(t => {
            let colorStart = '#16a34a', colorEnd = '#15803d'; // Petrol (green)
            let pUpper = (t.product || '').toUpperCase();
            if(pUpper.includes('DIESEL') || pUpper.includes('AGO')) { 
                colorStart = '#f59e0b'; colorEnd = '#b45309'; 
            } else if(pUpper.includes('KEROSENE') || pUpper.includes('IK')) { 
                colorStart = '#3b82f6'; colorEnd = '#1d4ed8'; 
            }
            
            let statusPill = `<span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700;">Normal</span>`;
            if(t.status === 'Low') statusPill = `<span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700;">Low</span>`;
            if(t.status === 'Variance flagged') statusPill = `<span style="background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700;">Variance Flagged</span>`;
            
            tanksHtml += `
            <div style="width: 175px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 1.25rem 1rem; display: flex; flex-direction: column; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
               <div style="width: 80px; height: 160px; background: #f8fafc; border-radius: 10px; margin-bottom: 1rem; position: relative; border: 2px solid #e2e8f0; overflow: hidden;">
                 <!-- Fill -->
                 <div style="position: absolute; bottom: 0; left: 0; right: 0; height: ${t.percent_full}%; background: linear-gradient(to top, ${colorEnd}, ${colorStart}); transition: height 1s ease-in-out;"></div>
                 <!-- Markings -->
                 <div style="position: absolute; bottom: 25%; left: 0; right: 0; border-bottom: 1px solid rgba(255,255,255,0.35);"></div>
                 <div style="position: absolute; bottom: 50%; left: 0; right: 0; border-bottom: 1px solid rgba(255,255,255,0.35);"></div>
                 <div style="position: absolute; bottom: 75%; left: 0; right: 0; border-bottom: 1px solid rgba(255,255,255,0.35);"></div>
                 <!-- Reorder Threshold -->
                 <div style="position: absolute; bottom: ${t.reorder_threshold || 15}%; left: 0; right: 0; border-bottom: 1px dashed #ef4444;" title="Reorder Threshold"></div>
               </div>
               <div style="font-weight: 700; font-size: 0.875rem; color: #0f172a; text-align: center; margin-bottom: 0.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;" title="${t.name}">${t.name}</div>
               <div style="font-family: 'JetBrains Mono', monospace; font-size: 1.1rem; font-weight: 800; color: #0f172a; margin-bottom: 0.15rem;">
                  ${fmtNum(t.latest_dip, 1)} <span style="font-size: 0.75rem; color: #64748b;">L</span>
               </div>
               <div style="color: #64748b; font-size: 0.72rem; margin-bottom: 0.5rem; font-weight: 500;">${t.percent_full}% of ${fmtNum(t.capacity, 0)}L</div>
               ${statusPill}
            </div>`;
        });
    } else {
        tanksHtml = `<div style="text-align: center; color: #94a3b8; padding: 2rem 0; width: 100%;">No tanks configured for station</div>`;
    }
    $wrapper.find('#home-tank-container').html(tanksHtml);
    $wrapper.find('#home-tank-timestamp').text(`Updated: ${frappe.datetime.now_time()}`);
    
    // --- E. 7-Day Trend Chart ---
    let trend = data.trend || {};
    let trendDates = trend.trend_dates || [];
    let trendPetrol = trend.trend_petrol || [];
    let trendDiesel = trend.trend_diesel || [];
    
    if (trendDates.length > 0 && typeof frappe.Chart !== 'undefined') {
        try {
            $wrapper.find('#home-trend-chart-container').empty();
            new frappe.Chart("#home-trend-chart-container", {
                data: {
                    labels: trendDates.map(d => d.substring(5)), // MM-DD
                    datasets: [
                        { name: "Petrol (L)", values: trendPetrol, chartType: 'line' },
                        { name: "Diesel (L)", values: trendDiesel, chartType: 'line' }
                    ]
                },
                title: "",
                type: 'axis-mixed',
                height: 250,
                colors: ['#16a34a', '#d97706'],
                axisOptions: { xIsSeries: true },
                lineOptions: { regionFill: 1 }
            });
        } catch(e) {
            console.warn("Frappe chart init error:", e);
        }
    } else if (trendDates.length > 0) {
        let maxVal = Math.max(...trendPetrol, ...trendDiesel, 100);
        let barsHtml = `<div style="display: flex; align-items: flex-end; justify-content: space-around; height: 200px; padding-top: 20px;">`;
        trendDates.forEach((dt, idx) => {
            let pVal = trendPetrol[idx] || 0;
            let dVal = trendDiesel[idx] || 0;
            let pH = Math.round((pVal / maxVal) * 160);
            let dH = Math.round((dVal / maxVal) * 160);
            barsHtml += `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                <div style="display: flex; align-items: flex-end; gap: 4px; height: 160px;">
                    <div style="width: 14px; height: ${pH}px; background: #16a34a; border-radius: 3px 3px 0 0;" title="Petrol: ${fmtNum(pVal, 1)}L"></div>
                    <div style="width: 14px; height: ${dH}px; background: #d97706; border-radius: 3px 3px 0 0;" title="Diesel: ${fmtNum(dVal, 1)}L"></div>
                </div>
                <span style="font-size: 0.7rem; color: #64748b; font-family: 'JetBrains Mono', monospace;">${dt.substring(5)}</span>
            </div>`;
        });
        barsHtml += `</div>
        <div style="display: flex; justify-content: center; gap: 1.5rem; font-size: 0.75rem; margin-top: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 0.35rem;"><div style="width: 10px; height: 10px; background: #16a34a; border-radius: 2px;"></div> Petrol (L)</div>
            <div style="display: flex; align-items: center; gap: 0.35rem;"><div style="width: 10px; height: 10px; background: #d97706; border-radius: 2px;"></div> Diesel (L)</div>
        </div>`;
        $wrapper.find('#home-trend-chart-container').html(barsHtml);
    }
    
    // --- F. Fuel Mix Breakdown ---
    let fuelMix = trend.fuel_mix || {};
    let mixHtml = '';
    let mixTotal = Object.values(fuelMix).reduce((a,b) => a+b, 0);
    if (mixTotal === 0) mixTotal = 1;
    
    Object.keys(fuelMix).forEach(k => {
        let val = fuelMix[k] || 0;
        let pct = ((val / mixTotal) * 100).toFixed(1);
        let c = '#64748b';
        if (k === 'Petrol') c = '#16a34a';
        if (k === 'Diesel') c = '#d97706';
        if (k === 'Kerosene') c = '#3b82f6';
        if (k === 'Lubricants') c = '#8b5cf6';
        
        mixHtml += `
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.85rem;">
           <div style="width: 80px; font-weight: 700; color: #1e293b;">${k}</div>
           <div style="flex: 1; margin: 0 1rem; height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden;">
              <div style="width: ${pct}%; height: 100%; background: ${c}; border-radius: 4px; transition: width 0.8s ease-in-out;"></div>
           </div>
           <div style="width: 85px; text-align: right; font-family: 'JetBrains Mono', monospace; color: #0f172a; font-weight: 700;">${fmtNum(val, 1)}L</div>
        </div>`;
    });
    $wrapper.find('#home-fuel-mix-container').html(mixHtml || `<div style="text-align: center; color: #94a3b8; padding: 2rem 0;">No mix data</div>`);
    
    // --- G. Activity Feed ---
    let actHtml = '';
    (data.activity || []).forEach(a => {
        let color = '#3b82f6';
        if (a.type === 'shift') color = '#d97706';
        if (a.type === 'meter') color = '#16a34a';
        if (a.type === 'dip' && Math.abs(a.variance || 0) > 50) color = '#ef4444';
        
        let timeStr = a.time ? (a.time.includes(' ') ? a.time.split(' ')[1].substring(0, 5) : a.time.substring(0, 5)) : '';
        
        actHtml += `
        <div style="display: flex; gap: 0.75rem; align-items: flex-start; padding-bottom: 0.6rem; border-bottom: 1px solid #f1f5f9;">
           <div style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; margin-top: 6px; shrink: 0;"></div>
           <div style="flex: 1;">
              <div style="font-size: 0.825rem; color: #1e293b; font-weight: 500;">${a.msg}</div>
              <div style="font-size: 0.7rem; color: #94a3b8; font-family: 'JetBrains Mono', monospace; margin-top: 0.15rem;">${timeStr}</div>
           </div>
        </div>`;
    });
    $wrapper.find('#home-activity-container').html(actHtml || `<div style="text-align: center; color: #94a3b8; padding: 1.5rem 0; font-size: 0.85rem;">No recent activity</div>`);
};

window.render_homepage = function($wrapper, force_refresh=false) {
    let station = window.ACTIVE_SHIFT ? window.ACTIVE_SHIFT.station : (frappe.defaults.get_user_default("station") || "RUBIS POA PLACE");
    
    // Attach event listeners for date filter
    $wrapper.find('#btn-apply-date-filter').off('click').on('click', function() {
        window.render_homepage($wrapper, true);
    });

    let from_date = $wrapper.find('#home-date-from').val();
    let to_date = $wrapper.find('#home-date-to').val();
    let cacheKey = "fm_hp_cache_" + (station || "default");
    
    // Instant paint from local memory/storage cache (0ms delay)
    if (!force_refresh && !from_date && !to_date && !window.CURRENT_VIEWED_SHIFT) {
        if (window.HOMEPAGE_CACHE && window.HOMEPAGE_CACHE.station === station) {
            window.render_homepage_dom($wrapper, window.HOMEPAGE_CACHE, from_date, to_date);
        } else {
            let cached = localStorage.getItem(cacheKey);
            if (cached) {
                try {
                    let parsed = JSON.parse(cached);
                    window.HOMEPAGE_CACHE = parsed;
                    window.render_homepage_dom($wrapper, parsed, from_date, to_date);
                } catch(e) {}
            }
        }
    }
    
    // Fetch Consolidated Homepage Data in a Single Ultra-Fast Request
    frappe.call({
        method: "fuel_management.fuel_management.api.get_homepage_data",
        args: { 
            station: station, 
            shift_id: window.CURRENT_VIEWED_SHIFT, 
            from_date: from_date, 
            to_date: to_date,
            force_refresh: force_refresh ? 1 : 0
        },
        callback: function(r) {
            if(!r || !r.message) return;
            let data = r.message;
            if (!from_date && !to_date && !window.CURRENT_VIEWED_SHIFT) {
                window.HOMEPAGE_CACHE = data;
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(data));
                } catch(e) {}
            }
            window.render_homepage_dom($wrapper, data, from_date, to_date);
        }
    });
};

// Also set up auto-refresh for homepage every 5 minutes
if (!window.HOME_REFRESH_INTERVAL) {
    window.HOME_REFRESH_INTERVAL = setInterval(() => {
        if ($('.tab-pane.active').attr('id') === 'tab-home') {
            window.render_homepage($('.dashboard-wrapper'));
        }
    }, 5 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// DAY-TO-DAY DAILY SALES BREAKDOWN MODULE
// ---------------------------------------------------------------------------

window.DSB_STATE = {
    data: null,
    focus: 'all',
    search: '',
    month: null,
    from_date: null,
    to_date: null
};

window.open_daily_sales_breakdown = function(preFocus) {
    $('#modal-daily-sales-breakdown').css('display', 'flex');
    if (preFocus) {
        if (preFocus === 'petrol' || preFocus === 'diesel') {
            window.filter_dsb_focus('wetstock');
        } else if (preFocus === 'lubes' || preFocus === 'gas') {
            window.filter_dsb_focus('drystock');
        } else {
            window.filter_dsb_focus('all');
        }
    }
    window.load_daily_sales_breakdown();
};

window.close_daily_sales_breakdown = function() {
    $('#modal-daily-sales-breakdown').hide();
};

window.load_daily_sales_breakdown = function(monthVal, fromDate, toDate) {
    let station = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) || 
                  (window.HOMEPAGE_CACHE && window.HOMEPAGE_CACHE.station) || 
                  "RUBIS POA PLACE";
    
    let args = { station: station };
    if (fromDate && toDate) {
        args.from_date = fromDate;
        args.to_date = toDate;
    } else if (monthVal) {
        let parts = monthVal.split('-');
        args.year = parts[0];
        args.month = parts[1];
    } else {
        let hpFrom = $('#home-date-from').val();
        let hpTo = $('#home-date-to').val();
        if (hpFrom && hpTo) {
            args.from_date = hpFrom;
            args.to_date = hpTo;
        }
    }

    $('#dsb-table-body').html(`
        <tr>
            <td colspan="11" style="padding: 3rem; text-align: center; color: #64748b;">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                    <div style="width: 24px; height: 24px; border: 3px solid #cbd5e1; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                    <span style="font-size: 0.84rem; font-weight: 600;">Loading daily sales breakdown for ${station}...</span>
                </div>
            </td>
        </tr>
    `);

    frappe.call({
        method: "fuel_management.fuel_management.api.get_daily_sales_breakdown",
        args: args,
        callback: function(r) {
            if (r && r.message) {
                window.DSB_STATE.data = r.message;
                window.render_daily_sales_breakdown();
            }
        },
        error: function(err) {
            console.error("Failed to load daily breakdown:", err);
            $('#dsb-table-body').html(`
                <tr>
                    <td colspan="11" style="padding: 2rem; text-align: center; color: #ef4444; font-size: 0.84rem;">
                        Failed to fetch daily breakdown data. Please retry.
                    </td>
                </tr>
            `);
        }
    });
};

window.render_daily_sales_breakdown = function() {
    let data = window.DSB_STATE.data;
    if (!data) return;

    let $modal = $('#modal-daily-sales-breakdown');
    let fmtInt = n => Math.round(Number(n || 0)).toLocaleString();
    let fmtKes = n => 'KES ' + Math.round(Number(n || 0)).toLocaleString();

    // Station badge & Month Label
    $modal.find('#dsb-badge-station').text(data.station || 'Station');
    $modal.find('#dsb-modal-subtitle').text(`Day-to-day audit for ${data.month_label} (${data.active_days_count} active trading days)`);

    // Populate Month Select if not matching
    let months = data.available_months || [];
    let selectHtml = '';
    let selectedYm = data.from_date ? data.from_date.substring(0, 7) : '';
    months.forEach(m => {
        let isSel = (m.value === selectedYm) ? 'selected' : '';
        selectHtml += `<option value="${m.value}" ${isSel}>${m.label}</option>`;
    });
    $modal.find('#dsb-month-select').html(selectHtml);

    // Populate Custom Date inputs
    if (data.from_date) $modal.find('#dsb-date-from').val(data.from_date);
    if (data.to_date) $modal.find('#dsb-date-to').val(data.to_date);

    // KPI Strip
    let totals = data.totals || {};
    $modal.find('#dsb-kpi-fuel-total').text(fmtInt(totals.total_fuel_litres));
    $modal.find('#dsb-kpi-fuel-avg').text(fmtInt(totals.avg_daily_fuel_litres) + ' L/day');

    $modal.find('#dsb-kpi-pms-total').text(fmtInt(totals.pms_litres));
    $modal.find('#dsb-kpi-pms-avg').text(fmtInt(totals.avg_daily_pms_litres) + ' L/day');

    $modal.find('#dsb-kpi-ago-total').text(fmtInt(totals.ago_litres));
    $modal.find('#dsb-kpi-ago-avg').text(fmtInt(totals.avg_daily_ago_litres) + ' L/day');

    $modal.find('#dsb-kpi-lubes-total').text(fmtInt(totals.lubes_litres));
    $modal.find('#dsb-kpi-lubes-avg').text(fmtInt(totals.avg_daily_lubes_litres) + ' L/day');

    $modal.find('#dsb-kpi-gas-total').text(fmtInt(totals.gas_kgs));
    $modal.find('#dsb-kpi-gas-cylinders').text((totals.gas_cylinders || 0) + ' cyls');
    $modal.find('#dsb-kpi-gas-avg').text(fmtInt(totals.avg_daily_gas_kgs) + ' KG/day');

    $modal.find('#dsb-kpi-rev-total').text(fmtKes(totals.total_revenue));
    $modal.find('#dsb-kpi-rev-avg').text(fmtKes(totals.avg_daily_revenue) + '/day');

    // Render Rows
    let days = data.days || [];
    let search = (window.DSB_STATE.search || '').toLowerCase();
    let focus = window.DSB_STATE.focus || 'all';

    let filteredDays = days.filter(d => {
        if (!search) return true;
        return (d.date && d.date.toLowerCase().includes(search)) ||
               (d.day_name && d.day_name.toLowerCase().includes(search)) ||
               (d.formatted_date && d.formatted_date.toLowerCase().includes(search));
    });

    if (filteredDays.length === 0) {
        $modal.find('#dsb-table-body').html(`
            <tr>
                <td colspan="11" style="padding: 2.5rem; text-align: center; color: #64748b;">
                    No daily records found matching "${search}".
                </td>
            </tr>
        `);
        $modal.find('#dsb-table-foot').html('');
        return;
    }

    let maxRev = 0;
    days.forEach(d => { if ((d.total_revenue || 0) > maxRev) maxRev = d.total_revenue; });
    if (maxRev === 0) maxRev = 1;

    let totalMonthRev = totals.total_revenue || 1;
    let rowsHtml = '';

    filteredDays.forEach(d => {
        let isToday = (d.date === frappe.datetime.nowdate());
        let isWeekend = (d.day_name === 'Sunday' || d.day_name === 'Saturday');
        let rowBg = isToday ? '#eff6ff' : (isWeekend ? '#fdf8f6' : '#ffffff');
        let sharePct = Math.min(100, Math.round(((d.total_revenue || 0) / totalMonthRev) * 100 * 10) / 10);
        let isPeak = (d.total_revenue >= maxRev * 0.9 && maxRev > 0);

        let shiftBadge = '';
        if (d.shifts_count > 0) {
            shiftBadge = `<span style="background: #e0e7ff; color: #3730a3; font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1px solid #c7d2fe; white-space: nowrap;">${d.shifts_count} Shift${d.shifts_count === 1 ? '' : 's'}</span>`;
        } else {
            shiftBadge = `<span style="background: #f1f5f9; color: #94a3b8; font-size: 0.7rem; font-weight: 600; padding: 2px 6px; border-radius: 4px;">--</span>`;
        }

        let peakBadge = isPeak ? `<span style="background: #fef3c7; color: #92400e; font-size: 0.65rem; font-weight: 700; padding: 1px 4px; border-radius: 3px; margin-left: 4px;">★ PEAK</span>` : '';

        rowsHtml += `
            <tr style="background: ${rowBg}; border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='${rowBg}'">
                <td style="padding: 6px 10px; font-family: monospace; font-weight: 700; color: #1e293b; white-space: nowrap; vertical-align: middle;">
                    ${d.formatted_date} ${isToday ? `<span style="background: #2563eb; color: #fff; font-size: 0.62rem; font-weight: 800; padding: 1px 4px; border-radius: 3px; margin-left: 3px;">TODAY</span>` : ''}
                </td>
                <td style="padding: 6px 10px; color: ${isWeekend ? '#c2410c' : '#475569'}; font-weight: 600; vertical-align: middle;">
                    ${d.day_name}
                </td>
                <td style="padding: 6px 10px; text-align: center; vertical-align: middle;" title="${(d.shift_templates || []).join(', ')}">
                    ${shiftBadge}
                </td>
                <td class="col-pms" style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: 700; color: #16a34a; vertical-align: middle;">
                    ${d.pms_litres > 0 ? fmtInt(d.pms_litres) : '<span style="color:#cbd5e1;">--</span>'}
                </td>
                <td class="col-ago" style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: 700; color: #d97706; vertical-align: middle;">
                    ${d.ago_litres > 0 ? fmtInt(d.ago_litres) : '<span style="color:#cbd5e1;">--</span>'}
                </td>
                <td class="col-fuel" style="padding: 6px 10px; text-align: right; font-family: monospace; font-size: 0.84rem; font-weight: 800; color: #0284c7; background: rgba(2,132,199,0.03); vertical-align: middle;">
                    ${d.total_fuel_litres > 0 ? fmtInt(d.total_fuel_litres) : '<span style="color:#cbd5e1;">--</span>'}
                </td>
                <td class="col-lubes" style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: 600; color: #4f46e5; vertical-align: middle;">
                    ${d.lubes_litres > 0 ? fmtInt(d.lubes_litres) : '<span style="color:#cbd5e1;">--</span>'}
                </td>
                <td class="col-gas" style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: 600; color: #7c3aed; vertical-align: middle;">
                    ${d.gas_kgs > 0 ? `${fmtInt(d.gas_kgs)} <span style="font-size:0.68rem; color:#94a3b8;">(${d.gas_cylinders}c)</span>` : '<span style="color:#cbd5e1;">--</span>'}
                </td>
                <td class="col-fuel-rev" style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: 600; color: #334155; vertical-align: middle;">
                    ${d.fuel_revenue > 0 ? fmtInt(d.fuel_revenue) : '<span style="color:#cbd5e1;">--</span>'}
                </td>
                <td class="col-tot-rev" style="padding: 6px 10px; text-align: right; font-family: monospace; font-size: 0.84rem; font-weight: 800; color: #0f172a; vertical-align: middle;">
                    ${d.total_revenue > 0 ? fmtInt(d.total_revenue) : '<span style="color:#cbd5e1;">--</span>'} ${peakBadge}
                </td>
                <td style="padding: 6px 10px; vertical-align: middle;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <div style="flex-grow: 1; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                            <div style="height: 100%; width: ${sharePct}%; background: ${isPeak ? '#f59e0b' : '#2563eb'}; border-radius: 3px;"></div>
                        </div>
                        <span style="font-size: 0.68rem; font-weight: 700; color: #64748b; font-family: monospace; min-width: 32px; text-align: right;">${sharePct}%</span>
                    </div>
                </td>
            </tr>
        `;
    });

    $modal.find('#dsb-table-body').html(rowsHtml);

    // Footer Summary (Totals & Averages)
    let footHtml = `
        <tr style="background: #f1f5f9; color: #0f172a; font-size: 0.82rem; border-top: 2px solid #cbd5e1;">
            <td colspan="3" style="padding: 8px 10px; font-weight: 800; text-transform: uppercase;">MONTH TOTAL (${data.active_days_count} Days)</td>
            <td class="col-pms" style="padding: 8px 10px; text-align: right; font-family: monospace; color: #16a34a; font-weight: 800;">${fmtInt(totals.pms_litres)}</td>
            <td class="col-ago" style="padding: 8px 10px; text-align: right; font-family: monospace; color: #d97706; font-weight: 800;">${fmtInt(totals.ago_litres)}</td>
            <td class="col-fuel" style="padding: 8px 10px; text-align: right; font-family: monospace; font-size: 0.9rem; color: #0284c7; font-weight: 900; background: rgba(2,132,199,0.06);">${fmtInt(totals.total_fuel_litres)}</td>
            <td class="col-lubes" style="padding: 8px 10px; text-align: right; font-family: monospace; color: #4f46e5; font-weight: 800;">${fmtInt(totals.lubes_litres)}</td>
            <td class="col-gas" style="padding: 8px 10px; text-align: right; font-family: monospace; color: #7c3aed; font-weight: 800;">${fmtInt(totals.gas_kgs)}</td>
            <td class="col-fuel-rev" style="padding: 8px 10px; text-align: right; font-family: monospace; color: #334155; font-weight: 800;">${fmtInt(totals.fuel_revenue)}</td>
            <td class="col-tot-rev" style="padding: 8px 10px; text-align: right; font-family: monospace; font-size: 0.9rem; color: #0f172a; font-weight: 900;">${fmtInt(totals.total_revenue)}</td>
            <td style="padding: 8px 10px; text-align: center; font-weight: 800; color: #2563eb;">100%</td>
        </tr>
        <tr style="background: #eef2ff; color: #3730a3; font-size: 0.78rem;">
            <td colspan="3" style="padding: 6px 10px; font-weight: 700; text-transform: uppercase;">DAILY AVERAGE (Active Trading)</td>
            <td class="col-pms" style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: 700;">${fmtInt(totals.avg_daily_pms_litres)}</td>
            <td class="col-ago" style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: 700;">${fmtInt(totals.avg_daily_ago_litres)}</td>
            <td class="col-fuel" style="padding: 6px 10px; text-align: right; font-family: monospace; font-size: 0.85rem; font-weight: 800; color: #0284c7;">${fmtInt(totals.avg_daily_fuel_litres)}</td>
            <td class="col-lubes" style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: 700;">${fmtInt(totals.avg_daily_lubes_litres)}</td>
            <td class="col-gas" style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: 700;">${fmtInt(totals.avg_daily_gas_kgs)}</td>
            <td class="col-fuel-rev" style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: 700;">--</td>
            <td class="col-tot-rev" style="padding: 6px 10px; text-align: right; font-family: monospace; font-weight: 800; color: #3730a3;">${fmtInt(totals.avg_daily_revenue)}</td>
            <td style="padding: 6px 10px; text-align: center; color: #64748b;">Daily Avg</td>
        </tr>
    `;
    $modal.find('#dsb-table-foot').html(footHtml);

    // Apply column visibility based on focus
    window.apply_dsb_column_visibility(focus);
};

window.filter_dsb_focus = function(focus) {
    window.DSB_STATE.focus = focus;
    $('.dsb-filter-pill').css({'background': '#f8fafc', 'color': '#475569', 'font-weight': '600'});
    $(`.dsb-filter-pill[data-focus="${focus}"]`).css({'background': '#2563eb', 'color': '#ffffff', 'font-weight': '700'});
    window.apply_dsb_column_visibility(focus);
};

window.apply_dsb_column_visibility = function(focus) {
    let $m = $('#modal-daily-sales-breakdown');
    if (focus === 'wetstock') {
        $m.find('.col-pms, .col-ago, .col-fuel').show();
        $m.find('.col-lubes, .col-gas, .col-fuel-rev, .col-tot-rev').hide();
    } else if (focus === 'drystock') {
        $m.find('.col-lubes, .col-gas').show();
        $m.find('.col-pms, .col-ago, .col-fuel, .col-fuel-rev, .col-tot-rev').hide();
    } else if (focus === 'financials') {
        $m.find('.col-fuel-rev, .col-tot-rev').show();
        $m.find('.col-pms, .col-ago, .col-fuel, .col-lubes, .col-gas').hide();
    } else {
        $m.find('.col-pms, .col-ago, .col-fuel, .col-lubes, .col-gas, .col-fuel-rev, .col-tot-rev').show();
    }
};

window.export_daily_sales_csv = function() {
    let data = window.DSB_STATE.data;
    if (!data) return;

    let csv = `Daily Sales Breakdown: ${data.station} (${data.month_label})\n\n`;
    csv += "Date,Day,Shifts Count,Petrol / PMS (L),Diesel / AGO (L),Total Fuel (L),Lubes (L),LPG Gas (KG),Fuel Revenue (KES),Total Station Revenue (KES)\n";

    (data.days || []).forEach(d => {
        csv += `${d.date},${d.day_name},${d.shifts_count},${d.pms_litres},${d.ago_litres},${d.total_fuel_litres},${d.lubes_litres},${d.gas_kgs},${d.fuel_revenue},${d.total_revenue}\n`;
    });

    let t = data.totals || {};
    csv += `\nTOTAL,,${data.active_days_count} Active Days,${t.pms_litres},${t.ago_litres},${t.total_fuel_litres},${t.lubes_litres},${t.gas_kgs},${t.fuel_revenue},${t.total_revenue}\n`;
    csv += `DAILY AVERAGE,,,${t.avg_daily_pms_litres},${t.avg_daily_ago_litres},${t.avg_daily_fuel_litres},${t.avg_daily_lubes_litres},${t.avg_daily_gas_kgs},,${t.avg_daily_revenue}\n`;

    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Daily_Sales_Breakdown_${(data.month_label || 'Month').replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
    link.click();
};

window.print_daily_sales_breakdown = function() {
    let data = window.DSB_STATE.data;
    if (!data) return;

    let fmtInt = n => Math.round(Number(n || 0)).toLocaleString();
    let fmtKes = n => 'KES ' + Math.round(Number(n || 0)).toLocaleString();
    let totals = data.totals || {};

    let rowsHtml = '';
    (data.days || []).forEach(d => {
        rowsHtml += `
            <tr>
                <td>${d.formatted_date}</td>
                <td>${d.day_name}</td>
                <td style="text-align: center;">${d.shifts_count}</td>
                <td style="text-align: right; font-family: monospace;">${d.pms_litres > 0 ? fmtInt(d.pms_litres) : '--'}</td>
                <td style="text-align: right; font-family: monospace;">${d.ago_litres > 0 ? fmtInt(d.ago_litres) : '--'}</td>
                <td style="text-align: right; font-family: monospace; font-weight: bold;">${d.total_fuel_litres > 0 ? fmtInt(d.total_fuel_litres) : '--'}</td>
                <td style="text-align: right; font-family: monospace;">${d.lubes_litres > 0 ? fmtInt(d.lubes_litres) : '--'}</td>
                <td style="text-align: right; font-family: monospace;">${d.gas_kgs > 0 ? fmtInt(d.gas_kgs) : '--'}</td>
                <td style="text-align: right; font-family: monospace;">${d.fuel_revenue > 0 ? fmtInt(d.fuel_revenue) : '--'}</td>
                <td style="text-align: right; font-family: monospace; font-weight: bold;">${d.total_revenue > 0 ? fmtInt(d.total_revenue) : '--'}</td>
            </tr>
        `;
    });

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Daily Sales Breakdown - ${data.month_label}</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 25px; color: #1e293b; font-size: 11px; }
                .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 15px; }
                .title { font-size: 18px; font-weight: bold; text-transform: uppercase; color: #0f172a; }
                .subtitle { font-size: 12px; color: #475569; margin-top: 3px; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 6px 8px; text-transform: uppercase; font-size: 10px; }
                td { border: 1px solid #e2e8f0; padding: 5px 8px; }
                tfoot tr { font-weight: bold; background: #f8fafc; }
                .kpi-row { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 15px; }
                .kpi-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; flex: 1; text-align: center; }
                .kpi-title { font-size: 9px; text-transform: uppercase; color: #64748b; font-weight: bold; }
                .kpi-val { font-size: 14px; font-weight: bold; font-family: monospace; margin-top: 2px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">${data.station || 'FUEL STATION'}</div>
                <div class="subtitle">Day-to-Day Daily Sales Breakdown — <b>${data.month_label}</b></div>
                <div style="font-size: 10px; color: #94a3b8; margin-top: 3px;">Printed on ${new Date().toLocaleString()}</div>
            </div>

            <div class="kpi-row">
                <div class="kpi-card">
                    <div class="kpi-title">Total Fuel Sold</div>
                    <div class="kpi-val">${fmtInt(totals.total_fuel_litres)} L</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-title">Petrol / PMS</div>
                    <div class="kpi-val">${fmtInt(totals.pms_litres)} L</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-title">Diesel / AGO</div>
                    <div class="kpi-val">${fmtInt(totals.ago_litres)} L</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-title">Lubes Sold</div>
                    <div class="kpi-val">${fmtInt(totals.lubes_litres)} L</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-title">LPG Gas</div>
                    <div class="kpi-val">${fmtInt(totals.gas_kgs)} KG</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-title">Total Revenue</div>
                    <div class="kpi-val">${fmtKes(totals.total_revenue)}</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="text-align: left;">Date</th>
                        <th style="text-align: left;">Day</th>
                        <th style="text-align: center;">Shifts</th>
                        <th style="text-align: right;">PMS (L)</th>
                        <th style="text-align: right;">AGO (L)</th>
                        <th style="text-align: right;">Total Fuel (L)</th>
                        <th style="text-align: right;">Lubes (L)</th>
                        <th style="text-align: right;">LPG (KG)</th>
                        <th style="text-align: right;">Fuel Revenue</th>
                        <th style="text-align: right;">Total Revenue</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
                <tfoot>
                    <tr style="border-top: 2px solid #0f172a; background: #f1f5f9;">
                        <td colspan="3">MONTH TOTAL (${data.active_days_count} Days)</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.pms_litres)}</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.ago_litres)}</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.total_fuel_litres)}</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.lubes_litres)}</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.gas_kgs)}</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.fuel_revenue)}</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.total_revenue)}</td>
                    </tr>
                    <tr style="background: #eef2ff;">
                        <td colspan="3">DAILY AVERAGE</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.avg_daily_pms_litres)}</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.avg_daily_ago_litres)}</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.avg_daily_fuel_litres)}</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.avg_daily_lubes_litres)}</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.avg_daily_gas_kgs)}</td>
                        <td style="text-align: right; font-family: monospace;">--</td>
                        <td style="text-align: right; font-family: monospace;">${fmtInt(totals.avg_daily_revenue)}</td>
                    </tr>
                </tfoot>
            </table>

            <div style="margin-top: 40px; display: flex; justify-content: space-between;">
                <div>Prepared By: __________________________</div>
                <div>Station Manager: __________________________</div>
                <div>Audited By: __________________________</div>
            </div>
            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `;

    let w = window.open('', '_blank');
    w.document.open();
    w.document.write(html);
    w.document.close();
};

$(document).on('change', '#dsb-month-select', function() {
    window.load_daily_sales_breakdown($(this).val());
});

$(document).on('click', '#btn-dsb-apply-range', function() {
    let f = $('#dsb-date-from').val();
    let t = $('#dsb-date-to').val();
    if (f && t) {
        window.load_daily_sales_breakdown(null, f, t);
    }
});

$(document).on('input', '#dsb-search-input', function() {
    window.DSB_STATE.search = $(this).val();
    window.render_daily_sales_breakdown();
});

// ---------------------------------------------------------------------------
// SHORTAGE MANAGEMENT MODULE
// ---------------------------------------------------------------------------

window.toggle_shortage_cash_account = function() {
    // Disabled cash account dropdown display as requested
    $('#shortage-pay-cash-account-wrapper').hide();
};

window.load_shortage_form_data = function() {
    frappe.call({
        method: "fuel_management.fuel_management.api.get_shortage_form_data",
        callback: function(r) {
            if (r.message) {
                // Populate Employees
                let empOptions = '<option value="">Select Staff...</option>';
                r.message.employees.forEach(e => {
                    empOptions += `<option value="${e.name}">${e.employee_name}</option>`;
                });
                $('#shortage-pay-employee').html(empOptions);
                $('#shortage-cor-from').html(empOptions);
                $('#shortage-cor-to').html(empOptions);
                
                // Populate Cash Accounts
                let cashOptions = '<option value="">Select Account...</option>';
                r.message.cash_accounts.forEach(c => {
                    cashOptions += `<option value="${c.name}">${c.account_name} (Bal: ${format_currency(c.current_balance)})</option>`;
                });
                $('#shortage-pay-cash-account').html(cashOptions);
            }
        }
    });
};


window.cancel_shortage_doc = function(doctype, docname) {
    frappe.confirm(`Are you sure you want to cancel this ${doctype}? This will reverse the accounting and ledger entries.`, function() {
        frappe.call({
            method: "frappe.client.cancel",
            args: {
                doctype: doctype,
                name: docname
            },
            callback: function(r) {
                if(!r.exc) {
                    frappe.show_alert({message: "Document Cancelled Successfully", indicator: "green"});
                    window.load_shortage_history();
                    window.load_shortage_balances();
                }
            }
        });
    });
};

window.cancel_shortage_doc = function(doctype, docname) {
    frappe.confirm(`Are you sure you want to cancel this ${doctype}? This will reverse the accounting and ledger entries.`, function() {
        frappe.call({
            method: "frappe.client.cancel",
            args: {
                doctype: doctype,
                name: docname
            },
            callback: function(r) {
                if(!r.exc) {
                    frappe.show_alert({message: "Document Cancelled Successfully", indicator: "green"});
                    window.load_shortage_history();
                    window.load_shortage_balances();
                }
            }
        });
    });
};

window.load_shortage_history = function() {
    $('#shortage-history-body').html('<tr><td colspan="5" class="text-center py-4 text-gray-500">Loading...</td></tr>');
    
    let s = $('#shortage-history-start').val();
    let e = $('#shortage-history-end').val();
    let args = {};
    if (s && e) { args.start_date = s; args.end_date = e; }
    
    frappe.call({
        method: "fuel_management.fuel_management.api.get_recent_shortage_records",
        args: args,
        callback: function(r) {
            let count = r.message ? r.message.length : 0;
            if (!s && !e) {
                $('#shortage-history-subtitle').html(`<span style="color:#64748b; font-size:0.85rem;">(Showing latest 20 entries &bull; Use date filter for more)</span>`);
            } else {
                $('#shortage-history-subtitle').html(`<span style="color:#047857; font-size:0.85rem; font-weight:600;">(Showing ${count} filtered entries)</span>`);
            }
            if (r.message) {
                let html = '';
                if (r.message.length === 0) {
                    html = '<tr><td colspan="5" class="text-center py-4 text-gray-500">No recent activity</td></tr>';
                } else {
                    r.message.forEach(row => {
                        let isPay = row.type === 'Payment';
                        let typeBadge = isPay 
                            ? `<span class="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded border border-blue-200">Payment</span>`
                            : `<span class="bg-orange-100 text-orange-800 text-xs font-medium px-2.5 py-0.5 rounded border border-orange-200">Correction</span>`;
                        let staff = isPay ? row.employee_name : `${row.from_employee_name} -> ${row.to_employee_name}`;
                        
                        let doctype_url = isPay ? 'staff-shortage-payment' : 'staff-shortage-correction';
                        let dt_str = isPay ? 'Staff Shortage Payment' : 'Staff Shortage Correction';
                        
                        let actions = `
                            <div class="flex items-center justify-end gap-2">
                                <a href="/app/${doctype_url}/${row.name}" target="_blank" class="text-blue-600 hover:text-blue-800" title="View / Edit">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </a>
                                <button onclick="window.cancel_shortage_doc('${dt_str}', '${row.name}')" class="text-red-600 hover:text-red-800" title="Delete / Cancel">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                </button>
                            </div>
                        `;
                        
                        html += `
                            <tr class="border-b border-gray-100 hover:bg-gray-50">
                                <td class="px-4 py-3">${frappe.datetime.str_to_user(row.date)}</td>
                                <td class="px-4 py-3">${typeBadge}</td>
                                <td class="px-4 py-3">${staff}</td>
                                <td class="px-4 py-3 text-right font-medium text-gray-900">${format_currency(row.amount)}</td>
                                <td class="px-4 py-3 text-right">${actions}</td>
                            </tr>
                        `;
                    });
                }
                $('#shortage-history-body').html(html);
            }
        }
    });
};

window.submit_shortage_payment = function() {
    let employee = $('#shortage-pay-employee').val();
    let mode = $('#shortage-pay-mode').val();
    let account = $('#shortage-pay-cash-account').val();
    let amount = parseFloat($('#shortage-pay-amount').val());
    let ref = $('#shortage-pay-reference').val();
    let remarks = $('#shortage-pay-remarks').val();
    
    if (!employee) { frappe.msgprint("Please select a staff member"); return; }
    if (!amount || amount <= 0) { frappe.msgprint("Enter a valid amount"); return; }
    
    let shift_ref = window.ACTIVE_SHIFT ? window.ACTIVE_SHIFT.name : null;
    
    let $btn = $('#btn-submit-shortage-pay');
    let original_html = $btn.html();
    $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" style="margin-right: 5px;"></span> Processing...');
    
    frappe.call({
        method: "fuel_management.fuel_management.api.submit_shortage_payment",
        args: {
            employee: employee,
            payment_mode: mode,
            amount: amount,
            date: frappe.datetime.get_today(),
            shift_reference: shift_ref,
            cash_account: account,
            reference_no: ref,
            remarks: remarks
        },
        callback: function(r) {
            $btn.prop('disabled', false).html(original_html);
            if (!r.exc) {
                frappe.show_alert({message: "Payment Recorded Successfully", indicator: "green"});
                $('#shortage-pay-amount').val('');
                $('#shortage-pay-reference').val('');
                $('#shortage-pay-remarks').val('');
                window.load_shortage_history();
            }
        },
        error: function() {
            $btn.prop('disabled', false).html(original_html);
        }
    });
};

window.submit_shortage_correction = function() {
    let from_emp = $('#shortage-cor-from').val();
    let to_emp = $('#shortage-cor-to').val();
    let amount = parseFloat($('#shortage-cor-amount').val());
    let remarks = $('#shortage-cor-remarks').val();
    
    if (!from_emp || !to_emp) { frappe.msgprint("Please select both staff members"); return; }
    if (from_emp === to_emp) { frappe.msgprint("Cannot transfer to the same staff member"); return; }
    if (!amount || amount <= 0) { frappe.msgprint("Enter a valid amount"); return; }
    
    let $btn = $('#btn-submit-shortage-cor');
    let original_html = $btn.html();
    $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" style="margin-right: 5px;"></span> Processing...');
    
    frappe.call({
        method: "fuel_management.fuel_management.api.submit_shortage_correction",
        args: {
            from_employee: from_emp,
            to_employee: to_emp,
            amount: amount,
            date: frappe.datetime.get_today(),
            remarks: remarks
        },
        callback: function(r) {
            $btn.prop('disabled', false).html(original_html);
            if (!r.exc) {
                frappe.show_alert({message: "Correction Recorded Successfully", indicator: "green"});
                $('#shortage-cor-amount').val('');
                $('#shortage-cor-remarks').val('');
                window.load_shortage_history();
            }
        },
        error: function() {
            $btn.prop('disabled', false).html(original_html);
        }
    });
};

// Hook into tab switching to load data
$(document).on('click', '.nav-item[data-target="tab-shortage-mgmt"]', function() {
    window.load_shortage_form_data();
    window.load_shortage_history();
});

$(document).on('click', '.nav-item[data-target="tab-shorts-report"]', function() {
    window.init_shorts_report();
});

function render_shorts_report($wrapper) {
    window.init_shorts_report();
}

window.init_shorts_report = function() {
    // Set default dates if empty (start of current month to today)
    if (!$('#shorts-report-start').val()) {
        let today = new Date();
        let firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        $('#shorts-report-start').val(firstDay.toISOString().split('T')[0]);
        $('#shorts-report-end').val(today.toISOString().split('T')[0]);
    }
    window.setup_shorts_report_events();
    window.load_shortage_balances();
};

window.setup_shorts_report_events = function() {
    if (window._shorts_report_events_initialized) return;
    window._shorts_report_events_initialized = true;

    // Date Preset Pills
    $(document).on('click', '.sr-preset-btn', function() {
        $('.sr-preset-btn').removeClass('active').css({
            background: '#f8fafc',
            color: '#64748b',
            borderColor: '#e2e8f0',
            fontWeight: '500'
        });
        $(this).addClass('active').css({
            background: '#e0e7ff',
            color: '#3730a3',
            borderColor: '#cbd5e1',
            fontWeight: '600'
        });

        let preset = $(this).attr('data-preset');
        let today = new Date();
        let start = '', end = today.toISOString().split('T')[0];

        if (preset === 'this_month') {
            let firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            start = firstDay.toISOString().split('T')[0];
        } else if (preset === 'last_month') {
            let firstDayLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            let lastDayLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
            start = firstDayLastMonth.toISOString().split('T')[0];
            end = lastDayLastMonth.toISOString().split('T')[0];
        } else if (preset === 'this_year') {
            let firstDayYear = new Date(today.getFullYear(), 0, 1);
            start = firstDayYear.toISOString().split('T')[0];
        } else if (preset === 'all_time') {
            start = '2020-01-01';
        }

        $('#shorts-report-start').val(start);
        $('#shorts-report-end').val(end);
        window.load_shortage_balances();
    });

    // Search Box
    $(document).on('input', '#sr-search-input', function() {
        window.render_shortage_table();
    });

    // Status Filter Pills
    $(document).on('click', '.sr-status-filter', function() {
        $('.sr-status-filter').removeClass('active').css({
            background: 'transparent',
            color: '#64748b',
            fontWeight: '500',
            boxShadow: 'none'
        });
        $(this).addClass('active').css({
            background: '#ffffff',
            color: '#1e293b',
            fontWeight: '600',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        });
        window.render_shortage_table();
    });

    // Sorting Dropdown
    $(document).on('change', '#sr-sort-select', function() {
        window.render_shortage_table();
    });
};

window.load_shortage_balances = function() {
    let $btn = $('#btn-filter-shorts');
    $btn.prop('disabled', true);
    $btn.find('.spinner').removeClass('hidden');

    $('#shortage-balances-body').html('<tr><td colspan="9" class="text-center py-6 text-gray-500"><div style="display:inline-block; animation:spin 1s linear infinite; width:18px; height:18px; border:2px solid #cbd5e1; border-top-color:#2563eb; border-radius:50%; vertical-align:middle; margin-right:8px;"></div> Loading staff shortage balances & previous month opening balances...</td></tr>');
    
    let start_date = $('#shorts-report-start').val();
    let end_date = $('#shorts-report-end').val();
    
    frappe.call({
        method: "fuel_management.fuel_management.api.get_csa_shorts_balances",
        args: { start_date: start_date, end_date: end_date },
        callback: function(r) {
            $btn.prop('disabled', false);
            $btn.find('.spinner').addClass('hidden');

            if (r.message) {
                let data = r.message;
                let rows = data.rows || (Array.isArray(data) ? data : []);
                let summary = data.summary || {};

                window.CURRENT_SHORTS_DATA = rows;
                window.CURRENT_SHORTS_SUMMARY = summary;

                // Update KPI Metric Cards
                let totalOpening = summary.total_opening != null ? summary.total_opening : rows.reduce((acc, x) => acc + (x.opening_balance || 0), 0);
                let totalShorts = summary.total_shortage != null ? summary.total_shortage : rows.reduce((acc, x) => acc + (x.period_shortage || x.month_shortage || 0), 0);
                let totalPaid = summary.total_paid != null ? summary.total_paid : rows.reduce((acc, x) => acc + (x.period_paid || x.month_paid || 0), 0);
                let totalClosing = summary.total_closing != null ? summary.total_closing : (totalOpening + totalShorts - totalPaid);
                let activeCount = summary.active_debtors_count != null ? summary.active_debtors_count : rows.filter(x => (x.closing_balance || x.outstanding_balance || 0) > 0.01).length;

                $('#sr-kpi-opening').text('KES ' + Number(totalOpening).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
                $('#sr-kpi-shorts').text('KES ' + Number(totalShorts).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
                $('#sr-kpi-paid').text('KES ' + Number(totalPaid).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
                $('#sr-kpi-closing').text('KES ' + Number(totalClosing).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
                $('#sr-kpi-count').text(`${activeCount} / ${rows.length} Staff`);

                // Subtitle date update
                if (start_date && end_date) {
                    $('#shorts-report-subtitle').text(`Showing previous month opening balances, activity from ${frappe.datetime.str_to_user(start_date)} to ${frappe.datetime.str_to_user(end_date)}, and net closing balances`);
                }

                window.render_shortage_table();
            }
        },
        error: function() {
            $btn.prop('disabled', false);
            $btn.find('.spinner').addClass('hidden');
            $('#shortage-balances-body').html('<tr><td colspan="9" class="text-center py-6 text-red-500 font-semibold">Error loading shortage balances. Please retry.</td></tr>');
        }
    });
};

window.render_shortage_table = function() {
    let rows = window.CURRENT_SHORTS_DATA || [];
    let searchTerm = ($('#sr-search-input').val() || '').trim().toLowerCase();
    let statusFilter = $('.sr-status-filter.active').attr('data-filter') || 'all';
    let sortMode = $('#sr-sort-select').val() || 'balance_desc';

    // 1. Search Filter
    let filtered = rows.filter(r => {
        let name = (r.employee_name || '').toLowerCase();
        let id = (r.employee || '').toLowerCase();
        return name.includes(searchTerm) || id.includes(searchTerm);
    });

    // 2. Status Filter
    if (statusFilter === 'outstanding') {
        filtered = filtered.filter(r => (r.closing_balance || r.outstanding_balance || 0) > 0.01);
    } else if (statusFilter === 'cleared') {
        filtered = filtered.filter(r => Math.abs(r.closing_balance || r.outstanding_balance || 0) <= 0.01);
    }

    // 3. Sorting
    filtered.sort((a, b) => {
        let aBal = a.closing_balance != null ? a.closing_balance : (a.outstanding_balance || 0);
        let bBal = b.closing_balance != null ? b.closing_balance : (b.outstanding_balance || 0);
        let aShort = a.period_shortage != null ? a.period_shortage : (a.month_shortage || 0);
        let bShort = b.period_shortage != null ? b.period_shortage : (b.month_shortage || 0);
        let aPaid = a.period_paid != null ? a.period_paid : (a.month_paid || 0);
        let bPaid = b.period_paid != null ? b.period_paid : (b.month_paid || 0);
        let aOpen = a.opening_balance || 0;
        let bOpen = b.opening_balance || 0;

        if (sortMode === 'balance_desc') return bBal - aBal;
        if (sortMode === 'shorts_desc') return bShort - aShort;
        if (sortMode === 'paid_desc') return bPaid - aPaid;
        if (sortMode === 'opening_desc') return bOpen - aOpen;
        if (sortMode === 'name_asc') return (a.employee_name || a.employee || '').localeCompare(b.employee_name || b.employee || '');
        return 0;
    });

    if (filtered.length === 0) {
        $('#shortage-balances-body').html('<tr><td colspan="9" class="text-center py-8 text-gray-400" style="font-size:0.9rem;">No matching attendant records found for the selected filter.</td></tr>');
        $('#sr-foot-opening').text('KES 0.00');
        $('#sr-foot-shorts').text('KES 0.00');
        $('#sr-foot-paid').text('KES 0.00');
        $('#sr-foot-net').text('KES 0.00');
        $('#sr-foot-closing').text('KES 0.00');
        return;
    }

    let html = '';
    let footOpening = 0, footShorts = 0, footPaid = 0, footNet = 0, footClosing = 0;

    filtered.forEach((row, idx) => {
        let openBal = row.opening_balance || 0;
        let pShort = row.period_shortage != null ? row.period_shortage : (row.month_shortage || 0);
        let pPaid = row.period_paid != null ? row.period_paid : (row.month_paid || 0);
        let pNet = row.period_net != null ? row.period_net : (pShort - pPaid);
        let closeBal = row.closing_balance != null ? row.closing_balance : (row.outstanding_balance || 0);

        footOpening += openBal;
        footShorts += pShort;
        footPaid += pPaid;
        footNet += pNet;
        footClosing += closeBal;

        // Status Badge
        let statusBadge = '';
        if (closeBal > 0.01) {
            statusBadge = `<span style="background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">🔴 Outstanding</span>`;
        } else if (closeBal < -0.01) {
            statusBadge = `<span style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">🔵 Credit</span>`;
        } else {
            statusBadge = `<span style="background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">🟢 Cleared</span>`;
        }

        let netColor = pNet > 0.01 ? '#dc2626' : (pNet < -0.01 ? '#16a34a' : '#64748b');
        let netPrefix = pNet > 0.01 ? '+' : '';
        let empNameEscaped = (row.employee_name || row.employee || '').replace(/'/g, "\\'");

        html += `
            <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s ease;" class="hover-bg-slate-50">
                <td style="padding: 0.75rem; text-align: center; color: #94a3b8; font-size: 0.8rem; font-weight: 600;">${idx + 1}</td>
                <td style="padding: 0.75rem; color: #1e293b; font-weight: 600;">
                    <div style="font-size: 0.88rem; color: #0f172a;">${row.employee_name || row.employee}</div>
                    <div style="font-size: 0.72rem; color: #64748b; font-family: monospace;">${row.employee}</div>
                </td>
                <td style="padding: 0.75rem; text-align: right; color: #334155; font-weight: 700; font-family: monospace; font-size: 0.85rem;">${format_currency(openBal)}</td>
                <td style="padding: 0.75rem; text-align: right; color: ${pShort > 0 ? '#dc2626' : '#94a3b8'}; font-weight: 700; font-family: monospace; font-size: 0.85rem;">${format_currency(pShort)}</td>
                <td style="padding: 0.75rem; text-align: right; color: ${pPaid > 0 ? '#16a34a' : '#94a3b8'}; font-weight: 700; font-family: monospace; font-size: 0.85rem;">${format_currency(pPaid)}</td>
                <td style="padding: 0.75rem; text-align: right; color: ${netColor}; font-weight: 600; font-family: monospace; font-size: 0.85rem;">${netPrefix}${format_currency(pNet)}</td>
                <td style="padding: 0.75rem; text-align: right; font-weight: 800; color: ${closeBal > 0 ? '#0f172a' : (closeBal < 0 ? '#2563eb' : '#059669')}; font-family: monospace; font-size: 0.92rem;">${format_currency(closeBal)}</td>
                <td style="padding: 0.75rem; text-align: center;">${statusBadge}</td>
                <td style="padding: 0.75rem; text-align: center;">
                    <button type="button" class="btn btn-xs" onclick="window.show_shortage_breakdown('${row.employee}', '${empNameEscaped}')" style="padding: 3px 9px; font-size: 0.75rem; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; color: #1e293b; font-weight: 600; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05); display: inline-flex; align-items: center; gap: 3px;">
                        <span>📜 Statement</span>
                    </button>
                </td>
            </tr>
        `;
    });

    $('#shortage-balances-body').html(html);

    // Update Footer Grand Totals
    $('#sr-foot-opening').text('KES ' + Number(footOpening).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
    $('#sr-foot-shorts').text('KES ' + Number(footShorts).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
    $('#sr-foot-paid').text('KES ' + Number(footPaid).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
    let netFootColor = footNet > 0.01 ? '#dc2626' : (footNet < -0.01 ? '#16a34a' : '#475569');
    $('#sr-foot-net').css('color', netFootColor).text((footNet > 0.01 ? '+' : '') + 'KES ' + Number(footNet).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
    $('#sr-foot-closing').text('KES ' + Number(footClosing).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
};

window.show_shortage_breakdown = function(employee_id, employee_name) {
    let start_date = $('#shorts-report-start').val();
    let end_date = $('#shorts-report-end').val();

    $('#breakdown-modal-title').html(`<span>📜 Statement: ${employee_name}</span>`);
    $('#breakdown-modal-subtitle').html(`Employee: <b>${employee_id}</b> &bull; Period: <b>${frappe.datetime.str_to_user(start_date)}</b> to <b>${frappe.datetime.str_to_user(end_date)}</b>`);
    
    $('#breakdown-modal-kpis').html(`
        <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; text-align:center;">
            <div style="font-size:0.68rem; color:#64748b; font-weight:700; text-transform:uppercase;">Opening Balance (B/F)</div>
            <div style="font-size:1rem; font-weight:800; color:#1e293b; font-family:monospace; margin-top:2px;">...</div>
        </div>
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:8px 10px; text-align:center;">
            <div style="font-size:0.68rem; color:#991b1b; font-weight:700; text-transform:uppercase;">Period Shorts</div>
            <div style="font-size:1rem; font-weight:800; color:#dc2626; font-family:monospace; margin-top:2px;">...</div>
        </div>
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:8px 10px; text-align:center;">
            <div style="font-size:0.68rem; color:#166534; font-weight:700; text-transform:uppercase;">Period Paid</div>
            <div style="font-size:1rem; font-weight:800; color:#16a34a; font-family:monospace; margin-top:2px;">...</div>
        </div>
        <div style="background:#eef2ff; border:1px solid #c7d2fe; border-radius:6px; padding:8px 10px; text-align:center;">
            <div style="font-size:0.68rem; color:#3730a3; font-weight:700; text-transform:uppercase;">Closing Balance (C/F)</div>
            <div style="font-size:1rem; font-weight:800; color:#4338ca; font-family:monospace; margin-top:2px;">...</div>
        </div>
    `);

    $('#breakdown-modal-body').html('<div class="text-center py-10 text-gray-500"><div style="display:inline-block; animation:spin 1s linear infinite; width:20px; height:20px; border:2px solid #cbd5e1; border-top-color:#2563eb; border-radius:50%; vertical-align:middle; margin-right:8px;"></div> Loading statement transactions & balances...</div>');
    $('#breakdown-modal').css('display', 'flex');
    
    // Bind close handlers
    $('#breakdown-modal-close').off('click').on('click', function() {
        $('#breakdown-modal').hide();
    });
    $('#breakdown-modal').off('click').on('click', function(e) {
        if (e.target === this) {
            $(this).hide();
        }
    });
    
    frappe.call({
        method: "fuel_management.fuel_management.api.get_csa_shorts_breakdown",
        args: { 
            employee: employee_id,
            start_date: start_date,
            end_date: end_date
        },
        callback: function(r) {
            if (r.message) {
                let d = r.message;
                window.CURRENT_STATEMENT_DATA = d;

                // Update Mini KPIs inside modal
                $('#breakdown-modal-kpis').html(`
                    <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; text-align:center;">
                        <div style="font-size:0.68rem; color:#64748b; font-weight:700; text-transform:uppercase;">Opening Balance (B/F)</div>
                        <div style="font-size:1.05rem; font-weight:800; color:#1e293b; font-family:monospace; margin-top:2px;">KES ${Number(d.opening_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    </div>
                    <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:8px 10px; text-align:center;">
                        <div style="font-size:0.68rem; color:#991b1b; font-weight:700; text-transform:uppercase;">Period Shorts</div>
                        <div style="font-size:1.05rem; font-weight:800; color:#dc2626; font-family:monospace; margin-top:2px;">KES ${Number(d.period_shortage || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    </div>
                    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:8px 10px; text-align:center;">
                        <div style="font-size:0.68rem; color:#166534; font-weight:700; text-transform:uppercase;">Period Paid</div>
                        <div style="font-size:1.05rem; font-weight:800; color:#16a34a; font-family:monospace; margin-top:2px;">KES ${Number(d.period_paid || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    </div>
                    <div style="background:#eef2ff; border:1px solid #c7d2fe; border-radius:6px; padding:8px 10px; text-align:center;">
                        <div style="font-size:0.68rem; color:#3730a3; font-weight:700; text-transform:uppercase;">Closing Balance (C/F)</div>
                        <div style="font-size:1.05rem; font-weight:800; color:#4338ca; font-family:monospace; margin-top:2px;">KES ${Number(d.closing_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    </div>
                `);

                // Bind print button
                $('#btn-print-csa-statement').off('click').on('click', function() {
                    window.print_csa_statement(d);
                });

                // Build Table
                let html = `
                    <table class="w-full text-left border-collapse" style="width: 100%; font-size: 0.82rem;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-transform: uppercase; font-size: 0.72rem; color: #475569; letter-spacing: 0.03em;">
                                <th style="padding: 0.65rem 0.75rem;">Date</th>
                                <th style="padding: 0.65rem 0.75rem;">Type</th>
                                <th style="padding: 0.65rem 0.75rem;">Shift / Ref</th>
                                <th style="padding: 0.65rem 0.75rem;">Reason / Description</th>
                                <th style="padding: 0.65rem 0.75rem; text-align: right; color: #dc2626;">Shortage (+)</th>
                                <th style="padding: 0.65rem 0.75rem; text-align: right; color: #16a34a;">Paid / Credit (-)</th>
                                <th style="padding: 0.65rem 0.75rem; text-align: right; color: #0f172a; font-weight: 800;">Running Bal</th>
                            </tr>
                        </thead>
                        <tbody>
                            <!-- Opening Balance Row -->
                            <tr style="background: #f8fafc; font-weight: 700; border-bottom: 2px solid #e2e8f0;">
                                <td style="padding: 0.7rem 0.75rem; font-family: monospace;">${frappe.datetime.str_to_user(d.start_date)}</td>
                                <td colspan="3" style="padding: 0.7rem 0.75rem; color: #334155;">
                                    <span style="display: inline-flex; align-items: center; gap: 4px;">🏁 <b>OPENING BALANCE</b> (Brought Forward from Previous Month)</span>
                                </td>
                                <td style="padding: 0.7rem 0.75rem; text-align: right; color: #94a3b8;">-</td>
                                <td style="padding: 0.7rem 0.75rem; text-align: right; color: #94a3b8;">-</td>
                                <td style="padding: 0.7rem 0.75rem; text-align: right; font-weight: 800; font-family: monospace; color: #0f172a;">${format_currency(d.opening_balance || 0)}</td>
                            </tr>
                `;

                if (!d.transactions || d.transactions.length === 0) {
                    html += `
                        <tr>
                            <td colspan="7" class="text-center py-6 text-gray-400" style="font-size: 0.85rem;">
                                No transactions recorded for this attendant within the selected date range.
                            </td>
                        </tr>
                    `;
                } else {
                    d.transactions.forEach(row => {
                        let shiftName = row.shift || '-';
                        if (row.shift_date && row.shift_template) {
                            let parts = row.shift_date.split('-');
                            if (parts.length === 3) {
                                let shortDate = `${parts[2]}/${parts[1]}`;
                                shiftName = `(${shortDate}) ${row.shift_template}`;
                            }
                        }

                        let reasonText = row.reason || '-';
                        if (row.shift && shiftName !== row.shift) {
                            reasonText = reasonText.replace(row.shift, shiftName);
                        }

                        let typeBadge = '';
                        if (row.amount > 0) {
                            typeBadge = `<span style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; padding:1px 6px; border-radius:4px; font-size:0.7rem; font-weight:600;">Shortage</span>`;
                        } else {
                            typeBadge = `<span style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; padding:1px 6px; border-radius:4px; font-size:0.7rem; font-weight:600;">Payment</span>`;
                        }

                        html += `
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 0.65rem 0.75rem; font-family: monospace; white-space: nowrap;">${frappe.datetime.str_to_user(row.date)}</td>
                                <td style="padding: 0.65rem 0.75rem;">${typeBadge}</td>
                                <td style="padding: 0.65rem 0.75rem; color: #475569; font-size: 0.78rem;">${shiftName}</td>
                                <td style="padding: 0.65rem 0.75rem; color: #1e293b;">${reasonText}</td>
                                <td style="padding: 0.65rem 0.75rem; text-align: right; color: #dc2626; font-weight: 700; font-family: monospace;">${row.shortage_amount > 0 ? format_currency(row.shortage_amount) : '-'}</td>
                                <td style="padding: 0.65rem 0.75rem; text-align: right; color: #16a34a; font-weight: 700; font-family: monospace;">${row.paid_amount > 0 ? format_currency(row.paid_amount) : '-'}</td>
                                <td style="padding: 0.65rem 0.75rem; text-align: right; font-weight: 800; color: #0f172a; font-family: monospace;">${format_currency(row.running_balance)}</td>
                            </tr>
                        `;
                    });
                }

                // Closing Balance Row
                html += `
                            <!-- Closing Balance Row -->
                            <tr style="background: #eef2ff; font-weight: 800; border-top: 2px solid #c7d2fe;">
                                <td style="padding: 0.75rem; font-family: monospace;">${frappe.datetime.str_to_user(d.end_date)}</td>
                                <td colspan="3" style="padding: 0.75rem; color: #3730a3;">
                                    <span style="display: inline-flex; align-items: center; gap: 4px;">🏁 <b>CLOSING BALANCE</b> (Carried Forward)</span>
                                </td>
                                <td style="padding: 0.75rem; text-align: right; color: #dc2626; font-family: monospace;">${format_currency(d.period_shortage || 0)}</td>
                                <td style="padding: 0.75rem; text-align: right; color: #16a34a; font-family: monospace;">${format_currency(d.period_paid || 0)}</td>
                                <td style="padding: 0.75rem; text-align: right; font-size: 0.95rem; font-weight: 800; font-family: monospace; color: #312e81;">${format_currency(d.closing_balance || 0)}</td>
                            </tr>
                        </tbody>
                    </table>
                `;
                $('#breakdown-modal-body').html(html);
            }
        },
        error: function() {
            $('#breakdown-modal-body').html('<div class="text-center py-8 text-red-500 font-semibold">Error loading CSA statement ledger.</div>');
        }
    });
};

window.print_shorts_report = function() {
    let rows = window.CURRENT_SHORTS_DATA || [];
    let start_date = $('#shorts-report-start').val() || '';
    let end_date = $('#shorts-report-end').val() || '';
    let stationName = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) ? window.ACTIVE_SHIFT.station : (frappe.defaults.get_user_default("station") || "Fuel Station");
    let companyName = frappe.defaults.get_user_default("Company") || "Fuel Management System";

    let totOpen = 0, totShort = 0, totPaid = 0, totClose = 0;
    let tableRowsHtml = '';

    rows.forEach((r, idx) => {
        let op = r.opening_balance || 0;
        let sh = r.period_shortage != null ? r.period_shortage : (r.month_shortage || 0);
        let pd = r.period_paid != null ? r.period_paid : (r.month_paid || 0);
        let cl = r.closing_balance != null ? r.closing_balance : (r.outstanding_balance || 0);
        let net = sh - pd;

        totOpen += op;
        totShort += sh;
        totPaid += pd;
        totClose += cl;

        let statusText = cl > 0.01 ? 'Outstanding' : (cl < -0.01 ? 'Credit' : 'Cleared');

        tableRowsHtml += `
            <tr>
                <td style="text-align: center;">${idx + 1}</td>
                <td><b>${r.employee_name || r.employee}</b><br><small style="color:#666;">${r.employee}</small></td>
                <td style="text-align: right; font-family: monospace;">${Number(op).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                <td style="text-align: right; font-family: monospace; color: #b91c1c;">${Number(sh).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                <td style="text-align: right; font-family: monospace; color: #15803d;">${Number(pd).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                <td style="text-align: right; font-family: monospace;">${(net > 0 ? '+' : '') + Number(net).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                <td style="text-align: right; font-family: monospace; font-weight: bold;">${Number(cl).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                <td style="text-align: center; font-size: 11px;">${statusText}</td>
            </tr>
        `;
    });

    let printHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>CSA Shorts & Liability Report - ${stationName}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 25px; margin: 0; }
                .header { text-align: center; border-bottom: 2px solid #334155; padding-bottom: 12px; margin-bottom: 16px; }
                .title { font-size: 18px; font-weight: 800; text-transform: uppercase; margin: 0; color: #0f172a; }
                .subtitle { font-size: 12px; color: #475569; margin: 4px 0 0 0; }
                .kpi-grid { display: flex; gap: 10px; margin-bottom: 16px; justify-content: space-between; }
                .kpi-box { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; background: #f8fafc; text-align: center; }
                .kpi-label { font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase; }
                .kpi-val { font-size: 14px; font-weight: 800; font-family: monospace; margin-top: 3px; color: #0f172a; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; }
                th { background: #f1f5f9; text-transform: uppercase; font-size: 10px; color: #334155; }
                tfoot tr td { background: #f8fafc; font-weight: bold; }
                .sign-row { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 20px; }
                .sign-box { width: 30%; border-top: 1px dashed #64748b; text-align: center; padding-top: 5px; font-size: 11px; color: #475569; }
                @media print {
                    body { padding: 0; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">${companyName}</div>
                <div style="font-size: 14px; font-weight: 700; color: #1e3a8a; margin-top: 2px;">${stationName}</div>
                <div class="subtitle">STAFF SHORTAGES & LIABILITY RECONCILIATION REPORT</div>
                <div class="subtitle" style="font-weight: 600; margin-top: 3px;">Period: ${frappe.datetime.str_to_user(start_date)} to ${frappe.datetime.str_to_user(end_date)} &bull; Generated on: ${new Date().toLocaleString()}</div>
            </div>

            <div class="kpi-grid">
                <div class="kpi-box">
                    <div class="kpi-label">Opening Balance (B/F)</div>
                    <div class="kpi-val">KES ${Number(totOpen).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                </div>
                <div class="kpi-box">
                    <div class="kpi-label">Period Shorts Incurred</div>
                    <div class="kpi-val" style="color:#b91c1c;">KES ${Number(totShort).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                </div>
                <div class="kpi-box">
                    <div class="kpi-label">Period Paid / Recovered</div>
                    <div class="kpi-val" style="color:#15803d;">KES ${Number(totPaid).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                </div>
                <div class="kpi-box">
                    <div class="kpi-label">Closing Balance (C/F)</div>
                    <div class="kpi-val" style="color:#1e3a8a;">KES ${Number(totClose).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 30px;">#</th>
                        <th>Attendant / CSA</th>
                        <th style="text-align: right;">Opening Bal (KES)</th>
                        <th style="text-align: right;">Period Shorts (KES)</th>
                        <th style="text-align: right;">Period Paid (KES)</th>
                        <th style="text-align: right;">Net Change (KES)</th>
                        <th style="text-align: right;">Closing Bal (KES)</th>
                        <th style="text-align: center;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHtml}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="2" style="text-align: right; text-transform: uppercase;">GRAND TOTALS:</td>
                        <td style="text-align: right; font-family: monospace;">KES ${Number(totOpen).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                        <td style="text-align: right; font-family: monospace; color:#b91c1c;">KES ${Number(totShort).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                        <td style="text-align: right; font-family: monospace; color:#15803d;">KES ${Number(totPaid).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                        <td style="text-align: right; font-family: monospace;">${(totShort - totPaid > 0 ? '+' : '')}KES ${Number(totShort - totPaid).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                        <td style="text-align: right; font-family: monospace; font-size: 12px; color:#0f172a;">KES ${Number(totClose).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>

            <div class="sign-row">
                <div class="sign-box">Prepared By (Station Accountant)</div>
                <div class="sign-box">Verified By (Station Manager)</div>
                <div class="sign-box">Approved By (Owner / Director)</div>
            </div>

            <script>
                window.onload = function() { window.print(); };
            </script>
        </body>
        </html>
    `;

    let printWindow = window.open('', '_blank');
    printWindow.document.write(printHtml);
    printWindow.document.close();
};

window.print_csa_statement = function(data) {
    if (!data) return;
    let stationName = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) ? window.ACTIVE_SHIFT.station : (frappe.defaults.get_user_default("station") || "Fuel Station");
    let companyName = frappe.defaults.get_user_default("Company") || "Fuel Management System";

    let txRowsHtml = '';
    (data.transactions || []).forEach(tx => {
        let shiftName = tx.shift || '-';
        if (tx.shift_date && tx.shift_template) {
            let parts = tx.shift_date.split('-');
            if (parts.length === 3) shiftName = `(${parts[2]}/${parts[1]}) ${tx.shift_template}`;
        }
        let reason = tx.reason || '-';
        if (tx.shift && shiftName !== tx.shift) reason = reason.replace(tx.shift, shiftName);

        txRowsHtml += `
            <tr>
                <td style="font-family: monospace;">${frappe.datetime.str_to_user(tx.date)}</td>
                <td>${tx.entry_type || (tx.amount > 0 ? 'Shortage' : 'Payment')}</td>
                <td>${shiftName}</td>
                <td>${reason}</td>
                <td style="text-align: right; font-family: monospace; color: #b91c1c;">${tx.shortage_amount > 0 ? Number(tx.shortage_amount).toLocaleString('en-US', {minimumFractionDigits: 2}) : '-'}</td>
                <td style="text-align: right; font-family: monospace; color: #15803d;">${tx.paid_amount > 0 ? Number(tx.paid_amount).toLocaleString('en-US', {minimumFractionDigits: 2}) : '-'}</td>
                <td style="text-align: right; font-family: monospace; font-weight: bold;">${Number(tx.running_balance).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
            </tr>
        `;
    });

    let printHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>CSA Statement - ${data.employee_name}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 25px; margin: 0; }
                .header { text-align: center; border-bottom: 2px solid #334155; padding-bottom: 12px; margin-bottom: 16px; }
                .title { font-size: 18px; font-weight: 800; text-transform: uppercase; margin: 0; color: #0f172a; }
                .subtitle { font-size: 12px; color: #475569; margin: 3px 0 0 0; }
                .info-box { display: flex; justify-content: space-between; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 14px; margin-bottom: 15px; font-size: 12px; }
                .kpi-grid { display: flex; gap: 10px; margin-bottom: 16px; }
                .kpi-box { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; background: #f8fafc; text-align: center; }
                .kpi-label { font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase; }
                .kpi-val { font-size: 14px; font-weight: 800; font-family: monospace; margin-top: 3px; color: #0f172a; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; }
                th { background: #f1f5f9; text-transform: uppercase; font-size: 10px; color: #334155; }
                .sign-row { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 20px; }
                .sign-box { width: 40%; border-top: 1px dashed #64748b; text-align: center; padding-top: 5px; font-size: 11px; color: #475569; }
                @media print {
                    body { padding: 0; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">${companyName}</div>
                <div style="font-size: 14px; font-weight: 700; color: #1e3a8a; margin-top: 2px;">${stationName}</div>
                <div class="subtitle">INDIVIDUAL CSA LIABILITY & SHORTAGE STATEMENT</div>
            </div>

            <div class="info-box">
                <div>
                    <div><b>Attendant:</b> ${data.employee_name}</div>
                    <div><b>Staff ID:</b> ${data.employee}</div>
                </div>
                <div style="text-align: right;">
                    <div><b>Statement Period:</b> ${frappe.datetime.str_to_user(data.start_date)} to ${frappe.datetime.str_to_user(data.end_date)}</div>
                    <div><b>Date Printed:</b> ${new Date().toLocaleString()}</div>
                </div>
            </div>

            <div class="kpi-grid">
                <div class="kpi-box">
                    <div class="kpi-label">Opening Balance (B/F)</div>
                    <div class="kpi-val">KES ${Number(data.opening_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                </div>
                <div class="kpi-box">
                    <div class="kpi-label">Period Shorts Incurred</div>
                    <div class="kpi-val" style="color:#b91c1c;">KES ${Number(data.period_shortage || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                </div>
                <div class="kpi-box">
                    <div class="kpi-label">Period Paid / Recovered</div>
                    <div class="kpi-val" style="color:#15803d;">KES ${Number(data.period_paid || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                </div>
                <div class="kpi-box">
                    <div class="kpi-label">Closing Balance (C/F)</div>
                    <div class="kpi-val" style="color:#1e3a8a;">KES ${Number(data.closing_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Shift / Ref</th>
                        <th>Reason / Description</th>
                        <th style="text-align: right;">Shortage (+)</th>
                        <th style="text-align: right;">Paid (-)</th>
                        <th style="text-align: right;">Running Bal (KES)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="background: #f8fafc; font-weight: bold;">
                        <td style="font-family: monospace;">${frappe.datetime.str_to_user(data.start_date)}</td>
                        <td colspan="3">🏁 OPENING BALANCE (Brought Forward from Previous Month)</td>
                        <td style="text-align: right;">-</td>
                        <td style="text-align: right;">-</td>
                        <td style="text-align: right; font-family: monospace;">${Number(data.opening_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                    </tr>
                    ${txRowsHtml}
                    <tr style="background: #eef2ff; font-weight: bold;">
                        <td style="font-family: monospace;">${frappe.datetime.str_to_user(data.end_date)}</td>
                        <td colspan="3">🏁 CLOSING BALANCE (Carried Forward)</td>
                        <td style="text-align: right; font-family: monospace; color:#b91c1c;">${Number(data.period_shortage || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                        <td style="text-align: right; font-family: monospace; color:#15803d;">${Number(data.period_paid || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                        <td style="text-align: right; font-family: monospace; font-size: 13px; color:#1e1b4b;">KES ${Number(data.closing_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                    </tr>
                </tbody>
            </table>

            <div class="sign-row">
                <div class="sign-box">Attendant Signature / Acknowledgement</div>
                <div class="sign-box">Supervisor / Manager Signature</div>
            </div>

            <script>
                window.onload = function() { window.print(); };
            </script>
        </body>
        </html>
    `;

    let printWindow = window.open('', '_blank');
    printWindow.document.write(printHtml);
    printWindow.document.close();
};

window.export_shorts_csv = function() {
    let rows = window.CURRENT_SHORTS_DATA || [];
    let start_date = $('#shorts-report-start').val() || '';
    let end_date = $('#shorts-report-end').val() || '';

    if (rows.length === 0) {
        frappe.msgprint("No records available to export.");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Row,Staff Name,Employee ID,Status,Opening Balance (KES),Period Shorts (KES),Period Paid (KES),Period Net Change (KES),Closing Balance (KES)\n";

    rows.forEach((r, idx) => {
        let name = (r.employee_name || r.employee || '').replace(/"/g, '""');
        let id = r.employee || '';
        let st = r.closing_balance > 0.01 ? 'Outstanding' : (r.closing_balance < -0.01 ? 'Credit' : 'Cleared');
        let op = (r.opening_balance || 0).toFixed(2);
        let sh = (r.period_shortage != null ? r.period_shortage : (r.month_shortage || 0)).toFixed(2);
        let pd = (r.period_paid != null ? r.period_paid : (r.month_paid || 0)).toFixed(2);
        let net = (r.period_net != null ? r.period_net : (sh - pd)).toFixed(2);
        let cl = (r.closing_balance != null ? r.closing_balance : (r.outstanding_balance || 0)).toFixed(2);

        csvContent += `${idx + 1},"${name}","${id}","${st}",${op},${sh},${pd},${net},${cl}\n`;
    });

    let encodedUri = encodeURI(csvContent);
    let link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `CSA_Shorts_Report_${start_date}_to_${end_date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};








function fetch_invoice_history($wrapper) {
    if(!window.ACTIVE_SHIFT) return;
    
    let from_date = $wrapper.find('#inv-filter-date-from').val();
    let to_date = $wrapper.find('#inv-filter-date-to').val();
    let customer = $wrapper.find('#inv-filter-customer').val();
    let search = ($wrapper.find('#invoice-filter-search').val() || '').toLowerCase();
    
    let is_locked = window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.status !== 'Open';
    
    $wrapper.find('#list-invoice-saved').html('<tr><td colspan="12" style="text-align: center; padding: 2rem;">Loading history...</td></tr>');
    
    frappe.call({
        method: 'fuel_management.fuel_management.api.get_shift_invoices_history',
        args: {
            station: window.ACTIVE_SHIFT.station,
            from_date: from_date,
            to_date: to_date,
            customer: customer
        },
        callback: function(r) {
            let count = r.message ? r.message.length : 0;
            if (!from_date && !to_date && !customer) {
                $wrapper.find('#inv-history-subtitle').html(`<span style="color:#64748b; font-size:0.85rem;">(Showing latest 20 entries &bull; Use date filter for more)</span>`);
            } else {
                $wrapper.find('#inv-history-subtitle').html(`<span style="color:#047857; font-size:0.85rem; font-weight:600;">(Showing ${count} filtered entries)</span>`);
            }
            let html_saved = '';
            if (r.message && r.message.length > 0) {
                r.message.forEach((row, idx) => {
                    let searchStr = `${row.customer} ${row.entry_number} ${row.vehicle_registration}`.toLowerCase();
                    if (search && !searchStr.includes(search)) return;
                    
                    let c = (window.CUSTOMERS_LIST || []).find(c => c.name === row.customer);
                    let customer_name = c ? c.customer_name : row.customer;
                    
                    let csa_name = row.csa;
                    if(window.USERS_LIST) {
                        let u = window.USERS_LIST.find(u => u.name === row.csa);
                        if(u) csa_name = u.employee_name || u.full_name;
                    }
                    
                    let can_edit = !is_locked && row.shift === window.ACTIVE_SHIFT.name;
                    
                    let del_btn = can_edit ? 
                        `<button class="btn btn-xs btn-danger btn-remove-saved-invoice" data-name="${row.name}">X</button>` : 
                        `<button class="btn btn-xs btn-danger" disabled>X</button>`;
                        
                    let edit_btn = can_edit ?
                        `<button class="btn btn-xs btn-default btn-edit-saved-invoice" data-name="${row.name}">Edit</button>` :
                        `<button class="btn btn-xs btn-default" disabled>Edit</button>`;

                    let action_html = `<div style="display:flex; gap:0.5rem;">${edit_btn}${del_btn}</div>`;
                    
                    let i_obj = (window.INVOICE_ITEMS || []).find(i => i.item_code === row.item);
                    let item_name = i_obj ? i_obj.item_name : row.item;

                    let gross_val = row.gross_amount || (row.quantity * row.rate) || row.amount;
                    let disc_cell = '-';
                    if (row.discount_amount > 0) {
                        let disc_csa_u = window.USERS_LIST ? window.USERS_LIST.find(u => u.name === row.discount_csa) : null;
                        let disc_csa_label = disc_csa_u ? (disc_csa_u.employee_name || disc_csa_u.full_name) : row.discount_csa;
                        disc_cell = `<span style="color:#7c3aed; font-weight:700;">-${frappe.format(row.discount_amount, {fieldtype: 'Currency'})}</span><br><small style="color:#6b21a8;">CSA: ${disc_csa_label || 'N/A'}</small>`;
                    }

                    html_saved += `
                        <tr>
                            <td><span class="badge" style="background: #e2e8f0; color: #0f172a;">${row.entry_number || '-'}</span></td>
                            <td style="color: #64748b;">${row.shift_date ? frappe.datetime.str_to_user(row.shift_date).split(' ')[0] : ''}</td>
                            <td style="color: #64748b;">${row.shift_template || row.shift}</td>
                            <td><strong>${customer_name || ''}</strong></td>
                            <td>${row.vehicle_registration || '-'}</td>
                            <td>${item_name || ''}</td>
                            <td><strong>${row.quantity || 0}</strong></td>
                            <td style="color: #64748b;">${frappe.format(gross_val, {fieldtype: 'Currency'})}</td>
                            <td>${disc_cell}</td>
                            <td><strong style="color: #047857;">${frappe.format(row.amount, {fieldtype: 'Currency'})}</strong></td>
                            <td>${csa_name || ''}</td>
                            <td>${action_html}</td>
                        </tr>
                    `;
                });
            }
            if(!html_saved) {
                html_saved = `<tr><td colspan="12" style="text-align: center; color: #64748b; padding: 2rem;">No historical invoices match filters.</td></tr>`;
            }
            $wrapper.find('#list-invoice-saved').html(html_saved);
            
            // Edit Historical Action
            $wrapper.find('.btn-edit-saved-invoice').off('click').on('click', function() {
                let name = $(this).attr('data-name');
                let row = r.message.find(x => x.name === name);
                if (!row) return;
                
                frappe.confirm(`This will load invoice ${row.entry_number || ''} back into the entry form and remove it from history. Continue?`, () => {
                    // Retain existing entry number for continuous uniqueness
                    window.EDITING_INVOICE_ENTRY_NUMBER = row.entry_number || null;
                    if (row.entry_number) {
                        $wrapper.find('#invoice-entry-number').text(`${row.entry_number} (Editing)`);
                    }

                    // Populate form
                    let c = (window.CUSTOMERS_LIST || []).find(c => c.name === row.customer);
                    let customer_name = c ? (c.customer_name || c.name) : row.customer;
                    $wrapper.find('#invoice-customer-hidden').val(row.customer);
                    $wrapper.find('#invoice-customer-input').val(customer_name);

                    // Update Vehicles list for this customer
                    $wrapper.find('#invoice-vehicles-list').empty();
                    if (row.customer) {
                        let unique_v = [];
                        if (window.SHIFT_DOC && window.SHIFT_DOC.invoices) {
                            window.SHIFT_DOC.invoices.forEach(r_inv => {
                                if (r_inv.customer === row.customer && r_inv.vehicle_registration) {
                                    unique_v.push(r_inv.vehicle_registration);
                                }
                            });
                        }
                        unique_v = [...new Set(unique_v)];
                        let vOpts = '';
                        unique_v.forEach(v => {
                            if (v) vOpts += `<option value="${v}">`;
                        });
                        $wrapper.find('#invoice-vehicles-list').html(vOpts);
                    }

                    $wrapper.find('#invoice-csa').val(row.csa);
                    if (row.inventory_csa) {
                        $wrapper.find('#invoice-inventory-csa').val(row.inventory_csa);
                    }
                    $wrapper.find('#invoice-po').val(row.purchase_order);
                    $wrapper.find('#invoice-vehicle').val(row.vehicle_registration);

                    let i_obj = (window.INVOICE_ITEMS || []).find(i => i.item_code === row.item);
                    let item_name = i_obj ? (i_obj.item_name || i_obj.item_code) : row.item;
                    $wrapper.find('#invoice-item-hidden').val(row.item);
                    $wrapper.find('#invoice-item-input').val(item_name).trigger('change');

                    $wrapper.find('#invoice-rate').val(row.rate);
                    $wrapper.find('#invoice-qty').val(row.quantity);
                    let gross_val = row.gross_amount || (row.quantity * row.rate) || row.amount;
                    $wrapper.find('#invoice-gross-amount').val(gross_val);
                    $wrapper.find('#invoice-discount-amount').val(row.discount_amount || '');
                    $wrapper.find('#invoice-discount-csa').val(row.discount_csa || row.csa);
                    $wrapper.find('#invoice-discount-reason').val(row.discount_reason || '');
                    $wrapper.find('#invoice-amount').val(row.amount);
                    
                    // delete from current shift
                    let idx = window.SHIFT_DOC.invoices.findIndex(i => i.name === name);
                    if (idx > -1) {
                        window.SHIFT_DOC.invoices.splice(idx, 1);
                        frappe.call({
                            method: "frappe.client.get",
                            args: { doctype: "Shift", name: window.ACTIVE_SHIFT.name },
                            callback: function(res) {
                                if(res.message) {
                                    let doc = res.message;
                                    doc.invoices = window.SHIFT_DOC.invoices.map(r2 => {
                                        return { ...r2, name: r2._is_new ? undefined : r2.name };
                                    });
                                    frappe.call({
                                        method: "frappe.client.save",
                                        args: { doc: doc },
                                        callback: function(r2) {
                                            if(r2.message) window.SHIFT_DOC = r2.message;
                                            fetch_invoice_history($wrapper);
                                            if(typeof render_greasing === 'function') render_greasing($wrapper);
                                            if(typeof render_dry_stock === 'function') render_dry_stock($wrapper);
                                            $wrapper.find('#tab-invoices .seg-btn[data-view="entry"]').click();
                                        }
                                    });
                                }
                            }
                        });
                    }
                });
            });

            // Delete Historical Action
            $wrapper.find('.btn-remove-saved-invoice').off('click').on('click', function() {
                let name = $(this).attr('data-name');
                frappe.confirm('Are you sure you want to delete this historical invoice item?', () => {
                    let idx = window.SHIFT_DOC.invoices.findIndex(i => i.name === name);
                    if (idx > -1) {
                        window.SHIFT_DOC.invoices.splice(idx, 1);
                        frappe.call({
                            method: "frappe.client.get",
                            args: { doctype: "Shift", name: window.ACTIVE_SHIFT.name },
                            callback: function(res) {
                                if(res.message) {
                                    let doc = res.message;
                                    doc.invoices = window.SHIFT_DOC.invoices.map(r2 => {
                                        return { ...r2, name: r2._is_new ? undefined : r2.name };
                                    });
                                    frappe.call({
                                        method: "frappe.client.save",
                                        args: { doc: doc },
                                        callback: function(r2) {
                                            if(r2.message) window.SHIFT_DOC = r2.message;
                                            fetch_invoice_history($wrapper);
                                            render_invoices($wrapper);
                                            if(typeof render_greasing === 'function') render_greasing($wrapper);
                                            if(typeof render_dry_stock === 'function') render_dry_stock($wrapper);
                                            frappe.show_alert({message: "Item deleted from history", indicator: "green"});
                                        }
                                    });
                                }
                            }
                        });
                    }
                });
            });
        }
    });
}

function fetch_discounts_report($wrapper) {
    if (!window.ACTIVE_SHIFT) return;
    
    // Ensure customer dropdown is populated
    if ($wrapper.find('#disc-filter-customer option').length <= 1 && window.CUSTOMERS_LIST) {
        let opts = '<option value="">All Customers</option>';
        window.CUSTOMERS_LIST.forEach(c => {
            opts += `<option value="${c.name}">${c.customer_name}</option>`;
        });
        $wrapper.find('#disc-filter-customer').html(opts);
    }
    
    let from_date = $wrapper.find('#disc-filter-from').val();
    let to_date = $wrapper.find('#disc-filter-to').val();
    let customer = $wrapper.find('#disc-filter-customer').val();
    
    $wrapper.find('#list-discounts-report').html('<tr><td colspan="11" style="text-align: center; padding: 2rem;">Loading discounts report...</td></tr>');
    
    frappe.call({
        method: 'fuel_management.fuel_management.api.get_shift_discounts_report',
        args: {
            station: window.ACTIVE_SHIFT.station,
            from_date: from_date,
            to_date: to_date,
            customer: customer
        },
        callback: function(r) {
            if (!r.message) return;
            let res = r.message;
            
            $wrapper.find('#disc-rep-total-discounts').text(format_currency(res.total_discounts || 0));
            $wrapper.find('#disc-rep-count').text(`${res.count || 0} items discounted`);
            $wrapper.find('#disc-rep-total-gross').text(format_currency(res.total_gross || 0));
            $wrapper.find('#disc-rep-total-net').text(format_currency(res.total_net || 0));
            
            let html = '';
            (res.discounts || []).forEach(row => {
                let sDate = row.shift_date ? frappe.datetime.str_to_user(row.shift_date).split(' ')[0] : '';
                let shiftName = row.shift_template || row.shift || '';
                
                let cust_name = row.customer_name || row.customer;
                let csa_name = row.discount_csa_name || row.csa_name || row.discount_csa || row.csa || '-';
                
                html += `
                    <tr>
                        <td><strong>${shiftName}</strong><br><small style="color:#64748b;">${sDate}</small></td>
                        <td><strong>${cust_name}</strong><br><small style="color:#64748b;">${row.vehicle_registration || ''}</small></td>
                        <td><span class="badge" style="background: #e2e8f0; color: #0f172a;">${row.entry_number || '-'}</span></td>
                        <td>${row.item_name || row.item}</td>
                        <td style="font-weight: 700;">${row.quantity}</td>
                        <td>${frappe.format(row.rate, {fieldtype: 'Currency'})}</td>
                        <td style="color: #475569;">${frappe.format(row.gross_amount, {fieldtype: 'Currency'})}</td>
                        <td style="color: #7c3aed; font-weight: 800;">-${frappe.format(row.discount_amount, {fieldtype: 'Currency'})}</td>
                        <td style="color: #047857; font-weight: 800;">${frappe.format(row.net_amount, {fieldtype: 'Currency'})}</td>
                        <td><span class="badge" style="background: #f3e8ff; color: #6b21a8; font-weight: 600;">${csa_name}</span></td>
                        <td><small style="color: #64748b;">${row.discount_reason || '-'}</small></td>
                    </tr>
                `;
            });
            
            if (!html) {
                html = '<tr><td colspan="11" style="text-align: center; color: #64748b; padding: 2rem;">No discounts recorded for the selected period.</td></tr>';
            }
            $wrapper.find('#list-discounts-report').html(html);
        }
    });
}
