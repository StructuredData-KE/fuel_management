import frappe
from frappe import _

@frappe.whitelist()
def get_csa_reconciliation_data(shift_id, csa_id):
    if not shift_id or not csa_id:
        frappe.throw(_("Shift ID and CSA ID are required"))
        
    data = {
        "meter_sales": 0.0,
        "meter_sales_breakdown": [],
        "inventory_sales": 0.0,
        "greasing_sales": 0.0,
        "customer_payments": 0.0,
        "mpesa": 0.0,
        "invoices": 0.0,
        "cards": 0.0,
        "expenses": 0.0,
        "rtt_deductions": 0.0
    }
    
    # 1. Meter Sales
    # Find Pump Groups assigned to this CSA in the current Shift
    assigned_groups = frappe.get_all(
        "Shift Assigned CSA",
        filters={"parent": shift_id, "parenttype": "Shift", "csa": csa_id},
        pluck="pump_group"
    )
    
    if assigned_groups:
        # Find all Nozzles belonging to these Pump Groups
        nozzles = frappe.get_all(
            "Pump Nozzle",
            filters={"pump_group": ["in", assigned_groups]},
            fields=["name", "fuel_tank", "pump_group"]
        )
        
        nozzle_tanks = {n.name: n.fuel_tank for n in nozzles}
        nozzle_groups = {n.name: n.pump_group for n in nozzles}
        nozzle_names = list(nozzle_tanks.keys())
        
        if nozzle_names:
            # Find Meter Readings for these nozzles in this shift
            readings = frappe.get_all(
                "Pump Meter Reading",
                filters={"parent": shift_id, "parenttype": "Shift", "pump_nozzle": ["in", nozzle_names]},
                fields=["pump_nozzle", "sales_quantity_electronic", "sales_quantity_manual"]
            )
            
            # Aggregate Meter Sales and fetch prices
            tank_items = {} # Cache for tank -> item mapping
            item_prices = {} # Cache for item -> standard_rate mapping
            group_totals = {}
            
            for r in readings:
                qty = (r.sales_quantity_electronic or 0.0)
                if qty <= 0: continue
                
                tank = nozzle_tanks.get(r.pump_nozzle)
                if not tank: continue
                
                if tank not in tank_items:
                    tank_items[tank] = frappe.db.get_value("Fuel Tank", tank, "fuel_product")
                    
                item = tank_items[tank]
                if not item: continue
                
                if item not in item_prices:
                    price = frappe.db.get_value("Item Price", {"item_code": item, "price_list": "Standard Selling"}, "price_list_rate")
                    if not price:
                        price = frappe.db.get_value("Item", item, "standard_rate") or 0.0
                    item_prices[item] = price
                    
                amount = qty * item_prices[item]
                data["meter_sales"] += amount
                
                grp = nozzle_groups.get(r.pump_nozzle, "Unknown")
                if grp not in group_totals:
                    group_totals[grp] = {"amount": 0.0, "petrol_liters": 0.0, "diesel_liters": 0.0}
                
                group_totals[grp]["amount"] += amount
                
                item_upper = (item or "").upper()
                is_pms = "PMS" in item_upper or "PETROL" in item_upper or "SUPER" in item_upper
                is_ago = "AGO" in item_upper or "DIESEL" in item_upper
                
                if not is_pms and not is_ago:
                    noz_upper = (r.pump_nozzle or "").upper()
                    if "AGO" in noz_upper or "DIESEL" in noz_upper: is_ago = True
                    if "PMS" in noz_upper or "SUPER" in noz_upper: is_pms = True
                
                if is_pms:
                    group_totals[grp]["petrol_liters"] += qty
                elif is_ago:
                    group_totals[grp]["diesel_liters"] += qty
                
            data["meter_sales_breakdown"] = [
                {
                    "pump_group": g, 
                    "amount": v["amount"], 
                    "petrol_liters": v["petrol_liters"], 
                    "diesel_liters": v["diesel_liters"]
                } 
                for g, v in group_totals.items()
            ]
                
            # 9. RTT Deductions
            # RTT is also tied to Nozzles
            rtts = frappe.get_all(
                "Shift Return To Tank",
                filters={"parent": shift_id, "parenttype": "Shift", "pump_nozzle": ["in", nozzle_names]},
                fields=["pump_nozzle", "quantity"]
            )
            
            for r in rtts:
                qty = r.quantity or 0.0
                if qty <= 0: continue
                
                tank = nozzle_tanks.get(r.pump_nozzle)
                if not tank: continue
                
                if tank not in tank_items:
                    tank_items[tank] = frappe.db.get_value("Fuel Tank", tank, "fuel_product")
                    
                item = tank_items[tank]
                if not item: continue
                
                if item not in item_prices:
                    price = frappe.db.get_value("Item Price", {"item_code": item, "price_list": "Standard Selling"}, "price_list_rate")
                    if not price:
                        price = frappe.db.get_value("Item", item, "standard_rate") or 0.0
                    item_prices[item] = price
                    
                data["rtt_deductions"] += qty * item_prices[item]
                
    # 2. Inventory Sales
    is_lubes_assigned = assigned_groups and "Lubes & Accessories" in assigned_groups
    
    if is_lubes_assigned:
        inventory_data = frappe.db.sql("""
            SELECT item, quantity, amount 
            FROM `tabShift Inventory Sale` 
            WHERE parent=%s AND parenttype='Shift' 
            AND (
                (sold_by=%s)
                OR (is_invoice_sale=0)
            )
        """, (shift_id, csa_id), as_dict=True)
    else:
        inventory_data = frappe.db.sql("""
            SELECT item, quantity, amount 
            FROM `tabShift Inventory Sale` 
            WHERE parent=%s AND parenttype='Shift' 
            AND sold_by=%s AND (is_invoice_sale IS NULL OR is_invoice_sale=1)
        """, (shift_id, csa_id), as_dict=True)

    data["inventory_breakdown"] = inventory_data or []
    data["inventory_sales"] = sum([d.amount for d in inventory_data]) if inventory_data else 0.0
    
    # 3. Greasing Sales
    greasing_data = frappe.db.sql("""
        SELECT vehicle_type, total_amount as amount 
        FROM `tabShift Greasing Sale` 
        WHERE parent=%s AND parenttype='Shift' AND csa=%s
    """, (shift_id, csa_id), as_dict=True)
    data["greasing_breakdown"] = greasing_data or []
    data["greasing_sales"] = sum([d.amount for d in greasing_data]) if greasing_data else 0.0
    
    # 4. Customer Payments
    cp_data = frappe.db.sql("""
        SELECT name, customer, amount 
        FROM `tabCustomer Payment` 
        WHERE shift=%s AND csa=%s AND docstatus=1
    """, (shift_id, csa_id), as_dict=True)
    
    if not cp_data:
        cp_data = frappe.db.sql("""
            SELECT name, customer, amount 
            FROM `tabCustomer Payment` 
            WHERE shift=%s AND csa=%s
        """, (shift_id, csa_id), as_dict=True)
        
    data["customer_payments_breakdown"] = cp_data or []
    data["customer_payments"] = sum([d.amount for d in cp_data]) if cp_data else 0.0
        
    # 5. M-Pesa
    mpesa_data = frappe.db.sql("""
        SELECT 
            sp.mpesa_till, 
            sp.amount 
        FROM `tabShift M-Pesa Payment` sp
        WHERE sp.parent=%s AND sp.parenttype='Shift' 
        AND sp.mpesa_till IN (
            SELECT tpg.parent 
            FROM `tabM-Pesa Till Pump Group` tpg
            WHERE tpg.parenttype = 'M-Pesa Till'
            AND tpg.pump_group IN (
                SELECT sc.pump_group
                FROM `tabShift Assigned CSA` sc
                WHERE sc.parent=%s AND sc.parenttype='Shift' AND sc.csa=%s
            )
        )
    """, (shift_id, shift_id, csa_id), as_dict=True)
    data["mpesa_breakdown"] = mpesa_data or []
    data["mpesa"] = sum([d.amount for d in mpesa_data]) if mpesa_data else 0.0
    
    # 6. Invoices
    invoices_data = frappe.db.sql("""
        SELECT item, quantity, entry_number, amount 
        FROM `tabShift Invoice` 
        WHERE parent=%s AND parenttype='Shift' AND csa=%s
    """, (shift_id, csa_id), as_dict=True)
    data["invoices_breakdown"] = invoices_data or []
    data["invoices"] = sum([d.amount for d in invoices_data]) if invoices_data else 0.0
    
    # 7. Cards
    cards_data = frappe.db.sql("""
        SELECT card as card_type, receipt_no, amount 
        FROM `tabStation Cards` 
        WHERE shift=%s AND csa=%s
    """, (shift_id, csa_id), as_dict=True)
    data["cards_breakdown"] = cards_data or []
    data["cards"] = sum([d.amount for d in cards_data]) if cards_data else 0.0
    
    # 8. Expenses
    expenses_data = frappe.db.sql("""
        SELECT name, category, amount 
        FROM `tabStation Expense` 
        WHERE shift=%s AND csa=%s
    """, (shift_id, csa_id), as_dict=True)
    
    data["expenses_breakdown"] = expenses_data or []
    data["expenses"] = sum([d.amount for d in expenses_data]) if expenses_data else 0.0
    
    return data

