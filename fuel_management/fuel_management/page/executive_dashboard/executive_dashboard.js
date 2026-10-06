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
    // Navigation logic
    $(wrapper).find('.exec-nav-item').on('click', function(e) {
        if ($(this).attr('data-tab')) {
            e.preventDefault();
            
            const target = $(this).data('tab');
            const debtorsView = $(this).attr('data-debtors-view');

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
            }

            // Close sidebar on mobile
            if ($(window).width() < 768) {
                $(wrapper).find('.exec-sidebar').hide();
            }
        }
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
    }

    // Date Preset Buttons
    $(wrapper).find('.exec-preset-btn').off('click').on('click', function(e) {
        e.preventDefault();
        $(wrapper).find('.exec-preset-btn').removeClass('active');
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
        $(wrapper).find('.exec-preset-btn').removeClass('active');
        trigger_all_loads();
    });

    $(wrapper).find('#btn-reconcile-topups').off('click').on('click', function() {
        let d = new frappe.ui.Dialog({
            title: 'Enter Top-Up Deduction (Rubis Charge)',
            fields: [
                {
                    label: 'Station',
                    fieldname: 'station',
                    fieldtype: 'Link',
                    options: 'Fuel Station',
                    reqd: 1
                },
                {
                    label: 'Amount Charged by Rubis',
                    fieldname: 'amount',
                    fieldtype: 'Currency',
                    reqd: 1
                },
                {
                    label: 'Rubis/Bank Account (Credit Account)',
                    fieldname: 'credit_account',
                    fieldtype: 'Link',
                    options: 'Account',
                    get_query: function() {
                        return { filters: { is_group: 0 } };
                    },
                    reqd: 1
                },
                {
                    label: 'Date',
                    fieldname: 'date',
                    fieldtype: 'Date',
                    default: frappe.datetime.get_today(),
                    reqd: 1
                },
                {
                    label: 'Reference / Invoice No',
                    fieldname: 'reference',
                    fieldtype: 'Data',
                    reqd: 1
                }
            ],
            primary_action_label: 'Submit Deduction',
            primary_action(values) {
                frappe.call({
                    method: 'fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.create_topup_deduction',
                    args: {
                        station: values.station,
                        amount: values.amount,
                        credit_account: values.credit_account,
                        date: values.date,
                        reference: values.reference
                    },
                    callback: function(r) {
                        if (!r.exc) {
                            frappe.show_alert({message: 'Deduction logged successfully', indicator: 'green'});
                            d.hide();
                            load_topups_statement(wrapper);
                            load_dashboard_data(wrapper);
                        }
                    }
                });
            }
        });
        d.show();
    });

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

    // Fetch and render data
    load_dashboard_data(wrapper);
    load_pnl_data(wrapper);
    load_hr_data(wrapper);
    load_analytics_data(wrapper);
    load_topups_statement(wrapper);

    
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
        fetch_inventory_report($(wrapper));
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
    return {
        from_date: $(wrapper).find('#exec-global-from').val(),
        to_date: $(wrapper).find('#exec-global-to').val()
    };
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
                let tanks = data.inventory.tank_levels;
                let tanks_html = "";
                tanks.forEach(t => {
                    tanks_html += `
                        <div style="background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #e2e8f0; width:150px;">
                            <div style="font-size:11px; font-weight:700; color:#64748b;">${t.tank_name}</div>
                            <div style="font-size:18px; font-weight:600; color:#0f172a; margin:4px 0;">${t.current_volume} L</div>
                            <div style="height:4px; background:#e2e8f0; border-radius:4px; margin-top:8px;">
                                <div style="height:100%; width:${t.percentage}%; background:${t.percentage < 20 ? '#dc2626' : '#059669'}; border-radius:4px;"></div>
                            </div>
                            <div style="font-size:10px; color:#64748b; margin-top:4px; text-align:right;">${t.percentage}%</div>
                        </div>
                    `;
                });
                if(tanks_html) {
                    $(wrapper).find('#exec-tank-levels').html(tanks_html);
                }
            }
        }
    });
}

