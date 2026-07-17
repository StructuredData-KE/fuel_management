frappe.pages['shift_operation_spa'].on_page_load = function(wrapper) {
    // Render custom HTML structure
    $(wrapper).html(frappe.render_template("shift_operation_spa", {}));
    
    // UI Setup
    setup_tabs(wrapper);
    load_dropdowns(wrapper);
    setup_actions(wrapper);
}

function setup_tabs(wrapper) {
    const $wrapper = $(wrapper);
    $wrapper.find('.nav-tab').on('click', function() {
        // Remove active class from all tabs and panes
        $wrapper.find('.nav-tab').removeClass('active');
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

    // Fetch Head CSAs (Users with Role = Head CSA or just all for now)
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
                    options += `<option value="${u.name}">${u.full_name}</option>`;
                });
                $(wrapper).find('#select-head-csa').html(options);
            }
        }
    });
}

function setup_actions(wrapper) {
    const $wrapper = $(wrapper);
    
    // Start Shift Logic
    $wrapper.find('#btn-start-shift').on('click', function() {
        const station = $wrapper.find('#select-station').val();
        const head_csa = $wrapper.find('#select-head-csa').val();
        
        if(!station || !head_csa) {
            frappe.show_alert({message: "Please select Station and Head CSA", indicator: "red"});
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
                    start_time: frappe.datetime.now_datetime()
                }
            },
            callback: function(r) {
                $btn.find('.spinner').addClass('hidden');
                $btn.prop('disabled', false);
                
                if(r.message) {
                    frappe.show_alert({message: "Shift Started Successfully!", indicator: "green"});
                    $wrapper.find('#active-shift-badge')
                        .addClass('active-shift')
                        .text(r.message.name);
                    
                    // Move to Wetstock Tab
                    $wrapper.find('[data-target="tab-wetstock"]').click();
                }
            }
        });
    });
}