@frappe.whitelist()
def email_shift_report(shift_name):
    try:
        shift_doc = frappe.get_doc("Shift", shift_name)
        owner_email = frappe.db.get_value("Fuel Station", shift_doc.station, "owner_email")
        
        if not owner_email:
            return {"status": "error", "message": f"No Owner Email configured for Fuel Station {shift_doc.station}."}
            
        # Parse multiple emails if separated by comma or semicolon
        recipients = [e.strip() for e in owner_email.replace(';', ',').split(',')]
            
        # Generate the PDF of the Shift End Report
        pdf = frappe.get_print("Shift", shift_name, "End of Shift Report", as_pdf=True)
        
        # Send the email
        frappe.sendmail(
            recipients=recipients,
            subject=f"End of Shift Report - {shift_name}",
            message=f"Please find attached the End of Shift Report for Shift {shift_name}.",
            attachments=[{
                "fname": f"Shift_Report_{shift_name}.pdf",
                "fcontent": pdf
            }]
        )
        return {"status": "success", "message": f"Report successfully emailed to {owner_email}"}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), f"Failed to email shift report for {shift_name}")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def get_expected_dips(shift_id):
    if not shift_id:
        return {}
        
    shift = frappe.get_doc("Shift", shift_id)
    shift.calculate_expected_stock()
    
    expected = {}
    for row in (shift.dip_stick_readings or []):
        expected[row.fuel_tank] = row.expected_stock
        
    return expected