function load_pnl_data(wrapper) {
    let filters = get_date_filters(wrapper);
    frappe.call({
        method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_pnl_summary",
        args: filters,
        callback: function(r) {
            if(r.message && !r.message.error) {
                let pnl = r.message;
                $(wrapper).find('#exec-pnl-period').text("Period: " + pnl.period);
                $(wrapper).find('#exec-pnl-income').text(format_currency(pnl.total_income, "KES"));
                $(wrapper).find('#exec-pnl-expense').text(format_currency(pnl.total_expense, "KES"));
                $(wrapper).find('#exec-pnl-profit').text(format_currency(pnl.net_profit, "KES"));
                if(pnl.net_profit < 0) {
                    $(wrapper).find('#exec-pnl-profit').css('color', '#dc2626');
                }

                // Render Income Table
                let income_html = `<table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">`;
                income_html += `<tr style="border-bottom:1px solid #e2e8f0; color:#64748b;">
                                    <th style="padding:8px;">Account</th>
                                    <th style="padding:8px; text-align:right;">Amount (KES)</th>
                                </tr>`;
                if(pnl.income_accounts.length === 0) {
                    income_html += `<tr><td colspan="2" style="padding:12px; text-align:center; color:#94a3b8;">No income data found.</td></tr>`;
                } else {
                    pnl.income_accounts.forEach(a => {
                        income_html += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:10px 8px; color:#334155;">${a.account_name}</td>
                            <td style="padding:10px 8px; text-align:right; font-weight:600; color:#059669;">${format_currency(a.balance, "")}</td>
                        </tr>`;
                    });
                }
                income_html += `</table>`;
                $(wrapper).find('#exec-pnl-income-table').html(income_html);

                // Render Expense Table
                let expense_html = `<table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">`;
                expense_html += `<tr style="border-bottom:1px solid #e2e8f0; color:#64748b;">
                                    <th style="padding:8px;">Account</th>
                                    <th style="padding:8px; text-align:right;">Amount (KES)</th>
                                </tr>`;
                if(pnl.expense_accounts.length === 0) {
                    expense_html += `<tr><td colspan="2" style="padding:12px; text-align:center; color:#94a3b8;">No expense data found.</td></tr>`;
                } else {
                    pnl.expense_accounts.forEach(a => {
                        expense_html += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:10px 8px; color:#334155;">${a.account_name}</td>
                            <td style="padding:10px 8px; text-align:right; font-weight:600; color:#dc2626;">${format_currency(a.balance, "")}</td>
                        </tr>`;
                    });
                }
                expense_html += `</table>`;
                $(wrapper).find('#exec-pnl-expense-table').html(expense_html);
            } else {
                $(wrapper).find('#exec-pnl-period').text("Error loading accounting data.");
                $(wrapper).find('#exec-pnl-income-table').html("<div style='color:#dc2626; font-size:13px;'>Error connecting to GL Entry.</div>");
                $(wrapper).find('#exec-pnl-expense-table').html("<div style='color:#dc2626; font-size:13px;'>Error connecting to GL Entry.</div>");
            }
        }
    });
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
                $(wrapper).find('#exec-fuel-total-liters').text(format_currency(data.fuel.total_liters, '').trim() + ' L');
                $(wrapper).find('#exec-fuel-total-revenue').text(format_currency(data.fuel.total_revenue, 'KES'));

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
                
                Object.values(data.fuel.summary || {}).forEach(fs => {
                    let dotColor = prodColors[fs.item_code.toUpperCase()] || '#6366f1';
                    fuelHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:10px 8px; font-weight:700; color:#0f172a;">
                            <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${dotColor}; margin-right:6px;"></span>
                            ${fs.item_code}
                        </td>
                        <td style="padding:10px 8px; text-align:right; font-family: monospace;">${(fs.day_liters || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td style="padding:10px 8px; text-align:right; font-family: monospace;">${(fs.night_liters || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td style="padding:10px 8px; text-align:right; font-weight:700; color:#0f172a; font-family: monospace;">${(fs.total_liters || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td style="padding:10px 8px; text-align:right; color:#059669; font-weight:700; font-family: monospace;">${format_currency(fs.revenue, 'KES')}</td>
                    </tr>`;
                });
                fuelHtml += `</tbody></table>`;
                $(wrapper).find('#exec-fuel-table').html(fuelHtml);

                // 2. Render Lubes (in Litres)
                $(wrapper).find('#exec-lubes-total-badge').text((data.lubes.total_liters || 0).toLocaleString(undefined, {minimumFractionDigits: 1}) + ' L');
                $(wrapper).find('#exec-lubes-chart').empty();
                if (data.lubes.timeline_liters && data.lubes.timeline_liters.some(v => v > 0)) {
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
                if (!data.lubes.items || data.lubes.items.length === 0) {
                    lubesHtml += `<tr><td colspan="5" style="padding:16px; text-align:center; color:#94a3b8;">No lubes sales recorded.</td></tr>`;
                } else {
                    data.lubes.items.forEach(item => {
                        lubesHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:6px 4px; font-weight:600; color:#1e293b;">${item.item_code}</td>
                            <td style="padding:6px 4px; text-align:right; color:#64748b; font-family: monospace;">${item.pack_size}L</td>
                            <td style="padding:6px 4px; text-align:right; font-family: monospace;">${item.qty}</td>
                            <td style="padding:6px 4px; text-align:right; font-weight:700; color:#0284c7; font-family: monospace;">${item.total_liters.toFixed(1)} L</td>
                            <td style="padding:6px 4px; text-align:right; color:#059669; font-weight:600; font-family: monospace;">${format_currency(item.revenue, '')}</td>
                        </tr>`;
                    });
                }
                lubesHtml += `</tbody></table>`;
                $(wrapper).find('#exec-analytics-lubes').html(lubesHtml);

                // 3. Render Gas (Kgs) & Cylinders
                $(wrapper).find('#exec-gas-total-badge').text((data.gas.total_kgs || 0).toLocaleString() + ' Kg');
                $(wrapper).find('#exec-cyl-total-badge').text((data.gas.total_cylinders || 0) + ' Cyl');
                $(wrapper).find('#exec-gas-chart').empty();
                if ((data.gas.timeline_kgs && data.gas.timeline_kgs.some(v => v > 0)) || (data.gas.timeline_cylinders && data.gas.timeline_cylinders.some(v => v > 0))) {
                    new frappe.Chart($(wrapper).find('#exec-gas-chart')[0], {
                        data: {
                            labels: data.date_labels,
                            datasets: [
                                { name: "Gas (Kgs)", values: data.gas.timeline_kgs, chartType: 'bar' },
                                { name: "Cylinders (Units)", values: data.gas.timeline_cylinders, chartType: 'line' }
                            ]
                        },
                        type: 'axis-mixed',
                        height: 180,
                        colors: ['#f97316', '#475569'],
                        tooltipOptions: { formatTooltipY: d => d }
                    });
                }

                let gasHtml = `<table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0; color:#64748b; font-size:10px; text-transform:uppercase;">
                            <th style="padding:6px 4px;">Product</th>
                            <th style="padding:6px 4px; text-align:right;">Type</th>
                            <th style="padding:6px 4px; text-align:right;">Units</th>
                            <th style="padding:6px 4px; text-align:right;">Weight</th>
                            <th style="padding:6px 4px; text-align:right;">Revenue</th>
                        </tr>
                    </thead>
                    <tbody>`;
                let hasGas = (data.gas.gas_items && data.gas.gas_items.length > 0) || (data.gas.cylinder_items && data.gas.cylinder_items.length > 0);
                if (!hasGas) {
                    gasHtml += `<tr><td colspan="5" style="padding:16px; text-align:center; color:#94a3b8;">No gas or cylinder sales recorded.</td></tr>`;
                } else {
                    (data.gas.gas_items || []).forEach(g => {
                        gasHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:6px 4px; font-weight:600; color:#1e293b;">${g.item_code}</td>
                            <td style="padding:6px 4px; text-align:right; color:#ea580c; font-size:10px; font-weight:600;">Gas Refill</td>
                            <td style="padding:6px 4px; text-align:right; font-family: monospace;">${g.qty}</td>
                            <td style="padding:6px 4px; text-align:right; font-weight:700; color:#ea580c; font-family: monospace;">${g.total_kg.toFixed(0)} Kg</td>
                            <td style="padding:6px 4px; text-align:right; color:#059669; font-weight:600; font-family: monospace;">${format_currency(g.revenue, '')}</td>
                        </tr>`;
                    });
                    (data.gas.cylinder_items || []).forEach(c => {
                        gasHtml += `<tr style="border-bottom:1px solid #f1f5f9; background:#fcfcfc;">
                            <td style="padding:6px 4px; font-weight:600; color:#334155;">${c.item_code}</td>
                            <td style="padding:6px 4px; text-align:right; color:#475569; font-size:10px; font-weight:600;">Cylinder</td>
                            <td style="padding:6px 4px; text-align:right; font-family: monospace;">${c.qty}</td>
                            <td style="padding:6px 4px; text-align:right; color:#64748b; font-family: monospace;">--</td>
                            <td style="padding:6px 4px; text-align:right; color:#059669; font-weight:600; font-family: monospace;">${format_currency(c.revenue, '')}</td>
                        </tr>`;
                    });
                }
                gasHtml += `</tbody></table>`;
                $(wrapper).find('#exec-analytics-gas').html(gasHtml);

                // 4. Render Filters & Accessories
                $(wrapper).find('#exec-filters-total-badge').text((data.accessories.total_qty || 0) + ' Units');
                $(wrapper).find('#exec-filters-chart').empty();
                if (data.accessories.timeline_qty && data.accessories.timeline_qty.some(v => v > 0)) {
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
                if (!data.accessories.items || data.accessories.items.length === 0) {
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
                filtersHtml += `</tbody></table>`;
                $(wrapper).find('#exec-analytics-accessories').html(filtersHtml);
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

function load_topups_statement(wrapper) {
    let filters = get_date_filters(wrapper);
    
    $(wrapper).find('#exec-topups-table tbody').html('<tr><td colspan="8" style="text-align: center; padding: 24px; color: #64748b;">Loading statement...</td></tr>');
    
    frappe.call({
        method: "fuel_management.fuel_management.page.executive_dashboard.executive_dashboard.get_topup_statement",
        args: filters,
        callback: function(r) {
            let html = '';
            let total = 0;
            
            if(r.message && r.message.length > 0) {
                r.message.forEach(row => {
                    let amount = parseFloat(row.amount) || 0;
                    let run_bal = parseFloat(row.running_balance) || 0;
                    if(!row.is_opening) total += amount;
                    
                    let link = row.is_opening ? row.entry_name : `<a href="/app/${row.entry_name.startsWith('JV-') ? 'journal-entry' : 'station-supplier-top-up'}/${row.entry_name}" style="color: #0ea5e9; font-weight: 500; text-decoration: none;">${row.entry_name}</a>`;
                    
                    let amountColor = amount < 0 ? '#ef4444' : '#10b981';
                    if(row.is_opening) amountColor = '#64748b';
                    
                    html += `<tr style="border-bottom: 1px solid #f1f5f9; ${row.is_opening ? 'background: #f8fafc; font-style: italic;' : ''}">
                        <td style="padding: 12px 16px;">${frappe.datetime.str_to_user(row.date)}</td>
                        <td style="padding: 12px 16px;">${link}</td>
                        <td style="padding: 12px 16px;">${row.station || '-'}</td>
                        <td style="padding: 12px 16px;">${row.supplier || '-'}</td>
                        <td style="padding: 12px 16px;">${row.mode || '-'}</td>
                        <td style="padding: 12px 16px;">${row.ref || '-'}</td>
                        <td style="padding: 12px 16px; text-align: right; font-family: monospace; font-weight: 600; color: ${amountColor};">${format_currency(amount, "KES")}</td>
                        <td style="padding: 12px 16px; text-align: right; font-family: monospace; font-weight: 600; color: #f59e0b;">${format_currency(run_bal, "KES")}</td>
                    </tr>`;
                });
            } else {
                html = '<tr><td colspan="8" style="text-align: center; padding: 24px; color: #64748b;">No top-ups found in this period.</td></tr>';
            }
            
            $(wrapper).find('#exec-topups-table tbody').html(html);
            $(wrapper).find('#exec-topups-total').text(format_currency(total, "KES"));
        }
    });
}
