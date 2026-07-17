window.ACTIVE_SHIFT = null;
window.USERS_LIST = [];
window.PUMP_GROUPS_LIST = [];

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
            }
        }
    });
}

function render_meters($wrapper) {
    let html = '';
    (window.SHIFT_DOC.pump_meter_readings || []).forEach(row => {
        html += `
            <div class="dash-card">
                <h4>Nozzle: ${row.pump_nozzle}</h4>
                <div class="form-group">
                    <label>Closing Electronic</label>
                    <input type="number" class="spa-input meter-input" data-field="closing_electronic_meter" data-name="${row.name}" value="${row.closing_electronic_meter || ''}">
                </div>
                <div class="form-group">
                    <label>Closing Manual</label>
                    <input type="number" class="spa-input meter-input" data-field="closing_manual_meter" data-name="${row.name}" value="${row.closing_manual_meter || ''}">
                </div>
                <p style="font-size: 0.8rem; color: #64748b;">Opening Elec: ${row.opening_electronic_meter}</p>
            </div>
        `;
    });
    $wrapper.find('#meters-container').html(html);
}

function render_dips($wrapper) {
    let html = '';
    (window.SHIFT_DOC.dip_stick_readings || []).forEach(row => {
        html += `
            <div class="dash-card">
                <h4>Tank: ${row.fuel_tank}</h4>
                <div class="form-group">
                    <label>Closing Dip (Liters)</label>
                    <input type="number" class="spa-input dip-input" data-name="${row.name}" value="${row.closing_dip || ''}">
                </div>
                <p style="font-size: 0.8rem; color: #64748b;">Opening Dip: ${row.opening_dip || 0}</p>
                <p style="font-size: 0.8rem; color: #64748b;">Expected Stock: ${row.expected_stock || 0}</p>
            </div>
        `;
    });
    $wrapper.find('#dips-container').html(html);
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
                    options += `<option value="${u.name}">${u.full_name}</option>`;
                });
                $(wrapper).find('#select-head-csa').html(options);
            }
        }
    });
}

function setup_actions(wrapper) {
    const $wrapper = $(wrapper);
    
    // Dynamic Row for CSA Assignments
    $wrapper.find('#btn-add-csa-row').on('click', function(e) {
        e.preventDefault();
        
        let csaOptions = '<option value="">Select CSA...</option>';
        window.USERS_LIST.forEach(u => { csaOptions += `<option value="${u.name}">${u.full_name}</option>`; });
        
        let pgOptions = '<option value="">Select Pump Group...</option>';
        window.PUMP_GROUPS_LIST.forEach(pg => { pgOptions += `<option value="${pg.name}">${pg.name}</option>`; });
        
        let rowHtml = `
            <tr>
                <td><select class="spa-input csa-select">${csaOptions}</select></td>
                <td><select class="spa-input pg-select">${pgOptions}</select></td>
                <td><button class="btn-danger btn-sm btn-remove-csa-row">Remove</button></td>
            </tr>
        `;
        $wrapper.find('#csa-assignment-body').append(rowHtml);
    });

    $wrapper.on('click', '.btn-remove-csa-row', function(e) {
        e.preventDefault();
        $(this).closest('tr').remove();
    });
    
    // Start Shift Logic
    $wrapper.find('#btn-start-shift').on('click', function() {
        const station = $wrapper.find('#select-station').val();
        const head_csa = $wrapper.find('#select-head-csa').val();
        
        let assigned_csas = [];
        $wrapper.find('#csa-assignment-body tr').each(function() {
            let csa = $(this).find('.csa-select').val();
            let pg = $(this).find('.pg-select').val();
            if(csa) {
                assigned_csas.push({
                    "csa": csa,
                    "pump_group": pg
                });
            }
        });
        
        if(!station || !head_csa || assigned_csas.length === 0) {
            frappe.show_alert({message: "Please select Station, Head CSA, and assign at least one CSA to a pump group.", indicator: "red"});
            return;
        }
        
        let $btn = $(this);
        $btn.find('.spinner').removeClass('hidden');
        $btn.prop('disabled', true);
        
        frappe.call({
            method: "frappe.client.insert",
            args: {
                doc: {
                    doctype: "Shift",
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