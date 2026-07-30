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
def email_shift_report(shift_name, email_address):
    try:
        # Generate the PDF of the Shift End Report
        pdf = frappe.get_print("Shift", shift_name, "End of Shift Report", as_pdf=True)
        
        # Send the email
        frappe.sendmail(
            recipients=[email_address],
            subject=f"End of Shift Report - {shift_name}",
            message=f"Please find attached the End of Shift Report for Shift {shift_name}.",
            attachments=[{
                "fname": f"Shift_Report_{shift_name}.pdf",
                "fcontent": pdf
            }]
        )
        return {"status": "success", "message": f"Report successfully emailed to {email_address}"}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), f"Failed to email shift report for {shift_name}")
        return {"status": "error", "message": str(e)}
