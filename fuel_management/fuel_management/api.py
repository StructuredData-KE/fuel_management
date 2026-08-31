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
    rtts = frappe.get_all(
        "Station Return To Tank",
        filters={"shift": shift_id, "csa": csa_id},
        fields=["amount", "item", "volume_returned as quantity"]
    )
    data["rtt_breakdown"] = rtts or []
    data["rtt_deductions"] = sum([r.amount for r in rtts]) if rtts else 0.0
    
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
    
    # 4. Customer Payments (All customer payments count as liabilities for the CSA)
    from frappe.utils import flt
    cp_data = frappe.db.sql("""
        SELECT name, customer, amount, mode_of_payment 
        FROM `tabCustomer Payment` 
        WHERE shift=%s AND csa=%s AND docstatus=1 
        AND mode_of_payment IN ('Cash', 'M-Pesa', 'Mpesa')
    """, (shift_id, csa_id), as_dict=True)
    
    if not cp_data:
        cp_data = frappe.db.sql("""
            SELECT name, customer, amount, mode_of_payment 
            FROM `tabCustomer Payment` 
            WHERE shift=%s AND csa=%s
            AND mode_of_payment IN ('Cash', 'M-Pesa', 'Mpesa')
        """, (shift_id, csa_id), as_dict=True)
        
    data["customer_payments_breakdown"] = cp_data or []
    data["customer_payments"] = sum([flt(d.amount) for d in cp_data]) if cp_data else 0.0
        
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
    data["mpesa"] = sum([flt(d.amount) for d in mpesa_data]) if mpesa_data else 0.0
    
    # Add non-cash M-Pesa customer payments to M-Pesa deductions
    for cp in (cp_data or []):
        if cp.mode_of_payment == "M-Pesa":
            data["mpesa"] += flt(cp.amount)
    
    # 6. Invoices
    invoices_data = frappe.db.sql("""
        SELECT item, quantity, entry_number, amount 
        FROM `tabShift Invoice` 
        WHERE parent=%s AND parenttype='Shift' AND csa=%s
    """, (shift_id, csa_id), as_dict=True)
    data["invoices_breakdown"] = invoices_data or []
    data["invoices"] = sum([flt(d.amount) for d in invoices_data]) if invoices_data else 0.0
    
    # 7. Cards
    cards_data = frappe.db.sql("""
        SELECT card as card_type, receipt_no, amount 
        FROM `tabStation Cards` 
        WHERE shift=%s AND csa=%s
    """, (shift_id, csa_id), as_dict=True)
    data["cards_breakdown"] = cards_data or []
    data["cards"] = sum([flt(d.amount) for d in cards_data]) if cards_data else 0.0
    
    # Add other non-cash customer payments (Bank Transfer, Card, etc.) to Card/Bank deductions
    for cp in (cp_data or []):
        if cp.mode_of_payment and cp.mode_of_payment not in ["Cash", "M-Pesa"]:
            data["cards"] += flt(cp.amount)
    
    # 8. Expenses
    expenses_data = frappe.db.sql("""
        SELECT name, category, amount 
        FROM `tabStation Expense` 
        WHERE shift=%s AND csa=%s
    """, (shift_id, csa_id), as_dict=True)
    
    data["expenses_breakdown"] = expenses_data or []
    data["expenses"] = sum([flt(d.amount) for d in expenses_data]) if expenses_data else 0.0
    
    return data

@frappe.whitelist()
def get_shift_report_data(shift_id):
    recons = frappe.get_all("Shift Cash Reconciliation", filters={"shift": shift_id}, fields=["csa", "meter_sales", "inventory_sales", "greasing_sales", "invoices", "cards", "mpesa", "expenses", "expected_cash", "actual_cash", "variance"])
    
    # Customer Payments
    payments_breakdown = frappe.db.sql("""
        SELECT IFNULL(c.customer_name, p.customer) as customer, SUM(p.amount) as amount 
        FROM `tabCustomer Payment` p
        LEFT JOIN `tabCustomer` c ON p.customer = c.name
        WHERE p.shift=%s AND p.docstatus < 2
        GROUP BY p.customer
    """, (shift_id,), as_dict=True)
    customer_payments_total = sum([p.amount for p in payments_breakdown]) if payments_breakdown else 0.0
    
    # Top Ups
    top_ups = frappe.db.sql("""
        SELECT amount 
        FROM `tabStation Supplier Top Up` 
        WHERE shift=%s AND docstatus < 2
    """, (shift_id,), as_dict=True)
    topups_total = sum([t.amount for t in top_ups]) if top_ups else 0.0
    
    # Cards Breakdown
    cards_breakdown = frappe.db.sql("""
        SELECT card as card_type, SUM(amount) as amount
        FROM `tabStation Cards`
        WHERE shift=%s
        GROUP BY card
    """, (shift_id,), as_dict=True)
    
    # Invoices Breakdown by Customer
    invoices_breakdown = frappe.db.sql("""
        SELECT IFNULL(c.customer_name, i.customer) as customer, SUM(i.amount) as amount
        FROM `tabShift Invoice` i
        LEFT JOIN `tabCustomer` c ON i.customer = c.name
        WHERE i.parent=%s AND i.parenttype='Shift'
        GROUP BY i.customer
    """, (shift_id,), as_dict=True)
    
    return {
        "reconciliations": recons,
        "customer_payments_total": customer_payments_total,
        "customer_payments_breakdown": payments_breakdown,
        "topups_total": topups_total,
        "cards_breakdown": cards_breakdown,
        "invoices_breakdown": invoices_breakdown
    }