@frappe.whitelist()
def setup_accounts():
    company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
    if not company:
        return "No default company found"
        
    def get_root_account(root_type):
        return frappe.db.get_value("Account", {"company": company, "root_type": root_type, "is_group": 1, "parent_account": ("is", "not set")})
        
    asset_root = get_root_account("Asset")
    income_root = get_root_account("Income")
    
    current_assets = frappe.db.get_value("Account", {"company": company, "account_name": "Current Assets", "is_group": 1})
    if not current_assets: current_assets = asset_root
    
    cash_in_hand = frappe.db.get_value("Account", {"company": company, "account_name": "Cash In Hand", "is_group": 1})
    if not cash_in_hand: cash_in_hand = current_assets
    
    direct_income = frappe.db.get_value("Account", {"company": company, "account_name": "Direct Income", "is_group": 1})
    if not direct_income: direct_income = income_root

    accounts_to_create = [
        {"account_name": "Shift Control Account", "parent_account": current_assets, "account_type": "Current Asset", "is_group": 0},
        {"account_name": "Shift Main Cash", "parent_account": cash_in_hand, "account_type": "Cash", "is_group": 0},
        {"account_name": "Fuel Sales Revenue", "parent_account": direct_income, "account_type": "Income Account", "is_group": 0},
        {"account_name": "Dry Stock Sales Revenue", "parent_account": direct_income, "account_type": "Income Account", "is_group": 0},
        {"account_name": "Greasing Sales Revenue", "parent_account": direct_income, "account_type": "Income Account", "is_group": 0},
        {"account_name": "CSA Shortfalls (Staff Liability)", "parent_account": current_assets, "account_type": "Receivable", "is_group": 0},
        {"account_name": "Shift Overages", "parent_account": direct_income, "account_type": "Income Account", "is_group": 0},
    ]
    
    created = []
    
    for acc in accounts_to_create:
        acc_id = f"{acc['account_name']} - {frappe.get_cached_value('Company', company, 'abbr')}"
        if not frappe.db.exists("Account", acc_id):
            doc = frappe.new_doc("Account")
            doc.account_name = acc["account_name"]
            doc.parent_account = acc["parent_account"]
            doc.company = company
            doc.account_type = acc["account_type"]
            doc.is_group = acc["is_group"]
            doc.insert(ignore_permissions=True)
            created.append(doc.name)
            
    # Now map them to Fuel Station
    stations = frappe.get_all("Fuel Station")
    mapped = 0
    for s in stations:
        station = frappe.get_doc("Fuel Station", s.name)
        abbr = frappe.get_cached_value('Company', company, 'abbr')
        station.shift_control_account = f"Shift Control Account - {abbr}"
        station.cash_account = f"Shift Main Cash - {abbr}"
        station.fuel_sales_account = f"Fuel Sales Revenue - {abbr}"
        station.dry_stock_sales_account = f"Dry Stock Sales Revenue - {abbr}"
        station.greasing_sales_account = f"Greasing Sales Revenue - {abbr}"
        station.shortfall_account = f"CSA Shortfalls (Staff Liability) - {abbr}"
        station.overage_account = f"Shift Overages - {abbr}"
        station.save(ignore_permissions=True)
        mapped += 1
        
    frappe.db.commit()
    return f"Created accounts: {created}. Mapped to {mapped} Fuel Stations."

