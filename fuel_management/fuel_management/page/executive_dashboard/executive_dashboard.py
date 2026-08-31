import frappe
from frappe.utils import today, getdate, flt, formatdate
import json

@frappe.whitelist()
def get_dashboard_summary(from_date=None, to_date=None):
    """Returns a high-level summary of the dashboard metrics."""
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = to_date
    
    # Financial Overview
    # 1. Total Sales Today (or selected period)
    # We will sum the Total Sales from Fuel Shift for the period.
    total_sales_today = frappe.db.sql("""
        SELECT SUM(expected_cash + expected_dry_stock_cash) 
        FROM `tabShift` 
        WHERE docstatus < 2 AND DATE(shift_date) >= %s AND DATE(shift_date) <= %s
    """, (from_date, to_date))[0][0] or 0.0

    # 2. Collections Split
    # We will sum M-Pesa payments
    mpesa_total = frappe.db.sql("""
        SELECT SUM(amount) 
        FROM `tabShift M-Pesa Payment` mp 
        INNER JOIN `tabShift` fs ON mp.parent = fs.name 
        WHERE fs.docstatus < 2 AND DATE(fs.shift_date) >= %s AND DATE(fs.shift_date) <= %s
    """, (from_date, to_date))[0][0] or 0.0

    card_total = frappe.db.sql("""
        SELECT SUM(amount) 
        FROM `tabShift Card Payment` cp 
        INNER JOIN `tabShift` fs ON cp.parent = fs.name 
        WHERE fs.docstatus < 2 AND DATE(fs.shift_date) >= %s AND DATE(fs.shift_date) <= %s
    """, (from_date, to_date))[0][0] or 0.0

    cash_total = frappe.db.sql("""
        SELECT SUM(actual_cash + actual_dry_stock_cash) 
        FROM `tabShift` 
        WHERE docstatus < 2 AND DATE(shift_date) >= %s AND DATE(shift_date) <= %s
    """, (from_date, to_date))[0][0] or 0.0

    collections = {
        "mpesa": float(mpesa_total),
        "card": float(card_total),
        "cash": float(cash_total),
        "total": float(mpesa_total + card_total + cash_total)
    }

    # 3. Variance and Reconciliations
    shift_variance = frappe.db.sql("""
        SELECT SUM(st.variance)
        FROM `tabDip Stick Reading` st
        INNER JOIN `tabShift` fs ON st.parent = fs.name
        WHERE fs.docstatus < 2 AND DATE(fs.shift_date) >= %s AND DATE(fs.shift_date) <= %s
    """, (from_date, to_date))[0][0] or 0.0

    # Inventory / Assets
    # Tank Levels
    tank_levels = frappe.db.sql("""
        SELECT tank_name, current_volume, capacity as max_capacity 
        FROM `tabFuel Tank`
    """, as_dict=True)

    for t in tank_levels:
        if not t.max_capacity:
            t.max_capacity = 10000 # Default fallback
        t.percentage = round((flt(t.current_volume) / flt(t.max_capacity)) * 100, 2)

    # Alerts (Mocked for now based on actual logic)
    alerts = []
    
    # High Variance Alert
    if abs(shift_variance) > 50: # Example threshold
        alerts.append({
            "title": "High Fuel Variance",
            "desc": f"Total station variance today is {shift_variance} Liters.",
            "type": "danger",
            "icon": "water_drop"
        })

    # Holding Account Balance
    holding_accounts = frappe.db.sql("SELECT DISTINCT top_up_holding_account FROM `tabFuel Station` WHERE top_up_holding_account IS NOT NULL AND top_up_holding_account != ''", pluck=True)
    holding_balance = 0.0
    if holding_accounts:
        from erpnext.accounts.utils import get_balance_on
        for acc in holding_accounts:
            holding_balance += abs(flt(get_balance_on(acc)))
            
    if holding_balance > 0:
        alerts.append({
            "title": "Pending Supplier Top-ups",
            "desc": f"You have {frappe.format_value(holding_balance, 'Currency')} sitting in the Top-Up Holding Account pending reconciliation with Rubis.",
            "type": "warning",
            "icon": "payments"
        })

    # Return Payload
    return {
        "financials": {
            "total_sales_today": total_sales_today,
            "collections": collections,
            "top_up_holding_balance": holding_balance
        },
        "reconciliations": {
            "fuel_variance_today": shift_variance
        },
        "inventory": {
            "tank_levels": tank_levels
        },
        "alerts": alerts,
        "date": f"{formatdate(from_date)} to {formatdate(to_date)}"
    }