@frappe.whitelist()
def get_active_item_prices():
    sql = """
        SELECT ip.item_code, ip.item_name, ip.price_list_rate, i.item_group
        FROM `tabItem Price` ip
        LEFT JOIN `tabItem` i ON ip.item_code = i.name
        WHERE ip.price_list = 'Standard Selling' 
        AND (ip.valid_from <= CURDATE() OR ip.valid_from IS NULL)
        AND (ip.valid_upto >= CURDATE() OR ip.valid_upto IS NULL)
        ORDER BY ip.valid_from DESC, ip.creation DESC
    """
    prices = frappe.db.sql(sql, as_dict=True)
    
    active_prices = []
    seen = set()
    for p in prices:
        if p.item_code not in seen:
            active_prices.append(p)
            seen.add(p.item_code)
            
    return active_prices

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
def get_daily_dip_summary(shift_id):
    """
    Returns dip data for the ENTIRE DAY corresponding to a night shift,
    GROUPED BY FUEL PRODUCT (to combine multiple tanks for the same product into one row).
    """
    from frappe.utils import flt

    if not shift_id:
        return []

    night_shift = frappe.get_doc("Shift", shift_id)

    if not night_shift.dip_stick_readings:
        return []

    shift_date = night_shift.shift_date
    station = night_shift.station

    # Map tanks to fuel products
    tank_to_product = {}
    for tank in frappe.get_all("Fuel Tank", filters={"station": station}, fields=["name", "fuel_product"]):
        tank_to_product[tank.name] = tank.fuel_product or tank.name

    # Get ALL shifts on the same date for this station
    all_shifts_on_date = frappe.get_all(
        "Shift",
        filters={"station": station, "shift_date": shift_date, "docstatus": ["!=", 2]},
        pluck="name"
    )

    # --- Meter Sales: grouped by product ---
    meter_sales_by_product = {}  
    for s_name in all_shifts_on_date:
        s_doc = frappe.get_doc("Shift", s_name)
        for row in (s_doc.pump_meter_readings or []):
            tank_name = frappe.db.get_value("Pump Nozzle", row.pump_nozzle, "fuel_tank") if row.pump_nozzle else None
            if tank_name:
                product = tank_to_product.get(tank_name, tank_name)
                sales_lts = max(0, flt(row.closing_electronic_meter) - flt(row.opening_electronic_meter))
                meter_sales_by_product[product] = meter_sales_by_product.get(product, 0) + sales_lts

    # --- Purchases: grouped by product ---
    purchases_by_product = {} 
    shift_purchases = frappe.get_all(
        "Station Purchase",
        filters={"shift": ["in", all_shifts_on_date], "docstatus": ["in", [0, 1]]},
        pluck="name"
    )
    if shift_purchases:
        pur_items = frappe.get_all(
            "Station Purchase Item",
            filters={"parent": ["in", shift_purchases]},
            fields=["item", "quantity"]
        )
        for pi in pur_items:
            product = pi.item
            purchases_by_product[product] = purchases_by_product.get(product, 0) + flt(pi.quantity)

    # --- Opening Dip: per tank ---
    prev_night_shift_query = """
        SELECT name FROM `tabShift`
        WHERE station = %s
          AND name != %s
          AND (shift_date < %s OR (shift_date = %s AND LOWER(shift_template) LIKE %s))
          AND LOWER(shift_template) LIKE %s
          AND docstatus != 2
        ORDER BY shift_date DESC, creation DESC
        LIMIT 1
    """
    prev_night = frappe.db.sql(prev_night_shift_query, (
        station, shift_id,
        shift_date, shift_date, "%night%",
        "%night%"
    ), as_dict=True)

    opening_dip_by_tank = {}
    if prev_night:
        prev_doc = frappe.get_doc("Shift", prev_night[0].name)
        for r in (prev_doc.dip_stick_readings or []):
            if r.fuel_tank and r.closing_dip is not None:
                opening_dip_by_tank[r.fuel_tank] = flt(r.closing_dip)

    for row in night_shift.dip_stick_readings:
        if row.fuel_tank not in opening_dip_by_tank and flt(row.opening_dip) != 0:
            opening_dip_by_tank[row.fuel_tank] = flt(row.opening_dip)

    # --- Group dips into product ---
    product_summary = {}

    for row in night_shift.dip_stick_readings:
        tank = row.fuel_tank or ""
        product = tank_to_product.get(tank, tank)
        
        opening_dip = opening_dip_by_tank.get(tank, 0)
        closing_dip = flt(row.closing_dip)
        
        if product not in product_summary:
            product_summary[product] = {
                "opening_dip": 0.0,
                "closing_dip": 0.0,
                "tanks": []
            }
            
        product_summary[product]["opening_dip"] += opening_dip
        product_summary[product]["closing_dip"] += closing_dip
        if tank not in product_summary[product]["tanks"]:
            product_summary[product]["tanks"].append(tank)

    # --- Build final result ---
    result = []
    for product in sorted(product_summary.keys()):
        data = product_summary[product]
        
        opening_dip = data["opening_dip"]
        closing_dip = data["closing_dip"]
        purchases = purchases_by_product.get(product, 0)
        meter_sales = meter_sales_by_product.get(product, 0)
        
        tank_sales = opening_dip + purchases - closing_dip
        variance = meter_sales - tank_sales

        label = f"TOTAL {str(product).upper()}"

        result.append({
            "fuel_tank": label,
            "opening_dip": opening_dip,
            "closing_dip": closing_dip,
            "injected_purchases": purchases,
            "meter_sales": meter_sales,
            "sales_quantity": tank_sales,
            "variance": variance,
        })

    return result



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
def create_spa_stock_transfer(station_id, item_code=None, qty=None, direction="Store to Forecourt", items=None):
    if not station_id:
        frappe.throw("Station ID is required")
        
    import json
    
    parsed_items = []
    if items:
        try:
            parsed_items = json.loads(items)
        except Exception:
            frappe.throw("Invalid items array")
    elif item_code and qty:
        parsed_items = [{"item": item_code, "qty": qty, "direction": direction}]
        
    if not parsed_items:
        frappe.throw("No items to transfer")
        
    station = frappe.get_doc("Fuel Station", station_id)
    
    if not station.default_store_warehouse or not station.default_forecourt_warehouse:
        frappe.throw("Station must have both Default Store Warehouse and Default Forecourt Warehouse set.")
        
    company = station.company if hasattr(station, 'company') and station.company else frappe.defaults.get_user_default("Company")
    
    # We will create ONE stock entry per unique direction just to be safe, 
    # but the UI usually sends one direction or multiple. Wait, Stock Entry requires ONE from_warehouse and ONE to_warehouse in the header.
    # Actually, ERPNext v14+ allows Material Transfer to have different from/to per row if the header is blank!
    # But usually, it's better to just set it per row.
    
    se = frappe.new_doc("Stock Entry")
    se.stock_entry_type = "Material Transfer"
    se.company = company
    
    for row in parsed_items:
        r_item = row.get("item")
        r_qty = float(row.get("qty") or 0)
        r_dir = row.get("direction") or direction
        
        if r_qty <= 0: continue
        
        from_w = station.default_store_warehouse
        to_w = station.default_forecourt_warehouse
        
        if r_dir == "Forecourt to Store":
            from_w = station.default_forecourt_warehouse
            to_w = station.default_store_warehouse
            
        se.append("items", {
            "item_code": r_item,
            "qty": r_qty,
            "s_warehouse": from_w,
            "t_warehouse": to_w
        })
        
    if not se.items:
        frappe.throw("No valid items with quantity > 0")
        
    se.insert()
    se.submit()
    
    return {"status": "success", "message": f"Successfully created Stock Transfer: {se.name}", "name": se.name}