@frappe.whitelist()
def get_station_inventory(station_id):
    if not station_id:
        frappe.throw("Station ID is required")
        
    station = frappe.get_doc("Fuel Station", station_id)
    warehouses = []
    if station.default_forecourt_warehouse:
        warehouses.append(station.default_forecourt_warehouse)
    if station.default_store_warehouse:
        warehouses.append(station.default_store_warehouse)
        
    if not warehouses:
        return []
        
    # Get all bins for these warehouses
    bins = frappe.get_all("Bin", 
        filters={"warehouse": ["in", warehouses]},
        fields=["item_code", "warehouse", "actual_qty"],
        order_by="item_code asc"
    )
    
    # Enrich with item name
    for b in bins:
        b.item_name = frappe.db.get_value("Item", b.item_code, "item_name") or b.item_code
        b.item_group = frappe.db.get_value("Item", b.item_code, "item_group")
        
    return bins

@frappe.whitelist()
def update_pf():
    html = """<div style="font-family: sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; border: 1px solid #ddd;">
    <div style="text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px;">
        <h2>Consolidated CSA Cash Sign-Off</h2>
        <h4>Shift: {{ doc.get_formatted("shift_date") }} ({{ doc.shift_template }})</h4>
        <p>Station: {{ doc.station }}</p>
    </div>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 40px;">
        <thead>
            <tr style="background-color: #f3f4f6;">
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">CSA Name</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Pump Group</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">Expected Cash</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">Actual Cash</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">Variance</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: center; width: 25%;">CSA Signature</th>
            </tr>
        </thead>
        <tbody>
            {% set recons = frappe.get_all("Shift Cash Reconciliation", filters={"shift": doc.name}, fields=["csa", "expected_cash", "actual_cash", "variance"], order_by="creation asc") %}
            {% if recons %}
                {% for r in recons %}
                {% set pg = "" %}
                {% for ac in doc.assigned_csas %}
                    {% if ac.csa == r.csa %}
                        {% set pg = ac.pump_group %}
                    {% endif %}
                {% endfor %}
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd;"><b>{{ frappe.db.get_value("Employee", r.csa, "employee_name") or r.csa }}</b></td>
                    <td style="padding: 10px; border: 1px solid #ddd;">{{ pg or '' }}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">{{ "{:,.2f}".format(r.expected_cash) }}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">{{ "{:,.2f}".format(r.actual_cash) }}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: right; font-weight: bold; color: {% if r.variance < 0 %}#dc2626{% else %}#16a34a{% endif %};">{{ "{:,.2f}".format(r.variance) }}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">________________________</td>
                </tr>
                {% endfor %}
            {% else %}
                <tr><td colspan="6" style="padding: 10px; border: 1px solid #ddd; text-align: center;">No CSA Reconciliations found for this shift.</td></tr>
            {% endif %}
        </tbody>
    </table>
    
    <div style="margin-top: 60px; display: flex; justify-content: space-between;">
        <div style="width: 45%; border-top: 1px solid #333; padding-top: 10px; text-align: center;">
            <p style="margin: 0;"><b>Manager Signature</b></p>
            <p style="margin: 5px 0 0 0; font-size: 0.9em; color: #666;">Date: ________________</p>
        </div>
    </div>
</div>"""
    
    if frappe.db.exists("Print Format", "Consolidated CSA Sign-Off"):
        pf = frappe.get_doc("Print Format", "Consolidated CSA Sign-Off")
        pf.html = html
        pf.save(ignore_permissions=True)
        frappe.db.commit()

