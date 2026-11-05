frappe.pages['executive_dashboard'].on_page_load = function(wrapper) {
    console.log("Executive Dashboard: on_page_load started!");
    try {
        var page = frappe.ui.make_app_page({
            parent: wrapper,
            title: 'Executive Dashboard',
            single_column: true
        });
        console.log("Executive Dashboard: make_app_page successful");

        // Hide standard Frappe UI elements
        $('body').attr('data-route', 'executive_dashboard');
        $('.navbar').hide();
        $('.page-head').hide();
        $('#page-desktop').hide();
        
        try {
            frappe.ui.toolbar.toggle_full_width(true);
        } catch(e) {}

        // Inject fonts safely
        if (!$('#exec-fonts-icons').length) {
            $('<link id="exec-fonts-icons" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">').appendTo('head');
            $('<link id="exec-fonts-inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">').appendTo('head');
        }

        console.log("Executive Dashboard: fonts injected");

        $(wrapper).find('.layout-main-section').css({
            'padding': '0',
            'margin': '0'
        });
        
        $(wrapper).find('.container').css({
            'max-width': '100%',
            'padding': '0',
            'margin': '0'
        });

        // Load HTML Template
        console.log("Executive Dashboard: rendering template...");
        
        // Let's check if the template exists!
        if (!frappe.templates["executive_dashboard"]) {
            throw new Error("frappe.templates['executive_dashboard'] is missing! The HTML was not loaded into Frappe.");
        }
        
        var html = frappe.render_template("executive_dashboard", this);
        console.log("Executive Dashboard: template rendered successfully! Length: " + html.length);
        
        $(html).appendTo(page.main);
        console.log("Executive Dashboard: HTML appended to page.main");

        // Initialize UI after template is loaded
        setTimeout(() => {
            init_spa_ui(wrapper);
            console.log("Executive Dashboard: init_spa_ui completed");
        }, 100);

    } catch (e) {
        console.error("Executive Dashboard crashed:", e);
        $(wrapper).html("<div style='padding: 50px; background: white; color: red;'><h1>Dashboard Error</h1><pre>" + e.toString() + "\n" + e.stack + "</pre></div>");
    }
};

function init_spa_ui(wrapper) {
    // Collapsible navigation section headers
    $(wrapper).off('click', '.exec-nav-section-header').on('click', '.exec-nav-section-header', function(e) {
        e.preventDefault();
        let targetSelector = $(this).attr('data-target');
        let targetBody = $(wrapper).find(targetSelector);
        let isCollapsed = $(this).hasClass('collapsed');
        if (isCollapsed) {
            $(this).removeClass('collapsed');
            targetBody.removeClass('collapsed').stop(true, true).slideDown(180);
        } else {
            $(this).addClass('collapsed');
            targetBody.stop(true, true).slideUp(180, function() {
                $(this).addClass('collapsed');
            });
        }
    });

    // Navigation logic
    $(wrapper).off('click', '.exec-nav-item').on('click', '.exec-nav-item', function(e) {
        if ($(this).attr('data-tab')) {
            e.preventDefault();
            
            const target = $(this).data('tab');
            const debtorsView = $(this).attr('data-debtors-view');
            const accountName = $(this).attr('data-account');

            // Ensure parent collapsible section is open
            let parentSection = $(this).closest('.exec-nav-section-wrapper');
            if (parentSection.length) {
                let pHeader = parentSection.find('.exec-nav-section-header');
                let pBody = parentSection.find('.exec-nav-section-body');
                if (pHeader.hasClass('collapsed')) {
                    pHeader.removeClass('collapsed');
                    pBody.removeClass('collapsed').show();
                }
            }

            // Remove active class from all nav items
            $(wrapper).find('.exec-nav-item').removeClass('active');
            
            // Add active class to clicked item
            $(this).addClass('active');
            
            // Hide all tab content
            $(wrapper).find('.exec-main').hide();
            
            // Show target tab content
            $(wrapper).find('#' + target).show();

            // If navigating to debtors/customers
            if (target === 'tab-customers') {
                let subview = debtorsView || (window.DEBTORS_STATE && window.DEBTORS_STATE.active_subview) || 'balances';
                if (typeof window.switch_debtors_subview === 'function') {
                    window.switch_debtors_subview(subview);
                }
            } else if (target === 'tab-financials') {
                load_pnl_data(wrapper);
            } else if (target === 'tab-balance-sheet') {
                init_exec_balance_sheet(wrapper);
            } else if (target === 'tab-cash-accounts') {
                if (accountName) {
                    window.EXEC_CA_STATE = window.EXEC_CA_STATE || {};
                    window.EXEC_CA_STATE.active_account = accountName;
                }
                init_exec_cash_accounts(wrapper);
            } else if (target === 'tab-supplier-accounts') {
                if (accountName) {
                    window.EXEC_SUPP_ACC_STATE = window.EXEC_SUPP_ACC_STATE || {};
                    window.EXEC_SUPP_ACC_STATE.active_account = accountName;
                }
                init_exec_supplier_accounts(wrapper);
            } else if (target === 'tab-expenses') {
                init_exec_expenses(wrapper);
            } else if (target === 'tab-inventory') {
                let station = $(wrapper).find('#inventory-station-select').val();
                load_tank_levels(wrapper, station);
                fetch_inventory_report($(wrapper));
            } else if (target === 'tab-reconciliations') {
                init_reconciliation_module(wrapper);
                load_reconciliation_data(wrapper);
            } else if (target === 'tab-shorts-report') {
                init_exec_shorts_report(wrapper);
            } else if (target === 'tab-topups') {
                load_topups_statement(wrapper);
            } else if (target === 'tab-cards-holding') {
                init_cards_holding(wrapper);
            } else if (target === 'tab-mpesa-reconciliation') {
                init_exec_mpesa_reconciliation(wrapper);
            }

            // Close sidebar on mobile
            if ($(window).width() < 768) {
                $(wrapper).find('.exec-sidebar').hide();
            }
        }
    });

    // Top Financial Report Switcher (P&L vs Balance Sheet)
    $(wrapper).find('.exec-fin-top-switch').off('click').on('click', function(e) {
        e.preventDefault();
        let targetTab = $(this).data('target-tab');
        $(wrapper).find('.exec-nav-item').removeClass('active');
        $(wrapper).find(`.exec-nav-item[data-tab="${targetTab}"]`).addClass('active');
        $(wrapper).find('.exec-main').hide();
        $(wrapper).find('#' + targetTab).show();
        if (targetTab === 'tab-financials') {
            load_pnl_data(wrapper);
        } else if (targetTab === 'tab-balance-sheet') {
            init_exec_balance_sheet(wrapper);
        }
    });

    // Top Holding Accounts Switcher (Top Ups Holding vs Cards Holding vs M-Pesa Recon)
    $(wrapper).find('.exec-holding-top-switch').off('click').on('click', function(e) {
        e.preventDefault();
        let targetTab = $(this).data('target-tab');
        let navItem = $(wrapper).find(`.exec-nav-item[data-tab="${targetTab}"]`);
        let parentSec = navItem.closest('.exec-nav-section-wrapper');
        if (parentSec.length) {
            parentSec.find('.exec-nav-section-header').removeClass('collapsed');
            parentSec.find('.exec-nav-section-body').removeClass('collapsed').show();
        }
        $(wrapper).find('.exec-nav-item').removeClass('active');
        navItem.addClass('active');
        $(wrapper).find('.exec-main').hide();
        $(wrapper).find('#' + targetTab).show();
        if (targetTab === 'tab-topups') {
            load_topups_statement(wrapper);
        } else if (targetTab === 'tab-cards-holding') {
            init_cards_holding(wrapper);
        } else if (targetTab === 'tab-mpesa-reconciliation') {
            init_exec_mpesa_reconciliation(wrapper);
        }
    });

    // Click on Executive Homepage Live M-Pesa KPI card
    $(wrapper).find('#exec-card-mpesa-balance').off('click').on('click', function(e) {
        e.preventDefault();
        let navItem = $(wrapper).find('.exec-nav-item[data-tab="tab-mpesa-reconciliation"]');
        let parentSec = navItem.closest('.exec-nav-section-wrapper');
        if (parentSec.length) {
            parentSec.find('.exec-nav-section-header').removeClass('collapsed');
            parentSec.find('.exec-nav-section-body').removeClass('collapsed').show();
        }
        $(wrapper).find('.exec-nav-item').removeClass('active');
        navItem.addClass('active');
        $(wrapper).find('.exec-main').hide();
        $(wrapper).find('#tab-mpesa-reconciliation').show();
        init_exec_mpesa_reconciliation(wrapper);
    });

    // Mobile menu toggle
    $(wrapper).find('#mobile-menu-btn').on('click', function() {
        $(wrapper).find('#mobile-sidebar-overlay').show();
        $(wrapper).find('#sidebar').removeClass('-translate-x-full');
    });

    $(wrapper).find('#mobile-sidebar-overlay').on('click', function() {
        $(this).hide();
        $(wrapper).find('#sidebar').addClass('-translate-x-full');
    });

    // Show initial tab
    $(wrapper).find('.exec-main').hide();
    $(wrapper).find('#tab-dashboard').show();

    // Date Filter Initialization - Default to Last 7 Days
    let today = frappe.datetime.get_today();
    let seven_days_ago = frappe.datetime.add_days(today, -6);
    $(wrapper).find('#exec-global-from').val(seven_days_ago);
    $(wrapper).find('#exec-global-to').val(today);

    function trigger_all_loads() {
        load_dashboard_data(wrapper);
        load_analytics_data(wrapper);
        load_pnl_data(wrapper);
        load_hr_data(wrapper);
        load_topups_statement(wrapper);
        render_sidebar_account_modules(wrapper, window.ACTIVE_STATION);
    }

    // Dashboard Date Preset Buttons
    $(wrapper).find('#tab-dashboard .exec-preset-btn').off('click').on('click', function(e) {
        e.preventDefault();
        $(wrapper).find('#tab-dashboard .exec-preset-btn').removeClass('active');
        $(this).addClass('active');

        let range = $(this).data('range');
        let end = frappe.datetime.get_today();
        let start = end;

        if (range == 7) {
            start = frappe.datetime.add_days(end, -6);
        } else if (range == 14) {
            start = frappe.datetime.add_days(end, -13);
        } else if (range == 30) {
            start = frappe.datetime.add_days(end, -29);
        } else if (range == 'month') {
            start = frappe.datetime.month_start();
        }

        $(wrapper).find('#exec-global-from').val(start);
        $(wrapper).find('#exec-global-to').val(end);
        trigger_all_loads();
    });

    $(wrapper).find('#exec-global-apply').off('click').on('click', function(e) {
        e.preventDefault();
        $(wrapper).find('#tab-dashboard .exec-preset-btn').removeClass('active');
        trigger_all_loads();
    });

    // --- Station Switcher Dropdown Initialization & Synchronization ---
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Fuel Station",
            fields: ["name", "station_name"],
            order_by: "station_name asc",
            limit_page_length: 50
        },
        callback: function(r) {
            if (r.message && r.message.length > 0) {
                let optionsHtml = '<option value="">All Stations (Consolidated)</option>';
                r.message.forEach(st => {
                    let val = st.name;
                    let label = st.station_name || st.name;
                    optionsHtml += `<option value="${val}">${label}</option>`;
                });
                
                $(wrapper).find('#exec-global-station-select').html(optionsHtml);
                $(wrapper).find('#exec-header-station-select').html(optionsHtml);
                $(wrapper).find('#inventory-station-select').html(optionsHtml);
                $(wrapper).find('#exec-shorts-station-select').html(optionsHtml);
            }
        }
    });

    function handle_exec_station_change(selectedStation) {
        selectedStation = selectedStation || "";
        window.ACTIVE_STATION = selectedStation;
        $(wrapper).find('#exec-global-station-select').val(selectedStation);
        $(wrapper).find('#exec-header-station-select').val(selectedStation);
        $(wrapper).find('#inventory-station-select').val(selectedStation);
        $(wrapper).find('#exec-shorts-station-select').val(selectedStation);

        // Synchronize P&L station pills
        $(wrapper).find('#exec-pnl-station-tabs .exec-pnl-station-btn').removeClass('active').css({'background': 'transparent', 'color': '#64748b', 'font-weight': '600', 'box-shadow': 'none'});
        let $pnlPill = $(wrapper).find(`#exec-pnl-station-tabs .exec-pnl-station-btn[data-station="${selectedStation}"]`);
        if (!$pnlPill.length && !selectedStation) {
            $pnlPill = $(wrapper).find('#exec-pnl-station-tabs .exec-pnl-station-btn[data-station=""]');
        }
        $pnlPill.addClass('active').css({'background': '#fff', 'color': '#0284c7', 'font-weight': '700', 'box-shadow': '0 1px 2px rgba(0,0,0,0.06)'});
        let labelText = selectedStation ? (selectedStation === 'RUBIS POA PLACE' ? 'Rubis Poa Place' : selectedStation) : 'Consolidated';
        $(wrapper).find('#exec-pnl-station-badge').text(labelText);

        // Synchronize Balance Sheet station pills
        $(wrapper).find('#exec-bs-station-tabs .exec-bs-station-btn').removeClass('active').css({'background': 'transparent', 'color': '#64748b', 'font-weight': '600', 'box-shadow': 'none'});
        let $bsPill = $(wrapper).find(`#exec-bs-station-tabs .exec-bs-station-btn[data-station="${selectedStation}"]`);
        if (!$bsPill.length && !selectedStation) {
            $bsPill = $(wrapper).find('#exec-bs-station-tabs .exec-bs-station-btn[data-station=""]');
        }
        $bsPill.addClass('active').css({'background': '#fff', 'color': '#0284c7', 'font-weight': '700', 'box-shadow': '0 1px 2px rgba(0,0,0,0.06)'});
        $(wrapper).find('#exec-bs-station-badge').text(labelText);

        // Synchronize Shorts Report station badge
        let shortsBadgeText = selectedStation ? (selectedStation === 'RUBIS POA PLACE' ? 'Rubis Poa Place' : selectedStation) : 'All Stations (Consolidated)';
        $(wrapper).find('#exec-shorts-station-badge').text(shortsBadgeText);

        // Synchronize Debtors Management station badges
        let debtorsBadgeText = selectedStation ? (selectedStation === 'RUBIS POA PLACE' ? 'Rubis Poa Place' : selectedStation) : 'All Stations (Consolidated)';
        $(wrapper).find('#exec-debtors-station-badge').text(debtorsBadgeText);
        $(wrapper).find('#exec-aging-station-badge').text(debtorsBadgeText);

        // Synchronize Top Ups Holding Account station badge
        let topupsBadgeText = selectedStation ? (selectedStation === 'RUBIS POA PLACE' ? 'Rubis Poa Place' : selectedStation) : 'All Stations (Consolidated)';
        $(wrapper).find('#exec-topups-station-badge').text(topupsBadgeText);
        if (window.TOPUPS_STATE) {
            window.TOPUPS_STATE.selected_items.clear();
        }

        // Invalidate cached debtors state on station change so switching views always reflects the current station
        if (window.DEBTORS_STATE) {
            window.DEBTORS_STATE.debtors = null;
            window.DEBTORS_STATE.aging_data = null;
        }

        // Dynamically update Cash & Bank and Supplier Accounts in the sidebar
        render_sidebar_account_modules(wrapper, selectedStation);

        load_tank_levels(wrapper, selectedStation);
        if (typeof fetch_inventory_report === 'function') {
            fetch_inventory_report($(wrapper));
        }

        let activeTab = $(wrapper).find('.exec-nav-item.active').data('tab') || 'tab-dashboard';
        if (activeTab === 'tab-dashboard') {
            load_dashboard_data(wrapper);
            load_analytics_data(wrapper);
            load_hr_data(wrapper);
        } else if (activeTab === 'tab-financials') {
            load_pnl_data(wrapper);
        } else if (activeTab === 'tab-balance-sheet') {
            if (typeof load_exec_balance_sheet === 'function') {
                load_exec_balance_sheet(wrapper);
            }
        } else if (activeTab === 'tab-inventory') {
            load_tank_levels(wrapper, selectedStation);
            if (typeof fetch_inventory_report === 'function') {
                fetch_inventory_report($(wrapper));
            }
        } else if (activeTab === 'tab-reconciliations') {
            if (window.RECON_STATE) window.RECON_STATE.page = 1;
            load_reconciliation_data(wrapper, true);
        } else if (activeTab === 'tab-shorts-report') {
            load_exec_shortage_balances(wrapper);
        } else if (activeTab === 'tab-topups') {
            load_topups_statement(wrapper);
        } else if (activeTab === 'tab-cards-holding') {
            if (window.CARDS_HOLDING_STATE) window.CARDS_HOLDING_STATE.page = 1;
            load_cards_holding_data(wrapper);
        } else if (activeTab === 'tab-mpesa-reconciliation') {
            load_mpesa_reconciliation_data(wrapper);
        } else if (activeTab === 'tab-cash-accounts') {
            load_exec_cash_accounts(wrapper);
        } else if (activeTab === 'tab-supplier-accounts') {
            load_exec_supplier_account(wrapper);
        } else if (activeTab === 'tab-customers') {
            let debtorsSubview = (window.DEBTORS_STATE && window.DEBTORS_STATE.active_subview) || 'balances';
            if (debtorsSubview === 'aging') {
                if (typeof window.load_debtors_aging === 'function') {
                    window.load_debtors_aging();
                }
            } else if (debtorsSubview === 'statement') {
                if (typeof window.load_debtors_data === 'function') {
                    window.load_debtors_data(function() {
                        let selectedCust = $(wrapper).find('#stmt-customer-select').val();
                        if (selectedCust) {
                            window.load_customer_statement();
                        } else {
                            window.update_statement_customer_card();
                        }
                    });
                }
            } else {
                if (typeof window.load_debtors_data === 'function') {
                    window.load_debtors_data();
                }
            }
        }
    }

    $(wrapper).find('#exec-global-station-select').off('change').on('change', function() {
        handle_exec_station_change($(this).val());
    });

    $(wrapper).find('#exec-header-station-select').off('change').on('change', function() {
        handle_exec_station_change($(this).val());
    });

    $(wrapper).find('#exec-shorts-station-select').off('change').on('change', function() {
        handle_exec_station_change($(this).val());
    });

    $(wrapper).find('#inventory-station-select').off('change').on('change', function() {
        handle_exec_station_change($(this).val());
    });

    // Initialize Supplier Transfer / Invoices Reconciliation Modal
    init_supplier_payment_modal(wrapper);

    // Initialize Top-Ups Holding Account & Statement Reconciliation
    init_topups_holding_tab(wrapper);

    // Load Employees (window.USERS_LIST for receipts and CSAs)
    if (!window.USERS_LIST || window.USERS_LIST.length === 0) {
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Employee",
                filters: { status: "Active" },
                fields: ["name", "employee_name", "user_id"],
                limit_page_length: 0
            },
            callback: function(r) {
                if (r.message) {
                    window.USERS_LIST = r.message;
                    window.USERS_LIST.sort((a,b) => (a.employee_name || a.full_name || a.name || "").localeCompare(b.employee_name || b.full_name || b.name || ""));
                }
            }
        });
    }

    // Initialize Debtors Suite
    if (typeof window.init_debtors_module === 'function') {
        window.init_debtors_module(wrapper);
    }

    // Initialize Financials Tab
    if (typeof init_financials_tab === 'function') {
        init_financials_tab(wrapper);
    }

    // Fetch and render data
    load_dashboard_data(wrapper);
    load_tank_levels(wrapper);
    load_pnl_data(wrapper);
    load_hr_data(wrapper);
    load_analytics_data(wrapper);
    load_topups_statement(wrapper);
    render_sidebar_account_modules(wrapper, window.ACTIVE_STATION);

    
    // Populate Station Dropdown
    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Fuel Station',
            fields: ['name']
        },
        callback: function(r) {
            if(r.message) {
                let opts = '<option value="">All Stations</option>';
                r.message.forEach(s => {
                    opts += `<option value="${s.name}">${s.name}</option>`;
                });
                $(wrapper).find('#inventory-station-select').html(opts);
            }
        }
    });

    $(wrapper).find('#inventory-station-select').off('change').on('change', function() {
        let station = $(this).val();
        load_tank_levels(wrapper, station);
        fetch_inventory_report($(wrapper));
    });

    $(wrapper).find('#btn-refresh-tanks').off('click').on('click', function(e) {
        e.preventDefault();
        let station = $(wrapper).find('#inventory-station-select').val();
        load_tank_levels(wrapper, station);
    });

    // Inventory Report initialization
    let fromInput = $(wrapper).find('#inventory-date-from');
    let toInput = $(wrapper).find('#inventory-date-to');
    
    if (!fromInput.val()) {
        let d = new Date();
        fromInput.val(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]);
        toInput.val(new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]);
    }
    
    $(wrapper).find('#btn-refresh-inventory-report').off('click').on('click', function() {
        fetch_inventory_report($(wrapper));
    });

    $(wrapper).find('#inventory-search').off('input').on('input', function() {
        let val = $(this).val().toLowerCase();
        $(wrapper).find('#list-inventory-status tr.data-row').each(function() {
            let text = $(this).find('.th-product').text().toLowerCase();
            $(this).toggle(text.includes(val));
        });
        
        $(wrapper).find('#list-inventory-status tr.row-group-header').each(function() {
            let $group = $(this);
            let $rows = $group.nextUntil('.row-group-header', 'tr.data-row');
            if ($rows.filter(':visible').length === 0) {
                $group.hide();
            } else {
                $group.show();
            }
        });
    });

    // Zoom and Compact logic
    let current_zoom = 100;
    
    $(wrapper).find('#btn-zoom-in').on('click', function() {
        if(current_zoom < 150) {
            current_zoom += 10;
            apply_inventory_zoom(wrapper, current_zoom);
        }
    });
    
    $(wrapper).find('#btn-zoom-out').on('click', function() {
        if(current_zoom > 70) {
            current_zoom -= 10;
            apply_inventory_zoom(wrapper, current_zoom);
        }
    });
    
    $(wrapper).find('#btn-zoom-reset').on('click', function() {
        current_zoom = 100;
        apply_inventory_zoom(wrapper, current_zoom);
    });
    
    $(wrapper).find('#toggle-compact').on('change', function() {
        if($(this).is(':checked')) {
            $(wrapper).find('.new-inv-table-unified tbody td').css('padding', '0.2rem 1rem');
        } else {
            $(wrapper).find('.new-inv-table-unified tbody td').css('padding', '0.5rem 1rem');
        }
    });
    
    // Initial Fetch
    fetch_inventory_report($(wrapper));

}

function get_date_filters(wrapper) {
    let station = $(wrapper).find('#exec-global-station-select').val() || $(wrapper).find('#exec-header-station-select').val() || '';
    let obj = {
        from_date: $(wrapper).find('#exec-global-from').val(),
        to_date: $(wrapper).find('#exec-global-to').val()
    };
    if (station && station !== "ALL" && station !== "All Stations") {
        obj.station = station;
    }
    return obj;
}

function load_dashboard_data(wrapper) {
    let filters = get_date_filters(wrapper);
    frappe.call({
        method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_dashboard_summary",
        args: filters,
        callback: function(r) {
            if(r.message) {
                let data = r.message;
                
                // 1. Update Financials
                let f = data.financials;
                $(wrapper).find('#exec-total-sales').text(format_currency(f.total_sales_today, "KES"));
                $(wrapper).find('#exec-sales-progress-text').text("As of " + data.date);
                $(wrapper).find('#exec-sales-progress').css('width', '100%'); // Placeholder for target logic
                
                $(wrapper).find('#exec-collections-total').text(format_currency(f.collections.total, "KES"));
                if(f.collections.total > 0) {
                    let mpesa_pct = (f.collections.mpesa / f.collections.total) * 100;
                    let card_pct = (f.collections.card / f.collections.total) * 100;
                    let cash_pct = (f.collections.cash / f.collections.total) * 100;
                    $(wrapper).find('#exec-bar-mpesa').css('width', mpesa_pct + '%');
                    $(wrapper).find('#exec-bar-cards').css('width', card_pct + '%');
                    $(wrapper).find('#exec-bar-cash').css('width', cash_pct + '%');
                }

                // 2. Update Variance
                let v = data.reconciliations.fuel_variance_today;
                $(wrapper).find('#exec-net-variance').text(v.toFixed(0) + " L");
                if (v < 0) {
                    $(wrapper).find('#exec-variance-badge').html('<span class="material-symbols-outlined" style="font-size: 14px;">arrow_downward</span>Loss');
                    $(wrapper).find('#exec-variance-badge').css({'background': '#fee2e2', 'color': '#dc2626'});
                } else if (v > 0) {
                    $(wrapper).find('#exec-variance-badge').html('<span class="material-symbols-outlined" style="font-size: 14px;">arrow_upward</span>Gain');
                    $(wrapper).find('#exec-variance-badge').css({'background': '#dcfce7', 'color': '#16a34a'});
                }
                
                // Update Holding Account Balance
                $(wrapper).find('#exec-holding-balance').text(format_currency(f.top_up_holding_balance || 0, "KES"));

                // Update Live M-Pesa Tills Balance Card
                if (f.mpesa_live) {
                    let mpl = f.mpesa_live;
                    let totalBal = mpl.total_balance !== undefined ? mpl.total_balance : (mpl.total_live_balance || 0);
                    let tillsCount = mpl.tills_count !== undefined ? mpl.tills_count : (mpl.active_tills_count || 0);
                    $(wrapper).find('#exec-mpesa-live-balance').text(format_currency(totalBal, "KES"));
                    $(wrapper).find('#exec-mpesa-tills-count').text(tillsCount + " Active Tills");
                    
                    let pills_html = "";
                    let tillsList = mpl.tills || mpl.tills_breakdown || [];
                    if (tillsList.length) {
                        tillsList.forEach(tb => {
                            let tName = tb.till || tb.till_name || 'Till';
                            let tBal = tb.balance !== undefined ? tb.balance : (tb.current_balance || 0);
                            pills_html += `<span style="font-size:10.5px; padding:2px 7px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; color:#166534; font-weight:600;" title="${frappe.utils.escape_html(tb.station || '')}">
                                ${frappe.utils.escape_html(tName)}: ${format_currency(tBal, "KES")}
                            </span>`;
                        });
                    }
                    $(wrapper).find('#exec-mpesa-till-pills').html(pills_html);
                }

                // 3. Update Alerts
                let alerts = data.alerts;
                $(wrapper).find('#exec-alerts-badge').text(alerts.length + " Active");
                let alerts_html = "";
                if(alerts.length === 0) {
                    alerts_html = '<div style="text-align:center; color:#94a3b8; font-size:12px; margin-top: 20px;">No active alerts.</div>';
                } else {
                    alerts.forEach(a => {
                        let color_hex = a.type == 'danger' ? '#dc2626' : (a.type == 'warning' ? '#f59e0b' : '#059669');
                        alerts_html += `
                            <div class="exec-alert-item alert-${a.type}">
                                <span class="material-symbols-outlined" style="color: ${color_hex}; font-size:18px;">${a.icon}</span>
                                <div>
                                    <div class="exec-alert-title">${a.title}</div>
                                    <div class="exec-alert-desc">${a.desc}</div>
                                </div>
                            </div>
                        `;
                    });
                }
                $(wrapper).find('#exec-alerts-list').html(alerts_html);
                if(alerts.length > 0) {
                    $(wrapper).find('#exec-ack-btn').show();
                }

                // 4. Update Inventory
                if (data.inventory) {
                    render_tank_gauges(wrapper, data.inventory);
                }

                // 5. Update Pending Borrowed Products
                render_pending_borrowed_products(wrapper, data.pending_borrowed);
            }
        }
    });
}

function render_pending_borrowed_products(wrapper, pending_data) {
    let $tbody = $(wrapper).find('#exec-pending-bp-body');
    let $badge = $(wrapper).find('#exec-bp-badge');
    if (!$tbody.length) return;

    // Attach Refresh Button listener
    $(wrapper).find('#btn-exec-refresh-bp').off('click').on('click', function(e) {
        e.preventDefault();
        let filters = get_date_filters(wrapper);
        let station = filters.station;
        $tbody.html('<tr><td colspan="8" style="text-align:center; padding:24px; color:#94a3b8; font-size:13px;"><span class="spinner-border spinner-border-sm" style="margin-right:6px;"></span>Refreshing pending borrowed products...</td></tr>');
        frappe.call({
            method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_pending_borrowed_summary",
            args: { station: station },
            callback: function(r) {
                render_pending_borrowed_products(wrapper, { count: (r.message || []).length, records: r.message || [] });
            }
        });
    });

    let records = (pending_data && pending_data.records) ? pending_data.records : [];
    let count = records.length;
    
    $badge.text(`${count} Pending`);
    if (count > 0) {
        $badge.css({'background': '#fef3c7', 'color': '#b45309', 'border-color': '#fde68a'});
        let html = '';
        records.forEach(row => {
            let isOut = row.type === 'Borrowed Out';
            let typeBadge = isOut
                ? `<span style="background:#fee2e2; color:#991b1b; padding:3px 10px; border-radius:9999px; font-size:11px; font-weight:700; border:1px solid #fecaca; display:inline-flex; align-items:center; gap:4px;">🔻 Lent Out</span>`
                : `<span style="background:#dcfce7; color:#166534; padding:3px 10px; border-radius:9999px; font-size:11px; font-weight:700; border:1px solid #bbf7d0; display:inline-flex; align-items:center; gap:4px;">🔺 Borrowed In</span>`;
                
            let itemsSummary = (row.items || []).map(i => {
                let label = i.item_name || i.item_code;
                return `<b>${i.qty}x</b> ${frappe.utils.escape_html(label)}`;
            }).join(', ');
            
            html += `
                <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                    <td style="padding:12px 14px; font-weight:700; color:#0f172a; font-family:monospace;">${frappe.utils.escape_html(row.name)}</td>
                    <td style="padding:12px 14px; color:#475569; font-weight:600;">${frappe.utils.escape_html(row.station || 'All')}</td>
                    <td style="padding:12px 14px; color:#64748b;">${frappe.datetime.str_to_user(row.date)}</td>
                    <td style="padding:12px 14px;">${typeBadge}</td>
                    <td style="padding:12px 14px; font-weight:700; color:#1e293b;">${frappe.utils.escape_html(row.counterparty)}</td>
                    <td style="padding:12px 14px; color:#334155;">${itemsSummary || '<span style="color:#94a3b8;">No items</span>'}</td>
                    <td style="padding:12px 14px; color:#64748b; font-size:12px; font-style:italic;">${frappe.utils.escape_html(row.memo || '—')}</td>
                    <td style="padding:12px 14px; text-align:center;">
                        <span style="background:#fffbeb; color:#d97706; padding:4px 10px; border-radius:9999px; font-size:11px; font-weight:700; border:1px solid #fef3c7;">Pending Return</span>
                    </td>
                </tr>
            `;
        });
        $tbody.html(html);
    } else {
        $badge.text("0 Pending").css({'background': '#f0fdf4', 'color': '#166534', 'border-color': '#bbf7d0'});
        $tbody.html(`
            <tr>
                <td colspan="8" style="text-align:center; padding:32px 16px; color:#059669; background:#f0fdf4; border-radius:8px;">
                    <div style="font-size:22px; margin-bottom:6px;">🎉</div>
                    <div style="font-size:14px; font-weight:700;">No Pending Borrowed Products</div>
                    <div style="font-size:12px; color:#166534; margin-top:4px;">All cross-station and third-party stock transfers have been settled and returned.</div>
                </td>
            </tr>
        `);
    }
}

function load_tank_levels(wrapper, station) {
    let $levels = $(wrapper).find('#exec-tank-levels');
    $levels.html(`
        <div style="grid-column: 1 / -1; text-align:center; padding:35px; color:#64748b;">
            <div class="spinner-border text-primary" role="status" style="width:2rem; height:2rem; margin-bottom:10px;"></div>
            <div style="font-size:13px; font-weight:600;">Fetching latest physical dip readings...</div>
        </div>
    `);

    frappe.call({
        method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_tank_levels",
        args: { station: station || "" },
        callback: function(r) {
            if (r.message && r.message.tanks) {
                render_tank_gauges(wrapper, r.message);
            } else {
                $levels.html(`
                    <div style="grid-column: 1 / -1; color:#dc2626; padding:20px; text-align:center;">
                        Failed to retrieve tank dip readings.
                    </div>
                `);
            }
        }
    });
}

function render_tank_gauges(wrapper, invData) {
    let tanks = invData.tanks || invData.tank_levels || [];
    let summary = invData.summary || {};

    // 1. Update summary strip if elements exist
    if (summary.total_volume !== undefined) {
        $(wrapper).find('#tank-sum-volume').text(format_currency(summary.total_volume, '').trim() + ' L');
        $(wrapper).find('#tank-sum-capacity').text(format_currency(summary.total_capacity, '').trim() + ' L');
        $(wrapper).find('#tank-sum-pct').text(summary.overall_pct + ' %');
        $(wrapper).find('#tank-sum-ullage').text(format_currency(summary.overall_ullage, '').trim() + ' L');
    } else if (tanks.length > 0) {
        let totVol = 0, totCap = 0;
        tanks.forEach(t => {
            totVol += flt(t.last_dip_volume !== undefined ? t.last_dip_volume : t.current_volume || 0);
            totCap += flt(t.capacity !== undefined ? t.capacity : t.max_capacity || 0);
        });
        let pct = totCap > 0 ? ((totVol / totCap) * 100).toFixed(1) : '0';
        let ullage = Math.max(0, totCap - totVol);
        $(wrapper).find('#tank-sum-volume').text(format_currency(totVol, '').trim() + ' L');
        $(wrapper).find('#tank-sum-capacity').text(format_currency(totCap, '').trim() + ' L');
        $(wrapper).find('#tank-sum-pct').text(pct + ' %');
        $(wrapper).find('#tank-sum-ullage').text(format_currency(ullage, '').trim() + ' L');
    }

    let $container = $(wrapper).find('#exec-tank-levels');
    if (!$container.length) return;

    if (tanks.length === 0) {
        $container.html(`
            <div style="grid-column: 1 / -1; padding:30px; text-align:center; color:#94a3b8; font-size:13px;">
                No fuel tanks found for the selected station.
            </div>
        `);
        return;
    }

    let html = '';
    tanks.forEach((t, i) => {
        let cap = flt(t.capacity || t.max_capacity || 10000);
        let vol = flt(t.last_dip_volume !== undefined ? t.last_dip_volume : t.current_volume || 0);
        let pct = flt(t.percentage !== undefined ? t.percentage : (cap > 0 ? (vol / cap * 100) : 0));
        let ullage = flt(t.ullage !== undefined ? t.ullage : Math.max(0, cap - vol));
        let threshold = flt(t.reorder_threshold || 15);

        // Styling based on fuel level
        let status = t.status;
        let statusLabel = t.status_label;
        let badgeBg, badgeColor, badgeBorder, badgeDot, accentColor, gradStart, gradEnd, pulse = '';

        if (pct <= threshold) {
            status = 'critical';
            statusLabel = statusLabel || 'CRITICAL REORDER';
            badgeBg = '#fef2f2';
            badgeColor = '#dc2626';
            badgeBorder = '#fca5a5';
            badgeDot = '#dc2626';
            accentColor = '#dc2626';
            gradStart = '#ef4444';
            gradEnd = '#b91c1c';
            pulse = 'animation: pulse-red 1.5s infinite;';
        } else if (pct <= 35) {
            status = 'low';
            statusLabel = statusLabel || 'LOW STOCK';
            badgeBg = '#fffbeb';
            badgeColor = '#d97706';
            badgeBorder = '#fde68a';
            badgeDot = '#f59e0b';
            accentColor = '#f59e0b';
            gradStart = '#fbbf24';
            gradEnd = '#d97706';
        } else if (pct < 75) {
            status = 'normal';
            statusLabel = statusLabel || 'NORMAL LEVEL';
            badgeBg = '#f0fdf4';
            badgeColor = '#16a34a';
            badgeBorder = '#bbf7d0';
            badgeDot = '#22c55e';
            accentColor = '#10b981';
            gradStart = '#34d399';
            gradEnd = '#059669';
        } else {
            status = 'optimal';
            statusLabel = statusLabel || 'OPTIMAL / FULL';
            badgeBg = '#ecfdf5';
            badgeColor = '#059669';
            badgeBorder = '#a7f3d0';
            badgeDot = '#10b981';
            accentColor = '#059669';
            gradStart = '#10b981';
            gradEnd = '#047857';
        }

        // SVG Dial Math (240-deg arc)
        let arcLength = 272.27;
        let circ = 408.41;
        let fillRatio = Math.min(100, Math.max(0, pct)) / 100;
        let dashOffset = (arcLength * (1 - fillRatio)).toFixed(2);

        // Fuel Type details
        let fuelLabel = t.fuel_label || t.fuel_product || 'Fuel';
        let fuelColor = t.fuel_color || '#0284c7';
        let fuelBadgeBg = t.fuel_badge_bg || '#e0f2fe';
        let fuelBadgeText = t.fuel_badge_text || '#0369a1';
        let stationName = t.station || '';
        let dipType = t.dip_type || 'Physical Dip';
        let shiftTitle = t.shift_title || t.shift_name_display || t.shift_id || 'Latest Shift';
        let timeStr = t.formatted_time || 'Recorded recently';

        let capK = Math.round(cap / 1000);

        html += `
            <div class="exec-tank-gauge-card" style="background:#fff; border-radius:14px; border:1px solid ${status === 'critical' ? '#fca5a5' : '#e2e8f0'}; box-shadow:0 2px 8px rgba(0,0,0,0.04); padding:18px; display:flex; flex-direction:column; position:relative; overflow:hidden;">
                <!-- Top Accent Strip -->
                <div style="position:absolute; top:0; left:0; right:0; height:4px; background:${accentColor};"></div>

                <!-- Header -->
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                    <div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span class="material-symbols-outlined" style="font-size:18px; color:${fuelColor};">local_gas_station</span>
                            <span style="font-size:15px; font-weight:800; color:#0f172a;">${t.tank_name}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px; margin-top:3px;">
                            <span style="font-size:11px; font-weight:700; background:${fuelBadgeBg}; color:${fuelBadgeText}; padding:2px 8px; border-radius:6px; text-transform:uppercase; letter-spacing:0.5px;">
                                ${fuelLabel}
                            </span>
                            ${stationName ? `<span style="font-size:11px; color:#64748b;">${stationName}</span>` : ''}
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <span style="display:inline-flex; align-items:center; gap:5px; font-size:10.5px; font-weight:800; padding:3px 9px; border-radius:9999px; background:${badgeBg}; color:${badgeColor}; border:1px solid ${badgeBorder};">
                            <span style="width:6px; height:6px; border-radius:50%; background:${badgeDot}; display:inline-block; ${pulse}"></span>
                            ${statusLabel}
                        </span>
                    </div>
                </div>

                <!-- SVG Radial Arc Gauge -->
                <div style="display:flex; justify-content:center; align-items:center; padding:6px 0; position:relative;">
                    <svg viewBox="0 0 180 150" style="width:100%; max-width:215px; height:auto; overflow:visible;">
                        <defs>
                            <linearGradient id="tank-grad-${i}" x1="0%" y1="100%" x2="100%" y2="0%">
                                <stop offset="0%" stop-color="${gradStart}" />
                                <stop offset="100%" stop-color="${gradEnd}" />
                            </linearGradient>
                            <filter id="glow-${i}" x="-20%" y="-20%" width="140%" height="140%">
                                <feGaussianBlur stdDeviation="2" result="blur" />
                                <feComposite in="SourceGraphic" in2="blur" operator="over" />
                            </filter>
                        </defs>

                        <!-- Background Track (240 deg arc from 150 to 390 deg) -->
                        <circle cx="90" cy="85" r="65" fill="none" stroke="#e2e8f0" stroke-width="12"
                                stroke-dasharray="${arcLength} ${circ}" stroke-linecap="round"
                                transform="rotate(150 90 85)" />

                        <!-- Active Arc Stroke -->
                        <circle cx="90" cy="85" r="65" fill="none" stroke="url(#tank-grad-${i})" stroke-width="12"
                                stroke-dasharray="${arcLength} ${circ}" stroke-dashoffset="${dashOffset}" stroke-linecap="round"
                                transform="rotate(150 90 85)" filter="url(#glow-${i})"
                                style="transition: stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1);" />

                        <!-- Min / Max scale markers -->
                        <text x="24" y="132" font-size="10" font-weight="700" fill="#94a3b8" text-anchor="middle">0L</text>
                        <text x="156" y="132" font-size="10" font-weight="700" fill="#94a3b8" text-anchor="middle">${capK}k L</text>

                        <!-- Center Readouts -->
                        <text x="90" y="70" text-anchor="middle" font-size="22" font-weight="800" fill="#0f172a" class="exec-mono-text" font-family="monospace">
                            ${Math.round(vol).toLocaleString()}
                        </text>
                        <text x="90" y="85" text-anchor="middle" font-size="10.5" font-weight="700" fill="#64748b" letter-spacing="1">
                            LITRES
                        </text>
                        <text x="90" y="106" text-anchor="middle" font-size="14" font-weight="800" fill="${badgeColor}">
                            ${pct}% Full
                        </text>
                    </svg>
                </div>

                <!-- Capsule Level Bar -->
                <div style="background:#f1f5f9; border-radius:9999px; height:8px; overflow:hidden; margin:4px 0 12px 0; border:1px solid #e2e8f0;">
                    <div style="height:100%; width:${Math.min(100, Math.max(0, pct))}%; background:${accentColor}; border-radius:9999px; transition:width 1s ease;"></div>
                </div>

                <!-- Stats Grid: Capacity & Space Available (Ullage) -->
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; background:#f8fafc; padding:10px 12px; border-radius:10px; border:1px solid #f1f5f9;">
                    <div>
                        <div style="font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase;">Tank Capacity</div>
                        <div style="font-size:13px; font-weight:700; color:#1e293b; font-family:ui-monospace, monospace; margin-top:2px;">
                            ${Math.round(cap).toLocaleString()} L
                        </div>
                    </div>
                    <div>
                        <div style="font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase;">Space Available (Ullage)</div>
                        <div style="font-size:13px; font-weight:700; color:#059669; font-family:ui-monospace, monospace; margin-top:2px;">
                            ${Math.round(ullage).toLocaleString()} L
                        </div>
                    </div>
                </div>

                <!-- Dip Audit Details Footer -->
                <div style="margin-top:auto; padding-top:10px; border-top:1px solid #f1f5f9; font-size:11px; color:#64748b; display:flex; flex-direction:column; gap:4px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="display:flex; align-items:center; gap:4px;">
                            <span class="material-symbols-outlined" style="font-size:13px; color:#0284c7;">straighten</span>
                            <strong>Reading:</strong>
                        </span>
                        <span style="font-weight:700; color:#1e293b; background:#e2e8f0; padding:1px 6px; border-radius:4px; font-size:10px;">
                            ${dipType}
                        </span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="display:flex; align-items:center; gap:4px;">
                            <span class="material-symbols-outlined" style="font-size:13px; color:#64748b;">badge</span>
                            <span>Shift:</span>
                        </span>
                        <span style="font-weight:600; color:#334155; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${shiftTitle}">
                            ${shiftTitle}
                        </span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="display:flex; align-items:center; gap:4px;">
                            <span class="material-symbols-outlined" style="font-size:13px; color:#64748b;">schedule</span>
                            <span>Recorded:</span>
                        </span>
                        <span style="font-weight:600; color:#334155;">
                            ${timeStr}
                        </span>
                    </div>
                </div>
            </div>
        `;
    });

    $container.html(html);
}

function get_pnl_filters(wrapper) {
    let from_date = $(wrapper).find('#exec-pnl-from').val();
    let to_date = $(wrapper).find('#exec-pnl-to').val();
    if (!from_date || !to_date) {
        let today = frappe.datetime.get_today();
        from_date = from_date || frappe.datetime.month_start();
        to_date = to_date || today;
        $(wrapper).find('#exec-pnl-from').val(from_date);
        $(wrapper).find('#exec-pnl-to').val(to_date);
    }
    let station = $(wrapper).find('#exec-pnl-station-tabs .exec-pnl-station-btn.active').data('station');
    if (station === undefined) {
        station = $(wrapper).find('#exec-global-station-select').val() || '';
    }
    return { from_date: from_date, to_date: to_date, station: station };
}

function init_financials_tab(wrapper) {
    // Default dates to current month if empty
    if (!$(wrapper).find('#exec-pnl-from').val()) {
        $(wrapper).find('#exec-pnl-from').val(frappe.datetime.month_start());
        $(wrapper).find('#exec-pnl-to').val(frappe.datetime.get_today());
    }

    // Station Segmented Tabs (All Consolidated / Rubis / Galana)
    $(wrapper).find('#exec-pnl-station-tabs .exec-pnl-station-btn').off('click').on('click', function(e) {
        e.preventDefault();
        let targetStation = $(this).data('station');
        handle_exec_station_change(targetStation);
    });

    // P&L Date Presets
    $(wrapper).find('#exec-pnl-presets .exec-preset-btn').off('click').on('click', function(e) {
        e.preventDefault();
        $(wrapper).find('#exec-pnl-presets .exec-preset-btn').removeClass('active');
        $(this).addClass('active');

        let range = $(this).data('pnl-range');
        let today = frappe.datetime.get_today();
        let start = today;
        let end = today;

        if (range === 'month') {
            start = frappe.datetime.month_start();
            end = today;
        } else if (range === 'last_month') {
            let now = new Date();
            let y = now.getFullYear();
            let m = now.getMonth();
            if (m === 0) {
                y -= 1;
                m = 12;
            }
            let firstDay = new Date(y, m - 1, 1);
            let lastDay = new Date(y, m, 0);
            start = frappe.datetime.obj_to_str(firstDay);
            end = frappe.datetime.obj_to_str(lastDay);
        } else if (range === 'quarter') {
            let now = new Date();
            let qMonth = Math.floor(now.getMonth() / 3) * 3;
            let qStart = new Date(now.getFullYear(), qMonth, 1);
            start = frappe.datetime.obj_to_str(qStart);
            end = today;
        } else if (range === 'year') {
            start = frappe.datetime.year_start();
            end = today;
        } else if (range === '30') {
            start = frappe.datetime.add_days(today, -29);
            end = today;
        }

        $(wrapper).find('#exec-pnl-from').val(start);
        $(wrapper).find('#exec-pnl-to').val(end);
        load_pnl_data(wrapper);
    });

    // P&L Custom Date Apply Button
    $(wrapper).find('#exec-pnl-apply').off('click').on('click', function(e) {
        e.preventDefault();
        $(wrapper).find('#exec-pnl-presets .exec-preset-btn').removeClass('active');
        load_pnl_data(wrapper);
    });

    // View Switcher (Statement View vs Category Breakdown)
    $(wrapper).find('#exec-pnl-view-switcher .exec-preset-btn').off('click').on('click', function(e) {
        e.preventDefault();
        $(wrapper).find('#exec-pnl-view-switcher .exec-preset-btn').removeClass('active');
        $(this).addClass('active');

        let view = $(this).data('view');
        if (view === 'breakdown') {
            $(wrapper).find('#exec-pnl-statement-view').hide();
            $(wrapper).find('#exec-pnl-breakdown-view').show();
        } else {
            $(wrapper).find('#exec-pnl-breakdown-view').hide();
            $(wrapper).find('#exec-pnl-statement-view').show();
        }
    });

    // Print P&L Button
    $(wrapper).find('#exec-pnl-print-btn').off('click').on('click', function(e) {
        e.preventDefault();
        print_pnl_statement(wrapper);
    });
}

function print_pnl_statement(wrapper) {
    let company = $(wrapper).find('#exec-statement-company').text() || 'KILIBET INVESTMENT LTD';
    let period = $(wrapper).find('#exec-statement-period-dates').text() || $(wrapper).find('#exec-pnl-period').text() || '';
    let statementHtml = $(wrapper).find('#exec-pnl-formal-table').html();

    let printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
        frappe.msgprint(__('Pop-up blocked. Please allow pop-ups to print the statement.'));
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Profit and Loss Statement - ${company}</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    color: #0f172a;
                    padding: 32px;
                    margin: 0;
                    background: #fff;
                }
                .header {
                    border-bottom: 2px solid #0f172a;
                    padding-bottom: 16px;
                    margin-bottom: 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-end;
                }
                h1 { margin: 0 0 4px 0; font-size: 24px; font-weight: 800; color: #0f172a; }
                .sub { font-size: 14px; font-weight: 600; color: #475569; }
                .meta { text-align: right; font-size: 12px; color: #64748b; }
                table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
                th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #cbd5e1; font-weight: 700; color: #475569; }
                td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
                @media print {
                    body { padding: 10px; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div style="font-size:11px; font-weight:700; color:#0284c7; text-transform:uppercase; letter-spacing:1px;">Fuel & Retail Station Operations</div>
                    <h1>${company}</h1>
                    <div class="sub">Statement of Profit and Loss</div>
                </div>
                <div class="meta">
                    <div style="font-weight:700; color:#1e293b; font-size:13px;">${period}</div>
                    <div>Currency: Kenya Shillings (KES)</div>
                    <div>Generated: ${new Date().toLocaleString()}</div>
                </div>
            </div>
            <div>
                ${statementHtml}
            </div>
            <script>
                window.onload = function() {
                    window.print();
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function load_pnl_data(wrapper) {
    let filters = get_pnl_filters(wrapper);
    
    // Show loading state in formal table
    $(wrapper).find('#exec-pnl-formal-table').html(`
        <div style="text-align:center; padding:40px; color:#64748b;">
            <div class="spinner-border text-primary" role="status" style="width:2rem; height:2rem; margin-bottom:12px;"></div>
            <div style="font-size:13px; font-weight:600;">Calculating Profit & Loss Statement...</div>
        </div>
    `);

    frappe.call({
        method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_pnl_summary",
        args: filters,
        callback: function(r) {
            if(r.message && !r.message.error) {
                let pnl = r.message;
                window.CURRENT_PNL_DATA = pnl;

                // Update Header Labels
                $(wrapper).find('#exec-pnl-period').text("Period: " + pnl.period);
                $(wrapper).find('#exec-statement-period-dates').text(pnl.period);
                if (pnl.company) {
                    $(wrapper).find('#exec-statement-company').text(pnl.company);
                    $(wrapper).find('#exec-pnl-company-name').text(pnl.company);
                }

                // Update Station Labels
                let shortStName = pnl.station ? (pnl.station === 'RUBIS POA PLACE' ? 'Rubis Poa Place' : pnl.station) : 'Consolidated';
                $(wrapper).find('#exec-pnl-station-badge').text(shortStName);
                $(wrapper).find('#exec-statement-station-name').text(shortStName);

                // Update 5 KPI Cards with Fuel vs Lubes breakdown
                $(wrapper).find('#exec-pnl-income').text(format_currency(pnl.total_income, "KES"));
                if (pnl.fuel_income !== undefined && pnl.lube_income !== undefined) {
                    $(wrapper).find('#exec-pnl-income').siblings('div:last').html(`
                        <span style="color:#0284c7; font-weight:600;">⛽ Fuel: ${format_currency(pnl.fuel_income, '')}</span> &bull; 
                        <span style="color:#d97706; font-weight:600;">🛢️ Lubes: ${format_currency(pnl.lube_income, '')}</span>
                    `);
                }

                $(wrapper).find('#exec-pnl-cogs').text(format_currency(pnl.total_cogs, "KES"));
                let cogsPct = pnl.total_income > 0 ? ((pnl.total_cogs / pnl.total_income) * 100).toFixed(1) : 0;
                if (pnl.fuel_cogs !== undefined && pnl.lube_cogs !== undefined) {
                    $(wrapper).find('#exec-pnl-cogs-pct').html(`
                        <span style="color:#0284c7; font-weight:600;">⛽ Fuel: ${format_currency(pnl.fuel_cogs, '')}</span> &bull; 
                        <span style="color:#d97706; font-weight:600;">🛢️ Lubes: ${format_currency(pnl.lube_cogs, '')}</span>
                        <div style="color:#64748b; font-size:10px; margin-top:2px;">${cogsPct}% of Revenue</div>
                    `);
                } else {
                    $(wrapper).find('#exec-pnl-cogs-pct').text(`${cogsPct}% of Revenue`);
                }

                // Gross Profit
                let gp = pnl.gross_profit;
                let gpEl = $(wrapper).find('#exec-pnl-gross-profit');
                let gpMarginEl = $(wrapper).find('#exec-pnl-gross-margin');
                let gpCard = $(wrapper).find('#exec-pnl-gp-card');
                gpEl.text(format_currency(gp, "KES"));
                if (pnl.fuel_gross_margin !== undefined && pnl.lube_gross_margin !== undefined) {
                    gpMarginEl.html(`
                        Gross Margin: <strong>${pnl.gross_margin}%</strong> &bull; 
                        <span style="font-size:10px; font-weight:600; color:#0284c7;">Fuel: ${pnl.fuel_gross_margin}%</span> &bull; 
                        <span style="font-size:10px; font-weight:600; color:#d97706;">Lubes: ${pnl.lube_gross_margin}%</span>
                    `);
                } else {
                    gpMarginEl.text(`Gross Margin: ${pnl.gross_margin}%`);
                }
                if (gp >= 0) {
                    gpEl.css('color', '#059669');
                    gpMarginEl.css('color', '#059669');
                    gpCard.css('border-left-color', '#10b981');
                } else {
                    gpEl.css('color', '#dc2626');
                    gpMarginEl.css('color', '#dc2626');
                    gpCard.css('border-left-color', '#dc2626');
                }

                // Operating Expenses
                $(wrapper).find('#exec-pnl-opex').text(format_currency(pnl.total_opex, "KES"));
                let opexPct = pnl.total_income > 0 ? ((pnl.total_opex / pnl.total_income) * 100).toFixed(1) : 0;
                $(wrapper).find('#exec-pnl-opex-pct').text(`${opexPct}% of Revenue`);

                // Net Profit
                let np = pnl.net_profit;
                let npEl = $(wrapper).find('#exec-pnl-profit');
                let npMarginEl = $(wrapper).find('#exec-pnl-net-margin');
                let npCard = $(wrapper).find('#exec-pnl-np-card');
                let npIcon = $(wrapper).find('#exec-pnl-np-icon');
                npEl.text(format_currency(np, "KES"));
                npMarginEl.text(`Net Margin: ${pnl.net_margin}%`);
                if (np >= 0) {
                    npEl.css('color', '#059669');
                    npMarginEl.css('color', '#059669');
                    npCard.css('border-left-color', '#10b981');
                    npIcon.css('color', '#059669');
                } else {
                    npEl.css('color', '#dc2626');
                    npMarginEl.css('color', '#dc2626');
                    npCard.css('border-left-color', '#dc2626');
                    npIcon.css('color', '#dc2626');
                }

                // Render Multi-Tier Formal Statement Table
                render_formal_pnl_statement(wrapper, pnl);

                // Render Category Breakdown Cards
                render_pnl_breakdown_tables(wrapper, pnl);

            } else {
                let errMsg = (r.message && r.message.error) ? r.message.error : "Error loading accounting data.";
                $(wrapper).find('#exec-pnl-period').text(errMsg);
                $(wrapper).find('#exec-pnl-formal-table').html(`<div style="color:#dc2626; padding:20px; text-align:center;">${errMsg}</div>`);
                $(wrapper).find('#exec-pnl-income-table').html("<div style='color:#dc2626; font-size:13px;'>Error loading data.</div>");
                $(wrapper).find('#exec-pnl-cogs-table').html("<div style='color:#dc2626; font-size:13px;'>Error loading data.</div>");
                $(wrapper).find('#exec-pnl-expense-table').html("<div style='color:#dc2626; font-size:13px;'>Error loading data.</div>");
            }
        }
    });
}

function render_formal_pnl_statement(wrapper, pnl) {
    let fuelIncome = pnl.fuel_income || 0;
    let lubeIncome = pnl.lube_income || 0;
    let fuelCogs = pnl.fuel_cogs || 0;
    let lubeCogs = pnl.lube_cogs || 0;
    let fuelGP = pnl.fuel_gross_profit || (fuelIncome - fuelCogs);
    let fuelMargin = pnl.fuel_gross_margin || (fuelIncome > 0 ? ((fuelGP / fuelIncome) * 100).toFixed(2) : '0.00');
    let lubeGP = pnl.lube_gross_profit || (lubeIncome - lubeCogs);
    let lubeMargin = pnl.lube_gross_margin || (lubeIncome > 0 ? ((lubeGP / lubeIncome) * 100).toFixed(2) : '0.00');

    let html = `
        <div style="background:#fff; border-radius:12px; border:1px solid #e2e8f0; box-shadow:0 2px 8px rgba(0,0,0,0.04); overflow:hidden;">
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
                <thead>
                    <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0; color:#475569; font-size:11px; text-transform:uppercase; letter-spacing:0.6px; font-weight:700;">
                        <th style="padding:12px 16px; text-align:left;">Financial Line Item</th>
                        <th style="padding:12px 16px; text-align:right; width:220px;">Amount (KES)</th>
                        <th style="padding:12px 16px; text-align:right; width:130px;">% of Revenue</th>
                    </tr>
                </thead>
                <tbody>
    `;

    // 1. REVENUE SECTION
    html += `
        <tr style="background:#f8fafc; font-weight:700; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0;">
            <td colspan="3" style="padding:10px 16px; letter-spacing:0.5px; font-size:12px; text-transform:uppercase; color:#0284c7; display:flex; align-items:center; gap:6px;">
                <span class="material-symbols-outlined" style="font-size:16px;">trending_up</span>
                1. REVENUE / TURNOVER
            </td>
        </tr>
    `;
    if (!pnl.income_accounts || pnl.income_accounts.length === 0) {
        html += `<tr><td colspan="3" style="padding:12px 24px; color:#94a3b8; font-style:italic;">No revenue entries recorded for this period.</td></tr>`;
    } else {
        pnl.income_accounts.forEach(acc => {
            let isFuel = acc.category === 'fuel' || /FUEL|PETROL|DIESEL|PMS|AGO/i.test(acc.account_name);
            let iconName = isFuel ? 'local_gas_station' : 'oil_barrel';
            let iconColor = isFuel ? '#0284c7' : '#d97706';
            let catBadge = isFuel 
                ? '<span style="font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:600; margin-left:8px;">Fuel</span>' 
                : '<span style="font-size:10px; background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:4px; font-weight:600; margin-left:8px;">Lubes / Store</span>';

            html += `
                <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background='#fbfcfe'" onmouseout="this.style.background='transparent'">
                    <td style="padding:10px 16px 10px 24px; color:#1e293b; font-weight:500;">
                        <span class="material-symbols-outlined" style="font-size:16px; color:${iconColor}; vertical-align:middle; margin-right:6px;">${iconName}</span>
                        ${acc.account_name}
                        ${catBadge}
                    </td>
                    <td style="padding:10px 16px; text-align:right; font-family:'JetBrains Mono', ui-monospace, monospace; font-weight:600; color:#059669; font-size:13px;">
                        ${format_currency(acc.amount, '')}
                    </td>
                    <td style="padding:10px 16px; text-align:right;">
                        <span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; background:#ecfdf5; color:#059669;">
                            ${acc.pct}%
                        </span>
                    </td>
                </tr>
            `;
        });
    }
    // Revenue Subtotal
    html += `
        <tr style="background:#f1f5f9; font-weight:700; border-top:1px solid #cbd5e1; border-bottom:2px solid #cbd5e1;">
            <td style="padding:12px 16px; color:#0f172a; font-size:13px;">TOTAL REVENUE (TURNOVER)</td>
            <td style="padding:12px 16px; text-align:right; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:14px; font-weight:700; color:#059669;">${format_currency(pnl.total_income, 'KES')}</td>
            <td style="padding:12px 16px; text-align:right;">
                <span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:700; background:#059669; color:#fff;">100.0%</span>
            </td>
        </tr>
    `;

    // Spacer
    html += `<tr><td colspan="3" style="height:12px; background:#fafafa;"></td></tr>`;

    // 2. COST OF GOODS SOLD SECTION
    html += `
        <tr style="background:#f8fafc; font-weight:700; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0;">
            <td colspan="3" style="padding:10px 16px; letter-spacing:0.5px; font-size:12px; text-transform:uppercase; color:#475569; display:flex; align-items:center; gap:6px;">
                <span class="material-symbols-outlined" style="font-size:16px;">inventory_2</span>
                2. COST OF GOODS SOLD (COGS)
            </td>
        </tr>
    `;
    if (!pnl.cogs_accounts || pnl.cogs_accounts.length === 0) {
        html += `<tr><td colspan="3" style="padding:12px 24px; color:#94a3b8; font-style:italic;">No cost of sales recorded for this period.</td></tr>`;
    } else {
        pnl.cogs_accounts.forEach(acc => {
            let isFuel = acc.category === 'fuel' || /FUEL|PETROL|DIESEL|PMS|AGO/i.test(acc.account_name);
            let isLube = acc.category === 'lubes' || /LUBE|STORE|INVENTORY|DRY/i.test(acc.account_name);
            let iconName = isFuel ? 'local_gas_station' : (isLube ? 'oil_barrel' : 'inventory_2');
            let iconColor = isFuel ? '#0284c7' : (isLube ? '#d97706' : '#64748b');
            let catBadge = isFuel 
                ? '<span style="font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:600; margin-left:8px;">Fuel Stock</span>' 
                : (isLube 
                    ? '<span style="font-size:10px; background:#fef3c7; color:#b45309; padding:2px 6px; border-radius:4px; font-weight:600; margin-left:8px;">Lubes & Store</span>'
                    : '<span style="font-size:10px; background:#f1f5f9; color:#475569; padding:2px 6px; border-radius:4px; font-weight:600; margin-left:8px;">Adjustment</span>');

            html += `
                <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background='#fbfcfe'" onmouseout="this.style.background='transparent'">
                    <td style="padding:10px 16px 10px 24px; color:#1e293b; font-weight:500;">
                        <span class="material-symbols-outlined" style="font-size:16px; color:${iconColor}; vertical-align:middle; margin-right:6px;">${iconName}</span>
                        ${acc.account_name}
                        ${catBadge}
                    </td>
                    <td style="padding:10px 16px; text-align:right; font-family:'JetBrains Mono', ui-monospace, monospace; font-weight:600; color:#334155; font-size:13px;">
                        ${format_currency(acc.amount, '')}
                    </td>
                    <td style="padding:10px 16px; text-align:right;">
                        <span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; background:#f1f5f9; color:#475569;">
                            ${acc.pct}%
                        </span>
                    </td>
                </tr>
            `;
        });
    }
    // COGS Subtotal
    let cogsPct = pnl.total_income > 0 ? ((pnl.total_cogs / pnl.total_income) * 100).toFixed(1) : '0.0';
    html += `
        <tr style="background:#f1f5f9; font-weight:700; border-top:1px solid #cbd5e1; border-bottom:2px solid #cbd5e1;">
            <td style="padding:12px 16px; color:#0f172a; font-size:13px;">TOTAL COST OF GOODS SOLD</td>
            <td style="padding:12px 16px; text-align:right; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:14px; font-weight:700; color:#334155;">${format_currency(pnl.total_cogs, 'KES')}</td>
            <td style="padding:12px 16px; text-align:right;">
                <span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:700; background:#e2e8f0; color:#334155;">${cogsPct}%</span>
            </td>
        </tr>
    `;

    // Departmental Margins Insight Strip
    html += `
        <tr>
            <td colspan="3" style="padding: 12px 16px; background: #fafafa;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px;">
                    <!-- Fuel Department Margin Card -->
                    <div style="background:#fff; border:1px solid #e0f2fe; border-left:4px solid #0284c7; border-radius:8px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
                        <div>
                            <div style="font-size:11px; font-weight:700; color:#0284c7; text-transform:uppercase; letter-spacing:0.5px; display:flex; align-items:center; gap:4px;">
                                <span class="material-symbols-outlined" style="font-size:15px;">local_gas_station</span> Fuel Operations Gross Margin
                            </div>
                            <div style="font-size:15px; font-weight:800; font-family:'JetBrains Mono', monospace; color:#0f172a; margin-top:3px;">
                                ${format_currency(fuelGP, 'KES')}
                            </div>
                            <div style="font-size:11px; color:#64748b; margin-top:2px;">
                                Sales: ${format_currency(fuelIncome, '')} &bull; COGS: ${format_currency(fuelCogs, '')}
                            </div>
                        </div>
                        <span style="background:${fuelGP >= 0 ? '#e0f2fe' : '#fee2e2'}; color:${fuelGP >= 0 ? '#0369a1' : '#dc2626'}; padding:4px 10px; border-radius:16px; font-weight:700; font-size:12px;">
                            ${fuelMargin}% Margin
                        </span>
                    </div>

                    <!-- Lubes & Store Department Margin Card -->
                    <div style="background:#fff; border:1px solid #fef3c7; border-left:4px solid #d97706; border-radius:8px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
                        <div>
                            <div style="font-size:11px; font-weight:700; color:#d97706; text-transform:uppercase; letter-spacing:0.5px; display:flex; align-items:center; gap:4px;">
                                <span class="material-symbols-outlined" style="font-size:15px;">oil_barrel</span> Lubes & Store Gross Margin
                            </div>
                            <div style="font-size:15px; font-weight:800; font-family:'JetBrains Mono', monospace; color:#0f172a; margin-top:3px;">
                                ${format_currency(lubeGP, 'KES')}
                            </div>
                            <div style="font-size:11px; color:#64748b; margin-top:2px;">
                                Sales: ${format_currency(lubeIncome, '')} &bull; COGS: ${format_currency(lubeCogs, '')}
                            </div>
                        </div>
                        <span style="background:${lubeGP >= 0 ? '#fef3c7' : '#fee2e2'}; color:${lubeGP >= 0 ? '#b45309' : '#dc2626'}; padding:4px 10px; border-radius:16px; font-weight:700; font-size:12px;">
                            ${lubeMargin}% Margin
                        </span>
                    </div>
                </div>
            </td>
        </tr>
    `;

    // 3. OVERALL GROSS PROFIT ROW
    let gpColor = pnl.gross_profit >= 0 ? '#059669' : '#dc2626';
    let gpBg = pnl.gross_profit >= 0 ? '#ecfdf5' : '#fef2f2';
    html += `
        <tr style="background:${gpBg}; font-weight:800; border-top:2px solid ${gpColor}; border-bottom:2px solid ${gpColor};">
            <td style="padding:14px 16px; color:#0f172a; font-size:14px;">
                TOTAL GROSS PROFIT / (LOSS)
                <span style="font-size:11px; font-weight:600; color:#64748b; display:block; margin-top:2px;">(Total Revenue minus Total COGS)</span>
            </td>
            <td style="padding:14px 16px; text-align:right; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:16px; font-weight:800; color:${gpColor};">
                ${format_currency(pnl.gross_profit, 'KES')}
            </td>
            <td style="padding:14px 16px; text-align:right;">
                <span style="display:inline-block; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:800; background:${gpColor}; color:#fff;">
                    ${pnl.gross_margin}%
                </span>
            </td>
        </tr>
    `;

    // Spacer
    html += `<tr><td colspan="3" style="height:12px; background:#fafafa;"></td></tr>`;

    // 4. OPERATING EXPENSES (OPEX)
    html += `
        <tr style="background:#f8fafc; font-weight:700; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0;">
            <td colspan="3" style="padding:10px 16px; letter-spacing:0.5px; font-size:12px; text-transform:uppercase; color:#b45309; display:flex; align-items:center; gap:6px;">
                <span class="material-symbols-outlined" style="font-size:16px;">receipt_long</span>
                3. OPERATING & ADMINISTRATIVE EXPENSES (OPEX)
            </td>
        </tr>
    `;
    if (!pnl.opex_accounts || pnl.opex_accounts.length === 0) {
        html += `<tr><td colspan="3" style="padding:12px 24px; color:#94a3b8; font-style:italic;">No operating overheads recorded for this period.</td></tr>`;
    } else {
        pnl.opex_accounts.forEach(acc => {
            html += `
                <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background='#fbfcfe'" onmouseout="this.style.background='transparent'">
                    <td style="padding:10px 16px 10px 24px; color:#334155; font-weight:500;">${acc.account_name}</td>
                    <td style="padding:10px 16px; text-align:right; font-family:'JetBrains Mono', ui-monospace, monospace; font-weight:600; color:#dc2626; font-size:13px;">
                        ${format_currency(acc.amount, '')}
                    </td>
                    <td style="padding:10px 16px; text-align:right;">
                        <span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; background:#fef2f2; color:#dc2626;">
                            ${acc.pct}%
                        </span>
                    </td>
                </tr>
            `;
        });
    }
    // OPEX Subtotal
    let opexPct = pnl.total_income > 0 ? ((pnl.total_opex / pnl.total_income) * 100).toFixed(1) : '0.0';
    html += `
        <tr style="background:#f1f5f9; font-weight:700; border-top:1px solid #cbd5e1; border-bottom:2px solid #cbd5e1;">
            <td style="padding:12px 16px; color:#0f172a; font-size:13px;">TOTAL OPERATING EXPENSES</td>
            <td style="padding:12px 16px; text-align:right; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:14px; font-weight:700; color:#dc2626;">${format_currency(pnl.total_opex, 'KES')}</td>
            <td style="padding:12px 16px; text-align:right;">
                <span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:700; background:#fee2e2; color:#dc2626;">${opexPct}%</span>
            </td>
        </tr>
    `;

    // Spacer
    html += `<tr><td colspan="3" style="height:14px; background:#fafafa;"></td></tr>`;

    // 5. NET PROFIT / (LOSS) ROW
    let npColor = pnl.net_profit >= 0 ? '#059669' : '#dc2626';
    let npBg = pnl.net_profit >= 0 ? '#d1fae5' : '#fee2e2';
    html += `
        <tr style="background:${npBg}; font-weight:800; border-top:3px solid ${npColor}; border-bottom:3px double ${npColor};">
            <td style="padding:16px; color:#0f172a; font-size:15px;">
                NET PROFIT / (LOSS)
                <span style="font-size:11px; font-weight:600; color:#64748b; display:block; margin-top:2px;">(Gross Profit minus Operating Expenses)</span>
            </td>
            <td style="padding:16px; text-align:right; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:18px; font-weight:800; color:${npColor};">
                ${format_currency(pnl.net_profit, 'KES')}
            </td>
            <td style="padding:16px; text-align:right;">
                <span style="display:inline-block; padding:4px 12px; border-radius:14px; font-size:13px; font-weight:800; background:${npColor}; color:#fff;">
                    ${pnl.net_margin}%
                </span>
            </td>
        </tr>
    `;

    html += `
                </tbody>
            </table>
        </div>
    `;

    $(wrapper).find('#exec-pnl-formal-table').html(html);
}

function render_pnl_breakdown_tables(wrapper, pnl) {
    // 1. Income Card Table
    let incomeHtml = `<table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
            <tr style="border-bottom:1px solid #e2e8f0; color:#64748b;">
                <th style="padding:8px; text-align:left;">Revenue Stream</th>
                <th style="padding:8px; text-align:right;">Amount (KES)</th>
                <th style="padding:8px; text-align:right; width:60px;">Share</th>
            </tr>
        </thead>
        <tbody>`;
    if (!pnl.income_accounts || pnl.income_accounts.length === 0) {
        incomeHtml += `<tr><td colspan="3" style="padding:12px; text-align:center; color:#94a3b8;">No income recorded.</td></tr>`;
    } else {
        pnl.income_accounts.forEach(a => {
            incomeHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:8px; color:#334155;">${a.account_name}</td>
                <td style="padding:8px; text-align:right; font-weight:600; color:#059669; font-family:ui-monospace, monospace;">${format_currency(a.amount, '')}</td>
                <td style="padding:8px; text-align:right; color:#64748b; font-size:11px;">${a.pct}%</td>
            </tr>`;
        });
        incomeHtml += `<tr style="font-weight:700; background:#f8fafc; border-top:1px solid #cbd5e1;">
            <td style="padding:8px; color:#0f172a;">Total Income</td>
            <td style="padding:8px; text-align:right; color:#059669; font-family:ui-monospace, monospace;">${format_currency(pnl.total_income, 'KES')}</td>
            <td style="padding:8px; text-align:right; color:#059669;">100%</td>
        </tr>`;
    }
    incomeHtml += `</tbody></table>`;
    $(wrapper).find('#exec-pnl-income-table').html(incomeHtml);

    // 2. Cost of Sales Card Table
    let cogsHtml = `<table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
            <tr style="border-bottom:1px solid #e2e8f0; color:#64748b;">
                <th style="padding:8px; text-align:left;">Direct Cost Account</th>
                <th style="padding:8px; text-align:right;">Amount (KES)</th>
                <th style="padding:8px; text-align:right; width:60px;">% Rev</th>
            </tr>
        </thead>
        <tbody>`;
    if (!pnl.cogs_accounts || pnl.cogs_accounts.length === 0) {
        cogsHtml += `<tr><td colspan="3" style="padding:12px; text-align:center; color:#94a3b8;">No COGS recorded.</td></tr>`;
    } else {
        pnl.cogs_accounts.forEach(a => {
            cogsHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:8px; color:#334155;">${a.account_name}</td>
                <td style="padding:8px; text-align:right; font-weight:600; color:#475569; font-family:ui-monospace, monospace;">${format_currency(a.amount, '')}</td>
                <td style="padding:8px; text-align:right; color:#64748b; font-size:11px;">${a.pct}%</td>
            </tr>`;
        });
        let cogsPct = pnl.total_income > 0 ? ((pnl.total_cogs / pnl.total_income) * 100).toFixed(1) : 0;
        cogsHtml += `<tr style="font-weight:700; background:#f8fafc; border-top:1px solid #cbd5e1;">
            <td style="padding:8px; color:#0f172a;">Total COGS</td>
            <td style="padding:8px; text-align:right; color:#334155; font-family:ui-monospace, monospace;">${format_currency(pnl.total_cogs, 'KES')}</td>
            <td style="padding:8px; text-align:right; color:#64748b;">${cogsPct}%</td>
        </tr>`;
    }
    cogsHtml += `</tbody></table>`;
    $(wrapper).find('#exec-pnl-cogs-table').html(cogsHtml);

    // 3. Operating Expenses Card Table
    let opexHtml = `<table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
            <tr style="border-bottom:1px solid #e2e8f0; color:#64748b;">
                <th style="padding:8px; text-align:left;">Overhead Account</th>
                <th style="padding:8px; text-align:right;">Amount (KES)</th>
                <th style="padding:8px; text-align:right; width:60px;">% Rev</th>
            </tr>
        </thead>
        <tbody>`;
    if (!pnl.opex_accounts || pnl.opex_accounts.length === 0) {
        opexHtml += `<tr><td colspan="3" style="padding:12px; text-align:center; color:#94a3b8;">No OPEX recorded.</td></tr>`;
    } else {
        pnl.opex_accounts.forEach(a => {
            opexHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:8px; color:#334155;">${a.account_name}</td>
                <td style="padding:8px; text-align:right; font-weight:600; color:#dc2626; font-family:ui-monospace, monospace;">${format_currency(a.amount, '')}</td>
                <td style="padding:8px; text-align:right; color:#64748b; font-size:11px;">${a.pct}%</td>
            </tr>`;
        });
        let opexPct = pnl.total_income > 0 ? ((pnl.total_opex / pnl.total_income) * 100).toFixed(1) : 0;
        opexHtml += `<tr style="font-weight:700; background:#f8fafc; border-top:1px solid #cbd5e1;">
            <td style="padding:8px; color:#0f172a;">Total OPEX</td>
            <td style="padding:8px; text-align:right; color:#dc2626; font-family:ui-monospace, monospace;">${format_currency(pnl.total_opex, 'KES')}</td>
            <td style="padding:8px; text-align:right; color:#64748b;">${opexPct}%</td>
        </tr>`;
    }
    opexHtml += `</tbody></table>`;
    $(wrapper).find('#exec-pnl-expense-table').html(opexHtml);
}

function load_hr_data(wrapper) {
    let filters = get_date_filters(wrapper);
    frappe.call({
        method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_employee_shorts",
        args: filters,
        callback: function(r) {
            if(r.message) {
                let hr = r.message;
                let html = `<table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">`;
                html += `<tr style="border-bottom:1px solid #e2e8f0; color:#64748b;">
                            <th style="padding:8px;">Employee</th>
                            <th style="padding:8px; text-align:right;">Total Variance (KES)</th>
                            <th style="padding:8px; text-align:center;">Status</th>
                        </tr>`;
                
                if(hr.shorts.length === 0) {
                    html += `<tr><td colspan="3" style="padding:12px; text-align:center; color:#94a3b8;">No shortages recorded this period.</td></tr>`;
                } else {
                    hr.shorts.forEach(s => {
                        let color = s.total_variance < 0 ? '#dc2626' : '#059669'; // Negative is a shortage
                        let status = s.total_variance < 0 ? 
                            '<span style="background:#fee2e2; color:#b91c1c; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">Shortage</span>' : 
                            '<span style="background:#d1fae5; color:#065f46; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">Overage</span>';
                        
                        html += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:10px 8px; font-weight:500; color:#0f172a;">${s.employee}</td>
                            <td style="padding:10px 8px; text-align:right; font-weight:600; color:${color};">${format_currency(s.total_variance, "")}</td>
                            <td style="padding:10px 8px; text-align:center;">${status}</td>
                        </tr>`;
                    });
                }
                html += `</table>`;
                $(wrapper).find('#exec-hr-shorts-table').html(html);
            }
        }
    });
}

function load_analytics_data(wrapper) {
    $(wrapper).find('#exec-analytics-status').text('Loading analytics data...');
    let filters = get_date_filters(wrapper);
    frappe.call({
        method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_sales_analytics",
        args: filters,
        callback: function(r) {
            if(r.message) {
                $(wrapper).find('#exec-analytics-status').text('');
                let data = r.message;
                
                // 1. Render Fuel Multi-Line Comparison Chart
                $(wrapper).find('#exec-fuel-chart').empty();
                
                let fuelDatasets = (data.fuel.series || []).map((s, idx) => ({
                    name: s.name,
                    values: s.values,
                    chartType: 'line'
                }));

                let fuelChartData = {
                    labels: data.date_labels || [],
                    datasets: fuelDatasets
                };

                new frappe.Chart($(wrapper).find('#exec-fuel-chart')[0], {
                    data: fuelChartData,
                    type: 'line',
                    height: 300,
                    colors: ['#f59e0b', '#0f172a', '#10b981', '#6366f1', '#ec4899'],
                    lineOptions: {
                        regionFill: 1,
                        dotSize: 5
                    },
                    axisOptions: {
                        xIsSeries: true,
                        shortenYAxisNumbers: true
                    },
                    tooltipOptions: {
                        formatTooltipX: d => d,
                        formatTooltipY: d => (d || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' L'
                    }
                });

                // Update Fuel Summary Totals
                let totalFuelLiters = flt(data.fuel.total_liters || 0);
                let totalFuelRevenue = flt(data.fuel.total_revenue || 0);
                $(wrapper).find('#exec-fuel-total-liters').text(totalFuelLiters.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' L');
                $(wrapper).find('#exec-fuel-total-revenue').text(format_currency(totalFuelRevenue, 'KES'));

                // Render Fuel Table Summary
                let fuelHtml = `<table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0; color:#64748b; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">
                            <th style="padding:10px 8px;">Fuel Type</th>
                            <th style="padding:10px 8px; text-align:right;">Day Shift (L)</th>
                            <th style="padding:10px 8px; text-align:right;">Night Shift (L)</th>
                            <th style="padding:10px 8px; text-align:right;">Total Volume (L)</th>
                            <th style="padding:10px 8px; text-align:right;">Revenue (KES)</th>
                        </tr>
                    </thead>
                    <tbody>`;
                
                let prodColors = {'DIESEL': '#f59e0b', 'PETROL 001': '#0f172a', 'SUPER': '#0f172a', 'KEROSENE': '#10b981'};
                let sumFuelDay = 0, sumFuelNight = 0, sumFuelVolume = 0, sumFuelRevenue = 0;

                Object.values(data.fuel.summary || {}).forEach(fs => {
                    let dayL = flt(fs.day_liters || 0);
                    let nightL = flt(fs.night_liters || 0);
                    let totL = flt(fs.total_liters || 0);
                    let rev = flt(fs.revenue || 0);
                    sumFuelDay += dayL;
                    sumFuelNight += nightL;
                    sumFuelVolume += totL;
                    sumFuelRevenue += rev;
                    let dotColor = prodColors[fs.item_code.toUpperCase()] || '#6366f1';
                    fuelHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:10px 8px; font-weight:700; color:#0f172a;">
                            <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${dotColor}; margin-right:6px;"></span>
                            ${fs.item_code}
                        </td>
                        <td style="padding:10px 8px; text-align:right; font-family: monospace;">${dayL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style="padding:10px 8px; text-align:right; font-family: monospace;">${nightL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style="padding:10px 8px; text-align:right; font-weight:700; color:#0f172a; font-family: monospace;">${totL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style="padding:10px 8px; text-align:right; color:#059669; font-weight:700; font-family: monospace;">${format_currency(rev, 'KES')}</td>
                    </tr>`;
                });
                fuelHtml += `</tbody>
                    <tfoot>
                        <tr style="border-top:2px solid #cbd5e1; background:#f8fafc;">
                            <td style="padding:11px 8px; font-weight:800; color:#0f172a; text-transform:uppercase; font-size:12px;">Total (Combined)</td>
                            <td style="padding:11px 8px; text-align:right; font-family: monospace; font-weight:700; color:#334155;">${sumFuelDay.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td style="padding:11px 8px; text-align:right; font-family: monospace; font-weight:700; color:#334155;">${sumFuelNight.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td style="padding:11px 8px; text-align:right; font-weight:800; color:#0f172a; font-family: monospace; font-size:14px;">${sumFuelVolume.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td style="padding:11px 8px; text-align:right; color:#059669; font-weight:800; font-family: monospace; font-size:14px;">${format_currency(sumFuelRevenue, 'KES')}</td>
                        </tr>
                    </tfoot>
                </table>`;
                $(wrapper).find('#exec-fuel-table').html(fuelHtml);

                // Extract Non-Fuel Category Totals
                let lubesLitres = flt(data.lubes ? data.lubes.total_liters : 0);
                let lubesRev = flt(data.lubes ? data.lubes.total_revenue : 0);
                let lubesQty = flt(data.lubes ? (data.lubes.total_qty || (data.lubes.items || []).reduce((acc, x) => acc + flt(x.qty), 0)) : 0);

                let gasKgs = flt(data.gas ? data.gas.total_kgs : 0);
                let gasRev = flt(data.gas ? (data.gas.total_gas_revenue || data.gas.total_revenue || 0) : 0);
                let gasQty = flt(data.gas ? (data.gas.total_qty || (data.gas.gas_items || []).reduce((acc, x) => acc + flt(x.qty), 0)) : 0);

                let cylUnits = flt(data.cylinders ? data.cylinders.total_units : (data.gas ? data.gas.total_cylinders : 0));
                let cylRev = flt(data.cylinders ? data.cylinders.total_revenue : (data.gas ? data.gas.total_cylinder_revenue : 0));

                let filtersUnits = flt(data.accessories ? data.accessories.total_qty : 0);
                let filtersRev = flt(data.accessories ? data.accessories.total_revenue : 0);

                let greasingVehicles = flt(data.greasing ? data.greasing.total_vehicles : 0);
                let greasingRev = flt(data.greasing ? data.greasing.total_revenue : 0);

                let totalNonFuelRev = (data.non_fuel && data.non_fuel.total_revenue != null) ? 
                    flt(data.non_fuel.total_revenue) : 
                    (lubesRev + gasRev + cylRev + filtersRev + greasingRev);

                // Update Non-Fuel Summary Overview Banner
                $(wrapper).find('#exec-nonfuel-total-revenue').text(format_currency(totalNonFuelRev, 'KES'));
                $(wrapper).find('#exec-kpi-lubes-vol').text(lubesLitres.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) + ' L');
                $(wrapper).find('#exec-kpi-lubes-rev').text(format_currency(lubesRev, 'KES'));

                $(wrapper).find('#exec-kpi-gas-vol').text(gasKgs.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1}) + ' Kg');
                $(wrapper).find('#exec-kpi-gas-rev').text(format_currency(gasRev, 'KES'));

                $(wrapper).find('#exec-kpi-cyl-count').text(cylUnits.toLocaleString() + ' Cyl');
                $(wrapper).find('#exec-kpi-cyl-rev').text(format_currency(cylRev, 'KES'));

                $(wrapper).find('#exec-kpi-filters-count').text(filtersUnits.toLocaleString() + ' Units');
                $(wrapper).find('#exec-kpi-filters-rev').text(format_currency(filtersRev, 'KES'));

                $(wrapper).find('#exec-kpi-greasing-count').text(greasingVehicles.toLocaleString() + ' Vehicles');
                $(wrapper).find('#exec-kpi-greasing-rev').text(format_currency(greasingRev, 'KES'));

                // 2. Render Lubes (in Litres)
                $(wrapper).find('#exec-lubes-total-badge').text(lubesLitres.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) + ' L');
                $(wrapper).find('#exec-lubes-rev-badge').text(format_currency(lubesRev, 'KES'));
                $(wrapper).find('#exec-lubes-chart').empty();
                if (data.lubes && data.lubes.timeline_liters && data.lubes.timeline_liters.some(v => v > 0)) {
                    new frappe.Chart($(wrapper).find('#exec-lubes-chart')[0], {
                        data: {
                            labels: data.date_labels,
                            datasets: [{ name: "Lubes (Litres)", values: data.lubes.timeline_liters, chartType: 'bar' }]
                        },
                        type: 'bar',
                        height: 180,
                        colors: ['#0284c7'],
                        tooltipOptions: { formatTooltipY: d => (d || 0) + ' L' }
                    });
                }

                let lubesHtml = `<table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0; color:#64748b; font-size:10px; text-transform:uppercase;">
                            <th style="padding:6px 4px;">Lube Item</th>
                            <th style="padding:6px 4px; text-align:right;">Pack</th>
                            <th style="padding:6px 4px; text-align:right;">Qty</th>
                            <th style="padding:6px 4px; text-align:right;">Litres</th>
                            <th style="padding:6px 4px; text-align:right;">Revenue</th>
                        </tr>
                    </thead>
                    <tbody>`;
                if (!data.lubes || !data.lubes.items || data.lubes.items.length === 0) {
                    lubesHtml += `<tr><td colspan="5" style="padding:16px; text-align:center; color:#94a3b8;">No lubes sales recorded.</td></tr>`;
                } else {
                    data.lubes.items.forEach(item => {
                        lubesHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:6px 4px; font-weight:600; color:#1e293b;">${item.item_code}</td>
                            <td style="padding:6px 4px; text-align:right; color:#64748b; font-family: monospace;">${item.pack_size}L</td>
                            <td style="padding:6px 4px; text-align:right; font-family: monospace;">${item.qty}</td>
                            <td style="padding:6px 4px; text-align:right; font-weight:700; color:#0284c7; font-family: monospace;">${flt(item.total_liters).toFixed(1)} L</td>
                            <td style="padding:6px 4px; text-align:right; color:#059669; font-weight:600; font-family: monospace;">${format_currency(item.revenue, '')}</td>
                        </tr>`;
                    });
                }
                lubesHtml += `</tbody>
                    <tfoot>
                        <tr style="border-top:2px solid #e2e8f0; background:#f8fafc; font-weight:700;">
                            <td colspan="2" style="padding:8px 4px; color:#0f172a; text-transform:uppercase; font-size:11px;">Total</td>
                            <td style="padding:8px 4px; text-align:right; font-family: monospace;">${lubesQty.toLocaleString()}</td>
                            <td style="padding:8px 4px; text-align:right; color:#0284c7; font-family: monospace;">${lubesLitres.toFixed(1)} L</td>
                            <td style="padding:8px 4px; text-align:right; color:#059669; font-family: monospace;">${format_currency(lubesRev, 'KES')}</td>
                        </tr>
                    </tfoot>
                </table>`;
                $(wrapper).find('#exec-analytics-lubes').html(lubesHtml);

                // 3. Render Gas Refill (in Kgs)
                $(wrapper).find('#exec-gas-total-badge').text(gasKgs.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1}) + ' Kg');
                $(wrapper).find('#exec-gas-rev-badge').text(format_currency(gasRev, 'KES'));
                $(wrapper).find('#exec-gas-chart').empty();
                if (data.gas && data.gas.timeline_kgs && data.gas.timeline_kgs.some(v => v > 0)) {
                    new frappe.Chart($(wrapper).find('#exec-gas-chart')[0], {
                        data: {
                            labels: data.date_labels,
                            datasets: [{ name: "Gas (Kgs)", values: data.gas.timeline_kgs, chartType: 'bar' }]
                        },
                        type: 'bar',
                        height: 180,
                        colors: ['#f97316'],
                        tooltipOptions: { formatTooltipY: d => (d || 0) + ' Kg' }
                    });
                }

                let gasItems = (data.gas && data.gas.gas_items) ? data.gas.gas_items : [];
                let gasHtml = `<table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0; color:#64748b; font-size:10px; text-transform:uppercase;">
                            <th style="padding:6px 4px;">Gas Product</th>
                            <th style="padding:6px 4px; text-align:right;">Refill (Kg)</th>
                            <th style="padding:6px 4px; text-align:right;">Qty</th>
                            <th style="padding:6px 4px; text-align:right;">Total Weight</th>
                            <th style="padding:6px 4px; text-align:right;">Revenue</th>
                        </tr>
                    </thead>
                    <tbody>`;
                if (!gasItems || gasItems.length === 0) {
                    gasHtml += `<tr><td colspan="5" style="padding:16px; text-align:center; color:#94a3b8;">No gas refill sales recorded.</td></tr>`;
                } else {
                    gasItems.forEach(g => {
                        gasHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:6px 4px; font-weight:600; color:#1e293b;">${g.item_code}</td>
                            <td style="padding:6px 4px; text-align:right; color:#64748b; font-family: monospace;">${g.kg_rating || '--'} Kg</td>
                            <td style="padding:6px 4px; text-align:right; font-family: monospace;">${g.qty}</td>
                            <td style="padding:6px 4px; text-align:right; font-weight:700; color:#ea580c; font-family: monospace;">${flt(g.total_kg).toFixed(0)} Kg</td>
                            <td style="padding:6px 4px; text-align:right; color:#059669; font-weight:600; font-family: monospace;">${format_currency(g.revenue, '')}</td>
                        </tr>`;
                    });
                }
                gasHtml += `</tbody>
                    <tfoot>
                        <tr style="border-top:2px solid #e2e8f0; background:#f8fafc; font-weight:700;">
                            <td colspan="2" style="padding:8px 4px; color:#0f172a; text-transform:uppercase; font-size:11px;">Total</td>
                            <td style="padding:8px 4px; text-align:right; font-family: monospace;">${gasQty.toLocaleString()}</td>
                            <td style="padding:8px 4px; text-align:right; color:#ea580c; font-family: monospace;">${gasKgs.toFixed(0)} Kg</td>
                            <td style="padding:8px 4px; text-align:right; color:#059669; font-family: monospace;">${format_currency(gasRev, 'KES')}</td>
                        </tr>
                    </tfoot>
                </table>`;
                $(wrapper).find('#exec-analytics-gas').html(gasHtml);

                // 4. Render Cylinders
                $(wrapper).find('#exec-cyl-total-badge').text(cylUnits.toLocaleString() + ' Cyl');
                $(wrapper).find('#exec-cyl-rev-badge').text(format_currency(cylRev, 'KES'));
                $(wrapper).find('#exec-cylinders-chart').empty();
                let cylTimeline = (data.cylinders && data.cylinders.timeline_units) ? data.cylinders.timeline_units : ((data.gas && data.gas.timeline_cylinders) ? data.gas.timeline_cylinders : []);
                if (cylTimeline && cylTimeline.some(v => v > 0)) {
                    new frappe.Chart($(wrapper).find('#exec-cylinders-chart')[0], {
                        data: {
                            labels: data.date_labels,
                            datasets: [{ name: "Cylinders (Units)", values: cylTimeline, chartType: 'bar' }]
                        },
                        type: 'bar',
                        height: 180,
                        colors: ['#475569'],
                        tooltipOptions: { formatTooltipY: d => (d || 0) + ' Cyl' }
                    });
                }

                let cylItems = (data.cylinders && data.cylinders.items) ? data.cylinders.items : ((data.gas && data.gas.cylinder_items) ? data.gas.cylinder_items : []);
                let cylHtml = `<table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0; color:#64748b; font-size:10px; text-transform:uppercase;">
                            <th style="padding:6px 4px;">Cylinder Item</th>
                            <th style="padding:6px 4px; text-align:right;">Type</th>
                            <th style="padding:6px 4px; text-align:right;">Units Sold</th>
                            <th style="padding:6px 4px; text-align:right;">Revenue</th>
                        </tr>
                    </thead>
                    <tbody>`;
                if (!cylItems || cylItems.length === 0) {
                    cylHtml += `<tr><td colspan="4" style="padding:16px; text-align:center; color:#94a3b8;">No cylinder sales recorded.</td></tr>`;
                } else {
                    cylItems.forEach(c => {
                        cylHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:6px 4px; font-weight:600; color:#334155;">${c.item_code}</td>
                            <td style="padding:6px 4px; text-align:right; color:#64748b; font-size:10px;">Cylinder</td>
                            <td style="padding:6px 4px; text-align:right; font-family: monospace; font-weight:600;">${c.qty}</td>
                            <td style="padding:6px 4px; text-align:right; color:#059669; font-weight:600; font-family: monospace;">${format_currency(c.revenue, '')}</td>
                        </tr>`;
                    });
                }
                cylHtml += `</tbody>
                    <tfoot>
                        <tr style="border-top:2px solid #e2e8f0; background:#f8fafc; font-weight:700;">
                            <td colspan="2" style="padding:8px 4px; color:#0f172a; text-transform:uppercase; font-size:11px;">Total</td>
                            <td style="padding:8px 4px; text-align:right; font-family: monospace; color:#334155;">${cylUnits.toLocaleString()}</td>
                            <td style="padding:8px 4px; text-align:right; color:#059669; font-family: monospace;">${format_currency(cylRev, 'KES')}</td>
                        </tr>
                    </tfoot>
                </table>`;
                $(wrapper).find('#exec-analytics-cylinders').html(cylHtml);

                // 5. Render Filters & Accessories
                $(wrapper).find('#exec-filters-total-badge').text(filtersUnits.toLocaleString() + ' Units');
                $(wrapper).find('#exec-filters-rev-badge').text(format_currency(filtersRev, 'KES'));
                $(wrapper).find('#exec-filters-chart').empty();
                if (data.accessories && data.accessories.timeline_qty && data.accessories.timeline_qty.some(v => v > 0)) {
                    new frappe.Chart($(wrapper).find('#exec-filters-chart')[0], {
                        data: {
                            labels: data.date_labels,
                            datasets: [{ name: "Filters & Acc (Units)", values: data.accessories.timeline_qty, chartType: 'bar' }]
                        },
                        type: 'bar',
                        height: 180,
                        colors: ['#8b5cf6'],
                        tooltipOptions: { formatTooltipY: d => (d || 0) + ' Units' }
                    });
                }

                let filtersHtml = `<table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0; color:#64748b; font-size:10px; text-transform:uppercase;">
                            <th style="padding:6px 4px;">Item Code</th>
                            <th style="padding:6px 4px; text-align:right;">Group</th>
                            <th style="padding:6px 4px; text-align:right;">Qty</th>
                            <th style="padding:6px 4px; text-align:right;">Revenue</th>
                        </tr>
                    </thead>
                    <tbody>`;
                if (!data.accessories || !data.accessories.items || data.accessories.items.length === 0) {
                    filtersHtml += `<tr><td colspan="4" style="padding:16px; text-align:center; color:#94a3b8;">No filter or accessory sales recorded.</td></tr>`;
                } else {
                    data.accessories.items.forEach(acc => {
                        filtersHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:6px 4px; font-weight:600; color:#1e293b;">${acc.item_code}</td>
                            <td style="padding:6px 4px; text-align:right; color:#64748b; font-size:10px;">${acc.item_group}</td>
                            <td style="padding:6px 4px; text-align:right; font-family: monospace; font-weight:600;">${acc.qty}</td>
                            <td style="padding:6px 4px; text-align:right; color:#059669; font-weight:600; font-family: monospace;">${format_currency(acc.revenue, '')}</td>
                        </tr>`;
                    });
                }
                filtersHtml += `</tbody>
                    <tfoot>
                        <tr style="border-top:2px solid #e2e8f0; background:#f8fafc; font-weight:700;">
                            <td colspan="2" style="padding:8px 4px; color:#0f172a; text-transform:uppercase; font-size:11px;">Total</td>
                            <td style="padding:8px 4px; text-align:right; font-family: monospace;">${filtersUnits.toLocaleString()}</td>
                            <td style="padding:8px 4px; text-align:right; color:#059669; font-family: monospace;">${format_currency(filtersRev, 'KES')}</td>
                        </tr>
                    </tfoot>
                </table>`;
                $(wrapper).find('#exec-analytics-accessories').html(filtersHtml);

                // 6. Render Greasing Services
                $(wrapper).find('#exec-greasing-total-badge').text(greasingVehicles.toLocaleString() + ' Vehicles');
                $(wrapper).find('#exec-greasing-rev-badge').text(format_currency(greasingRev, 'KES'));
                $(wrapper).find('#exec-greasing-chart').empty();
                let greasingTimeline = (data.greasing && data.greasing.timeline_vehicles) ? data.greasing.timeline_vehicles : [];
                if (greasingTimeline && greasingTimeline.some(v => v > 0)) {
                    new frappe.Chart($(wrapper).find('#exec-greasing-chart')[0], {
                        data: {
                            labels: data.date_labels,
                            datasets: [{ name: "Vehicles Serviced", values: greasingTimeline, chartType: 'bar' }]
                        },
                        type: 'bar',
                        height: 180,
                        colors: ['#16a34a'],
                        tooltipOptions: { formatTooltipY: d => (d || 0) + ' Vehicles' }
                    });
                }

                let greasingItems = (data.greasing && data.greasing.items) ? data.greasing.items : [];
                let greasingHtml = `<table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0; color:#64748b; font-size:10px; text-transform:uppercase;">
                            <th style="padding:6px 4px;">Vehicle Type</th>
                            <th style="padding:6px 4px; text-align:right;">Vehicles Serviced</th>
                            <th style="padding:6px 4px; text-align:right;">Avg Rate</th>
                            <th style="padding:6px 4px; text-align:right;">Revenue</th>
                        </tr>
                    </thead>
                    <tbody>`;
                if (!greasingItems || greasingItems.length === 0) {
                    greasingHtml += `<tr><td colspan="4" style="padding:16px; text-align:center; color:#94a3b8;">No greasing sales recorded.</td></tr>`;
                } else {
                    greasingItems.forEach(g => {
                        greasingHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:6px 4px; font-weight:600; color:#1e293b;">${g.vehicle_type}</td>
                            <td style="padding:6px 4px; text-align:right; font-family: monospace; font-weight:600;">${g.vehicles_count}</td>
                            <td style="padding:6px 4px; text-align:right; color:#64748b; font-family: monospace;">${format_currency(g.avg_rate, '')}</td>
                            <td style="padding:6px 4px; text-align:right; color:#059669; font-weight:600; font-family: monospace;">${format_currency(g.revenue, '')}</td>
                        </tr>`;
                    });
                }
                greasingHtml += `</tbody>
                    <tfoot>
                        <tr style="border-top:2px solid #e2e8f0; background:#f8fafc; font-weight:700;">
                            <td style="padding:8px 4px; color:#0f172a; text-transform:uppercase; font-size:11px;">Total</td>
                            <td style="padding:8px 4px; text-align:right; font-family: monospace; color:#15803d;">${greasingVehicles.toLocaleString()}</td>
                            <td style="padding:8px 4px; text-align:right; color:#64748b;">--</td>
                            <td style="padding:8px 4px; text-align:right; color:#059669; font-family: monospace;">${format_currency(greasingRev, 'KES')}</td>
                        </tr>
                    </tfoot>
                </table>`;
                $(wrapper).find('#exec-analytics-greasing').html(greasingHtml);
            }
        }
    });
}

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
    selected_vehicle: '',
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
    $wrapper.off('click', '#debtors-segmented-control .seg-btn').on('click', '#debtors-segmented-control .seg-btn', function(e) {
        e.preventDefault();
        let view = $(this).attr('data-view');
        window.switch_debtors_subview(view);
    });

    // 2. Balances View Controls
    $wrapper.off('input', '#db-search-input').on('input', '#db-search-input', function() {
        window.DEBTORS_STATE.balances_search = $(this).val().toLowerCase().trim();
        window.render_debtors_balances();
    });

    $wrapper.off('click', '.db-status-filter').on('click', '.db-status-filter', function(e) {
        e.preventDefault();
        $wrapper.find('.db-status-filter').removeClass('active').css({ 'background': 'transparent', 'color': '#64748b', 'font-weight': '500' });
        $(this).addClass('active').css({ 'background': '#ffffff', 'color': '#1e293b', 'font-weight': '600' });
        window.DEBTORS_STATE.balances_filter = $(this).attr('data-filter') || 'all';
        window.render_debtors_balances();
    });

    $wrapper.off('change', '#db-sort-select').on('change', '#db-sort-select', function() {
        window.DEBTORS_STATE.balances_sort = $(this).val();
        window.render_debtors_balances();
    });

    // 3. Statement View Controls
    $wrapper.off('change', '#stmt-customer-select').on('change', '#stmt-customer-select', function() {
        let custId = $(this).val();
        window.DEBTORS_STATE.selected_customer_id = custId;
        window.DEBTORS_STATE.selected_vehicle = '';
        window.update_statement_customer_card();
        if (custId) {
            window.load_customer_statement();
        }
    });

    $wrapper.off('change', '#stmt-vehicle-select').on('change', '#stmt-vehicle-select', function() {
        let veh = $(this).val();
        window.filter_customer_statement_by_vehicle(veh);
    });

    $wrapper.off('click', '.stmt-veh-chip').on('click', '.stmt-veh-chip', function(e) {
        e.preventDefault();
        let veh = $(this).attr('data-vehicle') || '';
        window.filter_customer_statement_by_vehicle(veh);
    });

    $wrapper.off('click', '.stmt-preset-btn').on('click', '.stmt-preset-btn', function(e) {
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

    $wrapper.off('change', '#aging-as-of-date').on('change', '#aging-as-of-date', function() {
        window.load_debtors_aging();
    });

    $wrapper.off('input', '#aging-search-input').on('input', '#aging-search-input', function() {
        window.DEBTORS_STATE.aging_search = $(this).val().toLowerCase().trim();
        window.render_debtors_aging();
    });

    $wrapper.off('click', '.aging-risk-filter').on('click', '.aging-risk-filter', function(e) {
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
    $w.find('#tab-customers .view-pane').removeClass('active');
    $w.find('#debtors-' + subview + '-view').addClass('active');

    // Sidebar highlight
    $w.find('.exec-nav-item[data-tab="tab-customers"]').removeClass('active');
    $w.find('.exec-nav-item[data-tab="tab-customers"][data-debtors-view="' + subview + '"]').addClass('active');

    if (subview === 'balances') {
        if (!window.DEBTORS_STATE.debtors || window.DEBTORS_STATE.debtors.length === 0) {
            window.load_debtors_data();
        } else {
            window.render_debtors_balances();
        }
    } else if (subview === 'statement') {
        if (!window.DEBTORS_STATE.debtors || window.DEBTORS_STATE.debtors.length === 0) {
            window.load_debtors_data(function() {
                window.populate_debtor_dropdown();
                let selectedCust = $w.find('#stmt-customer-select').val();
                if (selectedCust) {
                    window.load_customer_statement();
                } else {
                    window.update_statement_customer_card();
                }
            });
        } else {
            window.populate_debtor_dropdown();
            let selectedCust = $w.find('#stmt-customer-select').val();
            if (selectedCust) {
                window.load_customer_statement();
            } else {
                window.update_statement_customer_card();
            }
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
    if (currentVal && list.some(d => d.id === currentVal)) {
        $select.val(currentVal);
    } else {
        $select.val('');
        window.DEBTORS_STATE.selected_customer_id = null;
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
    let station = $w.find('#exec-global-station-select').val() 
        || $w.find('#exec-header-station-select').val() 
        || window.ACTIVE_STATION 
        || '';

    let badgeText = station ? (station === 'RUBIS POA PLACE' ? 'Rubis Poa Place' : station) : 'All Stations (Consolidated)';
    $w.find('#exec-debtors-station-badge').text(badgeText);
    $w.find('#exec-aging-station-badge').text(badgeText);

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
        method: "fuel_management.fuel_management.api.get_debtors_data",
        args: { station: station },
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

    window.DEBTORS_STATE.statement_data = data;

    let allTxns = data.transactions || [];
    let vehMap = {};
    let uniqueVehicles = [];

    allTxns.forEach(t => {
        let v = (t.vehicle_registration || '').trim().toUpperCase();
        if (v) {
            if (!vehMap[v]) {
                vehMap[v] = { plate: v, litres: 0, amount: 0, count: 0 };
                uniqueVehicles.push(v);
            }
            vehMap[v].litres += Number(t.quantity || 0);
            vehMap[v].amount += Number(t.debit || 0);
            vehMap[v].count += 1;
        }
    });
    uniqueVehicles.sort();

    // Populate Vehicle Dropdown Filter
    let currentVeh = window.DEBTORS_STATE.selected_vehicle || '';
    let vehOptions = `<option value="">🚗 All Vehicles / Fleet (${uniqueVehicles.length})</option>`;
    uniqueVehicles.forEach(v => {
        let info = vehMap[v];
        let litStr = info.litres > 0 ? `${info.litres.toLocaleString('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1})}L` : '0L';
        let amtStr = info.amount > 0 ? `KES ${format_num_only(info.amount)}` : 'KES 0.00';
        let sel = (v === currentVeh) ? 'selected' : '';
        vehOptions += `<option value="${escape_debtor_html(v)}" ${sel}>🚗 ${escape_debtor_html(v)} (${litStr} • ${amtStr})</option>`;
    });
    $w.find('#stmt-vehicle-select').html(vehOptions);

    // Build Vehicle Analysis Bar & Chips
    if (uniqueVehicles.length > 0) {
        $w.find('#stmt-vehicle-analysis-bar').show();
        $w.find('#stmt-vehicle-count-badge').text(`${uniqueVehicles.length} Vehicle${uniqueVehicles.length === 1 ? '' : 's'}`);
        
        let chipsHtml = `
            <button type="button" class="btn btn-xs stmt-veh-chip ${!currentVeh ? 'active' : ''}" data-vehicle="" style="padding: 3px 9px; font-size: 0.72rem; font-weight: 700; border-radius: 6px; border: 1px solid ${!currentVeh ? '#2563eb' : '#cbd5e1'}; background: ${!currentVeh ? '#eff6ff' : '#ffffff'}; color: ${!currentVeh ? '#1d4ed8' : '#334155'}; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <span>🚗 All Fleet (${allTxns.length})</span>
            </button>
        `;
        uniqueVehicles.forEach(v => {
            let info = vehMap[v];
            let isAct = (v === currentVeh);
            let litStr = info.litres > 0 ? `${info.litres.toLocaleString('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1})}L` : '0L';
            chipsHtml += `
                <button type="button" class="btn btn-xs stmt-veh-chip ${isAct ? 'active' : ''}" data-vehicle="${escape_debtor_html(v)}" style="padding: 3px 9px; font-size: 0.72rem; font-weight: 600; border-radius: 6px; border: 1px solid ${isAct ? '#2563eb' : '#cbd5e1'}; background: ${isAct ? '#eff6ff' : '#ffffff'}; color: ${isAct ? '#1d4ed8' : '#334155'}; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                    <span style="font-family: monospace; font-weight: 700; color: #0f172a;">🚗 ${escape_debtor_html(v)}</span>
                    <span style="background: #e0f2fe; color: #0369a1; padding: 1px 5px; border-radius: 3px; font-size: 0.65rem; font-family: monospace; font-weight: 700;">${litStr}</span>
                </button>
            `;
        });
        $w.find('#stmt-vehicle-chips').html(chipsHtml);
    } else {
        $w.find('#stmt-vehicle-analysis-bar').hide();
    }

    // Render Table based on selected vehicle
    window.filter_customer_statement_by_vehicle(currentVeh);
};

window.filter_customer_statement_by_vehicle = function(selected_veh) {
    const $w = $(window.DEBTORS_STATE.wrapper || document);
    let data = window.DEBTORS_STATE.statement_data;
    if (!data) return;

    let veh = (selected_veh || '').trim().toUpperCase();
    window.DEBTORS_STATE.selected_vehicle = veh;

    // Update select dropdown
    $w.find('#stmt-vehicle-select').val(veh);

    // Update chip active styles
    $w.find('.stmt-veh-chip').each(function() {
        let chipVeh = ($(this).attr('data-vehicle') || '').trim().toUpperCase();
        if (chipVeh === veh) {
            $(this).addClass('active').css({
                'border-color': '#2563eb',
                'background': '#eff6ff',
                'color': '#1d4ed8',
                'font-weight': '700'
            });
        } else {
            $(this).removeClass('active').css({
                'border-color': '#cbd5e1',
                'background': '#ffffff',
                'color': '#334155',
                'font-weight': '600'
            });
        }
    });

    let allTxns = data.transactions || [];
    let txns = veh ? allTxns.filter(t => (t.vehicle_registration || '').trim().toUpperCase() === veh) : allTxns;

    let openBal = Number(data.opening_balance || 0);
    let totalLitres = txns.reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);
    let periodInvoices = veh ? txns.reduce((sum, t) => sum + (Number(t.debit) || 0), 0) : Number(data.period_invoices != null ? data.period_invoices : (data.period_debits || 0));
    let periodPayments = veh ? txns.reduce((sum, t) => sum + (Number(t.credit) || 0), 0) : Number(data.period_payments != null ? data.period_payments : (data.period_credits || 0));
    let clBal = Number(data.closing_balance != null ? data.closing_balance : (openBal + periodInvoices - periodPayments));

    // Update KPI summary cards
    $w.find('#stmt-kpi-opening').text(format_kes(openBal));
    $w.find('#stmt-kpi-litres').text(`${totalLitres.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} L`);
    if (veh) {
        $w.find('#stmt-kpi-litres-sub').text(`Filtered: ${veh}`);
        $w.find('#stmt-kpi-invoices').text(format_kes(periodInvoices));
    } else {
        $w.find('#stmt-kpi-litres-sub').text('Total Fuel Volume');
        $w.find('#stmt-kpi-invoices').text(format_kes(periodInvoices));
    }
    $w.find('#stmt-kpi-payments').text(format_kes(periodPayments));
    $w.find('#stmt-kpi-closing').text(format_kes(clBal));

    let rowsHtml = '';

    // 1. Opening Balance Row (9 columns)
    rowsHtml += `
        <tr style="background: #f8fafc; font-weight: 700; border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 5px 8px; color: #475569; white-space: nowrap; font-size: 0.75rem; vertical-align: middle;">${data.start_date ? frappe.datetime.str_to_user(data.start_date) : '--'}</td>
            <td style="padding: 5px 8px; vertical-align: middle;">
                <span style="background: #e2e8f0; color: #334155; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 3px; text-transform: uppercase;">OPENING B/F</span>
            </td>
            <td style="padding: 5px 8px; font-family: monospace; color: #64748b; font-size: 0.75rem; vertical-align: middle;">--</td>
            <td style="padding: 5px 8px; font-family: monospace; color: #64748b; font-size: 0.75rem; vertical-align: middle;">--</td>
            <td style="padding: 5px 8px; color: #334155; font-size: 0.78rem; font-style: italic; vertical-align: middle;">Balance brought forward from prior period</td>
            <td style="padding: 5px 8px; text-align: right; font-family: monospace; color: #94a3b8; font-size: 0.78rem; vertical-align: middle;">--</td>
            <td style="padding: 5px 8px; text-align: right; font-family: monospace; color: #94a3b8; font-size: 0.78rem; vertical-align: middle;">--</td>
            <td style="padding: 5px 8px; text-align: right; font-family: monospace; color: #94a3b8; font-size: 0.78rem; vertical-align: middle;">--</td>
            <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-size: 0.84rem; font-weight: 800; color: #0f172a; vertical-align: middle;">${format_num_only(openBal)}</td>
        </tr>
    `;

    // 2. Transaction Rows (9 columns)
    if (txns.length === 0) {
        let msg = veh 
            ? `No transactions found for vehicle ${veh} during this period (${frappe.datetime.str_to_user(data.start_date)} to ${frappe.datetime.str_to_user(data.end_date)}).`
            : `No new invoices or payments recorded during this period (${frappe.datetime.str_to_user(data.start_date)} to ${frappe.datetime.str_to_user(data.end_date)}).`;
        rowsHtml += `
            <tr>
                <td colspan="9" style="padding: 1.25rem; text-align: center; color: #64748b; font-style: italic; font-size: 0.82rem; background: #ffffff;">
                    ${escape_debtor_html(msg)}
                </td>
            </tr>
        `;
    } else {
        txns.forEach(t => {
            let debit = Number(t.debit || 0);
            let credit = Number(t.credit || 0);
            let bal = Number(t.running_balance != null ? t.running_balance : (t.balance != null ? t.balance : 0));
            let qty = Number(t.quantity || 0);

            let badgeHtml = '';
            let refHtml = '';
            let vehHtml = '';
            let detailsHtml = '';

            let isInvoice = (t.voucher_type === 'Shift Invoice' || t.ref_type === 'Shift Invoice');
            let isPayment = (t.voucher_type === 'Customer Payment' || t.ref_type === 'Customer Payment');

            if (isInvoice) {
                badgeHtml = `<span style="background: #e0e7ff; color: #3730a3; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 3px; border: 1px solid #c7d2fe; white-space: nowrap;">⛽ INVOICE</span>`;
                
                let refDisplay = t.entry_number ? `#${escape_debtor_html(t.entry_number)}` : escape_debtor_html(t.reference_no || t.reference || '--');
                let poDisplay = t.purchase_order ? `<div style="font-size: 0.68rem; color: #92400e; font-weight: 600; margin-top: 1px;">PO #${escape_debtor_html(t.purchase_order)}</div>` : '';
                refHtml = `<div style="font-weight: 700; color: #1e293b; font-size: 0.76rem; font-family: monospace;">${refDisplay}</div>${poDisplay}`;

                if (t.vehicle_registration) {
                    vehHtml = `<span style="background: #f1f5f9; color: #0f172a; font-weight: 700; font-family: monospace; font-size: 0.74rem; padding: 2px 6px; border-radius: 4px; border: 1px solid #cbd5e1; display: inline-flex; align-items: center; gap: 3px;">🚗 ${escape_debtor_html(t.vehicle_registration)}</span>`;
                } else {
                    vehHtml = `<span style="color: #94a3b8; font-size: 0.75rem;">--</span>`;
                }

                let itemStr = t.item || 'Fuel Sale';
                let rate = Number(t.rate || 0);
                let rateStr = rate > 0 ? ` <span style="color: #64748b; font-size: 0.72rem; font-family: monospace;">(@ KES ${rate.toFixed(2)})</span>` : '';
                detailsHtml = `<span style="font-weight: 600; color: #1e293b; font-size: 0.78rem;">${escape_debtor_html(itemStr)}${rateStr}</span>`;
            } else if (isPayment) {
                badgeHtml = `<span style="background: #dcfce7; color: #166534; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 3px; border: 1px solid #bbf7d0; white-space: nowrap;">💳 PAYMENT</span>`;
                
                let refDisplay = t.trans_no ? escape_debtor_html(t.trans_no) : escape_debtor_html(t.reference_no || t.reference || '--');
                refHtml = `<div style="font-weight: 700; color: #065f46; font-size: 0.76rem; font-family: monospace;">${refDisplay}</div>`;
                vehHtml = `<span style="color: #94a3b8; font-size: 0.75rem;">--</span>`;

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
                vehHtml = `<span style="color: #94a3b8; font-size: 0.75rem;">--</span>`;
                detailsHtml = `<span style="color: #334155; font-size: 0.78rem;">${escape_debtor_html(t.description || '--').replace(/\s*\|\s*/g, ' <span style="color:#cbd5e1;">•</span> ')}</span>`;
            }

            let litresDisplay = qty > 0 ? `<span style="color: #0284c7; font-family: monospace; font-weight: 700;">${qty.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} L</span>` : `<span style="color: #94a3b8; font-family: monospace;">--</span>`;

            rowsHtml += `
                <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 5px 8px; color: #334155; white-space: nowrap; font-size: 0.75rem; vertical-align: middle;">${t.date ? frappe.datetime.str_to_user(t.date) : '--'}</td>
                    <td style="padding: 5px 8px; vertical-align: middle;">${badgeHtml}</td>
                    <td style="padding: 5px 8px; vertical-align: middle;">${refHtml}</td>
                    <td style="padding: 5px 8px; vertical-align: middle;">${vehHtml}</td>
                    <td style="padding: 5px 8px; vertical-align: middle;">${detailsHtml}</td>
                    <td style="padding: 5px 8px; text-align: right; font-size: 0.78rem; vertical-align: middle;">${litresDisplay}</td>
                    <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-weight: 600; color: #dc2626; font-size: 0.78rem; vertical-align: middle;">${debit > 0 ? format_num_only(debit) : '--'}</td>
                    <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-weight: 600; color: #166534; font-size: 0.78rem; vertical-align: middle;">${credit > 0 ? format_num_only(credit) : '--'}</td>
                    <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-size: 0.84rem; font-weight: 800; color: #0f172a; vertical-align: middle;">${format_num_only(bal)}</td>
                </tr>
            `;
        });
    }

    $w.find('#debtors-statement-body').html(rowsHtml);

    // Update Foot
    $w.find('#debtors-statement-foot').show();
    $w.find('#stmt-foot-date').text(data.end_date ? frappe.datetime.str_to_user(data.end_date) : '--');
    $w.find('#stmt-foot-vehicle-label').text(veh ? veh : 'All Fleet');
    $w.find('#stmt-foot-litres').text(`${totalLitres.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} L`);
    $w.find('#stmt-foot-invoices').text(format_num_only(periodInvoices));
    $w.find('#stmt-foot-payments').text(format_num_only(periodPayments));
    $w.find('#stmt-foot-closing').text(format_num_only(clBal));
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

    let station = $w.find('#exec-global-station-select').val() 
        || $w.find('#exec-header-station-select').val() 
        || window.ACTIVE_STATION 
        || '';

    let badgeText = station ? (station === 'RUBIS POA PLACE' ? 'Rubis Poa Place' : station) : 'All Stations (Consolidated)';
    $w.find('#exec-debtors-station-badge').text(badgeText);
    $w.find('#exec-aging-station-badge').text(badgeText);

    frappe.call({
        method: "fuel_management.fuel_management.page.shift_operation_spa.shift_operation_spa.get_debtors_aging_analysis",
        args: {
            as_of_date: asOfDate,
            station: station
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
                    <div style="font-size: 0.7rem; color: #64748b; line-height: 1.2; margin-top: 1px; display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                        <span>Fleet ID: <b>${escape_debtor_html(c.fleet_id || c.id || 'N/A')}</b></span>
                        ${c.last_clean_bill_date ? `<span style="background: #f0fdf4; color: #166534; padding: 1px 4px; border-radius: 3px; border: 1px solid #bbf7d0;">Clean Bill: <b>${c.last_clean_bill_date}</b></span>` : ''}
                        ${c.credit_days ? `<span style="background: #eff6ff; color: #1e40af; padding: 1px 4px; border-radius: 3px; border: 1px solid #bfdbfe;">Terms: <b>${c.credit_days}d</b></span>` : ''}
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

    let stationName = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) || (frappe.boot && frappe.boot.sysdefaults && frappe.boot.sysdefaults.company) || "RUBIS ENERGY - KILIBET SERVICE STATION";
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
    let veh = window.DEBTORS_STATE.selected_vehicle || '';
    
    frappe.show_alert({ message: "Generating PDF Statement...", indicator: "blue" });
    
    let vehParam = veh ? `&vehicle=${encodeURIComponent(veh)}` : '';
    let url = `/api/method/fuel_management.fuel_management.api.download_debtors_statement_pdf?customer=${encodeURIComponent(cust_id)}&start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}&station=${encodeURIComponent(station)}${vehParam}`;
    
    let link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    let vehSlug = veh ? `_${veh.replace(/\s+/g, '_')}` : '';
    link.download = `Statement_${(data.customer.name || cust_id).replace(/\s+/g, '_')}${vehSlug}_${start_date}_${end_date}.pdf`;
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
    let allTxns = data.transactions || [];
    let veh = (window.DEBTORS_STATE.selected_vehicle || '').trim().toUpperCase();
    let txns = veh ? allTxns.filter(t => (t.vehicle_registration || '').trim().toUpperCase() === veh) : allTxns;

    let totalLitres = txns.reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);
    let periodInvoices = veh ? txns.reduce((sum, t) => sum + (Number(t.debit) || 0), 0) : Number(data.period_invoices != null ? data.period_invoices : (data.period_debits || 0));
    let periodPayments = veh ? txns.reduce((sum, t) => sum + (Number(t.credit) || 0), 0) : Number(data.period_payments != null ? data.period_payments : (data.period_credits || 0));
    let stationName = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) || (frappe.boot && frappe.boot.sysdefaults && frappe.boot.sysdefaults.company) || "RUBIS ENERGY - KILIBET SERVICE STATION";

    let rowsHtml = '';
    // Opening balance
    rowsHtml += `
        <tr style="background: #f8fafc; font-weight: bold;">
            <td>${frappe.datetime.str_to_user(data.start_date)}</td>
            <td>OPENING B/F</td>
            <td>--</td>
            <td>--</td>
            <td>Balance brought forward from prior periods</td>
            <td style="text-align: right;">--</td>
            <td style="text-align: right;">--</td>
            <td style="text-align: right;">--</td>
            <td style="text-align: right; font-family: monospace;">${format_num_only(data.opening_balance)}</td>
        </tr>
    `;

    txns.forEach(t => {
        let deb = Number(t.debit || 0);
        let crd = Number(t.credit || 0);
        let bal = Number(t.running_balance != null ? t.running_balance : (t.balance != null ? t.balance : 0));
        let qty = Number(t.quantity || 0);
        
        let refStr = t.entry_number ? `#${t.entry_number}` : (t.trans_no || t.reference_no || '--');
        if (t.purchase_order) refStr += ` (PO: ${t.purchase_order})`;

        let vehStr = t.vehicle_registration || '--';

        let csa_name = t.csa || '';
        if (window.USERS_LIST && t.csa) {
            let u = window.USERS_LIST.find(x => x.name === t.csa || x.user_id === t.csa);
            if (u) csa_name = u.employee_name || u.full_name || csa_name;
        }

        let descStr = t.description || '--';
        if (t.item) {
            let ratePart = Number(t.rate) > 0 ? ` @ KES ${Number(t.rate).toFixed(2)}` : '';
            descStr = `${t.item}${ratePart}`;
        } else if (t.mode_of_payment) {
            descStr = `${t.mode_of_payment}${csa_name ? ' - Recv: ' + csa_name : ''}${t.memo ? ' - ' + t.memo : ''}`;
        }

        let qtyStr = qty > 0 ? `${qty.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} L` : '--';

        rowsHtml += `
            <tr>
                <td>${frappe.datetime.str_to_user(t.date)}</td>
                <td>${escape_debtor_html(t.voucher_type || t.ref_type || 'TXN')}</td>
                <td><b>${escape_debtor_html(refStr)}</b></td>
                <td style="font-family: monospace; font-weight: bold;">${escape_debtor_html(vehStr)}</td>
                <td>${escape_debtor_html(descStr)}</td>
                <td style="text-align: right; color: #0284c7; font-family: monospace; font-weight: bold;">${qtyStr}</td>
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
            <td style="font-family: monospace; font-weight: bold;">${veh ? escape_debtor_html(veh) : 'All Fleet'}</td>
            <td>TOTALS (VOLUME / INVOICED / PAID / DUE)</td>
            <td style="text-align: right; font-family: monospace; color: #0284c7; font-weight: bold;">${totalLitres.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} L</td>
            <td style="text-align: right; font-family: monospace; color: #dc2626;">${format_num_only(periodInvoices)}</td>
            <td style="text-align: right; font-family: monospace; color: #166534;">${format_num_only(periodPayments)}</td>
            <td style="text-align: right; font-size: 12px; font-family: monospace; color: #1e1b4b;">${format_num_only(data.closing_balance)}</td>
        </tr>
    `;

    let vehSubHeader = veh ? `<div style="font-size: 11px; color: #0284c7; margin-top: 3px;"><b>Filtered Vehicle:</b> ${escape_debtor_html(veh)}</div>` : '';

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Statement of Account - ${escape_debtor_html(cust.name)}</title>
            <style>
                body { font-family: Arial, sans-serif; font-size: 10.5px; color: #111; margin: 20px; line-height: 1.35; }
                .header-table { width: 100%; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; margin-bottom: 12px; }
                .brand-title { font-size: 18px; font-weight: 800; color: #1e3a8a; }
                .doc-title { font-size: 15px; font-weight: bold; text-align: right; color: #0f172a; text-transform: uppercase; }
                .info-grid { width: 100%; margin-bottom: 12px; }
                .info-box { border: 1px solid #cbd5e1; padding: 8px; border-radius: 6px; background: #f8fafc; }
                table.ledger { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 10px; }
                table.ledger th, table.ledger td { border: 1px solid #cbd5e1; padding: 5px 6px; }
                table.ledger th { background: #f1f5f9; text-transform: uppercase; font-size: 9px; }
                .banking-box { margin-top: 15px; border: 1px solid #cbd5e1; padding: 8px; border-radius: 6px; background: #fafafa; font-size: 9.5px; }
                @media print { @page { size: A4 portrait; margin: 10mm; } }
            </style>
        </head>
        <body>
            <table class="header-table">
                <tr>
                    <td style="vertical-align: top;">
                        <div class="brand-title">${stationName}</div>
                        <div style="font-size: 9.5px; color: #555; margin-top: 3px;">
                            Accounts Receivable Division<br>
                            Eldoret, Kenya<br>
                            Email: accounts@kilibetcore.co.ke
                        </div>
                    </td>
                    <td style="vertical-align: top; text-align: right;">
                        <div class="doc-title">Statement of Account</div>
                        <div style="font-size: 10px; color: #333; margin-top: 2px;">
                            <b>Period:</b> ${frappe.datetime.str_to_user(data.start_date)} &mdash; ${frappe.datetime.str_to_user(data.end_date)}<br>
                            <b>Date Printed:</b> ${new Date().toLocaleDateString()}
                        </div>
                        ${vehSubHeader}
                        <div style="margin-top: 4px; font-size: 12px; font-weight: bold; color: #1e3a8a;">
                            Closing Due: ${format_kes(data.closing_balance)}
                        </div>
                    </td>
                </tr>
            </table>

            <table class="info-grid">
                <tr>
                    <td style="width: 52%; vertical-align: top; padding-right: 8px;">
                        <div class="info-box">
                            <div style="font-size: 8.5px; font-weight: bold; color: #64748b; text-transform: uppercase;">BILL TO CUSTOMER:</div>
                            <div style="font-size: 13px; font-weight: bold; color: #0f172a; margin: 2px 0;">${escape_debtor_html(cust.name)}</div>
                            <div style="font-size: 9.5px; color: #475569;">
                                <b>Account / Fleet ID:</b> ${escape_debtor_html(cust.fleet_id || cust.id || 'N/A')}<br>
                                ${cust.address && cust.address !== 'N/A' ? `<b>Address:</b> ${escape_debtor_html(cust.address)}<br>` : ''}
                                ${cust.phone && cust.phone !== 'N/A' ? `<b>Phone:</b> ${escape_debtor_html(cust.phone)}` : ''}
                            </div>
                        </div>
                    </td>
                    <td style="width: 48%; vertical-align: top;">
                        <div class="info-box">
                            <div style="font-size: 8.5px; font-weight: bold; color: #64748b; text-transform: uppercase;">ACCOUNT SUMMARY:</div>
                            <table style="width: 100%; font-size: 9.5px; margin-top: 2px;">
                                <tr><td><b>Credit Limit:</b></td><td style="text-align: right; font-family: monospace;">${format_kes(cust.credit_limit)}</td></tr>
                                <tr><td><b>Opening Balance (B/F):</b></td><td style="text-align: right; font-family: monospace;">${format_kes(data.opening_balance)}</td></tr>
                                <tr><td><b>Total Fuel Litres:</b></td><td style="text-align: right; font-family: monospace; color:#0284c7; font-weight: bold;">${totalLitres.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} L</td></tr>
                                <tr><td><b>Total Invoices (Period):</b></td><td style="text-align: right; font-family: monospace; color:#dc2626;">+ ${format_kes(periodInvoices)}</td></tr>
                                <tr><td><b>Total Payments (Period):</b></td><td style="text-align: right; font-family: monospace; color:#166534;">- ${format_kes(periodPayments)}</td></tr>
                                <tr style="border-top: 1px solid #cbd5e1; font-weight: bold;"><td><b>Total Amount Due:</b></td><td style="text-align: right; font-family: monospace; color:#1e3a8a; font-size: 10.5px;">${format_kes(data.closing_balance)}</td></tr>
                            </table>
                        </div>
                    </td>
                </tr>
            </table>

            <table class="ledger">
                <thead>
                    <tr>
                        <th style="width: 65px;">Date</th>
                        <th style="width: 75px;">Type</th>
                        <th style="width: 80px;">Reference #</th>
                        <th style="width: 85px;">Vehicle Plate</th>
                        <th>Description / Details</th>
                        <th style="text-align: right; width: 65px; color: #0284c7;">Litres (L)</th>
                        <th style="text-align: right; width: 75px; color: #dc2626;">Debit (+)</th>
                        <th style="text-align: right; width: 75px; color: #166534;">Credit (-)</th>
                        <th style="text-align: right; width: 85px;">Balance</th>
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

            <div style="margin-top: 20px; display: flex; justify-content: space-between; font-size: 9.5px;">
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
    let stationName = (window.ACTIVE_SHIFT && window.ACTIVE_SHIFT.station) || (frappe.boot && frappe.boot.sysdefaults && frappe.boot.sysdefaults.company) || "RUBIS ENERGY - KILIBET SERVICE STATION";

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
    let allTxns = data.transactions || [];
    let veh = (window.DEBTORS_STATE.selected_vehicle || '').trim().toUpperCase();
    let txns = veh ? allTxns.filter(t => (t.vehicle_registration || '').trim().toUpperCase() === veh) : allTxns;

    let totalLitres = txns.reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);
    let periodInvoices = veh ? txns.reduce((sum, t) => sum + (Number(t.debit) || 0), 0) : Number(data.period_invoices != null ? data.period_invoices : (data.period_debits || 0));
    let periodPayments = veh ? txns.reduce((sum, t) => sum + (Number(t.credit) || 0), 0) : Number(data.period_payments != null ? data.period_payments : (data.period_credits || 0));

    let csv = `Statement of Account: ${cust.name || ''} (${cust.fleet_id || cust.id || ''})\n`;
    csv += `Period: ${data.start_date} to ${data.end_date}\n`;
    if (veh) csv += `Vehicle Filter: ${veh}\n`;
    csv += `Total Fuel Volume: ${totalLitres.toFixed(2)} L\n\n`;

    csv += "Date,Voucher Type,Reference No,Vehicle Plate,Description,Litres (L),Debit,Credit,Running Balance\n";
    csv += `${data.start_date},Opening Balance,--,--,Balance brought forward,0.00,0.00,0.00,${data.opening_balance}\n`;

    txns.forEach(t => {
        let refStr = t.entry_number ? `#${t.entry_number}` : (t.trans_no || t.reference_no || '');
        if (t.purchase_order) refStr += ` (PO: ${t.purchase_order})`;
        let csa_name = t.csa || '';
        if (window.USERS_LIST && t.csa) {
            let u = window.USERS_LIST.find(x => x.name === t.csa || x.user_id === t.csa);
            if (u) csa_name = u.employee_name || u.full_name || csa_name;
        }

        let descStr = t.description || '';
        if (t.item) {
            let ratePart = Number(t.rate) > 0 ? ` @ KES ${Number(t.rate).toFixed(2)}` : '';
            descStr = `${t.item}${ratePart}`;
        } else if (t.mode_of_payment) {
            descStr = `${t.mode_of_payment}${csa_name ? ' - Recv: ' + csa_name : ''}${t.memo ? ' - ' + t.memo : ''}`;
        }

        let desc = `"${descStr.replace(/"/g, '""')}"`;
        let ref = `"${refStr.replace(/"/g, '""')}"`;
        let vehPlate = `"${(t.vehicle_registration || '').replace(/"/g, '""')}"`;
        let qty = Number(t.quantity || 0).toFixed(2);
        let bal = t.running_balance != null ? t.running_balance : (t.balance || 0);
        csv += `${t.date},"${t.voucher_type || t.ref_type || 'TXN'}",${ref},${vehPlate},${desc},${qty},${t.debit || 0},${t.credit || 0},${bal}\n`;
    });

    csv += `${data.end_date},Closing Balance,--,${veh || 'All Fleet'},Total amount due / Volume,${totalLitres.toFixed(2)},${periodInvoices},${periodPayments},${data.closing_balance}\n`;

    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    let custSlug = (cust.name || 'Debtor').replace(/[^a-zA-Z0-9]/g, '_');
    let vehSlug = veh ? `_${veh.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    link.download = `Statement_${custSlug}${vehSlug}_${data.start_date}_${data.end_date}.csv`;
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






function apply_inventory_zoom(wrapper, level) {
    $(wrapper).find('#zoom-level').text(level + '%');
    let scale = level / 100;
    $(wrapper).find('.new-inv-table-unified').css('font-size', (0.875 * scale) + 'rem');
    $(wrapper).find('.new-inv-table-unified .header-main th').css('font-size', (0.75 * scale) + 'rem');
    $(wrapper).find('.new-inv-table-unified .header-sub th').css('font-size', (0.75 * scale) + 'rem');
}


function get_stock_group_priority(groupName) {
    let g = (groupName || "").toUpperCase().trim();
    if (g.includes("LUBE") || g.includes("LUBRICANT") || g.includes("OIL")) return 1;
    if (g === "GAS" || (g.includes("GAS") && !g.includes("CYLINDER"))) return 2;
    if (g.includes("CYLINDER")) return 3;
    if (g.includes("ACCESSOR")) return 4;
    if (g.includes("FILTER")) return 5;
    return 6;
}

function sort_stock_groups(groupList) {
    return (groupList || []).slice().sort((a, b) => {
        let pA = get_stock_group_priority(a);
        let pB = get_stock_group_priority(b);
        if (pA !== pB) return pA - pB;
        return a.localeCompare(b);
    });
}

function get_item_sort_key(item) {
    let name = String((item && (item.item_name || item.item_code || item.name)) || '').toUpperCase().trim();
    let match = name.match(/(\d+(?:\.\d+)?)\s*KG/);
    if (match) {
        let weight = parseFloat(match[1]) || 0;
        return { has_kg: 0, weight: weight, name: name };
    }
    return { has_kg: 1, weight: 0, name: name };
}

function sort_stock_items(itemList) {
    return (itemList || []).slice().sort((a, b) => {
        let kA = get_item_sort_key(a);
        let kB = get_item_sort_key(b);
        if (kA.has_kg !== kB.has_kg) return kA.has_kg - kB.has_kg;
        if (kA.weight !== kB.weight) return kA.weight - kB.weight;
        return kA.name.localeCompare(kB.name);
    });
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
            station_id: $wrapper.find("#inventory-station-select").val() || null,
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
                
                sort_stock_groups(Object.keys(data)).forEach(group => {
                    // Group Header
                    html += `
                        <tr class="row-group-header">
                            <td colspan="10">${group.toUpperCase()}</td>
                        </tr>
                    `;
                    
                    sort_stock_items(data[group]).forEach(row => {
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
// TOP-UPS HOLDING ACCOUNT & STATEMENT RECONCILIATION MODULE
// =========================================================

window.TOPUPS_STATE = {
    status: 'all', // 'all', 'pending', 'reconciled'
    search: '',
    selected_items: new Set(),
    statement: []
};

function init_topups_holding_tab(wrapper) {
    if (!window.TOPUPS_STATE) {
        window.TOPUPS_STATE = {
            status: 'all',
            search: '',
            selected_items: new Set(),
            statement: []
        };
    }

    // Status filter buttons
    $(wrapper).off('click', '.topup-status-filter').on('click', '.topup-status-filter', function(e) {
        e.preventDefault();
        $(wrapper).find('.topup-status-filter').removeClass('active').css({
            'background': 'transparent',
            'color': '#64748b',
            'box-shadow': 'none'
        });
        let filter = $(this).data('filter') || 'all';
        let activeColor = filter === 'pending' ? '#b45309' : (filter === 'reconciled' ? '#15803d' : '#1e293b');
        $(this).addClass('active').css({
            'background': '#ffffff',
            'color': activeColor,
            'box-shadow': '0 1px 2px rgba(0,0,0,0.05)'
        });
        window.TOPUPS_STATE.status = filter;
        load_topups_statement(wrapper);
    });

    // Search input (debounced)
    let searchTimeout = null;
    $(wrapper).off('input', '#topup-search-input').on('input', '#topup-search-input', function() {
        clearTimeout(searchTimeout);
        let val = $(this).val();
        searchTimeout = setTimeout(function() {
            window.TOPUPS_STATE.search = val;
            load_topups_statement(wrapper);
        }, 300);
    });

    // Refresh button
    $(wrapper).off('click', '#btn-refresh-topups').on('click', '#btn-refresh-topups', function(e) {
        e.preventDefault();
        load_topups_statement(wrapper);
    });

    // Select-all checkbox
    $(wrapper).off('change', '#topups-select-all').on('change', '#topups-select-all', function() {
        let checked = $(this).is(':checked');
        let state = window.TOPUPS_STATE;
        $(wrapper).find('.topup-row-check').each(function() {
            let name = $(this).data('name');
            $(this).prop('checked', checked);
            if (name) {
                if (checked) state.selected_items.add(name);
                else state.selected_items.delete(name);
            }
        });
        update_topups_selection_ui(wrapper);
    });

    // Individual row checkbox
    $(wrapper).off('change', '.topup-row-check').on('change', '.topup-row-check', function() {
        let name = $(this).data('name');
        let state = window.TOPUPS_STATE;
        if (name) {
            if ($(this).is(':checked')) state.selected_items.add(name);
            else state.selected_items.delete(name);
        }
        update_topups_selection_ui(wrapper);
    });

    // Row-level reconcile button
    $(wrapper).off('click', '.btn-reconcile-single-topup').on('click', '.btn-reconcile-single-topup', function(e) {
        e.preventDefault();
        let name = $(this).data('name');
        let state = window.TOPUPS_STATE;
        let row = (state.statement || []).find(r => (r.entry_name || r.name) === name);
        if (row) {
            open_topup_reconciliation_modal(wrapper, [row]);
        }
    });

    // Batch reconcile selected
    $(wrapper).off('click', '#btn-reconcile-selected-topups').on('click', '#btn-reconcile-selected-topups', function(e) {
        e.preventDefault();
        let state = window.TOPUPS_STATE;
        let selectedNames = Array.from(state.selected_items);
        if (!selectedNames.length) {
            frappe.msgprint(__('Please select at least one pending top-up to reconcile.'));
            return;
        }
        let selectedRows = (state.statement || []).filter(r => selectedNames.includes(r.entry_name || r.name));
        open_topup_reconciliation_modal(wrapper, selectedRows);
    });

    // Main KPI card reconcile button
    $(wrapper).off('click', '#btn-reconcile-topups').on('click', '#btn-reconcile-topups', function(e) {
        e.preventDefault();
        let state = window.TOPUPS_STATE;
        let pendingRows = (state.statement || []).filter(r => !r.is_opening && r.supplier !== 'RECONCILIATION' && !r.is_reconciled);
        open_topup_reconciliation_modal(wrapper, pendingRows);
    });
}

function update_topups_selection_ui(wrapper) {
    let state = window.TOPUPS_STATE;
    if (!state) return;

    let selectedCount = state.selected_items.size;
    $(wrapper).find('#topups-selected-count').text(selectedCount);

    if (selectedCount > 0) {
        $(wrapper).find('#btn-reconcile-selected-topups').css('display', 'inline-flex');
    } else {
        $(wrapper).find('#btn-reconcile-selected-topups').hide();
    }

    let checkableRows = $(wrapper).find('.topup-row-check');
    if (checkableRows.length > 0 && checkableRows.filter(':checked').length === checkableRows.length) {
        $(wrapper).find('#topups-select-all').prop('checked', true);
    } else {
        $(wrapper).find('#topups-select-all').prop('checked', false);
    }
}

function load_topups_statement(wrapper) {
    if (!window.TOPUPS_STATE) {
        window.TOPUPS_STATE = {
            status: 'all',
            search: '',
            selected_items: new Set(),
            statement: []
        };
    }
    let state = window.TOPUPS_STATE;
    let filters = get_date_filters(wrapper);
    filters.status = state.status;
    filters.search = state.search;

    $(wrapper).find('#exec-topups-table tbody').html('<tr><td colspan="11" style="text-align: center; padding: 24px; color: #64748b;">Loading statement...</td></tr>');

    frappe.call({
        method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_topup_statement",
        args: filters,
        callback: function(r) {
            let res = r.message || {};
            let stmt = Array.isArray(res) ? res : (res.statement || []);
            let pending_amount = res.pending_amount !== undefined ? res.pending_amount : 0;
            let pending_count = res.pending_count !== undefined ? res.pending_count : 0;
            let period_topups_sum = res.period_topups_sum !== undefined ? res.period_topups_sum : 0;
            state.statement = stmt;

            // Update KPI and badges
            $(wrapper).find('#exec-holding-balance').text(format_currency(pending_amount, "KES"));
            $(wrapper).find('#exec-holding-subtitle').html(`<strong>${pending_count}</strong> Pending Top-up(s) awaiting reconciliation`);
            $(wrapper).find('#topup-filter-pending-count').text(pending_count);
            $(wrapper).find('#exec-topups-total').text(format_currency(period_topups_sum, "KES"));

            let html = '';
            if (stmt && stmt.length > 0) {
                stmt.forEach(row => {
                    let amount = parseFloat(row.amount) || 0;
                    let run_bal = parseFloat(row.running_balance) || 0;
                    let isReconciled = Boolean(row.is_reconciled);
                    let isDeduction = row.supplier === 'RECONCILIATION' || amount < 0;
                    let isOpening = Boolean(row.is_opening);

                    let entryName = row.entry_name || row.name || '';
                    let isCheckable = !isOpening && !isDeduction && !isReconciled;
                    let isChecked = isCheckable && state.selected_items.has(entryName);

                    let checkboxHtml = isCheckable ?
                        `<input type="checkbox" class="topup-row-check" data-name="${frappe.utils.escape_html(entryName)}" ${isChecked ? 'checked' : ''} style="cursor: pointer;">` :
                        '';

                    let link = '';
                    if (isOpening) {
                        link = `<span style="font-weight: 700; color: #64748b;">${entryName}</span>`;
                    } else if (entryName.startsWith('JV-')) {
                        link = `<a href="/app/journal-entry/${entryName}" target="_blank" style="color: #0284c7; font-weight: 600; text-decoration: none;">${entryName}</a>`;
                    } else {
                        link = `<a href="/app/station-supplier-top-up/${entryName}" target="_blank" style="color: #0ea5e9; font-weight: 600; text-decoration: none;">${entryName}</a>`;
                    }

                    let amountColor = isOpening ? '#64748b' : (amount < 0 ? '#dc2626' : '#16a34a');

                    // Status Badge
                    let statusBadge = '';
                    if (isOpening) {
                        statusBadge = '<span style="color: #94a3b8; font-size: 11px;">-</span>';
                    } else if (isDeduction) {
                        statusBadge = '<span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;">Reconciliation JV</span>';
                    } else if (isReconciled) {
                        statusBadge = `<span style="background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;" title="Reconciled by ${frappe.utils.escape_html(row.reconciled_by || '')} on ${row.reconciled_date || ''}">🟢 Reconciled</span>`;
                    } else {
                        statusBadge = '<span style="background: #fef3c7; color: #b45309; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;">🟡 Pending</span>';
                    }

                    // Action Button
                    let actionHtml = '';
                    if (isOpening) {
                        actionHtml = '-';
                    } else if (isReconciled && row.reconciled_jv) {
                        actionHtml = `<a href="/app/journal-entry/${row.reconciled_jv}" target="_blank" class="btn btn-xs" style="padding: 2px 8px; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #0284c7; text-decoration: none; display: inline-flex; align-items: center; gap: 3px;" title="View Journal Entry">📄 View JV</a>`;
                    } else if (!isReconciled && !isDeduction) {
                        actionHtml = `<button type="button" class="btn btn-xs btn-reconcile-single-topup" data-name="${frappe.utils.escape_html(entryName)}" style="padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 4px; background: #f59e0b; color: #fff; border: none; cursor: pointer;" title="Reconcile and post to supplier account">⚡ Reconcile</button>`;
                    } else {
                        actionHtml = '-';
                    }

                    html += `<tr style="border-bottom: 1px solid #f1f5f9; ${isOpening ? 'background: #f8fafc; font-style: italic;' : ''}">
                        <td style="padding: 10px 12px; text-align: center;">${checkboxHtml}</td>
                        <td style="padding: 10px 12px; white-space: nowrap;">${row.date ? frappe.datetime.str_to_user(row.date) : '-'}</td>
                        <td style="padding: 10px 12px; white-space: nowrap;">${link}</td>
                        <td style="padding: 10px 12px; font-weight: 500;">${row.station || '-'}</td>
                        <td style="padding: 10px 12px;">${row.supplier || '-'}</td>
                        <td style="padding: 10px 12px; font-size: 11px; color: #64748b;">${row.mode || '-'}</td>
                        <td style="padding: 10px 12px; font-family: monospace; font-size: 11px;">${row.ref || '-'}</td>
                        <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-weight: 600; color: ${amountColor};">${format_currency(amount, "KES")}</td>
                        <td style="padding: 10px 12px; text-align: center;">${statusBadge}</td>
                        <td style="padding: 10px 12px; text-align: center;">${actionHtml}</td>
                        <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-weight: 600; color: #0284c7;">${format_currency(run_bal, "KES")}</td>
                    </tr>`;
                });
            } else {
                html = '<tr><td colspan="11" style="text-align: center; padding: 24px; color: #64748b;">No top-up entries found matching criteria.</td></tr>';
            }

            $(wrapper).find('#exec-topups-table tbody').html(html);
            update_topups_selection_ui(wrapper);
        }
    });
}

function open_topup_reconciliation_modal(wrapper, topup_records) {
    topup_records = topup_records || [];
    let state = window.TOPUPS_STATE;

    let defaultStation = '';
    if (topup_records.length > 0 && topup_records[0].station) {
        defaultStation = topup_records[0].station;
    } else if (window.ACTIVE_STATION && window.ACTIVE_STATION !== 'ALL') {
        defaultStation = window.ACTIVE_STATION;
    }

    let defaultSupplier = 'RUBIS KENYA';
    if (topup_records.length > 0 && topup_records[0].supplier && topup_records[0].supplier !== 'RECONCILIATION') {
        defaultSupplier = topup_records[0].supplier;
    }

    let totalAmount = topup_records.reduce((acc, r) => acc + (parseFloat(r.amount) || 0), 0);
    if (totalAmount <= 0 && state && state.statement) {
        let pending = state.statement.filter(r => !r.is_opening && r.supplier !== 'RECONCILIATION' && !r.is_reconciled);
        if (pending.length > 0) {
            topup_records = pending;
            totalAmount = pending.reduce((acc, r) => acc + (parseFloat(r.amount) || 0), 0);
            if (!defaultStation && pending[0].station) defaultStation = pending[0].station;
            if (pending[0].supplier && pending[0].supplier !== 'RECONCILIATION') defaultSupplier = pending[0].supplier;
        }
    }

    let defaultRef = '';
    if (topup_records.length > 0) {
        let refs = topup_records.map(r => r.ref).filter(Boolean);
        defaultRef = refs.length > 0 ? refs.join(', ').substring(0, 80) : `STMT-RECON-${frappe.datetime.get_today()}`;
    } else {
        defaultRef = `STMT-RECON-${frappe.datetime.get_today()}`;
    }

    let summaryHtml = `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
                <span style="color: #64748b;">Station:</span>
                <strong style="color: #0f172a;">${defaultStation || 'All / Selected Station'}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
                <span style="color: #64748b;">Supplier:</span>
                <strong style="color: #0f172a;">${defaultSupplier}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
                <span style="color: #64748b;">Top-ups Selected:</span>
                <span style="font-weight: 700; color: #b45309;">${topup_records.length} entry(ies)</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 800; border-top: 1px dashed #cbd5e1; padding-top: 8px; margin-top: 8px;">
                <span style="color: #0f172a;">Total Holding to Clear:</span>
                <span style="font-family: monospace; color: #16a34a; font-size: 15px;">${format_currency(totalAmount, "KES")}</span>
            </div>
            <div style="margin-top: 10px; padding: 8px 10px; border-radius: 6px; background: #eff6ff; border: 1px solid #bfdbfe; font-size: 11px; color: #1e40af; line-height: 1.4;">
                <strong>Accounting Posting:</strong><br>
                • <strong>Debit:</strong> Station Top-Up Holding Account (Clears Holding Asset balance)<br>
                • <strong>Credit:</strong> Creditors / Supplier Account (Party: ${defaultSupplier})
            </div>
        </div>
    `;

    let d = new frappe.ui.Dialog({
        title: __('Reconcile Top-Up with Supplier Statement'),
        fields: [
            {
                fieldname: 'summary_html',
                fieldtype: 'HTML',
                options: summaryHtml
            },
            {
                label: __('Station'),
                fieldname: 'station',
                fieldtype: 'Link',
                options: 'Fuel Station',
                default: defaultStation,
                reqd: 1
            },
            {
                label: __('Supplier'),
                fieldname: 'supplier',
                fieldtype: 'Link',
                options: 'Supplier',
                default: defaultSupplier,
                reqd: 1
            },
            {
                label: __('Supplier Account (Credit Account)'),
                fieldname: 'credit_account',
                fieldtype: 'Link',
                options: 'Account',
                default: 'Creditors - KIL',
                get_query: function() {
                    return { filters: { is_group: 0 } };
                },
                reqd: 1,
                description: __('Supplier Payable Account (e.g. Creditors - KIL) or Bank Account')
            },
            {
                label: __('Amount Credited / Confirmed on Statement (KES)'),
                fieldname: 'amount',
                fieldtype: 'Currency',
                default: totalAmount,
                reqd: 1
            },
            {
                label: __('Statement Reconciliation Date'),
                fieldname: 'date',
                fieldtype: 'Date',
                default: frappe.datetime.get_today(),
                reqd: 1
            },
            {
                label: __('Statement Reference / RRN / Batch #'),
                fieldname: 'reference',
                fieldtype: 'Data',
                default: defaultRef,
                reqd: 1
            }
        ],
        primary_action_label: __('Confirm & Post to Supplier Account'),
        primary_action: function(vals) {
            let topup_names = (topup_records || []).map(r => r.entry_name || r.name).filter(Boolean);
            frappe.call({
                method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.create_topup_deduction",
                args: {
                    station: vals.station,
                    amount: vals.amount,
                    supplier: vals.supplier,
                    credit_account: vals.credit_account,
                    date: vals.date,
                    reference: vals.reference,
                    topup_names: JSON.stringify(topup_names)
                },
                freeze: true,
                freeze_message: __("Reconciling & posting to supplier account..."),
                callback: function(r) {
                    if (!r.exc && r.message && (r.message.status === 'success' || r.message.jv)) {
                        frappe.show_alert({
                            message: (r.message.message || 'Top-up reconciled successfully') + ` (${r.message.jv})`,
                            indicator: 'green'
                        }, 7);
                        d.hide();
                        if (window.TOPUPS_STATE) {
                            topup_names.forEach(n => window.TOPUPS_STATE.selected_items.delete(n));
                        }
                        load_topups_statement(wrapper);
                        load_dashboard_data(wrapper);
                    } else {
                        let msg = (r && r.message && r.message.message) ? r.message.message : 'Failed to reconcile top-up.';
                        frappe.msgprint(__('Reconciliation failed: ') + msg);
                    }
                }
            });
        }
    });

    d.show();
}

/* =========================================================================
   RECONCILIATIONS MODULE (Customer Payments & Station Cards)
   ========================================================================= */

window.RECON_STATE = {
    initialized: false,
    reconciliation_type: "customer_payments", // "customer_payments" or "station_cards"
    from_date: "",
    to_date: "",
    status: "pending", // "all", "pending", "reconciled"
    party_or_card: "ALL",
    search: "",
    page: 1,
    page_length: 50,
    total_pages: 1,
    selected_items: new Set(),
    search_timer: null,
    loading: false
};

function init_reconciliation_module(wrapper) {
    let $w = $(wrapper);
    if (window.RECON_STATE.initialized) return;
    window.RECON_STATE.initialized = true;

    // Set default dates: first day of current month to today
    let today = frappe.datetime.get_today();
    let parts = today.split("-");
    let firstOfMonth = parts[0] + "-" + parts[1] + "-01";
    
    window.RECON_STATE.from_date = firstOfMonth;
    window.RECON_STATE.to_date = today;

    $w.find("#recon-from-date").val(firstOfMonth);
    $w.find("#recon-to-date").val(today);
    $w.find("#recon-status-filter").val("pending");

    // 1. Tab Switch (Customer Payments <-> Station Cards)
    $w.off("click", "#recon-segmented-control .seg-btn").on("click", "#recon-segmented-control .seg-btn", function(e) {
        e.preventDefault();
        let reconType = $(this).attr("data-recon-type");
        if (reconType === window.RECON_STATE.reconciliation_type) return;

        $w.find("#recon-segmented-control .seg-btn").removeClass("active");
        $(this).addClass("active");

        window.RECON_STATE.reconciliation_type = reconType;
        window.RECON_STATE.party_or_card = "ALL";
        window.RECON_STATE.page = 1;
        window.RECON_STATE.selected_items.clear();
        update_recon_bulk_ui($w);

        // Update party label
        if (reconType === "customer_payments") {
            $w.find("#recon-party-label").text("Customer:");
        } else {
            $w.find("#recon-party-label").text("Card Type:");
        }

        load_reconciliation_data(wrapper, true);
    });

    // 2. Date Inputs Change
    $w.off("change", "#recon-from-date, #recon-to-date").on("change", "#recon-from-date, #recon-to-date", function() {
        window.RECON_STATE.from_date = $w.find("#recon-from-date").val();
        window.RECON_STATE.to_date = $w.find("#recon-to-date").val();
        $w.find(".recon-preset-btn").removeClass("active");
        window.RECON_STATE.page = 1;
        load_reconciliation_data(wrapper);
    });

    // 3. Date Presets
    $w.off("click", ".recon-preset-btn").on("click", ".recon-preset-btn", function(e) {
        e.preventDefault();
        $w.find(".recon-preset-btn").removeClass("active");
        $(this).addClass("active");
        let preset = $(this).attr("data-preset");
        let today = frappe.datetime.get_today();

        if (preset === "today") {
            window.RECON_STATE.from_date = today;
            window.RECON_STATE.to_date = today;
        } else if (preset === "yesterday") {
            let yest = frappe.datetime.add_days(today, -1);
            window.RECON_STATE.from_date = yest;
            window.RECON_STATE.to_date = yest;
        } else if (preset === "week") {
            window.RECON_STATE.from_date = frappe.datetime.add_days(today, -7);
            window.RECON_STATE.to_date = today;
        } else if (preset === "month") {
            let p = today.split("-");
            window.RECON_STATE.from_date = p[0] + "-" + p[1] + "-01";
            window.RECON_STATE.to_date = today;
        } else if (preset === "all") {
            window.RECON_STATE.from_date = "";
            window.RECON_STATE.to_date = today;
        }

        $w.find("#recon-from-date").val(window.RECON_STATE.from_date);
        $w.find("#recon-to-date").val(window.RECON_STATE.to_date);
        window.RECON_STATE.page = 1;
        load_reconciliation_data(wrapper);
    });

    // 4. Status Filter Change
    $w.off("change", "#recon-status-filter").on("change", "#recon-status-filter", function() {
        window.RECON_STATE.status = $(this).val();
        window.RECON_STATE.page = 1;
        load_reconciliation_data(wrapper);
    });

    // 5. Party/Card Dropdown Change
    $w.off("change", "#recon-party-filter").on("change", "#recon-party-filter", function() {
        window.RECON_STATE.party_or_card = $(this).val();
        window.RECON_STATE.page = 1;
        load_reconciliation_data(wrapper);
    });

    // 6. Search Input Debounce
    $w.off("input", "#recon-search-input").on("input", "#recon-search-input", function() {
        let val = $(this).val();
        clearTimeout(window.RECON_STATE.search_timer);
        window.RECON_STATE.search_timer = setTimeout(function() {
            window.RECON_STATE.search = val;
            window.RECON_STATE.page = 1;
            load_reconciliation_data(wrapper);
        }, 300);
    });

    // 7. Refresh Button
    $w.off("click", "#btn-recon-refresh").on("click", "#btn-recon-refresh", function(e) {
        e.preventDefault();
        load_reconciliation_data(wrapper, true);
    });

    // 8. Pagination Controls
    $w.off("click", "#btn-recon-prev-page").on("click", "#btn-recon-prev-page", function(e) {
        e.preventDefault();
        if (window.RECON_STATE.page > 1) {
            window.RECON_STATE.page--;
            load_reconciliation_data(wrapper);
        }
    });

    $w.off("click", "#btn-recon-next-page").on("click", "#btn-recon-next-page", function(e) {
        e.preventDefault();
        if (window.RECON_STATE.page < window.RECON_STATE.total_pages) {
            window.RECON_STATE.page++;
            load_reconciliation_data(wrapper);
        }
    });

    // 9. Master Select Checkbox
    $w.off("change", "#recon-master-checkbox").on("change", "#recon-master-checkbox", function() {
        let checked = $(this).is(":checked");
        $w.find(".recon-row-select").each(function() {
            let name = $(this).attr("data-name");
            $(this).prop("checked", checked);
            if (checked) {
                window.RECON_STATE.selected_items.add(name);
            } else {
                window.RECON_STATE.selected_items.delete(name);
            }
        });
        update_recon_bulk_ui($w);
    });

    // 10. Row Select Checkbox
    $w.off("change", ".recon-row-select").on("change", ".recon-row-select", function() {
        let name = $(this).attr("data-name");
        if ($(this).is(":checked")) {
            window.RECON_STATE.selected_items.add(name);
        } else {
            window.RECON_STATE.selected_items.delete(name);
        }
        update_recon_bulk_ui($w);
    });

    // 11. Row Reconcile Action Button (Single toggle)
    $w.off("click", ".recon-row-toggle").on("click", ".recon-row-toggle", function(e) {
        e.preventDefault();
        let $btn = $(this);
        let name = $btn.attr("data-name");
        let currentStatus = parseInt($btn.attr("data-reconciled") || "0");
        let newStatus = currentStatus === 1 ? 0 : 1;

        $btn.prop("disabled", true).css("opacity", "0.6");

        frappe.call({
            method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.toggle_reconciliation_status",
            args: {
                doctype: window.RECON_STATE.reconciliation_type === "customer_payments" ? "Customer Payment" : "Station Cards",
                names: JSON.stringify([name]),
                is_reconciled: newStatus
            },
            callback: function(r) {
                $btn.prop("disabled", false).css("opacity", "1");
                if (r && r.message && r.message.success) {
                    frappe.show_alert({
                        message: newStatus === 1 ? __("Transaction marked as Reconciled") : __("Reconciliation reverted to Pending"),
                        indicator: newStatus === 1 ? "green" : "orange"
                    }, 3);
                    load_reconciliation_data(wrapper);
                } else {
                    frappe.msgprint(__("Failed to update status."));
                }
            },
            error: function() {
                $btn.prop("disabled", false).css("opacity", "1");
            }
        });
    });

    // 12. Bulk Reconcile Selected Button
    $w.off("click", "#btn-recon-bulk-check").on("click", "#btn-recon-bulk-check", function(e) {
        e.preventDefault();
        let names = Array.from(window.RECON_STATE.selected_items);
        if (!names || names.length === 0) return;

        frappe.confirm(
            __("Mark {0} selected transactions as Reconciled?", [names.length]),
            function() {
                let $bulkBtn = $w.find("#btn-recon-bulk-check");
                $bulkBtn.prop("disabled", true).text("Reconciling...");

                frappe.call({
                    method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.toggle_reconciliation_status",
                    args: {
                        doctype: window.RECON_STATE.reconciliation_type === "customer_payments" ? "Customer Payment" : "Station Cards",
                        names: JSON.stringify(names),
                        is_reconciled: 1
                    },
                    callback: function(r) {
                        $bulkBtn.prop("disabled", false);
                        if (r && r.message && r.message.success) {
                            frappe.show_alert({
                                message: __("{0} transactions marked as Reconciled", [names.length]),
                                indicator: "green"
                            }, 4);
                            window.RECON_STATE.selected_items.clear();
                            update_recon_bulk_ui($w);
                            load_reconciliation_data(wrapper);
                        }
                    }
                });
            }
        );
    });
}

function update_recon_bulk_ui($w) {
    let count = window.RECON_STATE.selected_items.size;
    let $btn = $w.find("#btn-recon-bulk-check");
    if (count > 0) {
        $btn.css("display", "inline-flex");
        $w.find("#recon-bulk-label").text("Reconcile Selected (" + count + ")");
    } else {
        $btn.hide();
        $w.find("#recon-master-checkbox").prop("checked", false);
    }
}

function load_reconciliation_data(wrapper, refresh_options) {
    let $w = $(wrapper || document);
    let state = window.RECON_STATE;
    let station = $w.find('#exec-global-station-select').val() || $w.find('#exec-header-station-select').val() || '';

    $w.find("#recon-transactions-table tbody").html(
        '<tr><td colspan="10" style="text-align:center; padding:36px; color:#64748b;"><div class="spinner-border spinner-border-sm text-primary" role="status"></div> Loading transactions...</td></tr>'
    );

    frappe.call({
        method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_reconciliation_data",
        args: {
            reconciliation_type: state.reconciliation_type,
            from_date: state.from_date,
            to_date: state.to_date,
            status: state.status,
            party_or_card: state.party_or_card,
            search: state.search,
            page: state.page,
            page_length: state.page_length,
            station: station
        },
        callback: function(r) {
            if (r && r.message) {
                let data = r.message;
                render_reconciliation_kpis($w, data.summary);
                render_reconciliation_table($w, data);
                if (refresh_options || !state.cached_options_type || state.cached_options_type !== state.reconciliation_type) {
                    populate_recon_dropdown($w, data.dropdown_options);
                    state.cached_options_type = state.reconciliation_type;
                }
            } else {
                $w.find("#recon-transactions-table tbody").html(
                    '<tr><td colspan="10" style="text-align:center; padding:32px; color:#ef4444;">Failed to load data.</td></tr>'
                );
            }
        }
    });
}

function render_reconciliation_kpis($w, summary) {
    if (!summary) return;
    let totCount = summary.total_count || 0;
    let totAmt = summary.total_amount || 0;
    let recCount = summary.reconciled_count || 0;
    let recAmt = summary.reconciled_amount || 0;
    let penCount = summary.pending_count || 0;
    let penAmt = summary.pending_amount || 0;

    let matchRate = totAmt > 0 ? ((recAmt / totAmt) * 100).toFixed(1) : (totCount > 0 ? ((recCount / totCount) * 100).toFixed(1) : "0.0");

    $w.find("#recon-kpi-total-val").text(totCount.toLocaleString() + " Txns");
    $w.find("#recon-kpi-total-sub").text("KES " + totAmt.toLocaleString("en-KE", {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " total value");

    $w.find("#recon-kpi-reconciled-val").text(recCount.toLocaleString() + " Cleared");
    $w.find("#recon-kpi-reconciled-sub").text("KES " + recAmt.toLocaleString("en-KE", {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " cleared");

    $w.find("#recon-kpi-pending-val").text(penCount.toLocaleString() + " Pending");
    $w.find("#recon-kpi-pending-sub").text("KES " + penAmt.toLocaleString("en-KE", {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " unverified");

    $w.find("#recon-kpi-rate-val").text(matchRate + "%");

    // Update Tab Badges
    if (window.RECON_STATE.reconciliation_type === "customer_payments") {
        $w.find("#recon-cp-pending-pill").text(penCount.toLocaleString() + " pending");
    } else {
        $w.find("#recon-sc-pending-pill").text(penCount.toLocaleString() + " pending");
    }
}

function populate_recon_dropdown($w, options) {
    let $select = $w.find("#recon-party-filter");
    let isCP = window.RECON_STATE.reconciliation_type === "customer_payments";
    let defaultLabel = isCP ? "All Customers" : "All Cards";

    let html = '<option value="ALL">' + defaultLabel + '</option>';
    if (options && options.length) {
        options.forEach(function(opt) {
            html += `<option value="${opt.id}">${opt.label}</option>`;
        });
    }
    $select.html(html);
    $select.val(window.RECON_STATE.party_or_card || "ALL");
}

function render_reconciliation_table($w, data) {
    let isCP = data.reconciliation_type === "customer_payments";
    let records = data.records || [];
    let state = window.RECON_STATE;
    state.total_pages = data.total_pages || 1;

    // 1. Render Header
    let theadHtml = "";
    if (isCP) {
        theadHtml = `
            <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0; text-align:left; font-size:11.5px; color:#475569; text-transform:uppercase; letter-spacing:0.5px;">
                <th style="padding:10px 14px; width:36px; text-align:center;">
                    <input type="checkbox" id="recon-master-checkbox" style="cursor:pointer;" />
                </th>
                <th style="padding:10px 12px; white-space:nowrap;">Date</th>
                <th style="padding:10px 12px; white-space:nowrap;">Trans No / Ref</th>
                <th style="padding:10px 12px; white-space:nowrap;">Shift</th>
                <th style="padding:10px 12px;">Customer</th>
                <th style="padding:10px 12px;">CSA / Attendant</th>
                <th style="padding:10px 12px;">Payment Mode</th>
                <th style="padding:10px 12px; text-align:right;">Amount (KES)</th>
                <th style="padding:10px 12px; text-align:center;">Status</th>
                <th style="padding:10px 14px; text-align:center; min-width:140px;">Reconcile Action</th>
            </tr>
        `;
    } else {
        theadHtml = `
            <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0; text-align:left; font-size:11.5px; color:#475569; text-transform:uppercase; letter-spacing:0.5px;">
                <th style="padding:10px 14px; width:36px; text-align:center;">
                    <input type="checkbox" id="recon-master-checkbox" style="cursor:pointer;" />
                </th>
                <th style="padding:10px 12px; white-space:nowrap;">Date</th>
                <th style="padding:10px 12px; white-space:nowrap;">Receipt No / RRN</th>
                <th style="padding:10px 12px; white-space:nowrap;">Shift</th>
                <th style="padding:10px 12px;">Card Type</th>
                <th style="padding:10px 12px;">CSA / Attendant</th>
                <th style="padding:10px 12px;">Memo / Ref</th>
                <th style="padding:10px 12px; text-align:right;">Amount (KES)</th>
                <th style="padding:10px 12px; text-align:center;">Status</th>
                <th style="padding:10px 14px; text-align:center; min-width:140px;">Reconcile Action</th>
            </tr>
        `;
    }
    $w.find("#recon-table-head").html(theadHtml);

    // 2. Render Body
    if (!records || records.length === 0) {
        $w.find("#recon-table-body").html(
            '<tr><td colspan="10" style="text-align:center; padding:48px 16px; color:#64748b;">' +
            '<div style="font-size:32px; margin-bottom:8px;">🔍</div>' +
            '<div style="font-weight:700; color:#334155; font-size:14px;">No transactions found</div>' +
            '<div style="font-size:12px; color:#94a3b8; margin-top:4px;">Try adjusting the date range or status filter.</div>' +
            '</td></tr>'
        );
        $w.find("#recon-pagination-info").text("Showing 0 of 0 transactions");
        $w.find("#btn-recon-prev-page").prop("disabled", true);
        $w.find("#btn-recon-next-page").prop("disabled", true);
        $w.find("#recon-current-page").text("Page 1 of 1");
        return;
    }

    let tbodyHtml = "";
    records.forEach(function(r) {
        let isRecon = parseInt(r.is_reconciled || 0) === 1;
        let isChecked = state.selected_items.has(r.name);
        let rowBg = isRecon ? "background:#fcfdfd;" : "background:#ffffff;";

        // Status Badge
        let statusBadge = "";
        if (isRecon) {
            let tooltip = r.reconciled_by ? `Reconciled by ${r.reconciled_by} on ${r.reconciled_date_formatted}` : "Reconciled";
            statusBadge = `<span title="${tooltip}" style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:999px; background:#dcfce7; color:#15803d; font-size:11px; font-weight:700;">
                <span class="material-symbols-outlined" style="font-size:13px;">check</span> Reconciled
            </span>`;
        } else {
            statusBadge = `<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:999px; background:#fef3c7; color:#b45309; font-size:11px; font-weight:700;">
                <span class="material-symbols-outlined" style="font-size:13px;">schedule</span> Pending
            </span>`;
        }

        // Action Check Button
        let actionBtn = "";
        if (isRecon) {
            actionBtn = `
                <button class="recon-row-toggle btn-recon-done" data-name="${r.name}" data-reconciled="1" title="Click to undo / revert to pending" style="display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:6px; border:1px solid #86efac; background:#f0fdf4; color:#16a34a; font-weight:700; font-size:11.5px; cursor:pointer; transition:all 0.15s ease;">
                    <span class="material-symbols-outlined" style="font-size:16px; color:#16a34a;">check_circle</span>
                    <span>Reconciled</span>
                </button>
            `;
        } else {
            actionBtn = `
                <button class="recon-row-toggle btn-recon-pending" data-name="${r.name}" data-reconciled="0" title="Click to verify and reconcile" style="display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:6px; border:1px solid #cbd5e1; background:#ffffff; color:#334155; font-weight:600; font-size:11.5px; cursor:pointer; transition:all 0.15s ease;">
                    <span class="material-symbols-outlined" style="font-size:16px; color:#94a3b8;">check_box_outline_blank</span>
                    <span>Mark Reconciled</span>
                </button>
            `;
        }

        let amtFormatted = (r.amount || 0).toLocaleString("en-KE", {minimumFractionDigits: 2, maximumFractionDigits: 2});

        if (isCP) {
            let custDisplay = r.customer_name ? `<strong>${r.customer_name}</strong> <span style="font-size:11px; color:#64748b;">(${r.customer})</span>` : (r.customer || "-");
            let modePill = r.mode_of_payment ? `<span style="display:inline-block; padding:2px 7px; background:#f1f5f9; border-radius:4px; font-size:11px; font-weight:600; color:#334155;">${r.mode_of_payment}</span>` : "-";

            tbodyHtml += `
                <tr style="border-bottom:1px solid #f1f5f9; ${rowBg} transition:background 0.1s ease;">
                    <td style="padding:10px 14px; text-align:center;">
                        <input type="checkbox" class="recon-row-select" data-name="${r.name}" ${isChecked ? "checked" : ""} style="cursor:pointer;" />
                    </td>
                    <td style="padding:10px 12px; font-size:12px; color:#334155; white-space:nowrap;">${r.date_formatted}</td>
                    <td style="padding:10px 12px; font-family:monospace; font-size:12px; font-weight:700; color:#0f172a; white-space:nowrap;">
                        <a href="/app/customer-payment/${r.name}" target="_blank" style="color:#2563eb; text-decoration:none;">${r.trans_no || r.name}</a>
                    </td>
                    <td style="padding:10px 12px; font-size:11.5px; color:#64748b; white-space:nowrap;">
                        <a href="/app/shift/${r.shift}" target="_blank" style="color:#475569; text-decoration:none;">${r.shift || "-"}</a>
                    </td>
                    <td style="padding:10px 12px; font-size:12px; color:#1e293b;">${custDisplay}</td>
                    <td style="padding:10px 12px; font-size:12px; color:#475569;">${r.csa_name || r.csa || "-"}</td>
                    <td style="padding:10px 12px;">${modePill}</td>
                    <td style="padding:10px 12px; text-align:right; font-family:monospace; font-size:13px; font-weight:700; color:#0f172a;">${amtFormatted}</td>
                    <td style="padding:10px 12px; text-align:center;">${statusBadge}</td>
                    <td style="padding:10px 14px; text-align:center;">${actionBtn}</td>
                </tr>
            `;
        } else {
            let cardBadge = r.card ? `<span style="display:inline-block; padding:2px 8px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:4px; font-size:11px; font-weight:700;">${r.card}</span>` : "-";

            tbodyHtml += `
                <tr style="border-bottom:1px solid #f1f5f9; ${rowBg} transition:background 0.1s ease;">
                    <td style="padding:10px 14px; text-align:center;">
                        <input type="checkbox" class="recon-row-select" data-name="${r.name}" ${isChecked ? "checked" : ""} style="cursor:pointer;" />
                    </td>
                    <td style="padding:10px 12px; font-size:12px; color:#334155; white-space:nowrap;">${r.date_formatted}</td>
                    <td style="padding:10px 12px; font-family:monospace; font-size:12px; font-weight:700; color:#0f172a; white-space:nowrap;">
                        <a href="/app/station-cards/${r.name}" target="_blank" style="color:#2563eb; text-decoration:none;">${r.receipt_no || r.name}</a>
                    </td>
                    <td style="padding:10px 12px; font-size:11.5px; color:#64748b; white-space:nowrap;">
                        <a href="/app/shift/${r.shift}" target="_blank" style="color:#475569; text-decoration:none;">${r.shift || "-"}</a>
                    </td>
                    <td style="padding:10px 12px;">${cardBadge}</td>
                    <td style="padding:10px 12px; font-size:12px; color:#475569;">${r.csa_name || r.csa || "-"}</td>
                    <td style="padding:10px 12px; font-size:11.5px; color:#64748b; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.memo || "-"}</td>
                    <td style="padding:10px 12px; text-align:right; font-family:monospace; font-size:13px; font-weight:700; color:#0f172a;">${amtFormatted}</td>
                    <td style="padding:10px 12px; text-align:center;">${statusBadge}</td>
                    <td style="padding:10px 14px; text-align:center;">${actionBtn}</td>
                </tr>
            `;
        }
    });

    $w.find("#recon-table-body").html(tbodyHtml);

    // Update pagination controls
    let startIdx = ((state.page - 1) * state.page_length) + 1;
    let endIdx = Math.min(startIdx + records.length - 1, data.summary.total_count || 0);
    $w.find("#recon-pagination-info").text(`Showing ${startIdx.toLocaleString()} to ${endIdx.toLocaleString()} of ${(data.summary.total_count || 0).toLocaleString()} transactions`);

    $w.find("#recon-current-page").text(`Page ${state.page} of ${state.total_pages}`);
    $w.find("#btn-recon-prev-page").prop("disabled", state.page <= 1);
    $w.find("#btn-recon-next-page").prop("disabled", state.page >= state.total_pages);
}

// =========================================================================
// STAFF SHORTS REPORT MODULE FOR EXECUTIVE PANEL
// =========================================================================

window.EXEC_SHORTS_DATA = [];
window.EXEC_SHORTS_SUMMARY = {};

function init_exec_shorts_report(wrapper) {
    let $w = $(wrapper);
    
    // Set default dates if empty (start of current month to today)
    let $startInput = $w.find('#exec-shorts-report-start');
    let $endInput = $w.find('#exec-shorts-report-end');
    if (!$startInput.val()) {
        let today = new Date();
        let firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        $startInput.val(firstDay.toISOString().split('T')[0]);
        $endInput.val(today.toISOString().split('T')[0]);
    }

    setup_exec_shorts_events(wrapper);
    load_exec_shortage_balances(wrapper);
}

function setup_exec_shorts_events(wrapper) {
    let $w = $(wrapper);
    if ($w.data('exec_shorts_events_bound')) return;
    $w.data('exec_shorts_events_bound', true);

    // Preset buttons
    $w.on('click', '.exec-sr-preset', function(e) {
        e.preventDefault();
        $w.find('.exec-sr-preset').removeClass('active').css({
            background: '#fff',
            color: '#64748b',
            borderColor: '#e2e8f0',
            fontWeight: '600'
        });
        $(this).addClass('active').css({
            background: '#e0e7ff',
            color: '#3730a3',
            borderColor: '#cbd5e1',
            fontWeight: '700'
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

        $w.find('#exec-shorts-report-start').val(start);
        $w.find('#exec-shorts-report-end').val(end);
        load_exec_shortage_balances(wrapper);
    });

    // Filter button
    $w.on('click', '#btn-exec-filter-shorts', function(e) {
        e.preventDefault();
        load_exec_shortage_balances(wrapper);
    });

    // Search input
    $w.on('input', '#exec-sr-search-input', function() {
        render_exec_shortage_table(wrapper);
    });

    // Status filter
    $w.on('click', '.exec-sr-status-filter', function(e) {
        e.preventDefault();
        $w.find('.exec-sr-status-filter').removeClass('active').css({
            background: 'transparent',
            color: '#64748b',
            fontWeight: '600'
        });
        $(this).addClass('active').css({
            background: '#fff',
            color: '#0f172a',
            fontWeight: '700'
        });
        render_exec_shortage_table(wrapper);
    });

    // Sort select
    $w.on('change', '#exec-sr-sort-select', function() {
        render_exec_shortage_table(wrapper);
    });

    // Print report
    $w.on('click', '#btn-exec-print-shorts-report', function(e) {
        e.preventDefault();
        print_exec_shorts_report(wrapper);
    });

    // Export CSV
    $w.on('click', '#btn-exec-export-shorts-csv', function(e) {
        e.preventDefault();
        export_exec_shorts_csv(wrapper);
    });

    // Statement modal close
    $w.on('click', '#exec-breakdown-modal-close', function() {
        $w.find('#exec-breakdown-modal').hide();
    });
    $w.on('click', '#exec-breakdown-modal', function(e) {
        if (e.target === this) {
            $(this).hide();
        }
    });

    // Statement breakdown row click
    $w.on('click', '.btn-exec-statement-breakdown', function(e) {
        e.preventDefault();
        let empId = $(this).attr('data-emp-id');
        let empName = $(this).attr('data-emp-name');
        show_exec_shortage_breakdown(wrapper, empId, empName);
    });

    // Open Clear Shorts to Salary Deductions Modal (Bulk)
    $w.on('click', '#btn-exec-clear-shorts-payroll', function(e) {
        e.preventDefault();
        open_exec_clear_shorts_modal(wrapper, null);
    });

    // Open Clear Shorts Modal (Individual Row)
    $w.on('click', '.btn-exec-single-clear-short', function(e) {
        e.preventDefault();
        let empId = $(this).attr('data-emp-id');
        open_exec_clear_shorts_modal(wrapper, empId);
    });

    // Clear Modal Close / Cancel
    $w.on('click', '#exec-clear-shorts-modal-close, #btn-exec-clear-shorts-cancel', function() {
        $w.find('#exec-clear-shorts-modal').hide();
    });
    $w.on('click', '#exec-clear-shorts-modal', function(e) {
        if (e.target === this) $(this).hide();
    });

    // Check all checkbox
    $w.on('change', '#exec-clear-check-all', function() {
        let isChecked = $(this).is(':checked');
        $w.find('.exec-clear-check-item').prop('checked', isChecked);
        recalculate_exec_clear_totals(wrapper);
    });

    // Individual checkbox change
    $w.on('change', '.exec-clear-check-item', function() {
        let totalItems = $w.find('.exec-clear-check-item').length;
        let checkedItems = $w.find('.exec-clear-check-item:checked').length;
        $w.find('#exec-clear-check-all').prop('checked', totalItems > 0 && totalItems === checkedItems);
        recalculate_exec_clear_totals(wrapper);
    });

    // Amount input change
    $w.on('input change', '.exec-clear-amt-input', function() {
        let $row = $(this).closest('tr');
        let orig = flt($(this).attr('data-orig-shortage') || 0);
        let val = flt($(this).val() || 0);
        if (val < 0) val = 0;
        let rem = Math.max(0, orig - val);
        $row.find('.exec-clear-rem-bal').text(format_currency(rem, ''));
        recalculate_exec_clear_totals(wrapper);
    });

    // Submit Clear Shorts to Deductions
    $w.on('click', '#btn-exec-submit-clear-shorts', function(e) {
        e.preventDefault();
        submit_exec_clear_shorts(wrapper);
    });

    // Deductions Schedule Modal Close
    $w.on('click', '#exec-deductions-schedule-modal-close, #btn-exec-deductions-sched-done', function() {
        $w.find('#exec-deductions-schedule-modal').hide();
    });
    $w.on('click', '#exec-deductions-schedule-modal', function(e) {
        if (e.target === this) $(this).hide();
    });

    // Print Deductions Schedule
    $w.on('click', '#btn-exec-print-deductions-sched', function(e) {
        e.preventDefault();
        print_exec_deductions_schedule(window.LAST_CLEARED_DEDUCTIONS);
    });

    // CSV Export Deductions Schedule
    $w.on('click', '#btn-exec-csv-deductions-sched', function(e) {
        e.preventDefault();
        export_exec_deductions_csv(window.LAST_CLEARED_DEDUCTIONS);
    });
}

function load_exec_shortage_balances(wrapper) {
    let $w = $(wrapper);
    let $btn = $w.find('#btn-exec-filter-shorts');
    $btn.prop('disabled', true);

    $w.find('#exec-shortage-balances-body').html('<tr><td colspan="9" style="text-align:center; padding:30px; color:#64748b;">Loading staff shortage balances...</td></tr>');

    let start_date = $w.find('#exec-shorts-report-start').val();
    let end_date = $w.find('#exec-shorts-report-end').val();
    let station = $w.find('#exec-shorts-station-select').val() 
        || $w.find('#exec-header-station-select').val() 
        || $w.find('#exec-global-station-select').val() 
        || window.ACTIVE_STATION 
        || "";

    let stationBadge = station ? (station === 'RUBIS POA PLACE' ? 'Rubis Poa Place' : station) : 'All Stations (Consolidated)';
    $w.find('#exec-shorts-station-badge').text(stationBadge);

    frappe.call({
        method: "fuel_management.fuel_management.api.get_csa_shorts_balances",
        args: { start_date: start_date, end_date: end_date, station: station },
        callback: function(r) {
            $btn.prop('disabled', false);

            if (r.message) {
                let data = r.message;
                let rows = data.rows || (Array.isArray(data) ? data : []);
                let summary = data.summary || {};

                window.EXEC_SHORTS_DATA = rows;
                window.EXEC_SHORTS_SUMMARY = summary;

                let totalOpening = summary.total_opening != null ? summary.total_opening : rows.reduce((acc, x) => acc + (x.opening_balance || 0), 0);
                let totalShorts = summary.total_shortage != null ? summary.total_shortage : rows.reduce((acc, x) => acc + (x.period_shortage || x.month_shortage || 0), 0);
                let totalPaid = summary.total_paid != null ? summary.total_paid : rows.reduce((acc, x) => acc + (x.period_paid || x.month_paid || 0), 0);
                let totalClosing = summary.total_closing != null ? summary.total_closing : (totalOpening + totalShorts - totalPaid);
                let activeCount = summary.active_debtors_count != null ? summary.active_debtors_count : rows.filter(x => (x.closing_balance || x.outstanding_balance || 0) > 0.01).length;

                $w.find('#exec-sr-kpi-opening').text(format_currency(totalOpening, 'KES'));
                $w.find('#exec-sr-kpi-shorts').text(format_currency(totalShorts, 'KES'));
                $w.find('#exec-sr-kpi-paid').text(format_currency(totalPaid, 'KES'));
                $w.find('#exec-sr-kpi-closing').text(format_currency(totalClosing, 'KES'));
                $w.find('#exec-sr-kpi-count').text(`${activeCount} / ${rows.length} Staff`);

                render_exec_shortage_table(wrapper);
            }
        },
        error: function() {
            $btn.prop('disabled', false);
            $w.find('#exec-shortage-balances-body').html('<tr><td colspan="9" style="text-align:center; padding:30px; color:#ef4444; font-weight:600;">Error loading shortage balances. Please retry.</td></tr>');
        }
    });
}

function render_exec_shortage_table(wrapper) {
    let $w = $(wrapper);
    let rows = window.EXEC_SHORTS_DATA || [];
    let searchTerm = ($w.find('#exec-sr-search-input').val() || '').trim().toLowerCase();
    let statusFilter = $w.find('.exec-sr-status-filter.active').attr('data-filter') || 'all';
    let sortMode = $w.find('#exec-sr-sort-select').val() || 'balance_desc';

    let filtered = rows.filter(r => {
        let name = (r.employee_name || '').toLowerCase();
        let id = (r.employee || '').toLowerCase();
        return name.includes(searchTerm) || id.includes(searchTerm);
    });

    if (statusFilter === 'outstanding') {
        filtered = filtered.filter(r => (r.closing_balance || r.outstanding_balance || 0) > 0.01);
    } else if (statusFilter === 'cleared') {
        filtered = filtered.filter(r => Math.abs(r.closing_balance || r.outstanding_balance || 0) <= 0.01);
    }

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
        $w.find('#exec-shortage-balances-body').html('<tr><td colspan="9" style="text-align:center; padding:30px; color:#94a3b8;">No matching attendant records found.</td></tr>');
        $w.find('#exec-sr-foot-opening').text('KES 0.00');
        $w.find('#exec-sr-foot-shorts').text('KES 0.00');
        $w.find('#exec-sr-foot-paid').text('KES 0.00');
        $w.find('#exec-sr-foot-net').text('KES 0.00');
        $w.find('#exec-sr-foot-closing').text('KES 0.00');
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

        let statusBadge = '';
        if (closeBal > 0.01) {
            statusBadge = `<span style="background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; font-weight: 700;">Outstanding</span>`;
        } else if (closeBal < -0.01) {
            statusBadge = `<span style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; font-weight: 700;">Credit</span>`;
        } else {
            statusBadge = `<span style="background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; font-weight: 700;">Cleared</span>`;
        }

        let netColor = pNet > 0.01 ? '#dc2626' : (pNet < -0.01 ? '#16a34a' : '#64748b');
        let netPrefix = pNet > 0.01 ? '+' : '';

        html += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="text-align: center; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
                <td>
                    <div style="font-weight: 700; color: #0f172a;">${row.employee_name || row.employee}</div>
                    <div style="font-size: 11px; color: #64748b; font-family: monospace;">${row.employee}${row.station ? ` &bull; <span style="color:#0284c7; font-weight:600;">${row.station}</span>` : ''}</div>
                </td>
                <td style="text-align: right; font-weight: 700; font-family: monospace;">${format_currency(openBal, '')}</td>
                <td style="text-align: right; color: ${pShort > 0 ? '#dc2626' : '#94a3b8'}; font-weight: 700; font-family: monospace;">${format_currency(pShort, '')}</td>
                <td style="text-align: right; color: ${pPaid > 0 ? '#16a34a' : '#94a3b8'}; font-weight: 700; font-family: monospace;">${format_currency(pPaid, '')}</td>
                <td style="text-align: right; color: ${netColor}; font-weight: 600; font-family: monospace;">${netPrefix}${format_currency(pNet, '')}</td>
                <td style="text-align: right; font-weight: 800; color: ${closeBal > 0 ? '#0f172a' : (closeBal < 0 ? '#2563eb' : '#059669')}; font-family: monospace; font-size: 13.5px;">${format_currency(closeBal, '')}</td>
                <td style="text-align: center;">${statusBadge}</td>
                <td style="text-align: center; white-space: nowrap;">
                    <button type="button" class="btn btn-xs btn-default btn-exec-statement-breakdown" data-emp-id="${row.employee}" data-emp-name="${frappe.utils.escape_html(row.employee_name || row.employee)}" style="padding: 3px 8px; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                        <span class="material-symbols-outlined" style="font-size: 14px;">receipt_long</span> Statement
                    </button>
                    ${closeBal > 0.01 ? `
                    <button type="button" class="btn btn-xs btn-primary btn-exec-single-clear-short" data-emp-id="${row.employee}" data-emp-name="${frappe.utils.escape_html(row.employee_name || row.employee)}" data-balance="${closeBal}" style="padding: 3px 8px; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; background: #0284c7; border-color: #0284c7; color: #fff; margin-left: 4px;" title="Clear to Salary Deduction">
                        <span class="material-symbols-outlined" style="font-size: 14px;">lock_clock</span> Deduct
                    </button>` : ''}
                </td>
            </tr>
        `;
    });

    $w.find('#exec-shortage-balances-body').html(html);

    $w.find('#exec-sr-foot-opening').text(format_currency(footOpening, 'KES'));
    $w.find('#exec-sr-foot-shorts').text(format_currency(footShorts, 'KES'));
    $w.find('#exec-sr-foot-paid').text(format_currency(footPaid, 'KES'));
    let netFootColor = footNet > 0.01 ? '#dc2626' : (footNet < -0.01 ? '#16a34a' : '#475569');
    $w.find('#exec-sr-foot-net').css('color', netFootColor).text((footNet > 0.01 ? '+' : '') + format_currency(footNet, 'KES'));
    $w.find('#exec-sr-foot-closing').text(format_currency(footClosing, 'KES'));
}

function show_exec_shortage_breakdown(wrapper, employee_id, employee_name) {
    let $w = $(wrapper);
    let start_date = $w.find('#exec-shorts-report-start').val();
    let end_date = $w.find('#exec-shorts-report-end').val();

    $w.find('#exec-breakdown-modal-title').html(`Statement: ${employee_name}`);
    $w.find('#exec-breakdown-modal-subtitle').html(`Employee: <b>${employee_name}</b> &bull; Period: <b>${frappe.datetime.str_to_user(start_date)}</b> to <b>${frappe.datetime.str_to_user(end_date)}</b>`);

    $w.find('#exec-breakdown-modal-kpis').html(`
        <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; text-align:center;">
            <div style="font-size:10px; color:#64748b; font-weight:700; text-transform:uppercase;">Opening Balance (B/F)</div>
            <div style="font-size:14px; font-weight:800; color:#1e293b; font-family:monospace; margin-top:2px;">...</div>
        </div>
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:8px 10px; text-align:center;">
            <div style="font-size:10px; color:#991b1b; font-weight:700; text-transform:uppercase;">Period Shorts</div>
            <div style="font-size:14px; font-weight:800; color:#dc2626; font-family:monospace; margin-top:2px;">...</div>
        </div>
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:8px 10px; text-align:center;">
            <div style="font-size:10px; color:#166534; font-weight:700; text-transform:uppercase;">Period Paid</div>
            <div style="font-size:14px; font-weight:800; color:#16a34a; font-family:monospace; margin-top:2px;">...</div>
        </div>
        <div style="background:#eef2ff; border:1px solid #c7d2fe; border-radius:6px; padding:8px 10px; text-align:center;">
            <div style="font-size:10px; color:#3730a3; font-weight:700; text-transform:uppercase;">Closing Balance (C/F)</div>
            <div style="font-size:14px; font-weight:800; color:#4338ca; font-family:monospace; margin-top:2px;">...</div>
        </div>
    `);

    $w.find('#exec-breakdown-modal-body').html('<div style="text-align:center; padding:30px; color:#64748b;">Loading statement transactions...</div>');
    $w.find('#exec-breakdown-modal').css('display', 'flex');

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
                window.EXEC_CURRENT_STATEMENT_DATA = d;

                let finalName = d.employee_name || employee_name;
                $w.find('#exec-breakdown-modal-title').html(`Statement: ${finalName}`);
                $w.find('#exec-breakdown-modal-subtitle').html(`Employee: <b>${finalName}</b> &bull; Period: <b>${frappe.datetime.str_to_user(d.start_date || start_date)}</b> to <b>${frappe.datetime.str_to_user(d.end_date || end_date)}</b>`);

                $w.find('#exec-breakdown-modal-kpis').html(`
                    <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; text-align:center;">
                        <div style="font-size:10px; color:#64748b; font-weight:700; text-transform:uppercase;">Opening Balance (B/F)</div>
                        <div style="font-size:14px; font-weight:800; color:#1e293b; font-family:monospace; margin-top:2px;">${format_currency(d.opening_balance || 0, 'KES')}</div>
                    </div>
                    <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:8px 10px; text-align:center;">
                        <div style="font-size:10px; color:#991b1b; font-weight:700; text-transform:uppercase;">Period Shorts</div>
                        <div style="font-size:14px; font-weight:800; color:#dc2626; font-family:monospace; margin-top:2px;">${format_currency(d.period_shortage || 0, 'KES')}</div>
                    </div>
                    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:8px 10px; text-align:center;">
                        <div style="font-size:10px; color:#166534; font-weight:700; text-transform:uppercase;">Period Paid</div>
                        <div style="font-size:14px; font-weight:800; color:#16a34a; font-family:monospace; margin-top:2px;">${format_currency(d.period_paid || 0, 'KES')}</div>
                    </div>
                    <div style="background:#eef2ff; border:1px solid #c7d2fe; border-radius:6px; padding:8px 10px; text-align:center;">
                        <div style="font-size:10px; color:#3730a3; font-weight:700; text-transform:uppercase;">Closing Balance (C/F)</div>
                        <div style="font-size:14px; font-weight:800; color:#4338ca; font-family:monospace; margin-top:2px;">${format_currency(d.closing_balance || 0, 'KES')}</div>
                    </div>
                `);

                $w.find('#btn-exec-print-csa-statement').off('click').on('click', function(e) {
                    e.preventDefault();
                    print_exec_csa_statement(d);
                });

                let html = `
                    <table class="table table-bordered" style="width: 100%; margin: 0; font-size: 12px; background: #fff;">
                        <thead>
                            <tr style="background: #f8fafc; font-size: 11px; text-transform: uppercase;">
                                <th style="padding: 6px 8px;">Date</th>
                                <th style="padding: 6px 8px;">Type</th>
                                <th style="padding: 6px 8px;">Shift / Ref</th>
                                <th style="padding: 6px 8px;">Reason / Description</th>
                                <th style="padding: 6px 8px; text-align: right; color: #dc2626;">Shortage (+)</th>
                                <th style="padding: 6px 8px; text-align: right; color: #16a34a;">Paid (-)</th>
                                <th style="padding: 6px 8px; text-align: right; font-weight: 800;">Running Bal</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="background: #f8fafc; font-weight: 700;">
                                <td style="padding: 6px 8px; font-family: monospace;">${frappe.datetime.str_to_user(d.start_date)}</td>
                                <td colspan="3" style="padding: 6px 8px; color: #334155;">🏁 OPENING BALANCE (B/F from Prior Month)</td>
                                <td style="padding: 6px 8px; text-align: right; color: #94a3b8;">-</td>
                                <td style="padding: 6px 8px; text-align: right; color: #94a3b8;">-</td>
                                <td style="padding: 6px 8px; text-align: right; font-weight: 800; font-family: monospace;">${format_currency(d.opening_balance || 0, '')}</td>
                            </tr>
                `;

                if (!d.transactions || d.transactions.length === 0) {
                    html += `
                        <tr>
                            <td colspan="7" style="text-align: center; padding: 20px; color: #94a3b8;">
                                No transactions recorded for this attendant in the selected period.
                            </td>
                        </tr>
                    `;
                } else {
                    d.transactions.forEach(row => {
                        let shiftName = row.shift || '-';
                        if (row.shift_date && row.shift_template) {
                            let parts = row.shift_date.split('-');
                            if (parts.length === 3) shiftName = `(${parts[2]}/${parts[1]}) ${row.shift_template}`;
                        }
                        let reasonText = row.reason || '-';
                        let typeBadge = row.amount > 0 
                            ? `<span style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:700;">Shortage</span>`
                            : `<span style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:700;">Payment</span>`;

                        html += `
                            <tr>
                                <td style="padding: 6px 8px; font-family: monospace; white-space: nowrap;">${frappe.datetime.str_to_user(row.date)}</td>
                                <td style="padding: 6px 8px;">${typeBadge}</td>
                                <td style="padding: 6px 8px; color: #475569;">${shiftName}</td>
                                <td style="padding: 6px 8px; color: #1e293b;">${reasonText}</td>
                                <td style="padding: 6px 8px; text-align: right; color: #dc2626; font-weight: 700; font-family: monospace;">${row.shortage_amount > 0 ? format_currency(row.shortage_amount, '') : '-'}</td>
                                <td style="padding: 6px 8px; text-align: right; color: #16a34a; font-weight: 700; font-family: monospace;">${row.paid_amount > 0 ? format_currency(row.paid_amount, '') : '-'}</td>
                                <td style="padding: 6px 8px; text-align: right; font-weight: 800; font-family: monospace;">${format_currency(row.running_balance, '')}</td>
                            </tr>
                        `;
                    });
                }

                html += `
                            <tr style="background: #eef2ff; font-weight: 800; border-top: 2px solid #c7d2fe;">
                                <td style="padding: 6px 8px; font-family: monospace;">${frappe.datetime.str_to_user(d.end_date)}</td>
                                <td colspan="3" style="padding: 6px 8px; color: #334155;">🏁 CLOSING BALANCE (Carried Forward)</td>
                                <td style="padding: 6px 8px; text-align: right; color: #dc2626; font-family: monospace;">${format_currency(d.period_shortage || 0, '')}</td>
                                <td style="padding: 6px 8px; text-align: right; color: #16a34a; font-family: monospace;">${format_currency(d.period_paid || 0, '')}</td>
                                <td style="padding: 6px 8px; text-align: right; font-weight: 800; font-family: monospace; color: #312e81;">${format_currency(d.closing_balance || 0, '')}</td>
                            </tr>
                        </tbody>
                    </table>
                `;
                $w.find('#exec-breakdown-modal-body').html(html);
            }
        },
        error: function() {
            $w.find('#exec-breakdown-modal-body').html('<div style="text-align:center; padding:20px; color:#ef4444; font-weight:600;">Error loading CSA statement.</div>');
        }
    });
}

function print_exec_shorts_report(wrapper) {
    let rows = window.EXEC_SHORTS_DATA || [];
    let $w = $(wrapper);
    let start_date = $w.find('#exec-shorts-report-start').val() || '';
    let end_date = $w.find('#exec-shorts-report-end').val() || '';
    let companyName = frappe.defaults.get_user_default("Company") || "KILIBET INVESTMENT LTD";

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
            <title>Staff Shorts & Liability Report</title>
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
                @media print { body { padding: 0; } }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">${companyName}</div>
                <div class="subtitle">STAFF SHORTAGES & LIABILITY RECONCILIATION REPORT</div>
                <div class="subtitle" style="font-weight: 600; margin-top: 3px;">Period: ${frappe.datetime.str_to_user(start_date)} to ${frappe.datetime.str_to_user(end_date)} &bull; Printed: ${new Date().toLocaleString()}</div>
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
                        <th>Attendant / Staff</th>
                        <th style="text-align: right;">Opening Bal (KES)</th>
                        <th style="text-align: right;">Period Shorts (KES)</th>
                        <th style="text-align: right;">Period Paid (KES)</th>
                        <th style="text-align: right;">Net Change (KES)</th>
                        <th style="text-align: right;">Closing Bal (KES)</th>
                        <th style="text-align: center;">Status</th>
                    </tr>
                </thead>
                <tbody>${tableRowsHtml}</tbody>
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
            <script>window.onload = function() { window.print(); };</script>
        </body>
        </html>
    `;

    let printWindow = window.open('', '_blank');
    printWindow.document.write(printHtml);
    printWindow.document.close();
}

function print_exec_csa_statement(data) {
    if (!data) return;
    let companyName = frappe.defaults.get_user_default("Company") || "KILIBET INVESTMENT LTD";

    let txRowsHtml = '';
    (data.transactions || []).forEach(tx => {
        let shiftName = tx.shift || '-';
        if (tx.shift_date && tx.shift_template) {
            let parts = tx.shift_date.split('-');
            if (parts.length === 3) shiftName = `(${parts[2]}/${parts[1]}) ${tx.shift_template}`;
        }
        let reason = tx.reason || '-';

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
            <title>Staff Statement - ${data.employee_name}</title>
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
                @media print { body { padding: 0; } }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">${companyName}</div>
                <div class="subtitle">STAFF LIABILITY & SHORTAGE STATEMENT</div>
            </div>

            <div class="info-box">
                <div>
                    <div><b>Staff:</b> ${data.employee_name}</div>
                    <div><b>ID:</b> ${data.employee}</div>
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
                        <td colspan="3">🏁 OPENING BALANCE (B/F from Prior Month)</td>
                        <td style="text-align: right; color:#94a3b8;">-</td>
                        <td style="text-align: right; color:#94a3b8;">-</td>
                        <td style="text-align: right; font-weight: bold; font-family: monospace;">${Number(data.opening_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                    </tr>
                    ${txRowsHtml}
                    <tr style="background: #eef2ff; font-weight: bold;">
                        <td style="font-family: monospace;">${frappe.datetime.str_to_user(data.end_date)}</td>
                        <td colspan="3">🏁 CLOSING BALANCE (Carried Forward)</td>
                        <td style="text-align: right; font-family: monospace; color:#b91c1c;">${Number(data.period_shortage || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                        <td style="text-align: right; font-family: monospace; color:#15803d;">${Number(data.period_paid || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                        <td style="text-align: right; font-family: monospace; color:#1e3a8a;">${Number(data.closing_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                    </tr>
                </tbody>
            </table>
            <script>window.onload = function() { window.print(); };</script>
        </body>
        </html>
    `;

    let printWindow = window.open('', '_blank');
    printWindow.document.write(printHtml);
    printWindow.document.close();
}

function export_exec_shorts_csv(wrapper) {
    let rows = window.EXEC_SHORTS_DATA || [];
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
    link.setAttribute("download", `Staff_Shorts_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

window.LAST_CLEARED_DEDUCTIONS = null;

function open_exec_clear_shorts_modal(wrapper, prefilterEmpId) {
    let $w = $(wrapper);
    let allRows = window.EXEC_SHORTS_DATA || [];
    let outstanding = allRows.filter(r => (r.closing_balance || r.outstanding_balance || 0) > 0.01);
    
    if (prefilterEmpId) {
        outstanding = outstanding.filter(r => r.employee === prefilterEmpId);
    }
    
    if (outstanding.length === 0) {
        frappe.msgprint({
            title: __('No Outstanding Shortages'),
            indicator: 'orange',
            message: __('There are no attendants with an outstanding shortage balance in this period to clear.')
        });
        return;
    }
    
    let station = $w.find('#exec-shorts-station-select').val() 
        || $w.find('#exec-header-station-select').val() 
        || $w.find('#exec-global-station-select').val() 
        || window.ACTIVE_STATION 
        || frappe.defaults.get_user_default("station") 
        || "";
    if (!station || station === "ALL" || station === "All Stations" || station === "All Stations (Consolidated)") {
        station = outstanding.length > 0 && outstanding[0].station ? outstanding[0].station : "RUBIS POA PLACE";
    }
    $w.find('#exec-clear-station-display').text(station);
    
    let endDate = $w.find('#exec-shorts-report-end').val() || frappe.datetime.get_today();
    $w.find('#exec-clear-date').val(endDate);
    
    // Guess human month name for memo
    let dateObj = new Date(endDate);
    let monthName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
    $w.find('#exec-clear-reason').val(`Salary Deduction - ${monthName}`);
    $w.find('#exec-clear-post-journal').prop('checked', false);
    $w.find('#exec-clear-check-all').prop('checked', true);
    
    let tbodyHtml = '';
    outstanding.forEach((r, idx) => {
        let bal = r.closing_balance != null ? r.closing_balance : (r.outstanding_balance || 0);
        tbodyHtml += `
            <tr data-emp-id="${r.employee}" data-emp-name="${frappe.utils.escape_html(r.employee_name || r.employee)}">
                <td style="text-align: center; vertical-align: middle;">
                    <input type="checkbox" class="exec-clear-check-item" checked style="cursor: pointer;">
                </td>
                <td style="vertical-align: middle;">
                    <div style="font-weight: 700; color: #0f172a;">${frappe.utils.escape_html(r.employee_name || r.employee)}</div>
                    <div style="font-size: 11px; color: #64748b; font-family: monospace;">${r.employee}${r.station ? ` &bull; <span style="color:#0284c7; font-weight:600;">${r.station}</span>` : ''}</div>
                </td>
                <td style="text-align: right; font-weight: 700; font-family: monospace; color: #b91c1c; vertical-align: middle;">
                    ${format_currency(bal, '')}
                </td>
                <td style="text-align: right; vertical-align: middle;">
                    <input type="number" step="0.01" class="form-control exec-clear-amt-input" 
                        data-orig-shortage="${bal}" 
                        value="${bal.toFixed(2)}" 
                        style="height: 30px; font-size: 12px; font-weight: 700; text-align: right; font-family: monospace; color: #0f172a;">
                </td>
                <td style="text-align: right; font-weight: 700; font-family: monospace; color: #16a34a; vertical-align: middle;" class="exec-clear-rem-bal">
                    0.00
                </td>
            </tr>
        `;
    });
    
    $w.find('#exec-clear-staff-tbody').html(tbodyHtml);
    recalculate_exec_clear_totals(wrapper);
    $w.find('#exec-clear-shorts-modal').css('display', 'flex').show();
}

function recalculate_exec_clear_totals(wrapper) {
    let $w = $(wrapper);
    let totalDeductions = 0.0;
    let selectedCount = 0;
    
    $w.find('#exec-clear-staff-tbody tr').each(function() {
        let $row = $(this);
        let isChecked = $row.find('.exec-clear-check-item').is(':checked');
        if (isChecked) {
            selectedCount++;
            let amt = flt($row.find('.exec-clear-amt-input').val() || 0);
            totalDeductions += amt;
        }
    });
    
    $w.find('#exec-clear-total-display').text(format_currency(totalDeductions, 'KES'));
    $w.find('#exec-clear-count-display').text(`${selectedCount} attendant${selectedCount === 1 ? '' : 's'} selected`);
}

function submit_exec_clear_shorts(wrapper) {
    let $w = $(wrapper);
    let station = $w.find('#exec-clear-station-display').text() || $w.find('#exec-shorts-station-select').val() || $w.find('#exec-header-station-select').val() || window.ACTIVE_STATION || "RUBIS POA PLACE";
    let clearanceDate = $w.find('#exec-clear-date').val();
    let reason = $w.find('#exec-clear-reason').val() || "Salary Deduction";
    let postJournal = $w.find('#exec-clear-post-journal').is(':checked') ? 1 : 0;
    
    let deductions = [];
    $w.find('#exec-clear-staff-tbody tr').each(function() {
        let $row = $(this);
        let isChecked = $row.find('.exec-clear-check-item').is(':checked');
        if (isChecked) {
            let empId = $row.attr('data-emp-id');
            let amt = flt($row.find('.exec-clear-amt-input').val() || 0);
            if (empId && amt > 0) {
                deductions.push({ employee: empId, amount: amt });
            }
        }
    });
    
    if (deductions.length === 0) {
        frappe.msgprint(__('Please select at least one attendant with an amount greater than 0 to clear.'));
        return;
    }
    
    let $btn = $w.find('#btn-exec-submit-clear-shorts');
    $btn.prop('disabled', true);
    $btn.find('.spinner-border').removeClass('hidden');
    
    frappe.call({
        method: 'fuel_management.fuel_management.api.clear_staff_shorts_to_deductions',
        args: {
            station: station,
            clearance_date: clearanceDate,
            reason: reason,
            deductions: JSON.stringify(deductions),
            post_journal: postJournal
        },
        callback: function(r) {
            $btn.prop('disabled', false);
            $btn.find('.spinner-border').addClass('hidden');
            
            if (r.message && r.message.success) {
                let res = r.message;
                frappe.show_alert({
                    message: `Successfully cleared ${format_currency(res.total_cleared, 'KES')} for ${res.count} staff to salary deductions!`,
                    indicator: 'green'
                }, 7);
                
                $w.find('#exec-clear-shorts-modal').hide();
                load_exec_shortage_balances(wrapper);
                
                // Show Confirmed Salary Deductions Schedule
                window.LAST_CLEARED_DEDUCTIONS = res;
                render_exec_deductions_schedule(wrapper, res);
            }
        },
        error: function(err) {
            $btn.prop('disabled', false);
            $btn.find('.spinner-border').addClass('hidden');
            frappe.msgprint({
                title: __('Clearance Failed'),
                indicator: 'red',
                message: err.message || __('Failed to clear staff shortages. Please check error logs.')
            });
        }
    });
}

function render_exec_deductions_schedule(wrapper, result) {
    let $w = $(wrapper);
    let entries = result.entries || [];
    let station = result.station || 'RUBIS POA PLACE';
    let dateStr = frappe.datetime.str_to_user(result.clearance_date);
    
    let rowsHtml = '';
    entries.forEach((e, idx) => {
        rowsHtml += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="text-align: center; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
                <td>
                    <div style="font-weight: 700; color: #0f172a;">${frappe.utils.escape_html(e.employee_name)}</div>
                    <div style="font-size: 11px; color: #64748b; font-family: monospace;">${e.employee}</div>
                </td>
                <td style="text-align: right; font-weight: 800; font-family: monospace; color: #b91c1c; font-size: 13px;">
                    ${format_currency(e.amount, '')}
                </td>
                <td style="font-size: 11.5px; color: #475569;">
                    ${frappe.utils.escape_html(e.reason)}
                </td>
            </tr>
        `;
    });
    
    let html = `
        <div style="background: #fff; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <div>
                    <h4 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: #0f172a;">${frappe.utils.escape_html(station)}</h4>
                    <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Memo: <b>${frappe.utils.escape_html(result.reason)}</b> &bull; Effective Date: <b>${dateStr}</b></div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Total Deductions</div>
                    <div style="font-size: 16px; font-weight: 800; color: #1e3a8a; font-family: monospace;">${format_currency(result.total_cleared, 'KES')}</div>
                </div>
            </div>
            ${result.journal_entry ? `<div style="font-size: 11.5px; color: #059669; font-weight: 600;">Linked Accounting Journal Entry: <b>${result.journal_entry}</b></div>` : ''}
        </div>
        
        <table class="table table-bordered" style="width: 100%; margin: 0; background: #fff; font-size: 12px;">
            <thead>
                <tr style="background: #f1f5f9;">
                    <th style="width: 36px; text-align: center;">#</th>
                    <th>Attendant</th>
                    <th style="text-align: right; width: 150px;">Confirmed Deduction (KES)</th>
                    <th>Clearance Memo</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot style="background: #f8fafc; font-weight: 800;">
                <tr>
                    <td colspan="2" style="text-align: right;">TOTAL CONFIRMED DEDUCTIONS:</td>
                    <td style="text-align: right; font-family: monospace; color: #b91c1c;">${format_currency(result.total_cleared, 'KES')}</td>
                    <td>Across ${result.count} attendants</td>
                </tr>
            </tfoot>
        </table>
    `;
    
    $w.find('#exec-deductions-schedule-content').html(html);
    $w.find('#exec-deductions-schedule-modal').css('display', 'flex').show();
}

function print_exec_deductions_schedule(result) {
    if (!result || !result.entries) return;
    let companyName = frappe.defaults.get_user_default("Company") || "KILIBET INVESTMENT LTD";
    let station = result.station || "RUBIS POA PLACE";
    let dateStr = frappe.datetime.str_to_user(result.clearance_date);
    
    let rowsHtml = '';
    result.entries.forEach((e, idx) => {
        rowsHtml += `
            <tr>
                <td style="text-align: center;">${idx + 1}</td>
                <td><b>${frappe.utils.escape_html(e.employee_name)}</b></td>
                <td style="font-family: monospace;">${e.employee}</td>
                <td style="text-align: right; font-family: monospace; font-weight: 800;">${Number(e.amount).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                <td>${frappe.utils.escape_html(e.reason)}</td>
            </tr>
        `;
    });
    
    let printHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Staff Salary Deduction Schedule - ${station}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 25px; margin: 0; }
                .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
                .title { font-size: 18px; font-weight: 800; text-transform: uppercase; margin: 0; color: #0f172a; }
                .subtitle { font-size: 13px; color: #475569; margin-top: 4px; font-weight: 600; }
                .meta { display: flex; justify-content: space-between; margin-bottom: 16px; font-size: 11px; background: #f8fafc; padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 6px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11.5px; }
                th, td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; }
                th { background: #f1f5f9; font-weight: 700; text-transform: uppercase; font-size: 10.5px; }
                .sign-section { margin-top: 40px; display: flex; justify-content: space-between; font-size: 11px; }
                .sign-box { width: 28%; border-top: 1px solid #64748b; padding-top: 6px; text-align: center; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">${companyName}</div>
                <div class="subtitle">STAFF SALARY DEDUCTIONS SCHEDULE — ${station.toUpperCase()}</div>
            </div>
            <div class="meta">
                <div>
                    <div><b>Station:</b> ${station}</div>
                    <div><b>Clearance Memo:</b> ${result.reason}</div>
                </div>
                <div style="text-align: right;">
                    <div><b>Effective Date:</b> ${dateStr}</div>
                    <div><b>Date Printed:</b> ${new Date().toLocaleString()}</div>
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th style="width: 30px; text-align: center;">#</th>
                        <th>Attendant / Staff Name</th>
                        <th style="width: 120px;">Staff ID</th>
                        <th style="text-align: right; width: 140px;">Confirmed Deduction (KES)</th>
                        <th>Remarks / Reason</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                    <tr style="font-weight: 800; background: #f8fafc;">
                        <td colspan="3" style="text-align: right; text-transform: uppercase;">TOTAL CONFIRMED DEDUCTIONS:</td>
                        <td style="text-align: right; font-family: monospace;">KES ${Number(result.total_cleared).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                        <td>Total Staff: ${result.count}</td>
                    </tr>
                </tfoot>
            </table>
            <div class="sign-section">
                <div class="sign-box">Prepared By (Station Manager)<br><br>Sign: _______________________</div>
                <div class="sign-box">Verified By (Accountant)<br><br>Sign: _______________________</div>
                <div class="sign-box">Approved By (Director)<br><br>Sign: _______________________</div>
            </div>
            <script>window.onload = function() { window.print(); };</script>
        </body>
        </html>
    `;
    
    let printWindow = window.open('', '_blank');
    printWindow.document.write(printHtml);
    printWindow.document.close();
}

function export_exec_deductions_csv(result) {
    if (!result || !result.entries || result.entries.length === 0) {
        frappe.msgprint("No deduction entries to export.");
        return;
    }
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Row,Employee ID,Staff Name,Station,Clearance Date,Deduction Amount (KES),Reason\n";
    
    result.entries.forEach((e, idx) => {
        let name = (e.employee_name || '').replace(/"/g, '""');
        let id = e.employee || '';
        let st = result.station || '';
        let dt = result.clearance_date || '';
        let amt = flt(e.amount).toFixed(2);
        let rsn = (e.reason || '').replace(/"/g, '""');
        csvContent += `${idx + 1},"${id}","${name}","${st}","${dt}",${amt},"${rsn}"\n`;
    });
    
    let encodedUri = encodeURI(csvContent);
    let link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Salary_Deductions_Schedule_${result.clearance_date || 'clearance'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


// ========================================================
// SIDEBAR ACCOUNT MODULES RENDERING (CASH & BANK & SUPPLIERS)
// ========================================================
function render_sidebar_account_modules(wrapper, selectedStation) {
    frappe.call({
        method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_executive_accounts",
        args: {
            station: selectedStation || ""
        },
        callback: function(r) {
            if (!r.message) return;
            let cashAccounts = r.message.cash_bank_accounts || [];
            let supplierAccounts = r.message.supplier_accounts || [];

            window.EXEC_ACCOUNTS_CACHE = {
                cash_bank: cashAccounts,
                suppliers: supplierAccounts
            };

            let activeTab = $(wrapper).find('.exec-main:visible').attr('id') || 'tab-dashboard';
            let activeCashAcc = window.EXEC_CA_STATE ? window.EXEC_CA_STATE.active_account : null;
            let activeSuppAcc = window.EXEC_SUPP_ACC_STATE ? window.EXEC_SUPP_ACC_STATE.active_account : null;

            // Render Cash & Bank Accounts in sidebar
            let cashHtml = '';
            let validCashFound = false;
            cashAccounts.forEach(acc => {
                let isCurrent = (activeTab === 'tab-cash-accounts' && acc.name === activeCashAcc);
                if (acc.name === activeCashAcc) validCashFound = true;

                let icon = 'payments';
                let upper = (acc.name || '').toUpperCase();
                if (upper.includes('MPESA') || upper.includes('TILL')) {
                    icon = 'phone_android';
                } else if (acc.account_type === 'Bank' || upper.includes('EQUITY') || upper.includes('KCB')) {
                    icon = 'account_balance';
                }

                let shortLabel = acc.label || acc.name.replace(' - KIL', '');

                cashHtml += `
                    <a class="exec-nav-item ${isCurrent ? 'active' : ''}" data-tab="tab-cash-accounts" data-account="${acc.name}" title="${acc.name}">
                        <span class="material-symbols-outlined">${icon}</span>
                        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${shortLabel}</span>
                    </a>
                `;
            });
            if (cashAccounts.length === 0) {
                cashHtml = '<div style="font-size: 11px; color: #94a3b8; padding: 6px 16px;">No accounts found</div>';
            }
            $(wrapper).find('#exec-sidebar-cash-accounts').html(cashHtml);

            // Render Supplier Accounts in sidebar
            let suppHtml = '';
            let validSuppFound = false;
            supplierAccounts.forEach(acc => {
                let isCurrent = (activeTab === 'tab-supplier-accounts' && acc.name === activeSuppAcc);
                if (acc.name === activeSuppAcc) validSuppFound = true;

                let shortLabel = acc.label || acc.name.replace(' - KIL', '');

                suppHtml += `
                    <a class="exec-nav-item ${isCurrent ? 'active' : ''}" data-tab="tab-supplier-accounts" data-account="${acc.name}" title="${acc.name}">
                        <span class="material-symbols-outlined">local_shipping</span>
                        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${shortLabel}</span>
                    </a>
                `;
            });
            if (supplierAccounts.length === 0) {
                suppHtml = '<div style="font-size: 11px; color: #94a3b8; padding: 6px 16px;">No supplier accounts</div>';
            }
            $(wrapper).find('#exec-sidebar-supplier-accounts').html(suppHtml);

            // Update section count badges
            $(wrapper).find('#exec-badge-cash-count').text(cashAccounts.length);
            $(wrapper).find('#exec-badge-supp-count').text(supplierAccounts.length);

            // If user is currently on cash accounts tab and active account is no longer in list, switch to first available
            if (activeTab === 'tab-cash-accounts') {
                let cashSec = $(wrapper).find('#sec-cash-accounts');
                cashSec.find('.exec-nav-section-header').removeClass('collapsed');
                cashSec.find('.exec-nav-section-body').removeClass('collapsed').show();

                if (!validCashFound && cashAccounts.length > 0) {
                    window.EXEC_CA_STATE = window.EXEC_CA_STATE || {};
                    window.EXEC_CA_STATE.active_account = cashAccounts[0].name;
                    $(wrapper).find(`#exec-sidebar-cash-accounts .exec-nav-item[data-account="${cashAccounts[0].name}"]`).addClass('active');
                    load_exec_cash_accounts(wrapper);
                }
            } else if (activeTab === 'tab-supplier-accounts') {
                let suppSec = $(wrapper).find('#sec-supplier-accounts');
                suppSec.find('.exec-nav-section-header').removeClass('collapsed');
                suppSec.find('.exec-nav-section-body').removeClass('collapsed').show();

                if (!validSuppFound && supplierAccounts.length > 0) {
                    window.EXEC_SUPP_ACC_STATE = window.EXEC_SUPP_ACC_STATE || {};
                    window.EXEC_SUPP_ACC_STATE.active_account = supplierAccounts[0].name;
                    $(wrapper).find(`#exec-sidebar-supplier-accounts .exec-nav-item[data-account="${supplierAccounts[0].name}"]`).addClass('active');
                    load_exec_supplier_account(wrapper);
                }
            }
        }
    });
}


// ========================================================
// CASH & BANK ACCOUNTS MODULE
// ========================================================
function init_exec_cash_accounts(wrapper) {
    if (!window.EXEC_CA_STATE) {
        window.EXEC_CA_STATE = {
            active_account: null,
            from_date: null,
            to_date: null,
            type_filter: 'all',
            search: '',
            raw_data: null
        };
    }

    let today = frappe.datetime.get_today();
    if (!window.EXEC_CA_STATE.to_date) {
        window.EXEC_CA_STATE.to_date = today;
        window.EXEC_CA_STATE.from_date = frappe.datetime.add_days(today, -6);
    }

    $(wrapper).find('#exec-ca-from').val(window.EXEC_CA_STATE.from_date);
    $(wrapper).find('#exec-ca-to').val(window.EXEC_CA_STATE.to_date);

    // Date Presets
    $(wrapper).find('.exec-ca-preset').off('click').on('click', function() {
        $(wrapper).find('.exec-ca-preset').removeClass('active').css({'background': '#fff', 'color': '#64748b', 'font-weight': '600', 'border-color': '#e2e8f0'});
        $(this).addClass('active').css({'background': '#e0e7ff', 'color': '#3730a3', 'font-weight': '700', 'border-color': '#cbd5e1'});

        let preset = $(this).data('preset');
        let end = frappe.datetime.get_today();
        let start = end;

        if (preset === 'today') {
            start = end;
        } else if (preset === 'last_7') {
            start = frappe.datetime.add_days(end, -6);
        } else if (preset === 'this_month') {
            start = frappe.datetime.month_start();
        } else if (preset === 'last_month') {
            let parts = end.split('-');
            let year = parseInt(parts[0]);
            let month = parseInt(parts[1]) - 1;
            if (month === 0) {
                month = 12;
                year -= 1;
            }
            let monthStr = month < 10 ? '0' + month : '' + month;
            start = `${year}-${monthStr}-01`;
            let lastDay = new Date(year, month, 0).getDate();
            end = `${year}-${monthStr}-${lastDay}`;
        } else if (preset === 'this_year') {
            let year = end.split('-')[0];
            start = `${year}-01-01`;
        }

        window.EXEC_CA_STATE.from_date = start;
        window.EXEC_CA_STATE.to_date = end;
        $(wrapper).find('#exec-ca-from').val(start);
        $(wrapper).find('#exec-ca-to').val(end);
        load_exec_cash_accounts(wrapper);
    });

    // Apply button
    $(wrapper).find('#btn-exec-ca-apply').off('click').on('click', function() {
        window.EXEC_CA_STATE.from_date = $(wrapper).find('#exec-ca-from').val();
        window.EXEC_CA_STATE.to_date = $(wrapper).find('#exec-ca-to').val();
        load_exec_cash_accounts(wrapper);
    });

    // Search input
    $(wrapper).find('#exec-ca-search-input').off('input').on('input', function() {
        window.EXEC_CA_STATE.search = $(this).val().trim().toLowerCase();
        render_exec_ca_table(wrapper);
    });

    // Type filter buttons
    $(wrapper).find('.exec-ca-type-filter').off('click').on('click', function() {
        $(wrapper).find('.exec-ca-type-filter').removeClass('active').css({'background': 'transparent', 'color': '#64748b', 'font-weight': '600'});
        $(this).addClass('active').css({'background': '#fff', 'color': '#0f172a', 'font-weight': '700'});
        window.EXEC_CA_STATE.type_filter = $(this).data('filter');
        render_exec_ca_table(wrapper);
    });

    // Print & Export
    $(wrapper).find('#btn-exec-ca-print').off('click').on('click', function() {
        print_exec_ca_ledger(wrapper);
    });
    $(wrapper).find('#btn-exec-ca-export').off('click').on('click', function() {
        export_exec_ca_csv(wrapper);
    });
    $(wrapper).find('#btn-exec-transfer-supplier').off('click').on('click', function() {
        open_supplier_payment_modal(wrapper, 'bank_transfer', window.EXEC_CA_STATE ? window.EXEC_CA_STATE.active_account : null, window.ACTIVE_STATION);
    });

    load_exec_cash_accounts(wrapper);
}

function load_exec_cash_accounts(wrapper) {
    $(wrapper).find('#exec-ca-table-body').html('<tr><td colspan="7" style="text-align: center; padding: 30px; color: #94a3b8;"><span class="spinner"></span> Loading ledger...</td></tr>');

    frappe.call({
        method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_cash_accounts_overview',
        args: {
            account: window.EXEC_CA_STATE.active_account,
            from_date: window.EXEC_CA_STATE.from_date,
            to_date: window.EXEC_CA_STATE.to_date,
            is_supplier: 0
        },
        callback: function(r) {
            if (r.message) {
                let data = r.message;
                window.EXEC_CA_STATE.raw_data = data;
                window.EXEC_CA_STATE.active_account = data.account;

                // Sync sidebar active state
                $(wrapper).find('#exec-sidebar-cash-accounts .exec-nav-item').removeClass('active');
                $(wrapper).find(`#exec-sidebar-cash-accounts .exec-nav-item[data-account="${data.account}"]`).addClass('active');

                // Update Header and Active Badge
                let cleanName = (data.account || '').replace(' - KIL', '');
                $(wrapper).find('#exec-ca-header-title').text(`${cleanName} (Cash & Bank Account)`);
                $(wrapper).find('#exec-ca-active-account-badge').text(data.account);

                // Update 5 KPIs
                $(wrapper).find('#exec-ca-kpi-opening').text(`KES ${Number(data.opening_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-ca-kpi-inflows').text(`KES ${Number(data.total_inflows || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-ca-kpi-outflows').text(`KES ${Number(data.total_outflows || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-ca-kpi-net').text(`KES ${Number(data.net_change || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                if (data.net_change >= 0) {
                    $(wrapper).find('#exec-ca-kpi-net').css('color', '#16a34a');
                } else {
                    $(wrapper).find('#exec-ca-kpi-net').css('color', '#dc2626');
                }
                $(wrapper).find('#exec-ca-kpi-closing').text(`KES ${Number(data.closing_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

                // Update Footers
                $(wrapper).find('#exec-ca-foot-inflows').text(`KES ${Number(data.total_inflows || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-ca-foot-outflows').text(`KES ${Number(data.total_outflows || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-ca-foot-closing').text(`KES ${Number(data.closing_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

                render_exec_ca_table(wrapper);
            }
        }
    });
}

function render_exec_ca_table(wrapper) {
    let data = window.EXEC_CA_STATE.raw_data;
    if (!data || !data.transactions) return;

    let txns = data.transactions;
    let typeFilter = window.EXEC_CA_STATE.type_filter;
    let search = (window.EXEC_CA_STATE.search || '').toLowerCase();

    let filtered = txns.filter(t => {
        if (typeFilter === 'inflows' && (t.debit <= 0)) return false;
        if (typeFilter === 'outflows' && (t.credit <= 0)) return false;

        if (search) {
            let text = `${t.voucher_no || ''} ${t.voucher_type || ''} ${t.remarks || ''} ${t.against || ''}`.toLowerCase();
            if (!text.includes(search)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        $(wrapper).find('#exec-ca-table-body').html('<tr><td colspan="7" style="text-align: center; padding: 30px; color: #94a3b8;">No transactions found matching criteria.</td></tr>');
        return;
    }

    let rowsHtml = '';
    filtered.forEach(t => {
        let debitStr = t.debit > 0 ? `KES ${Number(t.debit).toLocaleString('en-US', {minimumFractionDigits: 2})}` : '-';
        let creditStr = t.credit > 0 ? `KES ${Number(t.credit).toLocaleString('en-US', {minimumFractionDigits: 2})}` : '-';
        let runningStr = `KES ${Number(t.running_balance).toLocaleString('en-US', {minimumFractionDigits: 2})}`;

        let vLink = t.voucher_no;
        if (t.voucher_type && t.voucher_no) {
            vLink = `<a href="/app/${frappe.router.slug(t.voucher_type)}/${t.voucher_no}" target="_blank" style="color: #2563eb; font-weight: 600; text-decoration: underline;">${t.voucher_no}</a>`;
        }

        let memo = (t.remarks || '').replace(/\n/g, ' · ');

        rowsHtml += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="font-size: 12px; color: #475569; white-space: nowrap;">${t.date_formatted}</td>
                <td style="font-size: 12px; font-family: monospace;">
                    <div style="font-weight: 700; color: #0f172a;">${vLink}</div>
                    <div style="font-size: 10px; color: #94a3b8;">${t.voucher_type}</div>
                </td>
                <td style="font-size: 12px; color: #1e293b; max-width: 320px; word-break: break-word;">${memo}</td>
                <td style="font-size: 11px; color: #64748b; max-width: 220px; word-break: break-word;">${t.against || '-'}</td>
                <td style="text-align: right; font-family: monospace; font-size: 13px; color: ${t.debit > 0 ? '#16a34a' : '#94a3b8'}; font-weight: ${t.debit > 0 ? '700' : 'normal'};">${debitStr}</td>
                <td style="text-align: right; font-family: monospace; font-size: 13px; color: ${t.credit > 0 ? '#dc2626' : '#94a3b8'}; font-weight: ${t.credit > 0 ? '700' : 'normal'};">${creditStr}</td>
                <td style="text-align: right; font-family: monospace; font-size: 13px; font-weight: 800; color: #0f172a;">${runningStr}</td>
            </tr>
        `;
    });

    $(wrapper).find('#exec-ca-table-body').html(rowsHtml);
}

function print_exec_ca_ledger(wrapper) {
    let data = window.EXEC_CA_STATE.raw_data;
    if (!data || !data.transactions) {
        frappe.msgprint("No ledger records available to print.");
        return;
    }

    let txns = data.transactions;
    let rowsHtml = '';
    txns.forEach(t => {
        let debitStr = t.debit > 0 ? Number(t.debit).toLocaleString('en-US', {minimumFractionDigits: 2}) : '-';
        let creditStr = t.credit > 0 ? Number(t.credit).toLocaleString('en-US', {minimumFractionDigits: 2}) : '-';
        let runningStr = Number(t.running_balance).toLocaleString('en-US', {minimumFractionDigits: 2});
        let memo = (t.remarks || '').replace(/\n/g, ' · ');

        rowsHtml += `
            <tr>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${t.date_formatted}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-family: monospace;">${t.voucher_no} (${t.voucher_type})</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${memo}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${t.against || '-'}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-family: monospace;">${debitStr}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-family: monospace;">${creditStr}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-family: monospace; font-weight: bold;">${runningStr}</td>
            </tr>
        `;
    });

    let printHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Cash Account Ledger - ${data.account}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 20px; color: #1e293b; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                th { background: #f8fafc; text-align: left; padding: 8px; border-bottom: 2px solid #cbd5e1; font-size: 11px; }
                @media print { body { padding: 0; } }
            </style>
        </head>
        <body>
            <div style="border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 15px;">
                <h2 style="margin: 0; color: #0f172a;">KILIBET INVESTMENT LTD</h2>
                <h3 style="margin: 4px 0; color: #334155;">Cash & Bank Account Ledger: ${data.account}</h3>
                <div style="font-size: 12px; color: #64748b;">Period: ${data.from_date} to ${data.to_date} | Generated: ${new Date().toLocaleString()}</div>
            </div>

            <div style="display: flex; gap: 20px; margin-bottom: 15px; font-size: 12px; background: #f8fafc; padding: 10px; border-radius: 6px;">
                <div><strong>Opening (B/F):</strong> KES ${Number(data.opening_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                <div><strong>Total Inflows:</strong> KES ${Number(data.total_inflows || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                <div><strong>Total Outflows:</strong> KES ${Number(data.total_outflows || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                <div><strong>Net Change:</strong> KES ${Number(data.net_change || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                <div><strong>Closing (C/F):</strong> KES ${Number(data.closing_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Voucher #</th>
                        <th>Description / Memo</th>
                        <th>Against</th>
                        <th style="text-align: right;">Inflow (Debit)</th>
                        <th style="text-align: right;">Outflow (Credit)</th>
                        <th style="text-align: right;">Running Bal</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
            <script>window.onload = function() { window.print(); };</script>
        </body>
        </html>
    `;

    let w = window.open('', '_blank');
    w.document.write(printHtml);
    w.document.close();
}

function export_exec_ca_csv(wrapper) {
    let data = window.EXEC_CA_STATE.raw_data;
    if (!data || !data.transactions || data.transactions.length === 0) {
        frappe.msgprint("No ledger records available to export.");
        return;
    }

    let csv = "data:text/csv;charset=utf-8,";
    csv += "Date,Voucher Type,Voucher No,Description,Against Account,Inflow Debit (KES),Outflow Credit (KES),Running Balance (KES)\n";

    data.transactions.forEach(t => {
        let memo = (t.remarks || '').replace(/"/g, '""').replace(/\n/g, ' ');
        let against = (t.against || '').replace(/"/g, '""');
        let d = (t.debit || 0).toFixed(2);
        let c = (t.credit || 0).toFixed(2);
        let b = (t.running_balance || 0).toFixed(2);

        csv += `"${t.posting_date}","${t.voucher_type}","${t.voucher_no}","${memo}","${against}",${d},${c},${b}\n`;
    });

    let uri = encodeURI(csv);
    let link = document.createElement("a");
    link.setAttribute("href", uri);
    let safeName = (data.account || 'Cash_Account').replace(/[^a-zA-Z0-9]/g, '_');
    link.setAttribute("download", `Ledger_${safeName}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


// ========================================================
// SUPPLIER ACCOUNTS MODULE
// ========================================================
function init_exec_supplier_accounts(wrapper) {
    if (!window.EXEC_SUPP_ACC_STATE) {
        window.EXEC_SUPP_ACC_STATE = {
            active_account: null,
            from_date: null,
            to_date: null,
            type_filter: 'all',
            search: '',
            raw_data: null
        };
    }

    let today = frappe.datetime.get_today();
    if (!window.EXEC_SUPP_ACC_STATE.to_date) {
        window.EXEC_SUPP_ACC_STATE.to_date = today;
        window.EXEC_SUPP_ACC_STATE.from_date = frappe.datetime.add_days(today, -6);
    }

    $(wrapper).find('#exec-supp-from').val(window.EXEC_SUPP_ACC_STATE.from_date);
    $(wrapper).find('#exec-supp-to').val(window.EXEC_SUPP_ACC_STATE.to_date);

    // Date Presets
    $(wrapper).find('.exec-supp-preset').off('click').on('click', function() {
        $(wrapper).find('.exec-supp-preset').removeClass('active').css({'background': '#fff', 'color': '#64748b', 'font-weight': '600', 'border-color': '#e2e8f0'});
        $(this).addClass('active').css({'background': '#e0e7ff', 'color': '#3730a3', 'font-weight': '700', 'border-color': '#cbd5e1'});

        let preset = $(this).data('preset');
        let end = frappe.datetime.get_today();
        let start = end;

        if (preset === 'today') {
            start = end;
        } else if (preset === 'last_7') {
            start = frappe.datetime.add_days(end, -6);
        } else if (preset === 'this_month') {
            start = frappe.datetime.month_start();
        } else if (preset === 'last_month') {
            let parts = end.split('-');
            let year = parseInt(parts[0]);
            let month = parseInt(parts[1]) - 1;
            if (month === 0) {
                month = 12;
                year -= 1;
            }
            let monthStr = month < 10 ? '0' + month : '' + month;
            start = `${year}-${monthStr}-01`;
            let lastDay = new Date(year, month, 0).getDate();
            end = `${year}-${monthStr}-${lastDay}`;
        } else if (preset === 'this_year') {
            let year = end.split('-')[0];
            start = `${year}-01-01`;
        }

        window.EXEC_SUPP_ACC_STATE.from_date = start;
        window.EXEC_SUPP_ACC_STATE.to_date = end;
        $(wrapper).find('#exec-supp-from').val(start);
        $(wrapper).find('#exec-supp-to').val(end);
        load_exec_supplier_account(wrapper);
    });

    // Apply button
    $(wrapper).find('#btn-exec-supp-apply').off('click').on('click', function() {
        window.EXEC_SUPP_ACC_STATE.from_date = $(wrapper).find('#exec-supp-from').val();
        window.EXEC_SUPP_ACC_STATE.to_date = $(wrapper).find('#exec-supp-to').val();
        load_exec_supplier_account(wrapper);
    });

    // Search input
    $(wrapper).find('#exec-supp-search-input').off('input').on('input', function() {
        window.EXEC_SUPP_ACC_STATE.search = $(this).val().trim().toLowerCase();
        render_exec_supp_table(wrapper);
    });

    // Type filter buttons
    $(wrapper).find('.exec-supp-type-filter').off('click').on('click', function() {
        $(wrapper).find('.exec-supp-type-filter').removeClass('active').css({'background': 'transparent', 'color': '#64748b', 'font-weight': '600'});
        $(this).addClass('active').css({'background': '#fff', 'color': '#0f172a', 'font-weight': '700'});
        window.EXEC_SUPP_ACC_STATE.type_filter = $(this).data('filter');
        render_exec_supp_table(wrapper);
    });

    // Print & Export & Payment modal
    $(wrapper).find('#btn-exec-supp-print').off('click').on('click', function() {
        print_exec_supp_ledger(wrapper);
    });
    $(wrapper).find('#btn-exec-supp-export').off('click').on('click', function() {
        export_exec_supp_csv(wrapper);
    });
    $(wrapper).find('#btn-exec-supp-record-payment').off('click').on('click', function() {
        open_supplier_payment_modal(wrapper, 'bank_transfer', window.EXEC_SUPP_ACC_STATE ? window.EXEC_SUPP_ACC_STATE.active_account : null, window.ACTIVE_STATION);
    });

    load_exec_supplier_account(wrapper);
}

function load_exec_supplier_account(wrapper) {
    $(wrapper).find('#exec-supp-table-body').html('<tr><td colspan="7" style="text-align: center; padding: 30px; color: #94a3b8;"><span class="spinner"></span> Loading supplier ledger...</td></tr>');

    frappe.call({
        method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_cash_accounts_overview',
        args: {
            account: window.EXEC_SUPP_ACC_STATE ? window.EXEC_SUPP_ACC_STATE.active_account : null,
            from_date: window.EXEC_SUPP_ACC_STATE ? window.EXEC_SUPP_ACC_STATE.from_date : null,
            to_date: window.EXEC_SUPP_ACC_STATE ? window.EXEC_SUPP_ACC_STATE.to_date : null,
            is_supplier: 1
        },
        callback: function(r) {
            if (r.message) {
                let data = r.message;
                window.EXEC_SUPP_ACC_STATE = window.EXEC_SUPP_ACC_STATE || {};
                window.EXEC_SUPP_ACC_STATE.raw_data = data;
                window.EXEC_SUPP_ACC_STATE.active_account = data.account;

                // Sync sidebar active state
                $(wrapper).find('#exec-sidebar-supplier-accounts .exec-nav-item').removeClass('active');
                $(wrapper).find(`#exec-sidebar-supplier-accounts .exec-nav-item[data-account="${data.account}"]`).addClass('active');

                // Update Header and Active Badge
                let cleanName = (data.account || '').replace(' - KIL', '');
                $(wrapper).find('#exec-supp-header-title').text(`${cleanName} (Supplier Account)`);
                $(wrapper).find('#exec-supp-active-account-badge').text(data.account);

                // Update 5 KPIs (Deliveries / Credits vs Payments / Debits)
                $(wrapper).find('#exec-supp-kpi-opening').text(`KES ${Number(data.opening_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                let deliveries = data.total_credits || data.total_outflows || 0;
                let payments = data.total_debits || data.total_inflows || 0;
                $(wrapper).find('#exec-supp-kpi-deliveries').text(`KES ${Number(deliveries).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-supp-kpi-payments').text(`KES ${Number(payments).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-supp-kpi-net').text(`KES ${Number(data.net_change || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-supp-kpi-closing').text(`KES ${Number(data.closing_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

                // Update Footers
                $(wrapper).find('#exec-supp-foot-deliveries').text(`KES ${Number(deliveries).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-supp-foot-payments').text(`KES ${Number(payments).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-supp-foot-closing').text(`KES ${Number(data.closing_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

                render_exec_supp_table(wrapper);
            }
        }
    });
}

function render_exec_supp_table(wrapper) {
    let data = window.EXEC_SUPP_ACC_STATE ? window.EXEC_SUPP_ACC_STATE.raw_data : null;
    if (!data || !data.transactions) return;

    let txns = data.transactions;
    let typeFilter = window.EXEC_SUPP_ACC_STATE.type_filter;
    let search = (window.EXEC_SUPP_ACC_STATE.search || '').toLowerCase();

    let filtered = txns.filter(t => {
        if (typeFilter === 'credits' && (t.credit <= 0)) return false;
        if (typeFilter === 'debits' && (t.debit <= 0)) return false;

        if (search) {
            let text = `${t.voucher_no || ''} ${t.voucher_type || ''} ${t.remarks || ''} ${t.against || ''}`.toLowerCase();
            if (!text.includes(search)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        $(wrapper).find('#exec-supp-table-body').html('<tr><td colspan="7" style="text-align: center; padding: 30px; color: #94a3b8;">No supplier transactions found matching criteria.</td></tr>');
        return;
    }

    let rowsHtml = '';
    filtered.forEach(t => {
        let creditStr = t.credit > 0 ? `KES ${Number(t.credit).toLocaleString('en-US', {minimumFractionDigits: 2})}` : '-';
        let debitStr = t.debit > 0 ? `KES ${Number(t.debit).toLocaleString('en-US', {minimumFractionDigits: 2})}` : '-';
        let runningStr = `KES ${Number(t.running_balance).toLocaleString('en-US', {minimumFractionDigits: 2})}`;

        let vLink = t.voucher_no;
        if (t.voucher_type && t.voucher_no) {
            vLink = `<a href="/app/${frappe.router.slug(t.voucher_type)}/${t.voucher_no}" target="_blank" style="color: #2563eb; font-weight: 600; text-decoration: underline;">${t.voucher_no}</a>`;
        }

        let memo = (t.remarks || '').replace(/\n/g, ' · ');

        rowsHtml += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="font-size: 12px; color: #475569; white-space: nowrap;">${t.date_formatted}</td>
                <td style="font-size: 12px; font-family: monospace;">
                    <div style="font-weight: 700; color: #0f172a;">${vLink}</div>
                    <div style="font-size: 10px; color: #94a3b8;">${t.voucher_type}</div>
                </td>
                <td style="font-size: 12px; color: #1e293b; max-width: 320px; word-break: break-word;">${memo}</td>
                <td style="font-size: 11px; color: #64748b; max-width: 220px; word-break: break-word;">${t.against || '-'}</td>
                <td style="text-align: right; font-family: monospace; font-size: 13px; color: ${t.credit > 0 ? '#d97706' : '#94a3b8'}; font-weight: ${t.credit > 0 ? '700' : 'normal'};">${creditStr}</td>
                <td style="text-align: right; font-family: monospace; font-size: 13px; color: ${t.debit > 0 ? '#16a34a' : '#94a3b8'}; font-weight: ${t.debit > 0 ? '700' : 'normal'};">${debitStr}</td>
                <td style="text-align: right; font-family: monospace; font-size: 13px; font-weight: 800; color: #0f172a;">${runningStr}</td>
            </tr>
        `;
    });

    $(wrapper).find('#exec-supp-table-body').html(rowsHtml);
}

function print_exec_supp_ledger(wrapper) {
    let data = window.EXEC_SUPP_ACC_STATE ? window.EXEC_SUPP_ACC_STATE.raw_data : null;
    if (!data || !data.transactions) {
        frappe.msgprint("No supplier ledger records available to print.");
        return;
    }

    let txns = data.transactions;
    let rowsHtml = '';
    txns.forEach(t => {
        let creditStr = t.credit > 0 ? Number(t.credit).toLocaleString('en-US', {minimumFractionDigits: 2}) : '-';
        let debitStr = t.debit > 0 ? Number(t.debit).toLocaleString('en-US', {minimumFractionDigits: 2}) : '-';
        let runningStr = Number(t.running_balance).toLocaleString('en-US', {minimumFractionDigits: 2});
        let memo = (t.remarks || '').replace(/\n/g, ' · ');

        rowsHtml += `
            <tr>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${t.date_formatted}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-family: monospace;">${t.voucher_no} (${t.voucher_type})</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${memo}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${t.against || '-'}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-family: monospace; color: #d97706;">${creditStr}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-family: monospace; color: #16a34a;">${debitStr}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-family: monospace; font-weight: bold;">${runningStr}</td>
            </tr>
        `;
    });

    let deliveries = data.total_credits || data.total_outflows || 0;
    let payments = data.total_debits || data.total_inflows || 0;

    let printHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Supplier Account Ledger - ${data.account}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 20px; color: #1e293b; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                th { background: #f8fafc; text-align: left; padding: 8px; border-bottom: 2px solid #cbd5e1; font-size: 11px; }
                @media print { body { padding: 0; } }
            </style>
        </head>
        <body>
            <div style="border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 15px;">
                <h2 style="margin: 0; color: #0f172a;">KILIBET INVESTMENT LTD</h2>
                <h3 style="margin: 4px 0; color: #334155;">Supplier Account Ledger: ${data.account}</h3>
                <div style="font-size: 12px; color: #64748b;">Period: ${data.from_date} to ${data.to_date} | Generated: ${new Date().toLocaleString()}</div>
            </div>

            <div style="display: flex; gap: 20px; margin-bottom: 15px; font-size: 12px; background: #f8fafc; padding: 10px; border-radius: 6px;">
                <div><strong>Opening (B/F):</strong> KES ${Number(data.opening_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                <div><strong>Deliveries (Credits):</strong> KES ${Number(deliveries).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                <div><strong>Payments (Debits):</strong> KES ${Number(payments).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                <div><strong>Net Movement:</strong> KES ${Number(data.net_change || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                <div><strong>Closing (C/F):</strong> KES ${Number(data.closing_balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Voucher #</th>
                        <th>Description / Memo</th>
                        <th>Against</th>
                        <th style="text-align: right; color: #d97706;">Deliveries (Credit)</th>
                        <th style="text-align: right; color: #16a34a;">Payments (Debit)</th>
                        <th style="text-align: right;">Running Bal</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
            <script>window.onload = function() { window.print(); };</script>
        </body>
        </html>
    `;

    let w = window.open('', '_blank');
    w.document.write(printHtml);
    w.document.close();
}

function export_exec_supp_csv(wrapper) {
    let data = window.EXEC_SUPP_ACC_STATE ? window.EXEC_SUPP_ACC_STATE.raw_data : null;
    if (!data || !data.transactions || data.transactions.length === 0) {
        frappe.msgprint("No supplier ledger records available to export.");
        return;
    }

    let csv = "data:text/csv;charset=utf-8,";
    csv += "Date,Voucher Type,Voucher No,Description,Against Account,Deliveries Credit (KES),Payments Debit (KES),Running Balance (KES)\n";

    data.transactions.forEach(t => {
        let memo = (t.remarks || '').replace(/"/g, '""').replace(/\n/g, ' ');
        let against = (t.against || '').replace(/"/g, '""');
        let c = (t.credit || 0).toFixed(2);
        let d = (t.debit || 0).toFixed(2);
        let b = (t.running_balance || 0).toFixed(2);

        csv += `"${t.posting_date}","${t.voucher_type}","${t.voucher_no}","${memo}","${against}",${c},${d},${b}\n`;
    });

    let uri = encodeURI(csv);
    let link = document.createElement("a");
    link.setAttribute("href", uri);
    let safeName = (data.account || 'Supplier_Account').replace(/[^a-zA-Z0-9]/g, '_');
    link.setAttribute("download", `Supplier_Ledger_${safeName}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


// ========================================================
// EXECUTIVE / DIRECTOR EXPENSES MODULE
// ========================================================
function init_exec_expenses(wrapper) {
    if (!window.EXEC_EXP_STATE) {
        window.EXEC_EXP_STATE = {
            from_date: null,
            to_date: null,
            category_filter: '',
            account_filter: '',
            search: '',
            raw_data: null,
            form_options_loaded: false
        };
    }

    let today = frappe.datetime.get_today();
    if (!window.EXEC_EXP_STATE.to_date) {
        window.EXEC_EXP_STATE.to_date = today;
        window.EXEC_EXP_STATE.from_date = frappe.datetime.month_start();
    }

    $(wrapper).find('#exec-exp-from').val(window.EXEC_EXP_STATE.from_date);
    $(wrapper).find('#exec-exp-to').val(window.EXEC_EXP_STATE.to_date);

    // Presets
    $(wrapper).find('.exec-exp-preset').off('click').on('click', function() {
        $(wrapper).find('.exec-exp-preset').removeClass('active').css({'background': '#fff', 'color': '#64748b', 'font-weight': '600', 'border-color': '#e2e8f0'});
        $(this).addClass('active').css({'background': '#e0e7ff', 'color': '#3730a3', 'font-weight': '700', 'border-color': '#cbd5e1'});

        let preset = $(this).data('preset');
        let end = frappe.datetime.get_today();
        let start = end;

        if (preset === 'today') {
            start = end;
        } else if (preset === 'this_month') {
            start = frappe.datetime.month_start();
        } else if (preset === 'last_month') {
            let parts = end.split('-');
            let year = parseInt(parts[0]);
            let month = parseInt(parts[1]) - 1;
            if (month === 0) {
                month = 12;
                year -= 1;
            }
            let monthStr = month < 10 ? '0' + month : '' + month;
            start = `${year}-${monthStr}-01`;
            let lastDay = new Date(year, month, 0).getDate();
            end = `${year}-${monthStr}-${lastDay}`;
        } else if (preset === 'last_30') {
            start = frappe.datetime.add_days(end, -29);
        } else if (preset === 'this_year') {
            let year = end.split('-')[0];
            start = `${year}-01-01`;
        }

        window.EXEC_EXP_STATE.from_date = start;
        window.EXEC_EXP_STATE.to_date = end;
        $(wrapper).find('#exec-exp-from').val(start);
        $(wrapper).find('#exec-exp-to').val(end);
        load_exec_expenses(wrapper);
    });

    // Apply
    $(wrapper).find('#btn-exec-exp-apply').off('click').on('click', function() {
        window.EXEC_EXP_STATE.from_date = $(wrapper).find('#exec-exp-from').val();
        window.EXEC_EXP_STATE.to_date = $(wrapper).find('#exec-exp-to').val();
        load_exec_expenses(wrapper);
    });

    // Search
    $(wrapper).find('#exec-exp-search-input').off('input').on('input', function() {
        window.EXEC_EXP_STATE.search = $(this).val().trim().toLowerCase();
        render_exec_exp_table(wrapper);
    });

    // Filters
    $(wrapper).find('#exec-exp-category-filter').off('change').on('change', function() {
        window.EXEC_EXP_STATE.category_filter = $(this).val();
        load_exec_expenses(wrapper);
    });
    $(wrapper).find('#exec-exp-account-filter').off('change').on('change', function() {
        window.EXEC_EXP_STATE.account_filter = $(this).val();
        load_exec_expenses(wrapper);
    });

    // Print & Export
    $(wrapper).find('#btn-exec-exp-print').off('click').on('click', function() {
        print_exec_exp_register(wrapper);
    });
    $(wrapper).find('#btn-exec-exp-export').off('click').on('click', function() {
        export_exec_exp_csv(wrapper);
    });

    // Modal Events
    $(wrapper).find('#btn-exec-open-add-expense').off('click').on('click', function() {
        open_director_expense_modal(wrapper);
    });
    $(wrapper).find('#btn-exec-open-supplier-pay').off('click').on('click', function() {
        open_supplier_payment_modal(wrapper, 'bank_transfer', null, window.ACTIVE_STATION);
    });
    $(wrapper).find('#exec-expense-modal-close, #btn-exec-modal-exp-cancel').off('click').on('click', function() {
        $(wrapper).find('#exec-expense-modal').hide();
    });
    $(wrapper).find('#btn-exec-modal-exp-submit').off('click').on('click', function() {
        submit_director_expense_form(wrapper);
    });

    load_exec_exp_options(wrapper);
    load_exec_expenses(wrapper);
}

function load_exec_exp_options(wrapper) {
    if (window.EXEC_EXP_STATE && window.EXEC_EXP_STATE.form_options_loaded) return;

    frappe.call({
        method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_director_expense_form_options',
        callback: function(r) {
            if (r.message) {
                let opts = r.message;
                window.EXEC_EXP_STATE.options = opts;
                window.EXEC_EXP_STATE.form_options_loaded = true;

                // Populate Category Filter
                let catFilterHtml = '<option value="">All Categories</option>';
                (opts.expense_accounts || []).forEach(ea => {
                    catFilterHtml += `<option value="${ea.name}">${ea.account_name}</option>`;
                });
                $(wrapper).find('#exec-exp-category-filter').html(catFilterHtml);

                // Populate Account Filter
                let accFilterHtml = '<option value="">All Payment Accounts</option>';
                (opts.payment_accounts || []).forEach(pa => {
                    accFilterHtml += `<option value="${pa.name}">${pa.name.replace(' - KIL', '')} (${pa.account_type})</option>`;
                });
                $(wrapper).find('#exec-exp-account-filter').html(accFilterHtml);

                // Populate Modal Selects
                let modalPaidFromHtml = '<option value="">Select Payment Account...</option>';
                (opts.payment_accounts || []).forEach(pa => {
                    let selected = pa.name.includes('Shift Main Cash') ? 'selected' : '';
                    modalPaidFromHtml += `<option value="${pa.name}" ${selected}>${pa.name} (${pa.account_type})</option>`;
                });
                $(wrapper).find('#exec-modal-exp-paid-from').html(modalPaidFromHtml);

                let modalCatHtml = '<option value="">Select Expense Category...</option>';
                (opts.expense_accounts || []).forEach(ea => {
                    modalCatHtml += `<option value="${ea.name}">${ea.account_name}</option>`;
                });
                $(wrapper).find('#exec-modal-exp-category').html(modalCatHtml);
            }
        }
    });
}

function open_director_expense_modal(wrapper) {
    // Reset Form
    $(wrapper).find('#exec-expense-form')[0].reset();
    $(wrapper).find('#exec-modal-exp-date').val(frappe.datetime.get_today());
    $(wrapper).find('#exec-modal-exp-alert').hide().removeClass('alert-danger alert-success');
    $(wrapper).find('#exec-modal-exp-spinner').addClass('hidden');
    $(wrapper).find('#btn-exec-modal-exp-submit').prop('disabled', false);

    load_exec_exp_options(wrapper);
    $(wrapper).find('#exec-expense-modal').css('display', 'flex');
}

function submit_director_expense_form(wrapper) {
    let date = $(wrapper).find('#exec-modal-exp-date').val();
    let amount = parseFloat($(wrapper).find('#exec-modal-exp-amount').val());
    let paid_from = $(wrapper).find('#exec-modal-exp-paid-from').val();
    let category = $(wrapper).find('#exec-modal-exp-category').val();
    let payee = $(wrapper).find('#exec-modal-exp-payee').val().trim();
    let ref_no = $(wrapper).find('#exec-modal-exp-ref').val().trim();
    let desc = $(wrapper).find('#exec-modal-exp-desc').val().trim();

    let alertBox = $(wrapper).find('#exec-modal-exp-alert');
    alertBox.hide();

    if (!date) {
        alertBox.text("Please specify expense date.").css({'background': '#fee2e2', 'color': '#991b1b'}).show();
        return;
    }
    if (isNaN(amount) || amount <= 0) {
        alertBox.text("Please enter a valid amount greater than 0.").css({'background': '#fee2e2', 'color': '#991b1b'}).show();
        return;
    }
    if (!paid_from) {
        alertBox.text("Please select the payment account.").css({'background': '#fee2e2', 'color': '#991b1b'}).show();
        return;
    }
    if (!category) {
        alertBox.text("Please select the expense category.").css({'background': '#fee2e2', 'color': '#991b1b'}).show();
        return;
    }
    if (!payee) {
        alertBox.text("Please enter the Payee / Beneficiary.").css({'background': '#fee2e2', 'color': '#991b1b'}).show();
        return;
    }
    if (!desc) {
        alertBox.text("Please provide a business purpose / description.").css({'background': '#fee2e2', 'color': '#991b1b'}).show();
        return;
    }

    $(wrapper).find('#exec-modal-exp-spinner').removeClass('hidden');
    $(wrapper).find('#btn-exec-modal-exp-submit').prop('disabled', true);

    frappe.call({
        method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.submit_director_expense',
        args: {
            date: date,
            amount: amount,
            paid_from_account: paid_from,
            expense_account: category,
            payee: payee,
            description: desc,
            reference_no: ref_no
        },
        callback: function(r) {
            $(wrapper).find('#exec-modal-exp-spinner').addClass('hidden');
            $(wrapper).find('#btn-exec-modal-exp-submit').prop('disabled', false);

            if (r.message && r.message.success) {
                frappe.show_alert({
                    message: r.message.message,
                    indicator: 'green'
                }, 5);
                $(wrapper).find('#exec-expense-modal').hide();
                load_exec_expenses(wrapper);

                // If Cash Accounts was loaded, refresh it too
                if (window.EXEC_CA_STATE && window.EXEC_CA_STATE.raw_data) {
                    load_exec_cash_accounts(wrapper);
                }
            }
        },
        error: function(err) {
            $(wrapper).find('#exec-modal-exp-spinner').addClass('hidden');
            $(wrapper).find('#btn-exec-modal-exp-submit').prop('disabled', false);
            alertBox.text("Failed to post expense: " + (err.message || err.toString())).css({'background': '#fee2e2', 'color': '#991b1b'}).show();
        }
    });
}

function load_exec_expenses(wrapper) {
    $(wrapper).find('#exec-exp-table-body').html('<tr><td colspan="9" style="text-align: center; padding: 30px; color: #94a3b8;"><span class="spinner"></span> Loading executive expenses...</td></tr>');

    frappe.call({
        method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_director_expenses_register',
        args: {
            from_date: window.EXEC_EXP_STATE.from_date,
            to_date: window.EXEC_EXP_STATE.to_date,
            expense_account: window.EXEC_EXP_STATE.category_filter,
            paid_from_account: window.EXEC_EXP_STATE.account_filter
        },
        callback: function(r) {
            if (r.message) {
                let data = r.message;
                window.EXEC_EXP_STATE.raw_data = data;

                // Update KPIs
                $(wrapper).find('#exec-exp-kpi-total').text(`KES ${Number(data.summary.total_expense || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-exp-kpi-count').text(data.summary.count || 0);
                $(wrapper).find('#exec-exp-kpi-cash').text(`KES ${Number(data.summary.cash_expense || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-exp-kpi-bank').text(`KES ${Number(data.summary.bank_expense || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-exp-kpi-top-category').text(data.summary.top_category || 'None');
                $(wrapper).find('#exec-exp-kpi-top-amount').text(`KES ${Number(data.summary.top_category_amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

                // Update Footer
                $(wrapper).find('#exec-exp-foot-total').text(`KES ${Number(data.summary.total_expense || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

                render_exec_exp_table(wrapper);
            }
        }
    });
}

function render_exec_exp_table(wrapper) {
    let data = window.EXEC_EXP_STATE.raw_data;
    if (!data || !data.records) return;

    let records = data.records;
    let search = (window.EXEC_EXP_STATE.search || '').toLowerCase();

    let filtered = records.filter(r => {
        if (search) {
            let text = `${r.voucher_no || ''} ${r.payee || ''} ${r.description || ''} ${r.reference_no || ''} ${r.expense_account || ''}`.toLowerCase();
            if (!text.includes(search)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        $(wrapper).find('#exec-exp-table-body').html('<tr><td colspan="9" style="text-align: center; padding: 30px; color: #94a3b8;">No executive expenses recorded in this period.</td></tr>');
        return;
    }

    let rowsHtml = '';
    filtered.forEach(r => {
        let amtStr = `KES ${Number(r.amount).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        let vLink = `<a href="/app/journal-entry/${r.voucher_no}" target="_blank" style="color: #2563eb; font-weight: 700; text-decoration: underline;">${r.voucher_no}</a>`;
        let catShort = (r.expense_account || '').replace(' - KIL', '');
        let paidShort = (r.paid_from_account || '').replace(' - KIL', '');

        rowsHtml += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="font-size: 12px; color: #475569; white-space: nowrap;">${r.date_formatted}</td>
                <td style="font-size: 12px; font-family: monospace;">${vLink}</td>
                <td style="font-size: 13px; font-weight: 700; color: #0f172a;">${r.payee}</td>
                <td style="font-size: 12px; color: #1e293b;">
                    <span style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;">${catShort}</span>
                </td>
                <td style="font-size: 12px; color: #475569;">
                    <span style="font-size: 11px;">${paidShort}</span>
                </td>
                <td style="font-size: 11px; font-family: monospace; color: #64748b;">${r.reference_no}</td>
                <td style="font-size: 12px; color: #334155; max-width: 280px; word-break: break-word;">${r.description}</td>
                <td style="text-align: right; font-family: monospace; font-size: 13px; font-weight: 800; color: #dc2626;">${amtStr}</td>
                <td style="text-align: center; font-size: 11px; color: #64748b;">${r.owner}</td>
            </tr>
        `;
    });

    $(wrapper).find('#exec-exp-table-body').html(rowsHtml);
}

function print_exec_exp_register(wrapper) {
    let data = window.EXEC_EXP_STATE.raw_data;
    if (!data || !data.records || data.records.length === 0) {
        frappe.msgprint("No expense records available to print.");
        return;
    }

    let rowsHtml = '';
    data.records.forEach(r => {
        let amtStr = Number(r.amount).toLocaleString('en-US', {minimumFractionDigits: 2});
        let catShort = (r.expense_account || '').replace(' - KIL', '');
        let paidShort = (r.paid_from_account || '').replace(' - KIL', '');

        rowsHtml += `
            <tr>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${r.date_formatted}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-family: monospace;">${r.voucher_no}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: bold;">${r.payee}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${catShort}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${paidShort}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${r.reference_no}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${r.description}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-family: monospace; font-weight: bold;">${amtStr}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: center;">${r.owner}</td>
            </tr>
        `;
    });

    let printHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Executive Expenses Register</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 20px; color: #1e293b; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                th { background: #f8fafc; text-align: left; padding: 8px; border-bottom: 2px solid #cbd5e1; font-size: 11px; }
                @media print { body { padding: 0; } }
            </style>
        </head>
        <body>
            <div style="border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 15px;">
                <h2 style="margin: 0; color: #0f172a;">KILIBET INVESTMENT LTD</h2>
                <h3 style="margin: 4px 0; color: #334155;">Executive & Corporate Expenses Register</h3>
                <div style="font-size: 12px; color: #64748b;">Period: ${data.from_date} to ${data.to_date} | Generated: ${new Date().toLocaleString()}</div>
            </div>

            <div style="display: flex; gap: 20px; margin-bottom: 15px; font-size: 12px; background: #f8fafc; padding: 10px; border-radius: 6px;">
                <div><strong>Total Expenses:</strong> KES ${Number(data.summary.total_expense || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                <div><strong>Cash Payments:</strong> KES ${Number(data.summary.cash_expense || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                <div><strong>Bank / Till Payments:</strong> KES ${Number(data.summary.bank_expense || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                <div><strong>Total Transactions:</strong> ${data.summary.count || 0}</div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Voucher #</th>
                        <th>Payee</th>
                        <th>Category</th>
                        <th>Paid From</th>
                        <th>Ref #</th>
                        <th>Description</th>
                        <th style="text-align: right;">Amount (KES)</th>
                        <th style="text-align: center;">Recorded By</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
            <script>window.onload = function() { window.print(); };</script>
        </body>
        </html>
    `;

    let w = window.open('', '_blank');
    w.document.write(printHtml);
    w.document.close();
}

function export_exec_exp_csv(wrapper) {
    let data = window.EXEC_EXP_STATE.raw_data;
    if (!data || !data.records || data.records.length === 0) {
        frappe.msgprint("No expense records available to export.");
        return;
    }

    let csv = "data:text/csv;charset=utf-8,";
    csv += "Date,Voucher No,Payee,Expense Category,Paid From Account,Reference No,Description,Amount (KES),Recorded By\n";

    data.records.forEach(r => {
        let payee = (r.payee || '').replace(/"/g, '""');
        let cat = (r.expense_account || '').replace(/"/g, '""');
        let paid = (r.paid_from_account || '').replace(/"/g, '""');
        let ref = (r.reference_no || '').replace(/"/g, '""');
        let desc = (r.description || '').replace(/"/g, '""').replace(/\n/g, ' ');
        let amt = (r.amount || 0).toFixed(2);
        let owner = (r.owner || '').replace(/"/g, '""');

        csv += `"${r.posting_date}","${r.voucher_no}","${payee}","${cat}","${paid}","${ref}","${desc}",${amt},"${owner}"\n`;
    });

    let uri = encodeURI(csv);
    let link = document.createElement("a");
    link.setAttribute("href", uri);
    link.setAttribute("download", `Executive_Expenses_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


// ========================================================
// BALANCE SHEET (FINANCIAL POSITION) MODULE
// ========================================================
function init_exec_balance_sheet(wrapper) {
    if (!window.EXEC_BS_STATE) {
        window.EXEC_BS_STATE = {
            as_on_date: frappe.datetime.get_today(),
            view: 'statement',
            raw_data: null
        };
    }

    $(wrapper).find('#exec-bs-as-on').val(window.EXEC_BS_STATE.as_on_date);

    // Date Presets
    $(wrapper).find('.exec-bs-preset').off('click').on('click', function() {
        $(wrapper).find('.exec-bs-preset').removeClass('active').css({'background': '#fff', 'color': '#64748b', 'font-weight': '600', 'border-color': '#e2e8f0'});
        $(this).addClass('active').css({'background': '#e0e7ff', 'color': '#3730a3', 'font-weight': '700', 'border-color': '#cbd5e1'});

        let preset = $(this).data('preset');
        let today = frappe.datetime.get_today();
        let targetDate = today;

        if (preset === 'today') {
            targetDate = today;
        } else if (preset === 'month_end') {
            targetDate = today;
        } else if (preset === 'last_month_end') {
            let parts = today.split('-');
            let y = parseInt(parts[0]);
            let m = parseInt(parts[1]) - 1;
            if (m === 0) {
                m = 12;
                y -= 1;
            }
            let mStr = m < 10 ? '0' + m : '' + m;
            let lastDay = new Date(y, m, 0).getDate();
            targetDate = `${y}-${mStr}-${lastDay}`;
        } else if (preset === 'quarter_end') {
            let parts = today.split('-');
            let y = parseInt(parts[0]);
            let m = parseInt(parts[1]);
            let qEndMonth = Math.floor((m - 1) / 3) * 3;
            if (qEndMonth === 0) {
                qEndMonth = 12;
                y -= 1;
            }
            let mStr = qEndMonth < 10 ? '0' + qEndMonth : '' + qEndMonth;
            let lastDay = new Date(y, qEndMonth, 0).getDate();
            targetDate = `${y}-${mStr}-${lastDay}`;
        } else if (preset === 'year_end') {
            let y = parseInt(today.split('-')[0]) - 1;
            targetDate = `${y}-12-31`;
        }

        window.EXEC_BS_STATE.as_on_date = targetDate;
        $(wrapper).find('#exec-bs-as-on').val(targetDate);
        load_exec_balance_sheet(wrapper);
    });

    // Apply Button
    $(wrapper).find('#btn-exec-bs-apply').off('click').on('click', function() {
        window.EXEC_BS_STATE.as_on_date = $(wrapper).find('#exec-bs-as-on').val();
        load_exec_balance_sheet(wrapper);
    });

    // View Switcher (Statement vs Breakdown)
    $(wrapper).find('#exec-bs-view-switcher .exec-preset-btn').off('click').on('click', function(e) {
        e.preventDefault();
        $(wrapper).find('#exec-bs-view-switcher .exec-preset-btn').removeClass('active');
        $(this).addClass('active');

        let view = $(this).data('view');
        window.EXEC_BS_STATE.view = view;
        if (view === 'breakdown') {
            $(wrapper).find('#exec-bs-statement-view').hide();
            $(wrapper).find('#exec-bs-breakdown-view').show();
        } else {
            $(wrapper).find('#exec-bs-breakdown-view').hide();
            $(wrapper).find('#exec-bs-statement-view').show();
        }
    });

    // Print & Export
    $(wrapper).find('#btn-exec-bs-print').off('click').on('click', function(e) {
        e.preventDefault();
        print_exec_balance_sheet(wrapper);
    });
    $(wrapper).find('#btn-exec-bs-export').off('click').on('click', function(e) {
        e.preventDefault();
        export_exec_bs_csv(wrapper);
    });

    // Station Segmented Tabs for Balance Sheet
    $(wrapper).find('#exec-bs-station-tabs .exec-bs-station-btn').off('click').on('click', function(e) {
        e.preventDefault();
        let targetStation = $(this).data('station');
        handle_exec_station_change(targetStation);
    });

    load_exec_balance_sheet(wrapper);
}

function load_exec_balance_sheet(wrapper) {
    let station = $(wrapper).find('#exec-bs-station-tabs .exec-bs-station-btn.active').data('station');
    if (station === undefined) {
        station = $(wrapper).find('#exec-global-station-select').val() || '';
    }

    $(wrapper).find('#exec-bs-formal-table').html(`
        <div style="text-align:center; padding:40px; color:#64748b;">
            <div class="spinner-border text-primary" role="status" style="width:2rem; height:2rem; margin-bottom:12px;"></div>
            <div style="font-size:13px; font-weight:600;">Calculating Balance Sheet Statement...</div>
        </div>
    `);

    frappe.call({
        method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_balance_sheet_summary',
        args: {
            as_on_date: window.EXEC_BS_STATE.as_on_date,
            station: station
        },
        callback: function(r) {
            if (r.message && !r.message.error) {
                let bs = r.message;
                window.EXEC_BS_STATE.raw_data = bs;

                // Update Header Labels
                let stLabel = bs.station ? (bs.station === 'RUBIS POA PLACE' ? 'Rubis Poa Place' : bs.station) : 'Consolidated';
                $(wrapper).find('#exec-bs-station-badge').text(stLabel);
                $(wrapper).find('#exec-bs-subtitle').text(`Statement of Financial Position: Assets, Liabilities, and Equity as of ${bs.as_on_date_formatted} (${stLabel}).`);
                $(wrapper).find('#exec-bs-statement-date').text(`As of ${bs.as_on_date_formatted}`);
                if (bs.company) {
                    $(wrapper).find('#exec-bs-company-name').text(bs.company);
                }

                let sum = bs.summary;

                // Update 5 KPI Cards
                $(wrapper).find('#exec-bs-kpi-assets').text(`KES ${Number(sum.total_assets || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-bs-kpi-current-assets').text(`Current: KES ${Number(sum.current_assets || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

                $(wrapper).find('#exec-bs-kpi-liabilities').text(`KES ${Number(sum.total_liabilities || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                $(wrapper).find('#exec-bs-kpi-current-liabilities').text(`Current: KES ${Number(sum.current_liabilities || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

                let wc = sum.working_capital || 0;
                let wcEl = $(wrapper).find('#exec-bs-kpi-working-capital');
                wcEl.text(`KES ${Number(wc).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
                if (wc >= 0) {
                    wcEl.css('color', '#0284c7');
                } else {
                    wcEl.css('color', '#dc2626');
                }

                $(wrapper).find('#exec-bs-kpi-current-ratio').text(`${(sum.current_ratio || 0).toFixed(2)}x`);

                let eqWithProfit = sum.total_equity_and_reserves || 0;
                $(wrapper).find('#exec-bs-kpi-equity').text(`KES ${Number(eqWithProfit).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

                let badgeEl = $(wrapper).find('#exec-bs-balance-badge');
                if (sum.is_balanced) {
                    badgeEl.text('✓ Equation Balanced').css({'color': '#059669', 'font-weight': '700'});
                } else {
                    badgeEl.text(`⚠ Unbalanced (Diff: KES ${sum.difference})`).css({'color': '#dc2626', 'font-weight': '700'});
                }

                // Render Tables
                render_exec_bs_statement(wrapper, bs);
                render_exec_bs_breakdown(wrapper, bs);

            } else {
                let msg = (r.message && r.message.error) ? r.message.error : "Failed to load Balance Sheet.";
                $(wrapper).find('#exec-bs-formal-table').html(`<div style="color:#dc2626; padding:30px; text-align:center;">${msg}</div>`);
            }
        }
    });
}

function render_exec_bs_statement(wrapper, bs) {
    let sum = bs.summary;

    let html = `
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
                <tr style="border-bottom:2px solid #cbd5e1; color:#475569; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">
                    <th style="padding:10px 12px; text-align:left;">Financial Line Item</th>
                    <th style="padding:10px 12px; text-align:right; width:200px;">Amount (KES)</th>
                    <th style="padding:10px 12px; text-align:right; width:120px;">% of Assets</th>
                </tr>
            </thead>
            <tbody>
    `;

    // -------------------------------------------------------------
    // SECTION 1: ASSETS
    // -------------------------------------------------------------
    html += `
        <tr style="background:#f8fafc; font-weight:800; color:#0f172a; border-top:1px solid #e2e8f0;">
            <td colspan="3" style="padding:10px 12px; letter-spacing:0.5px; font-size:12px; text-transform:uppercase; color:#0284c7;">
                1. ASSETS
            </td>
        </tr>
    `;

    (bs.asset_groups || []).forEach(grp => {
        html += `
            <tr style="background:#fdfdfd; font-weight:700; border-top:1px solid #f1f5f9;">
                <td style="padding:8px 12px 6px 18px; color:#1e293b; font-size:12px;">${grp.bucket_name}</td>
                <td style="padding:8px 12px 6px 12px; text-align:right; font-family:monospace; font-weight:700; color:#0284c7;">
                    ${Number(grp.subtotal).toLocaleString('en-US', {minimumFractionDigits: 2})}
                </td>
                <td style="padding:8px 12px 6px 12px; text-align:right; font-size:11px; color:#64748b;">
                    ${sum.total_assets ? ((grp.subtotal / sum.total_assets) * 100).toFixed(1) : 0}%
                </td>
            </tr>
        `;

        (grp.items || []).forEach(acc => {
            let accShort = (acc.account_name || acc.account || '').replace(' - KIL', '');
            let amtStr = Number(acc.amount).toLocaleString('en-US', {minimumFractionDigits: 2});
            let pct = sum.total_assets ? ((acc.amount / sum.total_assets) * 100).toFixed(1) : '0.0';

            html += `
                <tr style="border-bottom:1px solid #f8fafc;">
                    <td style="padding:6px 12px 6px 36px; color:#475569; font-size:12px;">${accShort}</td>
                    <td style="padding:6px 12px; text-align:right; font-family:monospace; font-size:12px; color:#334155;">${amtStr}</td>
                    <td style="padding:6px 12px; text-align:right; color:#94a3b8; font-size:11px;">${pct}%</td>
                </tr>
            `;
        });
    });

    // TOTAL ASSETS
    html += `
        <tr style="background:#f0fdf4; font-weight:800; border-top:2px solid #10b981; border-bottom:2px solid #10b981;">
            <td style="padding:12px 12px; color:#0f172a; font-size:14px;">TOTAL ASSETS</td>
            <td style="padding:12px 12px; text-align:right; font-family:monospace; font-size:16px; font-weight:800; color:#059669;">
                KES ${Number(sum.total_assets).toLocaleString('en-US', {minimumFractionDigits: 2})}
            </td>
            <td style="padding:12px 12px; text-align:right; font-weight:800; font-size:13px; color:#059669;">100.0%</td>
        </tr>
    `;

    // Spacer
    html += `<tr><td colspan="3" style="height:18px;"></td></tr>`;

    // -------------------------------------------------------------
    // SECTION 2: LIABILITIES
    // -------------------------------------------------------------
    html += `
        <tr style="background:#f8fafc; font-weight:800; color:#0f172a; border-top:1px solid #e2e8f0;">
            <td colspan="3" style="padding:10px 12px; letter-spacing:0.5px; font-size:12px; text-transform:uppercase; color:#d97706;">
                2. LIABILITIES
            </td>
        </tr>
    `;

    (bs.liability_groups || []).forEach(grp => {
        html += `
            <tr style="background:#fdfdfd; font-weight:700; border-top:1px solid #f1f5f9;">
                <td style="padding:8px 12px 6px 18px; color:#1e293b; font-size:12px;">${grp.bucket_name}</td>
                <td style="padding:8px 12px 6px 12px; text-align:right; font-family:monospace; font-weight:700; color:#d97706;">
                    ${Number(grp.subtotal).toLocaleString('en-US', {minimumFractionDigits: 2})}
                </td>
                <td style="padding:8px 12px 6px 12px; text-align:right; font-size:11px; color:#64748b;">
                    ${sum.total_assets ? ((grp.subtotal / sum.total_assets) * 100).toFixed(1) : 0}%
                </td>
            </tr>
        `;

        (grp.items || []).forEach(acc => {
            let accShort = (acc.account_name || acc.account || '').replace(' - KIL', '');
            let amtStr = Number(acc.amount).toLocaleString('en-US', {minimumFractionDigits: 2});
            let pct = sum.total_assets ? ((acc.amount / sum.total_assets) * 100).toFixed(1) : '0.0';

            html += `
                <tr style="border-bottom:1px solid #f8fafc;">
                    <td style="padding:6px 12px 6px 36px; color:#475569; font-size:12px;">${accShort}</td>
                    <td style="padding:6px 12px; text-align:right; font-family:monospace; font-size:12px; color:#b45309;">${amtStr}</td>
                    <td style="padding:6px 12px; text-align:right; color:#94a3b8; font-size:11px;">${pct}%</td>
                </tr>
            `;
        });
    });

    // TOTAL LIABILITIES
    html += `
        <tr style="background:#fffbeb; font-weight:800; border-top:2px solid #f59e0b; border-bottom:2px solid #f59e0b;">
            <td style="padding:12px 12px; color:#0f172a; font-size:14px;">TOTAL LIABILITIES</td>
            <td style="padding:12px 12px; text-align:right; font-family:monospace; font-size:16px; font-weight:800; color:#d97706;">
                KES ${Number(sum.total_liabilities).toLocaleString('en-US', {minimumFractionDigits: 2})}
            </td>
            <td style="padding:12px 12px; text-align:right; font-weight:800; font-size:13px; color:#d97706;">
                ${sum.total_assets ? ((sum.total_liabilities / sum.total_assets) * 100).toFixed(1) : 0}%
            </td>
        </tr>
    `;

    // Spacer
    html += `<tr><td colspan="3" style="height:18px;"></td></tr>`;

    // -------------------------------------------------------------
    // SECTION 3: EQUITY & RETAINED EARNINGS
    // -------------------------------------------------------------
    html += `
        <tr style="background:#f8fafc; font-weight:800; color:#0f172a; border-top:1px solid #e2e8f0;">
            <td colspan="3" style="padding:10px 12px; letter-spacing:0.5px; font-size:12px; text-transform:uppercase; color:#4338ca;">
                3. EQUITY & RETAINED EARNINGS
            </td>
        </tr>
    `;

    (bs.equity_groups || []).forEach(grp => {
        (grp.items || []).forEach(acc => {
            let accShort = (acc.account_name || acc.account || '').replace(' - KIL', '');
            let amtStr = Number(acc.amount).toLocaleString('en-US', {minimumFractionDigits: 2});
            let pct = sum.total_assets ? ((acc.amount / sum.total_assets) * 100).toFixed(1) : '0.0';

            html += `
                <tr style="border-bottom:1px solid #f8fafc;">
                    <td style="padding:8px 12px 8px 24px; color:#334155;">${accShort}</td>
                    <td style="padding:8px 12px; text-align:right; font-family:monospace; font-size:13px; color:#1e293b;">${amtStr}</td>
                    <td style="padding:8px 12px; text-align:right; color:#64748b; font-size:12px;">${pct}%</td>
                </tr>
            `;
        });
    });

    let profitColor = sum.provisional_profit >= 0 ? '#059669' : '#dc2626';
    let profitPct = sum.total_assets ? ((sum.provisional_profit / sum.total_assets) * 100).toFixed(1) : '0.0';
    html += `
        <tr style="border-bottom:1px solid #e2e8f0; background:#f8fafc;">
            <td style="padding:10px 12px 10px 24px; font-weight:700; color:#0f172a;">
                Cumulative Net Profit / (Loss) for Period
                <span style="font-size:11px; font-weight:normal; color:#64748b; display:block;">(Transferred from Profit & Loss Statement)</span>
            </td>
            <td style="padding:10px 12px; text-align:right; font-family:monospace; font-weight:700; font-size:14px; color:${profitColor};">
                ${Number(sum.provisional_profit).toLocaleString('en-US', {minimumFractionDigits: 2})}
            </td>
            <td style="padding:10px 12px; text-align:right; font-weight:700; color:${profitColor}; font-size:12px;">${profitPct}%</td>
        </tr>
    `;

    // TOTAL EQUITY
    html += `
        <tr style="background:#eef2ff; font-weight:800; border-top:2px solid #6366f1; border-bottom:2px solid #6366f1;">
            <td style="padding:12px 12px; color:#0f172a; font-size:14px;">TOTAL EQUITY & RETAINED EARNINGS</td>
            <td style="padding:12px 12px; text-align:right; font-family:monospace; font-size:16px; font-weight:800; color:#4338ca;">
                KES ${Number(sum.total_equity_and_reserves).toLocaleString('en-US', {minimumFractionDigits: 2})}
            </td>
            <td style="padding:12px 12px; text-align:right; font-weight:800; font-size:13px; color:#4338ca;">
                ${sum.total_assets ? ((sum.total_equity_and_reserves / sum.total_assets) * 100).toFixed(1) : 0}%
            </td>
        </tr>
    `;

    // Spacer
    html += `<tr><td colspan="3" style="height:18px;"></td></tr>`;

    // -------------------------------------------------------------
    // SECTION 4: TOTAL LIABILITIES AND EQUITY
    // -------------------------------------------------------------
    html += `
        <tr style="background:#f1f5f9; font-weight:800; border-top:3px solid #0f172a; border-bottom:3px double #0f172a;">
            <td style="padding:14px 12px; color:#0f172a; font-size:15px;">
                TOTAL LIABILITIES AND EQUITY
                <span style="font-size:11px; font-weight:600; color:#059669; display:block;">(Must equal Total Assets: KES ${Number(sum.total_assets).toLocaleString('en-US', {minimumFractionDigits: 2})})</span>
            </td>
            <td style="padding:14px 12px; text-align:right; font-family:monospace; font-size:18px; font-weight:800; color:#0f172a;">
                KES ${Number(sum.total_liabilities_and_equity).toLocaleString('en-US', {minimumFractionDigits: 2})}
            </td>
            <td style="padding:14px 12px; text-align:right; font-weight:800; font-size:14px; color:#0f172a;">100.0%</td>
        </tr>
    `;

    html += `</tbody></table>`;

    $(wrapper).find('#exec-bs-formal-table').html(html);
}

function render_exec_bs_breakdown(wrapper, bs) {
    let sum = bs.summary;

    $(wrapper).find('#exec-bs-breakdown-total-assets').text(`KES ${Number(sum.total_assets).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
    $(wrapper).find('#exec-bs-breakdown-total-liab').text(`KES ${Number(sum.total_liabilities).toLocaleString('en-US', {minimumFractionDigits: 2})}`);

    // Assets Composition List
    let assetsListHtml = '';
    (bs.asset_groups || []).forEach(grp => {
        let pct = sum.total_assets > 0 ? ((grp.subtotal / sum.total_assets) * 100).toFixed(1) : 0;
        let barWidth = Math.max(0, Math.min(100, pct));
        assetsListHtml += `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-size: 13px; font-weight: 700; color: #1e293b;">${grp.bucket_name}</span>
                    <span style="font-size: 13px; font-weight: 800; font-family: monospace; color: #0284c7;">KES ${Number(grp.subtotal).toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #64748b;">
                    <span>${grp.items ? grp.items.length : 0} accounts</span>
                    <span>${pct}% of Assets</span>
                </div>
                <div style="height: 4px; background: #e2e8f0; border-radius: 4px; margin-top: 6px; overflow: hidden;">
                    <div style="height: 100%; background: #0284c7; width: ${barWidth}%;"></div>
                </div>
            </div>
        `;
    });
    $(wrapper).find('#exec-bs-assets-breakdown-list').html(assetsListHtml);

    // Liabilities Composition List
    let liabListHtml = '';
    (bs.liability_groups || []).forEach(grp => {
        let pct = sum.total_liabilities > 0 ? ((grp.subtotal / sum.total_liabilities) * 100).toFixed(1) : 0;
        let barWidth = Math.max(0, Math.min(100, pct));
        liabListHtml += `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-size: 13px; font-weight: 700; color: #1e293b;">${grp.bucket_name}</span>
                    <span style="font-size: 13px; font-weight: 800; font-family: monospace; color: #d97706;">KES ${Number(grp.subtotal).toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #64748b;">
                    <span>${grp.items ? grp.items.length : 0} accounts</span>
                    <span>${pct}% of Liabilities</span>
                </div>
                <div style="height: 4px; background: #e2e8f0; border-radius: 4px; margin-top: 6px; overflow: hidden;">
                    <div style="height: 100%; background: #f59e0b; width: ${barWidth}%;"></div>
                </div>
            </div>
        `;
    });
    $(wrapper).find('#exec-bs-liab-breakdown-list').html(liabListHtml);

    // Solvency & Metrics
    let solvencyHtml = `
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 14px;">
            <div style="font-size: 11px; font-weight: 700; color: #15803d; text-transform: uppercase;">Working Capital</div>
            <div style="font-size: 18px; font-weight: 800; font-family: monospace; color: #16a34a; margin-top: 2px;">
                KES ${Number(sum.working_capital).toLocaleString('en-US', {minimumFractionDigits: 2})}
            </div>
            <div style="font-size: 11px; color: #166534; margin-top: 4px;">Buffer of liquid assets over short-term obligations</div>
        </div>

        <div style="background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 12px 14px;">
            <div style="font-size: 11px; font-weight: 700; color: #3730a3; text-transform: uppercase;">Current Ratio (Liquidity)</div>
            <div style="font-size: 18px; font-weight: 800; font-family: monospace; color: #4338ca; margin-top: 2px;">
                ${sum.current_ratio.toFixed(2)}x
            </div>
            <div style="font-size: 11px; color: #312e81; margin-top: 4px;">Optimal benchmark is ≥ 1.0x (Currently ${sum.current_ratio >= 1 ? 'healthy' : 'tight'})</div>
        </div>

        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 14px;">
            <div style="font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Debt-to-Equity Ratio</div>
            <div style="font-size: 18px; font-weight: 800; font-family: monospace; color: #0f172a; margin-top: 2px;">
                ${sum.debt_to_equity.toFixed(2)}x
            </div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Total liabilities relative to equity cushion</div>
        </div>
    `;
    $(wrapper).find('#exec-bs-solvency-metrics').html(solvencyHtml);
}

function print_exec_balance_sheet(wrapper) {
    let bs = window.EXEC_BS_STATE ? window.EXEC_BS_STATE.raw_data : null;
    if (!bs) {
        frappe.msgprint("No Balance Sheet data loaded to print.");
        return;
    }

    let company = bs.company || 'KILIBET INVESTMENT LTD';
    let dateStr = bs.as_on_date_formatted || bs.as_on_date;
    let statementHtml = $(wrapper).find('#exec-bs-formal-table').html();

    let printHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Balance Sheet - ${company}</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    color: #0f172a;
                    padding: 32px;
                    margin: 0;
                    background: #fff;
                }
                .header {
                    border-bottom: 2px solid #0f172a;
                    padding-bottom: 16px;
                    margin-bottom: 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-end;
                }
                h1 { margin: 0 0 4px 0; font-size: 24px; font-weight: 800; color: #0f172a; }
                .sub { font-size: 14px; font-weight: 600; color: #475569; }
                .meta { text-align: right; font-size: 12px; color: #64748b; }
                table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
                th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #cbd5e1; font-weight: 700; color: #475569; }
                td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
                @media print {
                    body { padding: 10px; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <div style="font-size:11px; font-weight:700; color:#0284c7; text-transform:uppercase; letter-spacing:1px;">Fuel & Retail Station Operations</div>
                    <h1>${company}</h1>
                    <div class="sub">Statement of Financial Position (Balance Sheet)</div>
                </div>
                <div class="meta">
                    <div style="font-weight:700; color:#1e293b; font-size:13px;">As of ${dateStr}</div>
                    <div>Currency: Kenya Shillings (KES)</div>
                    <div>Generated: ${new Date().toLocaleString()}</div>
                </div>
            </div>
            <div>
                ${statementHtml}
            </div>
            <script>
                window.onload = function() {
                    window.print();
                };
            </script>
        </body>
        </html>
    `;

    let w = window.open('', '_blank');
    w.document.write(printHtml);
    w.document.close();
}

function export_exec_bs_csv(wrapper) {
    let bs = window.EXEC_BS_STATE ? window.EXEC_BS_STATE.raw_data : null;
    if (!bs) {
        frappe.msgprint("No Balance Sheet data available to export.");
        return;
    }

    let csv = "data:text/csv;charset=utf-8,";
    csv += "Section,Category / Bucket,Account Name,Account Code,Amount (KES)\n";

    // Assets
    (bs.asset_groups || []).forEach(grp => {
        (grp.items || []).forEach(it => {
            let name = (it.account_name || '').replace(/"/g, '""');
            let acc = (it.account || '').replace(/"/g, '""');
            csv += `"1. ASSETS","${grp.bucket_name}","${name}","${acc}",${it.amount}\n`;
        });
        csv += `"1. ASSETS","SUBTOTAL: ${grp.bucket_name}","","",${grp.subtotal}\n`;
    });
    csv += `"1. ASSETS","TOTAL ASSETS","","",${bs.summary.total_assets}\n`;

    // Liabilities
    (bs.liability_groups || []).forEach(grp => {
        (grp.items || []).forEach(it => {
            let name = (it.account_name || '').replace(/"/g, '""');
            let acc = (it.account || '').replace(/"/g, '""');
            csv += `"2. LIABILITIES","${grp.bucket_name}","${name}","${acc}",${it.amount}\n`;
        });
        csv += `"2. LIABILITIES","SUBTOTAL: ${grp.bucket_name}","","",${grp.subtotal}\n`;
    });
    csv += `"2. LIABILITIES","TOTAL LIABILITIES","","",${bs.summary.total_liabilities}\n`;

    // Equity
    (bs.equity_groups || []).forEach(grp => {
        (grp.items || []).forEach(it => {
            let name = (it.account_name || '').replace(/"/g, '""');
            let acc = (it.account || '').replace(/"/g, '""');
            csv += `"3. EQUITY","${grp.bucket_name}","${name}","${acc}",${it.amount}\n`;
        });
    });
    csv += `"3. EQUITY","Provisional Net Profit for Period","","",${bs.summary.provisional_profit}\n`;
    csv += `"3. EQUITY","TOTAL EQUITY & RETAINED EARNINGS","","",${bs.summary.total_equity_and_reserves}\n`;
    csv += `"SUMMARY","TOTAL LIABILITIES AND EQUITY","","",${bs.summary.total_liabilities_and_equity}\n`;

    let uri = encodeURI(csv);
    let link = document.createElement("a");
    link.setAttribute("href", uri);
    link.setAttribute("download", `Balance_Sheet_${bs.as_on_date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/* =========================================================================
   CARDS HOLDING ACCOUNT MODULE
   ========================================================================= */

window.CARDS_HOLDING_STATE = {
    initialized: false,
    from_date: "",
    to_date: "",
    card_type: "ALL",
    status: "pending", // default to pending in holding
    search: "",
    page: 1,
    page_length: 50,
    total_pages: 1,
    total_records: 0,
    selected_items: new Map(), // name -> { name, amount, card, receipt_no, shift, date }
    supplier_accounts: [],
    card_types: [],
    search_timer: null,
    loading: false
};

function init_cards_holding(wrapper) {
    let state = window.CARDS_HOLDING_STATE;

    // Default date range: "this_month"
    if (!state.from_date || !state.to_date) {
        state.from_date = frappe.datetime.month_start();
        state.to_date = frappe.datetime.get_today();
        $(wrapper).find('#cards-filter-from').val(state.from_date);
        $(wrapper).find('#cards-filter-to').val(state.to_date);
    }

    if (!state.initialized) {
        state.initialized = true;

        // Preset date buttons
        $(wrapper).find('.cards-preset-btn').off('click').on('click', function(e) {
            e.preventDefault();
            $(wrapper).find('.cards-preset-btn').css({ background: '#fff', color: '#475569' }).removeClass('active');
            $(this).css({ background: '#0f172a', color: '#fff' }).addClass('active');

            let range = $(this).data('range');
            let today = frappe.datetime.get_today();

            if (range === 'today') {
                state.from_date = today;
                state.to_date = today;
            } else if (range === 'this_week') {
                state.from_date = frappe.datetime.add_days(today, -6);
                state.to_date = today;
            } else if (range === 'this_month') {
                state.from_date = frappe.datetime.month_start();
                state.to_date = today;
            } else if (range === 'last_month') {
                let firstOfThisMonth = new Date(frappe.datetime.month_start());
                let lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 86400000);
                let firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
                state.from_date = frappe.datetime.obj_to_str(firstOfPrevMonth);
                state.to_date = frappe.datetime.obj_to_str(lastOfPrevMonth);
            } else if (range === 'all') {
                state.from_date = '';
                state.to_date = '';
            }

            $(wrapper).find('#cards-filter-from').val(state.from_date || '');
            $(wrapper).find('#cards-filter-to').val(state.to_date || '');
            state.page = 1;
            load_cards_holding_data(wrapper);
        });

        // Date input change
        $(wrapper).find('#cards-filter-from, #cards-filter-to').off('change').on('change', function() {
            $(wrapper).find('.cards-preset-btn').css({ background: '#fff', color: '#475569' }).removeClass('active');
            state.from_date = $(wrapper).find('#cards-filter-from').val();
            state.to_date = $(wrapper).find('#cards-filter-to').val();
            state.page = 1;
            load_cards_holding_data(wrapper);
        });

        // Card Type Filter
        $(wrapper).find('#cards-filter-card-type').off('change').on('change', function() {
            state.card_type = $(this).val();
            state.page = 1;
            load_cards_holding_data(wrapper);
        });

        // Status Filter
        $(wrapper).find('#cards-filter-status').off('change').on('change', function() {
            state.status = $(this).val();
            state.page = 1;
            load_cards_holding_data(wrapper);
        });

        // Search Input with Debounce
        $(wrapper).find('#cards-filter-search').off('input').on('input', function() {
            clearTimeout(state.search_timer);
            let val = $(this).val().trim();
            state.search_timer = setTimeout(() => {
                state.search = val;
                state.page = 1;
                load_cards_holding_data(wrapper);
            }, 300);
        });

        // Refresh Button
        $(wrapper).find('#btn-cards-holding-refresh').off('click').on('click', function(e) {
            e.preventDefault();
            load_cards_holding_data(wrapper);
        });

        // Reconcile Fuel Invoices Button
        $(wrapper).find('#btn-cards-reconcile-fuel').off('click').on('click', function(e) {
            e.preventDefault();
            open_supplier_payment_modal(wrapper, 'card_offset', null, window.ACTIVE_STATION);
        });

        // Pagination Previous
        $(wrapper).find('#btn-cards-prev-page').off('click').on('click', function(e) {
            e.preventDefault();
            if (state.page > 1) {
                state.page--;
                load_cards_holding_data(wrapper);
            }
        });

        // Pagination Next
        $(wrapper).find('#btn-cards-next-page').off('click').on('click', function(e) {
            e.preventDefault();
            if (state.page < state.total_pages) {
                state.page++;
                load_cards_holding_data(wrapper);
            }
        });

        // Master Checkbox
        $(wrapper).find('#cards-master-checkbox').off('change').on('change', function() {
            let checked = $(this).is(':checked');
            $(wrapper).find('.cards-row-checkbox').each(function() {
                let name = $(this).val();
                let amount = parseFloat($(this).data('amount')) || 0;
                let card = $(this).data('card') || '';
                let receipt = $(this).data('receipt') || '';
                let shift = $(this).data('shift') || '';
                let date = $(this).data('date') || '';

                $(this).prop('checked', checked);
                if (checked) {
                    state.selected_items.set(name, { name, amount, card, receipt_no: receipt, shift, date });
                } else {
                    state.selected_items.delete(name);
                }
            });
            update_cards_selection_ui(wrapper);
        });

        // Row Checkboxes Delegation
        $(wrapper).find('#exec-cards-holding-table').off('change', '.cards-row-checkbox').on('change', '.cards-row-checkbox', function() {
            let name = $(this).val();
            let amount = parseFloat($(this).data('amount')) || 0;
            let card = $(this).data('card') || '';
            let receipt = $(this).data('receipt') || '';
            let shift = $(this).data('shift') || '';
            let date = $(this).data('date') || '';

            if ($(this).is(':checked')) {
                state.selected_items.set(name, { name, amount, card, receipt_no: receipt, shift, date });
            } else {
                state.selected_items.delete(name);
            }
            update_cards_selection_ui(wrapper);
        });

        // Clear Selection
        $(wrapper).find('#btn-cards-quick-clear').off('click').on('click', function(e) {
            e.preventDefault();
            state.selected_items.clear();
            $(wrapper).find('.cards-row-checkbox').prop('checked', false);
            $(wrapper).find('#cards-master-checkbox').prop('checked', false).prop('indeterminate', false);
            update_cards_selection_ui(wrapper);
        });

        // Bulk Post Dialog Buttons
        $(wrapper).find('#btn-cards-post-bulk, #btn-cards-post-selected').off('click').on('click', function(e) {
            e.preventDefault();
            if (state.selected_items.size === 0) {
                frappe.msgprint(__('Please select at least one card transaction to post.'));
                return;
            }
            let records = Array.from(state.selected_items.values());
            open_cards_posting_dialog(wrapper, records);
        });

        // Single Row Post Button Delegation
        $(wrapper).find('#exec-cards-holding-table').off('click', '.btn-post-single-card').on('click', '.btn-post-single-card', function(e) {
            e.preventDefault();
            let name = $(this).data('name');
            let amount = parseFloat($(this).data('amount')) || 0;
            let card = $(this).data('card') || '';
            let receipt = $(this).data('receipt') || '';
            let shift = $(this).data('shift') || '';
            let date = $(this).data('date') || '';

            open_cards_posting_dialog(wrapper, [{ name, amount, card, receipt_no: receipt, shift, date }]);
        });

        // Single Row Undo Button Delegation
        $(wrapper).find('#exec-cards-holding-table').off('click', '.btn-undo-single-card').on('click', '.btn-undo-single-card', function(e) {
            e.preventDefault();
            let name = $(this).data('name');
            undo_cards_posting_action(wrapper, [name]);
        });
    }

    load_cards_holding_data(wrapper);
}

function load_cards_holding_data(wrapper) {
    let state = window.CARDS_HOLDING_STATE;
    if (state.loading) return;
    state.loading = true;

    let station = $(wrapper).find('#exec-global-station-select').val() || $(wrapper).find('#exec-header-station-select').val() || '';

    $(wrapper).find('#exec-cards-holding-table tbody').html(
        '<tr><td colspan="11" style="text-align: center; padding: 32px; color: #64748b;"><span class="material-symbols-outlined" style="animation: spin 1s linear infinite; vertical-align: middle; margin-right: 6px;">progress_activity</span> Loading cards holding data...</td></tr>'
    );

    frappe.call({
        method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_cards_holding_data",
        args: {
            from_date: state.from_date || '',
            to_date: state.to_date || '',
            card_type: state.card_type || 'ALL',
            status: state.status || 'pending',
            search: state.search || '',
            page: state.page || 1,
            page_length: state.page_length || 50,
            station: station
        },
        callback: function(r) {
            state.loading = false;
            if (r && r.message) {
                let data = r.message;
                state.total_pages = data.total_pages || 1;
                state.total_records = (data.summary && data.summary.total_count) || 0;
                state.supplier_accounts = data.supplier_accounts || [];
                state.card_types = data.card_types || [];

                // Populate Card Types dropdown if empty
                let cardSelect = $(wrapper).find('#cards-filter-card-type');
                if (cardSelect.children('option').length <= 1 && state.card_types.length > 0) {
                    state.card_types.forEach(ct => {
                        cardSelect.append(`<option value="${ct.id}">${ct.label}</option>`);
                    });
                    if (state.card_type) cardSelect.val(state.card_type);
                }

                // Update KPI Cards
                if (data.summary) {
                    let s = data.summary;
                    $(wrapper).find('#cards-kpi-pending-amt').text(format_currency(s.pending_amount || 0, "KES"));
                    $(wrapper).find('#cards-kpi-pending-count').text((s.pending_count || 0).toLocaleString());

                    $(wrapper).find('#cards-kpi-posted-amt').text(format_currency(s.posted_amount || 0, "KES"));
                    $(wrapper).find('#cards-kpi-posted-count').text((s.posted_count || 0).toLocaleString());

                    $(wrapper).find('#cards-kpi-total-amt').text(format_currency(s.total_amount || 0, "KES"));
                    $(wrapper).find('#cards-kpi-total-count').text((s.total_count || 0).toLocaleString());
                }

                // Render Table rows
                render_cards_holding_table(wrapper, data.records || []);

                // Update Pagination Controls
                let totalShown = 0;
                if (data.summary) {
                    if (state.status === 'pending') totalShown = data.summary.pending_count;
                    else if (state.status === 'posted') totalShown = data.summary.posted_count;
                    else totalShown = data.summary.total_count;
                }

                let startIdx = totalShown === 0 ? 0 : (state.page - 1) * state.page_length + 1;
                let endIdx = Math.min(state.page * state.page_length, totalShown);

                if (totalShown === 0) {
                    $(wrapper).find('#cards-pagination-info').text('Showing 0 records');
                } else {
                    $(wrapper).find('#cards-pagination-info').text(`Showing ${startIdx} to ${endIdx} of ${totalShown.toLocaleString()} records`);
                }
                $(wrapper).find('#cards-current-page').text(`Page ${state.page} of ${state.total_pages || 1}`);
                $(wrapper).find('#btn-cards-prev-page').prop('disabled', state.page <= 1);
                $(wrapper).find('#btn-cards-next-page').prop('disabled', state.page >= state.total_pages);

                // Update selection indicators
                update_cards_selection_ui(wrapper);
            } else {
                $(wrapper).find('#exec-cards-holding-table tbody').html(
                    '<tr><td colspan="11" style="text-align: center; padding: 30px; color: #ef4444;">Failed to load cards holding data.</td></tr>'
                );
            }
        },
        error: function() {
            state.loading = false;
            $(wrapper).find('#exec-cards-holding-table tbody').html(
                '<tr><td colspan="11" style="text-align: center; padding: 30px; color: #ef4444;">Network or server error while loading cards holding.</td></tr>'
            );
        }
    });
}

function render_cards_holding_table(wrapper, records) {
    let state = window.CARDS_HOLDING_STATE;
    let tbody = $(wrapper).find('#exec-cards-holding-table tbody');
    let pageTotal = 0;

    if (!records || records.length === 0) {
        tbody.html('<tr><td colspan="11" style="text-align: center; padding: 36px; color: #64748b; font-size: 13px;">No station card transactions found matching current filters.</td></tr>');
        $(wrapper).find('#cards-page-total').text('KES 0.00');
        return;
    }

    let html = '';
    records.forEach(r => {
        let amt = parseFloat(r.amount) || 0;
        pageTotal += amt;
        let isSelected = state.selected_items.has(r.name);
        let isReconciled = r.is_reconciled == 1;

        let statusBadge = isReconciled
            ? `<span style="background: #dcfce7; color: #166534; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;"><span class="material-symbols-outlined" style="font-size: 12px;">check</span> Posted</span>`
            : `<span style="background: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;"><span class="material-symbols-outlined" style="font-size: 12px;">hourglass_top</span> In Holding</span>`;

        let actionHtml = isReconciled
            ? `<button class="btn btn-xs btn-default btn-undo-single-card" data-name="${r.name}" style="font-size: 11px; padding: 3px 8px; border-radius: 4px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; color: #475569;" title="Revert to Holding">Undo</button>`
            : `<button class="btn btn-xs btn-primary btn-post-single-card" data-name="${r.name}" data-amount="${amt}" data-card="${frappe.utils.escape_html(r.card || '')}" data-receipt="${frappe.utils.escape_html(r.receipt_no || '')}" data-shift="${frappe.utils.escape_html(r.shift || '')}" data-date="${r.date || ''}" style="font-size: 11px; padding: 3px 10px; border-radius: 4px; background: #0284c7; color: #fff; border: none; font-weight: 600; cursor: pointer;">Post</button>`;

        let memoText = (r.memo || '').trim();
        let postingInfo = '';
        if (isReconciled) {
            let byUser = r.reconciled_by || 'Director';
            let recDate = r.reconciled_date_formatted || '';
            postingInfo = `<div style="font-size: 11px; color: #15803d; font-weight: 500;" title="${frappe.utils.escape_html(memoText)}">${frappe.utils.escape_html(memoText || ('Posted by ' + byUser + ' ' + recDate))}</div>`;
        } else {
            postingInfo = `<div style="font-size: 11px; color: #94a3b8; font-style: italic;">Awaiting director posting</div>`;
        }

        html += `<tr style="border-bottom: 1px solid #f1f5f9; ${isSelected ? 'background: #f0fdf4;' : ''}">
            <td style="padding: 10px 14px; text-align: center;">
                <input type="checkbox" class="cards-row-checkbox" value="${r.name}" data-amount="${amt}" data-card="${frappe.utils.escape_html(r.card || '')}" data-receipt="${frappe.utils.escape_html(r.receipt_no || '')}" data-shift="${frappe.utils.escape_html(r.shift || '')}" data-date="${r.date || ''}" ${isSelected ? 'checked' : ''} style="cursor: pointer; width: 15px; height: 15px;">
            </td>
            <td style="padding: 10px 14px; font-size: 12px; color: #334155; white-space: nowrap;">${r.date_formatted || r.date}</td>
            <td style="padding: 10px 14px; font-size: 12px; font-weight: 600;">
                <a href="/app/station-cards/${r.name}" target="_blank" style="color: #0284c7; text-decoration: none;">${r.name}</a>
            </td>
            <td style="padding: 10px 14px; font-size: 12px; font-family: monospace; font-weight: 600; color: #0f172a;">${frappe.utils.escape_html(r.receipt_no || '-')}</td>
            <td style="padding: 10px 14px; font-size: 12px; font-weight: 600; color: #1e293b;">
                <span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${frappe.utils.escape_html(r.card || '-')}</span>
            </td>
            <td style="padding: 10px 14px; font-size: 12px; color: #475569;">
                <a href="/app/shift/${r.shift}" target="_blank" style="color: #475569; text-decoration: none;">${frappe.utils.escape_html(r.shift || '-')}</a>
            </td>
            <td style="padding: 10px 14px; font-size: 12px; color: #475569;">${frappe.utils.escape_html(r.csa_name || r.csa || '-')}</td>
            <td style="padding: 10px 14px; text-align: right; font-family: monospace; font-weight: 700; color: #0f172a; font-size: 13px;">${format_currency(amt, "KES")}</td>
            <td style="padding: 10px 14px; text-align: center;">${statusBadge}</td>
            <td style="padding: 10px 14px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${postingInfo}</td>
            <td style="padding: 10px 14px; text-align: center; white-space: nowrap;">${actionHtml}</td>
        </tr>`;
    });

    tbody.html(html);
    $(wrapper).find('#cards-page-total').text(format_currency(pageTotal, "KES"));
}

function update_cards_selection_ui(wrapper) {
    let state = window.CARDS_HOLDING_STATE;
    let count = state.selected_items.size;
    let totalAmt = 0;
    state.selected_items.forEach(item => {
        totalAmt += parseFloat(item.amount) || 0;
    });

    $(wrapper).find('#cards-selected-count').text(count);
    $(wrapper).find('#cards-selected-amt').text(format_currency(totalAmt, "KES"));

    if (count > 0) {
        $(wrapper).find('#cards-bulk-bar').css('display', 'flex');
        $(wrapper).find('#btn-cards-post-bulk').prop('disabled', false).css('opacity', '1');
    } else {
        $(wrapper).find('#cards-bulk-bar').hide();
        $(wrapper).find('#btn-cards-post-bulk').prop('disabled', true).css('opacity', '0.6');
    }

    // Check master checkbox status on current page
    let totalCheckboxes = $(wrapper).find('.cards-row-checkbox').length;
    let checkedCount = $(wrapper).find('.cards-row-checkbox:checked').length;
    let master = $(wrapper).find('#cards-master-checkbox');

    if (totalCheckboxes > 0 && checkedCount === totalCheckboxes) {
        master.prop('checked', true).prop('indeterminate', false);
    } else if (checkedCount > 0) {
        master.prop('checked', false).prop('indeterminate', true);
    } else {
        master.prop('checked', false).prop('indeterminate', false);
    }
}

function open_cards_posting_dialog(wrapper, card_records) {
    if (!card_records || card_records.length === 0) {
        frappe.msgprint(__('No card records selected.'));
        return;
    }

    let state = window.CARDS_HOLDING_STATE;
    let cardsTotal = 0;
    let cardTypeSet = new Set();
    card_records.forEach(r => {
        cardsTotal += parseFloat(r.amount) || 0;
        if (r.card) cardTypeSet.add(r.card);
    });

    let cardTypesStr = Array.from(cardTypeSet).join(', ');

    // Available supplier accounts
    let accountOptions = [];
    if (state.supplier_accounts && state.supplier_accounts.length > 0) {
        accountOptions = state.supplier_accounts.map(a => a.name);
    } else {
        accountOptions = [
            "RUBIS A/C - KIL",
            "EQUITY (RUBIS) - KIL",
            "KCB(RUBIS) - KIL",
            "Creditors - KIL"
        ];
    }

    // Default supplier account detection
    let defaultAcc = "RUBIS A/C - KIL";
    if (cardTypesStr.toUpperCase().includes("EQUITY")) {
        defaultAcc = "EQUITY (RUBIS) - KIL";
    } else if (cardTypesStr.toUpperCase().includes("KCB")) {
        defaultAcc = "KCB(RUBIS) - KIL";
    }
    if (accountOptions.indexOf(defaultAcc) === -1) {
        accountOptions.unshift(defaultAcc);
    }

    let summaryHtml = `
        <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px;">
            <div style="font-size: 13px; font-weight: 700; color: #0369a1; margin-bottom: 6px;">Cards Holding Summary</div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: #334155; margin-bottom: 3px;">
                <span>Total Cards to Post:</span>
                <strong>${card_records.length} card(s)</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: #334155; margin-bottom: 3px;">
                <span>Card Types:</span>
                <span>${cardTypesStr || 'Station Cards'}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 13px; color: #0f172a; font-weight: 700; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #cbd5e1;">
                <span>SPA Recorded Value:</span>
                <span style="font-family: monospace; color: #0284c7; font-size: 14px;">${format_currency(cardsTotal, "KES")}</span>
            </div>
        </div>
        <p style="font-size: 12px; color: #64748b; margin-bottom: 12px;">
            Verify the amount actually credited to your supplier portal/statement. You can adjust the credited amount below if supplier commissions or merchant deductions were applied.
        </p>
    `;

    let d = new frappe.ui.Dialog({
        title: __('Post Cards to Supplier Account'),
        fields: [
            {
                fieldname: 'summary_html',
                fieldtype: 'HTML',
                options: summaryHtml
            },
            {
                label: __('Supplier Account Credited'),
                fieldname: 'supplier_account',
                fieldtype: 'Select',
                options: accountOptions.join('\n'),
                default: defaultAcc,
                reqd: 1
            },
            {
                label: __('Credited Amount in Supplier Account (KES)'),
                fieldname: 'credited_amount',
                fieldtype: 'Currency',
                default: cardsTotal,
                reqd: 1,
                description: __('Actual amount confirmed received in supplier account/portal')
            },
            {
                label: __('Posting Date'),
                fieldname: 'posting_date',
                fieldtype: 'Date',
                default: frappe.datetime.get_today(),
                reqd: 1
            },
            {
                label: __('Supplier Ref / Batch # / Settlement ID'),
                fieldname: 'reference',
                fieldtype: 'Data',
                placeholder: __('e.g. RUBIS-BATCH-20261012')
            },
            {
                label: __('Create Accounting Journal Entry (GL)'),
                fieldname: 'create_gl_entry',
                fieldtype: 'Check',
                default: 0,
                description: __('Generate Journal Entry: Debit Supplier Account & Credit Card Holding Account')
            },
            {
                label: __('Variance / Fee Account (if credited amount differs)'),
                fieldname: 'variance_account',
                fieldtype: 'Link',
                options: 'Account',
                depends_on: `eval:doc.credited_amount != ${cardsTotal}`
            },
            {
                label: __('Notes / Remarks'),
                fieldname: 'notes',
                fieldtype: 'Small Text',
                placeholder: __('Optional settlement details')
            }
        ],
        primary_action_label: __('Confirm & Post to Supplier'),
        primary_action: function(vals) {
            if (!vals.supplier_account) {
                frappe.msgprint(__('Please select a Supplier Account'));
                return;
            }

            let card_names = card_records.map(r => r.name);
            frappe.call({
                method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.post_station_cards_to_supplier",
                args: {
                    card_names: JSON.stringify(card_names),
                    supplier_account: vals.supplier_account,
                    credited_amount: vals.credited_amount,
                    posting_date: vals.posting_date,
                    reference: vals.reference || '',
                    variance_account: vals.variance_account || '',
                    notes: vals.notes || '',
                    create_gl_entry: vals.create_gl_entry ? 1 : 0
                },
                freeze: true,
                freeze_message: __("Posting cards to supplier account..."),
                callback: function(r) {
                    if (r && r.message && r.message.success) {
                        frappe.show_alert({
                            message: r.message.message,
                            indicator: 'green'
                        }, 7);
                        d.hide();

                        // Remove posted items from selection
                        card_names.forEach(n => state.selected_items.delete(n));
                        update_cards_selection_ui(wrapper);
                        load_cards_holding_data(wrapper);

                        // If Top-ups tab is visible, refresh it too
                        if ($(wrapper).find('#tab-topups').is(':visible')) {
                            load_topups_statement(wrapper);
                        }
                    } else {
                        frappe.msgprint(__('Posting failed: ') + ((r && r.message) ? JSON.stringify(r.message) : 'Unknown error'));
                    }
                }
            });
        }
    });

    d.show();
}

function undo_cards_posting_action(wrapper, card_names) {
    if (!card_names || card_names.length === 0) return;
    let state = window.CARDS_HOLDING_STATE;

    frappe.confirm(
        __(`Are you sure you want to revert ${card_names.length} card transaction(s) back to pending in holding?`),
        function() {
            frappe.call({
                method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.undo_station_cards_posting",
                args: {
                    card_names: JSON.stringify(card_names)
                },
                freeze: true,
                freeze_message: __("Reverting cards to holding..."),
                callback: function(r) {
                    if (r && r.message && r.message.success) {
                        frappe.show_alert({
                            message: r.message.message,
                            indicator: 'orange'
                        }, 5);
                        load_cards_holding_data(wrapper);
                    }
                }
            });
        }
    );
}

// ==============================================================================
// SUPPLIER TRANSFER & FUEL INVOICES RECONCILIATION MODAL
// ==============================================================================
window.EXEC_SUPP_STATE = {
    mode: 'bank_transfer', // 'bank_transfer' or 'card_offset'
    form_data: null,
    invoices: [],
    selected_invoices: new Set()
};

function init_supplier_payment_modal(wrapper) {
    let modal = $(wrapper).find('#exec-supplier-payment-modal');

    // Close buttons
    $(wrapper).find('#exec-supplier-payment-modal-close, #btn-exec-modal-supp-cancel').off('click').on('click', function() {
        modal.hide();
    });

    // Mode Buttons
    $(wrapper).find('.exec-supp-mode-btn').off('click').on('click', function() {
        let mode = $(this).data('mode');
        switch_supplier_modal_mode(wrapper, mode);
    });

    // Station Context Dropdown Change
    $(wrapper).find('#exec-modal-supp-station').off('change').on('change', function() {
        let newStation = $(this).val();
        window.EXEC_SUPP_STATE = window.EXEC_SUPP_STATE || {};
        window.EXEC_SUPP_STATE.station = newStation;
        let stBadgeText = newStation ? (newStation === 'RUBIS POA PLACE' ? 'Rubis Poa Place' : newStation) : 'All Stations (Consolidated)';
        $(wrapper).find('#exec-modal-supp-station-badge').text(stBadgeText);
        load_supplier_payment_modal_data(wrapper, newStation, null, window.EXEC_SUPP_STATE.account);
    });

    // Supplier Dropdown Change
    $(wrapper).find('#exec-modal-supp-supplier').off('change').on('change', function() {
        let supp = $(this).val();
        let currStation = $(wrapper).find('#exec-modal-supp-station').val();
        load_supplier_invoices_for_modal(wrapper, supp, currStation);
    });

    // Source Account Change
    $(wrapper).find('#exec-modal-supp-source-account').off('change').on('change', function() {
        update_supplier_source_balance(wrapper);
    });

    // Master Invoice Checkbox
    $(wrapper).find('#exec-supp-master-inv-check').off('change').on('change', function() {
        let isChecked = $(this).prop('checked');
        $(wrapper).find('.exec-supp-inv-check').prop('checked', isChecked);
        recalc_selected_invoices(wrapper);
    });

    // Single Invoice Checkbox Delegation
    $(wrapper).find('#exec-modal-supp-invs-body').off('change', '.exec-supp-inv-check').on('change', '.exec-supp-inv-check', function() {
        recalc_selected_invoices(wrapper);
    });

    // "Select All" Button
    $(wrapper).find('#btn-supp-inv-check-all').off('click').on('click', function() {
        let allChecked = $(wrapper).find('.exec-supp-inv-check').length === $(wrapper).find('.exec-supp-inv-check:checked').length;
        $(wrapper).find('.exec-supp-inv-check, #exec-supp-master-inv-check').prop('checked', !allChecked);
        recalc_selected_invoices(wrapper);
    });

    // "Match Selected Invoices" Button
    $(wrapper).find('#btn-supp-fill-amount').off('click').on('click', function(e) {
        e.preventDefault();
        let total = parseFloat($(this).data('total')) || 0;
        if (total > 0) {
            $(wrapper).find('#exec-modal-supp-amount').val(total.toFixed(2));
        }
    });

    // Submit Form Button
    $(wrapper).find('#btn-exec-modal-supp-submit').off('click').on('click', function() {
        submit_supplier_payment_form(wrapper);
    });
}

function open_supplier_payment_modal(wrapper, default_mode, default_account, default_station) {
    default_mode = default_mode || 'bank_transfer';
    let state = window.EXEC_SUPP_STATE = window.EXEC_SUPP_STATE || {};
    state.mode = default_mode;
    
    // Determine active station from arguments or application state
    let station = default_station || window.ACTIVE_STATION || '';
    let account = default_account || (window.EXEC_SUPP_ACC_STATE ? window.EXEC_SUPP_ACC_STATE.active_account : (window.EXEC_CA_STATE ? window.EXEC_CA_STATE.active_account : ''));

    if (!station && account) {
        let accU = account.toUpperCase();
        if (accU.includes('GALANA')) {
            station = 'Galana Annex';
        } else if (accU.includes('RUBIS') || accU.includes('SHIFT MAIN CASH')) {
            station = 'RUBIS POA PLACE';
        }
    }

    state.station = station;
    state.account = account;

    // Reset form
    $(wrapper).find('#exec-supplier-payment-form')[0].reset();
    $(wrapper).find('#exec-modal-supp-date').val(frappe.datetime.get_today());
    $(wrapper).find('#exec-modal-supp-alert').hide().removeClass('alert-danger alert-success');
    $(wrapper).find('#exec-modal-supp-spinner').addClass('hidden');
    $(wrapper).find('#btn-exec-modal-supp-submit').prop('disabled', false);
    $(wrapper).find('#exec-modal-supp-invs-body').html('<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 20px;"><span class="spinner"></span> Loading invoices...</td></tr>');

    // Set station dropdown in modal
    $(wrapper).find('#exec-modal-supp-station').val(station);

    // Update modal header station badge
    let stBadgeText = station ? (station === 'RUBIS POA PLACE' ? 'Rubis Poa Place' : station) : 'All Stations (Consolidated)';
    $(wrapper).find('#exec-modal-supp-station-badge').text(stBadgeText);

    // Open modal immediately with backdrop
    $(wrapper).find('#exec-supplier-payment-modal').css('display', 'flex');

    load_supplier_payment_modal_data(wrapper, station, null, account);
}

function load_supplier_payment_modal_data(wrapper, station, supplier, account) {
    let state = window.EXEC_SUPP_STATE;
    frappe.call({
        method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_supplier_payment_form_data',
        args: {
            station: station || '',
            supplier: supplier || '',
            account: account || ''
        },
        callback: function(r) {
            if (r.message) {
                state.form_data = r.message;
                populate_supplier_modal_dropdowns(wrapper);
                switch_supplier_modal_mode(wrapper, state.mode);
            }
        }
    });
}

function populate_supplier_modal_dropdowns(wrapper) {
    let data = window.EXEC_SUPP_STATE.form_data;
    if (!data) return;

    // Populate Suppliers
    let suppHtml = '';
    (data.suppliers || []).forEach(s => {
        let selected = s.name === data.default_supplier ? 'selected' : '';
        suppHtml += `<option value="${s.name}" ${selected}>${s.supplier_name || s.name}</option>`;
    });
    $(wrapper).find('#exec-modal-supp-supplier').html(suppHtml);

    // Initial render of invoices
    render_supplier_modal_invoices(wrapper, data.invoices || [], data.total_outstanding || 0);
}

function switch_supplier_modal_mode(wrapper, mode) {
    let state = window.EXEC_SUPP_STATE;
    state.mode = mode;

    // Update active tab button style
    $(wrapper).find('.exec-supp-mode-btn').removeClass('active').css({
        'background': 'transparent',
        'color': '#64748b',
        'box-shadow': 'none'
    });
    $(wrapper).find(`.exec-supp-mode-btn[data-mode="${mode}"]`).addClass('active').css({
        'background': '#fff',
        'color': '#0f172a',
        'box-shadow': '0 1px 2px rgba(0,0,0,0.05)'
    });

    let data = state.form_data;
    let accSelect = $(wrapper).find('#exec-modal-supp-source-account');
    let accountsList = [];

    if (mode === 'bank_transfer') {
        $(wrapper).find('#exec-modal-supp-title').text('Transfer to Fuel Supplier (Bank Payment)');
        $(wrapper).find('#exec-modal-supp-source-label').text('Paid From (Bank Account)');
        $(wrapper).find('#exec-modal-supp-submit-text').text('Confirm & Post Bank Transfer');
        $(wrapper).find('#exec-modal-supp-remarks').attr('placeholder', 'e.g. Fuel tanker RTGS transfer');
        accountsList = (data && data.bank_accounts) || [];
    } else {
        $(wrapper).find('#exec-modal-supp-title').text('Station Card Offset (Reconcile Invoices)');
        $(wrapper).find('#exec-modal-supp-source-label').text('Paid From (Card Holding Account)');
        $(wrapper).find('#exec-modal-supp-submit-text').text('Confirm & Offset Fuel Invoices');
        $(wrapper).find('#exec-modal-supp-remarks').attr('placeholder', 'e.g. Rubis card sales settlement offset');
        accountsList = (data && data.card_accounts) || [];
    }

    let accHtml = '<option value="">Select Account...</option>';
    let matchedAccountFound = false;
    accountsList.forEach((acc, idx) => {
        let isSelected = false;
        if (state.account && acc.name === state.account) {
            isSelected = true;
            matchedAccountFound = true;
        } else if (!state.account && idx === 0) {
            isSelected = true;
        }
        let selAttr = isSelected ? 'selected' : '';
        accHtml += `<option value="${acc.name}" data-balance="${acc.balance}" ${selAttr}>${acc.name} (KES ${format_currency(acc.balance, '')})</option>`;
    });
    accSelect.html(accHtml);

    update_supplier_source_balance(wrapper);
}

function update_supplier_source_balance(wrapper) {
    let selectedOpt = $(wrapper).find('#exec-modal-supp-source-account option:selected');
    let bal = parseFloat(selectedOpt.data('balance')) || 0;
    let badge = $(wrapper).find('#exec-modal-supp-source-bal-badge');

    badge.text('Bal: ' + format_currency(bal, 'KES'));
    if (bal >= 0) {
        badge.css({'background': '#dcfce7', 'color': '#166534'});
    } else {
        badge.css({'background': '#fee2e2', 'color': '#991b1b'});
    }
}

function load_supplier_invoices_for_modal(wrapper, supplier, station) {
    if (!supplier) return;
    $(wrapper).find('#exec-modal-supp-invs-body').html('<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 20px;"><span class="spinner"></span> Loading invoices for ' + supplier + '...</td></tr>');

    frappe.call({
        method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_supplier_payment_form_data',
        args: {
            supplier: supplier,
            station: station || ''
        },
        callback: function(r) {
            if (r.message) {
                render_supplier_modal_invoices(wrapper, r.message.invoices || [], r.message.total_outstanding || 0);
            }
        }
    });
}

function render_supplier_modal_invoices(wrapper, invoices, totalOutstanding) {
    window.EXEC_SUPP_STATE.invoices = invoices;
    $(wrapper).find('#exec-modal-supp-total-invs').text(format_currency(totalOutstanding, 'KES'));

    let tbody = $(wrapper).find('#exec-modal-supp-invs-body');
    if (!invoices || invoices.length === 0) {
        tbody.html('<tr><td colspan="7" style="text-align: center; color: #16a34a; font-weight: 700; padding: 20px;">✓ No outstanding fuel purchase invoices found for this station & supplier!</td></tr>');
        $(wrapper).find('#exec-modal-supp-selected-invs-total').text('KES 0.00');
        $(wrapper).find('#btn-supp-fill-amount').data('total', 0);
        return;
    }

    let rowsHtml = '';
    invoices.forEach(inv => {
        let stBadge = inv.station === 'Galana Annex'
            ? `<span style="font-size: 11px; font-weight: 700; background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px;">Galana Annex</span>`
            : (inv.station === 'RUBIS POA PLACE'
                ? `<span style="font-size: 11px; font-weight: 700; background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 4px;">Rubis Poa Place</span>`
                : `<span style="font-size: 11px; font-weight: 600; background: #f1f5f9; color: #64748b; padding: 2px 8px; border-radius: 4px;">General</span>`);

        rowsHtml += `
            <tr>
                <td style="text-align: center; vertical-align: middle;">
                    <input type="checkbox" class="exec-supp-inv-check" value="${inv.name}" data-outstanding="${inv.outstanding_amount}" checked>
                </td>
                <td style="font-weight: 700; color: #0284c7; vertical-align: middle;">
                    <a href="/app/purchase-invoice/${inv.name}" target="_blank" style="text-decoration: underline; color: inherit;">${inv.name}</a>
                </td>
                <td style="vertical-align: middle;">${stBadge}</td>
                <td style="vertical-align: middle; white-space: nowrap;">${inv.posting_date_formatted || inv.posting_date}</td>
                <td style="vertical-align: middle; font-family: monospace;">${inv.bill_no || '-'}</td>
                <td style="text-align: right; font-family: monospace; vertical-align: middle;">${format_currency(inv.grand_total, 'KES')}</td>
                <td style="text-align: right; font-family: monospace; font-weight: 700; color: #dc2626; vertical-align: middle;">${format_currency(inv.outstanding_amount, 'KES')}</td>
            </tr>
        `;
    });
    tbody.html(rowsHtml);

    recalc_selected_invoices(wrapper);
}

function recalc_selected_invoices(wrapper) {
    let total = 0;
    let count = 0;
    $(wrapper).find('.exec-supp-inv-check:checked').each(function() {
        total += parseFloat($(this).data('outstanding')) || 0;
        count++;
    });

    $(wrapper).find('#exec-modal-supp-selected-invs-total').text(format_currency(total, 'KES'));
    $(wrapper).find('#btn-supp-fill-amount').data('total', total);

    // If payment amount input is currently empty or 0, auto-fill with selected total
    let currentAmt = parseFloat($(wrapper).find('#exec-modal-supp-amount').val()) || 0;
    if (currentAmt === 0 && total > 0) {
        $(wrapper).find('#exec-modal-supp-amount').val(total.toFixed(2));
    }
}

function submit_supplier_payment_form(wrapper) {
    let state = window.EXEC_SUPP_STATE;
    let supplier = $(wrapper).find('#exec-modal-supp-supplier').val();
    let source_acc = $(wrapper).find('#exec-modal-supp-source-account').val();
    let amount = parseFloat($(wrapper).find('#exec-modal-supp-amount').val());
    let posting_date = $(wrapper).find('#exec-modal-supp-date').val();
    let ref = $(wrapper).find('#exec-modal-supp-ref').val().trim();
    let remarks = $(wrapper).find('#exec-modal-supp-remarks').val().trim();

    let alertBox = $(wrapper).find('#exec-modal-supp-alert');
    alertBox.hide();

    if (!supplier) {
        alertBox.text("Please select a supplier.").css({'background': '#fee2e2', 'color': '#991b1b'}).show();
        return;
    }
    if (!source_acc) {
        alertBox.text("Please select the source payment account.").css({'background': '#fee2e2', 'color': '#991b1b'}).show();
        return;
    }
    if (isNaN(amount) || amount <= 0) {
        alertBox.text("Please enter a valid payment amount greater than 0.").css({'background': '#fee2e2', 'color': '#991b1b'}).show();
        return;
    }
    if (!posting_date) {
        alertBox.text("Please specify payment date.").css({'background': '#fee2e2', 'color': '#991b1b'}).show();
        return;
    }

    // Collect checked invoices
    let checkedInvoices = [];
    $(wrapper).find('.exec-supp-inv-check:checked').each(function() {
        checkedInvoices.push($(this).val());
    });

    // UI Loading state
    $(wrapper).find('#exec-modal-supp-spinner').removeClass('hidden');
    $(wrapper).find('#btn-exec-modal-supp-submit').prop('disabled', true);

    frappe.call({
        method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.submit_supplier_bank_transfer',
        args: {
            paid_from_account: source_acc,
            supplier: supplier,
            amount: amount,
            posting_date: posting_date,
            reference: ref,
            invoice_names: JSON.stringify(checkedInvoices),
            remarks: remarks,
            payment_type_mode: state.mode
        },
        freeze: true,
        freeze_message: state.mode === 'bank_transfer' ? __("Posting Bank Transfer to Supplier...") : __("Reconciling Fuel Invoices with Station Cards..."),
        callback: function(r) {
            $(wrapper).find('#exec-modal-supp-spinner').addClass('hidden');
            $(wrapper).find('#btn-exec-modal-supp-submit').prop('disabled', false);

            if (r && r.message && r.message.success) {
                frappe.show_alert({
                    message: `<span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">check_circle</span> ${r.message.message} (<a href="/app/payment-entry/${r.message.payment_entry}" target="_blank" style="color: #fff; text-decoration: underline;">View Entry</a>)`,
                    indicator: 'green'
                }, 8);

                $(wrapper).find('#exec-supplier-payment-modal').hide();

                // Refresh affected views
                if (typeof load_exec_cash_accounts === 'function') {
                    load_exec_cash_accounts(wrapper);
                }
                if (typeof load_cards_holding_data === 'function') {
                    load_cards_holding_data(wrapper);
                }
                if (typeof load_dashboard_data === 'function') {
                    load_dashboard_data(wrapper);
                }
            } else {
                let err = (r && r.message && r.message.message) ? r.message.message : 'Failed to post payment entry.';
                alertBox.text(err).css({'background': '#fee2e2', 'color': '#991b1b'}).show();
            }
        },
        error: function(err) {
            $(wrapper).find('#exec-modal-supp-spinner').addClass('hidden');
            $(wrapper).find('#btn-exec-modal-supp-submit').prop('disabled', false);
            alertBox.text("Server Error: " + (err.message || JSON.stringify(err))).css({'background': '#fee2e2', 'color': '#991b1b'}).show();
        }
    });
}

// =========================================================================
// M-PESA TILLS RECONCILIATION & AUDIT MODULE
// =========================================================================

window.MPESA_RECON_STATE = {
    station: '',
    till: '',
    from_date: '',
    to_date: '',
    status_filter: 'all',
    search: '',
    active_subpane: 'mpesa-pane-shifts',
    shifts_data: [],
    transfers_data: [],
    tills_list: [],
    summary: {},
    live_tills: [],
    initialized: false
};

function init_exec_mpesa_reconciliation(wrapper) {
    let state = window.MPESA_RECON_STATE;

    // Default Date Range: Last 7 Days if not set
    if (!state.from_date || !state.to_date) {
        let today = frappe.datetime.get_today();
        state.to_date = today;
        state.from_date = frappe.datetime.add_days(today, -6);
    }
    $(wrapper).find('#mpesa-recon-from-date').val(state.from_date);
    $(wrapper).find('#mpesa-recon-to-date').val(state.to_date);

    // Sync station from executive sidebar if set
    let execStation = $(wrapper).find('#exec-station-filter').val() || '';
    if (execStation && execStation !== 'all') {
        state.station = execStation;
    }

    // Populate Station Selects
    let stSel = $(wrapper).find('#mpesa-recon-station-filter');
    let stmtStSel = $(wrapper).find('#stmt-match-station');
    let currentStationOptions = $(wrapper).find('#exec-station-filter option');

    if (currentStationOptions.length > 1) {
        stSel.empty().append('<option value="">All Stations</option>');
        stmtStSel.empty().append('<option value="">Select Station</option>');
        currentStationOptions.each(function() {
            let val = $(this).val();
            let txt = $(this).text();
            if (val && val !== 'all') {
                stSel.append(`<option value="${frappe.utils.escape_html(val)}">${frappe.utils.escape_html(txt)}</option>`);
                stmtStSel.append(`<option value="${frappe.utils.escape_html(val)}">${frappe.utils.escape_html(txt)}</option>`);
            }
        });
        if (state.station) {
            stSel.val(state.station);
            stmtStSel.val(state.station);
        }
    }

    // Only bind listeners once
    if (!state.initialized) {
        state.initialized = true;

        // Presets
        $(wrapper).find('.mpesa-preset-btn').on('click', function(e) {
            e.preventDefault();
            $(wrapper).find('.mpesa-preset-btn').removeClass('active').css({
                'border-color': '#cbd5e1', 'background': '#f8fafc', 'color': '#334155', 'font-weight': 'normal'
            });
            $(this).addClass('active').css({
                'border-color': '#16a34a', 'background': '#f0fdf4', 'color': '#166534', 'font-weight': '700'
            });

            let preset = $(this).data('preset');
            let today = frappe.datetime.get_today();
            if (preset === 'today') {
                state.from_date = today;
                state.to_date = today;
            } else if (preset === 'yesterday') {
                let y = frappe.datetime.add_days(today, -1);
                state.from_date = y;
                state.to_date = y;
            } else if (preset === 'week') {
                state.from_date = frappe.datetime.add_days(today, -6);
                state.to_date = today;
            } else if (preset === 'month') {
                state.from_date = frappe.datetime.month_start();
                state.to_date = frappe.datetime.month_end();
            } else if (preset === 'last_month') {
                let d = new Date();
                let lmStart = new Date(d.getFullYear(), d.getMonth() - 1, 1);
                let lmEnd = new Date(d.getFullYear(), d.getMonth(), 0);
                state.from_date = frappe.datetime.obj_to_str(lmStart);
                state.to_date = frappe.datetime.obj_to_str(lmEnd);
            }
            $(wrapper).find('#mpesa-recon-from-date').val(state.from_date);
            $(wrapper).find('#mpesa-recon-to-date').val(state.to_date);
            load_mpesa_reconciliation_data(wrapper);
        });

        // Date Inputs
        $(wrapper).find('#mpesa-recon-from-date, #mpesa-recon-to-date').on('change', function() {
            state.from_date = $(wrapper).find('#mpesa-recon-from-date').val();
            state.to_date = $(wrapper).find('#mpesa-recon-to-date').val();
            load_mpesa_reconciliation_data(wrapper);
        });

        // Station Select Filter
        $(wrapper).find('#mpesa-recon-station-filter').on('change', function() {
            state.station = $(this).val();
            state.till = '';
            $(wrapper).find('#stmt-match-station').val(state.station);
            load_mpesa_reconciliation_data(wrapper);
        });

        // Till Select Filter
        $(wrapper).find('#mpesa-recon-till-filter').on('change', function() {
            state.till = $(this).val();
            load_mpesa_reconciliation_data(wrapper);
        });

        // Status Filter
        $(wrapper).find('#mpesa-recon-status-filter').on('change', function() {
            state.status_filter = $(this).val();
            load_mpesa_reconciliation_data(wrapper);
        });

        // Search Input
        let searchTimeout = null;
        $(wrapper).find('#mpesa-search-input').on('keyup', function() {
            clearTimeout(searchTimeout);
            let val = $(this).val().toLowerCase().trim();
            searchTimeout = setTimeout(function() {
                state.search = val;
                filter_mpesa_tables_locally(wrapper);
            }, 250);
        });

        // Refresh Button
        $(wrapper).find('#btn-mpesa-recon-refresh').on('click', function(e) {
            e.preventDefault();
            load_mpesa_reconciliation_data(wrapper);
        });

        // Segmented Subtabs
        $(wrapper).find('#mpesa-segmented-control .seg-btn').on('click', function(e) {
            e.preventDefault();
            let targetPane = $(this).data('target');
            state.active_subpane = targetPane;

            $(wrapper).find('#mpesa-segmented-control .seg-btn').removeClass('active').css({
                'background': 'transparent', 'color': '#64748b', 'box-shadow': 'none'
            });
            $(this).addClass('active').css({
                'background': '#fff', 'color': '#0f172a', 'box-shadow': '0 1px 3px rgba(0,0,0,0.08)'
            });

            $(wrapper).find('.mpesa-subpane').hide();
            $(wrapper).find('#' + targetPane).fadeIn(150);
        });

        // Statement Matcher Station -> Tills
        $(wrapper).find('#stmt-match-station').on('change', function() {
            let st = $(this).val();
            populate_stmt_match_tills(wrapper, st);
        });

        // Statement Matcher Run Audit
        $(wrapper).find('#btn-stmt-match-run').on('click', function(e) {
            e.preventDefault();
            submit_mpesa_statement_matcher(wrapper);
        });

        // Modal Handlers
        $(wrapper).find('#btn-mpesa-modal-close, #btn-mpesa-modal-cancel').on('click', function(e) {
            e.preventDefault();
            $(wrapper).find('#modal-mpesa-audit-action').fadeOut(120);
        });

        $(wrapper).find('#btn-mpesa-modal-submit').on('click', function(e) {
            e.preventDefault();
            submit_mpesa_audit_action(wrapper);
        });

        // CSV Export
        $(wrapper).find('#btn-mpesa-export-csv').on('click', function(e) {
            e.preventDefault();
            export_mpesa_recon_csv(wrapper);
        });
    }

    load_mpesa_reconciliation_data(wrapper);
}

function load_mpesa_reconciliation_data(wrapper) {
    let state = window.MPESA_RECON_STATE;
    state.from_date = $(wrapper).find('#mpesa-recon-from-date').val() || state.from_date;
    state.to_date = $(wrapper).find('#mpesa-recon-to-date').val() || state.to_date;
    state.station = $(wrapper).find('#mpesa-recon-station-filter').val() || state.station;
    state.till = $(wrapper).find('#mpesa-recon-till-filter').val() || state.till;
    state.status_filter = $(wrapper).find('#mpesa-recon-status-filter').val() || 'all';

    // Update station badge
    let stText = state.station ? state.station : 'All Stations';
    $(wrapper).find('#exec-mpesa-recon-station-badge').text(stText);

    // Show table loaders
    $(wrapper).find('#mpesa-shifts-table-body').html(
        `<tr><td colspan="11" style="text-align: center; padding: 36px; color: #64748b;"><span class="spinner"></span> Loading M-Pesa shift readings...</td></tr>`
    );
    $(wrapper).find('#mpesa-transfers-table-body').html(
        `<tr><td colspan="10" style="text-align: center; padding: 36px; color: #64748b;"><span class="spinner"></span> Loading M-Pesa sweeps & transfers...</td></tr>`
    );

    frappe.call({
        method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_mpesa_reconciliation_data',
        args: {
            from_date: state.from_date,
            to_date: state.to_date,
            station: state.station,
            till: state.till,
            status_filter: state.status_filter
        },
        callback: function(r) {
            if (!r || !r.message) {
                $(wrapper).find('#mpesa-shifts-table-body').html('<tr><td colspan="11" style="text-align:center; padding:24px; color:#ef4444;">No data returned from server.</td></tr>');
                $(wrapper).find('#mpesa-transfers-table-body').html('<tr><td colspan="10" style="text-align:center; padding:24px; color:#ef4444;">No data returned from server.</td></tr>');
                return;
            }

            let d = r.message;
            state.shifts_data = d.shifts || [];
            state.transfers_data = d.transfers || [];
            state.tills_list = d.tills_list || [];
            state.summary = d.summary || {};
            state.live_tills = d.live_tills || [];

            // Update KPI cards
            let sm = state.summary;
            $(wrapper).find('#mpesa-kpi-live-balance').text(format_currency(sm.live_balance || 0, "KES"));
            $(wrapper).find('#mpesa-kpi-live-sub').text(`${(state.live_tills || []).length} active station tills monitored`);

            $(wrapper).find('#mpesa-kpi-collections-amt').text(format_currency(sm.total_collections || 0, "KES"));
            $(wrapper).find('#mpesa-kpi-collections-sub').text(`${sm.total_shifts_count || 0} shifts recorded in period`);

            $(wrapper).find('#mpesa-kpi-transfers-amt').text(format_currency(sm.total_transfers || 0, "KES"));
            $(wrapper).find('#mpesa-kpi-transfers-sub').text(`${sm.total_transfers_count || 0} sweeps to Bank / Supplier accounts`);

            let flagCount = sm.flagged_count || 0;
            $(wrapper).find('#mpesa-kpi-flags-count').text(`${flagCount} Flags`);
            if (flagCount > 0) {
                $(wrapper).find('#mpesa-kpi-flags-card').css({'border-left': '5px solid #ef4444', 'border-color': '#fecaca'});
                $(wrapper).find('#mpesa-kpi-flags-count').css('color', '#dc2626');
                $(wrapper).find('#mpesa-kpi-flags-sub').text(`${flagCount} carryover skips or math variances detected`);
            } else {
                $(wrapper).find('#mpesa-kpi-flags-card').css({'border-left': '5px solid #16a34a', 'border-color': '#bbf7d0'});
                $(wrapper).find('#mpesa-kpi-flags-count').css('color', '#16a34a').text('0 Flags (Clean)');
                $(wrapper).find('#mpesa-kpi-flags-sub').text('All recorded collections and carryovers match');
            }

            $(wrapper).find('#mpesa-subtab-shifts-badge').text(`${flagCount} flags`);
            $(wrapper).find('#mpesa-subtab-transfers-count').text(state.transfers_data.length);

            // Populate Till filter options if empty or changed
            let tillSel = $(wrapper).find('#mpesa-recon-till-filter');
            let currentTillVal = tillSel.val();
            tillSel.empty().append('<option value="">All Active Tills</option>');
            state.tills_list.forEach(t => {
                let optText = t.till_name + (t.station ? ` (${t.station})` : '');
                tillSel.append(`<option value="${frappe.utils.escape_html(t.till_name)}">${frappe.utils.escape_html(optText)}</option>`);
            });
            if (currentTillVal) {
                tillSel.val(currentTillVal);
            }

            // Also populate statement matcher till options
            populate_stmt_match_tills(wrapper, state.station);

            // Render tables
            render_mpesa_shifts_table(wrapper);
            render_mpesa_transfers_table(wrapper);
        },
        error: function(err) {
            $(wrapper).find('#mpesa-shifts-table-body').html(`<tr><td colspan="11" style="text-align:center; padding:24px; color:#ef4444;">Error: ${frappe.utils.escape_html(err.message || 'Failed to load')}</td></tr>`);
            $(wrapper).find('#mpesa-transfers-table-body').html(`<tr><td colspan="10" style="text-align:center; padding:24px; color:#ef4444;">Error: ${frappe.utils.escape_html(err.message || 'Failed to load')}</td></tr>`);
        }
    });
}

function render_mpesa_shifts_table(wrapper) {
    let state = window.MPESA_RECON_STATE;
    let list = state.shifts_data || [];
    let tbody = $(wrapper).find('#mpesa-shifts-table-body');
    tbody.empty();

    if (!list.length) {
        tbody.html('<tr><td colspan="11" style="text-align:center; padding:36px; color:#64748b;">No M-Pesa shift readings found for selected criteria.</td></tr>');
        $(wrapper).find('#mpesa-shifts-count-info').text('Showing 0 shifts');
        return;
    }

    let search = (state.search || '').toLowerCase();
    let renderedCount = 0;

    list.forEach(item => {
        // Local search filter
        if (search) {
            let str = `${item.shift || ''} ${item.station || ''} ${item.till_name || ''} ${item.cashier_name || ''} ${item.audit_status || ''}`.toLowerCase();
            if (!str.includes(search)) return;
        }
        renderedCount++;

        // Math badge
        let mathBadge = '';
        if (item.math_status === 'OK') {
            mathBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:#f0fdf4; color:#166534; font-weight:700; border:1px solid #bbf7d0;">✓ Bal 0.00</span>`;
        } else {
            let diffTxt = format_currency(item.math_discrepancy || 0, "KES");
            mathBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:#fef2f2; color:#dc2626; font-weight:700; border:1px solid #fecaca;" title="Formula: Collections should equal Closing - Opening + Sweeps">⚠️ Diff: ${diffTxt}</span>`;
        }

        // Carryover badge
        let carryBadge = '';
        if (item.carryover_status === 'Match') {
            carryBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:#f0fdf4; color:#166534; font-weight:700; border:1px solid #bbf7d0;">✓ Continuous</span>`;
        } else if (item.carryover_status === 'Mismatch') {
            carryBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:#fef2f2; color:#dc2626; font-weight:700; border:1px solid #fecaca;" title="Expected Opening: ${format_currency(item.expected_opening || 0, 'KES')}">🚨 Skip: exp ${format_currency(item.expected_opening || 0, 'KES')}</span>`;
        } else {
            carryBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:#f1f5f9; color:#64748b; font-weight:600;">Initial</span>`;
        }

        // Audit status badge
        let stBadge = '';
        let st = item.audit_status || 'Pending';
        if (st === 'Verified') {
            stBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:#dcfce7; color:#15803d; font-weight:800; border:1px solid #86efac;">🟢 Verified</span>`;
        } else if (st === 'Flagged') {
            stBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:#fee2e2; color:#b91c1c; font-weight:800; border:1px solid #fca5a5;">🔴 Flagged</span>`;
        } else {
            stBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:#fef3c7; color:#b45309; font-weight:800; border:1px solid #fde68a;">🟡 Pending</span>`;
        }

        let rowBg = (item.is_flagged) ? 'background:#fffbfb;' : '';

        let rowHtml = `
            <tr style="border-bottom: 1px solid #f1f5f9; ${rowBg}">
                <td style="padding: 10px 12px;">
                    <div style="font-weight: 700; color: #0f172a; font-family: monospace;">
                        <a href="/app/shift/${item.shift}" target="_blank" style="color: #0284c7; text-decoration: underline;">${frappe.utils.escape_html(item.shift || '')}</a>
                    </div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${frappe.utils.escape_html(item.station || '')}</div>
                </td>
                <td style="padding: 10px 12px;">
                    <div style="color: #334155; font-weight: 600;">${item.shift_date || ''}</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">CSA: ${frappe.utils.escape_html(item.cashier_name || 'N/A')}</div>
                </td>
                <td style="padding: 10px 12px;">
                    <span style="font-weight: 700; color: #0f172a; background: #f8fafc; padding: 3px 8px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 12px;">
                        ${frappe.utils.escape_html(item.till_name || '')}
                    </span>
                </td>
                <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 12.5px; color: #334155;">
                    ${format_currency(item.opening_balance || 0, "KES")}
                </td>
                <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 12.5px; font-weight: 700; color: #059669;">
                    +${format_currency(item.collections || 0, "KES")}
                </td>
                <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 12.5px; font-weight: 700; color: #0284c7;">
                    ${item.transfers_out > 0 ? '-' + format_currency(item.transfers_out, "KES") : '0.00'}
                </td>
                <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 12.5px; font-weight: 800; color: #0f172a;">
                    ${format_currency(item.closing_balance || 0, "KES")}
                </td>
                <td style="padding: 10px 12px; text-align: center;">
                    ${mathBadge}
                </td>
                <td style="padding: 10px 12px; text-align: center;">
                    ${carryBadge}
                </td>
                <td style="padding: 10px 12px; text-align: center;">
                    ${stBadge}
                </td>
                <td style="padding: 10px 12px; text-align: center;">
                    <button type="button" class="btn-mpesa-audit-shift btn btn-xs" 
                        data-row-name="${frappe.utils.escape_html(item.row_name || '')}"
                        data-shift="${frappe.utils.escape_html(item.shift || '')}"
                        data-station="${frappe.utils.escape_html(item.station || '')}"
                        data-date="${frappe.utils.escape_html(item.shift_date || '')}"
                        data-till="${frappe.utils.escape_html(item.till_name || '')}"
                        data-collections="${item.collections || 0}"
                        data-status="${frappe.utils.escape_html(item.audit_status || 'Pending')}"
                        data-stmt-ref="${frappe.utils.escape_html(item.statement_ref || '')}"
                        data-note="${frappe.utils.escape_html(item.audit_note || '')}"
                        style="padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 6px; background: #fff; border: 1px solid #cbd5e1; color: #1e293b; cursor: pointer;">
                        Audit / Verify
                    </button>
                </td>
            </tr>
        `;
        tbody.append(rowHtml);
    });

    $(wrapper).find('#mpesa-shifts-count-info').text(`Showing ${renderedCount} shifts`);

    // Bind Audit button click
    tbody.find('.btn-mpesa-audit-shift').off('click').on('click', function(e) {
        e.preventDefault();
        let btn = $(this);
        open_mpesa_audit_modal(wrapper, {
            target_type: 'shift_reading',
            target_id: btn.data('row-name'),
            shift: btn.data('shift'),
            station: btn.data('station'),
            date: btn.data('date'),
            till: btn.data('till'),
            amount: btn.data('collections'),
            status: btn.data('status'),
            stmt_ref: btn.data('stmt-ref'),
            note: btn.data('note')
        });
    });
}

function render_mpesa_transfers_table(wrapper) {
    let state = window.MPESA_RECON_STATE;
    let list = state.transfers_data || [];
    let tbody = $(wrapper).find('#mpesa-transfers-table-body');
    tbody.empty();

    if (!list.length) {
        tbody.html('<tr><td colspan="10" style="text-align:center; padding:36px; color:#64748b;">No M-Pesa sweeps or transfers recorded in this period.</td></tr>');
        $(wrapper).find('#mpesa-transfers-count-info').text('Showing 0 transfers');
        return;
    }

    let search = (state.search || '').toLowerCase();
    let renderedCount = 0;

    list.forEach(t => {
        if (search) {
            let str = `${t.transfer_id || ''} ${t.station || ''} ${t.destination_account || ''} ${t.source_account || ''} ${t.audit_status || ''}`.toLowerCase();
            if (!str.includes(search)) return;
        }
        renderedCount++;

        let stBadge = '';
        let st = t.audit_status || 'Pending';
        if (st === 'Verified') {
            stBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:#dcfce7; color:#15803d; font-weight:800; border:1px solid #86efac;">🟢 Verified</span>`;
        } else if (st === 'Flagged') {
            stBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:#fee2e2; color:#b91c1c; font-weight:800; border:1px solid #fca5a5;">🔴 Flagged</span>`;
        } else {
            stBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:#fef3c7; color:#b45309; font-weight:800; border:1px solid #fde68a;">🟡 Pending</span>`;
        }

        let typeBadge = (t.transfer_type === 'Station Cash Transfer')
            ? `<span style="font-size:10.5px; padding:2px 7px; background:#e0f2fe; color:#0369a1; border-radius:6px; font-weight:600;">Cash Transfer</span>`
            : `<span style="font-size:10.5px; padding:2px 7px; background:#fef3c7; color:#b45309; border-radius:6px; font-weight:600;">Shift Sweep</span>`;

        let rowHtml = `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 12px;">
                    <div style="font-weight: 700; color: #0284c7; font-family: monospace;">${frappe.utils.escape_html(t.transfer_id || '')}</div>
                </td>
                <td style="padding: 10px 12px; color: #334155; font-size: 12px;">
                    ${t.transfer_date || ''} ${t.transfer_time || ''}
                </td>
                <td style="padding: 10px 12px;">
                    <div style="font-weight: 600; color: #0f172a;">${frappe.utils.escape_html(t.station || '')}</div>
                    <div style="font-size: 11px; color: #64748b;">Shift: ${frappe.utils.escape_html(t.shift || 'N/A')}</div>
                </td>
                <td style="padding: 10px 12px;">
                    ${typeBadge}
                </td>
                <td style="padding: 10px 12px;">
                    <span style="font-size: 11.5px; font-weight: 700; color: #166534; background: #f0fdf4; padding: 2px 7px; border-radius: 6px; border: 1px solid #bbf7d0;">
                        ${frappe.utils.escape_html(t.source_account || 'M-Pesa Till')}
                    </span>
                </td>
                <td style="padding: 10px 12px;">
                    <span style="font-size: 11.5px; font-weight: 700; color: #1e40af; background: #eff6ff; padding: 2px 7px; border-radius: 6px; border: 1px solid #bfdbfe;">
                        ${frappe.utils.escape_html(t.destination_account || 'Bank / Supplier')}
                    </span>
                </td>
                <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 13px; font-weight: 800; color: #0284c7;">
                    ${format_currency(t.amount || 0, "KES")}
                </td>
                <td style="padding: 10px 12px; font-size: 11.5px; color: #475569;">
                    ${frappe.utils.escape_html(t.slip_ref || 'None')}
                </td>
                <td style="padding: 10px 12px; text-align: center;">
                    ${stBadge}
                </td>
                <td style="padding: 10px 12px; text-align: center;">
                    <button type="button" class="btn-mpesa-audit-transfer btn btn-xs"
                        data-transfer-id="${frappe.utils.escape_html(t.transfer_id || '')}"
                        data-transfer-type="${frappe.utils.escape_html(t.transfer_type || '')}"
                        data-station="${frappe.utils.escape_html(t.station || '')}"
                        data-date="${frappe.utils.escape_html(t.transfer_date || '')}"
                        data-source="${frappe.utils.escape_html(t.source_account || '')}"
                        data-dest="${frappe.utils.escape_html(t.destination_account || '')}"
                        data-amount="${t.amount || 0}"
                        data-status="${frappe.utils.escape_html(t.audit_status || 'Pending')}"
                        data-slip="${frappe.utils.escape_html(t.slip_ref || '')}"
                        data-note="${frappe.utils.escape_html(t.audit_note || '')}"
                        style="padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 6px; background: #fff; border: 1px solid #cbd5e1; color: #1e293b; cursor: pointer;">
                        Verify
                    </button>
                </td>
            </tr>
        `;
        tbody.append(rowHtml);
    });

    $(wrapper).find('#mpesa-transfers-count-info').text(`Showing ${renderedCount} transfers`);

    tbody.find('.btn-mpesa-audit-transfer').off('click').on('click', function(e) {
        e.preventDefault();
        let btn = $(this);
        open_mpesa_audit_modal(wrapper, {
            target_type: 'transfer',
            transfer_type: btn.data('transfer-type'),
            target_id: btn.data('transfer-id'),
            station: btn.data('station'),
            date: btn.data('date'),
            source: btn.data('source'),
            dest: btn.data('dest'),
            amount: btn.data('amount'),
            status: btn.data('status'),
            stmt_ref: btn.data('slip'),
            note: btn.data('note')
        });
    });
}

function filter_mpesa_tables_locally(wrapper) {
    render_mpesa_shifts_table(wrapper);
    render_mpesa_transfers_table(wrapper);
}

function open_mpesa_audit_modal(wrapper, opts) {
    let modal = $(wrapper).find('#modal-mpesa-audit-action');
    modal.find('#mpesa-audit-target-type').val(opts.target_type);
    modal.find('#mpesa-audit-target-id').val(opts.target_id);
    modal.find('#mpesa-audit-stmt-ref').val(opts.stmt_ref || '');
    modal.find('#mpesa-audit-note').val(opts.note || '');
    modal.find('#mpesa-audit-alert').hide().text('');

    if (opts.status === 'Verified') {
        modal.find('input[name="mpesa-audit-status-choice"][value="Verified"]').prop('checked', true);
    } else {
        modal.find('input[name="mpesa-audit-status-choice"][value="Flagged"]').prop('checked', true);
    }

    let infoHtml = '';
    if (opts.target_type === 'shift_reading') {
        modal.find('#mpesa-modal-title').text('Audit & Verify M-Pesa Shift Reading');
        infoHtml = `
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div><strong>Shift:</strong> ${frappe.utils.escape_html(opts.shift || '')}</div>
                <div><strong>Station:</strong> ${frappe.utils.escape_html(opts.station || '')}</div>
                <div><strong>Till:</strong> ${frappe.utils.escape_html(opts.till || '')}</div>
                <div><strong>Collections:</strong> <span style="font-family:monospace; color:#059669; font-weight:800;">${format_currency(opts.amount || 0, "KES")}</span></div>
            </div>
        `;
    } else {
        modal.find('#mpesa-modal-title').text('Audit & Verify M-Pesa Sweep / Transfer');
        modal.data('transfer-type', opts.transfer_type || 'Station Cash Transfer');
        infoHtml = `
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div><strong>Transfer ID:</strong> ${frappe.utils.escape_html(opts.target_id || '')}</div>
                <div><strong>Station:</strong> ${frappe.utils.escape_html(opts.station || '')}</div>
                <div><strong>Route:</strong> ${frappe.utils.escape_html(opts.source || '')} ➔ ${frappe.utils.escape_html(opts.dest || '')}</div>
                <div><strong>Amount:</strong> <span style="font-family:monospace; color:#0284c7; font-weight:800;">${format_currency(opts.amount || 0, "KES")}</span></div>
            </div>
        `;
    }
    modal.find('#mpesa-audit-item-info').html(infoHtml);
    modal.css('display', 'flex').hide().fadeIn(150);
}

function submit_mpesa_audit_action(wrapper) {
    let modal = $(wrapper).find('#modal-mpesa-audit-action');
    let targetType = modal.find('#mpesa-audit-target-type').val();
    let targetId = modal.find('#mpesa-audit-target-id').val();
    let decision = modal.find('input[name="mpesa-audit-status-choice"]:checked').val() || 'Verified';
    let stmtRef = modal.find('#mpesa-audit-stmt-ref').val().trim();
    let note = modal.find('#mpesa-audit-note').val().trim();
    let alertBox = modal.find('#mpesa-audit-alert');

    modal.find('#mpesa-modal-spinner').removeClass('hidden');
    modal.find('#btn-mpesa-modal-submit').prop('disabled', true);

    if (targetType === 'shift_reading') {
        frappe.call({
            method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.verify_mpesa_shift_reading',
            args: {
                row_name: targetId,
                status: decision,
                statement_ref: stmtRef,
                audit_note: note
            },
            callback: function(r) {
                modal.find('#mpesa-modal-spinner').addClass('hidden');
                modal.find('#btn-mpesa-modal-submit').prop('disabled', false);
                if (r && r.message && r.message.success) {
                    frappe.show_alert({
                        message: `<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle;">check_circle</span> ${r.message.message}`,
                        indicator: 'green'
                    }, 5);
                    modal.fadeOut(120);
                    load_mpesa_reconciliation_data(wrapper);
                } else {
                    let msg = (r && r.message && r.message.message) ? r.message.message : 'Failed to update audit status.';
                    alertBox.text(msg).css({'background': '#fee2e2', 'color': '#991b1b'}).show();
                }
            },
            error: function(err) {
                modal.find('#mpesa-modal-spinner').addClass('hidden');
                modal.find('#btn-mpesa-modal-submit').prop('disabled', false);
                alertBox.text(err.message || 'Server error occurred.').css({'background': '#fee2e2', 'color': '#991b1b'}).show();
            }
        });
    } else {
        let transferType = modal.data('transfer-type') || 'Station Cash Transfer';
        frappe.call({
            method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.audit_mpesa_transfer_routing',
            args: {
                transfer_id: targetId,
                transfer_type: transferType,
                status: decision,
                audit_note: note,
                bank_slip_ref: stmtRef
            },
            callback: function(r) {
                modal.find('#mpesa-modal-spinner').addClass('hidden');
                modal.find('#btn-mpesa-modal-submit').prop('disabled', false);
                if (r && r.message && r.message.success) {
                    frappe.show_alert({
                        message: `<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle;">check_circle</span> ${r.message.message}`,
                        indicator: 'green'
                    }, 5);
                    modal.fadeOut(120);
                    load_mpesa_reconciliation_data(wrapper);
                } else {
                    let msg = (r && r.message && r.message.message) ? r.message.message : 'Failed to update audit status.';
                    alertBox.text(msg).css({'background': '#fee2e2', 'color': '#991b1b'}).show();
                }
            },
            error: function(err) {
                modal.find('#mpesa-modal-spinner').addClass('hidden');
                modal.find('#btn-mpesa-modal-submit').prop('disabled', false);
                alertBox.text(err.message || 'Server error occurred.').css({'background': '#fee2e2', 'color': '#991b1b'}).show();
            }
        });
    }
}

function populate_stmt_match_tills(wrapper, station) {
    let state = window.MPESA_RECON_STATE;
    let tillSel = $(wrapper).find('#stmt-match-till');
    tillSel.empty().append('<option value="">Select Till</option>');
    (state.tills_list || []).forEach(t => {
        if (!station || t.station === station) {
            tillSel.append(`<option value="${frappe.utils.escape_html(t.till_name)}">${frappe.utils.escape_html(t.till_name)}</option>`);
        }
    });
}

function submit_mpesa_statement_matcher(wrapper) {
    let station = $(wrapper).find('#stmt-match-station').val();
    let till = $(wrapper).find('#stmt-match-till').val();
    let date = $(wrapper).find('#stmt-match-date').val();
    let op = parseFloat($(wrapper).find('#stmt-match-opening').val()) || 0;
    let inf = parseFloat($(wrapper).find('#stmt-match-inflows').val()) || 0;
    let trf = parseFloat($(wrapper).find('#stmt-match-transfers').val()) || 0;
    let cl = parseFloat($(wrapper).find('#stmt-match-closing').val()) || 0;
    let notes = $(wrapper).find('#stmt-match-notes').val();

    if (!station || !till || !date) {
        frappe.msgprint(__('Please select Station, Till Name, and Statement Date to run audit.'));
        return;
    }

    let resBox = $(wrapper).find('#stmt-match-results-box');
    resBox.html('<div style="padding:24px; text-align:center;"><span class="spinner"></span> Running comparison against shift records...</div>');

    frappe.call({
        method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.submit_mpesa_statement_audit',
        args: {
            station: station,
            till: till,
            statement_date: date,
            statement_opening: op,
            statement_inflows: inf,
            statement_transfers: trf,
            statement_closing: cl,
            notes: notes
        },
        callback: function(r) {
            if (!r || !r.message || !r.message.success) {
                resBox.html(`<div style="padding:16px; color:#ef4444;">${(r && r.message && r.message.message) || 'Statement audit failed.'}</div>`);
                return;
            }

            let res = r.message.audit_result;
            let statusPill = (res.status === 'Balanced')
                ? `<span style="font-size:12px; padding:4px 12px; border-radius:999px; background:#dcfce7; color:#15803d; font-weight:800; border:1px solid #86efac;">🟢 BALANCED (0.00 VARIANCE)</span>`
                : `<span style="font-size:12px; padding:4px 12px; border-radius:999px; background:#fee2e2; color:#b91c1c; font-weight:800; border:1px solid #fca5a5;">🚨 VARIANCE DETECTED</span>`;

            let html = `
                <div style="text-align:left;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid #e2e8f0; padding-bottom:10px;">
                        <div>
                            <span style="font-size:13px; font-weight:800; color:#0f172a;">${frappe.utils.escape_html(till)} • ${date}</span>
                            <div style="font-size:11px; color:#64748b;">${frappe.utils.escape_html(station)}</div>
                        </div>
                        <div>${statusPill}</div>
                    </div>

                    <table style="width:100%; font-size:12px; border-collapse:collapse; margin-bottom:14px;">
                        <thead>
                            <tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0;">
                                <th style="padding:6px 8px; text-align:left;">Metric</th>
                                <th style="padding:6px 8px; text-align:right;">Safaricom Stmt</th>
                                <th style="padding:6px 8px; text-align:right;">System / SPA</th>
                                <th style="padding:6px 8px; text-align:right;">Variance</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="border-bottom:1px solid #f1f5f9;">
                                <td style="padding:6px 8px; font-weight:600;">Opening Balance</td>
                                <td style="padding:6px 8px; text-align:right; font-family:monospace;">${format_currency(res.statement_opening, "KES")}</td>
                                <td style="padding:6px 8px; text-align:right; font-family:monospace;">${format_currency(res.system_opening, "KES")}</td>
                                <td style="padding:6px 8px; text-align:right; font-family:monospace; color:${res.opening_variance === 0 ? '#16a34a' : '#dc2626'}; font-weight:700;">${format_currency(res.opening_variance, "KES")}</td>
                            </tr>
                            <tr style="border-bottom:1px solid #f1f5f9;">
                                <td style="padding:6px 8px; font-weight:600;">Inflows / Collections</td>
                                <td style="padding:6px 8px; text-align:right; font-family:monospace;">${format_currency(res.statement_inflows, "KES")}</td>
                                <td style="padding:6px 8px; text-align:right; font-family:monospace;">${format_currency(res.system_collections, "KES")}</td>
                                <td style="padding:6px 8px; text-align:right; font-family:monospace; color:${res.inflows_variance === 0 ? '#16a34a' : '#dc2626'}; font-weight:700;">${format_currency(res.inflows_variance, "KES")}</td>
                            </tr>
                            <tr style="border-bottom:1px solid #f1f5f9;">
                                <td style="padding:6px 8px; font-weight:600;">Sweeps / Transfers</td>
                                <td style="padding:6px 8px; text-align:right; font-family:monospace;">${format_currency(res.statement_transfers, "KES")}</td>
                                <td style="padding:6px 8px; text-align:right; font-family:monospace;">${format_currency(res.system_transfers, "KES")}</td>
                                <td style="padding:6px 8px; text-align:right; font-family:monospace; color:${res.transfers_variance === 0 ? '#16a34a' : '#dc2626'}; font-weight:700;">${format_currency(res.transfers_variance, "KES")}</td>
                            </tr>
                            <tr style="border-bottom:2px solid #e2e8f0; font-weight:700;">
                                <td style="padding:8px 8px;">Closing Balance</td>
                                <td style="padding:8px 8px; text-align:right; font-family:monospace;">${format_currency(res.statement_closing, "KES")}</td>
                                <td style="padding:8px 8px; text-align:right; font-family:monospace;">${format_currency(res.system_closing, "KES")}</td>
                                <td style="padding:8px 8px; text-align:right; font-family:monospace; color:${res.closing_variance === 0 ? '#16a34a' : '#dc2626'}; font-weight:800;">${format_currency(res.closing_variance, "KES")}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div style="font-size:11.5px; color:#64748b; background:#f8fafc; border-radius:6px; padding:8px 12px; border:1px solid #e2e8f0;">
                        ${frappe.utils.escape_html(res.message || '')}
                    </div>
                </div>
            `;
            resBox.html(html);
            load_mpesa_reconciliation_data(wrapper);
        },
        error: function(err) {
            resBox.html(`<div style="padding:16px; color:#ef4444;">Server error: ${frappe.utils.escape_html(err.message || 'Unknown error')}</div>`);
        }
    });
}

function export_mpesa_recon_csv(wrapper) {
    let state = window.MPESA_RECON_STATE;
    let rows = [
        ["M-PESA TILLS AUDIT & RECONCILIATION REPORT"],
        ["Export Date", frappe.datetime.now_datetime()],
        ["Station Filter", state.station || "All Stations"],
        ["Till Filter", state.till || "All Active Tills"],
        ["Date Range", `${state.from_date} to ${state.to_date}`],
        ["Status Filter", state.status_filter],
        [],
        ["--- SECTION 1: SHIFT COLLECTIONS & READINGS AUDIT ---"],
        ["Shift ID", "Station", "Date", "Cashier", "Till Name", "Opening (KES)", "Collections (KES)", "Sweeps Out (KES)", "Closing (KES)", "Math Discrepancy", "Math Status", "Carryover Status", "Audit Status", "Statement Ref", "Audit Note"]
    ];

    (state.shifts_data || []).forEach(s => {
        rows.push([
            s.shift || "",
            s.station || "",
            s.shift_date || "",
            s.cashier_name || "",
            s.till_name || "",
            (s.opening_balance || 0).toFixed(2),
            (s.collections || 0).toFixed(2),
            (s.transfers_out || 0).toFixed(2),
            (s.closing_balance || 0).toFixed(2),
            (s.math_discrepancy || 0).toFixed(2),
            s.math_status || "",
            s.carryover_status || "",
            s.audit_status || "",
            s.statement_ref || "",
            (s.audit_note || "").replace(/(\r\n|\n|\r)/gm, " ")
        ]);
    });

    rows.push([]);
    rows.push(["--- SECTION 2: TRANSFERS & SWEEPS ROUTING ---"]);
    rows.push(["Transfer ID", "Type", "Station", "Date", "Time", "Shift", "Source Till", "Destination Account", "Amount (KES)", "Slip Ref", "Audit Status", "Audit Note"]);

    (state.transfers_data || []).forEach(t => {
        rows.push([
            t.transfer_id || "",
            t.transfer_type || "",
            t.station || "",
            t.transfer_date || "",
            t.transfer_time || "",
            t.shift || "",
            t.source_account || "",
            t.destination_account || "",
            (t.amount || 0).toFixed(2),
            t.slip_ref || "",
            t.audit_status || "",
            (t.audit_note || "").replace(/(\r\n|\n|\r)/gm, " ")
        ]);
    });

    let csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    let encodedUri = encodeURI(csvContent);
    let link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `mpesa_reconciliation_${state.station || 'all'}_${state.from_date}_to_${state.to_date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