@frappe.whitelist()
def get_inventory_status_report(station_id=None, from_date=None, to_date=None, warehouse_type=None):
    from frappe.utils import flt
    if not from_date or not to_date:
        frappe.throw("From Date and To Date are required")
        
    warehouses = []
    company = frappe.defaults.get_user_default("Company")
    
    store_warehouses = []
    forecourt_warehouses = []
    
    if station_id:
        station = frappe.get_doc("Fuel Station", station_id)
        if station.default_store_warehouse: store_warehouses.append(station.default_store_warehouse)
        if station.default_forecourt_warehouse: forecourt_warehouses.append(station.default_forecourt_warehouse)
        if hasattr(station, 'company') and station.company:
            company = station.company
    else:
        stations = frappe.get_all("Fuel Station", fields=["default_store_warehouse", "default_forecourt_warehouse"])
        for s in stations:
            if s.default_store_warehouse: store_warehouses.append(s.default_store_warehouse)
            if s.default_forecourt_warehouse: forecourt_warehouses.append(s.default_forecourt_warehouse)

    if warehouse_type == "store":
        warehouses = store_warehouses
    elif warehouse_type == "forecourt":
        warehouses = forecourt_warehouses
    else:
        warehouses = store_warehouses + forecourt_warehouses
        
    if not warehouses:
        return {"status": "success", "company": company, "from_date": from_date, "to_date": to_date, "data": {}}
    company_name = frappe.db.get_value("Company", company, "company_name") or company

    allowed_items = frappe.get_all("Item", filters={"item_group": ["not in", ["Fuels", "FUELS", "Fuel", "FUEL"]]}, pluck="name")
    
    if not allowed_items:
        return {"status": "success", "company": company_name, "from_date": from_date, "to_date": to_date, "data": []}

    # Fetch Standard Selling rates for all items in one query
    price_records = frappe.get_all(
        "Item Price",
        filters={"price_list": "Standard Selling"},
        fields=["item_code", "price_list_rate"]
    )
    item_prices = {p.item_code: flt(p.price_list_rate) for p in price_records}

    sles = frappe.get_all("Stock Ledger Entry",
        filters={"warehouse": ["in", warehouses], "is_cancelled": 0, "item_code": ["in", allowed_items]},
        fields=["item_code", "warehouse", "actual_qty", "qty_after_transaction", "posting_date", "posting_time", "creation", "voucher_type", "voucher_no"],
        order_by="posting_date asc, posting_time asc, creation asc"
    )
    
    data = {}
    item_wh_op = {}
    item_wh_cl = {}
    
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
                "borrowed_in": 0,
                "borrowed_out": 0,
                "sales": 0,
                "unit_price": item_prices.get(item, 0),
                "vouchers": {}
            }
        
        pdate = str(sle.posting_date)
        
        # Opening balance is the qty_after_transaction of the LAST SLE strictly BEFORE from_date
        if pdate < from_date:
            item_wh_op[(item, sle.warehouse)] = sle.qty_after_transaction
            
        # Closing balance is the qty_after_transaction of the LAST SLE up to to_date
        if pdate <= to_date:
            item_wh_cl[(item, sle.warehouse)] = sle.qty_after_transaction
        
        # Transactions
        if from_date <= pdate <= to_date:
            vid = sle.voucher_type + "|" + sle.voucher_no
            if vid not in data[item]["vouchers"]:
                data[item]["vouchers"][vid] = 0
            data[item]["vouchers"][vid] += sle.actual_qty

    # Calculate aggregated opening and closing balances
    for item, row in data.items():
        row["op_store"] = sum(qty for (it, wh), qty in item_wh_op.items() if it == item and wh in store_warehouses)
        row["op_forecourt"] = sum(qty for (it, wh), qty in item_wh_op.items() if it == item and wh in forecourt_warehouses)
        row["cl_store"] = sum(qty for (it, wh), qty in item_wh_cl.items() if it == item and wh in store_warehouses)
        row["cl_forecourt"] = sum(qty for (it, wh), qty in item_wh_cl.items() if it == item and wh in forecourt_warehouses)


    borrowed_docs = frappe.get_all("Borrowed Product", filters={"docstatus": ["!=", 2]}, fields=["stock_entry", "return_stock_entry", "type"])
    borrowed_in_ses = set()
    borrowed_out_ses = set()
    for b in borrowed_docs:
        if b.type == "Borrowed In":
            if b.stock_entry: borrowed_in_ses.add(b.stock_entry)
            if b.return_stock_entry: borrowed_out_ses.add(b.return_stock_entry)
        else:
            if b.stock_entry: borrowed_out_ses.add(b.stock_entry)
            if b.return_stock_entry: borrowed_in_ses.add(b.return_stock_entry)
    for item, row in data.items():
        if "vouchers" in row:
            for vid, qty in row["vouchers"].items():
                v_type, v_no = vid.split('|')
                if v_type == 'Stock Entry' and v_no in borrowed_in_ses:
                    row['borrowed_in'] += qty
                elif v_type == 'Stock Entry' and v_no in borrowed_out_ses:
                    row['borrowed_out'] += abs(qty)
                elif qty > 0:
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

    borrowed_docs = frappe.get_all("Borrowed Product", filters={"docstatus": ["!=", 2]}, fields=["stock_entry", "return_stock_entry", "type"])
    borrowed_in_ses = set()
    borrowed_out_ses = set()
    for b in borrowed_docs:
        if b.type == "Borrowed In":
            if b.stock_entry: borrowed_in_ses.add(b.stock_entry)
            if b.return_stock_entry: borrowed_out_ses.add(b.return_stock_entry)
        else:
            if b.stock_entry: borrowed_out_ses.add(b.stock_entry)
            if b.return_stock_entry: borrowed_in_ses.add(b.return_stock_entry)
    for item, row in data.items():
        ig = row["item_group"] or "Other"
        
        # Skip Fuels completely
        if ig.upper() in ["FUELS", "FUEL"]:
            continue
            
        if ig not in grouped:
            grouped[ig] = []
        grouped[ig].append(row)
        
    for ig in grouped:
        grouped[ig].sort(key=lambda x: str(x.get("item_name") or ""))
        
    return {"status": "success", "company": company_name, "from_date": from_date, "to_date": to_date, "data": grouped}

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


def get_or_create_transit_warehouse(station, company):
    import frappe
    warehouse_name = f"{station} - Borrowed Transit"
    if not frappe.db.exists("Warehouse", {"warehouse_name": warehouse_name, "company": company}):
        # Need to find the parent warehouse for the station
        station_doc = frappe.get_doc("Fuel Station", station)
        store_warehouse = station_doc.default_store_warehouse
        
        if not store_warehouse:
            frappe.throw("Station default store warehouse is not configured.")
            
        store_doc = frappe.get_doc("Warehouse", store_warehouse)
        parent_warehouse = store_doc.parent_warehouse
        
        new_wh = frappe.get_doc({
            "doctype": "Warehouse",
            "warehouse_name": warehouse_name,
            "company": company,
            "parent_warehouse": parent_warehouse,
            "is_group": 0
        })
        new_wh.insert(ignore_permissions=True)
        return new_wh.name
    else:
        return frappe.db.get_value("Warehouse", {"warehouse_name": warehouse_name, "company": company}, "name")

@frappe.whitelist()
def create_borrowed_product(payload):
    import frappe
    import json
    data = json.loads(payload)
    
    station = data.get("station")
    b_type = data.get("type")
    date = data.get("date")
    counterparty = data.get("counterparty")
    memo = data.get("memo")
    items = data.get("items", [])
    
    if not station or not items:
        frappe.throw("Missing station or items")
        
    station_doc = frappe.get_doc("Fuel Station", station)
    company = station_doc.company if hasattr(station_doc, "company") and station_doc.company else frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
    store_warehouse = station_doc.default_store_warehouse
    
    doc = frappe.get_doc({
        "doctype": "Borrowed Product",
        "station": station,
        "type": b_type,
        "date": date,
        "counterparty": counterparty,
        "memo": memo,
        "status": "Pending Return"
    })
    
    for item in items:
        doc.append("items", {
            "item_code": item.get("item_code"),
            "qty": item.get("qty")
        })
        
    doc.insert(ignore_permissions=True)
    
    # Handle Stock Entry
    se = frappe.new_doc("Stock Entry")
    se.posting_date = date
    se.company = company
    
    if b_type == "Borrowed In":
        se.stock_entry_type = "Material Receipt"
        for item in items:
            se.append("items", {
                "item_code": item.get("item_code"),
                "qty": item.get("qty"),
                "t_warehouse": store_warehouse
            })
    else: # Borrowed Out
        se.stock_entry_type = "Material Transfer"
        transit_warehouse = get_or_create_transit_warehouse(station, company)
        for item in items:
            se.append("items", {
                "item_code": item.get("item_code"),
                "qty": item.get("qty"),
                "s_warehouse": store_warehouse,
                "t_warehouse": transit_warehouse
            })
            
    se.insert(ignore_permissions=True)
    se.submit()
    
    doc.db_set("stock_entry", se.name)
    
    return doc.name

@frappe.whitelist()
def get_borrowed_products(station, status="All", from_date=None, to_date=None, counterparty=None):
    import frappe
    filters = {"station": station}
    if status != "All":
        filters["status"] = status
        
    if from_date and to_date:
        filters["date"] = ["between", [from_date, to_date]]
    elif from_date:
        filters["date"] = [">=", from_date]
    elif to_date:
        filters["date"] = ["<=", to_date]
        
    if counterparty:
        filters["counterparty"] = ["like", f"%{counterparty}%"]
        
    records = frappe.get_all("Borrowed Product", 
        filters=filters,
        fields=["name", "date", "counterparty", "type", "status", "memo"],
        order_by="creation desc"
    )
    
    if records:
        names = [r.name for r in records]
        all_items = frappe.get_all("Borrowed Product Item",
            filters={"parent": ["in", names]},
            fields=["parent", "item_code", "qty"]
        )
        items_map = {}
        for item in all_items:
            items_map.setdefault(item.parent, []).append(item)
        for r in records:
            r["items"] = items_map.get(r.name, [])
        
    return records




def create_counterparty_doctype():
    import frappe
    if not frappe.db.exists("DocType", "Borrowing Counterparty"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Borrowing Counterparty",
            "module": "Fuel Management",
            "custom": 1,
            "autoname": "field:counterparty_name",
            "fields": [
                {"fieldname": "counterparty_name", "label": "Counterparty Name", "fieldtype": "Data", "reqd": 1, "unique": 1, "in_list_view": 1}
            ]
        })
        doc.insert()
        print("Created Borrowing Counterparty")
    else:
        print("Borrowing Counterparty already exists")
        
    frappe.db.commit()