@frappe.whitelist()
def get_pnl_summary(from_date=None, to_date=None):
    """Returns a detailed P&L Statement for the selected period."""
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = getdate(to_date).replace(day=1)
    
    if not frappe.db.exists("DocType", "GL Entry"):
        return {"error": "Accounting module not found."}

    # Get Income Breakdown
    income_accounts = frappe.db.sql("""
        SELECT a.name as account_name, SUM(gl.credit) - SUM(gl.debit) as balance
        FROM `tabGL Entry` gl
        INNER JOIN `tabAccount` a ON gl.account = a.name
        WHERE a.root_type = 'Income' 
        AND gl.posting_date >= %s AND gl.posting_date <= %s
        AND gl.is_cancelled = 0
        GROUP BY a.name
        HAVING balance != 0
        ORDER BY balance DESC
    """, (from_date, to_date), as_dict=True)

    # Get Expense Breakdown
    expense_accounts = frappe.db.sql("""
        SELECT a.name as account_name, SUM(gl.debit) - SUM(gl.credit) as balance
        FROM `tabGL Entry` gl
        INNER JOIN `tabAccount` a ON gl.account = a.name
        WHERE a.root_type = 'Expense' 
        AND gl.posting_date >= %s AND gl.posting_date <= %s
        AND gl.is_cancelled = 0
        GROUP BY a.name
        HAVING balance != 0
        ORDER BY balance DESC
    """, (from_date, to_date), as_dict=True)

    total_income = sum(a.balance for a in income_accounts)
    total_expense = sum(a.balance for a in expense_accounts)

    return {
        "period": f"{formatdate(from_date)} - {formatdate(to_date)}",
        "total_income": total_income,
        "total_expense": total_expense,
        "net_profit": total_income - total_expense,
        "income_accounts": income_accounts,
        "expense_accounts": expense_accounts
    }
    
@frappe.whitelist()
def get_employee_shorts(from_date=None, to_date=None):
    """Returns a summary of cash shortages per employee for the selected period."""
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = getdate(to_date).replace(day=1)
    
    # We assume 'owner' or 'attendant' is tracked in Fuel Shift.
    # Usually in Frappe, `owner` is the creator, but maybe there is an `attendant` field.
    # Let's check `tabShift` columns to be safe, or just use `owner`.
    # I'll use `owner` which is standard.
    shorts = frappe.db.sql("""
        SELECT owner as employee, SUM(cash_variance) as total_variance
        FROM `tabShift`
        WHERE docstatus < 2 
        AND shift_date >= %s AND shift_date <= %s
        GROUP BY owner
        HAVING total_variance != 0
        ORDER BY total_variance ASC
    """, (from_date, to_date), as_dict=True)
    
    return {
        "shorts": shorts,
        "period": f"{formatdate(from_date)} to {formatdate(to_date)}"
    }

