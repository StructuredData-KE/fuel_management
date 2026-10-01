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
        "rtt_deductions": 0.0,
        "discounts": 0.0,
        "discounts_breakdown": []
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
            SELECT s.name, IFNULL(it.item_name, s.item) as item, s.quantity, s.amount 
            FROM `tabShift Inventory Sale` s
            LEFT JOIN `tabItem` it ON s.item = it.name
            WHERE s.parent=%s AND s.parenttype='Shift' 
            AND (
                (s.sold_by=%s)
                OR (s.is_invoice_sale=0)
            )
            ORDER BY it.item_name ASC, s.item ASC
        """, (shift_id, csa_id), as_dict=True)
    else:
        inventory_data = frappe.db.sql("""
            SELECT s.name, IFNULL(it.item_name, s.item) as item, s.quantity, s.amount 
            FROM `tabShift Inventory Sale` s
            LEFT JOIN `tabItem` it ON s.item = it.name
            WHERE s.parent=%s AND s.parenttype='Shift' 
            AND s.sold_by=%s AND (s.is_invoice_sale IS NULL OR s.is_invoice_sale=1)
            ORDER BY it.item_name ASC, s.item ASC
        """, (shift_id, csa_id), as_dict=True)

    data["inventory_breakdown"] = inventory_data or []
    data["inventory_sales"] = sum([d.amount for d in inventory_data]) if inventory_data else 0.0
    
    # 3. Greasing Sales
    greasing_data = frappe.db.sql("""
        SELECT vehicle_type, total_amount as amount 
        FROM `tabShift Greasing Sale` 
        WHERE parent=%s AND parenttype='Shift' AND csa=%s
        ORDER BY vehicle_type ASC
    """, (shift_id, csa_id), as_dict=True)
    data["greasing_breakdown"] = greasing_data or []
    data["greasing_sales"] = sum([d.amount for d in greasing_data]) if greasing_data else 0.0
    
    # 4. Customer Payments (All customer payments count as liabilities for the CSA)
    from frappe.utils import flt
    cp_data = frappe.db.sql("""
        SELECT p.name, IFNULL(c.customer_name, p.customer) as customer, p.amount, p.mode_of_payment 
        FROM `tabCustomer Payment` p
        LEFT JOIN `tabCustomer` c ON p.customer = c.name
        WHERE p.shift=%s AND p.csa=%s AND p.docstatus=1 
        AND p.mode_of_payment IN ('Cash', 'M-Pesa', 'Mpesa')
        ORDER BY customer ASC
    """, (shift_id, csa_id), as_dict=True)
    
    if not cp_data:
        cp_data = frappe.db.sql("""
            SELECT p.name, IFNULL(c.customer_name, p.customer) as customer, p.amount, p.mode_of_payment 
            FROM `tabCustomer Payment` p
            LEFT JOIN `tabCustomer` c ON p.customer = c.name
            WHERE p.shift=%s AND p.csa=%s
            AND p.mode_of_payment IN ('Cash', 'M-Pesa', 'Mpesa')
            ORDER BY customer ASC
        """, (shift_id, csa_id), as_dict=True)
        
    data["customer_payments_breakdown"] = cp_data or []
    data["customer_payments"] = sum([flt(d.amount) for d in cp_data]) if cp_data else 0.0
        
    # 5. M-Pesa (Strictly from Till readings)
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
        ORDER BY sp.mpesa_till ASC
    """, (shift_id, shift_id, csa_id), as_dict=True)
    data["mpesa_breakdown"] = mpesa_data or []
    data["mpesa"] = sum([flt(d.amount) for d in mpesa_data]) if mpesa_data else 0.0

    # 6. Invoices
    invoices_data = frappe.db.sql("""
        SELECT i.name, IFNULL(c.customer_name, i.customer) as customer, IFNULL(it.item_name, i.item) as item, i.quantity, i.entry_number, i.amount 
        FROM `tabShift Invoice` i
        LEFT JOIN `tabCustomer` c ON i.customer = c.name
        LEFT JOIN `tabItem` it ON i.item = it.name
        WHERE i.parent=%s AND i.parenttype='Shift' AND i.csa=%s
        ORDER BY customer ASC, item ASC
    """, (shift_id, csa_id), as_dict=True)
    data["invoices_breakdown"] = invoices_data or []
    data["invoices"] = sum([flt(d.amount) for d in invoices_data]) if invoices_data else 0.0
    
    # 7. Cards (Strictly from Station Cards)
    cards_data = frappe.db.sql("""
        SELECT name, card as card_type, receipt_no, memo, amount 
        FROM `tabStation Cards` 
        WHERE shift=%s AND csa=%s
        ORDER BY card ASC
    """, (shift_id, csa_id), as_dict=True)
    data["cards_breakdown"] = cards_data or []
    data["cards"] = sum([flt(d.amount) for d in cards_data]) if cards_data else 0.0
    
    # 8. Expenses (Petty Cash & Station Expenses attributed to this CSA)
    petty_cash_data = frappe.db.sql("""
        SELECT name, category, expense_account, memo, amount, payee, csa
        FROM `tabStation Petty Cash Entry` 
        WHERE shift=%s AND (csa=%s OR csa IN (SELECT user_id FROM `tabEmployee` WHERE name=%s))
        ORDER BY creation DESC
    """, (shift_id, csa_id, csa_id), as_dict=True)
    
    # Also check legacy tabStation Expense
    legacy_expenses = frappe.db.sql("""
        SELECT name, category, '' as expense_account, memo, amount, '' as payee, csa
        FROM `tabStation Expense` 
        WHERE shift=%s AND (csa=%s OR csa IN (SELECT user_id FROM `tabEmployee` WHERE name=%s))
        ORDER BY creation DESC
    """, (shift_id, csa_id, csa_id), as_dict=True)
    
    all_expenses = (petty_cash_data or []) + (legacy_expenses or [])
    data["expenses_breakdown"] = all_expenses
    data["expenses"] = sum([flt(d.amount) for d in all_expenses]) if all_expenses else 0.0
    
    # 9. Discounts Relief (Discounts credited to this CSA's cash liability)
    discounts_data = frappe.db.sql("""
        SELECT i.name, IFNULL(c.customer_name, i.customer) as customer, IFNULL(it.item_name, i.item) as item, i.quantity, i.entry_number, i.discount_amount as amount, i.discount_reason, i.discount_csa, i.csa
        FROM `tabShift Invoice` i
        LEFT JOIN `tabCustomer` c ON i.customer = c.name
        LEFT JOIN `tabItem` it ON i.item = it.name
        WHERE i.parent=%s AND i.parenttype='Shift' 
        AND (i.discount_csa=%s OR (i.discount_csa IS NULL AND i.csa=%s) OR (i.discount_csa='' AND i.csa=%s))
        AND i.discount_amount > 0
        ORDER BY customer ASC, item ASC
    """, (shift_id, csa_id, csa_id, csa_id), as_dict=True)
    data["discounts_breakdown"] = discounts_data or []
    data["discounts"] = sum([flt(d.amount) for d in discounts_data]) if discounts_data else 0.0
    
    return data

@frappe.whitelist()
def get_shift_report_data(shift_id):
    recons = frappe.get_all("Shift Cash Reconciliation", filters={"shift": shift_id}, fields=["csa", "meter_sales", "inventory_sales", "greasing_sales", "invoices", "cards", "mpesa", "expenses", "rtt_deductions", "discounts", "expected_cash", "actual_cash", "variance"])
    
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
    
    # Petty Cash Breakdown for Shift Report
    petty_cash_breakdown = frappe.db.sql("""
        SELECT pc.category, pc.expense_account, pc.payee, pc.memo, pc.amount, IFNULL(e.employee_name, pc.csa) as csa_name
        FROM `tabStation Petty Cash Entry` pc
        LEFT JOIN `tabEmployee` e ON pc.csa = e.name
        WHERE pc.shift=%s
        ORDER BY pc.creation ASC
    """, (shift_id,), as_dict=True)
    petty_cash_total = sum([flt(p.amount) for p in petty_cash_breakdown]) if petty_cash_breakdown else 0.0
    
    return {
        "reconciliations": recons,
        "customer_payments_total": customer_payments_total,
        "customer_payments_breakdown": payments_breakdown,
        "topups_total": topups_total,
        "cards_breakdown": cards_breakdown,
        "invoices_breakdown": invoices_breakdown,
        "petty_cash_breakdown": petty_cash_breakdown,
        "petty_cash_total": petty_cash_total
    }

def ensure_grease_service_items():
    """
    Ensures that Item Group 'Greasing Services' exists,
    and every 'Grease Vehicle Type' has a matching Item and Item Price in 'Standard Selling'.
    Also ensures custom columns exist on tabShift Greasing Sale.
    """
    try:
        from frappe.utils import flt
        
        # 1. Ensure Item Group exists
        if not frappe.db.exists("Item Group", "Greasing Services"):
            try:
                ig = frappe.get_doc({
                    "doctype": "Item Group",
                    "item_group_name": "Greasing Services",
                    "parent_item_group": "All Item Groups",
                    "is_group": 0
                })
                ig.insert(ignore_permissions=True)
            except Exception:
                frappe.db.rollback()

        # 2. Check and add columns on tabShift Greasing Sale if missing
        try:
            columns = [c[0] for c in frappe.db.sql("DESCRIBE `tabShift Greasing Sale`")]
            if "is_invoice_sale" not in columns:
                frappe.db.sql("ALTER TABLE `tabShift Greasing Sale` ADD COLUMN `is_invoice_sale` INT(1) DEFAULT 0")
            if "reference_invoice" not in columns:
                frappe.db.sql("ALTER TABLE `tabShift Greasing Sale` ADD COLUMN `reference_invoice` VARCHAR(140) DEFAULT NULL")
            frappe.db.commit()
        except Exception:
            pass

        # 3. Fetch all Grease Vehicle Types and ensure Item & Item Price
        if frappe.db.exists("DocType", "Grease Vehicle Type"):
            types = frappe.get_all("Grease Vehicle Type", fields=["name", "vehicle_type", "greasing_price"])
            for t in types:
                vt_name = (t.vehicle_type or t.name).strip()
                code = f"Greasing - {vt_name}"
                name = code
                rate = flt(t.greasing_price)
                
                # Check / Create Item
                if not frappe.db.exists("Item", code):
                    try:
                        item_doc = frappe.get_doc({
                            "doctype": "Item",
                            "item_code": code,
                            "item_name": name,
                            "item_group": "Greasing Services",
                            "stock_uom": "Nos",
                            "is_stock_item": 0,
                            "is_sales_item": 1,
                            "standard_rate": rate
                        })
                        item_doc.insert(ignore_permissions=True)
                    except Exception:
                        frappe.db.rollback()
                else:
                    curr_group = frappe.db.get_value("Item", code, "item_group")
                    if curr_group != "Greasing Services":
                        frappe.db.set_value("Item", code, "item_group", "Greasing Services", update_modified=False)

                # Check / Create / Update Item Price
                ip_name = frappe.db.get_value("Item Price", {"item_code": code, "price_list": "Standard Selling"}, "name")
                if not ip_name:
                    try:
                        ip_doc = frappe.get_doc({
                            "doctype": "Item Price",
                            "item_code": code,
                            "price_list": "Standard Selling",
                            "price_list_rate": rate,
                            "currency": "KES"
                        })
                        ip_doc.insert(ignore_permissions=True)
                    except Exception:
                        frappe.db.rollback()
                else:
                    curr_rate = flt(frappe.db.get_value("Item Price", ip_name, "price_list_rate"))
                    if curr_rate != rate and rate > 0:
                        frappe.db.set_value("Item Price", ip_name, "price_list_rate", rate, update_modified=False)
            frappe.db.commit()
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "ensure_grease_service_items error")