@frappe.whitelist()
def get_borrowing_counterparties():
    import frappe
    return frappe.get_all("Borrowing Counterparty", fields=["name as value", "counterparty_name as label"])

@frappe.whitelist()
def debug_prices():
    import frappe
    prices = frappe.get_all('Item Price', filters={'price_list': 'Standard Selling'}, fields=['item_code', 'price_list_rate'], limit=20)
    return [f"{p.item_code}: {p.price_list_rate}" for p in prices]

@frappe.whitelist()
def get_item_forecourt_balance(station_id, item_code):
    from frappe.utils import flt
    if not station_id or not item_code:
        return 0.0
    station = frappe.get_doc("Fuel Station", station_id)
    f_warehouse = station.default_forecourt_warehouse
    if not f_warehouse:
        return 0.0
    
    balance = frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": f_warehouse}, "actual_qty")
    return flt(balance)

@frappe.whitelist()
def reload_spa_page():
    import frappe
    frappe.reload_doc("fuel_management", "page", "shift_operation_spa", force=True)
    frappe.db.commit()
    return "Reloaded successfully"

@frappe.whitelist()
def get_customer_transactions(customer_id):
    if not customer_id:
        return []
        
    # Get invoices (debits)
    invoices = frappe.db.sql("""
        SELECT 
            si.name as id, 
            s.shift_date as date, 
            'Shift Invoice' as ref_type, 
            CONCAT(IFNULL(si.entry_number, ''), ' - ', IFNULL(si.vehicle_registration, ''), ' - ', IFNULL(si.item, '')) as description, 
            si.amount as debit, 
            0.0 as credit 
        FROM `tabShift Invoice` si
        JOIN `tabShift` s ON si.parent = s.name
        WHERE si.customer = %s AND s.docstatus < 2
    """, (customer_id,), as_dict=True)

    # Get payments (credits)
    payments = frappe.db.sql("""
        SELECT 
            name as id, 
            date as date, 
            'Customer Payment' as ref_type, 
            CONCAT('Payment via ', IFNULL(mode_of_payment, ''), ' - Ref: ', IFNULL(trans_no, '')) as description, 
            0.0 as debit, 
            amount as credit 
        FROM `tabCustomer Payment` 
        WHERE customer = %s AND docstatus < 2
    """, (customer_id,), as_dict=True)

    transactions = invoices + payments
    # Sort by date
    transactions.sort(key=lambda x: x['date'] if x['date'] else '')
    return transactions



from frappe.utils import today, add_days

@frappe.whitelist()
def get_tank_levels(station=None):
    if not station:
        station = frappe.db.get_value("Fuel Station", None, "name")
        
    tanks = frappe.get_all("Fuel Tank", filters={"station": station}, fields=["name as tank_name", "fuel_product", "capacity", "current_volume", "reorder_threshold", "variance_tolerance"])
    
    res = []
    
    tank_names = [t.tank_name for t in tanks]
    latest_dips = {}
    if tank_names:
        dips = frappe.db.sql("""
            SELECT * FROM (
                SELECT child.fuel_tank, child.closing_dip as reading, parent.shift_date as posting_date, parent.end_time as posting_time, child.variance,
                ROW_NUMBER() OVER(PARTITION BY child.fuel_tank ORDER BY parent.shift_date DESC, parent.end_time DESC) as rn
                FROM `tabDip Stick Reading` child
                JOIN `tabShift` parent ON child.parent = parent.name
                WHERE child.fuel_tank IN %s AND parent.docstatus IN (0, 1) AND child.closing_dip > 0
                AND parent.shift_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            ) as ranked
            WHERE rn = 1
        """, (tuple(tank_names),), as_dict=1)
        for d in dips:
            latest_dips[d.fuel_tank] = d

    for t in tanks:
        latest_dip = latest_dips.get(t.tank_name)
        
        dip_val = latest_dip.reading if latest_dip and latest_dip.reading is not None else t.current_volume
        variance = latest_dip.variance if latest_dip and latest_dip.variance is not None else 0.0
        ts = f"{latest_dip.posting_date} {latest_dip.posting_time}" if latest_dip else ""
        
        pct = (dip_val / t.capacity) * 100 if t.capacity else 0
        
        status = "Normal"
        if t.variance_tolerance and abs(variance) > t.variance_tolerance:
            status = "Variance flagged"
        elif t.reorder_threshold and pct <= t.reorder_threshold:
            status = "Low"
            
        res.append({
            "name": t.tank_name,
            "product": t.fuel_product,
            "capacity": t.capacity,
            "latest_dip": dip_val,
            "percent_full": round(pct, 1),
            "reorder_threshold": t.reorder_threshold,
            "variance": variance,
            "status": status,
            "timestamp": ts
        })
    return res


@frappe.whitelist()
def get_available_shifts(station=None, filter_date=None):
    if not station:
        station = frappe.db.get_value("Fuel Station", None, "name")
    filters = {"station": station}
    if filter_date:
        filters["shift_date"] = filter_date
    shifts = frappe.get_all("Shift", filters=filters, fields=["name", "shift_date", "creation", "status"], order_by="creation desc", limit=50)
    return shifts

