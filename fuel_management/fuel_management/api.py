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
                fields=["pump_nozzle", "sales_quantity_electronic"]
            )
            
            # Aggregate Meter Sales and fetch prices
            tank_items = {} # Cache for tank -> item mapping
            item_prices = {} # Cache for item -> standard_rate mapping
            group_totals = {}
            
            for r in readings:
                qty = r.sales_quantity_electronic or 0.0
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
                group_totals[grp] = group_totals.get(grp, 0.0) + amount
                
            data["meter_sales_breakdown"] = [{"pump_group": g, "amount": a} for g, a in group_totals.items()]
                
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
    inventory_sales = frappe.db.sql("""
        SELECT SUM(amount) FROM `tabShift Inventory Sale` 
        WHERE parent=%s AND parenttype='Shift' AND sold_by=%s
    """, (shift_id, csa_id))
    data["inventory_sales"] = inventory_sales[0][0] if inventory_sales and inventory_sales[0][0] else 0.0
    
    # 3. Greasing Sales
    greasing_sales = frappe.db.sql("""
        SELECT SUM(total_amount) FROM `tabShift Greasing Sale` 
        WHERE parent=%s AND parenttype='Shift' AND csa=%s
    """, (shift_id, csa_id))
    data["greasing_sales"] = greasing_sales[0][0] if greasing_sales and greasing_sales[0][0] else 0.0
    
    # 4. Customer Payments
    # Customer payments is a standalone Doctype
    customer_payments = frappe.db.sql("""
        SELECT SUM(amount) FROM `tabCustomer Payment` 
        WHERE shift=%s AND csa=%s AND docstatus=1
    """, (shift_id, csa_id))
    
    # If Customer Payment docstatus=1 isn't standard, just sum all.
    if customer_payments and customer_payments[0][0]:
        data["customer_payments"] = customer_payments[0][0]
    else:
        customer_payments = frappe.db.sql("""
            SELECT SUM(amount) FROM `tabCustomer Payment` 
            WHERE shift=%s AND csa=%s
        """, (shift_id, csa_id))
        data["customer_payments"] = customer_payments[0][0] if customer_payments and customer_payments[0][0] else 0.0
        
    # 5. M-Pesa
    mpesa = frappe.db.sql("""
        SELECT SUM(amount) FROM `tabShift M-Pesa Payment` 
        WHERE parent=%s AND parenttype='Shift'
    """, (shift_id,))
    data["mpesa"] = mpesa[0][0] if mpesa and mpesa[0][0] else 0.0
    
    # 6. Invoices
    invoices = frappe.db.sql("""
        SELECT SUM(amount) FROM `tabShift Invoice` 
        WHERE parent=%s AND parenttype='Shift' AND csa=%s
    """, (shift_id, csa_id))
    data["invoices"] = invoices[0][0] if invoices and invoices[0][0] else 0.0
    
    # 7. Cards
    cards = frappe.db.sql("""
        SELECT SUM(amount) FROM `tabShift Card Payment` 
        WHERE parent=%s AND parenttype='Shift'
    """, (shift_id,))
    data["cards"] = cards[0][0] if cards and cards[0][0] else 0.0
    
    # 8. Expenses
    expenses = frappe.db.sql("""
        SELECT SUM(amount) FROM `tabShift Expense` 
        WHERE parent=%s AND parenttype='Shift' AND csa=%s
    """, (shift_id, csa_id))
    data["expenses"] = expenses[0][0] if expenses and expenses[0][0] else 0.0
    
    return data