@frappe.whitelist()
def update_pf2():
    html = """<div style="font-family: sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; border: 1px solid #ddd;">
    <div style="text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px;">
        <h2>Consolidated CSA Cash Sign-Off</h2>
        <h4>Shift: {{ doc.get_formatted("shift_date") }} ({{ doc.shift_template }})</h4>
        <p>Station: {{ doc.station }}</p>
    </div>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 40px;">
        <thead>
            <tr style="background-color: #f3f4f6;">
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">CSA Name</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Pump Group</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">Expected Cash</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">Actual Cash</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">Variance</th>
                <th style="padding: 10px; border: 1px solid #ddd; text-align: center; width: 25%;">CSA Signature</th>
            </tr>
        </thead>
        <tbody>
            {% set recons = frappe.get_all("Shift Cash Reconciliation", filters={"shift": doc.name}, fields=["csa", "expected_cash", "actual_cash", "variance"], order_by="creation asc") %}
            {% if recons %}
                {% for r in recons %}
                {% set pg = namespace(value="") %}
                {% for ac in doc.assigned_csas %}
                    {% if ac.csa == r.csa %}
                        {% set pg.value = ac.pump_group %}
                    {% endif %}
                {% endfor %}
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd;"><b>{{ frappe.db.get_value("Employee", r.csa, "employee_name") or r.csa }}</b></td>
                    <td style="padding: 10px; border: 1px solid #ddd;">{{ pg.value or '' }}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">{{ "{:,.2f}".format(r.expected_cash) }}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">{{ "{:,.2f}".format(r.actual_cash) }}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: right; font-weight: bold; color: {% if r.variance < 0 %}#dc2626{% else %}#16a34a{% endif %};">{{ "{:,.2f}".format(r.variance) }}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">________________________</td>
                </tr>
                {% endfor %}
            {% else %}
                <tr><td colspan="6" style="padding: 10px; border: 1px solid #ddd; text-align: center;">No CSA Reconciliations found for this shift.</td></tr>
            {% endif %}
        </tbody>
    </table>
    
    <div style="margin-top: 60px; display: flex; justify-content: space-between;">
        <div style="width: 45%; border-top: 1px solid #333; padding-top: 10px; text-align: center;">
            <p style="margin: 0;"><b>Manager Signature</b></p>
            <p style="margin: 5px 0 0 0; font-size: 0.9em; color: #666;">Date: ________________</p>
        </div>
    </div>
</div>"""
    
    if frappe.db.exists("Print Format", "Consolidated CSA Sign-Off"):
        pf = frappe.get_doc("Print Format", "Consolidated CSA Sign-Off")
        pf.html = html
        pf.save(ignore_permissions=True)
        frappe.db.commit()