@frappe.whitelist()
def get_homepage_kpis(station=None, shift_id=None, from_date=None, to_date=None):

    from frappe.utils import today, get_first_day
    
    if not station:
        station = frappe.db.get_value("Fuel Station", None, "name")
        
    is_date_range = bool(from_date and to_date)
    
    if is_date_range:
        context_date = f"{from_date} to {to_date}"
        context_shift = "Multiple Shifts"
        context_status = "Date Range"
        context_creation = None
    elif shift_id:
        shifts = frappe.get_all("Shift", filters={"name": shift_id}, fields=["name", "shift_date", "creation", "status"], limit=1)
        if shifts:
            shift = shifts[0]
            context_date = shift.shift_date
            context_shift = shift.name
            context_status = shift.status
            context_creation = shift.creation
        else:
            context_date = today()
            context_shift = None
            context_status = None
            context_creation = None
    else:
        shifts = frappe.get_all("Shift", filters={"station": station}, fields=["name", "shift_date", "creation", "status"], order_by="creation desc", limit=1)
        if shifts:
            shift = shifts[0]
            context_date = shift.shift_date
            context_shift = shift.name
            context_status = shift.status
            context_creation = shift.creation
        else:
            context_date = today()
            context_shift = None
            context_status = None
            context_creation = None
        
    fuel_breakdown = {}
    if is_date_range:
        fuel_data = frappe.db.sql("""
            SELECT tank.fuel_product, SUM(child.sales_quantity_electronic) as qty
            FROM `tabPump Meter Reading` child
            JOIN `tabPump Nozzle` nozzle ON child.pump_nozzle = nozzle.name
            JOIN `tabFuel Tank` tank ON nozzle.fuel_tank = tank.name
            JOIN `tabShift` parent ON child.parent = parent.name
            WHERE parent.station = %s AND parent.shift_date >= %s AND parent.shift_date <= %s AND parent.docstatus IN (0, 1)
            GROUP BY tank.fuel_product
        """, (station, from_date, to_date), as_dict=True)
        for row in fuel_data:
            if row.fuel_product:
                fuel_breakdown[row.fuel_product] = row.qty or 0
    elif context_shift and context_shift != "Multiple Shifts":
        fuel_data = frappe.db.sql("""
            SELECT tank.fuel_product, SUM(child.sales_quantity_electronic) as qty
            FROM `tabPump Meter Reading` child
            JOIN `tabPump Nozzle` nozzle ON child.pump_nozzle = nozzle.name
            JOIN `tabFuel Tank` tank ON nozzle.fuel_tank = tank.name
            WHERE child.parent = %s
            GROUP BY tank.fuel_product
        """, (context_shift,), as_dict=True)
        for row in fuel_data:
            if row.fuel_product:
                fuel_breakdown[row.fuel_product] = row.qty or 0
    
    litres_sold = sum(fuel_breakdown.values())
    
    lubes_qty = 0
    gas_qty = 0
    top_selling_item = "None"
    top_selling_qty = 0
    
    gas_breakdown = {}
    cylinders_sold = 0
    
    inventory_sales = []
    if is_date_range:
        inventory_sales = frappe.db.sql("""
            SELECT item.item_group, item.item_name, SUM(child.quantity) as qty
            FROM `tabShift Inventory Sale` child
            JOIN `tabItem` item ON child.item = item.name
            JOIN `tabShift` parent ON child.parent = parent.name
            WHERE parent.station = %s AND parent.shift_date >= %s AND parent.shift_date <= %s AND parent.docstatus IN (0, 1)
            GROUP BY item.item_name, item.item_group
        """, (station, from_date, to_date), as_dict=True)
    elif context_shift and context_shift != "Multiple Shifts":
        inventory_sales = frappe.db.sql("""
            SELECT item.item_group, item.item_name, SUM(child.quantity) as qty
            FROM `tabShift Inventory Sale` child
            JOIN `tabItem` item ON child.item = item.name
            WHERE child.parent = %s
            GROUP BY item.item_name, item.item_group
        """, (context_shift,), as_dict=True)
        
    if inventory_sales:
        import re
        for sale in inventory_sales:
            group = sale.item_group.lower() if sale.item_group else ""
            qty = sale.qty or 0
            if "lube" in group or "lubricant" in group or "oil" in group:
                lubes_qty += qty
            elif "gas" in group or "lpg" in group:
                cylinders_sold += qty
                # Extract KG from item name e.g. "6KG GAS"
                match = re.search(r'(\d+)KG', sale.item_name, re.IGNORECASE)
                kg_per_cyl = int(match.group(1)) if match else 0
                gas_breakdown[sale.item_name] = qty * kg_per_cyl
                gas_qty += (qty * kg_per_cyl)
                
            if qty > top_selling_qty:
                top_selling_qty = qty
                top_selling_item = sale.item_name
    
    cash_reconciled = 0
    mpesa_posted = 0
        
    # Dip Variance Flags
    if is_date_range:
        flags = frappe.db.sql("""
            SELECT count(*) as count
            FROM `tabDip Stick Reading` child
            JOIN `tabShift` parent ON child.parent = parent.name
            WHERE parent.station = %s AND parent.shift_date >= %s AND parent.shift_date <= %s AND child.variance != 0 AND parent.docstatus = 1
        """, (station, from_date, to_date))[0][0]
    elif context_shift and context_shift != "Multiple Shifts":
        flags = frappe.db.sql("""
            SELECT count(*) as count
            FROM `tabDip Stick Reading` child
            WHERE child.parent = %s AND child.variance != 0
        """, (context_shift,))[0][0]
    else:
        tanks = get_tank_levels(station)
        flags = len([t for t in tanks if t.get("status") == "Variance flagged"])
        
    # Monthly KPIs
    if is_date_range:
        target_date = from_date
    elif context_shift and context_shift != "Multiple Shifts":
        target_date = context_date
    else:
        target_date = today()
        
    start_of_month = get_first_day(target_date)
    end_of_month = frappe.utils.get_last_day(target_date)
    
    month_meters = frappe.db.sql("""
        SELECT SUM(child.sales_quantity_electronic) as qty
        FROM `tabPump Meter Reading` child
        JOIN `tabShift` parent ON child.parent = parent.name
        WHERE parent.station = %s AND parent.shift_date >= %s AND parent.shift_date <= %s AND parent.docstatus = 1
    """, (station, start_of_month, end_of_month), as_dict=True)
    monthly_litres = month_meters[0].qty if month_meters and month_meters[0].qty else 0
    
    monthly_revenue = 0
    
    return {
        "context_shift": context_shift,
        "context_date": context_date,
        "context_status": context_status,
        "context_creation": context_creation,
        "litres_sold": litres_sold,
        "fuel_breakdown": fuel_breakdown,
        "lubes_qty": lubes_qty,
        "gas_qty": gas_qty,
        "gas_breakdown": gas_breakdown,
        "cylinders_sold": cylinders_sold,
        "top_selling_item": top_selling_item,
        "top_selling_qty": top_selling_qty,
        "cash_reconciled": cash_reconciled,
        "mpesa_posted": mpesa_posted,
        "dip_flags": flags,
        "monthly_litres": monthly_litres,
        "monthly_revenue": monthly_revenue
    }

@frappe.whitelist()
def get_homepage_trend(station=None):
    # Last 7 days
    start_date = add_days(today(), -6)
    meters = frappe.db.sql("""
        SELECT parent.shift_date as posting_date, tank.fuel_product, SUM(child.sales_quantity_electronic) as qty
        FROM `tabPump Meter Reading` child
        JOIN `tabShift` parent ON child.parent = parent.name
        JOIN `tabPump Nozzle` nozzle ON child.pump_nozzle = nozzle.name
        JOIN `tabFuel Tank` tank ON nozzle.fuel_tank = tank.name
        WHERE parent.shift_date >= %s AND parent.docstatus = 1
        GROUP BY parent.shift_date, tank.fuel_product
    """, (start_date,), as_dict=True)
    
    trend = {}
    for i in range(7):
        dt = str(add_days(start_date, i))
        trend[dt] = {"Petrol": 0, "Diesel": 0}
        
    mix = {"Petrol": 0, "Diesel": 0, "Kerosene": 0, "Lubricants": 0}
    
    for m in meters:
        dt = str(m.posting_date)
        prod = m.fuel_product or ""
        qty = m.qty or 0
        
        if dt not in trend: continue
        
        # Map products
        if "Petrol" in prod or "PMS" in prod or "Super" in prod:
            trend[dt]["Petrol"] += qty
            if dt == today(): mix["Petrol"] += qty
        elif "Diesel" in prod or "AGO" in prod:
            trend[dt]["Diesel"] += qty
            if dt == today(): mix["Diesel"] += qty
        elif "Kerosene" in prod or "IK" in prod:
            if dt == today(): mix["Kerosene"] += qty
        else:
            if dt == today(): mix["Lubricants"] += qty
                
    # formatting for charts
    dates = list(trend.keys())
    dates.sort()
    
    return {
        "trend_dates": dates,
        "trend_petrol": [trend[d]["Petrol"] for d in dates],
        "trend_diesel": [trend[d]["Diesel"] for d in dates],
        "fuel_mix": mix
    }

@frappe.whitelist()
def get_homepage_activity(station=None):
    # recent 5 shifts opened
    shifts = frappe.get_all("Shift", fields=["name", "creation", "shift_template", "status"], order_by="creation desc", limit=3)
    # recent 5 meter readings
    meters = frappe.get_all("Pump Meter Reading", fields=["name", "creation", "pump_nozzle"], order_by="creation desc", limit=3)
    # recent 5 dip sticks
    dips = frappe.get_all("Dip Stick Reading", fields=["name", "creation", "fuel_tank", "variance"], order_by="creation desc", limit=3)
    
    activity = []
    for s in shifts:
        activity.append({"time": str(s.creation), "msg": f"Shift {s.name} ({s.shift_template}) was created.", "type": "shift"})
    for m in meters:
        activity.append({"time": str(m.creation), "msg": f"Meter reading posted for {m.pump_nozzle}.", "type": "meter"})
    for d in dips:
        status = "variance flagged" if abs(d.variance or 0) > 50 else "normal"
        activity.append({"time": str(d.creation), "msg": f"Dip reading for {d.fuel_tank} posted ({status}).", "type": "dip", "variance": d.variance})
        
    activity.sort(key=lambda x: x["time"], reverse=True)
    return activity[:8]

# ---------------------------------------------------------
# Shortage Management Hooks & API
# ---------------------------------------------------------

@frappe.whitelist()
def get_shortage_form_data(station=None):
    employees = frappe.get_all('Employee', fields=['name', 'employee_name', 'status'], filters={'status': 'Active'}, order_by='employee_name asc')
    cash_accounts = frappe.get_all('Account', fields=['name', 'account_name'], filters={'account_type': ['in', ['Cash', 'Bank']], 'is_group': 0, 'company': frappe.defaults.get_user_default('company')})
    # Add dummy current_balance so frontend JS doesn't break
    for acc in cash_accounts:
        acc['current_balance'] = 0.0
    
    return {
        'employees': employees,
        'cash_accounts': cash_accounts
    }

