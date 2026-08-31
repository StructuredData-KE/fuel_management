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
            
            // Remove active class from all nav items
            $(wrapper).find('.exec-nav-item').removeClass('active');
            
            // Add active class to clicked item
            $(this).addClass('active');
            
            // Hide all tab content
            $(wrapper).find('.exec-main').hide();
            
            // Show target tab content (for future use if we have multiple tabs)
            const target = $(this).data('tab');
            $(wrapper).find('#' + target).show();

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

    // Debtors sub-navigation
    $(wrapper).find('.exec-debtors-nav').on('click', function(e) {
        e.preventDefault();
        if (window.VUE_DEBTORS_VIEW) {
            window.VUE_DEBTORS_VIEW.value = $(this).attr('data-debtors-view');
            // Update button styles
            $(wrapper).find('.exec-debtors-nav').removeClass('exec-btn-primary').addClass('exec-btn');
            $(this).removeClass('exec-btn').addClass('exec-btn-primary');
        }
    });

    // Date Filter Initialization
    let today = frappe.datetime.get_today();
    let first_day = frappe.datetime.month_start();
    $(wrapper).find('#exec-global-from').val(first_day);
    $(wrapper).find('#exec-global-to').val(today);

    $(wrapper).find('#exec-global-apply').on('click', function() {
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

    // Inject Tailwind for Vue Debtors App
    if (!$('#exec-tailwind').length) {
        $('<script id="exec-tailwind" src="https://cdn.tailwindcss.com"></script>').appendTo('head');
    }

    // Initialize Debtors Vue Dashboard
    if (typeof setup_vue_debtors === 'function') {
        if (typeof Vue !== 'undefined') {
            setup_vue_debtors(wrapper);
        } else {
            var script = document.createElement('script');
            script.src = 'https://unpkg.com/vue@3/dist/vue.global.js';
            script.onload = function() {
                setup_vue_debtors(wrapper);
            };
            document.head.appendChild(script);
        }
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
                
                // 1. Render Fuel Chart
                let labels = Object.keys(data.fuel.total);
                let dayData = labels.map(l => data.fuel.day[l] ? data.fuel.day[l].liters : 0);
                let nightData = labels.map(l => data.fuel.night[l] ? data.fuel.night[l].liters : 0);
                
                let chartData = {
                    labels: labels,
                    datasets: [
                        {
                            name: "Day Shift",
                            values: dayData,
                            chartType: 'bar'
                        },
                        {
                            name: "Night Shift",
                            values: nightData,
                            chartType: 'bar'
                        }
                    ]
                };
                
                new frappe.Chart($(wrapper).find('#exec-fuel-chart')[0], {
                    data: chartData,
                    type: 'bar',
                    height: 300,
                    colors: ['#f59e0b', '#1e293b'],
                    barOptions: {
                        stacked: true
                    },
                    tooltipOptions: {
                        formatTooltipX: d => (d + '').toUpperCase(),
                        formatTooltipY: d => d + ' L'
                    }
                });

                // Render Fuel Table Summary
                let fuelHtml = `<table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">`;
                fuelHtml += `<tr style="border-bottom:1px solid #e2e8f0; color:#64748b;">
                            <th style="padding:8px;">Fuel Type</th>
                            <th style="padding:8px; text-align:right;">Day (L)</th>
                            <th style="padding:8px; text-align:right;">Night (L)</th>
                            <th style="padding:8px; text-align:right;">Total (L)</th>
                            <th style="padding:8px; text-align:right;">Revenue (KES)</th>
                        </tr>`;
                
                labels.forEach(l => {
                    let dayL = data.fuel.day[l] ? data.fuel.day[l].liters : 0;
                    let nightL = data.fuel.night[l] ? data.fuel.night[l].liters : 0;
                    let totalL = data.fuel.total[l] ? data.fuel.total[l].liters : 0;
                    let totalRev = data.fuel.total[l] ? data.fuel.total[l].revenue : 0;
                    
                    fuelHtml += `<tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:10px 8px; font-weight:600; color:#0f172a;">${l}</td>
                            <td style="padding:10px 8px; text-align:right;">${dayL.toFixed(2)}</td>
                            <td style="padding:10px 8px; text-align:right;">${nightL.toFixed(2)}</td>
                            <td style="padding:10px 8px; text-align:right; font-weight:600;">${totalL.toFixed(2)}</td>
                            <td style="padding:10px 8px; text-align:right; color:#059669; font-weight:600;">${format_currency(totalRev, "")}</td>
                        </tr>`;
                });
                fuelHtml += `</table>`;
                $(wrapper).find('#exec-fuel-table').html(fuelHtml);

                // Helper to render dry stock tables
                const renderTable = (items, selector) => {
                    if(!items || items.length === 0) {
                        $(wrapper).find(selector).html(`<div style="color:#94a3b8; font-size:12px; padding:12px;">No sales in this period.</div>`);
                        return;
                    }
                    let html = `<table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">`;
                    html += `<tr style="border-bottom:1px solid #e2e8f0; color:#64748b;">
                                <th style="padding:8px;">Item</th>
                                <th style="padding:8px; text-align:right;">Qty</th>
                                <th style="padding:8px; text-align:right;">Revenue</th>
                            </tr>`;
                    items.forEach(i => {
                        html += `<tr style="border-bottom:1px solid #f1f5f9;">
                                <td style="padding:8px; color:#1e293b; font-weight:500;">${i.item_code}</td>
                                <td style="padding:8px; text-align:right;">${i.qty}</td>
                                <td style="padding:8px; text-align:right; color:#059669; font-weight:600;">${format_currency(i.revenue, "")}</td>
                            </tr>`;
                    });
                    html += `</table>`;
                    $(wrapper).find(selector).html(html);
                };

                renderTable(data.lubes, '#exec-analytics-lubes');
                renderTable(data.gas, '#exec-analytics-gas');
                renderTable(data.accessories, '#exec-analytics-accessories');
            }
        }
    });
}