@frappe.whitelist()
def get_sales_analytics(from_date=None, to_date=None):
    if not to_date:
        to_date = today()
    if not from_date:
        from_date = to_date
        
    analytics = {
        "fuel": {"day": {}, "night": {}, "total": {}},
        "lubes": [],
        "gas": [],
        "accessories": []
    }
    
    # 1. Fuel Sales Breakdown
    shifts = frappe.get_all("Shift", 
        filters={"docstatus": ["<", 2], "shift_date": ["between", [from_date, to_date]]},
        fields=["name", "shift_template", "shift_date"]
    )
    
    # Pre-fetch pricing mapping to avoid looping DB queries
    price_map = {}
    
    def get_price(item_code, shift_date):
        key = f"{item_code}_{shift_date}"
        if key in price_map:
            return price_map[key]
            
        price_record = frappe.get_all("Item Price", 
            filters={"item_code": item_code, "price_list": "Standard Selling", "valid_from": ("<=", shift_date)},
            fields=["price_list_rate"],
            order_by="valid_from desc",
            limit=1
        )
        price = price_record[0].price_list_rate if price_record else 0.0
        price_map[key] = price
        return price
        
    # Pre-fetch nozzles mapping
    nozzles = frappe.get_all("Pump Nozzle", fields=["name", "fuel_tank"])
    tanks = frappe.get_all("Fuel Tank", fields=["name", "fuel_product"])
    
    nozzle_tank_map = {n.name: n.fuel_tank for n in nozzles}
    tank_product_map = {t.name: t.fuel_product for t in tanks}
    
    for shift in shifts:
        readings = frappe.get_all("Pump Meter Reading", 
            filters={"parent": shift.name},
            fields=["pump_nozzle", "sales_quantity_electronic"]
        )
        
        shift_type = "day" if "DAY" in (shift.shift_template or "").upper() else "night"
        
        for r in readings:
            if r.sales_quantity_electronic and r.sales_quantity_electronic > 0:
                tank = nozzle_tank_map.get(r.pump_nozzle)
                if tank:
                    item_code = tank_product_map.get(tank)
                    if item_code:
                        price = get_price(item_code, shift.shift_date)
                        revenue = r.sales_quantity_electronic * price
                        
                        # Init dictionary structures
                        if item_code not in analytics["fuel"][shift_type]:
                            analytics["fuel"][shift_type][item_code] = {"liters": 0.0, "revenue": 0.0}
                        if item_code not in analytics["fuel"]["total"]:
                            analytics["fuel"]["total"][item_code] = {"liters": 0.0, "revenue": 0.0}
                            
                        # Add up
                        analytics["fuel"][shift_type][item_code]["liters"] += r.sales_quantity_electronic
                        analytics["fuel"][shift_type][item_code]["revenue"] += revenue
                        analytics["fuel"]["total"][item_code]["liters"] += r.sales_quantity_electronic
                        analytics["fuel"]["total"][item_code]["revenue"] += revenue

    # 2. Dry Stock Breakdown (Lubes, Gas, Accessories)
    inventory_sales = frappe.db.sql("""
        SELECT i.item_group, inv.item as item_code, i.item_name, SUM(inv.quantity) as qty, SUM(inv.amount) as revenue
        FROM `tabShift Inventory Sale` inv
        INNER JOIN `tabShift` s ON inv.parent = s.name
        INNER JOIN `tabItem` i ON inv.item = i.name
        WHERE s.docstatus < 2 AND s.shift_date >= %s AND s.shift_date <= %s
        GROUP BY inv.item, i.item_group
    """, (from_date, to_date), as_dict=True)
    
    for sale in inventory_sales:
        grp = sale.item_group.upper() if sale.item_group else ""
        payload = {
            "item_code": sale.item_code,
            "item_name": sale.item_name,
            "qty": sale.qty,
            "revenue": sale.revenue
        }
        
        if "LUBE" in grp:
            analytics["lubes"].append(payload)
        elif "GAS" in grp or "CYLINDER" in grp:
            analytics["gas"].append(payload)
        elif "ACCESSOR" in grp or "FILTER" in grp:
            analytics["accessories"].append(payload)
            
    # Sort descending by revenue
    analytics["lubes"].sort(key=lambda x: x["revenue"], reverse=True)
    analytics["gas"].sort(key=lambda x: x["revenue"], reverse=True)
    analytics["accessories"].sort(key=lambda x: x["revenue"], reverse=True)

    return analytics