@frappe.whitelist()
def submit_shortage_correction(from_employee, to_employee, amount, date, remarks=None):
    if float(amount) <= 0:
        frappe.throw('Amount must be positive.')
    
    doc = frappe.get_doc({
        'doctype': 'Staff Shortage Correction',
        'from_employee': from_employee,
        'to_employee': to_employee,
        'amount': amount,
        'date': date,
        'remarks': remarks
    })
    doc.insert(ignore_permissions=True)
    doc.submit()
    return doc.name

@frappe.whitelist()
def update_shift_assignments(shift_name, assignments):
    import json
    if isinstance(assignments, str):
        assignments = json.loads(assignments)
        
    doc = frappe.get_doc("Shift", shift_name)
    doc.set("assigned_csas", [])
    for row in assignments:
        doc.append("assigned_csas", {
            "csa": row.get("csa"),
            "pump_group": row.get("pump_group")
        })
    doc.save(ignore_permissions=True)
    return "success"

@frappe.whitelist()
def submit_shortage_payment(employee, payment_mode, amount, date, shift_reference=None, cash_account=None, reference_no=None, remarks=None):
    if float(amount) <= 0:
        frappe.throw('Amount must be positive.')
        
    doc = frappe.get_doc({
        'doctype': 'Staff Shortage Payment',
        'employee': employee,
        'payment_mode': payment_mode,
        'amount': amount,
        'date': date,
        'shift_reference': shift_reference,
        'cash_account': cash_account,
        'reference_no': reference_no,
        'remarks': remarks
    })
    doc.insert(ignore_permissions=True)
    doc.submit()
    return doc.name

def on_submit_shortage_correction(doc, method):
    # Reference field in Staff Liability Ledger: we should set a custom field or use 'amended_from' to link?
    # We can just link it in 'reason' for now.
    from frappe.utils import nowdate
    
    frappe.get_doc({
        'doctype': 'Staff Liability Ledger',
        'employee': doc.from_employee,
        'date': doc.date,
        'amount': -doc.amount,
        'reason': f'Correction/Transfer to {doc.to_employee} (Ref: {doc.name})',
        'status': 'Deducted'
    }).insert(ignore_permissions=True).submit()
    
    frappe.get_doc({
        'doctype': 'Staff Liability Ledger',
        'employee': doc.to_employee,
        'date': doc.date,
        'amount': doc.amount,
        'reason': f'Correction/Transfer from {doc.from_employee} (Ref: {doc.name})',
        'status': 'Unpaid'
    }).insert(ignore_permissions=True).submit()

def on_cancel_shortage_correction(doc, method):
    ledgers = frappe.get_all('Staff Liability Ledger', filters={'reason': ['like', f'%Ref: {doc.name}%'], 'docstatus': 1})
    for l in ledgers:
        ldoc = frappe.get_doc('Staff Liability Ledger', l.name)
        ldoc.cancel()


def on_submit_shortage_payment(doc, method):
    frappe.get_doc({
        'doctype': 'Staff Liability Ledger',
        'employee': doc.employee,
        'date': doc.date,
        'shift': doc.shift_reference,
        'amount': -float(doc.amount),
        'reason': f'{doc.payment_mode} Payment (Ref: {doc.name})',
        'status': 'Deducted'
    }).insert(ignore_permissions=True).submit()
    
    company = frappe.defaults.get_user_default("company")
    if not company:
        company = frappe.db.get_value("Global Defaults", None, "default_company")
        
    station_id = frappe.defaults.get_user_default("station")
    if not station_id:
        stations = frappe.get_all("Fuel Station", limit=1)
        if stations:
            station_id = stations[0].name
        
    if station_id:
        station = frappe.get_doc("Fuel Station", station_id)
        shortfall_account = station.shortfall_account
        
        debit_account = frappe.db.get_value("Mode of Payment Account", {"parent": doc.payment_mode, "company": company}, "default_account")
            
        if shortfall_account and debit_account:
            je = frappe.new_doc("Journal Entry")
            je.voucher_type = "Journal Entry"
            je.posting_date = doc.date
            je.company = company
            je.user_remark = f"Shortage Payment from {doc.employee} (Ref: {doc.name})"
            
            je.append("accounts", {
                "account": debit_account,
                "debit_in_account_currency": doc.amount
            })
            
            je.append("accounts", {
                "account": shortfall_account,
                "credit_in_account_currency": doc.amount,
                "party_type": "Employee",
                "party": doc.employee
            })
            
            je.insert(ignore_permissions=True)
            je.submit()

def on_cancel_shortage_payment(doc, method):
    ledgers = frappe.get_all('Staff Liability Ledger', filters={'reason': ['like', f'%Ref: {doc.name}%'], 'docstatus': 1})
    for l in ledgers:
        frappe.get_doc('Staff Liability Ledger', l.name).cancel()
        
    jes = frappe.get_all('Journal Entry', filters={'user_remark': f"Shortage Payment from {doc.employee} (Ref: {doc.name})", 'docstatus': 1}, fields=['name'])
    for je in jes:
        frappe.get_doc('Journal Entry', je.name).cancel()


@frappe.whitelist()
def get_recent_shortage_records(start_date=None, end_date=None):
    filters = {'docstatus': 1}
    if start_date and end_date:
        filters['date'] = ['between', [start_date, end_date]]
        limit = 0
    else:
        limit = 20

    payments = frappe.get_all('Staff Shortage Payment', filters=filters, fields=['name', 'employee', 'payment_mode', 'amount', 'date', 'creation'], order_by='date desc, creation desc', limit=limit)
    corrections = frappe.get_all('Staff Shortage Correction', filters=filters, fields=['name', 'from_employee', 'to_employee', 'amount', 'date', 'creation'], order_by='date desc, creation desc', limit=limit)
    
    combined = []
    
    emp_ids = set()
    for p in payments: emp_ids.add(p['employee'])
    for c in corrections: 
        emp_ids.add(c['from_employee'])
        emp_ids.add(c['to_employee'])
        
    emp_names = {}
    if emp_ids:
        emp_records = frappe.get_all('Employee', filters={'name': ['in', list(emp_ids)]}, fields=['name', 'employee_name'])
        emp_names = {e.name: e.employee_name for e in emp_records}
    
    for p in payments:
        p['type'] = 'Payment'
        p['employee_name'] = emp_names.get(p['employee']) or p['employee']
        combined.append(p)
    for c in corrections:
        c['type'] = 'Correction'
        c['from_employee_name'] = emp_names.get(c['from_employee']) or c['from_employee']
        c['to_employee_name'] = emp_names.get(c['to_employee']) or c['to_employee']
        combined.append(c)
        
    combined.sort(key=lambda x: x['creation'], reverse=True)
    if not start_date:
        return combined[:20]
    return combined

@frappe.whitelist()
def get_csa_shorts_balances(start_date=None, end_date=None):
    from frappe.utils import nowdate, getdate
    
    date_filter = ""
    args = []
    
    if start_date and end_date:
        date_filter = "AND date BETWEEN %s AND %s"
        args = [start_date, end_date]
    else:
        # Default to this month
        date = getdate(nowdate())
        date_filter = f"AND MONTH(date) = {date.month} AND YEAR(date) = {date.year}"
        
    ledgers = frappe.db.sql("""
        SELECT 
            l.employee,
            e.employee_name,
            SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END) as total_shortage,
            SUM(CASE WHEN l.amount < 0 THEN ABS(l.amount) ELSE 0 END) as total_paid,
            SUM(l.amount) as outstanding_balance
        FROM `tabStaff Liability Ledger` l
        LEFT JOIN `tabEmployee` e ON l.employee = e.name
        WHERE l.docstatus = 1
        GROUP BY l.employee
        ORDER BY e.employee_name
    """, as_dict=True)
    
    filtered_data = frappe.db.sql(f"""
        SELECT 
            employee,
            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as month_shortage,
            SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as month_paid
        FROM `tabStaff Liability Ledger`
        WHERE docstatus = 1 {date_filter}
        GROUP BY employee
    """, tuple(args) if args else (), as_dict=True)
    
    month_map = {d.employee: d for d in filtered_data}
    
    for l in ledgers:
        emp = l.employee
        if emp in month_map:
            l['month_shortage'] = month_map[emp].month_shortage
            l['month_paid'] = month_map[emp].month_paid
        else:
            l['month_shortage'] = 0
            l['month_paid'] = 0
            
    return ledgers