@frappe.whitelist()
def get_active_item_prices():
    ensure_grease_service_items()
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
    
    stock_adj_account = frappe.get_cached_value("Company", company, "stock_adjustment_account")

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
            
        row_dict = {
            "item_code": r_item,
            "qty": r_qty,
            "s_warehouse": from_w,
            "t_warehouse": to_w
        }
        if stock_adj_account:
            row_dict["expense_account"] = stock_adj_account

        se.append("items", row_dict)
        
    if not se.items:
        frappe.throw("No valid items with quantity > 0")
        
    se.insert()
    se.submit()
    
    frappe.clear_messages()
    
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
def get_borrowed_products(station, status="All", from_date=None, to_date=None, counterparty=None, limit=None):
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
        
    limit_num = int(limit) if limit else (1000 if (from_date or to_date or counterparty or status != "All") else 20)
        
    records = frappe.get_all("Borrowed Product", 
        filters=filters,
        fields=["name", "date", "counterparty", "type", "status", "memo"],
        order_by="date desc, creation desc",
        limit_page_length=limit_num
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
def get_debtors_data():
    from frappe.utils import flt
    
    # 1. Invoices from Shift Invoices
    invoices = frappe.db.sql("""
        SELECT 
            si.customer, 
            SUM(si.amount) as total_invoiced
        FROM 
            `tabShift Invoice` si
        JOIN 
            `tabShift` s ON si.parent = s.name
        WHERE 
            s.docstatus < 2
        GROUP BY 
            si.customer
    """, as_dict=True)
    
    # 2. Payments from Customer Payment
    payments = frappe.db.sql("""
        SELECT 
            customer, 
            SUM(amount) as total_paid, 
            MAX(date) as last_payment_date
        FROM 
            `tabCustomer Payment`
        WHERE 
            docstatus < 2
        GROUP BY 
            customer
    """, as_dict=True)
    
    # 3. GL balances (excluding Shift Closure JEs)
    gl_balances = frappe.db.sql("""
        SELECT 
            party as customer,
            SUM(debit) as total_debit,
            SUM(credit) as total_credit
        FROM `tabGL Entry`
        WHERE party_type = 'Customer' AND is_cancelled = 0
        AND (remarks IS NULL OR (remarks NOT LIKE '%%Shift Closure Accounting%%' AND remarks NOT LIKE '%%Customer Payment Reference%%'))
        GROUP BY party
    """, as_dict=True)
    
    all_customers = frappe.db.get_all('Customer', 
        fields=['name', 'customer_name', 'credit_limit', 'email_id', 'mobile_no', 'primary_address', 'disabled'],
        order_by='customer_name asc'
    )
    
    customer_map = {c.name: c for c in all_customers}
    payment_map = {p.customer: p for p in payments}
    invoice_map = {i.customer: i for i in invoices}
    gl_map = {g.customer: flt(g.total_debit) - flt(g.total_credit) for g in gl_balances}
    
    all_cust_keys = set(customer_map.keys())
    for inv in invoices:
        if inv.customer:
            all_cust_keys.add(inv.customer)
    for pay in payments:
        if pay.customer:
            all_cust_keys.add(pay.customer)
    for gl in gl_balances:
        if gl.customer:
            all_cust_keys.add(gl.customer)
            
    results = []
    
    for cust in all_cust_keys:
        c_info = customer_map.get(cust, {})
        c_name = c_info.get('customer_name') if isinstance(c_info, dict) else cust
        credit_limit = flt(c_info.get('credit_limit') or 0.0) if isinstance(c_info, dict) else 0.0
        
        inv = invoice_map.get(cust, {})
        pay = payment_map.get(cust, {})
        opening_balance = gl_map.get(cust, 0.0)
        
        total_invoiced = flt(inv.get('total_invoiced', 0))
        total_paid = flt(pay.get('total_paid', 0))
        last_payment_date = pay.get('last_payment_date', None)
        
        balance = opening_balance + total_invoiced - total_paid
        
        status = 'Safe'
        if credit_limit > 0:
            if balance >= credit_limit:
                status = 'Overdue'
            elif balance >= 0.8 * credit_limit:
                status = 'Near Limit'
        elif balance > 0:
            status = 'Near Limit'
        elif balance < 0:
            status = 'In Advance'
        else:
            status = 'Settled'
            
        results.append({
            'id': cust,
            'name': c_name or cust,
            'fleet_id': cust, 
            'last_payment_date': str(last_payment_date) if last_payment_date else '',
            'total_invoiced': round(total_invoiced, 2),
            'total_paid': round(total_paid, 2),
            'opening_balance': round(opening_balance, 2),
            'balance': round(balance, 2),
            'status': status,
            'credit_limit': credit_limit
        })
        
    results.sort(key=lambda x: (x['balance'] == 0, -x['balance'], x['name']))
    return results

@frappe.whitelist()
def get_customer_transactions(customer_id=None, customer=None, **kwargs):
    cust_id = customer_id or customer or kwargs.get('customer') or kwargs.get('customer_id')
    if not cust_id:
        return []
    from frappe.utils import flt
    
    # 1. GL entries
    gl_entries = frappe.db.sql("""
        SELECT 
            posting_date as date,
            voucher_type as ref_type,
            voucher_no as reference,
            remarks as description,
            debit,
            credit
        FROM `tabGL Entry`
        WHERE party_type = 'Customer' 
        AND party = %s 
        AND is_cancelled = 0
        AND (remarks IS NULL OR (remarks NOT LIKE '%%Shift Closure Accounting%%' AND remarks NOT LIKE '%%Customer Payment Reference%%'))
        ORDER BY posting_date ASC, creation ASC
    """, cust_id, as_dict=True)
    
    # 2. Shift Invoices
    shift_invoices = frappe.db.sql("""
        SELECT 
            s.shift_date as date,
            si.name as reference,
            'Shift Invoice' as ref_type,
            si.vehicle_registration,
            si.purchase_order,
            si.item,
            si.quantity,
            si.rate,
            si.entry_number,
            si.csa,
            IFNULL(e.employee_name, si.csa) as csa_name,
            si.amount as debit,
            0.0 as credit,
            si.creation
        FROM `tabShift Invoice` si
        JOIN `tabShift` s ON si.parent = s.name
        LEFT JOIN `tabEmployee` e ON (si.csa = e.name OR si.csa = e.user_id)
        WHERE si.customer = %s AND s.docstatus < 2
        ORDER BY s.shift_date ASC, si.creation ASC
    """, cust_id, as_dict=True)
    
    # 3. Customer Payments
    payments = frappe.db.sql("""
        SELECT 
            p.date,
            p.name as reference,
            'Customer Payment' as ref_type,
            p.mode_of_payment,
            p.trans_no,
            p.csa,
            IFNULL(e.employee_name, p.csa) as csa_name,
            p.memo,
            0.0 as debit,
            p.amount as credit,
            p.creation
        FROM `tabCustomer Payment` p
        LEFT JOIN `tabEmployee` e ON (p.csa = e.name OR p.csa = e.user_id)
        WHERE p.customer = %s AND p.docstatus < 2
        ORDER BY p.date ASC, p.creation ASC
    """, cust_id, as_dict=True)
    
    all_raw = []
    
    for g in gl_entries:
        all_raw.append({
            'date': str(g.date),
            'ref_type': g.ref_type or 'GL Entry',
            'voucher_type': g.ref_type or 'GL Entry',
            'reference': g.reference or '',
            'reference_no': g.reference or '',
            'description': g.description or g.reference or 'General Ledger Entry',
            'type': 'GL Entry',
            'debit': flt(g.debit),
            'credit': flt(g.credit),
            'sort_key': f"{g.date}_1"
        })
        
    for si in shift_invoices:
        desc_parts = []
        if si.vehicle_registration:
            desc_parts.append(f"Veh: {si.vehicle_registration}")
        if si.item:
            qty_str = f"{flt(si.quantity):,.1f}L" if si.quantity else ""
            rate_str = f"@ KES {flt(si.rate):,.2f}" if si.rate else ""
            desc_parts.append(f"{si.item} ({qty_str} {rate_str})".strip())
        if si.purchase_order:
            desc_parts.append(f"PO: {si.purchase_order}")
        csa_display = si.csa_name or si.csa or ''
        if csa_display:
            desc_parts.append(f"CSA: {csa_display}")
            
        desc = " | ".join(desc_parts) if desc_parts else "Fuel Sale Invoice"
        
        all_raw.append({
            'date': str(si.date),
            'ref_type': 'Shift Invoice',
            'voucher_type': 'Shift Invoice',
            'reference': si.reference,
            'reference_no': si.entry_number or si.reference,
            'entry_number': si.entry_number or '',
            'vehicle_registration': si.vehicle_registration or '',
            'item': si.item or '',
            'quantity': flt(si.quantity),
            'rate': flt(si.rate),
            'csa': csa_display,
            'csa_id': si.csa or '',
            'purchase_order': si.purchase_order or '',
            'description': desc,
            'type': 'Invoice',
            'debit': flt(si.debit),
            'credit': 0.0,
            'sort_key': f"{si.date}_2"
        })
        
    for p in payments:
        desc_parts = []
        if p.mode_of_payment:
            desc_parts.append(f"Mode: {p.mode_of_payment}")
        if p.trans_no:
            desc_parts.append(f"Ref: {p.trans_no}")
        if p.memo:
            desc_parts.append(f"Memo: {p.memo}")
        csa_display = p.csa_name or p.csa or ''
        if csa_display:
            desc_parts.append(f"Received By: {csa_display}")
            
        desc = " | ".join(desc_parts) if desc_parts else "Payment Received"
        
        all_raw.append({
            'date': str(p.date),
            'ref_type': 'Customer Payment',
            'voucher_type': 'Customer Payment',
            'reference': p.reference,
            'reference_no': p.trans_no or p.reference,
            'trans_no': p.trans_no or '',
            'mode_of_payment': p.mode_of_payment or '',
            'csa': csa_display,
            'csa_id': p.csa or '',
            'memo': p.memo or '',
            'description': desc,
            'type': 'Payment',
            'debit': 0.0,
            'credit': flt(p.credit),
            'sort_key': f"{p.date}_3"
        })
        
    all_raw.sort(key=lambda x: x['sort_key'])
    return all_raw

@frappe.whitelist()
def get_detailed_customer_statement(customer_id=None, customer=None, start_date=None, end_date=None, **kwargs):
    from frappe.utils import getdate, nowdate, flt
    cust_id = customer_id or customer or kwargs.get('customer') or kwargs.get('customer_id')
    if not cust_id:
        return {}
        
    if not start_date or not end_date:
        today = getdate(nowdate())
        if not start_date:
            start_date = f"{today.year}-{today.month:02d}-01"
        if not end_date:
            end_date = str(today)
            
    # 1. Customer metadata
    cust_doc = frappe.db.get_value("Customer", cust_id, 
        ["name", "customer_name", "tax_id", "email_id", "mobile_no", "primary_address", "credit_limit"], 
        as_dict=True
    ) or {"name": cust_id, "customer_name": cust_id}
    
    all_raw = get_customer_transactions(cust_id)
    
    opening_bal = 0.0
    period_txns = []
    
    for t in all_raw:
        t_date = t['date']
        if t_date < start_date:
            opening_bal += (t['debit'] - t['credit'])
        elif start_date <= t_date <= end_date:
            period_txns.append(t)
            
    running = opening_bal
    tot_debits = 0.0
    tot_credits = 0.0
    tot_litres = 0.0
    
    for pt in period_txns:
        running += (pt['debit'] - pt['credit'])
        pt['running_balance'] = round(running, 2)
        pt['balance'] = round(running, 2)
        tot_debits += pt['debit']
        tot_credits += pt['credit']
        if pt.get('quantity') and flt(pt.get('quantity')) > 0:
            tot_litres += flt(pt['quantity'])
        
    return {
        'customer': {
            'id': cust_id,
            'name': cust_doc.get('customer_name') or cust_id,
            'tax_id': cust_doc.get('tax_id') or '',
            'email': cust_doc.get('email_id') or '',
            'phone': cust_doc.get('mobile_no') or '',
            'address': cust_doc.get('primary_address') or '',
            'credit_limit': flt(cust_doc.get('credit_limit') or 0.0)
        },
        'start_date': start_date,
        'end_date': end_date,
        'opening_balance': round(opening_bal, 2),
        'period_debits': round(tot_debits, 2),
        'period_invoices': round(tot_debits, 2),
        'period_credits': round(tot_credits, 2),
        'period_payments': round(tot_credits, 2),
        'period_net': round(tot_debits - tot_credits, 2),
        'total_litres': round(tot_litres, 2),
        'closing_balance': round(running, 2),
        'transactions': period_txns
    }

@frappe.whitelist()
def get_debtors_aging_analysis(as_of_date=None, **kwargs):
    from frappe.utils import getdate, nowdate, flt
    date_val = as_of_date or kwargs.get('date') or kwargs.get('as_of_date')
    if not date_val:
        as_of_date = getdate(nowdate())
    else:
        as_of_date = getdate(date_val)
        
    debtors = get_debtors_data()
    aging_results = []
    
    tot_current = 0.0
    tot_30_60 = 0.0
    tot_60_90 = 0.0
    tot_90_120 = 0.0
    tot_over_120 = 0.0
    tot_balance = 0.0
    
    for d in debtors:
        cust_id = d['id']
        cust_name = d['name']
        balance = flt(d['balance'])
        credit_limit = flt(d.get('credit_limit', 0.0))
        
        txns = get_customer_transactions(cust_id)
        
        b_0_30 = 0.0
        b_31_60 = 0.0
        b_61_90 = 0.0
        b_91_120 = 0.0
        b_120_plus = 0.0
        
        if balance > 0:
            debits = [t for t in txns if flt(t.get('debit', 0)) > 0]
            debits.sort(key=lambda x: str(x.get('date', '')), reverse=True)
            
            rem_balance = balance
            for deb in debits:
                if rem_balance <= 0:
                    break
                deb_amt = flt(deb.get('debit', 0))
                deb_date = getdate(deb.get('date') or nowdate())
                days_old = (as_of_date - deb_date).days
                
                alloc_amt = min(deb_amt, rem_balance)
                rem_balance -= alloc_amt
                
                if days_old <= 30:
                    b_0_30 += alloc_amt
                elif days_old <= 60:
                    b_31_60 += alloc_amt
                elif days_old <= 90:
                    b_61_90 += alloc_amt
                elif days_old <= 120:
                    b_91_120 += alloc_amt
                else:
                    b_120_plus += alloc_amt
                    
            if rem_balance > 0:
                b_120_plus += rem_balance
        elif balance < 0:
            b_0_30 = balance
            
        tot_current += b_0_30
        tot_30_60 += b_31_60
        tot_60_90 += b_61_90
        tot_90_120 += b_91_120
        tot_over_120 += b_120_plus
        tot_balance += balance
        
        risk = "Current"
        risk_color = "green"
        if b_120_plus > 0 or b_91_120 > 0:
            risk = "Critical (90+ Days)"
            risk_color = "red"
        elif b_61_90 > 0:
            risk = "Overdue (61-90 Days)"
            risk_color = "orange"
        elif b_31_60 > 0:
            risk = "Watchlist (31-60 Days)"
            risk_color = "amber"
        elif balance <= 0:
            risk = "Settled"
            risk_color = "emerald"
            
        aging_results.append({
            'id': cust_id,
            'name': cust_name,
            'fleet_id': d.get('fleet_id', cust_id),
            'credit_limit': credit_limit,
            'last_payment_date': d.get('last_payment_date', ''),
            'total_balance': round(balance, 2),
            'current_0_30': round(b_0_30, 2),
            'aging_31_60': round(b_31_60, 2),
            'aging_61_90': round(b_61_90, 2),
            'aging_91_120': round(b_91_120, 2),
            'aging_120_plus': round(b_120_plus, 2),
            'risk_status': risk,
            'risk_color': risk_color
        })
        
    aging_results.sort(key=lambda x: x['total_balance'], reverse=True)
    
    return {
        'as_of_date': str(as_of_date),
        'summary': {
            'total_balance': round(tot_balance, 2),
            'current_0_30': round(tot_current, 2),
            'aging_31_60': round(tot_30_60, 2),
            'aging_61_90': round(tot_60_90, 2),
            'aging_91_120': round(tot_90_120, 2),
            'aging_120_plus': round(tot_over_120, 2),
            'total_debtors_count': len(debtors),
            'overdue_debtors_count': len([r for r in aging_results if (r['aging_31_60'] + r['aging_61_90'] + r['aging_91_120'] + r['aging_120_plus']) > 0.01])
        },
        'rows': aging_results
    }



from frappe.utils import today, add_days, get_first_day, get_last_day, getdate, cint, flt
import re
import json

def clear_homepage_cache(station=None):
    try:
        if station:
            frappe.cache().delete_keys(f"fm_hp_data:{station}:*")
        else:
            frappe.cache().delete_keys("fm_hp_data:*")
    except Exception:
        pass

@frappe.whitelist()
def get_active_shift(station=None):
    if not station:
        station = frappe.db.get_value("Fuel Station", {}, "name") or "RUBIS POA PLACE"
    shifts = frappe.db.sql("""
        SELECT name, station, head_csa, shift_template, shift_date, status, creation, report_sent
        FROM `tabShift`
        WHERE status = 'Open' AND station = %s AND docstatus != 2
        ORDER BY creation DESC LIMIT 1
    """, (station,), as_dict=True)
    return shifts[0] if shifts else None

@frappe.whitelist()
def get_homepage_data(station=None, shift_id=None, from_date=None, to_date=None, force_refresh=0):
    """
    Consolidated, ultra-fast endpoint for the homepage.
    Returns Monthly Volume Snapshot (Litres & KGs, not KSh),
    Active / Selected Shift Volumes, Live Tank Levels, 7-Day Trend, and Recent Activity.
    Cached via Redis for instant sub-millisecond retrieval.
    """
    if not station:
        station = frappe.db.get_value("Fuel Station", {}, "name") or "RUBIS POA PLACE"
        
    cache_key = f"fm_hp_data:{station}:{shift_id or ''}:{from_date or ''}:{to_date or ''}"
    if not cint(force_refresh):
        try:
            cached = frappe.cache().get_value(cache_key)
            if cached:
                if isinstance(cached, str):
                    return json.loads(cached)
                elif isinstance(cached, dict):
                    return cached
        except Exception:
            pass

    is_date_range = bool(from_date and to_date)
    
    # 1. Context Shift / Period Resolution (Direct fast SQL)
    if is_date_range:
        context_date = f"{from_date} to {to_date}"
        context_shift = "Multiple Shifts"
        context_status = "Date Range"
        context_creation = None
        target_date = from_date
    elif shift_id:
        shift_row = frappe.db.sql("""
            SELECT name, shift_date, creation, status
            FROM `tabShift`
            WHERE name = %s LIMIT 1
        """, (shift_id,), as_dict=True)
        if shift_row:
            shift = shift_row[0]
            context_date = shift.shift_date
            context_shift = shift.name
            context_status = shift.status
            context_creation = shift.creation
            target_date = shift.shift_date
        else:
            context_date = today()
            context_shift = None
            context_status = None
            context_creation = None
            target_date = today()
    else:
        shift_row = frappe.db.sql("""
            SELECT name, shift_date, creation, status
            FROM `tabShift`
            WHERE station = %s AND docstatus != 2
            ORDER BY creation DESC LIMIT 1
        """, (station,), as_dict=True)
        if shift_row:
            shift = shift_row[0]
            context_date = shift.shift_date
            context_shift = shift.name
            context_status = shift.status
            context_creation = shift.creation
            target_date = shift.shift_date
        else:
            context_date = today()
            context_shift = None
            context_status = None
            context_creation = None
            target_date = today()

    # 2. Monthly Volume Snapshot (Litres and KGs for the month)
    target_dt = getdate(target_date)
    start_of_month = get_first_day(target_date)
    end_of_month = get_last_day(target_date)
    month_label = target_dt.strftime("%B %Y")
    
    # Monthly Fuel Volumes (Petrol, Diesel, Total Litres)
    month_fuel_rows = frappe.db.sql("""
        SELECT tank.fuel_product, SUM(child.sales_quantity_electronic) as qty
        FROM `tabPump Meter Reading` child
        JOIN `tabPump Nozzle` nozzle ON child.pump_nozzle = nozzle.name
        JOIN `tabFuel Tank` tank ON nozzle.fuel_tank = tank.name
        JOIN `tabShift` parent ON child.parent = parent.name
        WHERE parent.station = %s AND parent.shift_date >= %s AND parent.shift_date <= %s AND parent.docstatus != 2
        GROUP BY tank.fuel_product
    """, (station, start_of_month, end_of_month), as_dict=True)
    
    monthly_fuel_breakdown = {}
    monthly_petrol = 0.0
    monthly_diesel = 0.0
    monthly_kerosene = 0.0
    
    for row in month_fuel_rows:
        prod = row.fuel_product or "Unknown"
        qty = float(row.qty or 0.0)
        monthly_fuel_breakdown[prod] = qty
        p_upper = prod.upper()
        if "PETROL" in p_upper or "PMS" in p_upper or "SUPER" in p_upper:
            monthly_petrol += qty
        elif "DIESEL" in p_upper or "AGO" in p_upper:
            monthly_diesel += qty
        elif "KEROSENE" in p_upper or "IK" in p_upper:
            monthly_kerosene += qty
            
    monthly_total_fuel = sum(monthly_fuel_breakdown.values())
    
    # Monthly Lubes and Gas Volumes (KGs and Litres)
    month_inv_rows = frappe.db.sql("""
        SELECT item.item_group, item.item_name, SUM(child.quantity) as qty
        FROM `tabShift Inventory Sale` child
        JOIN `tabItem` item ON child.item = item.name
        JOIN `tabShift` parent ON child.parent = parent.name
        WHERE parent.station = %s AND parent.shift_date >= %s AND parent.shift_date <= %s AND parent.docstatus != 2
        GROUP BY item.item_name, item.item_group
    """, (station, start_of_month, end_of_month), as_dict=True)
    
    monthly_lubes_qty = 0.0
    monthly_gas_kgs = 0.0
    monthly_gas_cylinders = 0
    monthly_gas_breakdown = {}
    
    for sale in month_inv_rows:
        grp = (sale.item_group or "").lower()
        iname = sale.item_name or ""
        qty = float(sale.qty or 0.0)
        
        if "lube" in grp or "lubricant" in grp or "oil" in grp:
            match_litres = re.search(r'(\d+(?:\.\d+)?)\s*L', iname, re.IGNORECASE)
            litres_per_unit = float(match_litres.group(1)) if match_litres else 1.0
            monthly_lubes_qty += (qty * litres_per_unit)
        elif "gas" in grp or "lpg" in grp:
            monthly_gas_cylinders += int(qty)
            match = re.search(r'(\d+)KG', iname, re.IGNORECASE)
            kg_per_cyl = int(match.group(1)) if match else 0
            kg_total = qty * kg_per_cyl
            monthly_gas_breakdown[iname] = monthly_gas_breakdown.get(iname, 0) + kg_total
            monthly_gas_kgs += kg_total

    # 3. Current Shift / Selected Period Volume Data
    fuel_breakdown = {}
    if is_date_range:
        fuel_data = frappe.db.sql("""
            SELECT tank.fuel_product, SUM(child.sales_quantity_electronic) as qty
            FROM `tabPump Meter Reading` child
            JOIN `tabPump Nozzle` nozzle ON child.pump_nozzle = nozzle.name
            JOIN `tabFuel Tank` tank ON nozzle.fuel_tank = tank.name
            JOIN `tabShift` parent ON child.parent = parent.name
            WHERE parent.station = %s AND parent.shift_date >= %s AND parent.shift_date <= %s AND parent.docstatus != 2
            GROUP BY tank.fuel_product
        """, (station, from_date, to_date), as_dict=True)
        for row in fuel_data:
            if row.fuel_product:
                fuel_breakdown[row.fuel_product] = float(row.qty or 0.0)
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
                fuel_breakdown[row.fuel_product] = float(row.qty or 0.0)
    
    litres_sold = sum(fuel_breakdown.values())
    
    shift_lubes_qty = 0.0
    shift_gas_kgs = 0.0
    shift_cylinders = 0
    shift_gas_breakdown = {}
    top_selling_item = "None"
    top_selling_qty = 0
    
    inv_sales = []
    if is_date_range:
        inv_sales = frappe.db.sql("""
            SELECT item.item_group, item.item_name, SUM(child.quantity) as qty
            FROM `tabShift Inventory Sale` child
            JOIN `tabItem` item ON child.item = item.name
            JOIN `tabShift` parent ON child.parent = parent.name
            WHERE parent.station = %s AND parent.shift_date >= %s AND parent.shift_date <= %s AND parent.docstatus != 2
            GROUP BY item.item_name, item.item_group
        """, (station, from_date, to_date), as_dict=True)
    elif context_shift and context_shift != "Multiple Shifts":
        inv_sales = frappe.db.sql("""
            SELECT item.item_group, item.item_name, SUM(child.quantity) as qty
            FROM `tabShift Inventory Sale` child
            JOIN `tabItem` item ON child.item = item.name
            WHERE child.parent = %s
            GROUP BY item.item_name, item.item_group
        """, (context_shift,), as_dict=True)
        
    if inv_sales:
        for sale in inv_sales:
            group = (sale.item_group or "").lower()
            iname = sale.item_name or ""
            qty = float(sale.qty or 0.0)
            if "lube" in group or "lubricant" in group or "oil" in group:
                match_litres = re.search(r'(\d+(?:\.\d+)?)\s*L', iname, re.IGNORECASE)
                litres_per_unit = float(match_litres.group(1)) if match_litres else 1.0
                shift_lubes_qty += (qty * litres_per_unit)
            elif "gas" in group or "lpg" in group:
                shift_cylinders += int(qty)
                match = re.search(r'(\d+)KG', iname, re.IGNORECASE)
                kg_per_cyl = int(match.group(1)) if match else 0
                kg_tot = qty * kg_per_cyl
                shift_gas_breakdown[iname] = shift_gas_breakdown.get(iname, 0) + kg_tot
                shift_gas_kgs += kg_tot
                
            if qty > top_selling_qty:
                top_selling_qty = qty
                top_selling_item = iname

    # 4. Tank Levels (Direct fast SQL)
    tanks = frappe.db.sql("""
        SELECT name as tank_name, fuel_product, capacity, current_volume, reorder_threshold, variance_tolerance
        FROM `tabFuel Tank`
        WHERE station = %s
    """, (station,), as_dict=True)
    
    tank_names = [t.tank_name for t in tanks]
    latest_dips = {}
    if tank_names:
        placeholders = ', '.join(['%s'] * len(tank_names))
        dips = frappe.db.sql(f"""
            SELECT child.fuel_tank, child.closing_dip as reading, parent.shift_date as posting_date, parent.end_time as posting_time, child.variance
            FROM `tabDip Stick Reading` child
            JOIN `tabShift` parent ON child.parent = parent.name
            WHERE child.fuel_tank IN ({placeholders}) AND parent.docstatus != 2 AND child.closing_dip > 0
            ORDER BY parent.shift_date DESC, parent.creation DESC
            LIMIT 50
        """, tuple(tank_names), as_dict=True)
        for d in dips:
            if d.fuel_tank not in latest_dips:
                latest_dips[d.fuel_tank] = d

    tank_list = []
    dip_flags = 0
    for t in tanks:
        latest_dip = latest_dips.get(t.tank_name)
        dip_val = float(latest_dip.reading if latest_dip and latest_dip.reading is not None else (t.current_volume or 0.0))
        variance = float(latest_dip.variance if latest_dip and latest_dip.variance is not None else 0.0)
        ts = f"{latest_dip.posting_date} {latest_dip.posting_time or ''}".strip() if latest_dip else ""
        
        cap = float(t.capacity or 0.0)
        pct = (dip_val / cap * 100.0) if cap > 0 else 0.0
        
        status = "Normal"
        if t.variance_tolerance and abs(variance) > t.variance_tolerance:
            status = "Variance flagged"
            dip_flags += 1
        elif t.reorder_threshold and pct <= t.reorder_threshold:
            status = "Low"
            
        tank_list.append({
            "name": t.tank_name,
            "product": t.fuel_product or t.tank_name,
            "capacity": cap,
            "latest_dip": dip_val,
            "percent_full": round(pct, 1),
            "reorder_threshold": t.reorder_threshold or 15,
            "variance": variance,
            "status": status,
            "timestamp": ts
        })

    # 5. 7-Day Trend
    start_trend_date = add_days(today(), -6)
    meters_trend = frappe.db.sql("""
        SELECT parent.shift_date as posting_date, tank.fuel_product, SUM(child.sales_quantity_electronic) as qty
        FROM `tabPump Meter Reading` child
        JOIN `tabPump Nozzle` nozzle ON child.pump_nozzle = nozzle.name
        JOIN `tabFuel Tank` tank ON nozzle.fuel_tank = tank.name
        JOIN `tabShift` parent ON child.parent = parent.name
        WHERE parent.station = %s AND parent.shift_date >= %s AND parent.docstatus != 2
        GROUP BY parent.shift_date, tank.fuel_product
    """, (station, start_trend_date), as_dict=True)
    
    trend = {}
    for i in range(7):
        dt = str(add_days(start_trend_date, i))
        trend[dt] = {"Petrol": 0.0, "Diesel": 0.0}
        
    mix = {"Petrol": 0.0, "Diesel": 0.0, "Kerosene": 0.0, "Lubricants": 0.0}
    
    for m in meters_trend:
        dt = str(m.posting_date)
        prod = (m.fuel_product or "").upper()
        qty = float(m.qty or 0.0)
        
        if dt in trend:
            if "PETROL" in prod or "PMS" in prod or "SUPER" in prod:
                trend[dt]["Petrol"] += qty
            elif "DIESEL" in prod or "AGO" in prod:
                trend[dt]["Diesel"] += qty
                
        if "PETROL" in prod or "PMS" in prod or "SUPER" in prod:
            mix["Petrol"] += qty
        elif "DIESEL" in prod or "AGO" in prod:
            mix["Diesel"] += qty
        elif "KEROSENE" in prod or "IK" in prod:
            mix["Kerosene"] += qty
        else:
            mix["Lubricants"] += qty
            
    trend_dates = list(trend.keys())
    trend_dates.sort()
    
    # 6. Activity (Direct fast SQL)
    shifts_act = frappe.db.sql("""
        SELECT name, creation, shift_template, status
        FROM `tabShift`
        WHERE station = %s AND docstatus != 2
        ORDER BY creation DESC LIMIT 3
    """, (station,), as_dict=True)

    meters_act = frappe.db.sql("""
        SELECT child.name, child.creation, child.pump_nozzle, child.sales_quantity_electronic
        FROM `tabPump Meter Reading` child
        JOIN `tabShift` parent ON child.parent = parent.name
        WHERE parent.station = %s AND parent.docstatus != 2
        ORDER BY child.creation DESC LIMIT 3
    """, (station,), as_dict=True)

    dips_act = frappe.db.sql("""
        SELECT child.name, child.creation, child.fuel_tank, child.variance
        FROM `tabDip Stick Reading` child
        JOIN `tabShift` parent ON child.parent = parent.name
        WHERE parent.station = %s AND parent.docstatus != 2
        ORDER BY child.creation DESC LIMIT 3
    """, (station,), as_dict=True)
    
    activity = []
    for s in shifts_act:
        activity.append({"time": str(s.creation), "msg": f"Shift {s.name} ({s.shift_template or 'Shift'}) - {s.status}.", "type": "shift"})
    for m in meters_act:
        activity.append({"time": str(m.creation), "msg": f"Meter reading for {m.pump_nozzle}: {m.sales_quantity_electronic or 0} L.", "type": "meter"})
    for d in dips_act:
        status_txt = "variance flagged" if abs(d.variance or 0) > 50 else "normal"
        activity.append({"time": str(d.creation), "msg": f"Dip reading for {d.fuel_tank} ({status_txt}).", "type": "dip", "variance": d.variance})
        
    activity.sort(key=lambda x: x["time"], reverse=True)

    res = {
        "station": station,
        "month_label": month_label,
        "monthly": {
            "total_litres": round(monthly_total_fuel, 2),
            "petrol_litres": round(monthly_petrol, 2),
            "diesel_litres": round(monthly_diesel, 2),
            "kerosene_litres": round(monthly_kerosene, 2),
            "fuel_breakdown": monthly_fuel_breakdown,
            "lubes_litres": round(monthly_lubes_qty, 2),
            "gas_kgs": round(monthly_gas_kgs, 1),
            "gas_cylinders": monthly_gas_cylinders,
            "gas_breakdown": monthly_gas_breakdown
        },
        "kpis": {
            "context_shift": context_shift,
            "context_date": str(context_date),
            "context_status": context_status,
            "context_creation": str(context_creation) if context_creation else "",
            "litres_sold": round(litres_sold, 2),
            "fuel_breakdown": fuel_breakdown,
            "lubes_qty": round(shift_lubes_qty, 2),
            "gas_qty": round(shift_gas_kgs, 1),
            "gas_breakdown": shift_gas_breakdown,
            "cylinders_sold": shift_cylinders,
            "top_selling_item": top_selling_item,
            "top_selling_qty": top_selling_qty,
            "cash_reconciled": 0.0,
            "mpesa_posted": 0.0,
            "dip_flags": dip_flags
        },
        "tanks": tank_list,
        "trend": {
            "trend_dates": trend_dates,
            "trend_petrol": [round(trend[d]["Petrol"], 2) for d in trend_dates],
            "trend_diesel": [round(trend[d]["Diesel"], 2) for d in trend_dates],
            "fuel_mix": {k: round(v, 2) for k, v in mix.items()}
        },
        "activity": activity[:8]
    }

    try:
        frappe.cache().set_value(cache_key, json.dumps(res, default=str), expires_in_sec=60)
    except Exception:
        pass

    return res

@frappe.whitelist()
def get_daily_sales_breakdown(station=None, from_date=None, to_date=None, month=None, year=None):
    """
    Returns day-by-day daily sales breakdown for wetstock fuel (PMS, AGO, IK),
    drystock (Lubes, LPG Gas, Store), shift counts, and sales revenues for each date.
    """
    from datetime import timedelta

    if not station:
        station = frappe.db.get_value("Fuel Station", {}, "name") or "RUBIS POA PLACE"

    # Resolve date range
    if month and year:
        from_date = f"{year}-{int(month):02d}-01"
        to_date = get_last_day(from_date)
    elif not from_date or not to_date:
        ref_date = today()
        from_date = get_first_day(ref_date)
        to_date = get_last_day(ref_date)

    start_dt = getdate(from_date)
    end_dt = getdate(to_date)
    month_label = start_dt.strftime("%B %Y") if (start_dt.month == end_dt.month and start_dt.year == end_dt.year) else f"{start_dt.strftime('%d %b %Y')} - {end_dt.strftime('%d %b %Y')}"

    # Standard Selling item prices cache for PMS, AGO, IK, etc.
    price_records = frappe.get_all("Item Price", filters={"price_list": "Standard Selling"}, fields=["item_code", "price_list_rate"])
    item_prices = {p.item_code: flt(p.price_list_rate) for p in price_records}

    # Helper to lookup price for fuel product
    def get_fuel_price(product_name):
        if not product_name:
            return 0.0
        if product_name in item_prices:
            return item_prices[product_name]
        p_up = product_name.upper()
        for k, v in item_prices.items():
            k_up = k.upper()
            if ("PETROL" in p_up or "PMS" in p_up or "SUPER" in p_up) and ("PETROL" in k_up or "PMS" in k_up or "SUPER" in k_up):
                return v
            if ("DIESEL" in p_up or "AGO" in p_up) and ("DIESEL" in k_up or "AGO" in k_up):
                return v
            if ("KEROSENE" in p_up or "IK" in p_up) and ("KEROSENE" in k_up or "IK" in k_up):
                return v
        return 0.0

    # 1. Query Pump Meter Readings by Shift Date & Product
    meter_rows = frappe.db.sql("""
        SELECT 
            parent.shift_date as date,
            tank.fuel_product,
            SUM(child.sales_quantity_electronic) as qty
        FROM `tabPump Meter Reading` child
        JOIN `tabPump Nozzle` nozzle ON child.pump_nozzle = nozzle.name
        JOIN `tabFuel Tank` tank ON nozzle.fuel_tank = tank.name
        JOIN `tabShift` parent ON child.parent = parent.name
        WHERE parent.station = %s 
          AND parent.shift_date >= %s 
          AND parent.shift_date <= %s 
          AND parent.docstatus != 2
        GROUP BY parent.shift_date, tank.fuel_product
    """, (station, from_date, to_date), as_dict=True)

    # 2. Query Shift Inventory Sales (Lubes, LPG, Shop) by Shift Date & Item
    inv_rows = frappe.db.sql("""
        SELECT 
            parent.shift_date as date,
            item.item_group,
            item.item_name,
            SUM(child.quantity) as qty,
            SUM(child.amount) as amount
        FROM `tabShift Inventory Sale` child
        JOIN `tabItem` item ON child.item = item.name
        JOIN `tabShift` parent ON child.parent = parent.name
        WHERE parent.station = %s 
          AND parent.shift_date >= %s 
          AND parent.shift_date <= %s 
          AND parent.docstatus != 2
        GROUP BY parent.shift_date, item.item_name, item.item_group
    """, (station, from_date, to_date), as_dict=True)

    # 3. Query Shifts by Date
    shift_rows = frappe.db.sql("""
        SELECT 
            name,
            shift_date as date,
            shift_template,
            status,
            creation
        FROM `tabShift`
        WHERE station = %s 
          AND shift_date >= %s 
          AND shift_date <= %s 
          AND docstatus != 2
        ORDER BY shift_date ASC, creation ASC
    """, (station, from_date, to_date), as_dict=True)

    # 4. Map raw rows by date string
    daily_fuel = {}
    for r in meter_rows:
        dt_str = str(r.date)
        if dt_str not in daily_fuel:
            daily_fuel[dt_str] = {}
        prod = r.fuel_product or "Unknown"
        daily_fuel[dt_str][prod] = daily_fuel[dt_str].get(prod, 0.0) + float(r.qty or 0.0)

    daily_inv = {}
    for r in inv_rows:
        dt_str = str(r.date)
        if dt_str not in daily_inv:
            daily_inv[dt_str] = []
        daily_inv[dt_str].append(r)

    daily_shifts = {}
    for s in shift_rows:
        dt_str = str(s.date)
        if dt_str not in daily_shifts:
            daily_shifts[dt_str] = []
        daily_shifts[dt_str].append(s)

    # 5. Generate complete date sequence
    current_dt = start_dt
    days_list = []
    
    tot_pms_l = 0.0
    tot_ago_l = 0.0
    tot_ik_l = 0.0
    tot_fuel_l = 0.0
    tot_lubes_l = 0.0
    tot_gas_kg = 0.0
    tot_gas_cyl = 0
    tot_fuel_rev = 0.0
    tot_lubes_rev = 0.0
    tot_gas_rev = 0.0
    tot_station_rev = 0.0
    active_days_count = 0

    while current_dt <= end_dt:
        dt_str = str(current_dt)
        day_fuels = daily_fuel.get(dt_str, {})
        day_invs = daily_inv.get(dt_str, [])
        day_shifts = daily_shifts.get(dt_str, [])

        pms_l = 0.0
        ago_l = 0.0
        ik_l = 0.0
        pms_rev = 0.0
        ago_rev = 0.0
        ik_rev = 0.0

        for prod, qty in day_fuels.items():
            p_up = prod.upper()
            price = get_fuel_price(prod)
            val = qty * price
            if "PETROL" in p_up or "PMS" in p_up or "SUPER" in p_up:
                pms_l += qty
                pms_rev += val
            elif "DIESEL" in p_up or "AGO" in p_up:
                ago_l += qty
                ago_rev += val
            elif "KEROSENE" in p_up or "IK" in p_up:
                ik_l += qty
                ik_rev += val

        day_total_fuel_l = pms_l + ago_l + ik_l
        day_fuel_rev = pms_rev + ago_rev + ik_rev

        lubes_l = 0.0
        lubes_rev = 0.0
        gas_kg = 0.0
        gas_cyl = 0
        gas_rev = 0.0
        other_rev = 0.0
        gas_items = {}

        for sale in day_invs:
            grp = (sale.item_group or "").lower()
            iname = sale.item_name or ""
            qty = float(sale.qty or 0.0)
            amt = float(sale.amount or 0.0)

            if "lube" in grp or "lubricant" in grp or "oil" in grp:
                match_litres = re.search(r'(\d+(?:\.\d+)?)\s*L', iname, re.IGNORECASE)
                litres_per_unit = float(match_litres.group(1)) if match_litres else 1.0
                lubes_l += (qty * litres_per_unit)
                lubes_rev += amt
            elif "gas" in grp or "lpg" in grp:
                gas_cyl += int(qty)
                match = re.search(r'(\d+)KG', iname, re.IGNORECASE)
                kg_per_cyl = int(match.group(1)) if match else 0
                kg_total = qty * kg_per_cyl
                gas_items[iname] = gas_items.get(iname, 0) + int(qty)
                gas_kg += kg_total
                gas_rev += amt
            else:
                other_rev += amt

        day_total_rev = day_fuel_rev + lubes_rev + gas_rev + other_rev
        has_sales = bool(day_total_fuel_l > 0 or day_total_rev > 0 or len(day_shifts) > 0)

        if has_sales:
            active_days_count += 1

        tot_pms_l += pms_l
        tot_ago_l += ago_l
        tot_ik_l += ik_l
        tot_fuel_l += day_total_fuel_l
        tot_lubes_l += lubes_l
        tot_gas_kg += gas_kg
        tot_gas_cyl += gas_cyl
        tot_fuel_rev += day_fuel_rev
        tot_lubes_rev += lubes_rev
        tot_gas_rev += gas_rev
        tot_station_rev += day_total_rev

        shift_templates = [s.shift_template or "Shift" for s in day_shifts]
        shift_names = [s.name for s in day_shifts]

        days_list.append({
            "date": dt_str,
            "day_name": current_dt.strftime("%A"),
            "day_short": current_dt.strftime("%a"),
            "formatted_date": current_dt.strftime("%d %b %Y"),
            "day_number": current_dt.day,
            "pms_litres": round(pms_l, 2),
            "pms_revenue": round(pms_rev, 2),
            "ago_litres": round(ago_l, 2),
            "ago_revenue": round(ago_rev, 2),
            "kerosene_litres": round(ik_l, 2),
            "kerosene_revenue": round(ik_rev, 2),
            "total_fuel_litres": round(day_total_fuel_l, 2),
            "fuel_revenue": round(day_fuel_rev, 2),
            "lubes_litres": round(lubes_l, 2),
            "lubes_revenue": round(lubes_rev, 2),
            "gas_kgs": round(gas_kg, 1),
            "gas_cylinders": gas_cyl,
            "gas_revenue": round(gas_rev, 2),
            "gas_items": gas_items,
            "total_revenue": round(day_total_rev, 2),
            "shifts_count": len(day_shifts),
            "shift_templates": shift_templates,
            "shift_names": shift_names,
            "has_sales": has_sales
        })

        current_dt += timedelta(days=1)

    # 6. Fetch available recent months for switching
    months_query = frappe.db.sql("""
        SELECT DISTINCT DATE_FORMAT(shift_date, '%%Y-%%m') as ym, DATE_FORMAT(shift_date, '%%M %%Y') as label
        FROM `tabShift`
        WHERE station = %s AND docstatus != 2
        ORDER BY ym DESC
        LIMIT 12
    """, (station,), as_dict=True)

    available_months = [{"value": m.ym, "label": m.label} for m in months_query if m.ym]
    curr_ym = start_dt.strftime("%Y-%m")
    if not any(m["value"] == curr_ym for m in available_months):
        available_months.insert(0, {"value": curr_ym, "label": start_dt.strftime("%B %Y")})

    denom = max(active_days_count, 1)

    return {
        "station": station,
        "from_date": from_date,
        "to_date": to_date,
        "month_label": month_label,
        "active_days_count": active_days_count,
        "total_days_count": len(days_list),
        "available_months": available_months,
        "totals": {
            "pms_litres": round(tot_pms_l, 2),
            "ago_litres": round(tot_ago_l, 2),
            "kerosene_litres": round(tot_ik_l, 2),
            "total_fuel_litres": round(tot_fuel_l, 2),
            "lubes_litres": round(tot_lubes_l, 2),
            "gas_kgs": round(tot_gas_kg, 1),
            "gas_cylinders": tot_gas_cyl,
            "fuel_revenue": round(tot_fuel_rev, 2),
            "lubes_revenue": round(tot_lubes_rev, 2),
            "gas_revenue": round(tot_gas_rev, 2),
            "total_revenue": round(tot_station_rev, 2),
            "avg_daily_fuel_litres": round(tot_fuel_l / denom, 2),
            "avg_daily_pms_litres": round(tot_pms_l / denom, 2),
            "avg_daily_ago_litres": round(tot_ago_l / denom, 2),
            "avg_daily_lubes_litres": round(tot_lubes_l / denom, 2),
            "avg_daily_gas_kgs": round(tot_gas_kg / denom, 1),
            "avg_daily_revenue": round(tot_station_rev / denom, 2)
        },
        "days": days_list
    }

@frappe.whitelist()
def get_tank_levels(station=None):
    data = get_homepage_data(station=station)
    return data.get("tanks", [])

@frappe.whitelist()
def get_available_shifts(station=None, filter_date=None):
    if not station:
        station = frappe.db.get_value("Fuel Station", {}, "name") or "RUBIS POA PLACE"
    if filter_date:
        return frappe.db.sql("""
            SELECT name, shift_date, creation, status
            FROM `tabShift`
            WHERE station = %s AND shift_date = %s AND docstatus != 2
            ORDER BY creation DESC LIMIT 50
        """, (station, filter_date), as_dict=True)
    else:
        return frappe.db.sql("""
            SELECT name, shift_date, creation, status
            FROM `tabShift`
            WHERE station = %s AND docstatus != 2
            ORDER BY creation DESC LIMIT 50
        """, (station,), as_dict=True)

@frappe.whitelist()
def get_homepage_kpis(station=None, shift_id=None, from_date=None, to_date=None):
    data = get_homepage_data(station=station, shift_id=shift_id, from_date=from_date, to_date=to_date)
    kpis = data.get("kpis", {})
    kpis["monthly_litres"] = data.get("monthly", {}).get("total_litres", 0)
    kpis["monthly_petrol"] = data.get("monthly", {}).get("petrol_litres", 0)
    kpis["monthly_diesel"] = data.get("monthly", {}).get("diesel_litres", 0)
    kpis["monthly_lubes"] = data.get("monthly", {}).get("lubes_litres", 0)
    kpis["monthly_gas_kgs"] = data.get("monthly", {}).get("gas_kgs", 0)
    kpis["monthly_gas_cylinders"] = data.get("monthly", {}).get("gas_cylinders", 0)
    return kpis

@frappe.whitelist()
def get_homepage_trend(station=None):
    data = get_homepage_data(station=station)
    return data.get("trend", {})

@frappe.whitelist()
def get_homepage_activity(station=None):
    data = get_homepage_data(station=station)
    return data.get("activity", [])

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
    from frappe.utils import flt
    amount = flt(amount)
    if amount <= 0:
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
    from frappe.utils import flt
    amount = flt(amount)
    if amount <= 0:
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
    from frappe.utils import flt, nowdate
    amount = flt(doc.amount)
    
    frappe.get_doc({
        'doctype': 'Staff Liability Ledger',
        'employee': doc.from_employee,
        'date': doc.date,
        'amount': -amount,
        'reason': f'Correction/Transfer to {doc.to_employee} (Ref: {doc.name})',
        'status': 'Deducted'
    }).insert(ignore_permissions=True).submit()
    
    frappe.get_doc({
        'doctype': 'Staff Liability Ledger',
        'employee': doc.to_employee,
        'date': doc.date,
        'amount': amount,
        'reason': f'Correction/Transfer from {doc.from_employee} (Ref: {doc.name})',
        'status': 'Unpaid'
    }).insert(ignore_permissions=True).submit()

def on_cancel_shortage_correction(doc, method):
    ledgers = frappe.get_all('Staff Liability Ledger', filters={'reason': ['like', f'%Ref: {doc.name}%'], 'docstatus': 1})
    for l in ledgers:
        ldoc = frappe.get_doc('Staff Liability Ledger', l.name)
        ldoc.cancel()


def on_submit_shortage_payment(doc, method):
    from frappe.utils import flt
    amount = flt(doc.amount)
    frappe.get_doc({
        'doctype': 'Staff Liability Ledger',
        'employee': doc.employee,
        'date': doc.date,
        'shift': doc.shift_reference,
        'amount': -amount,
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
                "debit_in_account_currency": amount
            })
            
            je.append("accounts", {
                "account": shortfall_account,
                "credit_in_account_currency": amount,
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
def get_csa_shorts_balances(start_date=None, end_date=None, employee=None):
    from frappe.utils import nowdate, getdate, flt
    
    if not start_date or not end_date:
        today = getdate(nowdate())
        if not start_date:
            start_date = f"{today.year}-{today.month:02d}-01"
        if not end_date:
            end_date = str(today)
            
    # 1. Opening balances (transactions prior to start_date)
    opening_sql = f"""
        SELECT 
            employee,
            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as opening_shortage,
            SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as opening_paid,
            SUM(amount) as opening_balance
        FROM `tabStaff Liability Ledger`
        WHERE docstatus = 1 AND date < %s {'AND employee = %s' if employee else ''}
        GROUP BY employee
    """
    op_params = [start_date, employee] if employee else [start_date]
    opening_data = frappe.db.sql(opening_sql, tuple(op_params), as_dict=True)
    opening_map = {d.employee: d for d in opening_data}
    
    # 2. Period activity (start_date <= date <= end_date)
    period_sql = f"""
        SELECT 
            employee,
            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as period_shortage,
            SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as period_paid,
            SUM(amount) as period_net
        FROM `tabStaff Liability Ledger`
        WHERE docstatus = 1 AND date BETWEEN %s AND %s {'AND employee = %s' if employee else ''}
        GROUP BY employee
    """
    pe_params = [start_date, end_date, employee] if employee else [start_date, end_date]
    period_data = frappe.db.sql(period_sql, tuple(pe_params), as_dict=True)
    period_map = {d.employee: d for d in period_data}
    
    # 3. All employees with any liability ledger entry
    all_emps_sql = f"""
        SELECT 
            l.employee,
            e.employee_name,
            e.status as employee_status,
            SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END) as lifetime_shortage,
            SUM(CASE WHEN l.amount < 0 THEN ABS(l.amount) ELSE 0 END) as lifetime_paid,
            SUM(l.amount) as lifetime_balance
        FROM `tabStaff Liability Ledger` l
        LEFT JOIN `tabEmployee` e ON l.employee = e.name
        WHERE l.docstatus = 1 {'AND l.employee = %s' if employee else ''}
        GROUP BY l.employee
        ORDER BY e.employee_name ASC
    """
    all_params = [employee] if employee else []
    all_emps = frappe.db.sql(all_emps_sql, tuple(all_params), as_dict=True)
    
    results = []
    tot_open = 0.0
    tot_short = 0.0
    tot_paid = 0.0
    tot_close = 0.0
    
    for r in all_emps:
        emp_id = r.employee
        op = opening_map.get(emp_id, {})
        pe = period_map.get(emp_id, {})
        
        op_bal = flt(op.get('opening_balance', 0.0), 2)
        p_short = flt(pe.get('period_shortage', 0.0), 2)
        p_paid = flt(pe.get('period_paid', 0.0), 2)
        p_net = flt(p_short - p_paid, 2)
        closing_bal = flt(op_bal + p_net, 2)
        
        tot_open += op_bal
        tot_short += p_short
        tot_paid += p_paid
        tot_close += closing_bal
        
        if closing_bal > 0.01:
            status_label = "Outstanding"
            status_color = "red"
        elif closing_bal < -0.01:
            status_label = "Credit / Advance"
            status_color = "blue"
        else:
            status_label = "Cleared"
            status_color = "green"
            
        results.append({
            'employee': emp_id,
            'employee_name': r.employee_name or emp_id,
            'employee_status': r.employee_status or "Active",
            'opening_balance': op_bal,
            'period_shortage': p_short,
            'period_paid': p_paid,
            'period_net': p_net,
            'closing_balance': closing_bal,
            'lifetime_balance': flt(r.lifetime_balance or 0.0, 2),
            'status_label': status_label,
            'status_color': status_color,
            # Backward compatibility fields
            'month_shortage': p_short,
            'month_paid': p_paid,
            'outstanding_balance': closing_bal
        })
        
    return {
        'start_date': start_date,
        'end_date': end_date,
        'summary': {
            'total_opening': round(tot_open, 2),
            'total_shortage': round(tot_short, 2),
            'total_paid': round(tot_paid, 2),
            'total_net': round(tot_short - tot_paid, 2),
            'total_closing': round(tot_close, 2),
            'active_debtors_count': len([r for r in results if r['closing_balance'] > 0.01]),
            'total_csas_count': len(results)
        },
        'rows': results
    }

@frappe.whitelist()
def get_csa_shorts_breakdown(employee, start_date=None, end_date=None):
    from frappe.utils import flt, nowdate, getdate
    if not employee:
        frappe.throw("Employee is required")
        
    if not start_date or not end_date:
        today = getdate(nowdate())
        if not start_date:
            start_date = f"{today.year}-{today.month:02d}-01"
        if not end_date:
            end_date = str(today)

    # 1. Opening Balance prior to start_date
    op_res = frappe.db.sql("""
        SELECT SUM(amount) as opening_balance
        FROM `tabStaff Liability Ledger`
        WHERE employee = %s AND docstatus = 1 AND date < %s
    """, (employee, start_date), as_dict=True)
    opening_balance = flt(op_res[0].opening_balance if op_res and op_res[0].opening_balance else 0.0, 2)
    
    # 2. Transactions during period
    txns = frappe.db.sql("""
        SELECT 
            sll.name, sll.date, sll.shift, sll.amount, sll.reason, sll.status,
            s.shift_template, s.shift_date
        FROM `tabStaff Liability Ledger` sll
        LEFT JOIN `tabShift` s ON s.name = sll.shift
        WHERE sll.employee = %s AND sll.docstatus = 1 AND sll.date BETWEEN %s AND %s
        ORDER BY sll.date ASC, sll.creation ASC
    """, (employee, start_date, end_date), as_dict=True)
    
    running = opening_balance
    total_short = 0.0
    total_paid = 0.0
    
    formatted_txns = []
    for t in txns:
        amt = flt(t.amount or 0.0, 2)
        running += amt
        running = round(running, 2)
        
        short_amt = amt if amt > 0 else 0.0
        paid_amt = abs(amt) if amt < 0 else 0.0
        
        total_short += short_amt
        total_paid += paid_amt
        
        # Format friendly type/category
        entry_type = "Shortage Incurred" if amt > 0 else "Payment / Recovery"
        if "Correction" in (t.reason or "") or "Transfer" in (t.reason or ""):
            entry_type = "Shortage Transfer"
        elif "Payment" in (t.reason or ""):
            entry_type = "Cash / M-Pesa Payment"
        elif "Shift Cash Variance" in (t.reason or ""):
            entry_type = "Shift Variance"
            
        formatted_txns.append({
            "name": t.name,
            "date": t.date,
            "shift": t.shift or "",
            "shift_template": t.shift_template or "",
            "shift_date": t.shift_date or "",
            "amount": amt,
            "shortage_amount": short_amt,
            "paid_amount": paid_amt,
            "running_balance": running,
            "reason": t.reason or "",
            "entry_type": entry_type,
            "status": t.status or ""
        })
        
    emp_doc = frappe.db.get_value("Employee", employee, ["name", "employee_name", "department", "designation"], as_dict=True) or {"name": employee, "employee_name": employee}
    
    return {
        "employee": employee,
        "employee_name": emp_doc.get("employee_name") or employee,
        "department": emp_doc.get("department") or "",
        "designation": emp_doc.get("designation") or "",
        "start_date": start_date,
        "end_date": end_date,
        "opening_balance": opening_balance,
        "period_shortage": round(total_short, 2),
        "period_paid": round(total_paid, 2),
        "period_net": round(total_short - total_paid, 2),
        "closing_balance": running,
        "transactions": formatted_txns
    }


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
        
    stock_adj_account = frappe.get_cached_value("Company", se.company, "stock_adjustment_account")

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
            
        row_dict = {
            "item_code": item_code,
            "qty": qty,
            "uom": frappe.db.get_value("Item", item_code, "stock_uom") or "Nos",
            "s_warehouse": se.from_warehouse,
            "t_warehouse": se.to_warehouse
        }
        if stock_adj_account:
            row_dict["expense_account"] = stock_adj_account

        se.append("items", row_dict)
        
    if not se.items:
        frappe.throw("No valid items to transfer")
        
    se.insert()
    se.submit()
    
    frappe.clear_messages()
    
    return {"status": "success", "message": "Bulk Stock Transfer completed successfully.", "name": se.name}

@frappe.whitelist()
def get_historical_stock_transfers(station_id, date_from=None, date_to=None, limit=None):
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
        
    limit_num = int(limit) if limit else (1000 if (date_from or date_to) else 20)
        
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
        LIMIT {limit_num}
    """, as_dict=1)
    
    for entry in entries:
        items = frappe.db.sql(f"""
            SELECT item_code, item_name, qty, uom, s_warehouse, t_warehouse
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
def get_spa_stock_transfer_details(stock_entry_id):
    if not stock_entry_id:
        frappe.throw("Stock Entry ID is required")
        
    se = frappe.get_doc("Stock Entry", stock_entry_id)
    items = []
    for d in se.items:
        items.append({
            "item_code": d.item_code,
            "item_name": d.item_name or d.item_code,
            "qty": d.qty,
            "uom": d.uom,
            "s_warehouse": d.s_warehouse,
            "t_warehouse": d.t_warehouse
        })
        
    return {
        "name": se.name,
        "posting_date": se.posting_date,
        "posting_time": se.posting_time,
        "company": se.company,
        "from_warehouse": se.from_warehouse,
        "to_warehouse": se.to_warehouse,
        "items": items
    }


@frappe.whitelist()
def delete_spa_stock_transfer(stock_entry_id):
    if not stock_entry_id:
        frappe.throw("Stock Entry ID is required")
        
    if not frappe.db.exists("Stock Entry", stock_entry_id):
        frappe.throw(f"Stock Entry {stock_entry_id} not found")
        
    se = frappe.get_doc("Stock Entry", stock_entry_id)
    if se.docstatus == 1:
        se.cancel()
    elif se.docstatus == 0:
        frappe.delete_doc("Stock Entry", stock_entry_id, ignore_permissions=True)
        
    frappe.clear_messages()
    return {"status": "success", "message": f"Stock Transfer {stock_entry_id} deleted successfully."}


@frappe.whitelist()
def update_spa_stock_transfer(stock_entry_id, station_id, items, direction="Store to Forecourt"):
    if not stock_entry_id:
        frappe.throw("Stock Entry ID is required")
    if not station_id:
        frappe.throw("Station ID is required")
    if not items:
        frappe.throw("Items list is required")
        
    import json
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except Exception:
            frappe.throw("Invalid items data format")
            
    if not frappe.db.exists("Stock Entry", stock_entry_id):
        frappe.throw(f"Stock Entry {stock_entry_id} not found")
        
    station = frappe.get_doc("Fuel Station", station_id)
    if not station.default_store_warehouse or not station.default_forecourt_warehouse:
        frappe.throw("Station must have both Default Store Warehouse and Default Forecourt Warehouse configured.")
        
    old_se = frappe.get_doc("Stock Entry", stock_entry_id)
    posting_date = old_se.posting_date
    posting_time = old_se.posting_time
    company = old_se.company or (station.company if hasattr(station, 'company') and station.company else frappe.defaults.get_user_default("Company"))
    
    # Cancel old entry
    if old_se.docstatus == 1:
        old_se.cancel()
    elif old_se.docstatus == 0:
        frappe.delete_doc("Stock Entry", stock_entry_id, ignore_permissions=True)
    
    # Create new entry with updated contents
    se = frappe.new_doc("Stock Entry")
    se.stock_entry_type = "Material Transfer"
    se.company = company
    se.posting_date = posting_date
    se.posting_time = posting_time or frappe.utils.nowtime()
    
    stock_adj_account = frappe.get_cached_value("Company", company, "stock_adjustment_account")
    
    for row in items:
        r_item = row.get("item") or row.get("item_code")
        r_qty = float(row.get("qty") or 0)
        r_dir = row.get("direction") or direction
        
        if not r_item or r_qty <= 0:
            continue
            
        from_w = station.default_store_warehouse
        to_w = station.default_forecourt_warehouse
        
        if r_dir == "Forecourt to Store":
            from_w = station.default_forecourt_warehouse
            to_w = station.default_store_warehouse
            
        row_dict = {
            "item_code": r_item,
            "qty": r_qty,
            "uom": frappe.db.get_value("Item", r_item, "stock_uom") or "Nos",
            "s_warehouse": from_w,
            "t_warehouse": to_w
        }
        if stock_adj_account:
            row_dict["expense_account"] = stock_adj_account
            
        se.append("items", row_dict)
        
    if not se.items:
        frappe.throw("No valid items with quantity > 0")
        
    se.insert(ignore_permissions=True)
    se.submit()
    
    frappe.clear_messages()
    return {"status": "success", "message": f"Stock Transfer updated successfully (New Entry: {se.name})", "name": se.name}



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
def get_past_shifts(start_date=None, end_date=None, limit=None):
    filters = {'status': 'Closed'}
    if start_date and end_date:
        filters['shift_date'] = ['between', [start_date, end_date]]
    elif start_date:
        filters['shift_date'] = ['>=', start_date]
    elif end_date:
        filters['shift_date'] = ['<=', end_date]
    
    limit_num = int(limit) if limit else (1000 if (start_date or end_date) else 20)
    
    shifts = frappe.get_all('Shift', filters=filters, fields=['name', 'shift_date', 'head_csa'], order_by='shift_date desc', limit_page_length=limit_num)
    
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
def get_inventory_sales_history(station, from_date=None, to_date=None, search=None, limit=None):
    conditions = ["s.station = %s", "s.docstatus < 2"]
    values = [station]
    
    if from_date:
        conditions.append("s.shift_date >= %s")
        values.append(from_date)
    if to_date:
        conditions.append("s.shift_date <= %s")
        values.append(to_date)
    if search:
        conditions.append("(sis.item LIKE %s OR sis.sold_by LIKE %s OR i.item_name LIKE %s OR i.item_group LIKE %s)")
        s_val = f"%{search}%"
        values.extend([s_val, s_val, s_val, s_val])
        
    limit_num = int(limit) if limit else (2000 if (from_date or to_date or search) else 200)
        
    query = f"""
        SELECT 
            sis.name,
            sis.parent as shift,
            sis.parent as parent,
            sis.idx,
            sis.item,
            COALESCE(i.item_name, sis.item) as item_name,
            COALESCE(i.item_group, '') as item_group,
            sis.quantity,
            sis.uom_multiplier,
            sis.total_volume,
            sis.selling_price,
            sis.amount,
            sis.sold_by,
            sis.is_invoice_sale,
            sis.reference_invoice,
            sis.creation,
            s.shift_date,
            s.shift_template,
            s.shift_name_display
        FROM `tabShift Inventory Sale` sis
        JOIN `tabShift` s ON sis.parent = s.name
        LEFT JOIN `tabItem` i ON sis.item = i.name
        WHERE {' AND '.join(conditions)}
        ORDER BY s.shift_date DESC, sis.creation DESC, sis.idx ASC
        LIMIT {limit_num}
    """
    return frappe.db.sql(query, values, as_dict=True)


@frappe.whitelist()
def get_station_cards_history(station, from_date=None, to_date=None, card=None, csa=None, limit=None):
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
        
    limit_num = int(limit) if limit else (1000 if (from_date or to_date) else 20)
    
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
        LIMIT {limit_num}
    """
    return frappe.db.sql(query, tuple(values), as_dict=True)

@frappe.whitelist()
def get_shift_invoices_history(station, from_date=None, to_date=None, customer=None, limit=None):
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
        
    limit_num = int(limit) if limit else (1000 if (from_date or to_date or customer) else 20)
        
    query = f"""
        SELECT 
            si.name, si.parent as shift, s.shift_date, s.shift_template, si.customer,
            IFNULL(cust.customer_name, si.customer) as customer_name,
            si.purchase_order, si.vehicle_registration, si.item,
            IFNULL(it.item_name, si.item) as item_name,
            si.quantity, si.rate, 
            COALESCE(si.gross_amount, (si.quantity * si.rate)) as gross_amount,
            si.discount_amount, si.discount_csa, si.discount_reason,
            IFNULL(e_disc.employee_name, si.discount_csa) as discount_csa_name,
            si.amount, si.entry_number, si.csa, 
            IFNULL(e_csa.employee_name, si.csa) as csa_name,
            si.inventory_csa,
            IFNULL(e_inv.employee_name, si.inventory_csa) as inventory_csa_name
        FROM `tabShift Invoice` si
        JOIN `tabShift` s ON si.parent = s.name
        LEFT JOIN `tabCustomer` cust ON si.customer = cust.name
        LEFT JOIN `tabItem` it ON si.item = it.name
        LEFT JOIN `tabEmployee` e_csa ON (si.csa = e_csa.name OR si.csa = e_csa.user_id)
        LEFT JOIN `tabEmployee` e_inv ON (si.inventory_csa = e_inv.name OR si.inventory_csa = e_inv.user_id)
        LEFT JOIN `tabEmployee` e_disc ON (si.discount_csa = e_disc.name OR si.discount_csa = e_disc.user_id)
        WHERE {' AND '.join(conditions)}
        ORDER BY 
            CASE 
                WHEN si.entry_number LIKE 'INV%%' THEN CAST(SUBSTRING(si.entry_number, 4) AS UNSIGNED) 
                ELSE 0 
            END DESC,
            s.shift_date DESC,
            si.creation DESC
        LIMIT {limit_num}
    """
    return frappe.db.sql(query, tuple(values), as_dict=True)


@frappe.whitelist()
def get_next_shift_invoice_number(station=None):
    from frappe.utils import cint
    res = frappe.db.sql("""
        SELECT DISTINCT entry_number 
        FROM `tabShift Invoice` 
        WHERE entry_number LIKE 'INV%'
    """, as_dict=True)
    
    max_num = 0
    for r in res:
        val = (r.entry_number or "").replace("INV", "").strip()
        if val.isdigit():
            num = int(val)
            if num > max_num:
                max_num = num
                
    next_num = max_num + 1
    next_inv = f"INV{next_num:03d}"
    return {"max_num": max_num, "next_invoice_number": next_inv}


@frappe.whitelist()
def get_shift_discounts_report(station=None, shift_id=None, from_date=None, to_date=None, customer=None):
    if not station and not shift_id:
        station = frappe.db.get_value("Fuel Station", {}, "name") or "RUBIS POA PLACE"
        
    conditions = ["s.docstatus < 2", "si.discount_amount > 0"]
    values = []
    
    if station:
        conditions.append("s.station = %s")
        values.append(station)
    if shift_id:
        conditions.append("s.name = %s")
        values.append(shift_id)
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
            si.name, si.parent as shift, s.shift_date, s.shift_template, s.station,
            si.customer, si.entry_number, si.purchase_order, si.vehicle_registration,
            si.item, item.item_name, item.item_group,
            si.quantity, si.rate, 
            COALESCE(si.gross_amount, (si.quantity * si.rate)) as gross_amount,
            si.discount_amount,
            COALESCE(si.discount_csa, si.csa) as discount_csa,
            si.discount_reason,
            si.amount as net_amount,
            si.csa as issuer_csa,
            emp_disc.employee_name as discount_csa_name,
            emp_iss.employee_name as issuer_csa_name,
            cust.customer_name
        FROM `tabShift Invoice` si
        JOIN `tabShift` s ON si.parent = s.name
        LEFT JOIN `tabItem` item ON si.item = item.name
        LEFT JOIN `tabCustomer` cust ON si.customer = cust.name
        LEFT JOIN `tabEmployee` emp_disc ON COALESCE(si.discount_csa, si.csa) = emp_disc.name
        LEFT JOIN `tabEmployee` emp_iss ON si.csa = emp_iss.name
        WHERE {' AND '.join(conditions)}
        ORDER BY s.shift_date DESC, si.creation DESC
    """
    rows = frappe.db.sql(query, values, as_dict=True)
    
    total_gross = sum(float(r.gross_amount or 0) for r in rows)
    total_discounts = sum(float(r.discount_amount or 0) for r in rows)
    total_net = sum(float(r.net_amount or 0) for r in rows)
    
    return {
        "discounts": rows,
        "count": len(rows),
        "total_gross": round(total_gross, 2),
        "total_discounts": round(total_discounts, 2),
        "total_net": round(total_net, 2),
        "summary": {
            "total_count": len(rows),
            "total_gross": round(total_gross, 2),
            "total_discounts": round(total_discounts, 2),
            "total_net": round(total_net, 2)
        }
    }

@frappe.whitelist()
def get_customer_payments_history(station, from_date=None, to_date=None, customer=None, limit=None):
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
        
    limit_num = int(limit) if limit else (1000 if (from_date or to_date or customer) else 20)
        
    query = f"""
        SELECT 
            cp.name, cp.shift, s.shift_date, s.shift_template, cp.customer,
            IFNULL(cust.customer_name, cp.customer) as customer_name,
            cp.csa, 
            IFNULL(e.employee_name, cp.csa) as csa_name,
            cp.mode_of_payment, cp.amount, cp.date, cp.creation
        FROM `tabCustomer Payment` cp
        JOIN `tabShift` s ON cp.shift = s.name
        LEFT JOIN `tabCustomer` cust ON cp.customer = cust.name
        LEFT JOIN `tabEmployee` e ON (cp.csa = e.name OR cp.csa = e.user_id)
        WHERE {' AND '.join(conditions)}
        ORDER BY s.shift_date DESC, cp.creation DESC
        LIMIT {limit_num}
    """
    return frappe.db.sql(query, values, as_dict=True)


@frappe.whitelist()
def get_topups_history(station=None, from_date=None, to_date=None, limit=None):
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
        
    limit_num = int(limit) if limit else (1000 if (from_date or to_date) else 20)
        
    sql = f'''
        SELECT 
            t.name, t.date, t.shift, t.creation, t.card, t.csa, 
            t.rrn_number, t.mode_of_payment, t.amount, s.shift_date, s.shift_template
        FROM `tabStation Supplier Top Up` t
        LEFT JOIN `tabShift` s ON t.shift = s.name
        WHERE t.docstatus < 2 {filter_cond}
        ORDER BY t.date DESC, t.creation DESC
        LIMIT {limit_num}
    '''
    return frappe.db.sql(sql, as_dict=True)


@frappe.whitelist()
def get_shift_dips_history(station=None, from_date=None, to_date=None, tank=None, shift_id=None, limit=None):
    conditions = ["s.docstatus < 2"]
    values = []
    
    if station:
        conditions.append("s.station = %s")
        values.append(station)
    if shift_id:
        conditions.append("s.name = %s")
        values.append(shift_id)
    if from_date:
        conditions.append("s.shift_date >= %s")
        values.append(from_date)
    if to_date:
        conditions.append("s.shift_date <= %s")
        values.append(to_date)
    if tank:
        conditions.append("sd.fuel_tank = %s")
        values.append(tank)
        
    limit_num = int(limit) if limit else (1000 if (from_date or to_date or tank or shift_id) else 20)
        
    query = f"""
        SELECT 
            sd.name, sd.parent as shift, s.shift_date, s.shift_template, s.status as shift_status,
            s.station, sd.fuel_tank, sd.opening_dip, sd.closing_dip, sd.expected_stock, sd.variance,
            (COALESCE(sd.opening_dip, 0) - COALESCE(sd.closing_dip, 0)) as diff_dip,
            sd.creation, sd.modified
        FROM `tabDip Stick Reading` sd
        JOIN `tabShift` s ON sd.parent = s.name
        WHERE {' AND '.join(conditions)}
        ORDER BY s.shift_date DESC, sd.creation DESC, sd.name DESC
        LIMIT {limit_num}
    """
    return frappe.db.sql(query, values, as_dict=True)


@frappe.whitelist()
def update_dip_reading(reading_id, closing_dip=None, opening_dip=None):
    from frappe.utils import flt
    if not reading_id:
        frappe.throw("Reading ID is required")
        
    parent_shift = frappe.db.get_value("Dip Stick Reading", reading_id, "parent")
    if not parent_shift:
        frappe.throw("Dip Stick Reading not found")
        
    shift_doc = frappe.get_doc("Shift", parent_shift)
    
    # Check permissions if closed
    if shift_doc.status != "Open" and not (frappe.user.has_role("System Manager") or frappe.user.has_role("Fuel Station Owner")):
        frappe.throw("This shift is closed. Only System Managers or Fuel Station Owners can modify closed shift readings.")
        
    row_found = False
    for r in shift_doc.dip_stick_readings:
        if r.name == reading_id:
            if closing_dip is not None and str(closing_dip).strip() != "":
                r.closing_dip = flt(closing_dip)
            else:
                r.closing_dip = None
            if opening_dip is not None and str(opening_dip).strip() != "":
                r.opening_dip = flt(opening_dip)
            row_found = True
            break
            
    if not row_found:
        frappe.throw(f"Reading row {reading_id} not found in shift {parent_shift}")
        
    shift_doc.save(ignore_permissions=True)
    return {"status": "success", "message": "Dip Stick reading updated successfully"}


@frappe.whitelist()
def clear_dip_reading(reading_id):
    if not reading_id:
        frappe.throw("Reading ID is required")
        
    parent_shift = frappe.db.get_value("Dip Stick Reading", reading_id, "parent")
    if not parent_shift:
        frappe.throw("Dip Stick Reading not found")
        
    shift_doc = frappe.get_doc("Shift", parent_shift)
    
    if shift_doc.status != "Open" and not (frappe.user.has_role("System Manager") or frappe.user.has_role("Fuel Station Owner")):
        frappe.throw("This shift is closed. Only System Managers or Fuel Station Owners can modify closed shift readings.")
        
    for r in shift_doc.dip_stick_readings:
        if r.name == reading_id:
            r.closing_dip = None
            break
            
    shift_doc.save(ignore_permissions=True)
    return {"status": "success", "message": "Dip Stick reading cleared successfully"}


@frappe.whitelist()
def get_historical_greasing_sales(from_date=None, to_date=None, csa=None, vehicle_type=None, station=None):
    from frappe.utils import flt, cint
    
    conditions = ["s.docstatus < 2"]
    values = []
    
    if from_date:
        conditions.append("s.shift_date >= %s")
        values.append(from_date)
    if to_date:
        conditions.append("s.shift_date <= %s")
        values.append(to_date)
    if station:
        conditions.append("s.station = %s")
        values.append(station)
    if csa:
        conditions.append("g.csa = %s")
        values.append(csa)
    if vehicle_type:
        conditions.append("g.vehicle_type = %s")
        values.append(vehicle_type)
        
    where_clause = " AND ".join(conditions)
    
    services = frappe.db.sql(f"""
        SELECT 
            g.name,
            g.parent as shift,
            s.shift_date,
            s.shift_name_display,
            s.station,
            g.csa,
            g.vehicle_type,
            g.number_of_vehicles,
            g.amount_per_vehicle,
            g.total_amount,
            g.is_invoice_sale,
            g.reference_invoice
        FROM `tabShift Greasing Sale` g
        INNER JOIN `tabShift` s ON g.parent = s.name
        WHERE {where_clause}
        ORDER BY s.shift_date DESC, g.creation DESC
    """, values, as_dict=True)
    
    # Also fetch shift level inventory & usage summary
    shift_conditions = ["docstatus < 2"]
    shift_values = []
    if from_date:
        shift_conditions.append("shift_date >= %s")
        shift_values.append(from_date)
    if to_date:
        shift_conditions.append("shift_date <= %s")
        shift_values.append(to_date)
    if station:
        shift_conditions.append("station = %s")
        shift_values.append(station)
        
    shift_where = " AND ".join(shift_conditions)
    shift_summaries = frappe.db.sql(f"""
        SELECT 
            name as shift,
            shift_date,
            shift_name_display,
            station,
            grease_opening_balance,
            grease_top_up,
            grease_closing_balance,
            grease_used,
            total_greasing_sales
        FROM `tabShift`
        WHERE {shift_where} AND (grease_used > 0 OR total_greasing_sales > 0 OR grease_opening_balance > 0)
        ORDER BY shift_date DESC, creation DESC
    """, shift_values, as_dict=True)
    
    total_revenue = sum([flt(s.total_amount) for s in services])
    total_vehicles = sum([cint(s.number_of_vehicles) for s in services])
    total_grease_kg = sum([flt(sh.grease_used) for sh in shift_summaries])
    
    return {
        "services": services,
        "shift_summaries": shift_summaries,
        "total_revenue": total_revenue,
        "total_vehicles": total_vehicles,
        "total_grease_kg": total_grease_kg
    }


@frappe.whitelist()
def delete_greasing_sale(shift_name, row_name):
    from frappe.utils import cint
    if not shift_name or not row_name:
        frappe.throw("Shift name and Row name are required")
        
    shift = frappe.get_doc("Shift", shift_name)
    if shift.status != "Open" and not (frappe.user.has_role("System Manager") or frappe.user.has_role("Fuel Station Owner")):
        frappe.throw("This shift is closed. Only System Managers or Fuel Station Owners can modify closed shift data.")
        
    for row in shift.greasing_sales:
        if row.name == row_name and cint(getattr(row, "is_invoice_sale", 0)):
            ref = getattr(row, "reference_invoice", "") or "unknown"
            frappe.throw(f"This greasing service was automatically posted from Invoice #{ref}. Please edit or delete that invoice directly in the Invoices tab.")
            
    shift.greasing_sales = [r for r in shift.greasing_sales if r.name != row_name]
    frappe.db.sql("DELETE FROM `tabShift Greasing Sale` WHERE name = %s AND parent = %s", (row_name, shift_name))
    shift.save(ignore_permissions=True)
    frappe.db.commit()
    return {"status": "success", "message": "Greasing service deleted successfully", "doc": frappe.get_doc("Shift", shift_name)}


@frappe.whitelist()
def download_debtors_statement_pdf(customer_id=None, customer=None, start_date=None, end_date=None, station=None, vehicle=None):
    from frappe.utils.pdf import get_pdf
    from frappe.utils import formatdate, flt
    import frappe.utils
    
    cust_id = customer_id or customer
    if not cust_id:
        frappe.throw("Customer ID is required to generate statement PDF.")
        
    data = get_detailed_customer_statement(customer_id=cust_id, customer=cust_id, start_date=start_date, end_date=end_date)
    if not data:
        frappe.throw(f"No statement data found for customer {cust_id}.")
        
    cust = data.get("customer", {})
    cust_name = cust.get("name") or cust_id
    txns = data.get("transactions", [])
    
    veh_filter = (vehicle or "").strip()
    if veh_filter and veh_filter.lower() != 'all':
        txns = [t for t in txns if (t.get('vehicle_registration') or '').strip().upper() == veh_filter.upper()]
        
    tot_litres = sum(flt(t.get('quantity') or 0) for t in txns)
    period_invoices = sum(flt(t.get('debit') or 0) for t in txns) if (veh_filter and veh_filter.lower() != 'all') else flt(data.get('period_invoices'))
    period_payments = sum(flt(t.get('credit') or 0) for t in txns) if (veh_filter and veh_filter.lower() != 'all') else flt(data.get('period_payments'))
    
    if not station:
        station = frappe.db.get_value("Fuel Station", {}, "station_name") or frappe.db.get_value("Fuel Station", {}, "name") or "RUBIS ENERGY - KILIBET SERVICE STATION"
        
    def fmt_num(val):
        try:
            v = flt(val)
            return f"{v:,.2f}"
        except:
            return "0.00"
            
    def fmt_dt(d_str):
        try:
            return formatdate(d_str, "dd/mm/yyyy")
        except:
            return str(d_str or "--")
            
    rows_html = ""
    # Opening balance
    rows_html += f"""
        <tr style="background: #f8fafc; font-weight: bold;">
            <td>{fmt_dt(data.get('start_date'))}</td>
            <td>OPENING B/F</td>
            <td>--</td>
            <td>--</td>
            <td>Balance brought forward from prior periods</td>
            <td style="text-align: right;">--</td>
            <td style="text-align: right;">--</td>
            <td style="text-align: right;">--</td>
            <td style="text-align: right; font-family: monospace;">{fmt_num(data.get('opening_balance'))}</td>
        </tr>
    """
    
    for t in txns:
        deb = flt(t.get('debit') or 0)
        crd = flt(t.get('credit') or 0)
        bal = flt(t.get('running_balance') if t.get('running_balance') is not None else t.get('balance', 0))
        
        ref_str = f"#{t.get('entry_number')}" if t.get('entry_number') else (t.get('trans_no') or t.get('reference_no') or '--')
        if t.get('purchase_order'):
            ref_str += f" (PO: {t.get('purchase_order')})"
            
        veh_str = t.get('vehicle_registration') or '--'
            
        desc_str = t.get('description') or '--'
        if t.get('item'):
            rate_val = flt(t.get('rate'))
            rate_part = f" @ KES {rate_val:.2f}" if rate_val > 0 else ""
            desc_str = f"{t.get('item')}{rate_part}"
        elif t.get('mode_of_payment'):
            csa_part = f" - Recv: {t.get('csa')}" if t.get('csa') else ''
            memo_part = f" - {t.get('memo')}" if t.get('memo') else ''
            desc_str = f"{t.get('mode_of_payment')}{csa_part}{memo_part}"
            
        qty_val = flt(t.get('quantity') or 0)
        qty_str = f"{qty_val:,.2f} L" if qty_val > 0 else "--"
        deb_str = fmt_num(deb) if deb > 0 else "--"
        crd_str = fmt_num(crd) if crd > 0 else "--"
        
        rows_html += f"""
            <tr>
                <td>{fmt_dt(t.get('date'))}</td>
                <td>{frappe.utils.escape_html(str(t.get('voucher_type') or t.get('ref_type') or 'TXN'))}</td>
                <td><b>{frappe.utils.escape_html(str(ref_str))}</b></td>
                <td style="font-family: monospace; font-weight: bold;">{frappe.utils.escape_html(str(veh_str))}</td>
                <td>{frappe.utils.escape_html(str(desc_str))}</td>
                <td style="text-align: right; color: #0284c7; font-family: monospace; font-weight: bold;">{qty_str}</td>
                <td style="text-align: right; color: #dc2626; font-family: monospace;">{deb_str}</td>
                <td style="text-align: right; color: #166534; font-family: monospace;">{crd_str}</td>
                <td style="text-align: right; font-weight: bold; font-family: monospace;">{fmt_num(bal)}</td>
            </tr>
        """
        
    # Closing balance
    rows_html += f"""
        <tr style="background: #eef2ff; font-weight: bold; border-top: 2px solid #0f172a;">
            <td>{fmt_dt(data.get('end_date'))}</td>
            <td>CLOSING C/F</td>
            <td>--</td>
            <td style="font-family: monospace; font-weight: bold;">{frappe.utils.escape_html(veh_filter) if veh_filter and veh_filter.lower() != 'all' else 'All Fleet'}</td>
            <td>TOTALS (VOLUME / INVOICED / PAID / DUE)</td>
            <td style="text-align: right; font-family: monospace; color: #0284c7; font-weight: bold;">{fmt_num(tot_litres)} L</td>
            <td style="text-align: right; font-family: monospace; color: #dc2626;">{fmt_num(period_invoices)}</td>
            <td style="text-align: right; font-family: monospace; color: #166534;">{fmt_num(period_payments)}</td>
            <td style="text-align: right; font-size: 11px; font-family: monospace; color: #1e1b4b;">{fmt_num(data.get('closing_balance'))}</td>
        </tr>
    """
    
    veh_sub_header = f"""<div style="font-size: 10px; color: #0284c7; margin-top: 3px; font-weight: bold;">Filtered Vehicle: {frappe.utils.escape_html(veh_filter)}</div>""" if (veh_filter and veh_filter.lower() != 'all') else ""
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Statement of Account - {frappe.utils.escape_html(cust_name)}</title>
        <style>
            body {{ font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9.5px; color: #111; margin: 15px; line-height: 1.35; }}
            .header-table {{ width: 100%; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 12px; }}
            .brand-title {{ font-size: 16px; font-weight: 800; color: #1e3a8a; }}
            .doc-title {{ font-size: 14px; font-weight: bold; text-align: right; color: #0f172a; text-transform: uppercase; }}
            .info-grid {{ width: 100%; margin-bottom: 12px; }}
            .info-box {{ border: 1px solid #cbd5e1; padding: 8px; border-radius: 4px; background: #f8fafc; }}
            table.ledger {{ width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 9px; }}
            table.ledger th, table.ledger td {{ border: 1px solid #cbd5e1; padding: 4px 5px; }}
            table.ledger th {{ background: #f1f5f9; text-transform: uppercase; font-size: 8px; }}
            .banking-box {{ margin-top: 15px; border: 1px solid #cbd5e1; padding: 8px; border-radius: 4px; background: #fafafa; font-size: 9px; }}
        </style>
    </head>
    <body>
        <table class="header-table">
            <tr>
                <td style="vertical-align: top;">
                    <div class="brand-title">{frappe.utils.escape_html(station)}</div>
                    <div style="font-size: 9px; color: #555; margin-top: 2px;">
                        Accounts Receivable Division<br>
                        Eldoret, Kenya<br>
                        Email: accounts@kilibetcore.co.ke
                    </div>
                </td>
                <td style="vertical-align: top; text-align: right;">
                    <div class="doc-title">Statement of Account</div>
                    <div style="font-size: 9.5px; color: #333; margin-top: 2px;">
                        <b>Period:</b> {fmt_dt(data.get('start_date'))} &mdash; {fmt_dt(data.get('end_date'))}<br>
                        <b>Date Generated:</b> {fmt_dt(frappe.utils.nowdate())}
                    </div>
                    {veh_sub_header}
                    <div style="margin-top: 4px; font-size: 11px; font-weight: bold; color: #1e3a8a;">
                        Closing Due: KES {fmt_num(data.get('closing_balance'))}
                    </div>
                </td>
            </tr>
        </table>

        <table class="info-grid">
            <tr>
                <td style="width: 52%; vertical-align: top; padding-right: 8px;">
                    <div class="info-box">
                        <div style="font-size: 8px; font-weight: bold; color: #64748b; text-transform: uppercase;">BILL TO CUSTOMER:</div>
                        <div style="font-size: 12px; font-weight: bold; color: #0f172a; margin: 2px 0;">{frappe.utils.escape_html(cust_name)}</div>
                        <div style="font-size: 9px; color: #475569;">
                            <b>Account / Fleet ID:</b> {frappe.utils.escape_html(str(cust.get('id') or 'N/A'))}<br>
                            {f"<b>Address:</b> {frappe.utils.escape_html(cust.get('address'))}<br>" if cust.get('address') and cust.get('address') != 'N/A' else ''}
                            {f"<b>Phone:</b> {frappe.utils.escape_html(cust.get('phone'))}<br>" if cust.get('phone') and cust.get('phone') != 'N/A' else ''}
                        </div>
                    </div>
                </td>
                <td style="width: 48%; vertical-align: top;">
                    <div class="info-box">
                        <div style="font-size: 8px; font-weight: bold; color: #64748b; text-transform: uppercase;">ACCOUNT SUMMARY:</div>
                        <table style="width: 100%; font-size: 8.5px; margin-top: 2px;">
                            <tr><td><b>Credit Limit:</b></td><td style="text-align: right; font-family: monospace;">KES {fmt_num(cust.get('credit_limit'))}</td></tr>
                            <tr><td><b>Opening Balance (B/F):</b></td><td style="text-align: right; font-family: monospace;">KES {fmt_num(data.get('opening_balance'))}</td></tr>
                            <tr><td><b>Total Fuel Litres:</b></td><td style="text-align: right; font-family: monospace; color:#0284c7; font-weight: bold;">{fmt_num(tot_litres)} L</td></tr>
                            <tr><td><b>Total Invoices (Period):</b></td><td style="text-align: right; font-family: monospace; color:#dc2626;">+ KES {fmt_num(period_invoices)}</td></tr>
                            <tr><td><b>Total Payments (Period):</b></td><td style="text-align: right; font-family: monospace; color:#166534;">- KES {fmt_num(period_payments)}</td></tr>
                            <tr style="border-top: 1px solid #cbd5e1; font-weight: bold;"><td><b>Total Amount Due:</b></td><td style="text-align: right; font-family: monospace; color:#1e3a8a; font-size: 9.5px;">KES {fmt_num(data.get('closing_balance'))}</td></tr>
                        </table>
                    </div>
                </td>
            </tr>
        </table>

        <table class="ledger">
            <thead>
                <tr>
                    <th style="width: 60px;">Date</th>
                    <th style="width: 70px;">Type</th>
                    <th style="width: 75px;">Reference #</th>
                    <th style="width: 75px;">Vehicle Plate</th>
                    <th>Description / Details</th>
                    <th style="text-align: right; width: 60px; color: #0284c7;">Litres (L)</th>
                    <th style="text-align: right; width: 68px; color: #dc2626;">Debit (+)</th>
                    <th style="text-align: right; width: 68px; color: #166534;">Credit (-)</th>
                    <th style="text-align: right; width: 78px;">Balance</th>
                </tr>
            </thead>
            <tbody>
                {rows_html}
            </tbody>
        </table>

        <div class="banking-box">
            <b>PAYMENT REMITTANCE INSTRUCTIONS:</b><br>
            Please make all cheque / direct bank transfers payable to <b>Kilibet Core Ltd</b>.<br>
            <b>Bank:</b> Equity Bank Kenya &nbsp;|&nbsp; <b>Account Name:</b> Kilibet Core Ltd &nbsp;|&nbsp; <b>Payment Terms:</b> 30 Days from invoice date.
        </div>

        <div style="margin-top: 18px; display: flex; justify-content: space-between; font-size: 8.5px;">
            <div><b>Prepared By:</b> __________________________</div>
            <div><b>Accounts Manager:</b> __________________________</div>
            <div><b>Received By (Debtor):</b> __________________________</div>
        </div>
    </body>
    </html>
    """
    
    pdf_bytes = get_pdf(html, {"orientation": "Portrait", "page-size": "A4"})
    
    safe_name = "".join(c for c in cust_name if c.isalnum() or c in (' ', '_', '-')).strip().replace(' ', '_')
    veh_part = f"_{veh_filter.replace(' ', '_')}" if (veh_filter and veh_filter.lower() != 'all') else ""
    filename = f"Statement_{safe_name}{veh_part}_{data.get('start_date')}_{data.get('end_date')}.pdf"
    
    frappe.response.filename = filename
    frappe.response.filecontent = pdf_bytes
    frappe.response.type = "pdf"