function setup_vue_debtors(wrapper) {
	console.log("Initializing Debtors Vue Dashboard...");
	// Create mount point
	$(wrapper).find("#debtors-app").html(`
		<div id="debtors-vue-root"></div>
	`);

	const { createApp, ref, computed, onMounted } = Vue;

	const app = createApp({
		template: `
			<div>
				<!-- Dashboard View -->
				<div v-if="activeView === 'dashboard'">
					<div class="max-w-7xl mx-auto p-6 flex flex-col gap-6 bg-slate-50 min-h-screen">
						
						<!-- 1. KPI Cards Grid -->
						<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
						<div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center">
							<span class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Total Receivables</span>
							<span class="text-2xl font-mono font-bold text-slate-800">{{ formatCurrency(totalReceivables) }}</span>
						</div>
						<div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center border-t-4 border-t-red-500">
							<span class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Overdue Amount</span>
							<span class="text-2xl font-mono font-bold text-red-600">{{ formatCurrency(totalOverdue) }}</span>
						</div>
						<div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center border-t-4 border-t-amber-500">
							<span class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">At Risk / Near Limit</span>
							<span class="text-2xl font-bold text-amber-500">{{ atRiskCount }} Customers</span>
						</div>
						</div>

						<!-- 2. Controls & Search -->
						<div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
						<input type="text" v-model="searchQuery" placeholder="Search Customer or Fleet ID..." class="w-full max-w-md bg-slate-50 border border-slate-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-900 focus:outline-none" />
						<label class="flex items-center gap-2 text-sm text-slate-700 font-medium">
							<input type="checkbox" v-model="showOverdueOnly" class="rounded text-blue-900 focus:ring-blue-900" /> Show Overdue Only
						</label>
						</div>

						<!-- 3. Main Data Table -->
						<div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
						<table class="w-full text-sm text-left">
							<thead class="bg-slate-100 border-b border-slate-200 text-slate-600 text-xs uppercase font-bold">
							<tr>
								<th class="px-3 py-3 md:px-6 md:py-4">Customer Name</th>
								<th class="px-3 py-3 md:px-6 md:py-4 text-right">Current Balance</th>
							</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
							<tr v-for="debtor in filteredDebtors" :key="debtor.id" class="hover:bg-slate-50 transition-colors">
								<td class="px-3 py-3 md:px-6 md:py-4 whitespace-normal break-words max-w-[200px] md:max-w-none">
								<span class="block font-bold text-slate-900">{{ debtor.name }}</span>
								<span class="block text-xs text-slate-500">Fleet ID: {{ debtor.fleet_id || 'N/A' }}</span>
								</td>
								<td class="px-3 py-3 md:px-6 md:py-4 text-right font-mono font-bold text-slate-900 whitespace-nowrap">{{ formatCurrency(debtor.balance) }}</td>
							</tr>
							<tr v-if="filteredDebtors.length === 0">
								<td colspan="2" class="px-3 py-3 text-center text-slate-500">No debtors found.</td>
							</tr>
							</tbody>
						</table>
						</div>
					</div>
				</div>

				<!-- Statement Detail View -->
				<div v-if="activeView === 'statement'">
					<div class="max-w-6xl mx-auto p-4 flex flex-col gap-4 bg-slate-50 min-h-screen">
						
						<!-- 1. Top Control Bar (Forced Single Row) -->
						<div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-row items-center justify-between w-full">
						<div class="flex items-center gap-3">
							<span class="text-xs font-bold text-slate-500 uppercase">Debtor:</span>
							<select v-model="selectedDebtorId" @change="onDebtorSelectChange" class="w-64 bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-900 focus:outline-none">
							<option v-for="d in debtors" :key="d.id" :value="d.id">{{ d.name }}</option>
							</select>
							
							<span class="text-xs font-bold text-slate-500 uppercase ml-4">From:</span>
							<input type="date" v-model="startDate" class="bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
							
							<span class="text-xs font-bold text-slate-500 uppercase ml-2">To:</span>
							<input type="date" v-model="endDate" class="bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
						</div>
						<div class="flex gap-2">
							<button @click="emailStatement" class="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-1.5 rounded-lg text-sm font-semibold shadow-sm transition-all">Email Statement</button>
							<button @click="printStatement" class="bg-blue-950 hover:bg-blue-900 text-amber-400 px-4 py-1.5 rounded-lg text-sm font-semibold shadow-sm transition-all">Export PDF</button>
						</div>
						</div>

						<!-- 2. The A4 Document Container (Tightened Padding) -->
						<div class="bg-white p-6 rounded-sm border border-slate-200 shadow-lg">
						
						<!-- Header -->
						<div class="flex justify-between items-start mb-6 pb-4 border-b border-slate-100">
							<div>
							<h1 class="text-2xl font-bold text-blue-950">Kilibet - Rubis</h1>
							<p class="text-xs text-slate-500 mt-1">Accounts Receivable Division<br>Highway Road, Eldoret</p>
							</div>
							<div class="text-right">
							<h2 class="text-xl font-bold text-slate-900 uppercase tracking-wider">Statement of Account</h2>
							<p class="text-xs text-slate-500 mt-1">Period: {{ startDate }} &mdash; {{ endDate }}</p>
							<div class="mt-3 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2 inline-block text-right">
								<span class="block text-[10px] font-bold text-blue-800 uppercase">Amount Due</span>
								<span class="block text-xl font-mono font-bold text-blue-950">{{ formatCurrency(closingBalance) }}</span>
							</div>
							</div>
						</div>

						<!-- Info Grid (Tightened Gaps & Conditional Rendering) -->
						<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
							<div class="p-4 border border-slate-200 rounded-lg bg-slate-50">
							<span class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Bill To</span>
							<h3 class="text-lg font-bold text-slate-900 mb-1">{{ selectedDebtor?.name }}</h3>
							<!-- CONDITIONAL RENDERING -->
							<div class="text-xs text-slate-600 flex flex-col gap-0.5">
								<span v-if="selectedDebtor?.address && selectedDebtor?.address !== 'N/A'">{{ selectedDebtor.address }}</span>
								<span v-if="selectedDebtor?.phone && selectedDebtor?.phone !== 'N/A'">{{ selectedDebtor.phone }}</span>
							</div>
							</div>
							
							<div class="p-4 border border-slate-200 rounded-lg">
							<span class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Account Details</span>
							<ul class="text-xs space-y-1.5">
								<li class="flex justify-between"><span class="text-slate-500">Account Number</span><span class="font-semibold text-slate-900">{{ selectedDebtor?.id || 'N/A' }}</span></li>
								<li class="flex justify-between"><span class="text-slate-500">Payment Terms</span><span class="font-semibold text-slate-900">30 days</span></li>
								<li class="flex justify-between"><span class="text-slate-500">Credit Limit</span><span class="font-mono text-slate-900">{{ formatCurrency(selectedDebtor?.credit_limit) }}</span></li>
							</ul>
							</div>
						</div>

						<!-- Ledger Table (Rebalanced Columns) -->
						<div class="overflow-x-auto">
							<table class="w-full text-xs text-left">
							<thead class="border-b-2 border-blue-950 text-slate-500 text-[10px] uppercase tracking-widest font-bold">
								<tr>
								<th class="py-2 pr-2 w-24">Date</th>
								<th class="py-2 px-2 w-32">Reference</th>
								<th class="py-2 px-2 w-2/5">Description</th>
								<th class="py-2 px-2 w-20">Type</th>
								<th class="py-2 px-2 text-right">Debit</th>
								<th class="py-2 px-2 text-right">Credit</th>
								<th class="py-2 pl-2 text-right">Balance</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								<tr class="bg-slate-50">
									<td colspan="4" class="py-2 pr-2 font-semibold text-slate-700">Opening Balance (Brought forward)</td>
									<td class="py-2 px-2 text-right font-mono text-slate-400">--</td>
									<td class="py-2 px-2 text-right font-mono text-slate-400">--</td>
									<td class="py-2 pl-2 text-right font-mono font-bold text-slate-900">{{ formatCurrency(openingBalance) }}</td>
								</tr>
								<tr v-for="(txn, index) in processedTransactions" :key="index" class="hover:bg-slate-50 transition-colors">
									<td class="py-2 pr-2 text-slate-600 whitespace-nowrap">{{ txn.date }}</td>
									<td class="py-2 px-2 text-slate-800 font-medium">{{ txn.ref_type }}</td>
									<td class="py-2 px-2 text-slate-600">{{ txn.description }}</td>
									<td class="py-2 px-2">
									<span class="bg-blue-50 text-blue-700 text-[9px] font-bold px-1.5 py-0.5 rounded border border-blue-100 uppercase">{{ txn.type || 'Transaction' }}</span>
									</td>
									<td class="py-2 px-2 text-right font-mono text-slate-800">{{ txn.debit ? formatCurrency(txn.debit) : '--' }}</td>
									<td class="py-2 px-2 text-right font-mono text-slate-400">{{ txn.credit ? formatCurrency(txn.credit) : '--' }}</td>
									<td class="py-2 pl-2 text-right font-mono font-bold text-slate-900">{{ formatCurrency(txn.running_balance) }}</td>
								</tr>
								<tr v-if="processedTransactions.length === 0">
									<td colspan="7" class="py-4 text-center text-slate-500 text-sm">No transactions in this period.</td>
								</tr>
							</tbody>
							</table>
						</div>
						</div>
					</div>
				</div>
			</div>
		`,
		setup() {
			const activeView = ref('dashboard');
			window.VUE_DEBTORS_VIEW = activeView;
			const searchQuery = ref('');
			const showOverdueOnly = ref(false);
			const selectedDebtor = ref(null);
			const selectedDebtorId = ref('');
			
			const onDebtorSelectChange = () => {
				const found = debtors.value.find(d => d.id === selectedDebtorId.value);
				if (found) {
					selectedDebtor.value = found;
					fetch_transactions(found.id);
				}
			};
			const startDate = ref('2026-08-01');
			const endDate = ref('2026-08-31');
			const isLoading = ref(true);

			const debtors = ref([]);
			const allTransactions = ref([]);

			const fetchDebtors = () => {
				isLoading.value = true;
				frappe.call({
					method: 'fuel_management.fuel_management.page.shift_operation_spa.shift_operation_spa.get_debtors_data',
					callback: function(r) {
						if(r.message) {
							let rawDebtors = r.message || [];
							debtors.value = rawDebtors.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
						}
						isLoading.value = false;
					}
				});
			};

			onMounted(() => {
				fetchDebtors();
			});

			// Computed properties for Dashboard
			const filteredDebtors = computed(() => {
				return debtors.value.filter(d => {
					const matchSearch = d.name.toLowerCase().includes(searchQuery.value.toLowerCase()) || 
										(d.fleet_id && d.fleet_id.toLowerCase().includes(searchQuery.value.toLowerCase()));
					const matchOverdue = showOverdueOnly.value ? d.status === 'Overdue' : true;
					return matchSearch && matchOverdue;
				});
			});

			const totalReceivables = computed(() => {
				return debtors.value.reduce((sum, d) => sum + d.balance, 0);
			});

			const totalOverdue = computed(() => {
				return debtors.value.filter(d => d.status === 'Overdue').reduce((sum, d) => sum + d.balance, 0);
			});

			const atRiskCount = computed(() => {
				return debtors.value.filter(d => d.status === 'Near Limit').length;
			});

			// Computed properties for Statement View
			const customerTransactions = ref([]);
			
			const fetch_transactions = (customer_id) => {
				isLoading.value = true;
				frappe.call({
					method: 'fuel_management.fuel_management.page.shift_operation_spa.shift_operation_spa.get_customer_transactions',
					args: { customer: customer_id },
					callback: function(r) {
						if(r.message) {
							customerTransactions.value = r.message;
						}
						isLoading.value = false;
					}
				});
			};

			const openingBalance = computed(() => {
				let bal = 0;
				for (let t of customerTransactions.value) {
					if (new Date(t.date) < new Date(startDate.value)) {
						bal += (t.debit || 0) - (t.credit || 0);
					}
				}
				return bal;
			});

			const processedTransactions = computed(() => {
				let currentBalance = openingBalance.value;
				let result = [];
				for (let t of customerTransactions.value) {
					if (new Date(t.date) >= new Date(startDate.value) && new Date(t.date) <= new Date(endDate.value)) {
						currentBalance += (t.debit || 0) - (t.credit || 0);
						result.push({
							...t,
							running_balance: currentBalance
						});
					}
				}
				return result;
			});

			const periodDebits = computed(() => {
				return processedTransactions.value.reduce((sum, t) => sum + (t.debit || 0), 0);
			});

			const periodCredits = computed(() => {
				return processedTransactions.value.reduce((sum, t) => sum + (t.credit || 0), 0);
			});

			const closingBalance = computed(() => {
				return openingBalance.value + periodDebits.value - periodCredits.value;
			});

			// Methods
			const formatCurrency = (val) => {
				if (val === null || val === undefined) return '';
				return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(val);
			};

			const getStatusColor = (status) => {
				if (status === 'Overdue') return 'red';
				if (status === 'Near Limit') return 'orange';
				return 'green';
			};

			const getStatusTailwindClass = (status) => {
				if (status === 'Overdue') return 'bg-red-100 text-red-800';
				if (status === 'Near Limit') return 'bg-amber-100 text-amber-800';
				return 'bg-emerald-100 text-emerald-800';
			};

			const openStatement = (debtor) => {
				selectedDebtor.value = debtor;
				selectedDebtorId.value = debtor.id;
				activeView.value = 'statement';
				fetch_transactions(debtor.id);
			};

			const printStatement = () => {
				frappe.msgprint("Opening print view (mocked)");
			};

			const emailStatement = () => {
				frappe.msgprint(`Emailing statement to ${selectedDebtor.value?.name || 'Customer'}`);
			};

			return {
				activeView, searchQuery, showOverdueOnly, selectedDebtor, selectedDebtorId, onDebtorSelectChange, startDate, endDate, isLoading,
				debtors, filteredDebtors, totalReceivables, totalOverdue, atRiskCount,
				openingBalance, processedTransactions, periodDebits, periodCredits, closingBalance,
				formatCurrency, getStatusColor, getStatusTailwindClass, openStatement, printStatement, emailStatement
			};
		}
	});

	app.mount('#debtors-vue-root');
}





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