@frappe.whitelist()
def get_csa_shorts_breakdown(employee, start_date=None, end_date=None):
    date_filter = ""
    args = [employee]
    
    if start_date and end_date:
        date_filter = "AND sll.date BETWEEN %s AND %s"
        args.extend([start_date, end_date])
        
    return frappe.db.sql(f"""
        SELECT 
            sll.name, sll.date, sll.shift, sll.amount, sll.reason, sll.status,
            s.shift_template, s.shift_date
        FROM `tabStaff Liability Ledger` sll
        LEFT JOIN `tabShift` s ON s.name = sll.shift
        WHERE sll.employee = %s AND sll.docstatus = 1 {date_filter}
        ORDER BY sll.date DESC, sll.creation DESC
    """, tuple(args), as_dict=True)


@frappe.whitelist()
def create_spa_bulk_stock_transfer(station_id, items, direction="Store to Forecourt"):
    if not station_id or not items:
        frappe.throw("Station ID and Items are required")
        
    import json
    if isinstance(items, str):
        items = json.loads(items)
        
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
        
    for it in items:
        item_code = it.get("item_code")
        qty = it.get("qty")
        if not item_code or not qty:
            continue
            
        try:
            qty = float(qty)
            if qty <= 0:
                continue
        except ValueError:
            continue
            
        se.append("items", {
            "item_code": item_code,
            "qty": qty,
            "uom": frappe.db.get_value("Item", item_code, "stock_uom") or "Nos",
            "s_warehouse": se.from_warehouse,
            "t_warehouse": se.to_warehouse
        })
        
    if not se.items:
        frappe.throw("No valid items to transfer")
        
    se.insert()
    se.submit()
    
    return {"status": "success", "message": "Bulk Stock Transfer completed successfully.", "name": se.name}

@frappe.whitelist()
def get_historical_stock_transfers(station_id, date_from=None, date_to=None):
    if not station_id:
        frappe.throw("Station ID is required")
        
    station = frappe.get_doc("Fuel Station", station_id)
    if not station.default_store_warehouse or not station.default_forecourt_warehouse:
        return []
        
    w1 = station.default_store_warehouse
    w2 = station.default_forecourt_warehouse
    
    date_conditions = ""
    if date_from:
        date_conditions += f" AND se.posting_date >= '{date_from}'"
    if date_to:
        date_conditions += f" AND se.posting_date <= '{date_to}'"
        
    entries = frappe.db.sql(f"""
        SELECT DISTINCT se.name, se.posting_date, se.posting_time
        FROM `tabStock Entry` se
        JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
        WHERE se.docstatus = 1 AND se.stock_entry_type = 'Material Transfer'
        AND (
            (sed.s_warehouse = '{w1}' AND sed.t_warehouse = '{w2}') OR 
            (sed.s_warehouse = '{w2}' AND sed.t_warehouse = '{w1}')
        )
        {date_conditions}
        ORDER BY se.posting_date DESC, se.posting_time DESC
        LIMIT 100
    """, as_dict=1)
    
    for entry in entries:
        items = frappe.db.sql(f"""
            SELECT item_code, item_name, qty, s_warehouse
            FROM `tabStock Entry Detail`
            WHERE parent = '{entry.name}'
        """, as_dict=1)
        
        if items and items[0].get("s_warehouse") == w1:
            entry.direction = "Store to Forecourt"
        else:
            entry.direction = "Forecourt to Store"
            
        entry.items = items
        
    return entries


@frappe.whitelist()
def get_supplier_statement(station_id, card, date_from=None, date_to=None):
    if not station_id or not card:
        frappe.throw("Station ID and Supplier Card are required")
        
    # We want to fetch from Station Supplier Top Up
    # We might need to join with Shift Operation to filter by station
    # However, Station Supplier Top Up might not have station directly, it has 'shift'
    # Let's check Shift Operation first
    
    conditions = "docstatus = 1 AND card = %s"
    values = [card]
    
    if date_from:
        conditions += " AND date >= %s"
        values.append(date_from)
    if date_to:
        conditions += " AND date <= %s"
        values.append(date_to)
        
    # We need to ensure the shift belongs to this station
    # So we join
    
    sql = f"""
        SELECT t.name, t.date, t.shift, t.csa, t.rrn_number, t.mode_of_payment, t.amount
        FROM `tabStation Supplier Top Up` t
        JOIN `tabShift Operation` s ON t.shift = s.name
        WHERE {conditions} AND s.station = %s AND s.docstatus = 1
        ORDER BY t.date ASC, t.creation ASC
    """
    values.append(station_id)
    
    entries = frappe.db.sql(sql, values, as_dict=1)
    
    return entries


@frappe.whitelist()
def get_item_tax_and_tanks(item_code, station_id=None):
    from frappe.utils import flt
    
    # Get standard tax for item
    tax_rate = 0.0
    item = frappe.get_doc("Item", item_code)
    
    # Check Item Tax
    if item.taxes:
        for t in item.taxes:
            # Get the rate from Item Tax Template
            template = frappe.get_cached_doc("Item Tax Template", t.item_tax_template)
            for r in template.taxes:
                tax_rate = flt(r.tax_rate)
                break
            if tax_rate > 0:
                break
                
    # Get tanks if Fuel
    tanks = []
    if item.item_group == "Fuel":
        filters = {"fuel_product": item_code}
        if station_id:
            filters["station"] = station_id
        tanks = frappe.get_all("Fuel Tank", filters=filters, fields=["name", "tank_name", "capacity", "current_volume"])
        
    return {
        "tax_rate": tax_rate,
        "tanks": tanks
    }

@frappe.whitelist()
def get_past_shifts(start_date=None, end_date=None):
    filters = {'status': 'Closed'}
    if start_date and end_date:
        filters['shift_date'] = ['between', [start_date, end_date]]
    
    shifts = frappe.get_all('Shift', filters=filters, fields=['name', 'shift_date', 'head_csa'], order_by='shift_date desc')
    
    for s in shifts:
        cashier_name = frappe.db.get_value('Employee', s.head_csa, 'employee_name')
        s['cashier_name'] = cashier_name or s.head_csa

    return shifts


def on_borrowed_product_inserted(doc, method=None):
    """
    When a Borrowed Product is recorded, create a Stock Entry.
    Borrowed Out => Material Issue
    Borrowed In => Material Receipt
    """
    import frappe
    if not doc.items:
        return
        
    station = frappe.get_doc("Fuel Station", doc.station)
    # Both use Store Warehouse
    warehouse = station.default_store_warehouse
    
    if not warehouse:
        frappe.throw(f"Fuel Station {doc.station} is missing Default Store Warehouse.")
        
    purpose = "Material Issue" if doc.type == "Borrowed Out" else "Material Receipt"
    
    se = frappe.new_doc("Stock Entry")
    se.purpose = purpose
    se.stock_entry_type = purpose
    se.posting_date = doc.date
    se.posting_time = frappe.utils.nowtime()
    se.company = station.company if hasattr(station, "company") and station.company else frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
    
    for item in doc.items:
        if purpose == "Material Issue":
            se.append("items", {
                "item_code": item.item_code,
                "qty": item.qty,
                "s_warehouse": warehouse,
                "cost_center": frappe.defaults.get_user_default("Cost Center") or getattr(station, 'cost_center', None)
            })
        else:
            se.append("items", {
                "item_code": item.item_code,
                "qty": item.qty,
                "t_warehouse": warehouse,
                "cost_center": frappe.defaults.get_user_default("Cost Center") or getattr(station, 'cost_center', None)
            })
            
    se.insert()
    se.submit()
    
    doc.db_set("stock_entry", se.name)



