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

import re
from datetime import datetime, timedelta

def parse_lube_litres(item_code, item_name):
    txt = f"{item_code} {item_name}".upper()
    m_ml = re.search(r'(\d+(?:\.\d+)?)\s*ML\b', txt)
    if m_ml:
        try:
            return float(m_ml.group(1)) / 1000.0
        except Exception:
            pass
    m_l = re.search(r'(\d+(?:\.\d+)?)\s*L(?:TR|ITRE|ITRES|TRS)?\b', txt)
    if m_l:
        try:
            return float(m_l.group(1))
        except Exception:
            pass
    return 1.0

def parse_gas_kg(item_code, item_name):
    txt = f"{item_code} {item_name}".upper()
    m_kg = re.search(r'(\d+(?:\.\d+)?)\s*KG\b', txt)
    if m_kg:
        try:
            return float(m_kg.group(1))
        except Exception:
            pass
    return 1.0

@frappe.whitelist()
def get_sales_analytics(from_date=None, to_date=None):
    if not to_date:
        to_date = today()
    if not from_date:
        # Default to 7 days window (today - 6 days to today)
        from_date = frappe.utils.add_days(to_date, -6)
        
    d_start = getdate(from_date)
    d_end = getdate(to_date)
    
    # Generate daily sequence of dates
    num_days = (d_end - d_start).days + 1
    date_list = [(d_start + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(num_days)]
    date_labels = [(d_start + timedelta(days=i)).strftime('%d %b') for i in range(num_days)]

    # 1. Fuel Sales Breakdown & Time-Series
    fuel_readings = frappe.db.sql("""
        SELECT 
            s.shift_date,
            t.fuel_product as item_code,
            SUM(CASE WHEN UPPER(COALESCE(s.shift_template, '')) LIKE '%%DAY%%' THEN r.sales_quantity_electronic ELSE 0 END) as day_liters,
            SUM(CASE WHEN UPPER(COALESCE(s.shift_template, '')) LIKE '%%NIGHT%%' THEN r.sales_quantity_electronic ELSE 0 END) as night_liters,
            SUM(r.sales_quantity_electronic) as total_liters
        FROM `tabPump Meter Reading` r
        JOIN `tabShift` s ON r.parent = s.name
        LEFT JOIN `tabPump Nozzle` n ON r.pump_nozzle = n.name
        LEFT JOIN `tabFuel Tank` t ON n.fuel_tank = t.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s AND t.fuel_product IS NOT NULL
        GROUP BY s.shift_date, t.fuel_product
        ORDER BY s.shift_date ASC, t.fuel_product ASC
    """, (from_date, to_date), as_dict=True)

    # Pre-fetch pricing mapping
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

    fuel_products = sorted(list(set(r.item_code for r in fuel_readings if r.item_code)))
    fuel_series = []
    fuel_summary = {}
    total_fuel_liters = 0.0
    total_fuel_revenue = 0.0

    for prod in fuel_products:
        daily_map = {d: 0.0 for d in date_list}
        tot_day = 0.0
        tot_night = 0.0
        tot_liters = 0.0
        tot_rev = 0.0
        
        for r in fuel_readings:
            if r.item_code == prod:
                sd = str(r.shift_date)
                if sd in daily_map:
                    daily_map[sd] += flt(r.total_liters or 0.0)
                tot_day += flt(r.day_liters or 0.0)
                tot_night += flt(r.night_liters or 0.0)
                tot_liters += flt(r.total_liters or 0.0)
                price = get_price(prod, sd)
                tot_rev += flt(r.total_liters or 0.0) * price
                
        fuel_series.append({
            "name": prod,
            "values": [round(daily_map[d], 2) for d in date_list]
        })
        
        fuel_summary[prod] = {
            "item_code": prod,
            "day_liters": round(tot_day, 2),
            "night_liters": round(tot_night, 2),
            "total_liters": round(tot_liters, 2),
            "revenue": round(tot_rev, 2)
        }
        total_fuel_liters += tot_liters
        total_fuel_revenue += tot_rev

    # 2. Lubes Sales (In Litres)
    lubes_raw = frappe.db.sql("""
        SELECT 
            s.shift_date,
            inv.item as item_code,
            i.item_name,
            i.stock_uom,
            SUM(inv.quantity) as qty,
            SUM(inv.amount) as revenue
        FROM `tabShift Inventory Sale` inv
        JOIN `tabShift` s ON inv.parent = s.name
        JOIN `tabItem` i ON inv.item = i.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s AND UPPER(i.item_group) = 'LUBES'
        GROUP BY s.shift_date, inv.item
        ORDER BY s.shift_date ASC
    """, (from_date, to_date), as_dict=True)

    daily_lubes_liters = {d: 0.0 for d in date_list}
    lubes_items_dict = {}
    total_lubes_liters = 0.0
    total_lubes_revenue = 0.0

    for row in lubes_raw:
        sd = str(row.shift_date)
        pack_l = parse_lube_litres(row.item_code, row.item_name)
        row_liters = flt(row.qty or 0.0) * pack_l
        if sd in daily_lubes_liters:
            daily_lubes_liters[sd] += row_liters
        
        code = row.item_code
        if code not in lubes_items_dict:
            lubes_items_dict[code] = {
                "item_code": code,
                "item_name": row.item_name or code,
                "pack_size": pack_l,
                "qty": 0.0,
                "total_liters": 0.0,
                "revenue": 0.0
            }
        lubes_items_dict[code]["qty"] += flt(row.qty or 0.0)
        lubes_items_dict[code]["total_liters"] += row_liters
        lubes_items_dict[code]["revenue"] += flt(row.revenue or 0.0)
        total_lubes_liters += row_liters
        total_lubes_revenue += flt(row.revenue or 0.0)

    lubes_list = sorted(lubes_items_dict.values(), key=lambda x: x["total_liters"], reverse=True)
    lubes_timeline = [round(daily_lubes_liters[d], 2) for d in date_list]

    # 3. Gas & Cylinders
    gas_cyl_raw = frappe.db.sql("""
        SELECT 
            s.shift_date,
            inv.item as item_code,
            i.item_name,
            i.item_group,
            i.stock_uom,
            SUM(inv.quantity) as qty,
            SUM(inv.amount) as revenue
        FROM `tabShift Inventory Sale` inv
        JOIN `tabShift` s ON inv.parent = s.name
        JOIN `tabItem` i ON inv.item = i.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s AND UPPER(i.item_group) IN ('GAS', 'CYLINDER')
        GROUP BY s.shift_date, inv.item
        ORDER BY s.shift_date ASC
    """, (from_date, to_date), as_dict=True)

    daily_gas_kgs = {d: 0.0 for d in date_list}
    daily_cylinders = {d: 0.0 for d in date_list}
    gas_items_dict = {}
    cyl_items_dict = {}
    total_gas_kgs = 0.0
    total_cylinders_count = 0.0
    total_gas_rev = 0.0
    total_cyl_rev = 0.0

    for row in gas_cyl_raw:
        sd = str(row.shift_date)
        grp = (row.item_group or "").upper()
        qty = flt(row.qty or 0.0)
        rev = flt(row.revenue or 0.0)
        code = row.item_code
        
        if "GAS" in grp:
            kg_rating = parse_gas_kg(row.item_code, row.item_name)
            tot_kg = qty * kg_rating
            if sd in daily_gas_kgs:
                daily_gas_kgs[sd] += tot_kg
            if code not in gas_items_dict:
                gas_items_dict[code] = {
                    "item_code": code,
                    "item_name": row.item_name or code,
                    "kg_rating": kg_rating,
                    "qty": 0.0,
                    "total_kg": 0.0,
                    "revenue": 0.0
                }
            gas_items_dict[code]["qty"] += qty
            gas_items_dict[code]["total_kg"] += tot_kg
            gas_items_dict[code]["revenue"] += rev
            total_gas_kgs += tot_kg
            total_gas_rev += rev
        elif "CYLINDER" in grp:
            if sd in daily_cylinders:
                daily_cylinders[sd] += qty
            if code not in cyl_items_dict:
                cyl_items_dict[code] = {
                    "item_code": code,
                    "item_name": row.item_name or code,
                    "qty": 0.0,
                    "revenue": 0.0
                }
            cyl_items_dict[code]["qty"] += qty
            cyl_items_dict[code]["revenue"] += rev
            total_cylinders_count += qty
            total_cyl_rev += rev

    gas_items_list = sorted(gas_items_dict.values(), key=lambda x: x["total_kg"], reverse=True)
    cylinder_items_list = sorted(cyl_items_dict.values(), key=lambda x: x["qty"], reverse=True)

    # 4. Filters & Accessories
    filters_acc_raw = frappe.db.sql("""
        SELECT 
            s.shift_date,
            inv.item as item_code,
            i.item_name,
            i.item_group,
            i.stock_uom,
            SUM(inv.quantity) as qty,
            SUM(inv.amount) as revenue
        FROM `tabShift Inventory Sale` inv
        JOIN `tabShift` s ON inv.parent = s.name
        JOIN `tabItem` i ON inv.item = i.name
        WHERE s.docstatus < 2 AND s.shift_date BETWEEN %s AND %s AND UPPER(i.item_group) IN ('FILTERS', 'ACCESSORIES')
        GROUP BY s.shift_date, inv.item
        ORDER BY s.shift_date ASC
    """, (from_date, to_date), as_dict=True)

    daily_filters_qty = {d: 0.0 for d in date_list}
    filters_items_dict = {}
    total_filters_qty = 0.0
    total_filters_rev = 0.0

    for row in filters_acc_raw:
        sd = str(row.shift_date)
        qty = flt(row.qty or 0.0)
        rev = flt(row.revenue or 0.0)
        code = row.item_code
        if sd in daily_filters_qty:
            daily_filters_qty[sd] += qty
        if code not in filters_items_dict:
            filters_items_dict[code] = {
                "item_code": code,
                "item_name": row.item_name or code,
                "item_group": row.item_group or "FILTERS",
                "qty": 0.0,
                "revenue": 0.0
            }
        filters_items_dict[code]["qty"] += qty
        filters_items_dict[code]["revenue"] += rev
        total_filters_qty += qty
        total_filters_rev += rev

    filters_list = sorted(filters_items_dict.values(), key=lambda x: x["revenue"], reverse=True)

    return {
        "dates": date_list,
        "date_labels": date_labels,
        "fuel": {
            "products": fuel_products,
            "series": fuel_series,
            "summary": fuel_summary,
            "total_liters": round(total_fuel_liters, 2),
            "total_revenue": round(total_fuel_revenue, 2)
        },
        "lubes": {
            "timeline_liters": lubes_timeline,
            "total_liters": round(total_lubes_liters, 2),
            "total_revenue": round(total_lubes_revenue, 2),
            "items": lubes_list
        },
        "gas": {
            "timeline_kgs": [round(daily_gas_kgs[d], 2) for d in date_list],
            "timeline_cylinders": [round(daily_cylinders[d], 2) for d in date_list],
            "total_kgs": round(total_gas_kgs, 2),
            "total_cylinders": round(total_cylinders_count, 2),
            "total_gas_revenue": round(total_gas_rev, 2),
            "total_cylinder_revenue": round(total_cyl_rev, 2),
            "gas_items": gas_items_list,
            "cylinder_items": cylinder_items_list
        },
        "accessories": {
            "timeline_qty": [round(daily_filters_qty[d], 2) for d in date_list],
            "total_qty": round(total_filters_qty, 2),
            "total_revenue": round(total_filters_rev, 2),
            "items": filters_list
        }
    }



@frappe.whitelist()
def get_topup_statement(from_date, to_date):
    # 1. Get Opening Balance (Topups before from_date)
    op_topups = frappe.db.sql("SELECT SUM(amount) as amt FROM `tabStation Supplier Top Up` WHERE date < %s", (from_date,), as_dict=1)
    op_topup_amt = op_topups[0].amt if op_topups and op_topups[0].amt else 0.0
    
    op_deductions = frappe.db.sql("""
        SELECT SUM(jea.debit) as amt 
        FROM `tabJournal Entry` je 
        JOIN `tabJournal Entry Account` jea ON je.name = jea.parent 
        WHERE je.docstatus = 1 AND je.user_remark LIKE %s AND jea.debit > 0 AND je.posting_date < %s
    """, ('[TOP-UP DEDUCTION]%', from_date), as_dict=1)
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
        AND je.user_remark LIKE %s
        AND jea.debit > 0
        AND je.posting_date BETWEEN %s AND %s
    """, ('[TOP-UP DEDUCTION]%', from_date, to_date), as_dict=True)
    
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