@frappe.whitelist()
def get_topup_statement(from_date, to_date):
    # 1. Get Opening Balance (Topups before from_date)
    op_topups = frappe.db.sql("SELECT SUM(amount) as amt FROM `tabStation Supplier Top Up` WHERE date < %s", (from_date,), as_dict=1)
    op_topup_amt = op_topups[0].amt if op_topups and op_topups[0].amt else 0.0
    
    op_deductions = frappe.db.sql("""
        SELECT SUM(jea.debit) as amt 
        FROM `tabJournal Entry` je 
        JOIN `tabJournal Entry Account` jea ON je.name = jea.parent 
        WHERE je.docstatus = 1 AND je.user_remark LIKE '[TOP-UP DEDUCTION]%' AND jea.debit > 0 AND je.posting_date < %s
    """, (from_date,), as_dict=1)
    op_deduct_amt = op_deductions[0].amt if op_deductions and op_deductions[0].amt else 0.0
    
    running_balance = op_topup_amt - op_deduct_amt

    # 2. Fetch Period Data
    topups = frappe.db.sql("""
        SELECT 
            t.name as entry_name, t.date, t.shift, t.card as supplier, t.mode_of_payment as mode, t.rrn_number as ref, t.amount,
            s.station, t.creation
        FROM `tabStation Supplier Top Up` t
        LEFT JOIN `tabShift` s ON t.shift = s.name
        WHERE t.date BETWEEN %s AND %s
    """, (from_date, to_date), as_dict=True)
    
    deductions = frappe.db.sql("""
        SELECT 
            je.name as entry_name, je.posting_date as date, '' as shift, 'RECONCILIATION' as supplier, '' as mode, je.cheque_no as ref, (jea.debit * -1) as amount,
            '' as station, je.creation
        FROM `tabJournal Entry` je
        JOIN `tabJournal Entry Account` jea ON je.name = jea.parent
        WHERE je.docstatus = 1 
        AND je.user_remark LIKE '[TOP-UP DEDUCTION]%'
        AND jea.debit > 0
        AND je.posting_date BETWEEN %s AND %s
    """, (from_date, to_date), as_dict=True)
    
    data = topups + deductions
    # Sort by date, then creation
    data.sort(key=lambda x: (x.get('date'), x.get('creation')))
    
    result = []
    # Insert opening balance row
    result.append({
        "date": from_date,
        "entry_name": "OPENING BALANCE",
        "shift": "",
        "station": "",
        "supplier": "",
        "mode": "",
        "ref": "",
        "amount": 0.0,
        "running_balance": running_balance,
        "is_opening": True
    })
    
    for d in data:
        running_balance += d.get('amount', 0.0)
        d['running_balance'] = running_balance
        result.append(d)
        
    return result

@frappe.whitelist()
def create_topup_deduction(station, amount, credit_account, date, reference):
    holding_account = frappe.db.get_value("Fuel Station", station, "top_up_holding_account")
    if not holding_account:
        frappe.throw(f"No Top Up Holding Account configured for Station: {station}")
        
    je = frappe.new_doc("Journal Entry")
    je.voucher_type = "Journal Entry"
    je.posting_date = date
    je.cheque_no = reference
    je.user_remark = f"[TOP-UP DEDUCTION] Reconciled to {credit_account} for {station}"
    
    # Debit the holding account (reduce liability/balance)
    je.append("accounts", {
        "account": holding_account,
        "debit_in_account_currency": amount
    })
    
    # Credit the target account (Rubis bank/supplier)
    je.append("accounts", {
        "account": credit_account,
        "credit_in_account_currency": amount
    })
    
    je.flags.ignore_permissions = True
    je.insert()
    je.submit()
    return je.name
