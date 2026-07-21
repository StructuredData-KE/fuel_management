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
            fields: ["name", "station", "head_csa"],
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
    $wrapper.find('#active-shift-badge').addClass('active-shift').text('Active: ' + window.ACTIVE_SHIFT.name);
    
    // Switch to Wetstock tab automatically
    $wrapper.find('.nav-item[data-target="tab-wetstock"]').click();
    
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
            }
        }
    });
}

function render_meters($wrapper) {
    let html = '';
    (window.SHIFT_DOC.pump_meter_readings || []).forEach(row => {
        html += `
            <tr data-name="${row.name}">
                <td style="font-weight: 600; color: var(--text-primary);">${row.pump_nozzle}</td>
                <td class="text-secondary">${row.opening_electronic_meter}</td>
                <td>
                    <input type="number" class="spa-input meter-closing" data-field="closing_electronic_meter" data-opening="${row.opening_electronic_meter}" value="${row.closing_electronic_meter || ''}" placeholder="0.00">
                </td>
                <td class="meter-sales font-weight-bold">0.00</td>
            </tr>
        `;
    });
    $wrapper.find('#meters-container').html(html);

    // Add Live Math & Validation
    $wrapper.find('.meter-closing').on('input', function() {
        let closing = parseFloat($(this).val());
        let opening = parseFloat($(this).attr('data-opening')) || 0;
        
        let $row = $(this).closest('tr');
        if (!isNaN(closing) && closing > 0 && closing < opening) {
            $(this).addClass('error-input');
            $row.find('.meter-sales').text('ERR').css('color', 'var(--danger)');
        } else {
            $(this).removeClass('error-input');
            let sales = isNaN(closing) ? 0 : (closing - opening);
            $row.find('.meter-sales').text(sales.toFixed(2)).css('color', 'var(--text-primary)');
        }
    });
    // Trigger initial calculation
    $wrapper.find('.meter-closing').trigger('input');
}

function render_dips($wrapper) {
    let html = '';
    (window.SHIFT_DOC.dip_stick_readings || []).forEach(row => {
        html += `
            <tr data-name="${row.name}">
                <td style="font-weight: 600; color: var(--text-primary);">${row.fuel_tank}</td>
                <td>
                    <input type="number" class="spa-input dip-opening" data-field="opening_dip" value="${row.opening_dip || ''}" placeholder="0.00">
                </td>
                <td>
                    <input type="number" class="spa-input dip-closing" data-field="closing_dip" value="${row.closing_dip || ''}" placeholder="0.00">
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
                <td class="text-secondary">${row.opening_balance || 0}</td>
                <td>
                    <input type="number" class="spa-input mpesa-transfers" data-field="transfers_made" value="${row.transfers_made || ''}" placeholder="0.00">
                </td>
                <td>
                    <input type="number" class="spa-input mpesa-closing" data-field="closing_balance" data-opening="${row.opening_balance || 0}" value="${row.closing_balance || ''}" placeholder="0.00">
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
        if (!isNaN(closing) && closing > 0 && closing < opening) {
            $closingInput.addClass('error-input');
            $row.find('.mpesa-collected').text('ERR').css('color', 'var(--danger)');
        } else {
            $closingInput.removeClass('error-input');
            let collected = (isNaN(closing) ? 0 : closing) - opening + transfers;
            $row.find('.mpesa-collected').text(collected.toFixed(2)).css('color', 'var(--text-primary)');
        }
    }
    
    $wrapper.find('.mpesa-closing, .mpesa-transfers').on('input', calc_mpesa);
    // Trigger initial
    $wrapper.find('.mpesa-closing').trigger('input');
}

function setup_tabs(wrapper) {
    const $wrapper = $(wrapper);
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
        $wrapper.find('#current-module-title').text(tabName);
    });

    // Sub-Tabs for Meters
    $wrapper.find('.meter-tab-btn').on('click', function(e) {
        e.preventDefault();
        
        $wrapper.find('.meter-tab-btn').removeClass('active');
        $wrapper.find('.meter-tab-content').addClass('hidden').removeClass('active');
        
        $(this).addClass('active');
        const target = $(this).attr('data-meter');
        $wrapper.find('#meter-' + target).removeClass('hidden').addClass('active');
    });
}

function load_dropdowns(wrapper) {
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

    // Save Meters Data (Fuel, Dips, M-Pesa)
    $wrapper.find('#btn-save-wetstock').on('click', function() {
        let readings = [];
        $wrapper.find('#meters-container tr').each(function() {
            readings.push({
                name: $(this).attr('data-name'),
                closing_electronic_meter: $(this).find('.meter-closing').val()
            });
        });
        save_child_table("pump_meter_readings", readings, "Fuel Nozzles saved!");
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
    
    function save_child_table(table_name, rows_data, success_msg) {
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
                        }
                    });
                }
            }
        });
    }

    // Close Shift Logic
    $wrapper.find('#btn-close-shift').on('click', function() {
        if(!window.ACTIVE_SHIFT) return;
        
        const cashCaptured = $wrapper.find('#chk-cash-captured').is(':checked');
        const reportsPrinted = $wrapper.find('#chk-reports-printed').is(':checked');
        
        if(!cashCaptured || !reportsPrinted) {
            frappe.show_alert({message: "You must complete the entire Pre-Close Checklist before closing.", indicator: "red"});
            return;
        }
        
        frappe.confirm('Are you absolutely sure you want to close this shift? This will permanently lock the data and generate accounting entries.', () => {
            frappe.call({
                method: "frappe.client.set_value",
                args: {
                    doctype: "Shift",
                    name: window.ACTIVE_SHIFT.name,
                    fieldname: "status",
                    value: "Closed"
                },
                callback: function(r) {
                    if(r.message) {
                        frappe.show_alert({message: "Shift Closed successfully!", indicator: "green"});
                        setTimeout(() => {
                            location.reload();
                        }, 2000);
                    }
                }
            });
        });
    });
}