@frappe.whitelist()
def return_borrowed_product(docname, return_date, returned_items):
    import frappe
    import json
    
    returned_items = json.loads(returned_items)
    doc = frappe.get_doc("Borrowed Product", docname)
    
    if doc.status == "Returned":
        frappe.throw("Already returned.")
        
    station = frappe.get_doc("Fuel Station", doc.station)
    warehouse = station.default_store_warehouse
    
    purpose = "Material Receipt" if doc.type == "Borrowed Out" else "Material Issue"
    
    se = frappe.new_doc("Stock Entry")
    se.purpose = purpose
    se.stock_entry_type = purpose
    se.posting_date = return_date
    se.posting_time = frappe.utils.nowtime()
    se.company = station.company if hasattr(station, "company") and station.company else frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
    
    has_items = False
    for r_item in returned_items:
        if float(r_item['qty']) > 0:
            has_items = True
            if purpose == "Material Issue":
                se.append("items", {
                    "item_code": r_item['item_code'],
                    "qty": float(r_item['qty']),
                    "s_warehouse": warehouse,
                    "cost_center": frappe.defaults.get_user_default("Cost Center") or getattr(station, 'cost_center', None)
                })
            else:
                se.append("items", {
                    "item_code": r_item['item_code'],
                    "qty": float(r_item['qty']),
                    "t_warehouse": warehouse,
                    "cost_center": frappe.defaults.get_user_default("Cost Center") or getattr(station, 'cost_center', None)
                })
                
    if not has_items:
        frappe.throw("No returned quantities provided.")
        
    se.insert(ignore_permissions=True)
    se.submit()
    
    # Check if partially returned
    is_partial = False
    for item in doc.items:
        returned_qty = next((float(r['qty']) for r in returned_items if r['item_code'] == item.item_code), 0)
        # We might want to keep track of total returned, but for now we just change status
        if returned_qty < item.qty:
            is_partial = True
            
    doc.db_set("return_stock_entry", se.name)
    doc.db_set("status", "Partially Returned" if is_partial else "Returned")
    return "success"

@frappe.whitelist()
def get_inventory_sales_history(station, from_date=None, to_date=None, search=None):
    import frappe
    # First get matching shifts
    shift_filters = {"station": station}
    if from_date and to_date:
        shift_filters["shift_date"] = ["between", [from_date, to_date]]
    elif from_date:
        shift_filters["shift_date"] = [">=", from_date]
    elif to_date:
        shift_filters["shift_date"] = ["<=", to_date]
        
    shifts = frappe.get_all("Shift", filters=shift_filters, fields=["name", "shift_date", "shift_template", "shift_name_display"])
    if not shifts:
        return []
        
    shift_map = {s.name: s for s in shifts}
    shift_names = list(shift_map.keys())
    
    # Now get the child records
    sale_filters = {"parent": ["in", shift_names], "parenttype": "Shift"}
    
    sales = frappe.get_all("Shift Inventory Sale", filters=sale_filters, fields=["name", "parent", "item", "quantity", "selling_price", "amount", "sold_by", "is_invoice_sale", "reference_invoice", "creation", "total_volume"])
    
    # Process and return
    result = []
    for s in sales:
        s_doc = shift_map.get(s.parent)
        s["shift_date"] = s_doc.shift_date if s_doc else ""
        s["shift_template"] = s_doc.shift_template if s_doc else ""
        s["shift_name_display"] = s_doc.shift_name_display if s_doc else s.parent
        
        # client side can filter search, or we do it here:
        if search:
            search_str = f"{s.item} {s.sold_by}".lower()
            if search.lower() not in search_str:
                continue
                
        result.append(s)
        
    # Sort by creation desc
    result.sort(key=lambda x: str(x.creation), reverse=True)
    return result


@frappe.whitelist()
def get_station_cards_history(station, from_date=None, to_date=None, card=None, csa=None):
    conditions = ["s.station = %s", "sc.docstatus < 2"]
    values = [station]
    
    if from_date:
        conditions.append("sc.date >= %s")
        values.append(from_date)
    if to_date:
        conditions.append("sc.date <= %s")
        values.append(to_date)
    if card:
        conditions.append("sc.card = %s")
        values.append(card)
    if csa:
        conditions.append("sc.csa = %s")
        values.append(csa)
        
    query = f"""
        SELECT 
            sc.name,
            sc.date,
            sc.creation,
            sc.card,
            sc.csa,
            sc.receipt_no,
            sc.amount,
            sc.memo,
            s.name as shift,
            s.shift_template as shift_template
        FROM `tabStation Cards` sc
        JOIN `tabShift` s ON sc.shift = s.name
        WHERE {' AND '.join(conditions)}
        ORDER BY sc.date DESC, sc.creation DESC
    """
    return frappe.db.sql(query, tuple(values), as_dict=True)

@frappe.whitelist()
def get_shift_invoices_history(station, from_date=None, to_date=None, customer=None):
    conditions = ["s.station = %s", "s.docstatus < 2"]
    values = [station]
    
    if from_date:
        conditions.append("s.shift_date >= %s")
        values.append(from_date)
    if to_date:
        conditions.append("s.shift_date <= %s")
        values.append(to_date)
    if customer:
        conditions.append("si.customer = %s")
        values.append(customer)
        
    query = f"""
        SELECT 
            si.name, si.parent as shift, s.shift_date, s.shift_template, si.customer,
            si.purchase_order, si.vehicle_registration, si.item,
            si.quantity, si.rate, si.amount, si.entry_number, si.csa
        FROM `tabShift Invoice` si
        JOIN `tabShift` s ON si.parent = s.name
        WHERE {' AND '.join(conditions)}
        ORDER BY si.creation DESC
        LIMIT {500 if (from_date or to_date) else 30}
    """
    return frappe.db.sql(query, values, as_dict=True)

@frappe.whitelist()
def get_customer_payments_history(station, from_date=None, to_date=None, customer=None):
    conditions = ["s.station = %s"]
    values = [station]
    
    if from_date:
        conditions.append("s.shift_date >= %s")
        values.append(from_date)
    if to_date:
        conditions.append("s.shift_date <= %s")
        values.append(to_date)
    if customer:
        conditions.append("cp.customer = %s")
        values.append(customer)
        
    query = f"""
        SELECT 
            cp.name, cp.shift, s.shift_date, s.shift_template, cp.customer,
            cp.csa, cp.mode_of_payment, cp.amount, cp.date, cp.creation
        FROM `tabCustomer Payment` cp
        JOIN `tabShift` s ON cp.shift = s.name
        WHERE {' AND '.join(conditions)}
        ORDER BY cp.creation DESC
        LIMIT {500 if (from_date or to_date) else 30}
    """
    return frappe.db.sql(query, values, as_dict=True)


@frappe.whitelist()
def get_topups_history(station=None, from_date=None, to_date=None):
    filters = []
    if station:
        filters.append(f"s.station = '{station}'")
    if from_date:
        filters.append(f"t.date >= '{from_date}'")
    if to_date:
        filters.append(f"t.date <= '{to_date}'")
        
    filter_cond = " AND ".join(filters)
    if filter_cond:
        filter_cond = " AND " + filter_cond
        
    sql = f'''
        SELECT 
            t.name, t.date, t.shift, t.creation, t.card, t.csa, 
            t.rrn_number, t.mode_of_payment, t.amount, s.shift_date, s.shift_template
        FROM `tabStation Supplier Top Up` t
        LEFT JOIN `tabShift` s ON t.shift = s.name
        WHERE t.docstatus < 2 {filter_cond}
        ORDER BY t.date DESC, t.creation DESC
        LIMIT {500 if (from_date or to_date) else 30}
    '''
    return frappe.db.sql(sql, as_dict=True)