@frappe.whitelist()
def create_spa_stock_transfer(station_id, item_code, qty, direction="Store to Forecourt"):
    if not station_id or not item_code or not qty:
        frappe.throw("Station ID, Item, and Quantity are required")
        
    try:
        qty = float(qty)
        if qty <= 0:
            frappe.throw("Quantity must be greater than 0")
    except ValueError:
        frappe.throw("Invalid quantity")
        
    station = frappe.get_doc("Fuel Station", station_id)
    
    if not station.default_store_warehouse or not station.default_forecourt_warehouse:
        frappe.throw("Station must have both Default Store Warehouse and Default Forecourt Warehouse set.")
        
    se = frappe.new_doc("Stock Entry")
    se.stock_entry_type = "Material Transfer"
    se.company = station.company if hasattr(station, 'company') and station.company else frappe.defaults.get_user_default("Company")
    if direction == "Forecourt to Store":
        se.from_warehouse = station.default_forecourt_warehouse
        se.to_warehouse = station.default_store_warehouse
    else:
        se.from_warehouse = station.default_store_warehouse
        se.to_warehouse = station.default_forecourt_warehouse
    
    se.append("items", {
        "item_code": item_code,
        "qty": qty,
        "uom": frappe.db.get_value("Item", item_code, "stock_uom"),
        "s_warehouse": se.from_warehouse,
        "t_warehouse": se.to_warehouse
    })
    
    se.insert()
    se.submit()
    
    return {"status": "success", "message": f"Successfully transferred {qty} of {item_code} ({direction}).", "name": se.name}

@frappe.whitelist()
def get_inventory_status_report(station_id, from_date, to_date):
    if not station_id or not from_date or not to_date:
        frappe.throw("Station ID, From Date, and To Date are required")
        
    station = frappe.get_doc("Fuel Station", station_id)
    warehouses = []
    if station.default_forecourt_warehouse:
        warehouses.append(station.default_forecourt_warehouse)
    if station.default_store_warehouse:
        warehouses.append(station.default_store_warehouse)
        
    s_warehouse = station.default_store_warehouse
    f_warehouse = station.default_forecourt_warehouse
    
    if not s_warehouse or not f_warehouse:
        frappe.throw("Station must have both Default Store Warehouse and Default Forecourt Warehouse set.")
        
    company = station.company if hasattr(station, 'company') and station.company else frappe.defaults.get_user_default("Company")
    company_name = frappe.db.get_value("Company", company, "company_name") or company

    sles = frappe.get_all("Stock Ledger Entry",
        filters={"warehouse": ["in", warehouses], "is_cancelled": 0},
        fields=["item_code", "warehouse", "actual_qty", "posting_date", "voucher_type", "voucher_no"]
    )
    
    data = {}
    for sle in sles:
        item = sle.item_code
        if item not in data:
            data[item] = {
                "item_code": item,
                "item_name": frappe.db.get_value("Item", item, "item_name") or item,
                "item_group": frappe.db.get_value("Item", item, "item_group"),
                "op_store": 0,
                "op_forecourt": 0,
                "purchases": 0,
                "sales": 0,
                "vouchers": {}
            }
        
        pdate = str(sle.posting_date)
        
        # Opening
        if pdate < from_date:
            if sle.warehouse == s_warehouse:
                data[item]["op_store"] += sle.actual_qty
            elif sle.warehouse == f_warehouse:
                data[item]["op_forecourt"] += sle.actual_qty
        
        # Transactions
        if from_date <= pdate <= to_date:
            vid = sle.voucher_type + "|" + sle.voucher_no
            if vid not in data[item]["vouchers"]:
                data[item]["vouchers"][vid] = 0
            data[item]["vouchers"][vid] += sle.actual_qty
            
    # Process transactions & recalculate closing properly from ALL SLEs <= to_date
    for sle in sles:
        pdate = str(sle.posting_date)
        if pdate <= to_date:
            item = sle.item_code
            if "cl_store" not in data[item]:
                data[item]["cl_store"] = 0
                data[item]["cl_forecourt"] = 0
            if sle.warehouse == s_warehouse:
                data[item]["cl_store"] += sle.actual_qty
            elif sle.warehouse == f_warehouse:
                data[item]["cl_forecourt"] += sle.actual_qty

    for item, row in data.items():
        if "vouchers" in row:
            for vid, qty in row["vouchers"].items():
                if qty > 0:
                    row["purchases"] += qty
                elif qty < 0:
                    row["sales"] += abs(qty)
            del row["vouchers"]
            
        row["op_total"] = row["op_store"] + row["op_forecourt"]
        
        if "cl_store" not in row:
            row["cl_store"] = 0
        if "cl_forecourt" not in row:
            row["cl_forecourt"] = 0
            
        row["cl_total"] = row["cl_store"] + row["cl_forecourt"]
            
    # Group by item group
    grouped = {}
    for item, row in data.items():
        ig = row["item_group"] or "Other"
        if ig not in grouped:
            grouped[ig] = []
        grouped[ig].append(row)
        
    return {"company": company_name, "data": grouped}

def create_borrowed_doctypes():
    import frappe
    # 1. Borrowed Product Item (Child Table)
    if not frappe.db.exists("DocType", "Borrowed Product Item"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Borrowed Product Item",
            "module": "Fuel Management",
            "custom": 1,
            "istable": 1,
            "fields": [
                {"fieldname": "item_code", "label": "Item Code", "fieldtype": "Link", "options": "Item", "in_list_view": 1, "reqd": 1},
                {"fieldname": "qty", "label": "Quantity", "fieldtype": "Float", "in_list_view": 1, "reqd": 1}
            ]
        })
        doc.insert()
        print("Created Borrowed Product Item")

    # 2. Borrowed Product (Parent)
    if not frappe.db.exists("DocType", "Borrowed Product"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Borrowed Product",
            "module": "Fuel Management",
            "custom": 1,
            "autoname": "format:BOR-{YYYY}-{MM}-{####}",
            "fields": [
                {"fieldname": "station", "label": "Station", "fieldtype": "Link", "options": "Fuel Station", "reqd": 1},
                {"fieldname": "type", "label": "Type", "fieldtype": "Select", "options": "Borrowed In\nBorrowed Out", "reqd": 1},
                {"fieldname": "date", "label": "Date", "fieldtype": "Date", "reqd": 1},
                {"fieldname": "counterparty", "label": "Counterparty", "fieldtype": "Data", "reqd": 1},
                {"fieldname": "memo", "label": "Memo", "fieldtype": "Data"},
                {"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "Pending Return\nReturned", "default": "Pending Return"},
                {"fieldname": "stock_entry", "label": "Stock Entry", "fieldtype": "Link", "options": "Stock Entry", "read_only": 1},
                {"fieldname": "return_stock_entry", "label": "Return Stock Entry", "fieldtype": "Link", "options": "Stock Entry", "read_only": 1},
                {"fieldname": "items", "label": "Items", "fieldtype": "Table", "options": "Borrowed Product Item", "reqd": 1}
            ]
        })
        doc.insert()
        print("Created Borrowed Product")
        
    frappe.db.commit()
